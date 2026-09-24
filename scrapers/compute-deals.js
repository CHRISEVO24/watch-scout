/**
 * compute-deals.js
 *
 * Reads all *-latest.json source files, groups listings by normalized reference
 * number across all sources, computes median price per ref, scores each listing,
 * and writes data/deals-scored.json.
 *
 * Deal score (0–100):
 *   base = (1 - price/median) * 100          [discount depth]
 *   score = clamp(round(base), 0, 100)
 *   Only listings priced BELOW the median receive a score > 0.
 *
 * Runs standalone:  node scrapers/compute-deals.js
 * Or called from server.js after a scrape completes.
 */

"use strict";

const fs   = require("fs");
const path = require("path");

const DATA_DIR  = path.join(__dirname, "..", "data");
const OUT_FILE  = path.join(DATA_DIR, "deals-scored.json");
const STATS_FILE = path.join(DATA_DIR, "deals-stats.json");

// ─── helpers ────────────────────────────────────────────────────────────────

function loadSafe(file) {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return []; }
}

/** Compute median of a sorted numeric array */
function median(sortedArr) {
  const n = sortedArr.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sortedArr[mid] : (sortedArr[mid - 1] + sortedArr[mid]) / 2;
}

/**
 * Normalise a reference string so slight formatting differences
 * ("126610LN", "126610 LN", "126-610LN") all map to the same key.
 */
function normaliseRef(ref) {
  if (!ref || typeof ref !== "string") return null;
  return ref.toUpperCase().replace(/[\s\-\/_.]/g, "").trim() || null;
}

/**
 * Label a deal score numerically.
 * 0       → no deal
 * 1–29    → slight deal
 * 30–59   → good deal
 * 60–79   → great deal
 * 80–100  → exceptional deal
 */
function dealLabel(score) {
  if (!score || score <= 0)  return null;
  if (score < 30)            return "Slight Deal";
  if (score < 60)            return "Good Deal";
  if (score < 80)            return "Great Deal";
  return "Exceptional Deal";
}

function dealColor(score) {
  if (!score || score <= 0)  return null;
  if (score < 30)            return "neutral";
  if (score < 60)            return "yellow";
  if (score < 80)            return "green";
  return "bright-green";
}

// ─── source file list ───────────────────────────────────────────────────────
// Keep in sync with scrapers/merge.js

const SOURCE_FILES = [
  "watchrecon-latest.json",
  "watchpatrol-latest.json",
  "chrono24-latest.json",
  "bobswatches-latest.json",
  "europeanwatch-latest.json",
  "fbgroups-latest.json",
  "fbmarketplace-latest.json",
  "ebay-latest.json",
  "whatsapp-latest.json",
  "bezel-latest.json",
  "inventoryconnect-latest.json",
  "artimeus-latest.json",
  "swisswatchexpo-latest.json",
  "watchlimit-latest.json",
  "the1916company-latest.json",
  "watchesoff5th-latest.json",
  "affordableswiss-latest.json",
  "exquisitetimepieces-latest.json",
  "ashford-latest.json",
  "luxurybazaar-latest.json",
  "watchaffinity-latest.json",
  "iplaywatch-latest.json",
  "aiswatches-latest.json",
  "elementintime-latest.json",
  "wristaficionado-latest.json",
  "collectors1946-latest.json",
  "grandcaliber-latest.json",
  "crmjewelers-latest.json",
  "providentjewelry-latest.json",
  "topperjewelers-latest.json",
  "materialgood-latest.json",
  "hqmilton-latest.json",
  "analogshift-latest.json",
  "timepiecetrading-latest.json",
  "grayandsons-latest.json",
  "mttimepieces-latest.json",
  "nywatchmarket-latest.json",
  "watchdrop-latest.json",
  "watchesinl-latest.json",
  "brandvillevault-latest.json",
  "watchpilot-latest.json",
  "luxurytime-latest.json",
  "yurwatches-latest.json",
  "vanceluxury-latest.json",
  "feldmar-latest.json",
  "wywatl-latest.json",
  "essentialwatches-latest.json",
  "1mtwatches-latest.json",
  "blw-latest.json",
];

// ─── main ───────────────────────────────────────────────────────────────────

