const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

function loadSafe(file) {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return []; }
}

function normalizeRef(ref) {
  if (!ref) return null;
  return String(ref).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function scoreMatch(item, wtb) {
  let score = 0;
  const itemText = [item.brand, item.model, item.ref, item.title, item.name].filter(Boolean).join(" ").toLowerCase();

  if (wtb.ref && item.ref) {
    const normItem = normalizeRef(item.ref);
    const normWtb = normalizeRef(wtb.ref);
    if (normItem === normWtb) score += 100;
    else if (normItem && normWtb && (normItem.startsWith(normWtb) || normWtb.startsWith(normItem))) score += 60;
  }
  if (wtb.brand && itemText.includes(wtb.brand.toLowerCase())) score += 30;
  if (wtb.model) {
    const modelWords = wtb.model.toLowerCase().split(/\s+/);
    const matched = modelWords.filter(w => w.length > 3 && itemText.includes(w));
    score += matched.length * 10;
  }
  if (wtb.keywords) {
    const kwords = wtb.keywords.toLowerCase().split(/[\s,]+/);
    kwords.filter(w => w.length > 3 && itemText.includes(w)).forEach(() => score += 5);
  }
  if (wtb.budgetMax && item.price) {
    const p = typeof item.price === "string" ? parseFloat(item.price.replace(/[^0-9.]/g, "")) : item.price;
    if (!isNaN(p) && p > wtb.budgetMax * 1.2) score = Math.max(0, score - 40);
  }
  return score;
}

async function matchWtb(wtb) {
  const wpb = loadSafe("inventory-latest.json").map(i => ({ ...i, _store: "WPB Watch Co" }));
  const eci = loadSafe("eci-inventory-latest.json").map(i => ({ ...i, _store: "ECI Jewelers" }));
  const ecj = loadSafe("ecj-inventory-latest.json").map(i => ({ ...i, _store: "ECJ Luxe Collection" }));
  const allInventory = [...wpb, ...eci, ...ecj].filter(i => (i.stockStatus || "").toLowerCase() !== "out of stock");
  const combined = loadSafe("combined.json");
  const ic = loadSafe("inventoryconnect-latest.json").filter(i => i.intent === "sell");

  const inventoryMatches = allInventory
    .map(item => ({ item, score: scoreMatch(item, wtb) }))
    .filter(m => m.score >= 30).sort((a, b) => b.score - a.score).slice(0, 10)
    .map(m => ({ score: m.score, store: m.item._store, name: m.item.name, ref: m.item.referenceNumber || m.item.ref, price: m.item.price, url: m.item.url, image: (m.item.images && m.item.images[0]) || m.item.image || m.item.imageUrl || null }));

  const marketMatches = combined
    .map(item => ({ item, score: scoreMatch(item, wtb) }))
    .filter(m => m.score >= 30).sort((a, b) => b.score - a.score).slice(0, 15)
    .map(m => ({ score: m.score, source: m.item.source, title: m.item.title || m.item.name, ref: m.item.ref, price: m.item.price, url: m.item.url, imageUrl: m.item.imageUrl || null, seller: m.item.seller }));

  const icMatches = ic
    .map(item => ({ item, score: scoreMatch(item, wtb) }))
    .filter(m => m.score >= 30).sort((a, b) => b.score - a.score).slice(0, 8)
    .map(m => ({ score: m.score, seller: m.item.seller, name: m.item.title || m.item.model, ref: m.item.ref, price: m.item.price, url: m.item.url }));

  return { wtbId: wtb.id, matchedAt: new Date().toISOString(), inventoryMatches, marketMatches, icMatches };
}

module.exports = { matchWtb };
