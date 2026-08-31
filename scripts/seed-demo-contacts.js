/**
 * Seed Google Sheet contact columns for the Twilio / Gmail demo.
 *
 * - Pins INV-1 (Piyush Tater) to ADMIN_PHONE + waOptIn + demo email
 * - Forces Date of supply + Credit line so the row is overdue (WA gate)
 * - Resets send markers so Approve & Send performs a fresh Gmail+WA attempt
 * - Cycles demo Gmails across other invoices; keeps 555 test phones
 *
 * Usage (PowerShell from repo root):
 *   Get-Content .env | ForEach-Object {
 *     if ($_ -match '^([^#=]+)=(.*)$') { Set-Item "env:$($matches[1])" $matches[2].Trim() }
 *   }
 *   node scripts/seed-demo-contacts.js
 */

const https = require("https");

const HOST = "n8n.piyushtater.com";
const DOC_ID = "1qk-kY0gwgDU9Sef-lvDLRZEe-W-m1AUZtm4inJb9ph0";
const DEMO_EMAILS = [
  "tooncreatives158@gmail.com",
  "piyushtater5555@gmail.com",
  "piyushjain2090@gmail.com",
  "kdfoods101@gmail.com",
];
const WA_DEMO_INVOICE_ID = "INV-1";
const WA_DEMO_CUSTOMER = "Piyush Tater";
const WA_DEMO_EMAIL = "piyushtater5555@gmail.com";
const SEED_WEBHOOK_PATH = "dunnly/seed-demo";

const apiKeyRaw = process.env.N8N_API_KEY || process.env.N8N_KEY;
if (!apiKeyRaw) {
  console.error("Set N8N_API_KEY (or N8N_KEY) before running.");
  process.exit(1);
}
const apiKey = apiKeyRaw.startsWith("n8n-api-")
  ? apiKeyRaw.slice("n8n-api-".length)
  : apiKeyRaw.trim();

const webhookSecret = process.env.N8N_WEBHOOK_SECRET || "";

const adminRaw = (process.env.ADMIN_PHONE || "").trim();
const adminDigits = adminRaw.replace(/\D/g, "");
if (!adminDigits) {
  console.error("Set ADMIN_PHONE in .env (e.g. whatsapp:+916001507395).");
  process.exit(1);
}

function adminPhoneDisplay() {
  if (adminDigits.length === 12 && adminDigits.startsWith("91")) {
    return `+91 ${adminDigits.slice(2, 7)} ${adminDigits.slice(7)}`;
  }
  if (adminDigits.length === 11 && adminDigits.startsWith("1")) {
    return `+1 ${adminDigits.slice(1, 4)} ${adminDigits.slice(4, 7)} ${adminDigits.slice(7)}`;
  }
  return `+${adminDigits}`;
}

