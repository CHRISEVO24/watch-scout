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
  const watchesoff5th = loadSafe("watchesoff5th-latest.json");
  const affordableswiss = loadSafe("affordableswiss-latest.json");
  const exquisitetimepieces = loadSafe("exquisitetimepieces-latest.json");
  const ashford = loadSafe("ashford-latest.json");
  const luxurybazaar = loadSafe("luxurybazaar-latest.json");
  const watchaffinity = loadSafe("watchaffinity-latest.json");
  const iplaywatch = loadSafe("iplaywatch-latest.json");
  const aiswatches = loadSafe("aiswatches-latest.json");
  const elementintime = loadSafe("elementintime-latest.json");
  const wristaficionado = loadSafe("wristaficionado-latest.json");
  const collectors1946 = loadSafe("collectors1946-latest.json");
  const grandcaliber = loadSafe("grandcaliber-latest.json");
  const crmjewelers = loadSafe("crmjewelers-latest.json");
  const providentjewelry = loadSafe("providentjewelry-latest.json");
  const topperjewelers = loadSafe("topperjewelers-latest.json");
  const materialgood = loadSafe("materialgood-latest.json");
  const hqmilton = loadSafe("hqmilton-latest.json");
  const analogshift = loadSafe("analogshift-latest.json");
  const timepiecetrading = loadSafe("timepiecetrading-latest.json");
  const grayandsons = loadSafe("grayandsons-latest.json");
  const mttimepieces = loadSafe("mttimepieces-latest.json");
  const nywatchmarket = loadSafe("nywatchmarket-latest.json");
  const watchdrop = loadSafe("watchdrop-latest.json");
  const watchesinl = loadSafe("watchesinl-latest.json");

  const combined = [...watchrecon, ...watchpatrol, ...chrono24, ...bobswatches, ...europeanwatch, ...fbgroups, ...fbmarketplace, ...ebay, ...whatsapp, ...bezel, ...inventoryconnect, ...artimeus, ...swisswatchexpo, ...watchlimit, ...the1916company, ...watchesoff5th, ...affordableswiss, ...exquisitetimepieces, ...ashford, ...luxurybazaar, ...watchaffinity, ...iplaywatch, ...aiswatches, ...elementintime, ...wristaficionado, ...collectors1946, ...grandcaliber, ...crmjewelers, ...providentjewelry, ...topperjewelers, ...materialgood, ...hqmilton, ...analogshift, ...timepiecetrading, ...grayandsons, ...mttimepieces, ...nywatchmarket, ...watchdrop, ...watchesinl].sort(
    (a, b) => (a.postedMinutesAgo ?? 99999) - (b.postedMinutesAgo ?? 99999)
  );

  fs.writeFileSync(OUT_FILE, JSON.stringify(combined, null, 2), "utf8");
  console.log(
    `Merged ${watchrecon.length} WatchRecon + ${watchpatrol.length} WatchPatrol + ${chrono24.length} Chrono24 + ${bobswatches.length} Bob's Watches + ${europeanwatch.length} European Watch + ${fbgroups.length} FB Group + ${fbmarketplace.length} FB Marketplace + ${ebay.length} eBay + ${whatsapp.length} WhatsApp + ${bezel.length} Bezel + ${inventoryconnect.length} InventoryConnect + ${artimeus.length} Artimeus + ${swisswatchexpo.length} SwissWatchExpo + ${watchlimit.length} WatchLimit + ${the1916company.length} The1916Company + ${watchesoff5th.length} WatchesOFF5TH + ${affordableswiss.length} AffordableSwiss + ${exquisitetimepieces.length} ExquisiteTimepieces + ${ashford.length} Ashford + ${luxurybazaar.length} LuxuryBazaar + ${watchaffinity.length} WatchAffinity + ${iplaywatch.length} iPlayWatch + ${aiswatches.length} AISWatches + ${elementintime.length} ElementiNTime + ${wristaficionado.length} WristAficionado + ${collectors1946.length} Collectors1946 + ${grandcaliber.length} GrandCaliber + ${crmjewelers.length} CRMJewelers + ${providentjewelry.length} ProvidentJewelry + ${topperjewelers.length} TopperJewelers + ${materialgood.length} MaterialGood + ${hqmilton.length} HQMilton listings → data/combined.json (${combined.length} total)`
  );
}

run();
