import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { parse } from "dotenv";
import assert from "node:assert/strict";
import pg from "pg";
import WebSocket from "ws";

const values = parse(await readFile(".env.test", "utf8"));
if (
  values.NODE_ENV !== "test" ||
  !new URL(values.DATABASE_URL).pathname.endsWith("_test") ||
  !new URL(values.MIGRATION_DATABASE_URL).pathname.endsWith("_test")
)
  throw new Error("Replica tests require an isolated test database.");
const children = [],
  ports = [33301, 33302];
let socket, serverId;
const name = "Replica fixture " + randomUUID().slice(0, 8);
const origin = values.APP_ORIGIN;
const db = new pg.Client({ connectionString: values.MIGRATION_DATABASE_URL });
try {
  await db.connect();
  for (const port of ports) {
    const child = spawn(process.execPath, ["build/server/server/index.js"], {
      env: {
        ...process.env,
        ...values,
        LISTENER_DATABASE_URL:
          values.LISTENER_DATABASE_URL || values.DATABASE_URL,
        HOST: "127.0.0.1",
        PORT: String(port),
      },
      stdio: "ignore",
    });
    children.push(child);
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null)
        throw new Error("Replica process exited during startup.");
      try {
        ready = (await fetch(`http://127.0.0.1:${port}/api/ready`)).ok;
      } catch {}
      if (ready) break;
      await delay(100);
    }
    assert.ok(ready, "Replica did not become ready");
  }
  let cookie = "",
    csrf = "";
  async function request(replica, path, body) {
    const response = await fetch(
      `http://127.0.0.1:${ports[replica]}/api${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          origin,
          cookie,
          "x-csrf-token": csrf,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    const data = await response.json();
    assert.ok(response.ok, `Replica request failed: ${response.status}`);
    if (response.headers.has("set-cookie"))
      cookie = response.headers.get("set-cookie").split(";")[0];
    return data;
  }
  csrf = (
    await request(0, "/auth/login", {
      email: values.SEED_EMAIL,
      password: values.SEED_PASSWORD,
    })
  ).csrf;
  serverId = (await request(0, "/servers", { name, isPublic: false })).id;
  const snapshot = await request(1, "/bootstrap");
  const channel = snapshot.channels.find(
    (c) => c.serverId === serverId && c.slug === "general",
  );
  assert.ok(channel, "Replica B cannot see the server created on A");
  socket = new WebSocket(`ws://127.0.0.1:${ports[1]}/api/realtime`, {
    headers: { origin, cookie },
  });
  function frame(predicate) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off("message", listener);
        reject(new Error("Replica frame timeout"));
      }, 10000);
      const listener = (raw) => {
        const data = JSON.parse(raw.toString());
        if (predicate(data)) {
          clearTimeout(timer);
          socket.off("message", listener);
          resolve(data);
        }
      };
      socket.on("message", listener);
    });
  }
  const ready = frame((f) => f.type === "ready");
  socket.once("open", () =>
    socket.send(JSON.stringify({ type: "auth", csrf })),
  );
  await ready;
  const subscribed = frame((f) => f.type === "subscribed");
  socket.send(
    JSON.stringify({ type: "subscribe", topics: ["channel:" + channel.id] }),
  );
  await subscribed;
  const delivered = frame(
    (f) => f.type === "invalidate" && f.topic === "channel:" + channel.id,
  );
  const room = encodeURIComponent(serverId + "/general");
  const message = await request(0, "/rooms/" + room + "/messages", {
    text: "Written on A, delivered on B",
    nonce: randomUUID(),
  });
  assert.deepEqual((await delivered).ids, [message.id]);
  assert.equal(
    (await request(1, "/rooms/" + room + "/sync", { ids: [message.id] }))
      .items[0].id,
    message.id,
  );
  const closed = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Remote revocation timeout")),
      10000,
    );
    socket.once("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  await request(0, "/auth/logout", { all: false });
  assert.equal(await closed, 4401);
  console.log(
    "Two API processes passed: shared session, server visibility, PostgreSQL fanout, room sync, remote session revocation.",
  );
} finally {
  socket?.terminate();
  await Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null) return resolve();
          child.once("exit", resolve);
          child.kill();
        }),
    ),
  );
  if (serverId)
    await db.query("DELETE FROM noctis.servers WHERE id=$1 AND name=$2", [
      serverId,
      name,
    ]);
  await db.end();
}
