import { NextResponse } from "next/server";
import { classify, findInvoice, patch, sleep } from "@/lib/store";
import { N8nUnreachableError, classifyReplyRemote, isMock } from "@/lib/n8n";
import { computeNextAction } from "@/lib/followup-policy";
import { normalizeMessageBody } from "@/lib/message-body";

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
    text = typeof body?.text === "string" ? normalizeMessageBody(body.text, { channel: "manual" }) : "";
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
    const inv = findInvoice(id)!;
    // Mock classifier has no LLM date extraction — promiseDate stays null,
    // which lands "promise" replies on the no-date W1 branch. Matches the
    // real dunnly-classify path's behavior when promiseConfidence < 0.6.
    const action = computeNextAction({
      classification: cls,
      promiseDate: null,
      promiseConfidence: 0,
      daysOverdue: inv.daysOverdue,
      amountRemaining: inv.amountRemaining,
      followupCount: inv.followupCount ?? 0,
      waOptOut: inv.waOptOut,
      email: inv.email,
    });
    const updated = patch(id, {
      classification: cls,
      stage: nextStage,
      nextActionAt: action.nextActionAt,
      followupBucket: action.followupBucket,
      cadenceState: action.cadenceState,
      promiseDate: action.promiseDate,
    });
    return NextResponse.json({ invoice: updated });
  }

  try {
    const result = await classifyReplyRemote(id, text);
    return NextResponse.json({ invoice: result.invoice });
  } catch (err) {
    if (err instanceof N8nUnreachableError) {
      return NextResponse.json({ error: "backend unreachable" }, { status: 502 });
    }
    throw err;
  }
}
