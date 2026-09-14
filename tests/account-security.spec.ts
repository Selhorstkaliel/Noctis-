import { mailLink, testDatabase } from "./security-mail-helper";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { totp } from "../server/security-core";

test.use({ screenshot: "off", trace: "off" }); // Auth secrets must not enter failure artifacts.
test.beforeAll(async () => {
  await testDatabase(async (db) => {
    await db.query("DELETE FROM noctis.rate_limits");
  });
});
test("duplicate registration explains sign-in and recovery without identifying the conflicting field", async ({
  page,
}) => {
  const existing = await testDatabase(
    async (db) =>
      (
        await db.query(
          "SELECT u.email,p.handle FROM noctis.users u JOIN noctis.profiles p ON p.user_id=u.id WHERE u.email=$1",
          [process.env.SEED_EMAIL],
        )
      ).rows[0],
  );
  const suffix = randomUUID().slice(0, 8);
  await page.addInitScript(() =>
    localStorage.setItem("noctis-preferred-language", "pt-BR"),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/login");
  await page
    .getByRole("button", { name: "Primeira vez aqui? Criar conta" })
    .click();
  await page
    .getByLabel("Nome de exibição", { exact: true })
    .fill("Teste de cadastro");
  await page
    .getByLabel("Senha", { exact: true })
    .fill(`Browser-security-${randomUUID()}`);
  for (const identity of [
    { email: existing.email, handle: `duplicate.${suffix}` },
    { email: `duplicate-${suffix}@example.invalid`, handle: existing.handle },
  ]) {
    await page
      .getByLabel("Endereço de e-mail", { exact: true })
      .fill(identity.email);
    await page
      .getByLabel("Nome de usuário", { exact: true })
      .fill(identity.handle);
    const result = page.waitForResponse((r) =>
      r.url().endsWith("/api/auth/register"),
    );
    await page
      .getByRole("button", { name: "Criar conta", exact: true })
      .click();
    expect((await result).status()).toBe(409);
    await expect(page.getByRole("alert")).toHaveText(
      "Não foi possível criar a conta. Tente outro e-mail ou nome de usuário. Se você já se cadastrou, entre na conta ou redefina sua senha.",
    );
    await expect(
      page.getByLabel("Endereço de e-mail", { exact: true }),
    ).toHaveValue(identity.email);
    await expect(
      page.getByRole("button", { name: "Esqueceu a senha?" }),
    ).toBeVisible();
  }
  await page.getByLabel("Senha", { exact: true }).fill("");
  await page.screenshot({
    path: "screenshots/registration-conflict-mobile.png",
    fullPage: true,
  });
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Já tem uma conta? Entrar" }).click();
  await expect(
    page.getByLabel("Endereço de e-mail", { exact: true }),
  ).toHaveValue(`duplicate-${suffix}@example.invalid`);
  await page.getByRole("button", { name: "Esqueceu a senha?" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Redefina sua senha" }),
  ).toBeVisible();
});
test("registration, email verification, MFA enrollment, challenge and recovery work in the browser", async ({
  page,
  context,
}) => {
  const suffix = randomUUID().slice(0, 8),
    email = `browser-sec-${suffix}@example.invalid`,
    password = `Browser-security-${randomUUID()}`;
  await page.goto("/#/login");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page
    .getByRole("button", { name: "New here? Create an account" })
    .click();
  await page
    .getByLabel("Display name", { exact: true })
    .fill("Security Browser");
  await page.getByLabel("Username", { exact: true }).fill(`sec.${suffix}`);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Verify your email" }),
  ).toBeVisible();
  await page.goto(await mailLink(email, "verify"));
  await expect(page).toHaveURL(/#\/verify-email$/);
  await page
    .getByRole("button", { name: "Confirm email", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Email verified");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/#\/?onboarding$/);
  await page.goto("/#/settings/security");
  await expect(
    page.getByRole("heading", {
      name: "Two-factor authentication",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({ path: "screenshots/security-settings-desktop.png" });
  await page
    .getByRole("button", { name: "Set up authenticator", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Current password", { exact: true }).fill(password);
  const setupResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/auth/mfa/setup") &&
      r.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "Set up authenticator", exact: true })
    .click();
  const setup = await (await setupResponse).json();
  await expect(
    dialog.getByAltText("Authenticator setup QR code"),
  ).toBeVisible();
  await dialog
    .getByLabel("Six-digit code", { exact: true })
    .fill(totp(setup.secret, Math.floor(Date.now() / 30000)));
  const enableResponse = page.waitForResponse((r) =>
    r.url().endsWith("/api/auth/mfa/enable"),
  );
  await dialog
    .getByRole("button", {
      name: "Enable two-factor authentication",
      exact: true,
    })
    .click();
  const enabled = await (await enableResponse).json();
  await expect(
    dialog.getByRole("heading", { name: "Save your recovery codes" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Done", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("I saved my recovery codes", { exact: true }).check();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await context.clearCookies();
  await page.goto("/#/login");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Two-factor authentication" }),
  ).toBeVisible();
  await page
    .getByLabel("Authenticator or recovery code", { exact: true })
    .fill("wrong-code");
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Invalid or already used",
  );
  await page
    .getByLabel("Authenticator or recovery code", { exact: true })
    .fill(enabled.recoveryCodes[0]);
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page).toHaveURL(/#\/?home$/);
  await context.clearCookies();
  await page.goto("/#/forgot-password");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Send recovery link" }).click();
  await expect(page.getByRole("status")).toContainText(
    "If password recovery is available",
  );
  await page.goto(await mailLink(email, "reset"));
  const nextPassword = `Changed-${randomUUID()}`;
  await page.getByLabel("New password", { exact: true }).fill(nextPassword);
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill(nextPassword);
  await page
    .getByLabel("Authenticator or recovery code", { exact: true })
    .fill(enabled.recoveryCodes[1]);
  await page
    .getByRole("button", { name: "Reset password", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Password changed");
});
test("Portuguese recovery has accessible narrow layout, keyboard controls and recoverable network errors", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("noctis-preferred-language", "pt-BR"),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#/forgot-password");
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  await expect(page).toHaveTitle("Redefina sua senha · Noctis");
  await expect(
    page.getByRole("heading", { name: "Redefina sua senha" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Enviar link de recuperação" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Digite um endereço de e-mail válido",
  );
  await expect(
    page.getByLabel("Endereço de e-mail", { exact: true }),
  ).toBeFocused();
  await page
    .getByLabel("Endereço de e-mail", { exact: true })
    .fill("missing@example.invalid");
  await page.route("**/api/auth/password/forgot", async (route) => {
    await new Promise((r) => setTimeout(r, 500));
    await route.abort();
  });
  await page
    .getByRole("button", { name: "Enviar link de recuperação" })
    .click();
  await expect(page.locator('button[type="submit"]')).toBeDisabled();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.unroute("**/api/auth/password/forgot");
  await page
    .getByRole("button", { name: "Enviar link de recuperação" })
    .click();
  await expect(page.getByRole("status")).toContainText("Se a recuperação");
  await page.screenshot({ path: "screenshots/security-recovery-mobile.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});
