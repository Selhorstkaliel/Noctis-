-- Read-only inspection. Run on the candidate database before provisioning/migrations.
-- No secrets, no application rows, no DDL; safe to review output.
SELECT current_database() AS database, current_user AS connected_role,
       current_setting('server_version') AS version,
       current_setting('search_path') AS search_path;
SELECT e.extname, n.nspname AS extension_schema
FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
WHERE e.extname='pgcrypto';
SELECT to_regprocedure('public.digest(bytea,text)') IS NOT NULL AS public_digest_available;
SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin
FROM pg_roles WHERE rolname IN ('noctis_api','noctis_auth','noctis_worker','noctis_migrator');
SELECT nspname, pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname='noctis';
SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid();
SELECT to_regclass('public.schema_migrations') IS NOT NULL AS migration_history_exists;
