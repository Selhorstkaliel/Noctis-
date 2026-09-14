import "dotenv/config";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["live.spec.ts", "account-security.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.APP_ORIGIN || "http://localhost:5173",
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--auto-select-desktop-capture-source=Entire screen",
      ],
    },
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      process.env.NODE_ENV === "test"
        ? "node scripts/start-test-stack.mjs"
        : process.platform === "win32"
          ? "npm.cmd run dev"
          : "npm run dev",
    url: (process.env.APP_ORIGIN || "http://localhost:5173") + "/api/health",
    reuseExistingServer: true,
  },
});
