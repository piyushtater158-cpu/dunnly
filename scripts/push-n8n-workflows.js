/**
 * Push local n8n/workflows/*.json to n8n.piyushtater.com by workflow name.
 * Usage: load .env then node scripts/push-n8n-workflows.js
 */
const fs = require("fs");
const path = require("path");
const https = require("https");

const envFile = path.join(__dirname, "..", ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const HOST = "n8n.piyushtater.com";
const apiKeyRaw = process.env.N8N_API_KEY || process.env.N8N_KEY;
if (!apiKeyRaw) {
  console.error("Set N8N_API_KEY");
  process.exit(1);
}
// Some n8n builds expect the bare JWT; .env may store "n8n-api-<jwt>".
const apiKey = apiKeyRaw.startsWith("n8n-api-")
  ? apiKeyRaw.slice("n8n-api-".length)
  : apiKeyRaw.trim();

const NAMES = [
  "dunnly-read",
  "dunnly-draft",
  "dunnly-classify",
  "dunnly-send",
  "dunnly-inbound-wa",
  "dunnly-inbound-email",
  "dunnly-seed-demo-contacts",
];

function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = https.request(
      {
        hostname: HOST,
        path: p,
        method,
        headers: {
          "X-N8N-API-KEY": apiKey,
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(data ? { "Content-Length": data.length } : {}),
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          let parsed = b;
          try {
            parsed = JSON.parse(b);
          } catch {}
          if (res.statusCode >= 400) {
            reject(new Error(res.statusCode + " " + String(b).slice(0, 500)));
          } else resolve(parsed);
        });
      }
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

function loadLocal(name) {
  const file = path.join(__dirname, "..", "n8n", "workflows", name + ".json");
  if (!fs.existsSync(file)) return null;
  let t = fs.readFileSync(file, "utf8");
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  return JSON.parse(t);
}

const ACTIVE_WORKFLOW_IDS = {
  "dunnly-classify": "kZIRFRsNvgQoem6f",
};

(async () => {
  let cursor;
  const allWorkflows = [];
  do {
    const q = cursor ? `/api/v1/workflows?limit=100&cursor=${cursor}` : "/api/v1/workflows?limit=100";
    const page = await req("GET", q);
    allWorkflows.push(...(page.data || []));
    cursor = page.nextCursor;
  } while (cursor);

  const allByName = new Map();
  for (const w of allWorkflows) {
    if (!allByName.has(w.name)) allByName.set(w.name, []);
    allByName.get(w.name).push(w);
  }
  const byName = new Map();
  for (const [name, workflows] of allByName) {
    const forced = ACTIVE_WORKFLOW_IDS[name];
    if (forced) {
      const hit = workflows.find((w) => w.id === forced);
      if (hit) {
        byName.set(name, hit);
        continue;
      }
    }
    const active = workflows.filter((w) => w.active);
    const pick = active.length ? active[active.length - 1] : workflows[workflows.length - 1];
    byName.set(name, pick);
  }

  for (const name of NAMES) {
    try {
      const local = loadLocal(name);
      if (!local) {
        console.log("skip_missing_file=" + name);
        continue;
      }
      let existing = byName.get(name);
      if (name === "dunnly-classify" && ACTIVE_WORKFLOW_IDS[name]) {
        existing = { id: ACTIVE_WORKFLOW_IDS[name], name };
      }
      const payload = {
        name: local.name || name,
        nodes: local.nodes,
        connections: local.connections,
        settings: local.settings || { executionOrder: "v1" },
      };
      if (existing) {
        const full = await req("GET", "/api/v1/workflows/" + existing.id);
        const nodes = local.nodes;
        if (name === "dunnly-classify") {
          const existingWebhook = (full.nodes || []).find(
            (n) => n.type === "n8n-nodes-base.webhook"
          );
          const webhookId = existingWebhook?.webhookId;
          if (webhookId) {
            for (const n of nodes) {
              if (n.type === "n8n-nodes-base.webhook") n.webhookId = webhookId;
            }
          }
        }
        await req("PUT", "/api/v1/workflows/" + existing.id, {
          ...payload,
          nodes,
          staticData: full.staticData ?? null,
        });
        console.log("updated=" + name + " id=" + existing.id);
      } else {
        const created = await req("POST", "/api/v1/workflows", payload);
        console.log("created=" + name + " id=" + created.id);
      }
    } catch (e) {
      console.error("failed=" + name, e.message || e);
    }
  }
  console.log("push_done");
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
