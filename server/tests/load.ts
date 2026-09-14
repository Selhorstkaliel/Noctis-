import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { writeFile, mkdir } from "node:fs/promises";
import pg from "pg";
import WebSocket from "ws";

if (
  process.env.NODE_ENV !== "test" ||
  !new URL(process.env.DATABASE_URL!).pathname.endsWith("_test") ||
  !new URL(process.env.MIGRATION_DATABASE_URL!).pathname.endsWith("_test")
)
  throw new Error("Load testing is restricted to the isolated test database.");
const { buildApp } = await import("../app.js");
const { closePools, apiPool } = await import("../db.js");
if (process.env.PROFILE_LOAD === "true")
  apiPool.on("connect", (client) => {
    const original = client.query.bind(client);
    client.query = ((...args: any[]) => {
      const start = performance.now();
      const result = (original as any)(...args);
      result?.then?.(
        () => {
          if (performance.now() - start > 100)
            console.log(
              JSON.stringify({
                query: String(args[0]).slice(0, 100),
                ms: Math.round(performance.now() - start),
              }),
            );
        },
        () => {},
      );
      return result;
    }) as typeof client.query;
  });
const app = await buildApp();
const fixture = new pg.Client({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
const sockets: WebSocket[] = [];
const actorIds: string[] = [];
let serverId: string | undefined;
const run = randomUUID().slice(0, 8);
const origin = process.env.APP_ORIGIN!;
const report: Record<string, unknown> = {
  timestamp: new Date().toISOString(),
  node: process.version,
  transport:
    "HTTP and WebSocket over loopback; PostgreSQL in local Docker; not a production capacity claim",
};
try {
  await fixture.connect();
  const base = await app.listen({ host: "127.0.0.1", port: 0 });
  async function actor(label: string, number: number) {
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      remoteAddress: `192.0.2.${number}`,
      headers: { origin },
      payload: {
        name: `ZZZ Load ${label}`,
        handle: `load.${run}.${number}`,
        email: `load.${run}.${number}@example.invalid`,
        password: randomUUID() + randomUUID(),
      },
    });
    assert.equal(r.statusCode, 201);
    const data = r.json();
    await fixture.query(
      "UPDATE noctis.users SET email_verified_at=now() WHERE id=$1",
      [data.userId],
    );
    actorIds.push(data.userId);
    return {
      id: data.userId,
      csrf: data.csrf,
      cookie: String(r.headers["set-cookie"]).split(";")[0],
    };
  }
  const owner = await actor("owner", 221);
  const member = await actor("member", 222);
  const unrelated = await actor("unrelated", 223);
  async function request(user: typeof owner, path: string, body?: unknown) {
    const r = await fetch(base + "/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        origin,
        cookie: user.cookie,
        "x-csrf-token": user.csrf,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await r.text();
    assert.equal(
      r.status,
      body !== undefined && path === "/servers" ? 201 : 200,
      `Unexpected HTTP ${r.status} at ${path}`,
    );
    return { bytes: Buffer.byteLength(text), data: JSON.parse(text) };
  }
  serverId = (
    await request(owner, "/servers", {
      name: `Load fixture ${run}`,
      isPublic: true,
    })
  ).data.id;
  await request(member, `/servers/${serverId}/join`, {});
  const channelId = (
    await fixture.query(
      "SELECT id FROM noctis.channels WHERE server_id=$1 AND slug='general'",
      [serverId],
    )
  ).rows[0].id;
  // Exact fixture identifiers, isolated database only; none are live users.
  const users = await fixture.query(
    "INSERT INTO noctis.users(id,email) SELECT 'load-'||$1||'-'||i,'load-'||$1||'-'||i||'@example.invalid' FROM generate_series(1,501) i RETURNING id",
    [run],
  );
  actorIds.push(...users.rows.map((u) => u.id));
  await fixture.query(
    "INSERT INTO noctis.profiles(user_id,name,handle) SELECT id,'AAA fixture',id FROM noctis.users WHERE id=ANY($1)",
    [users.rows.map((u) => u.id)],
  );
  await fixture.query(
    "INSERT INTO noctis.server_members(server_id,user_id) SELECT $1,unnest($2::text[])",
    [serverId, users.rows.map((u) => u.id)],
  );
  await fixture.query(
    "INSERT INTO noctis.messages(channel_id,author_id,body,created_at) SELECT $1,$2,'Historical load message '||i,now()-interval '1 day'+i*interval '1 second' FROM generate_series(1,10000) i",
    [channelId, owner.id],
  );
  const messageId = (
    await fixture.query(
      "SELECT id FROM noctis.messages WHERE channel_id=$1 ORDER BY created_at DESC LIMIT 1",
      [channelId],
    )
  ).rows[0].id;
  const key = encodeURIComponent(`${serverId}/general`);
  console.log("Load fixture ready; checking bootstrap.");
  const full = await request(member, "/bootstrap");
  assert.equal(
    full.data.profile.id,
    member.id,
    "Self must survive a >500-profile community",
  );
  report.fixture = {
    visibleProfiles: 503,
    historicalMessages: 10000,
    requestsPerVariant: 40,
    concurrency: 8,
  };
  async function measure(path: string, body?: unknown) {
    for (let i = 0; i < 3; i++) await request(member, path, body);
    const durations: number[] = [],
      sizes: number[] = [];
    let next = 0;
    const started = performance.now();
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        while (next++ < 40) {
          const before = performance.now();
          const r = await request(member, path, body);
          durations.push(performance.now() - before);
          sizes.push(r.bytes);
        }
      }),
    );
    durations.sort((a, b) => a - b);
    return {
      requests: durations.length,
      p50Ms: Math.round(durations[19]),
      p95Ms: Math.round(durations[37]),
      requestsPerSecond: +(40000 / (performance.now() - started)).toFixed(2),
      averageResponseBytes: Math.round(
        sizes.reduce((a, b) => a + b, 0) / sizes.length,
      ),
      errors: 0,
    };
  }
  report.fullSnapshot = await measure("/bootstrap");
  report.roomDelta = await measure(`/rooms/${key}/sync`, { ids: [messageId] });
  let unrelatedEvents = 0;
  async function connect(user: typeof owner, subscribed: boolean) {
    const ws = new WebSocket(base.replace("http:", "ws:") + "/api/realtime", {
      headers: { origin, cookie: user.cookie },
    });
    sockets.push(ws);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Socket handshake timeout")),
        10000,
      );
      ws.once("error", reject);
      ws.on("open", () =>
        ws.send(JSON.stringify({ type: "auth", csrf: user.csrf })),
      );
      ws.on("message", (raw) => {
        const frame = JSON.parse(raw.toString());
        if (frame.type === "ready")
          ws.send(
            JSON.stringify({
              type: "subscribe",
              topics: subscribed ? [`channel:${channelId}`] : [],
            }),
          );
        if (frame.type === "subscribed") {
          clearTimeout(timer);
          resolve();
        }
        if (!subscribed && frame.type === "invalidate") unrelatedEvents++;
      });
    });
    return ws;
  }
  const targets: WebSocket[] = [];
  for (let i = 0; i < 6; i++) targets.push(await connect(member, true));
  for (let i = 0; i < 6; i++) await connect(unrelated, false);
  const latencies: number[] = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    const received = targets.map(
      (ws) =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            ws.off("message", listener);
            reject(new Error("Fanout timeout"));
          }, 10000);
          const listener = (raw: WebSocket.RawData) => {
            const frame = JSON.parse(raw.toString());
            if (frame.type === "invalidate" && frame.ids) {
              clearTimeout(timer);
              ws.off("message", listener);
              resolve();
            }
          };
          ws.on("message", listener);
        }),
    );
    const response = await fetch(base + `/api/rooms/${key}/messages`, {
      method: "POST",
      headers: {
        origin,
        cookie: owner.cookie,
        "x-csrf-token": owner.csrf,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: `Fanout ${i}`, nonce: randomUUID() }),
    });
    assert.equal(response.status, 201);
    await response.arrayBuffer();
    await Promise.all(received);
    latencies.push(performance.now() - start);
  }
  assert.equal(unrelatedEvents, 0);
  latencies.sort((a, b) => a - b);
  report.fanout = {
    sockets: 12,
    recipients: 6,
    unrelated: 6,
    messages: 10,
    allRecipientsP95Ms: Math.round(latencies[9]),
    unrelatedInvalidations: unrelatedEvents,
  };
  await mkdir(".runtime", { recursive: true });
  await writeFile(
    ".runtime/load-report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const ws of sockets) ws.terminate();
  await app.close();
  await closePools();
  if (serverId)
    await fixture.query("DELETE FROM noctis.servers WHERE id=$1 AND name=$2", [
      serverId,
      `Load fixture ${run}`,
    ]);
  if (actorIds.length)
    await fixture.query("DELETE FROM noctis.users WHERE id=ANY($1)", [
      actorIds,
    ]);
  await fixture.end();
}
