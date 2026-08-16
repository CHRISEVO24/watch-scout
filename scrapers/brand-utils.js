const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const ROTATION_STATE_FILE = path.join(DATA_DIR, "brand-rotation-state.json");

function loadSafe(file) {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return [];
  }
}

function getInventoryBrands() {
  const inventory = loadSafe("inventory-latest.json");
  const brands = new Set();
  for (const item of inventory) {
    if (item.brand) brands.add(item.brand);
  }
  return Array.from(brands).sort();
}

function getRotationBrands(sourceName, allBrands, countPerRun) {
  if (allBrands.length === 0) return [];

  let state = {};
  if (fs.existsSync(ROTATION_STATE_FILE)) {
    try {
      state = JSON.parse(fs.readFileSync(ROTATION_STATE_FILE, "utf8"));
    } catch {
      state = {};
    }
  }

  const lastIndex = state[sourceName] || 0;
  const selected = [];
  for (let i = 0; i < countPerRun; i++) {
    selected.push(allBrands[(lastIndex + i) % allBrands.length]);
  }

  state[sourceName] = (lastIndex + countPerRun) % allBrands.length;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ROTATION_STATE_FILE, JSON.stringify(state, null, 2), "utf8");

  return selected;
}

function slugify(brand) {
  return brand
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // convert accented chars (o with umlaut -> o, e with accent -> e, etc.) instead of stripping them
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

module.exports = { getInventoryBrands, getRotationBrands, slugify };
