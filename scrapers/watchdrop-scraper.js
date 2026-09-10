const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DATA_DIR = path.join(__dirname, "..", "data");
const COOKIES_FILE = path.join(DATA_DIR, "inventoryconnect-cookies.json");
const OUT_FILE = path.join(DATA_DIR, "watchdrop-latest.json");

function convertCookies(raw) {
  return raw.map(c => ({
    name: c.name, value: c.value, domain: c.domain, path: c.path,
    expires: c.session ? -1 : Math.floor(c.expirationDate),
    httpOnly: c.httpOnly, secure: c.secure,
    sameSite: c.sameSite === 'unspecified' ? 'Lax' : (c.sameSite?.charAt(0).toUpperCase() + c.sameSite?.slice(1)) || 'Lax'
  }));
}

async function scrape() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" });
  await ctx.addCookies(convertCookies(JSON.parse(fs.readFileSync(COOKIES_FILE, "utf8"))));
  const page = await ctx.newPage();
  await page.goto("https://www.inventoryconnect.io/watchdrop?f-cur=USD", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
  if (page.url().includes("login")) { console.error("Session expired."); await browser.close(); return; }
  console.log("[WatchDrop] Session valid. Looking for Load More button...");

  const allItems = [];
  const seenIds = new Set();
  let clicks = 0;
  const MAX_CLICKS = 1000;

  while (clicks < MAX_CLICKS) {
    // Extract all current listing IDs via API intercept from DOM
    const items = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('a[href*="/watchdrop/"]').forEach(a => {
        const id = a.href.split('/watchdrop/')[1]?.split('?')[0];
        if (!id || id.length < 3) return;
        const card = a.closest('div,li,article') || a.parentElement;
        const title = card?.querySelector('h2,h3,[class*="title"],[class*="name"]')?.textContent?.trim();
        const price = card?.querySelector('[class*="price"]')?.textContent?.trim();
        const img = card?.querySelector('img')?.src;
        const ref = card?.querySelector('[class*="ref"],[class*="reference"]')?.textContent?.trim();
        const brand = card?.querySelector('[class*="brand"]')?.textContent?.trim();
        results.push({ id, href: a.href, title, price, img, ref, brand });
      });
      return results;
    });

    let newCount = 0;
    items.forEach(item => {
      if (seenIds.has(item.id)) return;
      seenIds.add(item.id);
      const priceNum = parseFloat((item.price||'').replace(/[^0-9.]/g,''))||null;
      allItems.push({
        id: `wd-${item.id}`,
        source: "WatchDrop",
        sourceDetail: "inventoryconnect.io/watchdrop",
        brand: item.brand || null,
        model: null,
        ref: item.ref || null,
        title: item.title || null,
        price: priceNum,
        url: item.href,
        imageUrl: item.img || null,
        condition: null,
        postedMinutesAgo: null,
        scrapedAt: new Date().toISOString(),
      });
      newCount++;
    });

    // Save progress every 500 items
    if (allItems.length % 500 < newCount) {
      fs.writeFileSync(OUT_FILE, JSON.stringify(allItems, null, 2));
    }

    console.log(`[WatchDrop] Click ${clicks}: ${items.length} visible, ${newCount} new (total: ${allItems.length})`);

    // Find and click Load More button
    const loadMore = await page.$('button:has-text("Load more"), button:has-text("load more"), button:has-text("Show more"), [class*="load-more"], [class*="loadMore"]');
    if (!loadMore) {
      console.log('[WatchDrop] No Load More button found, done.');
      break;
    }
    await loadMore.click();
    await page.waitForTimeout(2000);
    clicks++;
  }

  await browser.close();
  fs.writeFileSync(OUT_FILE, JSON.stringify(allItems, null, 2));
  console.log(`[WatchDrop] Done: ${allItems.length} unique listings`);
}

if (require.main === module) scrape().catch(console.error);
module.exports = { scrape };
