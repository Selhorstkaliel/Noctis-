import type { DB } from "../db.js";
import { musicChanged } from "../db.js";
import type {
  MusicEvent,
  MusicQueuePage,
  MusicRepeatMode,
  MusicSession,
  MusicSettings,
  MusicTrack,
} from "../../shared/music.js";
import { config } from "../config.js";
import { member, permit, type Permission, channel } from "../authorization.js";
import { requireThat } from "../errors.js";
import { MusicQueue, validateVolume } from "./queue.js";

type SessionRow = {
  server_id: string;
  voice_channel_id: string | null;
  requested_by: string | null;
  current_track: MusicTrack | null;
  queue: MusicTrack[];
  previous_tracks: MusicTrack[];
  playback_state: MusicSession["playbackState"];
  volume: number;
  repeat_mode: MusicRepeatMode;
  shuffle: boolean;
  started_at: Date | string | null;
  paused_at: Date | string | null;
  position_seconds: number;
  bot_connected: boolean;
  revision: string | number;
};

const iso = (value: Date | string | null) =>
  value ? new Date(value).toISOString() : null;

export function sessionFromRow(row: SessionRow): MusicSession {
  return {
    serverId: row.server_id,
    voiceChannelId: row.voice_channel_id,
    requestedBy: row.requested_by,
    currentTrack: row.current_track,
    queue: row.queue || [],
    previousTracks: row.previous_tracks || [],
    playbackState: row.playback_state,
    volume: Number(row.volume),
    repeatMode: row.repeat_mode,
    shuffle: row.shuffle,
    startedAt: iso(row.started_at),
    pausedAt: iso(row.paused_at),
    position: Number(row.position_seconds),
    botConnected: row.bot_connected,
    revision: Number(row.revision),
  };
}

export function playbackPosition(session: MusicSession, now = Date.now()) {
  if (
    session.playbackState !== "PLAYING" ||
    !session.startedAt ||
    !session.currentTrack
  )
    return session.position;
  const elapsed = Math.max(
    0,
    (now - new Date(session.startedAt).getTime()) / 1000,
  );
  return session.currentTrack.duration
    ? Math.min(session.position + elapsed, session.currentTrack.duration)
    : session.position + elapsed;
}

async function lock(db: DB, serverId: string) {
  await member(db, serverId);
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('music:'||$1,0))",
    [serverId],
  );
  await db.query(
    "INSERT INTO music_sessions(server_id,volume) SELECT server_id,default_volume FROM music_settings WHERE server_id=$1 ON CONFLICT DO NOTHING",
    [serverId],
  );
  const result = await db.query(
    "SELECT * FROM music_sessions WHERE server_id=$1",
    [serverId],
  );
  requireThat(result.rowCount, 404, "This music session is unavailable.");
  return sessionFromRow(result.rows[0]);
}

async function save(
  db: DB,
  session: MusicSession,
  events: MusicEvent[],
  idleSince: Date | null | undefined = undefined,
) {
  const result = await db.query(
    `UPDATE music_sessions SET
      voice_channel_id=$2,requested_by=$3,current_track=$4::jsonb,queue=$5::jsonb,
      previous_tracks=$6::jsonb,playback_state=$7,volume=$8,repeat_mode=$9,
      shuffle=$10,started_at=$11,paused_at=$12,position_seconds=$13,
      bot_connected=$14,revision=revision+1,updated_at=now(),
      idle_since=CASE WHEN $15::boolean THEN $16 ELSE idle_since END
     WHERE server_id=$1 RETURNING revision`,
    [
      session.serverId,
      session.voiceChannelId,
      session.requestedBy,
      session.currentTrack ? JSON.stringify(session.currentTrack) : null,
      JSON.stringify(session.queue),
      JSON.stringify(session.previousTracks.slice(-25)),
      session.playbackState,
      session.volume,
      session.repeatMode,
      session.shuffle,
      session.startedAt,
      session.pausedAt,
      session.position,
      session.botConnected,
      idleSince !== undefined,
      idleSince,
    ],
  );
  session.revision = Number(result.rows[0].revision);
  for (const event of events)
    await musicChanged(db, session.serverId, event, session.revision);
  return session;
}

async function has(db: DB, serverId: string, permission: Permission) {
  return !!(
    await db.query("SELECT noctis.has_permission($1,$2) AS allowed", [
      serverId,
      permission,
    ])
  ).rows[0].allowed;
}

async function authorize(
  db: DB,
  serverId: string,
  permission: Permission,
  setting?: "allow_member_skip" | "allow_member_volume",
) {
  await member(db, serverId);
  if (await has(db, serverId, permission)) return;
  if (setting) {
    const result = await db.query(
      `SELECT ${setting} AS allowed FROM music_settings WHERE server_id=$1`,
      [serverId],
    );
    if (result.rows[0]?.allowed) return;
  }
  await permit(db, serverId, permission);
}

