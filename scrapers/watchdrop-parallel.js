const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DATA_DIR = path.join(__dirname, "..", "data");
const COOKIES_FILE = path.join(DATA_DIR, "inventoryconnect-cookies.json");

function convertCookies(raw) {
  return raw.map(c => ({
    name: c.name, value: c.value, domain: c.domain, path: c.path,
    expires: c.session ? -1 : Math.floor(c.expirationDate),
    httpOnly: c.httpOnly, secure: c.secure,
    sameSite: c.sameSite === 'unspecified' ? 'Lax' : (c.sameSite?.charAt(0).toUpperCase() + c.sameSite?.slice(1)) || 'Lax'
  }));
}

// Each worker scrapes a specific brand
const BRANDS = [
  'Rolex', 'Patek Philippe', 'Audemars Piguet', 'Omega', 'Cartier',
  'IWC', 'Panerai', 'Breitling', 'Tudor', 'Grand Seiko',
  'Jaeger-LeCoultre', 'Vacheron Constantin', 'A. Lange & Söhne',
  'Richard Mille', 'Hublot', 'Zenith', 'Blancpain', 'Breguet',
  'TAG Heuer', 'Longines', 'Seiko', 'Girard-Perregaux'
];

async function scrapeWorker(workerId, brand, cookies) {
  const outFile = path.join(DATA_DIR, `watchdrop-brand-${brand.replace(/[^a-z0-9]/gi,'_').toLowerCase()}.json`);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  
  const url = `https://www.inventoryconnect.io/watchdrop?f-cur=USD&f-brand=${encodeURIComponent(brand)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  const allItems = [];
  const seenIds = new Set();
  let clicks = 0;

  while (clicks < 200) {
    const items = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('a[href*="/watchdrop/"]').forEach(a => {
        const id = a.href.split('/watchdrop/')[1]?.split('?')[0];
        if (!id || id.length < 3) return;
        const card = a.closest('div,li,article') || a.parentElement;
        const title = card?.querySelector('h2,h3,[class*="title"]')?.textContent?.trim();
        const price = card?.querySelector('[class*="price"]')?.textContent?.trim();
        const img = card?.querySelector('img')?.src;
        results.push({ id, href: a.href, title, price, img });
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
        brand: brand,
        model: null, ref: null,
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

    if (clicks % 10 === 0) {
      fs.writeFileSync(outFile, JSON.stringify(allItems, null, 2));
      console.log(`[Worker ${workerId}][${brand}] Click ${clicks}: ${newCount} new (total: ${allItems.length})`);
    }

    const loadMore = await page.$('button:has-text("Load more"), button:has-text("load more"), button:has-text("Show more")');
    if (!loadMore) { console.log(`[Worker ${workerId}][${brand}] Done: ${allItems.length} items`); break; }
    await loadMore.click();
    await page.waitForTimeout(1000 + Math.floor(Math.random() * 1000));
    clicks++;
  }

  fs.writeFileSync(outFile, JSON.stringify(allItems, null, 2));
  await browser.close();
  return allItems.length;
}

async function run() {
  const rawCookies = JSON.parse(fs.readFileSync(COOKIES_FILE, "utf8"));
  const cookies = convertCookies(rawCookies);

  // Run 4 workers in parallel
  const WORKERS = 4;
  const results = [];
  
  for (let i = 0; i < BRANDS.length; i += WORKERS) {
    const batch = BRANDS.slice(i, i + WORKERS);
    console.log(`\nScraping batch: ${batch.join(', ')}`);
    const counts = await Promise.all(batch.map((brand, idx) => scrapeWorker(i + idx, brand, cookies)));
    counts.forEach((count, idx) => console.log(`  ${batch[idx]}: ${count} items`));
    results.push(...counts);
    await new Promise(r => setTimeout(r, 2000));
  }

  // Merge all brand files
  console.log('\nMerging all brand files...');
  const allItems = [];
  const seenIds = new Set();
  
  BRANDS.forEach(brand => {
    const file = path.join(DATA_DIR, `watchdrop-brand-${brand.replace(/[^a-z0-9]/gi,'_').toLowerCase()}.json`);
    if (!fs.existsSync(file)) return;
    const items = JSON.parse(fs.readFileSync(file, 'utf8'));
    items.forEach(item => {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        allItems.push(item);
      }
    });
  });

  fs.writeFileSync(path.join(DATA_DIR, 'watchdrop-latest.json'), JSON.stringify(allItems, null, 2));
  console.log(`[WatchDrop] Total unique: ${allItems.length}`);
}

run().catch(console.error);
