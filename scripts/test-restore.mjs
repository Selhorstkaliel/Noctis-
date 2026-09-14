import { readFile, writeFile, mkdir, unlink, rmdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import {
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
  createHash,
} from "node:crypto";
import { spawn } from "node:child_process";
import { parse } from "dotenv";
import pg from "pg";
import assert from "node:assert/strict";

// This rehearsal only accepts the project's isolated test database. No production flags or overrides.
const env = parse(await readFile(".env.test"));
const source = new URL(env.MIGRATION_DATABASE_URL);
if (
  env.NODE_ENV !== "test" ||
  source.pathname !== "/noctis_test" ||
  !["localhost", "127.0.0.1"].includes(source.hostname)
)
  throw new Error(
    "Restoration rehearsal requires the local noctis_test database.",
  );
const suffix = randomUUID().replaceAll("-", "");
const database = `noctis_restore_test_${suffix}`;
const container = process.env.TEST_POSTGRES_CONTAINER || "noctis-postgres-1";
const targetDirectory = resolve(tmpdir(), `noctis-restore-test-${suffix}`);
const backup = resolve(".runtime", `restore-${suffix}.enc`);
const admin = new pg.Client({ connectionString: env.ADMIN_DATABASE_URL });
const sourceDb = new pg.Client({
  connectionString: source.href,
  options: "-c timezone=UTC",
});
const targetUrl = new URL(env.MIGRATION_DATABASE_URL);
targetUrl.pathname = `/${database}`;
const target = new pg.Client({
  connectionString: targetUrl.href,
  options: "-c timezone=UTC",
});
const copied = [];
let created = false;
function docker(args, input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("docker", args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks = [];
    let bytes = 0;
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 256 * 1024 * 1024) {
        child.kill();
        reject(new Error("Test backup exceeded its 256 MiB limit."));
      } else chunks.push(chunk);
    });
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("error", () =>
      reject(new Error("Docker could not run the restoration tool.")),
    );
    child.on("close", (code) =>
      code === 0
        ? resolvePromise(Buffer.concat(chunks))
        : reject(
            new Error(
              "PostgreSQL backup or restore failed. Check the local test container.",
            ),
          ),
    );
    child.stdin.end(input);
  });
}
try {
  await admin.connect();
  await sourceDb.connect();
  const counts = await sourceDb.query(
    "SELECT (SELECT count(*)::int FROM noctis.users) AS users,(SELECT count(*)::int FROM noctis.messages) AS messages,(SELECT count(*)::int FROM noctis.sessions) AS sessions",
  );
  const files = await sourceDb.query(
    "SELECT storage_key,sha256 FROM noctis.uploads",
  );
  const payloads = [];
  for (const row of files.rows) {
    if (!/^[a-f\d-]{36}$/.test(row.storage_key))
      throw new Error("Invalid test upload key.");
    const data = await readFile(join(env.STORAGE_PATH, row.storage_key));
    assert.equal(createHash("sha256").update(data).digest("hex"), row.sha256);
    payloads.push({
      key: row.storage_key,
      data: data.toString("base64"),
      sha256: row.sha256,
    });
  }
  const dump = await docker([
    "exec",
    container,
    "pg_dump",
    "-U",
    "postgres",
    "-d",
    "noctis_test",
    "-Fc",
  ]);
  const contents = Buffer.from(
    JSON.stringify({
      database: dump.toString("base64"),
      files: payloads,
      encryptionKey: env.ENCRYPTION_KEY,
    }),
  );
  const backupKey = randomBytes(32),
    iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", backupKey, iv);
  const sealed = Buffer.concat([
    iv,
    cipher.update(contents),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  await mkdir(resolve(".runtime"), { recursive: true });
  await writeFile(backup, sealed, { mode: 0o600, flag: "wx" });
  const saved = await readFile(backup);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    backupKey,
    saved.subarray(0, 12),
  );
  decipher.setAuthTag(saved.subarray(-16));
  const restored = JSON.parse(
    Buffer.concat([
      decipher.update(saved.subarray(12, -16)),
      decipher.final(),
    ]).toString(),
  );
  if (!restored.files.every((file) => /^[a-f\d-]{36}$/.test(file.key)))
    throw new Error("Invalid restored upload key.");
  assert.equal(restored.encryptionKey, env.ENCRYPTION_KEY);
  await admin.query(`CREATE DATABASE "${database}" OWNER noctis_migrator`);
  created = true;
  await docker(
    [
      "exec",
      "-i",
      container,
      "pg_restore",
      "-U",
      "postgres",
      "-d",
      database,
      "--no-owner",
      "--role=noctis_migrator",
      "--exit-on-error",
    ],
    Buffer.from(restored.database, "base64"),
  );
  await mkdir(targetDirectory, { mode: 0o700 });
  for (const file of restored.files) {
    const destination = join(targetDirectory, file.key);
    await writeFile(destination, Buffer.from(file.data, "base64"), {
      mode: 0o600,
      flag: "wx",
    });
    copied.push(destination);
    assert.equal(
      createHash("sha256")
        .update(await readFile(destination))
        .digest("hex"),
      file.sha256,
    );
  }
  await target.connect();
  const restoredCounts = await target.query(
    "SELECT (SELECT count(*)::int FROM noctis.users) AS users,(SELECT count(*)::int FROM noctis.messages) AS messages,(SELECT count(*)::int FROM noctis.sessions) AS sessions",
  );
  assert.deepEqual(restoredCounts.rows, counts.rows);
  const chain = await target.query(
    "WITH chain AS (SELECT record_hash,previous_hash,coalesce(lag(record_hash) OVER(ORDER BY id),repeat('0',64)) AS expected_previous,encode(public.digest(convert_to(jsonb_build_array(previous_hash,actor_id,action,target,server_id,metadata,created_at)::text,'UTF8'),'sha256'),'hex') AS expected_hash FROM noctis.audit_logs) SELECT count(*) FILTER(WHERE previous_hash<>expected_previous OR record_hash<>expected_hash)::int AS invalid FROM chain",
  );
  assert.equal(chain.rows[0].invalid, 0);
  await target.query("SET ROLE noctis_api");
  assert.equal(
    (await target.query("SELECT noctis.session_valid() AS valid")).rows[0]
      .valid,
    false,
  );
  assert.equal(
    (await target.query("SELECT count(*)::int AS total FROM noctis.messages"))
      .rows[0].total,
    0,
  );
  await assert.rejects(
    target.query("SELECT * FROM noctis.account_mfa"),
    /permission denied/,
  );
  await target.query("RESET ROLE");
  const secrets = await target.query(
    "SELECT user_id,secret_encrypted FROM noctis.account_mfa",
  );
  for (const row of secrets.rows) {
    const value = Buffer.from(row.secret_encrypted, "base64");
    const dec = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(restored.encryptionKey, "hex"),
      value.subarray(0, 12),
    );
    dec.setAAD(Buffer.from(`mfa:${row.user_id}`));
    dec.setAuthTag(value.subarray(-16));
    assert.match(
      Buffer.concat([
        dec.update(value.subarray(12, -16)),
        dec.final(),
      ]).toString(),
      /^[A-Z2-7]{32}$/,
    );
  }
  const report = {
    verified: true,
    at: new Date().toISOString(),
    scope: "local isolated test database",
    ...counts.rows[0],
    uploads: copied.length,
    encryptedMfaSeeds: secrets.rowCount,
    auditChain: true,
    rls: true,
    backupEncryption: "AES-256-GCM",
  };
  await writeFile(
    resolve(".runtime/restore-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await target.end();
  await sourceDb.end();
  if (created && /^noctis_restore_test_[a-f\d]{32}$/.test(database))
    await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await admin.end();
  // Only exact paths created by this run are removed; never recursively delete a computed directory.
  for (const file of copied) await unlink(file);
  await rmdir(targetDirectory).catch((e) => {
    if (e.code !== "ENOENT") throw e;
  });
  await unlink(backup).catch((e) => {
    if (e.code !== "ENOENT") throw e;
  });
}
