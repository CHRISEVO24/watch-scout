const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DATA_DIR = path.join(__dirname, "..", "data");
const LATEST_FILE = path.join(DATA_DIR, "chrono24-latest.json");
const HISTORY_FILE = path.join(DATA_DIR, "chrono24-history.json");

const BRANDS = [
  { name: "Rolex", slug: "rolex" },
  { name: "Patek Philippe", slug: "patekphilippe" },
  { name: "Audemars Piguet", slug: "audemarspiguet" },
  { name: "Vacheron Constantin", slug: "vacheronconstantin" },
  { name: "A. Lange & Söhne", slug: "alangesoehne" },
  { name: "Breguet", slug: "breguet" },
  { name: "Richard Mille", slug: "richardmille" },
  { name: "F.P. Journe", slug: "fpjourne" },
  { name: "MB&F", slug: "mbf" },
  { name: "H. Moser & Cie", slug: "hmosercie" },
  { name: "Omega", slug: "omega" },
  { name: "Cartier", slug: "cartier" },
  { name: "Jaeger-LeCoultre", slug: "jaegerlecoultre" },
  { name: "IWC", slug: "iwc" },
  { name: "Panerai", slug: "panerai" },
  { name: "Grand Seiko", slug: "grandseiko" },
  { name: "Blancpain", slug: "blancpain" },
  { name: "Girard-Perregaux", slug: "girardperregaux" },
  { name: "Hublot", slug: "hublot" },
  { name: "Zenith", slug: "zenith" },
  { name: "Breitling", slug: "breitling" },
  { name: "Tudor", slug: "tudor" },
  { name: "TAG Heuer", slug: "tagheuer" },
  { name: "Chopard", slug: "chopard" },
  { name: "Bulgari", slug: "bulgari" },
  { name: "Piaget", slug: "piaget" },
  { name: "Franck Muller", slug: "franckmuller" },
  { name: "Roger Dubuis", slug: "rogerdubuis" },
  { name: "Ulysse Nardin", slug: "ulyssenardin" },
  { name: "Glashutte Original", slug: "glashuetteoriginal" },
  { name: "Nomos", slug: "nomos" },
  { name: "Frederique Constant", slug: "frederiqueconstant" },
  { name: "Montblanc", slug: "montblanc" },
  { name: "Parmigiani", slug: "parmigianifleurier" },
  { name: "Laurent Ferrier", slug: "laurentferrier" },
];

const PRICE_BANDS = [
  [500,1000],
  [1000,1500],[1500,2000],[2000,2500],[2500,3000],
  [3000,3500],[3500,4000],[4000,4500],[4500,5000],
  [5000,5500],[5500,6000],[6000,6500],[6500,7000],
  [7000,7500],[7500,8000],[8000,8500],[8500,9000],
  [9000,9500],[9500,10000],[10000,11000],[11000,12000],
  [12000,13000],[13000,14000],[14000,15000],[15000,17500],
  [17500,20000],[20000,25000],[25000,30000],[30000,40000],
  [40000,50000],[50000,75000],[75000,100000],
  [100000,150000],[150000,250000],[250000,999999]
];

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
        const cardText = card.textContent || '';
        const nonUS = /(Hong Kong|Japan|Germany|China|Switzerland|Netherlands|France|Italy|Spain|Austria|Belgium|Australia|Singapore|Korea|Taiwan)/i.test(cardText);
        if (nonUS) return;
        results.push({ href: link.href, price: isNaN(price) ? null : price, img, id: idMatch?.[1] });
      });
      return results;
    });
  } catch(e) { return []; }
}

async function scrape() {
  const queryArg = process.argv.find(a => a.startsWith('--query='))?.replace('--query=','')?.toLowerCase();

  const totalCombos = BRANDS.length * PRICE_BANDS.length * SORT_ORDERS.length;
  console.log(`[Chrono24] ${totalCombos} combos: ${BRANDS.length} brands x ${PRICE_BANDS.length} bands x ${SORT_ORDERS.length} sort orders`);

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await context.newPage();

  let existing = [];
  if (fs.existsSync(LATEST_FILE)) {
    existing = JSON.parse(fs.readFileSync(LATEST_FILE, "utf8"));
    console.log(`[Chrono24] Loaded ${existing.length} existing items`);
  }

  for (const brand of BRANDS) {
    const brandMatches = !queryArg || brand.name.toLowerCase().includes(queryArg) || brand.slug.toLowerCase().includes(queryArg);
    if (!brandMatches) continue;

    const brandSeen = new Set();
    const freshItems = [];

    for (const [from, to] of PRICE_BANDS) {
      for (const sortorder of SORT_ORDERS) {
        const items = await scrapeTarget(page, brand.slug, from, to, sortorder);
        items.forEach(item => {
          if (!brandSeen.has(item.href)) {
            brandSeen.add(item.href);
            const title = titleFromUrl(item.href);
            freshItems.push({
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
          }
        });
        if (items.length < 60) break;
        await page.waitForTimeout(500);
      }
      await page.waitForTimeout(400);
    }

    if (freshItems.length > 0) {
      const beforeCount = existing.filter(i => i.brand === brand.name).length;
      existing = existing.filter(i => i.brand !== brand.name);
      existing.push(...freshItems);
      console.log(`[Chrono24] ${brand.name}: replaced ${beforeCount} old -> ${freshItems.length} fresh (total: ${existing.length})`);
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(LATEST_FILE, JSON.stringify(existing, null, 2));
    } else {
      console.log(`[Chrono24] ${brand.name}: 0 results - keeping existing ${existing.filter(i => i.brand === brand.name).length} listings`);
    }
  }

  await browser.close();

  let history = fs.existsSync(HISTORY_FILE) ? JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")) : [];
  const existingIds = new Set(history.map(i => i.id));
  let historyAdded = 0;
  existing.forEach(item => {
    if (!existingIds.has(item.id)) {
      history.push(item);
      historyAdded++;
    }
  });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(-100000), null, 2));
  console.log(`[Chrono24] Done. ${existing.length} total listings. +${historyAdded} added to history.`);
  return existing;
}

if (require.main === module) scrape().catch(console.error);
module.exports = { scrape };
