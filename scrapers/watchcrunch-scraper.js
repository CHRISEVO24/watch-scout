const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "watchcrunch-latest.json");

async function scrape() {
  console.log("[WatchCrunch] Starting scrape...");
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" });
  const page = await ctx.newPage();

  const allItems = [];
  const seenIds = new Set();
  let vToken = null;

  // Intercept page responses to extract listing data
  page.on('response', async res => {
    const url = res.url();
    if (!url.includes('watchcrunch.com/shop')) return;
    if (!vToken && url.includes('v=')) {
      vToken = url.match(/v=([^&]+)/)?.[1];
    }
    try {
      const html = await res.text();
      // Extract listing data from SSR HTML
      const matches = [...html.matchAll(/<a[^>]+href="(\/marketplace\/[^"]+)"[^>]*>/g)];
      matches.forEach(m => {
        if (!seenIds.has(m[1])) seenIds.add(m[1]);
      });
    } catch(e) {}
  });

  await page.goto('https://www.watchcrunch.com/shop', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Scroll many times to get all pages
  let lastCount = 0;
  let noChange = 0;
  let scrolls = 0;

  while (noChange < 5 && scrolls < 200) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
    
    const items = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('[class*="listing"],[class*="card"],[class*="market"]').forEach(card => {
        const link = card.querySelector('a[href*="/marketplace/"],a[href*="/listing/"]');
        if (!link) return;
        const title = card.querySelector('h2,h3,[class*="title"],[class*="name"]')?.textContent?.trim();
        const price = card.querySelector('[class*="price"]')?.textContent?.trim();
        const ref = card.querySelector('[class*="ref"],[class*="reference"]')?.textContent?.trim();
        const img = card.querySelector('img')?.src;
        const location = card.querySelector('[class*="location"],[class*="country"]')?.textContent?.trim();
        if (title || price) results.push({ href: link.href, title, price, ref, img, location });
      });
      return results;
    });

    items.forEach(item => {
      if (seenIds.has(item.href)) return;
      seenIds.add(item.href);
      const priceNum = parseFloat((item.price||'').replace(/[^0-9.]/g,''))||null;
      const refMatch = (item.ref||item.title||'').match(/\b([A-Z]{0,3}[0-9]{4,7}[A-Z0-9]{0,6})\b/i);
      allItems.push({
        id: `wc-${Buffer.from(item.href).toString('base64').slice(0,12)}`,
        source: "WatchCrunch",
        sourceDetail: "watchcrunch.com",
        brand: null, model: null,
        ref: refMatch?.[1] || null,
        title: item.title || null,
        price: priceNum,
        url: item.href.startsWith('http') ? item.href : 'https://www.watchcrunch.com' + item.href,
        imageUrl: item.img || null,
        condition: "Pre-Owned",
        location: item.location || null,
        postedMinutesAgo: null,
        scrapedAt: new Date().toISOString(),
      });
    });

    if (allItems.length === lastCount) noChange++;
    else { noChange = 0; console.log(`[WatchCrunch] Scroll ${scrolls}: ${allItems.length} items`); }
    lastCount = allItems.length;
    scrolls++;
  }

  await browser.close();
  fs.writeFileSync(OUT_FILE, JSON.stringify(allItems, null, 2));
  console.log(`[WatchCrunch] Done: ${allItems.length} items`);
}

scrape().catch(console.error);
