const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DATA_DIR = path.join(__dirname, "..", "data");
const COOKIES_FILE = path.join(DATA_DIR, "inventoryconnect-cookies.json");
const OUT_FILE = path.join(DATA_DIR, "watchdrop-latest.json");
const MAX_DAYS = 30;

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
  await page.waitForTimeout(2000);
  if (page.url().includes("login")) { console.error("Session expired."); await browser.close(); return; }
  console.log(`[WatchDrop] Session valid. Getting last ${MAX_DAYS} days USD listings...`);

  const allItems = [];
  const seenIds = new Set();
  let cursor = null;
  let pg = 1;
  const cutoff = Date.now() - MAX_DAYS * 24 * 60 * 60 * 1000;

  while (true) {
    const apiUrl = `/watchdrop/api/listings?limit=100&currency=USD` + (cursor ? `&cursor=${cursor}` : '');

    try {
      const result = await page.evaluate(async (url) => {
        const r = await fetch(url);
        const text = await r.text();
        if (text.startsWith('<')) return null;
        return JSON.parse(text);
      }, apiUrl);

      if (!result || !result.items || !result.items.length) { console.log(`[WatchDrop] No more items.`); break; }

      // Check for cursor loop - if all items already seen, stop
      const newItems = result.items.filter(i => !seenIds.has(i.id));
      if (newItems.length === 0) { console.log(`[WatchDrop] Cursor loop detected, stopping.`); break; }

      let stopPaging = false;
      for (const item of result.items) {
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);
        if (item.listing_type === 'wtb' || item.listing_type === 'ntq') continue;
        if (item.posted_at && new Date(item.posted_at).getTime() < cutoff) { stopPaging = true; break; }
        allItems.push({
          id: `wd-${item.id}`,
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
          year: item.year || null,
          seller: item.sender || null,
          groupName: item.group_name || null,
          postedMinutesAgo: item.posted_at ? Math.round((Date.now() - new Date(item.posted_at).getTime()) / 60000) : null,
          scrapedAt: new Date().toISOString(),
        });
      }

      console.log(`[WatchDrop] Page ${pg}: ${newItems.length} new items (total unique: ${allItems.length})`);
      if (allItems.length % 1000 < 100) fs.writeFileSync(OUT_FILE, JSON.stringify(allItems, null, 2));
      if (stopPaging || !result.nextCursor) break;
      cursor = result.nextCursor;
      pg++;
      await page.waitForTimeout(300);

    } catch(e) {
      console.log('[WatchDrop] Refreshing session...');
      await page.goto("https://www.inventoryconnect.io/watchdrop?f-cur=USD", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000);
      if (page.url().includes("login")) { console.log("Session expired, saving."); break; }
    }
  }

  await browser.close();
  fs.writeFileSync(OUT_FILE, JSON.stringify(allItems, null, 2));
  console.log(`[WatchDrop] Done: ${allItems.length} unique listings`);
}

if (require.main === module) scrape().catch(console.error);
module.exports = { scrape };
