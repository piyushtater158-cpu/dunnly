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
      const n = JSON.parse(b).nodes.find((x) => x.name === "Patch");
      const code = n.parameters.jsCode;
      console.log("has drafted", code.includes("stage: 'drafted'"));
      console.log("has credit", code.includes("'Credit line'"));
      console.log("snippet", code.slice(code.indexOf("if (id === HERO)"), code.indexOf("if (id === HERO)") + 400));
    });
  }
);
