const fs = require("fs");
const path = require("path");
const { classifyIntent } = require("./intent-classifier");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "buyer-matches.json");

function loadSafe(file) {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return [];
  }
}

function normalizeRef(ref) {
  if (!ref) return null;
  return String(ref).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function refFamily(normalizedRef) {
  if (!normalizedRef || normalizedRef.length < 5) return null;
  return normalizedRef.slice(0, 5);
}

function run() {
  const wpbInventory = loadSafe("inventory-latest.json");
  const eciInventory = loadSafe("eci-inventory-latest.json");
  const inventory = [...wpbInventory, ...eciInventory];
  if (inventory.length === 0) {
    console.error("No inventory found — run load-inventory.js and load-eci-inventory.js first.");
    process.exit(1);
  }
  console.log(`Combined inventory: ${wpbInventory.length} WPB Watch Co + ${eciInventory.length} ECI Jewelers = ${inventory.length} total.`);

  const fbgroups = loadSafe("fbgroups-latest.json");
  const whatsapp = loadSafe("whatsapp-latest.json");
  const inventoryconnect = loadSafe("inventoryconnect-latest.json");
  const candidateLeads = [...fbgroups, ...whatsapp, ...inventoryconnect];

  const buyLeads = candidateLeads.filter((lead) => {
    const intent = lead.intent || classifyIntent(lead.title);
    return intent === "buy";
  });

  console.log(`Found ${buyLeads.length} buy-intent leads to check against ${inventory.length} inventory items (${inventory.filter((i) => i.inStock).length} in stock).`);

  const inStockInventory = inventory.filter((i) => i.inStock);

  const matches = [];
  for (const lead of buyLeads) {
    const leadRef = normalizeRef(lead.ref);
    const leadFamily = refFamily(leadRef);

    let exactMatches = [];
    const familyMatches = [];

    for (const item of inStockInventory) {
      const itemRef = normalizeRef(item.ref);
      if (!leadRef || !itemRef) continue;

      if (leadRef === itemRef) {
        exactMatches.push(item);
      } else {
        const itemFamily = refFamily(itemRef);
        if (leadFamily && itemFamily && leadFamily === itemFamily) {
          familyMatches.push(item);
        }
      }
    }

    const itemsToReport = exactMatches.length > 0
      ? exactMatches.map((item) => ({ item, matchType: "ref" }))
      : familyMatches.slice(0, 3).map((item) => ({ item, matchType: "ref_family" }));

    for (const { item, matchType } of itemsToReport) {
      matches.push({
        id: `match-${lead.id}-${item.id}`,
        matchType,
        lead: {
          id: lead.id,
          source: lead.source,
          sourceDetail: lead.sourceDetail,
          title: lead.title,
          brand: lead.brand,
          model: lead.model,
          nickname: lead.nickname || null,
          ref: lead.ref,
          buyerName: lead.seller || null,
          url: lead.url || null,
        },
        inventoryItem: {
          id: item.id,
          store: item.store || "WPB Watch Co",
          name: item.name,
          brand: item.brand,
          model: item.model,
          ref: item.ref,
          price: item.price,
          dialColor: item.dialColor,
          url: item.url,
        },
        matchedAt: new Date().toISOString(),
      });
    }
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(matches, null, 2), "utf8");
  console.log(`Done. ${matches.length} sales opportunity matches written to data/buyer-matches.json`);

  if (matches.length > 0) {
    console.log("\nMatches found:");
    for (const m of matches) {
      console.log(`  [${m.matchType}] ${m.lead.buyerName || "Unknown"} (${m.lead.sourceDetail}) wants "${m.lead.title}" → you have "${m.inventoryItem.name}" ($${m.inventoryItem.price || "?"})`);
    }
  }
}

run();
