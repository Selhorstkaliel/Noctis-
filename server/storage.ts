import { mkdir, writeFile, unlink, readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "./config.js";
import { transaction, type DB } from "./db.js";
import { room } from "./authorization.js";
import { requireThat, id } from "./errors.js";
import { throttle } from "./auth.js";
import { resolveRoom } from "./domain/read.js";
import { AVATAR_MAX_BYTES, AVATAR_MAX_KB } from "../shared/uploads.js";
const uploadQuery = z
  .object({
    purpose: z.enum(["message", "avatar"]),
    room: z.string().max(160).optional(),
  })
  .strict()
  .refine((x) => x.purpose !== "message" || !!x.room, "Choose a conversation.");
const signatures = [
  {
    ext: [".png"],
    mime: "image/png",
    format: "png",
    test: (b: Buffer) =>
      b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  },
  {
    ext: [".jpg", ".jpeg"],
    mime: "image/jpeg",
    format: "jpeg",
    test: (b: Buffer) => b[0] === 255 && b[1] === 216 && b[2] === 255,
  },
  {
    ext: [".webp"],
    mime: "image/webp",
    format: "webp",
    test: (b: Buffer) =>
      b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WEBP",
  },
  {
    ext: [".gif"],
    mime: "image/gif",
    format: "gif",
    test: (b: Buffer) =>
      ["GIF87a", "GIF89a"].includes(b.toString("ascii", 0, 6)),
  },
];
export async function sanitizeUpload(
  buffer: Buffer,
  filename: string,
  mime: string,
  purpose: string,
) {
  const maxBytes = purpose === "avatar" ? AVATAR_MAX_BYTES : 8 * 1024 * 1024;
  requireThat(
    buffer.length > 0 && buffer.length <= maxBytes,
    413,
    purpose === "avatar"
      ? `Profile photos must be no larger than ${AVATAR_MAX_KB} KB.`
      : "Files must be no larger than 8 MB.",
  );
  requireThat(
    filename === basename(filename) &&
      !/[\\/\x00-\x1f\x7f]/.test(filename) &&
      filename.length <= 120 &&
      !filename.startsWith("."),
    400,
    "Choose a file with a simple filename.",
  );
  const extension = extname(filename).toLowerCase();
  const signature = signatures.find((s) => s.ext.includes(extension));
  if (signature) {
    requireThat(
      signature.mime === mime && signature.test(buffer),
      400,
      "The file contents do not match its type.",
    );
    try {
      const meta = await sharp(buffer, {
        animated: true,
        limitInputPixels: 40_000_000,
        failOn: "warning",
      }).metadata();
      requireThat(
        meta.format === signature.format &&
          !!meta.width &&
          !!meta.height &&
          (meta.pages || 1) <= 300 &&
          meta.width * meta.height <= 40_000_000,
        400,
        "This image is too large to process safely.",
      );
      const output = await sharp(buffer, {
        animated: purpose !== "avatar",
        limitInputPixels: 40_000_000,
        failOn: "warning",
      })
        .rotate()
        .resize(
          purpose === "avatar" ? 512 : 1920,
          purpose === "avatar" ? 512 : 1920,
          { fit: "inside", withoutEnlargement: true },
        )
        .webp({ quality: 85, effort: 3 })
        .toBuffer();
      requireThat(
        output.length <= maxBytes,
        413,
        "The processed image is too large.",
      );
      return {
        buffer: output,
        mime: "image/webp",
        name: filename.replace(/\.[^.]+$/, ".webp"),
      };
    } catch (error) {
      if (error instanceof Error && "statusCode" in error) throw error;
      throw Object.assign(new Error("This image could not be validated."), {
        statusCode: 400,
      });
    }
  }
  requireThat(
    purpose === "message" &&
      [".txt", ".md", ".csv"].includes(extension) &&
      [
        "text/plain",
        "text/markdown",
        "text/csv",
        "application/octet-stream",
      ].includes(mime),
    415,
    "Supported files: PNG, JPEG, WebP, GIF, TXT, Markdown, and CSV.",
  );
  requireThat(
    buffer.length <= 1024 * 1024,
    413,
    "Text files must be no larger than 1 MB.",
  );
  let value: string;
  try {
    value = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw Object.assign(new Error("Text files must use UTF-8 encoding."), {
      statusCode: 400,
    });
  }
  requireThat(
    !value.includes("\0"),
    400,
    "This text file contains unsupported data.",
  );
  return { buffer, mime: "text/plain", name: filename };
}
async function save(
  db: DB,
  userId: string,
  input: z.infer<typeof uploadQuery>,
  data: Buffer,
  name: string,
  mime: string,
) {
  const access =
    input.purpose === "message" ? await resolveRoom(db, input.room!) : {};
  if (input.purpose === "message") await room(db, access, "ATTACH_FILES");
  const clean = await sanitizeUpload(data, name, mime, input.purpose);
  const storageKey = randomUUID();
  const path = join(config.STORAGE_PATH, storageKey);
  await writeFile(path, clean.buffer, { flag: "wx", mode: 0o600 });
  try {
    const uploadId = randomUUID();
    await db.query(
      "INSERT INTO uploads(owner_id,channel_id,conversation_id,purpose,storage_key,original_name,content_type,byte_size,sha256,id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        userId,
        "channelId" in access ? access.channelId : null,
        "conversationId" in access ? access.conversationId : null,
        input.purpose,
        storageKey,
        clean.name,
        clean.mime,
        clean.buffer.length,
        createHash("sha256").update(clean.buffer).digest("hex"),
        uploadId,
      ],
    );
    return {
      id: uploadId,
      url: `/api/uploads/${uploadId}`,
      name: clean.name,
      type: clean.mime,
    };
  } catch (e) {
    await unlink(path).catch(() => {});
    throw e;
  }
}
export async function storageRoutes(app: FastifyInstance) {
  await mkdir(config.STORAGE_PATH, { recursive: true, mode: 0o700 });
  app.post("/api/uploads", async (req, reply) => {
    const input = uploadQuery.parse(req.query);
    const maxBytes =
      input.purpose === "avatar" ? AVATAR_MAX_BYTES : 8 * 1024 * 1024;
    await throttle("uploads", req.identity.userId, 20, 300);
    const part = await req.file({
      limits: { files: 1, fields: 0, fileSize: maxBytes, parts: 1 },
    });
    requireThat(part, 400, "Choose a file.");
    const buffer = await part.toBuffer();
    requireThat(
      !part.file.truncated,
      413,
      input.purpose === "avatar"
        ? `Profile photos must be no larger than ${AVATAR_MAX_KB} KB.`
        : "Files must be no larger than 8 MB.",
    );
    const result = await transaction(req.identity, (db) =>
      save(
        db,
        req.identity.userId,
        input,
        buffer,
        part.filename,
        part.mimetype,
      ),
    );
    reply.code(201);
    return result;
  });
  app.post("/api/uploads/preset", async (req, reply) => {
    const input = z
      .object({
        room: z.string().min(1).max(160),
        preset: z.enum(["celebrate", "wave", "yes"]),
      })
      .strict()
      .parse(req.body);
    await throttle("uploads", req.identity.userId, 20, 300);
    const buffer = await readFile(
      resolve("public/images", `${input.preset}.gif`),
    );
    const result = await transaction(req.identity, (db) =>
      save(
        db,
        req.identity.userId,
        { purpose: "message", room: input.room },
        buffer,
        `${input.preset}.gif`,
        "image/gif",
      ),
    );
    reply.code(201);
    return result;
  });
  app.get("/api/uploads/:id", async (req, reply) => {
    const p = z.object({ id }).parse(req.params);
    const upload = await transaction(req.identity, async (db) => {
      const r = await db.query(
        "SELECT id,storage_key,original_name,content_type,byte_size FROM uploads WHERE id=$1",
        [p.id],
      );
      requireThat(r.rowCount);
      return r.rows[0];
    });
    reply
      .header("Cache-Control", "private, no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; sandbox")
      .header(
        "Content-Disposition",
        `${upload.content_type.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(upload.original_name)}`,
      )
      .type(upload.content_type);
    return reply.send(
      createReadStream(join(config.STORAGE_PATH, upload.storage_key)),
    );
  });
}
