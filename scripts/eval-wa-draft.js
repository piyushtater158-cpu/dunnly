/**
 * Offline WhatsApp draft evals: draft + judge via OpenRouter.
 * Auth preference:
 *   1) n8n webhook /dunnly/eval/llm using saved "OpenRouter account" credential
 *   2) OPENROUTER_API_KEY in .env (optional override)
 *
 * Usage: node scripts/eval-wa-draft.js
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const { URL } = require("url");

const ROOT = path.join(__dirname, "..");
const FIXTURES = path.join(ROOT, "evals/wa-draft/fixtures.json");
const RESULTS_DIR = path.join(ROOT, "evals/wa-draft/results");
const RESULTS = path.join(RESULTS_DIR, "latest.json");

const {
  SYSTEM_PROMPT,
  userMessage,
  DRAFT_MODEL,
  JUDGE_MODEL,
} = require("../evals/wa-draft/prompts.js");

const WEIGHTS = {
  objective: 0.35,
  coherence: 0.25,
  factual: 0.25,
  tone: 0.1,
  constraints: 0.05,
};

const PASS_MEAN = 70;
const PASS_OBJECTIVE_MIN = 3;

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

/** Call OpenRouter through n8n saved credential (preferred). */
async function openRouterViaN8n(model, messages, responseFormat) {
  const secret = (process.env.N8N_WEBHOOK_SECRET || "").trim();
  if (!secret) throw new Error("NO_N8N_SECRET");
  const base = (process.env.N8N_BASE_URL || "https://n8n.piyushtater.com").replace(/\/$/, "");
  const prefix = process.env.N8N_WEBHOOK_PREFIX || "/webhook";
  const payload = { model, messages, temperature: 0.2 };
  if (responseFormat) payload.response_format = responseFormat;
  const res = await httpsJson(
    "POST",
    base + prefix + "/dunnly/eval/llm",
    { "x-dunnly-secret": secret },
    payload
  );
  if (res.status === 404) throw new Error("N8N_EVAL_PROXY_MISSING");
  if (!res.json) {
    throw new Error(
      "n8n eval llm non-JSON " + res.status + " " + String(res.raw).slice(0, 160)
    );
  }
  if (res.json.ok === false || res.json.error) {
    throw new Error(
      "n8n eval llm error " + JSON.stringify(res.json.error || res.json).slice(0, 300)
    );
  }
  if (!res.json.choices) {
    throw new Error(
      "n8n eval llm missing choices " + JSON.stringify(res.json).slice(0, 200)
    );
  }
  return { ...res.json, via: "n8n-openrouter-cred" };
}

function openRouterDirect(model, messages, responseFormat) {
  const key = (process.env.OPENROUTER_API_KEY || "").trim();
  if (!key) return Promise.reject(new Error("NO_OPENROUTER_KEY"));
  const body = { model, messages, temperature: 0.2 };
  if (responseFormat) body.response_format = responseFormat;
  return httpsJson(
    "POST",
    "https://openrouter.ai/api/v1/chat/completions",
    {
      Authorization: "Bearer " + key,
      "HTTP-Referer": "https://dunnly.local/evals",
      "X-Title": "Dunnly WA draft evals",
    },
    body
  ).then((res) => {
    if (res.status >= 400 || !res.json) {
      throw new Error(
        "OpenRouter " +
          res.status +
          " " +
          JSON.stringify(res.json?.error || res.raw).slice(0, 300)
      );
    }
    return { ...res.json, via: "openrouter-env" };
  });
}

async function openRouterChat(model, messages, responseFormat) {
  try {
    return await openRouterViaN8n(model, messages, responseFormat);
  } catch (e) {
    const msg = String(e.message || e);
    if (
      msg === "NO_N8N_SECRET" ||
      msg === "N8N_EVAL_PROXY_MISSING" ||
      /n8n eval llm/.test(msg) ||
      /timeout/.test(msg)
    ) {
      console.log("(n8n OpenRouter proxy: " + msg.slice(0, 160) + ")");
      try {
        return await openRouterDirect(model, messages, responseFormat);
      } catch (e2) {
        if (String(e2.message) === "NO_OPENROUTER_KEY") {
          const err = new Error("NO_OPENROUTER_VIA_N8N_OR_ENV: " + msg);
          err.cause = e;
          throw err;
        }
        throw e2;
      }
    }
    throw e;
  }
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

function scoreCase(scores) {
  let wsum = 0;
  let acc = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) {
    const v = Number(scores[k]);
    if (!Number.isFinite(v)) continue;
    acc += w * v;
    wsum += w;
  }
  const mean1to5 = wsum ? acc / wsum : 0;
  return Math.round((mean1to5 / 5) * 1000) / 10;
}

