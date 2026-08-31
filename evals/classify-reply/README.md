# Classify-reply evals (fidelity + groundedness)

Dunnly’s **manual paste reply** path does **not** use AI to retrieve or display the customer’s words. The pasted `replyText` is written through n8n and projected back to the UI. AI is used **only** to label intent (`paid | promise | dispute | no_response`).

```bash
# Offline: fidelity (deterministic) + classify LLM + judge via n8n OpenRouter proxy
npm run eval:classify-reply

# Optional: also hit live /dunnly/invoices/classify (mutates INV-1 for each non-empty fixture)
EVAL_CLASSIFY_LIVE=1 npm run eval:classify-reply
```

## What is scored

| Layer | AI? | Check |
|---|---|---|
| **Reply fidelity** | No | Projected `replyText` === submitted paste (unicode / multiline included) |
| **Classification groundedness** | Yes | Label fits the verbatim reply (judge `grounded`) |
| **No reply rewrite** | Yes | Model must not invent/alter customer words (`noReplyRewrite`) |
| **Schema** | Yes | Output is classification-only JSON |

Pass: **all** fixtures fidelity-pass **and** mean weighted score ≥ **75**.

Results: [`results/latest.json`](results/latest.json).
