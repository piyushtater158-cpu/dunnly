/**
 * Smoke-test per-channel Teams Power Automate webhooks.
 * Loads .env for TEAMS_WEBHOOK_* vars (or pass via environment).
 * Usage: node scripts/probe-teams-webhooks.js
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const envFile = path.join(__dirname, "..", ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const CHANNELS = [
  { label: "ar-escalations", keys: ["TEAMS_WEBHOOK_ESCALATIONS", "TEAMS_INCOMING_WEBHOOK_URL"] },
  { label: "ar-disputes", keys: ["TEAMS_WEBHOOK_DISPUTES"] },
  { label: "ar-payments", keys: ["TEAMS_WEBHOOK_PAYMENTS"] },
  { label: "ar-alerts", keys: ["TEAMS_WEBHOOK_ALERTS"] },
];

function pickUrl(keys) {
  for (const k of keys) {
    const v = (process.env[k] || "").trim();
    if (v) return v;
  }
  return "";
}

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = Buffer.from(JSON.stringify(body));
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": data.length,
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode, body: b.slice(0, 200) }));
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  let ok = 0;
  let skip = 0;
  let fail = 0;

  for (const ch of CHANNELS) {
    const url = pickUrl(ch.keys);
    if (!url) {
      console.log("SKIP", ch.label, "(no URL set)");
      skip++;
      continue;
    }
    try {
      const res = await postJson(url, {
        text: `Dunnly routing smoke test — ${ch.label} (${new Date().toISOString()})`,
      });
      const good = res.status >= 200 && res.status < 300;
      console.log(good ? "OK" : "FAIL", ch.label, "→", res.status, res.body || "");
      if (good) ok++;
      else fail++;
    } catch (e) {
      console.log("FAIL", ch.label, "→", e.message);
      fail++;
    }
  }

  console.log(`summary: ok=${ok} skip=${skip} fail=${fail}`);
  if (fail > 0) process.exit(1);
})();