async function userVoice(db: DB, serverId: string, userId: string) {
  const result = await db.query(
    `SELECT v.channel_id FROM voice_participants v
     JOIN channels c ON c.id=v.channel_id
     WHERE v.user_id=$1 AND c.server_id=$2 AND c.kind='voice'
       AND v.updated_at>now()-interval '2 minutes'
     ORDER BY v.updated_at DESC LIMIT 1`,
    [userId, serverId],
  );
  requireThat(
    result.rowCount,
    409,
    "Join a voice channel before using Noctis Music.",
  );
  return String(result.rows[0].channel_id);
}

export class PostgresMusicSessionManager {
  async read(db: DB, serverId: string) {
    await member(db, serverId);
    const result = await db.query(
      "SELECT * FROM music_sessions WHERE server_id=$1",
      [serverId],
    );
    if (result.rowCount) return sessionFromRow(result.rows[0]);
    return lock(db, serverId);
  }

  async preparePlay(db: DB, serverId: string, userId: string) {
    await authorize(db, serverId, "MUSIC_PLAY");
    return userVoice(db, serverId, userId);
  }

  async enqueue(
    db: DB,
    serverId: string,
    userId: string,
    voiceChannelId: string,
    tracks: MusicTrack[],
  ) {
    await authorize(db, serverId, "MUSIC_PLAY");
    requireThat((await userVoice(db, serverId, userId)) === voiceChannelId);
    const session = await lock(db, serverId);
    if (session.voiceChannelId && session.voiceChannelId !== voiceChannelId)
      await authorize(db, serverId, "MUSIC_MOVE");
    const queue = new MusicQueue(session.queue, config.MUSIC_MAX_QUEUE);
    queue.enqueue(tracks);
    if (session.shuffle) queue.shuffle();
    session.voiceChannelId = voiceChannelId;
    session.queue = queue.list();
    if (!session.currentTrack) {
      session.currentTrack = queue.dequeue();
      session.queue = queue.list();
      session.requestedBy = session.currentTrack?.requestedBy || userId;
      session.playbackState = "LOADING";
      session.position = 0;
      session.startedAt = null;
      session.pausedAt = null;
    }
    return save(db, session, ["music:trackAdded", "music:queueUpdated"], null);
  }

  async pause(db: DB, serverId: string) {
    await authorize(db, serverId, "MUSIC_PAUSE");
    const session = await lock(db, serverId);
    requireThat(
      session.currentTrack && session.playbackState === "PLAYING",
      409,
      "No track is currently playing.",
    );
    session.position = playbackPosition(session);
    session.playbackState = "PAUSED";
    session.pausedAt = new Date().toISOString();
    return save(db, session, ["music:paused"]);
  }

  async resume(db: DB, serverId: string) {
    await authorize(db, serverId, "MUSIC_PAUSE");
    const session = await lock(db, serverId);
    requireThat(
      session.currentTrack && session.playbackState === "PAUSED",
      409,
      "No paused track is available.",
    );
    session.playbackState = "PLAYING";
    session.startedAt = new Date().toISOString();
    session.pausedAt = null;
    return save(db, session, ["music:resumed"]);
  }

  async skip(db: DB, serverId: string) {
    await authorize(db, serverId, "MUSIC_SKIP", "allow_member_skip");
    const session = await lock(db, serverId);
    requireThat(session.currentTrack, 409, "The queue is already empty.");
    const previous = session.currentTrack;
    const queue = new MusicQueue(session.queue, config.MUSIC_MAX_QUEUE);
    session.currentTrack = queue.next(
      previous,
      session.repeatMode === "ALL" ? "ALL" : "OFF",
    );
    session.queue = queue.list();
    session.previousTracks = [...session.previousTracks, previous].slice(-25);
    session.requestedBy = session.currentTrack?.requestedBy || null;
    session.playbackState = session.currentTrack ? "LOADING" : "IDLE";
    session.position = 0;
    session.startedAt = null;
    session.pausedAt = null;
    return save(
      db,
      session,
      ["music:skipped", "music:queueUpdated"],
      session.currentTrack ? null : new Date(),
    );
  }

  async ended(db: DB, serverId: string, userId: string, trackId: string) {
    await member(db, serverId);
    const session = await lock(db, serverId);
    requireThat(
      session.currentTrack?.id === trackId &&
        session.currentTrack.playbackMode === "embed",
      409,
      "That track is no longer playing.",
    );
    if (session.currentTrack.requestedBy !== userId)
      await authorize(db, serverId, "MUSIC_SKIP", "allow_member_skip");
    const autoplay = (
      await db.query(
        "SELECT autoplay_enabled FROM music_settings WHERE server_id=$1",
        [serverId],
      )
    ).rows[0]?.autoplay_enabled;
    const previous = session.currentTrack;
    const queue = new MusicQueue(session.queue, config.MUSIC_MAX_QUEUE);
    session.currentTrack = autoplay
      ? queue.next(previous, session.repeatMode)
      : null;
    session.queue = queue.list();
    session.previousTracks = [...session.previousTracks, previous].slice(-25);
    session.requestedBy = session.currentTrack?.requestedBy || null;
    session.playbackState = session.currentTrack ? "LOADING" : "IDLE";
    session.position = 0;
    session.startedAt = null;
    session.pausedAt = null;
    return save(
      db,
      session,
      ["music:trackEnded", "music:queueUpdated"],
      session.currentTrack ? null : new Date(),
    );
  }

