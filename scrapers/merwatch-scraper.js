/**
 * Meridian Timepieces (merwatch.com) scraper
 * Uses WooCommerce Store API - no auth required
 * Run: node scrapers/merwatch-scraper.js
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const LATEST_FILE = path.join(DATA_DIR, "merwatch-latest.json");
const HISTORY_FILE = path.join(DATA_DIR, "merwatch-history.json");
const SOURCE = "Meridian Timepieces";
const BASE = "https://merwatch.com";

const BRAND_KEYWORDS = [
  "rolex","patek philippe","audemars piguet","richard mille","omega",
  "cartier","iwc","panerai","jaeger-lecoultre","jaeger lecoultre","vacheron constantin",
  "a. lange","breguet","fp journe","f.p. journe","mb&f","h. moser",
  "grand seiko","blancpain","girard-perregaux","hublot","zenith",
  "breitling","tudor","tag heuer","chopard","bulgari","piaget",
  "franck muller","roger dubuis","ulysse nardin","glashutte","nomos",
  "frederique constant","montblanc","parmigiani","laurent ferrier",
  "seiko","longines","hamilton","oris","tissot",
];

function extractBrand(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  const hit = BRAND_KEYWORDS.find(b => lower.startsWith(b)) || BRAND_KEYWORDS.find(b => lower.includes(b));
  return hit ? hit.replace(/\b\w/g, c => c.toUpperCase()) : null;
}

function extractRef(name, slug) {
  if (!name) return slug || null;
  const parts = name.trim().split(/\s+/);
  const last = parts[parts.length - 1];
  if (/^[A-Z0-9][A-Z0-9\-\.\/]{2,}$/i.test(last)) return last;
  return slug || null;
}

function extractDialColor(name) {
  const lower = (name||"").toLowerCase();
  const colors = ["black","blue","white","silver","green","grey","gray","champagne",
    "brown","gold","pink","red","yellow","orange","cream","ivory","copper","salmon",
    "slate","olive","teal","purple","burgundy","meteorite","chocolate","lacquer",
    "sunburst","rhodium","anthracite"];
  for (const c of colors) if (lower.includes(c+" dial")||lower.includes(c+"-dial")) return c.charAt(0).toUpperCase()+c.slice(1);
  for (const c of colors) if (lower.includes(c)) return c.charAt(0).toUpperCase()+c.slice(1);
  return null;
}

async function run() {
  console.log("[Merwatch] Launching browser...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Navigate to site first to get cookies/session
  await page.goto(BASE + "/shop/", { waitUntil: "domcontentloaded", timeout: 30000 });

  const all = [];
  let pageNum = 1;

  try {
    while (true) {
      console.log(`[Merwatch] Fetching page ${pageNum}...`);
      const url = `${BASE}/wp-json/wc/store/v1/products?per_page=100&page=${pageNum}&_fields=id,name,permalink,prices,images,slug`;
      const response = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      const body = await response.text();
      const data = JSON.parse(body);

      if (!data.length) break;
      all.push(...data);
      console.log(`[Merwatch] Page ${pageNum}: ${data.length} products, total: ${all.length}`);
      if (data.length < 100) break;
      pageNum++;
      await page.waitForTimeout(400);
    }
  } finally {
    await browser.close();
  }

  const now = new Date().toISOString();
  const mapped = all.map(p => ({
    id: `merwatch-${p.id}`,
    source: SOURCE,
    sourceDetail: "merwatch.com",
    imageUrl: p.images?.[0]?.src || null,
    brand: extractBrand(p.name),
    model: null,
    ref: extractRef(p.name, p.slug),
    title: p.name,
    dialColor: extractDialColor(p.name),
    caseMaterial: null, year: null,
    price: p.prices?.price ? Math.round(parseInt(p.prices.price) / 100) : null,
    seller: null,
    condition: "Pre-Owned",
    postedMinutesAgo: null,
    isNew: false,
    inStock: true,
    url: p.permalink,
    scrapedAt: now,
  }));

  console.log(`[Merwatch] Scraped ${mapped.length} total listings`);
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const existing = fs.existsSync(HISTORY_FILE)
    ? JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")) : [];
  const seen = new Set(existing.map(i => i.url));
  const newItems = mapped.filter(i => i.url && !seen.has(i.url));
  fs.writeFileSync(HISTORY_FILE, JSON.stringify([...existing, ...newItems], null, 2));
  fs.writeFileSync(LATEST_FILE, JSON.stringify(mapped, null, 2));
  console.log(`[Merwatch] Done. ${mapped.length} saved. +${newItems.length} new to history.`);
}

run().catch(err => { console.error("[Merwatch] Fatal:", err.message); process.exit(1); });
