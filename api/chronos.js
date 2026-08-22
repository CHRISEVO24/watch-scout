const DATA_BASE_URL = "https://raw.githubusercontent.com/CHRISEVO24/watch-scout/main/data";

function normalizeRef(ref) {
  if (!ref) return null;
  return String(ref).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function extractRefsFromQuestion(question) {
  const matches = question.match(/\b\d{4,6}[A-Z]{0,6}(?:[-/]\d{1,4}[A-Z]{0,3})?\b/gi) || [];
  return [...new Set(matches.map((m) => m.toUpperCase()))];
}

async function fetchJson(path) {
  try {
    const res = await fetch(`${DATA_BASE_URL}/${path}`);
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

async function gatherContext(question) {
  const refs = extractRefsFromQuestion(question);
  const normalizedRefs = refs.map(normalizeRef);
  const [combined, wpbInventory, eciInventory] = await Promise.all([
    fetchJson("combined.json"),
    fetchJson("inventory-latest.json"),
    fetchJson("eci-inventory-latest.json"),
  ]);
  let marketListings = [], inventoryMatches = [];
  if (normalizedRefs.length > 0) {
    marketListings = combined.filter((item) => {
      const itemRef = normalizeRef(item.ref);
      return itemRef && normalizedRefs.some((r) => itemRef === r || itemRef.startsWith(r) || r.startsWith(itemRef));
    }).slice(0, 40);
    const allInventory = [...wpbInventory, ...eciInventory];
    inventoryMatches = allInventory.filter((item) => {
      const itemRef = normalizeRef(item.ref);
      return itemRef && normalizedRefs.some((r) => itemRef === r || itemRef.startsWith(r) || r.startsWith(itemRef));
    }).slice(0, 20);
  }
  return { refs, marketListings, inventoryMatches };
}

function formatContextForPrompt(context) {
  const { refs, marketListings, inventoryMatches } = context;
  let text = "";
  if (refs.length > 0) text += `Reference number(s) detected: ${refs.join(", ")}\n\n`;
  if (inventoryMatches.length > 0) {
    text += `YOUR CURRENT INVENTORY matching this reference:\n`;
    for (const item of inventoryMatches) {
      text += `- [${item.store || "WPB"}] ${item.name} — Ref ${item.ref} — $${item.price ?? "?"}\n`;
    }
    text += "\n";
  }
  if (marketListings.length > 0) {
    text += `CURRENT MARKET LISTINGS:\n`;
    for (const item of marketListings) {
      text += `- [${item.source}] ${item.title || item.name} — $${item.price ?? "?"}\n`;
    }
    text += "\n";
  }
  if (refs.length === 0) text += "No specific reference number detected — answer using general watch market knowledge.\n";
  return text;
}

const SYSTEM_PROMPT = `You are a knowledgeable pre-owned luxury watch market pricing assistant for WPB Watch Co. Answer directly and concisely in the voice of an experienced trading floor assistant. When you have real listing data, cite rough price ranges from it. Keep answers focused.`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  const question = (req.body && req.body.question || "").toString().trim();
  if (!question) return res.status(400).json({ ok: false, error: "Provide a question." });
  try {
    const context = await gatherContext(question);
    const contextText = formatContextForPrompt(context);
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 1000, system: SYSTEM_PROMPT, messages: [{ role: "user", content: `DATA CONTEXT:\n${contextText}\n\nDEALER'S QUESTION: ${question}` }] }),
    });
    const data = await anthropicRes.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    return res.status(200).json({ ok: true, answer: textBlock ? textBlock.text : "No response generated." });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
