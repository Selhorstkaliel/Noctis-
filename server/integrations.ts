import { randomUUID, createHash, createHmac } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { config, production } from "./config.js";
import { authPool, workerPool, transaction, audit, changed } from "./db.js";
import {
  authenticate,
  finishLogin,
  sessionLive,
  throttle,
  verifyOrigin,
} from "./auth.js";
import { token, hash, equal, encrypt, decrypt } from "./crypto.js";
import { requireThat, id, text, HttpError } from "./errors.js";
import { permit, channel } from "./authorization.js";
const providerId = z.enum([
  "github",
  "google",
  "calendar",
  "spotify",
  "youtube",
  "twitch",
]);
type Provider = z.infer<typeof providerId>;
type ProviderConfig = {
  key: string;
  authorize: string;
  token: string;
  scope: string;
  pkce: boolean;
};
export const providers: Record<Provider, ProviderConfig> = {
  github: {
    key: "GITHUB",
    authorize: "https://github.com/login/oauth/authorize",
    token: "https://github.com/login/oauth/access_token",
    scope: "read:user user:email",
    pkce: true,
  },
  google: {
    key: "GOOGLE",
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    pkce: true,
  },
  calendar: {
    key: "GOOGLE",
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/calendar.readonly",
    pkce: true,
  },
  spotify: {
    key: "SPOTIFY",
    authorize: "https://accounts.spotify.com/authorize",
    token: "https://accounts.spotify.com/api/token",
    scope: "user-read-currently-playing",
    pkce: true,
  },
  youtube: {
    key: "GOOGLE",
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/youtube.readonly",
    pkce: true,
  },
  twitch: {
    key: "TWITCH",
    authorize: "https://id.twitch.tv/oauth2/authorize",
    token: "https://id.twitch.tv/oauth2/token",
    scope: "user:read:follows",
    pkce: false,
  },
};
export const enabled = (p: Provider) =>
  !!process.env[`${providers[p].key}_CLIENT_ID`] &&
  !!process.env[`${providers[p].key}_CLIENT_SECRET`];
