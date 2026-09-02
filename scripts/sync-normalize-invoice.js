/**
 * Patch n8n workflow Code nodes that inline invoice normalize logic.
 * Usage: node scripts/sync-normalize-invoice.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const msgPath = path.join(ROOT, "n8n/normalize-message-body.js");
const msgSrc = fs.readFileSync(msgPath, "utf8").replace(/module\.exports[\s\S]*$/, "").trim();
const normPath = path.join(ROOT, "n8n/normalize-invoice.js");
const normSrc = fs.readFileSync(normPath, "utf8");
const core =
  msgSrc +
  "\n\n" +
  normSrc
    .replace(/const \{ normalizeMessageBody \} = require\("\.\/normalize-message-body"\);\s*/, "")
    .replace(/module\.exports[\s\S]*$/, "")
    .trim();

const CADENCE_FIELDS = `
  nextActionAt: pickYmd(r.nextActionAt),
  followupBucket: pickBucket(r.followupBucket),
  followupCount: pickInt(r.followupCount, 0),
  cadenceState: pickCadenceState(r.cadenceState),
  promiseDate: pickYmd(r.promiseDate),
  lastTouchAt: pickLastTouchAt(r.lastTouchAt),`;

function buildEachItemTail(tailLines) {
  const helpers = core;
  const body = `
const r = $json;
const overdue = deriveOverdue(r);
const invoice = {
  id: String(r.id || ""),
  customer: String(r.customer || ""),
  email: String(r.email || ""),
  phone: String(r.phone || "").replace(/^'/, ""),
  amountDue: Number(r.amountDue || 0),
  amountRemaining: Number(r.amountRemaining || 0),
  dateOfSupply: overdue.dateOfSupply,
  creditDays: overdue.creditDays,
  dueDate: overdue.dueDate,
  daysOverdue: overdue.daysOverdue,
  stage: r.stage || "queued",
  classification: r.classification || null,
  replyText: r.repliedAt
    ? normalizeMessageBody(r.replyText || "", {
        channel:
          r.replyChannel === "email" || r.replyChannel === "whatsapp"
            ? r.replyChannel
            : "manual",
      })
    : null,
  replyChannel: r.replyChannel || null,
  failureReason: r.failureReason || null,
  draftEmail: r.draftEmail || null,
  draftWhatsapp: r.draftWhatsapp || null,
  updatedAt: r.updatedAt || new Date().toISOString(),
  waStatus: r.waStatus || null,
  waOptIn: truthy(r.waOptIn),
  waOptOut: truthy(r.waOptOut),${CADENCE_FIELDS}
};
${tailLines}
`;
  return helpers + body;
}

const TAILS = {
  "dunnly-send.json": {
    Normalize: buildEachItemTail(
      `if (invoice.stage === "failed") {
  return { json: { ok: false, step: "send", failureReason: invoice.failureReason, invoice } };
}
return { json: { ok: true, invoice } };`
    ),
  },
  "dunnly-classify.json": {
    Normalize: buildEachItemTail(
      `if (invoice.stage === "failed") {
  return { json: { ok: false, step: "notify", failureReason: invoice.failureReason, invoice } };
}
return { json: { ok: true, invoice } };`
    ),
  },
  "dunnly-draft.json": {
    Normalize: buildEachItemTail(`return { json: { ok: true, invoice } };`),
  },
  "dunnly-read.json": {
    "Aggregate invoices": (() => {
      const helpers = core;
      return (
        helpers +
        `
const invoices = $input.all().map(({ json: r }) => normalizeInvoiceRow(r));
return [{ json: { invoices } }];`
      );
    })(),
  },
};

// inbound-wa Respond attach body — custom tail
TAILS["dunnly-inbound-wa.json"] = {
  "Respond attach body": (() => {
    const helpers = core;
    return (
      helpers +
      `
const meta = $('Pick inbound body').item.json;
const r = $input.first().json;
const invoice = normalizeInvoiceRow(r);
invoice.replyText = r.repliedAt
  ? normalizeMessageBody(r.replyText || '', {
      channel:
        r.replyChannel === 'email' || r.replyChannel === 'whatsapp'
          ? r.replyChannel
          : 'manual',
    })
  : (r.replyText || null);
invoice.stage = r.stage || 'replied';
return [{ json: { ok: true, event: { sid: meta.sid, status: 'attached', attachedInvoiceId: meta.invoiceId, body: meta.body, kind: meta.kind, from: meta.from, suggestedInvoiceId: meta.invoiceId, messageStatus: null, timestamp: meta.now }, invoice } }];`
    );
  })(),
};

for (const [file, nodes] of Object.entries(TAILS)) {
  const p = path.join(ROOT, "n8n/workflows", file);
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  for (const [nodeName, jsCode] of Object.entries(nodes)) {
    const node = j.nodes.find((n) => n.name === nodeName);
    if (!node) throw new Error("missing node " + nodeName + " in " + file);
    node.parameters.jsCode = jsCode;
    console.log("patched", file, nodeName);
  }
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
}

console.log("sync-normalize-invoice: done");
