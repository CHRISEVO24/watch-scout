const axios = require('axios');
const fs = require('fs');
const path = require('path');
const DATA_DIR = path.join(__dirname, '..', 'data');
const HEADERS = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" };

async function scrapeShopify(name, baseUrl) {
  const items = [];
  let page = 1;
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  while (page <= 30) {
    try {
      const { data } = await axios.get(`${baseUrl}/products.json?limit=250&page=${page}`, { headers: HEADERS, timeout: 30000 });
      if (!data.products?.length) { console.log(`[${name}] No products on page ${page}`); break; }
      const before = items.length;
      data.products.forEach(p => {
        const price = parseFloat(p.variants?.[0]?.price || 0);
        if (price > 0) {
          items.push({
            id: `${slug}-${p.id}`, source: name,
            sourceDetail: baseUrl.replace('https://www.','').replace('https://',''),
            brand: p.vendor||null, model: null, ref: p.variants[0].sku||null,
            title: p.title, price,
            url: `${baseUrl}/products/${p.handle}`,
            imageUrl: p.images?.[0]?.src||null, condition: "Pre-Owned",
            postedMinutesAgo: Math.round((Date.now()-new Date(p.published_at).getTime())/60000),
            scrapedAt: new Date().toISOString(),
          });
        }
      });
      console.log(`[${name}] Page ${page}: ${data.products.length} products, ${items.length - before} added`);
      if (data.products.length < 250) break;
      page++;
      await new Promise(r=>setTimeout(r,1500));
    } catch(e) {
      console.error(`[${name}] Error page ${page}:`, e.message);
      break;
    }
  }
  fs.writeFileSync(path.join(DATA_DIR, `${slug}-latest.json`), JSON.stringify(items, null, 2));
  console.log(`[${name}] Done: ${items.length} items`);
  return items;
}

async function run() {
  const tpt = await scrapeShopify('Timepiece Trading', 'https://timepiecetradingllc.com');
  await new Promise(r=>setTimeout(r,5000));
  const as = await scrapeShopify('Analog Shift', 'https://www.analogshift.com');
  console.log('Grand total:', tpt.length + as.length);
}

run().catch(console.error);
