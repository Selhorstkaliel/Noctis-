import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { collectUploadGarbage } from "../upload-gc.js";

test("cleanup acknowledges only deleted/missing objects and retains failed deletions for retry", async () => {
  const [deleted, failed, missing] = [randomUUID(), randomUUID(), randomUUID()];
  const acknowledged: string[] = [];
  const attempted: string[] = [];
  const db = {
    async query(sql: string, values?: string[]) {
      if (sql.startsWith("SELECT"))
        return {
          rows: [deleted, failed, missing].map((storage_key) => ({
            storage_key,
          })),
        };
      acknowledged.push(values![0]);
      return { rows: [] };
    },
  };
  await collectUploadGarbage(db, {
    async delete(key) {
      attempted.push(key);
      if (key === failed)
        throw Object.assign(new Error("Unavailable"), { code: "EIO" });
      if (key === missing)
        throw Object.assign(new Error("Missing"), { code: "ENOENT" });
    },
  });
  assert.deepEqual(attempted, [deleted, failed, missing]);
  assert.deepEqual(acknowledged, [deleted, missing]);
});

test("cleanup never passes invalid queue keys to storage", async () => {
  let touched = false;
  await assert.rejects(
    collectUploadGarbage(
      {
        async query() {
          return { rows: [{ storage_key: "../../private" }] };
        },
      },
      {
        async delete() {
          touched = true;
        },
      },
    ),
    /Invalid storage key/,
  );
  assert.equal(touched, false);
});
