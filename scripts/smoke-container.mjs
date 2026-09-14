import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { parse } from "dotenv";
import { spawnSync } from "node:child_process";
import { chromium, expect } from "@playwright/test";
import sharp from "sharp";
import assert from "node:assert/strict";
const config = parse(await readFile(".env.test", "utf8"));
if (
  config.NODE_ENV !== "test" ||
  !new URL(config.DATABASE_URL).pathname.endsWith("_test")
)
  throw new Error("An isolated test database is required.");
const docker = process.env.DOCKER_EXECUTABLE || "docker";
const origin = "http://localhost:5180";
const env = {
  NODE_ENV: "development",
  PORT: "3001",
  HOST: "0.0.0.0",
  APP_ORIGIN: origin,
  DATABASE_SSL: "false",
  STORAGE_PATH: "/var/lib/noctis/uploads",
  SESSION_SECRET: config.SESSION_SECRET,
  ENCRYPTION_KEY: config.ENCRYPTION_KEY,
};
for (const key of [
  "DATABASE_URL",
  "AUTH_DATABASE_URL",
  "WORKER_DATABASE_URL",
]) {
  const url = new URL(config[key]);
  url.hostname = "host.docker.internal";
  env[key] = url.href;
}
await mkdir(".runtime", { recursive: true });
const envFile = ".runtime/container-smoke.env";
await writeFile(
  envFile,
  Object.entries(env)
    .map(([k, v]) => k + "=" + v)
    .join("\n"),
  { mode: 0o600 },
);
const name = "noctis-smoke-" + process.pid;
let browser;
try {
  const run = spawnSync(
    docker,
    [
      "run",
      "--rm",
      "-d",
      "--name",
      name,
      "--read-only",
      "--tmpfs",
      "/tmp",
      "--tmpfs",
      "/var/lib/noctis/uploads:uid=1000,gid=1000",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "-p",
      "127.0.0.1:5180:3001",
      "--env-file",
      envFile,
      "noctis:local",
    ],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, "Container launch failed.");
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      ready = (await fetch(origin + "/api/ready")).ok;
    } catch {}
    if (ready) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(ready, "Container did not become ready.");
  browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
      config.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    headless: true,
  });
  const context = await browser.newContext({ baseURL: origin });
  const login = await context.request.post("/api/auth/login", {
    headers: { Origin: origin },
    data: { email: config.SEED_EMAIL, password: config.SEED_PASSWORD },
  });
  assert.equal(login.status(), 200);
  const session = await login.json();
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#/home");
  await page
    .getByRole("heading", { name: /Good (morning|afternoon|evening), Alex/ })
    .waitFor();
  const gif = await context.request.post("/api/uploads/preset", {
    headers: { Origin: origin, "X-CSRF-Token": session.csrf },
    data: { room: "studio/general", preset: "wave" },
  });
  assert.equal(gif.status(), 201, "Compiled GIF asset path failed.");
  const download = await context.request.get(
    "/api/uploads/" + (await gif.json()).id,
  );
  assert.equal(download.status(), 200);
  assert.match(download.headers()["content-type"], /image\/webp/);
  const before = await (await context.request.get("/api/bootstrap")).json();
  const previousAvatar =
    before.profile.avatarUrl?.split("/api/uploads/")[1] || null;
  try {
    const localized = await context.request.patch("/api/settings", {
      headers: { Origin: origin, "X-CSRF-Token": session.csrf },
      data: { language: "pt-BR" },
    });
    assert.equal(localized.status(), 200);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/settings/account");
    await page.reload();
    const connectionErrors = [];
    page.on("console", (message) => {
      if (/violates.*Content Security Policy/i.test(message.text()))
        connectionErrors.push(message.text());
    });
    const avatar = await sharp({
      create: { width: 128, height: 128, channels: 3, background: "#bca9da" },
    })
      .png()
      .toBuffer();
    await page.getByLabel("Alterar foto").setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: avatar,
    });
    await expect(
      page.locator(".profile-settings-banner .avatar img"),
    ).toHaveAttribute("src", /^data:image\/png;base64,/);
    const profileSaved = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/profile") &&
        response.request().method() === "PATCH",
    );
    await page
      .getByRole("button", { name: "Salvar alterações", exact: true })
      .click();
    assert.equal((await profileSaved).status(), 200);
    await expect(page.getByRole("status")).toContainText("Alterações salvas");
    await page.reload();
    const photo = page.locator(".profile-settings-banner .avatar img");
    await expect(photo).toHaveAttribute("src", /^\/api\/uploads\//);
    const saved = await context.request.get(await photo.getAttribute("src"));
    assert.equal(saved.status(), 200);
    assert.match(saved.headers()["content-type"], /image\/webp/);
    assert.deepEqual(connectionErrors, []);
    await page.screenshot({
      path: "screenshots/avatar-saved-container-mobile.png",
      fullPage: true,
    });
  } finally {
    const restored = await context.request.patch("/api/profile", {
      headers: { Origin: origin, "X-CSRF-Token": session.csrf },
      data: { avatarUploadId: previousAvatar },
    });
    assert.equal(
      restored.status(),
      200,
      "Restore the test account's previous avatar.",
    );
    const languageRestored = await context.request.patch("/api/settings", {
      headers: { Origin: origin, "X-CSRF-Token": session.csrf },
      data: { language: before.settings.language },
    });
    assert.equal(languageRestored.status(), 200);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/server/studio/general");
  await page.reload();
  const transcript = page.locator(".transcript");
  await expect(page.locator(".music-chat-player")).toBeVisible();
  const transcriptBounds = await transcript.boundingBox();
  const composer = page.getByRole("textbox", { name: "Message", exact: true });
  await composer.fill("A draft stays in this conversation");
  const pins = page.getByRole("button", {
    name: "Show pinned messages",
    exact: true,
  });
  await pins.click();
  const panel = page.getByRole("dialog", {
    name: "Pinned messages",
    exact: true,
  });
  await expect(panel).toBeVisible();
  await expect(panel.locator(".pinned-message-link").first()).toBeVisible();
  console.log(await panel.evaluate((element) => [...element.querySelectorAll(".popover-body, .pinned-message-list, .pinned-message-link, .pinned-message-content")].map((node) => ({ className: node.className, top: node.getBoundingClientRect().top, height: node.getBoundingClientRect().height, visibility: getComputedStyle(node).visibility, opacity: getComputedStyle(node).opacity, color: getComputedStyle(node).color }))));
  assert.ok((await panel.boundingBox()).width <= 360);
  assert.deepEqual(await transcript.boundingBox(), transcriptBounds);
  await expect(page.locator(".music-chat-player")).toBeVisible();
  await page.screenshot({
    path: "screenshots/pinned-popover-container.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(pins).toBeFocused();
  await expect(composer).toHaveValue("A draft stays in this conversation");
  assert.deepEqual(errors, []);
  console.log(
    "Container passed: nonroot/read-only startup, database readiness, authentication, production UI, compiled GIF upload, avatar save/reload under full CSP, controlled downloads and anchored pinned messages with the chat/player preserved.",
  );
} finally {
  await browser?.close();
  spawnSync(docker, ["stop", "--time", "3", name], { stdio: "ignore" });
  await unlink(envFile).catch(() => {});
}
