import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { MusicProviderId, MusicTrack } from "../../shared/music.js";
import { config } from "../config.js";
import { probeAudio } from "./url.js";

export type ResolvedTrack = Omit<
  MusicTrack,
  "id" | "requestedBy" | "requestedAt"
>;

export interface MusicProvider {
  readonly id: MusicProviderId;
  canHandle(input: string): boolean;
  resolve(input: string): Promise<ResolvedTrack[]>;
  search(query: string): Promise<ResolvedTrack[]>;
  getMetadata(input: string): Promise<ResolvedTrack[]>;
  getPlayableSource(track: ResolvedTrack): Promise<string | null>;
}

const directPlaybackMessage =
  "This track was found, but this provider does not allow direct playback in Noctis.";

function supportedUrl(input: string, hosts: string[]) {
  try {
    const url = new URL(input);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      hosts.includes(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

async function fixedJson(endpoint: string) {
  const response = await fetch(endpoint, {
    redirect: "error",
    signal: AbortSignal.timeout(config.MUSIC_FETCH_TIMEOUT_MS),
    headers: { Accept: "application/json", "User-Agent": "Noctis-Music/1.0" },
  });
  if (!response.ok)
    throw Object.assign(
      new Error("The music provider is temporarily unavailable."),
      {
        statusCode: 502,
        code: "MUSIC_PROVIDER_UNAVAILABLE",
      },
    );
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 512 * 1024)
    throw Object.assign(
      new Error("The music provider returned too much data."),
      {
        statusCode: 502,
        code: "MUSIC_PROVIDER_RESPONSE",
      },
    );
  const text = await response.text();
  if (Buffer.byteLength(text) > 512 * 1024)
    throw Object.assign(
      new Error("The music provider returned too much data."),
      {
        statusCode: 502,
        code: "MUSIC_PROVIDER_RESPONSE",
      },
    );
  return JSON.parse(text) as unknown;
}

abstract class MetadataProvider implements MusicProvider {
  abstract readonly id: MusicProviderId;
  abstract canHandle(input: string): boolean;
  abstract getMetadata(input: string): Promise<ResolvedTrack[]>;
  resolve(input: string) {
    return this.getMetadata(input);
  }
  async search(_query: string) {
    return [];
  }
  async getPlayableSource(_track: ResolvedTrack) {
    return null;
  }
}

export class YouTubeProvider extends MetadataProvider {
  readonly id = "youtube" as const;
  canHandle(input: string) {
    return supportedUrl(input, [
      "youtube.com",
      "www.youtube.com",
      "youtu.be",
      "music.youtube.com",
    ]);
  }
  async getMetadata(input: string): Promise<ResolvedTrack[]> {
    const metadata = z
      .object({
        title: z.string().min(1).max(300),
        author_name: z.string().max(200).default("YouTube"),
        thumbnail_url: z.string().url().max(2048).optional(),
      })
      .parse(
        await fixedJson(
          `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(input)}`,
        ),
      );
    return [
      {
        title: metadata.title,
        artist: metadata.author_name,
        url: input,
        provider: this.id,
        thumbnail: metadata.thumbnail_url || null,
        duration: null,
        playbackMode: "embed",
      },
    ];
  }
}

export class SpotifyProvider extends MetadataProvider {
  readonly id = "spotify" as const;
  canHandle(input: string) {
    return supportedUrl(input, ["open.spotify.com"]);
  }
  async getMetadata(input: string): Promise<ResolvedTrack[]> {
    const metadata = z
      .object({
        title: z.string().min(1).max(300),
        thumbnail_url: z.string().url().max(2048).optional(),
      })
      .parse(
        await fixedJson(
          `https://open.spotify.com/oembed?url=${encodeURIComponent(input)}`,
        ),
      );
    return [
      {
        title: metadata.title,
        artist: "Spotify",
        url: input,
        provider: this.id,
        thumbnail: metadata.thumbnail_url || null,
        duration: null,
        playbackMode: "embed",
      },
    ];
  }
}

export class SoundCloudProvider extends MetadataProvider {
  readonly id = "soundcloud" as const;
  canHandle(input: string) {
    return supportedUrl(input, [
      "soundcloud.com",
      "www.soundcloud.com",
      "m.soundcloud.com",
    ]);
  }
  async getMetadata(input: string): Promise<ResolvedTrack[]> {
    const metadata = z
      .object({
        title: z.string().min(1).max(300),
        author_name: z.string().max(200).default("SoundCloud"),
        thumbnail_url: z.string().url().max(2048).optional(),
      })
      .parse(
        await fixedJson(
          `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(input)}`,
        ),
      );
    return [
      {
        title: metadata.title,
        artist: metadata.author_name,
        url: input,
        provider: this.id,
        thumbnail: metadata.thumbnail_url || null,
        duration: null,
        playbackMode: "embed",
      },
    ];
  }
}

export class DirectAudioProvider implements MusicProvider {
  readonly id = "audio" as const;
  canHandle(input: string) {
    try {
      const url = new URL(input);
      return config.MUSIC_AUDIO_HOSTS.has(
        url.hostname.toLowerCase().replace(/\.$/, ""),
      );
    } catch {
      return false;
    }
  }
  async resolve(input: string) {
    return this.getMetadata(input);
  }
  async search(_query: string) {
    return [];
  }
  async getMetadata(input: string): Promise<ResolvedTrack[]> {
    const source = await probeAudio(input);
    const name = decodeURIComponent(
      new URL(source.url).pathname.split("/").at(-1) || "Audio track",
    )
      .replace(/\.[a-z0-9]{2,5}$/i, "")
      .replace(/[-_]+/g, " ")
      .trim();
    return [
      {
        title: name.slice(0, 300) || "Audio track",
        artist: "Direct audio",
        url: source.url,
        provider: this.id,
        thumbnail: null,
        duration: null,
        playbackMode: "native",
      },
    ];
  }
  async getPlayableSource(track: ResolvedTrack) {
    return track.url;
  }
}

export class MusicProviderService {
  constructor(
    readonly providers: MusicProvider[] = [
      new YouTubeProvider(),
      new SpotifyProvider(),
      new SoundCloudProvider(),
      new DirectAudioProvider(),
    ],
  ) {}

  detect(input: string) {
    return this.providers.find((provider) => provider.canHandle(input));
  }

  async resolve(input: string, requestedBy: string): Promise<MusicTrack[]> {
    const normalized = input.trim();
    if (!normalized)
      throw Object.assign(
        new Error("Type a song name or paste a music link."),
        {
          statusCode: 400,
          code: "MUSIC_INPUT_REQUIRED",
        },
      );
    let provider = this.detect(normalized);
    let tracks: ResolvedTrack[] = [];
    if (provider) tracks = await provider.resolve(normalized);
    else if (!/^\w+:\/\//.test(normalized)) {
      for (const candidate of this.providers) {
        tracks = await candidate.search(normalized);
        if (tracks.length) {
          provider = candidate;
          break;
        }
      }
    } else
      throw Object.assign(
        new Error("This provider does not support playback in Noctis yet."),
        {
          statusCode: 422,
          code: "MUSIC_PROVIDER_UNSUPPORTED",
        },
      );
    if (!provider || !tracks.length)
      throw Object.assign(
        new Error(
          "No licensed playback source is configured for that search yet.",
        ),
        { statusCode: 422, code: "MUSIC_SEARCH_UNAVAILABLE" },
      );
    const playable: ResolvedTrack[] = [];
    for (const track of tracks) {
      if (track.duration && track.duration > config.MUSIC_MAX_TRACK_SECONDS)
        continue;
      if (track.playbackMode === "embed") {
        playable.push(track);
        continue;
      }
      const source = await provider.getPlayableSource(track);
      if (source)
        playable.push({ ...track, url: source, playbackMode: "native" });
    }
    if (!playable.length)
      throw Object.assign(new Error(directPlaybackMessage), {
        statusCode: 422,
        code: "MUSIC_PLAYBACK_UNAVAILABLE",
        metadata: tracks,
      });
    const now = new Date().toISOString();
    return playable.map((track) => ({
      ...track,
      id: randomUUID(),
      requestedBy,
      requestedAt: now,
    }));
  }
}

export const musicProviders = new MusicProviderService();
