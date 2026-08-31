# Power Automate flow inventory (Dunnly)

Verified 2026-08-30 after Microsoft account migration.

Environment: **Piyush Tater (default)** · host `default1b146de315394561beed4422cc62de.c1`

## Invoke URL vs designer GUID

| What you see in browser | What n8n needs |
|---|---|
| `make.powerautomate.com/.../flows/<designer-guid>` | ❌ Returns 401/405 |
| Trigger → **Copy URL** → `…/workflows/<invoke-workflow-id>/triggers/manual/paths/invoke?…&sig=…` | ✅ POSTable |

## Flows

| Flow | Trigger | invoke `cu` | invoke workflow id | n8n env var |
|---|---|---|---|---|
| Dunnly AR Send Email | (Gmail send) | 21 | `cb74df247f4d48c6be05d1f734e224b2` | `PA_EMAIL_WEBHOOK_URL` |
| Dunnly AR Escalations | Teams webhook request | 27 | `be22ee7fd8694b72b74c8eb259748b89` | `TEAMS_WEBHOOK_ESCALATIONS` |
| Dunnly AR Disputes | Teams webhook request | 03 | `bea15bf1704b44d0afdcd743ba79b40c` | `TEAMS_WEBHOOK_DISPUTES` |
| Dunnly AR Payments | Teams webhook request | 06 | `7a4a0397b791449c818503ef4392d195` | `TEAMS_WEBHOOK_PAYMENTS` |
| Dunnly AR Receive Email | Gmail trigger → HTTP POST n8n | _(create in PA)_ | — | New inbound half — see [power-automate-email-inbound.md](power-automate-email-inbound.md) |

`TEAMS_INCOMING_WEBHOOK_URL` = same as `TEAMS_WEBHOOK_ESCALATIONS` (used by `dunnly-inbound-wa`).

Full invoke URLs with `sig=` live only on the n8n host (`/etc/n8n/ms.env`) and gitignored `pa-invoke-urls.env` / `.env`.

## Consumed by Dunnly workflows (repo)

| Env var | Workflow |
|---|---|
| `PA_EMAIL_WEBHOOK_URL` | `dunnly-send` |
| `TEAMS_WEBHOOK_ESCALATIONS` | `dunnly-classify` (no_response), `dunnly-inbound-wa` / `dunnly-inbound-email` (unmatched only) |
| `TEAMS_WEBHOOK_DISPUTES` | `dunnly-classify` (dispute routing) |
| `TEAMS_WEBHOOK_PAYMENTS` | `dunnly-classify` (promise/paid) |
| `TEAMS_WEBHOOK_ALERTS` | reserved for failure alerts |
| `TEAMS_INCOMING_WEBHOOK_URL` | `dunnly-inbound-wa` fallback |

## Paste workflow (local + Oracle)

1. Copy each invoke URL from PA trigger → Copy URL
2. Local: fill `pa-invoke-urls.env` → `node scripts/merge-pa-urls-into-env.js`
3. Oracle: update `/etc/n8n/ms.env` → `docker compose up -d n8n`
