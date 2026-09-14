import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Transform } from "node:stream";
import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  Room,
  TrackPublishOptions,
  TrackSource as RtcTrackSource,
  dispose,
} from "@livekit/rtc-node";
import { AccessToken, TrackSource } from "livekit-server-sdk";
import type { MusicSession, MusicTrack } from "../../shared/music.js";
import { config } from "../config.js";
import { workerPool, musicChanged, type DB } from "../db.js";
import { mediaRoom, prepareMediaRoom } from "../media.js";
import { MusicQueue } from "./queue.js";
import { openAudioStream } from "./url.js";
import { sessionFromRow } from "./sessions.js";

const sampleRate = 48_000;
const channels = 2;
const samplesPerChannel = 960;
const frameBytes = samplesPerChannel * channels * 2;
const workerId = `music-worker:${randomUUID()}`;

async function botToken(serverId: string, channelId: string) {
  const token = new AccessToken(
    config.LIVEKIT_API_KEY,
    config.LIVEKIT_API_SECRET,
    {
      identity: `music:${serverId}`,
      name: "Noctis Music",
      ttl: 300,
    },
  );
  token.addGrant({
    roomJoin: true,
    room: mediaRoom(channelId),
    canPublish: true,
    canPublishSources: [TrackSource.MICROPHONE],
    canSubscribe: false,
    canPublishData: false,
  });
  return token.toJwt();
}

async function workerTransaction<T>(fn: (db: DB) => Promise<T>) {
  const db = await workerPool.connect();
  try {
    await db.query("BEGIN");
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

async function markConnected(serverId: string, channelId: string) {
  await workerTransaction(async (db) => {
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('music:'||$1,0))",
      [serverId],
    );
    const result = await db.query(
      "UPDATE music_sessions SET bot_connected=true,revision=revision+1,updated_at=now() WHERE server_id=$1 AND voice_channel_id=$2 AND claimed_by=$3 AND NOT bot_connected RETURNING revision",
      [serverId, channelId, workerId],
    );
    if (result.rowCount)
      await musicChanged(
        db,
        serverId,
        "music:connected",
        Number(result.rows[0].revision),
      );
  });
}

async function markStarted(serverId: string, trackId: string) {
  await workerTransaction(async (db) => {
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('music:'||$1,0))",
      [serverId],
    );
    const result = await db.query(
      `UPDATE music_sessions SET playback_state='PLAYING',started_at=now(),paused_at=NULL,
       revision=revision+1,updated_at=now()
       WHERE server_id=$1 AND current_track->>'id'=$2 AND claimed_by=$3
         AND playback_state='LOADING' RETURNING revision`,
      [serverId, trackId, workerId],
    );
    if (result.rowCount)
      await musicChanged(
        db,
        serverId,
        "music:trackStarted",
        Number(result.rows[0].revision),
      );
  });
}

async function markEmbedStarted(serverId: string, trackId: string) {
  await workerTransaction(async (db) => {
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('music:'||$1,0))",
      [serverId],
    );
    const result = await db.query(
      `UPDATE music_sessions SET playback_state='PLAYING',started_at=now(),paused_at=NULL,
       bot_connected=false,revision=revision+1,updated_at=now()
       WHERE server_id=$1 AND current_track->>'id'=$2 AND claimed_by=$3
         AND playback_state='LOADING' RETURNING revision`,
      [serverId, trackId, workerId],
    );
    if (!result.rowCount) return;
    const revision = Number(result.rows[0].revision);
    await musicChanged(db, serverId, "music:trackStarted", revision);
    await musicChanged(db, serverId, "music:disconnected", revision);
  });
}