function run() {
  const t0 = Date.now();

  // 1. Load all listings from all sources
  const allListings = [];
  let sourceCount = 0;

  for (const file of SOURCE_FILES) {
    const items = loadSafe(file);
    if (items.length) {
      sourceCount++;
      for (const item of items) allListings.push(item);
    }
  }

  console.log(`Loaded ${allListings.length} listings from ${sourceCount} sources`);

  // 2. Group prices by normalised ref
  //    refPrices: Map<normRef, number[]>
  const refPrices = new Map();

  for (const listing of allListings) {
    const price = typeof listing.price === "number" ? listing.price : null;
    const ref   = normaliseRef(listing.ref || listing.reference || listing.model);

    if (price === null || price <= 0 || !ref) continue;

    if (!refPrices.has(ref)) refPrices.set(ref, []);
    refPrices.get(ref).push(price);
  }

  // 3. Compute median per ref
  //    refMedian: Map<normRef, number>
  const refMedian   = new Map();
  const refSamples  = new Map();   // how many price points went into the median

  for (const [ref, prices] of refPrices) {
    prices.sort((a, b) => a - b);
    const m = median(prices);
    if (m !== null) {
      refMedian.set(ref, m);
      refSamples.set(ref, prices.length);
    }
  }

  console.log(`Computed medians for ${refMedian.size} unique references`);

  // 4. Score every listing that has a ref with enough data
  let scored = 0;
  const MIN_SAMPLES = 3;   // need at least 3 price points to trust the median

  const enriched = allListings.map(listing => {
    const price  = typeof listing.price === "number" ? listing.price : null;
    const ref    = normaliseRef(listing.ref || listing.reference || listing.model);

    if (price === null || price <= 0 || !ref) return listing;

    const med     = refMedian.get(ref);
    const samples = refSamples.get(ref) || 0;

    if (!med || samples < MIN_SAMPLES) return listing;

    const discountPct = ((med - price) / med) * 100;   // positive = below median (deal)
    const discountAmt = med - price;

    // Only flag as deal if priced below median
    const rawScore = Math.round(discountPct);
    const dealScore = Math.max(0, Math.min(100, rawScore));

    if (dealScore > 0) scored++;

    return {
      ...listing,
      dealScore,
      dealLabel:   dealLabel(dealScore),
      dealColor:   dealColor(dealScore),
      medianPrice: Math.round(med),
      discountPct: parseFloat(discountPct.toFixed(1)),
      discountAmt: Math.round(discountAmt),
      medianSamples: samples,
    };
  });

  // 5. Sort deals view: highest dealScore first, then by price asc for ties
  const deals = enriched
    .filter(l => l.dealScore && l.dealScore > 0)
    .sort((a, b) => (b.dealScore - a.dealScore) || (a.price - b.price));

  // 6. Write output
  fs.writeFileSync(OUT_FILE, JSON.stringify(enriched, null, 2), "utf8");

  // 7. Write a lightweight stats file (used by /api/deals-stats)
  const stats = {
    generatedAt:   new Date().toISOString(),
    totalListings: allListings.length,
    uniqueRefs:    refMedian.size,
    scoredListings: scored,
    topDeals: deals.slice(0, 20).map(l => ({
      id:           l.id,
      source:       l.source,
      title:        l.title,
      ref:          l.ref,
      price:        l.price,
      medianPrice:  l.medianPrice,
      dealScore:    l.dealScore,
      discountPct:  l.discountPct,
      discountAmt:  l.discountAmt,
      url:          l.url,
    })),
    medianByRef: Object.fromEntries(
      [...refMedian.entries()].map(([ref, med]) => [ref, {
        median:  Math.round(med),
        samples: refSamples.get(ref),
      }])
    ),
  };

  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2), "utf8");

  console.log(
    `Done in ${Date.now() - t0}ms — ${scored} deal listings scored, ` +
    `top deal: ${deals[0]?.dealScore ?? 0}% off (${deals[0]?.title ?? "n/a"})`
  );

  return { enriched, deals, stats };
}

// ─── entry point ────────────────────────────────────────────────────────────

if (require.main === module) {
  run();
} else {
  module.exports = { run, normaliseRef };
}
