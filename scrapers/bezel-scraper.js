const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const LATEST_FILE = path.join(DATA_DIR, "bezel-latest.json");
const HISTORY_FILE = path.join(DATA_DIR, "bezel-history.json");

const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, val] = arg.replace(/^--/, "").split("=");
  acc[key] = val === undefined ? true : val;
  return acc;
}, {});

const BRAND = args.brand || "rolex";

function extractRef(text) {
  const m = text.match(/"referenceNumber":"([^"]+)"/);
  return m ? m[1] : null;
}
function extractNestedName(text, key) {
  const m = text.match(new RegExp(`"${key}":\\{"id":\\d+,"name":"([^"]*)"`));
  return m ? m[1] : null;
}
function extractPrice(text) {
  const m = text.match(/"lowestPrice":(\d+)/);
  return m ? Math.round(Number(m[1]) / 100) : null;
}

function extractProductsFromHtml(html) {
  const marker = '{"type":"MODEL","object":{';
  const chunks = html.split(marker).slice(1);

  const products = [];
  for (const chunk of chunks) {
    const window = chunk.slice(0, 15000);

    const ref = extractRef(window);
    const price = extractPrice(window);
    if (!ref || !price) continue;

    const nameMatch = window.match(/"name":"([^"]+)"/);
    const modelName = nameMatch ? nameMatch[1] : null;
    const brandMatch = window.match(/"brand":\{"id":\d+,"name":"([^"]*)"/);
    const brandName = brandMatch ? brandMatch[1] : null;
    const dialColor = extractNestedName(window, "dialColor");
    const caseSizeMatch = window.match(/"caseSize":"([^"]*)"/);

    // Bezel's data structure has multiple "images"-shaped keys (brand
    // wordmark/logo vs actual product photo) that aren't reliably
    // distinguishable via regex - every attempt kept grabbing the generic
    // brand logo instead of the real watch photo. Disabled until we find
    // a cleaner way to isolate the real per-listing image.
    const imageUrl = null;

    products.push({
      id: `bezel-${ref}`,
      source: "Bezel",
      sourceDetail: "Marketplace — authenticated",
      imageUrl,
      brand: brandName || BRAND.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      model: modelName,
      ref,
      title: `${brandName || ""} ${modelName || ""}`.trim(),
      dialColor,
      caseSize: caseSizeMatch ? caseSizeMatch[1] : null,
      price,
      seller: null,
      condition: "Pre-owned, authenticated",
      postedMinutesAgo: null,
      isNew: null,
      url: `https://shop.getbezel.com/watches/${BRAND}/${(modelName || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      scrapedAt: new Date().toISOString(),
    });
  }
  return products;
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  });

  const url = `https://shop.getbezel.com/explore/${BRAND}`;
  console.log(`Launching headless browser for: ${url}`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);

  const html = await page.content();
  await browser.close();

  if (args.inspect) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, "bezel-raw.html"), html, "utf8");
    console.log("Saved raw HTML to data/bezel-raw.html");
  }

  const found = extractProductsFromHtml(html);
  console.log(`Found ${found.length} products.`);

  let existing = [];
  if (args.reset) {
    console.log("--reset flag set: discarding previously saved data.");
  } else if (fs.existsSync(LATEST_FILE)) {
    try {
      existing = JSON.parse(fs.readFileSync(LATEST_FILE, "utf8"));
    } catch {
      existing = [];
    }
  }
  const merged = new Map(existing.map((item) => [item.id, item]));
  for (const item of found) merged.set(item.id, item);
  const deduped = Array.from(merged.values());

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LATEST_FILE, JSON.stringify(deduped, null, 2), "utf8");

  let history = [];
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    } catch {
      history = [];
    }
  }
  history.push({ scrapedAt: new Date().toISOString(), brand: BRAND, count: found.length });
  if (history.length > 20) history = history.slice(-20);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf8");

  console.log(`Done. ${found.length} listings from this run, ${deduped.length} total across all saved runs — written to data/bezel-latest.json`);
}

run().catch((err) => {
  console.error("Bezel scraper failed:", err.message);
  process.exit(1);
});
