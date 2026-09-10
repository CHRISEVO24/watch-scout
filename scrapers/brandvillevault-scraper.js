const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "brandvillevault-latest.json");
const AUTH_FILE = path.join(DATA_DIR, "brandvillevault-auth.json");

async function scrape() {
  console.log("[BrandvilleVault] Starting...");
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Set auth token in localStorage before navigating
  if (fs.existsSync(AUTH_FILE)) {
    const auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    await page.addInitScript((authData) => {
      localStorage.setItem('bv-auth-token', JSON.stringify(authData));
      localStorage.setItem('bv_currency', 'USD');
    }, auth);
    console.log("[BrandvilleVault] Auth token loaded");
  }

  await page.goto("https://www.brandvillevault.com/watches?usd", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000);

  const allItems = [];
  const seenIds = new Set();
  let lastCount = 0;
  let noChangeRounds = 0;

  while (noChangeRounds < 5) {
    // Extract all current cards
    const items = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('a[href*="/catalog/"]').forEach(a => {
        if (results.find(r => r.url === a.href)) return;
        const card = a.closest('[class]') || a.parentElement;
        const text = card?.innerText || '';
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        const priceMatch = text.match(/\$([\d,]+)/);
        const refLine = lines.find(l => l.startsWith('Ref.'));
        const condLine = lines.find(l => ['MINOR WEAR','EXCELLENT','GOOD','LIKE NEW','UNWORN','MINT'].some(c => l.includes(c)));
        const boxLine = lines.find(l => l.includes('BOX') || l.includes('CARD') || l.includes('PAPERS'));
        const img = card?.querySelector('img')?.src;
        results.push({
          url: a.href,
          title: lines.slice(0, 4).join(' ').slice(0, 100),
          price: priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null,
          ref: refLine ? refLine.replace('Ref.', '').trim() : null,
          condition: condLine || null,
          boxPapers: boxLine || null,
          img: img || null,
        });
      });
      return results;
    });

    let newCount = 0;
    items.forEach(item => {
      if (seenIds.has(item.url)) return;
      seenIds.add(item.url);
      const idMatch = item.url.match(/([a-f0-9-]{36})$/);
      allItems.push({
        id: `bvv-${idMatch?.[1]?.slice(0, 8) || Math.random().toString(36).slice(2)}`,
        source: "Brandville Vault",
        sourceDetail: "brandvillevault.com",
        brand: null, model: null,
        ref: item.ref || null,
        title: item.title,
        price: item.price,
        url: item.url,
        imageUrl: item.img || null,
        condition: item.condition || 'Pre-Owned',
        boxPapers: item.boxPapers || null,
        postedMinutesAgo: null,
        scrapedAt: new Date().toISOString(),
      });
      newCount++;
    });

    console.log(`[BrandvilleVault] ${allItems.length} items found (${newCount} new)`);
    if (allItems.length === lastCount) noChangeRounds++;
    else noChangeRounds = 0;
    lastCount = allItems.length;

    // Scroll down
    await page.evaluate(() => window.scrollBy(0, 2000));
    await page.waitForTimeout(1500);

    if (allItems.length >= 700) break;
  }

  await browser.close();
  fs.writeFileSync(OUT_FILE, JSON.stringify(allItems, null, 2));
  console.log(`[BrandvilleVault] Done: ${allItems.length} items`);
}

scrape().catch(console.error);
