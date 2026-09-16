const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "essentialwatches-latest.json");
const BASE = "https://www.essential-watches.com";
const TOTAL_PAGES = 64;
const BATCH_SIZE = 8; // pages per browser session

async function scrapeBatch(startPage, endPage, existingIds) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }
  });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
  const page = await ctx.newPage();
  const items = [];

  for (let pg = startPage; pg <= endPage; pg++) {
    const url = pg === 1 ? `${BASE}/Pre-Owned` : `${BASE}/Pre-Owned/${pg}`;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2000 + Math.floor(Math.random() * 1500));

      const pageItems = await page.evaluate((base) => {
        const results = [];
        document.querySelectorAll('.product-thumb').forEach(card => {
          const link = card.querySelector('a[href*="/watch/"]');
          if (!link) return;
          const img = card.querySelector('img[data-src]');
          const itemId = link.getAttribute('data-itemid');
          const container = card.closest('.product-layout') || card.parentElement?.parentElement;
          const priceText = (container?.innerText || '').match(/Price\s*[-–]\s*\$([\d,]+)/);
          const price = priceText ? parseFloat(priceText[1].replace(/,/g, '')) : null;
          const title = link.getAttribute('href')?.split('/watch/')[1]?.replace(/-/g, ' ')?.split('/')[0] || '';
          results.push({
            href: base + link.getAttribute('href'),
            title: title.slice(0, 100),
            price,
            img: img?.getAttribute('data-src') || null,
            itemId
          });
        });
        return results;
      }, BASE);

      if (!pageItems.length) {
        console.log(`[Essential Watches] Page ${pg} empty`);
        break;
      }

      pageItems.forEach(item => {
        const id = `ew-${item.itemId || Buffer.from(item.href).toString('base64').slice(0, 10)}`;
        if (existingIds.has(id)) return;
        existingIds.add(id);
        const refMatch = (item.title || '').match(/\b([A-Z]{0,3}[0-9]{4,7}[A-Z0-9]{0,6})\b/i);
        items.push({
          id,
          source: "Essential Watches",
          sourceDetail: "essential-watches.com",
          brand: null, model: null,
          ref: refMatch?.[1] || null,
          title: item.title,
          price: item.price,
          url: item.href,
          imageUrl: item.img || null,
          condition: "Pre-Owned",
          postedMinutesAgo: null,
          scrapedAt: new Date().toISOString(),
        });
      });

      console.log(`[Essential Watches] Page ${pg}: ${pageItems.length} items (batch total: ${items.length})`);
      await page.waitForTimeout(1500 + Math.floor(Math.random() * 1000));
    } catch(e) {
      console.error(`[Essential Watches] Page ${pg} error:`, e.message);
      break;
    }
  }

  await browser.close();
  return items;
}

async function scrape() {
  console.log("[Essential Watches] Starting batch scrape...");
  const allItems = [];
  const seenIds = new Set();

  for (let start = 1; start <= TOTAL_PAGES; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE - 1, TOTAL_PAGES);
    console.log(`\n[Essential Watches] Batch: pages ${start}-${end}...`);
    const batch = await scrapeBatch(start, end, seenIds);
    allItems.push(...batch);
    if (batch.length === 0) { console.log('[Essential Watches] Empty batch, stopping.'); break; }
    // Save progress
    fs.writeFileSync(OUT_FILE, JSON.stringify(allItems, null, 2));
    console.log(`[Essential Watches] Progress saved: ${allItems.length} total`);
    // Wait between browser sessions
    if (end < TOTAL_PAGES) await new Promise(r => setTimeout(r, 5000));
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(allItems, null, 2));
  console.log(`\n[Essential Watches] Done: ${allItems.length} items`);
}

scrape().catch(console.error);
