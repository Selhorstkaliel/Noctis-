-- Presence lookups occur for each visible profile and server online count.
CREATE INDEX presence_user_updated ON noctis.presence(user_id,updated_at DESC);
CREATE INDEX voice_channel_updated ON noctis.voice_participants(channel_id,updated_at DESC);
