const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../data");
const COOKIES_FILE = path.join(DATA_DIR, "fb-cookies.json");

async function main() {
  var cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, "utf8"));
  var browser = await chromium.launch({ headless: false });
  var context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    viewport: { width: 1280, height: 900 },
  });
  await context.addCookies(cookies.map(function(c) {
    return { name: c.name, value: c.value, domain: c.domain,
             path: c.path || "/", secure: c.secure || false,
             httpOnly: c.httpOnly || false, sameSite: "Lax" };
  }));

  var page = await context.newPage();
  await page.goto("https://www.facebook.com/groups/645732992585010", {
    waitUntil: "domcontentloaded", timeout: 30000
  });
  
  // Wait but DO NOT SCROLL
  await page.waitForTimeout(5000);

  // First scroll the composer into view
  var scrollResult = await page.evaluate(function() {
    var allBtns = Array.from(document.querySelectorAll('div[role="button"]'));
    for (var i = 0; i < allBtns.length; i++) {
      if ((allBtns[i].textContent || "").trim() === "Write something...") {
        allBtns[i].scrollIntoView({ behavior: "instant", block: "center" });
        var rect = allBtns[i].getBoundingClientRect();
        return { found: true, y: Math.round(rect.top), x: Math.round(rect.left), w: Math.round(rect.width) };
      }
    }
    return { found: false };
  });

  console.log("After scrollIntoView:", JSON.stringify(scrollResult));
  await page.waitForTimeout(1000);

  // Measure again after scroll settles
  var afterScroll = await page.evaluate(function() {
    var allBtns = Array.from(document.querySelectorAll('div[role="button"]'));
    for (var i = 0; i < allBtns.length; i++) {
      if ((allBtns[i].textContent || "").trim() === "Write something...") {
        var rect = allBtns[i].getBoundingClientRect();
        return { y: Math.round(rect.top), x: Math.round(rect.left), w: Math.round(rect.width), h: Math.round(rect.height) };
      }
    }
    return null;
  });

  console.log("Final composer position:", JSON.stringify(afterScroll));
  await page.screenshot({ path: path.join(DATA_DIR, "fb-diagnose.png") });
  console.log("Screenshot saved");
  await page.waitForTimeout(15000);
  await browser.close();
}

main().catch(function(e) { console.error("Error:", e); process.exit(1); });
