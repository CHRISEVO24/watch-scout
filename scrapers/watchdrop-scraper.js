const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DATA_DIR = path.join(__dirname, "..", "data");
const COOKIES_FILE = path.join(DATA_DIR, "inventoryconnect-cookies.json");
const OUT_FILE = path.join(DATA_DIR, "watchdrop-latest.json");
const MAX_DAYS = 30;

const GROUPS = [
  "BUY/SELL/TRADE",
  "US 🇺🇸 Verified Dealers Only",
  "timecapsulecollection ⏱⚙️"
];

function convertCookies(raw) {
  return raw.map(c => ({
    name: c.name, value: c.value, domain: c.domain, path: c.path,
    expires: c.session ? -1 : Math.floor(c.expirationDate),
    httpOnly: c.httpOnly, secure: c.secure,
    sameSite: c.sameSite === 'unspecified' ? 'Lax' : (c.sameSite?.charAt(0).toUpperCase() + c.sameSite?.slice(1)) || 'Lax'
  }));
}

async function scrapeGroup(cookies, group, allItems, seenIds) {
  const cutoff = Date.now() - MAX_DAYS * 24 * 60 * 60 * 1000;
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  let newInGroup = 0;
  let hitCutoff = false;

  page.on('response', async res => {
    if (!res.url().includes('/watchdrop/api/listings')) return;
    try {
      const body = await res.text();
      if (!body.startsWith('{')) return;
      const data = JSON.parse(body);
      (data.items || []).forEach(item => {
        const id = `wd-${item.id}`;
        if (seenIds.has(id)) return;
        if (item.listing_type === 'wtb' || item.listing_type === 'ntq') return;
        if (item.posted_at && new Date(item.posted_at).getTime() < cutoff) { hitCutoff = true; return; }
        seenIds.add(id);
        allItems.push({
          id, source: "WatchDrop", sourceDetail: "inventoryconnect.io/watchdrop",
          brand: item.brand || null, model: item.model || null,
          ref: item.reference_number || null,
          title: [item.brand, item.model, item.reference_number].filter(Boolean).join(" "),
          price: item.price ? parseFloat(item.price) : null,
          url: `https://www.inventoryconnect.io/watchdrop/${item.id}`,
          imageUrl: item.photo_url ? `https://www.inventoryconnect.io${item.photo_url}` : null,
          condition: item.condition || null, dialColor: item.dial_color || null,
          seller: item.sender || null, groupName: item.group_name || null,
          postedMinutesAgo: item.posted_at ? Math.round((Date.now() - new Date(item.posted_at).getTime()) / 60000) : null,
          scrapedAt: new Date().toISOString(),
        });
        newInGroup++;
      });
    } catch(e) {}
  });

  const url = `https://www.inventoryconnect.io/watchdrop?f-cur=USD&f-group=${encodeURIComponent(group)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  let clicks = 0;
  while (clicks < 500 && !hitCutoff) {
    const btn = await page.$('button:has-text("Load more")');
    if (!btn) break;
    await btn.click();
    await page.waitForTimeout(800 + Math.floor(Math.random() * 400));
    clicks++;
    if (clicks % 20 === 0) {
      console.log(`[WatchDrop][${group.slice(0,20)}] Click ${clicks}, ${newInGroup} new items`);
      fs.writeFileSync(OUT_FILE, JSON.stringify(allItems, null, 2));
    }
  }

  await browser.close();
  console.log(`[WatchDrop][${group.slice(0,20)}] Done: ${newInGroup} new items (${clicks} clicks)`);
  return newInGroup;
}

async function scrape() {
  const cookies = convertCookies(JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8')));
  const allItems = [];
  const seenIds = new Set();

  if (fs.existsSync(OUT_FILE)) {
    const existing = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
    existing.forEach(i => { seenIds.add(i.id); allItems.push(i); });
    console.log(`[WatchDrop] Loaded ${allItems.length} existing items`);
  }

  for (const group of GROUPS) {
    console.log(`\n[WatchDrop] Scraping group: ${group}`);
    await scrapeGroup(cookies, group, allItems, seenIds);
    fs.writeFileSync(OUT_FILE, JSON.stringify(allItems, null, 2));
    console.log(`[WatchDrop] Total so far: ${allItems.length}`);
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log(`\n[WatchDrop] All groups done. Total: ${allItems.length} unique items`);
}

scrape().catch(console.error);
