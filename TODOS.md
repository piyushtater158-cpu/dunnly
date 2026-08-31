# Dunnly — Deferred Work

### WhatsApp in `dunnly-pull`'s auto-send branch

**What:** Wire real WhatsApp sending into `dunnly-pull`'s auto-send branch so
pull-and-draft can send without a human clicking SEND per invoice.

**Why deferred:** Rate-limit / cost risk on bulk sends. Keep `AUTO_SEND=false`.

**Depends on:** Wait/throttle + batch cap.

---

### Template quality monitoring

**What:** Watch template quality rating; keep a `_v2` ready if paused.

**Why deferred:** Sandbox uses shared Twilio Order Notifications templates, not
a custom utility template. Revisit when moving off sandbox to a real WABA.
