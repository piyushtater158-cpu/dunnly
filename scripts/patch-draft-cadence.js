/**
 * Patch dunnly-draft.json: escalating tone + cadence mode branch.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const draftPath = path.join(ROOT, "n8n/workflows/dunnly-draft.json");
const draft = JSON.parse(fs.readFileSync(draftPath, "utf8"));

const llm = draft.nodes.find((n) => n.name === "LLM draft");
const toneClause =
  "\\n\\nFollow-up tone: read followupCount from the invoice row ($('Read invoice').item.json.followupCount). count 0 or empty = first touch. count 1 = polite second reminder referencing the earlier message. count 2 = firmer, ask for a specific payment date. count 3+ = final notice before internal escalation. Keep all factual and shipping-language rules.";

if (!llm.parameters.jsonBody.includes("Follow-up tone")) {
  llm.parameters.jsonBody = llm.parameters.jsonBody.replace(
    "You are Dunnly AR's message drafter",
    "You are Dunnly AR's message drafter" + toneClause
  );
}

// cadence mode branch
const mode = draft.nodes.find((n) => n.name === "Mode");
mode.parameters.rules.values.push({
  outputKey: "cadence",
  conditions: {
    combinator: "and",
    conditions: [
      {
        leftValue: "={{$json.body.mode}}",
        rightValue: "cadence",
        operator: { type: "string", operation: "equals" },
      },
    ],
  },
});

if (!draft.nodes.find((n) => n.name === "Write cadence")) {
  draft.nodes.push({
    id: "sheets-write-cadence-1",
    name: "Write cadence",
    type: "n8n-nodes-base.googleSheets",
    typeVersion: 4.5,
    position: [780, 200],
    parameters: {
      resource: "sheet",
      operation: "update",
      documentId: {
        __rl: true,
        value: "1qk-kY0gwgDU9Sef-lvDLRZEe-W-m1AUZtm4inJb9ph0",
        mode: "id",
      },
      sheetName: { __rl: true, value: "invoices", mode: "name" },
      columns: {
        mappingMode: "defineBelow",
        matchingColumns: ["id"],
        value: {
          id: "={{$('Webhook').item.json.body.invoiceId}}",
          cadenceState: "={{$('Webhook').item.json.body.cadenceState || ''}}",
          nextActionAt: "={{$('Webhook').item.json.body.nextActionAt || ''}}",
          followupBucket: "={{$('Webhook').item.json.body.followupBucket || ''}}",
          updatedAt: "={{ $now.toISO() }}",
        },
      },
      options: {},
    },
    credentials: {
      googleSheetsOAuth2Api: { id: "XTaQHKonHKfxw3GX", name: "Google Sheets account" },
    },
  });
  draft.nodes.push({
    id: "sheets-read-cadence-out-1",
    name: "Read cadence result",
    type: "n8n-nodes-base.googleSheets",
    typeVersion: 4.5,
    position: [1040, 200],
    parameters: {
      resource: "sheet",
      operation: "read",
      documentId: {
        __rl: true,
        value: "1qk-kY0gwgDU9Sef-lvDLRZEe-W-m1AUZtm4inJb9ph0",
        mode: "id",
      },
      sheetName: { __rl: true, value: "invoices", mode: "name" },
      filtersUI: {
        values: [
          {
            lookupColumn: "id",
            lookupValue: "={{$('Webhook').item.json.body.invoiceId}}",
          },
        ],
      },
      options: {},
    },
    credentials: {
      googleSheetsOAuth2Api: { id: "XTaQHKonHKfxw3GX", name: "Google Sheets account" },
    },
  });
}

// Mode output 2 = cadence (0 save, 1 generate, 2 cadence)
draft.connections.Mode.main.push([
  { node: "Write cadence", type: "main", index: 0 },
]);
draft.connections["Write cadence"] = {
  main: [[{ node: "Read cadence result", type: "main", index: 0 }]],
};
draft.connections["Read cadence result"] = {
  main: [[{ node: "Normalize", type: "main", index: 0 }]],
};

fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2) + "\n");
console.log("patched dunnly-draft.json");
