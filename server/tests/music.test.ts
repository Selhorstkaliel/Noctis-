import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { MusicTrack } from "../../shared/music.js";
import { MusicQueue, validateVolume } from "../music/queue.js";
import {
  DirectAudioProvider,
  MusicProviderService,
  SoundCloudProvider,
  SpotifyProvider,
  YouTubeProvider,
  type MusicProvider,
} from "../music/providers.js";
import { isPrivateAddress, parsePublicAudioUrl } from "../music/url.js";
import { MemoryMusicSessionManager } from "../music/sessions.js";

const track = (id: string): MusicTrack => ({
  id,
  title: `Track ${id}`,
  artist: "Noctis Tests",
  url: `https://audio.example/${id}.mp3`,
  provider: "audio",
  thumbnail: null,
  duration: 120,
  requestedBy: "user",
  requestedAt: new Date(0).toISOString(),
});

test("queue operations are ordered, bounded, removable, and clearable", () => {
  const queue = new MusicQueue([], 3);
  queue.enqueue([track("a"), track("b")]);
  assert.equal(queue.dequeue()?.id, "a");
  queue.enqueue([track("c"), track("d")]);
  assert.throws(() => queue.enqueue([track("e")]));
  assert.equal(queue.remove(1).id, "c");
  assert.deepEqual(
    queue.list().map((item) => item.id),
    ["b", "d"],
  );
  assert.equal(queue.clear(), 2);
  assert.deepEqual(queue.list(), []);
});

test("repeat, previous, shuffle, skip, and stop primitives remain deterministic", () => {
  const queue = new MusicQueue([track("b"), track("c")]);
  assert.equal(queue.next(track("a"), "ONE")?.id, "a");
  assert.equal(queue.next(track("a"), "ALL")?.id, "b");
  assert.deepEqual(
    queue.list().map((item) => item.id),
    ["c", "a"],
  );
  assert.equal(queue.previous([track("x"), track("y")])?.id, "y");
  queue.shuffle(() => 0);
  assert.deepEqual(
    queue.list().map((item) => item.id),
    ["a", "c"],
  );
  queue.clear();
  assert.equal(queue.next(track("a"), "OFF"), null);
});

test("volume accepts only whole percentages from zero through one hundred", () => {
  assert.equal(validateVolume(0), 0);
  assert.equal(validateVolume(100), 100);
  for (const invalid of [-1, 101, 10.5, Number.NaN])
    assert.throws(() => validateVolume(invalid));
});

test("commercial providers use official embeds without exposing direct audio sources", async () => {
  const service = new MusicProviderService([
    new YouTubeProvider(),
    new SpotifyProvider(),
    new SoundCloudProvider(),
    new DirectAudioProvider(),
  ]);
  assert.equal(service.detect("https://youtu.be/abc")?.id, "youtube");
  assert.equal(
    service.detect("https://open.spotify.com/track/abc")?.id,
    "spotify",
  );
  assert.equal(
    service.detect("https://soundcloud.com/artist/song")?.id,
    "soundcloud",
  );
  assert.equal(service.detect("file:///etc/passwd"), undefined);
  assert.equal(
    await new SpotifyProvider().getPlayableSource({
      title: "Found",
      artist: "Artist",
      url: "https://open.spotify.com/track/abc",
      provider: "spotify",
      thumbnail: null,
      duration: null,
    }),
    null,
  );
  const official: MusicProvider = {
    id: "youtube",
    canHandle: (input) => input === "https://youtu.be/official",
    resolve: async () => [
      {
        title: "Official stream",
        artist: "Creator",
        url: "https://youtu.be/official",
        provider: "youtube",
        thumbnail: null,
        duration: null,
        playbackMode: "embed",
      },
    ],
    search: async () => [],
    getMetadata: async () => [],
    getPlayableSource: async () => null,
  };
  const [track] = await new MusicProviderService([official]).resolve(
    "https://youtu.be/official",
    "alex",
  );
  assert.equal(track?.playbackMode, "embed");
});

test("URL validation rejects local, private, metadata, non-http, and unlisted destinations", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "fd00::1",
  ])
    assert.equal(isPrivateAddress(address), true, address);
  const allowed = new Set(["cdn.example.com"]);
  assert.equal(
    parsePublicAudioUrl("https://cdn.example.com/a.mp3", allowed).hostname,
    "cdn.example.com",
  );
  for (const input of [
    "http://127.0.0.1/a.mp3",
    "http://169.254.169.254/latest/meta-data",
    "file:///tmp/music.mp3",
    "ftp://cdn.example.com/a.mp3",
    "javascript:alert(1)",
    "https://evil.example/a.mp3",
    "https://user:pass@cdn.example.com/a.mp3",
  ])
    assert.throws(() => parsePublicAudioUrl(input, allowed), input);
});

test("session manager never shares queue, volume, or player state across servers", () => {
  const manager = new MemoryMusicSessionManager();
  const a = manager.get("server-a");
  const b = manager.get("server-b");
  a.queue.push(track("a"));
  a.volume = 25;
  a.playbackState = "PLAYING";
  b.queue.push(track("b"));
  b.volume = 75;
  b.playbackState = "PAUSED";
  assert.notStrictEqual(a.queue, b.queue);
  assert.notDeepEqual(a.queue, b.queue);
  assert.notEqual(a.volume, b.volume);
  assert.notEqual(a.playbackState, b.playbackState);
});

test("provider registry accepts an injected licensed search adapter", async () => {
  const fake: MusicProvider = {
    id: "audio",
    canHandle: () => false,
    resolve: async () => [],
    search: async (query) => [
      {
        title: query,
        artist: "Licensed test catalog",
        url: "https://licensed.example/song.mp3",
        provider: "audio",
        thumbnail: null,
        duration: 60,
      },
    ],
    getMetadata: async () => [],
    getPlayableSource: async (value) => value.url,
  };
  const [resolved] = await new MusicProviderService([fake]).resolve(
    "Night drive",
    "member-a",
  );
  assert.equal(resolved.title, "Night drive");
  assert.equal(resolved.requestedBy, "member-a");
});
