import { NextResponse } from "next/server";
import { findInvoice, patch } from "@/lib/store";
import { N8nUnreachableError, isMock, setCadenceRemote } from "@/lib/n8n";
import type { CadenceState, FollowupBucket } from "@/lib/store";

export const maxDuration = 30;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: {
    cadenceState?: CadenceState;
    nextActionAt?: string | null;
    followupBucket?: FollowupBucket;
  } = {};
  try {
    body = await req.json();
  } catch {
    // no body
  }

  if (isMock()) {
    const inv = findInvoice(id);
    if (!inv) {
      return NextResponse.json({ error: "invoice not found" }, { status: 404 });
    }
    const updated = patch(id, {
      ...(body.cadenceState !== undefined ? { cadenceState: body.cadenceState } : {}),
      ...(body.nextActionAt !== undefined ? { nextActionAt: body.nextActionAt } : {}),
      ...(body.followupBucket !== undefined ? { followupBucket: body.followupBucket } : {}),
    });
    return NextResponse.json({ invoice: updated });
  }

  try {
    const result = await setCadenceRemote(id, body);
    return NextResponse.json({ invoice: result.invoice, ok: result.ok });
  } catch (err) {
    if (err instanceof N8nUnreachableError) {
      return NextResponse.json({ error: "backend unreachable" }, { status: 502 });
    }
    throw err;
  }
}
