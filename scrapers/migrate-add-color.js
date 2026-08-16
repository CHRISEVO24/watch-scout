const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

const COLOR_KEYWORDS = [
  "mother of pearl", "two-tone", "meteorite", "tropical", "champagne",
  "salmon", "burgundy", "charcoal", "turquoise", "ivory", "cream",
  "navy", "slate", "olive", "gilt", "black", "white", "blue", "green",
  "silver", "grey", "gray", "brown", "pink", "purple", "yellow", "orange",
  "red",
];

function extractColor(text) {
  if (!text) return null;
  const hit = COLOR_KEYWORDS.find((c) => new RegExp(`\\b${c}\\b`, "i").test(text));
  return hit ? hit.replace(/\b\w/g, (ch) => ch.toUpperCase()) : null;
}

function migrateFile(filename) {
  const p = path.join(DATA_DIR, filename);
  if (!fs.existsSync(p)) {
    console.log(`${filename} not found - skipping.`);
    return;
  }
  const listings = JSON.parse(fs.readFileSync(p, "utf8"));
  let updated = 0;
  for (const item of listings) {
    if (!item.dialColor) {
      item.dialColor = extractColor(item.title);
      if (item.dialColor) updated++;
    }
  }
  fs.writeFileSync(p, JSON.stringify(listings, null, 2), "utf8");
  console.log(`${filename}: ${updated} of ${listings.length} listings got a dial color assigned.`);
}

migrateFile("watchrecon-latest.json");
migrateFile("watchpatrol-latest.json");
migrateFile("fbgroups-latest.json");

console.log("Done. Run merge.js and build-dashboard.js next to push this into the dashboard.");
