/**
 * Hybrid verification: n8n webhooks, Oracle $env visibility, PA probes, routing logic.
 * Usage: node scripts/verify-hybrid-e2e.js
 */
const fs = require("fs");
const https = require("https");
const path = require("path");
const { execSync } = require("child_process");

const envFile = path.join(__dirname, "..", ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const secret = process.env.N8N_WEBHOOK_SECRET || "";
let k = process.env.N8N_API_KEY || "";
if (k.startsWith("n8n-api-")) k = k.slice(8);

const CLASSIFY_WF = process.env.N8N_CLASSIFY_WORKFLOW_ID || "kZIRFRsNvgQoem6f";
const SEND_WF = "0VHwySL7177F3IN5";

const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? "OK" : "FAIL") + " " + name + (detail ? " — " + detail : ""));
}

function req(host, method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = https.request(
      {
        hostname: host,
        path: p,
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...headers,
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
          resolve({ status: res.statusCode, j, raw: b });
        });
      }
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

async function probeN8nWebhooks() {
  try {
    const out = execSync("node scripts/probe-webhooks.js", {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
    });
    const lines = out.trim().split(/\r?\n/).filter(Boolean);
    const bad = lines.filter((l) => {
      try {
        return JSON.parse(l).status !== 200;
      } catch {
        return true;
      }
    });
    record("n8n_webhooks", bad.length === 0, `${lines.length - bad.length}/${lines.length} paths 200`);
  } catch (e) {
    record("n8n_webhooks", false, String(e.message).slice(0, 120));
  }
}

async function checkOracleEnvViaExecution() {
  const classify = await req(
    "n8n.piyushtater.com",
    "POST",
    "/webhook/dunnly/invoices/classify",
    {
      invoiceId: "INV-1",
      replyText: "We dispute this charge - verify hybrid env wiring.",
    },
    { "x-dunnly-secret": secret }
  );
  if (classify.status !== 200) {
    record("oracle_env_classify", false, "classify webhook " + classify.status);
    return;
  }
  await new Promise((r) => setTimeout(r, 30000));
  const list = await req(
    "n8n.piyushtater.com",
    "GET",
    `/api/v1/executions?workflowId=${CLASSIFY_WF}&limit=1`,
    null,
    { "X-N8N-API-KEY": k }
  );
  const ex = (list.j.data || [])[0];
  if (!ex) {
    record("oracle_env_classify", false, "no classify execution");
    return;
  }
  const full = await req(
    "n8n.piyushtater.com",
    "GET",
    `/api/v1/executions/${ex.id}?includeData=true`,
    null,
    { "X-N8N-API-KEY": k }
  );
  const run = full.j.data?.resultData || full.j.resultData;
  const resolve = run?.runData?.["Resolve Teams targets"]?.[0];
  const notify = run?.runData?.["Notify Teams"]?.[0];
  const outs = resolve?.data?.main?.flat() || [];
  const hasUrl = outs.some((o) => !!(o.json?.webhookUrl || o.json?.url));
  const notifyOut = notify?.data?.main?.flat()?.[0]?.json;
  const notifyStatus = notifyOut?.statusCode;
  const notifyErr = notifyOut?.error?.status || notifyOut?.error?.message;
  const notifyOk =
    notify &&
    !notifyErr &&
    (!notifyStatus || notifyStatus === 200 || notifyStatus === 202);
  record(
    "oracle_env_teams",
    hasUrl,
    hasUrl
      ? `exec ${ex.id} has webhook URLs`
      : `exec ${ex.id} — TEAMS_WEBHOOK_* not visible to n8n ($env empty); restart n8n on Oracle`
  );
  record(
    "oracle_env_teams_notify",
    notifyOk,
    notifyOk
      ? `Notify Teams HTTP ${notifyStatus || "ok"}`
      : notify
        ? `Notify Teams failed: ${String(notifyErr || notifyStatus || "unknown").slice(0, 80)} — replace designer links on Oracle`
        : "skipped (no URL)"
  );
}

