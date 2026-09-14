-- Validate the session and the exact room once, then count inside that room.
-- This aggregate never returns content or accepts a caller-supplied user ID.
CREATE FUNCTION noctis.unread_count(cid text, did text) RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid text := noctis.current_user_id(); stamp timestamptz; total integer;
BEGIN
  IF NOT noctis.session_valid() OR (cid IS NULL) = (did IS NULL) THEN RETURN 0; END IF;
  IF cid IS NOT NULL THEN
    IF NOT noctis.channel_permission(cid,'VIEW_CHANNEL') THEN RETURN 0; END IF;
    SELECT coalesce(cr.read_at,sm.joined_at) INTO stamp
      FROM noctis.channels c JOIN noctis.server_members sm ON sm.server_id=c.server_id AND sm.user_id=uid
      LEFT JOIN noctis.channel_reads cr ON cr.channel_id=c.id AND cr.user_id=uid WHERE c.id=cid;
    SELECT count(*)::integer INTO total FROM noctis.messages
      WHERE channel_id=cid AND author_id<>uid AND deleted_at IS NULL AND created_at>stamp;
  ELSE
    IF NOT noctis.in_conversation(did) THEN RETURN 0; END IF;
    SELECT last_read_at INTO stamp FROM noctis.direct_conversation_members WHERE conversation_id=did AND user_id=uid;
    SELECT count(*)::integer INTO total FROM noctis.messages
      WHERE conversation_id=did AND author_id<>uid AND deleted_at IS NULL AND created_at>stamp;
  END IF;
  RETURN coalesce(total,0);
END $$;
REVOKE ALL ON FUNCTION noctis.unread_count(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION noctis.unread_count(text,text) TO noctis_api;
