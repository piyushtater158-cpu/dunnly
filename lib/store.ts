// Server-only mock data layer. This is now the isMock() fallback path (see
// lib/n8n.ts) used whenever N8N_BASE_URL is unset — local dev, and a safe
// rollback if the real backend misbehaves. Every route's real-mode branch
// calls lib/n8n.ts instead of the functions here. See n8n/README.md for the
// real contract and n8n/workflows/ for the workflows that implement it.
// Never import this from a client component.

import { addCalendarDays, computeDaysOverdue, istYmd } from "@/lib/overdue";

export type Stage =
  | "queued"
  | "drafted"
  | "sent"
  | "replied"
  | "classified"
  | "notified"
  | "failed";

export type Classification = "paid" | "promise" | "dispute" | "no_response" | null;

export type ReplyChannel = "email" | "whatsapp" | "manual" | null;

/** Follow-up cadence loop control. See n8n/followup-policy.js for the state machine. */
export type CadenceState = "active" | "paused" | "closed" | null;

export type FollowupBucket = "W1" | "W2" | "W3" | "W4" | null;

export interface Invoice {
  id: string;
  customer: string;
  email: string;
  phone: string;
  amountDue: number;
  amountRemaining: number;
  /** ISO YYYY-MM-DD — input from Sheet / seed. */
  dateOfSupply: string | null;
  /** Days of credit allowed — input from Sheet / seed. */
  creditDays: number | null;
  /** Derived: dateOfSupply + creditDays (IST calendar). */
  dueDate: string | null;
  /** Derived when supply+credit present; else legacy stored age. */
  daysOverdue: number;
  stage: Stage;
  classification: Classification;
  replyText: string | null;
  replyChannel: ReplyChannel;
  failureReason: string | null;
  draftEmail: string | null;
  draftWhatsapp: string | null;
  updatedAt: number;
  waStatus: string | null;
  waOptIn: boolean;
  waOptOut: boolean;
  /** ISO YYYY-MM-DD — when the next automated touch is due. Null until first sent. */
  nextActionAt: string | null;
  /** Which follow-up window was chosen (display + audit). */
  followupBucket: FollowupBucket;
  /** Automated touches so far (incremented by dunnly-followup, not by a manual send). */
  followupCount: number;
  /** Follow-up loop control. Null until first sent (cadence not yet initialized). */
  cadenceState: CadenceState;
  /** ISO YYYY-MM-DD extracted from the customer's reply, or null. */
  promiseDate: string | null;
  /** epoch ms — same-day double-run guard for dunnly-followup. Null until first touched. */
  lastTouchAt: number | null;
}

/** Pending / keyword inbound WhatsApp events (unmatched, START, STOP). */
export interface InboundEvent {
  sid: string;
  timestamp: number;
  from: string;
  body: string;
  kind: "reply" | "stop" | "start" | "help" | "status";
  suggestedInvoiceId: string | null;
  attachedInvoiceId: string | null;
  status: "pending" | "attached" | "ignored";
  messageStatus: string | null;
  channel: "email" | "whatsapp" | null;
}

export const DEMO_EMAILS = [
  "tooncreatives158@gmail.com",
  "piyushtater5555@gmail.com",
  "piyushjain2090@gmail.com",
  "kdfoods101@gmail.com",
] as const;

/** Only this invoice owns ADMIN_PHONE for unique inbound WhatsApp tracking. */
export const WA_DEMO_INVOICE_ID = "INV-24245";
/** Customer name starts with PU so it’s easy to spot in the dashboard/Sheet. */
export const WA_DEMO_CUSTOMER = "Piyush Tater Demo Co";
/** Real Gmail for E2E email send/receive on the demo party. */
export const WA_DEMO_EMAIL = "piyushtater5555@gmail.com";