const allowedHosts = new Set([
  "github.com",
  "api.github.com",
  "accounts.google.com",
  "oauth2.googleapis.com",
  "openidconnect.googleapis.com",
  "www.googleapis.com",
  "accounts.spotify.com",
  "api.spotify.com",
  "id.twitch.tv",
  "api.twitch.tv",
]);
export async function boundedFetch(url: string, options: RequestInit = {}) {
  const target = new URL(url);
  requireThat(
    target.protocol === "https:" &&
      allowedHosts.has(target.hostname) &&
      (!target.port || target.port === "443") &&
      !target.username &&
      !target.password,
    400,
    "External destination is not allowed.",
  );
  const response = await fetch(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(8000),
    headers: {
      Accept: "application/json",
      "User-Agent": "Noctis/1.0",
      ...options.headers,
    },
  });
  requireThat(
    response.ok,
    502,
    "The provider could not complete this request.",
  );
  if (response.status === 204) return null;
  const reader = response.body?.getReader();
  requireThat(reader, 502, "Empty provider response.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      bytes += r.value.byteLength;
      requireThat(
        bytes <= 512 * 1024,
        502,
        "Provider response exceeded its limit.",
      );
      chunks.push(r.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(502, "The provider returned an invalid response.");
  }
}
const tokenSchema = z.object({
  access_token: z.string().min(1).max(8192),
  refresh_token: z.string().max(8192).optional(),
  expires_in: z.coerce.number().int().min(1).max(31536000).optional(),
  token_type: z.string().optional(),
});
export async function exchange(
  provider: Provider,
  fields: Record<string, string>,
) {
  const p = providers[provider];
  return tokenSchema.parse(
    await boundedFetch(p.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env[`${p.key}_CLIENT_ID`]!,
        ...(provider === "spotify" && fields.code_verifier
          ? {}
          : { client_secret: process.env[`${p.key}_CLIENT_SECRET`]! }),
        ...fields,
      }),
    }),
  );
}
async function start(
  provider: Provider,
  purpose: "login" | "integration",
  req: FastifyRequest,
  reply: FastifyReply,
) {
  requireThat(enabled(provider), 503, "This provider is not configured.");
  if (purpose === "login")
    requireThat(
      provider === "github" || provider === "google",
      400,
      "This provider is available for integrations only.",
    );
  const identity =
    purpose === "integration" ? await authenticate(req) : undefined;
  const state = token();
  const verifier = token();
  const stateId = randomUUID();
  await authPool.query(
    "INSERT INTO oauth_states(id,state_hash,provider,user_id,session_id,purpose,verifier_encrypted,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '10 minutes')",
    [
      stateId,
      hash(state),
      provider,
      identity?.userId || null,
      identity?.sessionId || null,
      purpose,
      encrypt(verifier, stateId),
    ],
  );
  reply.setCookie(production ? "__Host-noctis-oauth" : "noctis_oauth", state, {
    httpOnly: true,
    secure: production,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  const p = providers[provider];
  const url = new URL(p.authorize);
  url.search = new URLSearchParams({
    client_id: process.env[`${p.key}_CLIENT_ID`]!,
    redirect_uri: `${config.APP_ORIGIN}/api/oauth/${provider}/callback`,
    response_type: "code",
    scope: p.scope,
    state,
    ...(p.pkce
      ? {
          code_challenge: createHash("sha256")
            .update(verifier)
            .digest("base64url"),
          code_challenge_method: "S256",
        }
      : {}),
    ...(p.key === "GOOGLE"
      ? { access_type: "offline", prompt: "consent" }
      : {}),
  }).toString();
  return { url: url.toString() };
}
export async function integrationRoutes(app: FastifyInstance) {
  app.get("/api/auth/providers", async () =>
    Object.keys(providers).map((p) => ({
      id: p,
      enabled: enabled(p as Provider),
      login: p === "github" || p === "google",
    })),
  );
  app.get("/api/oauth/:provider/start", async (req, reply) => {
    const p = z.object({ provider: providerId }).parse(req.params);
    const q = z
      .object({ purpose: z.enum(["login", "integration"]).default("login") })
      .strict()
      .parse(req.query);
    const referer = req.headers.referer;
    requireThat(
      referer && new URL(referer).origin === config.APP_ORIGIN,
      403,
      "Start this connection from Noctis.",
    );
    await throttle("oauth-start", req.ip, 20, 300);
    const result = await start(p.provider, q.purpose, req, reply);
    return reply.redirect(result.url);
  });
  app.post("/api/integrations/:provider/connect", async (req, reply) => {
    const p = z.object({ provider: providerId }).parse(req.params);
    z.object({}).strict().parse(req.body);
    requireThat(p.provider !== "google", 400, "Choose a specific integration.");
    return start(p.provider, "integration", req, reply);
  });
  app.get("/api/oauth/:provider/callback", async (req, reply) => {
    const p = z.object({ provider: providerId }).parse(req.params);
    const q = z
      .object({
        code: z.string().min(1).max(2048).optional(),
        state: z.string().regex(/^[\w-]{43}$/),
        error: z.string().max(200).optional(),
        scope: z.string().max(2048).optional(),
        authuser: z.string().max(10).optional(),
        prompt: z.string().max(40).optional(),
      })
      .strict()
      .parse(req.query);
    const cookie = production ? "__Host-noctis-oauth" : "noctis_oauth";
    requireThat(
      typeof req.cookies[cookie] === "string" &&
        equal(req.cookies[cookie]!, q.state),
      403,
      "This connection request could not be verified.",
    );
    reply.clearCookie(cookie, { path: "/" });
    const db = await authPool.connect();
    let state: any;
    try {
      await db.query("BEGIN");
      const r = await db.query(
        "DELETE FROM oauth_states WHERE state_hash=$1 AND provider=$2 AND expires_at>now() RETURNING *",
        [hash(q.state), p.provider],
      );
      requireThat(r.rowCount, 403, "This connection request has expired.");
      state = r.rows[0];
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
    if (q.error)
      return reply.redirect(
        `${config.APP_ORIGIN}/#/integrations?connection=cancelled`,
      );
    requireThat(
      q.code,
      400,
      "The provider did not return an authorization code.",
    );
    if (state.purpose === "integration") {
      const identity = await authenticate(req);
      requireThat(
        identity.userId === state.user_id &&
          identity.sessionId === state.session_id,
        403,
        "Sign in again to connect this provider.",
      );
    }
    const tokens = await exchange(p.provider, {
      grant_type: "authorization_code",
      code: q.code,
      redirect_uri: `${config.APP_ORIGIN}/api/oauth/${p.provider}/callback`,
      ...(providers[p.provider].pkce
        ? { code_verifier: decrypt(state.verifier_encrypted, state.id) }
        : {}),
    });
    if (state.purpose === "login") {
      let subject: string, email: string, name: string;
      if (p.provider === "github") {
        const account = z
          .object({
            id: z.number().int(),
            name: z.string().nullable(),
            login: z.string(),
          })
          .parse(
            await boundedFetch("https://api.github.com/user", {
              headers: { Authorization: `Bearer ${tokens.access_token}` },
            }),
          );
        const emails = z
          .array(
            z.object({
              email: z.string().email(),
              primary: z.boolean(),
              verified: z.boolean(),
            }),
          )
          .parse(
            await boundedFetch("https://api.github.com/user/emails", {
              headers: { Authorization: `Bearer ${tokens.access_token}` },
            }),
          );
        const chosen = emails.find((e) => e.verified && e.primary);
        requireThat(chosen, 403, "A verified provider email is required.");
        subject = String(account.id);
        email = chosen.email.toLowerCase();
        name = (account.name || account.login).slice(0, 60);
      } else {
        const account = z
          .object({
            sub: z.string().max(200),
            email: z.string().email(),
            email_verified: z.boolean(),
            name: z.string().max(200),
          })
          .parse(
            await boundedFetch(
              "https://openidconnect.googleapis.com/v1/userinfo",
              { headers: { Authorization: `Bearer ${tokens.access_token}` } },
            ),
          );
        requireThat(
          account.email_verified,
          403,
          "A verified provider email is required.",
        );
        subject = account.sub;
        email = account.email.toLowerCase();
        name = account.name.slice(0, 60);
      }
      const auth = await authPool.connect();
      let userId: string;
      let authVersion: number;
      try {
        await auth.query("BEGIN");
        await auth.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [`${p.provider}:${subject}`],
        );
        const existing = await auth.query(
          "SELECT user_id FROM oauth_accounts WHERE provider=$1 AND subject=$2",
          [p.provider, subject],
        );
        if (existing.rowCount) userId = existing.rows[0].user_id;
        else {
          requireThat(
            !(await auth.query("SELECT id FROM users WHERE email=$1", [email]))
              .rowCount,
            409,
            "This email already has an account. Sign in with its existing method.",
          );
          userId = randomUUID();
          await auth.query(
            "INSERT INTO users(id,email,email_verified_at) VALUES($1,$2,now())",
            [userId, email],
          );
          await auth.query(
            "INSERT INTO profiles(user_id,name,handle) VALUES($1,$2,$3)",
            [userId, name, `member.${randomUUID().slice(0, 12)}`],
          );
          await auth.query(
            "INSERT INTO oauth_accounts(provider,subject,user_id) VALUES($1,$2,$3)",
            [p.provider, subject, userId],
          );
        }
        // Only the exact account email proven by this provider is considered verified.
        await auth.query(
          "UPDATE users SET email_verified_at=coalesce(email_verified_at,now()) WHERE id=$1 AND email=$2",
          [userId, email],
        );
        const account = await auth.query(
          "SELECT auth_version FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
          [userId],
        );
        requireThat(account.rowCount, 401, "Please sign in again.");
        authVersion = account.rows[0].auth_version;
        await audit(auth, userId, "auth.oauth.login", p.provider);
        await auth.query("COMMIT");
      } catch (e) {
        await auth.query("ROLLBACK");
        throw e;
      } finally {
        auth.release();
      }
      const login = await finishLogin(userId, req, reply, { authVersion });
      return reply.redirect(
        `${config.APP_ORIGIN}/#/${"mfaRequired" in login ? "mfa" : "home"}`,
      );
    }
    requireThat(
      await sessionLive({ userId: state.user_id, sessionId: state.session_id }),
      401,
      "This session is no longer valid.",
    );
    const worker = await workerPool.connect();
    try {
      await worker.query("BEGIN");
      const r = await worker.query(
        "INSERT INTO integrations(user_id,provider) VALUES($1,$2) ON CONFLICT(user_id,provider) DO UPDATE SET status='connected' RETURNING id",
        [state.user_id, p.provider],
      );
      const integrationId = r.rows[0].id;
      await worker.query(
        "INSERT INTO integration_credentials(integration_id,access_encrypted,refresh_encrypted,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(integration_id) DO UPDATE SET access_encrypted=excluded.access_encrypted,refresh_encrypted=coalesce(excluded.refresh_encrypted,integration_credentials.refresh_encrypted),expires_at=excluded.expires_at,updated_at=now()",
        [
          integrationId,
          encrypt(tokens.access_token, `${integrationId}:access`),
          tokens.refresh_token
            ? encrypt(tokens.refresh_token, `${integrationId}:refresh`)
            : null,
          tokens.expires_in
            ? new Date(Date.now() + tokens.expires_in * 1000)
            : null,
        ],
      );
      await worker.query(
        "INSERT INTO jobs(kind,integration_id) VALUES('integration',$1)",
        [integrationId],
      );
      await audit(worker, state.user_id, "integration.connected", p.provider);
      await changed(worker, `user:${state.user_id}`);
      await worker.query("COMMIT");
    } catch (e) {
      await worker.query("ROLLBACK");
      throw e;
    } finally {
      worker.release();
    }
    return reply.redirect(`${config.APP_ORIGIN}/#/integrations`);
  });
  app.delete("/api/integrations/:provider", (req) =>
    transaction(req.identity, async (db) => {
      const p = z.object({ provider: providerId }).parse(req.params);
      await db.query(
        "DELETE FROM integrations WHERE provider=$1 AND user_id=$2",
        [p.provider, req.identity.userId],
      );
      await audit(
        db,
        req.identity.userId,
        "integration.disconnected",
        p.provider,
      );
      await changed(db, `user:${req.identity.userId}`);
      return { ok: true };
    }),
  );
  app.post("/api/servers/:id/webhooks", (req) =>
    transaction(req.identity, async (db) => {
      const p = z.object({ id }).parse(req.params);
      const input = z
        .object({ channelId: id, name: text.max(80) })
        .strict()
        .parse(req.body);
      await permit(db, p.id, "MANAGE_SERVER");
      const c = await channel(db, input.channelId, "SEND_MESSAGES");
      requireThat(
        c.server_id === p.id && c.kind === "text",
        400,
        "Choose a text channel in this server.",
      );
      const webhookId = randomUUID();
      const secret = token();
      await db.query(
        "INSERT INTO webhooks(id,server_id,channel_id,created_by,name,secret_encrypted) VALUES($1,$2,$3,$4,$5,$6)",
        [
          webhookId,
          p.id,
          c.id,
          req.identity.userId,
          input.name,
          encrypt(secret, webhookId),
        ],
      );
      await audit(db, req.identity.userId, "webhook.created", webhookId, p.id);
      return {
        id: webhookId,
        secret,
        url: `${config.APP_ORIGIN}/api/webhooks/incoming/${webhookId}`,
      };
    }),
  );
  app.get("/api/servers/:id/webhooks", (req) =>
    transaction(req.identity, async (db) => {
      const p = z.object({ id }).parse(req.params);
      await permit(db, p.id, "MANAGE_SERVER");
      return (
        await db.query(
          'SELECT id,name,channel_id AS "channelId",created_at AS "createdAt",revoked_at AS "revokedAt" FROM webhooks WHERE server_id=$1',
          [p.id],
        )
      ).rows;
    }),
  );
  app.delete("/api/servers/:id/webhooks/:hook", (req) =>
    transaction(req.identity, async (db) => {
      const p = z.object({ id, hook: id }).parse(req.params);
      await permit(db, p.id, "MANAGE_SERVER");
      requireThat(
        (
          await db.query(
            "UPDATE webhooks SET revoked_at=now() WHERE id=$1 AND server_id=$2 RETURNING id",
            [p.hook, p.id],
          )
        ).rowCount,
      );
      await audit(db, req.identity.userId, "webhook.revoked", p.hook, p.id);
      return { ok: true };
    }),
  );
  app.post("/api/webhooks/incoming/:id", async (req, reply) => {
    const p = z.object({ id }).parse(req.params);
    await throttle("webhook-ip", req.ip, 100, 60);
    await throttle("webhook", p.id, 30, 60);
    const headers = z
      .object({
        "x-noctis-timestamp": z.string().regex(/^\d{10}$/),
        "x-noctis-delivery": id,
        "x-noctis-signature": z.string().regex(/^[a-f\d]{64}$/),
      })
      .parse(req.headers);
    requireThat(
      Math.abs(Date.now() / 1000 - Number(headers["x-noctis-timestamp"])) < 300,
      401,
      "Webhook verification failed.",
    );
    const db = await workerPool.connect();
    try {
      await db.query("BEGIN");
      const r = await db.query(
        "SELECT * FROM webhooks WHERE id=$1 AND revoked_at IS NULL FOR UPDATE",
        [p.id],
      );
      requireThat(r.rowCount, 401, "Webhook verification failed.");
      const hook = r.rows[0];
      const expected = createHmac(
        "sha256",
        decrypt(hook.secret_encrypted, hook.id),
      )
        .update(
          `${headers["x-noctis-timestamp"]}.${headers["x-noctis-delivery"]}.`,
        )
        .update(req.rawBody)
        .digest("hex");
      requireThat(
        equal(expected, headers["x-noctis-signature"]),
        401,
        "Webhook verification failed.",
      );
      const allowed = await db.query(
        "SELECT noctis.has_permission($1,'MANAGE_SERVER',$2) AND noctis.channel_permission($3,'SEND_MESSAGES',$2) AS allowed",
        [hook.server_id, hook.created_by, hook.channel_id],
      );
      requireThat(
        allowed.rows[0].allowed,
        403,
        "Webhook authorization is no longer valid.",
      );
      const input = z
        .object({ text: text.max(3500) })
        .strict()
        .parse(req.body);
      const delivery = await db.query(
        "INSERT INTO webhook_deliveries(webhook_id,delivery_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING delivery_id",
        [p.id, headers["x-noctis-delivery"]],
      );
      requireThat(
        delivery.rowCount,
        409,
        "This delivery has already been received.",
      );
      await db.query(
        "INSERT INTO jobs(kind,webhook_id,body) VALUES('webhook',$1,$2)",
        [p.id, input.text],
      );
      await db.query("COMMIT");
      reply.code(202);
      return { accepted: true };
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  });
}
