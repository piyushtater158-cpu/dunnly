const fs = require("fs");
const https = require("https");
const path = require("path");
const envFile = path.join(__dirname, "..", ".env");
for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}
let k = process.env.N8N_API_KEY;
if (k.startsWith("n8n-api-")) k = k.slice(8);
function api(p) {
  return new Promise((res, rej) => {
    https.get({ hostname: "n8n.piyushtater.com", path: p, headers: { "X-N8N-API-KEY": k } }, (r) => {
      let b = "";
      r.on("data", (c) => (b += c));
      r.on("end", () => res(JSON.parse(b)));
    }).on("error", rej);
  });
}
(async () => {
  const ex = await api("/api/v1/executions?workflowId=d3jhcY5LR9WEt9mQ&limit=1");
  const id = ex.data[0].id;
  const full = await api("/api/v1/executions/" + id + "?includeData=true");
  const rd = full.data?.resultData?.runData;
  const cr = rd?.["Classify reply"]?.[0];
  console.log("exec", id, "has classify", !!cr);
  if (cr) {
    console.log("error", cr.error);
    console.log("out", JSON.stringify(cr.data?.main?.[0]?.[0]?.json || cr.data).slice(0, 500));
  } else {
    console.log("nodes", Object.keys(rd || {}));
  }
})();
