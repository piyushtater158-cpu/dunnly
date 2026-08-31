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

function hook(method, p, body) {
  return new Promise((res, rej) => {
    const d = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = https.request(
      {
        hostname: "n8n.piyushtater.com",
        path: "/webhook" + p,
        method,
        headers: {
          "Content-Type": "application/json",
          "x-dunnly-secret": secret,
          ...(d ? { "Content-Length": d.length } : {}),
        },
      },
      (x) => {
        let b = "";
        x.on("data", (c) => (b += c));
        x.on("end", () => res({ status: x.statusCode, body: b }));
      }
    );
    r.on("error", rej);
    if (d) r.write(d);
    r.end();
  });
}

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

(async () => {
  const inv = await hook("GET", "/dunnly/invoices");
  const data = JSON.parse(inv.body);
  const i = data.invoices.find((x) => x.id === "INV-1");
  console.log("INV-1", JSON.stringify(i, null, 2));
  console.log("pending", data.inbound?.length, data.inbound?.slice(0, 2));

  const em = await hook("POST", "/dunnly/email/inbound", {
    messageId: "EM_dbg_" + Date.now(),
    fromEmail: "piyushtater5555@gmail.com",
    subject: "Re: Overdue: INV-1 - test",
    bodyPlain: "We will pay on September 20th",
    receivedAt: new Date().toISOString(),
  });
  console.log("email_inbound", em.status, em.body.slice(0, 300));

  await new Promise((r) => setTimeout(r, 35000));

  const inv2 = await hook("GET", "/dunnly/invoices");
  const i2 = JSON.parse(inv2.body).invoices.find((x) => x.id === "INV-1");
  console.log("after email", { stage: i2?.stage, cls: i2?.classification, ch: i2?.replyChannel });

  const cls = await hook("POST", "/dunnly/invoices/classify", {
    invoiceId: "INV-1",
    replyText: "We will pay September 20",
    source: "email",
  });
  console.log("direct classify", cls.status, cls.body.slice(0, 200));

  await new Promise((r) => setTimeout(r, 35000));
  const inv3 = await hook("GET", "/dunnly/invoices");
  const i3 = JSON.parse(inv3.body).invoices.find((x) => x.id === "INV-1");
  console.log("after classify", { stage: i3?.stage, cls: i3?.classification, ch: i3?.replyChannel });

  for (const wf of ["d3jhcY5LR9WEt9mQ", "BYrRdTtHiHo2BFHm", "kZIRFRsNvgQoem6f"]) {
    const ex = await api("/api/v1/executions?workflowId=" + wf + "&limit=1");
    console.log(
      "exec wf",
      wf,
      (ex.data || []).map((e) => e.id + " " + e.status).join(" | ")
    );
    if (ex.data?.[0]) {
      const full = await api("/api/v1/executions/" + ex.data[0].id + "?includeData=true");
      const rd = full.data?.resultData?.runData || full.resultData?.runData;
      if (rd) console.log("  nodes", Object.keys(rd).join(", "));
      const match = rd?.["Match email"]?.[0]?.data?.main?.[0]?.[0]?.json;
      if (match) console.log("  match email", JSON.stringify(match).slice(0, 400));
      const matchPhone = rd?.["Match phone"]?.[0]?.data?.main?.[0]?.[0]?.json;
      if (matchPhone) console.log("  match phone", JSON.stringify(matchPhone).slice(0, 400));
      const classifyNode = rd?.["Classify reply"];
      if (classifyNode) {
        console.log("  classify reply out", JSON.stringify(classifyNode[0]?.error || classifyNode[0]?.data?.main?.[0]?.[0]?.json).slice(0, 200));
      }
    }
  }
})().catch(console.error);
