import {
  AccessToken,
  TokenVerifier,
  RoomServiceClient,
  TrackSource,
  type VideoGrant,
} from "livekit-server-sdk";
import WebSocket, { type RawData } from "ws";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { transaction, workerPool, type DB, type Identity } from "./db.js";
import { channel } from "./authorization.js";
import { requireThat } from "./errors.js";
import { verifyOrigin, throttle } from "./auth.js";
import { RealtimeQueue } from "./realtime-queue.js";

export const mediaRoom = (channelId: string) =>
  `noctis-${config.NODE_ENV}-${channelId}`;
export function mediaService() {
  requireThat(
    config.LIVEKIT_API_KEY && config.LIVEKIT_API_SECRET.length >= 32,
    503,
    "Voice service is not configured yet.",
  );
  return new RoomServiceClient(
    config.LIVEKIT_INTERNAL_URL,
    config.LIVEKIT_API_KEY,
    config.LIVEKIT_API_SECRET,
    { requestTimeout: 3, failover: false },
  );
}
function notFound(error: unknown) {
  return (error as { code?: string }).code === "not_found";
}
const preparedRooms = new Map<
  string,
  { promise: Promise<void>; validUntil: number }
>();
export async function prepareMediaRoom(cid: string) {
  const existing = preparedRooms.get(cid);
  if (existing && existing.validUntil > Date.now()) return existing.promise;
  const entry = {
    validUntil: Date.now() + 30_000,
    promise: Promise.resolve(),
  };
  entry.promise = (async () => {
    await mediaService().createRoom({
      name: mediaRoom(cid),
      maxParticipants: 0,
      emptyTimeout: 60,
      departureTimeout: 20,
    });
  })();
  preparedRooms.set(cid, entry);
  try {
    await entry.promise;
  } catch {
    if (preparedRooms.get(cid) === entry) preparedRooms.delete(cid);
    throw Object.assign(
      new Error("Voice service is unavailable. Please try again shortly."),
      { statusCode: 503 },
    );
  }
  const cleanup = setTimeout(() => {
    if (preparedRooms.get(cid) === entry && entry.validUntil <= Date.now())
      preparedRooms.delete(cid);
  }, 30_000);
  cleanup.unref();
}
export async function mediaRights(
  db: DB,
  cid: string,
  connectionId: string,
): Promise<VideoGrant> {
  await channel(db, cid, "CONNECT_VOICE");
  const result = await db.query(
    "SELECT server_muted,server_deafened,noctis.channel_permission(channel_id,'SPEAK') AS speak,noctis.channel_permission(channel_id,'STREAM') AS stream FROM voice_participants WHERE connection_id=$1 AND channel_id=$2",
    [connectionId, cid],
  );
  requireThat(result.rowCount);
  const r = result.rows[0];
  const sources: TrackSource[] = [];
  if (r.speak && !r.server_muted) sources.push(TrackSource.MICROPHONE);
  if (r.stream) sources.push(TrackSource.CAMERA, TrackSource.SCREEN_SHARE);
  return {
    roomJoin: true,
    room: mediaRoom(cid),
    canPublish: sources.length > 0,
    canPublishSources: sources,
    canSubscribe: !r.server_deafened,
    canPublishData: false,
    canUpdateOwnMetadata: false,
    canSubscribeMetrics: false,
    canManageAgentSession: false,
  };
}
export async function mediaToken(connectionId: string, grant: VideoGrant) {
  mediaService();
  const token = new AccessToken(
    config.LIVEKIT_API_KEY,
    config.LIVEKIT_API_SECRET,
    { identity: connectionId, ttl: 60 },
  );
  token.addGrant(grant);
  return token.toJwt();
}
export async function syncMediaRights(
  db: DB,
  cid: string,
  connectionId: string,
) {
  const rights = await mediaRights(db, cid, connectionId);
  try {
    await mediaService().updateParticipant(mediaRoom(cid), connectionId, {
      permission: {
        canPublish: rights.canPublish,
        canPublishSources: rights.canPublishSources,
        canSubscribe: rights.canSubscribe,
        canPublishData: false,
        canUpdateMetadata: false,
      },
    });
  } catch (error) {
    if (!notFound(error)) throw error;
  }
}
export async function removeMedia(connectionId: string, roomName: string) {
  try {
    await mediaService().removeParticipant(roomName, connectionId);
  } catch (error) {
    if (!notFound(error)) throw error;
  }
  await workerPool.query(
    "DELETE FROM media_revocations WHERE connection_id=$1 AND room_name=$2",
    [connectionId, roomName],
  );
}
/** Durable cleanup also handles API crashes and administrative DELETE/cascades. */
export async function maintainMedia() {
  await workerPool.query(
    "DELETE FROM voice_participants v WHERE updated_at<now()-interval '2 minutes' OR NOT EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=v.session_id AND s.revoked_at IS NULL AND s.expires_at>now() AND s.last_seen_at>now()-interval '7 days' AND u.deleted_at IS NULL)",
  );
  const pending = await workerPool.query(
    "SELECT connection_id,room_name FROM media_revocations WHERE retry_at<=now() ORDER BY created_at LIMIT 50",
  );
  for (const r of pending.rows) {
    try {
      await removeMedia(r.connection_id, r.room_name);
    } catch {
      await workerPool.query(
        "UPDATE media_revocations SET retry_at=now()+interval '5 seconds' WHERE connection_id=$1",
        [r.connection_id],
      );
    }
  }
}

