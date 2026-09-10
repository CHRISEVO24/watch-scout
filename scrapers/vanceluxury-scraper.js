const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "vanceluxury-latest.json");

function parseItems(raw) {
  return (raw.item1 || []).map(entry => {
    const listing = entry.item?.listing || {};
    const details = listing.watchDetails || {};
    const price = listing.price || listing.wholesalePrice || listing.inventoryPrice || null;
    const ref = details.friendlyReferenceNumber || details.referenceNumber || null;
    return {
      id: `vlg-${entry.item?.id || Math.random().toString(36).slice(2)}`,
      source: "Vance Luxury Group",
      sourceDetail: "watchtrack.com/vance-luxury-group",
      brand: details.brand || null,
      model: details.model || details.series || null,
      ref,
      title: [details.brand, details.model, ref].filter(Boolean).join(" "),
      price: price ? parseFloat(String(price).replace(/[^0-9.]/g, '')) : null,
      url: "https://watchtrack.com/inventory/vance-luxury-group?key=0IST5KHW",
      imageUrl: details.image || entry.images?.[0] || null,
      condition: listing.condition || null,
      dialColor: details.dialColor || null,
      postedMinutesAgo: listing.listedDate ? Math.round((Date.now() - new Date(listing.listedDate).getTime()) / 60000) : null,
      scrapedAt: new Date().toISOString(),
    };
  });
}

async function scrape() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" });
  const page = await ctx.newPage();
  const allItems = [];
  const seenIds = new Set();

  page.on('response', async res => {
    if (res.url().includes('retrieveliveinventorydata')) {
      try {
        const d = await res.json();
        parseItems(d).forEach(item => {
          if (!seenIds.has(item.id)) {
            seenIds.add(item.id);
            allItems.push(item);
          }
        });
        console.log(`[Vance Luxury] Captured ${d.item1?.length} items (total: ${allItems.length}), hasMore: ${d.item2}`);
      } catch(e) {}
    }
  });

  await page.goto('https://watchtrack.com/inventory/vance-luxury-group?key=0IST5KHW', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Scroll to trigger all pages
  let lastCount = 0;
  let noChange = 0;
  while (noChange < 3) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
    if (allItems.length === lastCount) noChange++;
    else noChange = 0;
    lastCount = allItems.length;
  }

  await browser.close();
  fs.writeFileSync(OUT_FILE, JSON.stringify(allItems, null, 2));
  console.log(`[Vance Luxury] Done: ${allItems.length} items`);
}

scrape().catch(console.error);
