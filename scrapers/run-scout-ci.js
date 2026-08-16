const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { getInventoryBrands, getRotationBrands, slugify } = require("./brand-utils");

const DATA_DIR = path.join(__dirname, "..", "data");

function runScraper(scriptName, args) {
  return new Promise((resolve) => {
    execFile(
      "node",
      [path.join(__dirname, scriptName), ...args],
      { cwd: path.join(__dirname, ".."), timeout: 90000 },
      (err, stdout, stderr) => {
        if (err) {
          console.error(`${scriptName} failed:`, stderr || err.message);
          resolve({ ok: false, error: stderr || err.message });
        } else {
          console.log(stdout);
          resolve({ ok: true });
        }
      }
    );
  });
}

function loadSafe(file) {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return [];
  }
}

async function run() {
  console.log("=== Watch Scout CI Run: started ===");
  const stepResults = {};

  console.log("Step: Inventory (WPB + ECI)...");
  stepResults["Inventory-WPB"] = (await runScraper("load-inventory.js", [])).ok;
  stepResults["Inventory-ECI"] = (await runScraper("load-eci-inventory.js", [])).ok;

  const allBrands = getInventoryBrands();
  console.log(`Sweeping ${allBrands.length} brands from current inventory: ${allBrands.join(", ")}`);

  const fastSteps = [];
  for (const brand of allBrands) {
    const slug = slugify(brand);
    fastSteps.push({ name: `WatchRecon: ${brand}`, script: "watchrecon-scraper.js", args: [`--brand=${slug}`, "--days=7"] });
  }
  for (const brand of allBrands) {
    const slug = slugify(brand);
    fastSteps.push({ name: `Bob's Watches: ${brand}`, script: "bobswatches-scraper.js", args: [`--category=${slug}/watches-mens`] });
  }
  for (const brand of allBrands) {
    const slug = slugify(brand);
    fastSteps.push({ name: `European Watch: ${brand}`, script: "europeanwatch-scraper.js", args: [`--brand=${slug}`] });
  }
  for (const brand of allBrands) {
    fastSteps.push({ name: `eBay: ${brand}`, script: "ebay-scraper.js", args: [`--query=${brand} watch`] });
  }

  const slowSteps = [];
  const watchpatrolBrands = getRotationBrands("watchpatrol", allBrands, 2);
  for (const brand of watchpatrolBrands) {
    slowSteps.push({ name: `WatchPatrol: ${brand}`, script: "watchpatrol-scraper.js", args: [`--query=${brand}`] });
  }
  const chrono24Brands = getRotationBrands("chrono24", allBrands, 2);
  for (const brand of chrono24Brands) {
    slowSteps.push({ name: `Chrono24: ${brand}`, script: "chrono24-scraper.js", args: [`--query=${brand}`] });
  }
  const bezelBrands = getRotationBrands("bezel", allBrands, 2);
  for (const brand of bezelBrands) {
    const slug = slugify(brand);
    slowSteps.push({ name: `Bezel: ${brand}`, script: "bezel-scraper.js", args: [`--brand=${slug}`] });
  }

  const allSteps = [...fastSteps, ...slowSteps];
  for (const step of allSteps) {
    console.log(`Step: ${step.name}...`);
    const result = await runScraper(step.script, step.args);
    stepResults[step.name] = result.ok;
    if (!result.ok) console.error(`${step.name} failed —`, result.error);
  }

  console.log("Step: matching buyer leads...");
  stepResults["Matching"] = (await runScraper("match-buyer-leads.js", [])).ok;

  console.log("Step: merge...");
  stepResults["Merge"] = (await runScraper("merge.js", [])).ok;

  console.log("Step: build dashboard...");
  stepResults["BuildDashboard"] = (await runScraper("build-dashboard.js", [])).ok;

  const failed = Object.entries(stepResults).filter(([, ok]) => !ok).map(([name]) => name);
  console.log("\n=== Watch Scout CI Run: complete ===");
  console.log(`${Object.keys(stepResults).length - failed.length} of ${Object.keys(stepResults).length} steps succeeded.`);
  if (failed.length > 0) {
    console.log("Failed steps:", failed.join(", "));
  }
}

run().catch((err) => {
  console.error("CI run failed:", err.message);
  process.exit(1);
});
