/**
 * Trigger classify smoke and inspect Resolve Teams targets / Notify Teams nodes.
 * Usage: node scripts/inspect-classify-execution.js [invoiceId] [replyText]
 */
const fs = require("fs");
const https = require("https");
const path = require("path");

const envFile = path.join(__dirname, "..", ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const secret = process.env.N8N_WEBHOOK_SECRET || "";
let k = process.env.N8N_API_KEY || "";
if (k.startsWith("n8n-api-")) k = k.slice(8);

const wfId = process.env.N8N_CLASSIFY_WORKFLOW_ID || "kZIRFRsNvgQoem6f";
const invoiceId = process.argv[2] || "INV-24245";
const replyText =
  process.argv[3] ||
  "We dispute this invoice - wrong amount billed for services not received.";

function req(host, method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = https.request(
      {
        hostname: host,
        path: p,
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...headers,
          ...(data ? { "Content-Length": data.length } : {}),
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          let j;
          try {
            j = JSON.parse(b);
          } catch {
            j = b;
          }
          resolve({ status: res.statusCode, j });
        });
      }
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

function summarizeNode(name, entries) {
  if (!entries?.length) return { node: name, missing: true };
  const e0 = entries[0];
  const err = e0.error ? String(e0.error.message || e0.error).slice(0, 300) : null;
  const outs = e0.data?.main?.flat() || [];
  const sample = outs.slice(0, 4).map((o) => {
    const j = o.json || {};
    return {
      channelLabel: j.channelLabel,
      hasUrl: !!(j.webhookUrl || j.url),
      statusCode: j.statusCode,
      error: j.error,
      payloadKeys: j.payload ? Object.keys(j.payload) : null,
      classification: j.classification || j.payload?.classification,
      daysOverdue: j.daysOverdue ?? j.payload?.daysOverdue,
    };
  });
  return { node: name, error: err, outputs: sample, count: outs.length };
}

(async () => {
  const classify = await req(
    "n8n.piyushtater.com",
    "POST",
    "/webhook/dunnly/invoices/classify",
    { invoiceId, replyText },
    { "x-dunnly-secret": secret }
  );
  console.log(
    JSON.stringify({
      step: "classify_trigger",
      status: classify.status,
      body: String(classify.j).slice(0, 200),
    })
  );

  await new Promise((r) => setTimeout(r, 30000));

  const list = await req(
    "n8n.piyushtater.com",
    "GET",
    `/api/v1/executions?workflowId=${wfId}&limit=1`,
    null,
    { "X-N8N-API-KEY": k }
  );
  const ex = (list.j.data || [])[0];
  if (!ex) {
    console.log(JSON.stringify({ step: "no_execution" }));
    process.exit(1);
  }

  const full = await req(
    "n8n.piyushtater.com",
    "GET",
    `/api/v1/executions/${ex.id}?includeData=true`,
    null,
    { "X-N8N-API-KEY": k }
  );
  const run = full.j.data?.resultData || full.j.resultData;

  for (const name of [
    "Should notify Teams?",
    "Resolve Teams targets",
    "Notify Teams",
  ]) {
    console.log(JSON.stringify(summarizeNode(name, run?.runData?.[name])));
  }

  console.log(
    JSON.stringify({
      step: "execution_summary",
      execId: ex.id,
      status: ex.status,
      lastNode: run?.lastNodeExecuted,
      error: run?.error?.message?.slice?.(0, 200) || null,
    })
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
