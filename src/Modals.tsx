import { useRef, useState, useEffect } from "react";
import {
  Avatar,
  AvatarStack,
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  Icon,
  SearchInput,
  useUI,
  type ModalState,
} from "./components";
import { InvitePanel, IntegrationPanel } from "./ServicePanels";
import { api } from "./api";
import { MemberList } from "./Community";
import { MusicPlayForm, MusicPlayer } from "./MusicPlayer";
import {
  formatNumber,
  getUser,
  integrations,
  users,
  type Mission,
} from "./data";
import {
  navigate,
  newId,
  updateStore,
  useStore,
  command,
  signOut,
  openConversation,
  activeServer,
  loadRoom,
  refresh,
} from "./store";
import { useI18n } from "./i18n";

type FriendSearchResult = {
  id: string;
  name: string;
  handle: string;
  avatar: number;
  avatarUrl?: string;
  color: string;
  status: "online" | "idle" | "offline";
  canRequest: boolean;
  relationship: "none" | "outgoing" | "incoming" | "accepted";
};

export function ModalContent({
  modal,
  close,
}: {
  modal: NonNullable<ModalState>;
  close: () => void;
}) {
  const store = useStore();
  const { toast, open } = useUI();
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    {
      label: string;
      detail: string;
      icon: string;
      path: string;
      messageId?: string;
    }[]
  >([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [friendResults, setFriendResults] = useState<FriendSearchResult[]>([]);
  const [friendSearchBusy, setFriendSearchBusy] = useState(false);
  useEffect(() => {
    if (modal.type !== "search" || query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    const controller = new AbortController();
    setSearchBusy(true);
    const timer = setTimeout(() => {
      api(
        "/search?q=" + encodeURIComponent(query.trim()),
        "GET",
        undefined,
        controller.signal,
      )
        .then((r) =>
          setSearchResults([
            ...r.users.map((u: any) => ({
              label: u.name,
              detail: "Member · @" + u.handle,
              icon: "UserRound",
              path: "messages/" + u.id,
            })),
            ...r.servers.map((s: any) => ({
              label: s.name,
              detail: "Community",
              icon: "Orbit",
              path: store.servers.some((x) => x.id === s.id && x.joined)
                ? "server/" + s.id + "/general"
                : "discover",
            })),
            ...r.channels.map((c: any) => ({
              label: "#" + c.name,
              detail: "Channel",
              icon: "Hash",
              path: "server/" + c.serverId + "/" + c.slug,
            })),
            ...r.messages.map((m: any) => ({
              label: m.body,
              detail: "Message",
              icon: "MessageCircle",
              path:
                m.channel_id || m.server_id
                  ? "server/" + m.server_id + "/" + m.slug
                  : "messages/" + m.conversation_id,
              messageId: m.id,
            })),
          ]),
        )
        .catch((e) => {
          if (e.name !== "AbortError") setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchBusy(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, modal.type]);
  useEffect(() => {
    if (modal.type !== "add-friend" || query.trim().length < 2) {
      setFriendResults([]);
      setFriendSearchBusy(false);
      return;
    }
    const controller = new AbortController();
    setFriendSearchBusy(true);
    const timer = setTimeout(() => {
      api<FriendSearchResult[]>(
        "/friends/search?q=" + encodeURIComponent(query.trim()),
        "GET",
        undefined,
        controller.signal,
      )
        .then(setFriendResults)
        .catch((e) => {
          if (e.name !== "AbortError") setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setFriendSearchBusy(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, modal.type]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Design & creativity");
  const [serverId, setServerId] = useState(
    modal.id && store.servers.some((s) => s.id === modal.id)
      ? modal.id
      : store.servers.find((s) => s.joined)?.id || "",
  );
  const [objectiveText, setObjectiveText] = useState("");
  const [xp, setXp] = useState(250);
  const [date, setDate] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [searchIndex, setSearchIndex] = useState(0);
  const [role, setRole] = useState(
    store.roles[modal.id || ""] || getUser(modal.id || "").role,
  );
  const [targetChannel, setTargetChannel] = useState(
    String(store.settings[`integration:${modal.id}:channel`] || "general"),
  );
  const form = useRef<HTMLFormElement>(null);
  const goto = (path: string) => {
    close();
    navigate(path);
  };
  const invalid = (message: string) => {
    setError(message);
    form.current?.querySelector<HTMLInputElement>("input")?.focus();
  };
  const errors = error && (
    <p className="field-error" role="alert">
      {error}
    </p>
  );
  const actions = (label: string) => (
    <div className="dialog-actions">
      <Button type="button" onClick={close}>
        Cancel
      </Button>
      <Button variant="primary" type="submit">
        {label}
        <Icon name="ArrowRight" size={15} />
      </Button>
    </div>
  );
  let body;
  let title = "";
  let wide = false;
  let className = "";
  if (modal.type === "music-play") {
    title = "Add to Noctis Music";
    className = "music-dialog";
    body = (
      <>
        <p className="modal-intro">
          Add a licensed source to your server’s private queue. The bot will
          join your current voice room.
        </p>
        <MusicPlayForm serverId={modal.id || ""} afterPlay={close} />
      </>
    );
  } else if (modal.type === "music-player") {
    title = "Noctis Music";
    wide = true;
    className = "music-dialog player-dialog";
    body = <MusicPlayer serverId={modal.id || ""} />;
  } else if (modal.type === "profile") {
    const user =
      modal.id === store.profile.id
        ? store.profile
        : getUser(modal.id || "sophie");
    const friendship = store.friendships.find(
      (item) => item.requesterId === user.id || item.recipientId === user.id,
    );
    const relationship =
      friendship?.status === "accepted"
        ? "accepted"
        : friendship?.requesterId === store.profile.id
          ? "outgoing"
          : friendship?.recipientId === store.profile.id
            ? "incoming"
            : "none";
    title = user.name;
    className = "profile-dialog";
    body = (
      <>
        <div className="profile-cover">
          <span />
        </div>
        <div className="profile-identity">
          <Avatar user={user} size={84} />
          <div className="profile-badges">
            {user.badges?.map((b) => (
              <span key={b.id} title={b.name}>
                <Icon name={b.icon} size={20} />
              </span>
            ))}
          </div>
        </div>
        <div className="profile-name">
          <h2>{user.name}</h2>
          <span>@{user.handle}</span>
          <Badge
            tone="violet"
            icon={user.role === "Owner" ? "Crown" : "Shield"}
          >
            {store.roles[`${activeServer()?.id}:${user.id}`] || user.role}
          </Badge>
        </div>
        <div className="profile-bio">
          <span className="eyebrow">A LITTLE ABOUT ME</span>
          <p>{user.bio}</p>
        </div>
        {(user.id !== store.profile.id || store.settings.activity) && (
          <div className="profile-activity">
            <Icon name={user.id === "james" ? "Music2" : "Orbit"} size={23} />
            <div>
              <span>
                {user.status === "offline" ? "LAST ACTIVITY" : "RIGHT NOW"}
              </span>
              <strong>{user.activity}</strong>
            </div>
          </div>
        )}
        <div className="profile-detail-stats">
          <div>
            <strong>{formatNumber(user.xp)}</strong>
            <span>Experience points</span>
          </div>
          <div>
            <strong>
              {user.id === store.profile.id
                ? store.missions.filter((m) => m.claimed).length
                : "—"}
            </strong>
            <span>Missions completed</span>
          </div>
          <div>
            <strong>
              {user.createdAt
                ? new Date(user.createdAt).toLocaleDateString([], {
                    month: "short",
                    year: "numeric",
                  })
                : "—"}
            </strong>
            <span>Member since</span>
          </div>
        </div>
        {!!user.badges?.length && (
          <div className="earned-badges">
            {user.badges.map((b) => (
              <Badge key={b.id} tone="violet" icon={b.icon}>
                {b.name}
              </Badge>
            ))}
          </div>
        )}
        <div className="dialog-actions">
          {user.id === store.profile.id ? (
            <>
              <Button
                icon="LogIn"
                onClick={async () => {
                  await signOut();
                  close();
                }}
              >
                Sign out
              </Button>
              <Button
                variant="primary"
                icon="Pencil"
                onClick={() => goto("settings/account")}
              >
                Edit profile
              </Button>
            </>
          ) : (
            <>
              <Button
                icon={relationship === "accepted" ? "CircleCheck" : "UserPlus"}
                disabled={
                  relationship === "accepted" || relationship === "outgoing"
                }
                onClick={async () => {
                  if (relationship === "incoming") {
                    await command(`/friends/${user.id}`, "PUT", {
                      accept: true,
                    });
                    await refresh();
                    toast(t("Friend request accepted"));
                  } else {
                    await command("/friends", "POST", { targetId: user.id });
                    await refresh();
                    toast(t("Friend request sent"));
                  }
                }}
              >
                {t(
                  relationship === "accepted"
                    ? "Friends"
                    : relationship === "outgoing"
                      ? "Request sent"
                      : relationship === "incoming"
                        ? "Accept request"
                        : "Add friend",
                )}
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  await command(`/blocks/${user.id}`, "PUT", { blocked: true });
                  close();
                  toast("Account blocked");
                }}
              >
                Block
              </Button>
              <Button
                variant="primary"
                icon="MessageCircle"
                onClick={async () => {
                  await openConversation(user.id);
                  close();
                }}
              >
                Send message
              </Button>
            </>
          )}
        </div>
      </>
    );
  } else if (modal.type === "search") {
    title = "Find your way";
    wide = true;
    className = "command-dialog";
    const base = [
      {
        label: "Home",
        detail: "Your space, at a glance",
        icon: "House",
        path: "home",
      },
      {
        label: "Missions",
        detail: "Your next good thing",
        icon: "Target",
        path: "missions",
      },
      {
        label: "Discover communities",
        detail: "Find your people",
        icon: "Compass",
        path: "discover",
      },
      {
        label: "User settings",
        detail: "Make it yours",
        icon: "Settings",
        path: "settings/account",
      },
      {
        label: "Server administration",
        detail: activeServer()?.name || "Choose a community",
        icon: "Shield",
        path: `admin/${activeServer()?.id || ""}`,
      },
      {
        label: "Join The Lounge",
        detail: `${store.voice.length} people are around`,
        icon: "Volume2",
        path: `voice/${activeServer()?.id || ""}/lounge`,
      },
      {
        label: "Leaderboard",
        detail: "The people who make it happen",
        icon: "Trophy",
        path: "leaderboard",
      },
    ];
    const q = query.toLowerCase().trim();
    const results = q
      ? [
          ...base.filter((x) =>
            (x.label + " " + x.detail).toLowerCase().includes(q),
          ),
          ...searchResults,
        ].slice(0, 30)
      : base;
    const choose = async (index: number) => {
      const result = results[index];
      if (!result) return;
      goto(result.path);
      if ("messageId" in result) {
        await refresh();
        await loadRoom(
          result.path.startsWith("messages/")
            ? "dm/" + result.path.slice(9)
            : result.path.slice(7),
          undefined,
          result.messageId as string,
        );
        window.setTimeout(() => {
          const element = document.getElementById(
            `message-${result.messageId}`,
          );
          element?.scrollIntoView({ block: "center" });
          element?.classList.add("search-highlight");
        }, 100);
      }
    };
    body = (
      <div
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSearchIndex((i) => Math.min(i + 1, results.length - 1));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setSearchIndex((i) => Math.max(i - 1, 0));
          }
          if (
            e.key === "Enter" &&
            (e.target as HTMLElement).tagName === "INPUT"
          ) {
            e.preventDefault();
            choose(searchIndex);
          }
        }}
      >
        <SearchInput
          value={query}
          onChange={(v) => {
            setQuery(v);
            setSearchIndex(0);
          }}
          placeholder={
            modal.extra
              ? "Search this conversation…"
              : "Search messages, people, channels, and spaces…"
          }
          label="Search Noctis"
          autoFocus
        />
        <div className="command-section-label">
          {searchBusy
            ? "SEARCHING…"
            : q
              ? `${results.length} RESULTS`
              : "GO SOMEWHERE GOOD"}
        </div>
        <div className="command-results">
          {results.map((r, i) => (
            <button
              key={`${r.path}-${i}`}
              className={`command-result ${searchIndex === i ? "selected" : ""}`}
              onClick={() => choose(i)}
            >
              <Icon name={r.icon} size={20} />
              <span>
                <strong>{r.label}</strong>
                <small>{r.detail}</small>
              </span>
              <Icon name="CornerDownLeft" size={15} />
            </button>
          ))}
          {!results.length && (
            <EmptyState
              title="A little out of reach"
              description="No matches yet. Try a name, channel, or a few different words."
            />
          )}
        </div>
        <div className="command-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> to navigate
          </span>
          <span>
            <kbd>Enter</kbd> to open
          </span>
          <span>
            <kbd>Esc</kbd> to close
          </span>
        </div>
      </div>
    );
  } else if (modal.type === "create-server") {
    title = "A space of your own";
    body = (
      <>
        <div className="create-intro">
          <span className="create-emblem">
            <Icon name="Orbit" size={33} />
          </span>
          <p>
            A few friends, a shared interest, or the next big idea.
            <br />
            Make room for it here.
          </p>
        </div>
        <form
          ref={form}
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            if (name.trim().length < 2) {
              invalid("Give your server a name with at least 2 characters.");
              return;
            }
            const id = `space-${newId().slice(0, 8)}`;
            await updateStore((s) => ({
              ...s,
              servers: [
                ...s.servers,
                {
                  id,
                  name: name.trim(),
                  description:
                    description.trim() || "A new space for good company.",
                  mark: name
                    .trim()
                    .split(" ")
                    .map((x) => x[0])
                    .slice(0, 2)
                    .join("")
                    .toLowerCase(),
                  image: "/images/architecture.jpg",
                  color: "#b7a9d3",
                  members: 1,
                  online: 1,
                  category,
                  joined: true,
                  unread: 0,
                },
              ],
            }));
            goto(`server/${id}/general`);
            toast(`${name.trim()} is ready. Make yourself at home.`);
          }}
        >
          <Field
            label="Server name"
            placeholder="Something worth coming back to"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            error={error}
          />
          <Field label="A little about your space" id="create-description">
            <textarea
              id="create-description"
              className="resize-none"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={220}
              placeholder="What brings your people together?"
            />
          </Field>
          <Field label="Made for" id="server-category">
            <select
              id="server-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {[
                "Design & creativity",
                "Gaming",
                "Music",
                "Technology",
                "Lifestyle",
              ].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          {actions("Create server")}
        </form>
      </>
    );
  } else if (modal.type === "create-mission") {
    title = "Give your community a little purpose";
    wide = true;
    body = (
      <>
        <p className="modal-intro">
          A challenge, a shared goal, or a warm welcome. Every good mission
          starts with an idea.
        </p>
        <form
          ref={form}
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            const objectives = objectiveText
              .split("\n")
              .map((t) => t.trim())
              .filter(Boolean);
            if (!name.trim()) {
              invalid("Give your mission a title.");
              return;
            }
            if (!description.trim()) {
              invalid("Add a short description of the mission.");
              return;
            }
            if (!objectives.length || objectives.length > 8) {
              invalid("Add between 1 and 8 objectives, one per line.");
              return;
            }
            if (!Number.isInteger(xp) || xp < 50 || xp > 2000) {
              invalid("Choose a reward between 50 and 2,000 XP.");
              return;
            }
            const mission: Mission = {
              id: newId(),
              title: name.trim(),
              description: description.trim(),
              server: serverId,
              category:
                category === "Design & creativity"
                  ? "Community challenge"
                  : category,
              xp,
              icon: "Flag",
              color: "violet",
              objectives: objectives.map((text) => ({ text, done: false })),
              joined: true,
              claimed: false,
              due: "7 days left",
              badge: name.trim(),
              people: 1,
            };
            await updateStore((s) => ({
              ...s,
              missions: [...s.missions, mission],
            }));
            goto("missions");
            toast("Mission created. Let’s make it happen.");
          }}
        >
          <Field
            label="Mission title"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="A small step toward something good"
            maxLength={70}
            error={error && !name.trim() ? error : undefined}
          />
          <Field label="Description" id="mission-description">
            <textarea
              id="mission-description"
              className="resize-none"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={400}
              placeholder="What will members do, and why does it matter?"
            />
          </Field>
          <div className="form-grid">
            <Field label="Community" id="mission-server">
              <select
                id="mission-server"
                value={serverId}
                onChange={(e) => setServerId(e.target.value)}
              >
                {store.servers
                  .filter((s) => s.joined)
                  .map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Mission type" id="mission-category">
              <select
                id="mission-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="Design & creativity">Community challenge</option>
                <option>Community goal</option>
                <option>Onboarding</option>
                <option>Weekly challenge</option>
                <option>Event mission</option>
              </select>
            </Field>
          </div>
          <Field
            label="Objectives"
            id="mission-objectives"
            hint="One objective per line. Keep each step clear and achievable."
          >
            <textarea
              id="mission-objectives"
              className="resize-none"
              rows={3}
              value={objectiveText}
              onChange={(e) => setObjectiveText(e.target.value)}
              placeholder={
                "Share your idea in #general\nGive feedback to a fellow member"
              }
            />
          </Field>
          <Field
            label="XP reward"
            type="number"
            value={xp}
            onChange={(e) => setXp(Number(e.target.value))}
            min={50}
            max={2000}
            hint="50–2,000 XP. A profile badge is included with every completed mission."
          />
          {errors}
          {actions("Create mission")}
        </form>
      </>
    );
  } else if (modal.type === "invite") {
    title = "Invite your people";
    body = <InvitePanel serverId={modal.id || serverId} />;
  } else if (modal.type === "server-preview") {
    title = "You might have found your people";
    const server = store.servers.find((s) => s.id === modal.id);
    body = server ? (
      <>
        <div className={`invite-cover cover-${server.id}`}>
          <img src={server.image} alt="" />
          <span className="server-mark" style={{ color: server.color }}>
            {server.mark}
          </span>
        </div>
        <div className="server-preview-info">
          <Badge tone="violet" icon="BadgeCheck">
            {server.category}
          </Badge>
          <h2>{server.name}</h2>
          <p>{server.description}</p>
          <div className="preview-server-numbers">
            <span>
              <i className="online-dot" />
              {server.online} online
            </span>
            <span>
              <Icon name="Users" size={15} />
              {formatNumber(server.members)} members
            </span>
          </div>
          <AvatarStack
            ids={store.memberships
              .filter((m) => m.serverId === server.id)
              .map((m) => m.userId)
              .slice(0, 4)}
            total={server.members}
            size={31}
          />
          <p className="field-hint">
            Be kind, stay curious, and make yourself at home.
          </p>
          <Button
            variant="primary"
            className="full-width"
            icon={server.joined ? "ArrowRight" : "Plus"}
            onClick={async () => {
              if (!server.joined)
                await updateStore((s) => ({
                  ...s,
                  servers: s.servers.map((x) =>
                    x.id === server.id
                      ? { ...x, joined: true, members: x.members + 1 }
                      : x,
                  ),
                }));
              goto(`server/${server.id}/general`);
              toast(`Welcome to ${server.name}`);
            }}
          >
            {server.joined ? "Open community" : "Join community"}
          </Button>
        </div>
      </>
    ) : (
      <EmptyState
        title="This invitation has wandered off"
        description="That community is unavailable. Discover another space."
        action={
          <Button onClick={() => goto("discover")}>Discover communities</Button>
        }
      />
    );
  } else if (modal.type === "notifications") {
    title = "A little from your world";
    const notifications = store.notifications.map((n) => ({
      id: n.id,
      user: n.actorId || store.profile.id,
      title: n.title,
      text: n.body,
      context: "Your community",
      time: new Date(n.createdAt).toLocaleString(),
      path: n.route,
      icon: n.kind === "mention" ? "AtSign" : "Bell",
    }));
    body = (
      <>
        <div className="notification-summary">
          <span>
            {
              notifications.filter(
                (n) => !store.readNotifications.includes(n.id),
              ).length
            }{" "}
            unread updates
          </span>
          <button
            className="subtle-link"
            onClick={async () => {
              await updateStore((s) => ({
                ...s,
                readNotifications: notifications.map((n) => n.id),
              }));
              toast("All notifications marked as read");
            }}
          >
            <Icon name="CheckCheck" size={15} />
            Mark all as read
          </button>
        </div>
        {!store.settings.desktop && (
          <div className="inline-banner">
            Notifications are paused in your preferences. Previous updates
            remain here.
          </div>
        )}
        <div className="notification-list">
          {notifications
            .filter((n) => store.settings.mentions || n.icon !== "AtSign")
            .map((n) => (
              <button
                className={`notification-item ${store.readNotifications.includes(n.id) ? "read" : ""}`}
                key={n.id}
                onClick={async () => {
                  await updateStore((s) => ({
                    ...s,
                    readNotifications: [
                      ...new Set([...s.readNotifications, n.id]),
                    ],
                  }));
                  goto(n.path);
                }}
              >
                <Avatar user={n.user} size={39} />
                <span>
                  <strong>{n.title}</strong>
                  <p>{n.text}</p>
                  <small>
                    {n.context} · {n.time}
                  </small>
                </span>
                {!store.readNotifications.includes(n.id) && (
                  <i className="small-unread" />
                )}
              </button>
            ))}
        </div>
        <div className="dialog-actions">
          <Button
            variant="ghost"
            icon="Settings"
            onClick={() => goto("settings/notifications")}
          >
            Notification preferences
          </Button>
        </div>
      </>
    );
  } else if (modal.type === "event") {
    title = "Make a little time";
    const event = store.events.find((e) => e.id === modal.id);
    body = event ? (
      <>
        <div className={`event-modal-art event-art-${event.server}`}>
          <Icon name={event.icon} size={62} />
          <Badge tone={event.rsvp ? "mint" : "violet"}>
            {event.rsvp ? "You’re going" : "UPCOMING EVENT"}
          </Badge>
        </div>
        <div className="event-modal-details">
          <span className="eyebrow">
            {store.servers.find((s) => s.id === event.server)?.name}
          </span>
          <h2>{event.title}</h2>
          <p>{event.description}</p>
          <div>
            <Icon name="CalendarDays" size={18} />
            <span>
              {event.month} {event.day}, {event.year || 2026}
            </span>
          </div>
          <div>
            <Icon name="Clock3" size={18} />
            <span>{event.time} · Your local time</span>
          </div>
          <div>
            <Icon name="Volume2" size={18} />
            <span>The Lounge</span>
          </div>
          <div>
            <AvatarStack
              ids={event.memberIds || []}
              total={event.attendees + (event.rsvp ? 1 : 0)}
              size={26}
            />
            <span>
              {event.attendees + (event.rsvp ? 1 : 0)}{" "}
              {event.attendees + (event.rsvp ? 1 : 0) === 1
                ? "person is"
                : "people are"}{" "}
              going
            </span>
          </div>
        </div>
        <div className="dialog-actions">
          <Button
            icon="Volume2"
            onClick={() => goto(`voice/${event.server}/lounge`)}
          >
            Open voice room
          </Button>
          <Button
            variant={event.rsvp ? "secondary" : "primary"}
            icon={event.rsvp ? "Check" : "CalendarPlus"}
            onClick={async () => {
              await updateStore((s) => ({
                ...s,
                events: s.events.map((e) =>
                  e.id === event.id ? { ...e, rsvp: !e.rsvp } : e,
                ),
              }));
              toast(
                event.rsvp
                  ? "RSVP removed. Maybe next time."
                  : "You’re on the list. See you there.",
              );
            }}
          >
            {event.rsvp ? "Cancel RSVP" : "Count me in"}
          </Button>
        </div>
      </>
    ) : (
      <EmptyState
        title="This event isn’t available"
        description="Find another moment to look forward to."
      />
    );
  } else if (modal.type === "create-event") {
    title = "Put something good on the calendar";
    body = (
      <>
        <p className="modal-intro">A shared moment is a good place to start.</p>
        <form
          ref={form}
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) {
              invalid("Give your event a name.");
              return;
            }
            const d = new Date(date);
            if (
              !date ||
              Number.isNaN(d.getTime()) ||
              d.getTime() < Date.now()
            ) {
              invalid("Choose a date and time in the future.");
              return;
            }
            await updateStore((s) => ({
              ...s,
              events: [
                ...s.events,
                {
                  id: newId(),
                  title: name.trim(),
                  server: serverId,
                  description:
                    description.trim() ||
                    "A moment to bring your community together.",
                  startsAt: d.toISOString(),
                  day: String(d.getDate()),
                  year: d.getFullYear(),
                  month: d
                    .toLocaleDateString("en-US", { month: "short" })
                    .toUpperCase(),
                  time: `${d.toLocaleDateString("en-US", { weekday: "long" })} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
                  attendees: 0,
                  rsvp: true,
                  icon: "CalendarDays",
                },
              ],
            }));
            goto("events");
            toast("Event scheduled. Something to look forward to.");
          }}
        >
          <Field
            label="Event name"
            placeholder="What’s bringing everyone together?"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={70}
          />
          <Field label="Description" id="event-description">
            <textarea
              id="event-description"
              className="resize-none"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={350}
            />
          </Field>
          <Field
            label="Date & time"
            type="datetime-local"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            hint="Shown in your local timezone."
          />
          <Field label="Community" id="event-server">
            <select
              id="event-server"
              value={serverId}
              onChange={(e) => setServerId(e.target.value)}
            >
              {store.servers
                .filter((s) => s.joined)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </Field>
          {errors}
          {actions("Schedule event")}
        </form>
      </>
    );
  } else if (modal.type === "integration") {
    title = "Connect your world";
    body = <IntegrationPanel provider={modal.id || ""} />;
  } else if (modal.type === "members") {
    title = "The people in your space";
    body = <MemberList />;
  } else if (modal.type === "image") {
    title = "A closer look";
    wide = true;
    className = "image-dialog";
    const image = store.messages.find((m) => m.id === modal.id);
    body = image?.image ? (
      <>
        <img
          className="expanded-image"
          src={image.image}
          alt={`Image shared by ${getUser(image.user).name}`}
        />
        <p className="muted">
          Shared by {getUser(image.user).name} · {image.time}
        </p>
      </>
    ) : (
      <EmptyState
        title="Image unavailable"
        description="The message may have been removed."
      />
    );
  } else if (modal.type === "shortcuts") {
    title = "Find your flow";
    body = (
      <>
        <p className="modal-intro">
          A few shortcuts to keep you close to what matters.
        </p>
        <div className="shortcut-list">
          {[
            ["Search & command palette", "Ctrl / ⌘", "K"],
            ["Open settings", "Ctrl / ⌘", ","],
            ["Go Home", "Alt", "1"],
            ["Send a message", "Enter", ""],
            ["New line in a message", "Shift", "Enter"],
            ["Close a dialog", "Esc", ""],
          ].map(([label, a, b]) => (
            <div key={label}>
              <span>{label}</span>
              <span>
                <kbd>{a}</kbd>
                {b && <kbd>{b}</kbd>}
              </span>
            </div>
          ))}
        </div>
      </>
    );
  } else if (modal.type === "account-menu") {
    title = "Your little corner";
    body = (
      <>
        <div className="account-menu-identity">
          <Avatar user={store.profile.id} size={55} />
          <div>
            <h3>{store.profile.name}</h3>
            <span>@{store.profile.handle}</span>
          </div>
        </div>
        <div className="account-menu-options">
          <button
            onClick={() => open({ type: "profile", id: store.profile.id })}
          >
            <Icon name="UserRound" />
            My profile
            <Icon name="ChevronRight" size={16} />
          </button>
          <button onClick={() => goto("settings/account")}>
            <Icon name="Settings" />
            Settings<kbd>⌘ ,</kbd>
          </button>
          <button onClick={() => goto("admin/" + (activeServer()?.id || ""))}>
            <Icon name="Shield" />
            Server administration
            <Icon name="ChevronRight" size={16} />
          </button>
          <button
            onClick={async () => {
              await signOut();
              close();
            }}
          >
            <Icon name="LogIn" />
            Sign-in & onboarding
            <Icon name="ArrowUpRight" size={16} />
          </button>
        </div>
        <div className="status-options">
          {(["online", "idle", "offline"] as const).map((status) => (
            <button
              aria-pressed={store.profile.status === status}
              className={store.profile.status === status ? "selected" : ""}
              key={status}
              onClick={async () => {
                await updateStore((s) => ({
                  ...s,
                  profile: { ...s.profile, status },
                }));
                toast(
                  `Status set to ${status === "offline" ? "invisible" : status}`,
                );
              }}
            >
              <i className={`online-dot ${status}`} />
              {status === "offline"
                ? "Invisible"
                : status === "idle"
                  ? "Away"
                  : "Online"}
            </button>
          ))}
        </div>
      </>
    );
  } else if (modal.type === "sign-out") {
    title = "See you around?";
    body = (
      <>
        <p>
          Your conversations and preferences are saved to your account. You can
          return whenever you like.
        </p>
        <div className="dialog-actions">
          <Button onClick={close}>Stay here</Button>
          <Button variant="primary" icon="LogOut" onClick={() => goto("login")}>
            Sign out
          </Button>
        </div>
      </>
    );
  } else if (modal.type === "add-friend") {
    title = t("Add a friend");
    body = (
      <>
        <p className="modal-intro">
          {t("Search for people from your servers by name or username.")}
        </p>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t("Name or username")}
          label={t("Find people")}
          autoFocus
        />
        {errors}
        <div className="people-picker friend-search-results" aria-live="polite">
          {friendSearchBusy ? (
            <p className="friend-search-note">{t("Searching…")}</p>
          ) : query.trim().length < 2 ? (
            <p className="friend-search-note">
              {t("Enter at least two characters to search.")}
            </p>
          ) : friendResults.length ? (
            friendResults.map((person) => {
              const disabled =
                person.relationship === "accepted" ||
                person.relationship === "outgoing" ||
                (!person.canRequest && person.relationship === "none");
              const label =
                person.relationship === "accepted"
                  ? t("Friends")
                  : person.relationship === "outgoing"
                    ? t("Request sent")
                    : person.relationship === "incoming"
                      ? t("Accept request")
                      : person.canRequest
                        ? t("Add friend")
                        : t("Requests closed");
              return (
                <div className="friend-search-row" key={person.id}>
                  <Avatar
                    user={{
                      ...person,
                      activity: "",
                      role: "Member",
                      bio: "",
                      xp: 0,
                    }}
                    size={40}
                  />
                  <button
                    className="friend-search-identity"
                    onClick={() => open({ type: "profile", id: person.id })}
                  >
                    <strong>{person.name}</strong>
                    <small>@{person.handle}</small>
                  </button>
                  <Button
                    variant={
                      person.relationship === "none" ? "primary" : "secondary"
                    }
                    icon={
                      person.relationship === "accepted"
                        ? "CircleCheck"
                        : "UserPlus"
                    }
                    disabled={disabled}
                    onClick={async () => {
                      let next: FriendSearchResult["relationship"];
                      if (person.relationship === "incoming") {
                        await command(`/friends/${person.id}`, "PUT", {
                          accept: true,
                        });
                        next = "accepted";
                        toast(t("Friend request accepted"));
                      } else {
                        const result = await command<{
                          relationship: FriendSearchResult["relationship"];
                        }>("/friends", "POST", { targetId: person.id });
                        next = result.relationship;
                        toast(
                          t(
                            next === "accepted"
                              ? "Friend request accepted"
                              : "Friend request sent",
                          ),
                        );
                      }
                      setFriendResults((current) =>
                        current.map((item) =>
                          item.id === person.id
                            ? { ...item, relationship: next }
                            : item,
                        ),
                      );
                      await refresh();
                    }}
                  >
                    {label}
                  </Button>
                </div>
              );
            })
          ) : (
            <EmptyState
              title={t("No people found")}
              description={t(
                "Try another name or username. Only people visible to you can appear here.",
              )}
            />
          )}
        </div>
        <div className="dialog-actions">
          <Button onClick={close}>{t("Close")}</Button>
        </div>
      </>
    );
  } else if (modal.type === "new-message") {
    title = "Start a conversation";
    const groupMode = modal.extra === "group" || selected.length > 1;
    const filtered = users.filter(
      (u) =>
        u.id !== store.profile.id &&
        `${u.name} ${u.handle}`.toLowerCase().includes(query.toLowerCase()),
    );
    body = (
      <>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Find someone by name or username"
          label="Find people"
        />
        <div className="people-picker">
          {filtered.map((u) => (
            <button
              key={u.id}
              className={selected.includes(u.id) ? "selected" : ""}
              onClick={() =>
                setSelected((s) =>
                  s.includes(u.id)
                    ? s.filter((id) => id !== u.id)
                    : [...s, u.id],
                )
              }
              aria-pressed={selected.includes(u.id)}
            >
              <Avatar user={u.id} size={36} />
              <span>
                <strong>{u.name}</strong>
                <small>@{u.handle}</small>
              </span>
              <Icon
                name={selected.includes(u.id) ? "CircleCheck" : "Circle"}
                size={18}
              />
            </button>
          ))}
          {!filtered.length && (
            <EmptyState
              title="No one by that name here yet"
              description="Try a different username, or invite someone to your community."
            />
          )}
        </div>
        {groupMode && (
          <Field
            label="Group name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Give your crew a name"
            maxLength={45}
          />
        )}
        <div className="dialog-actions">
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            icon="MessageCircle"
            disabled={!selected.length}
            onClick={async () => {
              if (groupMode) {
                const id = `group-${newId().slice(0, 8)}`;
                const groupName =
                  name.trim() ||
                  selected
                    .map((id) => getUser(id).name.split(" ")[0])
                    .join(", ");
                await updateStore((s) => ({
                  ...s,
                  groups: [
                    ...s.groups,
                    { id, name: groupName, members: selected },
                  ],
                }));
                goto(`messages/${id}`);
                toast("Group conversation created");
              } else {
                await openConversation(selected[0]);
                close();
              }
            }}
          >
            {groupMode
              ? `Create group (${selected.length + 1})`
              : "Start conversation"}
          </Button>
        </div>
      </>
    );
  } else if (modal.type === "role-change") {
    title = `Change ${getUser(modal.id || "").name.split(" ")[0]}’s role`;
    body = (
      <>
        <p className="modal-intro">
          A role changes what this person can manage in Studio Collective.
          Choose with care.
        </p>
        <Field label="New role" id="new-role">
          <select
            id="new-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option>Admin</option>
            <option>Moderator</option>
            <option>Member</option>
          </select>
        </Field>
        <div className="settings-info">
          <Icon name="Shield" size={18} />
          <p>
            {role === "Admin"
              ? "Admins can manage channels, missions, and community settings."
              : role === "Moderator"
                ? "Moderators can pin and moderate community messages."
                : "Members can chat, react, join missions, and attend events."}
          </p>
        </div>
        <div className="dialog-actions">
          <Button onClick={close}>Keep current role</Button>
          <Button
            variant="primary"
            onClick={async () => {
              await updateStore((s) => ({
                ...s,
                roles: { ...s.roles, [modal.id!]: role },
              }));
              close();
              toast(
                `${getUser(modal.id!).name} is now a ${role.toLowerCase()}`,
              );
            }}
          >
            Change role
          </Button>
        </div>
      </>
    );
  } else if (modal.type === "permission-change") {
    title = "Server permissions";
    body = (
      <Button onClick={() => goto("admin/" + (activeServer()?.id || ""))}>
        Open role permissions
      </Button>
    );
  } else {
    title = "A little off the map";
    body = (
      <EmptyState
        title="This space isn’t available"
        description="Head back to your people and try again."
      />
    );
  }
  return (
    <Dialog title={title} onClose={close} wide={wide} className={className}>
      {store.error && (
        <p className="field-error" role="alert">
          {store.error}
        </p>
      )}
      {body}
    </Dialog>
  );
}
