import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function vercelFrontendConfig(value) {
  let backend;
  try {
    backend = new URL(value);
  } catch {
    throw new Error(
      "Set NOCTIS_BACKEND_ORIGIN to the real HTTPS backend origin.",
    );
  }
  if (
    backend.protocol !== "https:" ||
    backend.origin !== value ||
    backend.username ||
    backend.password ||
    /(^|\.)(localhost|invalid|example\.com)$/.test(backend.hostname) ||
    /^127\.|^0\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(
      backend.hostname,
    )
  )
    throw new Error(
      "NOCTIS_BACKEND_ORIGIN must be a public HTTPS origin without credentials or a path.",
    );
  const csp = [
    "default-src 'self'",
    "script-src 'self' https://www.youtube.com https://open.spotify.com https://w.soundcloud.com",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://open.spotify.com https://w.soundcloud.com",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
  return {
    $schema: "https://openapi.vercel.sh/vercel.json",
    framework: "vite",
    installCommand: "npm ci",
    buildCommand: "npm run build:web",
    outputDirectory: "dist",
    rewrites: [
      { source: "/api/:path*", destination: `${backend.origin}/api/:path*` },
    ],
    headers: [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
      {
        // Preserve the API's stricter per-upload CSP/sandbox response headers.
        source: "/:path((?!api(?:/|$)).*)",
        headers: [{ key: "Content-Security-Policy", value: csp }],
      },
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "CDN-Cache-Control", value: "no-store" },
          { key: "Vercel-CDN-Cache-Control", value: "no-store" },
          { key: "x-vercel-enable-rewrite-caching", value: "0" },
        ],
      },
    ],
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const config = vercelFrontendConfig(process.env.NOCTIS_BACKEND_ORIGIN);
  // Write before deployment/config discovery, not inside a Vercel build step.
  await writeFile("vercel.json", JSON.stringify(config, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(
    "Created vercel.json. Review the backend, then commit the public routing configuration.",
  );
}
