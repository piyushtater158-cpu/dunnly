/**
 * Shared invoice normalize — keep in sync across dunnly-read / draft / send / classify / inbound.
 * Returns one Invoice-shaped object from a Sheets row.
 * Derives dueDate + daysOverdue from dateOfSupply + creditDays (IST calendar).
 */

function istYmd(asOf) {
  const d = asOf || new Date();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function parseSupplyDate(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const ms = Math.round((raw - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!Number.isFinite(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  const s = String(raw).trim().replace(/^'/, "");
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (dmy) {
    return dmy[3] + "-" + dmy[2].padStart(2, "0") + "-" + dmy[1].padStart(2, "0");
  }
  const t = Date.parse(s);
  if (Number.isFinite(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}

function addCalendarDays(ymd, days) {
  const parts = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function diffCalendarDays(laterYmd, earlierYmd) {
  const a = laterYmd.split("-").map(Number);
  const b = earlierYmd.split("-").map(Number);
  const msA = Date.UTC(a[0], a[1] - 1, a[2]);
  const msB = Date.UTC(b[0], b[1] - 1, b[2]);
  return Math.round((msA - msB) / 86400000);
}

function pickSupplyCredit(r) {
  const dateOfSupply =
    r.dateOfSupply ?? r["Date of Supply"] ?? r["Date of supply"] ?? r.DateOfSupply ?? r.date_of_supply ?? null;
  const creditDays =
    r.creditDays ?? r.creditLine ?? r["Credit Line"] ?? r["Credit line"] ?? r["Credit Days"] ?? r.credit_days ?? null;
  return { dateOfSupply, creditDays };
}

function pickStoredOverdue(r) {
  if (r.daysOverdue != null && r.daysOverdue !== "") return r.daysOverdue;
  if (r["Days post due date "] != null && r["Days post due date "] !== "") return r["Days post due date "];
  for (const k of Object.keys(r)) {
    if (String(k).trim() === "Days post due date" && r[k] != null && r[k] !== "") return r[k];
  }
  return 0;
}

function deriveOverdue(r) {
  const picked = pickSupplyCredit(r);
  const supply = parseSupplyDate(picked.dateOfSupply);
  const creditRaw = picked.creditDays;
  const credit = creditRaw === "" || creditRaw == null ? null : Number(creditRaw);
  if (supply != null && credit != null && Number.isFinite(credit) && credit >= 0) {
    const dueDate = addCalendarDays(supply, Math.floor(credit));
    const today = istYmd(new Date());
    return {
      dateOfSupply: supply,
      creditDays: Math.floor(credit),
      dueDate,
      daysOverdue: Math.max(0, diffCalendarDays(today, dueDate)),
    };
  }
  const stored = Number(pickStoredOverdue(r) || 0);
  return {
    dateOfSupply: supply,
    creditDays: credit != null && Number.isFinite(credit) ? Math.floor(credit) : null,
    dueDate: null,
    daysOverdue: Number.isFinite(stored) ? Math.max(0, Math.floor(stored)) : 0,
  };
}

function normalizeInvoiceRow(r) {
  const truthy = (v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") {
      const s = v.trim().toUpperCase();
      return s === "TRUE" || s === "1" || s === "YES";
    }
    return false;
  };
  const overdue = deriveOverdue(r);
  return {
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
    replyText: r.repliedAt ? (r.replyText || "") : null,
    replyChannel: r.replyChannel || null,
    failureReason: r.failureReason || null,
    draftEmail: r.draftEmail || null,
    draftWhatsapp: r.draftWhatsapp || null,
    updatedAt: r.updatedAt || new Date().toISOString(),
    waStatus: r.waStatus || null,
    waOptIn: truthy(r.waOptIn),
    waOptOut: truthy(r.waOptOut),
    nextActionAt: pickYmd(r.nextActionAt),
    followupBucket: pickBucket(r.followupBucket),
    followupCount: pickInt(r.followupCount, 0),
    cadenceState: pickCadenceState(r.cadenceState),
    promiseDate: pickYmd(r.promiseDate),
    lastTouchAt: pickLastTouchAt(r.lastTouchAt),
  };
}

function pickYmd(v) {
  if (v == null || v === "") return null;
  const s = String(v).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function pickBucket(v) {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  return s === "W1" || s === "W2" || s === "W3" || s === "W4" ? s : null;
}

function pickCadenceState(v) {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  return s === "active" || s === "paused" || s === "closed" ? s : null;
}

function pickInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function pickLastTouchAt(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return n;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

module.exports = {
  normalizeInvoiceRow,
  deriveOverdue,
  parseSupplyDate,
  addCalendarDays,
  istYmd,
  pickSupplyCredit,
};
