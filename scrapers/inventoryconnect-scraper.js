const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const LATEST_FILE = path.join(DATA_DIR, "inventoryconnect-latest.json");
const COOKIES_FILE = path.join(DATA_DIR, "inventoryconnect-cookies.json");

const args = process.argv.slice(2).reduce((acc, arg) => {
  const eqIndex = arg.indexOf("=");
  if (arg.startsWith("--") && eqIndex > -1) {
    acc[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
  } else if (arg.startsWith("--")) {
    acc[arg.slice(2)] = true;
  }
  return acc;
}, {});

const MAX_PAGES = Number(args.maxPages || 9);

function convertCookiesForPlaywright(rawCookies) {
  const sameSiteMap = { lax: "Lax", strict: "Strict", no_restriction: "None" };
  return rawCookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || "/",
    expires: c.session ? -1 : Math.floor(c.expirationDate),
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    sameSite: sameSiteMap[c.sameSite] || "Lax",
  }));
}

function parsePrice(text) {
  if (!text) return null;
  const isUSD = /^\$/.test(text.trim());
  const m = String(text).replace(/,/g, "").match(/[\d.]+/);
  const amount = m ? Math.round(parseFloat(m[0])) : null;
  return { amount, isUSD };
}

async function run() {
  if (!fs.existsSync(COOKIES_FILE)) {
    console.error(`No cookie file found at ${COOKIES_FILE}. Export cookies via Cookie-Editor first.`);
    process.exit(1);
  }
  const rawCookies = JSON.parse(fs.readFileSync(COOKIES_FILE, "utf8"));
  const cookies = convertCookiesForPlaywright(rawCookies);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  });
  await context.addCookies(cookies);
  const page = await context.newPage();

  console.log("Logging in via saved session and navigating to InventoryConnect Marketplace...");
  await page.goto("https://www.inventoryconnect.io/marketplace", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2500);

  const isLoggedIn = await page.evaluate(() => !document.body.innerText.includes("Sign in") && !document.body.innerText.includes("Log in"));
  if (!isLoggedIn) {
    console.error("Session appears expired (landed on login page). Re-export cookies via Cookie-Editor and try again.");
    await browser.close();
    process.exit(1);
  }
  console.log("Session valid, logged in successfully.");

  const allListings = [];
  let pageNum = 1;

  while (pageNum <= MAX_PAGES) {
    await page.waitForTimeout(1500);

    const pageData = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('a[href*="/marketplace/"]'));
      return cards.map((card) => {
        const spans = Array.from(card.querySelectorAll("*")).filter((el) => el.children.length === 0 && el.textContent.trim().length > 0);
        const t = spans.map((el) => el.textContent.trim());
        const href = card.getAttribute("href") || "";
        const img = card.querySelector("img");
        let imageUrl = img ? img.src : null;
        if (imageUrl && imageUrl.includes("/_next/image")) {
          const match = imageUrl.match(/url=([^&]+)/);
          if (match) {
            try {
              imageUrl = decodeURIComponent(match[1]);
            } catch {
            }
          }
        }
        return {
          id: href.split("/marketplace/")[1]?.split("?")[0] || "",
          dealer: t[0] || null,
          brand: t[1] || null,
          model: t[2] || null,
          detailLine: t[3] || null,
          priceText: t[t.length - 1] || null,
          href,
          imageUrl,
        };
      });
    });

    console.log(`Page ${pageNum}: ${pageData.length} cards found.`);
    allListings.push(...pageData);

    const nextButton = page.getByText("Next", { exact: false }).first();
    const hasNext = await nextButton.isVisible().catch(() => false);
    if (!hasNext) {
      console.log("No more pages.");
      break;
    }
    await nextButton.click();
    pageNum++;
  }

  console.log("Capturing Wanted (WTB) tab...");
  await page.goto("https://www.inventoryconnect.io/marketplace?view=wanted", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  const wantedText = await page.evaluate(() => document.body.innerText);
  const wantedBlocks = wantedText.split("WANTED").slice(1).map((b) => b.trim());
  console.log(`WTB tab: ${wantedBlocks.length} wanted post(s) found.`);

  await browser.close();

  console.log(`Extracted ${allListings.length} raw cards across ${pageNum} page(s).`);

  const listings = allListings
    .filter((p) => p.id && p.model)
    .map((p) => {
      const price = parsePrice(p.priceText);
      const refMatch = p.detailLine ? p.detailLine.match(/Ref\.\s*([^\s\u00b7]+)/) : null;
      return {
        id: `ic-${p.id}`,
        source: "InventoryConnect Marketplace",
        sourceDetail: p.dealer || "Marketplace listing",
        brand: p.brand,
        model: p.model,
        ref: refMatch ? refMatch[1] : null,
        title: `${p.brand || ""} ${p.model || ""}`.trim(),
        dialColor: null,
        price: price.isUSD ? price.amount : null,
        priceNonUSD: price.isUSD ? null : p.priceText,
        seller: p.dealer,
        condition: p.detailLine,
        postedMinutesAgo: null,
        isNew: null,
        intent: "sell",
        imageUrl: p.imageUrl || null,
        url: p.href ? `https://www.inventoryconnect.io${p.href}` : null,
        scrapedAt: new Date().toISOString(),
      };
    });

  const wtbListings = wantedBlocks.map((block, i) => {
    const lines = block.split("\n").filter(Boolean);
    const titleLine = lines[0] || "";
    const refLine = lines[1] || "";
    const budgetLine = lines[2] || "";
    const buyerName = lines[3] || null;

    const refMatch = refLine.match(/Ref\.\s*([^\s\u00b7]+)/);
    const budgetMatch = budgetLine.replace(/,/g, "").match(/\$(\d+)/);
    const brandMatch = titleLine.match(/^(\S+)/);

    return {
      id: `ic-wtb-live-${i}-${refMatch ? refMatch[1] : Date.now()}`,
      source: "InventoryConnect Marketplace",
      sourceDetail: "Wanted (WTB)",
      brand: brandMatch ? brandMatch[1] : null,
      model: titleLine,
      ref: refMatch ? refMatch[1] : null,
      title: `WANTED: ${titleLine} - ${refLine} - ${budgetLine}`,
      dialColor: null,
      price: budgetMatch ? Number(budgetMatch[1]) : null,
      seller: buyerName,
      condition: refLine,
      postedMinutesAgo: null,
      isNew: null,
      intent: "buy",
      url: null,
      scrapedAt: new Date().toISOString(),
    };
  });

  const allNewListings = [...listings, ...wtbListings];

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
  for (const item of allNewListings) merged.set(item.id, item);
  const deduped = Array.from(merged.values());

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LATEST_FILE, JSON.stringify(deduped, null, 2), "utf8");

  const nonUsdCount = listings.filter((l) => l.priceNonUSD).length;
  console.log(`Done. ${listings.length} listings from this run (${nonUsdCount} non-USD, flagged not filtered), ${deduped.length} total — written to data/inventoryconnect-latest.json`);
}

run().catch((err) => {
  console.error("InventoryConnect scraper failed:", err.message);
  process.exit(1);
});
