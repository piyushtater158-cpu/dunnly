const fs = require("fs");
const https = require("https");
for (const l of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = l.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
let k = process.env.N8N_API_KEY || "";
if (k.startsWith("n8n-api-")) k = k.slice(8);
https.get(
  { hostname: "n8n.piyushtater.com", path: "/api/v1/workflows/84dabKoBpnUa12Jg", headers: { "X-N8N-API-KEY": k } },
  (r) => {
    let b = "";
    r.on("data", (c) => (b += c));
    r.on("end", () => {
      const n = JSON.parse(b).nodes.find((x) => x.name === "Update");
      console.log(JSON.stringify(n.parameters.columns.value, null, 2));
    });
  }
);
