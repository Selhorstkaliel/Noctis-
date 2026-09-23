import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { z } from "zod";
import {
  transaction,
  listenerPool,
  workerPool,
  changed,
  audit,
  type Identity,
  type DB,
} from "./db.js";
import {
  authenticate,
  verifyOrigin,
  csrf,
  sessionLive,
  throttle,
} from "./auth.js";
import { decrypt, encrypt, equal } from "./crypto.js";
import { channel, member, conversation, permit } from "./authorization.js";
import { id, requireThat } from "./errors.js";
import { config, publicWebSocketUrl } from "./config.js";
import {
  mediaRoom,
  prepareMediaRoom,
  mediaRights,
  mediaToken,
  syncMediaRights,
  removeMedia,
} from "./media.js";
import { RealtimeQueue } from "./realtime-queue.js";
import { musicEvents } from "../shared/music.js";
const topic = z
  .string()
  .max(160)
  .regex(/^(user|server|channel|conversation):[\w-]+$/);
const frame = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auth"), csrf: z.string().length(64) }).strict(),
  z
    .object({ type: z.literal("subscribe"), topics: z.array(topic).max(50) })
    .strict(),
  z.object({ type: z.literal("ping") }).strict(),
  z.object({ type: z.literal("voice.join"), channelId: id }).strict(),
  z.object({ type: z.literal("voice.leave") }).strict(),
  z
    .object({
      type: z.literal("voice.state"),
      muted: z.boolean(),
      deafened: z.boolean(),
      camera: z.boolean(),
      screen: z.boolean(),
    })
    .strict(),
]);
const realtimeTicket = z
  .object({
    userId: id,
    sessionId: id,
    expiresAt: z.number().int(),
  })
  .strict();
const musicNotification = z
  .object({
    serverId: id,
    event: z.enum(musicEvents),
    revision: z.number().int().nonnegative(),
  })
  .strict();
