const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const https = require("https");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "brandvillevault-latest.json");

const SUPABASE_URL = "https://tulqgebsvpxgwocptnmy.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1bHFnZWJzdnB4Z3dvY3B0bm15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MjYzOTEsImV4cCI6MjA5MDIwMjM5MX0.H12dPM59cIxlvpR7jbuDjpX11qNdohvi-nhiMxNheJA";
const EMAIL = "chris@wpbwatchco.com";
const PASSWORD = "Samantha24!";

async function getFreshToken() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ email: EMAIL, password: PASSWORD });
    const url = new URL(`${SUPABASE_URL}/auth/v1/token?grant_type=password`);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "apikey": ANON_KEY,
      }
    }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) resolve(parsed);
          else reject(new Error("Login failed: " + JSON.stringify(parsed).slice(0, 200)));
        } catch(e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function scrape() {
  console.log("[BrandvilleVault] Starting...");

  // Always get a fresh token via login — no stored token needed
  let auth;
  try {
    console.log("[BrandvilleVault] Logging in to get fresh token...");
    auth = await getFreshToken();
    console.log("[BrandvilleVault] Login successful");
  } catch(e) {
    console.error("[BrandvilleVault] Login failed:", e.message);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();

  // Inject fresh auth token before page loads
  await page.addInitScript((authData) => {
    localStorage.setItem('bv-auth-token', JSON.stringify(authData));
    localStorage.setItem('bv_currency', 'USD');
  }, auth);

  await page.goto("https://www.brandvillevault.com/watches?usd", { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(3000);

  const allItems = [];
  const seenIds = new Set();
  let noChangeRounds = 0;
  const MAX_NO_CHANGE = 8;
  let prevCount = 0;

  console.log("[BrandvilleVault] Starting scroll loop...");

  while (noChangeRounds < MAX_NO_CHANGE) {
    const items = await page.evaluate(() => {
      const results = [];
      const seenHrefs = new Set();
      document.querySelectorAll('a[href*="/catalog/"]').forEach(a => {
        const href = a.href;
        if (seenHrefs.has(href)) return;
        seenHrefs.add(href);
        const card = a.closest('[class]') || a.parentElement;
        const text = card?.innerText || '';
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        const priceMatch = text.match(/\$([\d,]+)/);
        const refLine = lines.find(l => l.startsWith('Ref.'));
        const condLine = lines.find(l => ['MINOR WEAR','EXCELLENT','GOOD','LIKE NEW','UNWORN','MINT'].some(c => l.includes(c)));
        const boxLine = lines.find(l => l.includes('BOX') || l.includes('CARD') || l.includes('PAPERS'));
        const img = card?.querySelector('img')?.src;
        results.push({
          url: href,
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
        locationCode: "US",
        postedMinutesAgo: null,
        scrapedAt: new Date().toISOString(),
      });
      newCount++;
    });

    console.log(`[BrandvilleVault] Round ${noChangeRounds + 1}: ${allItems.length} total (${newCount} new)`);

    if (allItems.length === prevCount) {
      noChangeRounds++;
    } else {
      noChangeRounds = 0;
    }
    prevCount = allItems.length;

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2500);

    if (noChangeRounds >= 3) {
      await page.evaluate(() => window.scrollBy(0, -600));
      await page.waitForTimeout(500);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);
    }

    if (allItems.length >= 600) break;
  }

  await browser.close();

  console.log(`[BrandvilleVault] Done: ${allItems.length} items`);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(allItems, null, 2));
  console.log(`[BrandvilleVault] Saved to ${OUT_FILE}`);
}

scrape().catch(console.error);
