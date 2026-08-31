import { NextResponse } from "next/server";
import { attachInbound, findInbound, findInvoice } from "@/lib/store";
import { N8nUnreachableError, attachInboundRemote, isMock } from "@/lib/n8n";

export const maxDuration = 30;

/** Attach a pending unmatched inbound WhatsApp message to an invoice. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ sid: string }> }
) {
  const { sid } = await params;
  let invoiceId = "";
  try {
    const body = await req.json();
    invoiceId = typeof body?.invoiceId === "string" ? body.invoiceId : "";
  } catch {
    // empty
  }
  if (!invoiceId) {
    return NextResponse.json({ error: "invoiceId required" }, { status: 400 });
  }

  if (isMock()) {
    if (!findInbound(sid)) {
      return NextResponse.json({ error: "inbound not found" }, { status: 404 });
    }
    if (!findInvoice(invoiceId)) {
      return NextResponse.json({ error: "invoice not found" }, { status: 404 });
    }
    const event = attachInbound(sid, invoiceId);
    return NextResponse.json({ ok: true, event, invoice: findInvoice(invoiceId) });
  }

  try {
    const result = await attachInboundRemote(sid, invoiceId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof N8nUnreachableError) {
      return NextResponse.json({ error: "backend unreachable" }, { status: 502 });
    }
    throw err;
  }
}
