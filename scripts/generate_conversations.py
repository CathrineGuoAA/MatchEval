#!/usr/bin/env python3
"""
Automated batch conversation generator for Mijke (openai-demo backend).

Instead of a human typing turn by turn, this uses a second LLM call as a
"simulated user" with a persona derived from a real row of
org_service_details.csv, and drives a full multi-turn conversation against
the locally-running Mijke backend (localhost:8000/chat). Each finished
conversation is saved in the same Conversation JSON shape used throughout
this project, plus an `expectedOrganization` field recording which CSV row
the persona was built from - so later scoring can check whether Mijke's
actual recommendation matches what it should have found.

Requires: the openai-demo backend running locally (see chat_with_mijke.py
header for setup), and `requests` (already installed).

Usage:
  python3 generate_conversations.py 5     # pilot batch of 5
  python3 generate_conversations.py 100   # full batch of 100
"""

import concurrent.futures
import csv
import json
import random
import re
import sys
import time
import uuid
from collections import defaultdict
from pathlib import Path

import requests

ENV_PATH = Path("/Users/mirror/Mijke-Platform/apps/backends/openai-demo/.env")
MIJKE_URL = "http://localhost:8000/chat"
OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"
MODEL = "gpt-4.1-mini"
CSV_PATH = Path(
    "/Users/mirror/Library/CloudStorage/OneDrive-TUEindhoven/0. Mijke 2026/040826_Dataset/org_service_details.csv"
)
OUT_DIR = Path(__file__).parent / "mijke-test-conversations"
MAX_TURNS = 14  # safety cap on user turns per conversation
MAX_WORKERS = 5  # concurrent conversations

# Copied verbatim from apps/backends/openai-demo/SYSTEM_PROMPT.md on the
# openai-demo branch (same string used in chat_with_mijke.py).
MIJKE_SYSTEM_PROMPT = """HIGHEST-PRIORITY RULES:

1. Reply entirely in the language of the user's latest message.
2. Never mix languages.
3. Ask only one question per response.
4. Use simple CEFR A2 language.
5. Only use organizations supplied in the current context.
6. Recommend exactly one organization after the need is clear.

0. Persona
Your name is Mijke, a matchmaker chatbot. Your goal is twofold:
a. Understand and clarify the user's real situation.
Do this by asking questions that explore:
What the user is trying to do (goal or task)
What is making it difficult (barriers)
What skills or tools they may be missing (capabilities)
Do not assume the first message contains the full picture.
b. After understanding the situation, suggest only one matching organization from the dataset, and explain clearly how it relates to the user's need.
Do Not: Suggest any organization outside the list provided. Suggest any general knowledge solution.
1. Dataset Analysis
Task: analyze the file uploaded before the first interaction to understand the available organizations in the Eindhoven region.
The list contains: Organization names. Descriptions of their services.
2. User Input Processing Task
2.1. Text Interpretation Analyze user input for keywords and themes to determine the assistance the user requires.
Use a step-by-step approach to uncover the user's intended task or goal, any barrier, and any missing skills or resources.
2.2. Considerations for Input
Recognize linguistic and cultural nuances, common spelling errors and phonetic variations.
When encountering potential misunderstandings due to errors, ask clarifying questions before proceeding.
3. Interaction Guidelines
3.1. Simplified Responses. Use short sentences and simple vocabulary. Clarify the user's intent with clear options.
3.2. Tone: professional but approachable, friendly and informal but respectful, always respectful, slightly enthusiastic without being pushy.
3.3. Avoid being dismissive or condescending. Avoid being too formal or distant.
3.4. Clarify Without Correcting. Gently clarify mistakes without pointing them out.
4. Language Guidelines
4.1-4.2. Dutch and English Language Level: Flesch score 80-90 (Easy). Sentence length 10-12 words.
4.3. Always use common, high-frequency vocabulary familiar to adults with low literacy (target CEFR A2 or lower). Use everyday words over institutional/bureaucratic/technical terms. Avoid abstract or compound nouns. Use consistent terminology throughout.
Before sending a response, internally simulate whether a user with CEFR A2-level comprehension would understand it. If not, simplify further.
4.4. Always respond in the same language used by the user. If the user switches languages mid-conversation, switch as well without confirmation.
5. Interaction with the User
5.1. Generate simple and short questions (maximum 20) to uncover what the user is really trying to do, what is stopping them, and what skills or tools they may lack. One question at a time - wait for the user's response before continuing.
6. Response Evaluation and Organization Suggestion
6.1. Evaluate the Match. Based on user responses, match the user's needs with an organization on the list. Only suggest a match after the user's situation has been fully explored. Suggest the closest match from the dataset, and clearly explain how it can help.
6.2. Avoid General Recommendations. Hide your reasoning process and only share the final suggestion. You are forbidden to suggest places, services, websites, or solutions that are outside the dataset. If no perfect match exists, select the most helpful available organization and explain what part of the problem they can help with.
7. Confirmation and Referral
7.1. Provide Contact Information. If the user is interested, share contact information and basic instructions on how to seek help.
7.2. Offer Further Assistance. When giving instructions: use bullet points, incorporate emoticons when necessary, respond in the language of the user's last message."""


