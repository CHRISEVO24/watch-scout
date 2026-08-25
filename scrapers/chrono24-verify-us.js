const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DATA_DIR = path.join(__dirname, "..", "data");
const SOURCE_FILE = path.join(DATA_DIR, "chrono24-latest.json");
const VERIFIED_FILE = path.join(DATA_DIR, "chrono24-verified.json");
const PROGRESS_FILE = path.join(DATA_DIR, "chrono24-verify-progress.json");

async function verifyAllUS() {
  const allItems = JSON.parse(fs.readFileSync(SOURCE_FILE, "utf8"));
  console.log(`[Verify] ${allItems.length} total items`);

  let startIdx = 0;
  let verified = [];
  let removed = [];
  if (fs.existsSync(PROGRESS_FILE)) {
    const p = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
    startIdx = p.nextIdx || 0;
    verified = p.verified || [];
    removed = p.removed || [];
    console.log(`[Verify] Resuming from ${startIdx}. Verified: ${verified.length} Removed: ${removed.length}`);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  for (let i = startIdx; i < allItems.length; i++) {
    const item = allItems[i];
    try {
      await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: 10000 });
      const location = await page.evaluate(() => {
        const loc = document.body.innerText.match(/Location\s+([^\n]+)/);
        return loc ? loc[1].trim() : "US";
      });
      const isUS = location.includes("United States") || location.startsWith("US,") || location === "US";
      if (isUS) { item.locationText = location; verified.push(item); }
      else removed.push({ id: item.id, url: item.url, location, brand: item.brand });
    } catch(e) {
      verified.push(item); // keep on error
    }

    // Save every 100 items
    if ((i + 1) % 100 === 0) {
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ nextIdx: i + 1, verified, removed }));
      fs.writeFileSync(VERIFIED_FILE, JSON.stringify(verified, null, 2));
      console.log(`[Verify] ${i+1}/${allItems.length} | Kept: ${verified.length} | Removed: ${removed.length}`);
    }

    await page.waitForTimeout(150);
  }

  await browser.close();
  fs.writeFileSync(SOURCE_FILE, JSON.stringify(verified, null, 2));
  fs.writeFileSync(path.join(DATA_DIR, "chrono24-removed-nonUS.json"), JSON.stringify(removed, null, 2));
  if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);
  console.log(`[Verify] COMPLETE. Kept: ${verified.length} | Removed: ${removed.length}`);
}

verifyAllUS().catch(console.error);
