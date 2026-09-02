/**
 * Patch dunnly-classify.json and dunnly-send.json for cadence layer.
 * Usage: node scripts/patch-cadence-workflows.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const policySrc = fs.readFileSync(path.join(ROOT, "n8n/followup-policy.js"), "utf8");
const policyInline = policySrc.replace(/module\.exports[\s\S]*$/, "").trim();
const normSrc = fs.readFileSync(path.join(ROOT, "n8n/normalize-invoice.js"), "utf8");
const normInline = normSrc.replace(/module\.exports[\s\S]*$/, "").trim();

const computeNextActionCode =
  normInline +
  "\n" +
  policyInline +
  "\n" +
  `const inv = $('Read invoice for cadence').item.json;
function truthy(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toUpperCase();
    return s === "TRUE" || s === "1" || s === "YES";
  }
  return false;
}
function pickInt(v, fb) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fb;
}
const overdue = deriveOverdue(inv);
const classification = $json.classification || "no_response";
const promiseDate = $json.promiseDate || null;
const promiseConfidence = $json.promiseConfidence != null ? Number($json.promiseConfidence) : 0;
const action = computeNextAction({
  classification,
  promiseDate,
  promiseConfidence,
  daysOverdue: overdue.daysOverdue,
  amountRemaining: Number(inv.amountRemaining || 0),
  followupCount: pickInt(inv.followupCount, 0),
  waOptOut: truthy(inv.waOptOut),
  email: String(inv.email || ""),
  maxTouches: Number($env.FOLLOWUP_MAX_TOUCHES || 4),
  highValue: Number($env.FOLLOWUP_HIGH_VALUE || 100000),
});
return {
  json: {
    classification,
    promiseDate: action.promiseDate || promiseDate || null,
    promiseConfidence,
    nextActionAt: action.nextActionAt,
    followupBucket: action.followupBucket,
    cadenceState: action.cadenceState,
    cadenceReason: action.reason,
  },
};`;

// --- classify ---
const classifyPath = path.join(ROOT, "n8n/workflows/dunnly-classify.json");
const classify = JSON.parse(fs.readFileSync(classifyPath, "utf8"));

const llm = classify.nodes.find((n) => n.name === "LLM classify");
llm.parameters.jsonBody =
  "={{ JSON.stringify({ model: \"openai/gpt-4o-mini\", response_format: { type: \"json_object\" }, messages: [ { role: \"system\", content: \"Classify an AR collections customer reply into exactly one of: paid, promise, dispute, no_response.\\n\\nRules:\\n- Use ONLY the customer's reply text. Do not invent facts, dates, amounts, or invoice details.\\n- Do NOT rewrite or invent reply text. Your output must be classification only plus optional promiseDate extraction.\\n- Reply with strict JSON only (no markdown): {\\\"classification\\\": string, \\\"promiseDate\\\": string|null, \\\"promiseConfidence\\\": number}\\n- promiseDate = ISO YYYY-MM-DD the customer committed to, resolved against today's date, else null.\\n- promiseConfidence = 0.0–1.0 confidence in promiseDate.\\n- If the reply is empty, unclear, off-topic, or silence, use no_response with promiseDate null.\\n- paid = customer states payment already made / remitted / paid.\\n- promise = customer commits to pay (with or without a date).\\n- dispute = customer contests amount, invoice, goods, or refuses payment for cause.\\n- no_response = empty, unrelated, or cannot determine intent.\" }, { role: \"user\", content: \"Today is \" + $now.setZone('Asia/Kolkata').toFormat('yyyy-MM-dd') + \" (IST).\\n\" + $('Webhook').item.json.body.replyText } ] }) }}";

const parseCls = classify.nodes.find((n) => n.name === "Parse classification");
parseCls.parameters.jsCode = `if ($json.error) {
  return { json: { classification: null, promiseDate: null, promiseConfidence: 0, failureReason: "LLM classify failed: " + JSON.stringify($json.error).slice(0, 300) } };
}
const content = $json.choices?.[0]?.message?.content || "{}";
let parsed = {};
try { parsed = JSON.parse(content); } catch (e) { parsed = {}; }
const allowed = ["paid", "promise", "dispute", "no_response"];
const cls = allowed.includes(parsed.classification) ? parsed.classification : "no_response";
let promiseDate = parsed.promiseDate || null;
let promiseConfidence = Number(parsed.promiseConfidence);
if (!Number.isFinite(promiseConfidence)) promiseConfidence = 0;
const today = $now.setZone('Asia/Kolkata').toFormat('yyyy-MM-dd');
const maxFuture = $now.setZone('Asia/Kolkata').add(365, 'day').toFormat('yyyy-MM-dd');
if (!promiseDate || !/^\\d{4}-\\d{2}-\\d{2}$/.test(String(promiseDate)) || promiseDate < today || promiseDate > maxFuture || promiseConfidence < 0.6) {
  promiseDate = null;
}
return { json: { classification: cls, promiseDate, promiseConfidence } };`;

// Read invoice for cadence node
if (!classify.nodes.find((n) => n.name === "Read invoice for cadence")) {
  classify.nodes.push({
    id: "sheets-read-cadence-1",
    name: "Read invoice for cadence",
    type: "n8n-nodes-base.googleSheets",
    typeVersion: 4.5,
    position: [400, 0],
    parameters: {
      resource: "sheet",
      operation: "read",
      documentId: {
        __rl: true,
        value: "1qk-kY0gwgDU9Sef-lvDLRZEe-W-m1AUZtm4inJb9ph0",
        mode: "id",
      },
      sheetName: { __rl: true, value: "invoices", mode: "name" },
      filtersUI: {
        values: [
          {
            lookupColumn: "id",
            lookupValue: "={{$('Webhook').item.json.body.invoiceId}}",
          },
        ],
      },
      options: {},
    },
    credentials: {
      googleSheetsOAuth2Api: {
        id: "XTaQHKonHKfxw3GX",
        name: "Google Sheets account",
      },
    },
  });
}

// Compute next action node
if (!classify.nodes.find((n) => n.name === "Compute next action")) {
  classify.nodes.push({
    id: "code-compute-next-1",
    name: "Compute next action",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1300, 0],
    parameters: { mode: "runOnceForEachItem", jsCode: computeNextActionCode },
  });
}

const writeClassified = classify.nodes.find((n) => n.name === "Write classified");
writeClassified.parameters.columns.value = {
  id: "={{ $('Webhook').item.json.body.invoiceId }}",
  stage: "classified",
  classification: "={{$json.classification}}",
  failureReason: "",
  updatedAt: "={{ $now.toISO() }}",
  nextActionAt: "={{$json.nextActionAt || ''}}",
  followupBucket: "={{$json.followupBucket || ''}}",
  cadenceState: "={{$json.cadenceState || ''}}",
  promiseDate: "={{$json.promiseDate || ''}}",
};

// connections
classify.connections["Write replied (before LLM)"] = {
  main: [[{ node: "Read invoice for cadence", type: "main", index: 0 }]],
};
classify.connections["Read invoice for cadence"] = {
  main: [[{ node: "Reply empty?", type: "main", index: 0 }]],
};
classify.connections["Parse classification"] = {
  main: [[{ node: "Compute next action", type: "main", index: 0 }]],
};
classify.connections["Set no_response"] = {
  main: [[{ node: "Compute next action", type: "main", index: 0 }]],
};
classify.connections["Compute next action"] = {
  main: [[{ node: "Should notify Teams?", type: "main", index: 0 }]],
};

fs.writeFileSync(classifyPath, JSON.stringify(classify, null, 2) + "\n");
console.log("patched dunnly-classify.json");

// --- send Decide final ---
const sendPath = path.join(ROOT, "n8n/workflows/dunnly-send.json");
const send = JSON.parse(fs.readFileSync(sendPath, "utf8"));
const decide = send.nodes.find((n) => n.name === "Decide final");
decide.parameters.jsCode = `const j = $json;
const inv = $('Read invoice').item.json;
const wh = $('Webhook').item.json.body;
const now = new Date().toISOString();
const isRetry = wh.isRetry === true;
const emailOk = j.emailOutcome === 'sent' || j.emailOutcome === 'already-sent';
const emailFailed = j.emailOutcome === 'failed';
const waOk = !!j.waOk;
const waSkipped = !waOk && !!j.waSkipReason;
const stage = emailFailed ? 'failed' : 'sent';
let failureReason = '';
if (emailFailed) {
  failureReason = j.emailFailureReason || 'PA Gmail send rejected: unknown error';
} else if (waSkipped) {
  failureReason = '';
}
const emailSentAt = j.emailOutcome === 'sent' ? now : (String(inv.emailSentAt || '') === 'RESET' ? '' : (inv.emailSentAt || ''));
const waSentAt = waOk ? now : (String(inv.waSentAt || '') === 'RESET' ? '' : (inv.waSentAt || ''));
const waMessageId = waOk ? (j.waProviderMessageId || '') : (inv.waMessageId || '');
const waStatus = waOk
  ? (j.waStatus || 'accepted')
  : (j.waStatus || (j.waSkipReason ? ('skipped:' + j.waSkipReason) : 'not-sent'));
let cadenceFields = {};
if (stage === 'sent' && !isRetry && (inv.cadenceState == null || inv.cadenceState === '')) {
  function istYmd() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  function addCalendarDays(ymd, days) {
    const parts = ymd.split('-').map(Number);
    const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
  }
  const today = istYmd();
  cadenceFields = {
    cadenceState: 'active',
    followupBucket: 'W1',
    nextActionAt: addCalendarDays(today, 7),
    followupCount: 0,
    promiseDate: inv.promiseDate || null,
    lastTouchAt: null,
  };
}
return { json: {
  id: wh.invoiceId,
  stage,
  failureReason,
  waStatus,
  emailOutcome: j.emailOutcome || '',
  draftEmail: $('Resolve payload').item.json.emailBody,
  draftWhatsapp: $('Resolve payload').item.json.waBody,
  updatedAt: now,
  emailSentAt,
  waSentAt,
  waMessageId,
  logRecipient: j.phoneLog || '',
  logBody: j.waRenderedText || '',
  logProviderMessageId: j.waProviderMessageId || '',
  logDetail: j.waErrorMessage || j.waSkipReason || '',
  ...cadenceFields,
} };`;

const writeFinal = send.nodes.find((n) => n.name === "Write final");
Object.assign(writeFinal.parameters.columns.value, {
  cadenceState: "={{ $('Decide final').item.json.cadenceState || '' }}",
  followupBucket: "={{ $('Decide final').item.json.followupBucket || '' }}",
  nextActionAt: "={{ $('Decide final').item.json.nextActionAt || '' }}",
  followupCount: "={{ $('Decide final').item.json.followupCount || '' }}",
  promiseDate: "={{ $('Decide final').item.json.promiseDate || '' }}",
  lastTouchAt: "={{ $('Decide final').item.json.lastTouchAt || '' }}",
});

fs.writeFileSync(sendPath, JSON.stringify(send, null, 2) + "\n");
console.log("patched dunnly-send.json");