def load_api_key():
    text = ENV_PATH.read_text(encoding="utf-8")
    m = re.search(r"^OPENAI_API_KEY=(.+)$", text, re.MULTILINE)
    if not m or not m.group(1).strip() or m.group(1).strip() == "openai_key_here":
        raise RuntimeError(f"OPENAI_API_KEY not set in {ENV_PATH}")
    return m.group(1).strip()


API_KEY = load_api_key()


def load_rows():
    with open(CSV_PATH, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


# The 6 official domains from Inclusive Society's "Domain Explainer.docx"
# (Movisie Leefgebiedenwijzer-based), mapped from the CSV's raw Dutch
# service_life_areas tags. A row is assigned to the first of ITS OWN tags
# (in listed order) that appears in this map.
#
# Domain -> what it covers, per the explainer doc:
#   LIVING            Housing, neighbourhood/district, transportation, household ADLs
#   HEALTH            Physical + mental health, self-care, well-being, illness/disability
#   FINANCE           Income, expenses, administration, insurance, financial care for others
#   WORK_ACTIVITIES   Work, daytime activities, activities, education/training, leisure
#   SOCIAL_RELATIONS  Family, relations/friends, neighbours, professional contacts, social media
#   PURPOSE           Drives, meaning, dreams, desires, culture/values, spirituality, motivation
#
# "Politie en justitie" (15 rows) doesn't map to any of the 6 domains and is
# excluded from the sample.
CATEGORY_MAP = {
    "Wonen": "LIVING",
    "Huishouden": "LIVING",
    "Vervoer": "LIVING",
    "Geestelijke gezondheid": "HEALTH",
    "Lichamelijke gezondheid": "HEALTH",
    "Persoonlijke verzorging": "HEALTH",
    "Alcohol, drugs, gamen en gokken": "HEALTH",
    "Geld": "FINANCE",
    "Werk": "WORK_ACTIVITIES",
    "Dagelijkse activiteiten en meedoen": "WORK_ACTIVITIES",
    "Leren": "WORK_ACTIVITIES",
    "Huiselijke relaties en sociale contacten": "SOCIAL_RELATIONS",
    "Gezin en opvoeden": "SOCIAL_RELATIONS",
    "Zingeving": "PURPOSE",
}


def primary_category(row):
    tags = [t.strip() for t in (row.get("service_life_areas") or "").split("|") if t.strip()]
    for t in tags:
        if t in CATEGORY_MAP:
            return CATEGORY_MAP[t]
    return None


def stratified_sample(rows, n):
    """Bucket by (Sichen's 5 categories, referral type) so the sample spans
    all 5 test categories and the referral-required split within each,
    instead of clustering on the biggest raw bucket (mental health)."""
    buckets = defaultdict(list)
    for r in rows:
        cat = primary_category(r)
        if cat is None:
            continue  # not in scope for this test round (police/justice, transport)
        offer = (r.get("service_offer_type") or "Onbekend").strip()
        buckets[(cat, offer)].append(r)
    keys = list(buckets.keys())
    random.shuffle(keys)
    sample = []
    i = 0
    while len(sample) < n and any(buckets[k] for k in keys):
        key = keys[i % len(keys)]
        pool = buckets[key]
        if pool:
            sample.append(pool.pop(random.randrange(len(pool))))
        i += 1
    return sample[:n]


def build_persona(row):
    return {
        "organization_name": (row.get("organization_name") or "").strip(),
        "service_name": (row.get("service_name") or "").strip(),
        "service_description": (row.get("service_description") or "")[:800],
        "life_areas": (row.get("service_life_areas") or "").strip(),
        "care_types": (row.get("service_care_types") or "").strip(),
        "offer_type": (row.get("service_offer_type") or "").strip(),
        "age_groups": (row.get("service_age_groups") or "").strip(),
        "test_category": primary_category(row),
    }


SIMULATOR_SYSTEM_TEMPLATE = """You are roleplaying as a real Dutch WhatsApp user testing a social-services \
chatbot called Mijke, for an accessibility research study. This is a simulation for research \
purposes - stay in character the whole time.

Your hidden underlying need (reveal gradually, only when asked - never state it all at once):
- Type of help needed: {service_name}
- Life area: {life_areas}
- Context: {service_description}

Style rules (important):
- Write only in Dutch, casual WhatsApp style, SHORT messages (1 sentence, sometimes a fragment).
- Simulate basic/low literacy: simple words, occasional realistic typos, no perfect grammar or punctuation.
- Never mention you are an AI, a test, or a persona. Never break character.
- Do not volunteer your whole situation in one message - answer only what is asked, let the \
assistant ask follow-up questions.
- Your FIRST message should be vague and indirect (like real users often are), not a direct \
request naming the service. You can phrase it as if asking on behalf of yourself or a friend.
- Once the assistant gives you a concrete organization/contact info and you feel satisfied \
(or after it has offered to help you further twice), wrap up naturally in Dutch (e.g. "oke \
dankjewel" / "nee dat is goed zo"). Then, and only then, on your NEXT turn reply with exactly \
the single token [END] and nothing else.
- If the conversation is going in circles or not making sense after several turns, also just \
reply with [END].
"""


def openai_chat(messages, temperature=0.9, max_tokens=150):
    resp = requests.post(
        OPENAI_CHAT_URL,
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
        json={"model": MODEL, "messages": messages, "temperature": temperature, "max_tokens": max_tokens},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"].strip()


def simulate_user_turn(persona, convo_view):
    sim_messages = [{"role": "system", "content": SIMULATOR_SYSTEM_TEMPLATE.format(**persona)}]
    for m in convo_view:
        # invert roles: Mijke's turns look like "user" input to the simulator,
        # the simulator's own past turns look like its own "assistant" replies.
        sim_messages.append({"role": "assistant" if m["role"] == "user" else "user", "content": m["content"]})
    if not convo_view:
        sim_messages.append({"role": "user", "content": "(Start the conversation now with your opening message.)"})
    return openai_chat(sim_messages, temperature=0.9, max_tokens=120)


def extract_text(response_json):
    if isinstance(response_json.get("output_text"), str):
        return response_json["output_text"]
    chunks = []
    for item in response_json.get("output", []) or []:
        if item.get("type") == "message":
            for c in item.get("content", []) or []:
                if c.get("type") in ("output_text", "text") and c.get("text"):
                    chunks.append(c["text"])
    return "\n".join(chunks) if chunks else None


def call_mijke(history_for_mijke):
    payload = {"messages": history_for_mijke, "stream": False, "temperature": 0.7, "model_id": MODEL}
    resp = requests.post(MIJKE_URL, json=payload, timeout=60)
    resp.raise_for_status()
    return extract_text(resp.json())


def run_conversation(persona):
    history_for_mijke = [{"role": "system", "content": MIJKE_SYSTEM_PROMPT}]
    convo_view = []
    messages_out = []
    for _ in range(MAX_TURNS):
        user_msg = simulate_user_turn(persona, convo_view)
        if "[END]" in user_msg:
            # Model sometimes appends the token to a real closing line instead
            # of sending it alone - keep the closing line if there is one,
            # otherwise just stop.
            cleaned = user_msg.replace("[END]", "").strip()
            if cleaned:
                history_for_mijke.append({"role": "user", "content": cleaned})
                messages_out.append({"id": str(uuid.uuid4()), "role": "user", "content": cleaned, "comments": []})
                closing_reply = call_mijke(history_for_mijke)
                if closing_reply:
                    messages_out.append({"id": str(uuid.uuid4()), "role": "model", "content": closing_reply, "comments": []})
            break
        convo_view.append({"role": "user", "content": user_msg})
        history_for_mijke.append({"role": "user", "content": user_msg})
        messages_out.append({"id": str(uuid.uuid4()), "role": "user", "content": user_msg, "comments": []})

        reply = call_mijke(history_for_mijke)
        if reply is None:
            break
        convo_view.append({"role": "model", "content": reply})
        history_for_mijke.append({"role": "assistant", "content": reply})
        messages_out.append({"id": str(uuid.uuid4()), "role": "model", "content": reply, "comments": []})
    return messages_out


def is_sensitive(persona):
    text = f"{persona['life_areas']} {persona['service_description']}".lower()
    return any(k in text for k in ["geestelijke gezondheid", "verslav", "psychisch", "suïcid", "crisis"])


def process_one(i, total, row):
    persona = build_persona(row)
    label = f"[{i}/{total}] {persona['organization_name']} / {persona['service_name'][:50]}"
    try:
        msgs = run_conversation(persona)
    except Exception as e:
        print(f"{label}  FAILED: {e}")
        return
    if len(msgs) < 2:
        print(f"{label}  too short ({len(msgs)} msgs), skipping")
        return

    conv = {
        "id": f"gen-{uuid.uuid4().hex[:8]}",
        "title": f"[{persona['test_category']}] {persona['organization_name']} — {persona['service_name'][:60]}",
        "createdAt": int(time.time() * 1000),
        "category": "Sensitive" if is_sensitive(persona) else "Normal",
        "domainContext": "Mijke openai-demo backend, gpt-4.1-mini via Responses API + file_search over org_service_details_for_filesearch.txt (699 Eindhoven org/service records). Conversation generated by an LLM user-simulator, not a real human tester.",
        "expectedOrganization": {
            "name": persona["organization_name"],
            "service": persona["service_name"],
            "referralRequired": persona["offer_type"],
            "lifeAreas": persona["life_areas"],
            "testCategory": persona["test_category"],
        },
        "messages": msgs,
    }
    OUT_DIR.mkdir(exist_ok=True)
    (OUT_DIR / f"{conv['id']}.json").write_text(json.dumps(conv, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"{label}  OK -> {len(msgs)} messages, saved {conv['id']}.json")


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    rows = load_rows()
    sample = stratified_sample(rows, n)
    print(f"Generating {len(sample)} conversations, {MAX_WORKERS} at a time...\n")

    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = [ex.submit(process_one, i, len(sample), row) for i, row in enumerate(sample, 1)]
        for f in concurrent.futures.as_completed(futures):
            f.result()

    print(f"\nDone. Output in {OUT_DIR}")


if __name__ == "__main__":
    main()
