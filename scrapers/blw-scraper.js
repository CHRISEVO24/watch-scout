const axios = require('axios');
const fs = require('fs');
const path = require('path');
const DATA_DIR = path.join(__dirname, '..', 'data');
const HEADERS = {'User-Agent':'Mozilla/5.0'};

async function scrape() {
  const items = [];
  const seen = new Set();
  let page = 1;
  while(page <= 50) {
    let r;
    for(let attempt=0; attempt<3; attempt++) {
      try {
        r = await axios.get(`https://birminghamluxurywatches.com/products.json?limit=250&page=${page}`, {headers:HEADERS,timeout:30000});
        break;
      } catch(e) {
        if(e.response?.status === 503) {
          console.log(`[BLW] Rate limited, waiting 3 min...`);
          await new Promise(r=>setTimeout(r,180000));
        } else throw e;
      }
    }
    if(!r?.data.products?.length) break;
    r.data.products.forEach(p => {
      const availVariant = p.variants.find(v => v.available && parseFloat(v.price) > 0);
      if(!availVariant) return;
      if(seen.has(p.id)) return;
      seen.add(p.id);
      const price = parseFloat(availVariant.price);
      const refMatch = p.title.match(/\b([A-Z]{0,3}[0-9]{4,7}[A-Z0-9]{0,6})\b/i);
      items.push({
        id: `blw-${p.id}`,
        source: 'Birmingham Luxury Watches', sourceDetail: 'birminghamluxurywatches.com',
        brand: p.vendor||null, model: null,
        ref: refMatch?.[1]||availVariant.sku||null,
        title: p.title, price,
        url: `https://birminghamluxurywatches.com/products/${p.handle}`,
        imageUrl: p.images?.[0]?.src||null,
        condition: 'Pre-Owned',
        postedMinutesAgo: Math.round((Date.now()-new Date(p.published_at).getTime())/60000),
        scrapedAt: new Date().toISOString(),
      });
    });
    console.log(`[BLW] Page ${page}: ${items.length} items`);
    if(r.data.products.length < 250) break;
    page++;
    await new Promise(r=>setTimeout(r,1200));
  }
  fs.writeFileSync(path.join(DATA_DIR,'blw-latest.json'), JSON.stringify(items,null,2));
  console.log(`[BLW] Done: ${items.length} items`);
}

scrape().catch(console.error);
