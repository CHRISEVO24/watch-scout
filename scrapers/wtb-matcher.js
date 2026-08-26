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
  // Extract ref from title if not stored directly
  const itemRef = normalizeRef(item.ref || (item.title ? (item.title.match(/([0-9]{3,6}[A-Z]{0,4})/i)||[])[1] : null));
  const wtbRef = normalizeRef(wtb.ref);
  const itemText = [item.brand, item.model, item.ref, item.title, item.name].filter(Boolean).join(" ").toLowerCase();

  // HARD FILTER: Dial color — if specified, must match
  if (wtb.dialColor && wtb.dialColor !== "Any color" && wtb.dialColor !== "") {
    const wtbColor = wtb.dialColor.toLowerCase();
    const itemColor = (item.dialColor || item.color || "").toLowerCase();
    if (itemColor) {
      // Item has a color field — must match exactly
      if (!itemColor.includes(wtbColor)) return 0;
    } else {
      // No color field — title must explicitly mention the color
      if (!itemText.includes(wtbColor)) return 0;
    }
  }

  // HARD FILTER: Condition — if specified, must be close match
  if (wtb.condition && wtb.condition !== "Any condition" && wtb.condition !== "") {
    const itemCond = (item.condition || "").toLowerCase();
    const wtbCond = wtb.condition.toLowerCase();
    if (wtbCond === "unworn / new" || wtbCond === "unworn") {
      if (itemCond && !["unworn","new","brand new"].some(c => itemCond.includes(c))) return 0;
    }
    // For other conditions we're more lenient — just score, don't hard filter
  }

  // HARD FILTER: Budget — reject anything over 1.3x budget
  if (wtb.budgetMax && item.price) {
    const p = typeof item.price === "string" ? parseFloat(item.price.replace(/[^0-9.]/g, "")) : item.price;
    if (!isNaN(p) && p > wtb.budgetMax * 1.3) return 0;
  }

  // If ref is specified, ONLY match on ref — brand/model alone is not enough
  if (wtbRef) {
    if (!itemRef) return 0;
    if (itemRef === wtbRef) return 100;
    if (itemRef.startsWith(wtbRef) || wtbRef.startsWith(itemRef)) return 60;
    return 0;
  }

  // No ref specified — match on brand + model keywords
  let score = 0;
  if (wtb.brand && itemText.includes(wtb.brand.toLowerCase())) score += 30;
  if (wtb.model) {
    const words = wtb.model.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const matched = words.filter(w => itemText.includes(w));
    if (matched.length >= Math.ceil(words.length * 0.7)) score += matched.length * 10;
    else return 0;
  }

  // BONUS: Box & Papers match
  if (wtb.boxPapers && wtb.boxPapers !== "No preference") {
    const itemBP = (item.boxPapers || item.title || "").toLowerCase();
    if (wtb.boxPapers === "Box & Papers required" && !itemBP.includes("paper")) score -= 20;
    if (wtb.boxPapers === "Papers required" && !itemBP.includes("paper")) score -= 20;
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

  const _mktRaw = combined
    .map(item => ({ item, score: scoreMatch(item, wtb) }))
    .filter(m => m.score >= 30).sort((a, b) => b.score - a.score)
    .map(m => ({ score: m.score, source: m.item.source, title: m.item.title || m.item.name, ref: m.item.ref, price: m.item.price, url: m.item.url, imageUrl: m.item.imageUrl || null, seller: m.item.seller }));
  // Deduplicate before slicing
  const _mktSeen = new Set();
  const marketMatches = _mktRaw.filter(m => {
    const key = String(m.price||'') + '|' + (m.source||'') + '|' + (m.title||'').slice(0,25);
    if (_mktSeen.has(key)) return false;
    _mktSeen.add(key);
    return true;
  }).slice(0, 15);

  const icMatches = ic
    .map(item => ({ item, score: scoreMatch(item, wtb) }))
    .filter(m => m.score >= 30).sort((a, b) => b.score - a.score).slice(0, 8)
    .map(m => ({ score: m.score, seller: m.item.seller, name: m.item.title || m.item.model, ref: m.item.ref, price: m.item.price, url: m.item.url }));

  return { wtbId: wtb.id, matchedAt: new Date().toISOString(), inventoryMatches, marketMatches, icMatches };
}

module.exports = { matchWtb };
