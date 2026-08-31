# Power Automate — Dunnly AR Send Email (Gmail)

n8n `dunnly-send` POSTs to this flow instead of calling Microsoft Graph or Gmail API directly.

## Create flow: `Dunnly AR Send Email`

1. [Power Automate](https://make.powerautomate.com) → **Create** → **Automated cloud flow**
2. Trigger: **When a HTTP request is received**
3. **Request Body JSON Schema** (optional but recommended):

```json
{
  "type": "object",
  "properties": {
    "toEmail": { "type": "string" },
    "subject": { "type": "string" },
    "body": { "type": "string" },
    "invoiceId": { "type": "string" },
    "customer": { "type": "string" }
  }
}
```

4. Action: **Send an email (V2)** — connector **Gmail**
   - Sign in with demo Gmail (e.g. `piyushtater5555@gmail.com`)
   - To: `triggerBody()?['toEmail']`
   - Subject: `triggerBody()?['subject']`
   - Body: `triggerBody()?['body']`
5. **Save** → **Turn on**
6. Copy HTTP trigger **POST URL** → set on Oracle n8n host as `PA_EMAIL_WEBHOOK_URL`

## n8n payload (from `Send via PA Gmail` node)

```json
{
  "toEmail": "customer@example.com",
  "subject": "Overdue: INV-24245 - $1200 - 45 days",
  "body": "Hello...",
  "invoiceId": "INV-24245",
  "customer": "Piyush Tater Demo Co"
}
```

## Smoke test

```bash
node scripts/probe-pa-email-webhook.js
```

## Troubleshooting

| Issue | Fix |
|---|---|
| 401 on webhook | Regenerate trigger URL; set authentication to **Anyone** |
| Gmail not connected | Re-authenticate Gmail connector in flow |
| Email not received | HTTP 202 only means PA trigger accepted — check **Run history** in `Dunnly AR Send Email` for Gmail step failure; re-auth Gmail connector; check spam |
| n8n shows sent but no inbox | PA Gmail action failed after async trigger — use `node scripts/probe-pa-email-webhook.js` and note `pa_workflow_run_id` to find the run |
