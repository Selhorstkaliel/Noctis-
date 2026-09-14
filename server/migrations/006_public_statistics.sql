SET search_path=noctis,pg_catalog;
CREATE FUNCTION server_statistics(sid text) RETURNS TABLE(members integer,online integer) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT (SELECT count(*)::int FROM noctis.server_members m WHERE m.server_id=sid),
 (SELECT count(DISTINCT p.user_id)::int FROM noctis.presence p JOIN noctis.server_members m ON m.user_id=p.user_id JOIN noctis.profiles pr ON pr.user_id=p.user_id WHERE m.server_id=sid AND p.updated_at>now()-interval '45 seconds' AND pr.status<>'offline')
 WHERE noctis.session_valid() AND EXISTS(SELECT 1 FROM noctis.servers WHERE id=sid AND deleted_at IS NULL AND (is_public OR noctis.member(sid)))
$$;
REVOKE ALL ON FUNCTION server_statistics(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION server_statistics(text) TO noctis_api;
CREATE POLICY visible_badges ON user_badges FOR SELECT TO noctis_api USING(session_valid() AND can_profile(user_id) AND EXISTS(SELECT 1 FROM badges b WHERE b.id=badge_id));
RESET search_path;
