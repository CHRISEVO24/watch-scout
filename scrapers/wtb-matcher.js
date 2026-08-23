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

  // If ref is specified, ONLY match on ref — brand/model alone is not enough
  if (wtbRef) {
    if (!itemRef) return 0; // item has no ref, skip
    if (itemRef === wtbRef) return 100; // exact ref match
    if (itemRef.startsWith(wtbRef) || wtbRef.startsWith(itemRef)) return 60; // partial ref match
    return 0; // ref doesn't match at all — reject
  }

  // No ref specified — match on brand + model keywords
  let score = 0;
  if (wtb.brand && itemText.includes(wtb.brand.toLowerCase())) score += 30;
  if (wtb.model) {
    const words = wtb.model.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const matched = words.filter(w => itemText.includes(w));
    if (matched.length >= Math.ceil(words.length * 0.7)) score += matched.length * 10;
    else return 0; // not enough model words match
  }

  // Budget check
  if (wtb.budgetMax && item.price) {
    const p = typeof item.price === "string" ? parseFloat(item.price.replace(/[^0-9.]/g, "")) : item.price;
    if (!isNaN(p) && p > wtb.budgetMax * 1.2) return 0;
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

  // Deduplicate market matches by url then price+source
  const mktSeen = new Set();
  const dedupedMkt = marketMatches.filter(m => {
    const key = m.url || (String(m.price||'') + (m.source||'') + (m.title||'').slice(0,20));
    if (mktSeen.has(key)) return false;
    mktSeen.add(key);
    return true;
  });

  return { wtbId: wtb.id, matchedAt: new Date().toISOString(), inventoryMatches, marketMatches: dedupedMkt, icMatches };
}

module.exports = { matchWtb };
