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
