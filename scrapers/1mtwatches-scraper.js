const axios = require('axios');
const fs = require('fs');
const path = require('path');
const DATA_DIR = path.join(__dirname, '..', 'data');
const HEADERS = {'User-Agent':'Mozilla/5.0'};

async function scrape() {
  const items = [];
  let page = 1;
  while(page <= 30) {
    const r = await axios.get(`https://www.1mtwatches.com/products.json?limit=250&page=${page}`, {headers:HEADERS,timeout:30000});
    if(!r.data.products?.length) break;
    r.data.products.forEach(p => {
      const availVariant = p.variants.find(v => v.available && parseFloat(v.price) > 0);
      if(!availVariant) return;
      const price = parseFloat(availVariant.price);
      const refMatch = p.title.match(/\b([A-Z]{0,3}[0-9]{4,7}[A-Z0-9]{0,6})\b/i);
      items.push({
        id: `1mt-${p.id}`,
        source: '1MT Watches', sourceDetail: '1mtwatches.com',
        brand: p.vendor||null, model: null,
        ref: refMatch?.[1]||availVariant.sku||null,
        title: p.title, price,
        url: `https://www.1mtwatches.com/products/${p.handle}`,
        imageUrl: p.images?.[0]?.src||null,
        condition: 'Pre-Owned',
        postedMinutesAgo: Math.round((Date.now()-new Date(p.published_at).getTime())/60000),
        scrapedAt: new Date().toISOString(),
      });
    });
    console.log(`[1MT Watches] Page ${page}: ${items.length} items`);
    if(r.data.products.length < 250) break;
    page++;
    await new Promise(r=>setTimeout(r,600));
  }
  fs.writeFileSync(path.join(DATA_DIR,'1mtwatches-latest.json'), JSON.stringify(items,null,2));
  console.log(`[1MT Watches] Done: ${items.length} items`);
}

scrape().catch(console.error);
