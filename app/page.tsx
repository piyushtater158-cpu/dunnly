"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Classification, InboundEvent, Invoice, Stage } from "@/lib/store";

const WA_DEMO_INVOICE_ID = "INV-24245";

const STAGES: Stage[] = ["queued", "drafted", "sent", "replied", "classified", "notified"];

const CLS: Record<
  string,
  { label: string; bg: string; fg: string; border: string }
> = {
  paid: { label: "PAID", bg: "#111110", fg: "#f2f1ec", border: "#111110" },
  promise: { label: "PROMISE", bg: "#f0c14b", fg: "#111110", border: "#111110" },
  dispute: { label: "DISPUTE", bg: "#b8390e", fg: "#f2f1ec", border: "#b8390e" },
  no_response: { label: "NO REPLY", bg: "transparent", fg: "#55524a", border: "#b1ada1" },
  none: { label: "—", bg: "transparent", fg: "#a5a199", border: "transparent" },
};

type TabKey = "action" | "flight" | "done" | "failed" | "inbound" | "all";

const needsReview = (v: Invoice) => v.stage === "drafted" || v.stage === "queued";
const isFailed = (v: Invoice) => v.stage === "failed";
const inFlight = (v: Invoice) => v.stage === "sent" || v.stage === "replied";
const isDone = (v: Invoice) => v.stage === "classified" || v.stage === "notified";

const TAB_DEFS: { key: TabKey; label: string; test: (v: Invoice) => boolean }[] = [
  { key: "action", label: "NEEDS REVIEW", test: needsReview },
  { key: "flight", label: "IN FLIGHT", test: inFlight },
  { key: "done", label: "CLASSIFIED", test: isDone },
  { key: "failed", label: "FAILED", test: isFailed },
  { key: "inbound", label: "INBOUND", test: () => false },
  { key: "all", label: "ALL", test: () => true },
];

