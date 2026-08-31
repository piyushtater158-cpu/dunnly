/** Activate dunnly-read on n8n. Usage: node scripts/activate-dunnly-read.js */
const fs = require("fs");
const https = require("https");
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

const WF_ID = "0ONcyB3VRvNjk6ba";
const apiKeyRaw = process.env.N8N_API_KEY || process.env.N8N_KEY;
if (!apiKeyRaw) {
  console.error("Set N8N_API_KEY");
  process.exit(1);
}
const apiKey = apiKeyRaw.startsWith("n8n-api-") ? apiKeyRaw.slice("n8n-api-".length) : apiKeyRaw;

function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = https.request(
      {
        hostname: "n8n.piyushtater.com",
        path: p,
        method,
        headers: {
          "X-N8N-API-KEY": apiKey,
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(data ? { "Content-Length": data.length } : {}),
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          let j = b;
          try {
            j = JSON.parse(b);
          } catch {}
          resolve({ status: res.statusCode, j });
        });
      }
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const act = await req("POST", "/api/v1/workflows/" + WF_ID + "/activate", {});
  console.log("activate", act.status, act.j.active ?? act.j);
  process.exit(act.status >= 400 ? 1 : 0);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
