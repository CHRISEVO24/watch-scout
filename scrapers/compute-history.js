/**
 * compute-history.js
 *
 * Reads data/chrono24-history.json (100K records) and builds:
 *
 *   data/history-index.json
 *     Keyed by c24 listing id.  Value = { ref, brand, sparkline: [{date, price}] }
 *     Sparkline points are sorted oldest→newest, deduplicated by date (day),
 *     and pruned to at most 30 points (roughly one per week over 6 months).
 *
 *   data/history-ref-index.json
 *     Keyed by normalised ref.  Value = { ref, brand, sparkline: [{date, price}] }
 *     Used as fallback when a listing doesn't have a Chrono24 id.
 *
 * Runs standalone:  node scrapers/compute-history.js
 * Or required from server.js.
 */

"use strict";

const fs   = require("fs");
const path = require("path");

const DATA_DIR        = path.join(__dirname, "..", "data");
const HISTORY_FILE    = path.join(DATA_DIR, "chrono24-history.json");
const ID_INDEX_FILE   = path.join(DATA_DIR, "history-index.json");
const REF_INDEX_FILE  = path.join(DATA_DIR, "history-ref-index.json");

// ─── helpers ────────────────────────────────────────────────────────────────

function normaliseRef(ref) {
  if (!ref || typeof ref !== "string") return null;
  return ref.toUpperCase().replace(/[\s\-\/_.]/g, "").trim() || null;
}

/** ISO date string → "YYYY-MM-DD" */
function toDateStr(isoStr) {
  if (!isoStr) return null;
  return isoStr.slice(0, 10);
}

/**
 * Given an array of { date, price } points (may have duplicates per day),
 * collapse to one point per day (average price), sort oldest→newest,
 * then thin to at most maxPoints evenly-spaced points.
 */
function buildSparkline(rawPoints, maxPoints = 30) {
  if (!rawPoints || rawPoints.length === 0) return [];

  // Collapse to one price per date (average)
  const byDate = new Map();
  for (const { date, price } of rawPoints) {
    if (!date || typeof price !== "number" || price <= 0) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(price);
  }

  const collapsed = [...byDate.entries()]
    .map(([date, prices]) => ({
      date,
      price: Math.round(prices.reduce((s, p) => s + p, 0) / prices.length),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (collapsed.length <= maxPoints) return collapsed;

  // Thin evenly: always keep first and last
  const step = (collapsed.length - 1) / (maxPoints - 1);
  const thinned = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round(i * step);
    thinned.push(collapsed[Math.min(idx, collapsed.length - 1)]);
  }
  return thinned;
}

/**
 * Compute a simple linear trend for a sparkline.
 * Returns { slope, pctChange, direction } where:
 *   slope      = price per day (positive = rising, negative = falling)
 *   pctChange  = total % change first→last
 *   direction  = "up" | "down" | "flat"
 */
function computeTrend(sparkline) {
  if (!sparkline || sparkline.length < 2) {
    return { slope: 0, pctChange: 0, direction: "flat" };
  }

  const first = sparkline[0];
  const last  = sparkline[sparkline.length - 1];
  const pctChange = ((last.price - first.price) / first.price) * 100;
  const days = (new Date(last.date) - new Date(first.date)) / 86_400_000 || 1;
  const slope = (last.price - first.price) / days;
  const direction = pctChange > 1 ? "up" : pctChange < -1 ? "down" : "flat";

  return {
    slope:      parseFloat(slope.toFixed(2)),
    pctChange:  parseFloat(pctChange.toFixed(1)),
    direction,
  };
}

// ─── main ───────────────────────────────────────────────────────────────────

function run() {
  const t0 = Date.now();

  if (!fs.existsSync(HISTORY_FILE)) {
    console.warn("chrono24-history.json not found — skipping compute-history");
    fs.writeFileSync(ID_INDEX_FILE,  JSON.stringify({}, null, 2), "utf8");
    fs.writeFileSync(REF_INDEX_FILE, JSON.stringify({}, null, 2), "utf8");
    return { idIndex: {}, refIndex: {} };
  }

  console.log("Reading chrono24-history.json …");
  const raw = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
  console.log(`  ${raw.length} records`);

  // ── build id-keyed buckets ──────────────────────────────────────────────
  // id-bucket: Map<c24-id, { ref, brand, points: [{date, price}] }>
  const idBuckets  = new Map();

  // ref-bucket: Map<normRef, { brand, points: [{date, price}] }>
  const refBuckets = new Map();

  for (const record of raw) {
    const { id, ref, brand, price, scrapedAt } = record;
    if (typeof price !== "number" || price <= 0) continue;

    const date   = toDateStr(scrapedAt);
    const normRef = normaliseRef(ref);
    if (!date) continue;

    // id bucket
    if (id) {
      if (!idBuckets.has(id)) {
        idBuckets.set(id, { ref, brand, points: [] });
      }
      idBuckets.get(id).points.push({ date, price });
    }

    // ref bucket
    if (normRef) {
      if (!refBuckets.has(normRef)) {
        refBuckets.set(normRef, { brand, ref, points: [] });
      }
      refBuckets.get(normRef).points.push({ date, price });
    }
  }

  console.log(`  ${idBuckets.size} unique listing ids`);
  console.log(`  ${refBuckets.size} unique refs`);

  // ── build id index ──────────────────────────────────────────────────────
  const idIndex = {};
  for (const [id, { ref, brand, points }] of idBuckets) {
    const sparkline = buildSparkline(points);
    if (sparkline.length < 2) continue;
    idIndex[id] = { ref, brand, sparkline, trend: computeTrend(sparkline) };
  }

  // ── build ref index ─────────────────────────────────────────────────────
  const refIndex = {};
  for (const [normRef, { brand, ref, points }] of refBuckets) {
    const sparkline = buildSparkline(points);
    if (sparkline.length < 2) continue;
    refIndex[normRef] = { brand, ref, sparkline, trend: computeTrend(sparkline) };
  }

  // ── write ────────────────────────────────────────────────────────────────
  fs.writeFileSync(ID_INDEX_FILE,  JSON.stringify(idIndex,  null, 2), "utf8");
  fs.writeFileSync(REF_INDEX_FILE, JSON.stringify(refIndex, null, 2), "utf8");

  const elapsed = Date.now() - t0;
  console.log(
    `Done in ${elapsed}ms — ` +
    `${Object.keys(idIndex).length} id entries, ` +
    `${Object.keys(refIndex).length} ref entries written`
  );

  return { idIndex, refIndex };
}

// ─── entry point ────────────────────────────────────────────────────────────

if (require.main === module) {
  run();
} else {
  module.exports = { run, normaliseRef, buildSparkline, computeTrend };
}
