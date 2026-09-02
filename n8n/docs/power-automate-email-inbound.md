# Dunnly AR — Gmail inbound via Power Automate

Inbound customer **email replies** are captured by a **new** Power Automate cloud flow and forwarded to n8n. n8n matches by customer email identity, updates the Google Sheet, classifies the reply, and posts **one** Teams notification.

## Architecture

```
Customer reply (From: customer@gmail.com)
  → Gmail inbox piyushtater158@gmail.com
  → PA: Dunnly AR Receive Email (trigger + filter + HTTP POST)
  → n8n: POST /webhook/dunnly/email/inbound
  → Match invoices.email + cross-check subject INV-xxxxx
  → Sheet: invoices.replied + inbound_log
  → classify (matched) OR #ar-escalations (unmatched/ambiguous)
  → Apps Script onChange → n8n sync → SSE dashboard (no poll)
```

PA is a **thin relay** only — no Teams, no Sheet writes in PA.

## Create the PA flow (human step)

Environment: **Piyush (default)** — `Default-1b146de3-1539-4561-beed-4422cc62dec1`

**Do not edit** existing flows: Dunnly AR Send Email, Escalations, Disputes, Payments, Alerts.

### Flow: `Dunnly AR Receive Email`

1. **Trigger:** When a new email arrives (V3) — Gmail **Dunnly** connection → `piyushtater158@gmail.com`
2. **Condition:** `From` does not contain `piyushtater158@gmail.com`
3. **HTTP POST** to `https://n8n.piyushtater.com/webhook/dunnly/email/inbound`

```json
{
  "messageId": "<Gmail message id>",
  "fromEmail": "<From address>",
  "subject": "<Subject>",
  "bodyPlain": "<plain reply text, max ~2000 chars>",
  "receivedAt": "<ISO8601>"
}
```

**Important — send plain reply text only**

- Use Gmail’s **plain-text body** action (not HTML/MIME) for `bodyPlain`.
- Send only the customer’s new reply when possible — not the full thread with headers.
- n8n runs `normalizeMessageBody()` on ingest (strips HTML, trims quoted reply chains), but cleaner PA output yields better sheet and dashboard text.

Headers: `Content-Type: application/json`  
Optional: `x-dunnly-inbound-secret` if `DUNNLY_INBOUND_EMAIL_SECRET` is set on n8n host.

4. Turn flow **On**. No Teams action in this flow.

## n8n workflow

File: [`../workflows/dunnly-inbound-email.json`](../workflows/dunnly-inbound-email.json)

| Match result | Dashboard | Teams |
|---|---|---|
| Unique email identity | `stage=replied`, `replyChannel=email` | One post via classify |
| Unmatched / ambiguous | INBOUND tab pending | One `#ar-escalations` post |

### Identity matching rules

- Primary key: normalized `fromEmail` ↔ `invoices.email`
- Requires open row (`sent`/`replied`) with `emailSentAt` set
- Subject `INV-xxxxx` cross-check: must agree with identity match
- Same email on 2+ open invoices → pending (human review)

### Demo data

`invoices.email` must be the address you **reply from** during E2E (e.g. `piyushtater5555@gmail.com`), not the Dunnly sender (`158`).

## Push workflow

```bash
node scripts/sync-normalize-message-body.js
node scripts/push-n8n-workflows.js
```

Activate `dunnly-inbound-email` in n8n UI after first create.

## Human gates before live E2E

- [ ] Google Cloud OAuth app for Gmail connection **Published** or **Internal** (not Testing-only)
- [ ] `N8N_WEBHOOK_SECRET` + `TEAMS_WEBHOOK_*` on Oracle n8n host
- [ ] Hero invoice `invoices.email` = your actual reply-from address
