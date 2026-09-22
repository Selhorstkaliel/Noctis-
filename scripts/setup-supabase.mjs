import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import dotenv from "dotenv";
import pg from "pg";

const adminEnv = dotenv.parse(readFileSync(".env.supabase"));
const adminUrl = new URL(adminEnv.ADMIN_DATABASE_URL);
const match = /^postgres\.([a-z0-9]+)$/.exec(adminUrl.username);
if (
  !match ||
  !adminUrl.hostname.endsWith(".pooler.supabase.com") ||
  adminUrl.port !== "5432" ||
  adminUrl.pathname !== "/postgres" ||
  !adminUrl.password ||
  adminUrl.search
)
  throw new Error(
    "Use the Supabase session-pooler administrator URL in .env.supabase.",
  );
if (adminEnv.DATABASE_SSL !== "true" || !adminEnv.DATABASE_CA)
  throw new Error("Configure verified TLS and DATABASE_CA in .env.supabase.");
const ssl = {
  rejectUnauthorized: true,
  ca: readFileSync(adminEnv.DATABASE_CA, "utf8"),
};
const runtimePath = ".env.supabase.runtime";
const migrationPath = ".env.supabase.migration";
const runtimeExists = existsSync(runtimePath);
const migrationExists = existsSync(migrationPath);
if (runtimeExists !== migrationExists)
  throw new Error(
    "Both private Supabase environment files must exist together; restore the missing file.",
  );
const connection = (role) => {
  const url = new URL(adminUrl);
  url.username = `${role}.${match[1]}`;
  url.password = randomBytes(32).toString("hex");
  return url.toString();
};
const runtime = runtimeExists
  ? dotenv.parse(readFileSync(runtimePath))
  : {
      DATABASE_URL: connection("noctis_api"),
      AUTH_DATABASE_URL: connection("noctis_auth"),
      WORKER_DATABASE_URL: connection("noctis_worker"),
      DATABASE_SSL: "true",
      DATABASE_CA: adminEnv.DATABASE_CA,
      API_POOL_SIZE: "5",
      AUTH_POOL_SIZE: "2",
      WORKER_POOL_SIZE: "2",
      DB_CONNECT_TIMEOUT_MS: "10000",
    };
runtime.LISTENER_DATABASE_URL = runtime.DATABASE_URL;
const migration = migrationExists
  ? dotenv.parse(readFileSync(migrationPath))
  : {
      MIGRATION_DATABASE_URL: connection("noctis_migrator"),
      NODE_ENV: "production",
      DOTENV_CONFIG_PATH: ".env.supabase.migration",
      DATABASE_SSL: "true",
      DATABASE_CA: adminEnv.DATABASE_CA,
    };
const roleUrls = {
  noctis_api: runtime.DATABASE_URL,
  noctis_auth: runtime.AUTH_DATABASE_URL,
  noctis_worker: runtime.WORKER_DATABASE_URL,
  noctis_migrator: migration.MIGRATION_DATABASE_URL,
};
for (const [role, value] of Object.entries(roleUrls)) {
  const url = new URL(value);
  if (
    url.host !== adminUrl.host ||
    url.pathname !== adminUrl.pathname ||
    url.username !== `${role}.${match[1]}` ||
    !url.password ||
    url.search
  )
    throw new Error(`Unexpected target or role in ${role} configuration.`);
}
const serialize = (values) =>
  Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n";
const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
const admin = new pg.Client({
  connectionString: adminEnv.ADMIN_DATABASE_URL,
  ssl,
  connectionTimeoutMillis: 10000,
});
try {
  await admin.connect();
  const {
    rows: [state],
  } = await admin.query(
    "SELECT current_database() AS database, to_regnamespace('noctis') IS NOT NULL AS initialized",
  );
  if (state.initialized && !runtimeExists)
    throw new Error(
      "Noctis already exists. Restore its runtime credentials; passwords will not be reset.",
    );
  const { rows: access } = await admin.query(
    "SELECT rolname,rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=ANY($1)",
    [Object.keys(roleUrls)],
  );
  if (
    access.length !== 4 ||
    access.some(
      (role) =>
        !role.rolcanlogin ||
        role.rolsuper ||
        role.rolbypassrls ||
        role.rolcreatedb ||
        role.rolcreaterole,
    )
  )
    throw new Error(
      "Expected the four existing restricted Noctis login roles.",
    );
  const {
    rows: [privileges],
  } = await admin.query(
    "SELECT has_database_privilege('noctis_migrator',current_database(),'CREATE') AND has_schema_privilege('noctis_migrator','public','USAGE') AND has_schema_privilege('noctis_migrator','public','CREATE') AS ready",
  );
  if (!privileges.ready)
    throw new Error(
      "Existing migration role is missing required privileges. No administrative permissions will be granted by this script.",
    );
  if (!runtimeExists) {
    writeFileSync(runtimePath, serialize(runtime), { flag: "wx", mode: 0o600 });
    writeFileSync(migrationPath, serialize(migration), {
      flag: "wx",
      mode: 0o600,
    });
  }
  // Existing installations must authenticate before any changes or password rotation.
  if (state.initialized) {
    for (const value of Object.values(roleUrls)) {
      const client = new pg.Client({
        connectionString: value,
        ssl,
        connectionTimeoutMillis: 10000,
      });
      try {
        await client.connect();
        await client.query("SELECT 1");
      } finally {
        await client.end();
      }
    }
  }
  await admin.query("BEGIN");
  await admin.query("SET LOCAL lock_timeout='5s'");
  for (const [role, value] of Object.entries(roleUrls)) {
    if (!state.initialized)
      await admin.query(
        `ALTER ROLE ${quote(role)} PASSWORD ${literal(decodeURIComponent(new URL(value).password))}`,
      );
  }
  await admin.query(readFileSync("infra/supabase-compatibility.sql", "utf8"));
  await admin.query("COMMIT");
  console.log(
    "Supabase roles, private configuration and pgcrypto compatibility are ready.",
  );
} catch (error) {
  await admin.query("ROLLBACK").catch(() => {});
  // Print only a sanitized message, never the query or PostgreSQL context.
  let message = String(error.message);
  for (const value of [
    ...Object.values(roleUrls),
    adminEnv.ADMIN_DATABASE_URL,
  ]) {
    const password = new URL(value).password;
    message = message
      .replaceAll(value, "[redacted]")
      .replaceAll(password, "[redacted]")
      .replaceAll(decodeURIComponent(password), "[redacted]");
  }
  console.error(
    "Supabase setup failed:",
    error.code || "configuration or connection error",
    message,
  );
  process.exitCode = 1;
} finally {
  await admin.end();
}
