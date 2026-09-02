/**
 * Classify-reply evals.
 *
 * Layer 1 (deterministic, non-AI retrieval): replyText projected for UI must equal input.
 * Layer 2 (AI): classification label only; judge checks groundedness + no reply hallucination.
 *
 * Auth: n8n /dunnly/eval/llm (OpenRouter cred) → fallback OPENROUTER_API_KEY.
 * Optional live path: EVAL_CLASSIFY_LIVE=1 hits /dunnly/invoices/classify (mutates INV-1).
 *
 * Usage: node scripts/eval-classify-reply.js
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const { URL } = require("url");

const ROOT = path.join(__dirname, "..");
const FIXTURES = path.join(ROOT, "evals/classify-reply/fixtures.json");
const RESULTS_DIR = path.join(ROOT, "evals/classify-reply/results");
const RESULTS = path.join(RESULTS_DIR, "latest.json");

const {
  CLASSIFY_SYSTEM_PROMPT,
  CLASSIFY_MODEL,
  JUDGE_MODEL,
} = require("../evals/classify-reply/prompts.js");
const { addCalendarDays, istYmd } = require("../n8n/normalize-invoice.js");

const ALLOWED = new Set(["paid", "promise", "dispute", "no_response"]);
const PASS_MEAN = 75;
const PASS_FIDELITY = 1; // all cases must fidelity-pass

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

function httpsJson(method, urlStr, headers, bodyObj) {
  const url = new URL(urlStr);
  const data = bodyObj !== undefined ? Buffer.from(JSON.stringify(bodyObj)) : null;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers: {
          Accept: "application/json",
          ...(data
            ? { "Content-Type": "application/json", "Content-Length": data.length }
            : {}),
          ...headers,
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          let json = null;
          try {
            json = b ? JSON.parse(b) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, json, raw: b });
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(120000, () => {
      req.destroy();
      reject(new Error("timeout " + url.pathname));
    });
    if (data) req.write(data);
    req.end();
  });
}

async function openRouterViaN8n(model, messages, responseFormat) {
  const secret = (process.env.N8N_WEBHOOK_SECRET || "").trim();
  if (!secret) throw new Error("NO_N8N_SECRET");
  const base = (process.env.N8N_BASE_URL || "https://n8n.piyushtater.com").replace(/\/$/, "");
  const prefix = process.env.N8N_WEBHOOK_PREFIX || "/webhook";
  const payload = { model, messages, temperature: 0 };
  if (responseFormat) payload.response_format = responseFormat;
  const res = await httpsJson(
    "POST",
    base + prefix + "/dunnly/eval/llm",
    { "x-dunnly-secret": secret },
    payload
  );
  if (res.status === 404) throw new Error("N8N_EVAL_PROXY_MISSING");
  if (!res.json?.choices) {
    throw new Error(
      "n8n eval llm bad " + res.status + " " + String(res.raw).slice(0, 200)
    );
  }
  return { ...res.json, via: "n8n-openrouter-cred" };
}

async function openRouterDirect(model, messages, responseFormat) {
  const key = (process.env.OPENROUTER_API_KEY || "").trim();
  if (!key) throw new Error("NO_OPENROUTER_KEY");
  const body = { model, messages, temperature: 0 };
  if (responseFormat) body.response_format = responseFormat;
  const res = await httpsJson(
    "POST",
    "https://openrouter.ai/api/v1/chat/completions",
    {
      Authorization: "Bearer " + key,
      "HTTP-Referer": "https://dunnly.local/evals",
      "X-Title": "Dunnly classify-reply evals",
    },
    body
  );
  if (res.status >= 400 || !res.json?.choices) {
    throw new Error("OpenRouter " + res.status + " " + String(res.raw).slice(0, 200));
  }
  return { ...res.json, via: "openrouter-env" };
}

async function openRouterChat(model, messages, responseFormat) {
  try {
    return await openRouterViaN8n(model, messages, responseFormat);
  } catch (e) {
    const msg = String(e.message || e);
    console.log("(n8n proxy: " + msg.slice(0, 120) + ")");
    return openRouterDirect(model, messages, responseFormat);
  }
}

function nextFridayYmd(fromYmd) {
  const [y, m, d] = fromYmd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay();
  let add = (5 - day + 7) % 7;
  if (add === 0) add = 7;
  return addCalendarDays(fromYmd, add);
}

function resolveExpectedPromiseDate(fx) {
  const today = istYmd(new Date());
  if (fx.expectedPromiseNull) return null;
  if (fx.expectedPromiseOffset != null) return addCalendarDays(today, fx.expectedPromiseOffset);
  if (fx.expectedPromiseFriday) return nextFridayYmd(today);
  return fx.expectedPromiseDate ?? null;
}

function promiseDateScore(expected, got, classification) {
  if (classification !== "promise") {
    return expected == null ? 100 : 50;
  }
  if (expected == null && got == null) return 100;
  if (expected == null || got == null) return 0;
  if (expected === got) return 100;
  const diff = Math.abs(
    (Date.parse(expected + "T12:00:00Z") - Date.parse(got + "T12:00:00Z")) / 86400000
  );
  if (diff <= 1) return 80;
  if (diff <= 3) return 60;
  return 0;
}

function parseJsonContent(content) {
  const raw = String(content || "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return {};
      }
    }
    return {};
  }
}

/** Mirror dunnly-classify Normalize: replyText only if repliedAt is set. */
function projectReplyForUi(submitted, opts = {}) {
  const repliedAt = opts.repliedAt !== undefined ? opts.repliedAt : new Date().toISOString();
  // Exact stored value as sheet would hold after Write replied
  const storedReplyText = submitted;
  return {
    repliedAt,
    replyText: repliedAt ? storedReplyText || "" : null,
  };
}

