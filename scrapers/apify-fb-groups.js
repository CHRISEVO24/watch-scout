/**
 * Apify Facebook Groups Scraper — Watch Scout
 * ----------------------------------------------
 * Pulls posts from public Facebook groups (watch trading / market groups
 * you specify) using Apify's official `apify/facebook-groups-scraper` actor.
 *
 * IMPORTANT — scope of what this can do:
 *  - Only PUBLIC Facebook groups. Apify will not log in on your behalf to
 *    reach private/closed groups — that would violate Facebook's ToS.
 *  - There is currently no official Apify actor for Facebook MARKETPLACE
 *    listings. Community actors exist but maintenance varies and quality is
 *    inconsistent — start with Groups only, revisit Marketplace later if a
 *    well-maintained actor shows up.
 *  - WhatsApp is not scrapable via Apify at all. The only sanctioned path is
 *    the WhatsApp Business API (a separate, webhook-based integration
 *    requiring Meta Business approval) — not a scraping task.
 *
 * Setup:
 *   npm install apify-client
 *   Get your Apify API token: Apify Console → Settings → Integrations
 *   export APIFY_TOKEN=your_token_here
 *
 * Usage:
 *   node apify-fb-groups.js --groups="https://www.facebook.com/groups/123456789"
 *   node apify-fb-groups.js --groups="url1,url2,url3" --maxPosts=50
 */

const { ApifyClient } = require("apify-client");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const LATEST_FILE = path.join(DATA_DIR, "fbgroups-latest.json");
const HISTORY_FILE = path.join(DATA_DIR, "fbgroups-history.json");

const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, val] = arg.replace(/^--/, "").split("=");
  acc[key] = val === undefined ? true : val;
  return acc;
}, {});

const APIFY_TOKEN = process.env.APIFY_TOKEN;
if (!APIFY_TOKEN) {
  console.error("Set APIFY_TOKEN in your environment before running this script.");
  process.exit(1);
}

const GROUP_URLS = (args.groups || "")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);

if (GROUP_URLS.length === 0) {
  console.error(
    "Pass at least one public group URL: --groups=\"https://www.facebook.com/groups/your-group-id\""
  );
  process.exit(1);
}

const MAX_POSTS = Number(args.maxPosts || 40);

// Simple keyword set to flag posts that look like watch sale/want-to-buy
// activity, since the raw actor returns all group posts, not just listings.
const LISTING_SIGNALS = /\b(WTS|WTB|ISO|FS|trade|trading|asking|\$\d)/i;
const BRAND_KEYWORDS = [
  "rolex", "patek", "audemars", "richard mille", "omega", "tudor",
  "cartier", "panerai", "iwc", "breitling", "jaeger", "vacheron",
];

function extractBrand(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const hit = BRAND_KEYWORDS.find((b) => lower.includes(b));
  return hit ? hit.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
}

function extractPrice(text) {
  if (!text) return null;
  const m = text.replace(/,/g, "").match(/\$(\d{2,7})/);
  return m ? Number(m[1]) : null;
}

async function run() {
  const client = new ApifyClient({ token: APIFY_TOKEN });

  console.log(`Running apify/facebook-groups-scraper on ${GROUP_URLS.length} group(s)...`);

  const run = await client.actor("apify/facebook-groups-scraper").call({
    startUrls: GROUP_URLS.map((url) => ({ url })),
    resultsLimit: MAX_POSTS,
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  const listings = items
    .filter((post) => LISTING_SIGNALS.test(post.text || ""))
    .map((post) => ({
      id: `fbg-${post.postId || post.id || Math.random().toString(36).slice(2)}`,
      source: "FB Group",
      sourceDetail: post.groupTitle || post.groupUrl || "Facebook group",
      brand: extractBrand(post.text),
      model: null,
      ref: null,
      title: (post.text || "").slice(0, 140),
      price: extractPrice(post.text),
      seller: post.user?.name || post.authorName || null,
      condition: null,
      postedMinutesAgo: post.timestamp
        ? Math.round((Date.now() - new Date(post.timestamp).getTime()) / 60000)
        : null,
      isNew: true,
      url: post.url || post.postUrl || null,
      scrapedAt: new Date().toISOString(),
    }));

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LATEST_FILE, JSON.stringify(listings, null, 2), "utf8");

  let history = [];
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    } catch {
      history = [];
    }
  }
  history.push({ scrapedAt: new Date().toISOString(), count: listings.length });
  if (history.length > 20) history = history.slice(-20);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf8");

  console.log(
    `Done. ${listings.length} of ${items.length} posts matched listing signals. Written to data/fbgroups-latest.json`
  );
}

run().catch((err) => {
  console.error("Apify run failed:", err.message);
  process.exit(1);
});
