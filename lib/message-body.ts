/**
 * TS mirror of n8n/normalize-message-body.js — keep in sync.
 */

export type MessageChannel = "email" | "whatsapp" | "manual";

const HTML_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

function decodeHtmlEntities(s: string): string {
  return s.replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39);/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? m);
}

export function stripHtml(s: string): string {
  let out = s;
  out = out.replace(/<br\s*\/?>/gi, "\n");
  out = out.replace(/<\/p>/gi, "\n\n");
  out = out.replace(/<[^>]+>/g, "");
  return decodeHtmlEntities(out);
}

export function collapseWhitespace(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

export function stripJsonArtifacts(s: string): string {
  let out = s.trim();
  out = out.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  if (!out.startsWith("{")) return out;
  try {
    const parsed = JSON.parse(out) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      if (typeof parsed.classification === "string") return "";
      for (const key of ["replyText", "text", "body", "message", "emailBody", "waBody", "content"]) {
        const v = parsed[key];
        if (typeof v === "string" && v.trim()) return v.trim();
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

export function trimEmailReply(s: string): string {
  let out = s;
  let cutAt = out.length;
  for (const pat of EMAIL_QUOTE_PATTERNS) {
    const m = pat.exec(out);
    if (m && m.index < cutAt) cutAt = m.index;
  }
  out = out.slice(0, cutAt);
  const lines = out.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (/^>/.test(line.trim())) break;
    kept.push(line);
  }
  return collapseWhitespace(kept.join("\n"));
}

function objectToPlainText(obj: unknown): string {
  if (obj == null) return "";
  if (typeof obj === "string") return obj.trim();
  if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
  if (Array.isArray(obj)) {
    const parts = obj.map(objectToPlainText).filter(Boolean);
    return parts.join("\n").trim();
  }
  if (typeof obj === "object") {
    const record = obj as Record<string, unknown>;
    for (const key of ["text", "body", "Body", "content", "message", "replyText", "bodyPlain"]) {
      const v = record[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    const vals = Object.values(record)
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter(Boolean);
    if (vals.length === 1) return vals[0];
    if (vals.length > 1) return vals.join(" ").trim();
  }
  return "";
}

export function coercePlainText(raw: unknown): string {
  if (raw == null || raw === "") return "";
  if (typeof raw === "string") return raw.trim();
  const fromObj = objectToPlainText(raw);
  if (fromObj) return fromObj;
  return "";
}

export function normalizeMessageBody(
  raw: unknown,
  opts?: { channel?: MessageChannel }
): string {
  const channel = opts?.channel ?? "manual";
  let text = coercePlainText(raw);
  if (!text) return "";
  text = stripJsonArtifacts(text);
  if (channel === "email") {
    text = stripHtml(text);
    text = trimEmailReply(text);
  }
  return collapseWhitespace(text);
}

export function replyChannelToMessageChannel(
  channel: string | null | undefined
): MessageChannel {
  if (channel === "email" || channel === "whatsapp") return channel;
  return "manual";
}
