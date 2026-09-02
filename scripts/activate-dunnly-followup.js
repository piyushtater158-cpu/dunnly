/** Activate dunnly-followup on n8n. Usage: node scripts/activate-dunnly-followup.js */
const fs = require("fs");
const https = require("https");
const path = require("path");

for (const f of [".env.local", ".env"]) {
  const envFile = path.join(__dirname, "..", f);
  if (!fs.existsSync(envFile)) continue;
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) {
      process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

const HOST = "n8n.piyushtater.com";
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
        hostname: HOST,
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
  const list = await req("GET", "/api/v1/workflows?limit=250");
  if (list.status >= 400) {
    console.error("n8n API " + list.status + " — regenerate N8N_API_KEY in n8n UI or import workflows manually");
    console.error(String(list.j?.message || list.j || "").slice(0, 200));
    process.exit(1);
  }
  const workflows = list.data || list.j?.data || [];
  const wf = workflows.filter((w) => w.name === "dunnly-followup").pop();
  if (!wf) {
    console.error("dunnly-followup not found — run push-n8n-workflows.js first");
    process.exit(1);
  }
  const act = await req("POST", "/api/v1/workflows/" + wf.id + "/activate", {});
  console.log("activate dunnly-followup id=" + wf.id, act.status, act.j?.active ?? act.j);
  process.exit(act.status >= 400 ? 1 : 0);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
