const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const LATEST_FILE = path.join(DATA_DIR, "whatsapp-latest.json");

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node save-whatsapp-results.js path/to/results.json");
  process.exit(1);
}

const NEW_RESULTS = JSON.parse(fs.readFileSync(inputPath, "utf8"));

let existing = [];
if (fs.existsSync(LATEST_FILE)) {
  try {
    existing = JSON.parse(fs.readFileSync(LATEST_FILE, "utf8"));
  } catch {
    existing = [];
  }
}

const merged = new Map(existing.map((item) => [item.id, item]));
for (const item of NEW_RESULTS) {
  item.scrapedAt = new Date().toISOString();
  merged.set(item.id, item);
}
const deduped = Array.from(merged.values());

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.writeFileSync(LATEST_FILE, JSON.stringify(deduped, null, 2), "utf8");

console.log(`Added ${NEW_RESULTS.length} results, ${deduped.length} total WhatsApp listings saved.`);
