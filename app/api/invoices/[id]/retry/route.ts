import { NextResponse } from "next/server";
import { findInvoice, patch, sleep } from "@/lib/store";
import { N8nUnreachableError, isMock, sendInvoiceRemote } from "@/lib/n8n";

export const maxDuration = 60;

// Manual retry for a Failed invoice — re-fires the same send step rather
// than auto-retrying, per the design doc's "Failed-stage recovery" open
// question (auto-retry on a flaky connection risks duplicate sends).
// isRetry:true only affects N8N's send_log entry, not behaviour.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (isMock()) {
    if (!findInvoice(id)) {
      return NextResponse.json({ error: "invoice not found" }, { status: 404 });
    }
    await sleep(1600);
    const updated = patch(id, { stage: "sent", failureReason: null, waStatus: "accepted" });
    return NextResponse.json({ invoice: updated });
  }

  try {
    const result = await sendInvoiceRemote(id, {
      isRetry: true,
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
