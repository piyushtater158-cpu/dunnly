/**
 * Sync evals/wa-draft/prompts.js SYSTEM_PROMPT into local n8n workflow JSON
 * (dunnly-draft + dunnly-pull LLM draft nodes), then optionally push to live n8n.
 *
 * Usage:
 *   node scripts/sync-draft-prompts.js           # local JSON only
 *   node scripts/sync-draft-prompts.js --push    # local + Public API push
 */
const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.join(__dirname, "..");
const { SYSTEM_PROMPT } = require("../evals/wa-draft/prompts.js");

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (!m) continue;
      const k = m[1].trim();
      if (process.env[k]) continue;
      process.env[k] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

/** Build n8n expression that stringifies OpenRouter chat body with hardened system prompt. */
function buildJsonBodyExpression(withModeRedraft) {
  const sysLiteral = JSON.stringify(SYSTEM_PROMPT);
  // Inside n8n ={{ JSON.stringify({...}) }} the system content is a JS expression.
  // We inject the prompt as a JSON string literal, then optionally append redraft suffix.
  const systemExpr = withModeRedraft
    ? `${sysLiteral} + ($('Webhook').item.json.body.mode === 'redraft' ? ' Produce a materially different phrasing than a typical first draft.' : '')`
    : sysLiteral;

  const userExpr = withModeRedraft
    ? "`Invoice ${$json.id} for ${$json.customer}. Amount due ${$json.amountDue}, remaining ${$json.amountRemaining}, ${$json.daysOverdue} days overdue. followupCount=${$('Read invoice').item.json.followupCount || 0}. Draft a polite payment-status-check email and a short WhatsApp message.`"
    : "`Invoice ${$json.id} for ${$json.customer}. Amount due ${$json.amountDue}, remaining ${$json.amountRemaining}, ${$json.daysOverdue} days overdue. Draft a polite payment-status-check email and a short WhatsApp message.`";

  return (
    "={{ JSON.stringify({ model: \"openai/gpt-4o-mini\", response_format: { type: \"json_object\" }, messages: [ " +
    `{ role: \"system\", content: ${systemExpr} }, ` +
    `{ role: \"user\", content: ${userExpr} } ` +
    "] }) }}"
  );
}

function patchWorkflowFile(rel, withModeRedraft) {
  const p = path.join(ROOT, rel);
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  const node = j.nodes.find((n) => n.name === "LLM draft");
  if (!node) throw new Error("LLM draft node missing in " + rel);
  node.parameters = node.parameters || {};
  node.parameters.jsonBody = buildJsonBodyExpression(withModeRedraft);
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
  console.log("patched", rel, "systemPromptChars=" + SYSTEM_PROMPT.length);
  return j;
}

function req(method, p, body, apiKey) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = https.request(
      {
        hostname: "n8n.piyushtater.com",
        path: p,
        method,
        headers: {
          "X-N8N-API-KEY": apiKey,
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(data ? { "Content-Length": data.length } : {}),
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          let parsed = b;
          try {
            parsed = JSON.parse(b);
          } catch {}
          if (res.statusCode >= 400)
            reject(new Error(res.statusCode + " " + String(b).slice(0, 400)));
          else resolve(parsed);
        });
      }
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

async function pushWorkflow(name, local, apiKey) {
  const list = await req("GET", "/api/v1/workflows?limit=250", null, apiKey);
  let existing = (list.data || []).find((w) => w.name === name);
  if (!existing) {
    console.log("creating", name, "on n8n…");
    const created = await req(
      "POST",
      "/api/v1/workflows",
      {
        name: local.name,
        nodes: local.nodes,
        connections: local.connections,
        settings: local.settings || { executionOrder: "v1" },
      },
      apiKey
    );
    existing = { id: created.id, name: created.name };
  }
  const full = await req("GET", "/api/v1/workflows/" + existing.id, null, apiKey);
  await req(
    "PUT",
    "/api/v1/workflows/" + existing.id,
    {
      name: local.name,
      nodes: local.nodes,
      connections: local.connections,
      settings: local.settings || { executionOrder: "v1" },
      staticData: full.staticData ?? null,
    },
    apiKey
  );
  try {
    await req("POST", "/api/v1/workflows/" + existing.id + "/activate", {}, apiKey);
    console.log("pushed+activated", name, existing.id);
  } catch (e) {
    console.log("pushed", name, existing.id, "activate_note", String(e.message).slice(0, 80));
  }
}

(async () => {
  loadEnv();
  const doPush = process.argv.includes("--push");
  const draft = patchWorkflowFile("n8n/workflows/dunnly-draft.json", true);
  const pull = patchWorkflowFile("n8n/workflows/dunnly-pull.json", false);

  if (!doPush) {
    console.log("local only — pass --push to update live n8n");
    return;
  }

  let k = (process.env.N8N_API_KEY || "").trim();
  if (k.startsWith("n8n-api-")) k = k.slice(8);
  if (!k) throw new Error("N8N_API_KEY required for --push");

  await pushWorkflow("dunnly-draft", draft, k);
  await pushWorkflow("dunnly-pull", pull, k);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
