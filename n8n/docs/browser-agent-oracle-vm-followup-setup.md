# Browser Agent Task: Oracle VM + n8n Follow-Up Cadence Setup

**Copy everything below the line into your browser agent / computer-use session.**

---

## Mission

Complete production setup and verification for Dunnly’s **follow-up cadence** feature on the Oracle Cloud n8n host. Code is already merged on branch `feature/followup-cadence`; workflows exist locally in the repo at `n8n/workflows/`. Your job is **server env**, **workflow import/activation**, and **plan §4 dry-run checks**. Do not change application source code on the VM unless a step explicitly says so.

## Credentials & access (use what you have)

| Resource | Value |
|----------|--------|
| n8n UI | https://n8n.piyushtater.com |
| Oracle VM SSH | `ubuntu@161.118.180.71` |
| Docker compose on VM | `/home/ubuntu/docker-compose.yml` |
| n8n env file on VM | `/etc/n8n/ms.env` |
| Google Sheet ledger | https://docs.google.com/spreadsheets/d/1qk-kY0gwgDU9Sef-lvDLRZEe-W-m1AUZtm4inJb9ph0/edit |
| Sheet tab | `invoices` |
| Test invoice (WA demo) | `INV-24245` (Piyush Tater Demo Co) |
| Dashboard (if deployed) | User’s Vercel Dunnly URL or local `localhost:3000` |

If n8n Public API returns **401**, use the **n8n web UI** for import/activate (API key may be expired). Do not paste secrets into chat logs; redact `sig=` in Power Automate URLs when screenshotting.

---

## Phase A — VM environment variables (kill switch first)

### A1. SSH into the VM

```bash
ssh ubuntu@161.118.180.71
```

### A2. Inspect current follow-up vars (should be absent or false)

```bash
sudo grep -E '^FOLLOWUP_' /etc/n8n/ms.env || echo "no FOLLOWUP vars yet"
```

### A3. Add follow-up cadence vars — **start disabled for dry-run**

Edit `/etc/n8n/ms.env` with `sudo nano /etc/n8n/ms.env` (or `sudo vi`). Append if missing:

```bash
FOLLOWUP_ENABLED=false
FOLLOWUP_BATCH_CAP=25
FOLLOWUP_MAX_TOUCHES=4
FOLLOWUP_HIGH_VALUE=100000
```

**Important:** Keep `FOLLOWUP_ENABLED=false` until Phase C step C1 passes.

Also confirm these exist (do not change unless broken):

- `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` (or unset) — required for `$env.FOLLOWUP_*` in Code nodes
- `PA_EMAIL_WEBHOOK_URL`, `TEAMS_WEBHOOK_*`, `TWILIO_*` as documented in repo `n8n/docs/oracle-cloud-n8n-env.md`

Never run `source /etc/n8n/ms.env` — `&` in PA URLs breaks the shell.

### A4. Restart n8n container

```bash
cd /home/ubuntu && docker compose up -d n8n
```

### A5. Verify vars loaded inside container

```bash
docker compose exec n8n printenv | grep -E '^FOLLOWUP_'
```

Expected: four `FOLLOWUP_*` lines with `FOLLOWUP_ENABLED=false`.

---

## Phase B — Import / update workflows in n8n UI

Local repo workflows to deploy (import or re-import if API push unavailable):

1. `dunnly-followup.json` — **NEW** scheduler (daily 09:00 IST)
2. `dunnly-send.json` — send-time cadence init
3. `dunnly-classify.json` — promiseDate + compute next action
4. `dunnly-draft.json` — escalating tone + `mode=cadence` branch
5. `dunnly-read.json` — normalize cadence columns
6. `dunnly-inbound-wa.json` — normalize pass-through

### B1. Open n8n

1. Go to https://n8n.piyushtater.com and sign in.
2. Workflows → check if **dunnly-followup** already exists.

### B2. Import `dunnly-followup` (if missing)

1. Workflows → **Add workflow** → ⋮ menu → **Import from file**.
2. Upload `dunnly-followup.json` from the developer’s machine (path on Windows dev box:
   `C:\Users\piyus\Documents\Projects\comprint-100x-project\n8n\workflows\dunnly-followup.json`).
3. Save workflow. **Do not activate yet** (leave inactive until Phase C).

### B3. Update existing workflows

For each of `dunnly-send`, `dunnly-classify`, `dunnly-draft`, `dunnly-read`, `dunnly-inbound-wa`:

- Either import-from-file **into the existing workflow** (replace nodes) via UI, **or**
- If developer can fix `N8N_API_KEY`, run on dev machine:
  `node scripts/push-n8n-workflows.js`

After update, confirm **dunnly-classify** webhook id unchanged (active workflow id `kZIRFRsNvgQoem6f` in repo scripts).

### B4. Credential check on `dunnly-followup`

Open workflow nodes and confirm Google Sheets OAuth credential **Google Sheets account** is bound on:

- Read invoices
- Close zero balance
- Re-arm row
- followup_log (if present)

---

## Phase C — Dry-run verification (plan §4)

Use Google Sheet + n8n **Execute workflow** (manual), not the schedule trigger.

### C1. Enabled? gate with FOLLOWUP_ENABLED=false

