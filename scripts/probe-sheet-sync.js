/**
 * Probe POST /dunnly/invoices/sync and GET /dunnly/invoices ledger cache.
 * Usage:
 *   node scripts/probe-sheet-sync.js [--bootstrap] [--notify URL]
 *
 * --bootstrap  POST a minimal fixture snapshot so GET returns 200 (dev/smoke only)
 * --notify URL POST normalized ledger to Next.js /api/invoices/notify (SSE smoke)
 */
const fs = require("fs");
const https = require("https");
const http = require("http");
const path = require("path");

const envFile = path.join(__dirname, "..", ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) {
      process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

const secret = process.env.N8N_WEBHOOK_SECRET || "";
const host = "n8n.piyushtater.com";
const bootstrap = process.argv.includes("--bootstrap");
const notifyIdx = process.argv.indexOf("--notify");
const notifyUrl = notifyIdx >= 0 ? process.argv[notifyIdx + 1] : null;

function n8nReq(method, p, body) {
  return new Promise((resolve) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = https.request(
      {
        hostname: host,
        path: "/webhook" + p,
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-dunnly-secret": secret,
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
          resolve({ status: res.statusCode, body: parsed, raw: b.slice(0, 300) });
        });
      }
    );
    r.on("error", (e) => resolve({ status: 0, body: e.message, raw: "" }));
    r.setTimeout(20000, () => {
      r.destroy();
      resolve({ status: 0, body: "timeout", raw: "" });
    });
    if (data) r.write(data);
    r.end();
  });
}

function urlReq(urlStr, body) {
  return new Promise((resolve) => {
    const u = new URL(urlStr);
    const data = Buffer.from(JSON.stringify(body));
    const lib = u.protocol === "https:" ? https : http;
    const r = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-dunnly-secret": secret,
          "Content-Length": data.length,
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
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    r.on("error", (e) => resolve({ status: 0, body: e.message }));
    r.write(data);
    r.end();
  });
}

const FIXTURE = {
  source: "probe-bootstrap",
  spreadsheetId: "1qk-kY0gwgDU9Sef-lvDLRZEe-W-m1AUZtm4inJb9ph0",
  syncedAt: new Date().toISOString(),
  invoiceRows: [
    {
      id: "INV-SYNC-PROBE",
      customer: "Sync Probe Co",
      email: "probe@example.test",
      phone: "+15555550100",
      amountDue: 1000,
      amountRemaining: 1000,
      "Days post due date ": 45,
      stage: "queued",
      waOptIn: "FALSE",
      waOptOut: "FALSE",
    },
  ],
  inboundRows: [],
};

(async () => {
  if (!secret) {
    console.error("Set N8N_WEBHOOK_SECRET in .env");
    process.exit(1);
  }

  if (bootstrap) {
    const sync = await n8nReq("POST", "/dunnly/invoices/sync", FIXTURE);
    console.log("POST /dunnly/invoices/sync", JSON.stringify(sync));
    if (sync.status < 200 || sync.status >= 300) process.exit(1);
  }

  const get = await n8nReq("GET", "/dunnly/invoices");
  console.log("GET /dunnly/invoices", JSON.stringify(get));

  const ok =
    get.status === 200 &&
    get.body &&
    get.body.ok === true &&
    Array.isArray(get.body.invoices);

  if (notifyUrl && get.body && get.body.invoices) {
    const notify = await urlReq(notifyUrl, {
      syncedAt: new Date().toISOString(),
      invoices: get.body.invoices,
      inbound: get.body.inbound || [],
    });
    console.log("POST notify", notifyUrl, JSON.stringify(notify));
    if (notify.status < 200 || notify.status >= 300) process.exit(1);
  }

  process.exit(ok ? 0 : 1);
})();
