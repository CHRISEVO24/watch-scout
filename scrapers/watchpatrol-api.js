/**
 * WatchPatrol API Client — Watch Scout
 * --------------------------------------
 * watchpatrol.net is NOT a scrape target — it ships a real typed REST API
 * (419 brands, 4,679 models, 119,970+ listings across 22 sources as of
 * June 2026). Use this instead of HTML parsing; it's faster, more stable,
 * and won't break every time their frontend changes.
 *
 * Access: they're onboarding API partners manually during beta. Request a
 * key at https://www.watchpatrol.net/contact/ — mention you want listings +
 * pricing endpoint access for a dealer-side market monitoring tool. Once
 * you have a key, set WATCHPATROL_API_KEY in your environment.
 *
 * I could not pull the exact response schema for /listings/ — their docs
 * page at /api/public/v1/docs/ blocks automated fetches (robots.txt), so
 * the field names below (id, brand, model, ref, price, seller, source,
 * postedAt, url) are reasonable assumptions based on the endpoint shapes
 * shown on their integrations page, not confirmed. First thing to do once
 * you have a key: run with --inspect to dump one raw response to
 * data/watchpatrol-raw-sample.json and adjust the mapping in
 * normalizeListing() below to match what actually comes back.
 *
 * Usage:
 *   export WATCHPATROL_API_KEY=your_key_here
 *   node watchpatrol-api.js --brand=rolex --maxPrice=15000
 *   node watchpatrol-api.js --brand=patek-philippe --inspect
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const LATEST_FILE = path.join(DATA_DIR, "watchpatrol-latest.json");
const HISTORY_FILE = path.join(DATA_DIR, "watchpatrol-history.json");

const API_BASE = "https://www.watchpatrol.net/api/public/v1";
const API_KEY = process.env.WATCHPATROL_API_KEY;

const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, val] = arg.replace(/^--/, "").split("=");
  acc[key] = val === undefined ? true : val;
  return acc;
}, {});

if (!API_KEY) {
  console.error(
    "Set WATCHPATROL_API_KEY in your environment. Request access at https://www.watchpatrol.net/contact/"
  );
  process.exit(1);
}

function normalizeListing(raw) {
  // Adjust field mappings here once you've confirmed the real response
  // shape against your API key's actual output (see --inspect note above).
  return {
    id: `wp-${raw.id ?? raw.listing_id ?? raw.slug}`,
    source: "WatchPatrol",
    sourceDetail: raw.source_name || raw.source || null,
    brand: raw.brand?.name || raw.brand_name || raw.brand || null,
    model: raw.model?.name || raw.model_name || raw.model || null,
    ref: raw.reference || raw.ref || null,
    title: raw.title || `${raw.brand_name || ""} ${raw.model_name || ""}`.trim(),
    price: raw.price ?? raw.price_usd ?? null,
    seller: raw.seller?.username || raw.seller_name || null,
    condition: raw.condition || null,
    postedMinutesAgo: raw.posted_at
      ? Math.round((Date.now() - new Date(raw.posted_at).getTime()) / 60000)
      : null,
    isNew: raw.is_new ?? null,
    url: raw.url || raw.listing_url || null,
    scrapedAt: new Date().toISOString(),
  };
}

async function fetchListings({ brand, maxPrice, minPrice, page = 1 }) {
  const params = new URLSearchParams();
  if (brand) params.set("brand", brand);
  if (maxPrice) params.set("max_price", maxPrice);
  if (minPrice) params.set("min_price", minPrice);
  if (page > 1) params.set("page", page);

  const url = `${API_BASE}/listings/?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`WatchPatrol API returned ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

async function run() {
  const brand = args.brand || null;
  const maxPrice = args.maxPrice || null;
  const minPrice = args.minPrice || null;

  console.log(`Fetching WatchPatrol listings${brand ? ` for ${brand}` : ""}...`);

  const data = await fetchListings({ brand, maxPrice, minPrice });

  if (args.inspect) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(DATA_DIR, "watchpatrol-raw-sample.json"),
      JSON.stringify(data, null, 2),
      "utf8"
    );
    console.log("Saved raw response to data/watchpatrol-raw-sample.json — check field names before trusting normalizeListing().");
  }

  const rawListings = data.results || data.listings || data;
  const listings = (Array.isArray(rawListings) ? rawListings : []).map(normalizeListing);

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LATEST_FILE, JSON.stringify(listings, null, 2), "utf8");

  let history = [];
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    } catch {
      history = [];
    }
  }
  history.push({ scrapedAt: new Date().toISOString(), count: listings.length });
  if (history.length > 20) history = history.slice(-20);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf8");

  console.log(`Done. ${listings.length} listings written to data/watchpatrol-latest.json`);
}

run().catch((err) => {
  console.error("WatchPatrol fetch failed:", err.message);
  process.exit(1);
});
