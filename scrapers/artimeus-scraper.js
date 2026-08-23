const fs = require("fs");
const path = require("path");
const axios = require("axios");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "artimeus-latest.json");

function normalizeItem(p) {
  const variant = p.variants?.[0] || {};
  const available = variant.available === true;
  const price = available ? parseFloat(variant.price || "0") : null;
  const tags = (p.tags || []).map(t => t.toLowerCase());
  const ref = p.tags?.find(t => /^[0-9]{4,6}[a-z]*/i.test(t) && !["pre-owned","papers","box"].includes(t.toLowerCase())) || null;
  return {
    id: `artimeus-${p.id}`,
    source: "Artimeus",
    sourceDetail: "artimeus.com",
    brand: p.vendor || null,
    model: null,
    ref,
    title: p.title,
    price: price || null,
    url: `https://artimeus.com/products/${p.handle}`,
    imageUrl: p.images?.[0]?.src || null,
    condition: tags.includes("pre-owned") ? "Pre-Owned" : "New",
    postedMinutesAgo: Math.round((Date.now() - new Date(p.published_at).getTime()) / 60000),
    scrapedAt: new Date().toISOString(),
  };
}

async function scrape() {
  console.log("[Artimeus] Starting scrape...");
  const items = [];
  let page = 1;
  while (true) {
    const url = `https://artimeus.com/products.json?limit=250&page=${page}`;
    const { data } = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 30000 });
    if (!data.products?.length) break;
    data.products.filter(p => p.product_type === "Watch" && p.variants?.[0]?.price).forEach(p => items.push(normalizeItem(p)));
    if (data.products.length < 250) break;
    page++;
    await new Promise(r => setTimeout(r, 500));
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(items, null, 2));
  console.log(`[Artimeus] Done. ${items.length} items written.`);
  return items;
}

if (require.main === module) scrape().catch(console.error);
module.exports = { scrape };
