# Google Sheets → n8n push sync (zero-poll dashboard)

The Dunnly ledger lives in Google Sheets. **Apps Script pushes** a full snapshot to n8n on every sheet change. n8n normalizes, caches, and **notifies the dashboard via SSE** — there is no background polling.

## Architecture

```
Google Sheet (invoices + inbound_log)
  → Apps Script onChange (debounced) + 1-min backup
  → POST /webhook/dunnly/invoices/sync
  → n8n dunnly-read: normalize + save ledger cache
  → POST DASHBOARD_NOTIFY_URL (/api/invoices/notify)
  → Next.js SSE (/api/invoices/stream) → dashboard UI updates
```

Spreadsheet: [Dunnly AR](https://docs.google.com/spreadsheets/d/1qk-kY0gwgDU9Sef-lvDLRZEe-W-m1AUZtm4inJb9ph0/edit)

**End-to-end (PA inbound example):** email reply → PA → n8n inbound → sheet write → Apps Script onChange → n8n sync → notify → SSE → UI shows `stage=replied` without refresh or poll window.

## Prerequisites

| Where | Property | Value |
|---|---|---|
| Apps Script Properties | `DUNNLY_SYNC_URL` | `https://n8n.piyushtater.com/webhook/dunnly/invoices/sync` |
| Apps Script Properties | `DUNNLY_SECRET` | Same as `N8N_WEBHOOK_SECRET` (header `x-dunnly-secret`) |
| Oracle n8n host | `DASHBOARD_NOTIFY_URL` | `https://<your-app>/api/invoices/notify` |
| Oracle n8n host | `DASHBOARD_NOTIFY_SECRET` | Optional alias; defaults to `N8N_WEBHOOK_SECRET` |

**Deployed (2026-08-31):** workflow `dunnly-read` id `0ONcyB3VRvNjk6ba` on `n8n.piyushtater.com`.

## Apps Script source

In the spreadsheet: **Extensions → Apps Script**. Project name: `DunnlyLedgerSync`.

```javascript
/**
 * Dunnly AR — push ledger snapshot to n8n on sheet change.
 * Script Properties: DUNNLY_SYNC_URL, DUNNLY_SECRET
 */

var DEBOUNCE_MS = 3000;
var DEBOUNCE_KEY = 'DUNNLY_LAST_SYNC_AT';
var DEBOUNCE_PENDING_KEY = 'DUNNLY_SYNC_PENDING';

function getConfig_() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('DUNNLY_SYNC_URL');
  var secret = props.getProperty('DUNNLY_SECRET');
  if (!url || !secret) {
    throw new Error('Set Script Properties DUNNLY_SYNC_URL and DUNNLY_SECRET');
  }
  return { url: url, secret: secret };
}

function readSheetAsObjects_(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  var range = sheet.getDataRange();
  var values = range.getDisplayValues();
  if (values.length < 2) return [];
  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var obj = {};
    var empty = true;
    for (var c = 0; c < headers.length; c++) {
      var key = String(headers[c] || '').trim();
      if (!key) continue;
      var val = values[i][c];
      if (val !== '') empty = false;
      obj[key] = val;
    }
    if (!empty) rows.push(obj);
  }
  return rows;
}

function buildPayload_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var invoiceRows = readSheetAsObjects_('invoices').filter(function (r) {
    return String(r.id || '').trim() !== '';
  });
  var inboundRows = readSheetAsObjects_('inbound_log').filter(function (r) {
    return String(r.sid || '').trim() !== '';
  });
  return {
    source: 'google-sheets',
    spreadsheetId: ss.getId(),
    syncedAt: new Date().toISOString(),
    invoiceRows: invoiceRows,
    inboundRows: inboundRows,
  };
}

function pushToN8n_(payload) {
  var cfg = getConfig_();
  var res = UrlFetchApp.fetch(cfg.url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-dunnly-secret': cfg.secret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('n8n sync failed HTTP ' + code + ': ' + body.slice(0, 500));
  }
  return { code: code, body: body };
}

/** Manual run / bootstrap — run once from Apps Script editor. */
function syncLedger() {
  var payload = buildPayload_();
  var result = pushToN8n_(payload);
  Logger.log('syncLedger ok: ' + result.body);
  PropertiesService.getScriptProperties().setProperty(DEBOUNCE_KEY, String(Date.now()));
  return result;
}

/** Installable onChange handler (debounced). */
function syncLedgerDebounced(e) {
  var props = PropertiesService.getScriptProperties();
  var now = Date.now();
  var last = Number(props.getProperty(DEBOUNCE_KEY) || 0);
  if (now - last < DEBOUNCE_MS) {
    props.setProperty(DEBOUNCE_PENDING_KEY, '1');
    return;
  }
  props.deleteProperty(DEBOUNCE_PENDING_KEY);
  syncLedger();
}

/** Time-based backup — catches missed onChange (e.g. n8n API writes). */
function syncLedgerBackup() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(DEBOUNCE_PENDING_KEY) === '1') {
    props.deleteProperty(DEBOUNCE_PENDING_KEY);
  }
  syncLedger();
}

/** One-time: create installable triggers. Run from editor after authorizing. */
function installTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === 'syncLedgerDebounced' || fn === 'syncLedgerBackup') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('syncLedgerDebounced')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onChange()
    .create();
  ScriptApp.newTrigger('syncLedgerBackup')
    .timeBased()
    .everyMinutes(1)
    .create();
  Logger.log('Triggers installed: onChange + every 1 min');
}
```

## Human install steps

1. Open the [spreadsheet](https://docs.google.com/spreadsheets/d/1qk-kY0gwgDU9Sef-lvDLRZEe-W-m1AUZtm4inJb9ph0/edit).
2. **Extensions → Apps Script** → paste code above → Save.
3. **Project Settings → Script Properties** → add `DUNNLY_SYNC_URL` and `DUNNLY_SECRET`.
4. Run `installTriggers()` → authorize → run `syncLedger()` (bootstrap).
5. Confirm n8n execution on POST `/dunnly/invoices/sync` with `invoiceCount > 0`.

---

## Browser agent prompt

Copy this entire section for a browser automation agent. Assumes **Google is already logged in as sheet owner/editor**.

### Browser Agent Prompt: Install DunnlyLedgerSync Apps Script

**Agent role:** You are a meticulous browser automation agent performing a one-time production install of the Dunnly AR ledger push-sync package in Google Sheets. You must not skip authorization steps, must verify each step before proceeding, and must capture evidence (screenshots or log text) at checkpoints.

**Mission:** Every save/edit to the Dunnly AR spreadsheet must POST a full snapshot (`invoices` + `inbound_log` tabs) to n8n `POST /webhook/dunnly/invoices/sync`. This replaces all pull/poll-based ledger reads. The dashboard updates via SSE when n8n finishes processing — there is **no polling**.

**Hard constraints:**
- Do NOT create any webhook inside Google Apps Script (no `doPost` deploy-as-web-app).
- Do NOT hardcode secrets in source code — use Script Properties only.
- Do NOT modify sheet data except for one optional test cell edit in Phase G.
- Project name must be exactly `DunnlyLedgerSync`.

**Target spreadsheet:**
`https://docs.google.com/spreadsheets/d/1qk-kY0gwgDU9Sef-lvDLRZEe-W-m1AUZtm4inJb9ph0/edit`

**Verify tabs exist before scripting:** `invoices`, `inbound_log`, `send_log`, `classification_log`.

**Credentials (human confirms before you start — do not log full secret):**

| Script Property | Value |
|---|---|
| `DUNNLY_SYNC_URL` | `https://n8n.piyushtater.com/webhook/dunnly/invoices/sync` |
| `DUNNLY_SECRET` | Value of `N8N_WEBHOOK_SECRET` (HTTP header `x-dunnly-secret`) |

#### Phase A — Open Apps Script editor

1. Navigate to the spreadsheet URL. Confirm you are signed in (avatar visible, no login redirect).
2. Menu: **Extensions → Apps Script**.
3. If project `DunnlyLedgerSync` exists, open it. Otherwise create new and rename via **Project Settings → Project name**.
4. Delete default `Code.gs` contents completely.

#### Phase B — Install source code

5. Paste the **entire** Apps Script from the code block above in this file.
6. **File → Save** (Ctrl+S). Confirm no syntax errors in editor.

#### Phase C — Script Properties

7. **Project Settings** (gear icon) → **Script Properties → Add script property**:
   - `DUNNLY_SYNC_URL` → sync URL above
   - `DUNNLY_SECRET` → secret above
8. Save. Return to **Editor** tab.

#### Phase D — Authorize and install triggers

9. Function dropdown → `installTriggers` → **Run**.
10. Authorization: Review Permissions → Google account → Advanced → Go to DunnlyLedgerSync (unsafe) → Allow.
11. **Executions** (clock icon): `installTriggers` status = **Completed**; log says `Triggers installed: onChange + every 1 min`.
12. **Triggers** (alarm clock): exactly **2** triggers:
    - `syncLedgerDebounced` — From spreadsheet — On change
    - `syncLedgerBackup` — Time-driven — Every minute

#### Phase E — Bootstrap sync

13. Run `syncLedger`.
14. Execution log: `syncLedger ok:` with JSON `{ ok: true, invoiceCount: N, ... }`.
15. HTTP 401/403 → wrong `DUNNLY_SECRET`. HTTP 404 → `dunnly-read` not active.

#### Phase F — Verify n8n

16. Open `https://n8n.piyushtater.com` → **Executions** / workflow `dunnly-read`.
17. POST `/dunnly/invoices/sync` execution within last 2 minutes.
18. Nodes: `Sync Webhook → Unwrap → Aggregate → Normalize → Save ledger cache` (+ `Notify dashboard` if `DASHBOARD_NOTIFY_URL` set).
19. `invoiceCount > 0`.

#### Phase G — Live change test

20. Spreadsheet tab `invoices`: edit `stage` on a test row (e.g. `INV-1`).
21. Wait 5 seconds.
22. Apps Script **Executions**: new `syncLedgerDebounced` or `syncLedger` run.
23. n8n: second sync execution within 10s.

#### Phase H — Optional inbound tab test

24. On `inbound_log`, edit any cell (e.g. set `status` to `pending`).
25. Confirm another sync execution fires.

**Success criteria:**
- [ ] Script Properties set (2 keys)
- [ ] 2 triggers installed
- [ ] Bootstrap `syncLedger` HTTP 200
- [ ] n8n sync with `invoiceCount > 0`
- [ ] Sheet edit triggers second sync within ~5s
- [ ] Dashboard updates without refresh when SSE + `DASHBOARD_NOTIFY_URL` configured

**Failure playbook:**

| Symptom | Fix |
|---|---|
| Authorization blocked | Re-run `installTriggers`; use sheet owner account |
| `Exception: Address unavailable` | Wrong `DUNNLY_SYNC_URL` or n8n down |
| `invoiceCount: 0` | Tab not named `invoices` or rows missing `id` |
| onChange never fires | Re-run `installTriggers`; check Triggers page |
| n8n writes don't trigger sync | Wait up to 1 min for backup trigger |
| Dashboard stale | Set `DASHBOARD_NOTIFY_URL` on n8n host; confirm SSE shows LIVE |

**Deliverables to human:** Screenshots of Triggers page, successful `syncLedger` log, n8n execution with invoiceCount, note of test row edited.

---

## Verify from laptop

```bash
# Bootstrap (Apps Script syncLedger or fixture)
node scripts/probe-sheet-sync.js --bootstrap

# Optional: smoke-test notify → SSE (local dev server running)
node scripts/probe-sheet-sync.js --bootstrap --notify http://localhost:3000/api/invoices/notify
```

```bash
curl -s -H "x-dunnly-secret: YOUR_SECRET" \
  https://n8n.piyushtater.com/webhook/dunnly/invoices
```

## Push workflow to n8n

```bash
node scripts/push-n8n-workflows.js
node scripts/activate-dunnly-read.js
```

Set on Oracle host (`/etc/n8n/ms.env`):

```bash
DASHBOARD_NOTIFY_URL=https://<your-vercel-app>/api/invoices/notify
```

Then `docker compose up -d n8n`.

## Vercel/serverless note

SSE uses an in-memory bus on each Node instance. For demo/single-user this is fine; multi-instance may occasionally miss a push until SSE reconnects (client refetches on mount).
