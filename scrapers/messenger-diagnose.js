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
  await page.goto("https://www.facebook.com/messages/t", {
    waitUntil: "domcontentloaded", timeout: 30000
  });
  await page.waitForTimeout(5000);

  // Get current URL to see thread ID
  console.log("Current URL:", page.url());

  // Find all chat threads and their URLs
  var threads = await page.evaluate(function() {
    var links = Array.from(document.querySelectorAll('a[href*="/t/"]'));
    return links.map(function(a) {
      return {
        href: a.href,
        text: (a.textContent || "").trim().substring(0, 60),
      };
    }).filter(function(t) { return t.href.includes("/t/"); });
  });

  console.log("\n=== MESSENGER THREADS ===");
  threads.forEach(function(t, i) {
    console.log(`${i}: ${t.text} — ${t.href}`);
  });

  await page.screenshot({ path: path.join(DATA_DIR, "messenger-debug.png") });
  console.log("\nScreenshot saved");
  await page.waitForTimeout(15000);
  await browser.close();
}

main().catch(function(e) { console.error("Error:", e); process.exit(1); });
