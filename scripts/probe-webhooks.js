/**
 * Probe Dunnly webhook endpoints (no secrets printed).
 */
const fs = require("fs");
const https = require("https");
const path = require("path");

const t = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
for (const line of t.split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

const secret = process.env.N8N_WEBHOOK_SECRET || "";
const host = "n8n.piyushtater.com";

function probe(method, p, body) {
  return new Promise((resolve) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = https.request(
      {
        hostname: host,
        path: "/webhook" + p,
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-dunnly-secret": secret,
          ...(data ? { "Content-Length": data.length } : {}),
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          resolve({
            path: p,
            method,
            status: res.statusCode,
            bodyHead: b.slice(0, 160).replace(/\s+/g, " "),
          });
        });
      }
    );
    req.on("error", (e) => resolve({ path: p, method, status: 0, bodyHead: e.message }));
    req.setTimeout(15000, () => {
      req.destroy();
      resolve({ path: p, method, status: 0, bodyHead: "timeout" });
    });
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  const results = [];
  results.push(await probe("GET", "/dunnly/invoices"));
  results.push(
    await probe("POST", "/dunnly/invoices/send", {
      invoiceId: "INV-24245",
      isRetry: false,
      waProvider: "twilio",
      waMode: "dryrun",
    })
  );
  results.push(
    await probe("POST", "/dunnly/invoices/draft", {
      invoiceId: "INV-24245",
      mode: "save",
      emailBody: "probe",
      waBody: "probe",
    })
  );
  results.push(await probe("POST", "/dunnly/invoices/classify", { invoiceId: "INV-24245", replyText: "" }));
  results.push(await probe("POST", "/dunnly/invoices/pull", { limit: 1, autoSend: false }));
  for (const r of results) console.log(JSON.stringify(r));
})();
