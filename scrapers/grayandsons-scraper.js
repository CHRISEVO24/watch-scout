const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "grayandsons-latest.json");

const BRAND_URLS = [
  "https://www.grayandsons.com/fine-watches/rolex/",
  "https://www.grayandsons.com/fine-watches/cartier/",
  "https://www.grayandsons.com/fine-watches/patek-philippe/",
  "https://www.grayandsons.com/fine-watches/audemars-piguet/",
  "https://www.grayandsons.com/fine-watches/other-watches-brands/omega/",
  "https://www.grayandsons.com/fine-watches/other-watches-brands/breitling/",
  "https://www.grayandsons.com/fine-watches/other-watches-brands/jaeger-lecoultre/",
  "https://www.grayandsons.com/fine-watches/other-watches-brands/hublot/",
  "https://www.grayandsons.com/fine-watches/other-watches-brands/ulysse-nardin/",
  "https://www.grayandsons.com/fine-watches/other-watches-brands/richard-mille/",
  "https://www.grayandsons.com/fine-watches/other-watches-brands/breguet/",
  "https://www.grayandsons.com/fine-watches/other-watches-brands/girard-perregaux/",
  "https://www.grayandsons.com/fine-watches/other-watches-brands/corum-watches-for-sale/",
  "https://www.grayandsons.com/fine-watches/other-watches-brands/iwc/",
  "https://www.grayandsons.com/fine-watches/other-watches-brands/panerai/",
  "https://www.grayandsons.com/fine-watches/other-watches-brands/vacheron-constantin/",
  "https://www.grayandsons.com/fine-watches/other-watches-brands/a-lange-sohne/",
  "https://www.grayandsons.com/fine-watches/other-watches-brands/bvlgari/",
  "https://www.grayandsons.com/fine-watches/other-watches-brands/chopard/",
  "https://www.grayandsons.com/fine-watches/other-watches-brands/frank-muller/",
  "https://www.grayandsons.com/fine-watches/other-watches-brands/piaget/",
  "https://www.grayandsons.com/fine-watches/other-watches-brands/van-cleef-arpels/",
  "https://www.grayandsons.com/fine-watches/other-watches-brands/",
  "https://www.grayandsons.com/fine-watches/pocket-watches-for-sale/",
];

async function extractItems(page) {
  return await page.evaluate(() => {
    const items = [];
    const seen = new Set();
    [...document.querySelectorAll('a')].filter(a => a.href.match(/grayandsons\.com\/w\d+/)).forEach(link => {
      if (seen.has(link.href)) return;
      seen.add(link.href);
      const card = link.closest('div,li,article') || link.parentElement;
      const text = card?.innerText || '';
      const lines = text.split('\n').map(l=>l.trim()).filter(l=>l && !['SHOP','GET QUOTE','SELL','NEW ARRIVAL','SOLD'].includes(l));
      const priceMatch = text.match(/\$([\d,]+)/);
      const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g,'')) : null;
      const img = card?.querySelector('img[src*="cdn.grayandsons.com"]')?.src || null;
      items.push({ href: link.href, title: lines.slice(0,4).join(' ').slice(0,100), price, img });
    });
    return items;
  });
}

async function scrape() {
  console.log("[Gray & Sons] Starting brand-by-brand scrape...");
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" });
  const page = await ctx.newPage();

  // Load existing items to avoid re-scraping
  let allItems = [];
  const seen = new Set();
  if (fs.existsSync(OUT_FILE)) {
    allItems = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
    allItems.forEach(i => seen.add(i.url));
    console.log(`[Gray & Sons] Loaded ${allItems.length} existing items`);
  }

  for (const brandUrl of BRAND_URLS) {
    let pg = 1;
    const brandName = brandUrl.split('/').filter(Boolean).pop();
    console.log(`[Gray & Sons] Scraping: ${brandName}`);

    let maxPages = 100; // cap per brand to avoid rate limiting
    while (pg <= maxPages) {
      const url = pg === 1 ? brandUrl : brandUrl.replace(/\/$/, '') + `/page-${pg}/`;
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(3000);
        const items = await extractItems(page);
        if (!items.length) break;

        items.forEach(item => {
          if (seen.has(item.href)) return;
          seen.add(item.href);
          const idMatch = item.href.match(/\/(w\d+)/);
          allItems.push({
            id: `gs-${idMatch?.[1] || Math.random().toString(36).slice(2)}`,
            source: "Gray & Sons",
            sourceDetail: "grayandsons.com",
            brand: null, model: null, ref: null,
            title: item.title, price: item.price,
            url: item.href, imageUrl: item.img || null,
            condition: "Pre-Owned", postedMinutesAgo: null,
            scrapedAt: new Date().toISOString(),
          });
        });

        console.log(`[Gray & Sons] ${brandName} page ${pg}: ${items.length} items (total: ${allItems.length})`);
        pg++;
        await page.waitForTimeout(1000);
      } catch(e) {
        console.error(`[Gray & Sons] Error:`, e.message);
        break;
      }
    }
  }

  await browser.close();
  fs.writeFileSync(OUT_FILE, JSON.stringify(allItems, null, 2));
  console.log(`[Gray & Sons] Done. ${allItems.length} items written.`);
}

if (require.main === module) scrape().catch(console.error);
module.exports = { scrape };