  async stop(db: DB, serverId: string) {
    await authorize(db, serverId, "MUSIC_STOP");
    const session = await lock(db, serverId);
    const wasConnected = session.botConnected;
    Object.assign(session, {
      voiceChannelId: null,
      requestedBy: null,
      currentTrack: null,
      queue: [],
      previousTracks: [],
      playbackState: "STOPPED",
      repeatMode: "OFF",
      shuffle: false,
      startedAt: null,
      pausedAt: null,
      position: 0,
      botConnected: false,
    });
    return save(
      db,
      session,
      [
        "music:stopped",
        ...(wasConnected ? (["music:disconnected"] as const) : []),
        "music:queueUpdated",
      ],
      null,
    );
  }

  async volume(db: DB, serverId: string, value: number) {
    await authorize(db, serverId, "MUSIC_VOLUME", "allow_member_volume");
    const session = await lock(db, serverId);
    session.volume = validateVolume(value);
    return save(db, session, ["music:volumeChanged"]);
  }

  async remove(db: DB, serverId: string, index: number) {
    await authorize(db, serverId, "MUSIC_QUEUE_MANAGE");
    const session = await lock(db, serverId);
    const queue = new MusicQueue(session.queue, config.MUSIC_MAX_QUEUE);
    queue.remove(index);
    session.queue = queue.list();
    return save(db, session, ["music:queueUpdated"]);
  }

  async clear(db: DB, serverId: string) {
    await authorize(db, serverId, "MUSIC_QUEUE_MANAGE");
    const session = await lock(db, serverId);
    session.queue = [];
    return save(db, session, ["music:queueUpdated"]);
  }

  async shuffle(db: DB, serverId: string, enabled?: boolean) {
    await authorize(db, serverId, "MUSIC_QUEUE_MANAGE");
    const session = await lock(db, serverId);
    session.shuffle = enabled ?? !session.shuffle;
    if (session.shuffle) {
      const queue = new MusicQueue(session.queue, config.MUSIC_MAX_QUEUE);
      queue.shuffle();
      session.queue = queue.list();
    }
    return save(db, session, ["music:queueUpdated"]);
  }

  async repeat(db: DB, serverId: string, mode?: MusicRepeatMode) {
    await authorize(db, serverId, "MUSIC_QUEUE_MANAGE");
    const session = await lock(db, serverId);
    const order: MusicRepeatMode[] = ["OFF", "ONE", "ALL"];
    session.repeatMode =
      mode || order[(order.indexOf(session.repeatMode) + 1) % order.length]!;
    return save(db, session, ["music:queueUpdated"]);
  }

  async move(db: DB, serverId: string, userId: string, channelId?: string) {
    await authorize(db, serverId, "MUSIC_MOVE");
    const target = channelId || (await userVoice(db, serverId, userId));
    const voice = await channel(db, target, "CONNECT_VOICE");
    requireThat(voice.server_id === serverId && voice.kind === "voice", 404);
    const session = await lock(db, serverId);
    requireThat(
      session.currentTrack || session.botConnected,
      409,
      "No Music Bot is active.",
    );
    session.voiceChannelId = target;
    session.playbackState = session.currentTrack ? "LOADING" : "IDLE";
    session.startedAt = null;
    return save(db, session, ["music:disconnected", "music:queueUpdated"]);
  }

  page(session: MusicSession, offset: number, limit: number): MusicQueuePage {
    const durations = session.queue.map((track) => track.duration);
    return {
      currentTrack: session.currentTrack,
      items: session.queue.slice(offset, offset + limit),
      offset,
      limit,
      total: session.queue.length,
      totalDuration: durations.every((value) => value !== null)
        ? durations.reduce<number>((sum, value) => sum + (value || 0), 0)
        : null,
    };
  }

  async settings(db: DB, serverId: string): Promise<MusicSettings> {
    await member(db, serverId);
    const row = (
      await db.query(
        'SELECT default_volume AS "defaultVolume",allow_member_skip AS "allowMemberSkip",allow_member_volume AS "allowMemberVolume",autoplay_enabled AS "autoplayEnabled",idle_disconnect_seconds AS "idleDisconnectSeconds" FROM music_settings WHERE server_id=$1',
        [serverId],
      )
    ).rows[0];
    requireThat(row, 404);
    return row;
  }
}

export const musicSessions = new PostgresMusicSessionManager();

/** In-memory implementation kept behind the same server-keyed contract for unit tests and small deployments. */
export class MemoryMusicSessionManager {
  readonly sessions = new Map<string, MusicSession>();
  get(serverId: string, volume = 50) {
    let session = this.sessions.get(serverId);
    if (!session) {
      session = {
        serverId,
        voiceChannelId: null,
        requestedBy: null,
        currentTrack: null,
        queue: [],
        previousTracks: [],
        playbackState: "IDLE",
        volume,
        repeatMode: "OFF",
        shuffle: false,
        startedAt: null,
        pausedAt: null,
        position: 0,
        botConnected: false,
        revision: 0,
      };
      this.sessions.set(serverId, session);
    }
    return session;
  }
}
