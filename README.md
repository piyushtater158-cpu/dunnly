# Dunnly

AI autopilot for accounts-receivable collections: pull overdue invoices, draft reminders, send via email (Power Automate → Gmail) and WhatsApp (Twilio), classify replies, and escalate to Microsoft Teams.

## Live architecture

- **Dashboard:** Next.js app on Vercel — SSE push sync (no background polling)
- **Backend:** n8n on `n8n.piyushtater.com`
- **Ledger:** Google Sheets → Apps Script push → n8n cache → dashboard notify

See [n8n/README.md](n8n/README.md) for webhook contract and workflow setup.

## Quick start (local)

```bash
npm install
npm run dev
```

Unset `N8N_BASE_URL` in `.env` to run against the built-in mock backend (`lib/store.ts`).

## Environment

Copy `.env.example` to `.env` and set:

| Variable | Purpose |
|---|---|
| `N8N_BASE_URL` | n8n instance (e.g. `https://n8n.piyushtater.com`) |
| `N8N_WEBHOOK_SECRET` | Header `x-dunnly-secret` for n8n webhooks |

Never commit `.env` or files containing Power Automate invoke URLs.

## Google Sheets push sync

Install Apps Script on the ledger spreadsheet using [n8n/docs/google-sheets-push-sync.md](n8n/docs/google-sheets-push-sync.md).

## Scripts

```bash
node scripts/push-n8n-workflows.js
node scripts/probe-sheet-sync.js --bootstrap
```
