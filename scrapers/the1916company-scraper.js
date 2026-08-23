const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "the1916company-latest.json");
const BASE_URL = "https://www.the1916company.com";

async function scrape() {
  console.log("[The1916Company] Starting Playwright scrape...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 }
  });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/pre-owned/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);
  console.log("[The1916Company] Page loaded. Clicking VIEW MORE to load all products...");

  // Click VIEW MORE one at a time until it disappears
  let clicks = 0;
  while (true) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);
    
    const btn = await page.locator('button:has-text("VIEW MORE")').first();
    const visible = await btn.isVisible().catch(() => false);
    if (!visible) break;
    
    await btn.click();
    clicks++;
    await page.waitForTimeout(2500);
    
    const count = await page.evaluate(() =>
      document.querySelectorAll('a[href*="/pre-owned/"]').length
    );
    console.log(`[The1916Company] Click #${clicks} — ${count} links loaded`);
  }

  console.log(`[The1916Company] All products loaded after ${clicks} clicks. Extracting...`);

  const items = await page.evaluate(() => {
    const seen = new Set();
    const results = [];
    const links = [...document.querySelectorAll('a[href*="/pre-owned/"]')].filter(a =>
      a.href.match(/\/pre-owned\/[^/]+\/[^/]+\/\d+\/?/) && a.href.length > 60
    );
    links.forEach(a => {
      if (seen.has(a.href)) return;
      seen.add(a.href);
      const text = a.innerText.trim();
      const lines = text.split("\n").map(l => l.trim()).filter(l => l && !["SALE","NEW","COMING SOON"].includes(l.toUpperCase()));
      const brand = lines[0] || null;
      const model = lines[1] || null;
      const ref = lines[2] || null;
      const priceMatch = text.match(/\$([\d,]+)/);
      const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, "")) : null;
      const img = a.querySelector("img");
      results.push({
        href: a.href, brand, model, ref, price,
        imgSrc: (img?.src && !img.src.includes('.svg') && !img.src.includes('mobify')) ? img.src : null,
      });
    });
    return results;
  });

  await browser.close();

  const normalized = items.map(item => ({
    id: `1916-${item.href.split("/").filter(Boolean).pop()}`,
    source: "The 1916 Company",
    sourceDetail: "the1916company.com",
    brand: item.brand,
    model: item.model,
    ref: item.ref,
    title: [item.brand, item.model, item.ref].filter(Boolean).join(" "),
    price: item.price,
    url: item.href,
    imageUrl: item.imgSrc || null,
    condition: "Pre-Owned",
    postedMinutesAgo: null,
    scrapedAt: new Date().toISOString(),
  }));

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(normalized, null, 2));
  console.log(`[The1916Company] Done. ${normalized.length} items written.`);
  return normalized;
}

if (require.main === module) scrape().catch(console.error);
module.exports = { scrape };
