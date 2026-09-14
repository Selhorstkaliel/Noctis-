import { mkdir, open, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

export interface ObjectStore {
  prepare(): Promise<void>;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

function validKey(key: string) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(key))
    throw new Error("Invalid storage key.");
  return key;
}

export function localObjectStore(root: string): ObjectStore {
  const path = (key: string) => join(root, validKey(key));
  return {
    async prepare() {
      await mkdir(root, { recursive: true, mode: 0o700 });
    },
    async put(key, data) {
      await writeFile(path(key), data, { flag: "wx", mode: 0o600 });
    },
    async get(key) {
      return (await open(path(key), "r")).createReadStream();
    },
    async delete(key) {
      try {
        await unlink(path(key));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },
  };
}

export function r2ObjectStore(client: S3Client, bucket: string): ObjectStore {
  return {
    async prepare() {},
    async put(key, data, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: validKey(key),
          Body: data,
          ContentLength: data.length,
          ContentType: contentType,
          CacheControl: "private, no-store",
          IfNoneMatch: "*",
        }),
        { abortSignal: AbortSignal.timeout(10000) },
      );
    },
    async get(key) {
      const result = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: validKey(key) }),
        { abortSignal: AbortSignal.timeout(10000) },
      );
      if (!result.Body) throw new Error("Stored file is unavailable.");
      return result.Body as Readable;
    },
    async delete(key) {
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: validKey(key) }),
        { abortSignal: AbortSignal.timeout(10000) },
      );
    },
  };
}
