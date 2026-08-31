/**
 * IST calendar-day overdue math.
 * dueDate = dateOfSupply + creditDays
 * daysOverdue = max(0, todayIST - dueDate)
 */

export const OVERDUE_TZ = "Asia/Kolkata";

/** YYYY-MM-DD in Asia/Kolkata for an instant (default: now). */
export function istYmd(asOf: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OVERDUE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(asOf);
}

/** Parse Sheet / ISO / serial-ish dates into YYYY-MM-DD, or null. */
export function parseSupplyDate(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Google Sheets serial day (approx); treat as UTC midnight epoch offset from 1899-12-30
    const ms = Math.round((raw - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!Number.isFinite(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  const s = String(raw).trim().replace(/^'/, "");
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // DD/MM/YYYY or DD-MM-YYYY (prefer day-first for IN)
  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (dmy) {
    const dd = dmy[1].padStart(2, "0");
    const mm = dmy[2].padStart(2, "0");
    const yyyy = dmy[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  const t = Date.parse(s);
  if (Number.isFinite(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}

export function addCalendarDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function diffCalendarDays(laterYmd: string, earlierYmd: string): number {
  const [y1, m1, d1] = laterYmd.split("-").map(Number);
  const [y0, m0, d0] = earlierYmd.split("-").map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y0, m0 - 1, d0);
  return Math.round((a - b) / 86400000);
}

export function computeDueDate(
  dateOfSupply: unknown,
  creditDays: unknown
): string | null {
  const supply = parseSupplyDate(dateOfSupply);
  const credit = Number(creditDays);
  if (!supply || !Number.isFinite(credit) || credit < 0) return null;
  return addCalendarDays(supply, Math.floor(credit));
}

/**
 * When supply + credit present → derive age.
 * Else fall back to storedDaysOverdue (migration).
 */
export function computeDaysOverdue(opts: {
  dateOfSupply?: unknown;
  creditDays?: unknown;
  storedDaysOverdue?: unknown;
  asOf?: Date;
}): { dueDate: string | null; daysOverdue: number; dateOfSupply: string | null; creditDays: number | null } {
  const supply = parseSupplyDate(opts.dateOfSupply);
  const creditRaw = opts.creditDays;
  const credit =
    creditRaw === "" || creditRaw == null ? null : Number(creditRaw);
  const dueDate =
    supply != null && credit != null && Number.isFinite(credit) && credit >= 0
      ? addCalendarDays(supply, Math.floor(credit))
      : null;

  if (dueDate) {
    const today = istYmd(opts.asOf ?? new Date());
    const days = Math.max(0, diffCalendarDays(today, dueDate));
    return {
      dueDate,
      daysOverdue: days,
      dateOfSupply: supply,
      creditDays: Math.floor(credit as number),
    };
  }

  const stored = Number(opts.storedDaysOverdue ?? 0);
  return {
    dueDate: null,
    daysOverdue: Number.isFinite(stored) ? Math.max(0, Math.floor(stored)) : 0,
    dateOfSupply: supply,
    creditDays: credit != null && Number.isFinite(credit) ? Math.floor(credit) : null,
  };
}

/** Pick dateOfSupply / creditDays from a row that may use Sheet aliases. */
export function pickSupplyCredit(r: Record<string, unknown>): {
  dateOfSupply: unknown;
  creditDays: unknown;
} {
  const dateOfSupply =
    r.dateOfSupply ??
    r["Date of Supply"] ??
    r["Date of supply"] ??
    r.DateOfSupply ??
    r.date_of_supply ??
    null;
  const creditDays =
    r.creditDays ??
    r.creditLine ??
    r["Credit Line"] ??
    r["Credit line"] ??
    r["Credit Days"] ??
    r.credit_days ??
    null;
  return { dateOfSupply, creditDays };
}
