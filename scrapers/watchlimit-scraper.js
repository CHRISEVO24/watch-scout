const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "watchlimit-latest.json");
const BASE_URL = "https://watchlimit.com";

function parsePrice(str) {
  if (!str) return null;
  const n = parseFloat(str.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : n;
}

function extractRef(title) {
  const m = title.match(/\b(\d{4,6}[A-Z]{0,4}(?:[.-]\d{3,4}[A-Z]{0,3})?)\b/);
  return m ? m[1] : null;
}

function extractBrand(title) {
  const brands = ["Rolex","Patek Philippe","Audemars Piguet","Omega","Cartier","IWC","Breitling","Tudor","Panerai","A. Lange","Richard Mille","Hublot","TAG Heuer","Jaeger","Vacheron","Girard"];
  return brands.find(b => title.toLowerCase().includes(b.toLowerCase())) || null;
}

async function scrape() {
  console.log("[WatchLimit] Starting scrape...");
  const items = [];
  let page = 1;
  while (page <= 20) {
    try {
      const url = `${BASE_URL}/shop/page/${page}/`;
      const { data } = await axios.get(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
        timeout: 30000,
      });
      const $ = cheerio.load(data);
      const cards = $(".product");
      if (!cards.length) break;
      cards.each((_, el) => {
        const title = $(el).find(".woocommerce-loop-product__title, h2").first().text().trim();
        const priceStr = $(el).find(".price").first().text().trim();
        const href = $(el).find("a.woocommerce-loop-product__link, a").first().attr("href");
        const img = $(el).find("img").first().attr("src") || $(el).find("img").first().attr("data-src");
        const condition = $(el).find(".product-meta, .sku").text().toLowerCase();
        if (!title) return;
        items.push({
          id: `wl-${Buffer.from(href || title).toString("base64").slice(0, 12)}`,
          source: "Watch Limit",
          sourceDetail: "watchlimit.com",
          brand: extractBrand(title),
          model: null,
          ref: extractRef(title),
          title,
          price: parsePrice(priceStr),
          url: href || null,
          imageUrl: img || null,
          condition: condition.includes("unworn") ? "Unworn" : "Pre-Owned",
          postedMinutesAgo: null,
          scrapedAt: new Date().toISOString(),
        });
      });
      console.log(`[WatchLimit] Page ${page}: ${cards.length} items`);
      page++;
      await new Promise(r => setTimeout(r, 800));
    } catch (e) {
      console.error(`[WatchLimit] Page ${page} error:`, e.message);
      break;
    }
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(items, null, 2));
  console.log(`[WatchLimit] Done. ${items.length} items written.`);
  return items;
}

if (require.main === module) scrape().catch(console.error);
module.exports = { scrape };
