/**
 * Fail fast if TEAMS_* or PA_EMAIL URLs are designer links, not invoke URLs.
 * Usage: node scripts/validate-webhook-urls.js
 */
const fs = require("fs");
const path = require("path");

const envFile = path.join(__dirname, "..", ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const KEYS = [
  "PA_EMAIL_WEBHOOK_URL",
  "TEAMS_WEBHOOK_ESCALATIONS",
  "TEAMS_WEBHOOK_DISPUTES",
  "TEAMS_WEBHOOK_PAYMENTS",
  "TEAMS_WEBHOOK_ALERTS",
  "TEAMS_INCOMING_WEBHOOK_URL",
];

function classify(url) {
  if (!url) return "missing";
  if (url.includes("make.powerautomate.com") && url.includes("/flows/")) return "designer";
  if (url.includes("/triggers/manual/paths/invoke") && url.includes("sig=")) return "invoke";
  return "unknown";
}

let bad = 0;
for (const k of KEYS) {
  const v = (process.env[k] || "").trim();
  const kind = classify(v);
  const ok = kind === "invoke" || kind === "missing";
  if (!ok) bad++;
  console.log(`${ok ? "OK" : "BAD"} ${k} → ${kind}${v ? ` (${v.slice(0, 50)}…)` : ""}`);
}
if (bad) {
  console.error(`\n${bad} URL(s) are designer links. Open each PA flow → HTTP trigger → copy HTTP POST URL.`);
  process.exit(1);
}
console.log("\nall_invoke_or_missing");
