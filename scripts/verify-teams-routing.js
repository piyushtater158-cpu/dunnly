/**
 * Verify Teams routing logic from dunnly-classify Resolve Teams targets node.
 */
const fs = require("fs");
const path = require("path");

const wf = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "n8n", "workflows", "dunnly-classify.json"), "utf8")
);
const resolve = wf.nodes.find((n) => n.name === "Resolve Teams targets");
const js = resolve.parameters.jsCode;

let failed = 0;

function runCase(label, env, cls, inv, wh, expectLabels) {
  const $env = env;
  const nodes = {
    "Should notify Teams?": { item: { json: { classification: cls } } },
    "Read invoice for notify": { item: { json: inv } },
    Webhook: { item: { json: { body: wh } } },
  };
  const $ = (name) => nodes[name];
  const fn = new Function("$", "$env", "process", js);
  let items;
  try {
    items = fn($, $env, { env: $env });
  } catch (e) {
    console.log("FAIL", label, e.message);
    failed++;
    return [];
  }
  const urls = items.map((i) => {
    const p = i.json.payload || {};
    return (
      i.json.channelLabel +
      ":" +
      (i.json.webhookUrl ? "ok" : "skip") +
      (p.invoiceId ? ":payload" : "")
    );
  });
  const labels = items.map((i) => i.json.channelLabel).filter((c) => c && c !== "none");
  console.log(label, "→", urls.join(", ") || "(none)");
  if (expectLabels) {
    const got = labels.join(",");
    const want = expectLabels.join(",");
    if (got !== want) {
      console.log("FAIL", label, "expected", want, "got", got);
      failed++;
    }
  }
  return labels;
}

process.env.TEAMS_INCOMING_WEBHOOK_URL = "https://example.com/hook";
process.env.TEAMS_WEBHOOK_DISPUTES = "https://example.com/disputes";
process.env.TEAMS_WEBHOOK_PAYMENTS = "https://example.com/payments";
process.env.TEAMS_WEBHOOK_ESCALATIONS = "https://example.com/escalations";

runCase(
  "PROMISE",
  process.env,
  "promise",
  { daysOverdue: 30 },
  { invoiceId: "INV-1", replyText: "pay Friday" },
  ["ar-payments"]
);
runCase(
  "DISPUTE mild",
  process.env,
  "dispute",
  { daysOverdue: 45 },
  { invoiceId: "INV-2", replyText: "wrong amount" },
  ["ar-disputes"]
);
runCase(
  "DISPUTE severe",
  process.env,
  "dispute",
  { daysOverdue: 72 },
  { invoiceId: "INV-3", replyText: "never received" },
  ["ar-disputes", "ar-escalations"]
);
runCase(
  "PAID",
  process.env,
  "paid",
  { daysOverdue: 10 },
  { invoiceId: "INV-4", replyText: "sent remittance" },
  ["ar-payments"]
);
runCase(
  "SHEET live headers severe",
  process.env,
  "dispute",
  { "Date of supply": "01/01/2025", "Credit line": 30 },
  { invoiceId: "INV-24222", replyText: "never received" },
  ["ar-disputes", "ar-escalations"]
);
runCase(
  "SHEET trailing-space fallback 72",
  process.env,
  "dispute",
  { "Days post due date ": 72 },
  { invoiceId: "INV-5", replyText: "wrong amount" },
  ["ar-disputes", "ar-escalations"]
);
runCase(
  "SHEET trailing-space mild 45",
  process.env,
  "dispute",
  { "Days post due date ": 45 },
  { invoiceId: "INV-6", replyText: "wrong amount" },
  ["ar-disputes"]
);

if (failed) {
  console.error("routing_fail", failed);
  process.exit(1);
}
console.log("routing_ok");
