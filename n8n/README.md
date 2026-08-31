# Dunnly — N8N backend

This directory has the importable N8N workflows that implement Dunnly's real backend, plus
everything needed to wire them up. Until you do this setup, the app runs entirely on its mock
backend (`lib/store.ts`) — nothing here is required to develop or demo the front end.

## Ledger (source of truth)

**Google Sheet:** [Dunnly AR (probe)](https://docs.google.com/spreadsheets/d/1qk-kY0gwgDU9Sef-lvDLRZEe-W-m1AUZtm4inJb9ph0/edit)

Spreadsheet ID `1qk-kY0gwgDU9Sef-lvDLRZEe-W-m1AUZtm4inJb9ph0`. Tabs: `invoices`, `send_log`,
`classification_log`, `inbound_log`.

There is no CSV/Excel path — live mode uses this Sheet as the ledger.

**Push sync (live):** Apps Script POSTs sheet snapshots to n8n; n8n notifies the dashboard via SSE (`/api/invoices/stream`). No background polling. Setup: [google-sheets-push-sync.md](docs/google-sheets-push-sync.md).

### Overdue age (date of supply + credit)

Sheet **inputs** (edit these): `dateOfSupply` (aliases: `Date of Supply`), `creditDays`
(aliases: `Credit Line`, `creditLine`).

Every workflow **Normalize / Aggregate** derives (IST calendar, Asia/Kolkata):

```
dueDate     = dateOfSupply + creditDays
daysOverdue = max(0, todayIST - dueDate)
```

No midnight cron — age rolls when the IST calendar day advances on the next read.
If supply/credit are missing, the stored `daysOverdue` cell is used as fallback.

JSON contract + fixtures: [`schema/invoices.row.schema.json`](schema/invoices.row.schema.json).
Validate: `node scripts/validate-invoice-schema.js`.

`lib/store.ts` defines the TypeScript `Invoice` shape and the **mock** ledger when
`N8N_BASE_URL` is unset. It does not read Google Sheets. Live mode: Sheet → n8n Normalize
→ `lib/n8n.ts` `toInvoice()` → same `Invoice` type.

### Demo contacts (Twilio sandbox E2E)

- **Four Gmail inboxes** cycled across rows: `tooncreatives158@gmail.com`,
  `piyushtater5555@gmail.com`, `piyushjain2090@gmail.com`, `kdfoods101@gmail.com`.
- **Only `INV-24245` (Piyush Tater Demo Co)** has `phone = ADMIN_PHONE` and `waOptIn=TRUE`.
  That is the WhatsApp demo party — inbound replies auto-attach to this invoice.
  Email is pinned to `piyushtater5555@gmail.com`.
- All other rows keep fictitious `+1 xxx 555 xxxx` phones (WA gate skips as `test-number`).
- Seed the Sheet (pick one):
  1. **n8n UI (preferred if API key fails):** Import
     [`n8n/workflows/dunnly-seed-demo-contacts.json`](workflows/dunnly-seed-demo-contacts.json)
     → Execute once.
  2. **CLI:** `node scripts/seed-demo-contacts.js` (needs working `N8N_API_KEY` + `ADMIN_PHONE`).
  3. **Manual:** On row `INV-24245` set `customer=Piyush Tater Demo Co`,
     `email=piyushtater5555@gmail.com`, `phone=+91 60015 07395` (or your `ADMIN_PHONE`),
     `waOptIn=TRUE`, `waOptOut=FALSE`. Clear `ADMIN_PHONE` from every other row.

## Contract

One canonical invoice record on the wire, matching `Invoice` in `../lib/store.ts` (see
`../lib/n8n.ts` for the exact mapping, including the ISO-string-on-the-wire /
epoch-ms-in-the-app conversion for `updatedAt`). Fields include `email`, `waStatus`,
`waOptIn`, `waOptOut`, `dateOfSupply`, `creditDays`, `dueDate`, and derived `daysOverdue`.

`GET /dunnly/invoices` also returns `inbound`: pending rows from `inbound_log`
(unmatched replies, START/STOP). Happy-path demo replies are written onto the invoice
itself (`stage=replied`) and do **not** stay pending.

Envelopes:
```jsonc
{ "ok": true,  "invoice":  { ...record } }
{ "ok": true,  "invoices": [ { ...record } ], "inbound": [ { ...pending } ] }
{ "ok": false, "step": "send", "failureReason": "...", "invoice": { ...record, "stage": "failed" } }
```

**The `ok:false` case is returned with HTTP 200, not an error status.** The frontend treats any
non-2xx as "the whole backend is unreachable" (the black banner) — a single failed send/classify
step is not that; it's a normal, visible row in the FAILED tab. Only a truly unreachable N8N
(network error, 403 from a bad secret, 5xx) should produce a non-2xx.

| # | Path | Method | Request body |
|---|---|---|---|
| 1 | `/dunnly/invoices` | GET | — (reads n8n ledger cache; bootstrap via Apps Script or `probe-sheet-sync.js --bootstrap`) |
| 1b | `/dunnly/invoices/sync` | POST | `{ invoiceRows, inboundRows, syncedAt?, source?, spreadsheetId? }` — Google Apps Script push |
| 2 | `/dunnly/invoices/pull` | POST | `{limit?, autoSend}` — responds immediately, drafts happen in the background |
| 3 | `/dunnly/invoices/draft` | POST | `{invoiceId, mode:"draft"\|"redraft"\|"save", emailBody?, waBody?}` |
| 4 | `/dunnly/invoices/send` | POST | `{invoiceId, emailBody?, waBody?, isRetry, waProvider?, waMode?}` |
| 5 | `/dunnly/invoices/classify` | POST | `{invoiceId, replyText, source?}` (`source`: `email` \| `whatsapp` \| `manual`) |
| 6 | `/dunnly/email/inbound` | POST | `{messageId, fromEmail, subject, bodyPlain, receivedAt}` — PA Gmail inbound |
| 7 | `/dunnly/wa/inbound` | POST | Twilio form-urlencoded inbound (no Dunnly secret — set in Sandbox Console) |
| 8 | `/dunnly/wa/status` | POST | Twilio status callback (form-urlencoded) |
| 9 | `/dunnly/inbound/attach` | POST | `{sid, invoiceId}` — unmatched fallback |
| 10 | `/dunnly/inbound/ignore` | POST | `{sid}` |

**No auto-send.** `AUTO_SEND` stays false; `dunnly-pull` does not call `dunnly-send`.

## Live architecture

| Channel | Transport | Notes |
|---|---|---|
| **Email** | Power Automate → Gmail | `dunnly-send` POSTs `$env.PA_EMAIL_WEBHOOK_URL`. No Graph, no n8n Gmail. |
| **Teams** | Power Automate webhooks | Four channels; optional SharePoint `Dunnly_AR_Inbox`. |
| **WhatsApp** | Twilio sandbox | Native `twilioApi` credential. Meta Cloud API is not the live path. |
| **Ledger** | Google Sheets → Apps Script → n8n cache → SSE dashboard | Other workflows still read/write sheet via OAuth. |
| **LLM** | OpenRouter | Native `openRouterApi` credential. |

Instance: `n8n.piyushtater.com`. Secrets live in n8n credentials or Oracle `/etc/n8n/ms.env` —
**nothing secret is written into the workflow JSON**.

### Credentials (current)

| What | Status |
|---|---|
| Header Auth (`x-dunnly-secret`) | Wired on webhook nodes |
| Google Sheets OAuth2 | Wired; spreadsheet shared |
| OpenRouter | Wired |
| Twilio API (`Twilio account`) | Live sandbox send + inbound |
| `PA_EMAIL_WEBHOOK_URL` on n8n host | Live — [power-automate-email-gmail.md](docs/power-automate-email-gmail.md) |
| `TEAMS_WEBHOOK_*` (×4 + incoming alias) | Live — [power-automate-teams-setup.md](docs/power-automate-teams-setup.md), [pa-flow-inventory.md](docs/pa-flow-inventory.md) |
| Graph `MS_*` | **Not used.** New tenant has no Entra app. |

Host env: [oracle-cloud-n8n-env.md](docs/oracle-cloud-n8n-env.md). Probes:
`node scripts/probe-pa-email-webhook.js`, `node scripts/probe-teams-webhooks.js`,
`node scripts/probe-webhooks.js`, `node scripts/probe-sheet-sync.js --bootstrap`.

Reimport: **Workflows → Import from File** from `n8n/workflows/`, or `node scripts/push-n8n-workflows.js`.

## Twilio sandbox inbound

Legacy Twilio Console → Messaging → Try WhatsApp → **Sandbox settings**:

1. **When a message comes in:** `https://n8n.piyushtater.com/webhook/dunnly/wa/inbound` (HTTP POST)
2. **Status callback URL:** `https://n8n.piyushtater.com/webhook/dunnly/wa/status`

Import/activate `n8n/workflows/dunnly-inbound-wa.json` first so those paths exist.

Prereq: admin WhatsApp has texted `join <sandbox-phrase>` to `+1 415 523 8886` (session ~3 days).

Outbound uses the native Twilio node with sandbox Order Notifications body wording.
`StatusCallback` points at `/webhook/dunnly/wa/status` so `waStatus` updates on the demo row.

### E2E demo path

1. Run `scripts/seed-demo-contacts.js` — only `INV-24245` (Piyush Tater Demo Co) has `ADMIN_PHONE` + opt-in.
2. Dashboard: open Piyush Tater Demo Co → **APPROVE & SEND** → Gmail via Power Automate + WhatsApp sandbox to admin phone.
3. Reply from that WhatsApp → within ~10s the row is IN FLIGHT / `replied`; classify runs automatically → **one** Teams post.
4. Email replies: PA `Dunnly AR Receive Email` → n8n `/dunnly/email/inbound` — see [power-automate-email-inbound.md](docs/power-automate-email-inbound.md).
5. Text `STOP` → only that row opts out; next WA send skips with `opt-out`.

`invoices.waOptIn` must be `TRUE` before anything sends. Fictitious `555` phones and `.test`
emails are skipped (`waStatus: skipped:test-number`).

## Teams routing (`dunnly-classify`)

**One Teams post per matched reply.** Inbound workflows do not double-post; unmatched/ambiguous inbound posts once to `#ar-escalations`.

After LLM classify, **Should notify Teams?** fires on `dispute`, `promise`, `paid`, or `no_response`:

| Classification | Power Automate webhook env |
|---|---|
| `dispute` | `TEAMS_WEBHOOK_DISPUTES` (60d+ overdue noted in message text) |
| `promise`, `paid` | `TEAMS_WEBHOOK_PAYMENTS` |
| `no_response` | `TEAMS_WEBHOOK_ESCALATIONS` |

| Channel | Purpose | n8n env var |
|---|---|---|
| `ar-escalations` | Unmatched/ambiguous inbound; vague/no_response classify | `TEAMS_WEBHOOK_ESCALATIONS` |
| `ar-disputes` | Reply classified DISPUTE | `TEAMS_WEBHOOK_DISPUTES` |
| `ar-payments` | PROMISE / PAID | `TEAMS_WEBHOOK_PAYMENTS` |
| `ar-alerts` | Workflow failures | `TEAMS_WEBHOOK_ALERTS` |

`dunnly-inbound-wa` posts to `TEAMS_WEBHOOK_ESCALATIONS` **only** when phone identity is unmatched/ambiguous.
Unset webhooks fall back to `TEAMS_INCOMING_WEBHOOK_URL`. Invoke URLs with `sig=` stay on the
n8n host only — see [`.env.example`](../.env.example) for names.

## Google Sheet tabs

| Tab | Columns |
|---|---|
| `invoices` | … `replyText`, `replyChannel`, `repliedAt`, … `emailSentAt` |
| `send_log` | `timestamp, id, channel, recipient, body, status, providerMessageId, detail` |
| `classification_log` | `timestamp, id, replyText, classification, notified` |
| `inbound_log` | `timestamp, sid, from, body, kind, suggestedInvoiceId, attachedInvoiceId, status, messageStatus, channel, messageId` |

Phone cells starting with `+` must be forced as text (`'` prefix) or Sheets treats them as formulas.

## Cut over

Set `N8N_BASE_URL` and `N8N_WEBHOOK_SECRET` in Vercel (and `.env` for local). Unset
`N8N_BASE_URL` to fall back to the mock backend.

## Known simplifications

- **Redrafting a Failed invoice preserves `failed`** until a successful send — `dunnly-draft`
  only flips `queued → drafted`.
- **No auto-retry.** Failed rows sit in FAILED until a human clicks Retry.
- **`dunnly-pull`'s auto-send branch is not wired.** Keep `AUTO_SEND=false`.
- Invoice-normalization JS is duplicated across `dunnly-read`, `dunnly-draft`, `dunnly-send`,
  `dunnly-classify` (n8n cannot share code until a sub-workflow ID exists).
- Dashboard uses **SSE push sync** (no poll). Initial GET on load; live updates via `/api/invoices/stream`. See [google-sheets-push-sync.md](docs/google-sheets-push-sync.md).
