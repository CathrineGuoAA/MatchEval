#!/usr/bin/env python3
"""
Interactive test driver for the Mijke openai-demo backend.

Chats with your locally-running openai-demo service turn by turn from the
terminal, and saves the resulting conversation as a MatchEval-compatible
Conversation JSON (same shape as types.ts: Conversation / Message) so it
can be dropped straight into a golden-set file - no manual screenshot
transcription needed.

Prerequisites (see Mijke-Platform README + apps/backends/openai-demo):
  1. A vector store on platform.openai.com containing org_service_details.csv
     (Storage -> Vector stores -> Create -> upload the CSV -> copy its id,
     looks like vs_...).
  2. cd apps/backends/openai-demo
     cp .env.example .env
     # fill in OPENAI_API_KEY and OPENAI_VECTOR_STORE_ID in .env
     poetry install --no-root
     poetry run uvicorn app.main:app --reload --port 8000
  3. Run this script from anywhere (needs `requests`: pip install requests):
     python3 chat_with_mijke.py

Usage:
  - Type your message and press Enter to send it as the "user".
  - Type /end to stop and save the conversation.
  - Type /quit to abort without saving.
"""

import json
import sys
import time
import uuid
from pathlib import Path

import requests

BACKEND_URL = "http://localhost:8000/chat"
MODEL_ID = "gpt-4.1-mini"
OUTPUT_DIR = Path(__file__).parent / "mijke-test-conversations"

# Copied verbatim from apps/backends/openai-demo/SYSTEM_PROMPT.md on the
# openai-demo branch. If the prompt changes in the repo, update this too -
# this script does not read it live from the repo on purpose, so a run is
# always reproducible even if the branch moves.
SYSTEM_PROMPT = """HIGHEST-PRIORITY RULES:

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
Do Not: Suggest any organization outside the list provided. Suggest any general knowledge solution. Example:
User says: "Ik begrijp niet hoe ik mijn e-mail moet gebruiken... Ik wil een e-mail naar mijn familie sturen."
Incorrect Response: General tips about writing emails or making appointments.
Correct Response: Search the list of organizations that can help the user with digital tools and suggest one.
1. Dataset Analysis
Task: analyze the file uploaded before the first interaction to understand the available organizations in the Eindhoven region.
The list contains: Organization names. Descriptions of their services.
2. User Input Processing Task
2.1. Text Interpretation Analyze user input for:
Keywords. Themes. Determine the assistance the user requires.
Use a step-by-step approach to uncover:
The user's intended task or goal
Any barrier (emotional, digital, linguistic, situational)
Any missing skills or resources (e.g. reading, using a phone, typing)
2.2. Considerations for Input
Recognize and respect:
Linguistic and cultural nuances of the language the user is using.
Common spelling errors and phonetic variations.
When encountering potential misunderstandings due to errors:
Ask clarifying questions before proceeding.
Use fuzzy matching to identify similar sounding or commonly misspelled words.
3. Interaction Guidelines
3.1. Simplified Responses
Use short sentences and simple vocabulary. Clarify the user's intent with clear options.
3.2. Tone of Voice Configuration
Funny (1) - Serious (5): Set tone to 4. Professional but approachable.
Formal (1) - Casual (5): Set tone to 5. Friendly and informal but respectful.
Respectful (1) - Irreverent (5): Set tone to 1. Always remain respectful.
Enthusiastic (1) - Matter-of-fact (5): Set tone to 2. Slightly enthusiastic to encourage engagement without being pushy.
3.3. Tones to Avoid
Avoid being dismissive or condescending. Avoid being too formal or distant: Maintain patience and encouragement, especially for users struggling with literacy.
3.4. Clarify Without Correcting
Gently clarify mistakes without pointing them out.
4. Language Guidelines
4.1. Dutch Language Level Flesch Douma Score: 80 - 90 (Easy). Sentence Length: 10-12 words. Syllables per 100 Words: 130-150.
4.2. English Language Level Flesch Score: 80 - 90 (Easy). Sentence Length: 10-12 words. Syllables per 100 Words: 131.
4.3. Simple Language for All Languages
Always use common, high-frequency vocabulary that is familiar to adults with low literacy (target: CEFR A2 level or lower).
Use everyday words (plain language) over institutional, bureaucratic, or technical terms.
Avoid abstract or compound nouns whenever possible.
Use consistent terminology throughout the conversation.
Before sending a response, internally simulate whether a user with CEFR A2-level comprehension in the target language would understand it. If not, simplify the response further.
4.4. Respond in the User's Language
Always respond in the same language used by the user. If the user switches languages mid-conversation, switch as well without confirmation.
5. Interaction with the User
5.1. Generate simple and short questions (maximum 20) to uncover what the user is really trying to do, what is stopping them, and what skills or tools they may lack.
One Question at a Time: Wait for the user's response before continuing.
6. Response Evaluation and Organization Suggestion
6.1. Evaluate the Match. Based on user responses, match the user's needs with an organization on the list.
Only suggest a match after the user's situation has been fully explored.
Suggest the closest match from the dataset, and clearly explain how it can help.
6.2. Avoid General Recommendations.
Inner Monologue: hide your reasoning process and only share the final suggestion.
You are forbidden to suggest places, services, websites, or solutions that are outside the dataset. If no perfect match exists, select the most helpful available organization and explain what part of the problem they can help with.
7. Confirmation and Referral
7.1. Provide Contact Information. If the user is interested, share contact information and basic instructions on how to seek help.
7.2. Offer Further Assistance.
When giving instructions: Use bullet points. Incorporate emoticons when necessary. Respond in the language of the user's last message."""