export function adminPhoneDisplay(): string {
  const raw = (process.env.ADMIN_PHONE || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "+1 555 010 0000";
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  return `+${digits}`;
}

export function adminPhoneDigits(): string {
  return (process.env.ADMIN_PHONE || "").replace(/\D/g, "");
}

const SEED: Array<
  [string, string, number, number, number, Stage, Classification, string | null, string?]
> = [
  ["INV-24118", "Halvorsen Freight Ltd", 48200, 48200, 74, "classified", "dispute", "PO mismatch on lines 3-4, we are holding payment until credit note issued."],
  ["INV-24093", "Merrow Dental Group", 12480, 12480, 61, "notified", "promise", "Cash flow is tight this month — we can settle in full on the 14th."],
  ["INV-24211", "Pinecrest Fabricators", 96750, 41250, 39, "classified", "promise", "Sent 55k Tuesday, balance follows after our own receivable clears."],
  ["INV-24187", "Ostrander Media Co", 8940, 8940, 52, "failed", null, null, "Graph send rejected: 550 5.1.1 recipient address rejected (ap@ostrandermedia.co)"],
  ["INV-24230", "Calderon Industrial Supply", 31500, 31500, 28, "sent", null, null],
  ["INV-24164", "Wexley Analytics Inc", 22300, 22300, 66, "drafted", null, null],
  ["INV-24245", "Piyush Tater Demo Co", 57800, 57800, 21, "drafted", null, null],
  ["INV-24102", "Ashgrove Facility Mgmt", 4150, 0, 71, "notified", "paid", "Remittance sent Friday, ref 887-2231. Please confirm receipt."],
  ["INV-24259", "Tolliver Bros Contracting", 78400, 78400, 17, "queued", null, null],
  ["INV-24199", "Kessington Labs", 15600, 15600, 45, "replied", null, null],
  ["INV-24176", "Drayton Cold Storage", 42900, 42900, 58, "failed", null, null, "n8n webhook timeout after 30s on classify step — pipeline halted"],
  ["INV-24222", "Sable Point Hotels", 26750, 26750, 35, "sent", null, null],
  ["INV-24141", "Ruddick Plastics", 19200, 19200, 63, "classified", "no_response", ""],
  ["INV-24268", "Ferrante Logistics", 63100, 63100, 12, "queued", null, null],
  ["INV-24208", "Whitlow Aggregate", 34600, 34600, 41, "notified", "dispute", "We never received the goods on this invoice. Escalating to our legal."],
  ["INV-24155", "Lindquist Orthopedics", 11875, 11875, 68, "sent", null, null],
  ["INV-24237", "Marbury Print House", 7320, 7320, 26, "drafted", null, null],
  ["INV-24127", "Estcourt Energy Partners", 118500, 118500, 79, "classified", "promise", "Approved internally. Payment run is the last business day of the month."],
  ["INV-24251", "Havlicek Machine Works", 29450, 29450, 19, "queued", null, null],
  ["INV-24193", "Corrigan Water Systems", 16240, 16240, 49, "replied", null, null],
  ["INV-24214", "Beaumont Textiles", 51900, 51900, 37, "failed", null, null, "WhatsApp sim gateway error 502 — message not delivered"],
  ["INV-24274", "Sundberg Roofing", 9680, 9680, 9, "queued", null, null],
  ["INV-24169", "Alderwick Property Trust", 88300, 88300, 55, "sent", null, null],
  ["INV-24204", "Trenholme Scientific", 23750, 23750, 43, "classified", "promise", "Short-paid by 3k pending a rebate check; rest goes out this week."],
];

const MINS_AGO = [4, 11, 19, 26, 33, 47, 58, 72, 96, 121];
/** Default net terms for mock seed (back-calc supply from desired age). */
const SEED_CREDIT_DAYS = 30;

function seed(): Invoice[] {
  const now = Date.now();
  const demoPhone = adminPhoneDisplay();
  const today = istYmd(new Date());
  return SEED.map((r, i) => {
    const id = r[0];
    const isDemo = id === WA_DEMO_INVOICE_ID;
    const desiredAge = r[4];
    const creditDays = SEED_CREDIT_DAYS;
    // dueDate = today - desiredAge; supply = dueDate - creditDays
    const dueDate = addCalendarDays(today, -desiredAge);
    const dateOfSupply = addCalendarDays(dueDate, -creditDays);
    const derived = computeDaysOverdue({
      dateOfSupply,
      creditDays,
      storedDaysOverdue: desiredAge,
    });
    const base: Invoice = {
      id,
      customer: isDemo ? WA_DEMO_CUSTOMER : r[1],
      email: isDemo ? WA_DEMO_EMAIL : DEMO_EMAILS[i % DEMO_EMAILS.length],
      amountDue: r[2],
      amountRemaining: r[3],
      dateOfSupply: derived.dateOfSupply,
      creditDays: derived.creditDays,
      dueDate: derived.dueDate,
      daysOverdue: derived.daysOverdue,
      stage: r[5],
      classification: r[6],
      replyText: r[7] ?? null,
      replyChannel: null,
      failureReason: r[8] ?? null,
      draftEmail: null,
      draftWhatsapp: null,
      updatedAt: now - (MINS_AGO[i % MINS_AGO.length] + i) * 60_000,
      phone: isDemo
        ? demoPhone
        : "+1 " + (200 + (i * 7) % 700) + " 555 " + String(1000 + i * 37).slice(0, 4),
      waStatus: null,
      waOptIn: isDemo,
      waOptOut: false,
      // Cadence starts null for pre-existing seed rows — mirrors real behavior:
      // the clock is only initialized the next time this row is actually sent
      // (see app/api/invoices/[id]/send/route.ts mock branch) or classified.
      nextActionAt: null,
      followupBucket: null,
      followupCount: 0,
      cadenceState: null,
      promiseDate: null,
      lastTouchAt: null,
    };
    if (base.stage !== "queued") {
      base.draftEmail = emailFor(base);
      base.draftWhatsapp = waFor(base);
    }
    return base;
  });
}

// Module-level singleton, kept on globalThis so Next.js route-handler module
// reloads in dev don't reset the mock DB mid-session.
const g = globalThis as unknown as {
  __dunnlyStore?: Invoice[];
  __dunnlyInbound?: InboundEvent[];
};

export function db(): Invoice[] {
  if (!g.__dunnlyStore) g.__dunnlyStore = seed();
  return g.__dunnlyStore;
}

export function inboundDb(): InboundEvent[] {
  if (!g.__dunnlyInbound) g.__dunnlyInbound = [];
  return g.__dunnlyInbound;
}

export function findInvoice(id: string): Invoice | undefined {
  return db().find((v) => v.id === id);
}

export function patch(id: string, fields: Partial<Invoice>): Invoice | undefined {
  const store = db();
  const idx = store.findIndex((v) => v.id === id);
  if (idx === -1) return undefined;
  store[idx] = { ...store[idx], ...fields, updatedAt: Date.now() };
  return store[idx];
}

export function pendingInbound(): InboundEvent[] {
  return inboundDb().filter((e) => e.status === "pending");
}

export function findInbound(sid: string): InboundEvent | undefined {
  return inboundDb().find((e) => e.sid === sid);
}

export function attachInbound(sid: string, invoiceId: string): InboundEvent | undefined {
  const ev = findInbound(sid);
  if (!ev || ev.status !== "pending") return undefined;
  const inv = findInvoice(invoiceId);
  if (!inv) return undefined;
  patch(invoiceId, {
    stage: "replied",
    replyText: ev.body,
    replyChannel: "whatsapp",
  });
  ev.status = "attached";
  ev.attachedInvoiceId = invoiceId;
  return ev;
}

export function ignoreInbound(sid: string): InboundEvent | undefined {
  const ev = findInbound(sid);
  if (!ev || ev.status !== "pending") return undefined;
  ev.status = "ignored";
  return ev;
}

/** Simulate an inbound WhatsApp event in mock mode (for local UI testing). */
export function mockInboundMessage(opts: {
  body: string;
  from?: string;
  kind?: InboundEvent["kind"];
}): InboundEvent {
  const from = opts.from || adminPhoneDisplay();
  const kind = opts.kind || classifyInboundKind(opts.body);
  const digits = from.replace(/\D/g, "");
  const matches = db().filter((v) => v.phone.replace(/\D/g, "") === digits);
  const sid = "SM_mock_" + Date.now();
  const now = Date.now();

  if (kind === "stop") {
    for (const m of matches) patch(m.id, { waOptOut: true, waOptIn: false });
    const ev: InboundEvent = {
      sid,
      timestamp: now,
      from,
      body: opts.body,
      kind,
      suggestedInvoiceId: matches[0]?.id ?? null,
      attachedInvoiceId: null,
      status: "pending",
      messageStatus: null,
      channel: "whatsapp",
    };
    inboundDb().unshift(ev);
    return ev;
  }

  if (kind === "start") {
    for (const m of matches) patch(m.id, { waOptIn: true, waOptOut: false });
    const ev: InboundEvent = {
      sid,
      timestamp: now,
      from,
      body: opts.body,
      kind,
      suggestedInvoiceId: matches[0]?.id ?? null,
      attachedInvoiceId: null,
      status: "pending",
      messageStatus: null,
      channel: "whatsapp",
    };
    inboundDb().unshift(ev);
    return ev;
  }

  if (matches.length === 1 && kind === "reply") {
    patch(matches[0].id, { stage: "replied", replyText: opts.body, replyChannel: "whatsapp" });
    const ev: InboundEvent = {
      sid,
      timestamp: now,
      from,
      body: opts.body,
      kind,
      suggestedInvoiceId: matches[0].id,
      attachedInvoiceId: matches[0].id,
      status: "attached",
      messageStatus: null,
      channel: "whatsapp",
    };
    inboundDb().unshift(ev);
    return ev;
  }

  const suggested = matches.length === 1 ? matches[0].id : null;

  const ev: InboundEvent = {
    sid,
    timestamp: now,
    from,
    body: opts.body,
    kind: kind === "help" ? "help" : "reply",
    suggestedInvoiceId: suggested,
    attachedInvoiceId: null,
    status: "pending",
    messageStatus: null,
    channel: "whatsapp",
  };
  inboundDb().unshift(ev);
  return ev;
}

export function classifyInboundKind(body: string): InboundEvent["kind"] {
  const s = body.trim().toUpperCase();
  if (/^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT)$/.test(s)) return "stop";
  if (/^(START|UNSTOP)$/.test(s) || /^JOIN\b/.test(s)) return "start";
  if (s === "HELP") return "help";
  return "reply";
}

