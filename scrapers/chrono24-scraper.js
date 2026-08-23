const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DATA_DIR = path.join(__dirname, "..", "data");
const LATEST_FILE = path.join(DATA_DIR, "chrono24-latest.json");
const HISTORY_FILE = path.join(DATA_DIR, "chrono24-history.json");

const BRANDS = [
  { name: "Patek Philippe", slug: "patekphilippe" },
  { name: "Audemars Piguet", slug: "audemarspiguet" },
  { name: "Vacheron Constantin", slug: "vacheronconstantin" },
  { name: "A. Lange & Söhne", slug: "alangesoehne" },
  { name: "Richard Mille", slug: "richardmille" },
  { name: "F.P. Journe", slug: "fpjourne" },
  { name: "MB&F", slug: "mbf" },
  { name: "H. Moser & Cie", slug: "hmoser" },
  { name: "Jaeger-LeCoultre", slug: "jaegerlecoultre" },
  { name: "IWC", slug: "iwc" },
  { name: "Grand Seiko", slug: "grandseiko" },
  { name: "Girard-Perregaux", slug: "girardperregaux" },
];

const PRICE_BANDS = [
  [500,1000],[1000,2000],[2000,3000],[3000,4000],[4000,5000],
  [5000,6000],[6000,7000],[7000,8000],[8000,9000],[9000,10000],
  [10000,12500],[12500,15000],[15000,17500],[17500,20000],
  [20000,25000],[25000,30000],[30000,40000],[40000,50000],
  [50000,75000],[75000,100000],[100000,150000],[150000,250000],[250000,999999]
];

// Multiple sort orders to get different sets of 120 when a band is full
// 1=price asc, 2=price desc, 3=newest, 5=popularity, 6=oldest
const SORT_ORDERS = [1, 2, 3, 5];

function extractRefFromTitle(title) {
  if (!title) return null;
  const m = title.match(/\b([0-9]{3,6}[A-Z]{0,4}(?:[/.-][0-9A-Z]{2,6}){0,3})\b/i);
  return m ? m[1].toUpperCase() : null;
}

function titleFromUrl(url) {
  const m = url.match(/\/([^/]+)--id\d/);
  if (!m) return null;
  return m[1].replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

async function scrapeTarget(page, slug, from, to, sortorder) {
  const url = `https://www.chrono24.com/${slug}/index.htm?country=US&priceFrom=${from}&priceTo=${to}&pageSize=120&sortorder=${sortorder}`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1000);
    return await page.evaluate(() => {
      const seen = new Set();
      const results = [];
      document.querySelectorAll('.wt-listing-item, .js-listing-item').forEach(card => {
        const link = card.querySelector('a[href*="--id"]');
        if (!link || seen.has(link.href)) return;
        seen.add(link.href);
        const priceText = card.querySelector('[class*="price"]')?.textContent?.trim() || "";
        const price = parseFloat(priceText.replace(/[^0-9.]/g, ""));
        const img = [...card.querySelectorAll('img')].find(i =>
          i.src && i.src.includes('chrono24') && !i.src.includes('svg')
        )?.src || null;
        const idMatch = link.href.match(/--id(\d+)/);
        results.push({ href: link.href, price: isNaN(price) ? null : price, img, id: idMatch?.[1] });
      });
      return results;
    });
  } catch(e) { return []; }
}

async function scrape() {
  const totalCombos = BRANDS.length * PRICE_BANDS.length * SORT_ORDERS.length;
  console.log(`[Chrono24] ${totalCombos} combos: ${BRANDS.length} brands × ${PRICE_BANDS.length} bands × ${SORT_ORDERS.length} sort orders`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
  });
  const page = await context.newPage();
  const allItems = [];
  const globalSeen = new Set();

  // Load existing data and merge
  let existing = [];
  if (fs.existsSync(LATEST_FILE)) {
    existing = JSON.parse(fs.readFileSync(LATEST_FILE, "utf8"));
    existing.forEach(item => globalSeen.add(item.url));
    console.log(`[Chrono24] Loaded ${existing.length} existing items, running missing brands only...`);
  }


  for (const brand of BRANDS) {
    let brandNew = 0;
    for (const [from, to] of PRICE_BANDS) {
      for (const sortorder of SORT_ORDERS) {
        const items = await scrapeTarget(page, brand.slug, from, to, sortorder);
        let newThisRun = 0;
        items.forEach(item => {
          if (!globalSeen.has(item.href)) {
            globalSeen.add(item.href);
            const title = titleFromUrl(item.href);
            allItems.push({
              id: `c24-${item.id}`,
              source: "Chrono24",
              sourceDetail: "chrono24.com",
              brand: brand.name,
              model: null,
              ref: extractRefFromTitle(title),
              title: title || brand.name,
              price: item.price,
              url: item.href,
              imageUrl: item.img,
              condition: "Pre-Owned",
              locationCode: "US",
              postedMinutesAgo: null,
              scrapedAt: new Date().toISOString(),
            });
            brandNew++;
            newThisRun++;
          }
        });
        // Skip remaining sort orders if this band returned < 60 items (no more data)
        if (items.length < 60) break;
        await page.waitForTimeout(500);
      }
      await page.waitForTimeout(400);
    }
    console.log(`[Chrono24] ${brand.name}: ${brandNew} new (total: ${allItems.length})`);
  }

  await browser.close();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const merged = [...existing, ...allItems];
  fs.writeFileSync(LATEST_FILE, JSON.stringify(merged, null, 2));
  let history = fs.existsSync(HISTORY_FILE) ? JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")) : [];
  const existingIds = new Set(history.map(i => i.id));
  allItems.forEach(item => { if (!existingIds.has(item.id)) history.push(item); });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(-100000), null, 2));
  console.log(`[Chrono24] Done. ${allItems.length} US luxury listings.`);
  return allItems;
}

if (require.main === module) scrape().catch(console.error);
module.exports = { scrape };
