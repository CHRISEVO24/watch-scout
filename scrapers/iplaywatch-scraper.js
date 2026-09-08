const fs = require("fs");
const path = require("path");
const axios = require("axios");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "iplaywatch-latest.json");

const API_URL = "https://www.iplaywatch.com/api/platform/prod/page";
const HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  "Referer": "https://www.iplaywatch.com/category/watch/1",
  "Origin": "https://www.iplaywatch.com"
};

function normalizeItem(i) {
  const imgs = i.imgs ? i.imgs.split(",") : [];
  const price = i.retailPrice || i.retailPriceToB || null;
  const ref = i.model || i.prodNumber || null;
  return {
    id: `ipw-${i.prodId}`,
    source: "iPlayWatch",
    sourceDetail: "iplaywatch.com",
    brand: (i.brand || "").trim() || null,
    model: i.series || null,
    ref: ref || null,
    title: i.prodName || null,
    price: price || null,
    url: `https://www.iplaywatch.com/product/${i.prodId}`,
    imageUrl: imgs[0] || null,
    condition: i.prodQuality || null,
    year: i.years || null,
    postedMinutesAgo: null,
    scrapedAt: new Date().toISOString(),
  };
}

async function scrape() {
  console.log("[iPlayWatch] Starting scrape...");
  const items = [];
  let page = 1;
  const pageSize = 50;

  while (true) {
    try {
      const { data } = await axios.post(API_URL, {
        pageNo: page, pageSize, status: 11
      }, { headers: HEADERS, timeout: 30000 });

      if (!data.sucFlag || !data.data?.length) break;
      
      data.data.forEach(i => items.push(normalizeItem(i)));
      console.log(`[iPlayWatch] Page ${page}: ${data.data.length} items (total: ${items.length}/${data.totalCount})`);
      
      if (items.length >= data.totalCount) break;
      page++;
      await new Promise(r => setTimeout(r, 1500));
    } catch(e) {
      if (e.response?.status === 429) {
        console.log(`[iPlayWatch] Rate limited, waiting 15s...`);
        await new Promise(r => setTimeout(r, 15000));
        continue; // retry same page
      }
      console.error(`[iPlayWatch] Page ${page} error:`, e.message);
      break;
    }
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(items, null, 2));
  console.log(`[iPlayWatch] Done. ${items.length} items written.`);
  return items;
}

if (require.main === module) scrape().catch(console.error);
module.exports = { scrape };
