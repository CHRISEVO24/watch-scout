const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "swisswatchexpo-latest.json");
const BASE_URL = "https://www.swisswatchexpo.com";

function parsePrice(str) {
  if (!str) return null;
  const prices = str.match(/\$[\d,]+/g);
  if (!prices) return null;
  // Take the last price (sale price)
  const n = parseFloat(prices[prices.length - 1].replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : n;
}

function extractRef(url) {
  const m = url.match(/-(\d{4,6}[a-z]{0,4})-/i);
  return m ? m[1].toUpperCase() : null;
}

function extractBrand(url) {
  const brands = ["rolex","patek-philippe","audemars-piguet","omega","cartier","iwc","breitling","tudor","panerai","a-lange","richard-mille","hublot","tag-heuer","jaeger","vacheron","girard"];
  const found = brands.find(b => url.toLowerCase().includes(b));
  return found ? found.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : null;
}

async function scrapePage(page) {
  const url = `${BASE_URL}/watches/?page=${page}`;
  const { data } = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml",
    },
    timeout: 30000,
  });
  const $ = cheerio.load(data);
  const items = [];

  $("img[src*='cdn.swisswatchexpo.com']").each((_, img) => {
    const card = $(img).closest(".col-6");
    if (!card.length) return;
    const href = card.find("a").first().attr("href");
    if (!href || !href.includes("/watches/")) return;
    const fullUrl = href.startsWith("http") ? href : BASE_URL + href;
    const imgSrc = $(img).attr("src");
    const allText = card.text().trim();
    const price = parsePrice(allText);
    
    // Extract title from URL slug
    const slug = href.split("/watches/")[1]?.replace(/-\d{4,6}\/$/, "").replace(/-/g, " ").trim();
    const title = slug ? slug.replace(/\b\w/g, c => c.toUpperCase()) : null;

    items.push({
      id: `swe-${href.split("/").filter(Boolean).pop()}`,
      source: "SwissWatchExpo",
      sourceDetail: "swisswatchexpo.com",
      brand: extractBrand(href),
      model: null,
      ref: extractRef(href),
      title: title || "SwissWatchExpo Listing",
      price,
      url: fullUrl,
      imageUrl: imgSrc ? (imgSrc.startsWith("http") ? imgSrc : "https:" + imgSrc) : null,
      condition: "Pre-Owned",
      postedMinutesAgo: null,
      scrapedAt: new Date().toISOString(),
    });
  });

  return items;
}

async function scrape() {
  console.log("[SwissWatchExpo] Starting scrape...");
  const items = [];
  for (let page = 1; page <= 35; page++) {
    try {
      const pageItems = await scrapePage(page);
      if (!pageItems.length) { console.log(`[SwissWatchExpo] No items on page ${page}, stopping.`); break; }
      items.push(...pageItems);
      console.log(`[SwissWatchExpo] Page ${page}: ${pageItems.length} items (total: ${items.length})`);
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      console.error(`[SwissWatchExpo] Page ${page} error:`, e.message);
      break;
    }
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(items, null, 2));
  console.log(`[SwissWatchExpo] Done. ${items.length} items written.`);
  return items;
}

if (require.main === module) scrape().catch(console.error);
module.exports = { scrape };
