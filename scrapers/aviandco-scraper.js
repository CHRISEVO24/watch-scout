const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "aviandco-latest.json");
const BASE = "https://www.aviandco.com";
const BATCH = 5;

async function scrapeBatch(start, end, seenIds) {
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled','--no-sandbox'] });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }
  });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
  const page = await ctx.newPage();
  const items = [];

  for (let pg = start; pg <= end; pg++) {
    const url = pg === 1 ? `${BASE}/collections/shop-by-brand` : `${BASE}/collections/shop-by-brand?p=${pg}`;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2500 + Math.floor(Math.random() * 1500));
      const pageItems = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll('.product-item, .item.product').forEach(card => {
          const link = card.querySelector('a.product-item-link, .product-item-name a');
          const price = card.querySelector('.price-wrapper .price, .price');
          const img = card.querySelector('img');
          if (!link) return;
          const priceNum = parseFloat((price?.textContent||'').replace(/[^0-9.]/g,''))||null;
          const title = link.textContent?.trim().replace(/\s+/g,' ')||'';
          const refMatch = title.match(/\b([A-Z]{0,3}[0-9]{4,7}[A-Z0-9]{0,6})\b/i);
          results.push({ href: link.href, title: title.slice(0,120), price: priceNum, ref: refMatch?.[1]||null, img: img?.src||null });
        });
        return results;
      });
      if (!pageItems.length) { console.log(`[Avi & Co] Page ${pg} empty`); break; }
      pageItems.forEach(item => {
        const id = `aviandco-${Buffer.from(item.href).toString('base64').slice(0,12)}`;
        if (seenIds.has(id)) return;
        seenIds.add(id);
        items.push({ id, source:"Avi & Co", sourceDetail:"aviandco.com", brand:null, model:null, ref:item.ref, title:item.title, price:item.price, url:item.href, imageUrl:item.img, condition:"Pre-Owned", postedMinutesAgo:null, scrapedAt:new Date().toISOString() });
      });
      console.log(`[Avi & Co] Page ${pg}: ${pageItems.length} items (batch: ${items.length})`);
      await page.waitForTimeout(1500 + Math.floor(Math.random() * 1000));
    } catch(e) { console.error(`[Avi & Co] Page ${pg} error:`, e.message); break; }
  }
  await browser.close();
  return items;
}

async function scrape() {
  console.log("[Avi & Co] Starting batch scrape (1990 items, ~111 pages)...");
  const allItems = [];
  const seenIds = new Set();

  for (let start = 1; start <= 120; start += BATCH) {
    const end = Math.min(start + BATCH - 1, 120);
    console.log(`\n[Avi & Co] Batch pages ${start}-${end}...`);
    const batch = await scrapeBatch(start, end, seenIds);
    allItems.push(...batch);
    if (batch.length === 0 && start > 1) { console.log('[Avi & Co] Empty batch, stopping.'); break; }
    fs.writeFileSync(OUT_FILE, JSON.stringify(allItems, null, 2));
    console.log(`[Avi & Co] Total saved: ${allItems.length}`);
    if (end < 120) await new Promise(r => setTimeout(r, 4000));
  }

  console.log(`\n[Avi & Co] Done: ${allItems.length} items`);
}

scrape().catch(console.error);
