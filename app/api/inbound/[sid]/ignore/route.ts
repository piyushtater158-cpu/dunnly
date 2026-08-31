import { NextResponse } from "next/server";
import { findInbound, ignoreInbound } from "@/lib/store";
import { N8nUnreachableError, ignoreInboundRemote, isMock } from "@/lib/n8n";

export const maxDuration = 30;

/** Ignore a pending inbound WhatsApp event (unmatched / keyword). */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ sid: string }> }
) {
  const { sid } = await params;

  if (isMock()) {
    if (!findInbound(sid)) {
      return NextResponse.json({ error: "inbound not found" }, { status: 404 });
    }
    const event = ignoreInbound(sid);
    return NextResponse.json({ ok: true, event });
  }

  try {
    const result = await ignoreInboundRemote(sid);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof N8nUnreachableError) {
      return NextResponse.json({ error: "backend unreachable" }, { status: 502 });
    }
    throw err;
  }
}
