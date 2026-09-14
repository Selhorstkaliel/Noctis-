SET search_path=noctis,pg_catalog;
CREATE POLICY voice_move_remove ON voice_participants FOR DELETE TO noctis_api
USING(session_valid() AND EXISTS(SELECT 1 FROM channels c WHERE c.id=channel_id
AND has_permission(c.server_id,'MOVE_MEMBERS') AND rank(c.server_id,current_user_id())>rank(c.server_id,user_id)));
RESET search_path;