async function checkPaEmailEnv() {
  const invoices = await req(
    "n8n.piyushtater.com",
    "GET",
    "/webhook/dunnly/invoices",
    null,
    { "x-dunnly-secret": secret }
  );
  const drafted = (invoices.j.invoices || []).find((i) => i.stage === "drafted");
  if (!drafted) {
    if (process.env.PA_EMAIL_WEBHOOK_URL) {
      record("oracle_env_pa_email", true, "skipped live send (no drafted row); PA_EMAIL_WEBHOOK_URL set locally");
    } else {
      record("oracle_env_pa_email", false, "no drafted invoice and PA_EMAIL_WEBHOOK_URL unset");
    }
    return;
  }
  await req(
    "n8n.piyushtater.com",
    "POST",
    "/webhook/dunnly/invoices/send",
    {
      invoiceId: drafted.id,
      isRetry: false,
      waProvider: "twilio",
      waMode: "dryrun",
    },
    { "x-dunnly-secret": secret }
  );
  await new Promise((r) => setTimeout(r, 25000));
  const list = await req(
    "n8n.piyushtater.com",
    "GET",
    `/api/v1/executions?workflowId=${SEND_WF}&limit=1`,
    null,
    { "X-N8N-API-KEY": k }
  );
  const ex = (list.j.data || [])[0];
  const full = await req(
    "n8n.piyushtater.com",
    "GET",
    `/api/v1/executions/${ex.id}?includeData=true`,
    null,
    { "X-N8N-API-KEY": k }
  );
  const pa = full.j.data?.resultData?.runData?.["Send via PA Gmail"]?.[0];
  const err = pa?.data?.main?.flat()?.[0]?.json?.error;
  const ok =
    !err ||
    (!String(err).includes("undefined") && !String(err).includes("URL parameter"));
  record(
    "oracle_env_pa_email",
    ok,
    ok ? `exec ${ex.id} PA Gmail reachable` : String(err || "PA_EMAIL_WEBHOOK_URL undefined on n8n host")
  );
}

async function probePaDirect() {
  if (!process.env.PA_EMAIL_WEBHOOK_URL) {
    record("pa_email_probe", false, "PA_EMAIL_WEBHOOK_URL not in local .env (copy from Oracle for direct probe)");
  } else {
    try {
      execSync("node scripts/probe-pa-email-webhook.js", {
        cwd: path.join(__dirname, ".."),
        encoding: "utf8",
        stdio: "pipe",
      });
      record("pa_email_probe", true, "PA email webhook accepted");
    } catch (e) {
      record("pa_email_probe", false, String(e.stdout || e.message).slice(0, 120));
    }
  }
  try {
    const out = execSync("node scripts/probe-teams-webhooks.js", {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      stdio: "pipe",
    });
    const fail = /FAIL/.test(out);
    record("pa_teams_probe", !fail, out.trim().split(/\r?\n/).pop());
  } catch (e) {
    record("pa_teams_probe", false, String(e.stdout || e.message).slice(0, 200));
  }
}

function probeRoutingLogic() {
  try {
    const out = execSync("node scripts/verify-teams-routing.js", {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
    });
    record("teams_routing_logic", /routing_ok/.test(out), "dispute/promise/paid/escalation rules");
  } catch (e) {
    record("teams_routing_logic", false, e.message);
  }
}

(async () => {
  console.log("=== verify-hybrid-e2e ===\n");
  await probeN8nWebhooks();
  probeRoutingLogic();
  await checkOracleEnvViaExecution();
  await checkPaEmailEnv();
  await probePaDirect();
  const failed = results.filter((r) => !r.ok);
  console.log("\n=== summary ===");
  console.log(`passed ${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    console.log("blockers:");
    for (const f of failed) console.log(" - " + f.name + ": " + f.detail);
    process.exit(1);
  }
  console.log("all_checks_passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
