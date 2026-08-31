# Dunnly — Demo Voiceover Script (word-for-word + screen directions)

Target length **~5:45** (add ~20s if you include the eval insert). Read the **SAY** lines aloud;
follow the **SCREEN** lines with your cursor. `[click]`, `[wait]`, `[switch]` are your action cues.

> **Email** uses Power Automate → Gmail. **Teams** uses Power Automate webhooks into Dunnly team
> channels (`#ar-payments` for PROMISE, `#ar-disputes` / `#ar-escalations` for DISPUTE).
> Also: silence phone/desktop notifications (Do Not Disturb) so nothing pops in-frame except the
> WhatsApp you're demoing.

---

## COLD OPEN — optional (0:00–0:08)
**SCREEN:** Dashboard already loaded, full view. Cursor still.
**SAY:**
> "Every business loses money to invoices that are just… late. This is **Dunnly** — it chases them
> down on autopilot."

---

## BEAT 0 — Orientation (0:08–0:40)
**SCREEN:** Slowly drag the cursor across the six-segment **pipeline bar** on any one row.
**SAY:**
> "Dunnly watches your accounts-receivable ledger, and for every overdue invoice it runs this
> six-stage pipeline — draft, send, reply, classify, escalate. I'm going to push one invoice all the
> way through, live. And each stage you see is a different part of the system talking to a different
> service."

---

## BEAT 1 — Pull & Draft → **Skill 3: AI Prompt Engineering** (0:40–1:40)
**SCREEN:** Click **RUN PULL** (top-right). Rows refresh. Click the **INV-24245 · Piyush Tater Demo Co**
row to expand it. Show the two panels: **DRAFT · EMAIL** and **DRAFT · WHATSAPP**.
**SAY:**
> "First I'll pull the ledger. [click] For every invoice that's overdue and hasn't been contacted, an
> AI model writes the reminder from scratch — grounded in that invoice's real amount and how late it
> is. Here's our demo customer. [expand] The model wrote two versions: a full email, and a shorter
> WhatsApp note — same objective, tuned to each channel. This is the prompt-engineering piece — and
> it's not guesswork."

**OPTIONAL EVAL INSERT (+0:20)**
**SCREEN:** Cut to a terminal. Run `npm run eval:wa-draft` (or `npm run eval:classify-reply`). Let the
score print.
**SAY:**
> "The prompt ships with an evaluation suite — it scores every draft for relevance and checks the model
> never rewrites the customer's own words. Passing means it stays on-objective. That's how you keep an
> LLM reliable in production."

---

## BEAT 2 — Approve & Send → **Skill 4: Multi-channel** + **Skill 1: API Usage** (1:40–2:50)
**SCREEN:** Point at the **AUTO_SEND=FALSE** chip in the header. Click **APPROVE & SEND**; the button
settles on **EMAIL + WA SENT**. `[switch]` to the **inbox** that received it — email is there.
`[switch]` to the **mirrored phone** — the WhatsApp is there. `[switch]` to the Google Sheet
**`send_log`** tab — a fresh row.
**SAY:**
> "Notice nothing has left yet — auto-send is off, so a human approves every message. I'll approve.
> [click] And it goes out on two channels at the same time. Here's the email — delivered through the
> **Microsoft 365 API**. [switch to phone] …and here's the same reminder on WhatsApp. The email carries
> the full AI draft; WhatsApp goes out as an approved business template — that's a WhatsApp platform
> rule, not a shortcut. [switch to Sheet] And every send is written back to the database — channel,
> recipient, delivery status — right here."

---

## BEAT 3 — Customer replies → **Skill 6: Webhooks (inbound)** (2:50–3:35)
**SCREEN:** On the **phone**, type a WhatsApp reply and send:
`Cash flow is tight this month — we can settle in full on the 14th.`
`[switch]` to the dashboard and **do not click anything**. Within ~10s the row flips to
**IN FLIGHT / replied**.
**SAY:**
> "Now keep your eye on the dashboard — I'm not going to touch it. The customer replies on WhatsApp…
> [wait] …and the row updates on its own. I didn't refresh, I didn't paste anything. Their reply hit an
> **inbound webhook**, the system matched the phone number back to this invoice, and pulled the message
> straight in."

---

## BEAT 4 — Classify → **Skill 2: Conditional Routing** (3:35–4:20)
**SCREEN:** Expand the row. Show the customer's reply text and the **PROMISE** badge.
**SAY:**
> "The moment that reply lands, an AI model classifies the intent — is this a promise to pay, a dispute,
> a confirmation they've already paid, or just silence? This one's a promise. And that single label
> decides the route: promises and disputes get escalated to a human; everything else is logged and quietly
> closed. Same message in — different path out."

---

## BEAT 5 — Notify → **Skill 6: Webhooks (outbound)** + **Skill 5: DB Writeback** (4:20–5:05)
**SCREEN:** `[switch]` to **Teams → Dunnly → `#ar-payments`** (PROMISE) or `#ar-disputes` (DISPUTE). `[switch]`
to the Sheet **`classification_log`** tab — a row with `notified = TRUE`. `[switch]` back to the
dashboard — the pipeline bar is now fully filled (**notified**).
**SAY:**
> "Because it's a promise, the account manager gets pinged in **Teams** — fired off through an outgoing
> webhook — with the customer, the invoice, and the date they committed to. [Sheet] The classification
> is written back to the log and marked as notified. And the pipeline is complete — all six stages,
> filled in."

---

## BEAT 6 — The proof layer → recap the plumbing (5:05–5:35)
**SCREEN:** Cut to the **n8n canvas**. Point in turn at: `dunnly-draft`'s **LLM draft** node →
`dunnly-send`'s **Microsoft 365 send** node and **WhatsApp** node → `dunnly-classify`'s
**`Should notify Teams?`** IF node branching into the **Notify Teams** node.
**SAY:**
> "Behind the dashboard it's these workflows. The AI drafting… the send — Microsoft 365 for email,
> Twilio for WhatsApp… and the classifier, with this branch right here: if it's a dispute or a promise,
> notify Teams — otherwise, just log it. Every one of these steps reads and writes the same shared
> database. That's the whole system."

---

## CLOSING (5:35–5:45)
**SCREEN:** Back to the dashboard, or a recap card listing the six skills.
**SAY:**
> "One invoice, six moving parts — AI drafting, multi-channel send, live webhooks in and out, intent
> routing, and a full audit trail behind all of it. That's Dunnly. Thanks for watching."

---

### Timing cheat-sheet
| Beat | Skill | End time |
|---|---|---|
| Cold open | — | 0:08 |
| 0 Orientation | — | 0:40 |
| 1 Pull & draft | 3 (AI prompts) | 1:40 |
| 2 Approve & send | 4 + 1 (multi-channel, M365 API) | 2:50 |
| 3 Reply | 6 inbound (webhook) | 3:35 |
| 4 Classify | 2 (routing) | 4:20 |
| 5 Notify | 6 outbound + 5 (DB writeback) | 5:05 |
| 6 Proof layer | recap all | 5:35 |
| Closing | — | 5:45 |
