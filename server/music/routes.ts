import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { transaction, audit, type DB } from "../db.js";
import { throttle } from "../auth.js";
import { id, requireThat } from "../errors.js";
import { permit } from "../authorization.js";
import { musicRepeatModes } from "../../shared/music.js";
import { musicProviders, type MusicProviderService } from "./providers.js";
import { musicSessions, type PostgresMusicSessionManager } from "./sessions.js";

const params = z.object({ id });
const queueQuery = z
  .object({
    offset: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(25).default(10),
  })
  .strict();
const actions = z.enum([
  "pause",
  "resume",
  "pass",
  "skip",
  "stop",
  "volume",
  "remove",
  "clear",
  "shuffle",
  "repeat",
  "move",
  "ended",
]);
const commandParams = z.object({ id, action: actions });
const commandBody = z
  .object({
    volume: z.number().int().min(0).max(100).optional(),
    index: z.number().int().min(1).max(500).optional(),
    enabled: z.boolean().optional(),
    mode: z.enum(musicRepeatModes).optional(),
    channelId: id.optional(),
    trackId: z.string().uuid().optional(),
  })
  .strict();

function publicState(
  session: Awaited<ReturnType<PostgresMusicSessionManager["read"]>>,
) {
  const durations = session.queue.map((track) => track.duration);
  return {
    ...session,
    queue: session.queue.slice(0, 10),
    queueTotal: session.queue.length,
    queueDuration: durations.every((value) => value !== null)
      ? durations.reduce<number>((sum, value) => sum + (value || 0), 0)
      : null,
  };
}

async function metric(db: DB, serverId: string, column: "provider_errors") {
  await db.query(
    `INSERT INTO music_metrics(server_id,${column}) VALUES($1,1)
     ON CONFLICT(server_id) DO UPDATE SET ${column}=music_metrics.${column}+1,updated_at=now()`,
    [serverId],
  );
}

