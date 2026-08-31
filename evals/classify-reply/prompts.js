/**
 * Classify-reply evals: reply fidelity (non-AI projection) + classification groundedness (AI).
 *
 * Architecture note:
 * - Reply text retrieval/projection is NOT AI — webhook body.replyText is written through
 *   and returned for UI display. Evals assert exact (or trimmed) fidelity so the LLM
 *   cannot "hallucinate" the customer's words onto the screen.
 * - AI is used only to label {paid|promise|dispute|no_response} from that verbatim reply.
 *
 * Usage: node scripts/eval-classify-reply.js
 * Optional: EVAL_CLASSIFY_LIVE=1 to also hit live /dunnly/classify (writes INV-1).
 */
const CLASSIFY_SYSTEM_PROMPT = `Classify an AR collections customer reply into exactly one of: paid, promise, dispute, no_response.

Rules:
- Use ONLY the customer's reply text. Do not invent facts, dates, amounts, or invoice details.
- Do NOT rewrite or invent reply text. Your output must be classification only.
- Reply with strict JSON only (no markdown): {"classification": string}
- If the reply is empty, unclear, off-topic, or silence, use no_response.
- paid = customer states payment already made / remitted / paid.
- promise = customer commits to pay (with or without a date).
- dispute = customer contests amount, invoice, goods, or refuses payment for cause.
- no_response = empty, unrelated, or cannot determine intent.`;

const CLASSIFY_MODEL = "openai/gpt-4o-mini";
const JUDGE_MODEL = "openai/gpt-4o-mini";

module.exports = {
  CLASSIFY_SYSTEM_PROMPT,
  CLASSIFY_MODEL,
  JUDGE_MODEL,
};
