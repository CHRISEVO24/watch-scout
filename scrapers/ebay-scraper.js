const axios = require("axios");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const LATEST_FILE = path.join(DATA_DIR, "ebay-latest.json");
const HISTORY_FILE = path.join(DATA_DIR, "ebay-history.json");

const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, val] = arg.replace(/^--/, "").split("=");
  acc[key] = val === undefined ? true : val;
  return acc;
}, {});

function loadEnvFile() {
  const fs = require("fs");
  const path = require("path");
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvFile();

const CLIENT_ID = process.env.EBAY_CLIENT_ID;
const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET in your environment before running this script.");
  process.exit(1);
}

const QUERY = args.query || "rolex submariner";
const US_ONLY = args.usOnly !== "false";
const MAX_ITEMS = Number(args.maxItems || 150);
const CATEGORY_ID = args.categoryId || "31387";

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
  "red", "beige",
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
  const m =
    text.match(/\bref\.?\s*([A-Z0-9\/]{4,14})\b/i) ||
    text.match(/\b(\d{4,6}[A-Z]{0,3})\b/);
  return m ? m[1] : null;
}

async function getAccessToken() {
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await axios.post(
    "https://api.ebay.com/identity/v1/oauth2/token",
    "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
    }
  );
  return res.data.access_token;
}

async function searchListings(token) {
  let allItems = [];
  let offset = 0;
  const pageSize = 200;
  const targetTotal = MAX_ITEMS;

  while (allItems.length < targetTotal) {
    const remaining = targetTotal - allItems.length;
    const res = await axios.get("https://api.ebay.com/buy/browse/v1/item_summary/search", {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
      params: {
        q: QUERY,
        category_ids: CATEGORY_ID,
        limit: Math.min(pageSize, remaining),
        offset,
      },
    });
    const pageItems = res.data.itemSummaries || [];
    allItems = allItems.concat(pageItems);
    console.log(`  Page at offset ${offset}: ${pageItems.length} items (${allItems.length}/${targetTotal} so far)`);
    if (pageItems.length === 0 || pageItems.length < Math.min(pageSize, remaining)) break;
    offset += pageItems.length;
  }

  return allItems;
}

async function run() {
  console.log(`Getting eBay access token...`);
  const token = await getAccessToken();

  console.log(`Searching eBay for "${QUERY}"...`);
  const items = await searchListings(token);
  console.log(`eBay returned ${items.length} raw items.`);

  if (args.inspect && items.length > 0) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, "ebay-sample-raw.json"), JSON.stringify(items[0], null, 2), "utf8");
    console.log("Saved one raw item to data/ebay-sample-raw.json");
  }

  let listings = items.map((item) => {
    const title = item.title || null;
    const price = item.price && item.price.value ? Math.round(parseFloat(item.price.value)) : null;
    const country = item.itemLocation ? item.itemLocation.country : null;
    const condition = item.condition || null;

    return {
      id: `ebay-${item.itemId}`,
      source: "eBay",
      imageUrl: (item.image && item.image.imageUrl) || null,
      imageUrl: (item.image && item.image.imageUrl) || null,
      sourceDetail: item.itemLocation && item.itemLocation.city
        ? `${item.itemLocation.city}, ${item.itemLocation.stateOrProvince || country || ""}`.trim()
        : "eBay",
      brand: extractBrand(title),
      model: extractModel(title),
      ref: extractRef(title),
      title,
      dialColor: extractColor(title),
      price,
      seller: null,
      condition,
      postedMinutesAgo: null,
      isNew: condition ? /new/i.test(condition) : null,
      country,
      url: item.itemWebUrl || null,
      scrapedAt: new Date().toISOString(),
    };
  });

  if (US_ONLY) {
    const before = listings.length;
    listings = listings.filter((l) => l.country === "US");
    console.log(`Filtered to US-only: ${listings.length} of ${before} listings.`);
  }

  let existing = [];
  if (args.reset) {
    console.log("--reset flag set: discarding previously saved eBay data.");
  } else if (fs.existsSync(LATEST_FILE)) {
    try {
      existing = JSON.parse(fs.readFileSync(LATEST_FILE, "utf8"));
    } catch {
      existing = [];
    }
  }
  const merged = new Map(existing.map((item) => [item.id, item]));
  for (const item of listings) merged.set(item.id, item);
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
  history.push({ scrapedAt: new Date().toISOString(), query: QUERY, count: listings.length });
  if (history.length > 20) history = history.slice(-20);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf8");

  console.log(`Done. ${listings.length} listings from this run, ${deduped.length} total across all saved runs — written to data/ebay-latest.json`);
}

run().catch((err) => {
  console.error("eBay scraper failed:", err.response ? JSON.stringify(err.response.data) : err.message);
  process.exit(1);
});
