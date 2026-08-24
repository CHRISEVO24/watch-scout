const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DATA_DIR = path.join(__dirname, "..", "data");
const LATEST_FILE = path.join(DATA_DIR, "chrono24-latest.json");
const REMOVED_FILE = path.join(DATA_DIR, "chrono24-removed-nonUS.json");
const PROGRESS_FILE = path.join(DATA_DIR, "chrono24-verify-progress.json");

const WORKERS = 5; // 5 parallel browsers
const DELAY_MS = 400; // per worker

async function checkLocation(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(500);
    const location = await page.evaluate(() => {
      const text = document.body.innerText;
      const loc = text.match(/Location\s+([^\n]+)/);
      return loc ? loc[1].trim() : "US";
    });
    const isUS = location.includes("United States") || location.startsWith("US,") || location === "US";
    return { isUS, location };
  } catch(e) {
    return { isUS: true, location: "unknown" }; // keep on error
  }
}

async function workerRun(workerId, items, results) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  for (const item of items) {
    const { isUS, location } = await checkLocation(page, item.url);
    results.push({ item, isUS, location });
    await page.waitForTimeout(DELAY_MS);
  }

  await browser.close();
  console.log(`[Worker ${workerId}] Done. Processed ${items.length} items.`);
}

async function verifyAllUS() {
  console.log("[Chrono24Verify] Loading data...");
  const items = JSON.parse(fs.readFileSync(LATEST_FILE, "utf8"));
  
  // Load progress if resuming
  let startIdx = 0;
  let verified = [];
  let removed = [];
  if (fs.existsSync(PROGRESS_FILE)) {
    const prog = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
    startIdx = prog.nextIdx || 0;
    verified = prog.verified || [];
    removed = prog.removed || [];
    console.log(`[Chrono24Verify] Resuming from item ${startIdx}. Already verified: ${verified.length}, removed: ${removed.length}`);
  }

  const remaining = items.slice(startIdx);
  const estimatedMinutes = Math.round(remaining.length * DELAY_MS / WORKERS / 60000);
  console.log(`[Chrono24Verify] ${remaining.length} items to check across ${WORKERS} workers. Est: ~${estimatedMinutes} min`);

  // Process in chunks of 1000, saving progress
  const CHUNK = 1000;
  
  for (let chunkStart = 0; chunkStart < remaining.length; chunkStart += CHUNK) {
    const chunk = remaining.slice(chunkStart, chunkStart + CHUNK);
    
    // Split chunk across workers
    const workerItems = Array.from({length: WORKERS}, (_, i) => 
      chunk.filter((_, idx) => idx % WORKERS === i)
    );

    const results = [];
    await Promise.all(workerItems.map((items, i) => workerRun(i, items, results)));

    // Process results
    for (const { item, isUS, location } of results) {
      if (isUS) {
        item.locationText = location;
        verified.push(item);
      } else {
        removed.push({ id: item.id, url: item.url, location, brand: item.brand, title: item.title });
      }
    }

    // Save progress
    const globalIdx = startIdx + chunkStart + chunk.length;
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ nextIdx: globalIdx, verified, removed }, null, 2));
    console.log(`[Chrono24Verify] Chunk done. Progress: ${globalIdx}/${items.length} | Kept: ${verified.length} | Removed: ${removed.length}`);

    // Save current verified data
    fs.writeFileSync(LATEST_FILE, JSON.stringify(verified, null, 2));
  }

  fs.writeFileSync(REMOVED_FILE, JSON.stringify(removed, null, 2));
  if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);

  console.log(`[Chrono24Verify] COMPLETE. Kept: ${verified.length} | Removed: ${removed.length} non-US listings`);
  return verified;
}

verifyAllUS().catch(console.error);
