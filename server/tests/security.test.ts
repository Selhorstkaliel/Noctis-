import "dotenv/config";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID, createHmac } from "node:crypto";
import WebSocket from "ws";
process.env.NODE_ENV = "test";
const { buildApp } = await import("../app.js");
const { apiPool, authPool, closePools, transaction } = await import("../db.js");
const { runJob } = await import("../worker.js");
const { sanitizeUpload } = await import("../storage.js");
const { encrypt, decrypt } = await import("../crypto.js");
const app = await buildApp();
type Actor = {
  id: string;
  csrf: string;
  cookie: string;
  email: string;
  password: string;
};
let owner: Actor, member: Actor, outsider: Actor;
let serverId: string,
  channelId: string,
  privateId: string,
  voiceId: string,
  missionId: string;
let address: string;
let counter = 0;
async function request(
  actor: Actor | undefined,
  method: string,
  path: string,
  body?: unknown,
  extra: Record<string, string> = {},
) {
  const response = await app.inject({
    method: method as any,
    url: `/api${path}`,
    remoteAddress: `198.51.100.${(++counter % 250) + 1}`,
    headers: {
      origin: process.env.APP_ORIGIN!,
      ...(actor ? { cookie: actor.cookie, "x-csrf-token": actor.csrf } : {}),
      ...extra,
    },
    ...(body !== undefined ? { payload: body as any } : {}),
  });
  return { status: response.statusCode, data: response.json(), response };
}
async function createActor(label: string): Promise<Actor> {
  const suffix = randomUUID().slice(0, 8);
  const email = `security-${label}-${suffix}@example.invalid`;
  const password = randomUUID() + randomUUID();
  const r = await request(undefined, "POST", "/auth/register", {
    name: `Security ${label}`,
    handle: `test.${suffix}`,
    email,
    password,
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  await authPool.query("UPDATE users SET email_verified_at=now() WHERE id=$1", [
    r.data.userId,
  ]);
  return {
    id: r.data.userId,
    csrf: r.data.csrf,
    cookie: String(r.response.headers["set-cookie"]).split(";")[0],
    email,
    password,
  };
}
before(async () => {
  owner = await createActor("owner");
  member = await createActor("member");
  outsider = await createActor("outsider");
  const r = await request(owner, "POST", "/servers", {
    name: "Security test community",
    isPublic: true,
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  serverId = r.data.id;
  assert.equal(
    (await request(member, "POST", `/servers/${serverId}/join`, {})).status,
    200,
  );
  const state = await request(owner, "GET", "/bootstrap");
  assert.equal(state.status, 200, JSON.stringify(state.data));
  channelId = state.data.channels.find(
    (c: any) => c.serverId === serverId && c.slug === "general",
  ).id;
  voiceId = state.data.channels.find(
    (c: any) => c.serverId === serverId && c.kind === "voice",
  ).id;
  const p = await request(owner, "POST", `/servers/${serverId}/channels`, {
    name: "private-review",
    isPrivate: true,
  });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  privateId = p.data.id;
  address = await app.listen({ port: 0, host: "127.0.0.1" });
});
after(async () => {
  await app.close();
  await closePools();
});
test("opaque HttpOnly sessions; login errors do not disclose account existence", async () => {
  assert.match(owner.cookie, /^noctis_session=/);
  const r = await request(undefined, "POST", "/auth/login", {
    email: owner.email,
    password: "an incorrect password",
  });
  assert.equal(r.status, 401);
  assert.match(r.data.error.message, /Email or password is incorrect/);
  const unknown = await request(undefined, "POST", "/auth/login", {
    email: `missing-${randomUUID()}@example.invalid`,
    password: "an incorrect password",
  });
  assert.equal(unknown.data.error.message, r.data.error.message);
  assert.equal((await request(undefined, "GET", "/bootstrap")).status, 401);
  const sessions = await request(owner, "GET", "/auth/devices");
  assert.equal(sessions.status, 200);
  assert.ok(sessions.data.every((s: any) => !s.token_hash && !s.token));
});
test("CSRF and strict schemas reject cross-origin and mass-assignment attempts", async () => {
  assert.equal(
    (
      await request(
        owner,
        "POST",
        "/servers",
        { name: "CSRF attempt" },
        { origin: "https://attacker.invalid" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        owner,
        "POST",
        "/servers",
        { name: "CSRF attempt" },
        { "x-csrf-token": "invalid" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(member, "PATCH", "/profile", {
        name: "Member",
        role: "Owner",
        xp: 999999,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(member, "PATCH", `/servers/${serverId}`, {
        ownerId: member.id,
      })
    ).status,
    400,
  );
});
test("BOLA: authentication does not grant server, channel, private-room, or search access", async () => {
  assert.equal(
    (await request(outsider, "GET", `/servers/${serverId}`)).status,
    404,
  );
  assert.equal(
    (await request(outsider, "GET", `/channels/${channelId}/messages`)).status,
    404,
  );
  assert.equal(
    (await request(member, "GET", `/channels/${privateId}/messages`)).status,
    404,
  );
  const r = await request(
    owner,
    "POST",
    `/rooms/${serverId}%2Fprivate-review/messages`,
    { text: "classifiedquartz", nonce: randomUUID() },
  );
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const search = await request(member, "GET", "/search?q=classifiedquartz");
  assert.equal(search.status, 200);
  assert.equal(search.data.messages.length, 0);
});
test("message editing, reactions, replies, pins, and soft deletion obey ownership and room scope", async () => {
  const room = `${serverId}%2Fgeneral`;
  const a = await request(owner, "POST", `/rooms/${room}/messages`, {
    text: "Hello @nobody",
    nonce: randomUUID(),
  });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  assert.equal(
    (
      await request(member, "PATCH", `/messages/${a.data.id}`, {
        text: "Hijacked",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request(member, "PUT", `/messages/${a.data.id}/pin`, {
        pinned: true,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(owner, "PUT", `/messages/${a.data.id}/pin`, {
        pinned: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(member, "PUT", `/messages/${a.data.id}/reactions`, {
        emoji: "🔥",
        active: true,
      })
    ).status,
    200,
  );
  const reply = await request(member, "POST", `/rooms/${room}/messages`, {
    text: "A reply",
    nonce: randomUUID(),
    replyTo: a.data.id,
  });
  assert.equal(reply.status, 201, JSON.stringify(reply.data));
  const cross = await request(
    owner,
    "POST",
    `/rooms/${serverId}%2Fprivate-review/messages`,
    { text: "Cross-room reply", nonce: randomUUID(), replyTo: a.data.id },
  );
  assert.equal(cross.status, 400);
  assert.equal(
    (await request(member, "DELETE", `/messages/${a.data.id}`)).status,
    404,
  );
  assert.equal(
    (await request(owner, "DELETE", `/messages/${a.data.id}`)).status,
    200,
  );
  assert.equal(
    (await request(owner, "POST", `/messages/${a.data.id}/restore`, {})).status,
    200,
  );
});
test("role rank and effective permission checks prevent privilege escalation", async () => {
  const roles = (
    await request(owner, "GET", "/bootstrap")
  ).data.serverRoles.filter((r: any) => r.serverId === serverId);
  const admin = roles.find((r: any) => r.name === "Admin");
  assert.equal(
    (
      await request(
        member,
        "PUT",
        `/servers/${serverId}/members/${member.id}/role`,
        { roleId: admin.id },
      )
    ).status,
    403,
  );
  const delegated = await request(owner, "POST", `/servers/${serverId}/roles`, {
    name: "Delegated manager",
    position: 10,
    permissions: ["VIEW_CHANNEL", "MANAGE_ROLES", "SEND_MESSAGES"],
  });
  assert.equal(delegated.status, 200, JSON.stringify(delegated.data));
  assert.equal(
    (
      await request(
        owner,
        "PUT",
        `/servers/${serverId}/members/${member.id}/role`,
        { roleId: delegated.data.id },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        member,
        "PUT",
        `/servers/${serverId}/members/${outsider.id}/role`,
        { roleId: admin.id },
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        member,
        "PUT",
        `/servers/${serverId}/roles/${admin.id}/permissions`,
        { permissions: ["MANAGE_SERVER"] },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(member, "POST", `/servers/${serverId}/roles`, {
        name: "Escalated",
        position: 9,
        permissions: ["MANAGE_SERVER"],
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        member,
        "PUT",
        `/servers/${serverId}/members/${owner.id}/role`,
        { roleId: delegated.data.id },
      )
    ).status,
    403,
  );
});
test("mission rewards use server objectives and grant XP exactly once under concurrency", async () => {
  const created = await request(owner, "POST", "/missions", {
    serverId,
    title: "Transactional reward",
    description: "Complete one real objective.",
    xp: 123,
    badge: "Verified",
    objectives: [{ text: "Finish the task", verification: "self" }],
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  missionId = created.data.id;
  assert.equal(
    (await request(member, "POST", `/missions/${missionId}/join`, {})).status,
    200,
  );
  assert.equal(
    (await request(member, "POST", `/missions/${missionId}/claim`, {})).status,
    409,
  );
  const m = (await request(member, "GET", "/bootstrap")).data.missions.find(
    (m: any) => m.id === missionId,
  );
  assert.equal(
    (
      await request(
        member,
        "PUT",
        `/missions/${missionId}/objectives/${m.objectives[0].id}`,
        { done: true },
      )
    ).status,
    200,
  );
  const claims = await Promise.all(
    Array.from({ length: 5 }, () =>
      request(member, "POST", `/missions/${missionId}/claim`, {}),
    ),
  );
  assert.ok(
    claims.every((c) => c.status === 200),
    JSON.stringify(claims.map((c) => c.data)),
  );
  assert.equal(claims.filter((c) => !c.data.alreadyClaimed).length, 1);
  const snapshot = await request(member, "GET", "/bootstrap");
  assert.equal(snapshot.data.profile.xp, 123);
  assert.equal(
    (
      await request(member, "POST", `/missions/${missionId}/claim`, {
        xp: 9999,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        member,
        "PUT",
        `/missions/${missionId}/objectives/${m.objectives[0].id}`,
        { done: false },
      )
    ).status,
    409,
  );
});
test("private uploads reject type spoofing, executable content, traversal, and unauthorized download", async () => {
  await assert.rejects(() =>
    sanitizeUpload(
      Buffer.from("<svg onload=alert(1)>"),
      "picture.png",
      "image/png",
      "message",
    ),
  );
  await assert.rejects(() =>
    sanitizeUpload(
      Buffer.from("hello"),
      "../file.txt",
      "text/plain",
      "message",
    ),
  );
  await assert.rejects(() =>
    sanitizeUpload(
      Buffer.from("MZ executable"),
      "file.exe",
      "application/octet-stream",
      "message",
    ),
  );
  await assert.rejects(() =>
    sanitizeUpload(
      Buffer.alloc(8 * 1024 * 1024 + 1),
      "big.txt",
      "text/plain",
      "message",
    ),
  );
  await assert.rejects(
    () =>
      sanitizeUpload(
        Buffer.alloc(2_000_001),
        "avatar.png",
        "image/png",
        "avatar",
      ),
    /Profile photos must be no larger than 2000 KB/,
  );
  const cleaned = await sanitizeUpload(
    Buffer.from("A safe note"),
    "note.txt",
    "text/plain",
    "message",
  );
  assert.equal(cleaned.mime, "text/plain");
  const boundary = `Noctis${randomUUID()}`;
  const payload = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="note.txt"\r\nContent-Type: text/plain\r\n\r\nPrivate note\r\n--${boundary}--\r\n`,
  );
  const r = await app.inject({
    method: "POST",
    url: `/api/uploads?purpose=message&room=${serverId}%2Fgeneral`,
    headers: {
      origin: process.env.APP_ORIGIN!,
      cookie: owner.cookie,
      "x-csrf-token": owner.csrf,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  });
  assert.equal(r.statusCode, 201, r.body);
  const upload = r.json();
  assert.equal(
    (await request(outsider, "GET", `/uploads/${upload.id}`)).status,
    404,
  );
  assert.equal(
    (await request(member, "GET", `/uploads/${upload.id}`)).status,
    404,
  );
  const msg = await request(
    owner,
    "POST",
    `/rooms/${serverId}%2Fgeneral/messages`,
    { text: "A file", nonce: randomUUID(), attachments: [upload.id] },
  );
  assert.equal(msg.status, 201, JSON.stringify(msg.data));
  const download = await app.inject({
    method: "GET",
    url: `/api/uploads/${upload.id}`,
    headers: { cookie: member.cookie },
  });
  assert.equal(download.statusCode, 200, download.body);
  assert.match(String(download.headers["content-disposition"]), /^attachment/);
  assert.equal(download.headers["x-content-type-options"], "nosniff");
});
test("invites expire/revoke and use counts are atomic", async () => {
  const invite = await request(owner, "POST", `/servers/${serverId}/invites`, {
    maxUses: 1,
    expiresHours: 1,
  });
  assert.equal(invite.status, 200);
  assert.equal(
    (await request(outsider, "GET", `/invites/${invite.data.token}`)).status,
    200,
  );
  const joined = await request(
    outsider,
    "POST",
    `/invites/${invite.data.token}/join`,
    {},
  );
  assert.equal(joined.status, 200);
  assert.equal(
    (await request(owner, "GET", `/invites/${invite.data.token}`)).status,
    404,
  );
  const another = await request(owner, "POST", `/servers/${serverId}/invites`, {
    maxUses: 5,
    expiresHours: 1,
  });
  await request(
    owner,
    "DELETE",
    `/servers/${serverId}/invites/${another.data.id}`,
  );
  assert.equal(
    (await request(outsider, "POST", `/invites/${another.data.token}/join`, {}))
      .status,
    404,
  );
});
test("direct invitations honor privacy and GIF presets use validated private storage", async () => {
  const invitation = await request(
    owner,
    "POST",
    `/servers/${serverId}/invites`,
    {},
  );
  assert.equal(invitation.status, 200);
  await request(member, "PATCH", "/settings", { invites: false });
  const path = `/servers/${serverId}/invites/${invitation.data.id}/send`;
  assert.equal(
    (
      await request(owner, "POST", path, {
        userId: member.id,
        token: invitation.data.token,
      })
    ).status,
    403,
  );
  await request(member, "PATCH", "/settings", { invites: true });
  assert.equal(
    (
      await request(owner, "POST", path, {
        userId: member.id,
        token: invitation.data.token,
      })
    ).status,
    200,
  );
  const gif = await request(owner, "POST", "/uploads/preset", {
    room: `${serverId}/general`,
    preset: "celebrate",
  });
  assert.equal(gif.status, 201, JSON.stringify(gif.data));
  assert.equal(
    (await request(member, "GET", `/uploads/${gif.data.id}`)).status,
    404,
  );
});
test("DM privacy and blocks are enforced by the API", async () => {
  assert.equal(
    (await request(owner, "POST", "/conversations", { members: [member.id] }))
      .status,
    403,
  );
  assert.equal(
    (await request(member, "PATCH", "/settings", { dmPolicy: "community" }))
      .status,
    200,
  );
  const c = await request(owner, "POST", "/conversations", {
    members: [member.id],
  });
  assert.equal(c.status, 201, JSON.stringify(c.data));
  assert.equal(
    (await request(member, "PUT", `/blocks/${owner.id}`, { blocked: true }))
      .status,
    200,
  );
  assert.equal(
    (
      await request(owner, "POST", `/rooms/dm%2F${c.data.id}/messages`, {
        text: "Blocked message",
        nonce: randomUUID(),
      })
    ).status,
    404,
  );
  assert.equal(
    (await request(member, "PUT", `/blocks/${owner.id}`, { blocked: false }))
      .status,
    200,
  );
});
test("webhook HMAC, replay protection, worker execution, revocation, and AES-GCM integrity", async () => {
  const hook = await request(owner, "POST", `/servers/${serverId}/webhooks`, {
    name: "Build notices",
    channelId,
  });
  assert.equal(hook.status, 200, JSON.stringify(hook.data));
  const body = { text: "Verified build completed" };
  const timestamp = String(Math.floor(Date.now() / 1000));
  const delivery = randomUUID();
  const signature = createHmac("sha256", hook.data.secret)
    .update(`${timestamp}.${delivery}.${JSON.stringify(body)}`)
    .digest("hex");
  const headers = {
    "x-noctis-timestamp": timestamp,
    "x-noctis-delivery": delivery,
    "x-noctis-signature": signature,
  };
  assert.equal(
    (
      await request(
        undefined,
        "POST",
        `/webhooks/incoming/${hook.data.id}`,
        body,
        { ...headers, "x-noctis-signature": "0".repeat(64) },
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await request(
        undefined,
        "POST",
        `/webhooks/incoming/${hook.data.id}`,
        body,
        headers,
      )
    ).status,
    202,
  );
  assert.equal(
    (
      await request(
        undefined,
        "POST",
        `/webhooks/incoming/${hook.data.id}`,
        body,
        headers,
      )
    ).status,
    409,
  );
  for (let i = 0; i < 20; i++) {
    if (!(await runJob())) break;
  }
  const history = await request(
    owner,
    "GET",
    `/channels/${channelId}/messages`,
  );
  assert.ok(
    history.data.items.some((m: any) =>
      m.text.includes("Verified build completed"),
    ),
  );
  await request(
    owner,
    "DELETE",
    `/servers/${serverId}/webhooks/${hook.data.id}`,
  );
  assert.equal(
    (
      await request(
        undefined,
        "POST",
        `/webhooks/incoming/${hook.data.id}`,
        body,
        headers,
      )
    ).status,
    401,
  );
  const sealed = encrypt("secret value", "context");
  assert.equal(decrypt(sealed, "context"), "secret value");
  assert.throws(() => decrypt(sealed, "other-context"));
});
test("database application role is non-superuser, RLS denies context-free rows, audit cannot be mutated", async () => {
  const role = await apiPool.query(
    "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
  );
  assert.equal(role.rows[0].rolsuper, false);
  assert.equal(role.rows[0].rolbypassrls, false);
  assert.equal((await apiPool.query("SELECT * FROM messages")).rowCount, 0);
  await assert.rejects(() => apiPool.query("SELECT password_hash FROM users"));
  await assert.rejects(() => apiPool.query("DELETE FROM audit_logs"));
  const log = await request(owner, "GET", `/servers/${serverId}/audit`);
  assert.equal(log.status, 200);
  assert.ok(log.data.length > 0);
  assert.ok(
    log.data.every(
      (r: any) =>
        /^[a-f\d]{64}$/.test(r.recordHash) &&
        !JSON.stringify(r).includes(owner.password),
    ),
  );
});
function connect(actor: Actor, origin = process.env.APP_ORIGIN!) {
  return new WebSocket(address.replace("http:", "ws:") + "/api/realtime", {
    headers: { Cookie: actor.cookie, Origin: origin },
  });
}
function frame(ws: WebSocket, predicate: (v: any) => boolean, timeout = 8000) {
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", handler);
      reject(new Error("Timed out waiting for a live frame"));
    }, timeout);
    const handler = (raw: WebSocket.RawData) => {
      const v = JSON.parse(raw.toString());
      if (predicate(v)) {
        clearTimeout(timer);
        ws.off("message", handler);
        resolve(v);
      }
    };
    ws.on("message", handler);
  });
}
test("live voice permissions revoke transmission and moderation removes the old room membership", async () => {
  const ws = connect(member);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  const ready = frame(ws, (v) => v.type === "ready");
  ws.send(JSON.stringify({ type: "auth", csrf: member.csrf }));
  await ready;
  const joined = frame(ws, (v) => v.type === "voice.joined");
  ws.send(JSON.stringify({ type: "voice.join", channelId: voiceId }));
  const admission = await joined;
  const connectionId = admission.connectionId;
  const validationPath = `/media/rtc/validate?access_token=${encodeURIComponent(admission.media.token)}`;
  assert.equal((await request(member, "GET", validationPath)).status, 200);
  assert.equal((await request(outsider, "GET", validationPath)).status, 403);
  const transmitting = frame(
    ws,
    (v) =>
      v.type === "voice.participants" &&
      v.participants.some(
        (p: any) => p.id === connectionId && p.camera && !p.muted,
      ),
  );
  ws.send(
    JSON.stringify({
      type: "voice.state",
      muted: false,
      deafened: false,
      camera: true,
      screen: true,
    }),
  );
  await transmitting;
  const role = (
    await request(owner, "GET", "/bootstrap")
  ).data.serverRoles.find((r: any) => r.serverId === serverId && r.isDefault);
  const restricted = frame(
    ws,
    (v) =>
      v.type === "voice.participants" &&
      v.participants.some(
        (p: any) =>
          p.id === connectionId &&
          p.muted &&
          !p.camera &&
          !p.screen &&
          !p.canStream,
      ),
  );
  assert.equal(
    (
      await request(
        owner,
        "PUT",
        `/servers/${serverId}/roles/${role.id}/permissions`,
        {
          permissions: role.permissions.filter(
            (p: string) => !["SPEAK", "STREAM"].includes(p),
          ),
        },
      )
    ).status,
    200,
  );
  await restricted;
  assert.equal(
    (
      await request(
        owner,
        "PUT",
        `/servers/${serverId}/roles/${role.id}/permissions`,
        { permissions: role.permissions },
      )
    ).status,
    200,
  );
  const destination = await request(
    owner,
    "POST",
    `/servers/${serverId}/channels`,
    { name: "quiet-room", kind: "voice" },
  );
  assert.equal(destination.status, 200);
  const left = frame(ws, (v) => v.type === "voice.left");
  const moved = await request(
    owner,
    "PUT",
    `/voice/${connectionId}/moderation`,
    { moveTo: destination.data.id },
  );
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  await left;
  assert.equal((await request(member, "GET", validationPath)).status, 403);
  assert.ok(
    !(await request(owner, "GET", "/bootstrap")).data.voice.some(
      (p: any) => p.id === connectionId,
    ),
  );
  ws.close();
});
test("room deltas preserve edits, delete tombstones and reject foreign/private IDs", async () => {
  const neverJoined = await createActor("delta-outsider");
  const key = encodeURIComponent(serverId + "/general");
  const created = await request(owner, "POST", "/rooms/" + key + "/messages", {
    text: "Delta original",
    nonce: randomUUID(),
  });
  assert.equal(created.status, 201);
  const messageId = created.data.id;
  const privateMessage = await request(
    owner,
    "POST",
    "/rooms/" + encodeURIComponent(serverId + "/private-review") + "/messages",
    { text: "Hidden delta", nonce: randomUUID() },
  );
  assert.equal(privateMessage.status, 201);
  const foreign = privateMessage.data.id;
  await request(owner, "PATCH", "/messages/" + messageId, {
    text: "Delta edited",
  });
  const delta = await request(member, "POST", "/rooms/" + key + "/sync", {
    ids: [messageId, foreign, "nonexistent"],
  });
  assert.equal(delta.status, 200, JSON.stringify(delta.data));
  assert.equal(delta.data.items.length, 1);
  assert.equal(delta.data.items[0].text, "Delta edited");
  assert.deepEqual(delta.data.removed, [foreign, "nonexistent"]);
  assert.equal(
    (
      await request(neverJoined, "POST", "/rooms/" + key + "/sync", {
        ids: [messageId],
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        member,
        "POST",
        "/rooms/" + encodeURIComponent(serverId + "/private-review") + "/sync",
        { ids: [foreign] },
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(member, "POST", "/rooms/" + key + "/sync", {
        ids: Array(101).fill(messageId),
      })
    ).status,
    400,
  );
  await request(owner, "DELETE", "/messages/" + messageId);
  const removed = await request(member, "POST", "/rooms/" + key + "/sync", {
    ids: [messageId],
  });
  assert.deepEqual(removed.data.items, []);
  assert.deepEqual(removed.data.removed, [messageId]);
  await request(owner, "POST", "/messages/" + messageId + "/restore", {});
  assert.equal(
    (
      await request(member, "POST", "/rooms/" + key + "/sync", {
        ids: [messageId],
      })
    ).data.items.length,
    1,
  );
});

test("unread aggregation verifies current session, room permissions and own identity", async () => {
  const contextFree = await apiPool.query(
    "SELECT noctis.unread_count($1,NULL) AS count",
    [privateId],
  );
  assert.equal(contextFree.rows[0].count, 0);
  const session = await authPool.query(
    "SELECT id FROM sessions WHERE user_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
    [member.id],
  );
  const identity = { userId: member.id, sessionId: session.rows[0].id };
  await transaction(identity, async (db) => {
    assert.equal(
      (
        await db.query("SELECT noctis.unread_count($1,NULL) AS count", [
          privateId,
        ])
      ).rows[0].count,
      0,
    );
    assert.equal(
      (
        await db.query("SELECT noctis.unread_count($1,$2) AS count", [
          channelId,
          "foreign-conversation",
        ])
      ).rows[0].count,
      0,
    );
  });
  const key = encodeURIComponent(serverId + "/general");
  await request(member, "POST", "/rooms/" + key + "/read", {});
  await request(owner, "POST", "/rooms/" + key + "/messages", {
    text: "Unread aggregate fixture",
    nonce: randomUUID(),
  });
  const read = await request(member, "POST", "/rooms/" + key + "/sync", {
    ids: [],
  });
  assert.equal(read.data.unread, 1);
  const activity = await request(member, "GET", "/activity");
  assert.ok(!activity.data.channels.some((c: any) => c.id === privateId));
});

test("indexed deliveries target a room and revoke channel-only subscriptions on server changes", async () => {
  const ws = connect(member);
  const other = connect(outsider);
  const collected: any[] = [];
  try {
    await Promise.all(
      [ws, other].map(
        (socket) =>
          new Promise<void>((resolve, reject) => {
            socket.once("open", resolve);
            socket.once("error", reject);
          }),
      ),
    );
    const ready = frame(ws, (v) => v.type === "ready");
    const otherReady = frame(other, (v) => v.type === "ready");
    ws.send(JSON.stringify({ type: "auth", csrf: member.csrf }));
    other.send(JSON.stringify({ type: "auth", csrf: outsider.csrf }));
    await Promise.all([ready, otherReady]);
    other.on("message", (raw) => collected.push(JSON.parse(raw.toString())));
    const subscribed = frame(ws, (v) => v.type === "subscribed");
    ws.send(
      JSON.stringify({ type: "subscribe", topics: ["channel:" + channelId] }),
    );
    await subscribed;
    const update = frame(
      ws,
      (v) => v.type === "invalidate" && v.topic === "channel:" + channelId,
    );
    const posted = await request(
      owner,
      "POST",
      "/rooms/" + encodeURIComponent(serverId + "/general") + "/messages",
      { text: "Indexed delivery", nonce: randomUUID() },
    );
    assert.deepEqual((await update).ids, [posted.data.id]);
    assert.equal(collected.filter((v) => v.type === "invalidate").length, 0);
    const revoked = frame(
      ws,
      (v) => v.type === "revoked" && v.topic === "channel:" + channelId,
    );
    assert.equal(
      (await request(member, "DELETE", "/servers/" + serverId + "/membership"))
        .status,
      200,
    );
    await revoked;
    assert.equal(
      (
        await request(
          member,
          "POST",
          "/rooms/" + encodeURIComponent(serverId + "/general") + "/sync",
          { ids: [posted.data.id] },
        )
      ).status,
      404,
    );
    await request(member, "POST", "/servers/" + serverId + "/join", {});
  } finally {
    ws.close();
    other.close();
  }
});

test("WebSocket origin, private subscriptions, voice room membership, and revoked sessions are revalidated", async () => {
  const denied = connect(owner, "https://attacker.invalid");
  const deniedStatus = await new Promise<number>((resolve) => {
    denied.on("unexpected-response", (_, res) => {
      res.resume();
      resolve(res.statusCode!);
    });
    denied.on("error", () => {});
  });
  assert.equal(deniedStatus, 403);
  denied.terminate();
  const ws = connect(member);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  const ready = frame(ws, (v) => v.type === "ready");
  ws.send(JSON.stringify({ type: "auth", csrf: member.csrf }));
  await ready;
  const error = frame(ws, (v) => v.type === "error");
  ws.send(
    JSON.stringify({ type: "subscribe", topics: [`channel:${privateId}`] }),
  );
  assert.match((await error).message, /unavailable/i);
  ws.close();
  const own = connect(owner);
  await new Promise<void>((resolve) => own.once("open", resolve));
  const handshake = frame(own, (v) => v.type === "ready");
  own.send(JSON.stringify({ type: "auth", csrf: owner.csrf }));
  await handshake;
  const joined = frame(own, (v) => v.type === "voice.joined");
  own.send(JSON.stringify({ type: "voice.join", channelId: voiceId }));
  const room = await joined;
  assert.equal(room.participants.length, 1);
  const invalid = frame(own, (v) => v.type === "error");
  own.send(
    JSON.stringify({
      type: "voice.signal",
      target: randomUUID(),
      signal: { type: "offer", sdp: "invalid" },
    }),
  );
  await invalid;
  const closed = new Promise<number>((resolve) =>
    own.once("close", (code) => resolve(code)),
  );
  await request(owner, "POST", "/auth/logout", { all: true });
  assert.equal(await closed, 4401);
  assert.equal((await request(owner, "GET", "/bootstrap")).status, 401);
});
