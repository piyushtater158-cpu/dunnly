# SharePoint — Dunnly_AR_Inbox list

Native M365 “AR panel” for account managers. Rows are created/updated by Power Automate when n8n classifies a reply.

## Create the list

1. SharePoint → Team site for **Dunnly** (or new site) → **New** → **List** → **Blank list**
2. Name: `Dunnly_AR_Inbox`
3. Add columns:

| Column | Type | Notes |
|---|---|---|
| Title | Single line (default) | Store `invoiceId` |
| Customer | Single line of text | |
| Classification | Choice | `paid`, `promise`, `dispute`, `no_response` |
| ReplyText | Multiple lines of text | Truncate in PA if needed |
| DaysOverdue | Number | |
| Stage | Single line of text | `notified` or `classified` |
| TeamsChannel | Single line of text | `ar-disputes`, `ar-payments`, `ar-escalations` |
| NotifiedAt | Date and time | |
| ReplyReceivedAt | Date and time | optional |

4. Create views:
   - **Open disputes** — filter Classification = dispute
   - **Payments** — filter Classification in (paid, promise)
   - **All** — default sort by NotifiedAt desc

## Power Automate mapping (after Teams post)

In each classify Teams flow, add after **Post message in a chat or channel**:

1. **Get items** (SharePoint) — filter `Title eq '<invoiceId>'` from `triggerBody()?['invoiceId']`
2. **Condition** — if count > 0 → **Update item**, else **Create item**
3. Field mapping from webhook body:

| SharePoint column | PA expression |
|---|---|
| Title | `triggerBody()?['invoiceId']` |
| Customer | `triggerBody()?['customer']` |
| Classification | `triggerBody()?['classification']` |
| ReplyText | `triggerBody()?['replyText']` |
| DaysOverdue | `triggerBody()?['daysOverdue']` |
| Stage | `triggerBody()?['stage']` |
| TeamsChannel | `triggerBody()?['teamsChannel']` |
| NotifiedAt | `triggerBody()?['notifiedAt']` |
| ReplyReceivedAt | `triggerBody()?['replyReceivedAt']` |

n8n sends this structured payload from **Notify Teams** in `dunnly-classify`.

## Google Sheet vs SharePoint

| Store | Used by |
|---|---|
| Google Sheets `invoices`, `classification_log` | Dunnly dashboard + n8n |
| SharePoint `Dunnly_AR_Inbox` | Account managers in M365 |

Both receive the same classification event; SharePoint is updated by PA, not n8n directly.
