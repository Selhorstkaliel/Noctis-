export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public requestId?: string,
  ) {
    super(message);
  }
}
let csrf = "";
export function setCSRF(value: string) {
  csrf = value;
}
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...(body instanceof FormData
        ? {}
        : body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      ...(!["GET", "HEAD"].includes(method) && csrf
        ? { "X-CSRF-Token": csrf }
        : {}),
    },
    body:
      body instanceof FormData
        ? body
        : body === undefined
          ? undefined
          : JSON.stringify(body),
    signal,
  }).catch((error: unknown) => {
    if (error instanceof TypeError)
      throw new Error(
        "Connection failed. Check your internet connection and try again.",
      );
    throw error;
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new ApiError(
      result?.error?.message || "The server could not complete this request.",
      response.status,
      result?.error?.requestId,
    );
    if (
      response.status === 401 &&
      !path.startsWith("/auth/login") &&
      !path.startsWith("/auth/register") &&
      !path.startsWith("/auth/mfa/") &&
      !path.startsWith("/auth/password")
    )
      window.dispatchEvent(new Event("noctis-session-expired"));
    throw error;
  }
  return result;
}
export async function uploadFile(
  file: File,
  purpose: "avatar" | "message",
  room?: string,
) {
  const form = new FormData();
  form.append("file", file);
  return api<{ id: string; url: string; name: string; type: string }>(
    `/uploads?purpose=${purpose}${room ? `&room=${encodeURIComponent(room)}` : ""}`,
    "POST",
    form,
  );
}
export async function fileFromUrl(url: string, name?: string): Promise<File> {
  let blob: Blob;
  if (url.startsWith("data:")) {
    // FileReader previews are local bytes. Fetching them violates connect-src 'self'.
    const comma = url.indexOf(",");
    const header = /^data:([^;,]+);base64$/.exec(url.slice(0, comma));
    try {
      if (!header) throw new Error();
      const bytes = Uint8Array.from(atob(url.slice(comma + 1)), (c) =>
        c.charCodeAt(0),
      );
      blob = new Blob([bytes], { type: header[1] });
    } catch {
      throw new Error("This file could not be read. Choose it again.");
    }
  } else {
    const response = await fetch(url);
    if (!response.ok)
      throw new Error("This file could not be read. Choose it again.");
    blob = await response.blob();
  }
  return new File([blob], name || `image.${blob.type.split("/")[1] || "bin"}`, {
    type: blob.type,
  });
}
export type LiveFrame = { type: string; [key: string]: any };
const listeners = new Set<(frame: LiveFrame) => void>();
let socket: WebSocket | undefined;
let interval: ReturnType<typeof setInterval> | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;
let wanted = false;
let ready = false;
let topics: string[] = [];
let csrfToken = "";
let retryCount = 0;
export function onLive(listener: (frame: LiveFrame) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function sendLive(frame: LiveFrame) {
  if (socket?.readyState === WebSocket.OPEN && ready)
    socket.send(JSON.stringify(frame));
  else throw new Error("Live connection is reconnecting. Please try again.");
}
export function subscribe(topicsToUse: string[]) {
  topics = topicsToUse.slice(0, 50);
  if (ready) sendLive({ type: "subscribe", topics });
}
export function connectLive(token: string) {
  csrfToken = token;
  wanted = true;
  if (socket && socket.readyState < 2) return;
  ready = false;
  socket = new WebSocket(
    `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/realtime`,
  );
  socket.onopen = () =>
    socket?.send(JSON.stringify({ type: "auth", csrf: csrfToken }));
  socket.onmessage = (e) => {
    const frame = JSON.parse(e.data) as LiveFrame;
    if (frame.type === "ready") {
      ready = true;
      retryCount = 0;
      sendLive({ type: "subscribe", topics });
      sendLive({ type: "ping" });
      interval = setInterval(() => {
        if (ready) sendLive({ type: "ping" });
      }, 15000);
    }
    listeners.forEach((fn) => fn(frame));
  };
  socket.onclose = (e) => {
    ready = false;
    clearInterval(interval);
    listeners.forEach((fn) => fn({ type: "disconnected" }));
    if (e.code === 4401) {
      wanted = false;
      window.dispatchEvent(new Event("noctis-session-expired"));
    }
    if (wanted)
      retry = setTimeout(
        () => connectLive(csrfToken),
        Math.min(15000, 1000 * 2 ** retryCount++),
      );
  };
  socket.onerror = () => socket?.close();
}
export function disconnectLive() {
  wanted = false;
  ready = false;
  clearInterval(interval);
  clearTimeout(retry);
  socket?.close();
  socket = undefined;
}
