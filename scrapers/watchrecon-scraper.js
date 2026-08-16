const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const HISTORY_FILE = path.join(DATA_DIR, "watchrecon-history.json");
const LATEST_FILE = path.join(DATA_DIR, "watchrecon-latest.json");

const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, val] = arg.replace(/^--/, "").split("=");
  acc[key] = val === undefined ? true : val;
  return acc;
}, {});

const BRAND = args.brand || null;
const LAST_DAYS = args.days || 14;
const MAX_PAGES = Number(args.pages || 3);

function buildUrl(page) {
  const params = new URLSearchParams();
  if (BRAND) params.set("brand", BRAND);
  if (LAST_DAYS) params.set("last_days", LAST_DAYS);
  if (page > 1) params.set("current_page", page);
  const qs = params.toString();
  return `https://www.watchrecon.com/${qs ? "?" + qs : ""}`;
}

function parseMinutesAgo(text) {
  const m = text.match(/(\d+)\s*min/);
  if (m) return Number(m[1]);
  const h = text.match(/(\d+)\s*hour/);
  if (h) return Number(h[1]) * 60;
  const d = text.match(/(\d+)\s*day/);
  if (d) return Number(d[1]) * 1440;
  return null;
}

function parsePrice(text) {
  if (!text) return null;
  const m = text.replace(/,/g, "").match(/\$(\d+)/);
  return m ? Number(m[1]) : null;
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

async function scrapePage(page) {
  const url = buildUrl(page);
  const { data: html } = await axios.get(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
    timeout: 15000,
  });

  if (args.inspect) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, "watchrecon-raw.html"), html, "utf8");
    console.log(`Saved raw HTML to data/watchrecon-raw.html for selector inspection.`);
  }

  const $ = cheerio.load(html);
  const listings = [];

  $(".galleryItemContainer").each((_, el) => {
    const $block = $(el);

    const cidHref = $block.find('a[href*="detail.php?"]').first().attr("href") || "";
    const cidMatch = cidHref.match(/cid=(\d+)/);
    if (!cidMatch) return;
    const cid = cidMatch[1];

    const title = $block.find(".subjectInfo a").attr("title")?.trim() || null;
    const sourceUrl = $block.find("a.listingLink").first().attr("href") || null;

    const imgSrc = $block.find("img.thumb").first().attr("src") || null;
    const imageUrl = imgSrc ? `https://www.watchrecon.com/${imgSrc}` : null;

    const price = parsePrice($block.find(".priceInfo").first().text());

    const brand = $block.find(".brandInfo a").first().text().trim() || null;
    const model = $block.find(".modelInfo a").first().text().trim() || null;

    const seller = $block.find(".userNameInfo a").first().text().trim() || null;

    const sourceText = $block.find(".sourceInfo").first().text().trim();
    const sourceDetail = sourceText.replace(/^on\s*/i, "").trim() || null;

    const postDateText = $block.find(".postDateInfo").first().text().trim();
    const postedMinutesAgo = parseMinutesAgo(postDateText);

    const tags = $block
      .find(".tagContainer .tag")
      .map((__, t) => $(t).text().trim())
      .get();
    const isNew = tags.some((t) => /new\s*listing/i.test(t));
    const condition = tags.filter((t) => !/new\s*listing/i.test(t)).join(", ") || null;

    listings.push({
      id: `wr-${cid}`,
      source: "WatchRecon",
      sourceDetail,
      imageUrl,
      brand,
      model,
      ref: null,
      title,
      dialColor: extractColor(title),
      price,
      seller,
      condition,
      postedMinutesAgo,
      isNew,
      url: `https://www.watchrecon.com/detail.php?cid=${cid}`,
      sourceUrl,
      scrapedAt: new Date().toISOString(),
    });
  });

  return listings;
}

async function run() {
  let all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    console.log(`Scraping page ${page}...`);
    try {
      const pageListings = await scrapePage(page);
      if (pageListings.length === 0) break;
      all = all.concat(pageListings);
      await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      console.error(`Failed on page ${page}:`, err.message);
      break;
    }
  }

  const seen = new Set();
  all = all.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  let existing = [];
  if (args.reset) {
    console.log("--reset flag set: discarding previously saved WatchRecon data.");
  } else if (fs.existsSync(LATEST_FILE)) {
    try {
      existing = JSON.parse(fs.readFileSync(LATEST_FILE, "utf8"));
    } catch {
      existing = [];
    }
  }
  const merged = new Map(existing.map((item) => [item.id, item]));
  for (const item of all) {
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
  history.push({ scrapedAt: new Date().toISOString(), brand: BRAND, count: all.length });
  if (history.length > 20) history = history.slice(-20);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf8");

  console.log(`Done. ${all.length} listings from this run, ${deduped.length} total across all saved runs — written to data/watchrecon-latest.json`);
}

run().catch((err) => {
  console.error("Scraper failed:", err);
  process.exit(1);
});
