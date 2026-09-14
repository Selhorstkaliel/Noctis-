import { useEffect, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  Field,
  Icon,
  PageHeading,
  Toggle,
  useUI,
} from "./components";
import { getUser } from "./data";
import { api } from "./api";
import { command, navigate, useStore } from "./store";
import type { MusicSettings } from "./music";
const permissions = [
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
];
const label = (p: string) =>
  p
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (s) => s.toUpperCase());
export function Admin({ serverId }: { serverId?: string }) {
  const store = useStore();
  const server = store.servers.find((s) => s.id === serverId);
  const { toast, open } = useUI();
  const [tab, setTab] = useState("Overview");
  const [name, setName] = useState(server?.name || "");
  const [description, setDescription] = useState(server?.description || "");
  const [mark, setMark] = useState(server?.mark || "N");
  const [image, setImage] = useState(server?.image || "/images/mountains.jpg");
  const [roleId, setRoleId] = useState("");
  const [channelName, setChannelName] = useState("");
  const [kind, setKind] = useState("text");
  const [privateChannel, setPrivateChannel] = useState(false);
  const [audit, setAudit] = useState<any[]>([]);
  const [hooks, setHooks] = useState<any[]>([]);
  const [secret, setSecret] = useState<any>();
  const [targetChannel, setTargetChannel] = useState("");
  const [hookName, setHookName] = useState("");
  const [roleName, setRoleName] = useState("");
  const [rolePosition, setRolePosition] = useState(10);
  const [moderate, setModerate] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [musicSettings, setMusicSettings] = useState<MusicSettings>();
  const roles = store.serverRoles.filter((r) => r.serverId === serverId);
  const chosen =
    roles.find((r) => r.id === roleId) || roles.find((r) => r.isDefault);
  const can = (p: string) => !!server?.permissions?.includes(p);
  useEffect(() => {
    if (tab === "Audit log" && can("VIEW_AUDIT_LOG"))
      api<any[]>(`/servers/${serverId}/audit`)
        .then(setAudit)
        .catch((e) => setError(e.message));
    if (tab === "Webhooks" && can("MANAGE_SERVER"))
      api<any[]>(`/servers/${serverId}/webhooks`)
        .then(setHooks)
        .catch((e) => setError(e.message));
    if (tab === "Music" && can("MANAGE_SERVER"))
      api<MusicSettings>(`/servers/${serverId}/music/settings`)
        .then(setMusicSettings)
        .catch((e) => setError(e.message));
  }, [tab, serverId]);
  if (!server?.joined)
    return (
      <EmptyState
        title="This server is unavailable"
        description="Choose a community you belong to."
        action={<Button onClick={() => navigate("home")}>Back to Home</Button>}
      />
    );
  if (
    ![
      "MANAGE_SERVER",
      "MANAGE_ROLES",
      "MANAGE_CHANNELS",
      "VIEW_AUDIT_LOG",
      "KICK_MEMBERS",
    ].some(can)
  )
    return (
      <EmptyState
        icon="Shield"
        title="This space needs admin access"
        description="Ask the server owner about your permissions."
      />
    );
  return (
    <div className="page-content standard-page">
      <PageHeading
        eyebrow={`${server.name.toUpperCase()} · ADMINISTRATION`}
        title="A good community starts with care."
        description="The people, permissions, and details that make this space yours."
        action={
          <Badge tone="violet" icon="Shield">
            {store.roles[`${serverId}:${store.profile.id}`] || "Member"}
          </Badge>
        }
      />
      <div className="admin-stats">
        {[
          ["Users", server.members, "Community members"],
          ["Radio", server.online, "Online now"],
          [
            "Target",
            store.missions.filter((m) => m.server === serverId).length,
            "Missions",
          ],
          [
            "CalendarDays",
            store.events.filter((e) => e.server === serverId).length,
            "Events",
          ],
        ].map(([icon, value, title]) => (
          <div key={title}>
            <Icon name={String(icon)} size={20} />
            <strong>{value}</strong>
            <span>{title}</span>
          </div>
        ))}
      </div>
      <div className="tabs admin-tabs">
        {[
          "Overview",
          "Members",
          "Roles & permissions",
          "Channels",
          "Music",
          "Audit log",
          "Webhooks",
        ].map((t) => (
          <button
            key={t}
            className={t === tab ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {tab === "Music" && musicSettings && (
        <section className="panel music-admin-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">NATIVE VOICE SERVICE</span>
              <h2>Noctis Music</h2>
            </div>
            <Badge tone="violet" icon="Music2">
              Per-server queue
            </Badge>
          </div>
          <p className="panel-intro">
            Set the default room behavior. Role permissions still decide who can
            play, pause, manage the queue, or move the bot.
          </p>
          <div className="settings-grid">
            <Field label="Default Music Bot volume" id="music-default-volume">
              <input
                id="music-default-volume"
                type="number"
                min="0"
                max="100"
                value={musicSettings.defaultVolume}
                onChange={(event) =>
                  setMusicSettings({
                    ...musicSettings,
                    defaultVolume: Number(event.target.value),
                  })
                }
              />
            </Field>
            <Field label="Idle disconnect (seconds)" id="music-idle-timeout">
              <input
                id="music-idle-timeout"
                type="number"
                min="30"
                max="3600"
                value={musicSettings.idleDisconnectSeconds}
                onChange={(event) =>
                  setMusicSettings({
                    ...musicSettings,
                    idleDisconnectSeconds: Number(event.target.value),
                  })
                }
              />
            </Field>
          </div>
          {[
            [
              "Allow members to skip",
              "Members can skip even when their role does not include MUSIC_SKIP.",
              "allowMemberSkip",
            ],
            [
              "Allow members to change volume",
              "Members can set the shared bot volume without MUSIC_VOLUME.",
              "allowMemberVolume",
            ],
            [
              "Autoplay queued tracks",
              "Start the next licensed source as soon as the current track ends.",
              "autoplayEnabled",
            ],
          ].map(([title, description, key]) => (
            <div className="setting-row" key={key}>
              <div>
                <strong>{title}</strong>
                <p>{description}</p>
              </div>
              <Toggle
                label={title}
                value={Boolean(musicSettings[key as keyof MusicSettings])}
                onChange={(value) =>
                  setMusicSettings({ ...musicSettings, [key]: value })
                }
              />
            </div>
          ))}
          <div className="settings-save">
            <span>Changes apply to this server only.</span>
            <Button
              variant="primary"
              onClick={async () => {
                const next = await api<MusicSettings>(
                  `/servers/${serverId}/music/settings`,
                  "PATCH",
                  musicSettings,
                );
                setMusicSettings(next);
                toast("Music settings saved");
              }}
            >
              Save music settings
            </Button>
          </div>
        </section>
      )}
      {tab === "Overview" && (
        <div className="admin-columns">
          <section className="panel">
            <h2>Your community</h2>
            <form
              noValidate
              onSubmit={async (e) => {
                e.preventDefault();
                await command(`/servers/${serverId}`, "PATCH", {
                  name,
                  description,
                  mark,
                  image,
                });
                toast("Server details saved");
              }}
            >
              <Field
                label="Server name"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
              />
              <Field label="Description" id="admin-description">
                <textarea
                  id="admin-description"
                  className="resize-none"
                  rows={4}
                  value={description}
                  maxLength={600}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
              <Field
                label="Server icon"
                value={mark}
                maxLength={4}
                onChange={(e) => setMark(e.target.value)}
                hint="Up to four letters or a symbol."
              />
              <Field label="Community banner" id="admin-banner">
                <select
                  id="admin-banner"
                  value={image}
                  onChange={(e) => setImage(e.target.value)}
                >
                  {[
                    ["mountains", "Mountain retreat"],
                    ["architecture", "Architecture"],
                    ["night", "After hours"],
                    ["music", "Sound and rhythm"],
                  ].map(([id, label]) => (
                    <option key={id} value={`/images/${id}.jpg`}>
                      {label}
                    </option>
                  ))}
                </select>
                <img
                  className="admin-banner-preview"
                  src={image}
                  alt="Selected community banner"
                />
              </Field>
              <Button
                type="submit"
                variant="primary"
                disabled={!can("MANAGE_SERVER")}
              >
                Save changes
              </Button>
            </form>
            <div className="setting-row">
              <div>
                <strong>Server discovery</strong>
                <p>Let new people find and join your community.</p>
              </div>
              <Toggle
                label="Public server discovery"
                value={!!server.isPublic}
                disabled={!can("MANAGE_SERVER")}
                onChange={(value) =>
                  void command(`/servers/${serverId}`, "PATCH", {
                    isPublic: value,
                  })
                }
              />
            </div>
          </section>
          <section className="panel">
            <h2>Bring people together</h2>
            <p className="muted">
              A challenge, a shared goal, or something to look forward to.
            </p>
            <Button
              icon="Target"
              disabled={!can("MANAGE_MISSIONS")}
              onClick={() => open({ type: "create-mission", id: serverId })}
            >
              Create mission
            </Button>
            <Button
              icon="CalendarDays"
              disabled={!can("MANAGE_EVENTS")}
              onClick={() => open({ type: "create-event", id: serverId })}
            >
              Schedule event
            </Button>
            <Button
              icon="UserPlus"
              disabled={!can("CREATE_INVITE")}
              onClick={() => open({ type: "invite", id: serverId })}
            >
              Invite people
            </Button>
          </section>
        </div>
      )}
      {tab === "Members" && (
        <section className="panel">
          {store.memberships
            .filter((m) => m.serverId === serverId)
            .map((m) => {
              const u = getUser(m.userId);
              const role = store.roles[`${serverId}:${m.userId}`];
              const assigned = roles.find((r) => r.name === role);
              return (
                <div className="setting-row" key={m.userId}>
                  <Avatar
                    user={u}
                    onClick={() => open({ type: "profile", id: u.id })}
                  />
                  <div>
                    <strong>{u.name}</strong>
                    <p>{role}</p>
                  </div>
                  {role === "Owner" ? (
                    <Badge icon="Crown">Owner</Badge>
                  ) : (
                    <>
                      <select
                        aria-label={`Role for ${u.name}`}
                        disabled={!can("MANAGE_ROLES")}
                        value={assigned?.id || ""}
                        onChange={(e) =>
                          void command(
                            `/servers/${serverId}/members/${m.userId}/role`,
                            "PUT",
                            { roleId: e.target.value },
                          )
                        }
                      >
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        disabled={!can("KICK_MEMBERS")}
                        onClick={() => setModerate(m.userId)}
                      >
                        Moderate
                      </Button>
                    </>
                  )}
                </div>
              );
            })}
          {moderate && (
            <form noValidate onSubmit={(e) => e.preventDefault()}>
              <h3>Moderate {getUser(moderate).name}</h3>
              <Field
                label="Reason"
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="dialog-actions">
                <Button onClick={() => setModerate("")}>Cancel</Button>
                {["kick", "ban", "unban"].map((action) => (
                  <Button
                    key={action}
                    disabled={
                      !reason ||
                      !can(action === "kick" ? "KICK_MEMBERS" : "BAN_MEMBERS")
                    }
                    variant="danger"
                    onClick={async () => {
                      await command(`/servers/${serverId}/moderation`, "POST", {
                        userId: moderate,
                        action,
                        reason,
                      });
                      setModerate("");
                      toast(`${label(action)} recorded`);
                    }}
                  >
                    {label(action)}
                  </Button>
                ))}
              </div>
            </form>
          )}
        </section>
      )}
      {tab === "Roles & permissions" && (
        <div className="admin-columns">
          <section className="panel">
            <h2>Roles</h2>
            <Field label="Selected role" id="admin-role">
              <select
                id="admin-role"
                value={chosen?.id || ""}
                onChange={(e) => setRoleId(e.target.value)}
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · rank {r.position}
                  </option>
                ))}
              </select>
            </Field>
            <p className="muted">
              Owners retain full access. Other roles can manage only roles and
              members below their rank.
            </p>
            <form
              noValidate
              onSubmit={async (e) => {
                e.preventDefault();
                const r = await command(`/servers/${serverId}/roles`, "POST", {
                  name: roleName,
                  position: rolePosition,
                  permissions: [],
                });
                setRoleId(r.id);
                setRoleName("");
              }}
            >
              <Field
                label="New role name"
                value={roleName}
                maxLength={40}
                onChange={(e) => setRoleName(e.target.value)}
              />
              <Field
                label="Role rank"
                type="number"
                min={1}
                max={100}
                value={rolePosition}
                onChange={(e) => setRolePosition(Number(e.target.value))}
              />
              <Button
                type="submit"
                disabled={!can("MANAGE_ROLES") || !roleName}
              >
                Create role
              </Button>
            </form>
          </section>
          <section className="panel">
            <h2>{chosen?.name} permissions</h2>
            {chosen &&
              permissions.map((p) => (
                <div className="setting-row" key={p}>
                  <strong>{label(p)}</strong>
                  <Toggle
                    label={`${chosen.name}: ${label(p)}`}
                    disabled={!can("MANAGE_ROLES")}
                    value={chosen.permissions.includes(p)}
                    onChange={(value) =>
                      void command(
                        `/servers/${serverId}/roles/${chosen.id}/permissions`,
                        "PUT",
                        {
                          permissions: value
                            ? [...chosen.permissions, p]
                            : chosen.permissions.filter((x) => x !== p),
                        },
                      )
                    }
                  />
                </div>
              ))}
          </section>
        </div>
      )}
      {tab === "Channels" && (
        <div className="admin-columns">
          <section className="panel">
            <h2>Create a channel</h2>
            <form
              noValidate
              onSubmit={async (e) => {
                e.preventDefault();
                await command(`/servers/${serverId}/channels`, "POST", {
                  name: channelName,
                  kind,
                  isPrivate: privateChannel,
                  categoryId: store.categories.find(
                    (c) => c.serverId === serverId,
                  )?.id,
                });
                setChannelName("");
                toast("Channel created");
              }}
            >
              <Field
                label="Channel name"
                placeholder="project-updates"
                value={channelName}
                maxLength={60}
                onChange={(e) =>
                  setChannelName(
                    e.target.value.toLowerCase().replaceAll(" ", "-"),
                  )
                }
              />
              <Field label="Channel type" id="channel-kind">
                <select
                  id="channel-kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                >
                  <option value="text">Text</option>
                  <option value="voice">Voice</option>
                </select>
              </Field>
              <Toggle
                label="Private channel"
                value={privateChannel}
                onChange={setPrivateChannel}
              />
              <p className="muted">
                Private channels require an explicit View channel permission for
                a role.
              </p>
              <Button type="submit" disabled={!can("MANAGE_CHANNELS")}>
                Create channel
              </Button>
            </form>
          </section>
          <section className="panel">
            <h2>Channels</h2>
            {store.channels
              .filter((c) => c.serverId === serverId)
              .map((c) => (
                <div className="setting-row" key={c.id}>
                  <div>
                    <strong>
                      {c.kind === "voice" ? "◉" : "#"} {c.name}
                    </strong>
                    <p>{c.isPrivate ? "Private" : "Community"}</p>
                  </div>
                  <Button
                    disabled={!can("MANAGE_CHANNELS")}
                    onClick={() =>
                      command(`/channels/${c.id}`, "PATCH", {
                        isPrivate: !c.isPrivate,
                      })
                    }
                  >
                    {c.isPrivate ? "Make public" : "Make private"}
                  </Button>
                  <Button
                    disabled={!can("MANAGE_CHANNELS")}
                    onClick={() =>
                      command(`/channels/${c.id}`, "PATCH", { deleted: true })
                    }
                  >
                    Archive
                  </Button>
                  {c.isPrivate && (
                    <select
                      aria-label={`Grant access to ${c.name}`}
                      value=""
                      disabled={!can("MANAGE_ROLES")}
                      onChange={(e) =>
                        void command(`/channels/${c.id}/permissions`, "PUT", {
                          roleId: e.target.value,
                          permission: "VIEW_CHANNEL",
                          allowed: true,
                        })
                      }
                    >
                      <option value="" disabled>
                        Grant a role access
                      </option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
          </section>
        </div>
      )}
      {tab === "Audit log" && (
        <section className="panel">
          <h2>Security and administration history</h2>
          {!can("VIEW_AUDIT_LOG") ? (
            <p>Your role cannot view the audit log.</p>
          ) : audit.length ? (
            audit.map((row) => (
              <div className="setting-row" key={row.id}>
                <div>
                  <strong>{row.action}</strong>
                  <p>
                    {getUser(row.actorId).name} · {row.target}
                  </p>
                </div>
                <time>{new Date(row.createdAt).toLocaleString()}</time>
              </div>
            ))
          ) : (
            <p className="muted">No audit records to display.</p>
          )}
        </section>
      )}
      {tab === "Webhooks" && (
        <section className="panel">
          <h2>Verified updates from your tools</h2>
          <p className="muted">
            Each webhook has a private signing secret. It is shown only when
            created.
          </p>
          <form
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              setSecret(
                await command(`/servers/${serverId}/webhooks`, "POST", {
                  name: hookName,
                  channelId: targetChannel,
                }),
              );
              setHooks(await api(`/servers/${serverId}/webhooks`));
            }}
          >
            <Field
              label="Webhook name"
              value={hookName}
              maxLength={80}
              onChange={(e) => setHookName(e.target.value)}
            />
            <Field label="Destination channel" id="webhook-channel">
              <select
                id="webhook-channel"
                value={targetChannel}
                onChange={(e) => setTargetChannel(e.target.value)}
              >
                <option value="" disabled>
                  Choose a channel
                </option>
                {store.channels
                  .filter((c) => c.serverId === serverId && c.kind === "text")
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Button
              type="submit"
              disabled={!can("MANAGE_SERVER") || !targetChannel || !hookName}
            >
              Create webhook
            </Button>
          </form>
          {secret && (
            <div className="settings-info">
              <div>
                <Field label="Webhook URL" readOnly value={secret.url} />
                <Field
                  label="Signing secret — save it now"
                  type="password"
                  readOnly
                  value={secret.secret}
                />
                <Button
                  onClick={() => navigator.clipboard.writeText(secret.secret)}
                >
                  Copy signing secret
                </Button>
              </div>
            </div>
          )}
          {hooks.map((h) => (
            <div className="setting-row" key={h.id}>
              <strong>{h.name}</strong>
              {h.revokedAt ? (
                <Badge>Revoked</Badge>
              ) : (
                <Button
                  onClick={async () => {
                    await command(
                      `/servers/${serverId}/webhooks/${h.id}`,
                      "DELETE",
                      undefined,
                    );
                    setHooks(await api(`/servers/${serverId}/webhooks`));
                  }}
                >
                  Revoke
                </Button>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