async function finishTrack(serverId: string, trackId: string, failed = false) {
  await workerTransaction(async (db) => {
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('music:'||$1,0))",
      [serverId],
    );
    const result = await db.query(
      "SELECT s.*,x.autoplay_enabled FROM music_sessions s JOIN music_settings x USING(server_id) WHERE s.server_id=$1 AND s.claimed_by=$2",
      [serverId, workerId],
    );
    if (!result.rowCount) return;
    const session = sessionFromRow(result.rows[0]);
    if (session.currentTrack?.id !== trackId) return;
    const previous = session.currentTrack;
    const queue = new MusicQueue(session.queue, config.MUSIC_MAX_QUEUE);
    session.currentTrack = failed
      ? queue.dequeue()
      : result.rows[0].autoplay_enabled
        ? queue.next(previous, session.repeatMode)
        : null;
    session.queue = queue.list();
    session.previousTracks = [...session.previousTracks, previous].slice(-25);
    session.requestedBy = session.currentTrack?.requestedBy || null;
    session.playbackState = session.currentTrack
      ? "LOADING"
      : failed
        ? "ERROR"
        : "IDLE";
    session.position = 0;
    session.startedAt = null;
    session.pausedAt = null;
    const updated = await db.query(
      `UPDATE music_sessions SET current_track=$2::jsonb,queue=$3::jsonb,
       previous_tracks=$4::jsonb,requested_by=$5,playback_state=$6,
       position_seconds=0,started_at=NULL,paused_at=NULL,
       idle_since=CASE WHEN $2::jsonb IS NULL THEN now() ELSE NULL END,
       revision=revision+1,updated_at=now() WHERE server_id=$1 RETURNING revision`,
      [
        serverId,
        session.currentTrack ? JSON.stringify(session.currentTrack) : null,
        JSON.stringify(session.queue),
        JSON.stringify(session.previousTracks),
        session.requestedBy,
        session.playbackState,
      ],
    );
    await db.query(
      `INSERT INTO music_metrics(server_id,tracks_played,playback_errors)
       VALUES($1,$2,$3) ON CONFLICT(server_id) DO UPDATE SET
       tracks_played=music_metrics.tracks_played+$2,
       playback_errors=music_metrics.playback_errors+$3,updated_at=now()`,
      [serverId, failed ? 0 : 1, failed ? 1 : 0],
    );
    const revision = Number(updated.rows[0].revision);
    await musicChanged(
      db,
      serverId,
      failed ? "music:error" : "music:trackEnded",
      revision,
    );
    await musicChanged(db, serverId, "music:queueUpdated", revision);
  });
}

class MusicBotController {
  private room?: Room;
  private source?: AudioSource;
  private track?: LocalAudioTrack;
  private process?: ChildProcessWithoutNullStreams;
  private run = 0;
  private channelId = "";
  private trackId = "";
  private paused = false;
  volume = 50;

  constructor(readonly serverId: string) {}

  async sync(session: MusicSession) {
    this.volume = session.volume;
    if (!session.voiceChannelId || !session.currentTrack) {
      if (session.playbackState === "STOPPED" || !session.voiceChannelId)
        await this.close();
      else this.stopDecoder();
      return;
    }
    if (session.currentTrack.playbackMode === "embed") {
      if (this.room || this.process) await this.close();
      if (session.playbackState === "LOADING")
        await markEmbedStarted(this.serverId, session.currentTrack.id);
      return;
    }
    if (!this.room || this.channelId !== session.voiceChannelId)
      await this.connect(session.voiceChannelId);
    if (session.playbackState === "PAUSED") {
      this.paused = true;
      this.stopDecoder();
      return;
    }
    const shouldPlay = ["LOADING", "PLAYING"].includes(session.playbackState);
    if (
      shouldPlay &&
      (!this.process || this.trackId !== session.currentTrack.id || this.paused)
    ) {
      this.paused = false;
      this.startDecoder(session.currentTrack, session.position);
    }
  }

