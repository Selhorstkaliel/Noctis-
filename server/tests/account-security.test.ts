import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { buildApp } from "../app.js";
import {
  authPool,
  apiPool,
  workerPool,
  closePools,
  transaction,
} from "../db.js";
import { config } from "../config.js";
import { decrypt, hash } from "../crypto.js";
import { totp } from "../security-core.js";
import { createSession, finishLogin } from "../auth.js";
import { deliverSecurityMail } from "../security-mail.js";
import { maintenance } from "../worker.js";

if (
  config.NODE_ENV !== "test" ||
  !new URL(config.DATABASE_URL).pathname.endsWith("_test")
)
  throw new Error("Security tests require the isolated test database.");
const app = await buildApp();
type Actor = {
  id: string;
  sessionId: string;
  email: string;
  password: string;
  cookie: string;
  csrf: string;
};
let ip = 0;
async function request(
  actor: Actor | undefined,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return app.inject({
    method: body === undefined ? "GET" : "POST",
    url: `/api/auth/${path}`,
    remoteAddress: `192.0.2.${(++ip % 250) + 1}`,
    headers: {
      origin: config.APP_ORIGIN,
      ...(actor ? { cookie: actor.cookie, "x-csrf-token": actor.csrf } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { payload: body as any }),
  });
}
async function mailToken(email: string, purpose: "verify" | "reset") {
  const result = await authPool.query(
    "SELECT * FROM security_mail ORDER BY created_at DESC",
  );
  for (const row of result.rows) {
    const mail = JSON.parse(decrypt(row.payload_encrypted, `mail:${row.id}`));
    if (mail.to === email) {
      const found = mail.text.match(
        new RegExp(`#/${purpose}-email/([\\w-]{43})`),
      );
      if (found) return found[1] as string;
    }
  }
  throw new Error("Expected security email was not queued.");
}
async function actor(verified = true) {
  const suffix = randomUUID();
  const email = `account-${suffix}@example.invalid`,
    password = `Secure-${suffix}`;
  const response = await request(undefined, "register", {
    email,
    password,
    name: "Security account",
    handle: `sec.${suffix.slice(0, 8)}`,
  });
  assert.equal(response.statusCode, 201);
  const data = response.json();
  const value: Actor = {
    id: data.userId,
    sessionId: data.sessionId,
    email,
    password,
    csrf: data.csrf,
    cookie: String(response.headers["set-cookie"]).split(";")[0],
  };
  if (verified)
    assert.equal(
      (
        await request(undefined, "email/verify", {
          token: await mailToken(email, "verify"),
        })
      ).statusCode,
      200,
    );
  return value;
}
async function enroll(a: Actor) {
  const setup = await request(a, "mfa/setup", { password: a.password });
  assert.equal(setup.statusCode, 200, setup.body);
  const secret = setup.json().secret;
  const code = totp(secret, Math.floor(Date.now() / 30000));
  const enabled = await request(a, "mfa/enable", {
    password: a.password,
    code,
  });
  assert.equal(enabled.statusCode, 200, enabled.body);
  return { secret, code, codes: enabled.json().recoveryCodes as string[] };
}
async function challenge(a: Actor) {
  const response = await request(undefined, "login", {
    email: a.email,
    password: a.password,
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { mfaRequired: true });
  const cookie = String(response.headers["set-cookie"]).split(";")[0];
  assert.match(cookie, /^noctis_mfa=/);
  assert.match(String(response.headers["set-cookie"]), /HttpOnly/);
  return cookie;
}
after(async () => {
  await app.close();
  await closePools();
});

test("TOTP matches all RFC 6238 SHA-1 reference vectors", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  for (const [time, expected] of [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ] as const)
    assert.equal(totp(secret, Math.floor(time / 30), 8), expected);
});
test("email confirmation gates API and database access, expires and consumes tokens once", async () => {
  const a = await actor(false);
  assert.equal((await request(a, "session")).json().emailVerified, false);
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: "/api/bootstrap",
        headers: { cookie: a.cookie },
      })
    ).statusCode,
    403,
  );
  await assert.rejects(
    transaction({ userId: a.id, sessionId: a.sessionId }, async () => true),
    /session has expired/,
  );
  const old = await mailToken(a.email, "verify");
  assert.equal(
    (
      await request(
        undefined,
        "email/verify",
        { token: old },
        { origin: "https://evil.invalid" },
      )
    ).statusCode,
    403,
  );
  await request(a, "email/resend", {});
  assert.equal(
    (await request(undefined, "email/verify", { token: old })).statusCode,
    400,
  );
  const token = await mailToken(a.email, "verify");
  const results = await Promise.all([
    request(undefined, "email/verify", { token }),
    request(undefined, "email/verify", { token }),
  ]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 400]);
  assert.equal((await request(a, "session")).json().emailVerified, true);
  const other = await actor(false);
  const expired = await mailToken(other.email, "verify");
  await authPool.query(
    "UPDATE account_tokens SET expires_at=now()-interval '1 second' WHERE user_id=$1",
    [other.id],
  );
  assert.equal(
    (await request(undefined, "email/verify", { token: expired })).statusCode,
    400,
  );
});
test("MFA enrollment requires reauthentication, encrypted seeds, and revokes older sessions", async () => {
  const a = await actor();
  const previous = await request(undefined, "login", {
    email: a.email,
    password: a.password,
  });
  const oldCookie = String(previous.headers["set-cookie"]).split(";")[0];
  assert.equal(
    (await request(a, "mfa/setup", { password: "incorrect" })).statusCode,
    403,
  );
  assert.equal(
    (
      await request(
        a,
        "mfa/setup",
        { password: a.password },
        { "x-csrf-token": "wrong" },
      )
    ).statusCode,
    403,
  );
  const enrolled = await enroll(a);
  assert.equal(
    (await request(undefined, "session", undefined, { cookie: oldCookie }))
      .statusCode,
    401,
  );
  assert.equal((await request(a, "account")).json().mfaEnabled, true);
  const secret = (
    await authPool.query(
      "SELECT secret_encrypted FROM account_mfa WHERE user_id=$1",
      [a.id],
    )
  ).rows[0].secret_encrypted;
  assert.ok(!secret.includes(enrolled.secret));
  assert.equal(enrolled.codes.length, 10);
  await assert.rejects(
    apiPool.query("SELECT * FROM account_mfa"),
    /permission denied/,
  );
  await assert.rejects(
    apiPool.query("SELECT * FROM account_tokens"),
    /permission denied/,
  );
  const c = await challenge(a);
  assert.equal(
    (
      await request(
        undefined,
        "mfa/login",
        { code: enrolled.code },
        { cookie: c },
      )
    ).statusCode,
    403,
  );
  const login = await request(
    undefined,
    "mfa/login",
    { code: enrolled.codes[0] },
    { cookie: c },
  );
  assert.equal(login.statusCode, 200, login.body);
  assert.equal(
    (
      await request(
        undefined,
        "mfa/login",
        { code: enrolled.codes[1] },
        { cookie: c },
      )
    ).statusCode,
    403,
  );
  const next = await challenge(a);
  assert.equal(
    (
      await request(
        undefined,
        "mfa/login",
        { code: enrolled.codes[0] },
        { cookie: next },
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await request(
        undefined,
        "mfa/login",
        { code: enrolled.codes[1] },
        { cookie: next, origin: "https://evil.invalid" },
      )
    ).statusCode,
    403,
  );
  const attempts = await Promise.all([
    request(
      undefined,
      "mfa/login",
      { code: enrolled.codes[1] },
      { cookie: next },
    ),
    request(
      undefined,
      "mfa/login",
      { code: enrolled.codes[1] },
      { cookie: next },
    ),
  ]);
  assert.deepEqual(attempts.map((r) => r.statusCode).sort(), [200, 403]);
});
test("password reset is generic, retains MFA, invalidates sessions and challenges, and rejects replay", async () => {
  const a = await actor();
  const { codes } = await enroll(a);
  const c = await challenge(a);
  const known = await request(undefined, "password/forgot", { email: a.email });
  const unknown = await request(undefined, "password/forgot", {
    email: `${randomUUID()}@example.invalid`,
  });
  assert.equal(known.statusCode, unknown.statusCode);
  assert.deepEqual(known.json(), unknown.json());
  const token = await mailToken(a.email, "reset");
  assert.equal(
    (await request(undefined, "email/verify", { token })).statusCode,
    400,
  );
  const password = `New-${randomUUID()}`;
  assert.equal(
    (await request(undefined, "password/reset", { token, password }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await request(undefined, "password/reset", {
        token,
        password,
        code: codes[0],
      })
    ).statusCode,
    200,
  );
  assert.equal((await request(a, "session")).statusCode, 401);
  assert.equal(
    (await request(undefined, "mfa/login", { code: codes[1] }, { cookie: c }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await request(undefined, "password/reset", {
        token,
        password,
        code: codes[1],
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await request(undefined, "login", {
        email: a.email,
        password: a.password,
      })
    ).statusCode,
    401,
  );
  a.password = password;
  await challenge(a);
});
test("factor removal and recovery replacement require a factor and invalidate old recovery codes", async () => {
  const a = await actor();
  const { codes } = await enroll(a);
  assert.equal(
    (await request(a, "mfa/disable", { password: a.password })).statusCode,
    403,
  );
  const rotated = await request(a, "mfa/recovery", {
    password: a.password,
    code: codes[0],
  });
  assert.equal(rotated.statusCode, 200, rotated.body);
  assert.equal(
    (await request(a, "mfa/disable", { password: a.password, code: codes[1] }))
      .statusCode,
    403,
  );
  const disabled = await request(a, "mfa/disable", {
    password: a.password,
    code: rotated.json().recoveryCodes[0],
  });
  assert.equal(disabled.statusCode, 200, disabled.body);
  assert.equal((await request(a, "account")).json().mfaEnabled, false);
});
test("shared OAuth login completion also requires MFA and expired challenges cannot authenticate", async () => {
  const a = await actor();
  const { codes } = await enroll(a);
  // Exercise the same function invoked after verified Google/GitHub identity, without a network provider stub.
  const reply = { setCookie() {} } as any;
  const user = (
    await authPool.query("SELECT auth_version FROM users WHERE id=$1", [a.id])
  ).rows[0];
  assert.deepEqual(
    await finishLogin(a.id, {} as any, reply, {
      authVersion: user.auth_version,
    }),
    {
      mfaRequired: true,
    },
  );
  const c = await challenge(a);
  await authPool.query(
    "UPDATE login_challenges SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
    [hash(c.split("=")[1])],
  );
  assert.equal(
    (await request(undefined, "mfa/login", { code: codes[0] }, { cookie: c }))
      .statusCode,
    403,
  );
});
test("logout-all invalidates pending MFA logins without consuming recovery codes", async () => {
  const a = await actor();
  const { codes } = await enroll(a);
  const pending = await challenge(a);
  const logout = await request(a, "logout", { all: true });
  assert.equal(logout.statusCode, 200, logout.body);
  assert.equal((await request(a, "session")).statusCode, 401);
  const replay = await request(
    undefined,
    "mfa/login",
    { code: codes[0] },
    { cookie: pending },
  );
  assert.equal(replay.statusCode, 403, replay.body);
  assert.equal(
    (
      await authPool.query("SELECT 1 FROM login_challenges WHERE user_id=$1", [
        a.id,
      ])
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await authPool.query(
        "SELECT 1 FROM mfa_recovery_codes WHERE user_id=$1",
        [a.id],
      )
    ).rowCount,
    10,
  );
  await assert.rejects(
    transaction({ userId: a.id, sessionId: a.sessionId }, async () => true),
    /session has expired/,
  );
  const fresh = await challenge(a);
  const login = await request(
    undefined,
    "mfa/login",
    { code: codes[0] },
    { cookie: fresh },
  );
  assert.equal(login.statusCode, 200, login.body);
});

async function waitForLockedRequests(count: number) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const result = await authPool.query(
      "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user AND wait_event_type='Lock'",
    );
    if (result.rows[0].waiting >= count) return;
    await delay(10);
  }
  assert.fail("Expected concurrent requests to wait for the account lock.");
}

for (const mfa of [false, true])
  test(`logout-all fences a concurrent password login with MFA ${mfa ? "enabled" : "disabled"}`, async () => {
    const a = await actor();
    if (mfa) await enroll(a);
    const lock = await authPool.connect();
    const pending: ReturnType<typeof request>[] = [];
    let responses: Awaited<ReturnType<typeof request>>[] = [];
    try {
      await lock.query("BEGIN");
      await lock.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [a.id]);
      pending.push(request(a, "logout", { all: true }));
      await waitForLockedRequests(1);
      pending.push(
        request(undefined, "login", { email: a.email, password: a.password }),
      );
      await waitForLockedRequests(2);
    } finally {
      await lock.query("ROLLBACK");
      lock.release();
      responses = await Promise.all(pending);
    }
    assert.equal(responses[0].statusCode, 200);
    assert.equal(responses[1].statusCode, 401);
    assert.equal(responses[1].headers["set-cookie"], undefined);
    assert.equal(
      (
        await authPool.query(
          "SELECT 1 FROM sessions WHERE user_id=$1 AND revoked_at IS NULL",
          [a.id],
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await authPool.query(
          "SELECT 1 FROM login_challenges WHERE user_id=$1",
          [a.id],
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await request(undefined, "login", {
          email: a.email,
          password: a.password,
        })
      ).statusCode,
      200,
    );
  });

test("logout-all rechecks a session revoked while another request was waiting", async () => {
  const a = await actor();
  const version = (
    await authPool.query("SELECT auth_version FROM users WHERE id=$1", [a.id])
  ).rows[0].auth_version;
  const lock = await authPool.connect();
  const pending: ReturnType<typeof request>[] = [];
  let responses: Awaited<ReturnType<typeof request>>[] = [];
  try {
    await lock.query("BEGIN");
    await lock.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [a.id]);
    pending.push(request(a, "logout", { all: true }));
    await waitForLockedRequests(1);
    pending.push(request(a, "logout", { all: true }));
    await waitForLockedRequests(2);
  } finally {
    await lock.query("ROLLBACK");
    lock.release();
    responses = await Promise.all(pending);
  }
  assert.deepEqual(
    responses.map((r) => r.statusCode),
    [200, 401],
  );
  assert.equal(
    (await authPool.query("SELECT auth_version FROM users WHERE id=$1", [a.id]))
      .rows[0].auth_version,
    version + 1,
  );
});

test("retired OAuth and session-creation proofs cannot reopen access after logout-all", async () => {
  const a = await actor();
  const user = (
    await authPool.query("SELECT auth_version FROM users WHERE id=$1", [a.id])
  ).rows[0];
  assert.equal((await request(a, "logout", { all: true })).statusCode, 200);
  const req = { headers: {} } as any;
  const reply = {
    setCookie() {
      assert.fail("A retired proof must not issue a cookie.");
    },
  } as any;
  await assert.rejects(
    finishLogin(a.id, req, reply, { authVersion: user.auth_version }),
    { statusCode: 401 },
  );
  await assert.rejects(createSession(a.id, req, reply, user.auth_version), {
    statusCode: 401,
  });
});

test("single-session logout preserves other sessions and other browsers' MFA challenges", async () => {
  const a = await actor();
  const { codes } = await enroll(a);
  const secondLogin = await request(
    undefined,
    "mfa/login",
    { code: codes[0] },
    { cookie: await challenge(a) },
  );
  assert.equal(secondLogin.statusCode, 200);
  const secondCookie = String(secondLogin.headers["set-cookie"]).split(";")[0];
  const localChallenge = await challenge(a);
  const remoteChallenge = await challenge(a);
  const logout = await request(
    a,
    "logout",
    { all: false },
    { cookie: `${a.cookie}; ${localChallenge}` },
  );
  assert.equal(logout.statusCode, 200);
  assert.match(String(logout.headers["set-cookie"]), /noctis_mfa=;/);
  assert.equal((await request(a, "session")).statusCode, 401);
  assert.equal(
    (await request(undefined, "session", undefined, { cookie: secondCookie }))
      .statusCode,
    200,
  );
  assert.equal(
    (
      await request(
        undefined,
        "mfa/login",
        { code: codes[1] },
        { cookie: localChallenge },
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await request(
        undefined,
        "mfa/login",
        { code: codes[1] },
        { cookie: remoteChallenge },
      )
    ).statusCode,
    200,
  );
});

test("remote device revocation checks ownership and preserves the current session", async () => {
  const a = await actor();
  const stranger = await actor();
  const secondLogin = await request(undefined, "login", {
    email: a.email,
    password: a.password,
  });
  const secondCookie = String(secondLogin.headers["set-cookie"]).split(";")[0];
  const sessionId = secondLogin.json().sessionId;
  const revoke = (owner: Actor) =>
    app.inject({
      method: "DELETE",
      url: `/api/auth/devices/${sessionId}`,
      headers: {
        origin: config.APP_ORIGIN,
        cookie: owner.cookie,
        "x-csrf-token": owner.csrf,
      },
    });
  assert.equal((await revoke(stranger)).statusCode, 404);
  assert.equal(
    (await request(undefined, "session", undefined, { cookie: secondCookie }))
      .statusCode,
    200,
  );
  assert.equal((await revoke(a)).statusCode, 200);
  assert.equal(
    (await request(undefined, "session", undefined, { cookie: secondCookie }))
      .statusCode,
    401,
  );
  assert.equal((await request(a, "session")).statusCode, 200);
});

test("worker maintenance expires account tokens and login challenges without reading their secrets", async () => {
  const a = await actor(false);
  const activeToken = hash(randomUUID());
  const expiredChallenge = hash(randomUUID());
  const activeChallenge = hash(randomUUID());
  await authPool.query(
    "UPDATE account_tokens SET expires_at=now()-interval '1 minute' WHERE user_id=$1",
    [a.id],
  );
  await authPool.query(
    "INSERT INTO account_tokens(user_id,purpose,token_hash,expires_at) VALUES($1,'reset',$2,now()+interval '20 minutes')",
    [a.id, activeToken],
  );
  await authPool.query(
    "INSERT INTO login_challenges(user_id,auth_version,token_hash,expires_at) VALUES($1,0,$2,now()-interval '1 minute'),($1,0,$3,now()+interval '5 minutes')",
    [a.id, expiredChallenge, activeChallenge],
  );

  await maintenance();

  for (const [table, active] of [
    ["account_tokens", activeToken],
    ["login_challenges", activeChallenge],
  ]) {
    const result = await authPool.query(
      `SELECT token_hash FROM ${table} WHERE user_id=$1`,
      [a.id],
    );
    assert.deepEqual(
      result.rows.map((row) => row.token_hash),
      [active],
    );
    await assert.rejects(workerPool.query(`SELECT token_hash FROM ${table}`), {
      code: "42501",
    });
    await assert.rejects(workerPool.query(`SELECT user_id FROM ${table}`), {
      code: "42501",
    });
    await assert.rejects(apiPool.query(`SELECT expires_at FROM ${table}`), {
      code: "42501",
    });
  }
});

test("local mail delivery writes the actual message without exposing it through the API", async () => {
  const a = await actor(false);
  for (let count = 0; count < 200 && (await deliverSecurityMail()); count++) {
    /* bounded outbox drain */
  }
  const files = await readdir(join(config.STORAGE_PATH, "mail"));
  let delivered = false;
  for (const file of files) {
    const mail = JSON.parse(
      await readFile(join(config.STORAGE_PATH, "mail", file), "utf8"),
    );
    if (mail.to === a.email) delivered = true;
  }
  assert.ok(delivered);
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: "/mail",
        headers: { cookie: a.cookie },
      })
    ).statusCode,
    404,
  );
});
