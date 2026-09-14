import "dotenv/config";
import { parse } from "dotenv";
import pg from "pg";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
if (process.env.NODE_ENV === "production")
  throw new Error("Test setup cannot use production configuration.");
const dbName = "noctis_test";
const adminUrl = new URL(process.env.ADMIN_DATABASE_URL);
adminUrl.pathname = "/postgres";
const admin = new pg.Client({ connectionString: adminUrl.href });
await admin.connect();
try {
  if (
    !(await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [dbName]))
      .rowCount
  )
    await admin.query("CREATE DATABASE noctis_test OWNER noctis_migrator");
} finally {
  await admin.end();
}
const base = await readFile(".env", "utf8");
const values = Object.fromEntries(
  base
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
for (const key of [
  "DATABASE_URL",
  "AUTH_DATABASE_URL",
  "WORKER_DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "ADMIN_DATABASE_URL",
]) {
  const url = new URL(values[key]);
  url.pathname = "/" + dbName;
  values[key] = url.href;
}
const previous = await readFile(".env.test", "utf8")
  .then(parse)
  .catch(() => ({}));
Object.assign(values, {
  NODE_ENV: "test",
  MAIL_TRANSPORT: "file",
  PORT: "3002",
  WEB_PORT: "5174",
  API_ORIGIN: "http://127.0.0.1:3002",
  APP_ORIGIN: "http://localhost:5174",
  SESSION_SECRET: previous.SESSION_SECRET || randomBytes(32).toString("hex"),
  ENCRYPTION_KEY: previous.ENCRYPTION_KEY || randomBytes(32).toString("hex"),
  STORAGE_PATH: resolve(tmpdir(), "noctis-test-uploads").replaceAll("\\", "/"),
  SEED_DEMO: "true",
  SEED_EMAIL: "owner@noctis-test.invalid",
});
await mkdir(values.STORAGE_PATH, { recursive: true });
await writeFile(
  ".env.test",
  Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n",
  { mode: 0o600 },
);
const env = {
  ...process.env,
  ...values,
  DOTENV_CONFIG_PATH: resolve(".env.test"),
};
for (const file of ["server/migrate.ts", "server/seed.ts"]) {
  const result = spawnSync(process.execPath, ["--import", "tsx", file], {
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
const fixtures = new pg.Client({
  connectionString: values.MIGRATION_DATABASE_URL,
});
await fixtures.connect();
await fixtures.query(
  "UPDATE noctis.users SET email_verified_at=coalesce(email_verified_at,now()) WHERE id='alex'",
);
await fixtures.end();
console.log(
  "Isolated PostgreSQL test environment prepared. Credentials remain private.",
);
