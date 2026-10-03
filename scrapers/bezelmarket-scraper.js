// scrapers/bezelmarket-scraper.js
// Bezel Market scraper (bezelmarket.com)
// Opens a NEW browser window — Chrome can stay open normally.
// On first run: log in via magic code in the new window. Session is saved for future runs.
// Run: node scrapers/bezelmarket-scraper.js

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, '../data/bezelmarket-latest.json');
const HISTORY_FILE = path.join(__dirname, '../data/bezelmarket-history.json');
// Persistent session dir — reuse across runs so you only log in once
const SESSION_DIR = path.join(__dirname, '../data/.bezelmarket-session');

function extractBrandFromSlug(slug) {
  const brandMap = {
    'rolex': 'Rolex',
    'patek-philippe': 'Patek Philippe',
    'audemars-piguet': 'Audemars Piguet',
    'richard-mille': 'Richard Mille',
    'vacheron-constantin': 'Vacheron Constantin',
    'a-lange-sohne': 'A. Lange & Söhne',
    'omega': 'Omega',
    'cartier': 'Cartier',
    'iwc': 'IWC',
    'tudor': 'Tudor',
    'f-p-journe': 'F.P. Journe',
    'greubel-forsey': 'Greubel Forsey',
  };
  for (const [key, val] of Object.entries(brandMap)) {
    if (slug.startsWith(key)) return val;
  }
  const parts = slug.split('-');
  return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
}

function extractRefFromSlug(slug) {
  const brandPrefixes = [
    'patek-philippe', 'audemars-piguet', 'richard-mille', 'vacheron-constantin',
    'a-lange-sohne', 'rolex', 'cartier', 'omega', 'iwc', 'tudor', 'f-p-journe', 'greubel-forsey',
  ];
  for (const prefix of brandPrefixes) {
    if (slug.startsWith(prefix + '-')) {
      return slug.slice(prefix.length + 1).toUpperCase();
    }
  }
  return slug.split('-').slice(1).join('-').toUpperCase();
}

async function scrapeRefPage(page, slug) {
  const url = `https://bezelmarket.com/r/${slug}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);
  } catch (e) {
    console.error(`  Load failed: ${e.message}`);
    return [];
  }

  const brand = extractBrandFromSlug(slug);
  const ref = extractRefFromSlug(slug);

  const data = await page.evaluate(() => {
    const titleEl = document.querySelector('h1');
    const title = titleEl ? titleEl.textContent.trim() : '';
    const brandEl = document.querySelector('a[href*="/brand/"]');
    const brandName = brandEl ? brandEl.textContent.trim() : null;
    const rows = Array.from(document.querySelectorAll('.flex.items-center')).filter(el =>
      el.textContent.includes('Dealer') && el.textContent.match(/\$[\d,]+/)
    );
    return {
      title,
      brand: brandName,
      rows: rows.map(row => ({ text: row.textContent.trim().replace(/\s+/g, ' ') })),
    };
  });

  const listings = [];
  const seen = new Set();

  for (let idx = 0; idx < data.rows.length; idx++) {
    const { text } = data.rows[idx];
    const dealerMatch = text.match(/Dealer\s+([\w-]+)/);
    const priceMatch = text.match(/\$([\d,]+)/);
    if (!dealerMatch || !priceMatch) continue;

    const dealer = dealerMatch[1];
    const price = parseInt(priceMatch[1].replace(/,/g, ''));
    if (price < 500 || price > 20000000) continue;

    const afterDealer = text.slice(text.indexOf(dealer));
    const isNew = /\bNew\b/.test(afterDealer);
    const yearMatch = text.match(/\b(20\d\d)\b/);
    const key = `${dealer}-${price}-${idx}`;
    if (seen.has(key)) continue;
    seen.add(key);

    listings.push({
      id: `bezelmarket-${slug}-${dealer}-${idx}`,
      source: 'Bezel Market',
      sourceDetail: 'bezelmarket.com',
      brand: data.brand || brand,
      model: data.title || slug,
      ref,
      price,
      condition: isNew ? 'New' : 'Used',
      year: yearMatch ? yearMatch[1] : null,
      dealer,
      url: `https://bezelmarket.com/r/${slug}`,
      scrapedAt: new Date().toISOString(),
    });
  }

  return listings;
}

