const fs = require("fs");
const https = require("https");
for (const l of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = l.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
let k = process.env.N8N_API_KEY || "";
if (k.startsWith("n8n-api-")) k = k.slice(8);

function req(p) {
  return new Promise((resolve, reject) => {
    https.get(
      { hostname: "n8n.piyushtater.com", path: p, headers: { "X-N8N-API-KEY": k } },
      (x) => {
        let b = "";
        x.on("data", (c) => (b += c));
        x.on("end", () => resolve(JSON.parse(b)));
      }
    ).on("error", reject);
  });
}

(async () => {
  const list = await req("/api/v1/executions?workflowId=0VHwySL7177F3IN5&limit=1");
  const id = list.data[0].id;
  const full = await req("/api/v1/executions/" + id + "?includeData=true");
  console.log("exec", id, list.data[0].status);
  console.log("error", full.data?.status, full.data?.resultData?.error?.message);
  const rd = full.data?.resultData?.runData || {};
  for (const name of Object.keys(rd)) {
    const node = rd[name][0];
    if (node.executionStatus === "error") {
      console.log("FAILED NODE:", name, node.error?.message);
    }
  }
  const pa = rd["Send via PA Gmail"]?.[0];
  const wa = rd["Send WhatsApp (Twilio)"]?.[0];
  const gate = rd["WA gate?"]?.[0];
  if (gate) console.log("gate", JSON.stringify(gate.data?.main?.flat()?.[0]?.json).slice(0, 300));
  if (pa) console.log("pa", pa.executionStatus, JSON.stringify(pa.data?.main?.flat()?.[0]?.json).slice(0, 200));
  if (wa) console.log("wa", wa.executionStatus, JSON.stringify(wa.data?.main?.flat()?.[0]?.json).slice(0, 300));
})();
