const fs = require("fs");
const path = require("path");
const https = require("https");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "watchaffinity-latest.json");

const LATEST_URL = "https://raw.githubusercontent.com/chrisevo24/watch-affinity-tracker/main/latest.json";

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve(JSON.parse(data)));
    }).on("error", reject);
  });
}

async function scrape() {
  console.log("[WatchAffinity] Fetching latest inventory...");
  const raw = await fetchJson(LATEST_URL);

  // Get most recent snapshot
  const snapshots = Object.keys(raw).sort();
  const latest = raw[snapshots[snapshots.length - 1]];

  const items = Object.values(latest)
    .filter(i => i.inStock && i.stockStatus === "In Stock")
    .map(i => ({
      id: `wa-${i.id}`,
      source: "Watch Affinity",
      sourceDetail: "watchaffinity.com",
      brand: i.brand || null,
      model: null,
      ref: i.referenceNumber || null,
      title: i.name || null,
      price: i.price ? parseFloat(i.price.replace(/[^0-9.]/g, "")) : null,
      url: i.url || null,
      imageUrl: i.image || null,
      condition: i.condition || null,
      dialColor: i.dialColor || null,
      caseMaterial: i.caseMaterial || null,
      boxPapers: i.box === "Yes" && i.papers === "Yes" ? "Box & Papers" : i.box === "Yes" ? "Box Only" : i.papers === "Yes" ? "Papers Only" : "None",
      stockStatus: i.stockStatus,
      postedMinutesAgo: null,
      scrapedAt: new Date().toISOString(),
    }));

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(items, null, 2));
  console.log(`[WatchAffinity] Done. ${items.length} in-stock items written.`);
  return items;
}

if (require.main === module) scrape().catch(console.error);
module.exports = { scrape };
