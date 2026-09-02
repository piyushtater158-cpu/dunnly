# Oracle Cloud — n8n host environment variables

`dunnly-send` and `dunnly-classify` read **`$env.*`** on the n8n **server** (Oracle Cloud VM), not from this repo’s `.env`.

**Host:** `ubuntu@161.118.180.71` · Docker Compose `/home/ubuntu/docker-compose.yml` · env file `/etc/n8n/ms.env`

## Hybrid path: PA Gmail + Teams

| Variable | Purpose |
|---|---|
| `PA_EMAIL_WEBHOOK_URL` | Power Automate **Dunnly AR Send Email** → Gmail send |
| `TEAMS_WEBHOOK_ESCALATIONS` | Classify / inbound WA → `#ar-escalations` |
| `TEAMS_WEBHOOK_DISPUTES` | DISPUTE → `#ar-disputes` |
| `TEAMS_WEBHOOK_PAYMENTS` | PROMISE / PAID → `#ar-payments` |
| `TEAMS_WEBHOOK_ALERTS` | Workflow failures → `#ar-alerts` |
| `TEAMS_INCOMING_WEBHOOK_URL` | Back-compat alias for escalations |
| `DASHBOARD_NOTIFY_URL` | n8n `dunnly-read` → Next.js `POST /api/invoices/notify` after sheet sync (SSE push) |
| `DASHBOARD_NOTIFY_SECRET` | Optional; defaults to `N8N_WEBHOOK_SECRET` |
| `TWILIO_ACCOUNT_SID` | Required for WhatsApp send URL (`…/Accounts/{SID}/Messages.json`). If unset, dashboard may pass SID in the webhook body. |
| `TWILIO_CONTENT_SID` | Optional; only used when Config `twilioContentMode` is `content` |
| `FOLLOWUP_ENABLED` | `true` to arm `dunnly-followup` daily scheduler (default off until tested) |
| `FOLLOWUP_BATCH_CAP` | Max rows per follow-up run (default 25) |
| `FOLLOWUP_MAX_TOUCHES` | Close cadence after this many touches (default 4) |
| `FOLLOWUP_HIGH_VALUE` | Amount threshold for tighter ladder (default 100000) |

**Do not set Graph vars.** The new Microsoft tenant has no Entra app. Live email is `PA_EMAIL_WEBHOOK_URL` only. Delete leftover `MS_TENANT_ID` / `MS_CLIENT_ID` / `MS_CLIENT_SECRET` / `MS_SENDER_UPN` from `/etc/n8n/ms.env` if still present.

See [power-automate-email-gmail.md](power-automate-email-gmail.md) and [power-automate-teams-setup.md](power-automate-teams-setup.md).

**URL format:** HTTP POST invoke URLs (`…/triggers/manual/paths/invoke?…&sig=…`).  
`https://make.powerautomate.com/.../flows/<guid>` designer links return **401/405**.

After editing `/etc/n8n/ms.env`:

```bash
cd /home/ubuntu && docker compose up -d n8n
docker compose exec n8n printenv | grep -E '^(PA_EMAIL|TEAMS_)' | sed -E 's/(sig=)[^&]+/\1***REDACTED***/'
```

Never `source` `/etc/n8n/ms.env` — the `&` in invoke URLs is a bash background operator and truncates `sig=`. Never grep `MS_` into a transcript.

```bash
sudo grep -E '^(PA_EMAIL|TEAMS_|N8N_BLOCK)' /etc/n8n/ms.env | sed -E 's/(sig=)[^&]+/\1***REDACTED***/'
```

Delete `/home/ubuntu/pa-invoke-urls.export.txt` after it has been consumed.

Strip dead Graph keys:

```bash
sudo python3 - << 'PY'
p = "/etc/n8n/ms.env"
drop = ("MS_TENANT_ID=", "MS_CLIENT_ID=", "MS_CLIENT_SECRET=", "MS_SENDER_UPN=")
lines = open(p).read().splitlines()
kept = [l for l in lines if not l.startswith(drop)]
open(p, "w").write("\n".join(kept).rstrip() + "\n")
print("removed", len(lines) - len(kept), "MS_* lines; remaining", len(kept))
PY
cd /home/ubuntu && docker compose up -d n8n
```

## `N8N_BLOCK_ENV_ACCESS_IN_NODE`

If set to `true`, Dunnly **classify** cannot read `$env.TEAMS_WEBHOOK_*` inside the **Resolve Teams targets** Code node. **Set to `false` or remove.**

## Generate local template / verify

```bash
node scripts/generate-n8n-host-env.js
node scripts/verify-hybrid-e2e.js
node scripts/probe-pa-email-webhook.js
node scripts/probe-teams-webhooks.js
node scripts/probe-webhooks.js
```
