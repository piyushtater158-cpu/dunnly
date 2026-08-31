/**
 * Smoke-test PA_EMAIL_WEBHOOK_URL (Dunnly AR Send Email flow).
 * Usage: node scripts/probe-pa-email-webhook.js
 */
const fs = require("fs");
const https = require("https");
const http = require("http");
const path = require("path");

const envFile = path.join(__dirname, "..", ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const url = (process.env.PA_EMAIL_WEBHOOK_URL || "").trim();
if (!url) {
  console.error("missing PA_EMAIL_WEBHOOK_URL in .env or environment");
  process.exit(1);
}

const body = {
  toEmail: process.env.GRAPH_TEST_TO || process.env.PA_EMAIL_TEST_TO || "piyushtater5555@gmail.com",
  subject: "Dunnly PA Gmail smoke test",
  body: "If you received this, PA_EMAIL_WEBHOOK_URL is wired correctly.",
  invoiceId: "INV-SMOKE",
  customer: "Smoke Test Co",
};

function postJson(targetUrl, payload) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const data = Buffer.from(JSON.stringify(payload));
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
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            body: b.slice(0, 300),
            workflowRunId: res.headers["x-ms-workflow-run-id"] || null,
          })
        );
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  const res = await postJson(url, body);
  const ok = res.status >= 200 && res.status < 300;
  console.log(ok ? "OK" : "FAIL", "pa_email", res.status, res.body || "");
  if (res.workflowRunId) {
    console.log("pa_workflow_run_id", res.workflowRunId);
    console.log("check_run", "https://make.powerautomate.com → Dunnly AR Send Email → Run history");
  }
  if (!ok) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
