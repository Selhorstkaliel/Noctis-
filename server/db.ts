import pg, { type PoolClient } from "pg";
import { config } from "./config.js";
import { readFileSync } from "node:fs";
import type { MusicEvent } from "../shared/music.js";
export type DB = PoolClient;
const ssl =
  config.DATABASE_SSL === "true"
    ? {
        rejectUnauthorized: true,
        ...(process.env.DATABASE_CA
          ? { ca: readFileSync(process.env.DATABASE_CA, "utf8") }
          : {}),
      }
    : undefined;
export const apiPool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: config.API_POOL_SIZE,
  connectionTimeoutMillis: config.DB_CONNECT_TIMEOUT_MS,
  ssl,
  statement_timeout: 8000,
  idle_in_transaction_session_timeout: 10000,
});
export const authPool = new pg.Pool({
  connectionString: config.AUTH_DATABASE_URL,
  max: config.AUTH_POOL_SIZE,
  connectionTimeoutMillis: config.DB_CONNECT_TIMEOUT_MS,
  ssl,
  statement_timeout: 5000,
});
export const workerPool = new pg.Pool({
  connectionString: config.WORKER_DATABASE_URL,
  max: config.WORKER_POOL_SIZE,
  connectionTimeoutMillis: config.DB_CONNECT_TIMEOUT_MS,
  ssl,
  statement_timeout: 8000,
});
export type Identity = { userId: string; sessionId: string };
// LISTEN needs a session connection and must never occupy a transaction pool slot.
export const listenerPool = new pg.Pool({
  connectionString: process.env.LISTENER_DATABASE_URL || config.DATABASE_URL,
  max: 2,
  ssl,
  connectionTimeoutMillis: config.DB_CONNECT_TIMEOUT_MS,
});
for (const pool of [apiPool, authPool, workerPool, listenerPool])
  pool.on("error", () => {
    // pg discards the idle connection; requests reconnect with a bounded deadline.
    process.stderr.write("Database idle connection lost.\n");
  });
export async function transaction<T>(
  identity: Identity,
  fn: (db: DB) => Promise<T>,
): Promise<T> {
  if (apiPool.waitingCount >= config.API_POOL_SIZE * 4)
    throw Object.assign(
      new Error("Server is busy. Please try again shortly."),
      { statusCode: 503 },
    );
  const db = await apiPool.connect();
  try {
    await db.query("BEGIN");
    const live = await db.query(
      `WITH context AS MATERIALIZED (
         SELECT set_config('noctis.user_id',$1,true),
                set_config('noctis.session_id',$2,true)
       )
       SELECT noctis.session_valid() AS valid FROM context`,
      [identity.userId, identity.sessionId],
    );
    if (!live.rows[0].valid)
      throw Object.assign(
        new Error("Your session has expired. Please sign in."),
        { statusCode: 401 },
      );
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
export async function audit(
  db: DB,
  actor: string | null,
  action: string,
  target: string,
  server: string | null = null,
  metadata: Record<string, string | number | boolean | null> = {},
) {
  await db.query("SELECT noctis.append_audit($1,$2,$3,$4,$5::jsonb)", [
    actor,
    action,
    target,
    server,
    JSON.stringify(metadata),
  ]);
}
export async function changed(db: DB, topic: string, messageId?: string) {
  await db.query("SELECT pg_notify('noctis_changes',$1)", [
    messageId ? JSON.stringify({ topic, messageId }) : topic,
  ]);
}
export async function musicChanged(
  db: DB,
  serverId: string,
  event: MusicEvent,
  revision: number,
) {
  await db.query("SELECT pg_notify('noctis_music',$1)", [
    JSON.stringify({ serverId, event, revision }),
  ]);
}
let closingPools: Promise<unknown> | undefined;
export async function closePools() {
  await (closingPools ||= Promise.all([
    apiPool.end(),
    authPool.end(),
    workerPool.end(),
    listenerPool.end(),
  ]));
}