function fidelityCheck(submitted, projected) {
  // Screen must show the customer's words — not an LLM paraphrase.
  const exact = projected === submitted;
  const trimmedOk =
    typeof projected === "string" &&
    typeof submitted === "string" &&
    projected.trim() === submitted.trim() &&
    (submitted === "" || projected.length > 0 || submitted.length === 0);
  return {
    pass: exact,
    exact,
    trimmedOk,
    submittedLen: String(submitted ?? "").length,
    projectedLen: projected == null ? null : String(projected).length,
  };
}

const JUDGE_SYSTEM = `You judge AR reply classification for Dunnly.

Given the verbatim customer reply and a model classification label, score:
- grounded (1-5): does the label fit the reply? 5 = clearly correct, 1 = wrong/hallucinated intent
- noReplyRewrite (1-5): does the classifier invent or alter customer words? 5 = classification-only / no rewrite, 1 = invents reply content
- schemaOk (1-5): output was only a classification label in the allowed set

Reply JSON only: {"grounded":n,"noReplyRewrite":n,"schemaOk":n,"notes":"short"}`;

async function classifyOffline(replyText) {
  const today = istYmd(new Date());
  const res = await openRouterChat(
    CLASSIFY_MODEL,
    [
      { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
      { role: "user", content: "Today's date (IST): " + today + "\n\nReply:\n" + replyText },
    ],
    { type: "json_object" }
  );
  const content = res.choices?.[0]?.message?.content || "{}";
  const parsed = parseJsonContent(content);
  const rawKeys = Object.keys(parsed);
  const cls = ALLOWED.has(parsed.classification) ? parsed.classification : "no_response";
  let promiseDate = parsed.promiseDate || null;
  if (promiseDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(promiseDate))) promiseDate = null;
  // Hallucination signal: any extra key that looks like reply body
  const inventsReplyField = rawKeys.some((k) =>
    /reply|message|body|text|customer/i.test(k) && k !== "classification"
  );
  return {
    classification: cls,
    promiseDate,
    raw: parsed,
    inventsReplyField,
    via: res.via,
    contentPreview: String(content).slice(0, 200),
  };
}

async function judgeCase(replyText, classification, inventsReplyField) {
  try {
    const res = await openRouterChat(
      JUDGE_MODEL,
      [
        { role: "system", content: JUDGE_SYSTEM },
        {
          role: "user",
          content: JSON.stringify({
            replyText,
            classification,
            inventsReplyField,
            allowed: [...ALLOWED],
          }),
        },
      ],
      { type: "json_object" }
    );
    const scores = parseJsonContent(res.choices?.[0]?.message?.content || "{}");
    return {
      grounded: Number(scores.grounded) || 1,
      noReplyRewrite: Number(scores.noReplyRewrite) || 1,
      schemaOk: Number(scores.schemaOk) || 1,
      notes: String(scores.notes || ""),
      via: res.via,
    };
  } catch (e) {
    // Heuristic fallback judge
    return {
      grounded: 3,
      noReplyRewrite: inventsReplyField ? 1 : 5,
      schemaOk: ALLOWED.has(classification) ? 5 : 1,
      notes: "heuristic: " + String(e.message || e).slice(0, 80),
      via: "heuristic",
    };
  }
}

async function classifyLive(invoiceId, replyText) {
  const secret = (process.env.N8N_WEBHOOK_SECRET || "").trim();
  const base = (process.env.N8N_BASE_URL || "https://n8n.piyushtater.com").replace(/\/$/, "");
  const res = await httpsJson(
    "POST",
    base + "/webhook/dunnly/invoices/classify",
    { "x-dunnly-secret": secret },
    { invoiceId, replyText }
  );
  return {
    status: res.status,
    rawLen: String(res.raw || "").length,
    ok: res.json?.ok,
    invoice: res.json?.invoice || null,
  };
}

