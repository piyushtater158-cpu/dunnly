const fs = require("fs");
const https = require("https");
const path = require("path");

const envFile = path.join(__dirname, "..", ".env");
for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

let k = process.env.N8N_API_KEY || "";
if (k.startsWith("n8n-api-")) k = k.slice(8);

function req(method, p, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = https.request(
      { hostname: "n8n.piyushtater.com", path: p, method, headers: { Accept: "application/json", ...headers } },
      (x) => {
        let b = "";
        x.on("data", (c) => (b += c));
        x.on("end", () => {
          let j;
          try {
            j = JSON.parse(b);
          } catch {
            j = b;
          }
          resolve(j);
        });
      }
    );
    r.on("error", reject);
    r.end();
  });
}

(async () => {
  const list = await req("GET", "/api/v1/workflows?limit=100", { "X-N8N-API-KEY": k });
  const wf = (list.data || []).find((w) => w.name === "dunnly-e2e-patch-temp");
  if (!wf) {
    console.log("no patch workflow");
    return;
  }
  const ex = await req("GET", "/api/v1/executions?workflowId=" + wf.id + "&limit=3", { "X-N8N-API-KEY": k });
  for (const row of ex.data || []) {
    const full = await req("GET", "/api/v1/executions/" + row.id + "?includeData=true", { "X-N8N-API-KEY": k });
    const rd = full.data?.resultData?.runData || {};
    const patch = rd.Patch?.[0]?.data?.main?.flat()?.map((x) => x.json) || [];
    const hero = patch.find((x) => x.id === "INV-1");
    const upd = rd.Update?.[0];
    console.log("exec", row.id, row.status, row.stoppedAt);
    if (hero) console.log("hero patch", JSON.stringify(hero));
    if (upd) console.log("update status", upd.executionStatus, upd.error?.message || "");
  }
})().catch(console.error);