type Access = {
  identity: Identity;
  connectionId: string;
  channelId: string;
  room: string;
  token: string;
};
declare module "fastify" {
  interface FastifyRequest {
    mediaAccess?: Access;
  }
}
async function authorize(req: FastifyRequest): Promise<Access> {
  mediaService();
  const url = new URL(req.url, config.APP_ORIGIN);
  const supplied = url.searchParams.get("access_token");
  requireThat(
    supplied && supplied.length < 8192,
    401,
    "Voice authorization is unavailable.",
  );
  let claims;
  try {
    claims = await new TokenVerifier(
      config.LIVEKIT_API_KEY,
      config.LIVEKIT_API_SECRET,
    ).verify(supplied, 0);
  } catch {
    throw Object.assign(
      new Error("Voice authorization has expired. Rejoin the room."),
      { statusCode: 401 },
    );
  }
  requireThat(
    claims.sub && claims.video?.roomJoin,
    403,
    "Voice authorization is unavailable.",
  );
  const connectionId = claims.sub;
  return transaction(req.identity, async (db) => {
    const result = await db.query(
      "SELECT channel_id,media_room FROM voice_participants WHERE connection_id=$1 AND user_id=$2 AND session_id=$3 AND updated_at>now()-interval '2 minutes'",
      [connectionId, req.identity.userId, req.identity.sessionId],
    );
    requireThat(
      result.rowCount,
      403,
      "Join the voice room before connecting media.",
    );
    const r = result.rows[0];
    requireThat(
      r.media_room === claims.video?.room,
      403,
      "Voice room does not match.",
    );
    // Self-hosted LiveKit does not revoke cached JWTs. Replace their grants with
    // current DB permissions on EVERY handshake, including SDK reconnects.
    const token = await mediaToken(
      connectionId,
      await mediaRights(db, r.channel_id, connectionId),
    );
    return {
      identity: req.identity,
      connectionId,
      channelId: r.channel_id,
      room: r.media_room,
      token,
    };
  });
}
export async function mediaRoutes(app: FastifyInstance) {
  type Bridge = {
    access: Access;
    browser: WebSocket;
    upstream: WebSocket;
    rights?: string;
  };
  const bridges = new Set<Bridge>();
  const close = (b: Bridge) => {
    b.browser.close(4001, "Voice connection ended.");
    b.upstream.close();
    bridges.delete(b);
  };
  const checks = new RealtimeQueue<Bridge>(
    4,
    4096,
    (_, b) => b,
    async (b) => {
      if (!bridges.has(b)) return;
      await transaction(b.access.identity, async (db) => {
        const active = await db.query(
          "SELECT 1 FROM voice_participants WHERE connection_id=$1 AND session_id=$2 AND channel_id=$3 AND updated_at>now()-interval '2 minutes'",
          [
            b.access.connectionId,
            b.access.identity.sessionId,
            b.access.channelId,
          ],
        );
        requireThat(active.rowCount, 403, "Voice membership expired.");
        const rights = await mediaRights(
          db,
          b.access.channelId,
          b.access.connectionId,
        );
        const signature = JSON.stringify(rights);
        if (signature !== b.rights) {
          await syncMediaRights(db, b.access.channelId, b.access.connectionId);
          b.rights = signature;
        }
      });
    },
    (b) => {
      close(b);
      void removeMedia(b.access.connectionId, b.access.room).catch(() => {});
    },
  );
  const timer = setInterval(() => {
    for (const b of bridges) checks.push(b.access.connectionId, b);
  }, 30000);
  for (const path of ["/api/media/rtc", "/api/media/rtc/v1"]) {
    app.get(
      path,
      {
        websocket: true,
        preValidation: async (req) => {
          verifyOrigin(req);
          await throttle("media-connect", req.identity.userId, 30, 60);
          req.mediaAccess = await authorize(req);
        },
      },
      (browser, req) => {
        const access = req.mediaAccess!;
        app.log.debug(
          { kind: "media", stage: "authorized" },
          "media signaling",
        );
        const incoming = new URL(req.url, config.APP_ORIGIN);
        const target = new URL(config.LIVEKIT_INTERNAL_URL);
        target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
        target.pathname = incoming.pathname.replace("/api/media", "");
        target.search = incoming.search;
        target.searchParams.set("access_token", access.token);
        const upstream = new WebSocket(target, {
          handshakeTimeout: 5000,
          maxPayload: 1024 * 1024,
          perMessageDeflate: false,
        });
        const b: Bridge = { access, browser, upstream };
        bridges.add(b);
        const pending: { data: RawData; binary: boolean }[] = [];
        let bytes = 0;
        const forward = (to: WebSocket, data: RawData, binary: boolean) => {
          if (to.readyState !== 1 || to.bufferedAmount > 1024 * 1024) {
            close(b);
            return;
          }
          to.send(data, { binary });
        };
        browser.on("message", (data, binary) => {
          if (upstream.readyState === 0) {
            bytes += Array.isArray(data)
              ? data.reduce((n, x) => n + x.length, 0)
              : data instanceof ArrayBuffer
                ? data.byteLength
                : data.length;
            if (bytes > 1024 * 1024 || pending.length >= 32) {
              close(b);
              return;
            }
            pending.push({ data, binary });
          } else forward(upstream, data, binary);
        });
        upstream.on("open", () => {
          app.log.debug(
            { kind: "media", stage: "upstream_open" },
            "media signaling",
          );
          for (const m of pending) forward(upstream, m.data, m.binary);
          pending.length = 0;
        });
        upstream.on("message", (data, binary) =>
          forward(browser, data, binary),
        );
        browser.on("close", () => {
          upstream.close();
          bridges.delete(b);
        });
        upstream.on("close", () => {
          app.log.debug(
            { kind: "media", stage: "upstream_closed" },
            "media signaling",
          );
          browser.close(4001, "Voice connection ended.");
          bridges.delete(b);
        });
        for (const [side, socket] of [
          ["browser", browser],
          ["upstream", upstream],
        ] as const)
          socket.on("error", () => {
            app.log.warn(
              { kind: "media", stage: `${side}_error` },
              "media signaling",
            );
            close(b);
          });
      },
    );
    app.get(path + "/validate", async (req) => {
      await authorize(req);
      return { ok: true };
    });
  }
  app.addHook("onClose", async () => {
    clearInterval(timer);
    checks.close();
    for (const b of bridges) close(b);
  });
}
