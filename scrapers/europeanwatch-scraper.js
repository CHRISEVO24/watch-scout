const axios = require("axios");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const LATEST_FILE = path.join(DATA_DIR, "europeanwatch-latest.json");
const HISTORY_FILE = path.join(DATA_DIR, "europeanwatch-history.json");

const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, val] = arg.replace(/^--/, "").split("=");
  acc[key] = val === undefined ? true : val;
  return acc;
}, {});

const BRAND = args.brand || "rolex";
const URL = `https://www.europeanwatch.com/brand/${BRAND}`;

const BRAND_KEYWORDS = [
  "rolex", "patek philippe", "audemars piguet", "richard mille", "omega",
  "tudor", "cartier", "panerai", "iwc", "breitling", "jaeger-lecoultre",
  "vacheron constantin", "grand seiko", "seiko", "tag heuer", "longines",
  "hamilton", "oris", "tissot", "zenith", "breguet",
];
const MODEL_KEYWORDS = [
  "GMT-Master II", "GMT-Master", "Sky-Dweller", "Sea-Dweller", "Day-Date",
  "Yacht-Master II", "Yacht-Master", "Air-King", "Submariner Date",
  "Submariner", "Daytona", "Datejust 41", "Datejust", "Explorer II", "Explorer",
  "Milgauss", "Cellini",
  "Royal Oak Offshore", "Royal Oak", "Code 11.59",
  "Nautilus", "Aquanaut", "Calatrava", "Grand Complications",
  "Black Bay GMT", "Black Bay Chrono", "Black Bay", "Pelagos", "Ranger",
  "Speedmaster Professional", "Speedmaster", "Seamaster Diver", "Seamaster",
  "Constellation", "De Ville", "Planet Ocean", "Aqua Terra",
  "Big Pilot", "Portugieser", "Pilot's Watch", "Aquatimer",
  "Navitimer", "Superocean", "Avenger", "Premier",
  "Tank", "Santos", "Ballon Bleu",
  "Luminor", "Radiomir", "Submersible",
  "Grand Seiko", "Prospex", "Presage",
];
const COLOR_KEYWORDS = [
  "mother of pearl", "two-tone", "meteorite", "tropical", "champagne",
  "salmon", "burgundy", "charcoal", "turquoise", "ivory", "cream",
  "navy", "slate", "olive", "gilt", "black", "white", "blue", "green",
  "silver", "grey", "gray", "brown", "pink", "purple", "yellow", "orange",
  "red", "beige", "lavender", "sodalite",
];

function extractBrand(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const hit = BRAND_KEYWORDS.find((b) => lower.includes(b));
  return hit ? hit.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
}
function extractModel(text) {
  if (!text) return null;
  const hit = MODEL_KEYWORDS.find((m) => new RegExp(`\\b${m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
  return hit || null;
}
function extractColor(text) {
  if (!text) return null;
  const hit = COLOR_KEYWORDS.find((c) => new RegExp(`\\b${c}\\b`, "i").test(text));
  return hit ? hit.replace(/\b\w/g, (ch) => ch.toUpperCase()) : null;
}
function extractRef(text) {
  if (!text) return null;
  const m = text.match(/\b(\d{4,6}[A-Z]{0,3})\b/);
  return m ? m[1] : null;
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
    if (data["@type"] !== "ItemList" || !Array.isArray(data.itemListElement)) continue;

    for (const el of data.itemListElement) {
      const item = el.item;
      if (!item || item["@type"] !== "Product") continue;

      const title = item.name || null;
      const price = item.offers && item.offers.price ? Math.round(Number(item.offers.price)) : null;
      const availability = item.offers ? item.offers.availability : null;
      const condition = item.offers && item.offers.itemCondition
        ? item.offers.itemCondition.replace("https://schema.org/", "").replace("Condition", "")
        : null;

      products.push({
        id: `ew-${item.sku}`,
        source: "European Watch Co",
        sourceDetail: "Dealer",
        imageUrl: (item.image && item.image[0]) || null,
        brand: extractBrand(title) || "Rolex",
        model: extractModel(title),
        ref: extractRef(title),
        title,
        dialColor: extractColor(title),
        caseMaterial: null,
        year: null,
        price,
        seller: null,
        condition,
        postedMinutesAgo: null,
        isNew: null,
        inStock: availability ? availability.includes("InStock") : null,
        url: item.url || null,
        scrapedAt: new Date().toISOString(),
      });
    }
  }
  return products;
}

async function run() {
  console.log(`Fetching: ${URL}`);
  let html;
  try {
    const response = await axios.get(URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
      timeout: 15000,
    });
    html = response.data;
  } catch (err) {
    if (err.response && err.response.status === 404) {
      // European Watch simply doesn't carry this brand - a normal, expected
      // outcome (not every dealer stocks every brand), not a real failure.
      console.log(`European Watch doesn't carry "${BRAND}" (404) - treating as 0 listings.`);
      fs.mkdirSync(DATA_DIR, { recursive: true });
      if (!fs.existsSync(LATEST_FILE)) fs.writeFileSync(LATEST_FILE, "[]", "utf8");
      console.log("Done. 0 listings from this run (brand not carried) - existing data untouched.");
      return;
    }
    throw err;
  }

  if (args.inspect) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, "europeanwatch-raw.html"), html, "utf8");
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

  console.log(`Done. ${found.length} listings from this run, ${deduped.length} total — written to data/europeanwatch-latest.json`);
}

run().catch((err) => {
  console.error("Scraper failed:", err.message);
  process.exit(1);
});
