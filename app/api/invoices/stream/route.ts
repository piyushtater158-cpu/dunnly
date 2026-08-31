import { getLastLedger, subscribe, type LedgerPayload } from "@/lib/ledger-bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KEEPALIVE_MS = 25_000;

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET() {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (payload: LedgerPayload) => {
        if (closed) return;
        controller.enqueue(encoder.encode(sseFrame("ledger", payload)));
      };

      const last = getLastLedger();
      if (last) {
        controller.enqueue(encoder.encode(sseFrame("ledger", last)));
      }

      unsubscribe = subscribe(push);

      keepalive = setInterval(() => {
        if (closed) return;
        controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, KEEPALIVE_MS);
    },
    cancel() {
      closed = true;
      if (unsubscribe) unsubscribe();
      if (keepalive) clearInterval(keepalive);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
