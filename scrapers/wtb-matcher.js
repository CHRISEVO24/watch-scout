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
  const itemRef = normalizeRef(item.ref || (item.title ? (item.title.match(/\b([A-Z]{0,3}[0-9]{3,6}[A-Z0-9]{0,6})\b/i)||[])[1] : null));
  const wtbRef = normalizeRef(wtb.ref);
  const itemText = [item.brand, item.model, item.ref, item.title, item.name].filter(Boolean).join(" ").toLowerCase();

  // HARD FILTERS run first — before any ref/brand matching

  // 1. Dial color — if specified, must match
  if (wtb.dialColor && wtb.dialColor !== "Any color" && wtb.dialColor !== "") {
    const wtbColor = wtb.dialColor.toLowerCase();
    const itemColor = (item.dialColor || item.color || "").toLowerCase();
    if (itemColor) {
      if (!itemColor.includes(wtbColor)) return 0;
    } else {
      if (!itemText.includes(wtbColor)) return 0;
    }
  }

  // 2. Condition — unworn is strict
  if (wtb.condition && wtb.condition !== "Any condition" && wtb.condition !== "") {
    const itemCond = (item.condition || "").toLowerCase();
    const wtbCond = wtb.condition.toLowerCase();
    if ((wtbCond === "unworn / new" || wtbCond === "unworn") && itemCond) {
      if (!["unworn","new","brand new"].some(c => itemCond.includes(c))) return 0;
    }
  }

  // 3. Budget — reject anything over 1.3x budget
  if (wtb.budgetMax && item.price) {
    const p = typeof item.price === "string" ? parseFloat(item.price.replace(/[^0-9.]/g, "")) : item.price;
    if (!isNaN(p) && p > wtb.budgetMax * 1.3) return 0;
  }

  // If ref is specified, ONLY match on ref — brand/model alone is not enough
  if (wtbRef) {
    if (!itemRef) return 0;
    if (itemRef === wtbRef) return 100;
    // Partial match only if refs are long enough and share significant overlap
    if (wtbRef.length >= 5 && itemRef.length >= 5) {
      if (itemRef.startsWith(wtbRef) || wtbRef.startsWith(itemRef)) return 60;
    }
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

async function searchWatchDrop(ref, brand) {
  if (!ref) return [];
  try {
    const cookiesFile = path.join(DATA_DIR, "inventoryconnect-cookies.json");
    if (!fs.existsSync(cookiesFile)) return [];
    const { chromium } = require("playwright");
    const rawCookies = JSON.parse(fs.readFileSync(cookiesFile, "utf8"));
    const cookies = rawCookies.map(c => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path,
      expires: c.session ? -1 : Math.floor(c.expirationDate),
      httpOnly: c.httpOnly, secure: c.secure,
      sameSite: c.sameSite === "unspecified" ? "Lax" : (c.sameSite?.charAt(0).toUpperCase() + c.sameSite?.slice(1)) || "Lax"
    }));
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ userAgent: "Mozilla/5.0" });
    await ctx.addCookies(cookies);
    const page = await ctx.newPage();
    await page.goto("https://www.inventoryconnect.io/watchdrop", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(1000);
    const results = await page.evaluate(async (searchRef) => {
      const r = await fetch("/watchdrop/api/listings?limit=20&currency=USD&reference=" + searchRef);
      const d = JSON.parse(await r.text());
      return d.items || [];
    }, ref);
    await browser.close();
    return results
      .filter(i => i.listing_type !== "wtb" && i.listing_type !== "ntq")
      .map(i => ({
        score: 80,
        source: "WatchDrop",
        title: [i.brand, i.model, i.reference_number].filter(Boolean).join(" "),
        ref: i.reference_number || null,
        price: i.price ? parseFloat(i.price) : null,
        url: "https://www.inventoryconnect.io/watchdrop/" + i.id,
        imageUrl: i.photo_url ? "https://www.inventoryconnect.io" + i.photo_url : null,
        seller: i.sender || null,
        postedMinutesAgo: i.posted_at ? Math.round((Date.now() - new Date(i.posted_at).getTime()) / 60000) : null,
      }));
  } catch(e) {
    console.log("[WatchDrop] Live search error:", e.message);
    return [];
  }
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

  // Add live WatchDrop results if ref is specified
  let wdMatches = [];
  if (wtb.ref) {
    wdMatches = await searchWatchDrop(wtb.ref, wtb.brand);
    console.log("[WTB] WatchDrop live:", wdMatches.length, "results for ref", wtb.ref);
  }

  // Merge WatchDrop into market matches (deduplicated)
  const allMktUrls = new Set(marketMatches.map(m => m.url).filter(Boolean));
  const newWd = wdMatches.filter(m => !allMktUrls.has(m.url));
  const finalMarket = [...marketMatches, ...newWd]
    .sort((a,b) => (a.postedMinutesAgo||99999) - (b.postedMinutesAgo||99999))
    .slice(0, 20);

  return { wtbId: wtb.id, matchedAt: new Date().toISOString(), inventoryMatches, marketMatches: finalMarket, icMatches };
}

module.exports = { matchWtb };
