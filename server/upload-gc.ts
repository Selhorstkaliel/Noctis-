import type { ObjectStore } from "./object-store.js";

type GarbageQueue = {
  query(
    sql: string,
    values?: string[],
  ): Promise<{ rows: { storage_key: string }[] }>;
};

// Run only on a process that can access the real object store / mounted volume.
export async function collectUploadGarbage(
  db: GarbageQueue,
  store: Pick<ObjectStore, "delete">,
) {
  const garbage = await db.query(
    "SELECT storage_key FROM upload_gc ORDER BY created_at LIMIT 100",
  );
  for (const { storage_key: key } of garbage.rows) {
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(key))
      throw new Error("Invalid storage key.");
    try {
      await store.delete(key);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") continue;
    }
    await db.query("DELETE FROM upload_gc WHERE storage_key=$1", [key]);
  }
}
