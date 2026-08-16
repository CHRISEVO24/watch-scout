/**
 * Save FB Group results — Watch Scout
 * ---------------------------------------
 * Unlike the other scrapers, Facebook Group results can't be pulled by an
 * unattended script — they come from a LIVE session where Claude browses
 * your logged-in Facebook with you present (Claude in Chrome), since
 * that's the only compliant way to read your private groups.
 *
 * This script just takes whatever results came out of that session (paste
 * them below, or point to a file) and merges them into fbgroups-latest.json
 * the same way every other scraper merges — so they show up in the
 * dashboard identically once you run merge.js + build-dashboard.js after.
 *
 * Usage:
 *   Edit NEW_RESULTS below with what Claude found, or:
 *   node save-fb-group-results.js path/to/results.json
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const LATEST_FILE = path.join(DATA_DIR, "fbgroups-latest.json");

const inputPath = process.argv[2];
let NEW_RESULTS = [];

if (inputPath) {
  NEW_RESULTS = JSON.parse(fs.readFileSync(inputPath, "utf8"));
} else {
  console.error("Usage: node save-fb-group-results.js path/to/results.json");
  process.exit(1);
}

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

console.log(`Added ${NEW_RESULTS.length} results, ${deduped.length} total FB Group listings saved.`);