function money(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ago(ms: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  return Math.round(mins / 60) + "h ago";
}

// Local fallbacks matching lib/store.ts's templates — only used when a
// queued invoice has no persisted draftEmail/draftWhatsapp yet.
function defaultEmail(v: Invoice): string {
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

function defaultWa(v: Invoice): string {
  // Same AR collections objective as email: overdue + amount + pay CTA.
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

function teamsNotifyLine(v: Invoice): string | null {
  if (v.classification === "dispute") {
    return v.daysOverdue >= 60
      ? "Teams notified · #ar-disputes (" + v.daysOverdue + "d overdue) · Dunnly"
      : "Teams notified · #ar-disputes · Dunnly";
  }
  if (v.classification === "promise" || v.classification === "paid") {
    return "Teams notified · #ar-payments · Dunnly";
  }
  if (v.classification === "no_response") {
    return "Teams notified · #ar-escalations · Dunnly";
  }
  return null;
}

function buildLog(v: Invoice): string[] {
  const lines: string[] = [];
  const cur = STAGES.indexOf(v.stage);
  if (v.stage !== "queued") lines.push("n8n draft generated (openai/gpt-4o-mini via OpenRouter) · email + whatsapp");
  if ((cur >= 2 || isFailed(v)) && !isFailed(v)) {
    lines.push("Email sent via Power Automate Gmail · logged to send_log");
  }
  if (v.waStatus) lines.push("WhatsApp status · " + v.waStatus);
  if (v.waOptOut) lines.push("WA opt-out · STOP received (or manual flag)");
  if (isFailed(v)) lines.push("FAILED · " + (v.failureReason || "unknown error"));
  if (v.replyText != null) {
    const via =
      v.replyChannel === "email"
        ? "email"
        : v.replyChannel === "whatsapp"
          ? "WhatsApp"
          : v.replyChannel === "manual"
            ? "manual paste"
            : v.id === WA_DEMO_INVOICE_ID
              ? "WhatsApp"
              : "inbound";
    lines.push("inbound reply captured via " + via);
  }
  if (v.classification) lines.push("classification written back: " + v.classification);
  const teamsLine = teamsNotifyLine(v);
  if (teamsLine) lines.push(teamsLine);
  if (!lines.length) lines.push("queued from AR ledger · awaiting draft");
  return lines;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (!res.ok) throw new Error("request failed: " + res.status);
  return res.json() as Promise<T>;
}

export default function PipelineDashboard() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [inbound, setInbound] = useState<InboundEvent[]>([]);
  const [autoSend, setAutoSend] = useState(false);
  const [tab, setTab] = useState<TabKey>("action");
  const [open, setOpen] = useState<string | null>(null);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [emailEdits, setEmailEdits] = useState<Record<string, string>>({});
  const [waEdits, setWaEdits] = useState<Record<string, string>>({});
  const [inflight, setInflight] = useState<Record<string, boolean>>({});
  const [outage, setOutage] = useState(false);
  const [streamLive, setStreamLive] = useState(false);

  const flag = useCallback((key: string, on: boolean) => {
    setInflight((s) => ({ ...s, [key]: on }));
  }, []);

  const loadInvoices = useCallback(async () => {
    try {
      const data = await fetchJson<{ invoices: Invoice[]; inbound?: InboundEvent[] }>("/api/invoices");
      setInvoices(data.invoices);
      setInbound(data.inbound ?? []);
      setOutage(false);
    } catch {
      setOutage(true);
    }
  }, []);

  useEffect(() => {
    fetchJson<{ autoSend: boolean }>("/api/config")
      .then((d) => setAutoSend(!!d.autoSend))
      .catch(() => {});
    loadInvoices();
  }, [loadInvoices]);

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      es = new EventSource("/api/invoices/stream");

      es.addEventListener("ledger", (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as {
            invoices: Invoice[];
            inbound?: InboundEvent[];
          };
          if (Array.isArray(data.invoices)) {
            setInvoices(data.invoices);
            setInbound(data.inbound ?? []);
            setOutage(false);
            setStreamLive(true);
          }
        } catch {
          /* ignore malformed frame */
        }
      });

      es.onopen = () => {
        setStreamLive(true);
      };

      es.onerror = () => {
        setStreamLive(false);
        es?.close();
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, 3_000);
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, []);

  const applyInvoice = useCallback((updated?: Invoice) => {
    if (!updated) return;
    setInvoices((s) => (s ? s.map((v) => (v.id === updated.id ? updated : v)) : s));
  }, []);

  async function pull() {
    if (inflight["pull"]) return;
    flag("pull", true);
    try {
      const data = await fetchJson<{ invoices: Invoice[]; inbound?: InboundEvent[] }>("/api/invoices/pull", {
        method: "POST",
      });
      setInvoices(data.invoices);
      if (data.inbound) setInbound(data.inbound);
      setOutage(false);
    } catch {
      setOutage(true);
    } finally {
      flag("pull", false);
    }
  }

  async function attachInbound(sid: string, invoiceId: string) {
    const key = "attach:" + sid;
    if (inflight[key]) return;
    flag(key, true);
    try {
      const data = await fetchJson<{ invoice?: Invoice }>(`/api/inbound/${encodeURIComponent(sid)}/attach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId }),
      });
      if (data.invoice) applyInvoice(data.invoice);
      await loadInvoices();
      setOutage(false);
    } catch {
      setOutage(true);
    } finally {
      flag(key, false);
    }
  }

  async function ignoreInboundEvent(sid: string) {
    const key = "ignore:" + sid;
    if (inflight[key]) return;
    flag(key, true);
    try {
      await fetchJson(`/api/inbound/${encodeURIComponent(sid)}/ignore`, { method: "POST" });
      await loadInvoices();
      setOutage(false);
    } catch {
      setOutage(true);
    } finally {
      flag(key, false);
    }
  }

  async function send(id: string) {
    if (inflight[id + ":send"]) return;
    flag(id + ":send", true);
    try {
      const inv = invoices?.find((v) => v.id === id);
      const stageIdx = inv ? STAGES.indexOf(inv.stage) : -1;
      const isRetry =
        !!inv &&
        (stageIdx >= 2 ||
          inv.stage === "failed" ||
          String(inv.waStatus || "").startsWith("skipped"));
      const data = await fetchJson<{ invoice: Invoice }>(`/api/invoices/${id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRetry }),
      });
      applyInvoice(data.invoice);
      setOutage(false);
    } catch (err) {
      // #region agent log
      fetch("http://127.0.0.1:7369/ingest/1710511b-54ab-49e5-9ad2-a85aa0c54305", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "3a635b" },
        body: JSON.stringify({
          sessionId: "3a635b",
          hypothesisId: "A",
          location: "app/page.tsx:send:catch",
          message: "UI send failed → outage banner",
          data: { id, err: err instanceof Error ? err.message : String(err) },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      setOutage(true);
    } finally {
      flag(id + ":send", false);
    }
  }

  async function retry(id: string) {
    if (inflight[id + ":retry"]) return;
    flag(id + ":retry", true);
    try {
      const data = await fetchJson<{ invoice: Invoice }>(`/api/invoices/${id}/retry`, {
        method: "POST",
      });
      applyInvoice(data.invoice);
      setOutage(false);
    } catch {
      setOutage(true);
    } finally {
      flag(id + ":retry", false);
    }
  }

  async function redraft(id: string) {
    if (inflight[id + ":redraft"]) return;
    flag(id + ":redraft", true);
    try {
      const data = await fetchJson<{ invoice: Invoice }>(`/api/invoices/${id}/redraft`, {
        method: "POST",
      });
      applyInvoice(data.invoice);
      setEmailEdits((s) => ({ ...s, [id]: data.invoice.draftEmail ?? "" }));
      setWaEdits((s) => ({ ...s, [id]: data.invoice.draftWhatsapp ?? "" }));
      setOutage(false);
    } catch {
      setOutage(true);
    } finally {
      flag(id + ":redraft", false);
    }
  }

  function saveDraft(id: string, fields: { emailBody?: string; waBody?: string }) {
    fetchJson(`/api/invoices/${id}/draft`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    }).catch(() => setOutage(true));
  }

  async function submitReply(id: string) {
    if (inflight[id + ":reply"]) return;
    const text = replies[id] ?? "";
    flag(id + ":reply", true);
    try {
      // #region agent log
      fetch("http://127.0.0.1:7369/ingest/1710511b-54ab-49e5-9ad2-a85aa0c54305", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "725e23" },
        body: JSON.stringify({
          sessionId: "725e23",
          runId: "pre-fix",
          hypothesisId: "E",
          location: "app/page.tsx:submitReply",
          message: "UI submitReply clicked",
          data: { id, textLen: text.length },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      const data = await fetchJson<{ invoice: Invoice }>(`/api/invoices/${id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      // #region agent log
      fetch("http://127.0.0.1:7369/ingest/1710511b-54ab-49e5-9ad2-a85aa0c54305", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "725e23" },
        body: JSON.stringify({
          sessionId: "725e23",
          runId: "pre-fix",
          hypothesisId: "A",
          location: "app/page.tsx:submitReply:ok",
          message: "UI submitReply got invoice",
          data: {
            id,
            invoiceId: data.invoice?.id,
            stage: data.invoice?.stage,
            classification: data.invoice?.classification,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      applyInvoice(data.invoice);
      setOutage(false);
    } catch (err) {
      // #region agent log
      fetch("http://127.0.0.1:7369/ingest/1710511b-54ab-49e5-9ad2-a85aa0c54305", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "725e23" },
        body: JSON.stringify({
          sessionId: "725e23",
          runId: "pre-fix",
          hypothesisId: "D",
          location: "app/page.tsx:submitReply:catch",
          message: "UI submitReply failed",
          data: { id, err: err instanceof Error ? err.message : String(err) },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      setOutage(true);
    } finally {
      flag(id + ":reply", false);
    }
  }

  const active = TAB_DEFS.find((t) => t.key === tab) || TAB_DEFS[0];
  const pendingInbound = inbound.filter((e) => e.status === "pending");

  const rows = useMemo(() => {
    if (!invoices) return [];
    if (tab === "inbound") return [];
    const risk = (v: Invoice) =>
      (v.classification === "dispute" ? 400 : 0) +
      (isFailed(v) ? 300 : 0) +
      (v.classification === "promise" ? 120 : 0) +
      (needsReview(v) ? 60 : 0) +
      (v.id === WA_DEMO_INVOICE_ID ? 50 : 0) +
      v.daysOverdue / 100;
    return invoices
      .filter((v) => active.test(v) || v.id === open)
      .slice()
      .sort((a, b) => risk(b) - risk(a));
  }, [invoices, active, open, tab]);

  if (!invoices) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#f2f1ec",
          color: "#55524a",
          padding: "44px 24px",
          textAlign: "center",
          fontSize: 12,
          letterSpacing: "0.1em",
        }}
      >
        LOADING DUNNLY PIPELINE…
      </div>
    );
  }

  const disputes = invoices.filter((v) => v.classification === "dispute").length;
  const promises = invoices.filter((v) => v.classification === "promise").length;
  const failedN = invoices.filter(isFailed).length;
  const outstanding = invoices.reduce((a, v) => a + v.amountRemaining, 0);

  const stats = [
    { label: "OPEN OVERDUE", value: invoices.length, note: money(outstanding) + " outstanding" },
    { label: "DISPUTES", value: disputes, note: "AM notified on all" },
    { label: "PROMISES TO PAY", value: promises, note: "dates on record" },
    { label: "FAILED STAGES", value: failedN, note: failedN ? "needs manual retry" : "pipeline clean" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#f2f1ec", color: "#111110", padding: "0 0 64px 0" }}>
      <style jsx>{`
        .dunnly-row:hover {
          background: #e6e3da;
        }
        .dunnly-pull-btn:hover {
          background: #b8390e;
          border-color: #b8390e;
        }
        @keyframes dunnly-pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.25;
          }
        }
      `}</style>

      {outage && (
        <div
          style={{
            background: "#111110",
            color: "#f2f1ec",
            padding: "9px 24px",
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontSize: 12,
            letterSpacing: "0.06em",
            borderBottom: "2px solid #b8390e",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              background: "#b8390e",
              animation: "dunnly-pulse 1.1s steps(2, end) infinite",
              display: "inline-block",
            }}
          />
          <span style={{ fontWeight: 700 }}>CAN&apos;T REACH THE AUTOMATION BACKEND — RETRYING</span>
          <span style={{ opacity: 0.55 }}>/api/invoices failed · SSE reconnecting</span>
        </div>
      )}

      <header
        style={{
          borderBottom: "2px solid #111110",
          padding: "18px 24px 14px 24px",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 24,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>DUNNLY</div>
          <div style={{ fontSize: 12, letterSpacing: "0.14em", paddingBottom: 2 }}>
            AR PIPELINE / OVERDUE
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, letterSpacing: "0.06em" }}>
          <span style={{ border: "1px solid #111110", padding: "4px 8px" }}>
            {autoSend ? "AUTO_SEND=TRUE" : "AUTO_SEND=FALSE"}
          </span>
          <span
            style={{
              border: "1px solid " + (streamLive ? "#111110" : "#b1ada1"),
              color: streamLive ? "#111110" : "#55524a",
              padding: "4px 8px",
            }}
          >
            {streamLive ? "LIVE · PUSH SYNC" : "SSE CONNECTING"}
          </span>
          <button
            onClick={pull}
            disabled={!!inflight["pull"]}
            className="dunnly-pull-btn"
            style={{
              border: "1px solid #111110",
              background: "#111110",
              color: "#f2f1ec",
              padding: "5px 12px",
              fontSize: 11,
              letterSpacing: "0.08em",
              fontWeight: 700,
              cursor: inflight["pull"] ? "not-allowed" : "pointer",
              borderRadius: 0,
            }}
          >
            {inflight["pull"] ? "PULLING…" : "RUN PULL"}
          </button>
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", borderBottom: "2px solid #111110" }}>
        {stats.map((s) => (
          <div
            key={s.label}
            style={{
              padding: "14px 20px",
              borderRight: "1px solid #d5d2c8",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div style={{ fontSize: 10.5, letterSpacing: "0.12em", color: "#55524a" }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>{s.value}</div>
            <div style={{ fontSize: 10.5, letterSpacing: "0.04em", color: "#55524a" }}>{s.note}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "stretch", borderBottom: "1px solid #111110", overflowX: "auto" }}>
        {TAB_DEFS.map((t) => {
          const count =
            t.key === "inbound"
              ? pendingInbound.length
              : invoices.filter(t.test).length;
          const isActive = t.key === active.key;
          return (
            <button
              key={t.key}
              onClick={() => {
                setTab(t.key);
                setOpen(null);
              }}
              style={{
                border: 0,
                borderRight: "1px solid #d5d2c8",
                padding: "10px 18px",
                fontSize: 11,
                letterSpacing: "0.1em",
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
                background: isActive ? "#111110" : "transparent",
                color: isActive ? "#f2f1ec" : "#55524a",
              }}
            >
              {t.label} · {count}
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "108px minmax(160px, 1fr) 116px 116px 58px 214px 128px 78px 20px",
          gap: 14,
          padding: "8px 24px",
          fontSize: 10,
          letterSpacing: "0.12em",
          color: "#55524a",
          borderBottom: "1px solid #d5d2c8",
          background: "#eae8e1",
        }}
      >
        <div>INVOICE</div>
        <div>CUSTOMER</div>
        <div style={{ textAlign: "right" }}>AMOUNT DUE</div>
        <div style={{ textAlign: "right" }}>REMAINING</div>
        <div style={{ textAlign: "right" }}>AGE</div>
        <div>PIPELINE</div>
        <div>REPLY</div>
        <div style={{ textAlign: "right" }}>UPDATED</div>
        <div />
      </div>

      {tab === "inbound" && (
        <div style={{ borderBottom: "1px solid #d5d2c8" }}>
          {pendingInbound.length === 0 && (
            <div style={{ padding: "44px 24px", textAlign: "center", fontSize: 12, letterSpacing: "0.1em", color: "#55524a" }}>
              NO PENDING INBOUND EVENTS — DEMO REPLIES AUTO-ATTACH TO PIYUSH TATER DEMO CO (INV-24245)
            </div>
          )}
          {pendingInbound.map((ev) => (
            <div
              key={ev.sid}
              style={{
                borderBottom: "1px solid #d5d2c8",
                padding: "14px 24px",
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 16,
                alignItems: "start",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 10.5, letterSpacing: "0.12em", fontWeight: 700 }}>
                  {ev.kind.toUpperCase()}
                  {ev.channel ? " · " + ev.channel.toUpperCase() : ""} · {ev.from} · {ago(ev.timestamp)}
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                  {ev.body || "(empty)"}
                </div>
                <div style={{ fontSize: 11, color: "#55524a" }}>
                  {ev.suggestedInvoiceId
                    ? "suggested · " + ev.suggestedInvoiceId
                    : "no suggested invoice"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {ev.suggestedInvoiceId && (
                  <button
                    onClick={() => attachInbound(ev.sid, ev.suggestedInvoiceId!)}
                    disabled={!!inflight["attach:" + ev.sid]}
                    style={{
                      border: "1px solid #111110",
                      background: "#111110",
                      color: "#f2f1ec",
                      padding: "8px 12px",
                      fontSize: 11,
                      letterSpacing: "0.08em",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    ATTACH · {ev.suggestedInvoiceId}
                  </button>
                )}
                <button
                  onClick={() => ignoreInboundEvent(ev.sid)}
                  disabled={!!inflight["ignore:" + ev.sid]}
                  style={{
                    border: "1px solid #111110",
                    background: "transparent",
                    color: "#111110",
                    padding: "8px 12px",
                    fontSize: 11,
                    letterSpacing: "0.08em",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  IGNORE
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab !== "inbound" && rows.map((v) => {
        const rowOpen = open === v.id;
        const cur = STAGES.indexOf(v.stage);
        const failAt = isFailed(v) ? 2 : -1;
        const segments = STAGES.map((name, i) => {
          let bg = "transparent";
          let border = "#b1ada1";
          if (isFailed(v)) {
            if (i < failAt) {
              bg = "#111110";
              border = "#111110";
            } else if (i === failAt) {
              bg = "#b8390e";
              border = "#b8390e";
            }
          } else if (i < cur) {
            bg = "#111110";
            border = "#111110";
          } else if (i === cur) {
            bg = "#f0c14b";
            border = "#111110";
          }
          return { bg, border, title: name.toUpperCase() };
        });
        const c = CLS[v.classification || "none"];
        const sending = !!inflight[v.id + ":send"];
        const replying = !!inflight[v.id + ":reply"];
        const retrying = !!inflight[v.id + ":retry"];
        const redrafting = !!inflight[v.id + ":redraft"];
        const sent = cur >= 2 || isFailed(v);
        const locked = sending;
        const emailValue = emailEdits[v.id] ?? v.draftEmail ?? defaultEmail(v);
        const waValue = waEdits[v.id] ?? v.draftWhatsapp ?? defaultWa(v);
        const replyDraft = replies[v.id] ?? "";
        const log = buildLog(v);

        return (
          <div key={v.id} style={{ borderBottom: "1px solid #d5d2c8", background: rowOpen ? "#eae8e1" : "transparent" }}>
            <div
              onClick={() => setOpen(rowOpen ? null : v.id)}
              className="dunnly-row"
              style={{
                display: "grid",
                gridTemplateColumns: "108px minmax(160px, 1fr) 116px 116px 58px 214px 128px 78px 20px",
                gap: 14,
                padding: "9px 24px",
                alignItems: "center",
                fontSize: 12.5,
                cursor: "pointer",
              }}
            >
              <div style={{ letterSpacing: "0.02em", color: "#55524a" }}>{v.id}</div>
              <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {v.customer}
                {v.id === WA_DEMO_INVOICE_ID && (
                  <span style={{ marginLeft: 8, fontSize: 10, letterSpacing: "0.08em", fontWeight: 700, color: "#b8390e" }}>
                    WA DEMO
                  </span>
                )}
                {v.email && (
                  <div style={{ fontSize: 10.5, color: "#55524a", fontWeight: 400, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {v.email}
                    {v.waOptOut ? " · WA OPTED OUT" : v.waStatus ? " · WA " + v.waStatus.toUpperCase() : ""}
                  </div>
                )}
              </div>
              <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(v.amountDue)}</div>
              <div
                style={{
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                  color: v.amountRemaining < v.amountDue ? "#b8390e" : "#111110",
                }}
              >
                {money(v.amountRemaining)}
              </div>
              <div
                style={{
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 700,
                  color: v.daysOverdue >= 60 ? "#b8390e" : "#111110",
                }}
              >
                {v.daysOverdue}d
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ display: "flex", gap: 2 }}>
                  {segments.map((g, i) => (
                    <div
                      key={i}
                      title={g.title}
                      style={{ width: 17, height: 11, border: "1px solid " + g.border, background: g.bg }}
                    />
                  ))}
                </div>
                <div style={{ fontSize: 10.5, letterSpacing: "0.08em", fontWeight: 700, color: isFailed(v) ? "#b8390e" : "#33312c" }}>
                  {isFailed(v) ? "FAILED" : v.stage.toUpperCase()}
                </div>
              </div>
              <div>
                <span
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.1em",
                    fontWeight: 700,
                    padding: "3px 7px",
                    border: "1px solid " + c.border,
                    background: c.bg,
                    color: c.fg,
                  }}
                >
                  {c.label}
                </span>
              </div>
              <div style={{ textAlign: "right", fontSize: 11, color: "#55524a" }}>{ago(v.updatedAt)}</div>
              <div style={{ textAlign: "right", fontSize: 11, color: "#55524a" }}>{rowOpen ? "–" : "+"}</div>
            </div>

            {rowOpen && (
              <div style={{ borderTop: "1px solid #111110", background: "#eae8e1", padding: "18px 24px 22px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
                {isFailed(v) && (
                  <div
                    style={{
                      border: "2px solid #b8390e",
                      background: "#f7e4dd",
                      padding: "12px 14px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 16,
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <div style={{ fontSize: 10.5, letterSpacing: "0.12em", fontWeight: 700, color: "#b8390e" }}>
                        STAGE FAILED
                      </div>
                      <div style={{ fontSize: 12.5 }}>{v.failureReason}</div>
                    </div>
                    <button
                      onClick={() => retry(v.id)}
                      disabled={retrying}
                      style={{
                        border: "1px solid #b8390e",
                        background: "#b8390e",
                        color: "#f2f1ec",
                        padding: "7px 14px",
                        fontSize: 11,
                        letterSpacing: "0.1em",
                        fontWeight: 700,
                        cursor: retrying ? "not-allowed" : "pointer",
                      }}
                    >
                      {retrying ? "RETRYING…" : "RETRY STEP"}
                    </button>
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div style={{ border: "1px solid #111110", background: "#f2f1ec", display: "flex", flexDirection: "column" }}>
                    <div
                      style={{
                        borderBottom: "1px solid #111110",
                        padding: "8px 12px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontSize: 10.5,
                        letterSpacing: "0.12em",
                        fontWeight: 700,
                      }}
                    >
                      <span>DRAFT · EMAIL (GMAIL · PA)</span>
                      <span style={{ color: "#55524a", fontWeight: 400 }}>
                        {sent ? "SENT — READ ONLY" : autoSend ? "AUTO-SEND ARMED" : "AWAITING APPROVAL"}
                      </span>
                    </div>
                    <div style={{ padding: "10px 12px", borderBottom: "1px dashed #c9c5ba", fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                      <div>
                        <span style={{ color: "#55524a" }}>SUBJ&nbsp;&nbsp;</span>
                        {"Overdue: " + v.id + " · " + money(v.amountRemaining) + " · " + v.daysOverdue + " days"}
                      </div>
                      <div style={{ color: "#55524a", fontSize: 11 }}>
                        SUPPLY {v.dateOfSupply || "—"} · CREDIT {v.creditDays != null ? v.creditDays + "d" : "—"} · DUE {v.dueDate || "—"}
                      </div>
                    </div>
                    <textarea
                      value={emailValue}
                      onChange={(e) => setEmailEdits((s) => ({ ...s, [v.id]: e.target.value }))}
                      onBlur={(e) => saveDraft(v.id, { emailBody: e.target.value })}
                      readOnly={locked}
                      spellCheck={false}
                      style={{
                        border: 0,
                        background: "transparent",
                        padding: "10px 12px",
                        minHeight: 148,
                        resize: "vertical",
                        fontSize: 12,
                        lineHeight: 1.55,
                        color: "#111110",
                        outline: "none",
                      }}
                    />
                  </div>
                  <div style={{ border: "1px solid #111110", background: "#f2f1ec", display: "flex", flexDirection: "column" }}>
                    <div
                      style={{
                        borderBottom: "1px solid #111110",
                        padding: "8px 12px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontSize: 10.5,
                        letterSpacing: "0.12em",
                        fontWeight: 700,
                      }}
                    >
                      <span>DRAFT · WHATSAPP</span>
                      <span style={{ color: "#55524a", fontWeight: 400 }}>{waValue.length}/1024 CHARS</span>
                    </div>
                    <div style={{ padding: "10px 12px", borderBottom: "1px dashed #c9c5ba", fontSize: 12 }}>
                      <span style={{ color: "#55524a" }}>TO&nbsp;&nbsp;&nbsp;&nbsp;</span>
                      {v.phone}
                    </div>
                    <textarea
                      value={waValue}
                      onChange={(e) => setWaEdits((s) => ({ ...s, [v.id]: e.target.value }))}
                      onBlur={(e) => saveDraft(v.id, { waBody: e.target.value })}
                      readOnly={locked}
                      spellCheck={false}
                      style={{
                        border: 0,
                        background: "transparent",
                        padding: "10px 12px",
                        minHeight: 148,
                        resize: "vertical",
                        fontSize: 12,
                        lineHeight: 1.55,
                        color: "#111110",
                        outline: "none",
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <button
                    onClick={() => send(v.id)}
                    disabled={locked}
                    style={{
                      border: "1px solid #111110",
                      background: locked ? "transparent" : "#111110",
                      color: locked ? "#a5a199" : "#f2f1ec",
                      padding: "9px 16px",
                      fontSize: 11,
                      letterSpacing: "0.1em",
                      fontWeight: 700,
                      cursor: locked ? "not-allowed" : "pointer",
                    }}
                  >
                    {sending
                      ? "SENDING…"
                      : sent
                        ? v.waStatus &&
                          (String(v.waStatus).startsWith("skipped") ||
                            String(v.waStatus).startsWith("failed") ||
                            String(v.waStatus) === "undelivered")
                          ? String(v.waStatus).startsWith("skipped")
                            ? "EMAIL SENT · WA SKIPPED"
                            : "EMAIL OK · WA FAILED"
                          : v.waStatus === "accepted" ||
                              v.waStatus === "dryrun" ||
                              v.waStatus === "delivered" ||
                              v.waStatus === "read" ||
                              v.waStatus === "sent"
                            ? "EMAIL + WA SENT"
                            : v.waStatus === "queued" || v.waStatus === "sending"
                              ? "EMAIL SENT · WA QUEUED"
                              : "RESEND EMAIL + WA"
                        : autoSend
                          ? "SEND NOW"
                          : "APPROVE & SEND"}
                  </button>
                  <button
                    onClick={() => redraft(v.id)}
                    disabled={locked || redrafting}
                    style={{
                      border: "1px solid #111110",
                      background: "transparent",
                      color: "#111110",
                      padding: "9px 16px",
                      fontSize: 11,
                      letterSpacing: "0.1em",
                      fontWeight: 700,
                      cursor: locked || redrafting ? "not-allowed" : "pointer",
                    }}
                  >
                    {redrafting ? "REDRAFTING…" : "REDRAFT"}
                  </button>
                  <div style={{ fontSize: 11, color: "#55524a", letterSpacing: "0.04em" }}>
                    {autoSend ? "AUTO_SEND=true — n8n sends without review" : "AUTO_SEND=false — nothing leaves without your approval"}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div style={{ border: "1px solid #c9c5ba", background: "#f2f1ec", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 10.5, letterSpacing: "0.12em", fontWeight: 700 }}>SEND LOG</div>
                    <div style={{ fontSize: 11, color: "#55524a" }}>last event {ago(v.updatedAt)}</div>
                    <div style={{ fontSize: 11.5, lineHeight: 1.9, whiteSpace: "pre-line", color: "#33312c" }}>
                      {log.map((l) => "· " + l).join("\n")}
                    </div>
                  </div>

                  <div style={{ border: "1px solid #c9c5ba", background: "#f2f1ec", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ fontSize: 10.5, letterSpacing: "0.12em", fontWeight: 700 }}>
                      MANUAL PASTE REPLY · {v.id}
                    </div>
                    <textarea
                      value={replyDraft}
                      onChange={(e) => setReplies((s) => ({ ...s, [v.id]: e.target.value }))}
                      placeholder="Paste or type the customer's reply text…"
                      spellCheck={false}
                      style={{
                        border: "1px solid #c9c5ba",
                        background: "#f8f7f3",
                        padding: "9px 10px",
                        minHeight: 66,
                        resize: "vertical",
                        fontSize: 12,
                        lineHeight: 1.5,
                        color: "#111110",
                        outline: "none",
                      }}
                    />
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <button
                        onClick={() => submitReply(v.id)}
                        disabled={replying || !sent}
                        style={{
                          border: "1px solid #111110",
                          background: replying || !sent ? "transparent" : "#111110",
                          color: replying || !sent ? "#a5a199" : "#f2f1ec",
                          padding: "8px 14px",
                          fontSize: 11,
                          letterSpacing: "0.1em",
                          fontWeight: 700,
                          cursor: replying || !sent ? "not-allowed" : "pointer",
                        }}
                      >
                        {replying ? "CLASSIFYING…" : !sent ? "SEND FIRST" : "SUBMIT REPLY"}
                      </button>
                      <span style={{ fontSize: 10.5, color: "#55524a" }}>SCOPED TO THIS INVOICE ONLY</span>
                    </div>
                    {v.replyText != null && (
                      <div style={{ borderTop: "1px dashed #d5d2c8", paddingTop: 9, display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ fontSize: 12, lineHeight: 1.55, color: "#33312c" }}>
                          &ldquo;
                          {v.replyText === ""
                            ? "no reply received within 7 days — auto-closed by n8n"
                            : v.replyText}
                          &rdquo;
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 10.5, letterSpacing: "0.08em" }}>
                          <span style={{ fontWeight: 700, padding: "3px 7px", border: "1px solid " + c.border, background: c.bg, color: c.fg }}>
                            CLASSIFIED · {c.label}
                          </span>
                          <span style={{ color: "#55524a" }}>
                            {v.classification ? "written back to mock_ar.csv · " + ago(v.updatedAt) : "write-back pending"}
                          </span>
                        </div>
                        <div style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 8 }}>
                          <span
                            style={{
                              width: 7,
                              height: 7,
                              background:
                                teamsNotifyLine(v)
                                  ? "#111110"
                                  : "#b1ada1",
                              display: "inline-block",
                            }}
                          />
                          <span>
                            {teamsNotifyLine(v)
                              ? teamsNotifyLine(v) + " · AM R. Oyelaran"
                              : "No AM notification required for this classification"}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {tab !== "inbound" && rows.length === 0 && (
        <div style={{ padding: "44px 24px", textAlign: "center", fontSize: 12, letterSpacing: "0.1em", color: "#55524a" }}>
          NO INVOICES IN THIS VIEW
        </div>
      )}

      <div
        style={{
          padding: "14px 24px",
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          fontSize: 10.5,
          letterSpacing: "0.06em",
          color: "#55524a",
          flexWrap: "wrap",
        }}
      >
        <span>
          {tab === "inbound"
            ? `PENDING INBOUND · ${pendingInbound.length}`
            : `SHOWING ${rows.length} OF ${invoices.length} INVOICES · ${active.label}`}
        </span>
        <span>
          LEDGER Google Sheets · WA DEMO {WA_DEMO_INVOICE_ID} · ORCHESTRATION n8n via /api/* · NO WEBHOOK URL IN CLIENT
        </span>
      </div>
    </div>
  );
}
