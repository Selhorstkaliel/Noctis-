-- Run once as a database administrator with psql, without statement echoing.
-- Pass secrets through environment variables, never -v plaintext arguments.
\set ON_ERROR_STOP on
\getenv api_password NOCTIS_API_PASSWORD
\getenv auth_password NOCTIS_AUTH_PASSWORD
\getenv worker_password NOCTIS_WORKER_PASSWORD
\getenv migrator_password NOCTIS_MIGRATOR_PASSWORD
CREATE ROLE noctis_api LOGIN PASSWORD :'api_password' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE noctis_auth LOGIN PASSWORD :'auth_password' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE noctis_worker LOGIN PASSWORD :'worker_password' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE noctis_migrator LOGIN PASSWORD :'migrator_password' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT CREATE ON DATABASE noctis TO noctis_migrator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE,CREATE ON SCHEMA public TO noctis_migrator;
GRANT noctis_api,noctis_auth,noctis_worker TO noctis_migrator WITH ADMIN OPTION;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
ALTER ROLE noctis_api SET search_path=noctis,pg_catalog;
ALTER ROLE noctis_auth SET search_path=noctis,pg_catalog;
ALTER ROLE noctis_worker SET search_path=noctis,pg_catalog;
ALTER ROLE noctis_migrator SET search_path=noctis,pg_catalog;
