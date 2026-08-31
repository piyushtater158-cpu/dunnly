// Server-only client for the real N8N backend. See n8n/README.md for the
// webhook contract this speaks, and the workflow exports under
// n8n/workflows/ that implement it. Never import this from a client
// component — it reads N8N_WEBHOOK_SECRET.
//
// isMock() gates every API route: unset N8N_BASE_URL and the app behaves
// exactly as it did before this file existed (lib/store.ts's in-memory
// mock). Setting N8N_BASE_URL is the entire cutover.

import { computeDaysOverdue, pickSupplyCredit } from "@/lib/overdue";
import {
  money,
  type Classification,
  type InboundEvent,
  type Invoice,
  type Stage,
} from "@/lib/store";

export class N8nUnreachableError extends Error {}

const STAGES = new Set<Stage>([
  "queued",
  "drafted",
  "sent",
  "replied",
  "classified",
  "notified",
  "failed",
]);

const CLASSIFICATIONS = new Set<Exclude<Classification, null>>([
  "paid",
  "promise",
  "dispute",
  "no_response",
]);

export function isMock(): boolean {
  return !process.env.N8N_BASE_URL;
}

function webhookUrl(path: string): string {
  const base = process.env.N8N_BASE_URL;
  if (!base) throw new N8nUnreachableError("N8N_BASE_URL is not set");
  const prefix = process.env.N8N_WEBHOOK_PREFIX ?? "/webhook";
  return base.replace(/\/+$/, "") + prefix + path;
}

interface N8nEnvelope {
  ok?: boolean;
  invoice?: unknown;
  invoices?: unknown[];
  inbound?: unknown[];
  step?: string;
  failureReason?: string;
  event?: unknown;
}

