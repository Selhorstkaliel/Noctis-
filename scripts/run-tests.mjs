import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import dotenv from "dotenv";
if (!existsSync(".env.test")) throw new Error("Run npm run test:setup first.");
const values = dotenv.parse(readFileSync(".env.test"));
const env = {
  ...process.env,
  ...values,
  LISTENER_DATABASE_URL: values.LISTENER_DATABASE_URL || values.DATABASE_URL,
  DOTENV_CONFIG_PATH: resolve(".env.test"),
};
const args =
  process.argv[2] === "load"
    ? ["--import", "tsx", "server/tests/load.ts"]
    : process.argv[2] === "api"
      ? [
          "--import",
          "tsx",
          "--test",
          "--test-concurrency=1",
          "server/tests/realtime-queue.test.ts",
          "server/tests/music.test.ts",
          "server/tests/music-api.test.ts",
          "server/tests/security.test.ts",
          "server/tests/account-security.test.ts",
        ]
      : [
          "node_modules/@playwright/test/cli.js",
          "test",
          ...process.argv.slice(2),
        ];
const child = spawn(process.execPath, args, { env, stdio: "inherit" });
child.on("exit", (code) => process.exit(code || 0));
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => child.kill());
