const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const DASHBOARD_FILE = path.join(ROOT, "watch-scout-dashboard.html");

function loadSafe(file) {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function replaceBetweenMarkers(html, startMarker, endMarker, varName, value) {
  const pattern = new RegExp(`(// ${startMarker}\\n)[\\s\\S]*?(\\n// ${endMarker})`);
  if (!pattern.test(html)) {
    console.error(`Could not find ${startMarker}/${endMarker} markers in watch-scout-dashboard.html.`);
    process.exit(1);
  }
  const safeJson = JSON.stringify(value, null, 2)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const varJs = `const ${varName} = ${safeJson};`;
  return html.replace(pattern, (match, p1, p2) => p1 + varJs + p2);
}

function run() {
  let listings = loadSafe("combined.json");

  if (listings.length === 0) {
    listings = [
      ...loadSafe("watchrecon-latest.json"),
      ...loadSafe("watchpatrol-latest.json"),
      ...loadSafe("chrono24-latest.json"),
      ...loadSafe("bobswatches-latest.json"),
      ...loadSafe("europeanwatch-latest.json"),
      ...loadSafe("fbgroups-latest.json"),
      ...loadSafe("fbmarketplace-latest.json"),
      ...loadSafe("ebay-latest.json"),
      ...loadSafe("whatsapp-latest.json"),
      ...loadSafe("bezel-latest.json"),
    ];
  }

  if (listings.length === 0) {
    console.error(
      "No data found in the data/ folder. Run a scraper first, e.g.:\n  node scrapers/watchrecon-scraper.js --brand=rolex --days=7"
    );
    process.exit(1);
  }

  const buyerMatches = loadSafe("buyer-matches.json");

  let html = fs.readFileSync(DASHBOARD_FILE, "utf8");
  html = replaceBetweenMarkers(html, "LISTINGS_START", "LISTINGS_END", "LISTINGS", listings);
  html = replaceBetweenMarkers(html, "BUYER_MATCHES_START", "BUYER_MATCHES_END", "BUYER_MATCHES", buyerMatches);

  fs.writeFileSync(DASHBOARD_FILE, html, "utf8");
  console.log(`Done. Wrote ${listings.length} listings and ${buyerMatches.length} buyer matches into watch-scout-dashboard.html`);
}

run();
