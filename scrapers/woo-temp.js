const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const DATA_DIR = path.join('/Users/christophermancuso/Library/Mobile Documents/com~apple~CloudDocs/Watch Scout/data');

const DEALERS = [
  { name: "Nashville Watch", url: "https://nashvillewatch.com", shopPath: "/shop" },
  { name: "Delray Watch", url: "https://delraywatch.com", shopPath: "/shop" },
];

async function scrapeWoo(page, dealer) {
  const items = [], seen = new Set();
  const slug = dealer.name.toLowerCase().replace(/[^a-z0-9]/g,'');
  for(let pg=1; pg<=20; pg++) {
    try {
      await page.goto(`${dealer.url}${dealer.shopPath}/page/${pg}/`, {waitUntil:'domcontentloaded',timeout:30000});
      await page.waitForTimeout(1500);
      const products = await page.evaluate(() => {
        const r=[];
        document.querySelectorAll('li.product,.product').forEach(el=>{
          const a=el.querySelector('a');
          const title=el.querySelector('h2,h3,.woocommerce-loop-product__title')?.textContent?.trim();
          const price=el.querySelector('.price')?.textContent?.trim();
          const img=el.querySelector('img')?.src;
          if(a&&title) r.push({href:a.href,title,price,img});
        });
        return r;
      });
      if(!products.length) break;
      products.forEach(p=>{
        if(seen.has(p.href)) return;
        seen.add(p.href);
        const price=parseFloat((p.price||'').replace(/[^0-9.]/g,''))||null;
        items.push({id:`${slug}-${Buffer.from(p.href).toString('base64').slice(0,10)}`,source:dealer.name,sourceDetail:dealer.url.replace('https://www.','').replace('https://',''),brand:null,model:null,ref:null,title:p.title,price,url:p.href,imageUrl:p.img||null,condition:'Pre-Owned',postedMinutesAgo:null,scrapedAt:new Date().toISOString()});
      });
      console.log(`[${dealer.name}] Page ${pg}: ${products.length} (total: ${items.length})`);
    } catch(e) { console.error(e.message); break; }
  }
  fs.writeFileSync(path.join(DATA_DIR,`${slug}-latest.json`), JSON.stringify(items,null,2));
  console.log(`[${dealer.name}] Done: ${items.length}`);
  return items;
}

async function run() {
  const browser = await chromium.launch({headless:true});
  const page = await (await browser.newContext({userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'})).newPage();
  for(const d of DEALERS) { await scrapeWoo(page,d); await page.waitForTimeout(2000); }
  await browser.close();
}
run().catch(console.error);