type Peer = {
  socket: WebSocket;
  identity: Identity;
  id: string;
  topics: Set<string>;
  ready: boolean;
  channelId?: string;
  lastPing: number;
  queue: Promise<void>;
  queuedFrames: number;
  dependencies: Map<string, string>;
  indexed: Set<string>;
  voiceServer?: string;
  mediaRights?: string;
};
const peers = new Map<string, Peer>();
const subscribers = new Map<string, Set<Peer>>();
function unindex(p: Peer) {
  for (const key of p.indexed) {
    const set = subscribers.get(key);
    set?.delete(p);
    if (!set?.size) subscribers.delete(key);
  }
  p.indexed.clear();
}
function index(p: Peer) {
  unindex(p);
  if (!peers.has(p.id)) return;
  const keys = new Set(p.topics);
  for (const t of p.topics) {
    const server = p.dependencies.get(t);
    if (server) keys.add("server:" + server);
  }
  if (p.channelId) keys.add("voice:" + p.channelId);
  if (p.voiceServer) keys.add("server:" + p.voiceServer);
  for (const key of keys) {
    let set = subscribers.get(key);
    if (!set) subscribers.set(key, (set = new Set()));
    set.add(p);
    p.indexed.add(key);
  }
}
const send = (p: Peer, data: unknown) => {
  if (p.socket.readyState === 1 && p.socket.bufferedAmount < 256 * 1024)
    p.socket.send(JSON.stringify(data));
  else p.socket.close(1013, "Connection is too slow.");
};
async function allowed(db: DB, p: Peer, t: string) {
  const [kind, id] = t.split(":");
  if (kind === "user")
    requireThat(id === p.identity.userId, 403, "Subscription unavailable.");
  else if (kind === "server") await member(db, id);
  else if (kind === "channel") {
    const c = await channel(db, id);
    p.dependencies.set(t, c.server_id);
  } else await conversation(db, id);
}
async function participants(db: DB, cid: string) {
  return (
    await db.query(
      'SELECT connection_id AS id,user_id AS "userId",muted,deafened,camera,screen,server_muted AS "serverMuted",server_deafened AS "serverDeafened",noctis.channel_permission(channel_id,\'SPEAK\',user_id) AS "canSpeak",noctis.channel_permission(channel_id,\'STREAM\',user_id) AS "canStream" FROM voice_participants WHERE channel_id=$1 AND updated_at>now()-interval \'2 minutes\' ORDER BY connection_id',
      [cid],
    )
  ).rows;
}
async function leave(p: Peer) {
  const previous = p.channelId;
  p.channelId = undefined;
  p.voiceServer = undefined;
  p.mediaRights = undefined;
  if (peers.has(p.id)) index(p);
  if (previous) {
    await workerPool.query(
      "DELETE FROM voice_participants WHERE connection_id=$1",
      [p.id],
    );
    await workerPool.query("SELECT pg_notify('noctis_changes',$1)", [
      `voice:${previous}`,
    ]);
    await workerPool.query(
      "SELECT pg_notify('noctis_changes','server:'||server_id) FROM channels WHERE id=$1",
      [previous],
    );
    await removeMedia(p.id, mediaRoom(previous)).catch(() => {});
    send(p, { type: "voice.left" });
  }
}
async function revalidate(p: Peer) {
  if (!(await sessionLive(p.identity))) {
    p.socket.close(4401, "Session expired.");
    return false;
  }
  let denied = false;
  await transaction(p.identity, async (db) => {
    for (const t of [...p.topics])
      try {
        await allowed(db, p, t);
      } catch {
        p.topics.delete(t);
        send(p, { type: "revoked", topic: t });
      }
    if (p.channelId) {
      try {
        await channel(db, p.channelId, "CONNECT_VOICE");
        const rights = await db.query(
          "SELECT noctis.channel_permission($1,'SPEAK') AS speak,noctis.channel_permission($1,'STREAM') AS stream",
          [p.channelId],
        );
        const updated = await db.query(
          "UPDATE voice_participants SET muted=CASE WHEN NOT $2 THEN true ELSE muted END,camera=camera AND $3,screen=screen AND $3 WHERE connection_id=$1 AND ((NOT $2 AND NOT muted) OR (NOT $3 AND (camera OR screen)))",
          [p.id, rights.rows[0].speak, rights.rows[0].stream],
        );
        if (updated.rowCount) await changed(db, `voice:${p.channelId}`);
        const signature = JSON.stringify(
          await mediaRights(db, p.channelId, p.id),
        );
        if (signature !== p.mediaRights) {
          await syncMediaRights(db, p.channelId, p.id);
          p.mediaRights = signature;
        }
      } catch {
        denied = true;
      }
    }
  });
  if (denied) await leave(p);
  index(p);
  return true;
}
export async function realtimeRoutes(app: FastifyInstance) {
  app.get("/api/realtime/ticket", async (req) => {
    await throttle("realtime-ticket", req.identity.userId, 30, 60);
    requireThat(await sessionLive(req.identity), 401, "Session expired.");
    return {
      url: publicWebSocketUrl("/api/realtime"),
      ticket: encrypt(
        JSON.stringify({
          ...req.identity,
          expiresAt: Date.now() + 30_000,
        }),
        "realtime-ticket",
      ),
    };
  });
  let stopping = false;
  let listener: DB | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  type MusicNotice = z.infer<typeof musicNotification>;
  type Batch = {
    peer: Peer;
    events: Map<string, Set<string> | null>;
    music?: Map<string, MusicNotice>;
  };
  const merge = (a: Batch, b: Batch) => {
    for (const [topic, ids] of b.events) {
      const old = a.events.get(topic);
      const merged =
        ids && old !== null ? new Set([...(old || []), ...ids]) : null;
      a.events.set(topic, merged && merged.size <= 100 ? merged : null);
    }
    if (b.music) {
      a.music ||= new Map();
      for (const [serverId, notice] of b.music) a.music.set(serverId, notice);
    }
    return a;
  };
  const deliveries = new RealtimeQueue<Batch>(
    config.REALTIME_CONCURRENCY,
    4096,
    merge,
    async ({ peer: p, events, music }) => {
      if (!peers.has(p.id) || !p.ready || p.socket.readyState !== 1) return;
      const security =
        !!music?.size ||
        [...events.keys()].some(
          (t) => /^(server|user|voice):/.test(t) || t === "heartbeat",
        );
      if (security && !(await revalidate(p))) return;
      for (const [t, ids] of events) {
        if (t === "heartbeat") continue;
        if (t.startsWith("voice:")) {
          if (p.channelId !== t.slice(6)) continue;
          await transaction(p.identity, async (db) => {
            await channel(db, p.channelId!, "CONNECT_VOICE");
            send(p, {
              type: "voice.participants",
              participants: await participants(db, p.channelId!),
            });
          });
        } else if (t.startsWith("activity:")) {
          await transaction(p.identity, () => Promise.resolve());
          send(p, { type: "activity" });
        } else if (
          p.topics.has(t) ||
          (t.startsWith("server:") && p.indexed.has(t))
        ) {
          // Check the session and only the destination resource, never unrelated rooms.
          try {
            await transaction(p.identity, (db) => allowed(db, p, t));
            send(p, {
              type: "invalidate",
              topic: t,
              ...(ids ? { ids: [...ids] } : {}),
            });
          } catch (error) {
            if ((error as { statusCode?: number }).statusCode === 401) {
              p.socket.close(4401, "Session expired.");
              return;
            }
            if (
              ![403, 404].includes(
                (error as { statusCode?: number }).statusCode || 0,
              )
            )
              throw error;
            p.topics.delete(t);
            index(p);
            send(p, { type: "revoked", topic: t });
          }
        }
      }
      for (const notice of music?.values() || []) {
        const destination = `server:${notice.serverId}`;
        if (!p.indexed.has(destination)) continue;
        await transaction(p.identity, (db) => member(db, notice.serverId));
        send(p, {
          type: notice.event,
          serverId: notice.serverId,
          revision: notice.revision,
        });
      }
    },
    ({ peer }, error) => {
      const e = error as
        { statusCode?: number; code?: string; name?: string } | undefined;
      if (e?.statusCode === 401) peer.socket.close(4401, "Session expired.");
      else {
        app.log.error(
          { code: e?.code, status: e?.statusCode, type: e?.name },
          "Live delivery failed",
        );
        peer.socket.close(1013, "Live updates are busy. Reconnecting.");
      }
    },
  );
  const broadcast = (payload: string) => {
    let t = payload,
      messageId: string | undefined;
    if (payload.startsWith("{")) {
      const data = z
        .object({ topic, messageId: id })
        .strict()
        .safeParse(JSON.parse(payload));
      if (!data.success) return;
      t = data.data.topic;
      messageId = data.data.messageId;
    }
    const key = t.startsWith("activity:") ? "user:" + t.slice(9) : t;
    for (const p of subscribers.get(key) || []) {
      if (p.ready)
        deliveries.push(p.id, {
          peer: p,
          events: new Map([[t, messageId ? new Set([messageId]) : null]]),
        });
    }
  };
  const broadcastMusic = (payload: string) => {
    const parsed = musicNotification.safeParse(JSON.parse(payload));
    if (!parsed.success) return;
    const notice = parsed.data;
    const key = `server:${notice.serverId}`;
    for (const p of subscribers.get(key) || []) {
      if (p.ready)
        deliveries.push(p.id, {
          peer: p,
          events: new Map(),
          music: new Map([[notice.serverId, notice]]),
        });
    }
  };
  const listen = async () => {
    let client: DB | undefined;
    try {
      client = await listenerPool.connect();
      listener = client;
      client.on("notification", (n) => {
        if (n.channel === "noctis_changes" && n.payload) {
          try {
            broadcast(n.payload);
          } catch {
            app.log.error("Invalid live notification");
          }
        }
        if (n.channel === "noctis_music" && n.payload) {
          try {
            broadcastMusic(n.payload);
          } catch {
            app.log.error("Invalid music notification");
          }
        }
      });
      client.once("error", () => {
        client?.release(true);
        if (listener === client) listener = undefined;
        // NOTIFY is ephemeral. Reconnect clients so they resync after any gap.
        for (const p of peers.values())
          p.socket.close(1012, "Live updates reconnecting.");
        if (!stopping) reconnect = setTimeout(() => void listen(), 2000);
      });
      await client.query("LISTEN noctis_changes");
      await client.query("LISTEN noctis_music");
    } catch {
      if (listener === client) {
        client?.release(true);
        listener = undefined;
      }
      if (!stopping) reconnect = setTimeout(() => void listen(), 2000);
    }
  };
  await listen();
  const heartbeat = setInterval(() => {
    for (const p of peers.values()) {
      if (Date.now() - p.lastPing > 90000)
        p.socket.close(4408, "Heartbeat expired.");
      else
        deliveries.push(p.id, {
          peer: p,
          events: new Map([["heartbeat", null]]),
        });
    }
  }, 15000);
  app.get(
    "/api/realtime",
    {
      websocket: true,
      preValidation: async (req) => {
        requireThat(
          listener,
          503,
          "Live updates are reconnecting. Please try again.",
        );
        verifyOrigin(req);
        const supplied = new URL(req.url, config.APP_ORIGIN).searchParams.get(
          "access_token",
        );
        if (supplied) {
          requireThat(
            supplied.length < 2048,
            401,
            "Connection ticket is invalid.",
          );
          try {
            const ticket = realtimeTicket.parse(
              JSON.parse(decrypt(supplied, "realtime-ticket")),
            );
            requireThat(
              ticket.expiresAt >= Date.now() &&
                ticket.expiresAt <= Date.now() + 35_000,
              401,
              "Connection ticket has expired.",
            );
            req.identity = {
              userId: ticket.userId,
              sessionId: ticket.sessionId,
            };
            requireThat(
              await sessionLive(req.identity),
              401,
              "Session expired.",
            );
          } catch (error) {
            if ((error as { statusCode?: number }).statusCode) throw error;
            throw Object.assign(new Error("Connection ticket is invalid."), {
              statusCode: 401,
            });
          }
        } else {
          req.identity = await authenticate(req);
        }
        await throttle("ws-connect", req.identity.userId, 20, 60);
        requireThat(
          (subscribers.get(`user:${req.identity.userId}`)?.size || 0) < 8,
          429,
          "Close an unused Noctis tab before opening another.",
        );
      },
    },
    (socket, req) => {
      const p: Peer = {
        socket,
        identity: req.identity,
        id: randomUUID(),
        topics: new Set([`user:${req.identity.userId}`]),
        ready: false,
        lastPing: Date.now(),
        queue: Promise.resolve(),
        queuedFrames: 0,
        dependencies: new Map(),
        indexed: new Set(),
      };
      peers.set(p.id, p);
      index(p);
      const deadline = setTimeout(() => {
        if (!p.ready) socket.close(4403, "Handshake expired.");
      }, 5000);
      socket.on("message", (raw, isBinary) => {
        if (socket.readyState !== 1) return;
        if (
          (Array.isArray(raw)
            ? raw.reduce((n, b) => n + b.length, 0)
            : raw.byteLength) > 65536
        ) {
          socket.close(1009, "Frame is too large.");
          return;
        }
        if (p.queuedFrames >= 32) {
          socket.close(1013, "Too many pending frames.");
          return;
        }
        p.queuedFrames++;
        p.queue = p.queue
          .then(async () => {
            if (socket.readyState !== 1) return;
            requireThat(!isBinary, 400, "Binary frames are not supported.");
            await throttle("ws-frame", p.identity.userId, 150, 60);
            const data = frame.parse(JSON.parse(raw.toString()));
            requireThat(await sessionLive(p.identity), 401, "Session expired.");
            if (!p.ready) {
              requireThat(
                data.type === "auth" && equal(data.csrf, csrf(p.identity)),
                403,
                "Handshake could not be verified.",
              );
              p.ready = true;
              clearTimeout(deadline);
              send(p, { type: "ready", connectionId: p.id });
              return;
            }
            const committed: (() => void)[] = [];
            await transaction(p.identity, async (db) => {
              if (data.type === "ping") {
                p.lastPing = Date.now();
                const present = await db.query(
                  "SELECT 1 FROM presence WHERE user_id=$1 AND updated_at>now()-interval '45 seconds'",
                  [p.identity.userId],
                );
                await db.query(
                  "INSERT INTO presence(session_id,user_id) VALUES($1,$2) ON CONFLICT(session_id) DO UPDATE SET updated_at=now()",
                  [p.identity.sessionId, p.identity.userId],
                );
                if (!present.rowCount)
                  await db.query(
                    "SELECT pg_notify('noctis_changes','server:'||server_id) FROM server_members WHERE user_id=$1",
                    [p.identity.userId],
                  );
                if (p.channelId) {
                  await channel(db, p.channelId, "CONNECT_VOICE");
                  await db.query(
                    "UPDATE voice_participants SET updated_at=now() WHERE connection_id=$1",
                    [p.id],
                  );
                }
                send(p, { type: "pong" });
              }
              if (data.type === "subscribe") {
                for (const t of data.topics) await allowed(db, p, t);
                p.topics = new Set([
                  "user:" + p.identity.userId,
                  ...data.topics,
                ]);
                index(p);
                send(p, { type: "subscribed", topics: [...p.topics] });
              }
              if (data.type === "voice.join") {
                app.log.debug(
                  { kind: "voice", stage: "join_received" },
                  "voice join",
                );
                const c = await channel(db, data.channelId, "CONNECT_VOICE");
                requireThat(c.kind === "voice", 400, "Choose a voice channel.");
                await leave(p);
                await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
                  c.id,
                ]);
                await prepareMediaRoom(c.id);
                app.log.debug(
                  { kind: "voice", stage: "room_ready" },
                  "voice join",
                );
                requireThat(
                  !(
                    await db.query(
                      "SELECT 1 FROM voice_participants WHERE user_id=$1 AND channel_id=$2",
                      [p.identity.userId, c.id],
                    )
                  ).rowCount,
                  409,
                  "You are already in this room on another device.",
                );
                await db.query(
                  "INSERT INTO voice_participants(connection_id,user_id,session_id,channel_id,media_room) VALUES($1,$2,$3,$4,$5)",
                  [
                    p.id,
                    p.identity.userId,
                    p.identity.sessionId,
                    c.id,
                    mediaRoom(c.id),
                  ],
                );
                p.channelId = c.id;
                p.voiceServer = c.server_id;
                index(p);
                const token = await mediaToken(
                  p.id,
                  await mediaRights(db, c.id, p.id),
                );
                const list = await participants(db, c.id);
                committed.push(() =>
                  send(p, {
                    type: "voice.joined",
                    channelId: c.id,
                    connectionId: p.id,
                    media: {
                      transport: "sfu",
                      url: publicWebSocketUrl("/api/media"),
                      token,
                    },
                    participants: list,
                  }),
                );
                await changed(db, `voice:${c.id}`);
                await changed(db, `server:${c.server_id}`);
              }
              if (data.type === "voice.leave") await leave(p);
              if (data.type === "voice.state") {
                requireThat(p.channelId, 409, "Join a voice room first.");
                await channel(db, p.channelId, "CONNECT_VOICE");
                if (!data.muted) await channel(db, p.channelId, "SPEAK");
                if (data.camera || data.screen)
                  await channel(db, p.channelId, "STREAM");
                await db.query(
                  "UPDATE voice_participants SET muted=($2 OR server_muted),deafened=($3 OR server_deafened),camera=$4,screen=$5,updated_at=now() WHERE connection_id=$1",
                  [p.id, data.muted, data.deafened, data.camera, data.screen],
                );
                await changed(db, `voice:${p.channelId}`);
              }
            });
            if (committed.length)
              app.log.debug(
                { kind: "voice", stage: "join_committed" },
                "voice join",
              );
            for (const notify of committed) notify();
          })
          .catch((error) => {
            const status = (error as { statusCode?: number }).statusCode;
            send(p, {
              type: "error",
              message:
                status && status < 500
                  ? (error as Error).message
                  : "This live action could not be completed.",
            });
            if (status === 401 || status === 403 || status === 429)
              socket.close(4403, "Connection authorization failed.");
          })
          .finally(() => {
            p.queuedFrames--;
          });
      });
      socket.on("close", () => {
        clearTimeout(deadline);
        peers.delete(p.id);
        unindex(p);
        deliveries.remove(p.id);
        void p.queue.finally(() => leave(p)).catch(() => {});
      });
      socket.on("error", () => socket.close());
    },
  );
  // NOTIFY carries moderator moves. Media signaling uses the authenticated SFU gateway.
  const signalListener = await listenerPool.connect();
  let signalListenerFailed = false;
  signalListener.on("error", () => {
    signalListenerFailed = true;
    signalListener.release(true);
    // Fail closed; the process supervisor restarts the listener and all sockets.
    for (const p of peers.values())
      p.socket.close(1011, "Signaling unavailable.");
    if (!stopping) void app.close().catch(() => {});
  });
  await signalListener.query("LISTEN noctis_signals");
  type Relay = { target: string; channel: string; moveTo: string };
  const relayQueue = new RealtimeQueue<Relay[]>(
    2,
    4096,
    (a, b) => [...a, ...b].slice(-32),
    async (batch) => {
      for (const data of batch) {
        const p = peers.get(data.target);
        if (!p || !(await sessionLive(p.identity))) continue;
        await transaction(p.identity, (db) =>
          channel(db, data.moveTo, "CONNECT_VOICE"),
        );
        await leave(p);
        send(p, { type: "voice.move", channelId: data.moveTo });
      }
    },
    (batch) => {
      for (const data of batch)
        peers
          .get(data.target)
          ?.socket.close(1013, "Voice moderation unavailable.");
    },
  );
  signalListener.on("notification", (n) => {
    if (!n.payload) return;
    try {
      const data = z
        .object({
          target: id,
          channel: id,
          moveTo: id,
          from: z.string().optional(),
        })
        .strict()
        .parse(JSON.parse(n.payload));
      if (peers.has(data.target)) relayQueue.push(data.target, [data]);
    } catch {
      app.log.error("Invalid voice moderation notification");
    }
  });
  const statistics = setInterval(() => {
    if (peers.size)
      app.log.info(
        {
          kind: "performance",
          peers: peers.size,
          topics: subscribers.size,
          deliveries: deliveries.metrics,
          moderation: relayQueue.metrics,
        },
        "realtime workload",
      );
  }, 60000);
  app.put("/api/voice/:id/moderation", (req) =>
    transaction(req.identity, async (db) => {
      const p = z.object({ id }).parse(req.params);
      const input = z
        .object({
          muted: z.boolean().optional(),
          deafened: z.boolean().optional(),
          moveTo: id.optional(),
        })
        .strict()
        .refine((v) => Object.keys(v).length > 0)
        .parse(req.body);
      const r = await db.query(
        "SELECT * FROM voice_participants WHERE connection_id=$1 FOR UPDATE",
        [p.id],
      );
      requireThat(r.rowCount);
      const v = r.rows[0];
      const c = await channel(db, v.channel_id);
      const ranks = await db.query(
        "SELECT noctis.rank($1,$2)>noctis.rank($1,$3) AS allowed",
        [c.server_id, req.identity.userId, v.user_id],
      );
      requireThat(
        ranks.rows[0].allowed,
        403,
        "You can moderate only members below your role.",
      );
      if (input.muted !== undefined)
        await permit(db, c.server_id, "MUTE_MEMBERS");
      if (input.deafened !== undefined)
        await permit(db, c.server_id, "DEAFEN_MEMBERS");
      if (input.moveTo) {
        await permit(db, c.server_id, "MOVE_MEMBERS");
        const dest = await channel(db, input.moveTo, "CONNECT_VOICE");
        requireThat(
          dest.server_id === c.server_id && dest.kind === "voice",
          400,
          "Choose a voice channel in this server.",
        );
        requireThat(
          (
            await db.query(
              "SELECT noctis.channel_permission($1,'CONNECT_VOICE',$2) AS allowed",
              [dest.id, v.user_id],
            )
          ).rows[0].allowed,
          403,
          "This member cannot access that voice channel.",
        );
      }
      await db.query(
        "UPDATE voice_participants SET server_muted=coalesce($2,server_muted),server_deafened=coalesce($3,server_deafened),muted=CASE WHEN $2 THEN true ELSE muted END,deafened=CASE WHEN $3 THEN true ELSE deafened END WHERE connection_id=$1",
        [p.id, input.muted ?? null, input.deafened ?? null],
      );
      if (input.moveTo) {
        await db.query(
          "DELETE FROM voice_participants WHERE connection_id=$1",
          [p.id],
        );
        await db.query("SELECT pg_notify('noctis_signals',$1)", [
          JSON.stringify({
            target: p.id,
            from: "server",
            channel: v.channel_id,
            moveTo: input.moveTo,
          }),
        ]);
      }
      await audit(
        db,
        req.identity.userId,
        "voice.moderated",
        v.user_id,
        c.server_id,
      );
      await changed(db, `voice:${v.channel_id}`);
      return { ok: true };
    }),
  );
  app.addHook("onClose", async () => {
    stopping = true;
    clearInterval(heartbeat);
    deliveries.close();
    relayQueue.close();
    clearInterval(statistics);
    if (reconnect) clearTimeout(reconnect);
    for (const p of peers.values()) p.socket.close(1001, "Server restarting.");
    if (listener) {
      await listener.query("UNLISTEN *");
      listener.release();
    }
    if (!signalListenerFailed) {
      await signalListener.query("UNLISTEN *");
      signalListener.release();
    }
  });
}

