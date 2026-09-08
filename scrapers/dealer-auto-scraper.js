const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { chromium } = require("playwright");

const DATA_DIR = path.join(__dirname, "..", "data");

// Dealers to scrape - add more as needed
const DEALERS = [
  { name: "DavidSW", url: "https://davidsw.com" },
  { name: "Nashville Watch", url: "https://nashvillewatch.com" },
  { name: "Loupe This", url: "https://loupethis.com" },
  { name: "OC Watch Guy", url: "https://www.ocwatchguy.com" },
  { name: "Takuya Watches", url: "https://www.takuyawatches.com" },
  { name: "AIS Watches", url: "https://aiswatches.com" },
  { name: "Element iN Time", url: "https://www.elementintime.com" },
  { name: "Avi & Co", url: "https://www.aviandco.com" },
  { name: "Wrist Aficionado", url: "https://wristaficionado.com" },
  { name: "Motion in Time", url: "https://motionintime.com" },
  { name: "Essential Watches", url: "https://www.essential-watches.com" },
  { name: "Collectors1946", url: "https://collectors1946.com" },
  { name: "Grand Caliber", url: "https://grandcaliber.com" },
  { name: "WatchChest", url: "https://watchchest.com" },
  { name: "Delray Watch", url: "https://delraywatch.com" },
  { name: "CRM Jewelers", url: "https://www.crmjewelers.com" },
  { name: "Gray & Sons", url: "https://www.grayandsons.com" },
  { name: "Provident Jewelry", url: "https://www.providentjewelry.com" },
  { name: "Topper Jewelers", url: "https://topperjewelers.com" },
  { name: "Feldmar Watch", url: "https://feldmarwatch.com" },
  { name: "Material Good", url: "https://materialgood.com" },
  { name: "Tropical Watch", url: "https://tropicalwatch.com" },
  { name: "Wind Vintage", url: "https://www.windvintage.com" },
  { name: "HQ Milton", url: "https://www.hqmilton.com" },
  { name: "Craft + Tailored", url: "https://www.craftandtailored.com" },
  { name: "Analog Shift", url: "https://www.analogshift.com" },
  { name: "Menta Watches", url: "https://mentawatches.com" },
  { name: "Timepiece Trading", url: "https://timepiecetradingllc.com" },
  { name: "Moda Watch", url: "https://www.moda.watch" },
];

const HEADERS = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" };

async function detectPlatform(baseUrl) {
  try {
    const r = await axios.get(`${baseUrl}/products.json?limit=1`, { headers: HEADERS, timeout: 10000 });
    if (r.data?.products) return "shopify";
  } catch {}
  try {
    const r = await axios.get(`${baseUrl}/wp-json/wc/v3/products?per_page=1`, { headers: HEADERS, timeout: 10000 });
    if (Array.isArray(r.data)) return "woocommerce";
  } catch {}
  return "unknown";
}

async function scrapeShopify(dealer) {
  const items = [];
  let page = 1;
  while (page <= 30) {
    try {
      const { data } = await axios.get(`${dealer.url}/products.json?limit=250&page=${page}`, { headers: HEADERS, timeout: 30000 });
      if (!data.products?.length) break;
      data.products
        .filter(p => p.variants?.[0]?.available && parseFloat(p.variants[0].price) > 0)
        .forEach(p => {
          const price = parseFloat(p.variants[0].price);
          const slug = dealer.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          items.push({
            id: `${slug}-${p.id}`,
            source: dealer.name,
            sourceDetail: dealer.url.replace('https://www.','').replace('https://',''),
            brand: p.vendor || null,
            model: null,
            ref: p.variants[0].sku || null,
            title: p.title,
            price: price || null,
            url: `${dealer.url}/products/${p.handle}`,
            imageUrl: p.images?.[0]?.src || null,
            condition: "Pre-Owned",
            postedMinutesAgo: Math.round((Date.now() - new Date(p.published_at).getTime()) / 60000),
            scrapedAt: new Date().toISOString(),
          });
        });
      if (data.products.length < 250) break;
      page++;
      await new Promise(r => setTimeout(r, 600));
    } catch(e) { break; }
  }
  return items;
}

async function run() {
  console.log(`[DealerScraper] Detecting platforms for ${DEALERS.length} dealers...`);
  const results = { shopify: [], unknown: [] };
  const allItems = [];

  for (const dealer of DEALERS) {
    const platform = await detectPlatform(dealer.url);
    console.log(`[${dealer.name}] Platform: ${platform}`);
    results[platform] = results[platform] || [];
    results[platform].push(dealer.name);

    if (platform === "shopify") {
      const items = await scrapeShopify(dealer);
      console.log(`[${dealer.name}] Scraped ${items.length} items`);
      if (items.length > 0) {
        const slug = dealer.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const outFile = path.join(DATA_DIR, `${slug}-latest.json`);
        fs.writeFileSync(outFile, JSON.stringify(items, null, 2));
        allItems.push(...items);
      }
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log("\n=== RESULTS ===");
  console.log("Shopify (scraped):", results.shopify?.join(", "));
  console.log("Unknown (needs manual):", results.unknown?.join(", "));
  console.log(`Total new items: ${allItems.length}`);
}

run().catch(console.error);
