import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { S3Client } from "@aws-sdk/client-s3";
import { localObjectStore, r2ObjectStore } from "../object-store.js";

async function bytes(stream: Readable) {
  const parts: Buffer[] = [];
  for await (const part of stream) parts.push(Buffer.from(part));
  return Buffer.concat(parts);
}

test("local objects retain bytes, reject traversal/overwrite and delete idempotently", async () => {
  const root = await mkdtemp(join(tmpdir(), "noctis-storage-test-"));
  try {
    const store = localObjectStore(root);
    const key = randomUUID();
    const data = Buffer.from([0, 1, 128, 255]);
    await store.prepare();
    await store.put(key, data, "application/octet-stream");
    assert.deepEqual(await bytes(await store.get(key)), data);
    // Windows ACLs do not expose POSIX permission bits through stat().
    if (process.platform !== "win32")
      assert.equal((await stat(join(root, key))).mode & 0o777, 0o600);
    await assert.rejects(store.put(key, data, "text/plain"));
    for (const key of ["../secret", "/tmp/secret", "nested/file", ""]) {
      await assert.rejects(store.put(key, data, "text/plain"));
      await assert.rejects(store.get(key));
      await assert.rejects(store.delete(key));
    }
    await store.delete(key);
    await store.delete(key);
    await assert.rejects(store.get(key));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("S3 wire contract keeps keys and private caching; failed delete is retryable", async () => {
  // Local protocol stub, NOT validation against the Cloudflare service.
  const objects = new Map<string, Buffer>();
  let failDelete = false;
  const requests: { method: string; path: string }[] = [];
  const server = createServer(async (req, res) => {
    const path = req.url!.split("?")[0];
    requests.push({ method: req.method!, path });
    if (req.method === "PUT") {
      assert.equal(req.headers["cache-control"], "private, no-store");
      assert.equal(req.headers["if-none-match"], "*");
      assert.equal(req.headers["x-amz-acl"], undefined);
      objects.set(path, await bytes(req));
      res.writeHead(200);
      res.end();
    } else if (req.method === "GET") {
      const body = objects.get(path);
      res.writeHead(body ? 200 : 404, {
        "content-type": "application/octet-stream",
      });
      res.end(body);
    } else if (req.method === "DELETE") {
      if (failDelete) {
        res.writeHead(503);
        res.end();
        return;
      }
      objects.delete(path);
      res.writeHead(204);
      res.end();
    } else {
      res.writeHead(405);
      res.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const client = new S3Client({
    endpoint: `http://127.0.0.1:${port}`,
    region: "auto",
    forcePathStyle: true,
    credentials: { accessKeyId: "test-only", secretAccessKey: "test-only" },
    maxAttempts: 1,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  try {
    const store = r2ObjectStore(client, "private-test");
    const key = randomUUID();
    const data = Buffer.from("attachment bytes");
    await store.put(key, data, "text/plain");
    assert.deepEqual(await bytes(await store.get(key)), data);
    assert.ok(requests.every((r) => r.path === `/private-test/${key}`));
    const count = requests.length;
    await assert.rejects(store.delete("../another-object"));
    assert.equal(requests.length, count);
    failDelete = true;
    await assert.rejects(store.delete(key));
    assert.equal(objects.size, 1);
    failDelete = false;
    await store.delete(key);
    await store.delete(key);
    assert.equal(objects.size, 0);
    await assert.rejects(store.get(key));
  } finally {
    client.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});
