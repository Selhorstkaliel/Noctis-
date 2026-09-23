import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import dotenv from "dotenv";

const paths = [".env.railway.api", ".env.railway.worker"];
if (paths.some((path) => existsSync(path))) {
  console.error(
    "Private Railway configuration already exists; preserve its keys and edit the missing provider values privately.",
  );
  process.exit(1);
}
const runtime = dotenv.parse(readFileSync(".env.supabase.runtime"));
const local = existsSync(".env") ? dotenv.parse(readFileSync(".env")) : {};
const origin = process.env.APP_ORIGIN || "";
if (
  origin &&
  (new URL(origin).origin !== origin || !origin.startsWith("https://"))
)
  throw new Error("APP_ORIGIN must be the final HTTPS frontend origin.");
const cloudMedia = process.env.LIVEKIT_INTERNAL_URL || "";
if (
  cloudMedia &&
  (!cloudMedia.startsWith("https://") ||
    !new URL(cloudMedia).hostname.endsWith(".livekit.cloud"))
)
  throw new Error("Supply the HTTPS LiveKit Cloud project origin.");
const shared = {
  NODE_ENV: "production",
  HOST: "0.0.0.0",
  PORT: "3001",
  APP_ORIGIN: origin,
  DATABASE_SSL: "true",
  DATABASE_CA: "/app/certs/supabase-ca.crt",
  SESSION_SECRET: randomBytes(32).toString("hex"),
  ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  STORAGE_DRIVER: "local",
  STORAGE_PATH: "/var/lib/noctis/uploads",
  UPLOAD_GC_OWNER: "api",
  API_POOL_SIZE: "5",
  AUTH_POOL_SIZE: "2",
  WORKER_POOL_SIZE: "2",
  DB_CONNECT_TIMEOUT_MS: "10000",
  LIVEKIT_INTERNAL_URL: cloudMedia,
  LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY || "",
  LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET || "",
  MAIL_TRANSPORT: process.env.MAIL_TRANSPORT || "mailersend",
  MAIL_FROM: process.env.MAIL_FROM || local.MAIL_FROM || "",
  MAILERSEND_API_TOKEN:
    process.env.MAILERSEND_API_TOKEN || local.MAILERSEND_API_TOKEN || "",
  SMTP_HOST: process.env.SMTP_HOST || local.SMTP_HOST || "",
  SMTP_PORT: process.env.SMTP_PORT || local.SMTP_PORT || "587",
  SMTP_USER: process.env.SMTP_USER || local.SMTP_USER || "",
  SMTP_PASSWORD: process.env.SMTP_PASSWORD || local.SMTP_PASSWORD || "",
  MUSIC_AUDIO_HOSTS: "",
  FFMPEG_PATH: "ffmpeg",
};
const api = {
  ...shared,
  DATABASE_URL: runtime.DATABASE_URL,
  AUTH_DATABASE_URL: runtime.AUTH_DATABASE_URL,
  WORKER_DATABASE_URL: runtime.WORKER_DATABASE_URL,
  LISTENER_DATABASE_URL: runtime.LISTENER_DATABASE_URL,
  // Entrypoint initializes the root-owned volume, then execs the API as node.
  RAILWAY_RUN_UID: "0",
};
const worker = {
  ...shared,
  DATABASE_URL: runtime.WORKER_DATABASE_URL,
  AUTH_DATABASE_URL: runtime.WORKER_DATABASE_URL,
  WORKER_DATABASE_URL: runtime.WORKER_DATABASE_URL,
  LISTENER_DATABASE_URL: runtime.WORKER_DATABASE_URL,
  API_POOL_SIZE: "2",
};
for (const [index, values] of [api, worker].entries()) {
  const contents =
    Object.entries(values)
      .map(([key, value]) => {
        const delimiter = ["'", '"', "`"].find((mark) => !value.includes(mark));
        if (!delimiter || /[\r\n]/.test(value))
          throw new Error(
            `Configure ${key} directly in the provider secret store.`,
          );
        return `${key}=${delimiter}${value}${delimiter}`;
      })
      .join("\n") + "\n";
  const parsed = dotenv.parse(contents);
  for (const [key, value] of Object.entries(values))
    if (parsed[key] !== value)
      throw new Error(`Environment encoding failed for ${key}.`);
  writeFileSync(paths[index], contents, { flag: "wx", mode: 0o600 });
}
const missing = Object.entries(shared)
  .filter(
    ([key, value]) =>
      !value &&
      [
        "APP_ORIGIN",
        "LIVEKIT_INTERNAL_URL",
        "LIVEKIT_API_KEY",
        "LIVEKIT_API_SECRET",
        "MAIL_FROM",
        ...(shared.MAIL_TRANSPORT === "mailersend"
          ? ["MAILERSEND_API_TOKEN"]
          : ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"]),
      ].includes(key),
  )
  .map(([key]) => key);
console.log(
  JSON.stringify(
    {
      files: paths,
      missing,
      mailSenderNeedsProductionVerification:
        shared.MAIL_FROM.includes(".mlsender.net"),
    },
    null,
    2,
  ),
);
