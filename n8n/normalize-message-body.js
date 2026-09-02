/**
 * Shared message-body normalizer — keep in sync with lib/message-body.ts.
 * Used at inbound ingestion and on read for customer reply text.
 */

const HTML_ENTITIES = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

function decodeHtmlEntities(s) {
  return String(s).replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39);/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? m);
}

function stripHtml(s) {
  let out = String(s);
  out = out.replace(/<br\s*\/?>/gi, "\n");
  out = out.replace(/<\/p>/gi, "\n\n");
  out = out.replace(/<[^>]+>/g, "");
  return decodeHtmlEntities(out);
}

function collapseWhitespace(s) {
  return String(s)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

function stripJsonArtifacts(s) {
  let out = String(s).trim();
  out = out.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  if (!out.startsWith("{")) return out;
  try {
    const parsed = JSON.parse(out);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      if (typeof parsed.classification === "string") return "";
      for (const key of ["replyText", "text", "body", "message", "emailBody", "waBody", "content"]) {
        if (typeof parsed[key] === "string" && parsed[key].trim()) return parsed[key].trim();
      }
    }
  } catch {
    /* not JSON */
  }
  return out;
}

const EMAIL_QUOTE_PATTERNS = [
  /\n-{2,}\s*original message\s*-{2,}/i,
  /\n-{5,}\s*forwarded message\s*-{5,}/i,
  /\nfrom:\s*.+\n(?:sent|date):\s*.+/i,
  /\non\s.+wrote:\s*\n/i,
  /\n_{5,}\n/,
];

function trimEmailReply(s) {
  let out = String(s);
  let cutAt = out.length;
  for (const pat of EMAIL_QUOTE_PATTERNS) {
    const m = pat.exec(out);
    if (m && m.index < cutAt) cutAt = m.index;
  }
  out = out.slice(0, cutAt);
  const lines = out.split("\n");
  const kept = [];
  for (const line of lines) {
    if (/^>/.test(line.trim())) break;
    kept.push(line);
  }
  return collapseWhitespace(kept.join("\n"));
}

function objectToPlainText(obj) {
  if (obj == null) return "";
  if (typeof obj === "string") return obj.trim();
  if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
  if (Array.isArray(obj)) {
    const parts = obj.map(objectToPlainText).filter(Boolean);
    return parts.join("\n").trim();
  }
  if (typeof obj === "object") {
    for (const key of ["text", "body", "Body", "content", "message", "replyText", "bodyPlain"]) {
      if (typeof obj[key] === "string" && obj[key].trim()) return obj[key].trim();
    }
    const vals = Object.values(obj)
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter(Boolean);
    if (vals.length === 1) return vals[0];
    if (vals.length > 1) return vals.join(" ").trim();
  }
  return "";
}

function coercePlainText(raw) {
  if (raw == null || raw === "") return "";
  if (typeof raw === "string") return raw.trim();
  const fromObj = objectToPlainText(raw);
  if (fromObj) return fromObj;
  return "";
}

/**
 * @param {unknown} raw
 * @param {{ channel?: 'email' | 'whatsapp' | 'manual' }} [opts]
 * @returns {string}
 */
function normalizeMessageBody(raw, opts) {
  const channel = opts && opts.channel ? opts.channel : "manual";
  let text = coercePlainText(raw);
  if (!text) return "";
  text = stripJsonArtifacts(text);
  if (channel === "email") {
    text = stripHtml(text);
    text = trimEmailReply(text);
  }
  return collapseWhitespace(text);
}

module.exports = {
  normalizeMessageBody,
  coercePlainText,
  stripHtml,
  stripJsonArtifacts,
  trimEmailReply,
  collapseWhitespace,
};
