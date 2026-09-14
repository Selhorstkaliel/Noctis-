import "dotenv/config";
import pg from "pg";
import { readFile } from "node:fs/promises";
const ssl =
  process.env.DATABASE_SSL === "true"
    ? {
        rejectUnauthorized: true,
        ...(process.env.DATABASE_CA
          ? { ca: await readFile(process.env.DATABASE_CA, "utf8") }
          : {}),
      }
    : undefined;
const db = new pg.Client({
  connectionString: process.env.MIGRATION_DATABASE_URL,
  ssl,
  options: "-c timezone=UTC",
});
await db.connect();
try {
  const result = await db.query(
    "WITH chain AS (SELECT id,record_hash,previous_hash,coalesce(lag(record_hash) OVER(ORDER BY id),repeat('0',64)) AS expected_previous,encode(public.digest(convert_to(jsonb_build_array(previous_hash,actor_id,action,target,server_id,metadata,created_at)::text,'UTF8'),'sha256'),'hex') AS expected_hash FROM noctis.audit_logs) SELECT count(*)::int AS records,count(*) FILTER(WHERE previous_hash<>expected_previous OR record_hash<>expected_hash)::int AS invalid FROM chain",
  );
  if (result.rows[0].invalid)
    throw new Error("Audit chain verification failed.");
  const checkpoint = await db.query(
    "SELECT id,record_hash FROM noctis.audit_logs ORDER BY id DESC LIMIT 1",
  );
  console.log(
    JSON.stringify({
      verified: true,
      records: result.rows[0].records,
      checkpoint: checkpoint.rows[0] || null,
    }),
  );
} finally {
  await db.end();
}
