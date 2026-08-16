const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../data");
const COOKIES_FILE = path.join(DATA_DIR, "fb-cookies.json");

async function findAndClickGroup(page, groupName) {
  // Get picker dialog bounds first
  var bounds = await page.evaluate(function() {
    var all = Array.from(document.querySelectorAll('*'));
    for (var i = 0; i < all.length; i++) {
      if ((all[i].innerText || "").trim() === "Add groups") {
        var el = all[i];
        for (var up = 0; up < 15; up++) {
          if (!el.parentElement) break;
          el = el.parentElement;
          var r = el.getBoundingClientRect();
          if (r.height > 300 && r.width > 200) {
            return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
          }
        }
      }
    }
    return { top: 100, bottom: 950, left: 0, right: 1000 };
  });

  var doneButtonY = bounds.bottom - 60;
  var minY = bounds.top + 150;
  var maxY = doneButtonY - 20;

  console.log("[FB] Picker bounds: top=" + Math.round(bounds.top) + " bottom=" + Math.round(bounds.bottom) + " maxClickY=" + Math.round(maxY));

  var shortName = groupName.substring(0, 12);

  for (var attempt = 0; attempt < 5; attempt++) {
    var result = await page.evaluate(function(args) {
      var name = args.name;
      var minY = args.minY;
      var maxY = args.maxY;
      var all = Array.from(document.querySelectorAll('*'));
      var candidates = [];
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        var text = (el.innerText || "").trim();
        if (text.startsWith(name) && text.length < 120) {
          var rect = el.getBoundingClientRect();
          if (rect.width > 80 && rect.width < 900 && rect.height > 15 && rect.height < 130) {
            candidates.push({ x: Math.round(rect.left + rect.width/2), y: Math.round(rect.top + rect.height/2), ry: rect.y });
          }
        }
      }
      // Filter to only those within picker visible area
      var visible = candidates.filter(function(c) { return c.y >= minY && c.y <= maxY; });
      if (visible.length > 0) return { found: true, x: visible[0].x, y: visible[0].y };
      // Return all candidates for debugging
      return { found: false, candidates: candidates.map(function(c) { return c.y; }) };
    }, { name: shortName, minY: minY, maxY: maxY });

    console.log("[FB] " + groupName + " attempt " + attempt + ":", JSON.stringify(result));

    if (result.found) {
      await page.mouse.click(result.x, result.y);
      await page.waitForTimeout(700);
      return true;
    }

    // Not visible - scroll using mouse wheel positioned inside picker
    // Position mouse in center of picker list area and wheel scroll
    var pickerCenterX = Math.round((bounds.left + bounds.right) / 2);
    var pickerCenterY = Math.round((bounds.top + bounds.bottom) / 2);
    await page.mouse.move(pickerCenterX, pickerCenterY);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(600);
  }
  return false;
}

