const axios = require('axios');
const fs = require('fs');
const path = require('path');
const DATA_DIR = path.join(__dirname, '..', 'data');
const HEADERS = {'User-Agent':'Mozilla/5.0'};

async function scrape() {
  const items = [];
  let page = 1;
  while(page <= 30) {
    const r = await axios.get('https://mttimepieces.net/products.json?limit=250&page=' + page, {headers:HEADERS,timeout:30000});
    if(!r.data.products || !r.data.products.length) break;
    r.data.products.forEach(p => {
      const price = parseFloat(p.variants[0].price);
      if(price > 0 && p.variants[0].available) {
        const refMatch = p.title.match(/\b([A-Z]{0,3}[0-9]{4,7}[A-Z0-9]{0,6})\b/i);
        items.push({
          id: 'mttimepieces-' + p.id,
          source: 'MT Timepieces',
          sourceDetail: 'mttimepieces.net',
          brand: p.vendor||null, model: null,
          ref: refMatch?.[1]||p.variants[0].sku||null,
          title: p.title, price,
          url: 'https://mttimepieces.net/products/' + p.handle,
          imageUrl: p.images?.[0]?.src||null,
          condition: 'Pre-Owned',
          postedMinutesAgo: Math.round((Date.now()-new Date(p.published_at).getTime())/60000),
          scrapedAt: new Date().toISOString(),
        });
      }
    });
    console.log('[MT Timepieces] Page ' + page + ': ' + items.length + ' total');
    if(r.data.products.length < 250) break;
    page++;
    await new Promise(r=>setTimeout(r,600));
  }
  fs.writeFileSync(path.join(DATA_DIR,'mttimepieces-latest.json'), JSON.stringify(items,null,2));
  console.log('[MT Timepieces] Done: ' + items.length + ' items');
  return items;
}

if(require.main === module) scrape().catch(console.error);
module.exports = { scrape };
