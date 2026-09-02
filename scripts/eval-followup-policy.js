/**
 * Table-driven eval for n8n/followup-policy.js
 * Usage: node scripts/eval-followup-policy.js
 */
const path = require("path");
const { computeNextAction, initCadenceAtSend, BUCKET_DAYS } = require("../n8n/followup-policy.js");
const { addCalendarDays, istYmd } = require("../n8n/normalize-invoice.js");

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else {
    console.log("ok:", msg);
  }
}

const today = istYmd(new Date());
const tomorrow = addCalendarDays(today, 1);

// init at send
const init = initCadenceAtSend();
assert(init.cadenceState === "active", "init active");
assert(init.followupBucket === "W1", "init W1");
assert(init.nextActionAt === addCalendarDays(today, 7), "init +7d");
assert(init.followupCount === 0, "init count 0");

// dispute paused +28d internal
const dispute = computeNextAction({
  classification: "dispute",
  daysOverdue: 10,
  amountRemaining: 1000,
  followupCount: 0,
  waOptOut: false,
  email: "a@b.com",
});
assert(dispute.cadenceState === "paused", "dispute paused");
assert(dispute.nextActionAt === addCalendarDays(today, 28), "dispute +28d");

// promise with date
const fri = addCalendarDays(today, 5);
const prom = computeNextAction({
  classification: "promise",
  promiseDate: fri,
  promiseConfidence: 0.9,
  daysOverdue: 10,
  amountRemaining: 1000,
  followupCount: 0,
  waOptOut: false,
  email: "a@b.com",
});
assert(prom.nextActionAt === addCalendarDays(fri, 2), "promise date +2 grace");

// promise no date -> W1
const promNo = computeNextAction({
  classification: "promise",
  promiseDate: null,
  promiseConfidence: 0.2,
  daysOverdue: 5,
  amountRemaining: 500,
  followupCount: 0,
  waOptOut: false,
  email: "a@b.com",
});
assert(promNo.followupBucket === "W1", "promise no date W1");

// no_response ladder
for (let i = 0; i < 4; i++) {
  const bucket = ["W1", "W2", "W3", "W4"][i];
  const r = computeNextAction({
    classification: "no_response",
    daysOverdue: 5,
    amountRemaining: 500,
    followupCount: i,
    waOptOut: false,
    email: "a@b.com",
  });
  assert(r.followupBucket === bucket, "ladder step " + i + " -> " + bucket);
  assert(r.nextActionAt === addCalendarDays(today, BUCKET_DAYS[bucket]), "ladder days " + bucket);
}

// max touches closed
const closed = computeNextAction({
  classification: "no_response",
  daysOverdue: 5,
  amountRemaining: 500,
  followupCount: 4,
  maxTouches: 4,
  waOptOut: false,
  email: "a@b.com",
});
assert(closed.cadenceState === "closed", "max touches closed");

// amount zero
const paidOff = computeNextAction({
  classification: "promise",
  amountRemaining: 0,
  followupCount: 0,
});
assert(paidOff.cadenceState === "closed", "amount zero closed");

// high value tightener — not before tomorrow
const hv = computeNextAction({
  classification: "no_response",
  daysOverdue: 5,
  amountRemaining: 200000,
  followupCount: 0,
  highValue: 100000,
  waOptOut: false,
  email: "a@b.com",
});
assert(hv.nextActionAt >= tomorrow, "high value floor tomorrow");

// wa opt out no email paused
const paused = computeNextAction({
  classification: "no_response",
  amountRemaining: 100,
  waOptOut: true,
  email: "",
});
assert(paused.cadenceState === "paused", "opt out no email paused");

if (failed) {
  console.error("\n" + failed + " failed");
  process.exit(1);
}
console.log("\neval-followup-policy: all passed");
