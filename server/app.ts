import Fastify, { LogController } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import staticFiles from "@fastify/static";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { ZodError } from "zod";
import { config, production } from "./config.js";
import { authHook, authRoutes } from "./auth.js";
import { accountSecurityRoutes } from "./account-security.js";
import { apiPool, authPool, workerPool, closePools } from "./db.js";
import { collectUploadGarbage } from "./upload-gc.js";
import { uploadStore } from "./upload-store.js";
import { readRoutes } from "./domain/read.js";
import { chatRoutes } from "./domain/chat.js";
import { communityRoutes } from "./domain/community.js";
import { missionRoutes } from "./domain/missions.js";
import { storageRoutes } from "./storage.js";
import { realtimeRoutes } from "./realtime.js";
import { mediaRoutes } from "./media.js";
import { integrationRoutes } from "./integrations.js";
import { musicRoutes } from "./music/routes.js";
import type { MusicProviderService } from "./music/providers.js";
declare module "fastify" {
  interface FastifyRequest {
    rawBody: Buffer;
  }
}
export async function buildApp(
  options: { musicProviders?: MusicProviderService } = {},
) {
  const app = Fastify({
    bodyLimit: 128 * 1024,
    requestTimeout: 15000,
    connectionTimeout: 10000,
    keepAliveTimeout: 5000,
    trustProxy: process.env.TRUST_PROXY_CIDR
      ? process.env.TRUST_PROXY_CIDR.split(",")
      : false,
    genReqId: () => randomUUID(),
    logController: new LogController({ disableRequestLogging: true }),
    logger:
      config.NODE_ENV === "test"
        ? false
        : {
            level: "info",
            redact: {
              paths: [
                "req.headers",
                "req.body",
                "res.headers",
                "password",
                "token",
                "secret",
                "credentials",
              ],
              remove: true,
            },
            serializers: {
              err: (e) => ({
                type: e.name,
                message: "Server error",
                stack: "",
                code: e.code,
                statusCode: e.statusCode,
              }),
            },
          },
  });
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer", bodyLimit: 128 * 1024 },
    (req, body, done) => {
      req.rawBody = body as Buffer;
      try {
        done(null, JSON.parse(req.rawBody.toString("utf8")));
      } catch {
        done(Object.assign(new Error("Invalid JSON."), { statusCode: 400 }));
      }
    },
  );
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "https://www.youtube.com",
          "https://open.spotify.com",
          "https://w.soundcloud.com",
        ],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", "blob:", "data:"],
        mediaSrc: ["'self'", "blob:"],
        connectSrc: ["'self'"],
        frameSrc: [
          "'self'",
          "https://www.youtube.com",
          "https://www.youtube-nocookie.com",
          "https://open.spotify.com",
          "https://w.soundcloud.com",
        ],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        ...(production
          ? { upgradeInsecureRequests: [] }
          : { upgradeInsecureRequests: null }),
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: production ? { maxAge: 31536000, includeSubDomains: true } : false,
  });
  await app.register(multipart, {
    limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
  });
  await app.register(websocket, {
    options: { maxPayload: 1024 * 1024, perMessageDeflate: false },
  });
  app.addHook("onRequest", async (req, reply) => {
    reply.header("X-Request-ID", req.id);
    if (req.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    if (authPool.waitingCount >= config.AUTH_POOL_SIZE * 4)
      throw Object.assign(
        new Error("Server is busy. Please try again shortly."),
        { statusCode: 503 },
      );
    await authHook(req);
  });
  app.addHook("onResponse", async (req, reply) => {
    app.log.info(
      {
        kind:
          reply.statusCode === 401 || reply.statusCode === 403
            ? "security"
            : "application",
        requestId: req.id,
        method: req.method,
        route: req.routeOptions.url || "unmatched",
        status: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      },
      "request completed",
    );
  });
  app.setErrorHandler((error, req, reply) => {
    const e = error as Error & { statusCode?: number; code?: string };
    const errorCode = e.code;
    let status = e.statusCode || 500;
    let message =
      status < 500 ? e.message : "Something went wrong. Please try again.";
    if (e instanceof ZodError) {
      status = 400;
      message = e.issues
        .map((i) => `${i.path.join(".") || "Request"}: ${i.message}`)
        .slice(0, 3)
        .join("; ");
    }
    if (["23505", "23503", "23514", "22P02"].includes(errorCode || "")) {
      status = 409;
      message =
        "This change conflicts with existing data. Check the details and try again.";
    }
    if (
      ["53300", "57014"].includes(errorCode || "") ||
      /timeout exceeded when trying to connect|Connection terminated due to connection timeout/.test(
        e.message,
      )
    ) {
      status = 503;
      message = "Server is busy. Please try again shortly.";
    }
    if (status === 503) reply.header("Retry-After", "1");
    if (status >= 500)
      app.log.error(
        {
          kind: "application",
          requestId: req.id,
          errorCode: errorCode || e.name,
          route: req.routeOptions.url,
        },
        "request failed",
      );
    reply.code(status).send({ error: { message, requestId: req.id } });
  });
  app.get("/api/health", async () => ({ status: "ok" }));
  app.get("/api/ready", async () => {
    await apiPool.query("SELECT 1");
    return { status: "ready" };
  });
  await authRoutes(app);
  await accountSecurityRoutes(app);
  await readRoutes(app);
  await chatRoutes(app);
  await communityRoutes(app);
  await missionRoutes(app);
  await storageRoutes(app);
  await integrationRoutes(app);
  await musicRoutes(app, options.musicProviders);
  await realtimeRoutes(app);
  await mediaRoutes(app);
  if (existsSync(resolve("dist/index.html"))) {
    await app.register(staticFiles, {
      root: resolve("dist"),
      prefix: "/",
      index: ["index.html"],
      maxAge: production ? "1h" : 0,
    });
  }
  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({
      error: { message: "This resource is unavailable.", requestId: req.id },
    }),
  );
  if (config.UPLOAD_GC_OWNER === "api") {
    let timer: ReturnType<typeof setInterval> | undefined;
    let collecting: Promise<void> | undefined;
    const collect = () => {
      if (collecting) return;
      collecting = collectUploadGarbage(workerPool, uploadStore)
        .catch(() => {
          app.log.error({ kind: "storage" }, "Upload cleanup will retry");
        })
        .finally(() => {
          collecting = undefined;
        });
    };
    app.addHook("onReady", async () => {
      collect();
      timer = setInterval(collect, 60000);
      timer.unref();
    });
    app.addHook("onClose", async () => {
      clearInterval(timer);
      await collecting;
    });
  }
  return app;
}
