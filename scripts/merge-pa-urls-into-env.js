/**
 * Merge pa-invoke-urls.env into .env (Teams + PA invoke URLs).
 * Usage: fill pa-invoke-urls.env, then node scripts/merge-pa-urls-into-env.js
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = path.join(root, "pa-invoke-urls.env");
const dst = path.join(root, ".env");

if (!fs.existsSync(src)) {
  console.error("missing pa-invoke-urls.env");
  process.exit(1);
}

const updates = {};
for (const line of fs.readFileSync(src, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (!m) continue;
  const val = m[2].trim();
  if (val && !val.includes("<PASTE>")) updates[m[1]] = val;
}

if (!Object.keys(updates).length) {
  console.error("no non-empty URLs in pa-invoke-urls.env");
  process.exit(1);
}

if (updates.TEAMS_WEBHOOK_ESCALATIONS && !updates.TEAMS_INCOMING_WEBHOOK_URL) {
  updates.TEAMS_INCOMING_WEBHOOK_URL = updates.TEAMS_WEBHOOK_ESCALATIONS;
}

let env = fs.readFileSync(dst, "utf8");
for (const [key, val] of Object.entries(updates)) {
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(env)) env = env.replace(re, `${key}=${val}`);
  else env += `\n${key}=${val}`;
}
fs.writeFileSync(dst, env);
console.log("merged keys:", Object.keys(updates).join(", "));
require("child_process").execSync("node scripts/validate-webhook-urls.js", {
  cwd: root,
  stdio: "inherit",
});
