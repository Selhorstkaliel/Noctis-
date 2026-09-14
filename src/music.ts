import { api } from "./api";
import type {
  MusicQueuePage,
  MusicSession,
  MusicSettings,
  MusicTrack,
} from "../shared/music";

export type {
  MusicQueuePage,
  MusicSession,
  MusicSettings,
  MusicTrack,
} from "../shared/music";

const commands = new Set([
  "play",
  "pause",
  "resume",
  "pass",
  "skip",
  "stop",
  "volume",
  "queue",
  "nowplaying",
  "remove",
  "clear",
  "shuffle",
  "repeat",
  "move",
]);

export function parseMusicCommand(value: string) {
  const match = /^\/(\w+)(?:\s+([\s\S]*))?$/.exec(value.trim());
  if (!match || !commands.has(match[1]!.toLowerCase())) return null;
  return { command: match[1]!.toLowerCase(), argument: match[2]?.trim() || "" };
}

const announce = (serverId: string, session: MusicSession) =>
  window.dispatchEvent(
    new CustomEvent("noctis-music-changed", { detail: { serverId, session } }),
  );

export async function loadMusic(serverId: string) {
  return api<MusicSession>(`/servers/${serverId}/music`);
}

export async function loadMusicQueue(serverId: string, offset = 0, limit = 10) {
  return api<MusicQueuePage>(
    `/servers/${serverId}/music/queue?offset=${offset}&limit=${limit}`,
  );
}

export async function playMusic(serverId: string, input: string) {
  const result = await api<{ session: MusicSession; added: MusicTrack[] }>(
    `/servers/${serverId}/music/play`,
    "POST",
    { input },
  );
  announce(serverId, result.session);
  return result;
}

export async function musicAction(
  serverId: string,
  action: string,
  body: Record<string, unknown> = {},
) {
  const session = await api<MusicSession>(
    `/servers/${serverId}/music/commands/${action}`,
    "POST",
    body,
  );
  announce(serverId, session);
  return session;
}