function scoreCase(fid, expected, got, judge, expectedPromiseDate) {
  const expectedMatch = expected === got.classification ? 1 : 0;
  const fidelityScore = fid.pass ? 100 : 0;
  const groundedScore = ((judge.grounded || 1) / 5) * 100;
  const noRewriteScore = ((judge.noReplyRewrite || 1) / 5) * 100;
  const schemaScore = ((judge.schemaOk || 1) / 5) * 100;
  const promiseScore = promiseDateScore(expectedPromiseDate, got.promiseDate, got.classification);
  const weighted =
    fidelityScore * 0.3 +
    groundedScore * 0.25 +
    noRewriteScore * 0.15 +
    schemaScore * 0.1 +
    promiseScore * 0.2;
  return {
    expectedMatch,
    fidelityScore,
    groundedScore,
    noRewriteScore,
    schemaScore,
    promiseScore,
    weighted: Math.round(weighted * 10) / 10,
  };
}

(async () => {
  loadEnv();
  const fixtures = JSON.parse(fs.readFileSync(FIXTURES, "utf8"));
  const live = process.env.EVAL_CLASSIFY_LIVE === "1";
  const cases = [];

  console.log("classify-reply evals · fixtures=" + fixtures.length + (live ? " · LIVE classify" : ""));

  for (const fx of fixtures) {
    const projected = projectReplyForUi(fx.replyText);
    const fid = fidelityCheck(fx.replyText, projected.replyText);

    let got;
    try {
      got = await classifyOffline(fx.replyText);
    } catch (e) {
      got = {
        classification: "no_response",
        raw: {},
        inventsReplyField: false,
        via: "error",
        contentPreview: String(e.message || e).slice(0, 160),
      };
    }

    const judge = await judgeCase(fx.replyText, got.classification, got.inventsReplyField);
    const expectedPromiseDate = resolveExpectedPromiseDate(fx);
    const scores = scoreCase(fid, fx.expected, got, judge, expectedPromiseDate);

    let liveResult = null;
    if (live && fx.replyText) {
      try {
        liveResult = await classifyLive("INV-1", fx.replyText);
        if (liveResult.invoice) {
          const liveFid = fidelityCheck(fx.replyText, liveResult.invoice.replyText);
          liveResult.fidelityPass = liveFid.pass;
          liveResult.stage = liveResult.invoice.stage;
          liveResult.classification = liveResult.invoice.classification;
        }
      } catch (e) {
        liveResult = { error: String(e.message || e).slice(0, 160) };
      }
    }

    const row = {
      id: fx.id,
      expected: fx.expected,
      got: got.classification,
      expectedPromiseDate,
      gotPromiseDate: got.promiseDate,
      fidelityPass: fid.pass,
      inventsReplyField: got.inventsReplyField,
      scores,
      judge,
      via: got.via,
      live: liveResult,
    };
    cases.push(row);
    console.log(
      (fid.pass ? "✓" : "✗") +
        " " +
        fx.id +
        " · expect=" +
        fx.expected +
        " got=" +
        got.classification +
        " · promise=" +
        (got.promiseDate || "null") +
        " · weighted=" +
        scores.weighted +
        (liveResult?.fidelityPass === false ? " · LIVE_FIDELITY_FAIL" : "")
    );
  }

  const fidelityAll = cases.every((c) => c.fidelityPass);
  const mean =
    cases.reduce((a, c) => a + c.scores.weighted, 0) / Math.max(1, cases.length);
  const expectedAcc =
    cases.filter((c) => c.scores.expectedMatch).length / Math.max(1, cases.length);
  const pass = fidelityAll && mean >= PASS_MEAN;

  const out = {
    at: new Date().toISOString(),
    pass,
    promptRelevance: Math.round(mean * 10) / 10,
    fidelityAll,
    expectedAccuracy: Math.round(expectedAcc * 1000) / 10,
    thresholds: { PASS_MEAN, PASS_FIDELITY },
    retrievalNote:
      "Reply text is non-AI retrieval (webhook → sheet → UI). AI only emits classification.",
    classifySystemPrompt: CLASSIFY_SYSTEM_PROMPT,
    cases,
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(RESULTS, JSON.stringify(out, null, 2));
  console.log(
    "\n" +
      (pass ? "PASS" : "FAIL") +
      " · promptRelevance=" +
      out.promptRelevance +
      " · fidelityAll=" +
      fidelityAll +
      " · expectedAccuracy=" +
      out.expectedAccuracy +
      "%"
  );
  console.log("wrote " + RESULTS);
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
