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
  // timecapsulecollection scraped via API below
];

function convertCookies(raw) {
  return raw.map(c => ({
    name: c.name, value: c.value, domain: c.domain, path: c.path,
    expires: c.session ? -1 : Math.floor(c.expirationDate),
    httpOnly: c.httpOnly, secure: c.secure,
    sameSite: c.sameSite === 'unspecified' ? 'Lax' : (c.sameSite?.charAt(0).toUpperCase() + c.sameSite?.slice(1)) || 'Lax'
  }));
}

async function scrapeGroup(cookies, group, allItems, seenIds, noEarlyStop=false) {
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
  let lastNewInGroup = 0;
  let noNewRounds = 0;
  while (clicks < 500 && !hitCutoff) {
    const btn = await page.$('button:has-text("Load more")');
    if (!btn) break;
    await btn.click();
    await page.waitForTimeout(800 + Math.floor(Math.random() * 400));
    clicks++;
    if (clicks % 20 === 0) {
      console.log(`[WatchDrop][${group.slice(0,20)}] Click ${clicks}, ${newInGroup} new items`);
      fs.writeFileSync(OUT_FILE, JSON.stringify(allItems, null, 2));
      if (newInGroup === lastNewInGroup) {
        noNewRounds++;
        if (!noEarlyStop && noNewRounds >= 3) { console.log(`[WatchDrop][${group.slice(0,20)}] No new items for 60 clicks, stopping`); break; }
      } else { noNewRounds = 0; }
      lastNewInGroup = newInGroup;
    }
  }

  await browser.close();
  console.log(`[WatchDrop][${group.slice(0,20)}] Done: ${newInGroup} new items (${clicks} clicks)`);
  return newInGroup;
}

async function scrapeGroupViaApi(page, group, allItems, seenIds, cutoff) {
  const encoded = encodeURIComponent(group);
  let cursor = null;
  let pg = 1;
  let newCount = 0;
  while(true) {
    const url = `/watchdrop/api/listings?limit=100&currency=USD&group=${encoded}` + (cursor ? `&cursor=${cursor}` : '');
    const result = await page.evaluate(async (apiUrl) => {
      const r = await fetch(apiUrl);
      const text = await r.text();
      if(text.startsWith('<')) return null;
      return JSON.parse(text);
    }, url);
    if(!result || !result.items?.length) break;
    let stop = false;
    result.items.forEach(item => {
      const id = `wd-${item.id}`;
      if(seenIds.has(id)) return;
      if(item.listing_type === 'wtb' || item.listing_type === 'ntq') return;
      if(item.posted_at && new Date(item.posted_at).getTime() < cutoff) { stop = true; return; }
      seenIds.add(id);
      allItems.push({
        id, source: "WatchDrop", sourceDetail: "inventoryconnect.io/watchdrop",
        brand: item.brand||null, model: item.model||null, ref: item.reference_number||null,
        title: [item.brand, item.model, item.reference_number].filter(Boolean).join(" "),
        price: item.price ? parseFloat(item.price) : null,
        url: `https://www.inventoryconnect.io/watchdrop/${item.id}`,
        imageUrl: item.photo_url ? `https://www.inventoryconnect.io${item.photo_url}` : null,
        condition: item.condition||null, dialColor: item.dial_color||null,
        seller: item.sender||null, groupName: item.group_name||null,
        postedMinutesAgo: item.posted_at ? Math.round((Date.now()-new Date(item.posted_at).getTime())/60000) : null,
        scrapedAt: new Date().toISOString(),
      });
      newCount++;
    });
    console.log(`[WatchDrop][${group.slice(0,20)}] API page ${pg}: ${newCount} new items`);
    if(stop || !result.nextCursor || result.nextCursor === cursor) break;
    cursor = result.nextCursor;
    pg++;
    await page.waitForTimeout(300);
  }
  return newCount;
}

async function scrape() {
  const cookies = convertCookies(JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8')));
  const cutoff = Date.now() - MAX_DAYS * 24 * 60 * 60 * 1000;
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

  // Scrape timecapsule via Load More with no early stop
  console.log('\n[WatchDrop] Scraping timecapsule via Load More (no early stop)...');
  await scrapeGroup(cookies, 'timecapsulecollection ⏱⚙️', allItems, seenIds, true);
  fs.writeFileSync(OUT_FILE, JSON.stringify(allItems, null, 2));
  console.log(`[WatchDrop] After timecapsule: ${allItems.length} items`);

  // Also try API for timecapsule
  console.log('\n[WatchDrop] Scraping timecapsule via API...');
  const tcBrowser = await chromium.launch({ headless: true });
  const tcCtx = await tcBrowser.newContext({ userAgent: "Mozilla/5.0" });
  try { await tcCtx.addCookies(convertCookies(JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8')))); } catch(e) { console.log('[WatchDrop] Cookie warning:', e.message); }
  const tcPage = await tcCtx.newPage();
  await tcPage.goto('https://www.inventoryconnect.io/watchdrop', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await tcPage.waitForTimeout(2000);
  await scrapeGroupViaApi(tcPage, 'timecapsulecollection ⏱⚙️', allItems, seenIds, cutoff);
  await tcBrowser.close();
  fs.writeFileSync(OUT_FILE, JSON.stringify(allItems, null, 2));

  console.log(`\n[WatchDrop] All groups done. Total: ${allItems.length} unique items`);
}

scrape().catch(console.error);
