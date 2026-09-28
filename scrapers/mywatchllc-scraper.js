/**
 * MyWatch LLC scraper
 * Uses Playwright to bypass Cloudflare/bot protection on mywatchllc.com
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const LATEST_FILE = path.join(DATA_DIR, "mywatchllc-latest.json");
const HISTORY_FILE = path.join(DATA_DIR, "mywatchllc-history.json");
const SOURCE = "My Watch LLC";
const LIMIT = 250;

const BRAND_KEYWORDS = [
  "rolex","patek philippe","audemars piguet","richard mille","omega",
  "cartier","iwc","panerai","jaeger-lecoultre","vacheron constantin",
  "a. lange","breguet","fp journe","f.p. journe","mb&f","h. moser",
  "grand seiko","blancpain","girard-perregaux","hublot","zenith",
  "breitling","tudor","tag heuer","chopard","bulgari","piaget",
  "franck muller","roger dubuis","ulysse nardin","glashutte","nomos",
  "frederique constant","montblanc","parmigiani","laurent ferrier",
  "seiko","longines","hamilton","oris","tissot",
];

function extractBrand(title, vendor) {
  if (vendor && !["mywatchllc","my watch llc"].includes(vendor.toLowerCase())) return vendor;
  const lower = (title||"").toLowerCase();
  const hit = BRAND_KEYWORDS.find(b => lower.includes(b));
  return hit ? hit.replace(/\b\w/g, c => c.toUpperCase()) : null;
}

function extractRef(title, sku) {
  if (sku && sku.trim()) return sku.trim();
  const m = (title||"").match(/\b([0-9]{4,6}[A-Z]{0,4}(?:[\/\.-][0-9A-Z]{2,6}){0,3})\b/i);
  return m ? m[1] : null;
}

function extractDialColor(title) {
  const lower = (title||"").toLowerCase();
  const colors = ["black","blue","white","silver","green","grey","gray","champagne",
    "brown","gold","pink","red","yellow","orange","cream","ivory","copper","salmon",
    "slate","olive","teal","purple","burgundy","meteorite","chocolate","lacquer",
    "sunburst","rhodium","anthracite"];
  for (const c of colors) {
    if (lower.includes(c+" dial")||lower.includes(c+"-dial"))
      return c.charAt(0).toUpperCase()+c.slice(1);
  }
  for (const c of colors) if (lower.includes(c)) return c.charAt(0).toUpperCase()+c.slice(1);
  return null;
}

async function run() {
  console.log("[MyWatchLLC] Launching browser...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const all = [];
  let pageNum = 1;

  try {
    while (true) {
      const url = `https://mywatchllc.com/collections/catalog/products.json?limit=${LIMIT}&page=${pageNum}`;
      console.log(`[MyWatchLLC] Fetching page ${pageNum}...`);

      const response = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      const body = await response.text();
      const data = JSON.parse(body);
      const products = data.products || [];

      if (!products.length) {
        console.log(`[MyWatchLLC] No more products at page ${pageNum}`);
        break;
      }

      for (const p of products) {
        const variant = p.variants && p.variants[0];
        const price = variant ? Math.round(parseFloat(variant.price)) : null;
        const sku = variant ? variant.sku : null;
        const image = p.images && p.images[0] ? p.images[0].src : null;
        all.push({
          id: `mywatchllc-${p.id}`,
          source: SOURCE,
          sourceDetail: "mywatchllc.com",
          imageUrl: image,
          brand: extractBrand(p.title, p.vendor),
          model: null,
          ref: extractRef(p.title, sku),
          title: p.title,
          dialColor: extractDialColor(p.title),
          caseMaterial: null,
          year: null,
          price,
          seller: null,
          condition: "Pre-Owned",
          postedMinutesAgo: null,
          isNew: (p.title||"").toLowerCase().startsWith("new ") ? true : false,
          inStock: variant ? variant.available : null,
          url: `https://mywatchllc.com/products/${p.handle}`,
          scrapedAt: new Date().toISOString(),
        });
      }

      console.log(`[MyWatchLLC] Page ${pageNum}: ${products.length} products, total: ${all.length}`);
      if (products.length < LIMIT) break;
      pageNum++;
      await page.waitForTimeout(500);
    }
  } finally {
    await browser.close();
  }

  console.log(`[MyWatchLLC] Scraped ${all.length} total listings`);
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Update history
  const existing = fs.existsSync(HISTORY_FILE)
    ? JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"))
    : [];
  const seen = new Set(existing.map(i => i.url));
  const newItems = all.filter(i => i.url && !seen.has(i.url));
  const history = [...existing, ...newItems];
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));

  // Write latest
  fs.writeFileSync(LATEST_FILE, JSON.stringify(all, null, 2));
  console.log(`[MyWatchLLC] Done. ${all.length} listings saved. +${newItems.length} new to history.`);
}

run().catch(err => {
  console.error("[MyWatchLLC] Fatal:", err.message);
  process.exit(1);
});
