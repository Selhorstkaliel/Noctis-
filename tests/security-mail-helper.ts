import pg from "pg";
import { decrypt } from "../server/crypto";

export async function testDatabase<T>(run: (db: pg.Client) => Promise<T>) {
  if (
    process.env.NODE_ENV !== "test" ||
    new URL(process.env.MIGRATION_DATABASE_URL!).pathname !== "/noctis_test"
  )
    throw new Error("Browser fixtures require the isolated test database.");
  const db = new pg.Client({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  await db.connect();
  try {
    return await run(db);
  } finally {
    await db.end();
  }
}
export async function mailLink(email: string, kind: "verify" | "reset") {
  return testDatabase(async (db) => {
    const rows = await db.query(
      "SELECT * FROM noctis.security_mail ORDER BY created_at DESC",
    );
    for (const row of rows.rows) {
      const mail = JSON.parse(decrypt(row.payload_encrypted, `mail:${row.id}`));
      if (mail.to === email) {
        const found = mail.text.match(
          new RegExp(`https?://[^\\s]+/#/${kind}-email/[\\w-]{43}`),
        );
        if (found) return found[0] as string;
      }
    }
    throw new Error("Expected account email was not queued.");
  });
}
