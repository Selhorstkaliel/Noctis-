SET search_path=noctis,pg_catalog;

INSERT INTO permissions(code) VALUES
  ('MUSIC_PLAY'),('MUSIC_PAUSE'),('MUSIC_SKIP'),('MUSIC_STOP'),
  ('MUSIC_VOLUME'),('MUSIC_QUEUE_MANAGE'),('MUSIC_MOVE')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id,permission)
SELECT r.id,p.code
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('Admin','Moderator')
  AND p.code LIKE 'MUSIC_%'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id,permission)
SELECT r.id,p.code
FROM roles r
CROSS JOIN permissions p
WHERE r.name='Member' AND p.code IN ('MUSIC_PLAY','MUSIC_PAUSE')
ON CONFLICT DO NOTHING;

CREATE TABLE music_settings (
  server_id text PRIMARY KEY REFERENCES servers ON DELETE CASCADE,
  default_volume smallint NOT NULL DEFAULT 50 CHECK(default_volume BETWEEN 0 AND 100),
  allow_member_skip boolean NOT NULL DEFAULT false,
  allow_member_volume boolean NOT NULL DEFAULT false,
  autoplay_enabled boolean NOT NULL DEFAULT true,
  idle_disconnect_seconds integer NOT NULL DEFAULT 300 CHECK(idle_disconnect_seconds BETWEEN 30 AND 3600),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Runtime rows coordinate API and worker replicas. They are updated only on
-- commands and track boundaries; playback position is derived from timestamps.
CREATE TABLE music_sessions (
  server_id text PRIMARY KEY REFERENCES servers ON DELETE CASCADE,
  voice_channel_id text REFERENCES channels ON DELETE SET NULL,
  requested_by text REFERENCES users ON DELETE SET NULL,
  current_track jsonb,
  queue jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(queue)='array'),
  previous_tracks jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(previous_tracks)='array'),
  playback_state text NOT NULL DEFAULT 'IDLE' CHECK(playback_state IN ('IDLE','LOADING','PLAYING','PAUSED','STOPPED','ERROR')),
  volume smallint NOT NULL DEFAULT 50 CHECK(volume BETWEEN 0 AND 100),
  repeat_mode text NOT NULL DEFAULT 'OFF' CHECK(repeat_mode IN ('OFF','ONE','ALL')),
  shuffle boolean NOT NULL DEFAULT false,
  started_at timestamptz,
  paused_at timestamptz,
  position_seconds double precision NOT NULL DEFAULT 0 CHECK(position_seconds>=0),
  bot_connected boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 0,
  idle_since timestamptz,
  claimed_by text,
  claim_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX music_sessions_worker_idx
  ON music_sessions(playback_state,claim_expires_at)
  WHERE current_track IS NOT NULL OR bot_connected;

INSERT INTO music_settings(server_id) SELECT id FROM servers ON CONFLICT DO NOTHING;

CREATE TABLE music_metrics (
  server_id text PRIMARY KEY REFERENCES servers ON DELETE CASCADE,
  tracks_played bigint NOT NULL DEFAULT 0,
  playback_errors bigint NOT NULL DEFAULT 0,
  provider_errors bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO music_metrics(server_id) SELECT id FROM servers ON CONFLICT DO NOTHING;

GRANT SELECT,INSERT,UPDATE ON music_settings,music_sessions,music_metrics TO noctis_api;
GRANT SELECT,INSERT,UPDATE,DELETE ON music_settings,music_sessions,music_metrics TO noctis_worker;

ALTER TABLE music_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY music_settings_read ON music_settings FOR SELECT TO noctis_api
  USING(session_valid() AND member(server_id));
CREATE POLICY music_settings_write ON music_settings FOR ALL TO noctis_api
  USING(session_valid() AND has_permission(server_id,'MANAGE_SERVER'))
  WITH CHECK(session_valid() AND has_permission(server_id,'MANAGE_SERVER'));
CREATE POLICY music_settings_worker ON music_settings TO noctis_worker USING(true) WITH CHECK(true);

ALTER TABLE music_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY music_sessions_read ON music_sessions FOR SELECT TO noctis_api
  USING(session_valid() AND member(server_id));
CREATE POLICY music_sessions_create ON music_sessions FOR INSERT TO noctis_api
  WITH CHECK(session_valid() AND member(server_id));
CREATE POLICY music_sessions_update ON music_sessions FOR UPDATE TO noctis_api
  USING(session_valid() AND member(server_id))
  WITH CHECK(session_valid() AND member(server_id));
CREATE POLICY music_sessions_worker ON music_sessions TO noctis_worker USING(true) WITH CHECK(true);

ALTER TABLE music_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY music_metrics_read ON music_metrics FOR SELECT TO noctis_api
  USING(session_valid() AND has_permission(server_id,'MANAGE_SERVER'));
CREATE POLICY music_metrics_write ON music_metrics FOR INSERT TO noctis_api
  WITH CHECK(session_valid() AND member(server_id));
CREATE POLICY music_metrics_update ON music_metrics FOR UPDATE TO noctis_api
  USING(session_valid() AND member(server_id)) WITH CHECK(session_valid() AND member(server_id));
CREATE POLICY music_metrics_worker ON music_metrics TO noctis_worker USING(true) WITH CHECK(true);

RESET search_path;
