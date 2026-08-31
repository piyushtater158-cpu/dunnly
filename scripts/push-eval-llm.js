/**
 * Create/update + activate dunnly-eval-llm on live n8n.
 * Proxies OpenRouter chat using the saved "OpenRouter account" credential.
 */
const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (!m) continue;
      const k = m[1].trim();
      if (process.env[k]) continue;
      process.env[k] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

function req(method, p, body, apiKey) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = https.request(
      {
        hostname: "n8n.piyushtater.com",
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
          if (res.statusCode >= 400)
            reject(new Error(res.statusCode + " " + String(b).slice(0, 400)));
          else resolve(parsed);
        });
      }
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  loadEnv();
  let k = (process.env.N8N_API_KEY || "").trim();
  if (k.startsWith("n8n-api-")) k = k.slice(8);
  if (!k) throw new Error("N8N_API_KEY required");

  const local = JSON.parse(
    fs.readFileSync(path.join(ROOT, "n8n/workflows/dunnly-eval-llm.json"), "utf8")
  );

  const list = await req("GET", "/api/v1/workflows?limit=250", null, k);
  let existing = (list.data || []).find((w) => w.name === "dunnly-eval-llm");
  if (!existing) {
    const created = await req(
      "POST",
      "/api/v1/workflows",
      {
        name: local.name,
        nodes: local.nodes,
        connections: local.connections,
        settings: local.settings || { executionOrder: "v1" },
      },
      k
    );
    existing = { id: created.id, name: created.name };
    console.log("created", existing.id);
  }

  const full = await req("GET", "/api/v1/workflows/" + existing.id, null, k);
  await req(
    "PUT",
    "/api/v1/workflows/" + existing.id,
    {
      name: local.name,
      nodes: local.nodes,
      connections: local.connections,
      settings: local.settings || { executionOrder: "v1" },
      staticData: full.staticData ?? null,
    },
    k
  );
  console.log("updated", existing.id);

  try {
    await req("POST", "/api/v1/workflows/" + existing.id + "/activate", {}, k);
    console.log("activated", existing.id);
  } catch (e) {
    console.log("activate_note", String(e.message).slice(0, 200));
  }
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
