import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
if (existsSync(".env")) {
  console.log("Existing .env preserved.");
  process.exit(0);
}
const secret = () => randomBytes(32).toString("hex");
const passwords = Object.fromEntries(
  ["postgres", "api", "auth", "worker", "migrator"].map((k) => [k, secret()]),
);
const storage = resolve(tmpdir(), "noctis-private-storage");
mkdirSync(storage, { recursive: true });
const url = (role) =>
  `postgresql://${role === "postgres" ? "postgres" : `noctis_${role}`}:${passwords[role]}@localhost:54329/noctis`;
writeFileSync(
  ".env",
  [
    "NODE_ENV=development",
    "PORT=3001",
    "APP_ORIGIN=http://localhost:5173",
    `POSTGRES_PASSWORD=${passwords.postgres}`,
    `ADMIN_DATABASE_URL=${url("postgres")}`,
    `DATABASE_URL=${url("api")}`,
    `AUTH_DATABASE_URL=${url("auth")}`,
    `WORKER_DATABASE_URL=${url("worker")}`,
    `MIGRATION_DATABASE_URL=${url("migrator")}`,
    `SESSION_SECRET=${secret()}`,
    `ENCRYPTION_KEY=${secret()}`,
    `STORAGE_PATH=${storage.replaceAll("\\", "/")}`,
    "DATABASE_SSL=false",
    "SEED_DEMO=false",
    "SEED_EMAIL=owner@noctis.local",
    `SEED_PASSWORD=${secret()}`,
  ].join("\n") + "\n",
  { mode: 0o600, flag: "wx" },
);
console.log(
  "Private local configuration generated in .env. No credentials printed.",
);
