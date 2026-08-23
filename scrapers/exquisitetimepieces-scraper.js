const fs = require("fs");
const path = require("path");
const axios = require("axios");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "exquisitetimepieces-latest.json");

function normalizeItem(p) {
  const variant = p.variants?.[0] || {};
  const available = variant.available === true;
  const price = available ? parseFloat(variant.price || "0") : null;
  const sku = variant.sku || null;
  const tags = p.tags || [];
  const isPreOwned = tags.some(t => t.toLowerCase().includes("pre-owned") || t.toLowerCase().includes("preowned") || t.toLowerCase().includes("used"));
  return {
    id: `etp-${p.id}`,
    source: "Exquisite Timepieces",
    sourceDetail: "exquisitetimepieces.com",
    brand: p.vendor || null,
    model: null,
    ref: sku || null,
    title: p.title,
    price: price || null,
    url: `https://www.exquisitetimepieces.com/products/${p.handle}`,
    imageUrl: p.images?.[0]?.src || null,
    condition: isPreOwned ? "Pre-Owned" : "New",
    postedMinutesAgo: Math.round((Date.now() - new Date(p.published_at).getTime()) / 60000),
    scrapedAt: new Date().toISOString(),
  };
}

async function scrape() {
  console.log("[ExquisiteTimepieces] Starting scrape...");
  const items = [];
  let page = 1;
  while (true) {
    const { data } = await axios.get(`https://www.exquisitetimepieces.com/products.json?limit=250&page=${page}`, {
      headers: { "User-Agent": "Mozilla/5.0" }, timeout: 30000
    });
    if (!data.products?.length) break;
    data.products
      .filter(p => p.title && p.variants?.[0]?.price && parseFloat(p.variants[0].price) > 0)
      .forEach(p => items.push(normalizeItem(p)));
    if (data.products.length < 250) break;
    page++;
    await new Promise(r => setTimeout(r, 600));
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(items, null, 2));
  console.log(`[ExquisiteTimepieces] Done. ${items.length} items written.`);
  return items;
}

if (require.main === module) scrape().catch(console.error);
module.exports = { scrape };
