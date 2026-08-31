import { NextResponse } from "next/server";
import { db, draftInvoice, patch, pendingInbound } from "@/lib/store";
import { N8nUnreachableError, fetchInvoicesRemote, isMock, triggerPullRemote } from "@/lib/n8n";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Triggers N8N's "pull overdue invoices" webhook. That workflow responds
// immediately and drafts each invoice in the background (LLM call per row
// can take a while for a full pull) — the dashboard SSE stream surfaces
// each row as it flips to "drafted" after Apps Script sync, so this returns
// snapshot right after kicking the pull off, not the final state.
export async function POST() {
  if (isMock()) {
    for (const v of db()) {
      if (v.stage === "queued") {
        patch(v.id, { stage: "drafted" });
        draftInvoice(v.id);
      }
    }
    return NextResponse.json({ invoices: db(), inbound: pendingInbound() });
  }
  try {
    await triggerPullRemote({ autoSend: process.env.AUTO_SEND === "true" });
    const { invoices, inbound } = await fetchInvoicesRemote();
    return NextResponse.json({ invoices, inbound });
  } catch (err) {
    if (err instanceof N8nUnreachableError) {
      return NextResponse.json({ error: "backend unreachable" }, { status: 502 });
    }
    throw err;
  }
}
