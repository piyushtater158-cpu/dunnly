/**
 * Patch n8n workflow Code nodes with shared message-body normalizer.
 * Usage: node scripts/sync-normalize-message-body.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const normPath = path.join(ROOT, "n8n/normalize-message-body.js");
const normSrc = fs.readFileSync(normPath, "utf8");
const core = normSrc.replace(/module\.exports[\s\S]*$/, "").trim();

function withNormalizer(tail) {
  return core + "\n\n" + tail;
}

const PATCHES = {
  "dunnly-inbound-wa.json": {
    "Parse inbound": withNormalizer(`const j = $json.body || $json;
const from = String(j.From || j.from || '');
const rawBody = j.Body ?? j.body ?? '';
const body = normalizeMessageBody(rawBody, { channel: 'whatsapp' });
const sid = String(j.MessageSid || j.SmsMessageSid || j.SmsSid || j.sid || ('IN' + Date.now()));
const digits = from.replace(/\\D/g, '');
const upper = body.trim().toUpperCase();
let kind = 'reply';
if (/^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT)$/.test(upper)) kind = 'stop';
else if (/^(START|UNSTOP)$/.test(upper) || /^JOIN\\b/.test(upper)) kind = 'start';
else if (upper === 'HELP') kind = 'help';
return { json: { from, body, sid, digits, kind, now: new Date().toISOString() } };`),
    "Pick inbound body": withNormalizer(`const meta = $('Parse attach').item.json;
const hit = $input.all().map(({ json: r }) => r).find((r) => String(r.sid) === meta.sid);
if (!hit) return [{ json: { ok: false, failureReason: 'inbound not found', sid: meta.sid } }];
const body = normalizeMessageBody(hit.body || '', { channel: 'whatsapp' });
return [{ json: { ok: true, sid: meta.sid, invoiceId: meta.invoiceId, body, from: hit.from || '', kind: hit.kind || 'reply', now: meta.now } }];`),
  },
  "dunnly-inbound-email.json": {
    "Parse email": withNormalizer(`const b = $json.body || $json;
const raw = b.bodyPlain ?? b.body ?? '';
const bodyPlain = normalizeMessageBody(raw, { channel: 'email' }).slice(0, 2000);
return {
  json: {
    messageId: String(b.messageId || b.id || ('EM' + Date.now())),
    fromEmail: String(b.fromEmail || b.from || ''),
    subject: String(b.subject || ''),
    bodyPlain,
    receivedAt: String(b.receivedAt || new Date().toISOString()),
    now: new Date().toISOString(),
  },
};`),
  },
  "dunnly-read.json": {
    "Normalize ledger": withNormalizer(`const invoices = $('Aggregate invoices').item.json.invoices || [];
const wh = $('Sync Webhook').first().json;
const body = wh.body || wh;
const inboundRows = Array.isArray(body.inboundRows) ? body.inboundRows : [];
let inbound = [];
try {
  inbound = inboundRows
    .map((r) => {
      if (!r || !r.sid) return null;
      const ts = r.timestamp ? Date.parse(String(r.timestamp)) : Date.now();
      const channel = r.channel === 'email' || r.channel === 'whatsapp' ? r.channel : 'manual';
      return {
        sid: String(r.sid || ''),
        timestamp: Number.isFinite(ts) ? new Date(ts).toISOString() : String(r.timestamp || ''),
        from: String(r.from || ''),
        body: normalizeMessageBody(r.body || '', { channel }),
        kind: String(r.kind || 'reply'),
        suggestedInvoiceId: r.suggestedInvoiceId || null,
        attachedInvoiceId: r.attachedInvoiceId || null,
        status: String(r.status || 'pending').toLowerCase(),
        messageStatus: r.messageStatus || null,
        channel: r.channel === 'email' || r.channel === 'whatsapp' ? r.channel : null,
      };
    })
    .filter((e) => e && e.status === 'pending');
} catch (e) {
  inbound = [];
}
const syncedAt = body.syncedAt || new Date().toISOString();
return [{ json: { ok: true, invoices, inbound, syncedAt } }];`),
  },
};

const CLASSIFY_NORMALIZE_NODE = {
  id: "code-normalize-reply-1",
  name: "Normalize reply",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [130, 0],
  parameters: {
    mode: "runOnceForEachItem",
    jsCode: withNormalizer(`const wh = $json.body || $json;
const source = wh.source === 'whatsapp' ? 'whatsapp' : (wh.source === 'email' ? 'email' : 'manual');
const replyText = normalizeMessageBody(wh.replyText, { channel: source });
return { json: { body: { ...wh, replyText, source } } };`),
  },
};

for (const [file, nodes] of Object.entries(PATCHES)) {
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

// dunnly-classify: add/update Normalize reply node and rewire Webhook
{
  const p = path.join(ROOT, "n8n/workflows/dunnly-classify.json");
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  let node = j.nodes.find((n) => n.name === "Normalize reply");
  if (!node) {
    j.nodes.push(CLASSIFY_NORMALIZE_NODE);
    node = CLASSIFY_NORMALIZE_NODE;
    console.log("added dunnly-classify.json Normalize reply node");
  } else {
    node.parameters.jsCode = CLASSIFY_NORMALIZE_NODE.parameters.jsCode;
    console.log("patched dunnly-classify.json Normalize reply");
  }

  j.connections.Webhook = {
    main: [[{ node: "Normalize reply", type: "main", index: 0 }]],
  };
  j.connections["Normalize reply"] = {
    main: [[{ node: "Write replied (before LLM)", type: "main", index: 0 }]],
  };

  const blob = JSON.stringify(j);
  const updated = blob
    .replace(/\$\('Webhook'\)\.item\.json\.body\.replyText/g, "$('Normalize reply').item.json.body.replyText")
    .replace(
      /\$\('Webhook'\)\.item\.json\.body;\nconst invoiceId/g,
      "$('Normalize reply').item.json.body;\nconst invoiceId"
    )
    .replace(
      /const wh = \$\('Webhook'\)\.item\.json\.body;/g,
      "const wh = $('Normalize reply').item.json.body;"
    );
  fs.writeFileSync(p, updated.endsWith("\n") ? updated : updated + "\n");
  console.log("patched dunnly-classify.json connections + replyText refs");
}

console.log("sync-normalize-message-body: done");
