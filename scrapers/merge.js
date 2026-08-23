const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "combined.json");

function loadSafe(file) {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function run() {
  const watchrecon = loadSafe("watchrecon-latest.json");
  const watchpatrol = loadSafe("watchpatrol-latest.json");
  const chrono24 = loadSafe("chrono24-latest.json");
  const bobswatches = loadSafe("bobswatches-latest.json");
  const europeanwatch = loadSafe("europeanwatch-latest.json");
  const fbgroups = loadSafe("fbgroups-latest.json");
  const fbmarketplace = loadSafe("fbmarketplace-latest.json");
  const ebay = loadSafe("ebay-latest.json");
  const whatsapp = loadSafe("whatsapp-latest.json");
  const bezel = loadSafe("bezel-latest.json");
  const inventoryconnect = loadSafe("inventoryconnect-latest.json");
  const artimeus = loadSafe("artimeus-latest.json");
  const swisswatchexpo = loadSafe("swisswatchexpo-latest.json");
  const watchlimit = loadSafe("watchlimit-latest.json");
  const the1916company = loadSafe("the1916company-latest.json");

  const combined = [...watchrecon, ...watchpatrol, ...chrono24, ...bobswatches, ...europeanwatch, ...fbgroups, ...fbmarketplace, ...ebay, ...whatsapp, ...bezel, ...inventoryconnect, ...artimeus, ...swisswatchexpo, ...watchlimit, ...the1916company].sort(
    (a, b) => (a.postedMinutesAgo ?? 99999) - (b.postedMinutesAgo ?? 99999)
  );

  fs.writeFileSync(OUT_FILE, JSON.stringify(combined, null, 2), "utf8");
  console.log(
    `Merged ${watchrecon.length} WatchRecon + ${watchpatrol.length} WatchPatrol + ${chrono24.length} Chrono24 + ${bobswatches.length} Bob's Watches + ${europeanwatch.length} European Watch + ${fbgroups.length} FB Group + ${fbmarketplace.length} FB Marketplace + ${ebay.length} eBay + ${whatsapp.length} WhatsApp + ${bezel.length} Bezel + ${inventoryconnect.length} InventoryConnect + ${artimeus.length} Artimeus + ${swisswatchexpo.length} SwissWatchExpo + ${watchlimit.length} WatchLimit + ${the1916company.length} The1916Company listings → data/combined.json (${combined.length} total)`
  );
}

run();
