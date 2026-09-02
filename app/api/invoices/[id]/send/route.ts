import { NextResponse } from "next/server";
import { findInvoice, patch, sleep } from "@/lib/store";
import { N8nUnreachableError, fetchInvoicesRemote, isMock, sendInvoiceRemote } from "@/lib/n8n";
import { initCadenceAtSend } from "@/lib/followup-policy";

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
    const isFirstSend = inv.cadenceState == null && !body.isRetry;
    const cadenceInit = isFirstSend ? initCadenceAtSend() : {};
    const updated = patch(id, {
      stage: "sent",
      failureReason: null,
      waStatus: inv.waOptIn && !inv.waOptOut ? "accepted" : "skipped:no-consent",
      ...(typeof body.emailBody === "string" ? { draftEmail: body.emailBody } : {}),
      ...(typeof body.waBody === "string" ? { draftWhatsapp: body.waBody } : {}),
      ...cadenceInit,
    });
    return NextResponse.json({ invoice: updated });
  }

  try {
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
    return NextResponse.json({ invoice: result.invoice });
  } catch (err) {
    if (err instanceof N8nUnreachableError) {
      return NextResponse.json({ error: "backend unreachable" }, { status: 502 });
    }
    throw err;
  }
}
