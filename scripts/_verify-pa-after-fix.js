/**
 * Verify dunnly-send fires PA on queued/drafted rows even with stale emailSentAt.
 */
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
  const patch = await req("POST", "/webhook/dunnly/e2e-patch-temp", {}, { "x-dunnly-secret": secret });
  console.log("patch_http", patch.status);
  await new Promise((r) => setTimeout(r, 5000));

  const inv = await req("GET", "/webhook/dunnly/invoices", null, { "x-dunnly-secret": secret });
  const h = (inv.j.invoices || []).find((x) => x.id === "INV-1");
  console.log("hero_stage", h?.stage, "daysOverdue", h?.daysOverdue);

  const send = await req(
    "POST",
    "/webhook/dunnly/invoices/send",
    {
      invoiceId: "INV-1",
      isRetry: false,
      waProvider: "twilio",
      waMode: "live",
      adminPhoneDigits: "916001507395",
    },
    { "x-dunnly-secret": secret }
  );
  console.log("send_ok", send.j?.ok, "stage", send.j?.invoice?.stage);

  await new Promise((r) => setTimeout(r, 15000));
  const list = await req("GET", "/api/v1/executions?workflowId=0VHwySL7177F3IN5&limit=1", null, {
    "X-N8N-API-KEY": k,
  });
  const ex = list.j.data[0];
  const full = await req("GET", "/api/v1/executions/" + ex.id + "?includeData=true", null, {
    "X-N8N-API-KEY": k,
  });
  const rd = full.j.data?.resultData?.runData || {};
  const read = rd["Read invoice"]?.[0]?.data?.main?.flat()?.[0]?.json;
  const pa = rd["Send via PA Gmail"]?.[0];
  const skip = rd["Email skip (already sent)"]?.[0];
  const resolve = rd["Resolve payload"]?.[0]?.data?.main?.flat()?.[0]?.json;
  console.log("exec", ex.id, "read_stage", read?.stage, "emailSentAt", read?.emailSentAt);
  console.log("subject", resolve?.subject);
  console.log("PA_ran", !!pa, "SKIP", !!skip);
  if (pa) {
    const out = pa.data?.main?.flat()?.[0]?.json;
    console.log("PA", out?.statusCode, out?.headers?.["x-ms-workflow-run-id"]);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
