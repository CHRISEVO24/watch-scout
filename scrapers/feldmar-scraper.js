const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "feldmar-latest.json");
const BASE_URL = "https://feldmarwatch.com/product-category/certified-pre-owned/page/";

async function scrape() {
  console.log("[Feldmar] Starting scrape...");
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" });
  const page = await ctx.newPage();
  const allItems = [];
  const seen = new Set();

  for (let pg = 1; pg <= 10; pg++) {
    const url = pg === 1 ? "https://feldmarwatch.com/product-category/certified-pre-owned/" : `${BASE_URL}${pg}/`;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(1500);

      const items = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll('li.product, .type-product').forEach(el => {
          const link = el.querySelector('a');
          const title = el.querySelector('h2, .woocommerce-loop-product__title')?.textContent?.trim();
          const price = el.querySelector('.price')?.textContent?.trim();
          const img = el.querySelector('img')?.src;
          if (!link || !title) return;
          const priceNum = parseFloat((price || '').replace(/[^0-9.]/g, '')) || null;
          const refMatch = title.match(/\b([A-Z]{0,3}[0-9]{4,7}[A-Z0-9]{0,6})\b/i);
          results.push({ href: link.href, title, price: priceNum, img, ref: refMatch?.[1] || null });
        });
        return results;
      });

      if (!items.length) { console.log(`[Feldmar] Page ${pg} empty, stopping.`); break; }

      items.forEach(item => {
        if (seen.has(item.href)) return;
        seen.add(item.href);
        allItems.push({
          id: `feldmar-${Buffer.from(item.href).toString('base64').slice(0, 10)}`,
          source: "Feldmar Watch",
          sourceDetail: "feldmarwatch.com",
          brand: null, model: null,
          ref: item.ref || null,
          title: item.title,
          price: item.price,
          url: item.href,
          imageUrl: item.img || null,
          condition: "Pre-Owned",
          postedMinutesAgo: null,
          scrapedAt: new Date().toISOString(),
        });
      });

      console.log(`[Feldmar] Page ${pg}: ${items.length} items (total: ${allItems.length})`);
      await page.waitForTimeout(1000);
    } catch(e) {
      console.error(`[Feldmar] Page ${pg} error:`, e.message);
      break;
    }
  }

  await browser.close();
  fs.writeFileSync(OUT_FILE, JSON.stringify(allItems, null, 2));
  console.log(`[Feldmar] Done: ${allItems.length} items`);
}

scrape().catch(console.error);
