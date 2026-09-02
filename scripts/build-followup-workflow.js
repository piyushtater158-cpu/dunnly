/**
 * Generate n8n/workflows/dunnly-followup.json
 * Usage: node scripts/build-followup-workflow.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const policySrc = fs.readFileSync(path.join(ROOT, "n8n/followup-policy.js"), "utf8");
const policyInline = policySrc.replace(/module\.exports[\s\S]*$/, "").trim();
const normSrc = fs.readFileSync(path.join(ROOT, "n8n/normalize-invoice.js"), "utf8");
const normInline = normSrc.replace(/module\.exports[\s\S]*$/, "").trim();

const selectDueCode =
  normInline +
  `
function istTodayTouch(lastTouchAt) {
  if (!lastTouchAt) return false;
  const n = Number(lastTouchAt);
  const d = Number.isFinite(n) && n > 0 ? new Date(n) : new Date(String(lastTouchAt));
  if (!Number.isFinite(d.getTime())) return false;
  return istYmd(d) === istYmd(new Date());
}
const today = istYmd(new Date());
const due = [];
const toClose = [];
for (const { json: r } of $input.all()) {
  const amt = Number(r.amountRemaining || 0);
  if (r.cadenceState === 'active' && amt <= 0) {
    toClose.push({ json: { id: r.id, cadenceState: 'closed', nextActionAt: '', updatedAt: new Date().toISOString() } });
    continue;
  }
  if (String(r.cadenceState || '') !== 'active') continue;
  const next = String(r.nextActionAt || '').slice(0, 10);
  if (!next || next > today) continue;
  if (amt <= 0) continue;
  const stage = String(r.stage || '');
  if (stage === 'drafted' || stage === 'queued') continue;
  if (istTodayTouch(r.lastTouchAt)) continue;
  due.push({ json: r });
}
if (toClose.length) {
  return [...toClose, ...due];
}
return due;
`;

const computeRearmCode =
  normInline +
  "\n" +
  policyInline +
  `
const inv = $('Request redraft').item.json.invoice || $('Loop Over Items').item.json;
function truthy(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toUpperCase();
    return s === 'TRUE' || s === '1' || s === 'YES';
  }
  return false;
}
function pickInt(v, fb) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fb;
}
const overdue = deriveOverdue(inv);
const classification = inv.classification || 'no_response';
const curCount = pickInt(inv.followupCount, 0);
const action = computeNextAction({
  classification,
  promiseDate: inv.promiseDate || null,
  promiseConfidence: 1,
  daysOverdue: overdue.daysOverdue,
  amountRemaining: Number(inv.amountRemaining || 0),
  followupCount: curCount,
  waOptOut: truthy(inv.waOptOut),
  email: String(inv.email || ''),
  maxTouches: Number($env.FOLLOWUP_MAX_TOUCHES || 4),
  highValue: Number($env.FOLLOWUP_HIGH_VALUE || 100000),
});
const now = new Date().toISOString();
const nowMs = Date.now();
const newCount = curCount + 1;
return {
  json: {
    id: inv.id,
    stage: 'drafted',
    emailSentAt: 'RESET',
    waSentAt: 'RESET',
    waStatus: '',
    waMessageId: '',
    followupCount: newCount,
    nextActionAt: action.nextActionAt || '',
    followupBucket: action.followupBucket || '',
    cadenceState: action.cadenceState || 'active',
    promiseDate: inv.promiseDate || '',
    lastTouchAt: nowMs,
    updatedAt: now,
    cadenceReason: action.reason,
    classification,
    logReason: action.reason,
    logBucket: action.followupBucket,
    escalate: action.cadenceState === 'closed' && newCount >= Number($env.FOLLOWUP_MAX_TOUCHES || 4),
  },
};
`;

const workflow = {
  name: "dunnly-followup",
  nodes: [
    {
      id: "sched-followup-1",
      name: "Schedule Trigger",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.2,
      position: [0, 0],
      parameters: {
        rule: { interval: [{ field: "cronExpression", expression: "0 9 * * *" }] },
        timezone: "Asia/Kolkata",
      },
    },
    {
      id: "set-config-followup-1",
      name: "Config",
      type: "n8n-nodes-base.set",
      typeVersion: 3.4,
      position: [260, 0],
      parameters: {
        assignments: {
          assignments: [
            { name: "enabled", type: "string", value: "={{ $env.FOLLOWUP_ENABLED || 'true' }}" },
            { name: "batchCap", type: "number", value: "={{ Number($env.FOLLOWUP_BATCH_CAP || 25) }}" },
          ],
        },
      },
    },
    {
      id: "if-enabled-followup-1",
      name: "Enabled?",
      type: "n8n-nodes-base.if",
      typeVersion: 2,
      position: [520, 0],
      parameters: {
        conditions: {
          combinator: "and",
          conditions: [
            {
              leftValue: "={{ $json.enabled }}",
              rightValue: "true",
              operator: { type: "string", operation: "equals" },
            },
          ],
        },
      },
    },
    {
      id: "sheets-read-followup-1",
      name: "Read invoices",
      type: "n8n-nodes-base.googleSheets",
      typeVersion: 4.5,
      position: [780, 0],
      parameters: {
        resource: "sheet",
        operation: "read",
        documentId: {
          __rl: true,
          value: "1qk-kY0gwgDU9Sef-lvDLRZEe-W-m1AUZtm4inJb9ph0",
          mode: "id",
        },
        sheetName: { __rl: true, value: "invoices", mode: "name" },
        options: {},
      },
      credentials: {
        googleSheetsOAuth2Api: { id: "XTaQHKonHKfxw3GX", name: "Google Sheets account" },
      },
    },
    {
      id: "code-select-due-1",
      name: "Select due",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1040, 0],
      parameters: { mode: "runOnceForAllItems", jsCode: selectDueCode },
    },
    {
      id: "if-close-only-1",
      name: "Close row?",
      type: "n8n-nodes-base.if",
      typeVersion: 2,
      position: [1300, 0],
      parameters: {
        conditions: {
          combinator: "and",
          conditions: [
            {
              leftValue: "={{ $json.cadenceState }}",
              rightValue: "closed",
              operator: { type: "string", operation: "equals" },
            },
          ],
        },
      },
    },
    {
      id: "sheets-close-row-1",
      name: "Close zero balance",
      type: "n8n-nodes-base.googleSheets",
      typeVersion: 4.5,
      position: [1560, -120],
      parameters: {
        resource: "sheet",
        operation: "update",
        documentId: {
          __rl: true,
          value: "1qk-kY0gwgDU9Sef-lvDLRZEe-W-m1AUZtm4inJb9ph0",
          mode: "id",
        },
        sheetName: { __rl: true, value: "invoices", mode: "name" },
        columns: {
          mappingMode: "defineBelow",
          matchingColumns: ["id"],
          value: {
            id: "={{ $json.id }}",
            cadenceState: "closed",
            nextActionAt: "",
            updatedAt: "={{ $json.updatedAt }}",
          },
        },
        options: {},
      },
      credentials: {
        googleSheetsOAuth2Api: { id: "XTaQHKonHKfxw3GX", name: "Google Sheets account" },
      },
    },
    {
      id: "limit-followup-1",
      name: "Limit",
      type: "n8n-nodes-base.limit",
      typeVersion: 1,
      position: [1560, 80],
      parameters: { maxItems: "={{ $('Config').item.json.batchCap }}" },
    },
    {
      id: "loop-followup-1",
      name: "Loop Over Items",
      type: "n8n-nodes-base.splitInBatches",
      typeVersion: 3,
      position: [1820, 80],
      parameters: { batchSize: 1, options: {} },
    },
    {
      id: "http-redraft-1",
      name: "Request redraft",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [2080, 0],
      continueOnFail: true,
      parameters: {
        method: "POST",
        url: "={{ ($env.N8N_PUBLIC_WEBHOOK_BASE || 'https://n8n.piyushtater.com/webhook') + '/dunnly/invoices/draft' }}",
        authentication: "predefinedCredentialType",
        nodeCredentialType: "httpHeaderAuth",
        sendBody: true,
        specifyBody: "json",
        jsonBody:
          "={{ JSON.stringify({ invoiceId: $json.id, mode: 'redraft' }) }}",
        options: {},
      },
      credentials: {
        httpHeaderAuth: { id: "aXMj4HkLU3j2VBVy", name: "Header Auth account 2" },
      },
    },
    {
      id: "if-redraft-ok-1",
      name: "Redraft ok?",
      type: "n8n-nodes-base.if",
      typeVersion: 2,
      position: [2340, 0],
      parameters: {
        conditions: {
          combinator: "and",
          conditions: [
            {
              leftValue: "={{ $json.ok === true && $json.invoice ? 'yes' : 'no' }}",
              rightValue: "yes",
              operator: { type: "string", operation: "equals" },
            },
          ],
        },
      },
    },
    {
      id: "code-log-fail-1",
      name: "Log redraft failed",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [2600, 120],
      parameters: {
        mode: "runOnceForEachItem",
        jsCode: `const inv = $('Loop Over Items').item.json;
return { json: {
  id: inv.id,
  followupCount: inv.followupCount || 0,
  bucket: inv.followupBucket || '',
  nextActionAt: inv.nextActionAt || '',
  classification: inv.classification || '',
  reason: 'redraft_failed',
  channel: 'scheduler',
} };`,
      },
    },
    {
      id: "sheets-log-fail-1",
      name: "Append redraft failed log",
      type: "n8n-nodes-base.googleSheets",
      typeVersion: 4.5,
      position: [2860, 120],
      parameters: {
        resource: "sheet",
        operation: "append",
        documentId: {
          __rl: true,
          value: "1qk-kY0gwgDU9Sef-lvDLRZEe-W-m1AUZtm4inJb9ph0",
          mode: "id",
        },
        sheetName: { __rl: true, value: "followup_log", mode: "name" },
        columns: {
          mappingMode: "defineBelow",
          value: {
            timestamp: "={{ $now.toISO() }}",
            id: "={{ $json.id }}",
            followupCount: "={{ $json.followupCount }}",
            bucket: "={{ $json.bucket }}",
            nextActionAt: "={{ $json.nextActionAt }}",
            classification: "={{ $json.classification }}",
            reason: "={{ $json.reason }}",
            channel: "={{ $json.channel }}",
          },
        },
        options: { useAppend: true },
      },
      credentials: {
        googleSheetsOAuth2Api: { id: "XTaQHKonHKfxw3GX", name: "Google Sheets account" },
      },
      continueOnFail: true,
    },
    {
      id: "code-compute-rearm-1",
      name: "Compute next action",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [2600, -80],
      parameters: { mode: "runOnceForEachItem", jsCode: computeRearmCode },
    },
    {
      id: "sheets-rearm-1",
      name: "Re-arm row",
      type: "n8n-nodes-base.googleSheets",
      typeVersion: 4.5,
      position: [2860, -80],
      parameters: {
        resource: "sheet",
        operation: "update",
        documentId: {
          __rl: true,
          value: "1qk-kY0gwgDU9Sef-lvDLRZEe-W-m1AUZtm4inJb9ph0",
          mode: "id",
        },
        sheetName: { __rl: true, value: "invoices", mode: "name" },
        columns: {
          mappingMode: "defineBelow",
          matchingColumns: ["id"],
          value: {
            id: "={{ $json.id }}",
            stage: "drafted",
            emailSentAt: "RESET",
            waSentAt: "RESET",
            waStatus: "",
            waMessageId: "",
            followupCount: "={{ $json.followupCount }}",
            nextActionAt: "={{ $json.nextActionAt }}",
            followupBucket: "={{ $json.followupBucket }}",
            cadenceState: "={{ $json.cadenceState }}",
            promiseDate: "={{ $json.promiseDate }}",
            lastTouchAt: "={{ $json.lastTouchAt }}",
            updatedAt: "={{ $json.updatedAt }}",
          },
        },
        options: {},
      },
      credentials: {
        googleSheetsOAuth2Api: { id: "XTaQHKonHKfxw3GX", name: "Google Sheets account" },
      },
    },
    {
      id: "sheets-log-followup-1",
      name: "Append followup_log",
      type: "n8n-nodes-base.googleSheets",
      typeVersion: 4.5,
      position: [3120, -80],
      parameters: {
        resource: "sheet",
        operation: "append",
        documentId: {
          __rl: true,
          value: "1qk-kY0gwgDU9Sef-lvDLRZEe-W-m1AUZtm4inJb9ph0",
          mode: "id",
        },
        sheetName: { __rl: true, value: "followup_log", mode: "name" },
        columns: {
          mappingMode: "defineBelow",
          value: {
            timestamp: "={{ $now.toISO() }}",
            id: "={{ $json.id }}",
            followupCount: "={{ $json.followupCount }}",
            bucket: "={{ $json.logBucket }}",
            nextActionAt: "={{ $json.nextActionAt }}",
            classification: "={{ $json.classification }}",
            reason: "={{ $json.logReason }}",
            channel: "scheduler",
          },
        },
        options: { useAppend: true },
      },
      credentials: {
        googleSheetsOAuth2Api: { id: "XTaQHKonHKfxw3GX", name: "Google Sheets account" },
      },
      continueOnFail: true,
    },
    {
      id: "if-escalate-1",
      name: "Escalate exhausted?",
      type: "n8n-nodes-base.if",
      typeVersion: 2,
      position: [3380, -80],
      parameters: {
        conditions: {
          combinator: "and",
          conditions: [
            {
              leftValue: "={{ $json.escalate ? 'yes' : 'no' }}",
              rightValue: "yes",
              operator: { type: "string", operation: "equals" },
            },
          ],
        },
      },
    },
    {
      id: "http-teams-escalate-1",
      name: "Notify Teams escalations",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [3640, -160],
      continueOnFail: true,
      parameters: {
        method: "POST",
        url: "={{ $env.TEAMS_WEBHOOK_ESCALATIONS || $env.TEAMS_INCOMING_WEBHOOK_URL }}",
        sendBody: true,
        specifyBody: "json",
        jsonBody:
          "={{ JSON.stringify({ text: 'Follow-up exhausted for invoice ' + $json.id + ' — max touches reached.' }) }}",
        options: {},
      },
    },
  ],
  connections: {
    "Schedule Trigger": { main: [[{ node: "Config", type: "main", index: 0 }]] },
    Config: { main: [[{ node: "Enabled?", type: "main", index: 0 }]] },
    "Enabled?": {
      main: [[{ node: "Read invoices", type: "main", index: 0 }], []],
    },
    "Read invoices": { main: [[{ node: "Select due", type: "main", index: 0 }]] },
    "Select due": { main: [[{ node: "Close row?", type: "main", index: 0 }]] },
    "Close row?": {
      main: [
        [{ node: "Close zero balance", type: "main", index: 0 }],
        [{ node: "Limit", type: "main", index: 0 }],
      ],
    },
    "Close zero balance": { main: [] },
    Limit: { main: [[{ node: "Loop Over Items", type: "main", index: 0 }]] },
    "Loop Over Items": {
      main: [[], [{ node: "Request redraft", type: "main", index: 0 }]],
    },
    "Request redraft": { main: [[{ node: "Redraft ok?", type: "main", index: 0 }]] },
    "Redraft ok?": {
      main: [
        [{ node: "Compute next action", type: "main", index: 0 }],
        [{ node: "Log redraft failed", type: "main", index: 0 }],
      ],
    },
    "Log redraft failed": {
      main: [[{ node: "Append redraft failed log", type: "main", index: 0 }]],
    },
    "Append redraft failed log": {
      main: [[{ node: "Loop Over Items", type: "main", index: 0 }]],
    },
    "Compute next action": { main: [[{ node: "Re-arm row", type: "main", index: 0 }]] },
    "Re-arm row": { main: [[{ node: "Append followup_log", type: "main", index: 0 }]] },
    "Append followup_log": {
      main: [[{ node: "Escalate exhausted?", type: "main", index: 0 }]],
    },
    "Escalate exhausted?": {
      main: [
        [{ node: "Notify Teams escalations", type: "main", index: 0 }],
        [{ node: "Loop Over Items", type: "main", index: 0 }],
      ],
    },
    "Notify Teams escalations": {
      main: [[{ node: "Loop Over Items", type: "main", index: 0 }]],
    },
  },
  active: false,
  settings: { executionOrder: "v1" },
  meta: { instanceId: "dunnly" },
};

const out = path.join(ROOT, "n8n/workflows/dunnly-followup.json");
fs.writeFileSync(out, JSON.stringify(workflow, null, 2) + "\n");
console.log("wrote", out);
