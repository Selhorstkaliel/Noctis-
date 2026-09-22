import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import dotenv from "dotenv";
import pg from "pg";
import { setTimeout as delay } from "node:timers/promises";

const runtime = dotenv.parse(readFileSync(".env.supabase.runtime"));
const migration = dotenv.parse(readFileSync(".env.supabase.migration"));
const ssl = {
  rejectUnauthorized: true,
  ca: readFileSync(migration.DATABASE_CA, "utf8"),
};
const checks = [];
const clients = [];
const connect = async (value, role) => {
  let db;
  for (let attempt = 0; attempt < 2; attempt++) {
    db = new pg.Client({
      connectionString: value,
      ssl,
      connectionTimeoutMillis: 10000,
      query_timeout: 10000,
    });
    clients.push(db);
    try {
      await db.connect();
      break;
    } catch (error) {
      await db.end().catch(() => {});
      // Supavisor refreshes cached role passwords on reconnect after rotation.
      if (error.code !== "28P01" || attempt === 1) throw error;
      await delay(15000);
    }
  }
  const {
    rows: [actual],
  } = await db.query(
    "SELECT current_user AS name, current_setting('search_path') AS search_path, rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user",
  );
  assert.equal(actual.name, role);
  assert.equal(
    actual.rolsuper ||
      actual.rolbypassrls ||
      actual.rolcreatedb ||
      actual.rolcreaterole,
    false,
  );
  checks.push(
    `${role}: authenticated with verified TLS and restricted privileges`,
  );
  return db;
};
try {
  const migrator = await connect(
    migration.MIGRATION_DATABASE_URL,
    "noctis_migrator",
  );
  const connections = await Promise.allSettled([
    connect(runtime.DATABASE_URL, "noctis_api"),
    connect(runtime.AUTH_DATABASE_URL, "noctis_auth"),
    connect(runtime.WORKER_DATABASE_URL, "noctis_worker"),
  ]);
  for (const result of connections)
    if (result.status === "rejected") throw result.reason;
  const api = connections[0].value;
  const rows = (
    await migrator.query(
      "SELECT name,checksum FROM public.schema_migrations ORDER BY name",
    )
  ).rows;
  const files = readdirSync("server/migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.deepEqual(
    rows.map((row) => row.name),
    files,
  );
  for (const row of rows)
    assert.equal(
      row.checksum,
      createHash("sha256")
        .update(readFileSync(`server/migrations/${row.name}`, "utf8"))
        .digest("hex"),
    );
  checks.push(`${files.length} migrations: checksums match repository`);
  const {
    rows: [digest],
  } = await migrator.query(
    "SELECT encode(public.digest(convert_to('noctis','UTF8'),'sha256'),'hex') AS value",
  );
  assert.equal(
    digest.value,
    createHash("sha256").update("noctis").digest("hex"),
  );
  checks.push("pgcrypto compatibility: digest verified");
  const {
    rows: [access],
  } = await api.query(
    "SELECT has_schema_privilege('anon','noctis','USAGE') OR has_schema_privilege('authenticated','noctis','USAGE') AS exposed, has_column_privilege(current_user,'noctis.users','password_hash','SELECT') AS passwords, has_table_privilege(current_user,'noctis.account_mfa','SELECT') AS mfa, noctis.session_valid() AS session_valid",
  );
  assert.deepEqual(access, {
    exposed: false,
    passwords: false,
    mfa: false,
    session_valid: false,
  });
  checks.push(
    "Data API isolation, secret-column restrictions and missing-session denial verified",
  );
  const channel = `noctis_probe_${randomUUID().replaceAll("-", "")}`;
  await api.query(`LISTEN ${channel}`);
  let timer;
  let received;
  const notification = new Promise((resolve, reject) => {
    received = (message) => {
      if (message.channel === channel) resolve();
    };
    api.on("notification", received);
    timer = setTimeout(
      () => reject(new Error("LISTEN verification timed out")),
      10000,
    );
  });
  try {
    await migrator.query("SELECT pg_notify($1,'probe')", [channel]);
    await notification;
    checks.push("Session-pooler LISTEN/NOTIFY verified");
  } finally {
    clearTimeout(timer);
    api.off("notification", received);
    await api.query(`UNLISTEN ${channel}`);
  }

  if (process.argv.includes("--isolation")) {
    // New, uniquely named test fixtures only; cleanup never targets existing users.
    const actors = [0, 1].map(() => ({
      user: randomUUID(),
      device: randomUUID(),
      session: randomUUID(),
      server: randomUUID(),
      channel: randomUUID(),
      message: randomUUID(),
    }));
    try {
      await migrator.query("BEGIN");
      for (const a of actors) {
        await migrator.query(
          "INSERT INTO noctis.users(id,email,email_verified_at) VALUES($1,$2,now())",
          [a.user, `probe-${a.user}@example.invalid`],
        );
        await migrator.query(
          "INSERT INTO noctis.profiles(user_id,name,handle) VALUES($1,'Deployment probe',$2)",
          [a.user, `probe.${a.user.slice(0, 16)}`],
        );
        await migrator.query(
          "INSERT INTO noctis.devices(id,user_id,label) VALUES($1,$2,'Deployment probe')",
          [a.device, a.user],
        );
        await migrator.query(
          "INSERT INTO noctis.sessions(id,user_id,device_id,token_hash) VALUES($1,$2,$3,$4)",
          [
            a.session,
            a.user,
            a.device,
            createHash("sha256").update(randomUUID()).digest("hex"),
          ],
        );
        await migrator.query(
          "INSERT INTO noctis.servers(id,owner_id,name) VALUES($1,$2,'Deployment probe')",
          [a.server, a.user],
        );
        await migrator.query(
          "INSERT INTO noctis.server_members(server_id,user_id) VALUES($1,$2)",
          [a.server, a.user],
        );
        await migrator.query(
          "INSERT INTO noctis.channels(id,server_id,name,slug) VALUES($1,$2,'Private probe','probe')",
          [a.channel, a.server],
        );
        await migrator.query(
          "INSERT INTO noctis.messages(id,channel_id,author_id,body) VALUES($1,$2,$3,'Deployment isolation probe')",
          [a.message, a.channel, a.user],
        );
      }
      await migrator.query("COMMIT");
      for (const actor of actors) {
        await api.query("BEGIN");
        try {
          await api.query(
            "SELECT set_config('noctis.user_id',$1,true),set_config('noctis.session_id',$2,true)",
            [actor.user, actor.session],
          );
          assert.equal(
            (await api.query("SELECT noctis.session_valid() AS valid")).rows[0]
              .valid,
            true,
          );
          const visible = await api.query(
            "SELECT id FROM noctis.messages WHERE id=ANY($1)",
            [actors.map((a) => a.message)],
          );
          assert.deepEqual(visible.rows, [{ id: actor.message }]);
        } finally {
          await api.query("ROLLBACK");
        }
      }
      assert.equal(
        (await api.query("SELECT noctis.session_valid() AS valid")).rows[0]
          .valid,
        false,
      );
      assert.equal(
        (
          await api.query("SELECT id FROM noctis.messages WHERE id=ANY($1)", [
            actors.map((a) => a.message),
          ])
        ).rowCount,
        0,
      );
      checks.push(
        "Two users/two communities: cross-community reads denied; transaction identity cleared",
      );
    } finally {
      await migrator.query("ROLLBACK");
      await migrator.query("BEGIN");
      await migrator.query("DELETE FROM noctis.servers WHERE id=ANY($1)", [
        actors.map((a) => a.server),
      ]);
      await migrator.query("DELETE FROM noctis.users WHERE id=ANY($1)", [
        actors.map((a) => a.user),
      ]);
      await migrator.query("COMMIT");
      checks.push("Temporary isolation fixtures removed");
    }
  }
  const report = {
    verified: true,
    checkedAt: new Date().toISOString(),
    checks,
  };
  writeFileSync(
    ".runtime/supabase-verification.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(
    JSON.stringify({
      verified: false,
      code: error.code || error.name,
      completedChecks: checks,
    }),
  );
  process.exitCode = 1;
} finally {
  await Promise.allSettled(clients.map((client) => client.end()));
}
