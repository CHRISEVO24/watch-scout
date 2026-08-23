const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DATA_DIR = path.join(__dirname, "..", "data");
const LATEST_FILE = path.join(DATA_DIR, "chrono24-latest.json");
const HISTORY_FILE = path.join(DATA_DIR, "chrono24-history.json");

// Scrape US sellers by brand + price range to maximize coverage
const SCRAPE_TARGETS = [];
const BRANDS = [
  "rolex","patek-philippe","audemars-piguet","omega","richard-mille",
  "cartier","iwc-schaffhausen","breitling","tudor","panerai","hublot",
  "tag-heuer","jaeger-lecoultre","vacheron-constantin","grand-seiko",
  "seiko","zenith","blancpain","girard-perregaux","longines","oris",
  "a-lange-soehne","f-p-journe","h-moser-cie","mb-f","urwerk",
  "de-bethune","greubel-forsey","roger-dubuis","bvlgari","chopard",
  "hamilton","tissot","citizen","casio","bulova",
  "glashutte-original","nomos","sinn","junghans","stowa",
  "bell-ross","bremont","christopher-ward","baume-mercier","frederique-constant",
  "rado","mido","raymond-weil","alpina","doxa",
];
const PRICE_RANGES = [
  [1000, 5000],[5000, 10000],[10000, 20000],[20000, 50000],[50000, 999999]
];

BRANDS.forEach(brand => {
  PRICE_RANGES.forEach(([from, to]) => {
    SCRAPE_TARGETS.push({ brand, from, to });
  });
});

function titleFromUrl(url) {
  const m = url.match(/\/([^/]+)--id\d/);
  if (!m) return null;
  return m[1].replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function extractRef(title) {
  const m = title?.match(/\b(\d{4,6}[A-Z]{0,4}(?:[.\-]\d{3,4}[A-Z]{0,4})?)\b/);
  return m ? m[1] : null;
}

function brandName(slug) {
  const map = {
    "rolex":"Rolex","patek-philippe":"Patek Philippe","audemars-piguet":"Audemars Piguet",
    "omega":"Omega","richard-mille":"Richard Mille","cartier":"Cartier",
    "iwc-schaffhausen":"IWC","breitling":"Breitling","tudor":"Tudor","panerai":"Panerai",
    "hublot":"Hublot","tag-heuer":"TAG Heuer","jaeger-lecoultre":"Jaeger-LeCoultre",
    "vacheron-constantin":"Vacheron Constantin","grand-seiko":"Grand Seiko","seiko":"Seiko",
    "zenith":"Zenith","blancpain":"Blancpain","girard-perregaux":"Girard-Perregaux",
    "longines":"Longines","oris":"Oris",
  };
  return map[slug] || slug;
}

async function scrapeTarget(page, brand, from, to) {
  const url = `https://www.chrono24.com/${brand}/index.htm?country=US&priceFrom=${from}&priceTo=${to}&pageSize=120&sortorder=1`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1500);

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
        results.push({ href: link.href, price: isNaN(price) ? null : price, img });
      });
      return results;
    });
  } catch(e) {
    return [];
  }
}

async function scrape() {
  console.log(`[Chrono24] Scraping ${SCRAPE_TARGETS.length} brand/price combos US only...`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
  });
  const page = await context.newPage();
  const allItems = [];
  const globalSeen = new Set();

  for (const { brand, from, to } of SCRAPE_TARGETS) {
    const items = await scrapeTarget(page, brand, from, to);
    let added = 0;
    items.forEach(item => {
      if (!globalSeen.has(item.href)) {
        globalSeen.add(item.href);
        const title = titleFromUrl(item.href);
        const idMatch = item.href.match(/--id(\d+)/);
        allItems.push({
          id: `c24-${idMatch?.[1]}`,
          source: "Chrono24",
          sourceDetail: "chrono24.com",
          brand: brandName(brand),
          model: null,
          ref: extractRef(title),
          title: title || brandName(brand),
          price: item.price,
          url: item.href,
          imageUrl: item.img,
          condition: "Pre-Owned",
          locationCode: "US",
          postedMinutesAgo: null,
          scrapedAt: new Date().toISOString(),
        });
        added++;
      }
    });
    if (added > 0) console.log(`[Chrono24] ${brandName(brand)} $${from}-$${to}: ${added} new (total: ${allItems.length})`);
    await page.waitForTimeout(800);
  }

  await browser.close();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LATEST_FILE, JSON.stringify(allItems, null, 2));
  let history = fs.existsSync(HISTORY_FILE) ? JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")) : [];
  const existingIds = new Set(history.map(i => i.id));
  allItems.forEach(item => { if (!existingIds.has(item.id)) history.push(item); });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(-50000), null, 2));
  console.log(`[Chrono24] Done. ${allItems.length} US luxury listings.`);
  return allItems;
}

if (require.main === module) scrape().catch(console.error);
module.exports = { scrape };