function req(method, path, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = https.request(
      {
        hostname: HOST,
        path,
        method,
        headers: {
          "X-N8N-API-KEY": apiKey,
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(extraHeaders || {}),
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
          if (res.statusCode >= 400) {
            reject(new Error(res.statusCode + " " + String(b).slice(0, 800)));
          } else resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    r.on("error", reject);
    r.setTimeout(120000, () => {
      r.destroy();
      reject(new Error("timeout"));
    });
    if (data) r.write(data);
    r.end();
  });
}

const seedCode = `
const DEMO_EMAILS = ${JSON.stringify(DEMO_EMAILS)};
const WA_DEMO_INVOICE_ID = ${JSON.stringify(WA_DEMO_INVOICE_ID)};
const WA_DEMO_CUSTOMER = ${JSON.stringify(WA_DEMO_CUSTOMER)};
const WA_DEMO_EMAIL = ${JSON.stringify(WA_DEMO_EMAIL)};
const adminPhone = ${JSON.stringify("'" + adminPhoneDisplay())};
const adminDigits = ${JSON.stringify(adminDigits)};
function addCalendarDays(ymd, days) {
  const parts = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
function istYmd() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function toSheetDate(ymd) {
  const p = ymd.split('-');
  return p[2] + '/' + p[1] + '/' + p[0];
}
const today = istYmd();
const rows = $input.all().map(({ json: r }, i) => {
  const id = String(r.id || '');
  const phoneDigits = String(r.phone || '').replace(/\\D/g, '');
  const isDemo = id === WA_DEMO_INVOICE_ID || phoneDigits === adminDigits;
  const email = isDemo ? WA_DEMO_EMAIL : DEMO_EMAILS[i % DEMO_EMAILS.length];
  let phone = String(r.phone || '').replace(/^'/, '');
  let customer = String(r.customer || '');
  if (isDemo) {
    phone = adminPhone;
    customer = WA_DEMO_CUSTOMER;
  } else if (!phone || !phone.includes('555')) {
    phone = "'+1 " + (200 + (i * 7) % 700) + " 555 " + String(1000 + i * 37).slice(0, 4);
  } else if (phone.startsWith('+')) {
    phone = "'" + phone;
  }

  // Demo row MUST be overdue so WA gate allows Twilio send.
  // Other rows: preserve existing supply/credit when present.
  let dateOfSupply = String(r['Date of supply'] || r.dateOfSupply || r['Date of Supply'] || '').trim();
  let creditDays = r['Credit line'] ?? r.creditDays ?? r['Credit Line'] ?? r.creditLine;
  let daysPostDue = String(r['Days post due date '] || r.daysOverdue || '').trim();
  if (isDemo) {
    const credit = 30;
    const desiredAge = 45;
    const due = addCalendarDays(today, -desiredAge);
    dateOfSupply = toSheetDate(addCalendarDays(due, -credit));
    creditDays = String(credit);
    daysPostDue = String(desiredAge);
  } else if (!dateOfSupply || creditDays === '' || creditDays == null) {
    const credit = 30;
    const desiredAge = 10 + (i * 5) % 60;
    const due = addCalendarDays(today, -desiredAge);
    dateOfSupply = toSheetDate(addCalendarDays(due, -credit));
    creditDays = String(credit);
    daysPostDue = String(desiredAge);
  } else {
    creditDays = String(creditDays);
  }

  return {
    json: {
      id,
      customer,
      email,
      phone,
      'Date of supply': dateOfSupply,
      'Credit line': creditDays,
      'Days post due date ': isDemo ? daysPostDue : (daysPostDue || ''),
      waOptIn: isDemo ? 'TRUE' : '',
      waOptOut: isDemo ? 'FALSE' : '',
      stage: isDemo ? 'drafted' : String(r.stage || ''),
      emailSentAt: isDemo ? 'RESET' : String(r.emailSentAt || ''),
      waSentAt: isDemo ? 'RESET' : String(r.waSentAt || ''),
      waMessageId: isDemo ? '' : String(r.waMessageId || ''),
      waStatus: isDemo ? '' : String(r.waStatus || ''),
      failureReason: isDemo ? '' : String(r.failureReason || ''),
      isDemo,
    },
  };
});
return rows;
`.trim();

const respondCode = `
const all = $('Build contact patch').all().map((i) => i.json);
const demo = all.filter((r) => r.isDemo);
return [{
  json: {
    ok: true,
    updated: all.length,
    demo: demo.map((r) => ({
      id: r.id,
      email: r.email,
      phone: r.phone,
      dateOfSupply: r['Date of supply'],
      creditLine: r['Credit line'],
      daysPostDue: r['Days post due date '],
      waOptIn: r.waOptIn,
      stage: r.stage,
    })),
  },
}];
`.trim();

const wf = {
  name: "dunnly-seed-demo-contacts",
  nodes: [
    {
      id: "manual-1",
      name: "When clicking ‘Test workflow’",
      type: "n8n-nodes-base.manualTrigger",
      typeVersion: 1,
      position: [0, 0],
      parameters: {},
    },
    {
      id: "webhook-1",
      name: "Webhook",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 220],
      webhookId: "dunnly-seed-demo",
      parameters: {
        httpMethod: "POST",
        path: SEED_WEBHOOK_PATH,
        responseMode: "responseNode",
        authentication: "headerAuth",
        options: {},
      },
      credentials: {
        httpHeaderAuth: { id: "aXMj4HkLU3j2VBVy", name: "Header Auth account 2" },
      },
    },
    {
      id: "sheets-read-1",
      name: "Read invoices",
      type: "n8n-nodes-base.googleSheets",
      typeVersion: 4.5,
      position: [260, 100],
      parameters: {
        resource: "sheet",
        operation: "read",
        documentId: { __rl: true, value: DOC_ID, mode: "id" },
        sheetName: { __rl: true, value: "invoices", mode: "name" },
        options: {},
      },
      credentials: {
        googleSheetsOAuth2Api: { id: "XTaQHKonHKfxw3GX", name: "Google Sheets account" },
      },
    },
    {
      id: "code-1",
      name: "Build contact patch",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [520, 100],
      parameters: { mode: "runOnceForAllItems", jsCode: seedCode },
    },
    {
      id: "sheets-update-1",
      name: "Update contacts",
      type: "n8n-nodes-base.googleSheets",
      typeVersion: 4.5,
      position: [780, 100],
      parameters: {
        resource: "sheet",
        operation: "update",
        documentId: { __rl: true, value: DOC_ID, mode: "id" },
        sheetName: { __rl: true, value: "invoices", mode: "name" },
        columns: {
          mappingMode: "defineBelow",
          matchingColumns: ["id"],
          value: {
            id: "={{ $json.id }}",
            customer: "={{ $json.customer }}",
            email: "={{ $json.email }}",
            phone: "={{ $json.phone }}",
            "Date of supply": "={{ $json['Date of supply'] }}",
            "Credit line": "={{ $json['Credit line'] }}",
            "Days post due date ": "={{ $json['Days post due date '] }}",
            waOptIn: "={{ $json.waOptIn }}",
            waOptOut: "={{ $json.waOptOut }}",
            stage: "={{ $json.stage }}",
            emailSentAt: "={{ $json.emailSentAt }}",
            waSentAt: "={{ $json.waSentAt }}",
            waMessageId: "={{ $json.waMessageId }}",
            waStatus: "={{ $json.waStatus }}",
            failureReason: "={{ $json.failureReason }}",
          },
        },
        options: {},
      },
      credentials: {
        googleSheetsOAuth2Api: { id: "XTaQHKonHKfxw3GX", name: "Google Sheets account" },
      },
    },
    {
      id: "code-respond-1",
      name: "Build response",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1040, 100],
      parameters: { mode: "runOnceForAllItems", jsCode: respondCode },
    },
    {
      id: "respond-1",
      name: "Respond to Webhook",
      type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1.1,
      position: [1300, 100],
      continueOnFail: true,
      parameters: {
        respondWith: "json",
        responseBody: "={{ $json }}",
        options: {},
      },
    },
    {
      id: "sheets-inbound-hdr-1",
      name: "Ensure inbound_log header",
      type: "n8n-nodes-base.googleSheets",
      typeVersion: 4.5,
      position: [1040, 300],
      continueOnFail: true,
      parameters: {
        resource: "sheet",
        operation: "append",
        documentId: { __rl: true, value: DOC_ID, mode: "id" },
        sheetName: { __rl: true, value: "inbound_log", mode: "name" },
        columns: {
          mappingMode: "defineBelow",
          value: {
            timestamp: "header",
            sid: "header",
            from: "header",
            body: "header",
            kind: "header",
            suggestedInvoiceId: "header",
            attachedInvoiceId: "header",
            status: "header",
            messageStatus: "header",
          },
        },
        options: { useAppend: true },
      },
      credentials: {
        googleSheetsOAuth2Api: { id: "XTaQHKonHKfxw3GX", name: "Google Sheets account" },
      },
    },
  ],
  connections: {
    "When clicking ‘Test workflow’": {
      main: [[{ node: "Read invoices", type: "main", index: 0 }]],
    },
    Webhook: {
      main: [[{ node: "Read invoices", type: "main", index: 0 }]],
    },
    "Read invoices": {
      main: [[{ node: "Build contact patch", type: "main", index: 0 }]],
    },
    "Build contact patch": {
      main: [[{ node: "Update contacts", type: "main", index: 0 }]],
    },
    "Update contacts": {
      main: [
        [
          { node: "Build response", type: "main", index: 0 },
          { node: "Ensure inbound_log header", type: "main", index: 0 },
        ],
      ],
    },
    "Build response": {
      main: [[{ node: "Respond to Webhook", type: "main", index: 0 }]],
    },
  },
  settings: { executionOrder: "v1" },
};

