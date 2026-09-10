const axios = require('axios');
const fs = require('fs');
const path = require('path');
const DATA_DIR = path.join(__dirname, '..', 'data');
const HEADERS = {'User-Agent':'Mozilla/5.0'};

const DEALERS = [
  { name: 'Watch Pilot', url: 'https://watchpilot.com', slug: 'watchpilot' },
  { name: 'Luxury Time', url: 'https://luxurytime.com', slug: 'luxurytime' },
];

async function scrapeShopify(dealer) {
  const items = [];
  let page = 1;
  while(page <= 30) {
    const r = await axios.get(`${dealer.url}/products.json?limit=250&page=${page}`, {headers:HEADERS,timeout:30000});
    if(!r.data.products || !r.data.products.length) break;
    r.data.products.forEach(p => {
      const price = parseFloat(p.variants[0].price);
      if(price > 0 && p.variants[0].available) {
        const refMatch = p.title.match(/\b([A-Z]{0,3}[0-9]{4,7}[A-Z0-9]{0,6})\b/i);
        items.push({
          id: `${dealer.slug}-${p.id}`,
          source: dealer.name, sourceDetail: dealer.url.replace('https://www.','').replace('https://',''),
          brand: p.vendor||null, model: null,
          ref: refMatch?.[1]||p.variants[0].sku||null,
          title: p.title, price,
          url: `${dealer.url}/products/${p.handle}`,
          imageUrl: p.images?.[0]?.src||null, condition: 'Pre-Owned',
          postedMinutesAgo: Math.round((Date.now()-new Date(p.published_at).getTime())/60000),
          scrapedAt: new Date().toISOString(),
        });
      }
    });
    console.log(`[${dealer.name}] Page ${page}: ${items.length} items`);
    if(r.data.products.length < 250) break;
    page++;
    await new Promise(r=>setTimeout(r,600));
  }
  fs.writeFileSync(path.join(DATA_DIR,`${dealer.slug}-latest.json`), JSON.stringify(items,null,2));
  console.log(`[${dealer.name}] Done: ${items.length} items`);
  return items;
}

async function run() {
  for(const dealer of DEALERS) {
    await scrapeShopify(dealer);
    await new Promise(r=>setTimeout(r,1000));
  }
}
run().catch(console.error);