  private async connect(channelId: string) {
    await this.close();
    await prepareMediaRoom(channelId);
    const room = new Room();
    await room.connect(
      config.LIVEKIT_INTERNAL_URL,
      await botToken(this.serverId, channelId),
      {
        autoSubscribe: false,
        dynacast: false,
      },
    );
    const source = new AudioSource(sampleRate, channels, 200);
    const track = LocalAudioTrack.createAudioTrack("Noctis Music", source);
    const options = new TrackPublishOptions();
    options.source = RtcTrackSource.SOURCE_MICROPHONE;
    await room.localParticipant!.publishTrack(track, options);
    this.room = room;
    this.source = source;
    this.track = track;
    this.channelId = channelId;
    await markConnected(this.serverId, channelId);
  }

  private startDecoder(track: MusicTrack, position: number) {
    this.stopDecoder();
    const generation = ++this.run;
    this.trackId = track.id;
    void this.play(track, position, generation).catch(async (error) => {
      if (generation !== this.run) return;
      this.process = undefined;
      console.error(
        JSON.stringify({
          kind: "music",
          event: "playback_failed",
          provider: track.provider,
          serverId: this.serverId,
          track: track.id,
          errorCode: (error as { code?: string }).code || (error as Error).name,
          stack:
            config.NODE_ENV === "development"
              ? (error as Error).stack
              : undefined,
          timestamp: new Date().toISOString(),
        }),
      );
      await finishTrack(this.serverId, track.id, true);
    });
  }

  private async play(track: MusicTrack, position: number, generation: number) {
    const { response } = await openAudioStream(track.url);
    if (generation !== this.run) {
      response.destroy();
      return;
    }
    let received = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > config.MUSIC_MAX_SOURCE_BYTES)
          callback(
            Object.assign(new Error("Audio source exceeded its limit."), {
              code: "MUSIC_SOURCE_TOO_LARGE",
            }),
          );
        else callback(null, chunk);
      },
    });
    const args = [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
    ];
    if (position > 0) args.push("-ss", position.toFixed(3));
    args.push(
      "-t",
      String(config.MUSIC_MAX_TRACK_SECONDS),
      "-vn",
      "-ac",
      String(channels),
      "-ar",
      String(sampleRate),
      "-f",
      "s16le",
      "pipe:1",
    );
    const child = spawn(config.FFMPEG_PATH, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    this.process = child;
    limiter.once("error", () => {
      response.destroy();
      child.kill();
    });
    response.pipe(limiter).pipe(child.stdin);
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 8192)
        stderr += String(chunk).slice(0, 8192 - stderr.length);
    });
    const failure = new Promise<never>((_, reject) => {
      child.once("error", reject);
      limiter.once("error", reject);
      response.once("error", reject);
    });
    let pending = Buffer.alloc(0);
    let started = false;
    const frames = (async () => {
      for await (const chunk of child.stdout) {
        if (generation !== this.run) return;
        pending = Buffer.concat([pending, chunk as Buffer]);
        while (pending.length >= frameBytes) {
          const bytes = pending.subarray(0, frameBytes);
          pending = pending.subarray(frameBytes);
          const raw = new Int16Array(
            bytes.buffer,
            bytes.byteOffset,
            frameBytes / 2,
          );
          const samples = Int16Array.from(raw, (sample) =>
            Math.max(
              -32768,
              Math.min(32767, Math.round(sample * (this.volume / 100))),
            ),
          );
          if (!started) {
            started = true;
            await markStarted(this.serverId, track.id);
          }
          await this.source!.captureFrame(
            new AudioFrame(samples, sampleRate, channels, samplesPerChannel),
          );
        }
      }
    })();
    const exit = new Promise<number>((resolve) =>
      child.once("close", (code) => resolve(code || 0)),
    );
    const [, code] = await Promise.race([Promise.all([frames, exit]), failure]);
    if (generation !== this.run) return;
    this.process = undefined;
    await this.source?.waitForPlayout();
    if (code !== 0)
      throw Object.assign(
        new Error("The audio decoder could not play this source."),
        {
          code: "MUSIC_DECODER_FAILED",
          detail: stderr.slice(0, 300),
        },
      );
    await finishTrack(this.serverId, track.id);
  }

  private stopDecoder() {
    this.run++;
    this.process?.kill();
    this.process = undefined;
    this.source?.clearQueue();
  }

  async close() {
    this.stopDecoder();
    this.channelId = "";
    this.trackId = "";
    await this.track?.close().catch(() => {});
    await this.source?.close().catch(() => {});
    await this.room?.disconnect().catch(() => {});
    this.track = undefined;
    this.source = undefined;
    this.room = undefined;
  }
}

