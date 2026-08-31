/** Debug inbound_log read path */
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
const secret = process.env.N8N_WEBHOOK_SECRET;

function api(p) {
  return new Promise((res, rej) => {
    https
      .get({ hostname: "n8n.piyushtater.com", path: p, headers: { "X-N8N-API-KEY": k } }, (r) => {
        let b = "";
        r.on("data", (c) => (b += c));
        r.on("end", () => res(JSON.parse(b)));
      })
      .on("error", rej);
  });
}

function hook(p) {
  return new Promise((res, rej) => {
    https
      .get({ hostname: "n8n.piyushtater.com", path: "/webhook" + p, headers: { "x-dunnly-secret": secret } }, (r) => {
        let b = "";
        r.on("data", (c) => (b += c));
        r.on("end", () => res({ status: r.statusCode, body: JSON.parse(b) }));
      })
      .on("error", rej);
  });
}

(async () => {
  const wfs = await api("/api/v1/workflows?limit=100");
  for (const w of wfs.data.filter((x) => x.name.startsWith("dunnly"))) {
    console.log(w.name, w.id, "active=" + w.active);
  }

  const ex = await api("/api/v1/executions?workflowId=BYrRdTtHiHo2BFHm&limit=1");
  const full = await api("/api/v1/executions/" + ex.data[0].id + "?includeData=true");
  const log = full.data?.resultData?.runData?.["Log inbound"]?.[0];
  console.log("\nWA Log inbound:", log?.executionStatus, "error:", log?.error?.message || log?.error);
  console.log("output:", JSON.stringify(log?.data?.main?.[0]?.[0]?.json || {}).slice(0, 600));

  const readId = wfs.data.find((x) => x.name === "dunnly-read")?.id;
  const readEx = await api("/api/v1/executions?workflowId=" + readId + "&limit=1");
  if (readEx.data[0]) {
    const rf = await api("/api/v1/executions/" + readEx.data[0].id + "?includeData=true");
    const ri = rf.data?.resultData?.runData?.["Read inbound_log"]?.[0];
    const rows = ri?.data?.main?.[0] || [];
    console.log("\nRead inbound_log rows:", rows.length, "error:", ri?.error?.message || ri?.error);
    const pending = rows.filter((r) => String(r.json?.status || "").toLowerCase() === "pending");
    console.log("pending rows in sheet read:", pending.length);
    console.log("last 3 rows:", rows.slice(-3).map((r) => r.json));

    const norm = rf.data?.resultData?.runData?.Normalize?.[0];
    console.log("\nNormalize inbound count:", norm?.data?.main?.[0]?.[0]?.json?.inbound?.length);
  }

  const inv = await hook("/dunnly/invoices");
  console.log("\nWebhook inbound count:", inv.body.inbound?.length);
  console.log("sample:", inv.body.inbound?.slice(0, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
