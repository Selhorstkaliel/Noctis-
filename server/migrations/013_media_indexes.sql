CREATE INDEX voice_session ON noctis.voice_participants(session_id);
CREATE INDEX media_revocations_retry ON noctis.media_revocations(retry_at, created_at);
