const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const cheerio = require("cheerio");

const DATA_DIR = path.join(__dirname, "..", "data");
const LATEST_FILE = path.join(DATA_DIR, "watchpatrol-latest.json");
const HISTORY_FILE = path.join(DATA_DIR, "watchpatrol-history.json");

const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, val] = arg.replace(/^--/, "").split("=");
  acc[key] = val === undefined ? true : val;
  return acc;
}, {});

const QUERY = args.query || "rolex";
const URL = `https://www.watchpatrol.net/?query=${encodeURIComponent(QUERY)}`;
const MAX_SCROLLS = Number(args.maxScrolls || 12);

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

function extractModel(text) {
  if (!text) return null;
  const hit = MODEL_KEYWORDS.find((m) => new RegExp(`\\b${m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
  return hit || null;
}

function parsePrice(text) {
  if (!text) return null;
  const m = text.replace(/,/g, "").match(/\$(\d+)/);
  return m ? Number(m[1]) : null;
}

function extractBrand(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const hit = BRAND_KEYWORDS.find((b) => lower.includes(b));
  return hit ? hit.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
}

function extractRef(text) {
  if (!text) return null;
  const m =
    text.match(/\bRef\.?\s*([A-Z0-9.\-]{4,12})\b/i) ||
    text.match(/\b(\d{5,6}[A-Z]{0,3})\b/);
  return m ? m[1] : null;
}

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

async function run() {
  console.log(`Launching headless browser for: ${URL}`);
  const browser = await chromium.launch();
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  });

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000);

  const listingsById = new Map();

  function extractFromHtml(html) {
    const $ = cheerio.load(html);
    $('.panel[id^="listing-"]').each((_, el) => {
      const $panel = $(el);
      const id = ($panel.attr("id") || "").replace("listing-", "");
      if (!id || listingsById.has(`wp-${id}`)) return;

      const $titleLink = $panel.find(".post-title a").first();
      const title = $titleLink.text().trim() || null;
      const relUrl = $titleLink.attr("href") || null;
      const url = relUrl ? `https://www.watchpatrol.net${relUrl}` : null;

      const seller = $panel.find(".panel-username").first().text().trim() || null;

      const datetimeAttr = $panel.find("time.panel-date").first().attr("datetime");
      const postedMinutesAgo = datetimeAttr
        ? Math.round((Date.now() - new Date(datetimeAttr).getTime()) / 60000)
        : null;

      const imageUrl = $panel.find("img.panel-thumbnail").first().attr("src") || null;

      const priceText = $panel.find(".price-row .price").first().text();
      const price = parsePrice(priceText);

      const sourceDetail = $panel.find("img.source-icon").first().attr("alt") || null;
      const isNew = $panel.find(".tag-new").length > 0;

      listingsById.set(`wp-${id}`, {
        id: `wp-${id}`,
        source: "WatchPatrol",
        sourceDetail,
        imageUrl,
        brand: extractBrand(title),
        model: extractModel(title),
        ref: extractRef(title),
        title,
        dialColor: extractColor(title),
        price,
        seller,
        condition: null,
        postedMinutesAgo,
        isNew,
        url,
        scrapedAt: new Date().toISOString(),
      });
    });
  }

  extractFromHtml(await page.content());

  async function scrollAnyScrollableContainer() {
    await page.evaluate(() => {
      const all = document.querySelectorAll("div, main, section");
      for (const el of all) {
        if (el.scrollHeight > el.clientHeight + 80) {
          el.scrollTop = el.scrollHeight;
        }
      }
      window.scrollTo(0, document.body.scrollHeight);
    });
  }

  let stableRounds = 0;
  for (let i = 0; i < MAX_SCROLLS; i++) {
    await scrollAnyScrollableContainer();
    await page.waitForTimeout(2000);

    const loadMoreButton = page.getByText("Load More", { exact: false }).first();
    const buttonVisible = await loadMoreButton.isVisible().catch(() => false);
    if (buttonVisible) {
      try {
        await loadMoreButton.click({ timeout: 3000 });
        await page.waitForTimeout(1500);
      } catch {
      }
    }

    const beforeSize = listingsById.size;
    extractFromHtml(await page.content());
    const afterSize = listingsById.size;
    console.log(`Round ${i + 1}: ${afterSize} unique listings captured so far`);

    if (afterSize === beforeSize) {
      stableRounds++;
      if (stableRounds >= 2) {
        console.log("No new listings after two rounds — reached the end of available results.");
        break;
      }
    } else {
      stableRounds = 0;
    }
  }

  if (args.inspect) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, "watchpatrol-rendered.html"), await page.content(), "utf8");
    await page.screenshot({ path: path.join(DATA_DIR, "watchpatrol-screenshot.png"), fullPage: true });
    console.log("Saved data/watchpatrol-rendered.html and data/watchpatrol-screenshot.png");
  }

  await browser.close();

  let existing = [];
  if (args.reset) {
    console.log("--reset flag set: discarding previously saved WatchPatrol data.");
  } else if (fs.existsSync(LATEST_FILE)) {
    try {
      existing = JSON.parse(fs.readFileSync(LATEST_FILE, "utf8"));
    } catch {
      existing = [];
    }
  }
  const merged = new Map(existing.map((item) => [item.id, item]));
  for (const item of listingsById.values()) {
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
  history.push({ scrapedAt: new Date().toISOString(), query: QUERY, count: listingsById.size });
  if (history.length > 20) history = history.slice(-20);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf8");

  console.log(`Done. ${listingsById.size} listings from this query, ${deduped.length} total across all saved runs — written to data/watchpatrol-latest.json`);
}

run().catch((err) => {
  console.error("WatchPatrol scrape failed:", err.message);
  process.exit(1);
});
