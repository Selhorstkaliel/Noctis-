import assert from "node:assert/strict";
import { test } from "node:test";
import { vercelFrontendConfig } from "./configure-vercel.mjs";

test("deployment config rejects absent, insecure, credential-bearing and path URLs", () => {
  for (const value of [
    undefined,
    "",
    "http://api.invalid",
    "https://user:password@api.test",
    "https://api.test/path",
    "https://127.0.0.1",
    "https://localhost",
    "https://example.com",
  ])
    assert.throws(() => vercelFrontendConfig(value));
});

test("API routes preserve same origin and cannot fall through to SPA HTML or CDN cache", () => {
  const config = vercelFrontendConfig("https://backend.test");
  assert.deepEqual(config.rewrites, [
    { source: "/api/:path*", destination: "https://backend.test/api/:path*" },
  ]);
  assert.equal(config.buildCommand, "npm run build:web");
  assert.equal(config.outputDirectory, "dist");
  const api = config.headers.find((h) => h.source === "/api/:path*");
  assert.ok(
    api.headers.some(
      (h) => h.key === "Vercel-CDN-Cache-Control" && h.value === "no-store",
    ),
  );
  const page = config.headers.find((h) => h.source.includes("(?!api"));
  assert.ok(
    page.headers.some(
      (h) =>
        h.key === "Content-Security-Policy" &&
        h.value.includes("frame-ancestors 'none'"),
    ),
  );
  assert.ok(!JSON.stringify(config).includes("LIVEKIT_API_SECRET"));
});
