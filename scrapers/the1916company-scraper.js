const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const LATEST_FILE = path.join(DATA_DIR, "the1916company-latest.json");
const HISTORY_FILE = path.join(DATA_DIR, "the1916company-history.json");

const args = process.argv.slice(2).reduce((acc, arg) => {
  const eqIndex = arg.indexOf("=");
  if (arg.startsWith("--") && eqIndex > -1) {
    acc[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
  } else if (arg.startsWith("--")) {
    acc[arg.slice(2)] = true;
  }
  return acc;
}, {});

const BRAND = args.brand || null;
const URL = BRAND
  ? `https://www.the1916company.com/pre-owned/?brand=${encodeURIComponent(BRAND)}`
  : "https://www.the1916company.com/pre-owned/";
const MAX_SCROLLS = Number(args.maxScrolls || 8);

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
  "Tank", "Santos", "Ballon Bleu", "Rotonde",
  "Luminor", "Radiomir", "Submersible", "Octo Finissimo", "Octo",
  "Grand Seiko", "Prospex", "Presage",
];
const COLOR_KEYWORDS = [
  "mother of pearl", "two-tone", "meteorite", "tropical", "champagne",
  "salmon", "burgundy", "charcoal", "turquoise", "ivory", "cream",
  "navy", "slate", "olive", "gilt", "black", "white", "blue", "green",
  "silver", "grey", "gray", "brown", "pink", "purple", "yellow", "orange",
  "red", "beige", "sundust", "chocolate",
];

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
function parsePrice(text) {
  if (!text) return null;
  const m = String(text).replace(/,/g, "").match(/\$(\d+)/);
  return m ? Number(m[1]) : null;
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  });

  console.log(`Launching headless browser for: ${URL}`);
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  try {
    const acceptButton = page.getByText("Accept Cookies", { exact: false }).first();
    if (await acceptButton.isVisible({ timeout: 3000 })) {
      await acceptButton.click();
      await page.waitForTimeout(1000);
      console.log("Dismissed cookie consent banner.");
    }
  } catch {
  }

  if (args.inspect) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, "the1916company-raw.html"), await page.content(), "utf8");
    console.log("Saved raw HTML to data/the1916company-raw.html");
  }

  let stableRounds = 0;
  let lastCount = 0;
  for (let i = 0; i < MAX_SCROLLS; i++) {
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(2500);

    const count = await page.evaluate(() => document.querySelectorAll("a.Tile_container__link").length);
    console.log(`Round ${i + 1}: ${count} tiles loaded so far`);
    if (count === lastCount) {
      stableRounds++;
      if (stableRounds >= 2) {
        console.log("No new tiles after two rounds — stopping scroll.");
        break;
      }
    } else {
      stableRounds = 0;
    }
    lastCount = count;
  }

  const rawProducts = await page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll("a.Tile_container__link"));
    return tiles.map((tile) => {
      const get = (sel) => {
        const el = tile.querySelector(sel);
        return el ? el.textContent.trim() : null;
      };
      const img = tile.querySelector("img");
      return {
        href: tile.getAttribute("href"),
        productId: tile.getAttribute("data-product-id"),
        brand: get(".Tile_container__brand"),
        name: get(".Tile_container__name"),
        ref: get(".Tile_container__ref-no"),
        currentPrice: get(".current-price"),
        listPrice: get(".list-price"),
        imageUrl: img ? img.src : null,
      };
    });
  });

  await browser.close();

  console.log(`Extracted ${rawProducts.length} raw product tiles.`);

  const listings = rawProducts
    .filter((p) => p.href && p.name)
    .map((p) => {
      const fullTitle = `${p.brand || ""} ${p.name || ""}`.trim();
      return {
        id: `1916-${p.productId || p.href}`,
        source: "The 1916 Company",
        sourceDetail: "Dealer — authenticated, owns inventory",
        brand: p.brand ? p.brand.replace(/\b\w/g, (c) => c.toUpperCase()) : null,
        model: extractModel(fullTitle),
        ref: p.ref || null,
        title: fullTitle,
        dialColor: extractColor(fullTitle),
        price: parsePrice(p.currentPrice),
        listPrice: parsePrice(p.listPrice),
        seller: null,
        condition: "Pre-owned, authenticated",
        postedMinutesAgo: null,
        isNew: null,
        imageUrl: p.imageUrl || null,
        url: p.href.startsWith("http") ? p.href : `https://www.the1916company.com${p.href}`,
        scrapedAt: new Date().toISOString(),
      };
    });

  let existing = [];
  if (args.reset) {
    console.log("--reset flag set: discarding previously saved data.");
  } else if (fs.existsSync(LATEST_FILE)) {
    try {
      existing = JSON.parse(fs.readFileSync(LATEST_FILE, "utf8"));
    } catch {
      existing = [];
    }
  }
  const merged = new Map(existing.map((item) => [item.id, item]));
  for (const item of listings) merged.set(item.id, item);
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
  history.push({ scrapedAt: new Date().toISOString(), brand: BRAND, count: listings.length });
  if (history.length > 20) history = history.slice(-20);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf8");

  console.log(`Done. ${listings.length} listings from this run, ${deduped.length} total across all saved runs — written to data/the1916company-latest.json`);
}

run().catch((err) => {
  console.error("The 1916 Company scraper failed:", err.message);
  process.exit(1);
});
