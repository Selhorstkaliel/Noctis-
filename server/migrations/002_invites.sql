SET search_path=noctis,pg_catalog;
CREATE FUNCTION is_banned(sid text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT EXISTS(SELECT 1 FROM noctis.server_bans WHERE server_id=sid AND user_id=noctis.current_user_id()) $$;
CREATE FUNCTION preview_invite(digest text) RETURNS TABLE(id text,name text,description text,mark text,image text,expires_at timestamptz) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT s.id,s.name,s.description,s.mark,s.image,i.expires_at FROM noctis.invitations i JOIN noctis.servers s ON s.id=i.server_id WHERE noctis.session_valid() AND i.token_hash=digest AND i.revoked_at IS NULL AND i.expires_at>now() AND i.uses<i.max_uses AND s.deleted_at IS NULL AND NOT noctis.is_banned(s.id) $$;
CREATE FUNCTION redeem_invite(digest text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE inv noctis.invitations%ROWTYPE; BEGIN
 IF NOT noctis.session_valid() THEN RETURN NULL; END IF;
 SELECT * INTO inv FROM noctis.invitations WHERE token_hash=digest FOR UPDATE;
 IF inv.id IS NULL OR inv.revoked_at IS NOT NULL OR inv.expires_at<=now() OR inv.uses>=inv.max_uses OR noctis.is_banned(inv.server_id) OR NOT EXISTS(SELECT 1 FROM noctis.servers WHERE id=inv.server_id AND deleted_at IS NULL) THEN RETURN NULL; END IF;
 IF NOT noctis.member(inv.server_id) THEN INSERT INTO noctis.server_members(server_id,user_id) VALUES(inv.server_id,noctis.current_user_id()); UPDATE noctis.invitations SET uses=uses+1 WHERE id=inv.id; END IF;
 RETURN inv.server_id;
END $$;
REVOKE ALL ON FUNCTION is_banned(text),preview_invite(text),redeem_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_banned(text),preview_invite(text),redeem_invite(text) TO noctis_api;
RESET search_path;
