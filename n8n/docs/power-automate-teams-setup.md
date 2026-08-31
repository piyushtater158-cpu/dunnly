# Power Automate → Teams per-channel webhooks

Create **one cloud flow per Dunnly channel**. Each flow receives a JSON payload from n8n and posts to the target Teams channel (and optionally SharePoint).

> See also [sharepoint-ar-inbox.md](sharepoint-ar-inbox.md) and [pa-flow-inventory.md](pa-flow-inventory.md).

## Trigger type (important)

Dunnly flows use **When a Teams webhook request is received** (Teams Webhook connector), **not** "When a HTTP request is received". Both produce a valid invoke URL:

`https://default…environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/<N>/workflows/<workflow-id>/triggers/manual/paths/invoke?api-version=1&sp=…&sv=1.0&sig=…`

Copy from the trigger panel **Copy URL** — never use the browser address bar (`make.powerautomate.com/.../flows/<designer-guid>`).

**Who can trigger:** should be **Anyone** (already set on existing Dunnly flows).

## Invoke URL inventory (2026-08-30, post-migration)

Host: `default1b146de315394561beed4422cc62de.c1`. Do not paste `sig=` into this repo.

| Flow | cu | invoke workflow id | env var |
|---|---|---|---|
| Dunnly AR Send Email | 21 | `cb74df247f4d48c6be05d1f734e224b2` | `PA_EMAIL_WEBHOOK_URL` |
| Dunnly AR Escalations | 27 | `be22ee7fd8694b72b74c8eb259748b89` | `TEAMS_WEBHOOK_ESCALATIONS` |
| Dunnly AR Disputes | 03 | `bea15bf1704b44d0afdcd743ba79b40c` | `TEAMS_WEBHOOK_DISPUTES` |
| Dunnly AR Payments | 06 | `7a4a0397b791449c818503ef4392d195` | `TEAMS_WEBHOOK_PAYMENTS` |
| Dunnly AR Alerts | 27 | `7e7dad5f0a80470da8c1cf5beaa0c654` | `TEAMS_WEBHOOK_ALERTS` |

Designer flow GUIDs in the PA URL bar differ from invoke `workflow id` — that mismatch caused 405 errors on the host.

Set `TEAMS_INCOMING_WEBHOOK_URL` = same value as `TEAMS_WEBHOOK_ESCALATIONS`.

## Setup on Oracle n8n host

1. Paste full URLs into `/etc/n8n/ms.env` (see [oracle-cloud-n8n-env.md](oracle-cloud-n8n-env.md))
2. Ensure `N8N_BLOCK_ENV_ACCESS_IN_NODE` is **false** or unset (Dunnly classify reads `$env` in a Code node)
3. `cd /home/ubuntu && docker compose up -d n8n`
4. Smoke test from laptop: `node scripts/probe-teams-webhooks.js`

## Webhook JSON from n8n (classify)

```json
{
  "text": "**DISPUTE** — Invoice INV-1: \"...\"",
  "invoiceId": "INV-1",
  "customer": "Acme Co",
  "classification": "dispute",
  "replyText": "...",
  "daysOverdue": 72,
  "stage": "notified",
  "teamsChannel": "ar-disputes",
  "notifiedAt": "2026-08-28T12:00:00.000Z",
  "replyReceivedAt": "2026-08-28T11:55:00.000Z"
}
```

Map fields in the PA flow for Teams card + SharePoint upsert.

## Channel mapping

| Flow name | Teams channel | n8n env var |
|---|---|---|
| Dunnly AR Escalations | `#ar-escalations` | `TEAMS_WEBHOOK_ESCALATIONS` |
| Dunnly AR Disputes | `#ar-disputes` | `TEAMS_WEBHOOK_DISPUTES` |
| Dunnly AR Payments | `#ar-payments` | `TEAMS_WEBHOOK_PAYMENTS` |
| Dunnly AR Alerts | `#ar-alerts` | `TEAMS_WEBHOOK_ALERTS` |

`dunnly-classify` routes dispute → `#ar-disputes`, promise/paid → `#ar-payments`, no_response → `#ar-escalations`. One post per matched reply. Inbound unmatched posts once to escalations.

## Smoke test

```bash
node scripts/validate-webhook-urls.js
node scripts/probe-teams-webhooks.js
node scripts/verify-hybrid-e2e.js
```

Expect `OK` / HTTP 200–202 for each invoke URL.
