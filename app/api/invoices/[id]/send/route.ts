import { NextResponse } from "next/server";
import { findInvoice, patch, sleep, waFor } from "@/lib/store";
import { N8nUnreachableError, fetchInvoicesRemote, isMock, sendInvoiceRemote } from "@/lib/n8n";

export const maxDuration = 60;

// Stands in for (mock) / calls (real) the N8N webhook that sends the
// approved email + WhatsApp draft via Power Automate Gmail + native Twilio. An optional
// {emailBody, waBody} body lets a just-blurred draft edit win over whatever
// N8N/the mock store already has stored, closing the save-then-send race.
//
// A step that fails but N8N answered cleanly comes back HTTP 200 with
// ok:false — we map that to a normal 200 response with stage:"failed" so
// the frontend renders a red FAILED row, not the "backend unreachable"
// banner. Only a genuinely unreachable N8N produces the 502 below.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: { emailBody?: string; waBody?: string; isRetry?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // no body sent — fine, use whatever's already drafted
  }

  if (isMock()) {
    if (!findInvoice(id)) {
      return NextResponse.json({ error: "invoice not found" }, { status: 404 });
    }
    await sleep(1400);
    const inv = findInvoice(id)!;
    const updated = patch(id, {
      stage: "sent",
      failureReason: null,
      waStatus: inv.waOptIn && !inv.waOptOut ? "accepted" : "skipped:no-consent",
      ...(typeof body.emailBody === "string" ? { draftEmail: body.emailBody } : {}),
      ...(typeof body.waBody === "string" ? { draftWhatsapp: body.waBody } : {}),
    });
    return NextResponse.json({ invoice: updated });
  }

  try {
    // #region agent log
    const draftPreview =
      typeof body.waBody === "string" ? body.waBody.slice(0, 120) : null;
    fetch("http://127.0.0.1:7369/ingest/1710511b-54ab-49e5-9ad2-a85aa0c54305", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "725e23" },
      body: JSON.stringify({
        sessionId: "725e23",
        runId: "post-fix",
        hypothesisId: "A",
        location: "app/api/invoices/[id]/send/route.ts:POST",
        message: "send: AR waBody (should match email objective)",
        data: {
          id,
          waMode: process.env.WA_MODE || "live",
          hasWaEdit: typeof body.waBody === "string",
          draftPreview,
          draftLooksLikePaymentReminder:
            typeof body.waBody === "string" &&
            /payment|overdue|past due|Dunnly AR/i.test(body.waBody),
          draftLooksLikeSandboxShip:
            typeof body.waBody === "string" &&
            /has shipped and should be delivered/i.test(body.waBody),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    let isRetry = body.isRetry === true;
    if (body.isRetry === undefined && !isMock()) {
      const { invoices } = await fetchInvoicesRemote();
      const cur = invoices.find((inv) => inv.id === id);
      isRetry =
        !!cur &&
        (cur.stage === "sent" ||
          cur.stage === "failed" ||
          String(cur.waStatus || "").startsWith("skipped"));
    }
    const result = await sendInvoiceRemote(id, {
      emailBody: body.emailBody,
      waBody: body.waBody,
      isRetry,
      waProvider: "twilio",
      waMode: process.env.WA_MODE || "live",
    });
    // #region agent log
    const inv = result.invoice;
    const expectedArWa = inv ? waFor(inv) : null;
    fetch("http://127.0.0.1:7369/ingest/1710511b-54ab-49e5-9ad2-a85aa0c54305", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "725e23" },
      body: JSON.stringify({
        sessionId: "725e23",
        runId: "post-fix",
        hypothesisId: "B",
        location: "app/api/invoices/[id]/send/route.ts:ok",
        message: "send: returned draftWhatsapp should be AR collections copy",
        data: {
          id,
          ok: result.ok,
          waStatus: inv?.waStatus ?? null,
          returnedDraftPreview: inv?.draftWhatsapp
            ? String(inv.draftWhatsapp).slice(0, 160)
            : null,
          expectedArWaPreview: expectedArWa ? expectedArWa.slice(0, 160) : null,
          returnedLooksLikeShip:
            !!inv?.draftWhatsapp && /has shipped/i.test(String(inv.draftWhatsapp)),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    // #region agent log
    fetch("http://127.0.0.1:7369/ingest/1710511b-54ab-49e5-9ad2-a85aa0c54305", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "7a7289" },
      body: JSON.stringify({
        sessionId: "7a7289",
        runId: "comms-fix",
        hypothesisId: "A",
        location: "app/api/invoices/[id]/send/route.ts:ok",
        message: "send result",
        data: {
          id,
          ok: result.ok,
          stage: result.invoice?.stage,
          waStatus: result.invoice?.waStatus ?? null,
          daysOverdue: result.invoice?.daysOverdue ?? null,
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
        runId: "post-fix",
        hypothesisId: "E",
        location: "app/api/invoices/[id]/send/route.ts:catch",
        message: "send route error",
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
