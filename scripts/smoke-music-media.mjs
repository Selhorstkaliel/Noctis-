import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import {
  AccessToken,
  RoomServiceClient,
  TrackSource,
} from "livekit-server-sdk";
import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  Room,
  TrackPublishOptions,
  TrackSource as RtcTrackSource,
  dispose,
} from "@livekit/rtc-node";

dotenv.config({ path: existsSync(".env.test") ? ".env.test" : ".env" });
const url = process.env.LIVEKIT_INTERNAL_URL;
const key = process.env.LIVEKIT_API_KEY;
const secret = process.env.LIVEKIT_API_SECRET;
assert(url && key && secret, "LiveKit test configuration is required.");
const ffmpeg = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-version"], {
  windowsHide: true,
  stdio: "ignore",
});
assert.equal(ffmpeg.status, 0, "FFmpeg is required for Noctis Music playback.");

const service = new RoomServiceClient(url, key, secret);
const roomName = `noctis-music-smoke-${randomUUID()}`;
const identity = `music:smoke-${randomUUID()}`;
const room = new Room();
let source;
let track;
try {
  await service.createRoom({
    name: roomName,
    maxParticipants: 0,
    emptyTimeout: 30,
  });
  const access = new AccessToken(key, secret, {
    identity,
    name: "Noctis Music Smoke",
    ttl: 60,
  });
  access.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canPublishSources: [TrackSource.MICROPHONE],
    canSubscribe: false,
  });
  await room.connect(url, await access.toJwt(), { autoSubscribe: false });
  source = new AudioSource(48_000, 2, 200);
  track = LocalAudioTrack.createAudioTrack("Noctis Music", source);
  const options = new TrackPublishOptions();
  options.source = RtcTrackSource.SOURCE_MICROPHONE;
  await room.localParticipant.publishTrack(track, options);
  for (let frame = 0; frame < 10; frame++) {
    const samples = new Int16Array(960 * 2);
    for (let sample = 0; sample < 960; sample++) {
      const value = Math.round(
        Math.sin(((frame * 960 + sample) * Math.PI * 2 * 220) / 48_000) * 1200,
      );
      samples[sample * 2] = value;
      samples[sample * 2 + 1] = value;
    }
    await source.captureFrame(new AudioFrame(samples, 48_000, 2, 960));
  }
  await source.waitForPlayout();
  const participants = await service.listParticipants(roomName);
  assert(participants.some((participant) => participant.identity === identity));
  console.log(
    "Noctis Music media smoke passed: FFmpeg ready and LiveKit audio published.",
  );
} finally {
  await track?.close().catch(() => {});
  await source?.close().catch(() => {});
  await room.disconnect().catch(() => {});
  await service.deleteRoom(roomName).catch(() => {});
  await dispose();
}
