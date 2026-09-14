export const musicPlaybackStates = [
  "IDLE",
  "LOADING",
  "PLAYING",
  "PAUSED",
  "STOPPED",
  "ERROR",
] as const;

export type MusicPlaybackState = (typeof musicPlaybackStates)[number];

export const musicRepeatModes = ["OFF", "ONE", "ALL"] as const;
export type MusicRepeatMode = (typeof musicRepeatModes)[number];

export const musicEvents = [
  "music:connected",
  "music:disconnected",
  "music:trackAdded",
  "music:trackStarted",
  "music:trackEnded",
  "music:paused",
  "music:resumed",
  "music:skipped",
  "music:stopped",
  "music:queueUpdated",
  "music:volumeChanged",
  "music:error",
] as const;
export type MusicEvent = (typeof musicEvents)[number];

export type MusicProviderId = "youtube" | "spotify" | "soundcloud" | "audio";

export type MusicTrack = {
  id: string;
  title: string;
  artist: string;
  url: string;
  provider: MusicProviderId;
  thumbnail: string | null;
  duration: number | null;
  playbackMode?: "native" | "embed";
  requestedBy: string;
  requestedAt: string;
};

export type MusicSession = {
  serverId: string;
  voiceChannelId: string | null;
  requestedBy: string | null;
  currentTrack: MusicTrack | null;
  queue: MusicTrack[];
  queueTotal?: number;
  queueDuration?: number | null;
  previousTracks: MusicTrack[];
  playbackState: MusicPlaybackState;
  volume: number;
  repeatMode: MusicRepeatMode;
  shuffle: boolean;
  startedAt: string | null;
  pausedAt: string | null;
  position: number;
  botConnected: boolean;
  revision: number;
};

export type MusicQueuePage = {
  currentTrack: MusicTrack | null;
  items: MusicTrack[];
  offset: number;
  limit: number;
  total: number;
  totalDuration: number | null;
};

export type MusicSettings = {
  defaultVolume: number;
  allowMemberSkip: boolean;
  allowMemberVolume: boolean;
  autoplayEnabled: boolean;
  idleDisconnectSeconds: number;
};
