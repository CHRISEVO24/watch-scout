const axios = require('axios');
const fs = require('fs');
const path = require('path');
const DATA_DIR = path.join(__dirname, '..', 'data');
const HEADERS = {'User-Agent':'Mozilla/5.0'};

async function scrape() {
  const items = [];
  let page = 1;
  while(page <= 30) {
    const r = await axios.get(`https://www.wywatl.com/products.json?limit=250&page=${page}`, {headers:HEADERS,timeout:30000});
    if(!r.data.products?.length) break;
    r.data.products.forEach(p => {
      const price = parseFloat(p.variants[0].price);
      if(price > 0 && p.variants[0].available && p.vendor !== 'Watch Your Wrist' && p.vendor !== 'Watch Your Wrist - WYWATL') {
        const refMatch = p.title.match(/\b([A-Z]{0,3}[0-9]{4,7}[A-Z0-9]{0,6})\b/i);
        items.push({
          id: `wywatl-${p.id}`,
          source: 'WYW ATL', sourceDetail: 'wywatl.com',
          brand: p.vendor||null, model: null,
          ref: refMatch?.[1]||p.variants[0].sku||null,
          title: p.title, price,
          url: `https://www.wywatl.com/products/${p.handle}`,
          imageUrl: p.images?.[0]?.src||null,
          condition: 'Pre-Owned',
          postedMinutesAgo: Math.round((Date.now()-new Date(p.published_at).getTime())/60000),
          scrapedAt: new Date().toISOString(),
        });
      }
    });
    console.log(`[WYW ATL] Page ${page}: ${items.length} items`);
    if(r.data.products.length < 250) break;
    page++;
    await new Promise(r=>setTimeout(r,600));
  }
  fs.writeFileSync(path.join(DATA_DIR,'wywatl-latest.json'), JSON.stringify(items,null,2));
  console.log(`[WYW ATL] Done: ${items.length} items`);
  return items;
}

if(require.main===module) scrape().catch(console.error);
module.exports = { scrape };
