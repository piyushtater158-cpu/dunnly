# Dunnly — Loom Demo Runbook

A record-ready script for a 5–6 minute product demo that shows all six skills.
Keep this open on a second screen. Narration lines are suggestions — paraphrase.

---

## 0. The pitch (say this in the first 15 seconds)

> "This is **Dunnly** — an AI autopilot for accounts-receivable collections. It pulls overdue
> invoices, drafts the reminder with AI, sends it over email **and** WhatsApp, reads the customer's
> reply, classifies it, and escalates the ones that matter to the finance team in Teams — logging
> every step to a database. I'm going to walk one invoice through that whole pipeline, and each
> stage you see is a distinct integration skill."

---

## 1. The core idea: the pipeline **is** the skill checklist

The dashboard's pipeline bar has six stages. Each maps to a skill. Walk one invoice through them
in order and you have demonstrated everything, in a story instead of a list.

| Pipeline stage | Skill you're demonstrating | What to point at on screen |
|---|---|---|
| `queued → drafted` | **3. AI Prompt Engineering** | The AI-written email + WhatsApp drafts in the expanded row; (bonus) the eval suite in the terminal |
| `drafted → sent` | **4. Multi-channel Messaging** + **1. API Usage** | Two DRAFT panels (email + WhatsApp); real Gmail inbox + real WhatsApp on the phone |
| every write | **5. DB Writeback** | Google Sheet tabs `send_log` / `classification_log` gaining rows; the SEND LOG panel |
| `sent → replied` | **6. Webhooks (inbound)** | Row auto-flips to `replied` via sheet push → n8n → SSE (no click, no poll) |
| `replied → classified` | **2. Conditional Routing** | The classification badge (PROMISE / DISPUTE / PAID / NO REPLY); n8n `Should notify Teams?` IF node |
| `classified → notified` | **6. Webhooks (outbound)** + **1. API Usage** | Teams card in Dunnly `#ar-disputes`, `#ar-payments`, or `#ar-escalations` (60d+ dispute) |

> **Email** uses **Power Automate → Gmail** (`PA_EMAIL_WEBHOOK_URL` on the n8n host). **Teams**
> uses **Power Automate webhooks** into the Dunnly team channels (`ar-escalations`,
> `ar-disputes`, `ar-payments`). Set all four `TEAMS_WEBHOOK_*` vars on the n8n host.

---

## 2. Hero invoice

**`INV-24245` — "Piyush Tater Demo Co."** It's the only row wired for a real end-to-end run: it owns
`ADMIN_PHONE`, has `waOptIn=TRUE`, and its email is pinned to `piyushtater5555@gmail.com`. Every other
row has fictitious `.test` emails and `555` phones that the system deliberately skips.

**Arm it as `queued` before recording** so you can run the *entire* pipeline on this one invoice on
camera (pull → draft → send → reply → classify → notify). In the Google Sheet `invoices` tab, on the
`INV-24245` row: set `stage = queued`, and clear `draftEmail`, `draftWhatsapp`, `classification`,
`replyText`, `waStatus`. (Leave `waOptIn = TRUE`.)

---

## 3. Pre-flight checklist (do this in the 30 min before recording)

You are in **LIVE mode** (`N8N_BASE_URL=https://n8n.piyushtater.com`). That means real Gmail (via PA) / WhatsApp /
Teams / Sheets. Confirm each leg is warm — live legs go stale:

- [ ] **Dev server up**: `bun run dev` → `http://localhost:3000` (or use your Vercel URL).
- [ ] **n8n**: all 5 workflows **Active** on `n8n.piyushtater.com`. Open the canvas tab so it's ready.
- [ ] **Twilio WhatsApp sandbox session is ALIVE** (this is the #1 thing that breaks a demo — it expires
      after ~72h idle). From the hero phone, text `join <your-sandbox-phrase>` to `+1 415 523 8886`.
      Then send one throwaway test both ways to confirm.
