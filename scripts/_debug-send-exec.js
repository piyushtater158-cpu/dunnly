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
          resolve({ status: x.statusCode, j, b });
        });
      }
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const inv = await req("GET", "/webhook/dunnly/invoices", null, { "x-dunnly-secret": secret });
  const hero = (inv.j.invoices || []).find((x) => x.id === "INV-1");
  console.log("INV-1 from n8n:", JSON.stringify(hero, null, 2));

  const list = await req("GET", "/api/v1/executions?workflowId=0VHwySL7177F3IN5&limit=5", null, {
    "X-N8N-API-KEY": k,
  });
  for (const ex of list.j.data || []) {
    const full = await req("GET", "/api/v1/executions/" + ex.id + "?includeData=true", null, {
      "X-N8N-API-KEY": k,
    });
    const rd = full.j.data?.resultData?.runData || {};
    console.log("\n=== exec", ex.id, ex.status, "===");
    for (const name of [
      "Send via PA Gmail",
      "Email already sent?",
      "Email skip (already sent)",
      "WA gate",
      "WA skipped",
      "Send WhatsApp (Twilio)",
      "Merge outcomes",
    ]) {
      const node = rd[name]?.[0];
      if (!node) continue;
      const out = node.data?.main?.flat()?.[0]?.json;
      console.log(name + ":", JSON.stringify(out).slice(0, 500));
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
