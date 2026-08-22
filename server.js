const express = require("express");
const path = require("path");
const fs = require("fs");
const { execFile, spawn } = require("child_process");
const { getInventoryBrands, getRotationBrands, slugify } = require("./scrapers/brand-utils");

const app = express();
const PORT = process.env.PORT || 4173;
const DATA_DIR = path.join(__dirname, "data");

app.use(express.static(__dirname));

function runScraper(scriptName, args) {
  return new Promise((resolve) => {
    execFile(
      "node",
      [path.join("scrapers", scriptName), ...args],
      { cwd: __dirname, timeout: 90000 },
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

function loadAllSources() {
  const watchrecon = loadSafe("watchrecon-latest.json");
  const watchpatrol = loadSafe("watchpatrol-latest.json");
  const chrono24 = loadSafe("chrono24-latest.json");
  const bobswatches = loadSafe("bobswatches-latest.json");
  const europeanwatch = loadSafe("europeanwatch-latest.json");
  const fbgroups = loadSafe("fbgroups-latest.json");
  const fbmarketplace = loadSafe("fbmarketplace-latest.json");
  const ebay = loadSafe("ebay-latest.json");
  const whatsapp = loadSafe("whatsapp-latest.json");
  const bezel = loadSafe("bezel-latest.json");

  const combined = [...watchrecon, ...watchpatrol, ...chrono24, ...bobswatches, ...europeanwatch, ...fbgroups, ...fbmarketplace, ...ebay, ...whatsapp, ...bezel].sort(
    (a, b) => (a.postedMinutesAgo ?? 99999) - (b.postedMinutesAgo ?? 99999)
  );

  return { combined, watchrecon, watchpatrol, chrono24, bobswatches, europeanwatch, fbgroups, fbmarketplace, ebay, whatsapp, bezel };
}

app.get("/api/search", async (req, res) => {
  const term = (req.query.q || "").toString().trim();

  if (!term) {
    return res.status(400).json({ error: "Provide a search term, e.g. ?q=rolex+daytona" });
  }

  console.log(`\nLive search requested: "${term}"`);

  const brandGuess = term.split(/\s+/)[0];

  const [watchreconResult, watchpatrolResult, chrono24Result, ebayResult] = await Promise.allSettled([
    runScraper("watchrecon-scraper.js", [`--brand=${brandGuess}`, "--days=14"]),
    runScraper("watchpatrol-scraper.js", [`--query=${term}`]),
    runScraper("chrono24-scraper.js", [`--query=${term}`]),
    runScraper("ebay-scraper.js", [`--query=${term}`]),
  ]);

  const { combined } = loadAllSources();
  fs.writeFileSync(path.join(DATA_DIR, "combined.json"), JSON.stringify(combined, null, 2), "utf8");

  res.json({
    term,
    watchreconOk: watchreconResult.status === "fulfilled" && watchreconResult.value.ok,
    watchpatrolOk: watchpatrolResult.status === "fulfilled" && watchpatrolResult.value.ok,
    chrono24Ok: chrono24Result.status === "fulfilled" && chrono24Result.value.ok,
    ebayOk: ebayResult.status === "fulfilled" && ebayResult.value.ok,
    count: combined.length,
    listings: combined,
  });
});

app.get("/api/run-scout", async (req, res) => {
  console.log("\n=== Run Scout: full refresh started ===");

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send("progress", { step: 1, total: 1, name: "Inventory" });
  console.log("Run Scout: Inventory...");
  const stepResults = {};
  const invResult = await runScraper("load-inventory.js", []);
  stepResults["Inventory"] = invResult.ok;

  const allBrands = getInventoryBrands();
  console.log(`Run Scout: sweeping ${allBrands.length} brands from current inventory: ${allBrands.join(", ")}`);

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
  slowSteps.push({ name: "InventoryConnect Marketplace", script: "inventoryconnect-scraper.js", args: [] });

  const allSteps = [...fastSteps, ...slowSteps];
  const totalSteps = allSteps.length + 2;

  for (let i = 0; i < allSteps.length; i++) {
    const step = allSteps[i];
    send("progress", { step: i + 2, total: totalSteps, name: step.name });
    console.log(`Run Scout: ${step.name}...`);
    const result = await runScraper(step.script, step.args);
    stepResults[step.name] = result.ok;
    if (!result.ok) console.error(`Run Scout: ${step.name} failed —`, result.error);
  }

  send("progress", { step: totalSteps, total: totalSteps, name: "Matching" });
  console.log("Run Scout: matching buyer leads...");
  const matchResult = await runScraper("match-buyer-leads.js", []);
  stepResults["Matching"] = matchResult.ok;

  const { combined, fbgroups, whatsapp } = loadAllSources();
  fs.writeFileSync(path.join(DATA_DIR, "combined.json"), JSON.stringify(combined, null, 2), "utf8");

  console.log("Run Scout: rebuilding dashboard...");
  const buildResult = await runScraper("build-dashboard.js", []);
  stepResults["BuildDashboard"] = buildResult.ok;

  const buyerMatches = loadSafe("buyer-matches.json");

  const liveAssistedTimestamps = [...fbgroups, ...whatsapp]
    .map((item) => item.scrapedAt)
    .filter(Boolean)
    .sort();
  const lastLiveSync = liveAssistedTimestamps.length > 0 ? liveAssistedTimestamps[liveAssistedTimestamps.length - 1] : null;

  console.log("=== Run Scout: complete ===\n");

  send("done", {
    stepResults,
    count: combined.length,
    listings: combined,
    buyerMatches,
    lastLiveSync,
  });
  res.end();
});

const { askUltron } = require("./scrapers/ultron-chat");
const { matchWtb } = require("./scrapers/wtb-matcher");

const WTB_FILE = path.join(DATA_DIR, "wtb-requests.json");
function loadWtbRequests() {
  if (!fs.existsSync(WTB_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(WTB_FILE, "utf8")); } catch { return []; }
}
function saveWtbRequests(requests) {
  fs.writeFileSync(WTB_FILE, JSON.stringify(requests, null, 2), "utf8");
}

app.post("/api/wtb/submit", express.json(), async (req, res) => {
  const { firstName, lastName, email, phone, brand, model, ref, budgetMax, condition, boxPapers, notes, source } = req.body;
  if (!brand || !email) return res.status(400).json({ ok: false, error: "brand and email required" });
  const requests = loadWtbRequests();
  const wtb = {
    id: Date.now().toString(),
    submittedAt: new Date().toISOString(),
    source: source || "manual",
    status: "new",
    client: { firstName, lastName, email, phone },
    watch: { brand, model, ref, budgetMax: budgetMax ? Number(budgetMax) : null, condition, boxPapers, notes },
    matches: null,
    sentAt: null,
  };
  try {
    wtb.matches = await matchWtb({ id: wtb.id, brand, model, ref, budgetMax: wtb.watch.budgetMax, keywords: notes });
    wtb.status = "matched";
  } catch(err) {
    console.error("WTB matching failed:", err.message);
    wtb.status = "match-failed";
  }
  requests.unshift(wtb);
  saveWtbRequests(requests);
  console.log(`[WTB] New request from ${firstName} ${lastName} (${email}) — ${brand} ${model || ""} ${ref || ""}`);
  res.json({ ok: true, id: wtb.id, matchCount: wtb.matches ? (wtb.matches.inventoryMatches.length + wtb.matches.marketMatches.length) : 0 });
});

app.get("/api/wtb/requests", (req, res) => {
  res.json({ requests: loadWtbRequests() });
});

app.post("/api/wtb/update", express.json(), (req, res) => {
  const { id, status, notes } = req.body;
  const requests = loadWtbRequests();
  const r = requests.find(r => r.id === id);
  if (!r) return res.status(404).json({ ok: false, error: "not found" });
  if (status) r.status = status;
  if (notes) r.internalNotes = notes;
  saveWtbRequests(requests);
  res.json({ ok: true });
});

app.post("/api/wtb/send", express.json(), async (req, res) => {
  const { id } = req.body;
  const requests = loadWtbRequests();
  const wtb = requests.find(r => r.id === id);
  if (!wtb) return res.status(404).json({ ok: false, error: "WTB request not found" });

  const c = wtb.client || {};
  const w = wtb.watch || {};
  const m = wtb.matches || { inventoryMatches: [], marketMatches: [], icMatches: [] };

  function fmtP(p) {
    if (!p) return "—";
    const n = parseFloat(String(p).replace(/[^0-9.]/g, ""));
    return isNaN(n) ? String(p) : "$" + Math.round(n).toLocaleString();
  }

  // Build HTML email body
  const invRows = m.inventoryMatches.map(m => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;">
        <strong style="color:#111;">${m.name || ""}</strong><br>
        <span style="color:#6b7280;font-size:13px;">${m.store}${m.ref ? " · Ref. " + m.ref : ""}</span>
      </td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;">
        <strong style="color:#92400e;font-size:16px;">${fmtP(m.price)}</strong><br>
        <a href="mailto:chris@wpbwatchco.com?subject=Interested in ${encodeURIComponent(m.name)}" style="font-size:12px;color:#2563eb;">Contact WPB Watch Co</a>
      </td>
    </tr>`).join("");

  const icRows = m.icMatches.map(m => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;vertical-align:top;">
        ${m.imageUrl ? `<img src="${m.imageUrl}" style="width:80px;height:80px;object-fit:cover;border-radius:6px;float:left;margin-right:10px;" onerror="this.style.display='none'">` : ""}
        <div style="overflow:hidden;">
          <strong style="color:#111;font-size:13px;">${m.name || ""}</strong><br>
          <span style="color:#6b7280;font-size:12px;">${m.seller || "Dealer"}${m.ref ? " · Ref. " + m.ref : ""}</span><br>
          <span style="color:#059669;font-size:12px;font-weight:600;">Available via WPB Watch Co</span>
        </div>
      </td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;vertical-align:top;white-space:nowrap;">
        <strong style="color:#92400e;font-size:16px;">${fmtP(m.price)}</strong><br>
        <a href="mailto:chris@wpbwatchco.com?subject=Interested in ${encodeURIComponent(m.name || '')}" style="font-size:12px;color:#2563eb;">Contact WPB Watch Co</a>
      </td>
    </tr>`).join("");

  const mktRows = m.marketMatches.slice(0, 8).map(m => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;">
        <strong style="color:#111;">${m.title || ""}</strong><br>
        <span style="color:#6b7280;font-size:13px;">${m.source}${m.ref ? " · Ref. " + m.ref : ""}${m.seller ? " · " + m.seller : ""}</span>
      </td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;">
        <strong style="color:#92400e;font-size:16px;">${fmtP(m.price)}</strong><br>
        ${m.url ? `<a href="${m.url}" style="font-size:12px;color:#2563eb;">View Listing</a>` : ""}
      </td>
    </tr>`).join("");

  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
    <!-- Header -->
    <div style="background:#0f1117;padding:24px 28px;">
      <div style="font-size:20px;font-weight:700;color:#c9a05b;">WPB Watch Co</div>
      <div style="font-size:13px;color:#9a9691;margin-top:2px;">West Palm Beach, FL · 844-972-9282 · chris@wpbwatchco.com</div>
    </div>
    <!-- Intro -->
    <div style="padding:24px 28px;border-bottom:1px solid #e5e7eb;">
      <p style="font-size:15px;color:#111;margin:0 0 8px;">Hi ${c.firstName || "there"},</p>
      <p style="font-size:14px;color:#374151;line-height:1.6;margin:0;">
        Thank you for your watch request. We've searched our inventory and the full pre-owned market for your 
        <strong>${w.brand || ""} ${w.model || ""} ${w.ref ? "· Ref. " + w.ref : ""}</strong>${w.budgetMax ? " (budget up to $" + Number(w.budgetMax).toLocaleString() + ")" : ""}. 
        Here's what we found:
      </p>
    </div>

    ${invRows ? `
    <!-- Our Inventory -->
    <div style="padding:20px 28px 0;">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#059669;margin-bottom:10px;">● Available in Our Inventory</div>
      <table style="width:100%;border-collapse:collapse;">${invRows}</table>
      <p style="font-size:12px;color:#6b7280;margin:8px 0 20px;">Contact us directly at <a href="mailto:chris@wpbwatchco.com" style="color:#2563eb;">chris@wpbwatchco.com</a> or call <a href="tel:8449729282" style="color:#2563eb;">844-972-9282</a> to arrange purchase.</p>
    </div>` : ""}

    ${icRows ? `
    <!-- IC Dealers -->
    <div style="padding:20px 28px 0;">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#0284c7;margin-bottom:10px;">● Available from Verified Dealers</div>
      <table style="width:100%;border-collapse:collapse;">${icRows}</table>
    </div>` : ""}

    ${mktRows ? `
    <!-- Market -->
    <div style="padding:20px 28px 0;">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;margin-bottom:10px;">● Market Listings</div>
      <table style="width:100%;border-collapse:collapse;">${mktRows}</table>
    </div>` : ""}

    <!-- Footer -->
    <div style="padding:24px 28px;background:#f9fafb;margin-top:24px;">
      <p style="font-size:13px;color:#6b7280;margin:0 0 6px;">Questions? We're here to help find exactly what you're looking for.</p>
      <p style="font-size:13px;color:#374151;margin:0;">
        <strong>WPB Watch Co</strong> · 1601 Forum Pl, West Palm Beach, FL 33401<br>
        <a href="tel:8449729282" style="color:#2563eb;">844-972-9282</a> · 
        <a href="mailto:chris@wpbwatchco.com" style="color:#2563eb;">chris@wpbwatchco.com</a>
      </p>
    </div>
  </div>
</body>
</html>`;

  // Generate PDF using Python/reportlab
  const totalMatches = m.inventoryMatches.length + m.icMatches.length + m.marketMatches.length;
  const pdfPath = require("path").join(require("os").tmpdir(), `wpb-wtb-${id}.pdf`);

  // Write PDF generation script to temp file and execute it
  const pdfScriptPath = require("path").join(require("os").tmpdir(), `wtb-pdf-${id}.py`);
  const invLines = m.inventoryMatches.map(m2 => {
    const nm = (m2.name||"").replace(/'/g, "").slice(0, 50);
    const st = (m2.store||"").replace(/'/g, "");
    const rf = m2.ref ? " Ref " + m2.ref.replace(/'/g,"") : "";
    const pr = fmtP(m2.price).replace(/'/g,"");
    return `inv_data.append(['${nm} ${st}${rf}', '${pr}', 'chris@wpbwatchco.com'])`;
  }).join("\n");
  const icLines = m.icMatches.map(m2 => {
    const nm = ((m2.name||m2.model||"")).replace(/'/g,"").slice(0,50);
    const sl = (m2.seller||"Dealer").replace(/'/g,"");
    const rf = m2.ref ? " Ref " + m2.ref.replace(/'/g,"") : "";
    const pr = fmtP(m2.price).replace(/'/g,"");
    return `ic_data.append(['${nm}${rf}', '${pr}', '${sl}'])`;
  }).join("\n");
  const mktLines = m.marketMatches.slice(0,8).map(m2 => {
    const nm = ((m2.title||m2.name||"")).replace(/'/g,"").slice(0,50);
    const src = (m2.source||"").replace(/'/g,"");
    const rf = m2.ref ? " Ref " + m2.ref.replace(/'/g,"") : "";
    const pr = fmtP(m2.price).replace(/'/g,"");
    return `mkt_data.append(['${nm}${rf}', '${pr}', '${src}'])`;
  }).join("\n");

  const pdfScript = [
    "from reportlab.lib.pagesizes import letter",
    "from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle",
    "from reportlab.lib.colors import HexColor, white",
    "from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable",
    "from reportlab.lib.units import inch",
    `doc = SimpleDocTemplate('${pdfPath}', pagesize=letter, leftMargin=0.75*inch, rightMargin=0.75*inch, topMargin=0.75*inch, bottomMargin=0.75*inch)`,
    "styles = getSampleStyleSheet()",
    "brass = HexColor('#c9a05b')",
    "gray = HexColor('#6b7280')",
    "green = HexColor('#059669')",
    "blue = HexColor('#0284c7')",
    "title_s = ParagraphStyle('t', fontSize=20, fontName='Helvetica-Bold', textColor=brass, spaceAfter=4)",
    "sub_s = ParagraphStyle('s', fontSize=11, fontName='Helvetica', textColor=gray, spaceAfter=16)",
    "h2_s = ParagraphStyle('h2', fontSize=11, fontName='Helvetica-Bold', spaceBefore=14, spaceAfter=8)",
    "body_s = ParagraphStyle('b', fontSize=10, fontName='Helvetica', leading=14, spaceAfter=8)",
    "small_s = ParagraphStyle('sm', fontSize=9, fontName='Helvetica', textColor=gray, leading=12)",
    "story = []",
    "story.append(Paragraph('WPB Watch Co', title_s))",
    "story.append(Paragraph('1601 Forum Pl, West Palm Beach, FL 33401 | 844-972-9282 | chris@wpbwatchco.com', sub_s))",
    "story.append(HRFlowable(width='100%', thickness=1, color=brass, spaceAfter=12))",
    "story.append(Paragraph('Watch Request Results', h2_s))",
    `story.append(Paragraph('Prepared for: ${c.firstName||""} ${c.lastName||""} (${c.email})', body_s))`,
    `story.append(Paragraph('Looking for: ${w.brand||""} ${w.model||""} ${w.ref?"Ref. "+w.ref:""}', body_s))`,
    `story.append(Paragraph('Total matches found: ${totalMatches}', body_s))`,
    "story.append(Spacer(1, 12))",
  ];

  if (m.inventoryMatches.length) {
    pdfScript.push(
      "story.append(HRFlowable(width='100%', thickness=0.5, color=HexColor('#e5e7eb'), spaceAfter=8))",
      "story.append(Paragraph('AVAILABLE IN OUR INVENTORY', ParagraphStyle('l1', fontSize=9, fontName='Helvetica-Bold', textColor=green, spaceAfter=8)))",
      "inv_data = [['Watch', 'Price', 'Contact']]",
      invLines,
      "inv_t = Table(inv_data, colWidths=[3.5*inch, 1.2*inch, 2.1*inch])",
      "inv_t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),HexColor('#f0fdf4')),('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),('FONTSIZE',(0,0),(-1,-1),9),('GRID',(0,0),(-1,-1),0.5,HexColor('#e5e7eb')),('PADDING',(0,0),(-1,-1),6)]))",
      "story.append(inv_t)",
      "story.append(Spacer(1,12))"
    );
  }
  if (m.icMatches.length) {
    pdfScript.push(
      "story.append(Paragraph('AVAILABLE FROM VERIFIED DEALERS', ParagraphStyle('l2', fontSize=9, fontName='Helvetica-Bold', textColor=blue, spaceAfter=8)))",
      "ic_data = [['Watch', 'Price', 'Seller']]",
      icLines,
      "ic_t = Table(ic_data, colWidths=[3.5*inch, 1.2*inch, 2.1*inch])",
      "ic_t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),HexColor('#eff6ff')),('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),('FONTSIZE',(0,0),(-1,-1),9),('GRID',(0,0),(-1,-1),0.5,HexColor('#e5e7eb')),('PADDING',(0,0),(-1,-1),6)]))",
      "story.append(ic_t)",
      "story.append(Spacer(1,12))"
    );
  }
  if (m.marketMatches.length) {
    pdfScript.push(
      "story.append(Paragraph('MARKET LISTINGS', ParagraphStyle('l3', fontSize=9, fontName='Helvetica-Bold', textColor=gray, spaceAfter=8)))",
      "mkt_data = [['Watch', 'Price', 'Source']]",
      mktLines,
      "mkt_t = Table(mkt_data, colWidths=[3.5*inch, 1.2*inch, 2.1*inch])",
      "mkt_t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),HexColor('#f9fafb')),('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),('FONTSIZE',(0,0),(-1,-1),9),('GRID',(0,0),(-1,-1),0.5,HexColor('#e5e7eb')),('PADDING',(0,0),(-1,-1),6)]))",
      "story.append(mkt_t)"
    );
  }
  pdfScript.push(
    "story.append(Spacer(1,20))",
    "story.append(HRFlowable(width='100%', thickness=0.5, color=brass, spaceAfter=8))",
    "story.append(Paragraph('WPB Watch Co | West Palm Beach, FL | 844-972-9282 | chris@wpbwatchco.com', small_s))",
    "doc.build(story)",
    `print('PDF_OK:${pdfPath}')`
  );

  require("fs").writeFileSync(pdfScriptPath, pdfScript.join("\n"), "utf8");


  let pdfOk = false;
  try {
    const { execSync } = require("child_process");
    const result = execSync(`python3 ${pdfScriptPath}`, { timeout: 30000 }).toString();
    pdfOk = result.includes("PDF_OK:");
    console.log("[WTB] PDF result:", result.trim());
  } catch(e) {
    console.error("[WTB] PDF generation failed:", e.message);
  }

  // Return HTML + PDF path for Gmail draft creation via Claude
  wtb.sentAt = new Date().toISOString();
  wtb.status = "sent";
  requests.find(r => r.id === id) && Object.assign(requests.find(r => r.id === id), { sentAt: wtb.sentAt, status: "sent" });
  saveWtbRequests(requests);

  res.json({
    ok: true,
    clientEmail: c.email,
    clientName: `${c.firstName || ""} ${c.lastName || ""}`.trim(),
    subject: `Watch Request Results — ${w.brand || ""} ${w.model || ""} ${w.ref ? "Ref. " + w.ref : ""}`.trim(),
    htmlBody,
    pdfPath: pdfOk ? pdfPath : null,
    totalMatches,
  });
});

// Serve generated PDF as base64 for email attachment
app.get("/api/wtb/pdf", (req, res) => {
  const { path: pdfPath } = req.query;
  if (!pdfPath || !pdfPath.includes("wpb-wtb-")) return res.status(400).json({ ok: false, error: "invalid path" });
  if (!fs.existsSync(pdfPath)) return res.status(404).json({ ok: false, error: "PDF not found" });
  const base64 = fs.readFileSync(pdfPath).toString("base64");
  res.json({ ok: true, base64 });
});

// Save draft HTML to temp file for manual sending
app.post("/api/wtb/draft", express.json(), async (req, res) => {
  const { to, subject, htmlBody, pdfBase64, totalMatches } = req.body;
  if (!to || !subject) return res.status(400).json({ ok: false, error: "to and subject required" });

  try {
    const os = require("os");
    const draftId = Date.now().toString();

    // Save HTML email to temp file
    const htmlPath = path.join(os.tmpdir(), `wpb-draft-${draftId}.html`);
    fs.writeFileSync(htmlPath, htmlBody, "utf8");

    // Save PDF base64 to file if present
    let pdfSavedPath = null;
    if (pdfBase64) {
      pdfSavedPath = path.join(os.tmpdir(), `wpb-draft-${draftId}.pdf`);
      fs.writeFileSync(pdfSavedPath, Buffer.from(pdfBase64, "base64"));
    }

    // Use nodemailer to create a draft via Gmail SMTP
    // For now, store draft info and return compose URL
    const drafts = fs.existsSync(path.join(DATA_DIR, "wtb-drafts.json"))
      ? JSON.parse(fs.readFileSync(path.join(DATA_DIR, "wtb-drafts.json"), "utf8"))
      : [];

    const draft = { id: draftId, to, subject, htmlPath, pdfPath: pdfSavedPath, createdAt: new Date().toISOString(), totalMatches };
    drafts.unshift(draft);
    fs.writeFileSync(path.join(DATA_DIR, "wtb-drafts.json"), JSON.stringify(drafts.slice(0, 50), null, 2));

    // Build Gmail compose URL (opens pre-filled compose window)
    const gmailComposeUrl = "https://mail.google.com/mail/?view=cm&fs=1" +
      "&to=" + encodeURIComponent(to) +
      "&su=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent("Please see the attached watch request results. HTML version saved at: " + htmlPath + (pdfSavedPath ? "\nPDF: " + pdfSavedPath : ""));

    console.log("[WTB Draft] Saved draft", draftId, "for", to, "| HTML:", htmlPath);
    res.json({ ok: true, draftId, htmlPath, pdfPath: pdfSavedPath, gmailComposeUrl, totalMatches });
  } catch(err) {
    console.error("[WTB Draft] Error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/wtb/sync-vercel", async (req, res) => {
  try {
    const axios = require("axios");
    const r = await axios.get("https://watch-scout-seven.vercel.app/api/wtb-pending", { timeout: 10000 });
    const pending = r.data.submissions || [];
    if (!pending.length) return res.json({ ok: true, added: 0 });

    const requests = loadWtbRequests();
    const existingIds = new Set(requests.map(r => r.vercelId || r.id));
    let added = 0;

    for (const sub of pending) {
      if (existingIds.has(sub.id)) continue;
      const wtb = {
        id: Date.now().toString() + added,
        vercelId: sub.id,
        submittedAt: sub.submittedAt || new Date().toISOString(),
        source: "public-form",
        status: "new",
        client: { firstName: sub.firstName, lastName: sub.lastName, email: sub.email, phone: sub.phone },
        watch: { brand: sub.brand, model: sub.model, ref: sub.ref, budgetMax: sub.budgetMax, condition: sub.condition, boxPapers: sub.boxPapers, notes: sub.notes },
        matches: null,
      };
      try {
        const { matchWtb } = require("./scrapers/wtb-matcher");
        wtb.matches = await matchWtb({ id: wtb.id, ...wtb.watch });
        wtb.status = "matched";
      } catch(e) { wtb.status = "match-failed"; }
      requests.unshift(wtb);
      added++;
    }

    if (added > 0) saveWtbRequests(requests);
    res.json({ ok: true, added });
  } catch(err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/wtb/rematch", express.json(), async (req, res) => {
  const { id } = req.body;
  const requests = loadWtbRequests();
  const wtb = requests.find(r => r.id === id);
  if (!wtb) return res.status(404).json({ ok: false, error: "not found" });
  try {
    wtb.matches = await matchWtb({ id: wtb.id, ...wtb.watch });
    wtb.status = "matched";
    saveWtbRequests(requests);
    res.json({ ok: true, matches: wtb.matches });
  } catch(err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
function saveWtbRequests(requests) {
  fs.writeFileSync(WTB_FILE, JSON.stringify(requests, null, 2), "utf8");
}

// Submit WTB (from public form or Watch Scout manual entry)
app.post("/api/wtb/submit", express.json(), async (req, res) => {
  const { firstName, lastName, email, phone, brand, model, ref, budgetMax, condition, boxPapers, notes, source } = req.body;
  if (!brand || !email) return res.status(400).json({ ok: false, error: "brand and email required" });

  const requests = loadWtbRequests();
  const wtb = {
    id: Date.now().toString(),
    submittedAt: new Date().toISOString(),
    source: source || "manual",
    status: "new",
    client: { firstName, lastName, email, phone },
    watch: { brand, model, ref, budgetMax: budgetMax ? Number(budgetMax) : null, condition, boxPapers, notes },
    matches: null,
    sentAt: null,
  };

  // Auto-run matching
  try {
    wtb.matches = await matchWtb({ id: wtb.id, brand, model, ref, budgetMax: wtb.watch.budgetMax, keywords: notes });
    wtb.status = "matched";
  } catch(err) {
    console.error("WTB matching failed:", err.message);
    wtb.status = "match-failed";
  }

  requests.unshift(wtb);
  saveWtbRequests(requests);
  console.log(`[WTB] New request from ${firstName} ${lastName} (${email}) — ${brand} ${model || ''} ${ref || ''}}`);
  res.json({ ok: true, id: wtb.id, matchCount: wtb.matches ? (wtb.matches.inventoryMatches.length + wtb.matches.marketMatches.length) : 0 });
});

// Get all WTB requests
app.get("/api/wtb/requests", (req, res) => {
  res.json({ requests: loadWtbRequests() });
});

// Update WTB status
app.post("/api/wtb/update", express.json(), (req, res) => {
  const { id, status, notes } = req.body;
  const requests = loadWtbRequests();
  const req2 = requests.find(r => r.id === id);
  if (!req2) return res.status(404).json({ ok: false, error: "not found" });
  if (status) req2.status = status;
  if (notes) req2.internalNotes = notes;
  saveWtbRequests(requests);
  res.json({ ok: true });
});

// Re-run matching for a WTB
app.post("/api/wtb/send", express.json(), async (req, res) => {
  const { id } = req.body;
  const requests = loadWtbRequests();
  const wtb = requests.find(r => r.id === id);
  if (!wtb) return res.status(404).json({ ok: false, error: "WTB request not found" });

  const c = wtb.client || {};
  const w = wtb.watch || {};
  const m = wtb.matches || { inventoryMatches: [], marketMatches: [], icMatches: [] };

  function fmtP(p) {
    if (!p) return "—";
    const n = parseFloat(String(p).replace(/[^0-9.]/g, ""));
    return isNaN(n) ? String(p) : "$" + Math.round(n).toLocaleString();
  }

  // Build HTML email body
  const invRows = m.inventoryMatches.map(m => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;">
        <strong style="color:#111;">${m.name || ""}</strong><br>
        <span style="color:#6b7280;font-size:13px;">${m.store}${m.ref ? " · Ref. " + m.ref : ""}</span>
      </td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;">
        <strong style="color:#92400e;font-size:16px;">${fmtP(m.price)}</strong><br>
        <a href="mailto:chris@wpbwatchco.com?subject=Interested in ${encodeURIComponent(m.name)}" style="font-size:12px;color:#2563eb;">Contact WPB Watch Co</a>
      </td>
    </tr>`).join("");

  const icRows = m.icMatches.map(m => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;vertical-align:top;">
        ${m.imageUrl ? `<img src="${m.imageUrl}" style="width:80px;height:80px;object-fit:cover;border-radius:6px;float:left;margin-right:10px;" onerror="this.style.display='none'">` : ""}
        <div style="overflow:hidden;">
          <strong style="color:#111;font-size:13px;">${m.name || ""}</strong><br>
          <span style="color:#6b7280;font-size:12px;">${m.seller || "Dealer"}${m.ref ? " · Ref. " + m.ref : ""}</span><br>
          <span style="color:#059669;font-size:12px;font-weight:600;">Available via WPB Watch Co</span>
        </div>
      </td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;vertical-align:top;white-space:nowrap;">
        <strong style="color:#92400e;font-size:16px;">${fmtP(m.price)}</strong><br>
        <a href="mailto:chris@wpbwatchco.com?subject=Interested in ${encodeURIComponent(m.name || '')}" style="font-size:12px;color:#2563eb;">Contact WPB Watch Co</a>
      </td>
    </tr>`).join("");

  const mktRows = m.marketMatches.slice(0, 8).map(m => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;">
        <strong style="color:#111;">${m.title || ""}</strong><br>
        <span style="color:#6b7280;font-size:13px;">${m.source}${m.ref ? " · Ref. " + m.ref : ""}${m.seller ? " · " + m.seller : ""}</span>
      </td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;">
        <strong style="color:#92400e;font-size:16px;">${fmtP(m.price)}</strong><br>
        ${m.url ? `<a href="${m.url}" style="font-size:12px;color:#2563eb;">View Listing</a>` : ""}
      </td>
    </tr>`).join("");

  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
    <!-- Header -->
    <div style="background:#0f1117;padding:24px 28px;">
      <div style="font-size:20px;font-weight:700;color:#c9a05b;">WPB Watch Co</div>
      <div style="font-size:13px;color:#9a9691;margin-top:2px;">West Palm Beach, FL · 844-972-9282 · chris@wpbwatchco.com</div>
    </div>
    <!-- Intro -->
    <div style="padding:24px 28px;border-bottom:1px solid #e5e7eb;">
      <p style="font-size:15px;color:#111;margin:0 0 8px;">Hi ${c.firstName || "there"},</p>
      <p style="font-size:14px;color:#374151;line-height:1.6;margin:0;">
        Thank you for your watch request. We've searched our inventory and the full pre-owned market for your 
        <strong>${w.brand || ""} ${w.model || ""} ${w.ref ? "· Ref. " + w.ref : ""}</strong>${w.budgetMax ? " (budget up to $" + Number(w.budgetMax).toLocaleString() + ")" : ""}. 
        Here's what we found:
      </p>
    </div>

    ${invRows ? `
    <!-- Our Inventory -->
    <div style="padding:20px 28px 0;">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#059669;margin-bottom:10px;">● Available in Our Inventory</div>
      <table style="width:100%;border-collapse:collapse;">${invRows}</table>
      <p style="font-size:12px;color:#6b7280;margin:8px 0 20px;">Contact us directly at <a href="mailto:chris@wpbwatchco.com" style="color:#2563eb;">chris@wpbwatchco.com</a> or call <a href="tel:8449729282" style="color:#2563eb;">844-972-9282</a> to arrange purchase.</p>
    </div>` : ""}

    ${icRows ? `
    <!-- IC Dealers -->
    <div style="padding:20px 28px 0;">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#0284c7;margin-bottom:10px;">● Available from Verified Dealers</div>
      <table style="width:100%;border-collapse:collapse;">${icRows}</table>
    </div>` : ""}

    ${mktRows ? `
    <!-- Market -->
    <div style="padding:20px 28px 0;">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;margin-bottom:10px;">● Market Listings</div>
      <table style="width:100%;border-collapse:collapse;">${mktRows}</table>
    </div>` : ""}

    <!-- Footer -->
    <div style="padding:24px 28px;background:#f9fafb;margin-top:24px;">
      <p style="font-size:13px;color:#6b7280;margin:0 0 6px;">Questions? We're here to help find exactly what you're looking for.</p>
      <p style="font-size:13px;color:#374151;margin:0;">
        <strong>WPB Watch Co</strong> · 1601 Forum Pl, West Palm Beach, FL 33401<br>
        <a href="tel:8449729282" style="color:#2563eb;">844-972-9282</a> · 
        <a href="mailto:chris@wpbwatchco.com" style="color:#2563eb;">chris@wpbwatchco.com</a>
      </p>
    </div>
  </div>
</body>
</html>`;

  // Generate PDF using Python/reportlab
  const totalMatches = m.inventoryMatches.length + m.icMatches.length + m.marketMatches.length;
  const pdfPath = require("path").join(require("os").tmpdir(), `wpb-wtb-${id}.pdf`);

  const pythonScript = `
import sys
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor, black, white
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.lib.units import inch
from reportlab.lib import colors

doc = SimpleDocTemplate("${pdfPath}", pagesize=letter, leftMargin=0.75*inch, rightMargin=0.75*inch, topMargin=0.75*inch, bottomMargin=0.75*inch)
styles = getSampleStyleSheet()

brass = HexColor("#c9a05b")
dark = HexColor("#0f1117")
gray = HexColor("#6b7280")
green = HexColor("#059669")
blue = HexColor("#0284c7")

title_style = ParagraphStyle("title", fontSize=20, fontName="Helvetica-Bold", textColor=brass, spaceAfter=4)
sub_style = ParagraphStyle("sub", fontSize=11, fontName="Helvetica", textColor=gray, spaceAfter=16)
h2_style = ParagraphStyle("h2", fontSize=11, fontName="Helvetica-Bold", textColor=dark, spaceBefore=14, spaceAfter=8)
body_style = ParagraphStyle("body", fontSize=10, fontName="Helvetica", textColor=dark, leading=14, spaceAfter=8)
small_style = ParagraphStyle("small", fontSize=9, fontName="Helvetica", textColor=gray, leading=12)
label_style = ParagraphStyle("label", fontSize=9, fontName="Helvetica-Bold", textColor=green)

story = []

# Header
story.append(Paragraph("WPB Watch Co", title_style))
story.append(Paragraph("1601 Forum Pl, West Palm Beach, FL 33401 | 844-972-9282 | chris@wpbwatchco.com", sub_style))
story.append(HRFlowable(width="100%", thickness=1, color=brass, spaceAfter=12))

# Request summary
story.append(Paragraph("Watch Request Results", h2_style))
story.append(Paragraph(f"Prepared for: ${c.firstName || ""} ${c.lastName || ""} (${c.email})", body_style))
story.append(Paragraph(f"Looking for: ${w.brand || ""} ${w.model || ""} ${w.ref ? "Ref. " + w.ref : ""}", body_style))
${w.budgetMax ? `story.append(Paragraph(f"Budget: up to $${Number(w.budgetMax).toLocaleString()}", body_style))` : ""}
story.append(Paragraph(f"Total matches found: ${totalMatches}", body_style))
story.append(Spacer(1, 12))

${m.inventoryMatches.length ? `
story.append(HRFlowable(width="100%", thickness=0.5, color=HexColor("#e5e7eb"), spaceAfter=8))
story.append(Paragraph("AVAILABLE IN OUR INVENTORY", ParagraphStyle("lbl", fontSize=9, fontName="Helvetica-Bold", textColor=green, spaceAfter=8)))
inv_data = [["Watch", "Price", "Contact"]]
${m.inventoryMatches.map(m => `inv_data.append(["${(m.name||"").replace(/"/g,"'").slice(0,50)} ${m.store}${m.ref?" · Ref. "+m.ref:""}", "${fmtP(m.price)}", "chris@wpbwatchco.com"])`).join("\n")}
inv_table = Table(inv_data, colWidths=[3.5*inch, 1.2*inch, 2.1*inch])
inv_table.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), HexColor("#f0fdf4")),
    ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
    ("FONTSIZE", (0,0), (-1,-1), 9),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [white, HexColor("#f9fafb")]),
    ("GRID", (0,0), (-1,-1), 0.5, HexColor("#e5e7eb")),
    ("PADDING", (0,0), (-1,-1), 6),
    ("VALIGN", (0,0), (-1,-1), "TOP"),
]))
story.append(inv_table)
story.append(Spacer(1, 12))
` : ""}

${m.icMatches.length ? `
story.append(HRFlowable(width="100%", thickness=0.5, color=HexColor("#e5e7eb"), spaceAfter=8))
story.append(Paragraph("AVAILABLE FROM VERIFIED DEALERS", ParagraphStyle("lbl2", fontSize=9, fontName="Helvetica-Bold", textColor=blue, spaceAfter=8)))
ic_data = [["Watch", "Price", "Seller"]]
${m.icMatches.map(m => `ic_data.append(["${((m.name||"").replace(/"/g,"'")).slice(0,50)}${m.ref?" · Ref. "+m.ref:""}", "${fmtP(m.price)}", "${(m.seller||"Dealer").replace(/"/g,"'")}"])`).join("\n")}
ic_table = Table(ic_data, colWidths=[3.5*inch, 1.2*inch, 2.1*inch])
ic_table.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), HexColor("#eff6ff")),
    ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
    ("FONTSIZE", (0,0), (-1,-1), 9),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [white, HexColor("#f9fafb")]),
    ("GRID", (0,0), (-1,-1), 0.5, HexColor("#e5e7eb")),
    ("PADDING", (0,0), (-1,-1), 6),
    ("VALIGN", (0,0), (-1,-1), "TOP"),
]))
story.append(ic_table)
story.append(Spacer(1, 12))
` : ""}

${m.marketMatches.slice(0,8).length ? `
story.append(HRFlowable(width="100%", thickness=0.5, color=HexColor("#e5e7eb"), spaceAfter=8))
story.append(Paragraph("MARKET LISTINGS", ParagraphStyle("lbl3", fontSize=9, fontName="Helvetica-Bold", textColor=gray, spaceAfter=8)))
mkt_data = [["Watch", "Price", "Source"]]
${m.marketMatches.slice(0,8).map(m => `mkt_data.append(["${((m.title||"").replace(/"/g,"'")).slice(0,50)}${m.ref?" · Ref. "+m.ref:""}", "${fmtP(m.price)}", "${(m.source||"").replace(/"/g,"'")}"])`).join("\n")}
mkt_table = Table(mkt_data, colWidths=[3.5*inch, 1.2*inch, 2.1*inch])
mkt_table.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), HexColor("#f9fafb")),
    ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
    ("FONTSIZE", (0,0), (-1,-1), 9),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [white, HexColor("#f9fafb")]),
    ("GRID", (0,0), (-1,-1), 0.5, HexColor("#e5e7eb")),
    ("PADDING", (0,0), (-1,-1), 6),
    ("VALIGN", (0,0), (-1,-1), "TOP"),
]))
story.append(mkt_table)
` : ""}

story.append(Spacer(1, 20))
story.append(HRFlowable(width="100%", thickness=0.5, color=brass, spaceAfter=8))
story.append(Paragraph("WPB Watch Co | West Palm Beach, FL | 844-972-9282 | chris@wpbwatchco.com", small_style))

doc.build(story)
print("PDF_OK:" + "${pdfPath}")
`;

  let pdfOk = false;
  try {
    const { execSync } = require("child_process");
    const result = execSync(`python3 ${pdfScriptPath}`, { timeout: 30000 }).toString();
    pdfOk = result.includes("PDF_OK:");
    console.log("[WTB] PDF result:", result.trim());
  } catch(e) {
    console.error("[WTB] PDF generation failed:", e.message);
  }

  // Return HTML + PDF path for Gmail draft creation via Claude
  wtb.sentAt = new Date().toISOString();
  wtb.status = "sent";
  requests.find(r => r.id === id) && Object.assign(requests.find(r => r.id === id), { sentAt: wtb.sentAt, status: "sent" });
  saveWtbRequests(requests);

  res.json({
    ok: true,
    clientEmail: c.email,
    clientName: `${c.firstName || ""} ${c.lastName || ""}`.trim(),
    subject: `Watch Request Results — ${w.brand || ""} ${w.model || ""} ${w.ref ? "Ref. " + w.ref : ""}`.trim(),
    htmlBody,
    pdfPath: pdfOk ? pdfPath : null,
    totalMatches,
  });
});

// Serve generated PDF as base64 for email attachment
app.get("/api/wtb/pdf", (req, res) => {
  const { path: pdfPath } = req.query;
  if (!pdfPath || !pdfPath.includes("wpb-wtb-")) return res.status(400).json({ ok: false, error: "invalid path" });
  if (!fs.existsSync(pdfPath)) return res.status(404).json({ ok: false, error: "PDF not found" });
  const base64 = fs.readFileSync(pdfPath).toString("base64");
  res.json({ ok: true, base64 });
});

// Save draft HTML to temp file for manual sending
app.post("/api/wtb/draft", express.json(), async (req, res) => {
  const { to, subject, htmlBody, pdfBase64, totalMatches } = req.body;
  if (!to || !subject) return res.status(400).json({ ok: false, error: "to and subject required" });

  try {
    const os = require("os");
    const draftId = Date.now().toString();

    // Save HTML email to temp file
    const htmlPath = path.join(os.tmpdir(), `wpb-draft-${draftId}.html`);
    fs.writeFileSync(htmlPath, htmlBody, "utf8");

    // Save PDF base64 to file if present
    let pdfSavedPath = null;
    if (pdfBase64) {
      pdfSavedPath = path.join(os.tmpdir(), `wpb-draft-${draftId}.pdf`);
      fs.writeFileSync(pdfSavedPath, Buffer.from(pdfBase64, "base64"));
    }

    // Use nodemailer to create a draft via Gmail SMTP
    // For now, store draft info and return compose URL
    const drafts = fs.existsSync(path.join(DATA_DIR, "wtb-drafts.json"))
      ? JSON.parse(fs.readFileSync(path.join(DATA_DIR, "wtb-drafts.json"), "utf8"))
      : [];

    const draft = { id: draftId, to, subject, htmlPath, pdfPath: pdfSavedPath, createdAt: new Date().toISOString(), totalMatches };
    drafts.unshift(draft);
    fs.writeFileSync(path.join(DATA_DIR, "wtb-drafts.json"), JSON.stringify(drafts.slice(0, 50), null, 2));

    // Build Gmail compose URL (opens pre-filled compose window)
    const gmailComposeUrl = "https://mail.google.com/mail/?view=cm&fs=1" +
      "&to=" + encodeURIComponent(to) +
      "&su=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent("Please see the attached watch request results. HTML version saved at: " + htmlPath + (pdfSavedPath ? "\nPDF: " + pdfSavedPath : ""));

    console.log("[WTB Draft] Saved draft", draftId, "for", to, "| HTML:", htmlPath);
    res.json({ ok: true, draftId, htmlPath, pdfPath: pdfSavedPath, gmailComposeUrl, totalMatches });
  } catch(err) {
    console.error("[WTB Draft] Error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/wtb/sync-vercel", async (req, res) => {
  try {
    const axios = require("axios");
    const r = await axios.get("https://watch-scout-seven.vercel.app/api/wtb-pending", { timeout: 10000 });
    const pending = r.data.submissions || [];
    if (!pending.length) return res.json({ ok: true, added: 0 });

    const requests = loadWtbRequests();
    const existingIds = new Set(requests.map(r => r.vercelId || r.id));
    let added = 0;

    for (const sub of pending) {
      if (existingIds.has(sub.id)) continue;
      const wtb = {
        id: Date.now().toString() + added,
        vercelId: sub.id,
        submittedAt: sub.submittedAt || new Date().toISOString(),
        source: "public-form",
        status: "new",
        client: { firstName: sub.firstName, lastName: sub.lastName, email: sub.email, phone: sub.phone },
        watch: { brand: sub.brand, model: sub.model, ref: sub.ref, budgetMax: sub.budgetMax, condition: sub.condition, boxPapers: sub.boxPapers, notes: sub.notes },
        matches: null,
      };
      try {
        const { matchWtb } = require("./scrapers/wtb-matcher");
        wtb.matches = await matchWtb({ id: wtb.id, ...wtb.watch });
        wtb.status = "matched";
      } catch(e) { wtb.status = "match-failed"; }
      requests.unshift(wtb);
      added++;
    }

    if (added > 0) saveWtbRequests(requests);
    res.json({ ok: true, added });
  } catch(err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/wtb/rematch", express.json(), async (req, res) => {
  const { id } = req.body;
  const requests = loadWtbRequests();
  const wtb = requests.find(r => r.id === id);
  if (!wtb) return res.status(404).json({ ok: false, error: "not found" });
  try {
    wtb.matches = await matchWtb({ id: wtb.id, ...wtb.watch });
    wtb.status = "matched";
    saveWtbRequests(requests);
    res.json({ ok: true, matches: wtb.matches });
  } catch(err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/ecj-inventory", async (req, res) => {
  try {
    const axios = require("axios");
    const { data: history } = await axios.get("https://chrisevo24.github.io/ecj-tracker/history.json", { timeout: 20000 });
    const timestamps = Object.keys(history).sort();
    if (!timestamps.length) return res.json([]);
    const snapshot = history[timestamps[timestamps.length - 1]];
    const items = Object.values(snapshot).map(item => ({
      id: item.id,
      store: "ECJ Luxe Collection",
      name: item.name,
      brand: item.brand || null,
      ref: item.referenceNumber || null,
      referenceNumber: item.referenceNumber || null,
      productCode: item.productCode || null,
      price: item.price || null,
      inStock: item.inStock === true || (item.stockStatus || "").toLowerCase().includes("in stock"),
      stockStatus: item.stockStatus || null,
      year: item.year || null,
      image: item.image || null,
      imageUrl: item.image || null,
      url: item.url || null,
      description: item.description || null,
    }));
    res.json(items);
  } catch (err) {
    console.error("ECJ inventory fetch failed:", err.message);
    res.status(500).json([]);
  }
});

app.post("/api/ultron", express.json(), async (req, res) => {
  const question = (req.body && req.body.question || "").toString().trim();
  if (!question) {
    return res.status(400).json({ ok: false, error: "Provide a question." });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: "ANTHROPIC_API_KEY not set in .env" });
  }

  try {
    const answer = await askUltron(question, apiKey);
    res.json({ ok: true, answer });
  } catch (err) {
    console.error("Ultron request failed:", err.response ? err.response.data : err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Watch Scout server running.`);
  console.log(`Open: http://localhost:${PORT}/watch-scout-dashboard.html`);
});

// ─── WhatsApp Broadcaster ───────────────────────────────────────────────────
const wa = require("./scrapers/whatsapp-broadcaster");

app.get("/api/wa/status", (req, res) => {
  res.json({ status: wa.getStatus(), groups: wa.loadGroups() });
});

app.get("/api/wa/connect", (req, res) => {
  const status = wa.getStatus();
  if (status === "ready") return res.json({ ok: true, status: "ready" });
  if (status === "disconnected") wa.initClient();
  res.json({ ok: true, status: wa.getStatus() });
});

app.get("/api/wa/qr", (req, res) => {
  const qr = wa.getQR();
  if (qr) return res.json({ qr });
  res.json({ qr: null, status: wa.getStatus() });
});

app.get("/api/wa/sync-groups", async (req, res) => {
  try {
    const groups = await wa.syncGroups();
    res.json({ ok: true, groups });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

app.post("/api/wa/send", express.json(), async (req, res) => {
  const { groupIds, message, imageUrl, imagePath } = req.body;
  console.log("[SEND] imagePath:", imagePath, "imageUrl:", imageUrl);
  if (!groupIds || !groupIds.length || !message) {
    return res.status(400).json({ ok: false, error: "groupIds and message required" });
  }
  try {
    const results = await wa.sendToGroups(groupIds, message, imagePath || imageUrl || null);
    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Serve downloaded product images ─────────────────────────────────────────
app.get("/api/image/:filename", (req, res) => {
  const imgPath = require("path").join(require("os").tmpdir(), req.params.filename);
  if (!fs.existsSync(imgPath)) return res.status(404).json({ error: "Not found" });
  res.sendFile(imgPath);
});

// ── Fetch product image for WA attachment ────────────────────────────────────
const https = require("https");
const http = require("http");
const os = require("os");

app.get("/api/fetch-product-image", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ ok: false, error: "url required" });

  try {
    const axios = require("axios");

    // If URL is a direct image file, download it immediately — no scraping needed
    const isDirectImage = /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url);
    if (isDirectImage) {
      const imgResp = await axios.get(url, {
        responseType: "arraybuffer",
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 15000
      });
      const ext = url.split("?")[0].split(".").pop() || "jpg";
      const tmpPath = require("path").join(require("os").tmpdir(), `wa-img-${Date.now()}.${ext}`);
      require("fs").writeFileSync(tmpPath, imgResp.data);
      console.log(`[IMG] Direct image downloaded: ${tmpPath}`);
      return res.json({ ok: true, imagePath: tmpPath, imagePaths: [tmpPath], imageUrl: url, imageUrls: [url], count: 1 });
    }

    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Encoding": "identity"
      },
      maxRedirects: 5,
      responseType: "text"
    });
    const html = response.data;

    // Use data-large_image attributes from WooCommerce gallery (most reliable)
    const dataLargeImgs = [...html.matchAll(/data-large_image=["'](https?:\/\/[^"']+)["']/gi)]
      .map(m => m[1])
      .filter(u => !/-\d+x\d+\./.test(u));

    const seen = new Set();
    let imageUrls = [];
    for (const u of dataLargeImgs) {
      const name = u.split('/').pop();
      if (!seen.has(name)) { seen.add(name); imageUrls.push(u); }
    }

    // Fallback to og:image
    if (!imageUrls.length) {
      const wpbMatches = [...html.matchAll(/content="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi)]
        .map(m => m[1]).filter(u => !/-\d+x\d+\./.test(u));
      if (wpbMatches.length) imageUrls = [wpbMatches[0]];
    }

    // Limit to first 3
    imageUrls = imageUrls.slice(0, 3);

    if (!imageUrls.length) {
      return res.json({ ok: false, error: "No product images found" });
    }

    console.log(`[IMG] Found ${imageUrls.length} product image(s)`);

    // Download all images
    const imagePaths = [];
    for (let i = 0; i < imageUrls.length; i++) {
      try {
        const imgResp = await axios.get(imageUrls[i], {
          responseType: "arraybuffer",
          headers: { "User-Agent": "Mozilla/5.0" }
        });
        const ext = imageUrls[i].split("?")[0].split(".").pop() || "jpg";
        const tmpPath = require("path").join(require("os").tmpdir(), `wa-img-${Date.now()}-${i}.${ext}`);
        require("fs").writeFileSync(tmpPath, imgResp.data);
        imagePaths.push(tmpPath);
        console.log(`[IMG] Downloaded image ${i+1}: ${tmpPath}`);
      } catch(e) {
        console.warn(`[IMG] Failed image ${i+1}: ${e.message}`);
      }
    }

    if (!imagePaths.length) return res.json({ ok: false, error: "Failed to download images" });

    res.json({
      ok: true,
      imagePath: imagePaths[0],
      imagePaths: imagePaths,
      imageUrl: imageUrls[0],
      imageUrls: imageUrls,
      count: imagePaths.length
    });
  } catch (err) {
    console.error("[IMG] Error:", err.message);
    res.json({ ok: false, error: err.message });
  }
});


// ── Facebook Groups Broadcaster ───────────────────────────────────────────────
const FB_GROUPS_FILE = path.join(DATA_DIR, "fb-groups.json");
const FB_POSTS_FILE = path.join(DATA_DIR, "fb-posts.json");

function loadFbGroups() {
  if (!fs.existsSync(FB_GROUPS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(FB_GROUPS_FILE, "utf8")); } catch { return []; }
}

function loadFbPosts() {
  if (!fs.existsSync(FB_POSTS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(FB_POSTS_FILE, "utf8")); } catch { return []; }
}

function saveFbPosts(posts) {
  fs.writeFileSync(FB_POSTS_FILE, JSON.stringify(posts, null, 2), "utf8");
}

app.get("/api/fb/groups", (req, res) => {
  res.json({ groups: loadFbGroups() });
});

app.get("/api/fb/posts", (req, res) => {
  res.json({ posts: loadFbPosts() });
});

app.post("/api/fb/log-post", express.json(), (req, res) => {
  const { groupId, groupName, itemId, itemName, message, imageUrl, postUrl } = req.body;
  const posts = loadFbPosts();
  const entry = {
    id: Date.now().toString(),
    groupId, groupName,
    itemId, itemName,
    message, imageUrl,
    postUrl: postUrl || null,
    postedAt: new Date().toISOString(),
    bumps: [],
    sold: false,
  };
  posts.push(entry);
  saveFbPosts(posts);
  res.json({ ok: true, entry });
});

app.post("/api/fb/log-bump", express.json(), (req, res) => {
  const { postId } = req.body;
  const posts = loadFbPosts();
  const post = posts.find(p => p.id === postId);
  if (!post) return res.status(404).json({ ok: false, error: "Post not found" });
  post.bumps.push(new Date().toISOString());
  saveFbPosts(posts);
  res.json({ ok: true, post });
});

app.post("/api/fb/mark-sold", express.json(), (req, res) => {
  const { itemId } = req.body;
  const posts = loadFbPosts();
  let count = 0;
  posts.forEach(p => { if (p.itemId === itemId) { p.sold = true; count++; } });
  saveFbPosts(posts);
  res.json({ ok: true, markedSold: count });
});

app.delete("/api/fb/post/:id", (req, res) => {
  let posts = loadFbPosts();
  posts = posts.filter(p => p.id !== req.params.id);
  saveFbPosts(posts);
  res.json({ ok: true });
});

// ── FB Post via Playwright ───────────────────────────────────────────────────
let _fbPosterProcess = null;

app.post("/api/fb/start-posting", express.json(), async (req, res) => {
  const { itemId, itemName, itemUrl, message, imagePath, imagePaths, groups } = req.body;
  if (!groups || !groups.length || !message) {
    return res.status(400).json({ ok: false, error: "groups and message required" });
  }

  // Write job file
  const jobFile = path.join(DATA_DIR, "fb-current-job.json");
  const job = { itemId, itemName, itemUrl, message, imagePath: imagePath || null, groups: groups.map(g => ({ ...g, status: "pending" })) };
  fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

  // Kill any existing poster process
  if (_fbPosterProcess) { try { _fbPosterProcess.kill(); } catch(e) {} }

  // Start Playwright poster
  _fbPosterProcess = spawn("node", [path.join(__dirname, "scrapers/fb-poster.js")], {
    cwd: __dirname,
    stdio: ["ignore", "pipe", "pipe"],
  });

  _fbPosterProcess.stdout.on("data", d => process.stdout.write(d));
  _fbPosterProcess.stderr.on("data", d => process.stderr.write(d));
  _fbPosterProcess.on("exit", code => {
    console.log("[FB] Poster process exited with code", code);
    _fbPosterProcess = null;
  });

  res.json({ ok: true, message: "Posting started" });
});

app.get("/api/fb/job-status", (req, res) => {
  const jobFile = path.join(DATA_DIR, "fb-current-job.json");
  const resultsFile = path.join(DATA_DIR, "fb-job-results.json");
  if (!fs.existsSync(jobFile)) return res.json({ status: "no-job" });
  const job = JSON.parse(fs.readFileSync(jobFile, "utf8"));
  const results = fs.existsSync(resultsFile) ? JSON.parse(fs.readFileSync(resultsFile, "utf8")) : null;
  res.json({ status: "running", job, results });
});

app.post("/api/fb/post-to-group", express.json(), async (req, res) => {
  res.json({ ok: true });
});

// ── FB Post via Playwright ───────────────────────────────────────────────────

// ── Messenger Broadcaster ─────────────────────────────────────────────────────
const MESSENGER_GROUPS_FILE = path.join(DATA_DIR, "messenger-groups.json");

function loadMessengerGroups() {
  if (!fs.existsSync(MESSENGER_GROUPS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(MESSENGER_GROUPS_FILE, "utf8")); } catch { return []; }
}

app.get("/api/messenger/groups", (req, res) => {
  res.json({ groups: loadMessengerGroups() });
});

app.post("/api/messenger/start-posting", express.json(), async (req, res) => {
  const { itemId, itemName, message, imagePath, threads } = req.body;
  if (!threads || !threads.length || !message) {
    return res.status(400).json({ ok: false, error: "threads and message required" });
  }
  const jobFile = path.join(DATA_DIR, "messenger-current-job.json");
  const job = { itemId, itemName, message, imagePath: imagePath || null,
    threads: threads.map(t => ({ ...t, status: "pending" })) };
  fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));
  const proc = spawn("node", [path.join(__dirname, "scrapers/messenger-poster.js")], {
    cwd: __dirname, stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", d => process.stdout.write(d));
  proc.stderr.on("data", d => process.stderr.write(d));
  proc.on("exit", code => console.log("[MSG] Process exited:", code));
  res.json({ ok: true });
});

app.get("/api/messenger/job-status", (req, res) => {
  const jobFile = path.join(DATA_DIR, "messenger-current-job.json");
  const resultsFile = path.join(DATA_DIR, "messenger-job-results.json");
  if (!fs.existsSync(jobFile)) return res.json({ status: "no-job" });
  const job = JSON.parse(fs.readFileSync(jobFile, "utf8"));
  const results = fs.existsSync(resultsFile) ? JSON.parse(fs.readFileSync(resultsFile, "utf8")) : null;
  res.json({ status: "running", job, results });
});

app.post("/api/messenger/clear-results", (req, res) => {
  const resultsFile = path.join(DATA_DIR, "messenger-job-results.json");
  const jobFile = path.join(DATA_DIR, "messenger-current-job.json");
  if (fs.existsSync(resultsFile)) fs.unlinkSync(resultsFile);
  if (fs.existsSync(jobFile)) fs.unlinkSync(jobFile);
  res.json({ ok: true });
});

// ── ECI Image Fetch (direct Shopify CDN URL) ──────────────────────────────────
app.get("/api/fetch-eci-image", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ ok: false, error: "url required" });
  try {
    const axios = require("axios");
    const imgResp = await axios.get(url, {
      responseType: "arraybuffer",
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const ext = url.split("?")[0].split(".").pop() || "jpg";
    const tmpPath = require("path").join(require("os").tmpdir(), `eci-img-${Date.now()}.${ext}`);
    require("fs").writeFileSync(tmpPath, imgResp.data);
    console.log("[ECI] Downloaded image:", tmpPath);
    res.json({ ok: true, imagePath: tmpPath, imageUrl: url });
  } catch(err) {
    console.error("[ECI] Image error:", err.message);
    res.json({ ok: false, error: err.message });
  }
});

app.get("/api/inventory", async (req, res) => {
  try {
    const axios = require("axios");
    const { data: history } = await axios.get("https://chrisevo24.github.io/wpb-tracker/history.json", { timeout: 20000 });
    const timestamps = Object.keys(history).sort();
    if (!timestamps.length) return res.json([]);
    const snapshot = history[timestamps[timestamps.length - 1]];
    res.json(Object.values(snapshot));
  } catch (err) {
    console.error("WPB inventory fetch failed:", err.message);
    res.status(500).json([]);
  }
});

app.get("/api/eci-inventory", async (req, res) => {
  try {
    const axios = require("axios");
    const { data: history } = await axios.get("https://chrisevo24.github.io/ECI-Jewelers/history.json", { timeout: 20000 });
    const timestamps = Object.keys(history).sort();
    if (!timestamps.length) return res.json([]);
    const snapshot = history[timestamps[timestamps.length - 1]];
    res.json(Object.values(snapshot));
  } catch (err) {
    console.error("ECI inventory fetch failed:", err.message);
    res.status(500).json([]);
  }
});

app.get("/api/wtb/get-draft-html", (req, res) => {
  const drafts = fs.existsSync(path.join(DATA_DIR, "wtb-drafts.json"))
    ? JSON.parse(fs.readFileSync(path.join(DATA_DIR, "wtb-drafts.json"), "utf8"))
    : [];
  if (!drafts.length) return res.json({ ok: false, error: "no drafts" });
  const d = drafts[0];
  const html = fs.existsSync(d.htmlPath) ? fs.readFileSync(d.htmlPath, "utf8") : null;
  res.json({ ok: !!html, to: d.to, subject: d.subject, html, totalMatches: d.totalMatches });
});
