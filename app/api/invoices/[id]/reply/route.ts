import { NextResponse } from "next/server";
import { classify, findInvoice, patch, sleep } from "@/lib/store";
import { N8nUnreachableError, classifyReplyRemote, isMock } from "@/lib/n8n";

export const maxDuration = 90;

// Simulates an inbound customer reply, scoped to exactly one invoice (see
// design doc "Reply-to-invoice mapping") — this app never solves reply-to-
// invoice correlation from an external channel; the AR owner supplies the
// text against a known row. Calls N8N's dunnly-classify webhook, which
// writes stage:"replied" BEFORE its LLM call so a slow/failed classify
// still leaves a truthful row rather than a stale "sent" one.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let text = "";
  try {
    const body = await req.json();
    text = typeof body?.text === "string" ? body.text : "";
  } catch {
    // no body — treat as no reply / silence
  }

  if (isMock()) {
    if (!findInvoice(id)) {
      return NextResponse.json({ error: "invoice not found" }, { status: 404 });
    }
    patch(id, { stage: "replied", replyText: text, replyChannel: "manual" });
    await sleep(1500);
    const cls = classify(text);
    const nextStage =
      cls === "dispute" || cls === "promise" || cls === "paid" ? "notified" : "classified";
    const updated = patch(id, { classification: cls, stage: nextStage });
    return NextResponse.json({ invoice: updated });
  }

  try {
    // #region agent log
    fetch("http://127.0.0.1:7369/ingest/1710511b-54ab-49e5-9ad2-a85aa0c54305", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "725e23" },
      body: JSON.stringify({
        sessionId: "725e23",
        runId: "pre-fix",
        hypothesisId: "A",
        location: "app/api/invoices/[id]/reply/route.ts:POST",
        message: "manual reply classify start",
        data: { id, textLen: text.length, textPreview: text.slice(0, 80) },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    const result = await classifyReplyRemote(id, text);
    // #region agent log
    fetch("http://127.0.0.1:7369/ingest/1710511b-54ab-49e5-9ad2-a85aa0c54305", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "725e23" },
      body: JSON.stringify({
        sessionId: "725e23",
        runId: "pre-fix",
        hypothesisId: "A",
        location: "app/api/invoices/[id]/reply/route.ts:ok",
        message: "manual reply classify result",
        data: {
          id,
          ok: result.ok,
          invoiceId: result.invoice?.id,
          stage: result.invoice?.stage,
          classification: result.invoice?.classification,
          replyPreview: result.invoice?.replyText
            ? String(result.invoice.replyText).slice(0, 80)
            : null,
          failureReason: result.failureReason || result.invoice?.failureReason || null,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    return NextResponse.json({ invoice: result.invoice });
  } catch (err) {
    // #region agent log
    fetch("http://127.0.0.1:7369/ingest/1710511b-54ab-49e5-9ad2-a85aa0c54305", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "725e23" },
      body: JSON.stringify({
        sessionId: "725e23",
        runId: "pre-fix",
        hypothesisId: "D",
        location: "app/api/invoices/[id]/reply/route.ts:catch",
        message: "manual reply classify error",
        data: {
          id,
          isUnreachable: err instanceof N8nUnreachableError,
          err: err instanceof Error ? err.message : String(err),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    if (err instanceof N8nUnreachableError) {
      return NextResponse.json({ error: "backend unreachable" }, { status: 502 });
    }
    throw err;
  }
}
