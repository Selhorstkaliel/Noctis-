import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { transaction, changed, audit, type DB } from "../db.js";
import { room, canContact, channel } from "../authorization.js";
import { id, requireThat, text } from "../errors.js";
import { throttle } from "../auth.js";
import { resolveRoom, messageDTO } from "./read.js";
export const messageInput = z
  .object({
    text: z.string().trim().max(4000).default(""),
    nonce: z.string().uuid(),
    replyTo: id.optional(),
    attachments: z.array(id).max(4).default([]),
  })
  .strict()
  .refine(
    (v) => v.text.length > 0 || v.attachments.length > 0,
    "Write a message or attach a file.",
  );
export async function sendMessage(
  db: DB,
  userId: string,
  key: string,
  input: z.infer<typeof messageInput>,
) {
  const access = await resolveRoom(db, key);
  await room(db, access, "SEND_MESSAGES");
  if (input.attachments.length) {
    await room(db, access, "ATTACH_FILES");
    const r = await db.query(
      "SELECT id FROM uploads WHERE id=ANY($1) AND owner_id=$2 AND purpose='message' AND channel_id IS NOT DISTINCT FROM $3 AND conversation_id IS NOT DISTINCT FROM $4",
      [
        input.attachments,
        userId,
        access.channelId || null,
        access.conversationId || null,
      ],
    );
    requireThat(
      r.rowCount === new Set(input.attachments).size,
      400,
      "An attachment is unavailable in this conversation.",
    );
  }
  if (input.replyTo) {
    const r = await db.query(
      "SELECT id FROM messages WHERE id=$1 AND channel_id IS NOT DISTINCT FROM $2 AND conversation_id IS NOT DISTINCT FROM $3 AND deleted_at IS NULL",
      [input.replyTo, access.channelId || null, access.conversationId || null],
    );
    requireThat(
      r.rowCount,
      400,
      "The reply is unavailable in this conversation.",
    );
  }
  const mentions = [
    ...new Set(
      [...input.text.matchAll(/@([a-zA-Z0-9_.]{3,32})/g)].map((m) => m[1]),
    ),
  ];
  requireThat(
    mentions.length <= 10,
    400,
    "A message can mention up to 10 people.",
  );
  const r = await db.query(
    "INSERT INTO messages(author_id,channel_id,conversation_id,body,client_nonce) VALUES($1,$2,$3,$4,$5) ON CONFLICT(author_id,client_nonce) DO NOTHING RETURNING *",
    [
      userId,
      access.channelId || null,
      access.conversationId || null,
      input.text,
      input.nonce,
    ],
  );
  if (!r.rowCount) {
    const existing = await db.query(
      "SELECT * FROM messages WHERE author_id=$1 AND client_nonce=$2 AND channel_id IS NOT DISTINCT FROM $3 AND conversation_id IS NOT DISTINCT FROM $4",
      [
        userId,
        input.nonce,
        access.channelId || null,
        access.conversationId || null,
      ],
    );
    requireThat(
      existing.rowCount,
      409,
      "This message identifier has already been used.",
    );
    return existing.rows[0].id;
  }
  const message = r.rows[0];
  if (input.replyTo)
    await db.query(
      "INSERT INTO message_replies(message_id,parent_id) VALUES($1,$2)",
      [message.id, input.replyTo],
    );
  for (const upload of input.attachments)
    await db.query(
      "INSERT INTO message_attachments(message_id,upload_id) VALUES($1,$2)",
      [message.id, upload],
    );
  for (const handle of mentions) {
    const p = await db.query(
      "SELECT user_id FROM profiles WHERE handle=$1 AND user_id<>$2 AND NOT noctis.blocked(user_id,$2) AND (noctis.channel_permission($3,'VIEW_CHANNEL',user_id) OR noctis.in_conversation($4,user_id))",
      [handle, userId, access.channelId || null, access.conversationId || null],
    );
    if (p.rowCount) {
      await db.query("INSERT INTO message_mentions VALUES($1,$2)", [
        message.id,
        p.rows[0].user_id,
      ]);
      await db.query(
        "INSERT INTO notifications(user_id,actor_id,kind,title,body,route) VALUES($1,$2,'mention','You were mentioned',$3,$4)",
        [
          p.rows[0].user_id,
          userId,
          input.text.slice(0, 200),
          access.channelId ? `server/${key}` : `messages/${userId}`,
        ],
      );
      await changed(db, `user:${p.rows[0].user_id}`);
    }
  }
  await changed(
    db,
    access.channelId
      ? `channel:${access.channelId}`
      : `conversation:${access.conversationId}`,
    message.id,
  );
  return message.id;
}
export async function chatRoutes(app: FastifyInstance) {
  app.post("/api/rooms/:room/messages", async (req, reply) => {
    const p = z.object({ room: z.string().min(1).max(160) }).parse(req.params);
    const input = messageInput.parse(req.body);
    await throttle("message", req.identity.userId, 30, 30);
    const result = await transaction(req.identity, (db) =>
      sendMessage(db, req.identity.userId, p.room, input),
    );
    reply.code(201);
    return { id: result };
  });
  app.patch("/api/messages/:id", async (req) => {
    const p = z.object({ id }).parse(req.params);
    const input = z
      .object({ text: text.max(4000) })
      .strict()
      .parse(req.body);
    await throttle("message-edit", req.identity.userId, 30, 60);
    return transaction(req.identity, async (db) => {
      const r = await db.query(
        "SELECT * FROM messages WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
        [p.id],
      );
      requireThat(r.rowCount);
      const m = r.rows[0];
      requireThat(
        m.author_id === req.identity.userId,
        403,
        "You can edit only your own messages.",
      );
      await room(
        db,
        { channelId: m.channel_id, conversationId: m.conversation_id },
        "SEND_MESSAGES",
      );
      await db.query(
        "UPDATE messages SET body=$1,updated_at=clock_timestamp() WHERE id=$2",
        [input.text, p.id],
      );
      await changed(
        db,
        m.channel_id
          ? `channel:${m.channel_id}`
          : `conversation:${m.conversation_id}`,
        m.id,
      );
      return { ok: true };
    });
  });
  app.delete("/api/messages/:id", (req) =>
    transaction(req.identity, async (db) => {
      const p = z.object({ id }).parse(req.params);
      const r = await db.query(
        "SELECT * FROM messages WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
        [p.id],
      );
      requireThat(r.rowCount);
      const m = r.rows[0];
      await room(db, {
        channelId: m.channel_id,
        conversationId: m.conversation_id,
      });
      if (m.author_id !== req.identity.userId) {
        requireThat(
          m.channel_id,
          403,
          "You can delete only your own direct messages.",
        );
        await channel(db, m.channel_id, "MANAGE_MESSAGES");
      }
      await db.query("UPDATE messages SET deleted_at=now() WHERE id=$1", [
        p.id,
      ]);
      await audit(
        db,
        req.identity.userId,
        "message.deleted",
        p.id,
        m.channel_id ? (await channel(db, m.channel_id)).server_id : null,
      );
      await changed(
        db,
        m.channel_id
          ? `channel:${m.channel_id}`
          : `conversation:${m.conversation_id}`,
        m.id,
      );
      return { ok: true };
    }),
  );
  app.post("/api/messages/:id/restore", (req) =>
    transaction(req.identity, async (db) => {
      z.object({}).strict().parse(req.body);
      const p = z.object({ id }).parse(req.params);
      const r = await db.query(
        "SELECT * FROM messages WHERE id=$1 AND author_id=$2 AND deleted_at>now()-interval '15 seconds' FOR UPDATE",
        [p.id, req.identity.userId],
      );
      requireThat(r.rowCount, 409, "The undo period has ended.");
      const m = r.rows[0];
      await room(
        db,
        { channelId: m.channel_id, conversationId: m.conversation_id },
        "SEND_MESSAGES",
      );
      await db.query("UPDATE messages SET deleted_at=NULL WHERE id=$1", [p.id]);
      await changed(
        db,
        m.channel_id
          ? `channel:${m.channel_id}`
          : `conversation:${m.conversation_id}`,
        m.id,
      );
      return { ok: true };
    }),
  );
  app.put("/api/messages/:id/reactions", async (req) => {
    const p = z.object({ id }).parse(req.params);
    const input = z
      .object({
        emoji: z.enum([
          "🤍",
          "🔥",
          "🙌",
          "✨",
          "👍",
          "🎉",
          "💜",
          "👏",
          "🚀",
          "❤️",
          "💯",
          "👀",
          "😊",
          "🫶",
        ]),
        active: z.boolean(),
      })
      .strict()
      .parse(req.body);
    await throttle("reaction", req.identity.userId, 40, 60);
    return transaction(req.identity, async (db) => {
      const r = await db.query(
        "SELECT * FROM messages WHERE id=$1 AND deleted_at IS NULL",
        [p.id],
      );
      requireThat(r.rowCount);
      const m = r.rows[0];
      await room(
        db,
        { channelId: m.channel_id, conversationId: m.conversation_id },
        "ADD_REACTIONS",
      );
      if (input.active)
        await db.query(
          "INSERT INTO message_reactions(message_id,user_id,emoji) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [p.id, req.identity.userId, input.emoji],
        );
      else
        await db.query(
          "DELETE FROM message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3",
          [p.id, req.identity.userId, input.emoji],
        );
      await changed(
        db,
        m.channel_id
          ? `channel:${m.channel_id}`
          : `conversation:${m.conversation_id}`,
        m.id,
      );
      return { ok: true };
    });
  });
  app.put("/api/messages/:id/pin", (req) =>
    transaction(req.identity, async (db) => {
      const p = z.object({ id }).parse(req.params);
      const input = z.object({ pinned: z.boolean() }).strict().parse(req.body);
      const r = await db.query(
        "SELECT * FROM messages WHERE id=$1 AND deleted_at IS NULL",
        [p.id],
      );
      requireThat(r.rowCount);
      const m = r.rows[0];
      await room(
        db,
        { channelId: m.channel_id, conversationId: m.conversation_id },
        "MANAGE_MESSAGES",
      );
      if (input.pinned)
        await db.query(
          "INSERT INTO pinned_messages(message_id,pinned_by) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [p.id, req.identity.userId],
        );
      else
        await db.query("DELETE FROM pinned_messages WHERE message_id=$1", [
          p.id,
        ]);
      await changed(
        db,
        m.channel_id
          ? `channel:${m.channel_id}`
          : `conversation:${m.conversation_id}`,
        m.id,
      );
      return { ok: true };
    }),
  );
  app.post("/api/rooms/:room/read", (req) =>
    transaction(req.identity, async (db) => {
      const p = z
        .object({ room: z.string().min(1).max(160) })
        .parse(req.params);
      z.object({}).strict().parse(req.body);
      const access = await resolveRoom(db, p.room);
      if (access.channelId)
        await db.query(
          "INSERT INTO channel_reads(channel_id,user_id) VALUES($1,$2) ON CONFLICT(channel_id,user_id) DO UPDATE SET read_at=now()",
          [access.channelId, req.identity.userId],
        );
      else
        await db.query(
          "UPDATE direct_conversation_members SET last_read_at=now() WHERE conversation_id=$1 AND user_id=$2",
          [access.conversationId, req.identity.userId],
        );
      await changed(db, `activity:${req.identity.userId}`);
      return { ok: true };
    }),
  );
  app.post("/api/conversations", async (req, reply) => {
    const input = z
      .object({
        members: z.array(id).min(1).max(8),
        name: text.max(80).optional(),
      })
      .strict()
      .parse(req.body);
    await throttle("conversations", req.identity.userId, 15, 300);
    return transaction(req.identity, async (db) => {
      const ids = [...new Set(input.members)].filter(
        (u) => u !== req.identity.userId,
      );
      requireThat(ids.length > 0, 400, "Choose someone to message.");
      for (const target of ids) {
        const p = await canContact(db, target, req.identity.userId);
        requireThat(
          (p.allow_dm === "community" && p.shared) ||
            (p.allow_dm !== "nobody" && p.friends),
          403,
          "This person’s privacy settings do not allow this conversation.",
        );
      }
      if (ids.length === 1 && !input.name) {
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          [req.identity.userId, ids[0]].sort().join(":"),
        ]);
        const existing = await db.query(
          "SELECT c.id FROM direct_conversations c JOIN direct_conversation_members m ON m.conversation_id=c.id WHERE c.name IS NULL AND noctis.in_conversation(c.id) AND m.user_id=$1 AND (SELECT count(*) FROM direct_conversation_members x WHERE x.conversation_id=c.id)=2 LIMIT 1",
          [ids[0]],
        );
        if (existing.rowCount)
          return { id: existing.rows[0].id, route: `messages/${ids[0]}` };
      }
      const c = await db.query(
        "INSERT INTO direct_conversations(created_by,name) VALUES($1,$2) RETURNING id",
        [req.identity.userId, input.name || null],
      );
      for (const user of [req.identity.userId, ...ids]) {
        await db.query(
          "INSERT INTO direct_conversation_members(conversation_id,user_id) VALUES($1,$2)",
          [c.rows[0].id, user],
        );
        await changed(db, `user:${user}`);
      }
      reply.code(201);
      return {
        id: c.rows[0].id,
        route: `messages/${input.name ? c.rows[0].id : ids[0]}`,
      };
    });
  });
}
