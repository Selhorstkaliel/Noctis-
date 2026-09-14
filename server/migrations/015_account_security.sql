SET search_path=noctis,pg_catalog;

ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
ALTER TABLE users ADD COLUMN auth_version integer NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN mfa_verified_at timestamptz;

CREATE TABLE account_mfa (
  user_id text PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  secret_encrypted text NOT NULL,
  enabled_at timestamptz,
  setup_expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
  last_counter bigint NOT NULL DEFAULT -1
);
CREATE TABLE mfa_recovery_codes (
  user_id text NOT NULL REFERENCES users ON DELETE CASCADE,
  code_hash char(64) NOT NULL,
  PRIMARY KEY(user_id,code_hash)
);
CREATE TABLE login_challenges (
  token_hash char(64) PRIMARY KEY,
  user_id text NOT NULL REFERENCES users ON DELETE CASCADE,
  auth_version integer NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes'
);
CREATE INDEX login_challenges_expiry ON login_challenges(expires_at);
CREATE TABLE account_tokens (
  token_hash char(64) PRIMARY KEY,
  user_id text NOT NULL REFERENCES users ON DELETE CASCADE,
  purpose text NOT NULL CHECK(purpose IN ('verify','reset')),
  expires_at timestamptz NOT NULL,
  UNIQUE(user_id,purpose)
);
CREATE TABLE security_mail (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  payload_encrypted text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_mail_available ON security_mail(available_at);
REVOKE ALL ON account_mfa,mfa_recovery_codes,login_challenges,account_tokens,security_mail FROM PUBLIC,noctis_api,noctis_worker;
GRANT SELECT,INSERT,UPDATE,DELETE ON account_mfa,mfa_recovery_codes,login_challenges,account_tokens,security_mail TO noctis_auth;
GRANT SELECT,UPDATE,DELETE ON security_mail TO noctis_worker;
GRANT DELETE ON login_challenges,account_tokens TO noctis_worker;

CREATE OR REPLACE FUNCTION session_valid() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM noctis.sessions s JOIN noctis.users u ON u.id=s.user_id
    LEFT JOIN noctis.account_mfa m ON m.user_id=u.id AND m.enabled_at IS NOT NULL
    WHERE s.id=nullif(current_setting('noctis.session_id',true),'') AND s.user_id=noctis.current_user_id()
    AND s.revoked_at IS NULL AND s.expires_at>now() AND s.last_seen_at>now()-interval '7 days'
    AND u.deleted_at IS NULL AND u.email_verified_at IS NOT NULL
    AND (m.user_id IS NULL OR s.mfa_verified_at>=m.enabled_at))
$$;