- [ ] **`AUTO_SEND=false`** — you *want* the human-approval gate for the demo (it's a feature to show).
- [ ] **Sheet seeded** and hero row armed to `queued` (see §2). Sheet ID `1qk-kY0…9ph0`.
- [ ] **Hybrid env on n8n host**: `PA_EMAIL_WEBHOOK_URL` + all four `TEAMS_WEBHOOK_*`; run `node scripts/verify-hybrid-e2e.js`.
- [ ] **`WA_MODE=live`** (not `dryrun`) for the real send — but do your rehearsal in `dryrun` first.
- [ ] **Do one full silent dry-run** end-to-end (pull → send → reply → classify → Teams). This warms
      caches, confirms the sandbox session, and surfaces any stale credential *before* you hit record.
      Then re-arm the hero row to `queued`.

---

## 4. Recording setup

- **Tool**: Loom **desktop app** (better quality + lets you record system audio and a specific window).
  1080p, screen + camera bubble. Target **5–6 min** main cut; consider a **90-sec sizzle** later.
- **Browser zoom to ~110–125%** so text is legible when compressed.
- **Pre-open these tabs/windows** (so you never fumble live):
  1. Dunnly dashboard (`localhost:3000`)
  2. n8n canvas with `dunnly-draft`, `dunnly-send`, `dunnly-classify` open
  3. Google Sheet (tabs: `invoices`, `send_log`, `classification_log`, `inbound_log`)
  4. Gmail inbox for the hero invoice email (`piyushtater5555@gmail.com`)
  5. Teams channels in team **Dunnly**: `#ar-escalations`, `#ar-disputes`, `#ar-payments`
  6. (optional) a terminal for the eval beat
- **Get the phone in-frame**: mirror it onto your screen so the WhatsApp send/receive is *in the
  recording*, not off-camera. Android → `scrcpy`; iPhone → QuickTime "Movie Recording" → select iPhone.
  This single move is what makes the multi-channel + webhook beats believable.
- **Loom chapters**: add a chapter/timestamp per skill so a reviewer can jump straight to any skill.

---

## 5. Run of show (beat by beat)

Approx timings for a ~5:30 cut. Say the skill number out loud ("Skill 3 of 6…") at each beat.

### Beat 0 — Orientation (0:00–0:35)
- Show the dashboard: header, the four stat cards, the tab bar, one invoice row with its pipeline bar.
- Deliver the pitch (§0). Point at the six-segment pipeline bar: *"watch these light up."*

### Beat 1 — Pull & Draft → **Skill 3: AI Prompt Engineering** (0:35–1:35)
- Click **RUN PULL** (top-right). Narrate: *"This reads every overdue invoice from our ledger and, for
  each queued one, an AI model drafts a tailored reminder."*
- Open the hero row (it's now `drafted`). Show the two panels: **DRAFT · EMAIL (GMAIL · PA)** and
  **DRAFT · WHATSAPP** — both written by the model, grounded in this invoice's real numbers (amount,
  days overdue). Narrate that the model is `gpt-4o-mini` via OpenRouter, prompted for a specific AR-collections objective.
- **(Optional, high-credibility)** Cut to terminal: `npm run eval:wa-draft` and/or
  `npm run eval:classify-reply`. Narrate: *"These aren't vibes — the prompts have an eval suite that
  scores relevance and checks the model never rewrites the customer's words. This is the prompt
  engineering skill made measurable."* Show the pass score.

### Beat 2 — Approve & Send → **Skill 4: Multi-channel** + **Skill 1: API Usage** (1:35–2:45)
- Point at the `AUTO_SEND=FALSE` chip: *"Nothing leaves without a human. That's the approval gate."*
- Click **APPROVE & SEND**. The button transitions to **EMAIL + WA SENT**.
- **Prove it (the money shot):**
  - Switch to the **Gmail inbox** — the reminder email has arrived. *(Skill 1: PA → Gmail send)*
  - Switch to the **mirrored phone** — the WhatsApp message has arrived. *(Skill 4: second channel)*
  - *"Same collections objective, two channels, from one click."*
- Switch to the Google Sheet **`send_log`** tab — a new row appended (channel, recipient, status,
  provider message id). Narrate: **Skill 5: DB Writeback.** Also point at the in-row **SEND LOG** panel.

### Beat 3 — Customer replies → **Skill 6: Webhooks (inbound)** (2:45–3:30)
- On the mirrored phone, **reply over WhatsApp**: `"Cash flow is tight this month — we can settle in
  full on the 14th."`
- Do **not** touch the dashboard. Within a few seconds the `INV-24245` row flips to **IN FLIGHT / replied** on
  its own (sheet push → n8n → SSE). Narrate: *"I didn't click anything. The inbound webhook updated the sheet,
  Apps Script synced to n8n, and the dashboard got a live push."* **Skill 6, inbound.**
- (If the round-trip is flaky, use the fallback in §9 — but try for the real webhook first; it's the best beat.)

### Beat 4 — Classify → **Skill 2: Conditional Routing** (3:30–4:15)
- Open the row; the reply text is shown with a **PROMISE** badge. Narrate: *"An AI classifier labels the
  reply — paid, promise, dispute, or no-response — and that label decides what happens next."*
- Explain the routing rule out loud: *"Disputes and promises are escalated to a human; paid and
  no-response are just logged and closed. Same inbound message, different route, based on the class."*
  **Skill 2.**

### Beat 5 — Notify → **Skill 6: Webhooks (outbound)** + **Skill 5: DB Writeback** (4:15–5:00)
- Because it's a **PROMISE**, switch to **Teams → Dunnly → `#ar-payments`** — the notification card has landed
  (customer, invoice, amount, the promised date). Narrate: **Skill 6, outbound webhook → Teams.**
- Switch to the Sheet **`classification_log`** tab — the classification + `notified=TRUE` row is there.
  **Skill 5 again.** The pipeline bar now reads **notified** — all six segments filled.

### Beat 6 — The proof layer / behind the scenes (5:00–5:30)
- Cut to the **n8n canvas**. In ~20 seconds, point at the three workflows you just triggered:
  - `dunnly-draft` → the **LLM draft** node (OpenRouter) — Skill 3.
  - `dunnly-send` → the **Send via PA Gmail** node + the WhatsApp (Twilio) node — Skills 1 & 4.
  - `dunnly-classify` → the **`Should notify Teams?`** IF node branching into the **Notify Teams** node —
    Skills 2 & 6.
- *"Everything you saw is these workflows reading and writing that one Google Sheet."* Close.

---

## 6. Optional credibility beats (add if you want a longer, more senior cut)

These show production maturity beyond the six required skills:

- **Evals** (§Beat 1) — turns "I called an LLM" into "I engineered and tested the prompt."
- **FAILED tab + RETRY** — open the FAILED tab (seeded rows: `INV-24187` Graph 550, `INV-24176` n8n
  timeout, `INV-24214` WA 502). Show the RETRY STEP button. *"No silent auto-retries — a human decides,
  so we never double-send on a flaky line."* (Error handling.)
- **STOP / opt-out** — text `STOP` from the phone; that row flips to opted-out and the next WA send
  skips it. *"WhatsApp compliance — business messages require opt-in, and STOP is honored automatically."*
- **Outage banner** — if the automation backend is ever unreachable, the black banner appears and SSE reconnects. (Resilience.) Don't force this on camera; just mention it if it happens.

---

## 8. Honest caveats — narrate these correctly (don't get caught out)

- **Email is Power Automate → Gmail** (not Graph). **Teams** uses
  Power Automate webhooks into Dunnly team channels (`#ar-disputes`, `#ar-payments`,
  `#ar-escalations` for severe disputes). The underlying email skill — authenticating to a third-party email API — is
  identical whether the provider is Gmail, Graph, or an ESP later.
- **The WhatsApp message that's delivered is an approved template, not the verbatim AI draft.** WhatsApp
  requires business-initiated messages to use a pre-approved template. The AI-drafted WhatsApp text is a
  preview/audit field; the transmitted message is the template filled with this invoice's values. So when
  you show "AI draft" then "phone received," note the email is the AI-verbatim channel and WhatsApp is the
  templated channel. (Email carries the AI copy exactly.)
- **WhatsApp is the Twilio sandbox**, not a production WABA — fine for a demo, just don't call it production.
- **Classification is AI, not keyword matching**, in live mode (the keyword classifier in `lib/store.ts`
  is only the mock fallback). The brief said "based on keywords" — the live path is an LLM classifier;
  call it "intent classification" to be accurate.

---

## 9. Fallback plan (if a live leg breaks mid-record)

- **WhatsApp round-trip flaky** → use the in-row **MANUAL PASTE REPLY** box to inject the reply, but
  still show the **INBOUND** tab / `inbound_log` to prove the real webhook path exists. Narrate the
  difference honestly.
- **Twilio sandbox expired** → you likely can't fix it fast; switch that beat to email-only for
  multi-channel, and show a *previously captured* WhatsApp screenshot for continuity.
- **Whole backend down** → unset `N8N_BASE_URL` to drop to **mock mode** (`lib/store.ts`). The dashboard
  flow (pull/draft/send/reply/classify/notify) all still animate, but email/WA/Teams are simulated. Use
  this only as a last resort and say so — or better, reschedule and fix the live leg.
- **Golden rule:** never present a simulated leg as real. A demo that's honest about "this part is
  sandboxed" reads as *more* credible, not less.

---

## 10. Post-record checklist

- [ ] Add Loom **chapters** named `Skill 1 … Skill 6` at the timestamps above.
- [ ] Trim dead air (esp. the ~10s WhatsApp round-trip wait in Beat 3).
- [ ] Add a closing frame / on-screen recap listing all six skills as a checklist.
- [ ] Watch it once at 1x. Confirm every skill is *named* out loud and *shown* on screen.
- [ ] (Optional) Cut a 90-sec sizzle: Beats 0 → 2 (send) → 5 (Teams) only.
