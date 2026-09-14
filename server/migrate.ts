import "dotenv/config";
import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const ssl =
  process.env.DATABASE_SSL === "true"
    ? {
        rejectUnauthorized: true,
        ...(process.env.DATABASE_CA
          ? { ca: await readFile(process.env.DATABASE_CA, "utf8") }
          : {}),
      }
    : undefined;
if (process.argv.includes("--bootstrap")) {
  if (process.env.NODE_ENV === "production")
    throw new Error(
      "Provision production roles with your database administrator.",
    );
  const admin = new pg.Client({
    connectionString: process.env.ADMIN_DATABASE_URL,
    ssl,
  });
  await admin.connect();
  const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;
  const literal = (s: string) => `'${s.replaceAll("'", "''")}'`;
  for (const key of [
    "MIGRATION_DATABASE_URL",
    "DATABASE_URL",
    "AUTH_DATABASE_URL",
    "WORKER_DATABASE_URL",
  ]) {
    const url = new URL(process.env[key]!);
    const role = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    if (!/^noctis_(api|auth|worker|migrator)$/.test(role))
      throw new Error("Unexpected database role.");
    if (
      !(await admin.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role]))
        .rowCount
    )
      await admin.query(
        `CREATE ROLE ${quote(role)} LOGIN PASSWORD ${literal(password)} NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION`,
      );
    await admin.query(
      `ALTER ROLE ${quote(role)} SET search_path=noctis,pg_catalog`,
    );
  }
  await admin.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  await admin.query("GRANT CREATE ON DATABASE noctis TO noctis_migrator");
  await admin.query("GRANT USAGE,CREATE ON SCHEMA public TO noctis_migrator");
  await admin.query(
    "GRANT noctis_api,noctis_auth,noctis_worker TO noctis_migrator WITH ADMIN OPTION",
  );
  await admin.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  await admin.end();
}
const db = new pg.Client({
  connectionString: process.env.MIGRATION_DATABASE_URL,
  ssl,
});
await db.connect();
await db.query("CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public");
try {
  await db.query("SELECT pg_advisory_lock(916221)");
  await db.query(
    "CREATE TABLE IF NOT EXISTS public.schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const dir = fileURLToPath(new URL("./migrations/", import.meta.url));
  for (const name of (await readdir(dir))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    const sql = await readFile(`${dir}/${name}`, "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const applied = await db.query(
      "SELECT checksum FROM public.schema_migrations WHERE name=$1",
      [name],
    );
    if (applied.rowCount) {
      if (applied.rows[0].checksum !== checksum)
        throw new Error(`Migration checksum mismatch: ${name}`);
      continue;
    }
    await db.query("BEGIN");
    try {
      await db.query(sql);
      await db.query(
        "INSERT INTO public.schema_migrations(name,checksum) VALUES($1,$2)",
        [name, checksum],
      );
      await db.query("COMMIT");
      console.log(`Applied ${name}`);
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    }
  }
} finally {
  await db.query("SELECT pg_advisory_unlock(916221)");
  await db.end();
}
