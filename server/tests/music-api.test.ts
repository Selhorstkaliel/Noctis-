import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import WebSocket from "ws";
import type { MusicProvider } from "../music/providers.js";

process.env.NODE_ENV = "test";
const { MusicProviderService } = await import("../music/providers.js");
const provider: MusicProvider = {
  id: "audio",
  canHandle: (input) =>
    input.startsWith("licensed:") || input.startsWith("official:"),
  resolve: async (input) =>
    input.startsWith("official:")
      ? [
          {
            title: input.slice("official:".length),
            artist: "Official provider",
            url: "https://youtu.be/official",
            provider: "youtube",
            thumbnail: null,
            duration: 180,
            playbackMode: "embed",
          },
        ]
      : [
          {
            title: input.slice("licensed:".length),
            artist: "Noctis licensed test catalog",
            url: "https://licensed.example/audio.mp3",
            provider: "audio",
            thumbnail: null,
            duration: 180,
          },
        ],
  search: async () => [],
  getMetadata: async () => [],
  getPlayableSource: async (track) => track.url,
};
const { buildApp } = await import("../app.js");
const { authPool, closePools, transaction } = await import("../db.js");
const app = await buildApp({
  musicProviders: new MusicProviderService([provider]),
});

type Actor = { id: string; csrf: string; cookie: string; sessionId: string };
let owner: Actor;
let member: Actor;
let serverA: string;
let serverB: string;
let voiceA: string;
let voiceB: string;
let address: string;
let counter = 0;

async function request(
  actor: Actor | undefined,
  method: string,
  path: string,
  body?: unknown,
) {
  const response = await app.inject({
    method: method as never,
    url: `/api${path}`,
    remoteAddress: `203.0.113.${(++counter % 200) + 1}`,
    headers: {
      origin: process.env.APP_ORIGIN!,
      ...(actor ? { cookie: actor.cookie, "x-csrf-token": actor.csrf } : {}),
    },
    ...(body === undefined ? {} : { payload: body as never }),
  });
  return { status: response.statusCode, data: response.json(), response };
}

async function actor(label: string): Promise<Actor> {
  const suffix = randomUUID().slice(0, 8);
  const response = await request(undefined, "POST", "/auth/register", {
    name: `Music ${label}`,
    handle: `music.${suffix}`,
    email: `music-${suffix}@example.invalid`,
    password: randomUUID() + randomUUID(),
  });
  assert.equal(response.status, 201, JSON.stringify(response.data));
  await authPool.query("UPDATE users SET email_verified_at=now() WHERE id=$1", [
    response.data.userId,
  ]);
  const session = await authPool.query(
    "SELECT id FROM sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
    [response.data.userId],
  );
  return {
    id: response.data.userId,
    csrf: response.data.csrf,
    cookie: String(response.response.headers["set-cookie"]).split(";")[0],
    sessionId: session.rows[0].id,
  };
}

async function createServer(name: string) {
  const created = await request(owner, "POST", "/servers", {
    name,
    isPublic: true,
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  return created.data.id as string;
}

async function findVoice(serverId: string) {
  const state = await request(owner, "GET", "/bootstrap");
  return state.data.channels.find(
    (channel: { serverId: string; kind: string }) =>
      channel.serverId === serverId && channel.kind === "voice",
  ).id as string;
}

async function joinVoice(who: Actor, channelId: string) {
  await transaction(
    { userId: who.id, sessionId: who.sessionId },
    async (db) => {
      await db.query(
        "INSERT INTO voice_participants(connection_id,user_id,session_id,channel_id,updated_at) VALUES($1,$2,$3,$4,now())",
        [randomUUID(), who.id, who.sessionId, channelId],
      );
    },
  );
}

function waitFor(
  ws: WebSocket,
  predicate: (value: any) => boolean,
  timeout = 3000,
) {
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Realtime frame timed out.")),
      timeout,
    );
    const listener = (raw: WebSocket.RawData) => {
      const value = JSON.parse(raw.toString());
      if (!predicate(value)) return;
      clearTimeout(timer);
      ws.off("message", listener);
      resolve(value);
    };
    ws.on("message", listener);
  });
}