const controllers = new Map<string, MusicBotController>();

async function claimSessions() {
  return (
    await workerPool.query(
      `WITH candidates AS (
         SELECT server_id FROM music_sessions
         WHERE (current_track IS NOT NULL OR bot_connected)
           AND (claimed_by=$1 OR claim_expires_at IS NULL OR claim_expires_at<now())
         ORDER BY updated_at LIMIT 25 FOR UPDATE SKIP LOCKED
       )
       UPDATE music_sessions s SET claimed_by=$1,claim_expires_at=now()+interval '10 seconds'
       FROM candidates c WHERE s.server_id=c.server_id RETURNING s.*`,
      [workerId],
    )
  ).rows.map(sessionFromRow);
}

async function disconnectIdle() {
  const result = await workerPool.query(
    `WITH state AS (
       SELECT s.server_id,s.current_track,s.voice_channel_id,
         EXISTS(SELECT 1 FROM voice_participants v WHERE v.channel_id=s.voice_channel_id AND v.updated_at>now()-interval '2 minutes') AS occupied
       FROM music_sessions s WHERE s.claimed_by=$1 AND s.bot_connected
     )
     UPDATE music_sessions s SET
       idle_since=CASE WHEN state.current_track IS NULL OR NOT state.occupied THEN coalesce(s.idle_since,now()) ELSE NULL END
     FROM state WHERE s.server_id=state.server_id RETURNING s.server_id`,
    [workerId],
  );
  if (!result.rowCount) return;
  const expired = await workerPool.query(
    `UPDATE music_sessions s SET voice_channel_id=NULL,current_track=NULL,queue='[]',
      previous_tracks='[]',playback_state='STOPPED',position_seconds=0,started_at=NULL,
      paused_at=NULL,bot_connected=false,idle_since=NULL,revision=revision+1,updated_at=now()
     FROM music_settings x WHERE s.server_id=x.server_id AND s.claimed_by=$1
       AND s.bot_connected AND s.idle_since<now()-x.idle_disconnect_seconds*interval '1 second'
     RETURNING s.server_id,s.revision`,
    [workerId],
  );
  for (const row of expired.rows) {
    await workerPool.query("SELECT pg_notify('noctis_music',$1)", [
      JSON.stringify({
        serverId: row.server_id,
        event: "music:disconnected",
        revision: Number(row.revision),
      }),
    ]);
    await controllers.get(row.server_id)?.close();
    controllers.delete(row.server_id);
  }
}

export async function maintainMusic() {
  const sessions = await claimSessions();
  const claimed = new Set(sessions.map((session) => session.serverId));
  for (const session of sessions) {
    let controller = controllers.get(session.serverId);
    if (!controller)
      controllers.set(
        session.serverId,
        (controller = new MusicBotController(session.serverId)),
      );
    try {
      await controller.sync(session);
    } catch (error) {
      if (session.currentTrack)
        await finishTrack(session.serverId, session.currentTrack.id, true);
      else throw error;
    }
  }
  for (const [serverId, controller] of controllers) {
    if (claimed.has(serverId)) continue;
    await controller.close();
    controllers.delete(serverId);
  }
  await disconnectIdle();
}

export async function closeMusic() {
  await Promise.all(
    [...controllers.values()].map((controller) => controller.close()),
  );
  controllers.clear();
  await dispose();
}
