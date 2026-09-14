import "dotenv/config";
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    "C:/Users/kali/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe",
  headless: true,
});
const context = await browser.newContext({
  baseURL: process.env.APP_ORIGIN,
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => {
  if (
    r.status() >= 400 &&
    r.url().includes("/api/") &&
    !r.url().includes("/auth/session")
  )
    errors.push(
      `API ${r.status()} ${new URL(r.url()).pathname.replace(/\/invites\/[^/]+/, "/invites/:token")}`,
    );
});
const login = await context.request.post("/api/auth/login", {
  headers: { Origin: process.env.APP_ORIGIN },
  data: { email: process.env.SEED_EMAIL, password: process.env.SEED_PASSWORD },
});
if (!login.ok()) throw new Error(`Sign-in failed: ${login.status()}`);
await mkdir("screenshots", { recursive: true });
for (const route of [
  "home",
  "server/studio/general",
  "missions",
  "leaderboard",
  "integrations",
  "settings/devices",
  "admin/studio",
  "voice/studio/lounge",
]) {
  await page.goto("/#/" + route);
  await page.waitForTimeout(1600);
  console.log(
    route,
    await page.locator("h1").allTextContents(),
    await page.locator("body").evaluate((el) => el.scrollWidth > innerWidth),
  );
  await page.screenshot({
    path: `screenshots/live-${route.replaceAll("/", "-")}.png`,
    fullPage: true,
  });
}
console.log("Runtime errors:", errors);
await browser.close();
