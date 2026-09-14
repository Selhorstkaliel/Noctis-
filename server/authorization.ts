import type { DB } from "./db.js";
import { requireThat } from "./errors.js";
export const permissions = [
  "VIEW_CHANNEL",
  "SEND_MESSAGES",
  "MANAGE_MESSAGES",
  "ATTACH_FILES",
  "ADD_REACTIONS",
  "CONNECT_VOICE",
  "SPEAK",
  "STREAM",
  "MUTE_MEMBERS",
  "DEAFEN_MEMBERS",
  "MOVE_MEMBERS",
  "CREATE_INVITE",
  "MANAGE_CHANNELS",
  "MANAGE_ROLES",
  "MANAGE_MISSIONS",
  "MANAGE_EVENTS",
  "MANAGE_SERVER",
  "KICK_MEMBERS",
  "BAN_MEMBERS",
  "VIEW_AUDIT_LOG",
  "MUSIC_PLAY",
  "MUSIC_PAUSE",
  "MUSIC_SKIP",
  "MUSIC_STOP",
  "MUSIC_VOLUME",
  "MUSIC_QUEUE_MANAGE",
  "MUSIC_MOVE",
] as const;
export type Permission = (typeof permissions)[number];
export async function member(db: DB, serverId: string) {
  const r = await db.query("SELECT noctis.member($1) AS allowed", [serverId]);
  requireThat(r.rows[0].allowed);
}
export async function permit(db: DB, serverId: string, permission: Permission) {
  await member(db, serverId);
  const r = await db.query("SELECT noctis.has_permission($1,$2) AS allowed", [
    serverId,
    permission,
  ]);
  requireThat(r.rows[0].allowed, 403, "Your role does not allow this action.");
}
export async function channel(
  db: DB,
  channelId: string,
  permission: Permission = "VIEW_CHANNEL",
) {
  const r = await db.query(
    "SELECT c.*,noctis.channel_permission(c.id,$2) AS allowed FROM channels c WHERE c.id=$1 AND c.deleted_at IS NULL",
    [channelId, permission],
  );
  requireThat(r.rowCount);
  requireThat(r.rows[0].allowed, 403, "Your role does not allow this action.");
  return r.rows[0];
}
export async function conversation(db: DB, conversationId: string) {
  const r = await db.query("SELECT noctis.in_conversation($1) AS allowed", [
    conversationId,
  ]);
  requireThat(r.rows[0].allowed);
}
export type Room = { channelId?: string; conversationId?: string };
export async function room(
  db: DB,
  value: Room,
  permission: Permission = "VIEW_CHANNEL",
) {
  requireThat(
    !!value.channelId !== !!value.conversationId,
    400,
    "Choose one conversation.",
  );
  if (value.channelId) return channel(db, value.channelId, permission);
  await conversation(db, value.conversationId!);
  return null;
}
export async function canContact(db: DB, target: string, actor: string) {
  const r = await db.query(
    `SELECT p.user_id,p.allow_dm,p.allow_invites,p.allow_friend_requests,noctis.blocked($1,$2) AS blocked,noctis.friends($1,$2) AS friends,EXISTS(SELECT 1 FROM server_members a JOIN server_members b ON a.server_id=b.server_id WHERE a.user_id=$1 AND b.user_id=$2) AS shared FROM profiles p WHERE p.user_id=$2`,
    [actor, target],
  );
  requireThat(
    r.rowCount && target !== actor && !r.rows[0].blocked,
    403,
    "This person is not available for this action.",
  );
  return r.rows[0];
}
export async function hierarchy(
  db: DB,
  serverId: string,
  actor: string,
  target?: string,
  roleId?: string,
) {
  await permit(db, serverId, "MANAGE_ROLES");
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('server:'||$1,0))",
    [serverId],
  );
  const ranks = await db.query(
    "SELECT owner_id,noctis.rank(id,$2) AS actor_rank,noctis.rank(id,$3) AS target_rank FROM servers WHERE id=$1",
    [serverId, actor, target || actor],
  );
  const s = ranks.rows[0];
  requireThat(
    !target || target !== s.owner_id,
    403,
    "The owner role cannot be changed.",
  );
  if (s.owner_id !== actor) {
    requireThat(
      !target || s.actor_rank > s.target_rank,
      403,
      "You can manage only members below your role.",
    );
  }
  if (roleId) {
    const r = await db.query(
      "SELECT id,position FROM roles WHERE id=$1 AND server_id=$2",
      [roleId, serverId],
    );
    requireThat(r.rowCount);
    if (s.owner_id !== actor) {
      requireThat(
        r.rows[0].position < s.actor_rank,
        403,
        "You can manage only roles below your own.",
      );
      const escalated = await db.query(
        "SELECT 1 FROM role_permissions WHERE role_id=$1 AND NOT noctis.has_permission($2,permission) LIMIT 1",
        [roleId, serverId],
      );
      requireThat(
        !escalated.rowCount,
        403,
        "You cannot grant permissions you do not have.",
      );
    }
    return r.rows[0];
  }
  return s;
}
