const fs = require("fs");
const path = require("path");
const axios = require("axios");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "yurwatches-latest.json");
const API_BASE = "https://elefta-api-prod-5a14dea1fe41.herokuapp.com/v1/store/328b6e/yurwatches";
const HEADERS = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" };

async function scrape() {
  console.log("[YurWatches] Starting scrape...");
  const allItems = [];
  let page = 1;

  while (true) {
    try {
      const { data } = await axios.get(`${API_BASE}?page=${page}`, { headers: HEADERS, timeout: 30000 });
      const watches = data.watches || [];
      if (!watches.length) break;

      watches.forEach(w => {
        const img = w.images?.[0] || w.cover_photo || null;
        allItems.push({
          id: `yur-${w.id || w.sku}`,
          source: "YurWatches",
          sourceDetail: "yurwatches.elefta.store",
          brand: w.brand || w.full_brand || null,
          model: w.series || null,
          ref: w.reference_number || null,
          title: [w.brand, w.series, w.reference_number].filter(Boolean).join(" "),
          price: w.price ? parseFloat(String(w.price).replace(/[^0-9.]/g, '')) : null,
          url: `https://yurwatches.elefta.store/store/328b6e`,
          imageUrl: img || null,
          condition: w.display_condition || w.condition || null,
          dialColor: w.dial || null,
          box: w.box || null,
          papers: w.display_warranty_papers || w.papers || null,
          year: w.warranty || null,
          postedMinutesAgo: null,
          scrapedAt: new Date().toISOString(),
        });
      });

      console.log(`[YurWatches] Page ${page}/${data.paginate?.total_pages}: ${watches.length} items (total: ${allItems.length})`);
      if (!data.paginate?.next_page) break;
      page++;
      await new Promise(r => setTimeout(r, 500));
    } catch(e) {
      console.error(`[YurWatches] Error page ${page}:`, e.message);
      break;
    }
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(allItems, null, 2));
  console.log(`[YurWatches] Done: ${allItems.length} items`);
  return allItems;
}

if (require.main === module) scrape().catch(console.error);
module.exports = { scrape };
