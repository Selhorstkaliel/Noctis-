import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { transaction, audit, changed } from "../db.js";
import { permit, member } from "../authorization.js";
import { requireThat, id, text } from "../errors.js";
const params = z.object({ id });
export async function missionRoutes(app: FastifyInstance) {
  app.post("/api/missions", (req) =>
    transaction(req.identity, async (db) => {
      const input = z
        .object({
          serverId: id,
          title: text.max(100),
          description: text.max(2000),
          category: text.max(40).default("Community"),
          xp: z.number().int().min(0).max(10000),
          badge: text.max(60),
          dueAt: z.string().datetime().optional(),
          objectives: z
            .array(
              z
                .object({
                  text: text.max(300),
                  verification: z.enum(["self", "moderator"]).default("self"),
                })
                .strict(),
            )
            .min(1)
            .max(20),
        })
        .strict()
        .parse(req.body);
      await permit(db, input.serverId, "MANAGE_MISSIONS");
      const b = await db.query(
        "INSERT INTO badges(server_id,name) VALUES($1,$2) RETURNING id",
        [input.serverId, input.badge],
      );
      const m = await db.query(
        "INSERT INTO missions(server_id,created_by,title,description,category,due_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
        [
          input.serverId,
          req.identity.userId,
          input.title,
          input.description,
          input.category,
          input.dueAt || null,
        ],
      );
      for (const [position, o] of input.objectives.entries())
        await db.query(
          "INSERT INTO mission_objectives(mission_id,description,position,verification) VALUES($1,$2,$3,$4)",
          [m.rows[0].id, o.text, position, o.verification],
        );
      await db.query(
        "INSERT INTO mission_rewards(mission_id,xp,badge_id) VALUES($1,$2,$3)",
        [m.rows[0].id, input.xp, b.rows[0].id],
      );
      await db.query("INSERT INTO mission_members VALUES($1,$2,now())", [
        m.rows[0].id,
        req.identity.userId,
      ]);
      await audit(
        db,
        req.identity.userId,
        "mission.created",
        m.rows[0].id,
        input.serverId,
      );
      await changed(db, `server:${input.serverId}`);
      return m.rows[0];
    }),
  );
  app.post("/api/missions/:id/join", (req) =>
    transaction(req.identity, async (db) => {
      const p = params.parse(req.params);
      z.object({}).strict().parse(req.body);
      const r = await db.query(
        "SELECT * FROM missions WHERE id=$1 AND deleted_at IS NULL",
        [p.id],
      );
      requireThat(r.rowCount);
      requireThat(
        !r.rows[0].due_at || new Date(r.rows[0].due_at) > new Date(),
        409,
        "This mission has ended.",
      );
      await member(db, r.rows[0].server_id);
      await db.query(
        "INSERT INTO mission_members(mission_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [p.id, req.identity.userId],
      );
      await changed(db, `server:${r.rows[0].server_id}`);
      return { ok: true };
    }),
  );
  app.put("/api/missions/:id/objectives/:objective", (req) =>
    transaction(req.identity, async (db) => {
      const p = z.object({ id, objective: id }).parse(req.params);
      const input = z
        .object({ done: z.boolean(), userId: id.optional() })
        .strict()
        .parse(req.body);
      const target = input.userId || req.identity.userId;
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "mission:" + p.id,
      ]);
      const r = await db.query(
        "SELECT o.*,m.server_id,m.due_at FROM mission_objectives o JOIN missions m ON m.id=o.mission_id WHERE o.id=$1 AND m.id=$2 AND m.deleted_at IS NULL",
        [p.objective, p.id],
      );
      requireThat(r.rowCount);
      const o = r.rows[0];
      await member(db, o.server_id);
      requireThat(
        !o.due_at || new Date(o.due_at) > new Date(),
        409,
        "This mission has ended.",
      );
      if (o.verification === "moderator" || target !== req.identity.userId)
        await permit(db, o.server_id, "MANAGE_MISSIONS");
      requireThat(
        (
          await db.query(
            "SELECT 1 FROM mission_members WHERE mission_id=$1 AND user_id=$2",
            [p.id, target],
          )
        ).rowCount,
        409,
        "Join this mission before completing objectives.",
      );
      requireThat(
        !(
          await db.query(
            "SELECT 1 FROM xp_transactions x JOIN mission_rewards r ON r.id=x.reward_id WHERE r.mission_id=$1 AND x.user_id=$2",
            [p.id, target],
          )
        ).rowCount,
        409,
        "Completed missions cannot be changed.",
      );
      if (input.done)
        await db.query(
          "INSERT INTO mission_progress(objective_id,user_id,verified_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [p.objective, target, req.identity.userId],
        );
      else
        await db.query(
          "DELETE FROM mission_progress WHERE objective_id=$1 AND user_id=$2",
          [p.objective, target],
        );
      if (o.verification === "moderator")
        await audit(
          db,
          req.identity.userId,
          "mission.objective.verified",
          p.objective,
          o.server_id,
          { member: target },
        );
      await changed(db, `user:${target}`);
      return { ok: true };
    }),
  );
  app.post("/api/missions/:id/claim", (req) =>
    transaction(req.identity, async (db) => {
      const p = params.parse(req.params);
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "mission:" + p.id,
      ]);
      z.object({}).strict().parse(req.body);
      const r = await db.query(
        "SELECT m.*,r.id AS reward_id,r.xp,r.badge_id FROM missions m JOIN mission_rewards r ON r.mission_id=m.id WHERE m.id=$1 AND m.deleted_at IS NULL",
        [p.id],
      );
      requireThat(r.rowCount);
      const m = r.rows[0];
      await member(db, m.server_id);
      requireThat(
        (
          await db.query(
            "SELECT 1 FROM mission_members WHERE mission_id=$1 AND user_id=$2",
            [p.id, req.identity.userId],
          )
        ).rowCount,
        409,
        "Join this mission first.",
      );
      const existing = await db.query(
        "SELECT id FROM xp_transactions WHERE reward_id=$1 AND user_id=$2",
        [m.reward_id, req.identity.userId],
      );
      if (existing.rowCount)
        return { claimed: true, xp: m.xp, alreadyClaimed: true };
      requireThat(
        !m.due_at || new Date(m.due_at) > new Date(),
        409,
        "This mission has ended.",
      );
      const incomplete = await db.query(
        "SELECT 1 FROM mission_objectives o WHERE o.mission_id=$1 AND NOT EXISTS(SELECT 1 FROM mission_progress p WHERE p.objective_id=o.id AND p.user_id=$2)",
        [p.id, req.identity.userId],
      );
      requireThat(
        !incomplete.rowCount,
        409,
        "Complete every objective before claiming this reward.",
      );
      await db.query(
        "INSERT INTO xp_transactions(user_id,server_id,reward_id,amount) VALUES($1,$2,$3,$4)",
        [req.identity.userId, m.server_id, m.reward_id, m.xp],
      );
      if (m.badge_id)
        await db.query(
          "INSERT INTO user_badges(user_id,badge_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [req.identity.userId, m.badge_id],
        );
      await audit(
        db,
        req.identity.userId,
        "mission.reward.claimed",
        p.id,
        m.server_id,
        { xp: m.xp },
      );
      await changed(db, `server:${m.server_id}`);
      return { claimed: true, xp: m.xp, alreadyClaimed: false };
    }),
  );
  app.delete("/api/missions/:id", (req) =>
    transaction(req.identity, async (db) => {
      const p = params.parse(req.params);
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "mission:" + p.id,
      ]);
      const r = await db.query("SELECT server_id FROM missions WHERE id=$1", [
        p.id,
      ]);
      requireThat(r.rowCount);
      await permit(db, r.rows[0].server_id, "MANAGE_MISSIONS");
      await db.query("UPDATE missions SET deleted_at=now() WHERE id=$1", [
        p.id,
      ]);
      await audit(
        db,
        req.identity.userId,
        "mission.archived",
        p.id,
        r.rows[0].server_id,
      );
      await changed(db, `server:${r.rows[0].server_id}`);
      return { ok: true };
    }),
  );
  app.post("/api/events", (req) =>
    transaction(req.identity, async (db) => {
      const input = z
        .object({
          serverId: id,
          title: text.max(100),
          description: z.string().max(2000).default(""),
          startsAt: z.string().datetime(),
          endsAt: z.string().datetime().optional(),
        })
        .strict()
        .parse(req.body);
      await permit(db, input.serverId, "MANAGE_EVENTS");
      requireThat(
        new Date(input.startsAt) > new Date(),
        400,
        "Schedule an event in the future.",
      );
      requireThat(
        !input.endsAt || new Date(input.endsAt) > new Date(input.startsAt),
        400,
        "End time must follow start time.",
      );
      const r = await db.query(
        "INSERT INTO events(server_id,created_by,title,description,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
        [
          input.serverId,
          req.identity.userId,
          input.title,
          input.description,
          input.startsAt,
          input.endsAt || null,
        ],
      );
      await audit(
        db,
        req.identity.userId,
        "event.created",
        r.rows[0].id,
        input.serverId,
      );
      await changed(db, `server:${input.serverId}`);
      return r.rows[0];
    }),
  );
  app.put("/api/events/:id/rsvp", (req) =>
    transaction(req.identity, async (db) => {
      const p = params.parse(req.params);
      const input = z.object({ rsvp: z.boolean() }).strict().parse(req.body);
      const r = await db.query(
        "SELECT server_id,starts_at FROM events WHERE id=$1 AND deleted_at IS NULL",
        [p.id],
      );
      requireThat(r.rowCount);
      await member(db, r.rows[0].server_id);
      requireThat(
        new Date(r.rows[0].starts_at) > new Date(),
        409,
        "This event has already started.",
      );
      if (input.rsvp)
        await db.query(
          "INSERT INTO event_participants(event_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [p.id, req.identity.userId],
        );
      else
        await db.query(
          "DELETE FROM event_participants WHERE event_id=$1 AND user_id=$2",
          [p.id, req.identity.userId],
        );
      await changed(db, `server:${r.rows[0].server_id}`);
      return { ok: true };
    }),
  );
  app.delete("/api/events/:id", (req) =>
    transaction(req.identity, async (db) => {
      const p = params.parse(req.params);
      const r = await db.query("SELECT server_id FROM events WHERE id=$1", [
        p.id,
      ]);
      requireThat(r.rowCount);
      await permit(db, r.rows[0].server_id, "MANAGE_EVENTS");
      await db.query("UPDATE events SET deleted_at=now() WHERE id=$1", [p.id]);
      await audit(
        db,
        req.identity.userId,
        "event.cancelled",
        p.id,
        r.rows[0].server_id,
      );
      await changed(db, `server:${r.rows[0].server_id}`);
      return { ok: true };
    }),
  );
}
