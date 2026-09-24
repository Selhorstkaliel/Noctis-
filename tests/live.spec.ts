import "dotenv/config";
import {
  test,
  expect,
  request,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { mailLink } from "./security-mail-helper";
let ownerCookies: any[],
  memberCookies: any[],
  ownerCSRF: string,
  memberCSRF: string,
  memberId: string,
  serverId: string,
  voiceId: string;
const suffix = randomUUID().slice(0, 8);
let apiContext: Awaited<ReturnType<typeof request.newContext>>;
const origin = process.env.APP_ORIGIN || "http://localhost:5173";
test.beforeAll(async () => {
  if (
    process.env.NODE_ENV !== "test" ||
    !new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")
  )
    throw new Error("Browser tests require the isolated test database.");
  const { default: pg } = await import("pg");
  const setup = new pg.Client({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  await setup.connect();
  await setup.query("DELETE FROM noctis.rate_limits");
  await setup.query(
    "UPDATE noctis.servers SET deleted_at=now() WHERE name ~ '^(Browser Lab|Browser Admin|Evening Guild) [a-f0-9]{8}$' AND owner_id='alex'",
  );
  await setup.end();
  apiContext = await request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  const login = await apiContext.post("/api/auth/login", {
    data: {
      email: process.env.SEED_EMAIL,
      password: process.env.SEED_PASSWORD,
    },
  });
  expect(login.status()).toBe(200);
  ownerCSRF = (await login.json()).csrf;
  ownerCookies = (await apiContext.storageState()).cookies;
  const server = await apiContext.post("/api/servers", {
    headers: { "X-CSRF-Token": ownerCSRF },
    data: { name: `Browser Lab ${suffix}`, isPublic: true },
  });
  expect(server.status()).toBe(201);
  serverId = (await server.json()).id;
  const snapshot = await (await apiContext.get("/api/bootstrap")).json();
  voiceId = snapshot.channels.find(
    (c: any) => c.serverId === serverId && c.kind === "voice",
  ).id;
  const member = await request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  const registered = await member.post("/api/auth/register", {
    data: {
      name: "Jordan Browser",
      handle: `jordan.${suffix}`,
      email: `jordan.${suffix}@example.invalid`,
      password: randomUUID() + randomUUID(),
    },
  });
  expect(registered.status()).toBe(201);
  const identity = await registered.json();
  memberCSRF = identity.csrf;
  memberId = identity.userId;
  const fixture = new pg.Client({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  await fixture.connect();
  await fixture.query(
    "UPDATE noctis.users SET email_verified_at=now() WHERE id=$1",
    [memberId],
  );
  await fixture.end();
  memberCookies = (await member.storageState()).cookies;
  expect(
    (
      await member.post(`/api/servers/${serverId}/join`, {
        headers: { "X-CSRF-Token": memberCSRF },
        data: {},
      })
    ).status(),
  ).toBe(200);
  await member.patch("/api/settings", {
    headers: { "X-CSRF-Token": memberCSRF },
    data: { dmPolicy: "community" },
  });
  await member.dispose();
});
test.afterAll(async () => {
  await apiContext?.dispose();
});
test.beforeEach(async ({ context, page }) => {
  await context.addCookies(ownerCookies);
  const bootstrap = page.waitForResponse((response) =>
    response.url().endsWith("/api/bootstrap"),
  );
  await page.goto("/#/home");
  expect((await bootstrap).status()).toBe(200);
  await expect(
    page.getByRole("heading", {
      name: /Good (morning|afternoon|evening), Alex/,
    }),
  ).toBeVisible();
});
async function secondContext(browser: any) {
  const context: BrowserContext = await browser.newContext({
    baseURL: origin,
    permissions: ["microphone", "camera"],
  });
  await context.addCookies(memberCookies);
  return context;
}
test("a server sidebar contains only that server's text and voice channels", async ({
  page,
}) => {
  await page.goto(`/#/server/${serverId}/general`);
  const sidebar = page.locator(".navigation-sidebar");
  await expect(
    sidebar.locator(`a[href="#/server/${serverId}/general"]`),
  ).toBeVisible();
  await expect(
    sidebar.locator(`a[href="#/voice/${serverId}/lounge"]`),
  ).toBeVisible();
  for (const label of [
    "Home",
    "Direct messages",
    "Missions",
    "Events",
    "Discover servers",
    "Integrations",
  ])
    await expect(
      sidebar.getByRole("link", { name: label, exact: true }),
    ).toHaveCount(0);
  await page.screenshot({
    path: "screenshots/server-sidebar-context.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Noctis Home" }).click();
  await expect(
    sidebar.getByRole("link", { name: "Home", exact: true }),
  ).toBeVisible();
});
test("server administration opens the current server and repairs legacy routes", async ({
  page,
}) => {
  await page.goto(`/#/server/${serverId}/general`);
  await page
    .locator(".navigation-sidebar")
    .getByRole("button", { name: "Server administration" })
    .click();
  await expect(page).toHaveURL(new RegExp(`#/?admin/${serverId}$`));
  await expect(
    page.getByRole("heading", {
      name: "A good community starts with care.",
    }),
  ).toBeVisible();
  const updatedName = `Browser Admin ${suffix}`;
  await page.getByRole("textbox", { name: "Server name" }).fill(updatedName);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Server details saved");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Server name" })).toHaveValue(
    updatedName,
  );
  await page.goto(`/#/server/${serverId}/general`);
  await page.evaluate(() => {
    location.hash = "#/admin/studio";
  });
  await expect(page).toHaveURL(new RegExp(`#/?admin/${serverId}$`));
  await expect(
    page.getByRole("heading", {
      name: "A good community starts with care.",
    }),
  ).toBeVisible();
  await expect(page.getByText("This server is unavailable")).toHaveCount(0);
  await page.screenshot({
    path: "screenshots/server-administration.png",
    fullPage: true,
  });
});
test("choosing a new direct recipient creates the conversation before sending", async ({
  page,
}) => {
  await page.goto("/#/messages");
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/conversations") &&
      response.request().method() === "POST",
  );
  const recipient = page.locator(`a[href="#/messages/${memberId}"]`);
  await expect(recipient).toBeVisible();
  await recipient.click();
  expect((await created).status()).toBe(201);
  await expect(page).toHaveURL(new RegExp(`#/?messages/${memberId}$`));

  const message = `First direct message ${suffix}`;
  const sent = page.waitForResponse(
    (response) =>
      response.url().includes("/api/rooms/") &&
      response.url().endsWith("/messages") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill(message);
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .press("Enter");
  expect((await sent).status()).toBe(201);
  await expect(
    page.locator(".chat-message").filter({ hasText: message }),
  ).toBeVisible();
  await expect(page.getByText("This resource is unavailable.")).toHaveCount(0);
});
test("messages sync to another user, preserve edits, reactions, replies, pins and attachments", async ({
  page,
  browser,
}) => {
  const other = await secondContext(browser);
  const receiver = await other.newPage();
  await receiver.goto(`/#/server/${serverId}/general`);
  await expect(
    receiver.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible();
  await page.goto(`/#/server/${serverId}/general`);
  const message = `A real conversation ${suffix}`;
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill(message);
  const sent = page.waitForResponse(
    (response) =>
      response.url().includes("/api/rooms/") &&
      response.url().endsWith("/messages") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .press("Enter");
  expect((await sent).status()).toBe(201);
  const row = page.locator(".chat-message").filter({ hasText: message });
  await expect(row).toBeVisible();
  await expect(
    receiver.locator(".chat-message").filter({ hasText: message }),
  ).toBeVisible();
  await row.hover();
  await row.getByRole("button", { name: "Edit message", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Edit message" })
    .fill(message + " Â· edited");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    receiver
      .locator(".chat-message")
      .filter({ hasText: message + " Â· edited" }),
  ).toBeVisible();
  await row.hover();
  await row.getByRole("button", { name: "Pin message", exact: true }).click();
  await expect(
    row.getByRole("button", { name: "Unpin message", exact: true }),
  ).toBeVisible();
  await row.hover();
  await row
    .getByRole("button", { name: "Reply to Alex Morgan", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("A reply that stays connected");
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .press("Enter");
  await expect(
    page
      .locator(".chat-message")
      .filter({ hasText: "A reply that stays connected" })
      .locator(".reply-reference"),
  ).toContainText(message);
  await page.getByLabel("Upload attachment").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Persistent private attachment"),
  });
  await expect(page.locator(".attachment-preview")).toContainText("notes.txt");
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Notes for the team");
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .press("Enter");
  await expect(
    page.locator(".chat-message").getByRole("link", {
      name: "notes.txt Download attachment",
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.locator(".chat-message").getByRole("link", {
      name: "notes.txt Download attachment",
      exact: true,
    }),
  ).toBeVisible();
  await other.close();
});
test("pinned messages stay in an anchored panel without replacing the conversation", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const headers = { "X-CSRF-Token": ownerCSRF };
  const slug = `pins-${suffix}`;
  const channel = await apiContext.post(`/api/servers/${serverId}/channels`, {
    headers,
    data: { name: slug },
  });
  expect(channel.status()).toBe(200);
  const room = `${serverId}/${slug}`;
  const send = async (text: string) => {
    const result = await apiContext.post(
      `/api/rooms/${encodeURIComponent(room)}/messages`,
      {
        headers,
        data: { text, nonce: randomUUID() },
      },
    );
    expect(result.status()).toBe(201);
    return (await result.json()).id as string;
  };
  const important = `Pinned plan ${suffix} â€” ${"Details for the community. ".repeat(20)}`;
  const pinnedId = await send(important);
  await send(`Unpinned conversation ${suffix}`);
  await page.goto(`/#/server/${serverId}/${slug}`);
  const transcript = page.getByRole("log", { name: "Conversation messages" });
  const composer = page.getByRole("textbox", { name: "Message", exact: true });
  await expect(transcript.locator(".chat-message")).toHaveCount(2);
  await composer.fill("Keep this unfinished message");
  const pinButton = page.getByRole("button", {
    name: "Show pinned messages",
    exact: true,
  });
  const transcriptBefore = await transcript.boundingBox();
  const scrollBefore = await transcript.evaluate(
    (element) => element.scrollTop,
  );
  const urlBefore = page.url();
  await pinButton.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("dialog", {
    name: "Pinned messages",
    exact: true,
  });
  await expect(panel).toBeVisible();
  await expect(panel).toBeFocused();
  await expect(pinButton).toHaveAttribute("aria-expanded", "true");
  await expect(panel.getByText("Nothing pinned yet")).toBeVisible();
  await expect(transcript.locator(".chat-message")).toHaveCount(2);
  expect(await transcript.boundingBox()).toEqual(transcriptBefore);
  expect(await transcript.evaluate((element) => element.scrollTop)).toBe(
    scrollBefore,
  );
  expect(page.url()).toBe(urlBefore);
  const rect = (await panel.boundingBox())!;
  expect(rect.width).toBeLessThanOrEqual(360);
  expect(rect.height).toBeLessThan(300);
  expect(rect.x + rect.width).toBeLessThanOrEqual(
    (await pinButton.boundingBox())!.x + 40,
  );
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(pinButton).toBeFocused();
  await pinButton.click();
  expect(
    (
      await apiContext.put(`/api/messages/${pinnedId}/pin`, {
        headers,
        data: { pinned: true },
      })
    ).status(),
  ).toBe(200);
  await expect(panel.getByText(important, { exact: true })).toBeVisible();
  await expect(panel.getByText(`Unpinned conversation ${suffix}`)).toHaveCount(
    0,
  );
  await expect(transcript.locator(".chat-message")).toHaveCount(2);
  await page.screenshot({
    path: "screenshots/pinned-popover-desktop.png",
    fullPage: true,
  });
  await panel
    .getByRole("button", { name: "Go to message by Alex Morgan" })
    .click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator(`[id="message-${pinnedId}"]`)).toBeFocused();
  await expect(composer).toHaveValue("Keep this unfinished message");
  await pinButton.click();
  await composer.click();
  await expect(panel).toHaveCount(0);
  await expect(composer).toBeFocused();
  // Read-only pins remain usable while offline; opening them does not fetch or navigate.
  await context.setOffline(true);
  await pinButton.click();
  await expect(panel.getByText(important, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await context.setOffline(false);
  // A long list uses the panel's own scroll area.
  for (let index = 0; index < 5; index++) {
    const id = await send(
      `More pinned details ${index}: ${"A long preview. ".repeat(25)}`,
    );
    expect(
      (
        await apiContext.put(`/api/messages/${id}/pin`, {
          headers,
          data: { pinned: true },
        })
      ).status(),
    ).toBe(200);
  }
  await apiContext.patch("/api/settings", {
    headers,
    data: { language: "pt-BR" },
  });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    const localizedButton = page.getByRole("button", {
      name: "Mostrar mensagens fixadas",
    });
    await localizedButton.click();
    const localizedPanel = page.getByRole("dialog", {
      name: "Mensagens fixadas",
      exact: true,
    });
    await expect(localizedPanel).toBeVisible();
    await expect(localizedPanel.locator("li")).toHaveCount(6);
    const mobile = (await localizedPanel.boundingBox())!;
    expect(mobile.x).toBeGreaterThanOrEqual(12);
    expect(mobile.x + mobile.width).toBeLessThanOrEqual(378);
    expect(mobile.y + mobile.height).toBeLessThanOrEqual(832);
    expect(mobile.height).toBeLessThanOrEqual(420);
    const body = localizedPanel.locator(".popover-body");
    expect(
      await body.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(true);
    await body.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(localizedPanel).toBeVisible();
    const mobileTranscript = page.locator(".transcript");
    const beforeIncoming = await mobileTranscript.evaluate(
      (element) => element.scrollTop,
    );
    const incoming = await send("A new message while reading pins");
    await expect(page.locator(`[id="message-${incoming}"]`)).toHaveCount(1);
    await expect(localizedPanel).toBeVisible();
    expect(
      await mobileTranscript.evaluate((element) => element.scrollTop),
    ).toBe(beforeIncoming);
    const accessibility = await new AxeBuilder({ page })
      .include(".anchored-popover")
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({
      path: "screenshots/pinned-popover-mobile.png",
      fullPage: true,
    });
    await localizedPanel
      .getByRole("button", { name: "Fechar mensagens fixadas" })
      .click();
    await expect(localizedButton).toBeFocused();
    await localizedButton.click();
    await page.evaluate((id) => {
      location.hash = `/server/${id}/general`;
    }, serverId);
    await expect(localizedPanel).toHaveCount(0);
    const player = page.locator(".music-chat-player");
    await expect(player).toBeVisible();
    const playerBefore = await player.boundingBox();
    await localizedButton.click();
    await expect(localizedPanel).toBeVisible();
    expect(await player.boundingBox()).toEqual(playerBefore);
    await page.keyboard.press("Escape");
  } finally {
    await apiContext.patch("/api/settings", {
      headers,
      data: { language: "en-US" },
    });
  }
});
test("chat delivery, edits and removal do not reload the account snapshot", async ({
  page,
  browser,
}) => {
  const other = await secondContext(browser);
  const receiver = await other.newPage();
  try {
    await receiver.goto("/#/server/" + serverId + "/general");
    await page.evaluate((id) => {
      location.hash = "/server/" + id + "/general";
    }, serverId);
    await Promise.all(
      [page, receiver].map(async (p) => {
        await expect(
          p.getByRole("textbox", { name: "Message", exact: true }),
        ).toBeVisible();
        await p.waitForLoadState("networkidle");
      }),
    );
    const bootstraps: string[] = [];
    for (const p of [page, receiver])
      p.on("request", (r) => {
        if (new URL(r.url()).pathname === "/api/bootstrap")
          bootstraps.push(r.url());
      });
    const text = "Scoped update " + suffix;
    const box = page.getByRole("textbox", { name: "Message", exact: true });
    await box.fill(text);
    await box.press("Enter");
    const row = page.locator(".chat-message").filter({ hasText: text });
    const received = receiver
      .locator(".chat-message")
      .filter({ hasText: text });
    await expect(row).toBeVisible();
    await expect(received).toBeVisible();
    await row.hover();
    await row
      .getByRole("button", { name: "Edit message", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Edit message" })
      .fill(text + " edited");
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(received).toContainText("edited");
    await row.hover();
    await row
      .getByRole("button", { name: "Delete message", exact: true })
      .click();
    await expect(received).toHaveCount(0);
    await Promise.all(
      [page, receiver].map((p) => p.waitForLoadState("networkidle")),
    );
    expect(bootstraps).toEqual([]);
  } finally {
    await other.close();
  }
});

test("server creation and real invitation produce a durable community", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Create a server", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Server name").fill(`Evening Guild ${suffix}`);
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/servers") &&
      response.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "Create server", exact: true })
    .click();
  expect((await created).status()).toBe(201);
  await expect(page).toHaveURL(/#server\/[\w-]+\/general/);
  const id = page.url().split("#")[1].split("/")[1];
  await page
    .getByRole("button", { name: "Invite your people", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  await expect(page.getByLabel("Invitation link")).toHaveValue(
    /#\/invite\/[\w-]{43}$/,
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page.reload();
  await expect(page.locator(".channel-nav"))
    .toContainText(`Evening Guild ${suffix}`)
    .catch(async () => {
      await expect(
        page.getByText(`Evening Guild ${suffix}`, { exact: true }).first(),
      ).toBeVisible();
    });
  expect(id).toBeTruthy();
});
test("missions use persistent objectives and server-calculated rewards", async ({
  page,
}) => {
  await page.goto(`/#/admin/${serverId}`);
  await page
    .getByRole("button", { name: "Create mission", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Mission title").fill(`A shared purpose ${suffix}`);
  await dialog
    .getByLabel("Description", { exact: true })
    .fill("Complete one meaningful objective together.");
  await dialog.getByLabel(/Objectives/).fill("Share an idea with the group");
  await dialog
    .getByRole("button", { name: "Create mission", exact: true })
    .click();
  await page
    .getByRole("button")
    .filter({ hasText: `A shared purpose ${suffix}` })
    .first()
    .click();
  await page
    .getByRole("checkbox", { name: /Share an idea with the group/ })
    .click();
  await page
    .getByRole("button", { name: "Claim rewards", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Rewards claimed|Completed/ }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: /Rewards claimed|Completed/ }),
  ).toBeVisible();
});
test("settings save on the server and devices show active sessions", async ({
  page,
}) => {
  const headers = (await page.request.get("/api/health")).headers();
  const connectPolicy = headers["content-security-policy"]
    .split(";")
    .find((directive) => directive.trim().startsWith("connect-src"))!;
  expect(connectPolicy.trim()).toContain("connect-src 'self' wss://");
  // Vite does not serve Helmet headers. Exercise the server's real connection
  // policy on both navigation and reload, without blocking Vite's inline setup.
  await page.route("**/", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        "content-security-policy": connectPolicy,
      },
    });
  });
  const cspErrors: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    // Vite's development-only fallback socket uses 127.0.0.1 instead of localhost.
    if (
      /violates.*Content Security Policy/i.test(text) &&
      !/Connecting to 'ws:\/\/127\.0\.0\.1:\d+\/\?token=/.test(text)
    )
      cspErrors.push(text.slice(0, 200));
  });
  const avatar = await sharp(randomBytes(600 * 600 * 3), {
    raw: { width: 600, height: 600, channels: 3 },
  })
    .png()
    .toBuffer();
  expect(avatar.length).toBeGreaterThan(400_000);
  expect(avatar.length).toBeLessThanOrEqual(2_000_000);
  await page.goto("/#/settings/account");
  await page.getByLabel("Change avatar").setInputFiles({
    name: "profile.png",
    mimeType: "image/png",
    buffer: avatar,
  });
  await expect(
    page.locator(".profile-settings-banner .avatar img"),
  ).toHaveAttribute("src", /^data:image\/png;base64,/);
  let attempts = 0;
  await page.route("**/api/uploads?purpose=avatar", async (route) => {
    attempts++;
    await new Promise((resolve) => setTimeout(resolve, 750));
    await route.abort();
  });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Saving changesâ€¦" }),
  ).toBeDisabled();
  await page.getByLabel("Display name", { exact: true }).press("Enter");
  await expect(page.getByRole("alert")).toContainText(
    "Connection failed. Check your internet connection and try again.",
  );
  expect(attempts).toBe(1);
  await expect(page.getByText("You have unsaved changes.")).toBeVisible();
  await expect(page.getByRole("status")).not.toContainText("Changes saved");
  await expect(
    page.locator(".profile-settings-banner .avatar img"),
  ).toHaveAttribute("src", /^data:image\/png;base64,/);
  await page.unroute("**/api/uploads?purpose=avatar");
  const uploadResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/uploads?purpose=avatar") &&
      response.request().method() === "POST",
  );
  const profileResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/profile") &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  expect((await uploadResponse).status()).toBe(201);
  expect((await profileResponse).status()).toBe(200);
  await expect(page.getByRole("status")).toContainText("Changes saved");
  await page.reload();
  await expect(
    page.locator(".profile-settings-banner .avatar img"),
  ).toHaveAttribute("src", /\/api\/uploads\//);
  const savedPhoto = await page
    .locator(".profile-settings-banner .avatar img")
    .getAttribute("src");
  const download = await page.request.get(savedPhoto!);
  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toContain("image/webp");
  expect(cspErrors).toEqual([]);
  await page.goto("/#/settings/appearance");
  await page.getByRole("button", { name: "Graphite", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "graphite");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "graphite");
  await page.getByRole("button", { name: "Midnight", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.goto("/#/settings/devices");
  await expect(
    page.getByRole("heading", { name: "Active devices" }),
  ).toBeVisible();
  await expect(page.getByText("This device", { exact: true })).toBeVisible();
  await page
    .locator(".settings-content")
    .getByRole("button", { name: "Account security", exact: true })
    .click();
  await expect(
    page.getByLabel("Current password", { exact: true }),
  ).toHaveAttribute("type", "password");
});
test("language selection persists and updates core navigation and chat", async ({
  browser,
}) => {
  const context = await secondContext(browser);
  const page = await context.newPage();
  try {
    await page.goto("/#/settings/language");
    await page
      .locator(".language-option")
      .filter({ hasText: "Portuguese" })
      .click();
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(
      page.getByRole("button", { name: "Salvar alteraÃ§Ãµes", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await page.goto("/#/home");
    await expect(
      page.getByRole("link", { name: "InÃ­cio", exact: true }),
    ).toBeVisible();
    await page.goto(`/#/server/${serverId}/general`);
    await expect(
      page.getByRole("heading", { name: "Boas-vindas ao #general" }),
    ).toBeVisible();
  } finally {
    await page.goto("/#/settings/language");
    await page
      .locator(".language-option")
      .filter({ hasText: "InglÃªs" })
      .click();
    await page
      .getByRole("button", { name: "Salvar alteraÃ§Ãµes", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
    await context.close();
  }
});
test("provider configuration is honest and search uses authorized API results", async ({
  page,
}) => {
  await page.goto("/#/integrations");
  await page
    .locator(".integration-card")
    .filter({ hasText: "GitHub" })
    .getByRole("button")
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Not configured", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  const snapshot = await (await apiContext.get("/api/bootstrap")).json();
  const currentName = snapshot.servers.find((s: any) => s.id === serverId)
    .name as string;
  await page.getByRole("dialog").getByRole("searchbox").fill(currentName);
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: new RegExp(currentName) }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
});
test("a real WebRTC call stays active while reading messages and stops on explicit leave", async ({
  page,
  context,
  browser,
}) => {
  await context.grantPermissions(["microphone", "camera"]);
  const other = await secondContext(browser);
  const receiver = await other.newPage();
  const errors: string[] = [];
  receiver.on("pageerror", (e) => errors.push(e.message));
  page.on("pageerror", (e) => errors.push(e.message));
  for (const p of [page, receiver])
    await p.evaluate(() => {
      const Original = window.RTCPeerConnection;
      (window as any).__peers = [];
      window.RTCPeerConnection = class extends Original {
        constructor(config?: RTCConfiguration) {
          super(config);
          (window as any).__peers.push(this);
        }
      };
    });
  await page.goto(`/#/voice/${serverId}/lounge`);
  await receiver.goto(`/#/voice/${serverId}/lounge`);
  await receiver.evaluate(() => {
    const Original = window.RTCPeerConnection;
    (window as any).__peers = [];
    window.RTCPeerConnection = class extends Original {
      constructor(config?: RTCConfiguration) {
        super(config);
        (window as any).__peers.push(this);
      }
    };
  });
  await page
    .getByRole("button", { name: "Join voice room", exact: true })
    .click();
  await expect(page.getByText("1 person connected"))
    .toBeVisible({ timeout: 15000 })
    .catch(async (error) => {
      console.log(
        JSON.stringify({
          alerts: await page.locator("[role=alert]").allTextContents(),
          pageErrors: errors,
        }),
      );
      throw error;
    });
  await receiver
    .getByRole("button", { name: "Join voice room", exact: true })
    .click();
  await expect(page.getByText("2 people connected")).toBeVisible();
  await expect(receiver.getByText("2 people connected")).toBeVisible();
  await page
    .getByRole("button", { name: "Turn camera on", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Unmute microphone", exact: true })
    .click();
  await expect
    .poll(
      () =>
        receiver
          .locator(".participant-tile video")
          .evaluateAll((videos) =>
            videos.some(
              (v) =>
                (v as HTMLVideoElement).videoWidth > 0 &&
                ((v as HTMLVideoElement).srcObject as MediaStream)
                  ?.getVideoTracks()
                  .some((t) => t.readyState === "live"),
            ),
          ),
      { timeout: 25000 },
    )
    .toBe(true)
    .catch(async (e) => {
      for (const p of [page, receiver])
        console.log(
          JSON.stringify(
            await p.evaluate(() => ({
              videos: [...document.querySelectorAll("video")].map((v) => ({
                width: v.videoWidth,
                paused: v.paused,
                ready: v.readyState,
              })),
              alerts: [...document.querySelectorAll("[role=alert]")].map(
                (e) => e.textContent,
              ),
              peers: ((window as any).__peers || []).map(
                (pc: RTCPeerConnection) => ({
                  connection: pc.connectionState,
                  ice: pc.iceConnectionState,
                  signaling: pc.signalingState,
                  tracks: pc.getTransceivers().map((t) => ({
                    mid: t.mid,
                    direction: t.currentDirection,
                    send: t.sender.track?.kind,
                    sendState: t.sender.track?.readyState,
                    enabled: t.sender.track?.enabled,
                    sendMuted: t.sender.track?.muted,
                    receive: t.receiver.track.kind,
                    muted: t.receiver.track.muted,
                  })),
                }),
              ),
            })),
          ),
        );
      throw e;
    });
  await expect
    .poll(() =>
      receiver
        .locator("audio")
        .evaluateAll((elements) =>
          elements.some((a) =>
            (a.srcObject as MediaStream)
              ?.getAudioTracks()
              .some((t) => t.readyState === "live"),
          ),
        ),
    )
    .toBe(true);
  const noiseControl = page.getByRole("button", {
    name: "Turn noise suppression off",
  });
  await expect(noiseControl).toHaveAttribute("aria-pressed", "true");
  await noiseControl.click();
  await expect(
    page.getByRole("button", { name: "Turn noise suppression on" }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Turn noise suppression on" }).click();
  await page.locator(`a[href="#/server/${serverId}/general"]`).click();
  await expect(page).toHaveURL(new RegExp(`#/?server/${serverId}/general$`));
  const dock = page.getByRole("complementary", { name: "Background call" });
  await expect(dock).toBeVisible();
  await expect(dock).toContainText("2 people");
  await expect(receiver.getByText("2 people connected")).toBeVisible();
  await expect
    .poll(() =>
      receiver
        .locator("audio")
        .evaluateAll((elements) =>
          elements.some((a) =>
            (a.srcObject as MediaStream)
              ?.getAudioTracks()
              .some((t) => t.readyState === "live"),
          ),
        ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      receiver
        .locator(".participant-tile video")
        .evaluateAll((videos) =>
          videos.some(
            (video) =>
              (video as HTMLVideoElement).videoWidth > 0 &&
              ((video as HTMLVideoElement).srcObject as MediaStream)
                ?.getVideoTracks()
                .some((track) => track.readyState === "live"),
          ),
        ),
    )
    .toBe(true);
  await dock
    .getByRole("button", { name: "Return to lounge voice room" })
    .click();
  await expect(page.getByText("2 people connected")).toBeVisible();
  await receiver
    .getByRole("button", { name: "Turn camera on", exact: true })
    .click();
  await expect
    .poll(() => page.locator(".participant-tile video").count())
    .toBe(2);
  await expect
    .poll(() =>
      page
        .locator(".participant-tile video")
        .evaluateAll((v) =>
          v.every((el) => (el as HTMLVideoElement).videoWidth > 0),
        ),
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "Share your screen", exact: true })
    .click();
  await expect
    .poll(
      () =>
        receiver
          .locator(".screen-share-tile video")
          .evaluateAll((v) =>
            v.some((el) => (el as HTMLVideoElement).videoWidth > 0),
          ),
      { timeout: 15000 },
    )
    .toBe(true);
  const remoteScreen = receiver.locator(".screen-share-tile").first();
  await remoteScreen.getByRole("button", { name: /full size/ }).click();
  await expect(remoteScreen).toHaveClass(/expanded/);
  await remoteScreen
    .getByRole("button", { name: "Return shared screen to the grid" })
    .click();
  await expect(remoteScreen).not.toHaveClass(/expanded/);
  await receiver
    .getByRole("button", { name: "Share your screen", exact: true })
    .click();
  await expect(page.locator(".screen-share-tile")).toHaveCount(2);
  await expect(receiver.locator(".screen-share-tile")).toHaveCount(2);
  await receiver.screenshot({ path: "screenshots/live-screen-sharing.png" });
  await receiver
    .getByRole("button", { name: "Stop sharing screen", exact: true })
    .click();
  await expect(page.locator(".screen-share-tile")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Stop sharing screen", exact: true })
    .click();
  await expect(receiver.locator(".screen-share-tile")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Leave voice room", exact: true })
    .click();
  await expect(receiver.getByText("1 person connected")).toBeVisible();
  expect(errors).toEqual([]);
  await other.close();
});
test("an SFU room accepts thirteen real browser participants without peer-to-peer fan-out", async ({
  page,
  browser,
}) => {
  test.setTimeout(240000);
  const ids = Array.from(
    { length: 11 },
    (_, index) => `sfu-${suffix}-${index}`,
  );
  const emails = ids.map((id) => `${id}@example.invalid`);
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [page];
  const { default: pg } = await import("pg");
  const fixture = new pg.Client({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  await fixture.connect();
  try {
    await fixture.query("DELETE FROM noctis.users WHERE id LIKE 'sfu-%'");
    await fixture.query(
      "INSERT INTO noctis.users(id,email,password_hash,email_verified_at) SELECT x.id,x.email,u.password_hash,now() FROM unnest($1::text[],$2::text[]) x(id,email) CROSS JOIN noctis.users u WHERE u.id='alex'",
      [ids, emails],
    );
    await fixture.query(
      "INSERT INTO noctis.profiles(user_id,name,handle) SELECT id,'SFU Participant '||ordinality,'sfu.'||$2||'.'||ordinality FROM unnest($1::text[]) WITH ORDINALITY AS x(id,ordinality)",
      [ids, suffix],
    );
    await fixture.query(
      "INSERT INTO noctis.server_members(server_id,user_id) SELECT $1,id FROM unnest($2::text[]) x(id)",
      [serverId, ids],
    );
    const memberContext = await secondContext(browser);
    contexts.push(memberContext);
    pages.push(await memberContext.newPage());
    const states: Awaited<ReturnType<typeof apiContext.storageState>>[] = [];
    const loginState = async (email: string) => {
      const client = await request.newContext({
        baseURL: origin,
        extraHTTPHeaders: { Origin: origin },
      });
      try {
        const login = await client.post("/api/auth/login", {
          data: { email, password: process.env.SEED_PASSWORD },
        });
        expect(login.status()).toBe(200);
        return await client.storageState();
      } finally {
        await client.dispose();
      }
    };
    for (let offset = 0; offset < emails.length; offset += 3)
      states.push(
        ...(await Promise.all(
          emails.slice(offset, offset + 3).map(loginState),
        )),
      );
    for (const state of states) {
      const context = await browser.newContext({ baseURL: origin });
      await context.addCookies((await state).cookies);
      contexts.push(context);
      pages.push(await context.newPage());
    }
    for (let offset = 0; offset < pages.length; offset += 4)
      await Promise.all(
        pages
          .slice(offset, offset + 4)
          .map((p) => p.goto(`/#/voice/${serverId}/lounge`)),
      );
    for (const p of pages)
      await p.evaluate(() => {
        const Original = window.RTCPeerConnection;
        (window as any).__sfuPeers = [];
        window.RTCPeerConnection = class extends Original {
          constructor(config?: RTCConfiguration) {
            super(config);
            (window as any).__sfuPeers.push(this);
          }
        };
      });
    for (let offset = 0; offset < pages.length; offset += 3)
      await Promise.all(
        pages.slice(offset, offset + 3).map(async (p) => {
          const join = p.getByRole("button", {
            name: "Join voice room",
            exact: true,
          });
          await expect(join).toBeEnabled({ timeout: 30000 });
          await join.click();
          await expect(p.getByText(/(?:person|people) connected/)).toBeVisible({
            timeout: 45000,
          });
        }),
      );
    await expect(pages.at(-1)!.getByText("13 people connected")).toBeVisible({
      timeout: 30000,
    });
    console.log("SFU scale check: 13 Noctis participants connected");
    const { RoomServiceClient } = await import("livekit-server-sdk");
    const media = new RoomServiceClient(
      process.env.LIVEKIT_INTERNAL_URL!,
      process.env.LIVEKIT_API_KEY!,
      process.env.LIVEKIT_API_SECRET!,
    );
    await expect
      .poll(
        async () =>
          (await media.listRooms()).find((item) => item.name.endsWith(voiceId))
            ?.numParticipants,
        { timeout: 30000 },
      )
      .toBe(13);
    console.log("SFU scale check: LiveKit reports 13 participants");
    const sampledPages = [pages[0], pages[6], pages[12]];
    const peerCounts: number[] = [];
    for (const sampled of sampledPages)
      peerCounts.push(
        await sampled.evaluate(
          () =>
            ((window as any).__sfuPeers || []).filter(
              (peer: RTCPeerConnection) => peer.connectionState !== "closed",
            ).length,
        ),
      );
    expect(peerCounts).toEqual([1, 1, 1]);
    console.log("SFU scale check: sampled browsers use one peer connection");
    await expect(
      page.getByRole("navigation", { name: "Call participants" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Next people" }).click();
    await expect(page.getByText("2 / 2", { exact: true })).toBeVisible();
    console.log("SFU scale check: participant pagination passed");
  } finally {
    console.log("SFU scale check: closing fixture contexts");
    await Promise.allSettled(
      contexts.map((context) =>
        Promise.race([
          context.close(),
          new Promise<void>((resolve) => setTimeout(resolve, 10000)),
        ]),
      ),
    );
    try {
      await fixture.query("SET lock_timeout='5s'; SET statement_timeout='15s'");
      await fixture.query("DELETE FROM noctis.users WHERE id=ANY($1::text[])", [
        ids,
      ]);
    } finally {
      await fixture.end();
    }
    console.log("SFU scale check: fixtures removed");
  }
});
test("new accounts authenticate, complete onboarding, and retain server-backed identity", async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: origin });
  const page = await context.newPage();
  await page.goto("/#/home");
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "screenshots/live-login.png" });
  await page
    .getByRole("button", { name: "New here? Create an account", exact: true })
    .click();
  await page.getByLabel("Display name").fill("Riley Rivers");
  await page.getByLabel("Username").fill(`riley.${suffix}`);
  await page
    .getByLabel("Email address")
    .fill(`riley.${suffix}@example.invalid`);
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
  await page
    .getByLabel("Password", { exact: true })
    .fill(randomUUID() + randomUUID());
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Verify your email" }),
  ).toBeVisible();
  await page.goto(await mailLink(`riley.${suffix}@example.invalid`, "verify"));
  await page
    .getByRole("button", { name: "Confirm email", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "What brings you here, Riley?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Technology", exact: true }).click();
  await page
    .getByRole("button", { name: "Discover your communities", exact: true })
    .click();
  await page.goto("/#/home");
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: /Good (morning|afternoon|evening), Riley/,
    }),
  ).toBeVisible();
  await context.close();
});
test("music commands open the native player and server settings remain configurable", async ({
  page,
}) => {
  await page.goto(`/#/server/${serverId}/general`);
  const composer = page.getByRole("textbox", { name: "Message", exact: true });
  await composer.fill("/play");
  await composer.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Add to Noctis Music" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Type a song name or paste a music link"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();

  await page.goto(`/#/voice/${serverId}/lounge`);
  await page.getByRole("button", { name: "Join voice room" }).click();
  await expect(
    page.getByRole("article", { name: "Noctis Music participant" }),
  ).toBeVisible();
  await expect(page.getByText("BOT", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "screenshots/music-player-desktop.png",
    fullPage: true,
  });

  await page.evaluate(() => {
    (window as any).YT = {
      Player: class {
        private time = 0;
        constructor(target: HTMLElement, options: any) {
          const frame = document.createElement("iframe");
          frame.title = "Official YouTube test player";
          frame.dataset.provider = "youtube";
          target.appendChild(frame);
          queueMicrotask(options.events.onReady);
        }
        destroy() {}
        getCurrentTime() {
          return this.time;
        }
        pauseVideo() {}
        playVideo() {}
        seekTo(value: number) {
          this.time = value;
        }
        setVolume() {}
        stopVideo() {}
      },
    };
  });
  const trackId = randomUUID();
  const { default: pg } = await import("pg");
  const musicFixture = new pg.Client({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  await musicFixture.connect();
  const revision = await musicFixture.query(
    `UPDATE noctis.music_sessions SET voice_channel_id=$2,current_track=$3::jsonb,
     requested_by='alex',playback_state='PLAYING',started_at=now(),position_seconds=0,
     revision=revision+1 WHERE server_id=$1 RETURNING revision`,
    [
      serverId,
      voiceId,
      JSON.stringify({
        id: trackId,
        title: "Official provider session",
        artist: "Noctis Test",
        url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
        provider: "youtube",
        thumbnail: null,
        duration: 120,
        playbackMode: "embed",
        requestedBy: "alex",
        requestedAt: new Date().toISOString(),
      }),
    ],
  );
  await musicFixture.query("SELECT pg_notify('noctis_music',$1)", [
    JSON.stringify({
      serverId,
      event: "music:trackStarted",
      revision: Number(revision.rows[0].revision),
    }),
  ]);
  await musicFixture.end();
  await expect(
    page.getByRole("region", { name: "Official youtube playback" }),
  ).toBeVisible();
  await expect(page.getByTitle("Official YouTube test player")).toBeVisible();
  await page.evaluate(() => {
    (window as any).__musicPlaybackFrame = document.querySelector(
      'iframe[title="Official YouTube test player"]',
    );
  });
  await page.screenshot({
    path: "screenshots/music-official-youtube.png",
    fullPage: true,
  });
  await page.locator(`a[href="#/server/${serverId}/general"]`).click();
  await expect(
    page.getByRole("complementary", { name: "Background call" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as any).__musicPlaybackFrame?.isConnected,
    ),
  ).toBe(true);
  const chatMusic = page.getByRole("region", {
    name: "Noctis Music controls",
  });
  await expect(chatMusic).toBeVisible();
  await expect(chatMusic.getByRole("button", { name: "Pause" })).toBeEnabled();
  await chatMusic.getByRole("button", { name: "Pause" }).click();
  await expect(chatMusic.getByRole("button", { name: "Resume" })).toBeVisible();
  await chatMusic.getByRole("button", { name: "Resume" }).click();
  await expect(chatMusic.getByLabel("Music Bot volume")).toBeVisible();
  await expect(
    chatMusic.getByRole("button", { name: "Open music queue" }),
  ).toBeVisible();
  await page.evaluate(() => {
    location.hash = "#/missions";
  });
  expect(
    await page.evaluate(
      () => (window as any).__musicPlaybackFrame?.isConnected,
    ),
  ).toBe(true);
  await page.evaluate((id) => {
    location.hash = `#/voice/${id}/lounge`;
  }, serverId);
  await expect(page.getByTitle("Official YouTube test player")).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as any).__musicPlaybackFrame?.isConnected,
    ),
  ).toBe(true);
  await page.locator(`a[href="#/server/${serverId}/general"]`).click();
  await page.screenshot({
    path: "screenshots/music-controls-general.png",
    fullPage: true,
  });
  await chatMusic.getByRole("button", { name: "Stop and clear queue" }).click();
  await page.getByRole("button", { name: "Leave voice room" }).click();

  await page.goto(`/#/admin/${serverId}`);
  await page.getByRole("button", { name: "Music", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Noctis Music" }),
  ).toBeVisible();
  await page.getByLabel("Default Music Bot volume").fill("45");
  await page.getByRole("button", { name: "Save music settings" }).click();
  await expect(page.getByText("Music settings saved")).toBeVisible();
});
test("desktop and mobile authenticated screens have no serious accessibility violations or overflow", async ({
  page,
}) => {
  for (const route of [
    "home",
    "missions",
    "settings/account",
    `admin/${serverId}`,
    `server/${serverId}/general`,
    `voice/${serverId}/lounge`,
  ]) {
    await page.goto("/#/" + route);
    await expect(page.locator(".workspace")).toBeVisible();
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            document
              .getAnimations()
              .every(
                (animation) =>
                  animation.playState === "finished" ||
                  animation.effect?.getTiming().iterations === Infinity,
              ),
          ),
        { timeout: 3000 },
      )
      .toBe(true);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of [
    "home",
    "missions",
    "settings/account",
    `server/${serverId}/general`,
    `voice/${serverId}/lounge`,
  ]) {
    await page.goto("/#/" + route);
    await expect(page.locator(".workspace")).toBeVisible();
    expect(
      await page.locator("body").evaluate((el) => el.scrollWidth <= innerWidth),
    ).toBe(true);
  }
  await page.screenshot({
    path: "screenshots/live-mobile.png",
    fullPage: true,
  });
});

