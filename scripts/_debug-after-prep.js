const fs = require("fs");
const https = require("https");
const path = require("path");
const { execSync } = require("child_process");

const envFile = path.join(__dirname, "..", ".env");
for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

let k = process.env.N8N_API_KEY || "";
if (k.startsWith("n8n-api-")) k = k.slice(8);
const secret = process.env.N8N_WEBHOOK_SECRET || "";

function req(method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = https.request(
      {
        hostname: "n8n.piyushtater.com",
        path: p,
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...headers,
          ...(data ? { "Content-Length": data.length } : {}),
        },
      },
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
          resolve({ status: x.statusCode, j });
        });
      }
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  execSync("node scripts/e2e-inbound-matrix.js prep", { cwd: path.join(__dirname, ".."), stdio: "inherit" });
  const inv = await req("GET", "/webhook/dunnly/invoices", null, { "x-dunnly-secret": secret });
  const hero = (inv.j.invoices || []).find((x) => x.id === "INV-1");
  console.log("normalized INV-1", JSON.stringify(hero, null, 2));

  const list = await req("GET", "/api/v1/executions?workflowId=0ONcyB3VRvNjk6ba&limit=1", null, {
    "X-N8N-API-KEY": k,
  });
  const ex = list.j.data?.[0];
  if (ex) {
    const full = await req("GET", "/api/v1/executions/" + ex.id + "?includeData=true", null, {
      "X-N8N-API-KEY": k,
    });
    const rows = full.j.data?.resultData?.runData?.["Read invoices"]?.[0]?.data?.main?.flat() || [];
    const raw = rows.find((x) => String(x.json?.id) === "INV-1")?.json;
    console.log("raw sheet INV-1", JSON.stringify(raw, null, 2));
  }
})();
