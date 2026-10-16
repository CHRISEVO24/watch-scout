const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "combined.json");

// Sources in order — same as before
const SOURCES = [
  { file: "watchrecon-latest.json",       label: "WatchRecon" },
  { file: "watchpatrol-latest.json",      label: "WatchPatrol" },
  { file: "chrono24-latest.json",         label: "Chrono24" },
  { file: "bobswatches-latest.json",      label: "Bob's Watches" },
  { file: "europeanwatch-latest.json",    label: "European Watch" },
  { file: "fbgroups-latest.json",         label: "FB Group" },
  { file: "fbmarketplace-latest.json",    label: "FB Marketplace" },
  { file: "ebay-latest.json",             label: "eBay" },
  { file: "whatsapp-latest.json",         label: "WhatsApp" },
  { file: "bezel-latest.json",            label: "Bezel" },
  { file: "inventoryconnect-latest.json", label: "InventoryConnect" },
  { file: "artimeus-latest.json",         label: "Artimeus" },
  { file: "swisswatchexpo-latest.json",   label: "SwissWatchExpo" },
  { file: "watchlimit-latest.json",       label: "WatchLimit" },
  { file: "the1916company-latest.json",   label: "The1916Company" },
  { file: "watchesoff5th-latest.json",    label: "WatchesOFF5TH" },
  { file: "affordableswiss-latest.json",  label: "AffordableSwiss" },
  { file: "exquisitetimepieces-latest.json", label: "ExquisiteTimepieces" },
  { file: "ashford-latest.json",          label: "Ashford" },
  { file: "luxurybazaar-latest.json",     label: "LuxuryBazaar" },
  { file: "watchaffinity-latest.json",    label: "WatchAffinity" },
  { file: "iplaywatch-latest.json",       label: "iPlayWatch" },
  { file: "aiswatches-latest.json",       label: "AISWatches" },
  { file: "elementintime-latest.json",    label: "ElementiNTime" },
  { file: "wristaficionado-latest.json",  label: "WristAficionado" },
  { file: "collectors1946-latest.json",   label: "Collectors1946" },
  { file: "grandcaliber-latest.json",     label: "GrandCaliber" },
  { file: "crmjewelers-latest.json",      label: "CRMJewelers" },
  { file: "providentjewelry-latest.json", label: "ProvidentJewelry" },
  { file: "topperjewelers-latest.json",   label: "TopperJewelers" },
  { file: "materialgood-latest.json",     label: "MaterialGood" },
  { file: "hqmilton-latest.json",         label: "HQMilton" },
  { file: "analogshift-latest.json",      label: "Analog Shift" },
  { file: "timepiecetrading-latest.json", label: "Timepiece Trading" },
  { file: "grayandsons-latest.json",      label: "Gray & Sons" },
  { file: "mttimepieces-latest.json",     label: "MT Timepieces" },
  { file: "nywatchmarket-latest.json",    label: "NY Watch Market" },
  { file: "watchdrop-latest.json",        label: "WatchDrop" },
  { file: "watchesinl-latest.json",       label: "Watches Intl" },
  { file: "brandvillevault-latest.json",  label: "Brandville Vault" },
  { file: "watchpilot-latest.json",       label: "Watch Pilot" },
  { file: "luxurytime-latest.json",       label: "Luxury Time" },
  { file: "yurwatches-latest.json",       label: "YurWatches" },
  { file: "vanceluxury-latest.json",      label: "Vance Luxury" },
  { file: "feldmar-latest.json",          label: "Feldmar" },
  { file: "wywatl-latest.json",           label: "WYW ATL" },
  { file: "essentialwatches-latest.json", label: "Essential Watches" },
  { file: "1mtwatches-latest.json",       label: "1MT Watches" },
  { file: "blw-latest.json",              label: "Birmingham Luxury Watches" },
];

function run() {
  const counts = {};

  const combined = [];
  for (const { file, label } of SOURCES) {
    const p = path.join(DATA_DIR, file);
    if (!fs.existsSync(p)) { counts[label] = 0; continue; }
    let items;
    try { items = JSON.parse(fs.readFileSync(p, "utf8")); } catch { items = []; }
    counts[label] = items.length;
    for (const item of items) combined.push(item);
    items.length = 0; // free the source array immediately
  }

  // Sort in place — same order as before
  combined.sort((a, b) => (a.postedMinutesAgo ?? 99999) - (b.postedMinutesAgo ?? 99999));

  // Stream-write to avoid JSON.stringify holding a second copy of the full array
  const out = fs.createWriteStream(OUT_FILE, { encoding: "utf8" });
  out.write("[\n");
  for (let i = 0; i < combined.length; i++) {
    out.write("  " + JSON.stringify(combined[i]) + (i < combined.length - 1 ? ",\n" : "\n"));
  }
  out.write("]\n");
  out.end();

  const total = combined.length;
  const parts = SOURCES.map(({ label }) => `${counts[label] ?? 0} ${label}`).join(" + ");
  console.log(`Merged ${parts} → data/combined.json (${total} total)`);
}

run();
