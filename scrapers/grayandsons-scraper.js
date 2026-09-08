const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "grayandsons-latest.json");

async function scrapePage(page, pageNum) {
  const url = pageNum === 1
    ? "https://www.grayandsons.com/fine-watches/"
    : `https://www.grayandsons.com/fine-watches/page-${pageNum}/`;

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(5000);

  return await page.evaluate(() => {
    const items = [];
    const seen = new Set();
    [...document.querySelectorAll('a')].filter(a => a.href.match(/grayandsons\.com\/w\d+/)).forEach(link => {
      if (seen.has(link.href)) return;
      seen.add(link.href);
      const card = link.closest('div,li,article') || link.parentElement;
      const text = card?.innerText || link.innerText || '';
      const lines = text.split('\n').map(l=>l.trim()).filter(l=>l && !['SHOP','GET QUOTE','SELL','NEW ARRIVAL','SOLD'].includes(l));
      const priceMatch = text.match(/\$([\d,]+)/);
      const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g,'')) : null;
      const img = card?.querySelector('img[src*="cdn.grayandsons.com"]')?.src || null;
      items.push({ href: link.href, title: lines.slice(0,4).join(' ').slice(0,100), price, img });
    });
    return items;
  });
}

async function scrape() {
  console.log("[Gray & Sons] Starting scrape (394 pages)...");
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
  });
  const page = await ctx.newPage();
  const allItems = [];
  const seen = new Set();

  for (let pg = 1; pg <= 400; pg++) {
    try {
      const items = await scrapePage(page, pg);
      if (!items.length) { console.log(`[Gray & Sons] Page ${pg} empty, stopping.`); break; }
      items.forEach(item => {
        if (seen.has(item.href)) return;
        seen.add(item.href);
        const idMatch = item.href.match(/\/(w\d+)/);
        allItems.push({
          id: `gs-${idMatch?.[1] || Math.random().toString(36).slice(2)}`,
          source: "Gray & Sons",
          sourceDetail: "grayandsons.com",
          brand: null, model: null, ref: null,
          title: item.title,
          price: item.price,
          url: item.href,
          imageUrl: item.img || null,
          condition: "Pre-Owned",
          postedMinutesAgo: null,
          scrapedAt: new Date().toISOString(),
        });
      });
      console.log(`[Gray & Sons] Page ${pg}: ${items.length} items (total: ${allItems.length})`);
      await page.waitForTimeout(1000);
    } catch(e) {
      console.error(`[Gray & Sons] Page ${pg} error:`, e.message);
      await page.waitForTimeout(3000);
    }
  }

  await browser.close();
  fs.writeFileSync(OUT_FILE, JSON.stringify(allItems, null, 2));
  console.log(`[Gray & Sons] Done. ${allItems.length} items written.`);
}

if (require.main === module) scrape().catch(console.error);
module.exports = { scrape };
