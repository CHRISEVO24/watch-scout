const axios = require('axios');
const fs = require('fs');
const path = require('path');

const OUT_FILE = path.join(__dirname, '..', 'data', 'discovered-dealers.json');
const HEADERS = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'};

// Seed list of known luxury watch dealer domains to check
const SEED_DEALERS = [
  // Already scraped - skip
  // New targets
  'watchmaxx.com', 'bobswatches.com', 'crownandcaliber.com',
  'watchbox.com', 'tourneau.com', 'govberg.com', 'raymondjewelers.com',
  'jomashop.com', 'ashford.com', 'rww.com', 'londonjewelers.com',
  'hamiltonjewelers.com', 'benbridge.com', 'helzberg.com',
  'firstclasswatches.co.uk', 'watchfinder.com', 'chronext.com',
  'watchuseek.com', 'bobswatches.com', 'luxuryofwatches.com',
  'luxurydiscount.com', 'watchmaster.com', 'watchpilot.com',
  'catawiki.com', 'invaluable.com', 'icollector.com',
  'hodinkee.com', 'timpetrof.com', 'wristcheck.com',
  'tradewatch.com', 'watchcollectors.com',
  'monochrome-watches.com', 'fratellowatches.com',
  'milliarwatches.com', 'timewatchspecialist.com',
  'prestige-watches.com', 'bestofthetime.com',
  'timeandgemjewelers.com', 'watches2u.com',
  'luxurytics.com', 'watchrecon.com',
  'davidsw.com', 'timezone.com',
  'gregoryson.com', 'foxandstone.com',
  'oldbangkok.com', 'timegear.com',
  'watchaficionado.com', 'absolutewatches.com',
  'luxurywatchesusa.com', 'premier-watches.com',
  'thewatchsource.co.uk', 'prestigewatches.com',
  'swisswatchhk.com', 'luxurytime.com',
  'watchcity.com', 'atlanticwatches.com',
  'orlandowatchcompany.com', 'floridawatchcompany.com',
  'miamiwatch.com', 'watchsnob.com',
  'watchuseek.com', 'timezone.com',
];

async function detectPlatform(domain) {
  const url = `https://${domain}`;
  try {
    // Check Shopify
    const r = await axios.get(`${url}/products.json?limit=1`, {headers: HEADERS, timeout: 8000});
    if (r.data?.products) return { platform: 'shopify', count: null };
  } catch {}
  try {
    // Check WooCommerce
    const r = await axios.get(`${url}/wp-json/wc/v3/products?per_page=1`, {headers: HEADERS, timeout: 8000});
    if (Array.isArray(r.data) || r.data?.code === 'woocommerce_rest_cannot_view') return { platform: 'woocommerce', count: null };
  } catch {}
  try {
    // Check if site exists
    const r = await axios.get(url, {headers: HEADERS, timeout: 8000});
    const isWatch = r.data.toLowerCase().includes('watch') || r.data.toLowerCase().includes('rolex');
    return { platform: isWatch ? 'custom' : 'not-watch', count: null };
  } catch {
    return { platform: 'error', count: null };
  }
}

async function run() {
  console.log(`Checking ${SEED_DEALERS.length} dealers...`);
  const results = { shopify: [], woocommerce: [], custom: [], error: [] };
  
  for (const domain of SEED_DEALERS) {
    const { platform } = await detectPlatform(domain);
    console.log(`${domain}: ${platform}`);
    if (results[platform]) results[platform].push(domain);
    else results.custom.push(domain);
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n=== RESULTS ===');
  console.log('Shopify (easy scrape):', results.shopify);
  console.log('WooCommerce:', results.woocommerce);
  console.log('Custom:', results.custom);
  
  fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));
  console.log('\nSaved to discovered-dealers.json');
}

run().catch(console.error);
