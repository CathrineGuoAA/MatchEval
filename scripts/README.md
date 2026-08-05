# scripts

Test-data generation tooling for the Mijke `openai-demo` backend. Not part of the MatchEval app itself - these produce `Conversation` JSON files (same shape as `types.ts`) that can be imported into MatchEval for evaluation.

- **`chat_with_mijke.py`** - manual, interactive: chat with the locally-running backend turn by turn from the terminal, saves the finished conversation automatically.
- **`generate_conversations.py`** - automated batch generation: drives a full multi-turn conversation using a second LLM call as a simulated low-literacy user, with personas sampled (stratified by life domain and referral type) from `org_service_details.csv`.

Both scripts embed a static copy of the `openai-demo` branch's `SYSTEM_PROMPT.md` so a run stays reproducible even if the prompt changes later - update the embedded copy manually to test a new prompt version.

Usage and setup: see the docstring at the top of each script, or the full testing guide in the Mijke project vault (`Mijke/AI as a judge/llm-judge-testing-guide.md`).
