SET search_path=noctis,pg_catalog;

-- DELETE predicates require SELECT on the columns they inspect.
-- The worker may inspect expiration times, but not token hashes or identities.
GRANT SELECT(expires_at) ON account_tokens,login_challenges TO noctis_worker;
