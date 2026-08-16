const fs = require("fs");

const BUY_SIGNALS = [
  /\bwtb\b/i, /\bntq\b/i, /\biso\b/i, /\blooking for\b/i, /\bneed\b/i,
  /\bwant(ed)?\b/i, /\bin search of\b/i, /\bhunting for\b/i,
  /\bwilling to buy\b/i, /\bwill buy\b/i, /\bseeking\b/i,
];

const SELL_SIGNALS = [
  /\bwts\b/i, /\bfs\b/i, /\bfor sale\b/i, /\bselling\b/i, /\bsale\b/i,
  /\bavailable\b/i, /\bin stock\b/i, /\bbnib\b/i, /\bnib\b/i,
];

function classifyIntent(text) {
  if (!text) return null;
  const buyHit = BUY_SIGNALS.some((re) => re.test(text));
  const sellHit = SELL_SIGNALS.some((re) => re.test(text));
  if (buyHit) return "buy";
  if (sellHit) return "sell";
  return null;
}

function run() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node intent-classifier.js path/to/data-file.json");
    process.exit(1);
  }

  const listings = JSON.parse(fs.readFileSync(filePath, "utf8"));
  let buyCount = 0;
  let sellCount = 0;
  let unknownCount = 0;

  for (const item of listings) {
    const intent = classifyIntent(item.title);
    item.intent = intent;
    if (intent === "buy") buyCount++;
    else if (intent === "sell") sellCount++;
    else unknownCount++;
  }

  fs.writeFileSync(filePath, JSON.stringify(listings, null, 2), "utf8");
  console.log(`Tagged ${listings.length} listings: ${buyCount} buy, ${sellCount} sell, ${unknownCount} unclear.`);
}

if (require.main === module) {
  run();
}

module.exports = { classifyIntent };