1. In n8n, open **dunnly-followup**.
2. Click **Execute workflow** (manual test).
3. Open execution log → confirm flow stops at **Enabled?** node with **false** branch (no rows processed).

**Pass criteria:** Zero sheet writes, no draft webhook calls.

### C2. Pick a test row in Google Sheets

Open `invoices` tab. Use a **non-demo** row OR `INV-24245` only if you accept it may get redrafted.

Set columns for test row (example `INV-24199`):

| Column | Value |
|--------|--------|
| `stage` | `sent` |
| `cadenceState` | `active` |
| `nextActionAt` | **yesterday’s date** in `YYYY-MM-DD` (IST; e.g. if today is 2026-09-01, use `2026-08-31`) |
| `followupCount` | `0` |
| `followupBucket` | `W1` |
| `amountRemaining` | > 0 |
| `lastTouchAt` | empty |
| `emailSentAt` | any non-empty (simulates prior send) |

### C3. Enable follow-up for one manual run

On VM:

```bash
sudo sed -i 's/^FOLLOWUP_ENABLED=.*/FOLLOWUP_ENABLED=true/' /etc/n8n/ms.env
cd /home/ubuntu && docker compose up -d n8n
docker compose exec n8n printenv | grep FOLLOWUP_ENABLED
```

### C4. Execute `dunnly-followup` once

1. n8n UI → **dunnly-followup** → **Execute workflow**.
2. Watch execution:

**Pass criteria:**

- Exactly **one** row selected (Limit node).
- `followupCount` **0 → 1** on test row in Sheet.
- `stage` → **`drafted`** (re-armed for human approval).
- `nextActionAt` pushed forward (later than yesterday).
- `lastTouchAt` set to today ISO timestamp.
- New line in **`followup_log`** tab (if workflow writes it).

Screenshot execution success + updated Sheet row.

### C5. Stage-gate check (4b)

**Do not approve/send** the redrafted row. Leave `stage=drafted`.

Set `nextActionAt` to **yesterday** again on the same row (simulate next day due).

Execute **dunnly-followup** again.

**Pass criteria:** **Zero rows selected** (stage gate excludes `drafted`). `followupCount` unchanged.

### C6. Idempotency (plan §6)

With row still `sent` and due today, run **dunnly-followup** twice same day.

**Pass criteria:** Second run selects **zero** rows (`lastTouchAt` guard).

### C7. Disable scheduler after testing

```bash
sudo sed -i 's/^FOLLOWUP_ENABLED=.*/FOLLOWUP_ENABLED=false/' /etc/n8n/ms.env
cd /home/ubuntu && docker compose up -d n8n
```

In n8n UI: leave **dunnly-followup** workflow **inactive** until ops explicitly arms daily schedule, OR activate only when `FOLLOWUP_ENABLED=true` is intentional for production.

---

## Phase D — Dashboard checks (optional if app deployed)

1. Open Dunnly dashboard with `N8N_BASE_URL` pointing to live n8n.
2. Confirm **FOLLOW-UPS** tab lists the test row when cadence active/paused rules match.
3. Expanded row shows cadence line (not hardcoded “auto-closed” text).
4. Re-armed row at `stage=drafted` + `followupCount>0` shows **STILL PENDING APPROVAL**.
5. Snooze / Resume / Close buttons call `PATCH /api/invoices/{id}/cadence` without 502.

---

## Phase E — Ghosting-debtor path (plan §7) — optional extended test

1. Pick a fresh `queued` or `drafted` row, approve & send via dashboard or n8n send webhook.
2. Confirm on Sheet after send: `cadenceState=active`, `followupBucket=W1`, `nextActionAt=sendDate+7d`, `followupCount=0`.
3. Backdate `nextActionAt`, run follow-up workflow → row redrafted.

---

## Phase F — Paused dispute resurface (plan §8) — optional

1. Classify a reply as `dispute` on a sent invoice.
2. Confirm `cadenceState=paused`, `nextActionAt≈today+28d`.
3. Backdate `nextActionAt` to today, confirm row appears on dashboard FOLLOW-UPS with **CADENCE PAUSED · REVIEW**.
4. Run `dunnly-followup` — row must **not** be selected (only `active` rows).

---

## Deliverables back to developer

Post a short report with:

1. Screenshot or copy of `docker compose exec n8n printenv | grep FOLLOWUP`
2. n8n execution IDs for C1, C4, C5, C6
3. Before/after Sheet values for test invoice columns listed above
4. Whether workflows were imported via UI or API push
5. Any blockers (expired API key, credential errors, OpenRouter failures on redraft)

---

## Safety rules

- **Never** set `AUTO_SEND=true` on production without explicit approval.
- Follow-up workflow **only drafts** — it does not email/WhatsApp customers directly.
- Use `FOLLOWUP_ENABLED=false` as the master kill switch when not testing.
- Do not commit `/etc/n8n/ms.env` or paste webhook `sig=` values into tickets.

---

## Quick reference — repo verification already green on dev machine

```bash
node scripts/eval-followup-policy.js
npm run eval:classify-reply
npm run eval:wa-draft
node scripts/validate-invoice-schema.js
```

All should PASS before/after VM setup.
