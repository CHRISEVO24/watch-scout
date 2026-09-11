const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DATA_DIR = path.join(__dirname, "..", "data");
const COOKIES_FILE = path.join(DATA_DIR, "inventoryconnect-cookies.json");
const OUT_FILE = path.join(DATA_DIR, "watchdrop-latest.json");
const PROGRESS_FILE = path.join(DATA_DIR, "watchdrop-progress.json");
const NUM_WORKERS = 10;

function convertCookies(raw) {
  return raw.map(c => ({
    name: c.name, value: c.value, domain: c.domain, path: c.path,
    expires: c.session ? -1 : Math.floor(c.expirationDate),
    httpOnly: c.httpOnly, secure: c.secure,
    sameSite: c.sameSite === 'unspecified' ? 'Lax' : (c.sameSite?.charAt(0).toUpperCase() + c.sameSite?.slice(1)) || 'Lax'
  }));
}

// Shared state between workers
const sharedState = {
  items: {},
  done: new Set(),
  lock: false,
};

function saveProgress() {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ done: [...sharedState.done], items: sharedState.items }));
  fs.writeFileSync(OUT_FILE, JSON.stringify(Object.values(sharedState.items), null, 2));
}

async function worker(workerId, refs, cookies) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();

  await page.goto('https://www.inventoryconnect.io/watchdrop', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000 + workerId * 200); // stagger starts

  if (page.url().includes('login')) {
    console.log(`[Worker ${workerId}] Session expired`);
    await browser.close();
    return;
  }
  console.log(`[Worker ${workerId}] Ready, searching ${refs.length} refs`);

  let searched = 0;
  let sessionErrors = 0;

  for (const ref of refs) {
    if (sharedState.done.has(ref)) { searched++; continue; }

    try {
      const results = await page.evaluate(async (searchRef) => {
        const r = await fetch(`/watchdrop/api/listings?limit=20&currency=USD&reference=${encodeURIComponent(searchRef)}`);
        const text = await r.text();
        if (text.startsWith('<')) return null;
        return JSON.parse(text);
      }, ref);

      if (results === null) {
        sessionErrors++;
        if (sessionErrors > 3) {
          await page.goto('https://www.inventoryconnect.io/watchdrop', { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(3000);
          sessionErrors = 0;
        }
        continue;
      }

      const items = (results.items || []).filter(i => i.listing_type !== 'wtb' && i.listing_type !== 'ntq');
      items.forEach(item => {
        const id = `wd-${item.id}`;
        if (!sharedState.items[id]) {
          sharedState.items[id] = {
            id, source: "WatchDrop", sourceDetail: "inventoryconnect.io/watchdrop",
            brand: item.brand || null, model: item.model || null,
            ref: item.reference_number || null,
            title: [item.brand, item.model, item.reference_number].filter(Boolean).join(" "),
            price: item.price ? parseFloat(item.price) : null,
            url: `https://www.inventoryconnect.io/watchdrop/${item.id}`,
            imageUrl: item.photo_url ? `https://www.inventoryconnect.io${item.photo_url}` : null,
            condition: item.condition || null, dialColor: item.dial_color || null,
            seller: item.sender || null, groupName: item.group_name || null,
            postedMinutesAgo: item.posted_at ? Math.round((Date.now() - new Date(item.posted_at).getTime()) / 60000) : null,
            scrapedAt: new Date().toISOString(),
          };
        }
      });

      sharedState.done.add(ref);
      searched++;

      if (searched % 50 === 0) {
        console.log(`[Worker ${workerId}] ${searched}/${refs.length} done | Global: ${Object.keys(sharedState.items).length} items`);
        saveProgress();
      }

      await page.waitForTimeout(200);

    } catch(e) {
      console.error(`[Worker ${workerId}] Error on ${ref}:`, e.message);
      await page.waitForTimeout(1000);
    }
  }

  await browser.close();
  console.log(`[Worker ${workerId}] Finished ${searched} refs`);
}

async function run() {
  const cookies = convertCookies(JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8')));

  // Load progress
  if (fs.existsSync(PROGRESS_FILE)) {
    const saved = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    saved.done?.forEach(r => sharedState.done.add(r));
    Object.assign(sharedState.items, saved.items || {});
    console.log(`[Main] Resuming: ${sharedState.done.size} refs done, ${Object.keys(sharedState.items).length} items`);
  }

  // Load existing WatchDrop items
  if (fs.existsSync(OUT_FILE)) {
    const existing = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
    existing.forEach(i => { sharedState.items[i.id] = i; });
  }

  // Build ref list
  console.log('[Main] Building ref list from combined.json...');
  const combined = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'combined.json'), 'utf8'));
  const wtb = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wtb-requests.json'), 'utf8'));

  const refSet = new Set();
  combined.filter(i => i.source !== 'WatchDrop' && i.ref && i.ref.length >= 4 && i.ref.length <= 15).forEach(i => refSet.add(i.ref.trim()));
  wtb.filter(r => r.watch?.ref).forEach(r => refSet.add(r.watch.ref.trim()));

  const allRefs = [...refSet].filter(r => !sharedState.done.has(r));
  console.log(`[Main] ${allRefs.length} refs to search across ${NUM_WORKERS} workers`);

  // Split refs evenly across workers
  const chunks = Array.from({length: NUM_WORKERS}, (_, i) =>
    allRefs.filter((_, idx) => idx % NUM_WORKERS === i)
  );

  console.log(`[Main] Starting ${NUM_WORKERS} parallel workers...`);
  const start = Date.now();

  await Promise.all(chunks.map((chunk, i) => worker(i + 1, chunk, cookies)));

  const elapsed = Math.round((Date.now() - start) / 1000 / 60);
  saveProgress();

  const total = Object.keys(sharedState.items).length;
  console.log(`[Main] Complete! ${total} unique WatchDrop items in ${elapsed} minutes`);
}

run().catch(console.error);