async function postToAllGroups(page, groups, message, imagePath, imagePaths) {
  const firstGroup = groups[0];
  console.log(`[FB] Navigating to ${firstGroup.name}...`);
  await page.goto(`https://www.facebook.com/groups/${firstGroup.id}`, {
    waitUntil: "domcontentloaded", timeout: 30000
  });
  await page.waitForTimeout(5000);

  // Find and click composer
  var composerCoords = await page.evaluate(function() {
    var allBtns = Array.from(document.querySelectorAll('div[role="button"]'));
    for (var i = 0; i < allBtns.length; i++) {
      if ((allBtns[i].textContent || "").trim() === "Write something...") {
        allBtns[i].scrollIntoView({ behavior: "instant", block: "center" });
        var rect = allBtns[i].getBoundingClientRect();
        return { x: Math.round(rect.left + rect.width/2), y: Math.round(rect.top + rect.height/2) };
      }
    }
    return null;
  });
  if (!composerCoords) throw new Error("Composer not found");
  await page.waitForTimeout(1000);
  await page.mouse.click(composerCoords.x, composerCoords.y);
  await page.waitForTimeout(3000);

  // Get text area
  var textArea = null;
  try {
    await page.waitForSelector('div[role="dialog"] div[contenteditable="true"]', { timeout: 8000 });
    textArea = await page.$('div[role="dialog"] div[contenteditable="true"]');
  } catch(e) {
    await page.waitForSelector('div[role="textbox"]', { timeout: 5000 });
    textArea = await page.$('div[role="textbox"]');
  }
  await textArea.click({ force: true });
  await page.waitForTimeout(500);

  // Type message
  var lines = message.split("\n");
  for (var i = 0; i < lines.length; i++) {
    await page.keyboard.type(lines[i], { delay: 15 });
    if (i < lines.length - 1) await page.keyboard.press("Enter");
  }
  await page.waitForTimeout(1000);

  // Upload images
  var imagesToUpload = imagePaths && imagePaths.length ? imagePaths : (imagePath ? [imagePath] : []);
  imagesToUpload = imagesToUpload.filter(function(p) { return p && fs.existsSync(p); }).slice(0, 3);
  if (imagesToUpload.length > 0) {
    console.log(`[FB] Uploading ${imagesToUpload.length} image(s)...`);
    try {
      var photoEl = await page.$('[aria-label="Photo/video"]') || await page.$('[aria-label="Photo or video"]');
      if (photoEl) {
        var fcPromise = page.waitForEvent("filechooser", { timeout: 4000 });
        await photoEl.click({ force: true });
        try {
          var fc = await fcPromise;
          await fc.setFiles(imagesToUpload);
          await page.waitForTimeout(6000);
          console.log(`[FB] Images uploaded`);
        } catch(e) { console.warn(`[FB] File chooser timeout`); }
      }
    } catch(e) { console.warn(`[FB] Upload error: ${e.message}`); }
  }

  // Add remaining groups
  if (groups.length > 1) {
    console.log(`[FB] Adding ${groups.length-1} more groups...`);
    var addBtn = await page.evaluate(function() {
      var btns = Array.from(document.querySelectorAll('div[role="button"], button'));
      for (var i = 0; i < btns.length; i++) {
        var t = (btns[i].textContent || "").trim();
        if (t.includes("Add groups") || t.includes("Add group")) {
          var r = btns[i].getBoundingClientRect();
          return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
        }
      }
      return null;
    });

    if (addBtn) {
      await page.mouse.click(addBtn.x, addBtn.y);
      await page.waitForTimeout(2000);

      for (var g = 1; g < groups.length; g++) {
        var selected = await findAndClickGroup(page, groups[g].name);
        if (!selected) console.warn(`[FB] Could not select: ${groups[g].name}`);
      }

      // Screenshot before Done
      await page.screenshot({ path: path.join(DATA_DIR, "fb-addgroups.png") });

      // Click Done
      var doneCoords = await page.evaluate(function() {
        var btns = Array.from(document.querySelectorAll('div[role="button"], button'));
        for (var i = 0; i < btns.length; i++) {
          if ((btns[i].textContent || "").trim() === "Done") {
            var r = btns[i].getBoundingClientRect();
            return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
          }
        }
        return null;
      });
      if (doneCoords) {
        await page.mouse.click(doneCoords.x, doneCoords.y);
        console.log(`[FB] Clicked Done`);
        await page.waitForTimeout(3000);
      }
    }
  }

  // Click Post
  console.log(`[FB] Clicking Post...`);
  var posted = false;
  var postEl = await page.$('div[role="dialog"] div[aria-label="Post"]') ||
               await page.$('div[role="dialog"] button[aria-label="Post"]');
  if (postEl) {
    await postEl.click({ force: true });
    posted = true;
  } else {
    posted = await page.evaluate(function() {
      var dialog = document.querySelector('div[role="dialog"]');
      if (!dialog) return false;
      var btns = Array.from(dialog.querySelectorAll('div[role="button"], button'));
      for (var i = 0; i < btns.length; i++) {
        if ((btns[i].textContent || "").trim() === "Post" || btns[i].getAttribute("aria-label") === "Post") {
          btns[i].click(); return true;
        }
      }
      return false;
    });
  }
  if (!posted) throw new Error("Post button not found");
  await page.waitForTimeout(5000);
  console.log(`[FB] Posted to ${groups.length} groups`);
  return true;
}

async function main() {
  var jobFile = path.join(DATA_DIR, "fb-current-job.json");
  if (!fs.existsSync(jobFile)) { console.error("[FB] No job file"); process.exit(1); }
  var job = JSON.parse(fs.readFileSync(jobFile, "utf8"));
  console.log(`[FB] Starting: ${job.itemName} -> ${job.groups.length} groups`);

  var cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, "utf8"));
  var browser = await chromium.launch({ headless: false, args: ["--no-sandbox", "--start-maximized"] });
  var context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: null,
  });
  await context.addCookies(cookies.map(function(c) {
    return { name: c.name, value: c.value, domain: c.domain,
             path: c.path || "/", secure: c.secure || false,
             httpOnly: c.httpOnly || false, sameSite: "Lax" };
  }));

  var page = await context.newPage();
  var results = [];

  try {
    await postToAllGroups(page, job.groups, job.message, job.imagePath, job.imagePaths || []);
    job.groups.forEach(function(g) { g.status = "done"; });
    results = job.groups.map(function(g) { return { groupId: g.id, groupName: g.name, ok: true }; });
  } catch(e) {
    console.error(`[FB] Failed: ${e.message}`);
    results = job.groups.map(function(g) { return { groupId: g.id, groupName: g.name, ok: false, error: e.message }; });
  }

  fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));
  await browser.close();
  var posted = results.filter(function(r) { return r.ok; }).length;
  var failed = results.filter(function(r) { return !r.ok; }).length;
  console.log(`\n[FB] Done -- ${posted} posted, ${failed} failed`);
  fs.writeFileSync(path.join(DATA_DIR, "fb-job-results.json"),
    JSON.stringify({ posted: posted, failed: failed, results: results }, null, 2));
  process.exit(0);
}

main().catch(function(e) { console.error("[FB] Fatal:", e); process.exit(1); });
