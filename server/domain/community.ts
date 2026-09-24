import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { transaction, audit, changed, type DB } from "../db.js";
import {
  permit,
  member,
  hierarchy,
  permissions,
  canContact,
  channel,
} from "../authorization.js";
import { id, text, requireThat, page } from "../errors.js";
import { throttle } from "../auth.js";
import { hash, token } from "../crypto.js";
const params = z.object({ id });
const serverInput = z
  .object({
    name: text.min(2).max(80),
    description: z.string().trim().max(600).default(""),
    category: text.max(40).default("Community"),
    isPublic: z.boolean().default(false),
  })
  .strict();
const memberPermissions = [
  "VIEW_CHANNEL",
  "SEND_MESSAGES",
  "ATTACH_FILES",
  "ADD_REACTIONS",
  "CONNECT_VOICE",
  "SPEAK",
  "STREAM",
  "CREATE_INVITE",
  "MUSIC_PLAY",
  "MUSIC_PAUSE",
];
export async function createServer(
  db: DB,
  userId: string,
  input: z.infer<typeof serverInput>,
  serverId = randomUUID(),
) {
  const roleDefinitions = [
    { name: "Member", position: 0, permissions: memberPermissions },
    {
      name: "Moderator",
      position: 20,
      permissions: [
        ...memberPermissions,
        "MANAGE_MESSAGES",
        "MUTE_MEMBERS",
        "DEAFEN_MEMBERS",
        "MOVE_MEMBERS",
        "KICK_MEMBERS",
        "MANAGE_EVENTS",
        "MUSIC_SKIP",
        "MUSIC_STOP",
        "MUSIC_VOLUME",
        "MUSIC_QUEUE_MANAGE",
        "MUSIC_MOVE",
      ],
    },
    { name: "Admin", position: 50, permissions },
  ];
  const roleIds = roleDefinitions.map(() => randomUUID());
  const rolePermissionRows = roleDefinitions.flatMap((role, index) =>
    role.permissions.map((permission) => ({
      roleId: roleIds[index],
      permission,
    })),
  );
  const categories = [
    {
      id: randomUUID(),
      name: "Community",
      position: 0,
      channels: ["general", "introductions", "share-your-work", "inspiration"],
    },
    { id: randomUUID(), name: "Voice", position: 1, channels: ["lounge"] },
  ];
  const channels = categories.flatMap((category) =>
    category.channels.map((slug, index) => ({
      id: randomUUID(),
      categoryId: category.id,
      slug,
      kind: category.name === "Voice" ? "voice" : "text",
      position: category.position * 10 + index,
    })),
  );
  await db.query(
    `WITH created_server AS (
       INSERT INTO servers(id,owner_id,name,description,category,mark,is_public)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       RETURNING id
     ), created_membership AS (
       INSERT INTO server_members(server_id,user_id)
       SELECT id,$2 FROM created_server
       RETURNING server_id
     )
     SELECT created_server.id,(SELECT count(*) FROM created_membership) AS memberships
     FROM created_server`,
    [
      serverId,
      userId,
      input.name,
      input.description,
      input.category,
      input.name
        .split(" ")
        .map((s) => s[0])
        .slice(0, 2)
        .join("")
        .toLowerCase(),
      input.isPublic,
    ],
  );
  await db.query(
    `WITH created_roles AS (
       INSERT INTO roles(id,server_id,name,position,is_default)
       SELECT role_id,$1,name,position,name='Member'
       FROM unnest($2::text[],$3::text[],$4::integer[])
         AS role(role_id,name,position)
       RETURNING id
     ), created_settings AS (
       INSERT INTO music_settings(server_id) VALUES($1)
       ON CONFLICT DO NOTHING
       RETURNING server_id
     ), created_metrics AS (
       INSERT INTO music_metrics(server_id)
       SELECT server_id FROM created_settings
       ON CONFLICT DO NOTHING
       RETURNING server_id
     ), created_categories AS (
       INSERT INTO channel_categories(id,server_id,name,position)
       SELECT category_id,$1,name,position
       FROM unnest($5::text[],$6::text[],$7::integer[])
         AS category(category_id,name,position)
       RETURNING id
     )
     SELECT (SELECT count(*) FROM created_roles) AS roles,
            (SELECT count(*) FROM created_metrics) AS metrics,
            (SELECT count(*) FROM created_categories) AS categories`,
    [
      serverId,
      roleIds,
      roleDefinitions.map((role) => role.name),
      roleDefinitions.map((role) => role.position),
      categories.map((category) => category.id),
      categories.map((category) => category.name),
      categories.map((category) => category.position),
    ],
  );
  await db.query(
    `INSERT INTO role_permissions(role_id,permission)
     SELECT role_id,permission
     FROM unnest($1::text[],$2::text[]) AS item(role_id,permission)`,
    [
      rolePermissionRows.map((row) => row.roleId),
      rolePermissionRows.map((row) => row.permission),
    ],
  );
  const channelValues = channels.flatMap((channel) => [
    channel.id,
    serverId,
    channel.categoryId,
    channel.slug,
    channel.kind,
    channel.position,
  ]);
  await db.query(
    `INSERT INTO channels(id,server_id,category_id,name,slug,kind,position) VALUES ${channels
      .map((_, index) => {
        const offset = index * 6;
        return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 4},$${offset + 5},$${offset + 6})`;
      })
      .join(",")}`,
    channelValues,
  );
  await db.query(
    "SELECT noctis.append_audit($1,'server.created',$2,$2,'{}'::jsonb),pg_notify('noctis_changes',$3)",
    [userId, serverId, `user:${userId}`],
  );
  return serverId;
}
export async function communityRoutes(app: FastifyInstance) {
  app.post("/api/servers", async (req, reply) => {
    const input = serverInput.parse(req.body);
    await throttle("server-create", req.identity.userId, 5, 3600);
    const id = await transaction(req.identity, (db) =>
      createServer(db, req.identity.userId, input),
    );
    reply.code(201);
    return { id };
  });
  app.patch("/api/servers/:id", (req) =>
    transaction(req.identity, async (db) => {
      const p = params.parse(req.params);
      const input = serverInput
        .partial()
        .extend({
          mark: z.string().trim().min(1).max(4).optional(),
          image: z
            .enum([
              "/images/mountains.jpg",
              "/images/architecture.jpg",
              "/images/night.jpg",
              "/images/music.jpg",
            ])
            .optional(),
        })
        .strict()
        .parse(req.body);
      await permit(db, p.id, "MANAGE_SERVER");
      await db.query(
        "UPDATE servers SET name=coalesce($2,name),description=coalesce($3,description),category=coalesce($4,category),is_public=coalesce($5,is_public),mark=coalesce($6,mark),image=coalesce($7,image),updated_at=now() WHERE id=$1",
        [
          p.id,
          input.name ?? null,
          input.description ?? null,
          input.category ?? null,
          input.isPublic ?? null,
          input.mark ?? null,
          input.image ?? null,
        ],
      );
      await audit(db, req.identity.userId, "server.updated", p.id, p.id);
      await changed(db, `server:${p.id}`);
      return { ok: true };
    }),
  );
  app.post("/api/servers/:id/join", async (req) => {
    const p = params.parse(req.params);
    z.object({}).strict().parse(req.body);
    await throttle("join", req.identity.userId, 15, 300);
    return transaction(req.identity, async (db) => {
      const r = await db.query(
        "SELECT id FROM servers WHERE id=$1 AND is_public AND deleted_at IS NULL",
        [p.id],
      );
      requireThat(r.rowCount);
      const banned = await db.query("SELECT noctis.is_banned($1) AS banned", [
        p.id,
      ]);
      requireThat(!banned.rows[0].banned, 403, "You cannot join this server.");
      await db.query(
        "INSERT INTO server_members(server_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [p.id, req.identity.userId],
      );
      await audit(db, req.identity.userId, "server.joined", p.id, p.id);
      await changed(db, `server:${p.id}`);
      await changed(db, `user:${req.identity.userId}`);
      return { ok: true };
    });
  });
  app.delete("/api/servers/:id/membership", (req) =>
    transaction(req.identity, async (db) => {
      const p = params.parse(req.params);
      await member(db, p.id);
      const s = await db.query("SELECT owner_id FROM servers WHERE id=$1", [
        p.id,
      ]);
      requireThat(
        s.rows[0].owner_id !== req.identity.userId,
        409,
        "Transfer ownership before leaving your server.",
      );
      await db.query(
        "DELETE FROM server_members WHERE server_id=$1 AND user_id=$2",
        [p.id, req.identity.userId],
      );
      await audit(db, req.identity.userId, "server.left", p.id, p.id);
      await changed(db, `server:${p.id}`);
      await changed(db, `user:${req.identity.userId}`);
      return { ok: true };
    }),
  );
  app.post("/api/servers/:id/channels", (req) =>
    transaction(req.identity, async (db) => {
      const p = params.parse(req.params);
      const input = z
        .object({
          name: text.max(60).regex(/^[a-z0-9-]+$/),
          description: z.string().max(300).default(""),
          kind: z.enum(["text", "voice"]).default("text"),
          categoryId: id.optional(),
          isPrivate: z.boolean().default(false),
        })
        .strict()
        .parse(req.body);
      await permit(db, p.id, "MANAGE_CHANNELS");
      if (input.categoryId)
        requireThat(
          (
            await db.query(
              "SELECT id FROM channel_categories WHERE id=$1 AND server_id=$2",
              [input.categoryId, p.id],
            )
          ).rowCount,
          400,
          "Choose a category in this server.",
        );
      const channelId = randomUUID();
      await db.query(
        "INSERT INTO channels(server_id,name,slug,description,kind,category_id,is_private,id) VALUES($1,$2,$2,$3,$4,$5,$6,$7)",
        [
          p.id,
          input.name,
          input.description,
          input.kind,
          input.categoryId || null,
          input.isPrivate,
          channelId,
        ],
      );
      await audit(db, req.identity.userId, "channel.created", channelId, p.id);
      await changed(db, `server:${p.id}`);
      return { id: channelId };
    }),
  );
  app.post("/api/servers/:id/categories", (req) =>
    transaction(req.identity, async (db) => {
      const p = params.parse(req.params);
      const input = z
        .object({
          name: text.max(60),
          position: z.number().int().min(0).max(100).default(0),
        })
        .strict()
        .parse(req.body);
      await permit(db, p.id, "MANAGE_CHANNELS");
      const r = await db.query(
        "INSERT INTO channel_categories(server_id,name,position) VALUES($1,$2,$3) RETURNING id",
        [p.id, input.name, input.position],
      );
      await audit(
        db,
        req.identity.userId,
        "category.created",
        r.rows[0].id,
        p.id,
      );
      await changed(db, `server:${p.id}`);
      return r.rows[0];
    }),
  );
  app.patch("/api/channels/:id", (req) =>
    transaction(req.identity, async (db) => {
      const p = params.parse(req.params);
      const input = z
        .object({
          name: text
            .max(60)
            .regex(/^[a-z0-9-]+$/)
            .optional(),
          description: z.string().max(300).optional(),
          isPrivate: z.boolean().optional(),
          deleted: z.boolean().optional(),
        })
        .strict()
        .parse(req.body);
      const c = await channel(db, p.id);
      await permit(db, c.server_id, "MANAGE_CHANNELS");
      await db.query(
        "UPDATE channels SET name=coalesce($2,name),slug=coalesce($2,slug),description=coalesce($3,description),is_private=coalesce($4,is_private),deleted_at=CASE WHEN $5 THEN now() ELSE deleted_at END WHERE id=$1",
        [
          p.id,
          input.name ?? null,
          input.description ?? null,
          input.isPrivate ?? null,
          input.deleted || false,
        ],
      );
      await audit(
        db,
        req.identity.userId,
        "channel.updated",
        p.id,
        c.server_id,
      );
      await changed(db, `server:${c.server_id}`);
      return { ok: true };
    }),
  );
  app.post("/api/servers/:id/roles", (req) =>
    transaction(req.identity, async (db) => {
      const p = params.parse(req.params);
      const input = z
        .object({
          name: text.max(40),
          position: z.number().int().min(1).max(100),
          permissions: z.array(z.enum(permissions)).max(permissions.length),
        })
        .strict()
        .parse(req.body);
      const ranks = await hierarchy(db, p.id, req.identity.userId);
      requireThat(
        ranks.owner_id === req.identity.userId ||
          ranks.actor_rank > input.position,
        403,
        "Choose a role position below your own.",
      );
      for (const permission of input.permissions)
        await permit(db, p.id, permission);
      const r = await db.query(
        "INSERT INTO roles(server_id,name,position) VALUES($1,$2,$3) RETURNING id",
        [p.id, input.name, input.position],
      );
      for (const permission of new Set(input.permissions))
        await db.query("INSERT INTO role_permissions VALUES($1,$2)", [
          r.rows[0].id,
          permission,
        ]);
      await audit(db, req.identity.userId, "role.created", r.rows[0].id, p.id);
      await changed(db, `server:${p.id}`);
      return r.rows[0];
    }),
  );
  app.put("/api/servers/:id/members/:user/role", (req) =>
    transaction(req.identity, async (db) => {
      const p = z.object({ id, user: id }).parse(req.params);
      const input = z.object({ roleId: id }).strict().parse(req.body);
      await member(db, p.id);
      requireThat(
        (
          await db.query(
            "SELECT 1 FROM server_members WHERE server_id=$1 AND user_id=$2",
            [p.id, p.user],
          )
        ).rowCount,
      );
      await hierarchy(db, p.id, req.identity.userId, p.user, input.roleId);
      await db.query(
        "DELETE FROM member_roles WHERE server_id=$1 AND user_id=$2",
        [p.id, p.user],
      );
      await db.query("INSERT INTO member_roles VALUES($1,$2,$3)", [
        p.id,
        p.user,
        input.roleId,
      ]);
      await audit(
        db,
        req.identity.userId,
        "member.role.changed",
        p.user,
        p.id,
        { roleId: input.roleId },
      );
      await changed(db, `server:${p.id}`);
      return { ok: true };
    }),
  );
  app.put("/api/servers/:id/roles/:role/permissions", (req) =>
    transaction(req.identity, async (db) => {
      const p = z.object({ id, role: id }).parse(req.params);
      const input = z
        .object({
          permissions: z.array(z.enum(permissions)).max(permissions.length),
        })
        .strict()
        .parse(req.body);
      await hierarchy(db, p.id, req.identity.userId, undefined, p.role);
      for (const permission of input.permissions)
        await permit(db, p.id, permission);
      await db.query("DELETE FROM role_permissions WHERE role_id=$1", [p.role]);
      for (const permission of new Set(input.permissions))
        await db.query("INSERT INTO role_permissions VALUES($1,$2)", [
          p.role,
          permission,
        ]);
      await audit(
        db,
        req.identity.userId,
        "role.permissions.changed",
        p.role,
        p.id,
      );
      await changed(db, `server:${p.id}`);
      return { ok: true };
    }),
  );
  app.put("/api/channels/:id/permissions", (req) =>
    transaction(req.identity, async (db) => {
      const p = params.parse(req.params);
      const input = z
        .object({
          roleId: id,
          permission: z.enum(permissions),
          allowed: z.boolean(),
        })
        .strict()
        .parse(req.body);
      const c = await channel(db, p.id);
      await hierarchy(
        db,
        c.server_id,
        req.identity.userId,
        undefined,
        input.roleId,
      );
      await permit(db, c.server_id, input.permission);
      await db.query(
        "INSERT INTO channel_role_permissions VALUES($1,$2,$3,$4) ON CONFLICT(channel_id,role_id,permission) DO UPDATE SET allowed=excluded.allowed",
        [p.id, input.roleId, input.permission, input.allowed],
      );
      await audit(
        db,
        req.identity.userId,
        "channel.permissions.changed",
        p.id,
        c.server_id,
      );
      await changed(db, `server:${c.server_id}`);
      return { ok: true };
    }),
  );
  app.post("/api/servers/:id/moderation", (req) =>
    transaction(req.identity, async (db) => {
      const p = params.parse(req.params);
      const input = z
        .object({
          userId: id,
          action: z.enum(["kick", "ban", "unban"]),
          reason: text.max(500),
        })
        .strict()
        .parse(req.body);
      await permit(
        db,
        p.id,
        input.action === "kick" ? "KICK_MEMBERS" : "BAN_MEMBERS",
      );
      await db.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('server:'||$1,0))",
        [p.id],
      );
      const rank = await db.query(
        "SELECT owner_id,noctis.rank(id,$2) AS actor,noctis.rank(id,$3) AS target FROM servers WHERE id=$1",
        [p.id, req.identity.userId, input.userId],
      );
      requireThat(
        input.userId !== req.identity.userId &&
          input.userId !== rank.rows[0].owner_id &&
          rank.rows[0].actor > rank.rows[0].target,
        403,
        "You can moderate only members below your role.",
      );
      if (input.action === "ban")
        await db.query(
          "INSERT INTO server_bans(server_id,user_id,actor_id,reason) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [p.id, input.userId, req.identity.userId, input.reason],
        );
      if (input.action === "unban")
        await db.query(
          "DELETE FROM server_bans WHERE server_id=$1 AND user_id=$2",
          [p.id, input.userId],
        );
      else
        await db.query(
          "DELETE FROM server_members WHERE server_id=$1 AND user_id=$2",
          [p.id, input.userId],
        );
      await db.query(
        "INSERT INTO moderation_actions(server_id,actor_id,target_id,action,reason) VALUES($1,$2,$3,$4,$5)",
        [p.id, req.identity.userId, input.userId, input.action, input.reason],
      );
      await audit(
        db,
        req.identity.userId,
        `moderation.${input.action}`,
        input.userId,
        p.id,
      );
      await changed(db, `server:${p.id}`);
      await changed(db, `user:${input.userId}`);
      return { ok: true };
    }),
  );
  app.get("/api/servers/:id/audit", (req) =>
    transaction(req.identity, async (db) => {
      const p = params.parse(req.params);
      const q = page.parse(req.query);
      await permit(db, p.id, "VIEW_AUDIT_LOG");
      return (
        await db.query(
          'SELECT id,actor_id AS "actorId",action,target,metadata,created_at AS "createdAt",record_hash AS "recordHash",previous_hash AS "previousHash" FROM audit_logs WHERE server_id=$1 AND ($2::timestamptz IS NULL OR created_at<$2) ORDER BY created_at DESC LIMIT $3',
          [p.id, q.before || null, q.limit],
        )
      ).rows;
    }),
  );
  app.post("/api/servers/:id/invites", async (req) => {
    const p = params.parse(req.params);
    const input = z
      .object({
        maxUses: z.number().int().min(1).max(1000).default(25),
        expiresHours: z.number().int().min(1).max(168).default(24),
      })
      .strict()
      .parse(req.body);
    await throttle("invite-create", req.identity.userId, 10, 300);
    return transaction(req.identity, async (db) => {
      await permit(db, p.id, "CREATE_INVITE");
      const secret = token();
      const r = await db.query(
        "INSERT INTO invitations(server_id,created_by,token_hash,max_uses,expires_at) VALUES($1,$2,$3,$4,now()+$5*interval '1 hour') RETURNING id,expires_at",
        [
          p.id,
          req.identity.userId,
          hash(secret),
          input.maxUses,
          input.expiresHours,
        ],
      );
      await audit(
        db,
        req.identity.userId,
        "invite.created",
        r.rows[0].id,
        p.id,
      );
      return {
        id: r.rows[0].id,
        token: secret,
        expiresAt: r.rows[0].expires_at,
      };
    });
  });
  app.post("/api/servers/:id/invites/:invite/send", async (req) => {
    const p = z.object({ id, invite: id }).parse(req.params);
    const input = z
      .object({ userId: id, token: z.string().regex(/^[\w-]{43}$/) })
      .strict()
      .parse(req.body);
    await throttle("invite-send", req.identity.userId, 15, 3600);
    return transaction(req.identity, async (db) => {
      await permit(db, p.id, "CREATE_INVITE");
      const recipient = await canContact(db, input.userId, req.identity.userId);
      requireThat(
        recipient.allow_invites,
        403,
        "This person is not accepting invitations.",
      );
      const invitation = await db.query(
        "SELECT s.name FROM invitations i JOIN servers s ON s.id=i.server_id WHERE i.id=$1 AND i.server_id=$2 AND i.token_hash=$3 AND i.revoked_at IS NULL AND i.expires_at>now() AND i.uses<i.max_uses",
        [p.invite, p.id, hash(input.token)],
      );
      requireThat(invitation.rowCount, 404, "This invitation is unavailable.");
      await db.query(
        "INSERT INTO notifications(user_id,actor_id,kind,title,route) VALUES($1,$2,'invite',$3,$4)",
        [
          input.userId,
          req.identity.userId,
          `You're invited to ${invitation.rows[0].name}`,
          `invite/${input.token}`,
        ],
      );
      await audit(db, req.identity.userId, "invite.sent", input.userId, p.id);
      await changed(db, `user:${input.userId}`);
      return { ok: true };
    });
  });
  app.delete("/api/servers/:id/invites/:invite", (req) =>
    transaction(req.identity, async (db) => {
      const p = z.object({ id, invite: id }).parse(req.params);
      await permit(db, p.id, "CREATE_INVITE");
      const r = await db.query(
        "UPDATE invitations SET revoked_at=now() WHERE id=$1 AND server_id=$2 RETURNING id",
        [p.invite, p.id],
      );
      requireThat(r.rowCount);
      await audit(db, req.identity.userId, "invite.revoked", p.invite, p.id);
      return { ok: true };
    }),
  );
  app.get("/api/invites/:token", (req) =>
    transaction(req.identity, async (db) => {
      const p = z
        .object({ token: z.string().regex(/^[\w-]{43}$/) })
        .parse(req.params);
      const r = await db.query("SELECT * FROM noctis.preview_invite($1)", [
        hash(p.token),
      ]);
      requireThat(
        r.rowCount,
        404,
        "This invite has expired or is unavailable.",
      );
      return r.rows[0];
    }),
  );
  app.post("/api/invites/:token/join", async (req) => {
    const p = z
      .object({ token: z.string().regex(/^[\w-]{43}$/) })
      .parse(req.params);
    z.object({}).strict().parse(req.body);
    await throttle("invite-redeem", req.identity.userId, 15, 300);
    return transaction(req.identity, async (db) => {
      const r = await db.query("SELECT noctis.redeem_invite($1) AS id", [
        hash(p.token),
      ]);
      requireThat(
        r.rows[0].id,
        404,
        "This invite has expired or is unavailable.",
      );
      await audit(
        db,
        req.identity.userId,
        "invite.redeemed",
        "invite",
        r.rows[0].id,
      );
      await changed(db, `server:${r.rows[0].id}`);
      await changed(db, `user:${req.identity.userId}`);
      return { id: r.rows[0].id };
    });
  });
  app.patch("/api/profile", (req) =>
    transaction(req.identity, async (db) => {
      const input = z
        .object({
          name: text.min(2).max(60).optional(),
          handle: z
            .string()
            .min(3)
            .max(32)
            .regex(/^[a-z0-9_.]+$/)
            .optional(),
          bio: z.string().max(600).optional(),
          activity: z.string().max(120).optional(),
          status: z.enum(["online", "idle", "offline"]).optional(),
          avatarUploadId: id.nullable().optional(),
        })
        .strict()
        .parse(req.body);
      if (input.avatarUploadId)
        requireThat(
          (
            await db.query(
              "SELECT id FROM uploads WHERE id=$1 AND owner_id=$2 AND purpose='avatar'",
              [input.avatarUploadId, req.identity.userId],
            )
          ).rowCount,
          400,
          "This avatar is unavailable.",
        );
      await db.query(
        "UPDATE profiles SET name=coalesce($2,name),handle=coalesce($3,handle),bio=coalesce($4,bio),activity=coalesce($5,activity),status=coalesce($6,status),avatar_upload_id=CASE WHEN $7 THEN $8 ELSE avatar_upload_id END,updated_at=now() WHERE user_id=$1",
        [
          req.identity.userId,
          input.name ?? null,
          input.handle ?? null,
          input.bio ?? null,
          input.activity ?? null,
          input.status ?? null,
          input.avatarUploadId !== undefined,
          input.avatarUploadId ?? null,
        ],
      );
      await changed(db, `user:${req.identity.userId}`);
      await db.query(
        "SELECT pg_notify('noctis_changes','server:'||server_id) FROM server_members WHERE user_id=$1",
        [req.identity.userId],
      );
      return { ok: true };
    }),
  );
  app.patch("/api/settings", (req) =>
    transaction(req.identity, async (db) => {
      const input = z
        .object({
          theme: z.enum(["midnight", "graphite"]).optional(),
          motion: z.boolean().optional(),
          sounds: z.boolean().optional(),
          desktop: z.boolean().optional(),
          mentions: z.boolean().optional(),
          interests: z.string().max(300).optional(),
          status: z.enum(["online", "idle", "offline"]).optional(),
          activity: z.boolean().optional(),
          direct: z.boolean().optional(),
          friendRequests: z.boolean().optional(),
          invites: z.boolean().optional(),
          dmPolicy: z.enum(["community", "friends", "nobody"]).optional(),
          profileVisibility: z
            .enum(["community", "friends", "private"])
            .optional(),
          language: z.enum(["en-US", "pt-BR"]).optional(),
        })
        .strict()
        .parse(req.body);
      await db.query(
        "UPDATE profiles SET allow_dm=coalesce($2,allow_dm),profile_visibility=coalesce($3,profile_visibility),show_activity=coalesce($4,show_activity),allow_invites=coalesce($5,allow_invites),allow_friend_requests=coalesce($6,allow_friend_requests),status=coalesce($7,status),updated_at=now() WHERE user_id=$1",
        [
          req.identity.userId,
          input.dmPolicy ??
            (input.direct === undefined
              ? null
              : input.direct
                ? "friends"
                : "nobody"),
          input.profileVisibility ?? null,
          input.activity ?? null,
          input.invites ?? null,
          input.friendRequests ?? null,
          input.status ?? null,
        ],
      );
      for (const key of [
        "theme",
        "motion",
        "sounds",
        "desktop",
        "mentions",
        "interests",
        "language",
      ] as const)
        if (input[key] !== undefined)
          await db.query(
            "INSERT INTO user_settings VALUES($1,$2,$3) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value",
            [req.identity.userId, key, String(input[key])],
          );
      await audit(
        db,
        req.identity.userId,
        "privacy.settings.updated",
        req.identity.userId,
      );
      await changed(db, `user:${req.identity.userId}`);
      await db.query(
        "SELECT pg_notify('noctis_changes','server:'||server_id) FROM server_members WHERE user_id=$1",
        [req.identity.userId],
      );
      return { ok: true };
    }),
  );
  app.post("/api/friends", async (req) => {
    const input = z
      .object({ handle: text.max(32) })
      .strict()
      .parse(req.body);
    await throttle("friend-request", req.identity.userId, 15, 3600);
    return transaction(req.identity, async (db) => {
      const r = await db.query("SELECT user_id FROM profiles WHERE handle=$1", [
        input.handle.replace(/^@/, ""),
      ]);
      requireThat(r.rowCount, 404, "This person is unavailable.");
      const target = r.rows[0].user_id;
      const p = await canContact(db, target, req.identity.userId);
      requireThat(
        p.allow_friend_requests,
        403,
        "This person is not accepting friend requests.",
      );
      await db.query(
        "INSERT INTO friendships(requester_id,recipient_id,status) VALUES($1,$2,'pending') ON CONFLICT DO NOTHING",
        [req.identity.userId, target],
      );
      await db.query(
        "INSERT INTO notifications(user_id,actor_id,kind,title,route) VALUES($1,$2,'friend-request','A new friend request','friends')",
        [target, req.identity.userId],
      );
      await changed(db, `user:${target}`);
      await changed(db, `user:${req.identity.userId}`);
      return { ok: true };
    });
  });
  app.put("/api/friends/:id", (req) =>
    transaction(req.identity, async (db) => {
      const p = params.parse(req.params);
      const input = z.object({ accept: z.boolean() }).strict().parse(req.body);
      if (input.accept) {
        const r = await db.query(
          "UPDATE friendships SET status='accepted' WHERE requester_id=$1 AND recipient_id=$2 AND NOT noctis.blocked($1,$2) RETURNING requester_id",
          [p.id, req.identity.userId],
        );
        requireThat(r.rowCount);
      } else
        await db.query(
          "DELETE FROM friendships WHERE (requester_id=$1 AND recipient_id=$2) OR (requester_id=$2 AND recipient_id=$1)",
          [p.id, req.identity.userId],
        );
      await changed(db, `user:${p.id}`);
      await changed(db, `user:${req.identity.userId}`);
      return { ok: true };
    }),
  );
  app.put("/api/blocks/:id", (req) =>
    transaction(req.identity, async (db) => {
      const p = params.parse(req.params);
      const input = z.object({ blocked: z.boolean() }).strict().parse(req.body);
      requireThat(
        p.id !== req.identity.userId,
        400,
        "You cannot block yourself.",
      );
      if (input.blocked) {
        await db.query(
          "INSERT INTO user_blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [req.identity.userId, p.id],
        );
        await db.query(
          "DELETE FROM friendships WHERE (requester_id=$1 AND recipient_id=$2) OR (requester_id=$2 AND recipient_id=$1)",
          [req.identity.userId, p.id],
        );
      } else
        await db.query(
          "DELETE FROM user_blocks WHERE blocker_id=$1 AND blocked_id=$2",
          [req.identity.userId, p.id],
        );
      await audit(
        db,
        req.identity.userId,
        input.blocked ? "privacy.blocked" : "privacy.unblocked",
        p.id,
      );
      await changed(db, `user:${req.identity.userId}`);
      await changed(db, `user:${p.id}`);
      return { ok: true };
    }),
  );
  app.put("/api/notifications/read", (req) =>
    transaction(req.identity, async (db) => {
      const input = z
        .object({ ids: z.array(id).max(100) })
        .strict()
        .parse(req.body);
      await db.query(
        "UPDATE notifications SET read_at=now() WHERE user_id=$1 AND id=ANY($2)",
        [req.identity.userId, input.ids],
      );
      await changed(db, `user:${req.identity.userId}`);
      return { ok: true };
    }),
  );
}

