/** Poll dashboard API until INV-1 stage/classification changes or timeout. */
const HERO = "INV-1";
const INTERVAL_MS = 10_000;
const MAX_MS = 10 * 60_000;

let baseline = null;

async function poll() {
  const res = await fetch("http://localhost:3000/api/invoices");
  const j = await res.json();
  const hero = (j.invoices || []).find((i) => i.id === HERO);
  const inbound = j.inbound || [];
  const ts = new Date().toISOString().slice(11, 19);
  console.log(
    `[${ts}] INV-1 stage=${hero?.stage} cls=${hero?.classification || "-"} ch=${hero?.replyChannel || "-"} inbound=${inbound.length}`
  );
  if (!baseline && hero) baseline = { stage: hero.stage, cls: hero.classification, reply: hero.replyText };
  if (hero && baseline) {
    const changed =
      hero.stage !== baseline.stage ||
      hero.classification !== baseline.cls ||
      (hero.replyText && hero.replyText !== baseline.reply);
    if (changed) {
      console.log("\n*** LIVE HIT ***");
      console.log(JSON.stringify(hero, null, 2));
      process.exit(0);
    }
  }
}

console.log(`Watching ${HERO} on http://localhost:3000 (poll every ${INTERVAL_MS / 1000}s, max ${MAX_MS / 60000}min)\n`);
poll();
const timer = setInterval(poll, INTERVAL_MS);
setTimeout(() => {
  clearInterval(timer);
  console.log("\nTimeout — no change detected.");
  process.exit(1);
}, MAX_MS);
