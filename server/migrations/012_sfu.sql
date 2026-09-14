ALTER TABLE noctis.voice_participants ADD COLUMN media_room text;
CREATE TABLE noctis.media_revocations (
  connection_id text PRIMARY KEY, room_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), retry_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE noctis.media_revocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY media_cleanup_worker ON noctis.media_revocations TO noctis_worker USING(true) WITH CHECK(true);
GRANT SELECT,UPDATE,DELETE ON noctis.media_revocations TO noctis_worker;
CREATE FUNCTION noctis.queue_media_removal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF OLD.media_room IS NOT NULL THEN
    INSERT INTO noctis.media_revocations(connection_id,room_name) VALUES(OLD.connection_id,OLD.media_room)
      ON CONFLICT(connection_id) DO UPDATE SET room_name=EXCLUDED.room_name,retry_at=now();
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION noctis.queue_media_removal() FROM PUBLIC;
CREATE TRIGGER voice_media_cleanup AFTER DELETE ON noctis.voice_participants
FOR EACH ROW EXECUTE FUNCTION noctis.queue_media_removal();
