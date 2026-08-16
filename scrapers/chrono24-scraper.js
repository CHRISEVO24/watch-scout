const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const cheerio = require("cheerio");

const DATA_DIR = path.join(__dirname, "..", "data");
const LATEST_FILE = path.join(DATA_DIR, "chrono24-latest.json");
const HISTORY_FILE = path.join(DATA_DIR, "chrono24-history.json");

const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, val] = arg.replace(/^--/, "").split("=");
  acc[key] = val === undefined ? true : val;
  return acc;
}, {});

const QUERY = args.query || "rolex submariner";
const US_ONLY = args.usOnly !== "false";
const URL = `https://www.chrono24.com/search/index.htm?dosearch=true&query=${encodeURIComponent(QUERY)}`;

const BRAND_KEYWORDS = [
  "rolex", "patek philippe", "audemars piguet", "richard mille", "omega",
  "tudor", "cartier", "panerai", "iwc", "breitling", "jaeger-lecoultre",
  "vacheron constantin", "grand seiko", "seiko", "tag heuer", "longines",
  "hamilton", "oris", "tissot", "zenith", "breguet",
];
const MODEL_KEYWORDS = [
  "GMT-Master II", "GMT-Master", "Sky-Dweller", "Sea-Dweller", "Day-Date",
  "Yacht-Master II", "Yacht-Master", "Air-King", "Submariner Date",
  "Submariner", "Daytona", "Datejust", "Explorer II", "Explorer",
  "Milgauss", "Cellini",
  "Royal Oak Offshore", "Royal Oak", "Code 11.59",
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
const COLOR_KEYWORDS = [
  "mother of pearl", "two-tone", "meteorite", "tropical", "champagne",
  "salmon", "burgundy", "charcoal", "turquoise", "ivory", "cream",
  "navy", "slate", "olive", "gilt", "black", "white", "blue", "green",
  "silver", "grey", "gray", "brown", "pink", "purple", "yellow", "orange",
  "red",
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
function extractColor(text) {
  if (!text) return null;
  const hit = COLOR_KEYWORDS.find((c) => new RegExp(`\\b${c}\\b`, "i").test(text));
  return hit ? hit.replace(/\b\w/g, (ch) => ch.toUpperCase()) : null;
}
function extractRef(text) {
  if (!text) return null;
  const m =
    text.match(/\bRef\.?\s*([A-Z0-9.\-\/]{4,14})\b/i) ||
    text.match(/\b(\d{4,6}[A-Z]{0,3}(?:\/\d+)?)\b/);
  return m ? m[1] : null;
}
function parsePrice(text) {
  if (!text) return null;
  const m = text.replace(/,/g, "").match(/\$?(\d+)/);
  return m ? Number(m[1]) : null;
}

async function run() {
  console.log(`Launching headless browser for: ${URL}`);
  const browser = await chromium.launch();
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  });

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  const html = await page.content();

  if (args.inspect) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, "chrono24-search-rendered.html"), html, "utf8");
    await page.screenshot({ path: path.join(DATA_DIR, "chrono24-search-screenshot.png"), fullPage: true });
    console.log("Saved data/chrono24-search-rendered.html and data/chrono24-search-screenshot.png");
  }

  await browser.close();

  const $ = cheerio.load(html);
  const listings = [];

  $("a.wt-listing-item-link").each((_, el) => {
    const $card = $(el);
    const href = $card.attr("href") || "";
    const idMatch = href.match(/--id(\d+)\.htm/);
    if (!idMatch) return;
    const id = idMatch[1];

    // Chrono24 serves images through an authenticated AWS API Gateway
    // (returns MissingAuthenticationTokenException on direct requests) -
    // the URL pattern alone isn't enough, a signed token is required that
    // their frontend JS generates dynamically. Disabled until/unless a
    // legitimate way to get that token is found.
    const imageUrl = null;

    const paragraphs = $card.find("p");
    const title = paragraphs.eq(0).text().trim() || null;
    const subtitle = paragraphs.eq(1).text().trim() || null;

    const price = parsePrice($card.find(".wt-listing-item-price").first().text());

    const $location = $card.find(".wt-listing-item-location").first();
    const locationCode = $location.find("span").first().text().trim().toUpperCase() || null;
    const locationName = $location.attr("data-title") || null;

    const sellerBadge = $card.find(".wt-listing-item-seller-badge").first().text().trim() || null;
    const certified = $card.find(".wt-listing-item-certified").length > 0;

    const fullTitle = `${title || ""} ${subtitle || ""}`.trim();
    const ref = extractRef(fullTitle);

    listings.push({
      id: `c24-${id}`,
      source: "Chrono24",
      sourceDetail: sellerBadge || "Dealer",
      imageUrl,
      brand: extractBrand(fullTitle),
      model: extractModel(fullTitle),
      ref,
      title: fullTitle,
      subtitle,
      dialColor: extractColor(fullTitle),
      price,
      seller: null,
      condition: certified ? "Certified available" : null,
      postedMinutesAgo: null,
      isNew: null,
      locationCode,
      locationName,
      url: `https://www.chrono24.com${href}`,
      scrapedAt: new Date().toISOString(),
    });
  });

  const filtered = US_ONLY ? listings.filter((l) => l.locationCode === "US") : listings;

  console.log(`Found ${listings.length} total listings, ${filtered.length} after US-only filter (usOnly=${US_ONLY}).`);

  let existing = [];
  if (args.reset) {
    console.log("--reset flag set: discarding previously saved Chrono24 data.");
  } else if (fs.existsSync(LATEST_FILE)) {
    try {
      existing = JSON.parse(fs.readFileSync(LATEST_FILE, "utf8"));
    } catch {
      existing = [];
    }
  }
  const merged = new Map(existing.map((item) => [item.id, item]));
  for (const item of filtered) {
    merged.set(item.id, item);
  }
  const deduped = Array.from(merged.values());

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LATEST_FILE, JSON.stringify(deduped, null, 2), "utf8");

  let history = [];
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    } catch {
      history = [];
    }
  }
  history.push({ scrapedAt: new Date().toISOString(), query: QUERY, count: filtered.length });
  if (history.length > 20) history = history.slice(-20);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf8");

  console.log(`Done. ${filtered.length} listings from this query, ${deduped.length} total across all saved runs — written to data/chrono24-latest.json`);
}

run().catch((err) => {
  console.error("Chrono24 scrape failed:", err.message);
  process.exit(1);
});
