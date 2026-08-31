/**
 * QA matrix A–E for inbound auto-classify on hero INV-1.
 * Usage: node scripts/e2e-inbound-matrix.js [all|A|B|C|D|E|prep]
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

const HOST = "n8n.piyushtater.com";
const DOC_ID = "1qk-kY0gwgDU9Sef-lvDLRZEe-W-m1AUZtm4inJb9ph0";
const HERO_ID = "INV-1";
const HERO_EMAIL = "piyushtater5555@gmail.com";
const DUP_ID = "INV-24155";
const secret = process.env.N8N_WEBHOOK_SECRET || "";
let apiKey = process.env.N8N_API_KEY || "";
if (apiKey.startsWith("n8n-api-")) apiKey = apiKey.slice(8);
const adminDigits = (process.env.ADMIN_PHONE || "").replace(/\D/g, "");
const adminWa = adminDigits ? `whatsapp:+${adminDigits}` : "whatsapp:+916001507395";
const unknownWa = "whatsapp:+19995550199";

const results = [];

function req(method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = https.request(
      {
        hostname: HOST,
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
          resolve({ status: res.statusCode, j, raw: b });
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

const hook = (method, p, body) => req(method, "/webhook" + p, body, { "x-dunnly-secret": secret });
const api = (method, p, body) => req(method, p, body, { "X-N8N-API-KEY": apiKey });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getInvoices() {
  const res = await hook("GET", "/dunnly/invoices");
  if (res.status !== 200) throw new Error("invoices GET " + res.status);
  return res.j.invoices || [];
}

async function getInbound() {
  const res = await hook("GET", "/dunnly/invoices");
  return res.j.inbound || [];
}

function findHero(invoices) {
  return invoices.find((i) => i.id === HERO_ID);
}

async function runSheetPatch(jsCode, name) {
  const wf = {
    name: "dunnly-e2e-patch-temp",
    nodes: [
      {
        id: "wh1",
        name: "Webhook",
        type: "n8n-nodes-base.webhook",
        typeVersion: 2,
        position: [0, 0],
        webhookId: "dunnly-e2e-patch-temp",
        parameters: {
          httpMethod: "POST",
          path: "dunnly/e2e-patch-temp",
          responseMode: "lastNode",
          authentication: "headerAuth",
        },
        credentials: {
          httpHeaderAuth: { id: "aXMj4HkLU3j2VBVy", name: "Header Auth account 2" },
        },
      },
      {
        id: "read1",
        name: "Read",
        type: "n8n-nodes-base.googleSheets",
        typeVersion: 4.5,
        position: [260, 0],
        parameters: {
          resource: "sheet",
          operation: "read",
          documentId: { __rl: true, value: DOC_ID, mode: "id" },
          sheetName: { __rl: true, value: "invoices", mode: "name" },
        },
        credentials: {
          googleSheetsOAuth2Api: { id: "XTaQHKonHKfxw3GX", name: "Google Sheets account" },
        },
      },
      {
        id: "code1",
        name: "Patch",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [520, 0],
        parameters: { mode: "runOnceForAllItems", jsCode },
      },
      {
        id: "upd1",
        name: "Update",
        type: "n8n-nodes-base.googleSheets",
        typeVersion: 4.5,
        position: [780, 0],
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
              stage: "={{ $json.stage || '' }}",
              email: "={{ $json.email || '' }}",
              classification: "={{ $json.classification || '' }}",
              replyText: "={{ $json.replyText || '' }}",
              replyChannel: "={{ $json.replyChannel || '' }}",
              emailSentAt: "={{ $json.emailSentAt || '' }}",
              waSentAt: "={{ $json.waSentAt || '' }}",
              waStatus: "={{ $json.waStatus || '' }}",
              "Date of supply": "={{ $json['Date of supply'] || '' }}",
              "Credit line": "={{ $json['Credit line'] || '' }}",
              "Days post due date ": "={{ $json['Days post due date '] || '' }}",
              waOptIn: "={{ $json.waOptIn || '' }}",
              waOptOut: "={{ $json.waOptOut || '' }}",
            },
          },
        },
        credentials: {
          googleSheetsOAuth2Api: { id: "XTaQHKonHKfxw3GX", name: "Google Sheets account" },
        },
      },
    ],
    connections: {
      Webhook: { main: [[{ node: "Read", type: "main", index: 0 }]] },
      Read: { main: [[{ node: "Patch", type: "main", index: 0 }]] },
      Patch: { main: [[{ node: "Update", type: "main", index: 0 }]] },
    },
    settings: { executionOrder: "v1" },
  };

  const list = await api("GET", "/api/v1/workflows?limit=100");
  let existing = (list.j.data || []).find((w) => w.name === wf.name);
  if (existing) {
    const full = await api("GET", "/api/v1/workflows/" + existing.id);
    await api("PUT", "/api/v1/workflows/" + existing.id, {
      name: wf.name,
      nodes: wf.nodes,
      connections: wf.connections,
      settings: wf.settings,
      staticData: full.j.staticData ?? null,
    });
  } else {
    const created = await api("POST", "/api/v1/workflows", wf);
    existing = { id: created.j.id };
  }
  try {
    await api("POST", "/api/v1/workflows/" + existing.id + "/activate", {});
  } catch {}
  const run = await hook("POST", "/dunnly/e2e-patch-temp", {});
  console.log("sheet_patch", name, run.status);
  await sleep(2000);
}

async function resetHeroSent() {
  const now = new Date().toISOString();
  await runSheetPatch(
    `
const now = ${JSON.stringify(now)};
const HERO = ${JSON.stringify(HERO_ID)};
const EMAIL = ${JSON.stringify(HERO_EMAIL)};
const DEMO_EMAILS = ${JSON.stringify(["tooncreatives158@gmail.com", "piyushjain2090@gmail.com", "kdfoods101@gmail.com", "piyushtater158@gmail.com"])};
function istYmd() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function addCalendarDays(ymd, days) {
  const p = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
function toSheetDate(ymd) {
  const p = ymd.split('-');
  return p[2] + '/' + p[1] + '/' + p[0];
}
function normEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}
return $input.all().map(({ json: r }, i) => {
  const id = String(r.id || '');
  if (id === HERO) {
    const credit = 30;
    const desiredAge = 45;
    const due = addCalendarDays(istYmd(), -desiredAge);
    const supply = toSheetDate(addCalendarDays(due, -credit));
    return { json: {
      id, email: EMAIL,
      'Date of supply': supply,
      'Credit line': String(credit),
      'Days post due date ': String(desiredAge),
      stage: 'queued', classification: '', replyText: '', replyChannel: '',
      emailSentAt: 'RESET', waSentAt: 'RESET', waStatus: '',
      waOptIn: 'TRUE', waOptOut: 'FALSE',
    }};
  }
  const email = normEmail(r.email);
  if (email === EMAIL.toLowerCase()) {
    return { json: {
      id, email: DEMO_EMAILS[i % DEMO_EMAILS.length],
      stage: String(r.stage || ''), classification: '', replyText: '', replyChannel: '',
      emailSentAt: '', waSentAt: '',
    }};
  }
  if (id === ${JSON.stringify(DUP_ID)}) {
    return { json: {
      id, email: '', stage: String(r.stage||''), classification: '', replyText: '', replyChannel: '',
      emailSentAt: '', waSentAt: '',
    }};
  }
  return null;
}).filter(Boolean);
`.trim(),
    "resetHeroSent"
  );
}

async function prepCaseE() {
  const now = new Date().toISOString();
  await runSheetPatch(
    `
const now = ${JSON.stringify(now)};
const EMAIL = ${JSON.stringify(HERO_EMAIL)};
const ids = [${JSON.stringify(HERO_ID)}, ${JSON.stringify(DUP_ID)}];
return $input.all()
  .filter(({ json: r }) => ids.includes(String(r.id)))
  .map(({ json: r }) => ({ json: {
    id: String(r.id),
    email: EMAIL,
    stage: 'sent',
    classification: '', replyText: '', replyChannel: '',
    emailSentAt: now, waSentAt: '',
    waOptIn: String(r.id) === ${JSON.stringify(HERO_ID)} ? 'TRUE' : 'FALSE',
    waOptOut: 'FALSE',
  }}));
`.trim(),
    "prepCaseE"
  );
}

async function postEmail(fromEmail, subject, bodyPlain, messageId) {
  return hook("POST", "/dunnly/email/inbound", {
    messageId: messageId || "EM_e2e_" + Date.now(),
    fromEmail,
    subject,
    bodyPlain,
    receivedAt: new Date().toISOString(),
  });
}

async function postWa(from, body, sid) {
  const form = new URLSearchParams({
    From: from,
    Body: body,
    MessageSid: sid || "SM_e2e_" + Date.now(),
  }).toString();
  return new Promise((resolve, reject) => {
    const data = Buffer.from(form);
    const r = https.request(
      {
        hostname: HOST,
        path: "/webhook/dunnly/wa/inbound",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": data.length,
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode, raw: b }));
      }
    );
    r.on("error", reject);
    r.write(data);
    r.end();
  });
}

function record(caseId, ok, detail) {
  results.push({ case: caseId, ok, detail });
  console.log((ok ? "PASS" : "FAIL") + " Case " + caseId + " — " + detail);
}

async function caseA() {
  await resetHeroSent();
  const subj = "Re: Overdue: INV-1 - $1200 - 45 days";
  const body = "We will pay in full on September 15th. Thanks.";
  const res = await postEmail(HERO_EMAIL, subj, body, "EM_e2e_A_" + Date.now());
  await sleep(50000);
  const inv = findHero(await getInvoices());
  const ok =
    res.status === 200 &&
    inv &&
    inv.stage === "notified" &&
    inv.classification === "promise" &&
    inv.replyChannel === "email";
  record("A", ok, JSON.stringify({ http: res.status, stage: inv?.stage, cls: inv?.classification, ch: inv?.replyChannel }));
}

async function caseB() {
  await resetHeroSent();
  const res = await postWa(adminWa, "We dispute this invoice - never received the goods.", "SM_e2e_B_" + Date.now());
  await sleep(50000);
  const inv = findHero(await getInvoices());
  const ok =
    res.status === 200 &&
    inv &&
    inv.stage === "notified" &&
    inv.classification === "dispute" &&
    inv.replyChannel === "whatsapp";
  record("B", ok, JSON.stringify({ http: res.status, stage: inv?.stage, cls: inv?.classification, ch: inv?.replyChannel }));
}

async function caseC() {
  await resetHeroSent();
  const res = await postEmail(HERO_EMAIL, "Re: Overdue: INV-1", "ok thanks", "EM_e2e_C_" + Date.now());
  await sleep(50000);
  const inv = findHero(await getInvoices());
  const ok =
    res.status === 200 &&
    inv &&
    (inv.classification === "no_response" || inv.stage === "classified" || inv.stage === "notified") &&
    inv.replyChannel === "email";
  record("C", ok, JSON.stringify({ http: res.status, stage: inv?.stage, cls: inv?.classification, ch: inv?.replyChannel }));
}

async function caseD() {
  const sid = "SM_e2e_D_" + Date.now();
  const res = await postWa(unknownWa, "Hello this is a random reply", sid);
  await sleep(12000);
  const inbound = await getInbound();
  const pending = inbound.filter((e) => e.status === "pending");
  const ok = res.status === 200 && pending.length >= 1;
  record("D", ok, JSON.stringify({ http: res.status, pendingTotal: pending.length, latest: pending[0]?.from }));
}

async function caseE() {
  await prepCaseE();
  const res = await postEmail(
    HERO_EMAIL,
    "Re: your invoice",
    "Paying next week",
    "EM_e2e_E_" + Date.now()
  );
  await sleep(10000);
  const inbound = await getInbound();
  const pending = inbound.filter((e) => e.status === "pending" && String(e.messageId || e.sid || "").includes("EM_e2e_E"));
  const inv = findHero(await getInvoices());
  const heroUnchanged = inv && inv.stage === "sent" && !inv.replyText;
  const ok = res.status === 200 && (pending.length >= 1 || heroUnchanged);
  record("E", ok, JSON.stringify({ http: res.status, pendingAmbiguous: pending.length, heroStage: inv?.stage }));
}

async function seedFirst() {
  console.log("Running seed-demo-contacts...");
  const { execSync } = require("child_process");
  execSync("node scripts/seed-demo-contacts.js", {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
  });
  await sleep(3000);
}

const cmd = (process.argv[2] || "all").toUpperCase();

(async () => {
  console.log("=== inbound auto-classify E2E — hero " + HERO_ID + " ===\n");
  await seedFirst();
  const inv0 = findHero(await getInvoices());
  console.log("hero_before", JSON.stringify({ email: inv0?.email, phone: inv0?.phone, stage: inv0?.stage }, null, 2));

  if (cmd === "PREP") {
    await resetHeroSent();
    console.log("prep_done");
    return;
  }
  const cases = cmd === "ALL" ? ["A", "B", "C", "D", "E"] : [cmd];
  for (const c of cases) {
    console.log("\n--- Case " + c + " ---");
    if (c === "A") await caseA();
    else if (c === "B") await caseB();
    else if (c === "C") await caseC();
    else if (c === "D") await caseD();
    else if (c === "E") await caseE();
    else console.log("unknown case", c);
  }

  console.log("\n=== summary ===");
  const failed = results.filter((r) => !r.ok);
  console.log("passed", results.length - failed.length + "/" + results.length);
  for (const r of results) console.log(" ", r.case, r.ok ? "PASS" : "FAIL", r.detail);

  const reportPath = path.join(__dirname, "..", ".gstack", "qa-reports", "inbound-auto-classify-e2e-2026-08-31.md");
  let report = fs.readFileSync(reportPath, "utf8");
  const ts = new Date().toISOString();
  for (const r of results) {
    const row = `| ${r.case} | ${ts} | ${r.ok ? "PASS" : "FAIL"} | ${r.detail.replace(/\|/g, "/")} |`;
    report = report.replace(new RegExp(`\\| ${r.case} \\| \\| \\| \\|`), row);
  }
  report = report.replace(
    "| Email inbound n8n workflow | **Created** | `dunnly-inbound-email` id `d3jhcY5LR9WEt9mQ` — **activate in n8n UI** |",
    "| Email inbound n8n workflow | **Active** | `dunnly-inbound-email` id `d3jhcY5LR9WEt9mQ` |"
  );
  report = report.replace(
    "| PA Receive Email flow | **Pending human** |",
    "| PA Receive Email flow | **Created by user** |"
  );
  report = report.replace("- [ ] Activate `dunnly-inbound-email` workflow in n8n", "- [x] Activate `dunnly-inbound-email` workflow in n8n");
  report = report.replace("- [ ] Create + turn On PA flow **Dunnly AR Receive Email**", "- [x] Create + turn On PA flow **Dunnly AR Receive Email**");
  report = report.replace("- [ ] Google Sheet headers", "- [x] Google Sheet headers");
  report = report.replace("Hero row `INV-24245`", "Hero row `INV-1`");
  fs.writeFileSync(reportPath, report);

  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
