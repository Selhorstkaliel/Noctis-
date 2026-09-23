import "dotenv/config";
import { z } from "zod";
import { isAbsolute, relative, resolve } from "node:path";
const env = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    MAIL_TRANSPORT: z.enum(["file", "smtp", "mailersend"]).default("file"),
    MAIL_FROM: z.string().email().default("noctis@localhost.invalid"),
    MAILERSEND_API_TOKEN: z.string().default(""),
    SMTP_HOST: z.string().default(""),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_USER: z.string().default(""),
    SMTP_PASSWORD: z.string().default(""),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    APP_ORIGIN: z.string().url(),
    DATABASE_URL: z.string().min(1),
    AUTH_DATABASE_URL: z.string().min(1),
    WORKER_DATABASE_URL: z.string().min(1),
    SESSION_SECRET: z.string().regex(/^[a-f\d]{64}$/i),
    ENCRYPTION_KEY: z.string().regex(/^[a-f\d]{64}$/i),
    STORAGE_PATH: z.string().min(1),
    STORAGE_DRIVER: z.enum(["local", "r2"]).default("local"),
    UPLOAD_GC_OWNER: z.enum(["api", "worker"]).default("worker"),
    R2_ENDPOINT: z.string().default(""),
    R2_BUCKET: z.string().default(""),
    R2_ACCESS_KEY_ID: z.string().default(""),
    R2_SECRET_ACCESS_KEY: z.string().default(""),
    DATABASE_SSL: z.enum(["true", "false"]).default("true"),
    API_POOL_SIZE: z.coerce.number().int().min(2).max(50).default(15),
    AUTH_POOL_SIZE: z.coerce.number().int().min(1).max(20).default(5),
    WORKER_POOL_SIZE: z.coerce.number().int().min(1).max(20).default(5),
    DB_CONNECT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(10000)
      .default(2000),
    REALTIME_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),
    LIVEKIT_INTERNAL_URL: z.string().url().default("http://127.0.0.1:17880"),
    LIVEKIT_API_KEY: z.string().default(""),
    LIVEKIT_API_SECRET: z.string().default(""),
    MUSIC_AUDIO_HOSTS: z.string().default(""),
    MUSIC_MAX_QUEUE: z.coerce.number().int().min(1).max(500).default(100),
    MUSIC_MAX_TRACK_SECONDS: z.coerce
      .number()
      .int()
      .min(30)
      .max(86400)
      .default(3600),
    MUSIC_MAX_SOURCE_BYTES: z.coerce
      .number()
      .int()
      .min(1024 * 1024)
      .max(2 * 1024 * 1024 * 1024)
      .default(200 * 1024 * 1024),
    MUSIC_FETCH_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(30000)
      .default(10000),
    MUSIC_IDLE_DISCONNECT_SECONDS: z.coerce
      .number()
      .int()
      .min(30)
      .max(3600)
      .default(300),
    FFMPEG_PATH: z.string().min(1).default("ffmpeg"),
  })
  .safeParse(process.env);
if (!env.success)
  throw new Error(
    `Invalid server configuration: ${env.error.issues.map((i) => i.path.join(".")).join(", ")}`,
  );
export const config = {
  ...env.data,
  MUSIC_AUDIO_HOSTS: new Set(
    env.data.MUSIC_AUDIO_HOSTS.split(",")
      .map((host) => host.trim().toLowerCase().replace(/\.$/, ""))
      .filter(Boolean),
  ),
};
export const production = config.NODE_ENV === "production";
if (config.STORAGE_DRIVER === "r2") {
  let endpoint: URL;
  try {
    endpoint = new URL(config.R2_ENDPOINT);
  } catch {
    throw new Error("R2_ENDPOINT must be a valid HTTPS origin.");
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== "/" ||
    !endpoint.hostname.endsWith(".r2.cloudflarestorage.com") ||
    !config.R2_BUCKET ||
    !config.R2_ACCESS_KEY_ID ||
    !config.R2_SECRET_ACCESS_KEY
  )
    throw new Error(
      "Configure a private R2 bucket and server-side S3 credentials.",
    );
}
if (production && config.MAIL_TRANSPORT === "file")
  throw new Error("Production requires external email delivery.");
if (
  production &&
  (config.MAIL_FROM.endsWith(".invalid") ||
    (config.MAIL_TRANSPORT === "smtp" &&
      (!config.SMTP_USER || !config.SMTP_PASSWORD)) ||
    (config.MAIL_TRANSPORT === "mailersend" && !config.MAILERSEND_API_TOKEN))
)
  throw new Error(
    "Production requires a mail sender and delivery credentials.",
  );
if (
  production &&
  (config.ENCRYPTION_KEY === config.SESSION_SECRET ||
    /^(.)\1{63}$/.test(config.ENCRYPTION_KEY) ||
    /^(.)\1{63}$/.test(config.SESSION_SECRET))
)
  throw new Error(
    "Production requires distinct random encryption and session keys.",
  );
if (
  config.MAIL_TRANSPORT === "smtp" &&
  (!config.SMTP_HOST || (config.SMTP_USER && !config.SMTP_PASSWORD))
)
  throw new Error(
    "Configure SMTP_HOST and SMTP credentials before enabling email delivery.",
  );
if (new URL(config.APP_ORIGIN).origin !== config.APP_ORIGIN)
  throw new Error("APP_ORIGIN must be an origin without a path.");
if (production && !config.APP_ORIGIN.startsWith("https://"))
  throw new Error("Production requires HTTPS.");
if (production && config.DATABASE_SSL !== "true")
  throw new Error("Production database connections require verified TLS.");
if (!isAbsolute(config.STORAGE_PATH))
  throw new Error("STORAGE_PATH must be absolute.");
const storageRelative = relative(resolve("."), resolve(config.STORAGE_PATH));
if (!storageRelative.startsWith("..") && !isAbsolute(storageRelative))
  throw new Error("Storage must be outside the application directory.");
export const cookieName = production ? "__Host-noctis" : "noctis_session";
export function publicWebSocketUrl(path: string) {
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  const origin = railwayDomain ? `https://${railwayDomain}` : config.APP_ORIGIN;
  const url = new URL(path, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

