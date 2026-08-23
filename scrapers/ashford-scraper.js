const fs = require("fs");
const path = require("path");
const axios = require("axios");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "ashford-latest.json");

function normalizeItem(p) {
  const variant = p.variants?.[0] || {};
  const price = parseFloat(variant.price || "0");
  return {
    id: `ash-${p.id}`,
    source: "Ashford",
    sourceDetail: "ashford.com",
    brand: p.vendor || null,
    model: null,
    ref: variant.sku || null,
    title: p.title,
    price: price || null,
    url: `https://www.ashford.com/products/${p.handle}`,
    imageUrl: p.images?.[0]?.src || null,
    condition: "New",
    postedMinutesAgo: Math.round((Date.now() - new Date(p.published_at).getTime()) / 60000),
    scrapedAt: new Date().toISOString(),
  };
}

async function scrape() {
  console.log("[Ashford] Starting scrape...");
  const items = [];
  let page = 1;
  while (page <= 60) {
    try {
      const { data } = await axios.get(`https://www.ashford.com/products.json?limit=250&page=${page}`, {
        headers: { 
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json",
          "Accept-Language": "en-US,en;q=0.9",
        }, 
        timeout: 30000
      });
      if (!data.products?.length) break;
      data.products
        .filter(p => p.variants?.[0]?.available && p.images?.length && parseFloat(p.variants[0].price) > 0)
        .forEach(p => items.push(normalizeItem(p)));
      console.log(`[Ashford] Page ${page}: ${data.products.length} products (total items: ${items.length})`);
      if (data.products.length < 250) break;
      page++;
      await new Promise(r => setTimeout(r, 2000)); // 2 second delay to avoid rate limiting
    } catch(e) {
      if (e.response?.status === 429) {
        console.log(`[Ashford] Rate limited at page ${page}, waiting 10s...`);
        await new Promise(r => setTimeout(r, 10000));
        continue; // retry same page
      }
      console.error(`[Ashford] Error at page ${page}:`, e.message);
      break;
    }
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(items, null, 2));
  console.log(`[Ashford] Done. ${items.length} items written.`);
  return items;
}

if (require.main === module) scrape().catch(console.error);
module.exports = { scrape };