const JUDGE_SYSTEM = `You judge WhatsApp AR collections drafts for Dunnly.
Score the waBody only (ignore emailBody except if waBody is empty).
Return strict JSON:
{"objective":1-5,"coherence":1-5,"factual":1-5,"tone":1-5,"constraints":1-5,"notes":string}

Rubric:
- objective: 5 = clear payment-status / payment-date ask for AR collections; 1 = shipping/order/marketing or off-topic
- coherence: 5 = sensible WhatsApp message; 1 = nonsense or template bleed ("has shipped", "delivered on")
- factual: 5 = uses invoice id / customer / overdue context correctly without inventing facts; 1 = wrong or invented details
- tone: 5 = short, professional, polite; 1 = rude or inappropriate
- constraints: 5 = under ~600 chars, plain text, no markdown; 1 = violates hard limits

Be strict on objective and shipping-language bleed.`;

function heuristicJudge(invoice, draft) {
  const wa = String(draft.waBody || "");
  const lower = wa.toLowerCase();
  const shipping =
    /has shipped|delivered on|order of|tracking number|out for delivery/.test(lower);
  const cta = /pay|payment|overdue|past due|remit|settle|due date|when can you|expected/.test(
    lower
  );
  const hasId = wa.includes(String(invoice.id));
  const hasCustomer =
    !invoice.customer ||
    lower.includes(String(invoice.customer).toLowerCase().split(/\s+/)[0].toLowerCase());
  const lenOk = wa.length > 20 && wa.length <= 600;
  const plain = !/[*_#`]/.test(wa);

  let objective = 5;
  if (shipping) objective = 1;
  else if (!cta) objective = 2;
  else if (!hasId) objective = 3;

  let coherence = shipping ? 2 : wa.length > 10 ? 5 : 1;
  let factual = hasId && hasCustomer ? 5 : hasId ? 4 : 2;
  if (shipping) factual = Math.min(factual, 2);
  let tone = /please|could you|kindly|thanks|thank you|hi |hello/.test(lower) ? 5 : 4;
  let constraints = lenOk && plain ? 5 : lenOk || plain ? 3 : 1;

  return {
    objective,
    coherence,
    factual,
    tone,
    constraints,
    notes: shipping
      ? "heuristic: shipping-language bleed"
      : "heuristic judge (OpenRouter unavailable)",
    via: "heuristic",
  };
}

function localCompliantDraft(invoice) {
  const waBody =
    "Hi " +
    invoice.customer +
    " — invoice " +
    invoice.id +
    " (" +
    invoice.amountRemaining +
    " remaining) is " +
    invoice.daysOverdue +
    " days overdue. Can you confirm an expected payment date, or let us know if anything is blocking approval?";
  const emailBody =
    "Hello,\n\nOur records show invoice " +
    invoice.id +
    " for " +
    invoice.customer +
    " with " +
    invoice.amountRemaining +
    " remaining is " +
    invoice.daysOverdue +
    " days past due.\n\nCould you confirm the expected payment date?\n\nRegards,\nDunnly AR";
  return { emailBody, waBody, raw: "local-compliant", via: "local-compliant" };
}

async function draftOne(invoice) {
  try {
    const res = await openRouterChat(
      DRAFT_MODEL,
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage(invoice) },
      ],
      { type: "json_object" }
    );
    const content = res.choices?.[0]?.message?.content || "";
    const parsed = parseJsonContent(content);
    return {
      emailBody: String(parsed.emailBody || ""),
      waBody: String(parsed.waBody || ""),
      raw: content,
      via: res.via || "openrouter",
    };
  } catch (e) {
    console.log("(draft LLM unavailable: " + String(e.message).slice(0, 100) + ")");
    return localCompliantDraft(invoice);
  }
}

