import "dotenv/config";
import { config, production } from "../server/config.ts";
import { apiPool, authPool, workerPool, closePools } from "../server/db.ts";

// Read-only checks against the configured environment. Never print credentials or provider responses.
const checks = [];
const check = (name, passed) => checks.push({ name, passed: !!passed });
try {
  check("production configuration", production);
  check("HTTPS origin", config.APP_ORIGIN.startsWith("https://"));
  check("verified database TLS configured", config.DATABASE_SSL === "true");
  check(
    "SMTP delivery configured",
    config.MAIL_TRANSPORT === "smtp" &&
      !!config.SMTP_HOST &&
      !!config.SMTP_USER &&
      !!config.SMTP_PASSWORD,
  );
  check(
    "distinct encryption and session keys",
    config.ENCRYPTION_KEY !== config.SESSION_SECRET,
  );
  const roleNames = [];
  for (const [label, pool] of [
    ["api", apiPool],
    ["auth", authPool],
    ["worker", workerPool],
  ]) {
    const role = await pool.query(
      "SELECT rolname,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user",
    );
    roleNames.push(role.rows[0].rolname);
    check(
      `${label} restricted database role`,
      !role.rows[0].rolsuper &&
        !role.rows[0].rolbypassrls &&
        !role.rows[0].rolcreaterole &&
        !role.rows[0].rolcreatedb,
    );
    const tls = await pool.query(
      "SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()",
    );
    check(`${label} active TLS connection`, tls.rows[0]?.ssl);
  }
  check("separate runtime roles", new Set(roleNames).size === 3);
  const owner = await apiPool.query(
    "SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='noctis' AND c.relkind='r' AND pg_has_role(current_user,c.relowner,'USAGE')) AS owns_tables",
  );
  check("API cannot inherit table ownership", !owner.rows[0].owns_tables);
  const access = await apiPool.query(
    "SELECT has_table_privilege(current_user,'noctis.account_mfa','SELECT') OR has_table_privilege(current_user,'noctis.account_tokens','SELECT') AS exposed",
  );
  check("API cannot read MFA or recovery tokens", !access.rows[0].exposed);
  const context = await apiPool.query("SELECT noctis.session_valid() AS valid");
  check("database denies missing identity", !context.rows[0].valid);
  if (production) {
    const response = await fetch(`${config.APP_ORIGIN}/api/health`, {
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    check("public HTTPS health", response.ok);
    check(
      "public HSTS",
      /max-age=\d+/.test(
        response.headers.get("strict-transport-security") || "",
      ),
    );
    check("public CSP", !!response.headers.get("content-security-policy"));
    check(
      "public nosniff",
      response.headers.get("x-content-type-options") === "nosniff",
    );
  }
} catch {
  checks.push({ name: "environment checks completed", passed: false });
} finally {
  await closePools();
}
console.log(
  JSON.stringify({ verified: checks.every((c) => c.passed), checks }, null, 2),
);
if (checks.some((c) => !c.passed)) process.exitCode = 1;
