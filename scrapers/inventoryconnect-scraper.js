const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const LATEST_FILE = path.join(DATA_DIR, "inventoryconnect-latest.json");

const IC_EMAIL    = "chrisevo24@gmail.com";
const IC_PASSWORD = "Samantha24!";

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

function parsePrice(text) {
  if (!text) return null;
  const isUSD = /^\$/.test(text.trim());
  const m = String(text).replace(/,/g, "").match(/[\d.]+/);
  const amount = m ? Math.round(parseFloat(m[0])) : null;
  return { amount, isUSD };
}

async function login(page) {
  console.log("Navigating to login page...");
  await page.goto("https://www.inventoryconnect.io/login", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1500);

  // Fill email
  await page.fill('input[type="email"], input[name="email"], input[placeholder*="email" i]', IC_EMAIL);
  await page.waitForTimeout(500);

  // Fill password
  await page.fill('input[type="password"], input[name="password"]', IC_PASSWORD);
  await page.waitForTimeout(500);

  // Submit
  await page.click('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Login")');
  await page.waitForTimeout(3000);

  // Verify we're logged in
  const url = page.url();
  const bodyText = await page.evaluate(() => document.body.innerText);
  const loggedIn = !url.includes("/login") && !bodyText.includes("Sign in") && !bodyText.includes("Invalid credentials");
  if (!loggedIn) {
    throw new Error("Login failed — check credentials or the login page may have changed.");
  }
  console.log("Logged in successfully.");
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  });
  const page = await context.newPage();

  await login(page);

  console.log("Navigating to InventoryConnect Marketplace...");
  await page.goto("https://www.inventoryconnect.io/marketplace", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2500);

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
            try { imageUrl = decodeURIComponent(match[1]); } catch {}
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
    if (!hasNext) { console.log("No more pages."); break; }
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
      const refMatch = p.detailLine ? p.detailLine.match(/Ref\.\s*([^\s·]+)/) : null;
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
    const refMatch = refLine.match(/Ref\.\s*([^\s·]+)/);
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
    try { existing = JSON.parse(fs.readFileSync(LATEST_FILE, "utf8")); } catch { existing = []; }
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
