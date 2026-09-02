/**
 * Sync evals/classify-reply/prompts.js CLASSIFY_SYSTEM_PROMPT into dunnly-classify.json LLM node.
 *
 * Usage:
 *   node scripts/sync-classify-prompt.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { CLASSIFY_SYSTEM_PROMPT } = require("../evals/classify-reply/prompts.js");

const workflowPath = path.join(ROOT, "n8n/workflows/dunnly-classify.json");
const workflow = JSON.parse(fs.readFileSync(workflowPath, "utf8"));
const llm = workflow.nodes.find((n) => n.name === "LLM classify");
if (!llm) throw new Error("LLM classify node missing");

const systemEscaped = CLASSIFY_SYSTEM_PROMPT.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
const userContent =
  "Today's date (IST): {{ $now.setZone('Asia/Kolkata').toFormat('yyyy-MM-dd') }}\\n\\nReply:\\n{{ $('Webhook').item.json.body.replyText }}";

llm.parameters.jsonBody =
  "={{ JSON.stringify({ model: \"openai/gpt-4o-mini\", response_format: { type: \"json_object\" }, messages: [ " +
  `{ role: \"system\", content: \"${systemEscaped}\" }, ` +
  `{ role: \"user\", content: \"${userContent}\" } ` +
  "] }) }}";

fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2) + "\n");
console.log("patched dunnly-classify.json LLM classify · promptChars=" + CLASSIFY_SYSTEM_PROMPT.length);
