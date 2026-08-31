import { NextResponse } from "next/server";
import { publish } from "@/lib/ledger-bus";
import { toInboundEvent, toInvoice } from "@/lib/n8n";

export const dynamic = "force-dynamic";

function notifySecret(): string {
  return (
    process.env.LEDGER_NOTIFY_SECRET ||
    process.env.N8N_WEBHOOK_SECRET ||
    ""
  );
}

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

export async function POST(req: Request) {
  const expected = notifySecret();
  if (!expected) {
    return NextResponse.json({ ok: false, error: "notify secret not configured" }, { status: 503 });
  }

  const got = req.headers.get("x-dunnly-secret") || "";
  if (got !== expected) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const raw = (body ?? {}) as Record<string, unknown>;
  const invoicesRaw = Array.isArray(raw.invoices) ? raw.invoices : [];
  const inboundRaw = Array.isArray(raw.inbound) ? raw.inbound : [];
  const syncedAt =
    typeof raw.syncedAt === "string" && raw.syncedAt
      ? raw.syncedAt
      : new Date().toISOString();

  publish({
    invoices: invoicesRaw.map(toInvoice),
    inbound: inboundRaw.map(toInboundEvent),
    syncedAt,
  });

  return NextResponse.json({ ok: true, syncedAt });
}
