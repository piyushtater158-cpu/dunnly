import { NextResponse } from "next/server";

// Auto-send config lives server-side per the design doc: AUTO_SEND is read
// here from the environment and handed to the client as a plain boolean —
// never as a client-bundled env var. Default false (manual approve/send).
export async function GET() {
  const autoSend = process.env.AUTO_SEND === "true";
  return NextResponse.json({ autoSend });
}
