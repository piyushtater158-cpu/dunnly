// TypeScript port of n8n/followup-policy.js for the mock-mode (isMock()) code
// path — keep both in sync. n8n Code nodes can't import this file (no
// filesystem access), so n8n/followup-policy.js's text is pasted directly
// into the relevant Code nodes instead. See n8n/followup-policy.js for the
// canonical algorithm notes.

import { addCalendarDays, istYmd } from "@/lib/overdue";
import type { CadenceState, Classification, FollowupBucket } from "@/lib/store";

const BUCKET_DAYS: Record<"W1" | "W2" | "W3" | "W4", number> = {
  W1: 7,
  W2: 14,
  W3: 21,
  W4: 28,
};

function parseYmd(s: unknown): string | null {
  if (!s || typeof s !== "string") return null;
  const t = s.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

function diffDays(laterYmd: string, earlierYmd: string): number {
  const a = laterYmd.split("-").map(Number);
  const b = earlierYmd.split("-").map(Number);
  return Math.round(
    (Date.UTC(a[0], a[1] - 1, a[2]) - Date.UTC(b[0], b[1] - 1, b[2])) / 86400000
  );
}

function bucketLabelForDays(days: number): FollowupBucket {
  if (days <= 7) return "W1";
  if (days <= 14) return "W2";
  if (days <= 21) return "W3";
  return "W4";
}

export interface ComputeNextActionOpts {
  classification: Classification;
  promiseDate?: string | null;
  promiseConfidence?: number;
  daysOverdue: number;
  amountRemaining: number;
  followupCount: number;
  waOptOut: boolean;
  email: string;
  maxTouches?: number;
  highValue?: number;
}

export interface ComputeNextActionResult {
  nextActionAt: string | null;
  followupBucket: FollowupBucket;
  cadenceState: Exclude<CadenceState, null>;
  reason: string;
  promiseDate: string | null;
}

export function computeNextAction(opts: ComputeNextActionOpts): ComputeNextActionResult {
  const today = istYmd();
  const tomorrow = addCalendarDays(today, 1);

  const classification = opts.classification || "no_response";
  const promiseDate = parseYmd(opts.promiseDate);
  const promiseConfidence = Number(opts.promiseConfidence ?? 0);
  const daysOverdue = Number(opts.daysOverdue ?? 0);
  const amountRemaining = Number(opts.amountRemaining ?? 0);
  const followupCount = Number(opts.followupCount ?? 0);
  const waOptOut = !!opts.waOptOut;
  const email = String(opts.email || "").trim();

  const maxTouches = Number(opts.maxTouches ?? 4);
  const highValue = Number(opts.highValue ?? 100000);

  if (amountRemaining <= 0) {
    return {
      nextActionAt: null,
      followupBucket: null,
      cadenceState: "closed",
      reason: "amount_remaining_zero",
      promiseDate: promiseDate || null,
    };
  }

  if (waOptOut && !email) {
    return {
      nextActionAt: null,
      followupBucket: null,
      cadenceState: "paused",
      reason: "no_reachable_channel",
      promiseDate: promiseDate || null,
    };
  }

  if (classification === "dispute") {
    return {
      nextActionAt: addCalendarDays(today, 28),
      followupBucket: "W4",
      cadenceState: "paused",
      reason: "dispute_paused_internal_resurface_28d",
      promiseDate: promiseDate || null,
    };
  }

  let nextActionAt: string | null = null;
  let followupBucket: FollowupBucket = null;
  let cadenceState: Exclude<CadenceState, null> = "active";
  let reason: string = classification || "no_response";
  const outPromiseDate = promiseDate && promiseConfidence >= 0.6 ? promiseDate : null;

  if (classification === "promise" && promiseDate && promiseConfidence >= 0.6) {
    nextActionAt = addCalendarDays(promiseDate, 2);
    followupBucket = bucketLabelForDays(diffDays(nextActionAt, today));
    reason = "promise_with_date";
  } else if (classification === "promise") {
    nextActionAt = addCalendarDays(today, BUCKET_DAYS.W1);
    followupBucket = "W1";
    reason = "promise_no_date_w1";
  } else if (classification === "paid") {
    nextActionAt = addCalendarDays(today, BUCKET_DAYS.W1);
    followupBucket = "W1";
    reason = "paid_verify_w1";
  } else {
    const ladder: FollowupBucket[] = ["W1", "W2", "W3", "W4"];
    const idx = Math.min(Math.max(0, followupCount), ladder.length - 1);
    followupBucket = ladder[idx];
    if (followupCount >= maxTouches) {
      return {
        nextActionAt: null,
        followupBucket,
        cadenceState: "closed",
        reason: "max_touches_closed",
        promiseDate: outPromiseDate,
      };
    }
    nextActionAt = addCalendarDays(today, BUCKET_DAYS[followupBucket as "W1" | "W2" | "W3" | "W4"]);
    reason = "no_response_ladder_" + followupBucket;
  }

  if (daysOverdue >= 60 || amountRemaining >= highValue) {
    const shifted = addCalendarDays(nextActionAt as string, -7);
    nextActionAt = shifted < tomorrow ? tomorrow : shifted;
    if (reason.startsWith("no_response_ladder")) {
      followupBucket = bucketLabelForDays(diffDays(nextActionAt, today));
    }
    reason += "|high_value_or_overdue_tightened";
  }

  if (followupCount >= maxTouches) {
    cadenceState = "closed";
    reason = "max_touches_closed";
  }

  return {
    nextActionAt,
    followupBucket,
    cadenceState,
    reason,
    promiseDate: outPromiseDate,
  };
}

/** First (non-retry) send stamps W1 +7d. */
export function initCadenceAtSend() {
  const today = istYmd();
  return {
    cadenceState: "active" as const,
    followupBucket: "W1" as const,
    nextActionAt: addCalendarDays(today, 7),
    followupCount: 0,
    promiseDate: null,
    lastTouchAt: null,
  };
}