async function watcher(who: Actor, serverId: string) {
  const ws = new WebSocket(address.replace(/^http/, "ws") + "/api/realtime", {
    headers: { origin: process.env.APP_ORIGIN!, cookie: who.cookie },
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  const ready = waitFor(ws, (value) => value.type === "ready");
  ws.send(JSON.stringify({ type: "auth", csrf: who.csrf }));
  await ready;
  const subscribed = waitFor(ws, (value) => value.type === "subscribed");
  ws.send(
    JSON.stringify({ type: "subscribe", topics: [`server:${serverId}`] }),
  );
  await subscribed;
  return ws;
}

before(async () => {
  owner = await actor("Owner");
  member = await actor("Member");
  serverA = await createServer("Music isolation A");
  serverB = await createServer("Music isolation B");
  assert.equal(
    (await request(member, "POST", `/servers/${serverA}/join`, {})).status,
    200,
  );
  voiceA = await findVoice(serverA);
  voiceB = await findVoice(serverB);
  await joinVoice(owner, voiceA);
  await joinVoice(member, voiceA);
  await joinVoice(owner, voiceB);
  address = await app.listen({ port: 0, host: "127.0.0.1" });
});

after(async () => {
  await app.close();
  await closePools();
});

test("play, concurrent queueing, skip, stop, and server isolation use the API contract", async () => {
  const [firstA, secondA] = await Promise.all([
    request(owner, "POST", `/servers/${serverA}/music/play`, {
      input: "licensed:Alpha",
    }),
    request(member, "POST", `/servers/${serverA}/music/play`, {
      input: "licensed:Beta",
    }),
  ]);
  assert.equal(firstA.status, 200, JSON.stringify(firstA.data));
  assert.equal(secondA.status, 200, JSON.stringify(secondA.data));
  const firstB = await request(
    owner,
    "POST",
    `/servers/${serverB}/music/play`,
    {
      input: "licensed:Gamma",
    },
  );
  assert.equal(firstB.status, 200, JSON.stringify(firstB.data));

  const stateA = await request(owner, "GET", `/servers/${serverA}/music`);
  const stateB = await request(owner, "GET", `/servers/${serverB}/music`);
  const titlesA = [
    stateA.data.currentTrack.title,
    ...stateA.data.queue.map((x: any) => x.title),
  ].sort();
  const nextA = stateA.data.queue[0].title;
  assert.deepEqual(titlesA, ["Alpha", "Beta"]);
  assert.equal(stateB.data.currentTrack.title, "Gamma");
  assert.notEqual(stateA.data.voiceChannelId, stateB.data.voiceChannelId);

  assert.equal(
    (
      await request(
        member,
        "POST",
        `/servers/${serverA}/music/commands/skip`,
        {},
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        owner,
        "POST",
        `/servers/${serverA}/music/commands/volume`,
        { volume: 25 },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        owner,
        "POST",
        `/servers/${serverB}/music/commands/volume`,
        { volume: 75 },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        owner,
        "POST",
        `/servers/${serverA}/music/commands/skip`,
        {},
      )
    ).status,
    200,
  );
  const skippedA = await request(owner, "GET", `/servers/${serverA}/music`);
  const unchangedB = await request(owner, "GET", `/servers/${serverB}/music`);
  assert.equal(skippedA.data.volume, 25);
  assert.equal(skippedA.data.currentTrack.title, nextA);
  assert.equal(unchangedB.data.volume, 75);
  assert.equal(unchangedB.data.currentTrack.title, "Gamma");

  const stopped = await request(
    owner,
    "POST",
    `/servers/${serverA}/music/commands/stop`,
    {},
  );
  assert.equal(stopped.status, 200, JSON.stringify(stopped.data));
  assert.equal(stopped.data.currentTrack, null);
  assert.deepEqual(stopped.data.queue, []);
  assert.equal(stopped.data.botConnected, false);
});

test("official provider completion advances only for the requester or a permitted member", async () => {
  const played = await request(
    owner,
    "POST",
    `/servers/${serverA}/music/play`,
    { input: "official:YouTube stream" },
  );
  assert.equal(played.status, 200, JSON.stringify(played.data));
  const track = played.data.session.currentTrack;
  assert.equal(track.playbackMode, "embed");
  assert.equal(
    (
      await request(
        member,
        "POST",
        `/servers/${serverA}/music/commands/ended`,
        { trackId: track.id },
      )
    ).status,
    403,
  );
  const ended = await request(
    owner,
    "POST",
    `/servers/${serverA}/music/commands/ended`,
    { trackId: track.id },
  );
  assert.equal(ended.status, 200, JSON.stringify(ended.data));
  assert.equal(ended.data.currentTrack, null);
  assert.equal(ended.data.playbackState, "IDLE");
});

test("music realtime events are delivered only to subscribers of their server", async () => {
  const inA = await watcher(owner, serverA);
  const inB = await watcher(owner, serverB);
  const eventsA: any[] = [];
  const eventsB: any[] = [];
  inA.on("message", (raw) => eventsA.push(JSON.parse(raw.toString())));
  inB.on("message", (raw) => eventsB.push(JSON.parse(raw.toString())));
  const changed = waitFor(
    inA,
    (value) =>
      value.type === "music:volumeChanged" && value.serverId === serverA,
  );
  const response = await request(
    owner,
    "POST",
    `/servers/${serverA}/music/commands/volume`,
    {
      volume: 31,
    },
  );
  assert.equal(response.status, 200, JSON.stringify(response.data));
  await changed;
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.ok(eventsA.some((value) => value.type === "music:volumeChanged"));
  assert.equal(
    eventsB.some((value) => value.type.startsWith("music:")),
    false,
  );
  inA.close();
  inB.close();
});
