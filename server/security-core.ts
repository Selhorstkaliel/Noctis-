import { createHmac, randomBytes } from "node:crypto";
import { decrypt, equal, hash } from "./crypto.js";
import type { DB } from "./db.js";
import { requireThat } from "./errors.js";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function newTotpSecret() {
  const bytes = randomBytes(20);
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  return bits
    .match(/.{5}/g)!
    .map((b) => alphabet[parseInt(b, 2)])
    .join("");
}
// RFC 4226 / RFC 6238: SHA-1, six digits, 30-second steps.
export function totp(secret: string, counter: number, digits = 6) {
  const bits = [...secret]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const value = Buffer.alloc(8);
  value.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(value).digest();
  const offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits)
    .toString()
    .padStart(digits, "0");
}
export function matchingCounter(
  secret: string,
  code: string,
  last = -1,
  now = Date.now(),
) {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 30000);
  for (const counter of [current, current - 1, current + 1])
    if (counter > last && equal(totp(secret, counter), code)) return counter;
  return null;
}
export function recoveryHash(userId: string, code: string) {
  return hash(
    `mfa-recovery:${userId}:${code.replaceAll("-", "").toLowerCase()}`,
  );
}
// Callers hold the user row lock so revocation and session creation are ordered.
export async function invalidatePendingLogins(db: DB, userId: string) {
  await db.query("UPDATE users SET auth_version=auth_version+1 WHERE id=$1", [
    userId,
  ]);
  await db.query("DELETE FROM login_challenges WHERE user_id=$1", [userId]);
}
// Callers hold the user row lock: proofs, recovery consumption and session creation commit together.
export async function consumeFactor(db: DB, userId: string, code: string) {
  const result = await db.query(
    "SELECT * FROM account_mfa WHERE user_id=$1 AND enabled_at IS NOT NULL FOR UPDATE",
    [userId],
  );
  requireThat(
    result.rowCount,
    403,
    "Two-factor authentication is not enabled.",
  );
  const mfa = result.rows[0];
  const counter = matchingCounter(
    decrypt(mfa.secret_encrypted, `mfa:${userId}`),
    code,
    Number(mfa.last_counter),
  );
  if (counter !== null) {
    await db.query("UPDATE account_mfa SET last_counter=$2 WHERE user_id=$1", [
      userId,
      counter,
    ]);
    return;
  }
  if (/^[a-f\d-]{32,39}$/i.test(code)) {
    const recovery = await db.query(
      "DELETE FROM mfa_recovery_codes WHERE user_id=$1 AND code_hash=$2 RETURNING code_hash",
      [userId, recoveryHash(userId, code)],
    );
    if (recovery.rowCount) return;
  }
  requireThat(
    false,
    403,
    "Invalid or already used code. Try the next authenticator code or a recovery code.",
  );
}
export async function replaceRecoveryCodes(db: DB, userId: string) {
  const codes = Array.from({ length: 10 }, () =>
    randomBytes(16).toString("hex").match(/.{8}/g)!.join("-"),
  );
  await db.query("DELETE FROM mfa_recovery_codes WHERE user_id=$1", [userId]);
  for (const code of codes)
    await db.query(
      "INSERT INTO mfa_recovery_codes(user_id,code_hash) VALUES($1,$2)",
      [userId, recoveryHash(userId, code)],
    );
  return codes;
}
