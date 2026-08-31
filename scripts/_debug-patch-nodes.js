const fs = require("fs");
const https = require("https");
for (const l of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = l.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
let k = process.env.N8N_API_KEY || "";
if (k.startsWith("n8n-api-")) k = k.slice(8);
const secret = process.env.N8N_WEBHOOK_SECRET;

function req(method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = https.request(
      {
        hostname: "n8n.piyushtater.com",
        path: p,
        method,
        headers: {
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
  await req("POST", "/webhook/dunnly/e2e-patch-temp", {}, { "x-dunnly-secret": secret });
  await new Promise((r) => setTimeout(r, 4000));
  const list = await req("GET", "/api/v1/executions?workflowId=84dabKoBpnUa12Jg&limit=1", null, {
    "X-N8N-API-KEY": k,
  });
  const id = list.j.data?.[0]?.id;
  const full = await req("GET", "/api/v1/executions/" + id + "?includeData=true", null, {
    "X-N8N-API-KEY": k,
  });
  const rd = full.j.data?.resultData?.runData || {};
  const patchRows = rd.Patch?.[0]?.data?.main?.flat() || [];
  const heroPatch = patchRows.find((x) => x.json?.id === "INV-1")?.json;
  const updRows = rd.Update?.[0]?.data?.main?.flat() || [];
  const heroUpd = updRows.find((x) => x.json?.id === "INV-1")?.json;
  console.log("exec", id);
  console.log("patch hero", JSON.stringify(heroPatch, null, 2));
  console.log("update hero", JSON.stringify(heroUpd, null, 2));
})();
