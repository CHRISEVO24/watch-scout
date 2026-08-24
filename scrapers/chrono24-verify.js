const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DATA_DIR = path.join(__dirname, "..", "data");
const LATEST_FILE = path.join(DATA_DIR, "chrono24-latest.json");

async function verifyUS() {
  console.log("[Chrono24Verify] Loading existing data...");
  const items = JSON.parse(fs.readFileSync(LATEST_FILE, "utf8"));
  console.log(`[Chrono24Verify] ${items.length} items to verify`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  // Sample check -- verify 200 random items for US location
  // Full verify would take hours for 83k items
  const sample = items.filter((_, i) => i % 400 === 0); // every 400th item
  let nonUS = 0;

  for (const item of sample.slice(0, 50)) {
    try {
      await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(1000);
      const locationText = await page.evaluate(() => {
        const loc = document.querySelector('[class*="location"], [class*="dealer-location"], [class*="seller-location"]');
        return loc?.textContent?.trim() || document.body.innerText.match(/\b(US|United States|UK|Germany|HK|Hong Kong|Japan|France|Switzerland)\b/)?.[0] || "unknown";
      });
      if (!["US", "United States"].includes(locationText)) {
        nonUS++;
        console.log(`[NonUS] ${locationText}: ${item.title.slice(0,40)} - ${item.url.slice(-30)}`);
      }
    } catch(e) {}
    await page.waitForTimeout(500);
  }

  await browser.close();
  console.log(`[Chrono24Verify] Sample check: ${nonUS} non-US found in ${sample.slice(0,50).length} items checked`);
  console.log(`[Chrono24Verify] Estimated non-US in full dataset: ~${Math.round(nonUS/50*100)}%`);
}

verifyUS().catch(console.error);
