const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const DATA_DIR = path.join(__dirname, '..', 'data');
const COOKIES_FILE = path.join(DATA_DIR, 'inventoryconnect-cookies.json');
const OUT_FILE = path.join(DATA_DIR, 'watchdrop-latest.json');

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
  await ctx.addCookies(convertCookies(JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'))));
  const page = await ctx.newPage();

  const allItems = [];
  const seenIds = new Set();

  // Load existing
  if (fs.existsSync(OUT_FILE)) {
    const existing = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
    existing.forEach(i => seenIds.add(i.id));
    allItems.push(...existing);
    console.log(`[WatchDrop] Loaded ${allItems.length} existing items`);
  }

  // Intercept API responses to capture listing data directly
  page.on('response', async res => {
    const url = res.url();
    if (!url.includes('/watchdrop/api/listings') && !url.includes('/_next/data')) return;
    try {
      const body = await res.text();
      if (!body.startsWith('{') && !body.startsWith('[')) return;
      const data = JSON.parse(body);
      const items = data.items || data.pageProps?.listings || [];
      let newCount = 0;
      items.forEach(item => {
        const id = `wd-${item.id}`;
        if (seenIds.has(id)) return;
        seenIds.add(id);
        if (item.listing_type === 'wtb' || item.listing_type === 'ntq') return;
        allItems.push({
          id,
          source: "WatchDrop",
          sourceDetail: "inventoryconnect.io/watchdrop",
          brand: item.brand || null,
          model: item.model || null,
          ref: item.reference_number || null,
          title: [item.brand, item.model, item.reference_number].filter(Boolean).join(" "),
          price: item.price ? parseFloat(item.price) : null,
          url: `https://www.inventoryconnect.io/watchdrop/${item.id}`,
          imageUrl: item.photo_url ? `https://www.inventoryconnect.io${item.photo_url}` : null,
          condition: item.condition || null,
          dialColor: item.dial_color || null,
          seller: item.sender || null,
          postedMinutesAgo: item.posted_at ? Math.round((Date.now() - new Date(item.posted_at).getTime()) / 60000) : null,
          scrapedAt: new Date().toISOString(),
        });
        newCount++;
      });
      if (newCount > 0) {
        console.log(`[WatchDrop] Intercepted ${newCount} new items from ${url.slice(-50)} (total: ${allItems.length})`);
        fs.writeFileSync(OUT_FILE, JSON.stringify(allItems, null, 2));
      }
    } catch(e) {}
  });

  await page.goto('https://www.inventoryconnect.io/watchdrop?f-cur=USD', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  console.log('[WatchDrop] Clicking Load More repeatedly...');

  let clicks = 0;
  while (clicks < 1000) {
    const btn = await page.$('button:has-text("Load more")');
    if (!btn) { console.log('[WatchDrop] No more Load More button'); break; }
    await btn.click();
    await page.waitForTimeout(800 + Math.floor(Math.random() * 400));
    clicks++;
    if (clicks % 50 === 0) console.log(`[WatchDrop] ${clicks} clicks, ${allItems.length} total items`);
  }

  await browser.close();
  fs.writeFileSync(OUT_FILE, JSON.stringify(allItems, null, 2));
  console.log(`[WatchDrop] Done: ${allItems.length} items`);
}

scrape().catch(console.error);