export async function musicRoutes(
  app: FastifyInstance,
  providers: MusicProviderService = musicProviders,
) {
  app.get("/api/servers/:id/music", (req) =>
    transaction(req.identity, async (db) => {
      const { id: serverId } = params.parse(req.params);
      return publicState(await musicSessions.read(db, serverId));
    }),
  );

  app.get("/api/servers/:id/music/queue", (req) =>
    transaction(req.identity, async (db) => {
      const { id: serverId } = params.parse(req.params);
      const query = queueQuery.parse(req.query);
      return musicSessions.page(
        await musicSessions.read(db, serverId),
        query.offset,
        query.limit,
      );
    }),
  );

  app.get("/api/servers/:id/music/settings", (req) =>
    transaction(req.identity, async (db) => {
      const { id: serverId } = params.parse(req.params);
      return musicSessions.settings(db, serverId);
    }),
  );

  app.patch("/api/servers/:id/music/settings", (req) =>
    transaction(req.identity, async (db) => {
      const { id: serverId } = params.parse(req.params);
      const input = z
        .object({
          defaultVolume: z.number().int().min(0).max(100).optional(),
          allowMemberSkip: z.boolean().optional(),
          allowMemberVolume: z.boolean().optional(),
          autoplayEnabled: z.boolean().optional(),
          idleDisconnectSeconds: z.number().int().min(30).max(3600).optional(),
        })
        .strict()
        .parse(req.body);
      requireThat(
        Object.keys(input).length > 0,
        400,
        "Choose a music setting to update.",
      );
      await permit(db, serverId, "MANAGE_SERVER");
      await db.query(
        `UPDATE music_settings SET
          default_volume=coalesce($2,default_volume),
          allow_member_skip=coalesce($3,allow_member_skip),
          allow_member_volume=coalesce($4,allow_member_volume),
          autoplay_enabled=coalesce($5,autoplay_enabled),
          idle_disconnect_seconds=coalesce($6,idle_disconnect_seconds),updated_at=now()
         WHERE server_id=$1`,
        [
          serverId,
          input.defaultVolume ?? null,
          input.allowMemberSkip ?? null,
          input.allowMemberVolume ?? null,
          input.autoplayEnabled ?? null,
          input.idleDisconnectSeconds ?? null,
        ],
      );
      await audit(
        db,
        req.identity.userId,
        "music.settings.updated",
        serverId,
        serverId,
      );
      return musicSessions.settings(db, serverId);
    }),
  );

  app.get("/api/servers/:id/music/metrics", (req) =>
    transaction(req.identity, async (db) => {
      const { id: serverId } = params.parse(req.params);
      await permit(db, serverId, "MANAGE_SERVER");
      const result = await db.query(
        `SELECT
          count(*) FILTER(WHERE s.current_track IS NOT NULL) AS "activeMusicSessions",
          count(*) FILTER(WHERE s.bot_connected) AS "activeMusicBots",
          coalesce(sum(jsonb_array_length(s.queue)),0) AS "queuedTracks",
          max(m.tracks_played) AS "tracksPlayed",
          max(m.playback_errors) AS "playbackErrors",
          max(m.provider_errors) AS "providerErrors"
         FROM music_sessions s JOIN music_metrics m USING(server_id) WHERE s.server_id=$1`,
        [serverId],
      );
      return result.rows[0];
    }),
  );

  app.post("/api/servers/:id/music/play", async (req) => {
    const { id: serverId } = params.parse(req.params);
    const input = z
      .object({ input: z.string().trim().min(1).max(2048) })
      .strict()
      .parse(req.body);
    await throttle(`music-play:${serverId}`, req.identity.userId, 12, 60);
    const voiceChannelId = await transaction(req.identity, (db) =>
      musicSessions.preparePlay(db, serverId, req.identity.userId),
    );
    let tracks;
    try {
      tracks = await providers.resolve(input.input, req.identity.userId);
    } catch (error) {
      await transaction(req.identity, async (db) => {
        await metric(db, serverId, "provider_errors");
      });
      const e = error as Error & { code?: string };
      app.log.warn(
        {
          kind: "music",
          provider: providers.detect(input.input)?.id || "search",
          serverId,
          errorCode: e.code || e.name,
          timestamp: new Date().toISOString(),
        },
        "music provider request failed",
      );
      throw error;
    }
    await throttle(
      `music-tracks:${serverId}`,
      req.identity.userId,
      Math.max(20, tracks.length),
      60,
    );
    return transaction(req.identity, async (db) => {
      const session = await musicSessions.enqueue(
        db,
        serverId,
        req.identity.userId,
        voiceChannelId,
        tracks,
      );
      await audit(
        db,
        req.identity.userId,
        "music.track.added",
        tracks[0]!.id,
        serverId,
        {
          provider: tracks[0]!.provider,
          count: tracks.length,
        },
      );
      return { session: publicState(session), added: tracks };
    });
  });

  app.post("/api/servers/:id/music/commands/:action", async (req) => {
    const { id: serverId, action } = commandParams.parse(req.params);
    const input = commandBody.parse(req.body);
    await throttle(`music-command:${serverId}`, req.identity.userId, 30, 60);
    return transaction(req.identity, async (db) => {
      const manager = musicSessions;
      let session;
      if (action === "pause") session = await manager.pause(db, serverId);
      else if (action === "resume")
        session = await manager.resume(db, serverId);
      else if (action === "skip" || action === "pass")
        session = await manager.skip(db, serverId);
      else if (action === "stop") session = await manager.stop(db, serverId);
      else if (action === "volume") {
        requireThat(
          input.volume !== undefined,
          400,
          "Choose a volume from 0 to 100.",
        );
        session = await manager.volume(db, serverId, input.volume!);
      } else if (action === "remove") {
        requireThat(input.index !== undefined, 400, "Choose a queue position.");
        session = await manager.remove(db, serverId, input.index! - 1);
      } else if (action === "clear")
        session = await manager.clear(db, serverId);
      else if (action === "shuffle")
        session = await manager.shuffle(db, serverId, input.enabled);
      else if (action === "repeat")
        session = await manager.repeat(db, serverId, input.mode);
      else if (action === "ended") {
        requireThat(input.trackId, 400, "Choose the completed track.");
        session = await manager.ended(
          db,
          serverId,
          req.identity.userId,
          input.trackId!,
        );
      } else
        session = await manager.move(
          db,
          serverId,
          req.identity.userId,
          input.channelId,
        );
      await audit(
        db,
        req.identity.userId,
        `music.${action}`,
        serverId,
        serverId,
      );
      return publicState(session);
    });
  });
}
