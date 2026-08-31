import { NextResponse } from "next/server";
import { findInvoice, redraftInvoice, sleep } from "@/lib/store";
import { N8nUnreachableError, draftInvoiceRemote, isMock } from "@/lib/n8n";

export const maxDuration = 60;

// Regenerates the draft email/WhatsApp copy from scratch, discarding any
// manual edits. Calls N8N's dunnly-draft webhook with mode:"redraft".
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (isMock()) {
    if (!findInvoice(id)) {
      return NextResponse.json({ error: "invoice not found" }, { status: 404 });
    }
    await sleep(500);
    const updated = redraftInvoice(id);
    return NextResponse.json({ invoice: updated });
  }

  try {
    const result = await draftInvoiceRemote(id, "redraft");
    return NextResponse.json({ invoice: result.invoice });
  } catch (err) {
    if (err instanceof N8nUnreachableError) {
      return NextResponse.json({ error: "backend unreachable" }, { status: 502 });
    }
    throw err;
  }
}
