/**
 * Validate normalized invoice fixtures against schema + overdue formula.
 * Usage: node scripts/validate-invoice-schema.js
 */
const fs = require("fs");
const path = require("path");
const {
  deriveOverdue,
  addCalendarDays,
  istYmd,
} = require("../n8n/normalize-invoice.js");

const root = path.join(__dirname, "..");
const schema = JSON.parse(
  fs.readFileSync(path.join(root, "n8n/schema/invoices.row.schema.json"), "utf8")
);
const fixture = JSON.parse(
  fs.readFileSync(path.join(root, "n8n/schema/fixtures/demo-overdue.json"), "utf8")
);

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL: " + msg);
    failed++;
  } else {
    console.log("ok: " + msg);
  }
}

const row = fixture.row;
const required = schema.required || [];
for (const k of required) {
  assert(row[k] !== undefined && row[k] !== "", "required field " + k);
}

assert(
  ["queued", "drafted", "sent", "replied", "classified", "notified", "failed"].includes(row.stage),
  "stage enum"
);
assert(Number.isInteger(row.daysOverdue) && row.daysOverdue >= 0, "daysOverdue >= 0 int");
assert(Number.isInteger(row.creditDays) && row.creditDays >= 0, "creditDays >= 0 int");

// Formula vs fixture asOf
const asOf = new Date(fixture.asOf + "T12:00:00+05:30");
const expectedDue = addCalendarDays(row.dateOfSupply, row.creditDays);
assert(expectedDue === row.dueDate, "dueDate = supply + credit (" + expectedDue + ")");

const today = istYmd(asOf);
const [y1, m1, d1] = today.split("-").map(Number);
const [y0, m0, d0] = expectedDue.split("-").map(Number);
const expectedAge = Math.max(
  0,
  Math.round(
    (Date.UTC(y1, m1 - 1, d1) - Date.UTC(y0, m0 - 1, d0)) / 86400000
  )
);
assert(expectedAge === row.daysOverdue, "daysOverdue vs asOf (" + expectedAge + ")");

// deriveOverdue with frozen clock via dateOfSupply inputs (live clock) — check structure
const live = deriveOverdue({
  dateOfSupply: row.dateOfSupply,
  creditDays: row.creditDays,
  daysOverdue: 999,
});
assert(live.dueDate === expectedDue, "deriveOverdue dueDate");
assert(live.daysOverdue !== 999, "deriveOverdue ignores stale stored age when inputs present");

// Alias map
const aliased = deriveOverdue({
  "Date of Supply": "2026-07-01",
  "Credit Line": 30,
  daysOverdue: 1,
});
assert(aliased.dueDate === "2026-07-31", "alias Date of Supply / Credit Line");

// Fallback when inputs missing
const fallback = deriveOverdue({ daysOverdue: 12 });
assert(fallback.daysOverdue === 12 && fallback.dueDate === null, "fallback to stored daysOverdue");

if (failed) {
  console.error("\n" + failed + " assertion(s) failed");
  process.exit(1);
}
console.log("\nvalidate-invoice-schema: all passed");