async function main() {
  console.log('Starting Bezel Market scraper...\n');
  console.log('NOTE: A new browser window will open. Chrome can stay open normally.\n');

  // Use a persistent context stored in the project — saves login session between runs
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    console.log('First run: a browser will open for you to log in to bezelmarket.com.');
    console.log('After you sign in, the scraper will start automatically.\n');
  }

  const browser = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    channel: 'chrome',
    args: ['--no-first-run'],
  });

  const pages = browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();

  await page.goto('https://bezelmarket.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Check login status — wait up to 3 minutes for user to log in if needed
  let isLoggedIn = await page.evaluate(() => !!document.querySelector('a[href="/account"]'));

  if (!isLoggedIn) {
    console.log('Not logged in. Please sign into bezelmarket.com in the browser window that just opened.');
    console.log('Waiting up to 3 minutes for you to log in...\n');

    const deadline = Date.now() + 3 * 60 * 1000;
    while (!isLoggedIn && Date.now() < deadline) {
      await page.waitForTimeout(3000);
      isLoggedIn = await page.evaluate(() => !!document.querySelector('a[href="/account"]')).catch(() => false);
      if (isLoggedIn) break;
      // Also check if URL changed to indicate login happened
      const url = page.url();
      if (url.includes('bezelmarket.com') && !url.includes('login')) {
        isLoggedIn = await page.evaluate(() => !!document.querySelector('a[href="/account"]')).catch(() => false);
      }
    }

    if (!isLoggedIn) {
      console.error('Timed out waiting for login. Please run again after signing in.');
      await browser.close();
      process.exit(1);
    }
    console.log('Logged in ✓  Session saved — future runs won\'t need login.\n');
  } else {
    console.log('Logged in ✓ (saved session)\n');
  }

  // Re-navigate to homepage fresh after login to ensure full Next.js render
  console.log('Loading homepage...');
  await page.goto('https://bezelmarket.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for reference links to appear after hydration (up to 20s)
  console.log('Waiting for reference links...');
  try {
    await page.waitForSelector('a[href^="/r/"]', { timeout: 20000 });
    console.log('Reference links found ✓');
  } catch (e) {
    console.log('Warning: /r/ links not found via selector — trying anyway...');
  }
  await page.waitForTimeout(1500);

  // Get reference slugs
  const slugs = await page.evaluate(() =>
    [...new Set(
      Array.from(document.querySelectorAll('a[href^="/r/"]'))
        .map(a => a.getAttribute('href').replace('/r/', ''))
        .filter(s => s && !s.includes('/'))
    )]
  );

  console.log(`Found ${slugs.length} reference pages to scrape\n`);
  if (slugs.length === 0) {
    console.error('No reference slugs found. Try running again — the page may not have fully loaded.');
    await browser.close();
    process.exit(1);
  }

  const allListings = [];
  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    process.stdout.write(`[${i + 1}/${slugs.length}] ${slug}... `);
    const listings = await scrapeRefPage(page, slug);
    allListings.push(...listings);
    console.log(`${listings.length} listings`);
    if (i < slugs.length - 1) await page.waitForTimeout(500);
  }

  await browser.close();

  const dataDir = path.join(__dirname, '../data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allListings, null, 2));
  console.log(`\nSaved ${allListings.length} listings → ${OUTPUT_FILE}`);

  let history = [];
  if (fs.existsSync(HISTORY_FILE)) {
    try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch {}
  }
  history.push({ scrapedAt: new Date().toISOString(), count: allListings.length });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));

  console.log(`TOTAL: ${allListings.length}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
