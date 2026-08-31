import { NextResponse } from "next/server";
import { findInvoice, updateDraft } from "@/lib/store";
import { N8nUnreachableError, draftInvoiceRemote, isMock } from "@/lib/n8n";

export const maxDuration = 30;

// Saves manual edits to the drafted email/WhatsApp copy before it's sent.
// Called on textarea blur, not per keystroke. Calls N8N's dunnly-draft
// webhook with mode:"save" — a plain write, no LLM call.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: { emailBody?: string; waBody?: string } = {};
  try {
    body = await req.json();
  } catch {
    // no-op
  }

  // Nothing to save — skip the round trip entirely (mock or real).
  if (typeof body.emailBody !== "string" && typeof body.waBody !== "string") {
    if (isMock()) {
      return NextResponse.json({ invoice: findInvoice(id) });
    }
    return NextResponse.json({ invoice: null });
  }

  if (isMock()) {
    if (!findInvoice(id)) {
      return NextResponse.json({ error: "invoice not found" }, { status: 404 });
    }
    const updated = updateDraft(id, body);
    return NextResponse.json({ invoice: updated });
  }

  try {
    const result = await draftInvoiceRemote(id, "save", body);
    return NextResponse.json({ invoice: result.invoice });
  } catch (err) {
    if (err instanceof N8nUnreachableError) {
      return NextResponse.json({ error: "backend unreachable" }, { status: 502 });
    }
    throw err;
  }
}