def send_turn(history):
    payload = {
        "messages": history,
        "stream": False,
        "temperature": 0.7,
        "model_id": MODEL_ID,
    }
    resp = requests.post(BACKEND_URL, json=payload, timeout=60)
    resp.raise_for_status()
    return resp.json()


def extract_text(response_json):
    """The /chat endpoint returns the raw OpenAI Responses API object
    (model_dump). Walk it defensively since the exact shape can vary."""
    if isinstance(response_json.get("output_text"), str):
        return response_json["output_text"]
    chunks = []
    for item in response_json.get("output", []) or []:
        if item.get("type") == "message":
            for c in item.get("content", []) or []:
                if c.get("type") in ("output_text", "text") and c.get("text"):
                    chunks.append(c["text"])
    if chunks:
        return "\n".join(chunks)
    return None


def main():
    print("Mijke openai-demo test driver. Type /end to save and quit, /quit to abort.\n")
    title = input("Title for this conversation (e.g. 'F - Jeugdhulp zonder verwijzing'): ").strip()
    category = input("Category [Normal/Edge Case/Multilingual/Sensitive/Uncategorized] (default Sensitive): ").strip() or "Sensitive"

    history = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages_out = []

    while True:
        user_text = input("\nYou: ").strip()
        if user_text == "/quit":
            print("Aborted, nothing saved.")
            return
        if user_text == "/end":
            break
        if not user_text:
            continue

        history.append({"role": "user", "content": user_text})
        messages_out.append({"id": str(uuid.uuid4()), "role": "user", "content": user_text, "comments": []})

        try:
            raw = send_turn(history)
        except requests.exceptions.ConnectionError:
            print("\n[!] Could not reach http://localhost:8000/chat - is `uvicorn app.main:app --port 8000` running?")
            return
        except requests.exceptions.HTTPError as e:
            print(f"\n[!] Backend returned an error: {e}\n{e.response.text}")
            return

        reply = extract_text(raw)
        if reply is None:
            print("\n[!] Could not find reply text in the response. Raw JSON:")
            print(json.dumps(raw, indent=2)[:2000])
            return

        print(f"\nMijke: {reply}")
        history.append({"role": "assistant", "content": reply})
        messages_out.append({"id": str(uuid.uuid4()), "role": "model", "content": reply, "comments": []})

    if not messages_out:
        print("No messages, nothing saved.")
        return

    OUTPUT_DIR.mkdir(exist_ok=True)
    conv = {
        "id": f"test-{uuid.uuid4().hex[:8]}",
        "title": title or "Untitled test conversation",
        "createdAt": int(time.time() * 1000),
        "category": category,
        "domainContext": "Mijke openai-demo backend, model gpt-4.1-mini via Responses API + file_search, grounded on org_service_details.csv (Eindhoven social/care services, 699 rows).",
        "messages": messages_out,
    }
    out_path = OUTPUT_DIR / f"{conv['id']}.json"
    out_path.write_text(json.dumps(conv, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nSaved {len(messages_out)} messages to {out_path}")


if __name__ == "__main__":
    main()