async function n8nFetch(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<N8nEnvelope> {
  const timeoutMs = Number(process.env.N8N_TIMEOUT_MS ?? 45_000);

  for (let attempt = 0; attempt < 2; attempt++) {
    const envelope = await n8nFetchOnce(path, init, timeoutMs, attempt);
    if (envelope !== null) return envelope;
    if (attempt === 0) await new Promise((r) => setTimeout(r, 2000));
  }

  throw new N8nUnreachableError("N8N returned empty body for " + path);
}

async function n8nFetchOnce(
  path: string,
  init: { method?: string; body?: unknown } | undefined,
  timeoutMs: number,
  attempt: number
): Promise<N8nEnvelope | null> {
  const url = webhookUrl(path);
  const secret = process.env.N8N_WEBHOOK_SECRET;

  // #region agent log
  fetch("http://127.0.0.1:7369/ingest/1710511b-54ab-49e5-9ad2-a85aa0c54305", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "3a635b" },
    body: JSON.stringify({
      sessionId: "3a635b",
      hypothesisId: "A",
      location: "lib/n8n.ts:n8nFetch:entry",
      message: "n8nFetch start",
      data: {
        path,
        attempt,
        method: init?.method ?? "GET",
        timeoutMs,
        hasSecret: !!secret,
        bodyKeys:
          init?.body && typeof init.body === "object"
            ? Object.keys(init.body as object)
            : [],
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  let res: Response;
  try {
    res = await fetch(url, {
      method: init?.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "x-dunnly-secret": secret } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // #region agent log
    fetch("http://127.0.0.1:7369/ingest/1710511b-54ab-49e5-9ad2-a85aa0c54305", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "3a635b" },
      body: JSON.stringify({
        sessionId: "3a635b",
        hypothesisId: "D",
        location: "lib/n8n.ts:n8nFetch:network",
        message: "n8nFetch network/timeout error",
        data: {
          path,
          attempt,
          err: err instanceof Error ? err.message : String(err),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    throw new N8nUnreachableError(
      "N8N request failed (" + path + "): " + (err instanceof Error ? err.message : String(err))
    );
  }

  const rawText = await res.text();

  // #region agent log
  fetch("http://127.0.0.1:7369/ingest/1710511b-54ab-49e5-9ad2-a85aa0c54305", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "3a635b" },
    body: JSON.stringify({
      sessionId: "3a635b",
      hypothesisId: "A",
      location: "lib/n8n.ts:n8nFetch:response",
      message: "n8nFetch raw response",
      data: {
        path,
        attempt,
        status: res.status,
        ok: res.ok,
        contentType: res.headers.get("content-type"),
        bodyLen: rawText.length,
        bodyHead: rawText.slice(0, 200),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  if (!res.ok) {
    throw new N8nUnreachableError("N8N responded " + res.status + " for " + path);
  }

  if (!rawText.trim()) {
    // #region agent log
    fetch("http://127.0.0.1:7369/ingest/1710511b-54ab-49e5-9ad2-a85aa0c54305", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "3a635b" },
      body: JSON.stringify({
        sessionId: "3a635b",
        hypothesisId: "A",
        location: "lib/n8n.ts:n8nFetch:empty",
        message: "empty body — will retry",
        data: { path, attempt, status: res.status },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    return null;
  }

  try {
    return JSON.parse(rawText) as N8nEnvelope;
  } catch {
    // #region agent log
    fetch("http://127.0.0.1:7369/ingest/1710511b-54ab-49e5-9ad2-a85aa0c54305", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "3a635b" },
      body: JSON.stringify({
        sessionId: "3a635b",
        hypothesisId: "A",
        location: "lib/n8n.ts:n8nFetch:badjson",
        message: "non-JSON body",
        data: { path, attempt, bodyHead: rawText.slice(0, 120) },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    throw new N8nUnreachableError("N8N returned a non-JSON response for " + path);
  }
}

function truthy(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toUpperCase();
    return s === "TRUE" || s === "1" || s === "YES";
  }
  return false;
}

export function toInvoice(raw: unknown): Invoice {
  const r = (raw ?? {}) as Record<string, unknown>;

  const stage = STAGES.has(r.stage as Stage) ? (r.stage as Stage) : "failed";

  const classification: Classification =
    r.classification == null
      ? null
      : CLASSIFICATIONS.has(r.classification as Exclude<Classification, null>)
        ? (r.classification as Exclude<Classification, null>)
        : "no_response";

  const updatedAtMs =
    typeof r.updatedAt === "string" ? Date.parse(r.updatedAt) : Number(r.updatedAt);

  const picked = pickSupplyCredit(r);
  // Prefer n8n-derived fields; recompute if supply+credit present (safety).
  const derived = computeDaysOverdue({
    dateOfSupply: picked.dateOfSupply ?? r.dateOfSupply,
    creditDays: picked.creditDays ?? r.creditDays,
    storedDaysOverdue:
      r.daysOverdue ??
      r["Days post due date "] ??
      r["Days post due date"],
  });

  return {
    id: String(r.id ?? ""),
    customer: String(r.customer ?? ""),
    email: String(r.email ?? ""),
    phone: String(r.phone ?? "").replace(/^'/, ""),
    amountDue: Number(r.amountDue ?? 0),
    amountRemaining: Number(r.amountRemaining ?? 0),
    dateOfSupply: derived.dateOfSupply,
    creditDays: derived.creditDays,
    dueDate: derived.dueDate ?? (typeof r.dueDate === "string" ? r.dueDate : null),
    daysOverdue: derived.daysOverdue,
    stage,
    classification,
    replyText: typeof r.replyText === "string" ? r.replyText : null,
    replyChannel:
      r.replyChannel === "email" || r.replyChannel === "whatsapp" || r.replyChannel === "manual"
        ? r.replyChannel
        : null,
    failureReason: typeof r.failureReason === "string" && r.failureReason ? r.failureReason : null,
    draftEmail: typeof r.draftEmail === "string" && r.draftEmail ? r.draftEmail : null,
    draftWhatsapp: typeof r.draftWhatsapp === "string" && r.draftWhatsapp ? r.draftWhatsapp : null,
    updatedAt: Number.isFinite(updatedAtMs) ? updatedAtMs : Date.now(),
    waStatus: typeof r.waStatus === "string" && r.waStatus ? r.waStatus : null,
    waOptIn: truthy(r.waOptIn),
    waOptOut: truthy(r.waOptOut),
  };
}

export function toInboundEvent(raw: unknown): InboundEvent {
  const r = (raw ?? {}) as Record<string, unknown>;
  const kindRaw = String(r.kind || "reply");
  const kind = (["reply", "stop", "start", "help", "status"].includes(kindRaw)
    ? kindRaw
    : "reply") as InboundEvent["kind"];
  const statusRaw = String(r.status || "pending");
  const status = (["pending", "attached", "ignored"].includes(statusRaw)
    ? statusRaw
    : "pending") as InboundEvent["status"];
  const ts =
    typeof r.timestamp === "string" ? Date.parse(r.timestamp) : Number(r.timestamp);
  return {
    sid: String(r.sid ?? ""),
    timestamp: Number.isFinite(ts) ? ts : Date.now(),
    from: String(r.from ?? ""),
    body: String(r.body ?? ""),
    kind,
    suggestedInvoiceId:
      typeof r.suggestedInvoiceId === "string" && r.suggestedInvoiceId
        ? r.suggestedInvoiceId
        : null,
    attachedInvoiceId:
      typeof r.attachedInvoiceId === "string" && r.attachedInvoiceId
        ? r.attachedInvoiceId
        : null,
    status,
    messageStatus:
      typeof r.messageStatus === "string" && r.messageStatus ? r.messageStatus : null,
    channel:
      r.channel === "email" || r.channel === "whatsapp"
        ? r.channel
        : null,
  };
}

export function subjectFor(v: Invoice): string {
  return "Overdue: " + v.id + " · " + money(v.amountRemaining) + " · " + v.daysOverdue + " days";
}

export interface StepResult {
  invoice: Invoice;
  ok: boolean;
  failureReason?: string;
}

function toStepResult(body: N8nEnvelope): StepResult {
  return {
    invoice: toInvoice(body.invoice),
    ok: body.ok !== false,
    failureReason: body.failureReason,
  };
}

export async function fetchInvoicesRemote(): Promise<{
  invoices: Invoice[];
  inbound: InboundEvent[];
}> {
  const body = await n8nFetch("/dunnly/invoices", { method: "GET" });
  return {
    invoices: (body.invoices ?? []).map(toInvoice),
    inbound: (body.inbound ?? []).map(toInboundEvent),
  };
}

export async function triggerPullRemote(opts: { limit?: number; autoSend: boolean }): Promise<void> {
  await n8nFetch("/dunnly/invoices/pull", { method: "POST", body: opts });
}

export async function draftInvoiceRemote(
  invoiceId: string,
  mode: "draft" | "redraft" | "save",
  edits?: { emailBody?: string; waBody?: string }
): Promise<StepResult> {
  const body = await n8nFetch("/dunnly/invoices/draft", {
    method: "POST",
    body: { invoiceId, mode, ...edits },
  });
  return toStepResult(body);
}

export async function sendInvoiceRemote(
  invoiceId: string,
  opts: {
    emailBody?: string;
    waBody?: string;
    isRetry: boolean;
    waProvider?: string;
    waMode?: string;
  }
): Promise<StepResult> {
  // #region agent log
  fetch("http://127.0.0.1:7369/ingest/1710511b-54ab-49e5-9ad2-a85aa0c54305", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "725e23" },
    body: JSON.stringify({
      sessionId: "725e23",
      runId: "pre-fix",
      hypothesisId: "C",
      location: "lib/n8n.ts:sendInvoiceRemote",
      message: "n8n send payload (draft passed but Twilio uses template params)",
      data: {
        invoiceId,
        waProvider: opts.waProvider ?? "twilio",
        waMode: opts.waMode ?? process.env.WA_MODE ?? "live",
        waBodyLen: opts.waBody ? opts.waBody.length : 0,
        waBodyPreview: opts.waBody ? opts.waBody.slice(0, 100) : null,
        note: "dunnly-send Build WA payload (Twilio) ignores draft for live sandbox Body; fills Order Notifications slots",
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  const body = await n8nFetch("/dunnly/invoices/send", {
    method: "POST",
    body: {
      invoiceId,
      emailBody: opts.emailBody,
      waBody: opts.waBody,
      isRetry: opts.isRetry,
      waProvider: opts.waProvider ?? "twilio",
      waMode: opts.waMode ?? process.env.WA_MODE ?? "live",
      adminPhoneDigits: (process.env.ADMIN_PHONE || "").replace(/\D/g, "") || "916001507395",
    },
  });
  return toStepResult(body);
}

export async function classifyReplyRemote(invoiceId: string, replyText: string): Promise<StepResult> {
  const body = await n8nFetch("/dunnly/invoices/classify", {
    method: "POST",
    body: { invoiceId, replyText, source: "manual" },
  });
  return toStepResult(body);
}

export async function attachInboundRemote(
  sid: string,
  invoiceId: string
): Promise<{ ok: boolean; event?: InboundEvent; invoice?: Invoice }> {
  const body = await n8nFetch("/dunnly/inbound/attach", {
    method: "POST",
    body: { sid, invoiceId },
  });
  return {
    ok: body.ok !== false,
    event: body.event ? toInboundEvent(body.event) : undefined,
    invoice: body.invoice ? toInvoice(body.invoice) : undefined,
  };
}

export async function ignoreInboundRemote(sid: string): Promise<{ ok: boolean; event?: InboundEvent }> {
  const body = await n8nFetch("/dunnly/inbound/ignore", {
    method: "POST",
    body: { sid },
  });
  return {
    ok: body.ok !== false,
    event: body.event ? toInboundEvent(body.event) : undefined,
  };
}
