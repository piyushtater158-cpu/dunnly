/**
 * Live E2E helper: preflight status + arm INV-24245.
 * Usage: node scripts/e2e-live-comms.js [status|arm]
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
const HERO_ID = "INV-24245";
const HERO_CUSTOMER = "Piyush Tater Demo Co";
const HERO_EMAIL = "piyushtater5555@gmail.com";
const NEEDED = [
  "dunnly-read",
  "dunnly-pull",
  "dunnly-draft",
  "dunnly-send",
  "dunnly-classify",
  "dunnly-inbound-wa",
];

let apiKey = process.env.N8N_API_KEY || "";
if (apiKey.startsWith("n8n-api-")) apiKey = apiKey.slice(8);
const secret = process.env.N8N_WEBHOOK_SECRET || "";
const adminDigits = (process.env.ADMIN_PHONE || "").replace(/\D/g, "");

function adminPhoneDisplay() {
  if (adminDigits.length === 12 && adminDigits.startsWith("91")) {
    return `+91 ${adminDigits.slice(2, 7)} ${adminDigits.slice(7)}`;
  }
  return `+${adminDigits}`;
}

function req(method, p, body, extraHeaders) {
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
          ...(extraHeaders || {}),
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
      reject(new Error("timeout " + p));
    });
    if (data) r.write(data);
    r.end();
  });
}

function n8nApi(method, p, body) {
  return req(method, p, body, { "X-N8N-API-KEY": apiKey });
}

function n8nHook(method, p, body) {
  return req(method, "/webhook" + p, body, { "x-dunnly-secret": secret });
}

function summarizeHero(invoices) {
  const hero = (invoices || []).find((i) => i.id === HERO_ID);
  if (!hero) return { missing: true };
  const digits = String(hero.phone || "").replace(/\D/g, "");
  const others = (invoices || []).filter(
    (i) => i.id !== HERO_ID && String(i.phone || "").replace(/\D/g, "") === digits && digits
  );
  return {
    id: hero.id,
    customer: hero.customer,
    email: hero.email,
    phone: hero.phone,
    stage: hero.stage,
    classification: hero.classification || null,
    waOptIn: hero.waOptIn,
    waOptOut: hero.waOptOut,
    waStatus: hero.waStatus || null,
    hasDraftEmail: !!hero.draftEmail,
    hasDraftWa: !!hero.draftWhatsapp,
    replyPreview: hero.replyText ? String(hero.replyText).slice(0, 80) : null,
    failureReason: hero.failureReason || null,
    phoneMatchAdmin: digits === adminDigits,
    otherRowsWithSamePhone: others.map((o) => o.id),
  };
}

async function listAllWorkflows() {
  const arr = [];
  let cursor;
  do {
    const q = cursor
      ? "/api/v1/workflows?limit=100&cursor=" + encodeURIComponent(cursor)
      : "/api/v1/workflows?limit=100";
    const page = await n8nApi("GET", q);
    arr.push(...(page.j.data || []));
    cursor = page.j.nextCursor;
  } while (cursor);
  return arr;
}

async function status() {
  const arr = await listAllWorkflows();
  console.log("workflows_http", 200, "count", arr.length);
  for (const n of NEEDED) {
    const wf = arr.find((w) => w.name === n);
    console.log(n, wf ? "id=" + wf.id + " active=" + wf.active : "MISSING");
  }
  const inv = await n8nHook("GET", "/dunnly/invoices");
  console.log("invoices_http", inv.status, "ok", inv.j && inv.j.ok, "count", (inv.j.invoices || []).length);
  console.log(
    "ids",
    (inv.j.invoices || [])
      .map((i) => i.id + ":" + i.stage + ":" + String(i.customer || "").slice(0, 28))
      .join(" | ")
  );
  console.log("all_workflows", arr.map((w) => w.name + (w.active ? "*" : "")).join(", "));
  console.log("hero", JSON.stringify(summarizeHero(inv.j.invoices), null, 2));
  const inv1 = (inv.j.invoices || []).find((i) => i.id === "INV-1");
  if (inv1) {
    console.log(
      "inv1",
      JSON.stringify(
        {
          id: inv1.id,
          customer: inv1.customer,
          email: inv1.email,
          phone: inv1.phone,
          stage: inv1.stage,
          classification: inv1.classification || null,
          waOptIn: inv1.waOptIn,
          waOptOut: inv1.waOptOut,
          waStatus: inv1.waStatus || null,
          phoneDigits: String(inv1.phone || "").replace(/\D/g, ""),
          adminDigits,
        },
        null,
        2
      )
    );
  }
  const classifyDup = arr.filter((w) => w.name === "dunnly-classify" || w.id === "kZIRFRsNvgQoem6f");
  console.log(
    "classify_dupes",
    classifyDup.map((w) => w.id + " name=" + w.name + " active=" + w.active).join(" | ") || "none"
  );
  const pullDup = arr.filter((w) => /dunnly-pull|invoices\/pull/.test(w.name));
  console.log("pull_matches", pullDup.map((w) => w.id + " " + w.name + " active=" + w.active).join(" | ") || "none");
  return { workflows: arr, invoices: inv.j.invoices || [] };
}

async function arm() {
  const seedCode = `
const HERO_ID = ${JSON.stringify(HERO_ID)};
const HERO_CUSTOMER = ${JSON.stringify(HERO_CUSTOMER)};
const HERO_EMAIL = ${JSON.stringify(HERO_EMAIL)};
const adminPhone = ${JSON.stringify("'" + adminPhoneDisplay())};
const adminDigits = ${JSON.stringify(adminDigits)};
const rows = $input.all().map(({ json: r }, i) => {
  const id = String(r.id || '');
  const phoneDigits = String(r.phone || '').replace(/\\D/g, '');
  const isHero = id === HERO_ID;
  let phone = String(r.phone || '').replace(/^'/, '');
  let customer = String(r.customer || '');
  let email = String(r.email || '');
  if (isHero) {
    phone = adminPhone;
    customer = HERO_CUSTOMER;
    email = HERO_EMAIL;
  } else if (phoneDigits === adminDigits || (phone && !phone.includes('555') && id !== HERO_ID && phoneDigits.length > 6)) {
    phone = "'+1 " + (200 + (i * 7) % 700) + " 555 " + String(1000 + i * 37).slice(0, 4);
  } else if (phone.startsWith('+')) {
    phone = "'" + phone;
  }
  if (isHero) {
    return { json: {
      id, customer, email, phone,
      waOptIn: 'TRUE', waOptOut: 'FALSE',
      stage: 'queued',
      draftEmail: '', draftWhatsapp: '',
      classification: '', replyText: '',
      waStatus: '', failureReason: '',
      emailSentAt: '', waSentAt: '', waMessageId: '',
      isHero: true,
    } };
  }
  return { json: { id, customer, email, phone, isHero: false } };
});
return rows;
`.trim();

  const wf = {
    name: "dunnly-e2e-arm-hero",
    nodes: [
      {
        id: "webhook-1",
        name: "Webhook",
        type: "n8n-nodes-base.webhook",
        typeVersion: 2,
        position: [0, 0],
        webhookId: "dunnly-e2e-arm-hero",
        parameters: {
          httpMethod: "POST",
          path: "dunnly/e2e-arm-hero",
          responseMode: "lastNode",
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
        position: [260, 0],
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
        name: "Build arm patch",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [520, 0],
        parameters: { mode: "runOnceForAllItems", jsCode: seedCode },
      },
      {
        id: "sheets-update-1",
        name: "Update invoices",
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
              customer: "={{ $json.customer }}",
              email: "={{ $json.email }}",
              phone: "={{ $json.phone }}",
              waOptIn: "={{ $json.waOptIn || '' }}",
              waOptOut: "={{ $json.waOptOut || '' }}",
              stage: "={{ $json.stage || $json.id && $('Read invoices') }}",
            },
          },
          options: {},
        },
        credentials: {
          googleSheetsOAuth2Api: { id: "XTaQHKonHKfxw3GX", name: "Google Sheets account" },
        },
      },
    ],
    connections: {
      Webhook: { main: [[{ node: "Read invoices", type: "main", index: 0 }]] },
      "Read invoices": { main: [[{ node: "Build arm patch", type: "main", index: 0 }]] },
      "Build arm patch": { main: [[{ node: "Update invoices", type: "main", index: 0 }]] },
    },
    settings: { executionOrder: "v1" },
  };

  // Conditional columns: only hero rows should rewrite stage/drafts.
  // Use two-pass: update all phones first, then a dedicated hero-only write via code filter.
  wf.nodes[3].parameters.columns.value = {
    id: "={{ $json.id }}",
    customer: "={{ $json.customer }}",
    email: "={{ $json.email }}",
    phone: "={{ $json.phone }}",
  };

  const heroOnly = {
    id: "if-hero-1",
    name: "Hero only",
    type: "n8n-nodes-base.filter",
    typeVersion: 2,
    position: [1040, 0],
    parameters: {
      conditions: {
        combinator: "and",
        conditions: [
          {
            leftValue: "={{ $json.isHero }}",
            rightValue: true,
            operator: { type: "boolean", operation: "true", singleValue: true },
          },
        ],
      },
    },
  };
  const heroWrite = {
    id: "sheets-hero-1",
    name: "Reset hero",
    type: "n8n-nodes-base.googleSheets",
    typeVersion: 4.5,
    position: [1300, 0],
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
          waOptIn: "={{ $json.waOptIn }}",
          waOptOut: "={{ $json.waOptOut }}",
          stage: "={{ $json.stage }}",
          draftEmail: "={{ $json.draftEmail }}",
          draftWhatsapp: "={{ $json.draftWhatsapp }}",
          classification: "={{ $json.classification }}",
          replyText: "={{ $json.replyText }}",
          waStatus: "={{ $json.waStatus }}",
          failureReason: "={{ $json.failureReason }}",
          emailSentAt: "={{ $json.emailSentAt }}",
          waSentAt: "={{ $json.waSentAt }}",
          waMessageId: "={{ $json.waMessageId }}",
        },
      },
      options: {},
    },
    credentials: {
      googleSheetsOAuth2Api: { id: "XTaQHKonHKfxw3GX", name: "Google Sheets account" },
    },
  };

  wf.nodes.push(heroOnly, heroWrite);
  wf.connections["Update invoices"] = {
    main: [[{ node: "Hero only", type: "main", index: 0 }]],
  };
  wf.connections["Hero only"] = {
    main: [[{ node: "Reset hero", type: "main", index: 0 }]],
  };

  const list = await n8nApi("GET", "/api/v1/workflows?limit=100");
  const existing = (list.j.data || []).find((w) => w.name === wf.name);
  let id;
  if (existing) {
    id = existing.id;
    const full = await n8nApi("GET", "/api/v1/workflows/" + id);
    const put = await n8nApi("PUT", "/api/v1/workflows/" + id, {
      name: wf.name,
      nodes: wf.nodes,
      connections: wf.connections,
      settings: wf.settings,
      staticData: full.j.staticData ?? null,
    });
    console.log("updated_arm_workflow", id, put.status);
  } else {
    const created = await n8nApi("POST", "/api/v1/workflows", wf);
    id = created.j.id;
    console.log("created_arm_workflow", id, created.status);
  }
  try {
    const act = await n8nApi("POST", "/api/v1/workflows/" + id + "/activate", {});
    console.log("activate", act.status);
  } catch (e) {
    console.log("activate_failed", e.message);
  }
  const run = await n8nHook("POST", "/dunnly/e2e-arm-hero", {});
  console.log("arm_http", run.status, "hero_id", run.j && (run.j.id || (Array.isArray(run.j) ? run.j[0] && run.j[0].id : null)));
  await new Promise((r) => setTimeout(r, 2000));
  await status();
}

const cmd = process.argv[2] || "status";
(async () => {
  if (cmd === "arm") await arm();
  else await status();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
