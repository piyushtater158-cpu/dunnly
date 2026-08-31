/** Activate dunnly-inbound-email on n8n. Usage: node scripts/activate-inbound-email.js */
const fs = require("fs");
const https = require("https");
const path = require("path");

const envFile = path.join(__dirname, "..", ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const HOST = "n8n.piyushtater.com";
const WF_ID = "d3jhcY5LR9WEt9mQ";
let apiKey = process.env.N8N_API_KEY || "";
if (apiKey.startsWith("n8n-api-")) apiKey = apiKey.slice(8);

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
          let j;
          try {
            j = JSON.parse(b);
          } catch {
            j = b;
          }
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
  const get = await req("GET", "/api/v1/workflows/" + WF_ID);
  console.log("get", get.status, "name", get.j.name, "active", get.j.active);
  if (!get.j.active) {
    const act = await req("POST", "/api/v1/workflows/" + WF_ID + "/activate", {});
    console.log("activate", act.status, act.j.active ?? act.j);
  } else {
    console.log("already_active");
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
