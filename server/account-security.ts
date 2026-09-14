import type { FastifyInstance, FastifyRequest } from "fastify";
import { hash as passwordHash, verify } from "@node-rs/argon2";
import QRCode from "qrcode";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { authPool, audit, type DB } from "./db.js";
import { passwordOptions, throttle, verifyOrigin } from "./auth.js";
import { decrypt, encrypt, hash } from "./crypto.js";
import { requireThat } from "./errors.js";
import {
  consumeFactor,
  invalidatePendingLogins,
  matchingCounter,
  newTotpSecret,
  replaceRecoveryCodes,
} from "./security-core.js";
import { queueAccountToken, queueSecurityMail } from "./security-mail.js";

const tokenSchema = z.string().regex(/^[\w-]{43}$/);
const proofSchema = z
  .object({
    password: z.string().max(128).optional(),
    code: z.string().trim().max(39).optional(),
  })
  .strict();
async function lockedAccount<T>(
  userId: string,
  action: (db: DB, user: any) => Promise<T>,
) {
  const db = await authPool.connect();
  try {
    await db.query("BEGIN");
    const found = await db.query(
      "SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
      [userId],
    );
    requireThat(found.rowCount, 403, "This account is unavailable.");
    const result = await action(db, found.rows[0]);
    await db.query("COMMIT");
    return result;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
async function reauthenticate(
  db: DB,
  user: any,
  req: FastifyRequest,
  password?: string,
) {
  const session = await db.query(
    "SELECT 1 FROM sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>now() AND ($3 OR created_at>now()-interval '5 minutes')",
    [req.identity.sessionId, user.id, !!user.password_hash],
  );
  requireThat(
    session.rowCount,
    403,
    "Sign in again before changing account security.",
  );
  requireThat(
    user.email_verified_at,
    403,
    "Verify your email before continuing.",
  );
  if (user.password_hash)
    requireThat(
      await verify(user.password_hash, password || ""),
      403,
      "Current password is incorrect.",
    );
}
async function changedSecurity(db: DB, userId: string, sessionId?: string) {
  await invalidatePendingLogins(db, userId);
  await db.query(
    "UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND ($2::text IS NULL OR id<>$2) AND revoked_at IS NULL",
    [userId, sessionId || null],
  );
  await db.query("SELECT pg_notify('noctis_changes',$1)", [`user:${userId}`]);
}
export async function accountSecurityRoutes(app: FastifyInstance) {
  app.post("/api/auth/email/resend", async (req) => {
    await throttle("verify-email", req.identity.userId, 3, 900);
    return lockedAccount(req.identity.userId, async (db, user) => {
      if (!user.email_verified_at)
        await queueAccountToken(db, user.id, user.email, "verify");
      return { ok: true };
    });
  });
  app.post("/api/auth/email/verify", async (req) => {
    verifyOrigin(req);
    await throttle("verify-token-ip", req.ip, 30, 900);
    const input = z.object({ token: tokenSchema }).strict().parse(req.body);
    const result = await authPool.query(
      "SELECT user_id FROM account_tokens WHERE token_hash=$1 AND purpose='verify' AND expires_at>now()",
      [hash(input.token)],
    );
    requireThat(
      result.rowCount,
      400,
      "This link expired or was already used. Request a new email.",
    );
    return lockedAccount(result.rows[0].user_id, async (db, user) => {
      const consumed = await db.query(
        "DELETE FROM account_tokens WHERE token_hash=$1 AND purpose='verify' AND expires_at>now() RETURNING user_id",
        [hash(input.token)],
      );
      requireThat(
        consumed.rowCount,
        400,
        "This link expired or was already used. Request a new email.",
      );
      await db.query(
        "UPDATE users SET email_verified_at=coalesce(email_verified_at,now()),updated_at=now() WHERE id=$1",
        [user.id],
      );
      await audit(db, user.id, "auth.email.verified", user.id);
      return { ok: true };
    });
  });
  app.post("/api/auth/password/forgot", async (req) => {
    const started = Date.now();
    verifyOrigin(req);
    await throttle("forgot-ip", req.ip, 10, 900);
    const input = z
      .object({
        email: z
          .string()
          .email()
          .max(254)
          .transform((s) => s.toLowerCase()),
      })
      .strict()
      .parse(req.body);
    await throttle("forgot-account", input.email, 3, 900);
    const user = await authPool.query(
      "SELECT id FROM users WHERE email=$1 AND password_hash IS NOT NULL AND deleted_at IS NULL",
      [input.email],
    );
    if (user.rowCount)
      await lockedAccount(user.rows[0].id, async (db, account) => {
        await queueAccountToken(db, account.id, account.email, "reset");
        await audit(
          db,
          account.id,
          "auth.password.reset_requested",
          account.id,
        );
      });
    // Queued delivery plus a common response floor keeps mailbox existence out of the normal timing path.
    await delay(Math.max(0, 300 - (Date.now() - started)));
    return { ok: true };
  });
  app.post("/api/auth/password/reset", async (req) => {
    verifyOrigin(req);
    await throttle("reset-ip", req.ip, 20, 900);
    const input = z
      .object({
        token: tokenSchema,
        password: z.string().min(12).max(128),
        code: z.string().trim().max(39).optional(),
      })
      .strict()
      .parse(req.body);
    const found = await authPool.query(
      "SELECT user_id FROM account_tokens WHERE token_hash=$1 AND purpose='reset' AND expires_at>now()",
      [hash(input.token)],
    );
    requireThat(
      found.rowCount,
      400,
      "This link expired or was already used. Request a new email.",
    );
    const userId = found.rows[0].user_id;
    await throttle("reset-account", userId, 10, 900);
    await throttle("mfa-proof", userId, 10, 900);
    return lockedAccount(userId, async (db, user) => {
      const consumed = await db.query(
        "DELETE FROM account_tokens WHERE token_hash=$1 AND purpose='reset' AND expires_at>now() RETURNING user_id",
        [hash(input.token)],
      );
      requireThat(
        consumed.rowCount,
        400,
        "This link expired or was already used. Request a new email.",
      );
      const mfa = await db.query(
        "SELECT 1 FROM account_mfa WHERE user_id=$1 AND enabled_at IS NOT NULL",
        [userId],
      );
      if (mfa.rowCount) await consumeFactor(db, userId, input.code || "");
      const digest = await passwordHash(input.password, passwordOptions);
      await db.query(
        "UPDATE users SET password_hash=$2,email_verified_at=coalesce(email_verified_at,now()),updated_at=now() WHERE id=$1",
        [userId, digest],
      );
      await db.query("DELETE FROM account_tokens WHERE user_id=$1", [userId]);
      await changedSecurity(db, userId);
      await audit(db, userId, "auth.password.reset", userId);
      await queueSecurityMail(db, {
        to: user.email,
        subject: "Noctis — Password changed / Senha alterada",
        text: "Your password was changed and all sessions were signed out. If this was not you, reset your password immediately. / Sua senha foi alterada e todas as sessões foram encerradas. Se não foi você, redefina sua senha imediatamente.",
      });
      return { ok: true };
    });
  });
  app.post("/api/auth/mfa/setup", async (req) => {
    const input = proofSchema.pick({ password: true }).parse(req.body);
    await throttle("mfa-manage", req.identity.userId, 10, 900);
    return lockedAccount(req.identity.userId, async (db, user) => {
      await reauthenticate(db, user, req, input.password);
      const existing = await db.query(
        "SELECT enabled_at FROM account_mfa WHERE user_id=$1",
        [user.id],
      );
      requireThat(
        !existing.rows[0]?.enabled_at,
        409,
        "Two-factor authentication is already enabled.",
      );
      const secret = newTotpSecret();
      await db.query(
        "INSERT INTO account_mfa(user_id,secret_encrypted) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET secret_encrypted=excluded.secret_encrypted,setup_expires_at=now()+interval '10 minutes',last_counter=-1",
        [user.id, encrypt(secret, `mfa:${user.id}`)],
      );
      const uri = `otpauth://totp/${encodeURIComponent(`Noctis:${user.email}`)}?secret=${secret}&issuer=Noctis&algorithm=SHA1&digits=6&period=30`;
      return {
        secret,
        qrCode: await QRCode.toDataURL(uri, { width: 224, margin: 2 }),
        expiresIn: 600,
      };
    });
  });
  app.post("/api/auth/mfa/enable", async (req) => {
    const input = proofSchema
      .extend({ code: z.string().regex(/^\d{6}$/) })
      .parse(req.body);
    await throttle("mfa-proof", req.identity.userId, 10, 900);
    await throttle("mfa-manage", req.identity.userId, 10, 900);
    return lockedAccount(req.identity.userId, async (db, user) => {
      await reauthenticate(db, user, req, input.password);
      const result = await db.query(
        "SELECT * FROM account_mfa WHERE user_id=$1 AND enabled_at IS NULL AND setup_expires_at>now() FOR UPDATE",
        [user.id],
      );
      requireThat(
        result.rowCount,
        400,
        "Authenticator setup expired. Start setup again.",
      );
      const counter = matchingCounter(
        decrypt(result.rows[0].secret_encrypted, `mfa:${user.id}`),
        input.code,
      );
      requireThat(
        counter !== null,
        403,
        "Invalid or already used code. Try the next authenticator code or a recovery code.",
      );
      await db.query(
        "UPDATE account_mfa SET enabled_at=now(),last_counter=$2 WHERE user_id=$1",
        [user.id, counter],
      );
      await db.query("UPDATE sessions SET mfa_verified_at=now() WHERE id=$1", [
        req.identity.sessionId,
      ]);
      const recoveryCodes = await replaceRecoveryCodes(db, user.id);
      await changedSecurity(db, user.id, req.identity.sessionId);
      await audit(db, user.id, "auth.mfa.enabled", user.id);
      return { recoveryCodes };
    });
  });
  for (const action of ["disable", "recovery"] as const)
    app.post(`/api/auth/mfa/${action}`, async (req) => {
      const input = proofSchema.parse(req.body);
      await throttle("mfa-proof", req.identity.userId, 10, 900);
      await throttle("mfa-manage", req.identity.userId, 10, 900);
      return lockedAccount(req.identity.userId, async (db, user) => {
        await reauthenticate(db, user, req, input.password);
        await consumeFactor(db, user.id, input.code || "");
        let recoveryCodes: string[] | undefined;
        if (action === "disable") {
          await db.query("DELETE FROM account_mfa WHERE user_id=$1", [user.id]);
          await db.query("DELETE FROM mfa_recovery_codes WHERE user_id=$1", [
            user.id,
          ]);
        } else recoveryCodes = await replaceRecoveryCodes(db, user.id);
        await changedSecurity(db, user.id, req.identity.sessionId);
        await audit(
          db,
          user.id,
          `auth.mfa.${action === "disable" ? "disabled" : "recovery_rotated"}`,
          user.id,
        );
        await queueSecurityMail(db, {
          to: user.email,
          subject:
            "Noctis — Account security changed / Segurança da conta alterada",
          text:
            action === "disable"
              ? "Two-factor authentication was disabled. If this was not you, reset your password immediately. / A autenticação em duas etapas foi desativada. Se não foi você, redefina sua senha imediatamente."
              : "Your recovery codes were replaced. / Seus códigos de recuperação foram substituídos.",
        });
        return { ok: true, ...(recoveryCodes ? { recoveryCodes } : {}) };
      });
    });
}