(async () => {
  console.log("adminPhone=" + adminPhoneDisplay());
  console.log("demoInvoice=" + WA_DEMO_INVOICE_ID);
  console.log("demoCustomer=" + WA_DEMO_CUSTOMER);
  console.log("demoEmail=" + WA_DEMO_EMAIL);

  const list = await req("GET", "/api/v1/workflows?limit=100");
  const existing = (list.body.data || []).find((w) => w.name === wf.name);
  let id;
  if (existing) {
    id = existing.id;
    const full = await req("GET", "/api/v1/workflows/" + id);
    await req("PUT", "/api/v1/workflows/" + id, {
      name: wf.name,
      nodes: wf.nodes,
      connections: wf.connections,
      settings: wf.settings,
      staticData: full.body.staticData ?? null,
    });
    console.log("updated_workflow=" + id);
  } else {
    const created = await req("POST", "/api/v1/workflows", wf);
    id = created.body.id;
    console.log("created_workflow=" + id);
  }

  try {
    await req("POST", "/api/v1/workflows/" + id + "/activate", {});
    console.log("activated=" + id);
  } catch (e) {
    console.log("activate_failed=" + e.message);
  }

  try {
    const run = await req(
      "POST",
      "/webhook/" + SEED_WEBHOOK_PATH,
      {},
      { "x-dunnly-secret": webhookSecret }
    );
    console.log("seed_webhook=" + JSON.stringify(run.body));
  } catch (e) {
    console.log("seed_webhook_failed=" + e.message);
    console.log("Open n8n → dunnly-seed-demo-contacts → Execute workflow once.");
  }

  console.log(
    "Done. Confirm INV-1 is overdue with ADMIN_PHONE + " + WA_DEMO_EMAIL
  );
  console.log("Sheet: https://docs.google.com/spreadsheets/d/" + DOC_ID + "/edit");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
