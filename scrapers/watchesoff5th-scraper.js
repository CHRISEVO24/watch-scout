const fs = require("fs");
const path = require("path");
const axios = require("axios");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "watchesoff5th-latest.json");

function normalizeItem(p) {
  const variant = p.variants?.[0] || {};
  const available = variant.available === true;
  const price = available ? parseFloat(variant.price || "0") : null;
  const ref = p.tags?.find(t => /^[0-9]{4,6}[a-z]*/i.test(t) && !["pre-owned","papers","box","brand"].some(x=>t.toLowerCase().startsWith(x))) || null;
  return {
    id: `wo5-${p.id}`,
    source: "Watches OFF 5TH",
    sourceDetail: "watchesoff5th.com",
    brand: p.vendor || null,
    model: null,
    ref,
    title: p.title,
    price: price || null,
    url: `https://www.watchesoff5th.com/products/${p.handle}`,
    imageUrl: p.images?.[0]?.src || null,
    condition: "Pre-Owned",
    postedMinutesAgo: Math.round((Date.now() - new Date(p.published_at).getTime()) / 60000),
    scrapedAt: new Date().toISOString(),
  };
}

async function scrape() {
  console.log("[WatchesOFF5TH] Starting scrape...");
  const items = [];
  let page = 1;
  while (true) {
    const { data } = await axios.get(`https://www.watchesoff5th.com/products.json?limit=250&page=${page}`, {
      headers: { "User-Agent": "Mozilla/5.0" }, timeout: 30000
    });
    if (!data.products?.length) break;
    data.products.filter(p => p.product_type === "Watch" && p.variants?.[0]?.price).forEach(p => items.push(normalizeItem(p)));
    if (data.products.length < 250) break;
    page++;
    await new Promise(r => setTimeout(r, 500));
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(items, null, 2));
  console.log(`[WatchesOFF5TH] Done. ${items.length} items written.`);
  return items;
}

if (require.main === module) scrape().catch(console.error);
module.exports = { scrape };
