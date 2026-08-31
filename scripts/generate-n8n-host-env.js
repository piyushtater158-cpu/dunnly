/**
 * Print env block for Oracle Cloud n8n host (systemd / docker).
 * Reads local .env for PA/Teams URLs when set.
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

const escalations =
  process.env.TEAMS_WEBHOOK_ESCALATIONS || process.env.TEAMS_INCOMING_WEBHOOK_URL || "";

const lines = [
  "# Paste into n8n host (Oracle Cloud) — then restart n8n",
  "# Hybrid path: PA Gmail + Teams (no MS_* required for email)",
  process.env.PA_EMAIL_WEBHOOK_URL
    ? `PA_EMAIL_WEBHOOK_URL=${process.env.PA_EMAIL_WEBHOOK_URL}`
    : "PA_EMAIL_WEBHOOK_URL=<PA flow Dunnly AR Send Email → HTTP POST URL>",
  escalations ? `TEAMS_WEBHOOK_ESCALATIONS=${escalations}` : "TEAMS_WEBHOOK_ESCALATIONS=<PA URL>",
  process.env.TEAMS_WEBHOOK_DISPUTES
    ? `TEAMS_WEBHOOK_DISPUTES=${process.env.TEAMS_WEBHOOK_DISPUTES}`
    : "TEAMS_WEBHOOK_DISPUTES=<PA URL → #ar-disputes>",
  process.env.TEAMS_WEBHOOK_PAYMENTS
    ? `TEAMS_WEBHOOK_PAYMENTS=${process.env.TEAMS_WEBHOOK_PAYMENTS}`
    : "TEAMS_WEBHOOK_PAYMENTS=<PA URL → #ar-payments>",
  process.env.TEAMS_WEBHOOK_ALERTS
    ? `TEAMS_WEBHOOK_ALERTS=${process.env.TEAMS_WEBHOOK_ALERTS}`
    : "TEAMS_WEBHOOK_ALERTS=<PA URL → #ar-alerts>",
  escalations
    ? `TEAMS_INCOMING_WEBHOOK_URL=${escalations}`
    : "TEAMS_INCOMING_WEBHOOK_URL=<alias for ESCALATIONS>",
  "",
  "# Graph MS_* unused. New tenant has no Entra app — do not set these.",
];

console.log(lines.join("\n"));
