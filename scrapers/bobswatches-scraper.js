const axios = require("axios");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const LATEST_FILE = path.join(DATA_DIR, "bobswatches-latest.json");
const HISTORY_FILE = path.join(DATA_DIR, "bobswatches-history.json");

const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, val] = arg.replace(/^--/, "").split("=");
  acc[key] = val === undefined ? true : val;
  return acc;
}, {});

const CATEGORY = args.category || "rolex/watches-mens";
const MAX_PAGES = Number(args.pages || 3);

const BRAND_KEYWORDS = [
  "rolex", "patek philippe", "audemars piguet", "richard mille", "omega",
  "tudor", "cartier", "panerai", "iwc", "breitling", "jaeger-lecoultre",
  "vacheron constantin", "grand seiko", "seiko", "tag heuer", "longines",
  "hamilton", "oris", "tissot", "zenith", "breguet",
];
function extractBrand(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const hit = BRAND_KEYWORDS.find((b) => lower.includes(b));
  return hit ? hit.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
}

function buildUrl(page) {
  const base = `https://www.bobswatches.com/${CATEGORY}`;
  return page > 1 ? `${base}?page=${page}` : base;
}

function extractProductsFromHtml(html) {
  const products = [];
  const scriptRegex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    let data;
    try {
      data = JSON.parse(match[1]);
    } catch {
      continue;
    }
    if (data["@type"] !== "Product") continue;

    const propsList = data.additionalProperty || [];
    const props = {};
    for (const p of propsList) {
      if (p.name) props[p.name] = p.value;
    }

    const title = data.name || null;
    const price = data.offers && data.offers.price ? Math.round(parseFloat(data.offers.price)) : null;
    const availability = data.offers ? data.offers.availability : null;

    const imageUrl = (data.image && data.image[0] && data.image[0].url) || null;

    products.push({
      id: `bw-${data.sku || Buffer.from(data.url || title || "").toString("base64").slice(0, 16)}`,
      source: "Bob's Watches",
      sourceDetail: "Dealer",
      imageUrl,
      brand: extractBrand(title) || "Rolex",
      model: props["Model Name"] || null,
      ref: data.mpn || null,
      title,
      dialColor: props["Dial Color"] || null,
      caseMaterial: props["Metal Type"] || data.color || null,
      year: props["Year"] || null,
      price,
      seller: null,
      condition: data.itemCondition ? data.itemCondition.replace("Condition", "") : null,
      postedMinutesAgo: null,
      isNew: null,
      inStock: availability ? availability.includes("InStock") : null,
      url: data.url || null,
      scrapedAt: new Date().toISOString(),
    });
  }
  return products;
}

async function scrapePage(page) {
  const url = buildUrl(page);
  const { data: html } = await axios.get(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
    timeout: 15000,
  });

  if (args.inspect) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, `bobswatches-raw-page${page}.html`), html, "utf8");
  }

  return extractProductsFromHtml(html);
}

async function run() {
  let all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    console.log(`Scraping page ${page}...`);
    try {
      const pageListings = await scrapePage(page);
      if (pageListings.length === 0) {
        console.log("No products found on this page — likely reached the end.");
        break;
      }
      console.log(`  Found ${pageListings.length} products.`);
      all = all.concat(pageListings);
      await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      console.error(`Failed on page ${page}:`, err.message);
      break;
    }
  }

  const seen = new Set();
  all = all.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

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
  for (const item of all) merged.set(item.id, item);
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
  history.push({ scrapedAt: new Date().toISOString(), category: CATEGORY, count: all.length });
  if (history.length > 20) history = history.slice(-20);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf8");

  console.log(`Done. ${all.length} listings from this run, ${deduped.length} total — written to data/bobswatches-latest.json`);
}

run().catch((err) => {
  console.error("Scraper failed:", err.message);
  process.exit(1);
});
