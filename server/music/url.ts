import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { config } from "../config.js";

const forbiddenNames = new Set(["localhost", "localhost.localdomain"]);

export function isPrivateAddress(value: string) {
  const address = value.toLowerCase().replace(/^::ffff:/, "");
  if (address.includes(":"))
    return (
      address === "::" ||
      address === "::1" ||
      address.startsWith("fc") ||
      address.startsWith("fd") ||
      /^fe[89ab]/.test(address)
    );
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((x) => !Number.isInteger(x)))
    return true;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a! >= 224
  );
}

export function parsePublicAudioUrl(
  input: string,
  allowedHosts = config.MUSIC_AUDIO_HOSTS,
) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw Object.assign(new Error("Enter a valid music link or search term."), {
      statusCode: 400,
      code: "MUSIC_URL_INVALID",
    });
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    forbiddenNames.has(hostname) ||
    isIP(hostname) ||
    !allowedHosts.has(hostname)
  )
    throw Object.assign(
      new Error("This audio host is not enabled for Noctis Music."),
      {
        statusCode: 400,
        code: "MUSIC_URL_BLOCKED",
      },
    );
  url.hash = "";
  return url;
}

async function resolvePublic(url: URL) {
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address)))
    throw Object.assign(new Error("This audio address is not available."), {
      statusCode: 400,
      code: "MUSIC_URL_BLOCKED",
    });
  return addresses[0]!;
}

function openPinned(
  url: URL,
  address: string,
  family: number,
  method: "GET" | "HEAD",
) {
  return new Promise<IncomingMessage>((resolve, reject) => {
    const requester = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = requester(
      url,
      {
        method,
        headers: {
          Accept: "audio/*",
          "User-Agent": "Noctis-Music/1.0",
        },
        lookup: (_hostname, _options, callback) =>
          callback(null, address, family as 4 | 6),
      },
      resolve,
    );
    req.setTimeout(config.MUSIC_FETCH_TIMEOUT_MS, () =>
      req.destroy(
        Object.assign(new Error("Audio source timed out."), {
          code: "MUSIC_TIMEOUT",
        }),
      ),
    );
    req.once("error", reject);
    req.end();
  });
}

export async function openAudioStream(
  input: string,
  method: "GET" | "HEAD" = "GET",
  redirects = 0,
): Promise<{ response: IncomingMessage; url: URL }> {
  const url = parsePublicAudioUrl(input);
  const resolved = await resolvePublic(url);
  const response = await openPinned(
    url,
    resolved.address,
    resolved.family,
    method,
  );
  if (method === "HEAD" && [403, 405].includes(response.statusCode || 0)) {
    response.resume();
    return openAudioStream(input, "GET", redirects);
  }
  if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
    response.resume();
    if (redirects >= 3 || !response.headers.location)
      throw Object.assign(
        new Error("This audio link redirected too many times."),
        {
          statusCode: 400,
          code: "MUSIC_REDIRECT_BLOCKED",
        },
      );
    return openAudioStream(
      new URL(response.headers.location, url).href,
      method,
      redirects + 1,
    );
  }
  if (
    (response.statusCode || 500) < 200 ||
    (response.statusCode || 500) >= 300
  ) {
    response.resume();
    throw Object.assign(new Error("This audio source is unavailable."), {
      statusCode: 422,
      code: "MUSIC_SOURCE_UNAVAILABLE",
    });
  }
  const length = Number(response.headers["content-length"] || 0);
  if (length > config.MUSIC_MAX_SOURCE_BYTES) {
    response.destroy();
    throw Object.assign(
      new Error("This audio file is larger than the server allows."),
      {
        statusCode: 413,
        code: "MUSIC_SOURCE_TOO_LARGE",
      },
    );
  }
  const type = String(response.headers["content-type"] || "").toLowerCase();
  if (
    type &&
    !type.startsWith("audio/") &&
    type !== "application/octet-stream"
  ) {
    response.destroy();
    throw Object.assign(
      new Error("This link does not provide a supported audio file."),
      {
        statusCode: 422,
        code: "MUSIC_SOURCE_TYPE",
      },
    );
  }
  return { response, url };
}

export async function probeAudio(input: string) {
  const { response, url } = await openAudioStream(input, "HEAD");
  const length = Number(response.headers["content-length"] || 0);
  const type = String(response.headers["content-type"] || "audio/unknown");
  response.destroy();
  return { url: url.href, length, type };
}
