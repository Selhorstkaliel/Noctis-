import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { transaction, type DB } from "../db.js";
import { member, room, channel, conversation } from "../authorization.js";
import { requireThat, id, page } from "../errors.js";
import { throttle } from "../auth.js";
export async function resolveRoom(db: DB, key: string) {
  if (key.startsWith("dm/")) {
    const target = key.slice(3);
    let r = await db.query("SELECT id FROM direct_conversations WHERE id=$1", [
      target,
    ]);
    if (!r.rowCount)
      r = await db.query(
        `SELECT c.id FROM direct_conversations c JOIN direct_conversation_members m ON m.conversation_id=c.id WHERE c.name IS NULL AND m.user_id=$1 AND noctis.in_conversation(c.id) AND (SELECT count(*) FROM direct_conversation_members x WHERE x.conversation_id=c.id)=2 LIMIT 1`,
        [target],
      );
    requireThat(r.rowCount);
    await conversation(db, r.rows[0].id);
    return { conversationId: r.rows[0].id as string };
  }
  const [server, slug] = key.split("/");
  const r = await db.query(
    "SELECT id FROM channels WHERE server_id=$1 AND slug=$2 AND deleted_at IS NULL",
    [server, slug],
  );
  requireThat(r.rowCount);
  await channel(db, r.rows[0].id);
  return { channelId: r.rows[0].id as string };
}
export async function messageDTO(
  db: DB,
  rows: Record<string, any>[],
  userId: string,
) {
  if (!rows.length) return [];
  const ids = rows.map((m) => m.id);
  const reactions = (
    await db.query(
      "SELECT message_id,emoji,count(*)::int AS count,bool_or(user_id=$2) AS mine FROM message_reactions WHERE message_id=ANY($1) GROUP BY message_id,emoji",
      [ids, userId],
    )
  ).rows;
  const attachments = (
    await db.query(
      "SELECT ma.message_id,u.id,u.original_name,u.content_type FROM message_attachments ma JOIN uploads u ON u.id=ma.upload_id WHERE ma.message_id=ANY($1)",
      [ids],
    )
  ).rows;
  const replies = (
    await db.query(
      "SELECT r.message_id,r.parent_id,m.body,p.name FROM message_replies r JOIN messages m ON m.id=r.parent_id LEFT JOIN profiles p ON p.user_id=m.author_id WHERE r.message_id=ANY($1)",
      [ids],
    )
  ).rows;
  const pins = (
    await db.query(
      "SELECT message_id FROM pinned_messages WHERE message_id=ANY($1)",
      [ids],
    )
  ).rows;
  return rows.map((m) => {
    const a = attachments.filter((a) => a.message_id === m.id);
    const reply = replies.find((r) => r.message_id === m.id);
    return {
      id: m.id,
      room: m.room,
      user: m.author_id,
      text: m.body,
      time: new Date(m.created_at).toISOString(),
      edited:
        new Date(m.updated_at).getTime() > new Date(m.created_at).getTime(),
      pinned: pins.some((p) => p.message_id === m.id),
      reactions: Object.fromEntries(
        reactions
          .filter((r) => r.message_id === m.id)
          .map((r) => [r.emoji, r.count]),
      ),
      mine: reactions
        .filter((r) => r.message_id === m.id && r.mine)
        .map((r) => r.emoji),
      reply: reply
        ? `${reply.name || "Member"}: ${reply.body.slice(0, 120)}`
        : undefined,
      replyTo: reply?.parent_id,
      image: a.find((u) => u.content_type.startsWith("image/"))
        ? `/api/uploads/${a.find((u) => u.content_type.startsWith("image/")).id}`
        : undefined,
      file: a.find((u) => !u.content_type.startsWith("image/"))
        ? {
            name: a.find((u) => !u.content_type.startsWith("image/"))
              .original_name,
            data: `/api/uploads/${a.find((u) => !u.content_type.startsWith("image/")).id}`,
          }
        : undefined,
      attachments: a.map((u) => ({
        id: u.id,
        name: u.original_name,
        url: `/api/uploads/${u.id}`,
        type: u.content_type,
      })),
    };
  });
}
async function readPeople(db: DB, userId: string, ids?: string[]) {
  const profiles = (
    await db.query(
      `SELECT p.*,u.created_at,coalesce((SELECT sum(x.amount)::int FROM xp_transactions x WHERE x.user_id=p.user_id),0) AS xp,EXISTS(SELECT 1 FROM presence pr WHERE pr.user_id=p.user_id AND pr.updated_at>now()-interval '45 seconds') AS present FROM profiles p JOIN users u ON u.id=p.user_id WHERE ($2::text[] IS NULL OR p.user_id=ANY($2)) ORDER BY (p.user_id=$1) DESC,p.name,p.user_id LIMIT 500`,
      [userId, ids || null],
    )
  ).rows;
  const badges = (
    await db.query(
      "SELECT ub.user_id,b.id,b.name,b.icon FROM user_badges ub JOIN badges b ON b.id=ub.badge_id WHERE ub.user_id=ANY($1)",
      [profiles.map((p) => p.user_id)],
    )
  ).rows;
  const people = profiles.map((p) => ({
    id: p.user_id,
    badges: badges
      .filter((b) => b.user_id === p.user_id)
      .map(({ id, name, icon }) => ({ id, name, icon })),
    createdAt: p.created_at,
    name: p.name,
    handle: p.handle,
    avatar: p.avatar,
    avatarUrl: p.avatar_upload_id
      ? `/api/uploads/${p.avatar_upload_id}`
      : undefined,
    bio: p.bio,
    status: p.present ? p.status : "offline",
    activity: p.show_activity ? p.activity : "",
    role: "Member",
    xp: p.xp,
    color: p.color,
  }));
  return { profiles, people };
}
export async function snapshot(db: DB, userId: string) {
  const { profiles, people } = await readPeople(db, userId);
  const settings = Object.fromEntries(
    (
      await db.query("SELECT key,value FROM user_settings WHERE user_id=$1", [
        userId,
      ])
    ).rows.map((s) => [
      s.key,
      s.value === "true" ? true : s.value === "false" ? false : s.value,
    ]),
  );
  const self = profiles.find((p) => p.user_id === userId);
  requireThat(self, 401, "Please sign in again.");
  Object.assign(settings, {
    direct: self.allow_dm !== "nobody",
    dmPolicy: self.allow_dm,
    profileVisibility: self.profile_visibility,
    activity: self.show_activity,
    friendRequests: self.allow_friend_requests,
    invites: self.allow_invites,
    status: self.status,
  });
  const serverRows = (
    await db.query(
      `SELECT s.*,noctis.member(s.id) AS joined,stats.members,stats.online FROM servers s CROSS JOIN LATERAL noctis.server_statistics(s.id) stats WHERE s.deleted_at IS NULL ORDER BY noctis.member(s.id) DESC,s.created_at DESC,s.id LIMIT 100`,
    )
  ).rows;
  const serverIds = serverRows.filter((s) => s.joined).map((s) => s.id);
  const permRows = (
    await db.query(
      "SELECT s.id,p.code FROM servers s CROSS JOIN permissions p WHERE s.id=ANY($1) AND noctis.has_permission(s.id,p.code)",
      [serverIds],
    )
  ).rows;
  const servers = serverRows.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    mark: s.mark,
    image: s.image,
    color: s.color,
    members: s.members,
    online: s.online,
    category: s.category,
    joined: s.joined,
    unread: 0,
    ownerId: s.owner_id,
    isPublic: s.is_public,
    permissions: permRows.filter((p) => p.id === s.id).map((p) => p.code),
  }));
  const channels = (
    await db.query(
      'SELECT c.id,c.server_id AS "serverId",c.name,c.slug,c.description,c.kind,c.category_id AS "categoryId",c.is_private AS "isPrivate",c.position,noctis.unread_count(c.id,NULL) AS unread FROM channels c WHERE c.deleted_at IS NULL ORDER BY c.position LIMIT 300',
    )
  ).rows;
  for (const s of servers)
    s.unread = channels
      .filter((c) => c.serverId === s.id)
      .reduce((sum, c) => sum + c.unread, 0);
  const categories = (
    await db.query(
      'SELECT id,server_id AS "serverId",name,position FROM channel_categories ORDER BY position LIMIT 100',
    )
  ).rows;
  const memberships = (
    await db.query(
      'SELECT server_id AS "serverId",user_id AS "userId" FROM server_members WHERE server_id=ANY($1) LIMIT 2000',
      [serverIds],
    )
  ).rows;
  const serverRoles = (
    await db.query(
      'SELECT r.id,r.server_id AS "serverId",r.name,r.position,r.is_default AS "isDefault",r.color,coalesce(array_agg(rp.permission) FILTER(WHERE rp.permission IS NOT NULL),ARRAY[]::text[]) AS permissions FROM roles r LEFT JOIN role_permissions rp ON rp.role_id=r.id GROUP BY r.id ORDER BY r.position DESC',
    )
  ).rows;
  const assignments = (
    await db.query(
      'SELECT server_id AS "serverId",user_id AS "userId",role_id AS "roleId" FROM member_roles LIMIT 3000',
    )
  ).rows;
  const roles: Record<string, string> = {};
  for (const m of memberships) {
    const owner = servers.find((s) => s.id === m.serverId)?.ownerId;
    const assigned = serverRoles.filter(
      (r) =>
        r.serverId === m.serverId &&
        (r.isDefault ||
          assignments.some((a) => a.roleId === r.id && a.userId === m.userId)),
    );
    roles[`${m.serverId}:${m.userId}`] =
      owner === m.userId ? "Owner" : assigned[0]?.name || "Member";
  }
  const groups = (
    await db.query(
      "SELECT c.id,c.name,array_agg(m.user_id) AS members FROM direct_conversations c JOIN direct_conversation_members m ON m.conversation_id=c.id WHERE noctis.in_conversation(c.id) GROUP BY c.id ORDER BY c.updated_at DESC LIMIT 100",
    )
  ).rows;
  const dmRooms = new Map(
    groups.map((g) => [
      g.id,
      `dm/${g.name ? g.id : g.members.find((u: string) => u !== userId) || g.id}`,
    ]),
  );
  const msgs = (
    await db.query(
      `SELECT * FROM (
        SELECT m.*,c.server_id,c.slug FROM channels c CROSS JOIN LATERAL
          (SELECT * FROM messages WHERE channel_id=c.id AND deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 50) m WHERE c.id=ANY($1)
        UNION ALL
        SELECT m.*,NULL::text AS server_id,NULL::text AS slug FROM unnest($2::text[]) AS g(id) CROSS JOIN LATERAL
          (SELECT * FROM messages WHERE conversation_id=g.id AND deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 50) m
      ) recent ORDER BY created_at DESC,id DESC LIMIT 300`,
      [channels.map((c) => c.id), groups.map((g) => g.id)],
    )
  ).rows
    .reverse()
    .map((m) => ({
      ...m,
      room: m.channel_id
        ? `${m.server_id}/${m.slug}`
        : dmRooms.get(m.conversation_id),
    }));
  const messages = await messageDTO(db, msgs, userId);
  const missionRows = (
    await db.query(
      `SELECT m.*,r.xp,b.name AS badge,EXISTS(SELECT 1 FROM mission_members mm WHERE mm.mission_id=m.id AND mm.user_id=$1) AS joined,EXISTS(SELECT 1 FROM xp_transactions x WHERE x.reward_id=r.id AND x.user_id=$1) AS claimed,(SELECT count(*)::int FROM mission_members mm WHERE mm.mission_id=m.id) AS people,ARRAY(SELECT mm.user_id FROM mission_members mm WHERE mm.mission_id=m.id ORDER BY mm.user_id LIMIT 4) AS member_ids FROM missions m JOIN mission_rewards r ON r.mission_id=m.id LEFT JOIN badges b ON b.id=r.badge_id WHERE m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 100`,
      [userId],
    )
  ).rows;
  const objectives = (
    await db.query(
      "SELECT o.*,EXISTS(SELECT 1 FROM mission_progress p WHERE p.objective_id=o.id AND p.user_id=$1) AS done FROM mission_objectives o WHERE o.mission_id=ANY($2) ORDER BY o.position",
      [userId, missionRows.map((m) => m.id)],
    )
  ).rows;
  const missions = missionRows.map((m) => ({
    id: m.id,
    title: m.title,
    description: m.description,
    server: m.server_id,
    category: m.category,
    icon: m.icon,
    color: m.color,
    xp: m.xp,
    badge: m.badge || "",
    people: m.people,
    memberIds: m.member_ids,
    joined: m.joined,
    claimed: m.claimed,
    due: m.due_at
      ? new Date(m.due_at).getTime() > Date.now()
        ? `${Math.ceil((new Date(m.due_at).getTime() - Date.now()) / 86400000)} days left`
        : "Ended"
      : "No deadline",
    dueAt: m.due_at,
    objectives: objectives
      .filter((o) => o.mission_id === m.id)
      .map((o) => ({
        id: o.id,
        text: o.description,
        done: o.done,
        verification: o.verification,
      })),
  }));
  const eventRows = (
    await db.query(
      "SELECT e.*,EXISTS(SELECT 1 FROM event_participants p WHERE p.event_id=e.id AND p.user_id=$1) AS rsvp,(SELECT count(*)::int FROM event_participants p WHERE p.event_id=e.id AND p.user_id<>$1) AS attendees,ARRAY(SELECT p.user_id FROM event_participants p WHERE p.event_id=e.id ORDER BY p.user_id LIMIT 4) AS member_ids FROM events e WHERE e.deleted_at IS NULL ORDER BY e.starts_at LIMIT 100",
      [userId],
    )
  ).rows;
  const events = eventRows.map((e) => ({
    id: e.id,
    title: e.title,
    server: e.server_id,
    description: e.description,
    startsAt: e.starts_at,
    day: new Date(e.starts_at).getDate(),
    month: new Date(e.starts_at)
      .toLocaleDateString("en-US", { month: "short" })
      .toUpperCase(),
    year: new Date(e.starts_at).getFullYear(),
    time: new Date(e.starts_at).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    }),
    attendees: e.attendees,
    memberIds: e.member_ids,
    rsvp: e.rsvp,
    icon: e.icon,
  }));
  const notifications = (
    await db.query(
      'SELECT id,actor_id AS "actorId",kind,title,body,route,read_at AS "readAt",created_at AS "createdAt" FROM notifications ORDER BY created_at DESC LIMIT 100',
    )
  ).rows;
  const unreadDM: Record<string, number> = {};
  const unreadRows = await db.query(
    "SELECT id AS conversation_id,noctis.unread_count(NULL,id) AS count FROM unnest($1::text[]) AS g(id)",
    [groups.map((g) => g.id)],
  );
  const unreadCounts = new Map(
    unreadRows.rows.map((r) => [r.conversation_id, r.count]),
  );
  for (const g of groups)
    unreadDM[dmRooms.get(g.id)!.slice(3)] = unreadCounts.get(g.id) || 0;
  const connected = (
    await db.query("SELECT provider FROM integrations WHERE status='connected'")
  ).rows.map((x) => x.provider);
  const integrationItems = (
    await db.query(
      'SELECT i.provider,t.title,t.url,t.occurred_at AS "occurredAt" FROM integration_items t JOIN integrations i ON i.id=t.integration_id ORDER BY t.occurred_at DESC LIMIT 30',
    )
  ).rows;
  const friendships = (
    await db.query(
      'SELECT requester_id AS "requesterId",recipient_id AS "recipientId",status FROM friendships',
    )
  ).rows;
  const blocks = (
    await db.query("SELECT blocked_id FROM user_blocks")
  ).rows.map((b) => b.blocked_id);
  const voice = (
    await db.query(
      'SELECT connection_id AS id,user_id AS "userId",channel_id AS "channelId",muted,deafened,camera,screen,server_muted AS "serverMuted",server_deafened AS "serverDeafened" FROM voice_participants WHERE updated_at>now()-interval \'45 seconds\'',
    )
  ).rows;
  return {
    version: 2,
    profile: { ...people.find((p) => p.id === userId)!, status: self.status },
    users: people,
    servers,
    channels,
    categories,
    memberships,
    serverRoles,
    assignments,
    missions,
    messages,
    events,
    connected,
    integrationItems,
    notifications,
    readNotifications: notifications.filter((n) => n.readAt).map((n) => n.id),
    unreadDM,
    settings: {
      theme: "midnight",
      motion: true,
      language: "en-US",
      sounds: true,
      desktop: true,
      mentions: true,
      ...settings,
    },
    roles,
    groups,
    friendships,
    blocks,
    voice,
  };
}
export async function readRoutes(app: FastifyInstance) {
  app.post("/api/rooms/:room/sync", (req) =>
    transaction(req.identity, async (db) => {
      const p = z
        .object({ room: z.string().min(1).max(160) })
        .parse(req.params);
      const input = z
        .object({ ids: z.array(id).max(100) })
        .strict()
        .parse(req.body);
      const access = await resolveRoom(db, p.room);
      const rows = await db.query(
        `SELECT * FROM messages WHERE id=ANY($1) AND ${access.channelId ? "channel_id=$2" : "conversation_id=$2"} AND deleted_at IS NULL ORDER BY created_at,id`,
        [input.ids, access.channelId || access.conversationId],
      );
      const unread = await db.query(
        "SELECT noctis.unread_count($1,$2) AS count",
        [access.channelId || null, access.conversationId || null],
      );
      return {
        items: await messageDTO(
          db,
          rows.rows.map((m) => ({ ...m, room: p.room })),
          req.identity.userId,
        ),
        users: (
          await readPeople(db, req.identity.userId, [
            ...new Set(rows.rows.map((m) => m.author_id)),
          ])
        ).people,
        // Missing IDs reveal nothing: deleted, foreign and nonexistent IDs are identical.
        removed: input.ids.filter((id) => !rows.rows.some((m) => m.id === id)),
        unread: unread.rows[0].count,
      };
    }),
  );
  app.get("/api/activity", (req) =>
    transaction(req.identity, async (db) => {
      const channels = await db.query(
        "SELECT id,noctis.unread_count(id,NULL) AS unread FROM channels WHERE deleted_at IS NULL",
      );
      const conversations = await db.query(
        "SELECT conversation_id AS id,noctis.unread_count(NULL,conversation_id) AS unread FROM direct_conversation_members WHERE user_id=$1",
        [req.identity.userId],
      );
      return { channels: channels.rows, conversations: conversations.rows };
    }),
  );
  app.get("/api/bootstrap", (req) =>
    transaction(req.identity, (db) => snapshot(db, req.identity.userId)),
  );
  app.get("/api/servers/:id", (req) =>
    transaction(req.identity, async (db) => {
      const p = z.object({ id }).parse(req.params);
      await member(db, p.id);
      const r = await db.query(
        'SELECT id,name,description,owner_id AS "ownerId",is_public AS "isPublic" FROM servers WHERE id=$1',
        [p.id],
      );
      return r.rows[0];
    }),
  );
  app.get("/api/rooms/:room/messages", (req) =>
    transaction(req.identity, async (db) => {
      const p = z
        .object({ room: z.string().min(1).max(160) })
        .parse(req.params);
      const q = page
        .extend({ around: id.optional() })
        .strict()
        .parse(req.query);
      const access = await resolveRoom(db, p.room);
      let anchor: Date | undefined;
      if (q.around) {
        const target = await db.query(
          "SELECT created_at FROM messages WHERE id=$1 AND channel_id IS NOT DISTINCT FROM $2 AND conversation_id IS NOT DISTINCT FROM $3 AND deleted_at IS NULL",
          [q.around, access.channelId || null, access.conversationId || null],
        );
        requireThat(target.rowCount);
        anchor = target.rows[0].created_at;
      }
      const r = await db.query(
        `SELECT * FROM messages WHERE ${access.channelId ? "channel_id=$1 AND $2::text IS NULL" : "conversation_id=$2 AND $1::text IS NULL"} AND deleted_at IS NULL AND ($3::timestamptz IS NULL OR created_at<$3) ORDER BY CASE WHEN $5::timestamptz IS NOT NULL THEN abs(extract(epoch FROM created_at-$5::timestamptz)) END,created_at DESC LIMIT $4`,
        [
          access.channelId || null,
          access.conversationId || null,
          q.before || null,
          q.limit,
          anchor || null,
        ],
      );
      return {
        items: await messageDTO(
          db,
          r.rows
            .sort((a, b) => a.created_at - b.created_at)
            .map((m) => ({ ...m, room: p.room })),
          req.identity.userId,
        ),
        nextCursor: r.rows.length === q.limit ? r.rows[0].created_at : null,
      };
    }),
  );
  app.get("/api/channels/:id/messages", (req) =>
    transaction(req.identity, async (db) => {
      const p = z.object({ id }).parse(req.params);
      const q = page.parse(req.query);
      const c = await channel(db, p.id);
      const r = await db.query(
        "SELECT * FROM messages WHERE channel_id=$1 AND deleted_at IS NULL AND ($2::timestamptz IS NULL OR created_at<$2) ORDER BY created_at DESC LIMIT $3",
        [p.id, q.before || null, q.limit],
      );
      return {
        items: await messageDTO(
          db,
          r.rows
            .reverse()
            .map((m) => ({ ...m, room: `${c.server_id}/${c.slug}` })),
          req.identity.userId,
        ),
        nextCursor: r.rows.length === q.limit ? r.rows[0].created_at : null,
      };
    }),
  );
  app.get("/api/servers/:id/leaderboard", (req) =>
    transaction(req.identity, async (db) => {
      const p = z.object({ id }).parse(req.params);
      await member(db, p.id);
      const query = z
        .object({ period: z.enum(["all", "week"]).default("all") })
        .strict()
        .parse(req.query);
      return (
        await db.query(
          `SELECT x.user_id AS "userId",sum(x.amount)::int AS xp,(SELECT count(*)::int FROM user_badges ub JOIN badges b ON b.id=ub.badge_id WHERE ub.user_id=x.user_id AND b.server_id=$1) AS badges FROM xp_transactions x WHERE x.server_id=$1 AND ($2='all' OR x.created_at>=date_trunc('week',now())) GROUP BY x.user_id ORDER BY xp DESC,x.user_id LIMIT 100`,
          [p.id, query.period],
        )
      ).rows;
    }),
  );
  app.get("/api/search", async (req) => {
    const q = z
      .object({
        q: z.string().trim().min(2).max(100),
        limit: z.coerce.number().int().min(1).max(30).default(20),
      })
      .strict()
      .parse(req.query);
    await throttle("search", req.identity.userId, 30, 60);
    return transaction(req.identity, async (db) => {
      const messages = (
        await db.query(
          "SELECT m.id,m.body,c.server_id,c.slug,m.conversation_id FROM messages m LEFT JOIN channels c ON c.id=m.channel_id WHERE m.deleted_at IS NULL AND to_tsvector('english',m.body) @@ plainto_tsquery('english',$1) ORDER BY m.created_at DESC LIMIT $2",
          [q.q, q.limit],
        )
      ).rows;
      const profiles = (
        await db.query(
          "SELECT user_id AS id,name,handle FROM profiles WHERE name ILIKE $1 OR handle ILIKE $1 ORDER BY name LIMIT $2",
          [`%${q.q.replace(/[%_\\]/g, "\\$&")}%`, q.limit],
        )
      ).rows;
      const channels = (
        await db.query(
          'SELECT id,server_id AS "serverId",slug,name FROM channels WHERE name ILIKE $1 AND deleted_at IS NULL LIMIT $2',
          [`%${q.q.replace(/[%_\\]/g, "\\$&")}%`, q.limit],
        )
      ).rows;
      const servers = (
        await db.query(
          "SELECT id,name,description FROM servers WHERE name ILIKE $1 AND deleted_at IS NULL LIMIT $2",
          [`%${q.q.replace(/[%_\\]/g, "\\$&")}%`, q.limit],
        )
      ).rows;
      return { messages, users: profiles, channels, servers };
    });
  });
}