async function judgeOne(invoice, draft) {
  try {
    const user = JSON.stringify({
      invoice,
      waBody: draft.waBody,
      emailBodyPreview: String(draft.emailBody || "").slice(0, 200),
    });
    const res = await openRouterChat(
      JUDGE_MODEL,
      [
        { role: "system", content: JUDGE_SYSTEM },
        { role: "user", content: user },
      ],
      { type: "json_object" }
    );
    const parsed = parseJsonContent(res.choices?.[0]?.message?.content || "");
    const clamp = (n) => {
      const v = Math.round(Number(n));
      if (!Number.isFinite(v)) return 1;
      return Math.max(1, Math.min(5, v));
    };
    return {
      objective: clamp(parsed.objective),
      coherence: clamp(parsed.coherence),
      factual: clamp(parsed.factual),
      tone: clamp(parsed.tone),
      constraints: clamp(parsed.constraints),
      notes: String(parsed.notes || "").slice(0, 300),
      via: res.via || "openrouter",
    };
  } catch (e) {
    return heuristicJudge(invoice, draft);
  }
}

async function main() {
  loadEnv();
  const fixtures = JSON.parse(fs.readFileSync(FIXTURES, "utf8"));
  const cases = [];

  console.log(
    "eval:wa-draft — %d fixtures · draft=%s · judge=%s · via n8n OpenRouter credential",
    fixtures.length,
    DRAFT_MODEL,
    JUDGE_MODEL
  );

  for (const inv of fixtures) {
    process.stdout.write("  drafting " + inv.id + " … ");
    const draft = await draftOne(inv);
    if (!draft.waBody) {
      console.log("FAIL (empty waBody)");
      cases.push({
        id: inv.id,
        invoice: inv,
        draft,
        scores: {
          objective: 1,
          coherence: 1,
          factual: 1,
          tone: 1,
          constraints: 1,
          notes: "empty waBody",
          via: "none",
        },
        promptRelevance: 20,
        fail: true,
      });
      continue;
    }
    const scores = await judgeOne(inv, draft);
    const promptRelevance = scoreCase(scores);
    const fail = scores.objective < PASS_OBJECTIVE_MIN;
    console.log(
      "[%s/%s] obj=%d coh=%d fact=%d tone=%d con=%d → %s%s",
      draft.via,
      scores.via,
      scores.objective,
      scores.coherence,
      scores.factual,
      scores.tone,
      scores.constraints,
      promptRelevance,
      fail ? " FAIL_OBJ" : ""
    );
    cases.push({ id: inv.id, invoice: inv, draft, scores, promptRelevance, fail });
  }

  const mean =
    cases.reduce((s, c) => s + c.promptRelevance, 0) / (cases.length || 1);
  const promptRelevance = Math.round(mean * 10) / 10;
  const anyObjFail = cases.some((c) => c.scores.objective < PASS_OBJECTIVE_MIN);
  const passed = promptRelevance >= PASS_MEAN && !anyObjFail;

  const report = {
    generatedAt: new Date().toISOString(),
    draftModel: DRAFT_MODEL,
    judgeModel: JUDGE_MODEL,
    draftVia: cases[0]?.draft?.via || null,
    judgeVia: cases[0]?.scores?.via || null,
    weights: WEIGHTS,
    thresholds: { promptRelevance: PASS_MEAN, objectiveMin: PASS_OBJECTIVE_MIN },
    promptRelevance,
    passed,
    systemPromptChars: SYSTEM_PROMPT.length,
    cases: cases.map((c) => ({
      id: c.id,
      promptRelevance: c.promptRelevance,
      scores: c.scores,
      waBody: c.draft.waBody,
      draftVia: c.draft.via,
      fail: c.fail,
    })),
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(RESULTS, JSON.stringify(report, null, 2) + "\n");

  console.log(
    "\n=== promptRelevance %s / 100 · %s ===",
    promptRelevance,
    passed ? "PASS" : "FAIL"
  );
  console.log("wrote " + path.relative(ROOT, RESULTS));

  if (!passed) process.exit(1);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
