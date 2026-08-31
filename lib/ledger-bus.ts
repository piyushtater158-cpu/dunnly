import type { InboundEvent, Invoice } from "@/lib/store";

export interface LedgerPayload {
  invoices: Invoice[];
  inbound: InboundEvent[];
  syncedAt: string;
}

type Subscriber = (payload: LedgerPayload) => void;

interface LedgerBusState {
  lastLedger: LedgerPayload | null;
  subscribers: Set<Subscriber>;
}

const GLOBAL_KEY = "__dunnlyLedgerBus";

function getState(): LedgerBusState {
  const g = globalThis as typeof globalThis & { [GLOBAL_KEY]?: LedgerBusState };
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = { lastLedger: null, subscribers: new Set() };
  }
  return g[GLOBAL_KEY];
}

export function getLastLedger(): LedgerPayload | null {
  return getState().lastLedger;
}

export function subscribe(cb: Subscriber): () => void {
  const state = getState();
  state.subscribers.add(cb);
  return () => {
    state.subscribers.delete(cb);
  };
}

export function publish(payload: LedgerPayload): void {
  const state = getState();
  state.lastLedger = payload;
  for (const cb of state.subscribers) {
    try {
      cb(payload);
    } catch {
      /* subscriber error — ignore */
    }
  }
}
