-- Run as the database administrator after provisioning the Noctis roles.
-- Keep pgcrypto in Supabase's extensions schema and preserve migrations 001-016.
DO $$
BEGIN
  IF to_regprocedure('public.digest(bytea,text)') IS NULL THEN
    IF to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
      RAISE EXCEPTION 'Expected Supabase pgcrypto in extensions';
    END IF;
    EXECUTE 'CREATE FUNCTION public.digest(bytea,text) RETURNS bytea
      LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SECURITY INVOKER
      SET search_path=pg_catalog
      AS ''SELECT extensions.digest($1,$2)''';
    REVOKE ALL ON FUNCTION public.digest(bytea,text) FROM PUBLIC,anon,authenticated;
    GRANT EXECUTE ON FUNCTION public.digest(bytea,text) TO noctis_migrator;
  END IF;
END $$;
GRANT USAGE ON SCHEMA extensions TO noctis_migrator;
GRANT EXECUTE ON FUNCTION extensions.digest(bytea,text) TO noctis_migrator;
