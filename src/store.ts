import { useSyncExternalStore } from "react";
import {
  setUsers,
  unavailableUser,
  type User,
  type Server,
  type Mission,
  type Message,
  type Event,
} from "./data";
import {
  api,
  setCSRF,
  connectLive,
  disconnectLive,
  onLive,
  subscribe,
  uploadFile,
  fileFromUrl,
} from "./api";
export type Channel = {
  id: string;
  serverId: string;
  name: string;
  slug: string;
  description: string;
  kind: "text" | "voice";
  categoryId: string;
  isPrivate: boolean;
  position: number;
  unread: number;
};
export type ServerRole = {
  id: string;
  serverId: string;
  name: string;
  position: number;
  isDefault: boolean;
  color: string;
  permissions: string[];
};
export type Store = {
  version: number;
  profile: User;
  users: User[];
  servers: Server[];
  channels: Channel[];
  categories: {
    id: string;
    serverId: string;
    name: string;
    position: number;
  }[];
  memberships: { serverId: string; userId: string }[];
  serverRoles: ServerRole[];
  assignments: { serverId: string; userId: string; roleId: string }[];
  missions: Mission[];
  messages: Message[];
  events: Event[];
  connected: string[];
  readNotifications: string[];
  unreadDM: Record<string, number>;
  settings: Record<string, boolean | string>;
  roles: Record<string, string>;
  groups: { id: string; name: string | null; members: string[] }[];
  notifications: {
    id: string;
    actorId?: string;
    kind: string;
    title: string;
    body: string;
    route: string;
    readAt?: string;
    createdAt: string;
  }[];
  friendships: {
    requesterId: string;
    recipientId: string;
    status: "pending" | "accepted";
  }[];
  blocks: string[];
  voice: {
    id: string;
    userId: string;
    channelId: string;
    muted: boolean;
    deafened: boolean;
    camera: boolean;
    screen: boolean;
    serverMuted: boolean;
    serverDeafened: boolean;
  }[];
  integrationItems: {
    provider: string;
    title: string;
    url?: string;
    occurredAt: string;
  }[];
  auth: "loading" | "authenticated" | "anonymous" | "verification" | "error";
  connection: "connecting" | "connected" | "offline";
  pending: boolean;
  error: string;
  providers: { id: string; enabled: boolean; login: boolean }[];
};
const empty: Store = {
  version: 2,
  profile: unavailableUser,
  users: [],
  servers: [],
  channels: [],
  categories: [],
  memberships: [],
  serverRoles: [],
  assignments: [],
  missions: [],
  messages: [],
  events: [],
  connected: [],
  readNotifications: [],
  unreadDM: {},
  settings: { theme: "midnight", motion: true, language: "en-US" },
  roles: {},
  groups: [],
  notifications: [],
  friendships: [],
  blocks: [],
  voice: [],
  integrationItems: [],
  auth: "loading",
  connection: "connecting",
  pending: false,
  error: "",
  providers: [],
};
let state: Store = { ...empty };
const listeners = new Set<() => void>();
const aliases = new Map<string, string>();
let refreshPromise: Promise<void> | undefined;
let refreshAgain = false;
let sessionEpoch = 0;
let dataEpoch = 0;
function publish(next: Store) {
  state = next;
  setUsers(next.users);
  listeners.forEach((fn) => fn());
}
export function getStore() {
  return state;
}
export function useStore() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => state,
  );
}
export async function refresh() {
  if (refreshPromise) {
    refreshAgain = true;
    return refreshPromise;
  }
  refreshPromise = (async () => {
    const epoch = sessionEpoch;
    do {
      refreshAgain = false;
      dataEpoch++;
      const snapshot =
        await api<
          Omit<Store, "auth" | "connection" | "pending" | "error" | "providers">
        >("/bootstrap");
      if (epoch !== sessionEpoch) return;
      publish({ ...state, ...snapshot, auth: "authenticated", error: "" });
      updateSubscriptions();
    } while (refreshAgain);
  })().finally(() => {
    refreshPromise = undefined;
  });
  return refreshPromise;
}
export function updateSubscriptions() {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  const current = state.channels.find(
    (c) => c.serverId === parts[1] && c.slug === parts[2],
  );
  const dm =
    parts[0] === "messages"
      ? state.groups.find(
          (g) => g.id === parts[1] || (!g.name && g.members.includes(parts[1])),
        )
      : undefined;
  // The visible room has priority even for accounts with many communities.
  subscribe([
    ...new Set([
      ...(current ? ["channel:" + current.id] : []),
      ...(dm ? ["conversation:" + dm.id] : []),
      ...state.servers.filter((s) => s.joined).map((s) => "server:" + s.id),
      ...state.groups.slice(0, 15).map((g) => "conversation:" + g.id),
    ]),
  ]);
}
function roomForTopic(topic: string) {
  const [kind, id] = topic.split(":");
  if (kind === "channel") {
    const c = state.channels.find((c) => c.id === id);
    return c ? c.serverId + "/" + c.slug : undefined;
  }
  if (kind === "conversation") {
    const g = state.groups.find((g) => g.id === id);
    return g
      ? "dm/" +
          (g.name
            ? g.id
            : g.members.find((u) => u !== state.profile.id) || g.id)
      : undefined;
  }
}
type RoomWork = { ids: Set<string>; dirty: boolean; promise: Promise<void> };
const roomQueues = new Map<string, RoomWork>();
export function syncRoom(room: string, ids: string[]) {
  const queued = roomQueues.get(room);
  if (queued) {
    ids.forEach((id) => queued.ids.add(id));
    queued.dirty = true;
    return queued.promise;
  }
  const epoch = sessionEpoch;
  const work: RoomWork = {
    ids: new Set(ids),
    dirty: true,
    promise: Promise.resolve(),
  };
  work.promise = Promise.resolve()
    .then(async () => {
      while (work.dirty || work.ids.size) {
        if (refreshPromise) await refreshPromise;
        if (epoch !== sessionEpoch) return;
        if (work.ids.size > 1000) {
          await refresh();
          return;
        }
        const generation = dataEpoch;
        work.dirty = false;
        const batch = [...work.ids].slice(0, 100);
        batch.forEach((id) => work.ids.delete(id));
        const result = await api<{
          items: Message[];
          users: User[];
          removed: string[];
          unread: number;
        }>("/rooms/" + encodeURIComponent(room) + "/sync", "POST", {
          ids: batch,
        });
        if (epoch !== sessionEpoch) return;
        if (generation !== dataEpoch) {
          batch.forEach((id) => work.ids.add(id));
          work.dirty = true;
          continue;
        }
        const replaced = new Set([...batch, ...result.items.map((m) => m.id)]);
        const messages = [
          ...state.messages.filter(
            (m) => m.room !== room || !replaced.has(m.id),
          ),
          ...result.items,
        ].sort(
          (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
        );
        const channels = state.channels.map((c) =>
          c.serverId + "/" + c.slug === room
            ? { ...c, unread: result.unread }
            : c,
        );
        const authorIds = new Set(result.users.map((u) => u.id));
        publish({
          ...state,
          messages,
          channels,
          users: [
            ...state.users.filter((u) => !authorIds.has(u.id)),
            ...result.users,
          ],
          servers: state.servers.map((s) => ({
            ...s,
            unread: channels
              .filter((c) => c.serverId === s.id)
              .reduce((sum, c) => sum + c.unread, 0),
          })),
          unreadDM: room.startsWith("dm/")
            ? { ...state.unreadDM, [room.slice(3)]: result.unread }
            : state.unreadDM,
        });
      }
    })
    .finally(() => {
      if (roomQueues.get(room) === work) roomQueues.delete(room);
    });
  roomQueues.set(room, work);
  return work.promise;
}
let activityPromise: Promise<void> | undefined;
async function refreshActivity() {
  if (activityPromise) return activityPromise;
  const epoch = sessionEpoch,
    generation = dataEpoch;
  activityPromise = (async () => {
    const result = await api<{
      channels: { id: string; unread: number }[];
      conversations: { id: string; unread: number }[];
    }>("/activity");
    if (epoch !== sessionEpoch || generation !== dataEpoch) return;
    const channels = state.channels.map((c) => ({
      ...c,
      unread: result.channels.find((r) => r.id === c.id)?.unread || 0,
    }));
    const unreadDM = { ...state.unreadDM };
    for (const g of result.conversations) {
      const room = roomForTopic("conversation:" + g.id);
      if (room) unreadDM[room.slice(3)] = g.unread;
    }
    publish({
      ...state,
      channels,
      unreadDM,
      servers: state.servers.map((s) => ({
        ...s,
        unread: channels
          .filter((c) => c.serverId === s.id)
          .reduce((sum, c) => sum + c.unread, 0),
      })),
    });
  })().finally(() => {
    activityPromise = undefined;
  });
  return activityPromise;
}

let initialization: Promise<void> | undefined;
export function initialize() {
  return (initialization ||= initializeSession().finally(() => {
    initialization = undefined;
  }));
}
async function initializeSession() {
  try {
    const providers = await api<Store["providers"]>("/auth/providers");
    publish({ ...state, providers });
    const session = await api("/auth/session");
    await acceptSession(session);
  } catch (error) {
    if ((error as { status?: number }).status === 401)
      publish({ ...empty, providers: state.providers, auth: "anonymous" });
    else publish({ ...state, auth: "error", error: (error as Error).message });
  }
}
export async function signIn(
  input: {
    email: string;
    password: string;
    name?: string;
    handle?: string;
    language?: string;
  },
  register = false,
) {
  const session = await api(
    register ? "/auth/register" : "/auth/login",
    "POST",
    input,
  );
  if (session.mfaRequired) return "mfa";
  await acceptSession(session);
  return session.emailVerified ? "authenticated" : "verification";
}
export async function acceptSession(session: {
  csrf: string;
  emailVerified: boolean;
}) {
  setCSRF(session.csrf);
  if (!session.emailVerified) {
    disconnectLive();
    publish({ ...empty, providers: state.providers, auth: "verification" });
    return;
  }
  const preferred = sessionStorage.getItem("noctis-pending-login-language");
  if (preferred === "en-US" || preferred === "pt-BR") {
    await api("/settings", "PATCH", { language: preferred });
    sessionStorage.removeItem("noctis-pending-login-language");
  }
  await refresh();
  connectLive(session.csrf);
}
export async function signOut(all = false) {
  await api("/auth/logout", "POST", { all });
  sessionEpoch++;
  disconnectLive();
  setCSRF("");
  sessionStorage.clear();
  publish({ ...empty, providers: state.providers, auth: "anonymous" });
  navigate("login");
}
window.addEventListener("noctis-session-expired", () => {
  sessionEpoch++;
  disconnectLive();
  setCSRF("");
  sessionStorage.clear();
  publish({ ...empty, providers: state.providers, auth: "anonymous" });
});
let liveRefresh: ReturnType<typeof setTimeout> | undefined;
const pendingDeltas = new Map<string, Set<string>>();
let deltaTimer: ReturnType<typeof setTimeout> | undefined;
onLive((frame) => {
  if (frame.type === "ready") {
    publish({ ...state, connection: "connected" });
    void refresh().catch(reportError);
  }
  if (frame.type === "disconnected")
    publish({ ...state, connection: "offline" });
  if (frame.type === "activity") void refreshActivity().catch(reportError);
  if (frame.type === "invalidate" && Array.isArray(frame.ids)) {
    const room = roomForTopic(frame.topic);
    if (room) {
      const ids = pendingDeltas.get(room) || new Set<string>();
      frame.ids.forEach((id: string) => ids.add(id));
      pendingDeltas.set(room, ids);
      if (!deltaTimer)
        deltaTimer = setTimeout(() => {
          deltaTimer = undefined;
          const batches = [...pendingDeltas];
          pendingDeltas.clear();
          for (const [room, ids] of batches)
            void syncRoom(room, [...ids]).catch(() =>
              refresh().catch(reportError),
            );
        }, 75);
      return;
    }
  }
  if (["invalidate", "revoked"].includes(frame.type)) {
    if (frame.type === "revoked") {
      dataEpoch++;
      const room = roomForTopic(frame.topic);
      publish({
        ...state,
        messages: room ? state.messages.filter((m) => m.room !== room) : [],
      });
    }
    if (!liveRefresh)
      liveRefresh = setTimeout(() => {
        liveRefresh = undefined;
        void refresh().catch(reportError);
      }, 100);
  }
  if (frame.type === "error") reportError(new Error(frame.message));
});
export function reportError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "This change could not be saved.";
  publish({ ...state, error: message });
  window.dispatchEvent(
    new CustomEvent("noctis-api-error", { detail: message }),
  );
}
export async function command<T = any>(
  path: string,
  method = "POST",
  body: unknown = {},
): Promise<T> {
  publish({ ...state, pending: true, error: "" });
  try {
    const result = await api<T>(path, method, body);
    if (/^\/rooms\/[^/]+\/read$/.test(path)) {
      const room = decodeURIComponent(path.split("/")[2]);
      void syncRoom(room, []).catch(reportError);
    } else if (path !== "/conversations") void refresh().catch(reportError);
    return result;
  } catch (error) {
    reportError(error);
    throw error;
  } finally {
    publish({ ...state, pending: false });
  }
}
export const newId = () => crypto.randomUUID();
export function navigate(path: string) {
  window.location.hash = path
    .split("/")
    .map((p) => aliases.get(p) || p)
    .join("/");
}
export function useRoute() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("hashchange", cb);
      return () => window.removeEventListener("hashchange", cb);
    },
    () => location.hash.replace(/^#\/?/, "") || "home",
  );
}
export function activeServer() {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  return (
    state.servers.find((s) => s.id === parts[1]) ||
    state.servers.find((s) => s.joined)
  );
}
export function can(serverId: string | undefined, permission: string) {
  return !!state.servers
    .find((s) => s.id === serverId)
    ?.permissions?.includes(permission);
}
export function roleCan(
  _role: string,
  action: "manage" | "roles" | "moderate",
) {
  return can(
    activeServer()?.id,
    action === "roles"
      ? "MANAGE_ROLES"
      : action === "manage"
        ? "MANAGE_SERVER"
        : "MANAGE_MESSAGES",
  );
}
export async function openConversation(userId: string) {
  const result = await command("/conversations", "POST", { members: [userId] });
  navigate(result.route);
}
export async function loadRoom(
  room: string,
  before?: string,
  around?: string,
): Promise<string | null> {
  const epoch = sessionEpoch;
  if (refreshPromise) await refreshPromise;
  const generation = dataEpoch;
  const result = await api<{ items: Message[]; nextCursor: string | null }>(
    `/rooms/${encodeURIComponent(room)}/messages?limit=50${before ? `&before=${encodeURIComponent(before)}` : ""}${around ? `&around=${encodeURIComponent(around)}` : ""}`,
  );
  if (epoch !== sessionEpoch) return null;
  if (generation !== dataEpoch) return loadRoom(room, before, around);
  const ids = new Set(result.items.map((m) => m.id));
  publish({
    ...state,
    messages: [
      ...state.messages.filter((m) => !ids.has(m.id)),
      ...result.items,
    ].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()),
  });
  return result.nextCursor;
}
/** Presentation intents map to specific domain endpoints, never a bulk state write. */
export async function updateStore(mutator: (current: Store) => Store) {
  const before = state;
  const next = mutator(before);
  const onlyMessages = (Object.keys(next) as (keyof Store)[]).every(
    (key) => key === "messages" || next[key] === before[key],
  );
  const touched = new Map<string, Set<string>>();
  const touch = (room: string, id: string) => {
    const ids = touched.get(room) || new Set<string>();
    ids.add(id);
    touched.set(room, ids);
  };
  if (next === before) return;
  publish({ ...state, pending: true, error: "" });
  try {
    const changedFields = (
      a: Record<string, any>,
      b: Record<string, any>,
      keys: string[],
    ) =>
      Object.fromEntries(
        keys
          .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
          .map((k) => [k, b[k]]),
      );
    const profile = changedFields(before.profile, next.profile, [
      "name",
      "handle",
      "bio",
      "activity",
      "status",
    ]);
    if (
      next.profile.avatarUrl !== before.profile.avatarUrl &&
      next.profile.avatarUrl
    ) {
      const upload = await uploadFile(
        await fileFromUrl(next.profile.avatarUrl),
        "avatar",
      );
      profile.avatarUploadId = upload.id;
    }
    if (Object.keys(profile).length) await api("/profile", "PATCH", profile);
    const settings = changedFields(before.settings, next.settings, [
      "theme",
      "motion",
      "sounds",
      "desktop",
      "mentions",
      "interests",
      "status",
      "activity",
      "direct",
      "friendRequests",
      "invites",
      "dmPolicy",
      "profileVisibility",
      "language",
    ]);
    if (Object.keys(settings).length) await api("/settings", "PATCH", settings);
    for (const s of next.servers) {
      const old = before.servers.find((x) => x.id === s.id);
      if (!old) {
        const result = await api("/servers", "POST", {
          name: s.name,
          description: s.description,
          category: s.category,
          isPublic: s.isPublic || false,
        });
        aliases.set(s.id, result.id);
      } else if (old.joined !== s.joined) {
        await api(
          `/servers/${s.id}/${s.joined ? "join" : "membership"}`,
          s.joined ? "POST" : "DELETE",
          s.joined ? {} : undefined,
        );
      } else {
        const patch = changedFields(old, s, [
          "name",
          "description",
          "category",
          "isPublic",
        ]);
        if (Object.keys(patch).length)
          await api(`/servers/${s.id}`, "PATCH", patch);
      }
    }
    for (const m of next.missions) {
      const old = before.missions.find((x) => x.id === m.id);
      if (!old) {
        const result = await api("/missions", "POST", {
          serverId: m.server,
          title: m.title,
          description: m.description,
          category: m.category,
          xp: m.xp,
          badge: m.badge.slice(0, 60),
          dueAt: new Date(Date.now() + 7 * 86400000).toISOString(),
          objectives: m.objectives.map((o) => ({
            text: o.text,
            verification: o.verification || "self",
          })),
        });
        aliases.set(m.id, result.id);
      } else {
        if (m.joined && !old.joined)
          await api(`/missions/${m.id}/join`, "POST", {});
        for (const [i, o] of m.objectives.entries())
          if (o.done !== old.objectives[i]?.done)
            await api(
              `/missions/${m.id}/objectives/${old.objectives[i].id}`,
              "PUT",
              { done: o.done },
            );
        if (m.claimed && !old.claimed)
          await api(`/missions/${m.id}/claim`, "POST", {});
      }
    }
    for (const m of next.messages) {
      const old = before.messages.find((x) => x.id === m.id);
      if (old && JSON.stringify(m) !== JSON.stringify(old)) touch(m.room, m.id);
      if (!old) {
        if (deleted.has(m.id)) {
          touch(m.room, m.id);
          await api(`/messages/${m.id}/restore`, "POST", {});
          deleted.delete(m.id);
          continue;
        }
        const attachments: string[] = [];
        for (const a of m.attachments || []) attachments.push(a.id);
        if (m.image?.startsWith("/images/") && m.image.endsWith(".gif")) {
          const upload = await api("/uploads/preset", "POST", {
            room: m.room,
            preset: m.image.split("/").pop()!.split(".")[0],
          });
          attachments.push(upload.id);
        } else if ((m.image || m.file?.data) && !attachments.length) {
          const url = m.image || m.file!.data;
          const upload = await uploadFile(
            await fileFromUrl(url, m.file?.name),
            "message",
            m.room,
          );
          attachments.push(upload.id);
        }
        const result = await api(
          `/rooms/${encodeURIComponent(m.room)}/messages`,
          "POST",
          { text: m.text, nonce: m.id, replyTo: m.replyTo, attachments },
        );
        aliases.set(m.id, result.id);
        touch(m.room, result.id);
      } else {
        if (m.text !== old.text)
          await api(`/messages/${m.id}`, "PATCH", { text: m.text });
        if (m.pinned !== old.pinned)
          await api(`/messages/${m.id}/pin`, "PUT", { pinned: !!m.pinned });
        for (const emoji of new Set([...(old.mine || []), ...(m.mine || [])]))
          if (!!old.mine?.includes(emoji) !== !!m.mine?.includes(emoji))
            await api(`/messages/${m.id}/reactions`, "PUT", {
              emoji,
              active: !!m.mine?.includes(emoji),
            });
      }
    }
    for (const m of before.messages)
      if (!next.messages.some((x) => x.id === m.id)) {
        await api(`/messages/${m.id}`, "DELETE");
        deleted.add(m.id);
        touch(m.room, m.id);
      }
    for (const e of next.events) {
      const old = before.events.find((x) => x.id === e.id);
      if (!old) {
        const result = await api("/events", "POST", {
          serverId: e.server,
          title: e.title,
          description: e.description,
          startsAt:
            e.startsAt ||
            new Date(
              `${e.month} ${e.day}, ${e.year || new Date().getFullYear()} ${e.time}`,
            ).toISOString(),
        });
        aliases.set(e.id, result.id);
      } else if (e.rsvp !== old.rsvp)
        await api(`/events/${e.id}/rsvp`, "PUT", { rsvp: e.rsvp });
    }
    for (const g of next.groups)
      if (!before.groups.some((x) => x.id === g.id)) {
        const result = await api("/conversations", "POST", {
          name: g.name || undefined,
          members: g.members,
        });
        aliases.set(g.id, result.id);
      }
    const reads = next.readNotifications.filter(
      (id) => !before.readNotifications.includes(id),
    );
    if (reads.length) await api("/notifications/read", "PUT", { ids: reads });
    for (const [key, role] of Object.entries(next.roles))
      if (role !== before.roles[key]) {
        const [serverId, userId] = key.includes(":")
          ? key.split(":")
          : [activeServer()?.id, key];
        const r = state.serverRoles.find(
          (r) => r.serverId === serverId && r.name === role,
        );
        if (!r) throw new Error("This role is unavailable.");
        await api(`/servers/${serverId}/members/${userId}/role`, "PUT", {
          roleId: r.id,
        });
      }
    for (const provider of before.connected)
      if (!next.connected.includes(provider))
        await api(`/integrations/${provider}`, "DELETE");
    for (const provider of next.connected)
      if (!before.connected.includes(provider)) {
        const result = await api(
          `/integrations/${provider}/connect`,
          "POST",
          {},
        );
        location.assign(result.url);
      }
    if (onlyMessages) {
      const beforeById = new Map(
        before.messages.map((message) => [message.id, message]),
      );
      const changedIds = new Set<string>();
      const committed = new Map<string, Message>();
      for (const message of next.messages) {
        const previous = beforeById.get(message.id);
        if (!previous || JSON.stringify(previous) !== JSON.stringify(message)) {
          const id = aliases.get(message.id) || message.id;
          changedIds.add(message.id);
          changedIds.add(id);
          committed.set(id, { ...message, id });
        }
      }
      for (const message of before.messages)
        if (!next.messages.some((candidate) => candidate.id === message.id))
          changedIds.add(message.id);
      publish({
        ...state,
        messages: [
          ...state.messages.filter((message) => !changedIds.has(message.id)),
          ...committed.values(),
        ],
        pending: false,
        error: "",
      });
      for (const [room, ids] of touched)
        void syncRoom(room, [...ids]).catch(reportError);
    } else {
      publish({ ...next, pending: false, error: "" });
      void refresh().catch(reportError);
    }
  } catch (error) {
    reportError(error);
    throw error;
  } finally {
    publish({ ...state, pending: false });
  }
}
const deleted = new Set<string>();
window.addEventListener("unhandledrejection", (e) => {
  if (e.reason instanceof Error) {
    e.preventDefault();
    reportError(e.reason);
  }
});