export function money(n: number): string {
  return (
    "$" +
    n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

export function ago(ms: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  return Math.round(mins / 60) + "h ago";
}

export function emailFor(v: Invoice): string {
  return (
    "Hello,\n\nOur records show invoice " +
    v.id +
    " for " +
    money(v.amountDue) +
    " is " +
    v.daysOverdue +
    " days past due" +
    (v.amountRemaining < v.amountDue
      ? ", with " + money(v.amountRemaining) + " still outstanding after your partial payment"
      : "") +
    ".\n\nCould you confirm the expected payment date, or let us know if anything is blocking approval on your side? Remittance details are unchanged from the invoice.\n\nRegards,\nAccounts Receivable\nDunnly"
  );
}

/** AR collections WhatsApp copy — same objective as email (overdue + amount + pay CTA). */
export function waFor(v: Invoice): string {
  return (
    "Hi — quick note from Dunnly AR: invoice " +
    v.id +
    " (" +
    money(v.amountRemaining) +
    ") is " +
    v.daysOverdue +
    " days overdue. Can you confirm a payment date? Happy to send the copy again if useful."
  );
}

// Mock-mode classifier only. In real mode (N8N_BASE_URL set), classification
// is done by an LLM inside N8N's dunnly-classify workflow — see
// n8n/workflows/dunnly-classify.json — and this function is never called.
export function classify(text: string | null | undefined): Exclude<Classification, null> {
  const s = (text || "").toLowerCase().trim();
  if (!s) return "no_response";
  if (/remit|paid|wire|transferred|settled in full|ref /.test(s)) return "paid";
  if (/dispute|never received|wrong|incorrect|credit note|mismatch|legal|holding/.test(s))
    return "dispute";
  if (/will pay|next week|on the |payment run|follows|can settle|this week|month/.test(s))
    return "promise";
  return "no_response";
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function draftInvoice(id: string): Invoice | undefined {
  const v = findInvoice(id);
  if (!v) return undefined;
  return patch(id, { draftEmail: emailFor(v), draftWhatsapp: waFor(v) });
}

export function redraftInvoice(id: string): Invoice | undefined {
  return draftInvoice(id);
}

export function updateDraft(
  id: string,
  fields: { emailBody?: string; waBody?: string }
): Invoice | undefined {
  const patchFields: Partial<Invoice> = {};
  if (typeof fields.emailBody === "string") patchFields.draftEmail = fields.emailBody;
  if (typeof fields.waBody === "string") patchFields.draftWhatsapp = fields.waBody;
  if (!Object.keys(patchFields).length) return findInvoice(id);
  return patch(id, patchFields);
}
