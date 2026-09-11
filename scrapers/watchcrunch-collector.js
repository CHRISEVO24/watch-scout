/**
 * WatchCrunch Marketplace Collector
 * Stage 1: Discovery | Stage 2: Enrichment
 * Uses Playwright with persistent profile - login manually on first run
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PROFILE_DIR = path.join(DATA_DIR, 'watchcrunch-profile');
const CHECKPOINT_FILE = path.join(DATA_DIR, 'watchcrunch-checkpoint.json');
const OUT_JSON = path.join(DATA_DIR, 'watchcrunch-latest.json');
const OUT_CSV = path.join(DATA_DIR, 'watchcrunch-latest.csv');

// Configuration-driven - update without rewriting crawler
const CONFIG = {
  baseUrl: 'https://www.watchcrunch.com/shop',
  loginUrl: 'https://www.watchcrunch.com/signin',
  loginDetect: ['signin', 'login', 'Sign in'],
  stopCodes: [403, 429],
  stopPatterns: ['captcha', 'verify', 'challenge', 'blocked'],
  batchSize: 10,
  scrollDelay: 1200,
  pageDelay: 2000,
  maxRetries: 3,
  backoffBase: 2000,
  maxScrolls: 500,
  // Network response field mappings - update when API changes
  fieldMap: {
    id: ['id', 'listingId', 'listing_id'],
    title: ['title', 'name', 'watchName'],
    brand: ['brand', 'brandName', 'make'],
    model: ['model', 'modelName', 'series'],
    ref: ['referenceNumber', 'reference_number', 'ref', 'sku'],
    price: ['price', 'askingPrice', 'asking_price'],
    currency: ['currency', 'currencyCode'],
    seller: ['seller', 'sellerName', 'user', 'username'],
    condition: ['condition', 'watchCondition'],
    imageUrl: ['imageUrl', 'image', 'coverPhoto', 'cover_photo', 'mainImage'],
    url: ['url', 'listingUrl', 'permalink'],
    postedAt: ['createdAt', 'created_at', 'listedDate', 'postedAt'],
  }
};

// Structured logger
const log = {
  info:  (msg, data) => console.log(`[INFO]  ${new Date().toISOString()} ${msg}`, data||''),
  warn:  (msg, data) => console.warn(`[WARN]  ${new Date().toISOString()} ${msg}`, data||''),
  error: (msg, data) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`, data||''),
  batch: (n, total)  => console.log(`[BATCH] ${new Date().toISOString()} +${n} new (total: ${total})`),
};

// Extract field using config map
function extractField(obj, fieldName) {
  const keys = CONFIG.fieldMap[fieldName] || [fieldName];
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
    // Nested search
    for (const k of Object.keys(obj)) {
      if (typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k])) {
        const val = obj[k][key];
        if (val !== undefined && val !== null) return val;
      }
    }
  }
  return null;
}

// Normalize a raw listing from any source (API JSON or DOM)
function normalizeItem(raw, sourceUrl) {
  const ref = extractField(raw, 'ref');
  const brand = extractField(raw, 'brand');
  const model = extractField(raw, 'model');
  const title = extractField(raw, 'title') || [brand, model, ref].filter(Boolean).join(' ');
  const rawUrl = extractField(raw, 'url') || sourceUrl || '';
  const url = rawUrl.startsWith('http') ? rawUrl : 'https://www.watchcrunch.com' + rawUrl;
  const id = extractField(raw, 'id') || 'wc-' + Buffer.from(url).toString('base64').slice(0, 12);

  return {
    id: `wc-${id}`,
    source: 'WatchCrunch',
    sourceDetail: 'watchcrunch.com',
    brand, model, ref, title,
    price: parseFloat(String(extractField(raw, 'price') || '').replace(/[^0-9.]/g, '')) || null,
    currency: extractField(raw, 'currency') || 'USD',
    seller: extractField(raw, 'seller') || null,
    condition: extractField(raw, 'condition') || null,
    imageUrl: extractField(raw, 'imageUrl') || null,
    url,
    postedAt: extractField(raw, 'postedAt') || null,
    postedMinutesAgo: null,
    enriched: false,
    scrapedAt: new Date().toISOString(),
  };
}

// Load checkpoint
function loadCheckpoint() {
  if (fs.existsSync(CHECKPOINT_FILE)) {
    return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'));
  }
  return { items: {}, lastScroll: 0, stage: 'discovery' };
}

// Save checkpoint
function saveCheckpoint(cp) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp));
}

// Export CSV
function exportCsv(items) {
  const cols = ['id','brand','model','ref','title','price','currency','condition','seller','url','imageUrl','postedAt','scrapedAt'];
  const rows = [cols.join(',')];
  Object.values(items).forEach(item => {
    rows.push(cols.map(c => JSON.stringify(item[c] ?? '')).join(','));
  });
  fs.writeFileSync(OUT_CSV, rows.join('\n'));
}

// Check for stop conditions
function shouldStop(url, status) {
  if (CONFIG.stopCodes.includes(status)) return `HTTP ${status}`;
  if (CONFIG.stopPatterns.some(p => url.toLowerCase().includes(p))) return `URL pattern: ${url}`;
  return null;
}

// Retry with exponential backoff
async function withRetry(fn, retries = CONFIG.maxRetries) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === retries) throw e;
      const delay = CONFIG.backoffBase * Math.pow(2, i);
      log.warn(`Retry ${i+1}/${retries} after ${delay}ms: ${e.message}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function run() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const cp = loadCheckpoint();
  log.info(`Loaded checkpoint: ${Object.keys(cp.items).length} items, stage: ${cp.stage}`);

  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false, // headed for manual login
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  const page = await browser.newPage();

  // Intercept all API responses
  page.on('response', async res => {
    const url = res.url();
    const status = res.status();

    // Check stop conditions
    const stop = shouldStop(url, status);
    if (stop) { log.error(`STOP condition: ${stop}`); return; }

    // Only process JSON responses
    const ct = res.headers()['content-type'] || '';
    if (!ct.includes('json')) return;

    try {
      const body = await res.json();
      // Look for listing arrays in any JSON response
      const lists = [];
      const scan = (obj, depth = 0) => {
        if (depth > 4 || !obj) return;
        if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === 'object') {
          if (obj[0].price !== undefined || obj[0].referenceNumber !== undefined || obj[0].listingId !== undefined) {
            lists.push(obj);
          }
        }
        if (typeof obj === 'object') Object.values(obj).forEach(v => scan(v, depth + 1));
      };
      scan(body);

      lists.forEach(list => {
        let newCount = 0;
        list.forEach(raw => {
          const item = normalizeItem(raw, url);
          if (!cp.items[item.id]) {
            cp.items[item.id] = item;
            newCount++;
          }
        });
        if (newCount > 0) {
          log.batch(newCount, Object.keys(cp.items).length);
          saveCheckpoint(cp);
        }
      });
    } catch(e) {}
  });

  // Navigate to shop
  log.info('Navigating to WatchCrunch shop...');
  await page.goto(CONFIG.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Check if login needed
  const needsLogin = CONFIG.loginDetect.some(t => page.url().includes('signin') || page.url().includes('login'));
  if (needsLogin) {
    log.info('Login required - please log in manually in the browser window. Waiting 30s...');
    await page.waitForTimeout(30000);
  }

  // Also scrape DOM as fallback
  const domScrape = async () => {
    return await page.evaluate((config) => {
      const items = [];
      const seen = new Set();
      document.querySelectorAll('a').forEach(a => {
        if (!a.href.includes('watchcrunch.com/shop/')) return;
        if (seen.has(a.href)) return;
        const card = a.closest('div,article,li');
        const text = card?.innerText?.trim() || '';
        const priceMatch = text.match(/\$([\d,]+)/);
        const refMatch = text.match(/Ref\.\s*(\S+)/i);
        seen.add(a.href);
        if (priceMatch) {
          items.push({
            url: a.href,
            title: text.split('\n')[0]?.trim(),
            price: text.match(/\$([\d,]+)/)?.[1],
            ref: refMatch?.[1] || null,
            imageUrl: card?.querySelector('img')?.src || null,
          });
        }
      });
      return items;
    }, CONFIG);
  };

  // Stage 1: Discovery via scroll
  log.info('Stage 1: Discovery - scrolling to load listings...');
  let scrollCount = cp.lastScroll || 0;
  let noNewCount = 0;
  let lastTotal = Object.keys(cp.items).length;

  while (scrollCount < CONFIG.maxScrolls && noNewCount < 10) {
    await withRetry(async () => {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(CONFIG.scrollDelay);
    });

    // Also do DOM scrape as fallback
    const domItems = await domScrape();
    let newFromDom = 0;
    domItems.forEach(raw => {
      const item = normalizeItem(raw, raw.url);
      if (!cp.items[item.id]) {
        cp.items[item.id] = item;
        newFromDom++;
      }
    });

    const currentTotal = Object.keys(cp.items).length;
    if (currentTotal === lastTotal) {
      noNewCount++;
    } else {
      noNewCount = 0;
      log.batch(currentTotal - lastTotal, currentTotal);
    }
    lastTotal = currentTotal;
    scrollCount++;
    cp.lastScroll = scrollCount;

    if (scrollCount % 10 === 0) {
      saveCheckpoint(cp);
      log.info(`Scroll ${scrollCount}: ${currentTotal} total items`);
    }
  }

  log.info(`Discovery complete: ${Object.keys(cp.items).length} items`);
  saveCheckpoint(cp);

  // Write outputs
  const items = Object.values(cp.items);
  fs.writeFileSync(OUT_JSON, JSON.stringify(items, null, 2));
  exportCsv(cp.items);
  log.info(`Exported ${items.length} items to JSON and CSV`);

  await browser.close();
}

run().catch(e => { log.error('Fatal:', e.message); process.exit(1); });
