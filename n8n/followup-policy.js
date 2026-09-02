/**
 * Follow-up cadence policy — keep in sync with pasted copies in n8n Code nodes.
 * Reuses date helpers from normalize-invoice.js.
 */
const { addCalendarDays, istYmd } = require("./normalize-invoice.js");

const BUCKET_DAYS = { W1: 7, W2: 14, W3: 21, W4: 28 };

function parseYmd(s) {
  if (!s || typeof s !== "string") return null;
  const t = s.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

function diffDays(laterYmd, earlierYmd) {
  const a = laterYmd.split("-").map(Number);
  const b = earlierYmd.split("-").map(Number);
  return Math.round((Date.UTC(a[0], a[1] - 1, a[2]) - Date.UTC(b[0], b[1] - 1, b[2])) / 86400000);
}

function bucketLabelForDays(days) {
  if (days <= 7) return "W1";
  if (days <= 14) return "W2";
  if (days <= 21) return "W3";
  return "W4";
}

/**
 * @param {object} opts
 * @returns {{ nextActionAt: string|null, followupBucket: string|null, cadenceState: string, reason: string, promiseDate?: string|null }}
 */
function computeNextAction(opts) {
  const today = istYmd(new Date());
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

  let nextActionAt = null;
  let followupBucket = null;
  let cadenceState = "active";
  let reason = classification;
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
    const ladder = ["W1", "W2", "W3", "W4"];
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
    nextActionAt = addCalendarDays(today, BUCKET_DAYS[followupBucket]);
    reason = "no_response_ladder_" + followupBucket;
  }

  if (daysOverdue >= 60 || amountRemaining >= highValue) {
    const shifted = addCalendarDays(nextActionAt, -7);
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
function initCadenceAtSend() {
  const today = istYmd(new Date());
  return {
    cadenceState: "active",
    followupBucket: "W1",
    nextActionAt: addCalendarDays(today, 7),
    followupCount: 0,
    promiseDate: null,
    lastTouchAt: null,
  };
}

module.exports = {
  computeNextAction,
  initCadenceAtSend,
  BUCKET_DAYS,
};
