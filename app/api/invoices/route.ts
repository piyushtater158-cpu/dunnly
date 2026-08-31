import { NextResponse } from "next/server";
import { db, pendingInbound } from "@/lib/store";
import { N8nUnreachableError, fetchInvoicesRemote, isMock } from "@/lib/n8n";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// This is the front end's only path to invoice data — same-origin, no N8N
// webhook URL or secret ever reaches the browser. isMock() reads the local
// mock store; otherwise it proxies to N8N's dunnly-read workflow.
export async function GET() {
  if (isMock()) {
    return NextResponse.json({ invoices: db(), inbound: pendingInbound() });
  }
  try {
    const { invoices, inbound } = await fetchInvoicesRemote();
    return NextResponse.json({ invoices, inbound });
  } catch (err) {
    if (err instanceof N8nUnreachableError) {
      return NextResponse.json({ error: "backend unreachable" }, { status: 502 });
    }
    throw err;
  }
}
