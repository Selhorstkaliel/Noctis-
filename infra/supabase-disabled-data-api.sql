-- Official workaround for disabled-Data-API schema-cache errors:
-- https://supabase.com/docs/guides/troubleshooting/schema-pg_pgrst_no_exposed_schemas-does-not-exist
-- The pg_ prefix is reserved: the empty schema deliberately has no pg_ prefix.
CREATE SCHEMA IF NOT EXISTS pgrst_no_exposed_schemas;
REVOKE ALL ON SCHEMA pgrst_no_exposed_schemas FROM PUBLIC,anon,authenticated;
ALTER ROLE authenticator SET pgrst.db_schemas = 'pgrst_no_exposed_schemas';
NOTIFY pgrst;
-- Before enabling the Data API in the future:
-- ALTER ROLE authenticator RESET pgrst.db_schemas;
-- NOTIFY pgrst;
