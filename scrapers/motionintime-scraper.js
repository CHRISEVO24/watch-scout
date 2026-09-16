const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "motionintime-latest.json");
const BASE = "https://motionintime.com";

async function scrapeBatch(startPage, endPage, seenIds) {
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled','--no-sandbox'] });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 }
  });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
  const page = await ctx.newPage();
  const items = [];

  for (let pg = startPage; pg <= endPage; pg++) {
    const url = `${BASE}/?page=search&currentPage=${pg}&numPerPage=50`;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2000 + Math.floor(Math.random() * 1000));

      const pageItems = await page.evaluate((base) => {
        const results = [];
        document.querySelectorAll('.item-container, .product-item, [class*="item"]').forEach(card => {
          const link = card.querySelector('a[href*="?page="]');
          if (!link || !link.href.includes('itemId')) return;
          const title = card.querySelector('.item-title, h3, h4, [class*="title"], [class*="name"]')?.textContent?.trim();
          const ref = card.querySelector('.item-sku, [class*="sku"], [class*="ref"]')?.textContent?.trim();
          const priceEl = card.querySelector('[class*="price"], .price');
          const priceText = priceEl?.textContent?.trim();
          const priceNum = parseFloat((priceText||'').replace(/[^0-9.]/g,''))||null;
          const img = card.querySelector('img')?.src;
          if(title) results.push({ href: link.href, title: title.slice(0,100), ref: ref||null, price: priceNum, img: img||null });
        });
        return results;
      }, BASE);

      if (!pageItems.length) { console.log(`[Motion in Time] Page ${pg} empty`); break; }

      pageItems.forEach(item => {
        const id = `mit-${Buffer.from(item.href).toString('base64').slice(0,12)}`;
        if (seenIds.has(id)) return;
        seenIds.add(id);
        const refMatch = (item.ref||item.title||'').match(/\b([A-Z]{0,3}[0-9]{4,7}[A-Z0-9]{0,6})\b/i);
        items.push({
          id, source: "Motion in Time", sourceDetail: "motionintime.com",
          brand: null, model: null, ref: refMatch?.[1]||item.ref||null,
          title: item.title, price: item.price, url: item.href, imageUrl: item.img,
          condition: "Pre-Owned", postedMinutesAgo: null, scrapedAt: new Date().toISOString(),
        });
      });

      console.log(`[Motion in Time] Page ${pg}: ${pageItems.length} items (batch: ${items.length})`);
      await page.waitForTimeout(1000 + Math.floor(Math.random() * 500));
    } catch(e) { console.error(`[Motion in Time] Page ${pg} error:`, e.message); break; }
  }
  await browser.close();
  return items;
}

async function scrape() {
  console.log("[Motion in Time] Starting scrape (5139 items, 103 pages)...");
  const allItems = [];
  const seenIds = new Set();
  const BATCH = 10;

  for (let start = 1; start <= 103; start += BATCH) {
    const end = Math.min(start + BATCH - 1, 103);
    console.log(`\n[Motion in Time] Batch pages ${start}-${end}...`);
    const batch = await scrapeBatch(start, end, seenIds);
    allItems.push(...batch);
    if (batch.length === 0 && start > 1) { console.log('[Motion in Time] Empty batch, stopping.'); break; }
    fs.writeFileSync(OUT_FILE, JSON.stringify(allItems, null, 2));
    console.log(`[Motion in Time] Total saved: ${allItems.length}`);
    if (end < 103) await new Promise(r => setTimeout(r, 3000));
  }
  console.log(`\n[Motion in Time] Done: ${allItems.length} items`);
}

scrape().catch(console.error);
