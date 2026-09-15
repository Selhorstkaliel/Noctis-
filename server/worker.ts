import { workerPool, audit, changed, closePools } from "./db.js";
import { deliverSecurityMail } from "./security-mail.js";
import { boundedFetch, exchange, providers, enabled } from "./integrations.js";
import { encrypt, decrypt } from "./crypto.js";
import { requireThat } from "./errors.js";
import { z } from "zod";
import { uploadStore } from "./upload-store.js";
import { config } from "./config.js";
import { maintainMedia } from "./media.js";
import { maintainMusic, closeMusic } from "./music/playback.js";
import { randomUUID } from "node:crypto";
type Item = { id: string; title: string; url?: string; time?: string };
const string = z.string().max(1000);
async function providerItems(
  provider: keyof typeof providers,
  access: string,
): Promise<Item[]> {
  const headers = { Authorization: `Bearer ${access}` };
  if (provider === "github") {
    const user = z
      .object({ login: z.string().regex(/^[\w-]{1,100}$/) })
      .parse(await boundedFetch("https://api.github.com/user", { headers }));
    return z
      .array(
        z.object({
          id: string,
          type: string,
          repo: z.object({ name: z.string().regex(/^[\w.-]+\/[\w.-]+$/) }),
          created_at: z.string().datetime(),
        }),
      )
      .max(100)
      .parse(
        await boundedFetch(
          `https://api.github.com/users/${user.login}/events?per_page=10`,
          { headers },
        ),
      )
      .map((e) => ({
        id: e.id,
        title: `${e.type.replace(/Event$/, "")} · ${e.repo.name}`,
        url: `https://github.com/${e.repo.name}`,
        time: e.created_at,
      }));
  }
  if (provider === "calendar")
    return (
      z
        .object({
          items: z
            .array(
              z.object({
                id: string,
                summary: string.optional(),
                start: z
                  .object({
                    dateTime: z.string().datetime({ offset: true }).optional(),
                    date: z.string().optional(),
                  })
                  .optional(),
              }),
            )
            .max(100)
            .optional(),
        })
        .parse(
          await boundedFetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=10&singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(new Date().toISOString())}`,
            { headers },
          ),
        )
        .items?.map((e) => ({
          id: e.id,
          title: e.summary || "Calendar event",
          time: e.start?.dateTime,
        })) || []
    );
  if (provider === "spotify") {
    const raw = await boundedFetch(
      "https://api.spotify.com/v1/me/player/currently-playing",
      { headers },
    );
    if (!raw) return [];
    const playing = z
      .object({
        item: z
          .object({
            id: string,
            name: string,
            artists: z.array(z.object({ name: string })).max(20),
          })
          .nullable(),
      })
      .parse(raw);
    return playing.item
      ? [
          {
            id: playing.item.id,
            title: `${playing.item.name} · ${playing.item.artists.map((a) => a.name).join(", ")}`,
            url: `https://open.spotify.com/track/${encodeURIComponent(playing.item.id)}`,
          },
        ]
      : [];
  }
  if (provider === "youtube")
    return z
      .object({
        items: z
          .array(
            z.object({
              id: string,
              snippet: z.object({
                title: string,
                resourceId: z.object({
                  channelId: z.string().regex(/^[\w-]+$/),
                }),
              }),
            }),
          )
          .max(50),
      })
      .parse(
        await boundedFetch(
          "https://www.googleapis.com/youtube/v3/subscriptions?part=snippet&mine=true&maxResults=10",
          { headers },
        ),
      )
      .items.map((e) => ({
        id: e.id,
        title: e.snippet.title,
        url: `https://www.youtube.com/channel/${e.snippet.resourceId.channelId}`,
      }));
  if (provider === "twitch") {
    const h = { ...headers, "Client-Id": process.env.TWITCH_CLIENT_ID! };
    const user = z
      .object({
        data: z
          .array(z.object({ id: z.string().regex(/^\d+$/) }))
          .min(1)
          .max(100),
      })
      .parse(
        await boundedFetch("https://api.twitch.tv/helix/users", { headers: h }),
      );
    return z
      .object({
        data: z
          .array(
            z.object({
              id: string,
              user_login: z.string().regex(/^[\w]+$/),
              user_name: string,
              title: string,
            }),
          )
          .max(100),
      })
      .parse(
        await boundedFetch(
          `https://api.twitch.tv/helix/streams/followed?user_id=${user.data[0].id}&first=10`,
          { headers: h },
        ),
      )
      .data.map((e) => ({
        id: e.id,
        title: `${e.user_name}: ${e.title}`,
        url: `https://www.twitch.tv/${e.user_login}`,
      }));
  }
  return [];
}
export async function runJob() {
  const db = await workerPool.connect();
  let job: any;
  try {
    await db.query("BEGIN");
    const r = await db.query(
      "SELECT * FROM jobs WHERE completed_at IS NULL AND failed_at IS NULL AND attempts<5 AND run_at<=now() AND (locked_at IS NULL OR locked_at<now()-interval '90 seconds') ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT 1",
    );
    job = r.rows[0];
    if (!job) {
      await db.query("COMMIT");
      return false;
    }
    await db.query(
      "UPDATE jobs SET locked_at=now(),attempts=attempts+1 WHERE id=$1",
      [job.id],
    );
    await db.query("COMMIT");
    if (job.kind === "webhook") {
      await db.query("BEGIN");
      const r = await db.query(
        "SELECT h.* FROM webhooks h JOIN users u ON u.id=h.created_by WHERE h.id=$1 AND h.revoked_at IS NULL AND u.deleted_at IS NULL FOR UPDATE OF h",
        [job.webhook_id],
      );
      requireThat(r.rowCount, 403, "Webhook inactive.");
      const h = r.rows[0];
      const allowed = await db.query(
        "SELECT noctis.has_permission($1,'MANAGE_SERVER',$2) AND noctis.channel_permission($3,'SEND_MESSAGES',$2) AS allowed",
        [h.server_id, h.created_by, h.channel_id],
      );
      requireThat(allowed.rows[0].allowed, 403, "Webhook permission revoked.");
      const messageId = randomUUID();
      const delivered = await db.query(
        "INSERT INTO messages(channel_id,author_id,body,client_nonce,id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(author_id,client_nonce) DO NOTHING",
        [
          h.channel_id,
          h.created_by,
          `[Webhook · ${h.name}]\n${job.body}`,
          job.id,
          messageId,
        ],
      );
      if (delivered.rowCount)
        await changed(db, `channel:${h.channel_id}`, messageId);
      await audit(db, h.created_by, "webhook.delivered", h.id, h.server_id);
      await db.query(
        "UPDATE jobs SET completed_at=now(),locked_at=NULL WHERE id=$1",
        [job.id],
      );
      await db.query("COMMIT");
    } else {
      const r = await db.query(
        "SELECT i.*,c.access_encrypted,c.refresh_encrypted,c.expires_at FROM integrations i JOIN integration_credentials c ON c.integration_id=i.id JOIN users u ON u.id=i.user_id WHERE i.id=$1 AND i.status<>'disconnected' AND u.deleted_at IS NULL",
        [job.integration_id],
      );
      requireThat(r.rowCount, 403, "Integration disconnected.");
      const integration = r.rows[0];
      requireThat(enabled(integration.provider), 503, "Provider disabled.");
      let access = decrypt(
        integration.access_encrypted,
        `${integration.id}:access`,
      );
      if (
        integration.expires_at &&
        new Date(integration.expires_at).getTime() < Date.now() + 60000
      ) {
        requireThat(
          integration.refresh_encrypted,
          401,
          "Reconnect this integration.",
        );
        const refreshed = await exchange(integration.provider, {
          grant_type: "refresh_token",
          refresh_token: decrypt(
            integration.refresh_encrypted,
            `${integration.id}:refresh`,
          ),
        });
        access = refreshed.access_token;
        await db.query(
          "UPDATE integration_credentials SET access_encrypted=$2,refresh_encrypted=coalesce($3,refresh_encrypted),expires_at=$4,updated_at=now() WHERE integration_id=$1",
          [
            integration.id,
            encrypt(access, `${integration.id}:access`),
            refreshed.refresh_token
              ? encrypt(refreshed.refresh_token, `${integration.id}:refresh`)
              : null,
            refreshed.expires_in
              ? new Date(Date.now() + refreshed.expires_in * 1000)
              : null,
          ],
        );
      }
      const items = await providerItems(integration.provider, access);
      await db.query("BEGIN");
      const still = await db.query(
        "SELECT id FROM integrations WHERE id=$1 FOR UPDATE",
        [integration.id],
      );
      requireThat(still.rowCount, 403, "Integration disconnected.");
      for (const item of items)
        await db.query(
          "INSERT INTO integration_items(integration_id,external_id,title,url,occurred_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(integration_id,external_id) DO UPDATE SET title=excluded.title,url=excluded.url,occurred_at=excluded.occurred_at",
          [
            integration.id,
            item.id.slice(0, 200),
            item.title.slice(0, 300),
            item.url || null,
            item.time ? new Date(item.time) : new Date(),
          ],
        );
      await db.query(
        "UPDATE integrations SET status='connected',last_synced_at=now() WHERE id=$1",
        [integration.id],
      );
      await db.query(
        "UPDATE jobs SET completed_at=now(),locked_at=NULL WHERE id=$1",
        [job.id],
      );
      await db.query(
        "INSERT INTO jobs(kind,integration_id,run_at) VALUES('integration',$1,now()+interval '5 minutes')",
        [integration.id],
      );
      await changed(db, `user:${integration.user_id}`);
      await db.query("COMMIT");
    }
  } catch (error) {
    await db.query("ROLLBACK");
    if (job) {
      const permanent =
        [401, 403, 404].includes(
          (error as { statusCode?: number }).statusCode || 0,
        ) || job.attempts >= 4;
      await db.query(
        "UPDATE jobs SET locked_at=NULL,run_at=now()+$2*interval '1 second',failed_at=CASE WHEN $3 THEN now() ELSE NULL END WHERE id=$1",
        [job.id, Math.min(300, 2 ** job.attempts * 10), permanent],
      );
      if (permanent && job.integration_id)
        await db.query("UPDATE integrations SET status='error' WHERE id=$1", [
          job.integration_id,
        ]);
      console.error(
        JSON.stringify({
          kind: "worker",
          event: "job_failed",
          jobId: job.id,
          attempt: job.attempts + 1,
          retry: !permanent,
        }),
      );
    } else throw error;
  } finally {
    db.release();
  }
  return true;
}
export async function maintenance() {
  await workerPool.query("DELETE FROM account_tokens WHERE expires_at<now()");
  await workerPool.query("DELETE FROM login_challenges WHERE expires_at<now()");
  await workerPool.query(
    "DELETE FROM security_mail WHERE created_at<now()-interval '1 day'",
  );
  await workerPool.query(
    "WITH expired AS (DELETE FROM uploads u WHERE created_at<now()-interval '1 day' AND NOT EXISTS(SELECT 1 FROM message_attachments a WHERE a.upload_id=u.id) AND NOT EXISTS(SELECT 1 FROM profiles p WHERE p.avatar_upload_id=u.id) RETURNING storage_key) INSERT INTO upload_gc(storage_key) SELECT storage_key FROM expired ON CONFLICT DO NOTHING",
  );
  const garbage = await workerPool.query(
    "SELECT storage_key FROM upload_gc ORDER BY created_at LIMIT 100",
  );
  for (const row of garbage.rows) {
    if (!/^[a-f0-9-]{36}$/.test(row.storage_key))
      throw new Error("Invalid storage key.");
    try {
      await uploadStore.delete(row.storage_key);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") continue;
    }
    await workerPool.query("DELETE FROM upload_gc WHERE storage_key=$1", [
      row.storage_key,
    ]);
  }
  await workerPool.query(
    "DELETE FROM presence WHERE updated_at<now()-interval '2 minutes'",
  );
  await workerPool.query(
    "DELETE FROM voice_participants WHERE updated_at<now()-interval '2 minutes' OR session_id IN(SELECT id FROM sessions WHERE revoked_at IS NOT NULL OR expires_at<now())",
  );
  await workerPool.query(
    "DELETE FROM realtime_signals WHERE created_at<now()-interval '1 minute'",
  );
  await workerPool.query(
    "DELETE FROM rate_limits WHERE window_start<now()-interval '2 days'",
  );
  await workerPool.query("DELETE FROM oauth_states WHERE expires_at<now()");
  await workerPool.query(
    "DELETE FROM jobs WHERE completed_at<now()-interval '7 days' OR failed_at<now()-interval '30 days'",
  );
  await workerPool.query(
    "DELETE FROM webhook_deliveries WHERE received_at<now()-interval '7 days'",
  );
  await workerPool.query(
    "DELETE FROM integration_items WHERE occurred_at<now()-interval '90 days'",
  );
}
if (
  process.argv[1]?.replaceAll("\\", "/").endsWith("/worker.ts") ||
  process.argv[1]?.replaceAll("\\", "/").endsWith("/worker.js")
) {
  let running = true;
  for (const sig of ["SIGINT", "SIGTERM"] as const)
    process.on(sig, () => {
      running = false;
    });
  let lastMaintenance = 0;
  let lastMediaMaintenance = 0;
  let lastMusicMaintenance = 0;
  while (running) {
    try {
      if (Date.now() - lastMediaMaintenance > 5000) {
        await maintainMedia();
        lastMediaMaintenance = Date.now();
      }
      if (Date.now() - lastMusicMaintenance > 500) {
        await maintainMusic();
        lastMusicMaintenance = Date.now();
      }
      if (Date.now() - lastMaintenance > 60000) {
        await maintenance();
        lastMaintenance = Date.now();
      }
      const mail = await deliverSecurityMail();
      if (!(await runJob()) && !mail)
        await new Promise((r) => setTimeout(r, 1000));
    } catch {
      console.error(
        JSON.stringify({ kind: "worker", event: "database_unavailable" }),
      );
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  await closeMusic();
  await closePools();
}
