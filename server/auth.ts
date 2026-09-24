import { randomUUID } from "node:crypto";
import { hash as passwordHash, verify, Algorithm } from "@node-rs/argon2";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { authPool, audit, type Identity, type DB } from "./db.js";
import { consumeFactor, invalidatePendingLogins } from "./security-core.js";
import { queueAccountToken } from "./security-mail.js";
import { config, cookieName, production } from "./config.js";
import { equal, hash, keyed, token } from "./crypto.js";
import { HttpError, requireThat, id } from "./errors.js";
declare module "fastify" {
  interface FastifyRequest {
    identity: Identity;
  }
}
export const passwordOptions = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
};
const credentials = z
  .object({
    email: z
      .string()
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    password: z.string().min(12).max(128),
  })
  .strict();
const register = credentials
  .extend({
    name: z.string().trim().min(2).max(60),
    language: z.enum(["en-US", "pt-BR"]).default("en-US"),
    handle: z
      .string()
      .min(3)
      .max(32)
      .regex(/^[a-z0-9_.]+$/),
  })
  .strict();
let dummyHash: string;
export async function throttle(
  scope: string,
  key: string,
  limit: number,
  seconds: number,
) {
  const result = await authPool.query(
    `INSERT INTO rate_limits(bucket) VALUES($1) ON CONFLICT(bucket) DO UPDATE SET hits=CASE WHEN rate_limits.window_start<now()-$2*interval '1 second' THEN 1 ELSE rate_limits.hits+1 END,window_start=CASE WHEN rate_limits.window_start<now()-$2*interval '1 second' THEN now() ELSE rate_limits.window_start END RETURNING hits`,
    [keyed(`${scope}:${key}`), seconds],
  );
  if (result.rows[0].hits > limit)
    throw new HttpError(
      429,
      "Too many attempts. Please wait before trying again.",
    );
}
export function verifyOrigin(request: FastifyRequest) {
  requireThat(
    request.headers.origin === config.APP_ORIGIN,
    403,
    "This request could not be verified.",
  );
}
export async function authenticate(
  request: Pick<FastifyRequest, "cookies">,
): Promise<Identity> {
  const raw = request.cookies[cookieName];
  requireThat(
    raw && /^[\w-]{43}$/.test(raw),
    401,
    "Please sign in to continue.",
  );
  const result = await authPool.query(
    `SELECT s.id,s.user_id,s.last_seen_at FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN account_mfa m ON m.user_id=u.id AND m.enabled_at IS NOT NULL WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now() AND last_seen_at>now()-interval '7 days' AND u.deleted_at IS NULL AND (m.user_id IS NULL OR s.mfa_verified_at>=m.enabled_at)`,
    [hash(raw)],
  );
  requireThat(
    result.rowCount,
    401,
    "Your session has expired. Please sign in.",
  );
  const { id: sessionId, user_id: userId } = result.rows[0];
  if (Date.now() - new Date(result.rows[0].last_seen_at).getTime() >= 5 * 60000)
    await authPool.query(
      "UPDATE sessions SET last_seen_at=now() WHERE id=$1 AND last_seen_at<now()-interval '5 minutes'",
      [sessionId],
    );
  return { userId, sessionId };
}
async function authenticateApiRequest(
  request: Pick<FastifyRequest, "cookies">,
): Promise<Identity> {
  const raw = request.cookies[cookieName];
  requireThat(
    raw && /^[\w-]{43}$/.test(raw),
    401,
    "Please sign in to continue.",
  );
  const result = await authPool.query(
    `WITH authenticated AS MATERIALIZED (
       SELECT s.id,s.user_id,s.last_seen_at,u.email_verified_at
       FROM sessions s
       JOIN users u ON u.id=s.user_id
       LEFT JOIN account_mfa m
         ON m.user_id=u.id AND m.enabled_at IS NOT NULL
       WHERE s.token_hash=$1
         AND s.revoked_at IS NULL
         AND s.expires_at>now()
         AND s.last_seen_at>now()-interval '7 days'
         AND u.deleted_at IS NULL
         AND (m.user_id IS NULL OR s.mfa_verified_at>=m.enabled_at)
     ), touched AS (
       UPDATE sessions s SET last_seen_at=now()
       FROM authenticated a
       WHERE s.id=a.id AND a.last_seen_at<now()-interval '5 minutes'
       RETURNING s.id
     ), limited AS (
       INSERT INTO rate_limits(bucket)
       SELECT $2 FROM authenticated
       ON CONFLICT(bucket) DO UPDATE SET
         hits=CASE
           WHEN rate_limits.window_start<now()-interval '60 seconds' THEN 1
           ELSE rate_limits.hits+1
         END,
         window_start=CASE
           WHEN rate_limits.window_start<now()-interval '60 seconds' THEN now()
           ELSE rate_limits.window_start
         END
       RETURNING hits
     )
     SELECT a.id,a.user_id,a.email_verified_at,l.hits
     FROM authenticated a CROSS JOIN limited l`,
    [hash(raw), keyed(`api-session:${raw}`)],
  );
  requireThat(
    result.rowCount,
    401,
    "Your session has expired. Please sign in.",
  );
  requireThat(
    result.rows[0].email_verified_at,
    403,
    "Verify your email before continuing.",
  );
  if (result.rows[0].hits > 600)
    throw new HttpError(
      429,
      "Too many attempts. Please wait before trying again.",
    );
  return {
    userId: result.rows[0].user_id,
    sessionId: result.rows[0].id,
  };
}
export async function sessionLive(identity: Identity) {
  const r = await authPool.query(
    "SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN account_mfa m ON m.user_id=u.id AND m.enabled_at IS NOT NULL WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>now() AND s.last_seen_at>now()-interval '7 days' AND u.deleted_at IS NULL AND u.email_verified_at IS NOT NULL AND (m.user_id IS NULL OR s.mfa_verified_at>=m.enabled_at)",
    [identity.sessionId, identity.userId],
  );
  return !!r.rowCount;
}
export function csrf(identity: Identity) {
  return keyed(`csrf:${identity.sessionId}`);
}
export async function createSession(
  userId: string,
  request: FastifyRequest,
  reply: FastifyReply,
  authVersion: number,
  proof?: (db: DB, user: any) => Promise<boolean>,
) {
  const db = await authPool.connect();
  const secret = token();
  const sessionId = randomUUID();
  let emailVerified = false;
  try {
    await db.query("BEGIN");
    const users = await db.query(
      "SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
      [userId],
    );
    requireThat(users.rowCount, 401, "Please sign in again.");
    const user = users.rows[0];
    requireThat(
      user.auth_version === authVersion,
      401,
      "Please sign in again.",
    );
    const verifiedFactor = proof ? await proof(db, user) : false;
    const mfa = await db.query(
      "SELECT 1 FROM account_mfa WHERE user_id=$1 AND enabled_at IS NOT NULL",
      [userId],
    );
    requireThat(
      !mfa.rowCount || verifiedFactor,
      403,
      "Two-factor authentication is required. Sign in again.",
    );
    emailVerified = !!user.email_verified_at;
    const agent = request.headers["user-agent"] || "Unknown device";
    const browser = /Edg\//.test(agent)
      ? "Microsoft Edge"
      : /Firefox\//.test(agent)
        ? "Firefox"
        : /Chrome\//.test(agent)
          ? "Chrome"
          : /Safari\//.test(agent)
            ? "Safari"
            : "Browser";
    const platform = /Windows/.test(agent)
      ? "Windows"
      : /Android/.test(agent)
        ? "Android"
        : /iPhone|iPad/.test(agent)
          ? "iOS"
          : /Mac/.test(agent)
            ? "macOS"
            : "Linux";
    const device = await db.query(
      "INSERT INTO devices(user_id,label) VALUES($1,$2) RETURNING id",
      [userId, `${browser} on ${platform}`],
    );
    await db.query(
      "INSERT INTO sessions(id,user_id,device_id,token_hash,mfa_verified_at) VALUES($1,$2,$3,$4,CASE WHEN $5 THEN now() END)",
      [sessionId, userId, device.rows[0].id, hash(secret), verifiedFactor],
    );
    await audit(db, userId, "auth.session.created", sessionId);
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
  reply.setCookie(cookieName, secret, {
    httpOnly: true,
    secure: production,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 86400,
  });
  return {
    userId,
    sessionId,
    csrf: csrf({ userId, sessionId }),
    emailVerified,
  };
}
export const challengeCookie = production ? "__Host-noctis-mfa" : "noctis_mfa";
export async function finishLogin(
  userId: string,
  request: FastifyRequest,
  reply: FastifyReply,
  proof: { authVersion: number; passwordDigest?: string },
) {
  const db = await authPool.connect();
  try {
    await db.query("BEGIN");
    const result = await db.query(
      "SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
      [userId],
    );
    requireThat(result.rowCount, 401, "Please sign in again.");
    const user = result.rows[0];
    requireThat(
      user.auth_version === proof.authVersion &&
        (!proof.passwordDigest || user.password_hash === proof.passwordDigest),
      401,
      "Please sign in again.",
    );
    if (!user.email_verified_at) {
      const pending = await db.query(
        "SELECT 1 FROM account_tokens WHERE user_id=$1 AND purpose='verify' AND expires_at>now()",
        [userId],
      );
      if (!pending.rowCount)
        await queueAccountToken(db, userId, user.email, "verify");
    }
    const mfa = await db.query(
      "SELECT 1 FROM account_mfa WHERE user_id=$1 AND enabled_at IS NOT NULL",
      [userId],
    );
    if (mfa.rowCount) {
      const secret = token();
      await db.query(
        "INSERT INTO login_challenges(token_hash,user_id,auth_version) VALUES($1,$2,$3)",
        [hash(secret), userId, user.auth_version],
      );
      await db.query("COMMIT");
      reply.setCookie(challengeCookie, secret, {
        httpOnly: true,
        secure: production,
        sameSite: "lax",
        path: "/",
        maxAge: 300,
      });
      return { mfaRequired: true as const };
    }
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
  return createSession(
    userId,
    request,
    reply,
    proof.authVersion,
    async (_db, user) => {
      requireThat(
        !proof.passwordDigest || user.password_hash === proof.passwordDigest,
        401,
        "Please sign in again.",
      );
      return false;
    },
  );
}
async function lockSessionOwner(db: DB, identity: Identity) {
  const owner = await db.query(
    "SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
    [identity.userId],
  );
  requireThat(owner.rowCount, 401, "Your session has expired. Please sign in.");
  const session = await db.query(
    "SELECT 1 FROM sessions s LEFT JOIN account_mfa m ON m.user_id=s.user_id AND m.enabled_at IS NOT NULL WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>now() AND s.last_seen_at>now()-interval '7 days' AND (m.user_id IS NULL OR s.mfa_verified_at>=m.enabled_at)",
    [identity.sessionId, identity.userId],
  );
  requireThat(
    session.rowCount,
    401,
    "Your session has expired. Please sign in.",
  );
}
export async function authRoutes(app: FastifyInstance) {
  dummyHash = await passwordHash(token(), passwordOptions);
  app.post("/api/auth/register", async (req, reply) => {
    verifyOrigin(req);
    await throttle("register-ip", req.ip, 5, 3600);
    const input = register.parse(req.body);
    const digest = await passwordHash(input.password, passwordOptions);
    const db = await authPool.connect();
    const userId = randomUUID();
    try {
      await db.query("BEGIN");
      await db.query(
        "INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)",
        [userId, input.email, digest],
      );
      await db.query(
        "INSERT INTO profiles(user_id,name,handle) VALUES($1,$2,$3)",
        [userId, input.name, input.handle],
      );
      await audit(db, userId, "auth.registered", userId);
      await db.query(
        "INSERT INTO user_settings(user_id,key,value) VALUES($1,'language',$2)",
        [userId, input.language],
      );
      await queueAccountToken(db, userId, input.email, "verify");
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505")
        throw new HttpError(
          409,
          "This account could not be created. Try another email or handle.",
        );
      throw error;
    } finally {
      db.release();
    }
    reply.code(201);
    return createSession(userId, req, reply, 0);
  });
  app.post("/api/auth/login", async (req, reply) => {
    verifyOrigin(req);
    await throttle("login-ip", req.ip, 30, 900);
    const input = credentials.parse(req.body);
    await throttle("login-account", input.email, 10, 900);
    const result = await authPool.query(
      "SELECT id,password_hash,auth_version FROM users WHERE email=$1 AND deleted_at IS NULL",
      [input.email],
    );
    const user = result.rows[0];
    const valid = await verify(
      user?.password_hash || dummyHash,
      input.password,
      passwordOptions,
    );
    if (!user?.password_hash || !valid) {
      const db = await authPool.connect();
      try {
        await audit(db, null, "auth.login.failed", "account", null, {
          account: keyed(input.email).slice(0, 16),
        });
      } finally {
        db.release();
      }
      throw new HttpError(401, "Email or password is incorrect.");
    }
    return finishLogin(user.id, req, reply, {
      passwordDigest: user.password_hash,
      authVersion: user.auth_version,
    });
  });
  app.post("/api/auth/mfa/login", async (req, reply) => {
    verifyOrigin(req);
    await throttle("mfa-login-ip", req.ip, 30, 900);
    const input = z
      .object({ code: z.string().trim().min(6).max(39) })
      .strict()
      .parse(req.body);
    const raw = req.cookies[challengeCookie];
    requireThat(
      raw && /^[\w-]{43}$/.test(raw),
      403,
      "Your sign-in request expired. Sign in again.",
    );
    const found = await authPool.query(
      "SELECT user_id,auth_version FROM login_challenges WHERE token_hash=$1 AND expires_at>now()",
      [hash(raw)],
    );
    requireThat(
      found.rowCount,
      403,
      "Your sign-in request expired. Sign in again.",
    );
    const userId = found.rows[0].user_id;
    await throttle("mfa-proof", userId, 10, 900);
    const result = await createSession(
      userId,
      req,
      reply,
      found.rows[0].auth_version,
      async (db, user) => {
        const challenge = await db.query(
          "DELETE FROM login_challenges WHERE token_hash=$1 AND user_id=$2 AND auth_version=$3 AND expires_at>now() RETURNING user_id",
          [hash(raw), userId, user.auth_version],
        );
        requireThat(
          challenge.rowCount,
          403,
          "Your sign-in request expired. Sign in again.",
        );
        await consumeFactor(db, userId, input.code);
        await audit(db, userId, "auth.mfa.login", userId);
        return true;
      },
    );
    reply.clearCookie(challengeCookie, {
      path: "/",
      secure: production,
      httpOnly: true,
      sameSite: "lax",
    });
    return result;
  });
  app.get("/api/auth/session", async (req) => {
    const user = await authPool.query(
      "SELECT email_verified_at FROM users WHERE id=$1",
      [req.identity.userId],
    );
    return {
      ...req.identity,
      csrf: csrf(req.identity),
      emailVerified: !!user.rows[0]?.email_verified_at,
    };
  });
  app.get("/api/auth/account", async (req) => {
    const result = await authPool.query(
      'SELECT email,email_verified_at AS "emailVerifiedAt",password_hash IS NOT NULL AS "hasPassword",EXISTS(SELECT 1 FROM account_mfa WHERE user_id=users.id AND enabled_at IS NOT NULL) AS "mfaEnabled",(SELECT count(*)::int FROM mfa_recovery_codes WHERE user_id=users.id) AS "recoveryCodesRemaining" FROM users WHERE id=$1 AND deleted_at IS NULL',
      [req.identity.userId],
    );
    requireThat(result.rowCount, 401, "Please sign in again.");
    return result.rows[0];
  });
  app.get("/api/auth/devices", async (req) => {
    const r = await authPool.query(
      "SELECT s.id,d.label,s.created_at,s.last_seen_at,s.expires_at FROM sessions s JOIN devices d ON d.id=s.device_id WHERE s.user_id=$1 AND s.revoked_at IS NULL AND s.expires_at>now() ORDER BY s.last_seen_at DESC LIMIT 50",
      [req.identity.userId],
    );
    return r.rows.map((s) => ({
      id: s.id,
      label: s.label,
      createdAt: s.created_at,
      lastSeen: s.last_seen_at,
      expiresAt: s.expires_at,
      current: s.id === req.identity.sessionId,
    }));
  });
  app.delete("/api/auth/devices/:id", async (req) => {
    const params = z.object({ id }).parse(req.params);
    const db = await authPool.connect();
    try {
      await db.query("BEGIN");
      await lockSessionOwner(db, req.identity);
      const r = await db.query(
        "UPDATE sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id",
        [params.id, req.identity.userId],
      );
      requireThat(r.rowCount);
      await audit(db, req.identity.userId, "auth.session.revoked", params.id);
      await db.query("SELECT pg_notify('noctis_changes',$1)", [
        `user:${req.identity.userId}`,
      ]);
      await db.query("COMMIT");
      return { ok: true };
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  });
  app.post("/api/auth/logout", async (req, reply) => {
    const input = z
      .object({ all: z.boolean().default(false) })
      .strict()
      .parse(req.body);
    const db = await authPool.connect();
    try {
      await db.query("BEGIN");
      await lockSessionOwner(db, req.identity);
      if (input.all) await invalidatePendingLogins(db, req.identity.userId);
      else {
        const pending = req.cookies[challengeCookie];
        if (pending && /^[\w-]{43}$/.test(pending))
          await db.query(
            "DELETE FROM login_challenges WHERE user_id=$1 AND token_hash=$2",
            [req.identity.userId, hash(pending)],
          );
      }
      await db.query(
        "UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND ($2 OR id=$3) AND revoked_at IS NULL",
        [req.identity.userId, input.all, req.identity.sessionId],
      );
      await audit(
        db,
        req.identity.userId,
        input.all ? "auth.sessions.revoked_all" : "auth.logout",
        req.identity.sessionId,
      );
      await db.query("SELECT pg_notify('noctis_changes',$1)", [
        `user:${req.identity.userId}`,
      ]);
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
    reply.clearCookie(cookieName, {
      path: "/",
      httpOnly: true,
      secure: production,
      sameSite: "lax",
    });
    reply.clearCookie(challengeCookie, {
      path: "/",
      httpOnly: true,
      secure: production,
      sameSite: "lax",
    });
    return { ok: true };
  });
  app.patch("/api/auth/password", async (req) => {
    const input = z
      .object({
        currentPassword: z.string().min(1).max(128),
        password: z.string().min(12).max(128),
        code: z.string().trim().max(39).optional(),
      })
      .strict()
      .parse(req.body);
    await throttle("password", req.identity.userId, 5, 900);
    const r = await authPool.query(
      "SELECT password_hash FROM users WHERE id=$1",
      [req.identity.userId],
    );
    requireThat(
      r.rows[0]?.password_hash &&
        (await verify(r.rows[0].password_hash, input.currentPassword)),
      401,
      "Current password is incorrect.",
    );
    const digest = await passwordHash(input.password, passwordOptions);
    await throttle("mfa-proof", req.identity.userId, 10, 900);
    const db = await authPool.connect();
    try {
      await db.query("BEGIN");
      const locked = await db.query(
        "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE",
        [req.identity.userId],
      );
      const session = await db.query(
        "SELECT 1 FROM sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>now()",
        [req.identity.sessionId, req.identity.userId],
      );
      requireThat(
        session.rowCount,
        401,
        "Your session has expired. Please sign in.",
      );
      requireThat(
        locked.rows[0].password_hash === r.rows[0].password_hash,
        403,
        "Your password changed. Try again.",
      );
      const mfa = await db.query(
        "SELECT 1 FROM account_mfa WHERE user_id=$1 AND enabled_at IS NOT NULL",
        [req.identity.userId],
      );
      if (mfa.rowCount) {
        await consumeFactor(db, req.identity.userId, input.code || "");
      }
      await db.query(
        "UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2",
        [digest, req.identity.userId],
      );
      await invalidatePendingLogins(db, req.identity.userId);
      await db.query(
        "DELETE FROM account_tokens WHERE user_id=$1 AND purpose='reset'",
        [req.identity.userId],
      );
      await db.query(
        "UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2",
        [req.identity.userId, req.identity.sessionId],
      );
      await audit(
        db,
        req.identity.userId,
        "auth.password.changed",
        req.identity.userId,
      );
      await db.query("SELECT pg_notify('noctis_changes',$1)", [
        `user:${req.identity.userId}`,
      ]);
      await db.query("COMMIT");
      return { ok: true };
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  });
}
export async function authHook(req: FastifyRequest) {
  const path = req.url.split("?")[0];
  if (
    !path.startsWith("/api/") ||
    path === "/api/realtime" ||
    path === "/api/media/rtc" ||
    path === "/api/media/rtc/v1" ||
    path === "/api/media/rtc/validate" ||
    path === "/api/media/rtc/v1/validate" ||
    [
      "/api/health",
      "/api/ready",
      "/api/auth/login",
      "/api/auth/register",
      "/api/auth/mfa/login",
      "/api/auth/password/forgot",
      "/api/auth/password/reset",
      "/api/auth/email/verify",
      "/api/auth/providers",
    ].includes(path) ||
    /^\/api\/oauth\/[a-z]+\/(start|callback)$/.test(path) ||
    path.startsWith("/api/webhooks/incoming/")
  )
    return;
  if (path.startsWith("/api/auth/")) {
    req.identity = await authenticate(req);
    await throttle("api", req.identity.userId, 600, 60);
  } else {
    req.identity = await authenticateApiRequest(req);
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    verifyOrigin(req);
    const supplied = req.headers["x-csrf-token"];
    requireThat(
      typeof supplied === "string" && equal(supplied, csrf(req.identity)),
      403,
      "This request could not be verified.",
    );
  }
}

