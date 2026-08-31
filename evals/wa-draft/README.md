# WhatsApp LLM draft evals

Offline harness that scores Dunnly’s AR WhatsApp draft **system prompt** for objective relevance.

```bash
# 1) Ensure the n8n proxy that uses saved "OpenRouter account" is live
npm run push:eval-llm

# 2) Run evals (uses n8n credential; optional OPENROUTER_API_KEY override)
npm run eval:wa-draft

# Sync hardened prompt into n8n draft/pull workflows
npm run sync:draft-prompts
npm run sync:draft-prompts -- --push
```

Evals call `POST /webhook/dunnly/eval/llm` on your n8n instance, which authenticates to OpenRouter with the saved **OpenRouter account** credential — no local API key required.

Without the proxy (or if it is down), the runner falls back to `OPENROUTER_API_KEY`, then to a local compliant draft + heuristic judge.

Results: [`results/latest.json`](results/latest.json) — look at `promptRelevance` (pass ≥ 70) and per-case `objective` (must be ≥ 3).
