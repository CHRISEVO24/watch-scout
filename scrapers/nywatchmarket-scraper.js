const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "nywatchmarket-latest.json");

async function scrape() {
  console.log("[NY Watch Market] Starting scrape...");
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
  });
  const page = await ctx.newPage();
  const items = [];
  const seen = new Set();
  let pg = 1;

  while (pg <= 20) {
    const url = `https://nywatchmarket.com/shop/page/${pg}/?stock_filter=instock`;
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    const products = await page.evaluate(() => {
      const results = [];
      const seen = new Set();
      [...document.querySelectorAll('a[href*="/product/"]')].forEach(a => {
        if (seen.has(a.href) || !a.href.includes('/product/')) return;
        seen.add(a.href);
        const card = a.closest('li,div,article') || a.parentElement;
        const title = card?.querySelector('h2,h3,.woocommerce-loop-product__title,[class*="title"]')?.textContent?.trim();
        const price = card?.querySelector('.price,.amount,[class*="price"]')?.textContent?.trim();
        const img = card?.querySelector('img')?.src;
        if (title) results.push({ href: a.href, title, price, img });
      });
      return results;
    });

    if (!products.length) { console.log(`[NY Watch Market] Page ${pg} empty, stopping`); break; }

    products.forEach(p => {
      if (seen.has(p.href)) return;
      seen.add(p.href);
      const priceNum = parseFloat((p.price||'').replace(/[^0-9.]/g,''))||null;
      const refMatch = p.title?.match(/\b([A-Z]{0,3}[0-9]{4,7}[A-Z0-9]{0,6})\b/i);
      items.push({
        id: `nywm-${Buffer.from(p.href).toString('base64').slice(0,10)}`,
        source: "NY Watch Market",
        sourceDetail: "nywatchmarket.com",
        brand: null, model: null,
        ref: refMatch?.[1] || null,
        title: p.title, price: priceNum,
        url: p.href, imageUrl: p.img || null,
        condition: "Pre-Owned",
        postedMinutesAgo: null,
        scrapedAt: new Date().toISOString(),
      });
    });

    console.log(`[NY Watch Market] Page ${pg}: ${products.length} items (total: ${items.length})`);
    pg++;
    await page.waitForTimeout(2000);
  }

  await browser.close();
  fs.writeFileSync(OUT_FILE, JSON.stringify(items, null, 2));
  console.log(`[NY Watch Market] Done: ${items.length} items`);
  return items;
}

if (require.main === module) scrape().catch(console.error);
module.exports = { scrape };
