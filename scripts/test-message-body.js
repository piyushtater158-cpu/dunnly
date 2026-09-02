/**
 * Unit tests for n8n/normalize-message-body.js
 * Usage: node scripts/test-message-body.js
 */
const {
  normalizeMessageBody,
  coercePlainText,
} = require("../n8n/normalize-message-body");

let passed = 0;
let failed = 0;

function assertEq(label, actual, expected) {
  if (actual === expected) {
    passed++;
    return;
  }
  failed++;
  console.error("FAIL:", label);
  console.error("  expected:", JSON.stringify(expected));
  console.error("  actual:  ", JSON.stringify(actual));
}

function assertIncludes(label, actual, substr) {
  if (actual.includes(substr)) {
    passed++;
    return;
  }
  failed++;
  console.error("FAIL:", label);
  console.error("  expected to include:", substr);
  console.error("  actual:", JSON.stringify(actual));
}

function assertNotIncludes(label, actual, substr) {
  if (!actual.includes(substr)) {
    passed++;
    return;
  }
  failed++;
  console.error("FAIL:", label);
  console.error("  expected NOT to include:", substr);
  console.error("  actual:", JSON.stringify(actual));
}

// Object payload coercion (WA)
assertEq(
  "coerce nested body object",
  coercePlainText({ body: "Payment sent yesterday" }),
  "Payment sent yesterday"
);
assertEq(
  "coerce Twilio-style Body field",
  coercePlainText({ Body: "I'll pay Friday" }),
  "I'll pay Friday"
);
assertEq("coerce empty object", coercePlainText({ foo: 1 }), "");

// Clean WA reply passes through
assertEq(
  "whatsapp clean reply",
  normalizeMessageBody("I'll pay tomorrow", { channel: "whatsapp" }),
  "I'll pay tomorrow"
);

// HTML email
const html = "<p>We paid via ACH.</p><br>Thanks";
assertEq(
  "email strips html",
  normalizeMessageBody(html, { channel: "email" }),
  "We paid via ACH.\n\nThanks"
);

// Email quote chain
const chain =
  "Please process this week.\n\nOn Mon, Jan 1, 2024 at 10:00 AM Dunnly <ar@dunnly.com> wrote:\n> Old message";
assertEq(
  "email trims quoted reply",
  normalizeMessageBody(chain, { channel: "email" }),
  "Please process this week."
);

// JSON artifact
assertEq(
  "strip classification json",
  normalizeMessageBody('{"classification":"paid","promiseDate":null}', { channel: "manual" }),
  ""
);
assertEq(
  "extract replyText from json blob",
  normalizeMessageBody('{"replyText":"Paid in full"}', { channel: "manual" }),
  "Paid in full"
);

// Code fences
assertEq(
  "strip code fences",
  normalizeMessageBody("```json\n{\"text\":\"hello\"}\n```", { channel: "manual" }),
  "hello"
);

// Original message separator
const outlook =
  "Will remit Friday.\n\n-----Original Message-----\nFrom: AR\nSent: Monday";
assertEq(
  "email trims outlook separator",
  normalizeMessageBody(outlook, { channel: "email" }),
  "Will remit Friday."
);

// Quoted lines
const quoted = "New reply here\n> quoted line\n> more quote";
assertEq(
  "email stops at quote lines",
  normalizeMessageBody(quoted, { channel: "email" }),
  "New reply here"
);

console.log(`\ntest-message-body: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
