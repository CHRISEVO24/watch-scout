const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../data");
const COOKIES_FILE = path.join(DATA_DIR, "fb-cookies.json");
const PROFILE_DIR = path.join(DATA_DIR, "messenger-profile");

async function main() {
  // Use persistent context so PIN unlock is remembered
  var context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: ["--no-sandbox"],
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });

  // Add cookies
  var cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, "utf8"));
  await context.addCookies(cookies.map(function(c) {
    return { name: c.name, value: c.value, domain: c.domain,
             path: c.path || "/", secure: c.secure || false,
             httpOnly: c.httpOnly || false, sameSite: "Lax" };
  }));

  var page = await context.newPage();
  await page.goto("https://www.facebook.com/messages/t/855627296894835/", {
    waitUntil: "domcontentloaded", timeout: 30000
  });

  console.log("===========================================");
  console.log("Browser open. Please:");
  console.log("1. Enter your PIN when prompted");
  console.log("2. Dismiss ALL dialogs until you see the Aa input");
  console.log("3. Type a test message and send it manually");
  console.log("4. Press ENTER in terminal when done");
  console.log("===========================================");

  await new Promise(function(resolve) { process.stdin.once("data", resolve); });
  console.log("Profile saved to messenger-profile/");
  await context.close();
  process.exit(0);
}

main().catch(function(e) { console.error(e); process.exit(1); });
