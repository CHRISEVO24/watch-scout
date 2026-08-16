const fs = require("fs");
const path = require("path");
const axios = require("axios");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "eci-inventory-latest.json");
const HISTORY_URL = "https://chrisevo24.github.io/ECI-Jewelers/history.json";

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
  "Royal Oak Offshore", "Royal Oak", "Code 11.59", "Millenary",
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
function parsePrice(text) {
  if (!text) return null;
  const m = String(text).replace(/,/g, "").match(/\$?(\d+)/);
  return m ? Number(m[1]) : null;
}

async function run() {
  console.log(`Fetching ECI inventory from: ${HISTORY_URL}`);
  const { data: history } = await axios.get(HISTORY_URL, { timeout: 20000 });

  const timestamps = Object.keys(history).sort();
  if (timestamps.length === 0) {
    console.error("No snapshots found in ECI history.json.");
    process.exit(1);
  }
  const latestTimestamp = timestamps[timestamps.length - 1];
  const snapshot = history[latestTimestamp];
  console.log(`Using most recent ECI snapshot: ${latestTimestamp} (${Object.keys(snapshot).length} products)`);

  const inventory = Object.values(snapshot).map((item) => {
    const brand = item.brand || extractBrand(item.name) || null;
    const model = item.model || extractModel(item.name) || null;

    return {
      id: `eci-${item.id}`,
      store: "ECI Jewelers",
      name: item.name,
      brand,
      model,
      ref: item.referenceNumber || null,
      productCode: item.productCode || null,
      price: parsePrice(item.price),
      inStock: item.inStock === true || item.stockStatus === "In Stock",
      stockStatus: item.stockStatus || null,
      dialColor: item.dial || null,
      caseMaterial: item.caseMat || null,
      bracelet: item.bracelet || null,
      year: item.year || null,
      box: item.box || null,
      papers: item.papers || null,
      url: item.url || null,
      imageUrl: item.image || null,
    };
  });

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(inventory, null, 2), "utf8");

  const inStockCount = inventory.filter((i) => i.inStock).length;
  console.log(`Done. ${inventory.length} ECI inventory items loaded (${inStockCount} in stock) — written to data/eci-inventory-latest.json`);
}

run().catch((err) => {
  console.error("ECI inventory load failed:", err.message);
  process.exit(1);
});
