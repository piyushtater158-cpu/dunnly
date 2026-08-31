const fs = require("fs");
const https = require("https");
for (const l of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = l.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
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
  console.log("=== PA email diagnostics ===\n");

  // 1) Local URL format
  const url = (process.env.PA_EMAIL_WEBHOOK_URL || "").trim();
  console.log("local PA_EMAIL_WEBHOOK_URL", url ? "set invoke URL" : "MISSING");

  // 2) Direct PA probe with full response
  const probeBody = {
    toEmail: "piyushtater5555@gmail.com",
    subject: "Dunnly PA probe " + new Date().toISOString(),
    body: "Direct PA webhook probe from diagnostics script.",
    invoiceId: "INV-PROBE",
    customer: "Probe",
  };
  await new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = Buffer.from(JSON.stringify(probeBody));
    const r = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": data.length },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          console.log("\ndirect PA probe:", res.statusCode, b || "(empty body)");
          resolve();
        });
      }
    );
    r.on("error", reject);
    r.write(data);
    r.end();
  });

  // 3) Latest dunnly-send execution — PA node + payload
  const list = await req("GET", "/api/v1/executions?workflowId=0VHwySL7177F3IN5&limit=5", null, {
    "X-N8N-API-KEY": k,
  });
  for (const ex of list.j.data || []) {
    const full = await req("GET", "/api/v1/executions/" + ex.id + "?includeData=true", null, {
      "X-N8N-API-KEY": k,
    });
    const rd = full.j.data?.resultData?.runData || {};
    const pa = rd["Send via PA Gmail"]?.[0];
    const resolve = rd["Resolve payload"]?.[0];
    const emailSkip = rd["Email skip (already sent)"]?.[0];
    if (!pa && !emailSkip) continue;
    console.log("\n--- send exec", ex.id, ex.status, ex.stoppedAt, "---");
    if (resolve) {
      const p = resolve.data?.main?.flat()?.[0]?.json;
      console.log("resolve payload:", JSON.stringify({
        toEmail: p?.toEmail,
        subject: p?.subject,
        emailBodyLen: p?.emailBody ? String(p.emailBody).length : 0,
        emailBodyHead: p?.emailBody ? String(p.emailBody).slice(0, 120) : null,
      }));
    }
    if (emailSkip) {
      console.log("EMAIL SKIPPED (already sent):", JSON.stringify(emailSkip.data?.main?.flat()?.[0]?.json));
    }
    if (pa) {
      const out = pa.data?.main?.flat()?.[0]?.json;
      console.log("PA node status:", pa.executionStatus);
      console.log("PA response:", JSON.stringify({
        statusCode: out?.statusCode,
        statusMessage: out?.statusMessage,
        error: out?.error,
        body: typeof out?.body === "string" ? out.body.slice(0, 300) : out?.body,
        headers: out?.headers ? Object.fromEntries(Object.entries(out.headers).slice(0, 5)) : null,
      }));
      // Check if URL was empty on n8n host
      const cfg = rd.Config?.[0]?.data?.main?.flat()?.[0]?.json;
      if (cfg) console.log("config waMode:", cfg.waMode);
    }
    break;
  }

  // 4) Trigger live send with isRetry and inspect
  console.log("\n--- live send INV-1 isRetry ---");
  const send = await req(
    "POST",
    "/webhook/dunnly/invoices/send",
    { invoiceId: "INV-1", isRetry: true, waProvider: "twilio", waMode: "dryrun", adminPhoneDigits: "916001507395" },
    { "x-dunnly-secret": secret }
  );
  console.log("send http", send.status, typeof send.j === "object" ? JSON.stringify(send.j).slice(0, 300) : send.b.slice(0, 300));

  await new Promise((r) => setTimeout(r, 12000));
  const list2 = await req("GET", "/api/v1/executions?workflowId=0VHwySL7177F3IN5&limit=1", null, {
    "X-N8N-API-KEY": k,
  });
  const ex2 = list2.j.data?.[0];
  const full2 = await req("GET", "/api/v1/executions/" + ex2.id + "?includeData=true", null, {
    "X-N8N-API-KEY": k,
  });
  const rd2 = full2.j.data?.resultData?.runData || {};
  const pa2 = rd2["Send via PA Gmail"]?.[0];
  const skip2 = rd2["Email skip (already sent)"]?.[0];
  console.log("latest exec after live send:", ex2.id, ex2.status);
  if (skip2) console.log("skipped:", JSON.stringify(skip2.data?.main?.flat()?.[0]?.json));
  if (pa2) {
    const out = pa2.data?.main?.flat()?.[0]?.json;
    console.log("PA:", pa2.executionStatus, JSON.stringify({ statusCode: out?.statusCode, error: out?.error, body: out?.body }));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
