import "dotenv/config";
import pg from "pg";
import { hash as passwordHash, Algorithm } from "@node-rs/argon2";
import { users, servers, messages, missions, events } from "./seed-data.js";
import { permissions } from "./authorization.js";
if (
  process.env.NODE_ENV === "production" ||
  (!process.argv.includes("--demo") && process.env.SEED_DEMO !== "true")
)
  throw new Error(
    "Demo seeding requires --demo and a non-production environment.",
  );
if (
  !process.env.SEED_EMAIL ||
  !process.env.SEED_PASSWORD ||
  process.env.SEED_PASSWORD.length < 12
)
  throw new Error("Set SEED_EMAIL and a strong SEED_PASSWORD before seeding.");
const db = new pg.Client({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
await db.connect();
try {
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(167826)");
  if ((await db.query("SELECT 1 FROM noctis.users WHERE id='alex'")).rowCount) {
    console.log("Demo already seeded; existing data preserved.");
    await db.query("ROLLBACK");
  } else {
    for (const u of users) {
      await db.query(
        "INSERT INTO noctis.users(id,email,password_hash,email_verified_at) VALUES($1,$2,$3,now())",
        [
          u.id,
          u.id === "alex"
            ? process.env.SEED_EMAIL.toLowerCase()
            : `${u.id}@seed.noctis.invalid`,
          u.id === "alex"
            ? await passwordHash(process.env.SEED_PASSWORD, {
                algorithm: Algorithm.Argon2id,
                memoryCost: 65536,
                timeCost: 3,
                parallelism: 1,
              })
            : null,
        ],
      );
      await db.query(
        "INSERT INTO noctis.profiles(user_id,name,handle,avatar,bio,status,activity,color,allow_dm) VALUES($1,$2,$3,$4,$5,'online',$6,$7,'community')",
        [u.id, u.name, u.handle, u.avatar, u.bio, u.activity, u.color],
      );
    }
    const channels = new Map<string, string>();
    for (const s of servers) {
      await db.query(
        "INSERT INTO noctis.servers(id,owner_id,name,description,mark,image,color,category,is_public) VALUES($1,'alex',$2,$3,$4,$5,$6,$7,true)",
        [s.id, s.name, s.description, s.mark, s.image, s.color, s.category],
      );
      for (const u of users)
        await db.query(
          "INSERT INTO noctis.server_members(server_id,user_id,joined_at) VALUES($1,$2,now()-interval '30 days')",
          [s.id, u.id],
        );
      for (const [name, position] of [
        ["Member", 0],
        ["Moderator", 20],
        ["Admin", 50],
      ] as const) {
        const r = await db.query(
          "INSERT INTO noctis.roles(server_id,name,position,is_default) VALUES($1,$2,$3,$4) RETURNING id",
          [s.id, name, position, name === "Member"],
        );
        const perms =
          name === "Admin"
            ? permissions
            : name === "Moderator"
              ? permissions.filter(
                  (p) =>
                    ![
                      "MANAGE_ROLES",
                      "MANAGE_SERVER",
                      "BAN_MEMBERS",
                      "MANAGE_CHANNELS",
                      "MANAGE_MISSIONS",
                    ].includes(p),
                )
              : [
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
        for (const p of perms)
          await db.query("INSERT INTO noctis.role_permissions VALUES($1,$2)", [
            r.rows[0].id,
            p,
          ]);
        if (name !== "Member")
          await db.query("INSERT INTO noctis.member_roles VALUES($1,$2,$3)", [
            s.id,
            name === "Admin" ? "sophie" : "james",
            r.rows[0].id,
          ]);
      }
      await db.query(
        "INSERT INTO noctis.music_settings(server_id) VALUES($1) ON CONFLICT DO NOTHING",
        [s.id],
      );
      await db.query(
        "INSERT INTO noctis.music_metrics(server_id) VALUES($1) ON CONFLICT DO NOTHING",
        [s.id],
      );
      for (const [category, slugs] of [
        ["START HERE", ["welcome", "announcements", "introductions"]],
        [
          "THE COLLECTIVE",
          [
            "general",
            "design-talk",
            "share-your-work",
            "inspiration",
            "resources",
          ],
        ],
        ["VOICE CHANNELS", ["lounge", "focus-room"]],
      ] as const) {
        const c = await db.query(
          "INSERT INTO noctis.channel_categories(server_id,name,position) VALUES($1,$2,$3) RETURNING id",
          [
            s.id,
            category,
            category === "START HERE"
              ? 0
              : category === "THE COLLECTIVE"
                ? 1
                : 2,
          ],
        );
        for (const [position, slug] of slugs.entries()) {
          const r = await db.query(
            "INSERT INTO noctis.channels(server_id,category_id,name,slug,kind,position) VALUES($1,$2,$3,$3,$4,$5) RETURNING id",
            [
              s.id,
              c.rows[0].id,
              slug,
              category === "VOICE CHANNELS" ? "voice" : "text",
              category === "START HERE"
                ? position
                : category === "THE COLLECTIVE"
                  ? 10 + position
                  : 20 + position,
            ],
          );
          channels.set(`${s.id}/${slug}`, r.rows[0].id);
        }
      }
    }
    const conversations = new Map<string, string>();
    for (const u of users.filter((u) => u.id !== "alex")) {
      const c = await db.query(
        "INSERT INTO noctis.direct_conversations(created_by) VALUES('alex') RETURNING id",
      );
      conversations.set(`dm/${u.id}`, c.rows[0].id);
      for (const id of ["alex", u.id])
        await db.query(
          "INSERT INTO noctis.direct_conversation_members(conversation_id,user_id,last_read_at) VALUES($1,$2,now()-interval '1 day')",
          [c.rows[0].id, id],
        );
      await db.query(
        "INSERT INTO noctis.friendships(requester_id,recipient_id,status) VALUES('alex',$1,'accepted')",
        [u.id],
      );
    }
    for (const [index, m] of messages.entries()) {
      const channel = channels.get(m.room);
      const conversation = conversations.get(m.room);
      if (!channel && !conversation) continue;
      await db.query(
        "INSERT INTO noctis.messages(id,channel_id,conversation_id,author_id,body,created_at,updated_at) VALUES($1,$2,$3,$4,$5,now()-interval '2 hours'+$6*interval '3 minutes',now()-interval '2 hours'+$6*interval '3 minutes')",
        [m.id, channel || null, conversation || null, m.user, m.text, index],
      );
      if (m.pinned)
        await db.query(
          "INSERT INTO noctis.pinned_messages(message_id,pinned_by) VALUES($1,'alex')",
          [m.id],
        );
      for (const [emoji, count] of Object.entries(m.reactions))
        for (const u of users.slice(1, Math.min(count + 1, 8)))
          await db.query(
            "INSERT INTO noctis.message_reactions(message_id,user_id,emoji) VALUES($1,$2,$3)",
            [m.id, u.id, emoji],
          );
    }
    for (const m of missions) {
      await db.query(
        "INSERT INTO noctis.missions(id,server_id,created_by,title,description,category,icon,color,due_at) VALUES($1,$2,'alex',$3,$4,$5,$6,'#aaa2ff',now()+interval '7 days')",
        [m.id, m.server, m.title, m.description, m.category, m.icon],
      );
      const b = await db.query(
        "INSERT INTO noctis.badges(name,server_id) VALUES($1,$2) RETURNING id",
        [m.badge, m.server],
      );
      await db.query(
        "INSERT INTO noctis.mission_rewards(mission_id,xp,badge_id) VALUES($1,$2,$3)",
        [m.id, m.xp, b.rows[0].id],
      );
      for (const u of users.slice(0, 4))
        await db.query(
          "INSERT INTO noctis.mission_members(mission_id,user_id) VALUES($1,$2)",
          [m.id, u.id],
        );
      for (const [position, o] of m.objectives.entries()) {
        const r = await db.query(
          "INSERT INTO noctis.mission_objectives(mission_id,description,position) VALUES($1,$2,$3) RETURNING id",
          [m.id, o.text, position],
        );
        if (o.done)
          await db.query(
            "INSERT INTO noctis.mission_progress(objective_id,user_id,verified_by) VALUES($1,'alex','alex')",
            [r.rows[0].id],
          );
      }
    }
    for (const u of users)
      await db.query(
        "INSERT INTO noctis.xp_transactions(user_id,server_id,amount) VALUES($1,'studio',$2)",
        [u.id, u.xp],
      );
    for (const [index, e] of events.entries()) {
      await db.query(
        "INSERT INTO noctis.events(id,server_id,created_by,title,description,starts_at,icon) VALUES($1,$2,'alex',$3,$4,now()+$5*interval '1 day',$6)",
        [e.id, e.server, e.title, e.description, index + 1, e.icon],
      );
      for (const u of users.slice(1, 5))
        await db.query(
          "INSERT INTO noctis.event_participants(event_id,user_id) VALUES($1,$2)",
          [e.id, u.id],
        );
    }
    await db.query(
      "INSERT INTO noctis.notifications(user_id,actor_id,server_id,kind,title,body,route) VALUES('alex','sophie','studio','welcome','Welcome to your collective','Your community is ready. Start a conversation or create a mission.','server/studio/general')",
    );
    await db.query(
      "SELECT noctis.append_audit('alex','demo.seeded','initial-content',NULL,'{}')",
    );
    await db.query("COMMIT");
    console.log(
      "Demo content seeded in PostgreSQL. Sign in with SEED_EMAIL and SEED_PASSWORD from your private environment.",
    );
  }
} catch (e) {
  await db.query("ROLLBACK");
  throw e;
} finally {
  await db.end();
}
