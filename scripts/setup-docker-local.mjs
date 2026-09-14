import { readFile, writeFile } from "node:fs/promises";
import { parse } from "dotenv";

const source = parse(await readFile(".env", "utf8"));
const required = [
  "POSTGRES_PASSWORD",
  "ADMIN_DATABASE_URL",
  "DATABASE_URL",
  "AUTH_DATABASE_URL",
  "WORKER_DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "SESSION_SECRET",
  "ENCRYPTION_KEY",
  "SEED_EMAIL",
  "SEED_PASSWORD",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "MEDIA_PUBLIC_IP",
];

const missing = required.filter((key) => !source[key]);
if (missing.length)
  throw new Error(
    `Missing local configuration: ${missing.join(", ")}. Run npm run setup:local first.`,
  );

function containerDatabaseUrl(key) {
  const url = new URL(source[key]);
  url.hostname = "postgres";
  url.port = "5432";
  return url.toString();
}

const docker = {
  ...source,
  NODE_ENV: "development",
  PORT: "3001",
  APP_ORIGIN: "http://localhost:3001",
  ADMIN_DATABASE_URL: containerDatabaseUrl("ADMIN_DATABASE_URL"),
  DATABASE_URL: containerDatabaseUrl("DATABASE_URL"),
  AUTH_DATABASE_URL: containerDatabaseUrl("AUTH_DATABASE_URL"),
  WORKER_DATABASE_URL: containerDatabaseUrl("WORKER_DATABASE_URL"),
  MIGRATION_DATABASE_URL: containerDatabaseUrl("MIGRATION_DATABASE_URL"),
  STORAGE_PATH: "/var/lib/noctis/uploads",
  DATABASE_SSL: "false",
  LIVEKIT_INTERNAL_URL: "http://sfu:7880",
};

const lines = Object.entries(docker).map(([key, value]) => {
  if (/[\r\n]/.test(value)) throw new Error(`Invalid newline in ${key}.`);
  return `${key}=${value}`;
});
await writeFile(".env.docker", `${lines.join("\n")}\n`, { mode: 0o600 });
console.log("Prepared private local Docker configuration in .env.docker.");
