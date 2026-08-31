const fs = require("fs");
const https = require("https");
const path = require("path");
const envFile = path.join(__dirname, "..", ".env");
for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}
const secret = process.env.N8N_WEBHOOK_SECRET;
let k = process.env.N8N_API_KEY;
if (k.startsWith("n8n-api-")) k = k.slice(8);

function postWa(from, body, sid) {
  const form = new URLSearchParams({ From: from, Body: body, MessageSid: sid }).toString();
  return new Promise((res, rej) => {
    const data = Buffer.from(form);
    https.request(
      {
        hostname: "n8n.piyushtater.com",
        path: "/webhook/dunnly/wa/inbound",
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": data.length },
      },
      (r) => {
        let b = "";
        r.on("data", (c) => (b += c));
        r.on("end", () => res({ status: r.statusCode, body: b }));
      }
    )
      .on("error", rej)
      .end(data);
  });
}

function hook(method, p, body) {
  return new Promise((res, rej) => {
    const d = body ? Buffer.from(JSON.stringify(body)) : null;
    https.request(
      {
        hostname: "n8n.piyushtater.com",
        path: "/webhook" + p,
        method,
        headers: { "Content-Type": "application/json", "x-dunnly-secret": secret, ...(d ? { "Content-Length": d.length } : {}) },
      },
      (x) => {
        let b = "";
        x.on("data", (c) => (b += c));
        x.on("end", () => res({ status: x.statusCode, body: b }));
      }
    )
      .on("error", rej);
    if (d) https.request; 
  });
}

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
  const sid = "SM_dbg_D_" + Date.now();
  const wa = await postWa("whatsapp:+19995550199", "unmatched debug reply", sid);
  console.log("wa", wa.status);
  await new Promise((r) => setTimeout(r, 8000));
  const inv = await new Promise((res, rej) => {
    https.get(
      { hostname: "n8n.piyushtater.com", path: "/webhook/dunnly/invoices", headers: { "x-dunnly-secret": secret } },
      (r) => {
        let b = "";
        r.on("data", (c) => (b += c));
        r.on("end", () => res(JSON.parse(b)));
      }
    ).on("error", rej);
  });
  console.log("pending count", inv.inbound?.length);
  console.log("pending sample", inv.inbound?.slice(0, 3));
  const ex = await api("/api/v1/executions?workflowId=BYrRdTtHiHo2BFHm&limit=1");
  const full = await api("/api/v1/executions/" + ex.data[0].id + "?includeData=true");
  const rd = full.data?.resultData?.runData;
  console.log("nodes", Object.keys(rd || {}));
  const log = rd?.["Log inbound"]?.[0];
  console.log("log inbound error", log?.error);
  const pending = rd?.["Mark pending reply"]?.[0]?.data?.main?.[0]?.[0]?.json;
  console.log("mark pending", JSON.stringify(pending).slice(0, 300));
})();
