const fs = require("fs");
const path = require("path");
const axios = require("axios");

(function loadEnvFile() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
})();

const DATA_DIR = path.join(__dirname, "..", "data");

function loadSafe(file) {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return [];
  }
}

function normalizeRef(ref) {
  if (!ref) return null;
  return String(ref).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function extractRefsFromQuestion(question) {
  const matches = question.match(/\b\d{4,6}[A-Z]{0,6}(?:[-/]\d{1,4}[A-Z]{0,3})?\b/gi) || [];
  return [...new Set(matches.map((m) => m.toUpperCase()))];
}

function gatherContext(question) {
  const refs = extractRefsFromQuestion(question);
  const normalizedRefs = refs.map(normalizeRef);

  const combined = loadSafe("combined.json");
  const wpbInventory = loadSafe("inventory-latest.json");
  const eciInventory = loadSafe("eci-inventory-latest.json");

  let marketListings = [];
  let inventoryMatches = [];

  if (normalizedRefs.length > 0) {
    marketListings = combined.filter((item) => {
      const itemRef = normalizeRef(item.ref);
      return itemRef && normalizedRefs.some((r) => itemRef === r || itemRef.startsWith(r) || r.startsWith(itemRef));
    });
    const allInventory = [...wpbInventory, ...eciInventory];
    inventoryMatches = allInventory.filter((item) => {
      const itemRef = normalizeRef(item.ref);
      return itemRef && normalizedRefs.some((r) => itemRef === r || itemRef.startsWith(r) || r.startsWith(itemRef));
    });
  }

  marketListings = marketListings.slice(0, 40);
  inventoryMatches = inventoryMatches.slice(0, 20);

  return { refs, marketListings, inventoryMatches };
}

function formatContextForPrompt(context) {
  const { refs, marketListings, inventoryMatches } = context;

  let text = "";
  if (refs.length > 0) {
    text += `Reference number(s) detected in the question: ${refs.join(", ")}\n\n`;
  }

  if (inventoryMatches.length > 0) {
    text += `YOUR CURRENT INVENTORY (WPB Watch Co + ECI Jewelers) matching this reference:\n`;
    for (const item of inventoryMatches) {
      text += `- [${item.store}] ${item.name} — Ref ${item.ref} — $${item.price ?? "?"} — ${item.dialColor || ""} — Box: ${item.box || "?"} Papers: ${item.papers || "?"}\n`;
    }
    text += "\n";
  } else if (refs.length > 0) {
    text += `YOUR CURRENT INVENTORY: no matching pieces found for this reference.\n\n`;
  }

  if (marketListings.length > 0) {
    text += `CURRENT MARKET LISTINGS (from WatchRecon, WatchPatrol, Chrono24, Bob's Watches, European Watch, eBay, Bezel, FB Groups, WhatsApp):\n`;
    for (const item of marketListings) {
      text += `- [${item.source}] ${item.title || item.name} — $${item.price ?? "?"} — ${item.dialColor || ""} — ${item.condition || ""}\n`;
    }
    text += "\n";
  } else if (refs.length > 0) {
    text += `CURRENT MARKET LISTINGS: no matching listings found in current Watch Scout data for this reference.\n\n`;
  }

  if (refs.length === 0) {
    text += "No specific reference number was detected in the question - answer using general watch market knowledge, and suggest the user include a reference number for a grounded, data-backed answer.\n";
  }

  return text;
}

async function askUltron(question, apiKey) {
  const context = gatherContext(question);
  const contextText = formatContextForPrompt(context);

  const systemPrompt = `You are a knowledgeable pre-owned luxury watch market pricing assistant for WPB Watch Co, a watch dealer. You have access to real, current data pulled from the dealer's own inventory and live market listings across multiple sources. Answer the dealer's question directly and concisely, in the voice of an experienced trading floor assistant - confident, specific with numbers when you have them, and clear about what's actually in the data versus general market knowledge. When you have real listing data, cite rough price ranges from it. When you don't have grounded data for something, say so plainly rather than making up numbers. Keep answers focused - a few short paragraphs or a tight list, not an exhaustive essay.`;

  const { data } = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model: "claude-sonnet-5",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `DATA CONTEXT:\n${contextText}\n\nDEALER'S QUESTION: ${question}`,
        },
      ],
    },
    {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      timeout: 30000,
    }
  );

  const textBlock = data.content.find((b) => b.type === "text");
  if (!textBlock) {
    console.error("Ultron: no text block in response. Full response:", JSON.stringify(data, null, 2));
  }
  return textBlock ? textBlock.text : "No response generated.";
}

module.exports = { askUltron };
