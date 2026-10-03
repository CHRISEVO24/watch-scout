const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "brandvillevault-latest.json");
const AUTH_FILE = path.join(DATA_DIR, "brandvillevault-auth.json");

const https = require("https");

const SUPABASE_URL = "https://tulqgebsvpxgwocptnmy.supabase.co";

async function refreshToken(auth) {
  return new Promise((resolve, reject) => {
    // We need the anon key — extract it from the JWT header hint or use a known value
    // Try to refresh via Supabase token endpoint
    const body = JSON.stringify({ refresh_token: auth.refresh_token });
    const url = new URL(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1bHFnZWJzdnB4Z3dvY3B0bm15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MjYzOTEsImV4cCI6MjA5MDIwMjM5MX0.H12dPM59cIxlvpR7jbuDjpX11qNdohvi-nhiMxNheJA",
      }
    }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function scrape() {
  console.log("[BrandvilleVault] Starting...");
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Set auth token in localStorage before navigating
  if (fs.existsSync(AUTH_FILE)) {
    let auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    // Auto-refresh if token is expired or expiring within 5 minutes
    if (auth.expires_at && (auth.expires_at - Date.now()/1000) < 300) {
      console.log("[BrandvilleVault] Token expired/expiring — refreshing...");
      try {
        const refreshed = await refreshToken(auth);
        if (refreshed.access_token) {
          auth = { ...auth, ...refreshed };
          fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2));
          console.log("[BrandvilleVault] Token refreshed successfully");
        } else {
          console.warn("[BrandvilleVault] Refresh failed:", JSON.stringify(refreshed).slice(0, 200));
        }
      } catch(e) {
        console.warn("[BrandvilleVault] Refresh error:", e.message);
      }
    }
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
