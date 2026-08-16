const fs = require("fs");
const path = require("path");
const axios = require("axios");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "ecj-inventory-latest.json");
const HISTORY_URL = "https://chrisevo24.github.io/ecj-tracker/history.json";

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
function parsePrice(text) {
  if (!text) return null;
  const m = String(text).replace(/,/g, "").match(/\$?(\d+)/);
  return m ? Number(m[1]) : null;
}

async function run() {
  console.log(`Fetching ECJ Luxe inventory from: ${HISTORY_URL}`);
  const { data: history } = await axios.get(HISTORY_URL, { timeout: 30000 });

  const timestamps = Object.keys(history).sort();
  if (timestamps.length === 0) {
    console.error("No snapshots found in ECJ Luxe history.json.");
    process.exit(1);
  }
  const latestTimestamp = timestamps[timestamps.length - 1];
  const snapshot = history[latestTimestamp];
  console.log(`Using most recent ECJ Luxe snapshot: ${latestTimestamp} (${Object.keys(snapshot).length} products)`);

  const inventory = Object.values(snapshot).map((item) => {
    const brand = item.brand || extractBrand(item.name) || null;

    return {
      id: `ecj-${item.id}`,
      store: "ECJ Luxe Collection",
      name: item.name,
      brand,
      model: item.model || null,
      ref: item.referenceNumber || null,
      productCode: item.productCode || null,
      price: parsePrice(item.price),
      inStock: item.inStock === true || item.stockStatus === "In Stock",
      stockStatus: item.stockStatus || null,
      year: item.year || null,
      category: item.category || null,
      description: item.description || null,
      url: item.url || null,
      imageUrl: item.image || null,
    };
  });

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(inventory, null, 2), "utf8");

  const inStockCount = inventory.filter((i) => i.inStock).length;
  console.log(`Done. ${inventory.length} ECJ Luxe inventory items loaded (${inStockCount} in stock) — written to data/ecj-inventory-latest.json`);
}

run().catch((err) => {
  console.error("ECJ Luxe inventory load failed:", err.message);
  process.exit(1);
});
