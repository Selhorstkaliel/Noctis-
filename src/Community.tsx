import { useEffect, useId, useRef, useState } from "react";
import {
  Avatar,
  AvatarStack,
  Badge,
  Button,
  EmptyState,
  Icon,
  IconButton,
  PageHeading,
  SearchInput,
  useUI,
} from "./components";
import { formatNumber, getUser, users, type Message } from "./data";
import {
  navigate,
  newId,
  updateStore,
  useStore,
  loadRoom,
  command,
  openConversation,
  activeServer,
} from "./store";
import { musicAction, parseMusicCommand, playMusic } from "./music";
import { MusicPlayer } from "./MusicPlayer";
import { useI18n } from "./i18n";
import { Popover } from "./Popover";

export function MemberList() {
  const store = useStore();
  const { open } = useUI();
  const users = store.users
    .filter((u) =>
      store.memberships.some(
        (m) => m.serverId === activeServer()?.id && m.userId === u.id,
      ),
    )
    .map((u) => ({
      ...u,
      role: store.roles[`${activeServer()?.id}:${u.id}`] || "Member",
    }));
  return (
    <div className="member-list">
      {["online", "idle", "offline"].map((status) => (
        <section key={status}>
          <h3>
            {status.toUpperCase()} —{" "}
            {users.filter((u) => u.status === status).length}
          </h3>
          {users
            .filter((u) => u.status === status)
            .map((user) => (
              <button
                className="member-row"
                key={user.id}
                onClick={() => open({ type: "profile", id: user.id })}
              >
                <Avatar user={user.id} size={34} />
                <span>
                  <strong
                    style={{
                      color: ["Owner", "Admin"].includes(user.role)
                        ? user.color
                        : undefined,
                    }}
                  >
                    {user.id === store.profile.id
                      ? store.profile.name
                      : user.name}
                    {user.role === "Owner" && <Icon name="Crown" size={12} />}
                  </strong>
                  <small>{user.activity}</small>
                </span>
              </button>
            ))}
        </section>
      ))}
    </div>
  );
}

export function Chat({
  room,
  direct = false,
}: {
  room: string;
  direct?: boolean;
}) {
  const store = useStore();
  const { t, locale } = useI18n();
  const { open, toast } = useUI();
  const [query, setQuery] = useState("");
  const [text, setText] = useState(() => {
    try {
      return sessionStorage.getItem(`draft:${room}`) || "";
    } catch {
      return "";
    }
  });
  const [reply, setReply] = useState<string>();
  const [replyTo, setReplyTo] = useState<string>();
  const [cursor, setCursor] = useState<string | null>(null);
  const [roomError, setRoomError] = useState("");
  const [editId, setEditId] = useState<string>();
  const [editText, setEditText] = useState("");
  const [pins, setPins] = useState(false);
  const pinsButton = useRef<HTMLButtonElement>(null);
  const pinsId = useId();
  const [picker, setPicker] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<{
    name: string;
    data: string;
    image: boolean;
  }>();
  const [fileError, setFileError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    if (!sending && !attachment) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [sending, attachment]);
  const composer = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const previousTranscript = useRef({ count: -1, query: "" });
  const upload = useRef<HTMLInputElement>(null);
  const activeReader = useRef<FileReader | null>(null);
  const person = getUser(room.split("/")[1]);
  const group = store.groups.find((g) => g.id === room.split("/")[1]);
  const channel = room.split("/")[1];
  const server = store.servers.find((s) => s.id === room.split("/")[0]);
  const visible = store.messages.filter(
    (m) =>
      m.room === room &&
      (direct || !query || m.text.toLowerCase().includes(query.toLowerCase())),
  );
  const pinnedMessages = store.messages.filter(
    (m) => m.room === room && m.pinned,
  );
  useEffect(() => setPins(false), [room]);
  useEffect(() => {
    let active = true;
    if (room === "dm/empty") return;
    loadRoom(room)
      .then((next) => {
        if (active) setCursor(next);
        return command("/rooms/" + encodeURIComponent(room) + "/read");
      })
      .catch((e) => {
        if (active) setRoomError(e.message);
      });
    return () => {
      active = false;
    };
  }, [room]);
  useEffect(() => {
    const changed =
      previousTranscript.current.count !== visible.length ||
      previousTranscript.current.query !== query;
    previousTranscript.current = { count: visible.length, query };
    // Opening, dismissing, or reading pins must not move the transcript.
    if (changed && transcript.current && !pins && !query)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [visible.length, pins, query]);
  useEffect(() => {
    try {
      sessionStorage.setItem(`draft:${room}`, text);
    } catch {
      /* Draft remains in memory. */
    }
  }, [text, room]);
  useEffect(() => () => activeReader.current?.abort(), []);
  const react = async (id: string, emoji: string) =>
    await updateStore((s) => ({
      ...s,
      messages: s.messages.map((m) => {
        if (m.id !== id) return m;
        const exists = m.mine?.includes(emoji);
        return {
          ...m,
          reactions: {
            ...m.reactions,
            [emoji]: Math.max(0, (m.reactions[emoji] || 0) + (exists ? -1 : 1)),
          },
          mine: exists
            ? m.mine?.filter((x) => x !== emoji)
            : [...(m.mine || []), emoji],
        };
      }),
    }));
  const send = async () => {
    if ((!text.trim() && !attachment) || uploading || sending) return;
    setSending(true);
    try {
      const music = !direct ? parseMusicCommand(text) : null;
      if (music && server) {
        if (music.command === "play" && !music.argument) {
          open({ type: "music-play", id: server.id });
        } else if (["queue", "nowplaying"].includes(music.command)) {
          open({ type: "music-player", id: server.id });
        } else if (music.command === "play") {
          const result = await playMusic(server.id, music.argument);
          toast(
            result.added.length > 1
              ? `${result.added.length} tracks added to the queue`
              : `${result.added[0].title} added to the queue`,
          );
        } else {
          const body: Record<string, unknown> = {};
          if (music.command === "volume") {
            const volume = Number(music.argument);
            if (!Number.isInteger(volume) || volume < 0 || volume > 100)
              throw new Error("Use /volume with a whole number from 0 to 100.");
            body.volume = volume;
          }
          if (music.command === "remove") {
            const index = Number(music.argument);
            if (!Number.isInteger(index) || index < 1)
              throw new Error(
                "Use /remove with a queue position, such as /remove 2.",
              );
            body.index = index;
          }
          if (music.command === "repeat" && music.argument) {
            const mode = music.argument.toUpperCase();
            if (!["OFF", "ONE", "ALL"].includes(mode))
              throw new Error("Use /repeat off, /repeat one, or /repeat all.");
            body.mode = mode;
          }
          if (music.command === "shuffle" && music.argument) {
            if (!["on", "off"].includes(music.argument.toLowerCase()))
              throw new Error("Use /shuffle on or /shuffle off.");
            body.enabled = music.argument.toLowerCase() === "on";
          }
          if (music.command === "move" && music.argument) {
            const voice = store.channels.find(
              (item) =>
                item.serverId === server.id &&
                item.kind === "voice" &&
                [item.id, item.slug, item.name].includes(music.argument),
            );
            if (!voice)
              throw new Error("Choose a voice channel from this server.");
            body.channelId = voice.id;
          }
          await musicAction(server.id, music.command, body);
          toast(
            music.command === "stop"
              ? "Noctis Music stopped"
              : music.command === "skip" || music.command === "pass"
                ? "Skipped to the next track"
                : "Music controls updated",
          );
        }
        setText("");
        setFileError("");
        try {
          sessionStorage.removeItem(`draft:${room}`);
        } catch {}
        composer.current?.focus();
        return;
      }
      const message: Message = {
        id: newId(),
        room,
        user: store.profile.id,
        text: text.trim(),
        time: new Intl.DateTimeFormat("en-US", {
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date()),
        reactions: {},
        reply,
        replyTo,
        ...(attachment
          ? attachment.image
            ? { image: attachment.data }
            : { file: { name: attachment.name, data: attachment.data } }
          : {}),
      };
      await updateStore((s) => ({ ...s, messages: [...s.messages, message] }));
      setText("");
      setReply(undefined);
      setReplyTo(undefined);
      setAttachment((current) =>
        current === attachment ? undefined : current,
      );
      setPicker(null);
      composer.current?.focus();
    } catch (error) {
      setFileError((error as Error).message);
    } finally {
      setSending(false);
    }
  };
  const selectFile = (file?: File) => {
    setFileError("");
    if (!file) return;
    if (file.size > 8_388_608) {
      setFileError("Choose a file no larger than 8 MB.");
      return;
    }
    if (!/\.(png|jpe?g|gif|webp|txt|md|csv)$/i.test(file.name)) {
      setFileError("Choose an image, UTF-8 text, Markdown, or CSV file.");
      return;
    }
    setUploading(true);
    const reader = new FileReader();
    activeReader.current = reader;
    reader.onload = () => {
      setAttachment({
        name: file.name,
        data: String(reader.result),
        image: /^image\/(png|jpeg|gif|webp)$/.test(file.type),
      });
      setUploading(false);
    };
    reader.onerror = () => {
      setFileError("This file could not be read. Choose it again.");
      setUploading(false);
    };
    reader.readAsDataURL(file);
  };
  return (
    <div className={`chat-layout ${direct ? "direct-layout" : ""}`}>
      {direct && (
        <aside className="dm-sidebar">
          <div className="section-heading">
            <h2>{t("Messages")}</h2>
            <IconButton
              name="SquarePen"
              label={t("New conversation")}
              onClick={() => open({ type: "new-message" })}
            />
          </div>
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder={t("Search conversations")}
            label={t("Search conversations")}
          />
          <div className="dm-list">
            {users
              .filter(
                (u) =>
                  u.id !== store.profile.id &&
                  `${u.name} ${u.handle}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
              )
              .map((user) => (
                <a
                  key={user.id}
                  href={`#/messages/${user.id}`}
                  className={`dm-person ${room === `dm/${user.id}` ? "active" : ""}`}
                >
                  <Avatar user={user.id} size={36} />
                  <span>
                    <strong>{user.name}</strong>
                    <small>
                      {store.messages
                        .filter((m) => m.room === `dm/${user.id}`)
                        .at(-1)?.text || user.activity}
                    </small>
                  </span>
                  {store.unreadDM[user.id] > 0 && (
                    <i className="small-unread" />
                  )}
                </a>
              ))}
            {store.groups
              .filter(
                (g) =>
                  !!g.name &&
                  g.name.toLowerCase().includes(query.toLowerCase()),
              )
              .map((g) => (
                <a
                  key={g.id}
                  href={`#/messages/${g.id}`}
                  className={`dm-person ${group?.id === g.id ? "active" : ""}`}
                >
                  <span className="group-avatar">
                    <Icon name="Users" />
                  </span>
                  <span>
                    <strong>{g.name}</strong>
                    <small>
                      {t("{count} members", { count: g.members.length })}
                    </small>
                  </span>
                </a>
              ))}
            {query &&
              !users.some(
                (u) =>
                  u.id !== store.profile.id &&
                  `${u.name} ${u.handle}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
              ) &&
              !store.groups.some((g) =>
                (g.name || "").toLowerCase().includes(query.toLowerCase()),
              ) && (
                <EmptyState
                  title={t("No conversations found")}
                  description={t("Try another name or clear your search.")}
                />
              )}
          </div>
          <Button
            icon="Users"
            className="full-width"
            onClick={() => open({ type: "new-message", extra: "group" })}
          >
            {t("Create a group")}
          </Button>
        </aside>
      )}
      <div className="chat-main">
        {room === "dm/empty" ? (
          <EmptyState
            icon="MessageCircle"
            title={t("A good conversation starts here")}
            description={t(
              "Choose someone from the sidebar, or start a new conversation.",
            )}
            action={
              <Button onClick={() => open({ type: "new-message" })}>
                {t("New conversation")}
              </Button>
            }
          />
        ) : (
          <>
            {roomError && (
              <div className="inline-banner" role="alert">
                {roomError}
                {direct && room !== "dm/empty" && (
                  <Button
                    onClick={async () => {
                      await openConversation(room.slice(3));
                      setRoomError("");
                      await loadRoom(room);
                    }}
                  >
                    {t("Start conversation")}
                  </Button>
                )}
              </div>
            )}
            {cursor && (
              <Button
                variant="ghost"
                onClick={async () => setCursor(await loadRoom(room, cursor))}
              >
                {t("Load earlier messages")}
              </Button>
            )}
            <div className="chat-heading">
              <div className="chat-heading-name">
                {direct ? (
                  group ? (
                    <Icon name="Users" size={22} />
                  ) : (
                    <Avatar
                      user={person.id}
                      size={32}
                      onClick={() => open({ type: "profile", id: person.id })}
                    />
                  )
                ) : (
                  <span className="channel-heading-icon">
                    <Icon name="Hash" size={23} />
                  </span>
                )}
                <div>
                  <h2>{direct ? group?.name || person.name : channel}</h2>
                  <span>
                    {direct
                      ? group
                        ? t("{count} members", {
                            count: group.members.length + 1,
                          })
                        : person.activity
                      : `${server?.name || t("Your community")} · ${t("Every good thing starts with a conversation")}`}
                  </span>
                </div>
              </div>
              <div className="chat-heading-actions">
                {direct && (
                  <IconButton
                    name="Phone"
                    label={t("Start voice call")}
                    onClick={() => navigate("voice/studio/lounge")}
                  />
                )}
                <IconButton
                  name="Pin"
                  ref={pinsButton}
                  label={t("Show pinned messages")}
                  aria-haspopup="dialog"
                  aria-expanded={pins}
                  aria-controls={pins ? pinsId : undefined}
                  className={pins ? "active" : ""}
                  onClick={() => setPins(!pins)}
                />
                <IconButton
                  name="Search"
                  label={t("Search this conversation")}
                  onClick={() => open({ type: "search", extra: room })}
                />
                <IconButton
                  name="Users"
                  label={t("View conversation members")}
                  onClick={() => open({ type: "members" })}
                />
              </div>
            </div>
            {!direct && (
              <div className="channel-welcome-bar">
                <Icon name="Sparkles" size={15} />
                <span>
                  {t(
                    "A space for ideas, little wins, and everything in between.",
                  )}
                </span>
                <button
                  onClick={() =>
                    open({ type: "invite", id: server?.id || "studio" })
                  }
                >
                  {t("Invite a friend")}
                  <Icon name="ArrowUpRight" size={13} />
                </button>
              </div>
            )}
            {pins && (
              <Popover
                id={pinsId}
                anchor={pinsButton}
                title={t("Pinned messages")}
                closeLabel={t("Close pinned messages")}
                onClose={() => setPins(false)}
              >
                {pinnedMessages.length ? (
                  <ul className="pinned-message-list">
                    {pinnedMessages.map((message) => {
                      const user =
                        message.user === store.profile.id
                          ? store.profile
                          : getUser(message.user);
                      return (
                        <li key={message.id}>
                          <button
                            className="pinned-message-link"
                            aria-label={t("Go to message by {name}", {
                              name: user.name,
                            })}
                            aria-describedby={`pin-preview-${message.id}`}
                            onClick={() => {
                              setPins(false);
                              const target = document.getElementById(
                                `message-${message.id}`,
                              );
                              target?.focus({ preventScroll: true });
                              target?.scrollIntoView({ block: "center" });
                            }}
                          >
                            <Avatar user={user} size={28} status={false} />
                            <span className="pinned-message-content">
                              <span className="pinned-message-meta">
                                <strong>{user.name}</strong>
                                <time dateTime={message.time}>
                                  {new Date(message.time).toLocaleDateString(
                                    locale,
                                    { day: "numeric", month: "short" },
                                  )}
                                </time>
                              </span>
                              <span
                                id={`pin-preview-${message.id}`}
                                className="pinned-message-preview"
                              >
                                {message.text ||
                                  message.attachments?.[0]?.name ||
                                  message.file?.name ||
                                  t("Image")}
                              </span>
                              <span className="pinned-message-jump">
                                {t("Go to message")}{" "}
                                <Icon name="ArrowUpRight" size={12} />
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="pinned-messages-empty">
                    <Icon name="Pin" size={26} />
                    <strong>{t("Nothing pinned yet")}</strong>
                    <p>{t("Pin a message to keep it close.")}</p>
                  </div>
                )}
              </Popover>
            )}
            <div
              className="transcript"
              ref={transcript}
              role="log"
              aria-label={t("Conversation messages")}
              aria-live="polite"
            >
              <div className="conversation-start">
                <span className="conversation-start-icon">
                  <Icon name={direct ? "MessageCircle" : "Hash"} size={30} />
                </span>
                <h2>
                  {direct
                    ? t("Your conversation with {name}", {
                        name: group?.name || person.name.split(" ")[0],
                      })
                    : t("Welcome to #{channel}", { channel })}
                </h2>
                <p>
                  {direct
                    ? t("A little closer, even from here.")
                    : t(
                        "This is the beginning of something good. Make yourself at home.",
                      )}
                </p>
              </div>
              <div className="date-divider">
                <span />
                {new Date().toLocaleDateString(locale, {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
                <span />
              </div>
              {visible.length === 0 && (
                <EmptyState
                  icon="MessageCircle"
                  title={t(
                    query ? "No matching messages" : "Start the conversation",
                  )}
                  description={t(
                    query
                      ? "Try a different phrase or clear your search."
                      : "Share an idea, ask a question, or just say hello.",
                  )}
                />
              )}
              {visible.map((message) => {
                const user =
                  message.user === store.profile.id
                    ? store.profile
                    : getUser(message.user);
                return (
                  <article
                    className="chat-message"
                    key={message.id}
                    id={`message-${message.id}`}
                    tabIndex={-1}
                  >
                    <Avatar
                      user={user}
                      size={38}
                      onClick={() => open({ type: "profile", id: user.id })}
                    />
                    <div className="message-body">
                      {message.reply && (
                        <div className="reply-reference">
                          <Icon name="CornerUpRight" size={13} />
                          {message.reply}
                        </div>
                      )}
                      <div className="message-meta">
                        <button
                          style={{
                            color: ["Admin", "Owner"].includes(user.role)
                              ? user.color
                              : undefined,
                          }}
                          onClick={() => open({ type: "profile", id: user.id })}
                        >
                          {user.name}
                        </button>
                        {user.role === "Admin" && (
                          <Badge tone="violet">ADMIN</Badge>
                        )}
                        <time dateTime={message.time}>
                          {new Date(message.time).toLocaleTimeString(locale, {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </time>
                        {message.edited && <small>(edited)</small>}
                        {message.pinned && <Icon name="Pin" size={12} />}
                      </div>
                      {editId === message.id ? (
                        <form
                          noValidate
                          onSubmit={async (e) => {
                            e.preventDefault();
                            if (!editText.trim()) return;
                            await updateStore((s) => ({
                              ...s,
                              messages: s.messages.map((m) =>
                                m.id === message.id
                                  ? {
                                      ...m,
                                      text: editText.trim(),
                                      edited: true,
                                    }
                                  : m,
                              ),
                            }));
                            setEditId(undefined);
                            toast("Message updated");
                          }}
                        >
                          <textarea
                            aria-label="Edit message"
                            className="edit-message resize-none"
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            autoFocus
                          />
                          <div className="edit-actions">
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => setEditId(undefined)}
                            >
                              Cancel
                            </Button>
                            <Button
                              type="submit"
                              disabled={!editText.trim()}
                              variant="primary"
                            >
                              Save changes
                            </Button>
                          </div>
                        </form>
                      ) : (
                        <p className="message-text">
                          {message.text
                            .split(/(@[A-Z][a-z]+ [A-Z][a-z]+)/g)
                            .map((part, i) =>
                              part.startsWith("@") ? (
                                <span className="mention" key={i}>
                                  {part}
                                </span>
                              ) : (
                                part
                              ),
                            )}
                        </p>
                      )}
                      {message.image && (
                        <button
                          className="message-image"
                          aria-label="Open shared image"
                          onClick={() =>
                            open({ type: "image", id: message.id })
                          }
                        >
                          <img
                            src={message.image}
                            alt={`Image shared by ${user.name}`}
                          />
                        </button>
                      )}
                      {message.file && (
                        <a
                          className="file-attachment"
                          href={message.file.data}
                          download={message.file.name}
                        >
                          <Icon name="FileText" size={25} />
                          <span>
                            {message.file.name}
                            <small>Download attachment</small>
                          </span>
                          <Icon name="Download" size={17} />
                        </a>
                      )}
                      <div className="reactions">
                        {Object.entries(message.reactions)
                          .filter(([, count]) => count > 0)
                          .map(([emoji, count]) => (
                            <button
                              key={emoji}
                              className={`reaction ${message.mine?.includes(emoji) ? "reacted" : ""}`}
                              aria-label={`${emoji} reaction, ${count}${message.mine?.includes(emoji) ? ", selected" : ""}`}
                              aria-pressed={
                                message.mine?.includes(emoji) || false
                              }
                              onClick={() => react(message.id, emoji)}
                            >
                              {emoji}
                              <span>{count}</span>
                            </button>
                          ))}
                        <button
                          className="add-reaction"
                          title="React with a heart"
                          aria-label="React with a heart"
                          onClick={() => react(message.id, "🤍")}
                        >
                          <Icon name="SmilePlus" size={15} />
                        </button>
                      </div>
                    </div>
                    <div className="message-actions">
                      <IconButton
                        name="Reply"
                        label={`Reply to ${user.name}`}
                        onClick={() => {
                          setReply(
                            `${user.name}: ${message.text.slice(0, 90)}`,
                          );
                          setReplyTo(message.id);
                          composer.current?.focus();
                        }}
                      />
                      <IconButton
                        name="Pin"
                        label={message.pinned ? "Unpin message" : "Pin message"}
                        onClick={async () => {
                          await updateStore((s) => ({
                            ...s,
                            messages: s.messages.map((m) =>
                              m.id === message.id
                                ? { ...m, pinned: !m.pinned }
                                : m,
                            ),
                          }));
                          toast(
                            message.pinned
                              ? "Message unpinned"
                              : "Message pinned",
                          );
                        }}
                      />
                      {message.user === store.profile.id && (
                        <>
                          <IconButton
                            name="Pencil"
                            label="Edit message"
                            onClick={() => {
                              setEditId(message.id);
                              setEditText(message.text);
                            }}
                          />
                          <IconButton
                            name="Trash2"
                            label="Delete message"
                            onClick={async () => {
                              const index = store.messages.findIndex(
                                (m) => m.id === message.id,
                              );
                              await updateStore((s) => ({
                                ...s,
                                messages: s.messages.filter(
                                  (m) => m.id !== message.id,
                                ),
                              }));
                              toast(
                                "Message deleted",
                                async () =>
                                  await updateStore((s) => ({
                                    ...s,
                                    messages: [
                                      ...s.messages.slice(0, index),
                                      message,
                                      ...s.messages.slice(index),
                                    ],
                                  })),
                              );
                              composer.current?.focus();
                            }}
                          />
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
            {!direct && channel === "general" && server && (
              <MusicPlayer serverId={server.id} view="chat" />
            )}
            <div className="composer-area">
              {reply && (
                <div className="composer-reply">
                  <Icon name="Reply" size={14} />
                  <span>Replying to {reply}</span>
                  <IconButton
                    name="X"
                    label="Cancel reply"
                    onClick={() => {
                      setReply(undefined);
                      setReplyTo(undefined);
                    }}
                  />
                </div>
              )}
              {attachment && (
                <div className="attachment-preview">
                  {attachment.image ? (
                    <img src={attachment.data} alt="Attachment preview" />
                  ) : (
                    <Icon name="FileText" />
                  )}
                  <span>{attachment.name}</span>
                  <IconButton
                    name="X"
                    label="Remove attachment"
                    onClick={() => setAttachment(undefined)}
                  />
                </div>
              )}
              {fileError && (
                <p className="field-error" role="alert">
                  {fileError}
                </p>
              )}
              {picker && (
                <div className="composer-picker">
                  {picker === "emoji"
                    ? [
                        "🤍",
                        "✨",
                        "🔥",
                        "🙌",
                        "👀",
                        "🎉",
                        "👋",
                        "🎧",
                        "💜",
                        "🚀",
                      ].map((emoji) => (
                        <button
                          key={emoji}
                          onClick={() => {
                            setText((t) => t + emoji);
                            setPicker(null);
                            composer.current?.focus();
                          }}
                        >
                          {emoji}
                        </button>
                      ))
                    : picker === "mention"
                      ? users.map((u) => (
                          <button
                            className="mention-option"
                            key={u.id}
                            onClick={() => {
                              setText((t) => t + `@${u.handle} `);
                              setPicker(null);
                              composer.current?.focus();
                            }}
                          >
                            <Avatar user={u.id} size={22} />
                            {u.name}
                          </button>
                        ))
                      : ["celebrate", "wave", "yes"].map((gif, i) => (
                          <button
                            key={gif}
                            className="gif-choice"
                            onClick={() => {
                              setAttachment({
                                name: `${gif}.gif`,
                                data: `/images/${gif}.gif`,
                                image: true,
                              });
                              setPicker(null);
                            }}
                          >
                            <img
                              src={`/images/${gif}.gif`}
                              alt={
                                ["Celebration GIF", "Hello GIF", "Yes GIF"][i]
                              }
                            />
                          </button>
                        ))}
                  <IconButton
                    name="X"
                    label="Close picker"
                    onClick={() => setPicker(null)}
                  />
                </div>
              )}
              <div className="composer">
                <IconButton
                  name="PlusCircle"
                  label="Attach a file"
                  onClick={() => upload.current?.click()}
                  disabled={uploading}
                />
                <input
                  type="file"
                  ref={upload}
                  className="visually-hidden"
                  tabIndex={-1}
                  accept=".png,.jpg,.jpeg,.gif,.webp,.txt,.md,.csv"
                  aria-label="Upload attachment"
                  onChange={(e) => {
                    selectFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <textarea
                  ref={composer}
                  className="resize-none"
                  rows={1}
                  value={text}
                  maxLength={4000}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  disabled={sending || !!roomError}
                  aria-label={t("Message")}
                  placeholder={
                    uploading
                      ? t("Reading your file…")
                      : t("Message {destination}", {
                          destination: direct
                            ? group?.name || `@${person.name}`
                            : `#${channel}`,
                        })
                  }
                />
                <div className="composer-tools">
                  <IconButton
                    name="AtSign"
                    label="Mention a member"
                    onClick={() =>
                      setPicker(picker === "mention" ? null : "mention")
                    }
                  />
                  <button
                    className="gif-button"
                    aria-label="Choose a GIF"
                    onClick={() => setPicker(picker === "gif" ? null : "gif")}
                  >
                    GIF
                  </button>
                  <IconButton
                    name="Smile"
                    label="Choose an emoji"
                    onClick={() =>
                      setPicker(picker === "emoji" ? null : "emoji")
                    }
                  />
                  <button
                    className="send-button"
                    aria-label="Send message"
                    disabled={
                      (!text.trim() && !attachment) ||
                      uploading ||
                      sending ||
                      !!roomError
                    }
                    onClick={send}
                  >
                    <Icon name="SendHorizontal" size={18} />
                  </button>
                </div>
              </div>
              <div className="composer-hint">
                <span>
                  <Icon name="Radio" size={12} />
                  {store.connection === "connected"
                    ? t("Connected")
                    : t("Reconnecting…")}
                </span>
                <span>
                  <kbd>Enter</kbd> to send · <kbd>Shift + Enter</kbd> for a new
                  line
                </span>
              </div>
            </div>
          </>
        )}
      </div>
      {!direct && (
        <aside className="members-sidebar">
          <div className="section-heading">
            <h2>{t("Members")}</h2>
            <span className="count-badge">
              {formatNumber(server?.members || 0)}
            </span>
          </div>
          <MemberList />
          <button
            className="sidebar-wide-link"
            onClick={() => open({ type: "invite", id: server?.id || "studio" })}
          >
            <Icon name="UserPlus" size={14} />
            {t("Invite members")}
            <Icon name="ArrowUpRight" size={14} />
          </button>
          <div className="member-server-card">
            <span className="mini-server-mark">{server?.mark}</span>
            <strong>{server?.name || "Your community"}</strong>
            <p>Good people. Great possibilities.</p>
            <Badge tone="mint" icon="ShieldCheck">
              A community that cares
            </Badge>
          </div>
        </aside>
      )}
    </div>
  );
}

export { Voice } from "./VoiceRoom";

export function Friends() {
  const store = useStore();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All friends");
  const { open } = useUI();
  const filtered = users.filter(
    (u) =>
      store.friendships.some(
        (f) =>
          f.status === "accepted" &&
          (f.requesterId === u.id || f.recipientId === u.id),
      ) &&
      u.id !== store.profile.id &&
      u.name.toLowerCase().includes(query.toLowerCase()) &&
      (filter !== "Online" || u.status === "online"),
  );
  return (
    <div className="page-content standard-page">
      <PageHeading
        eyebrow="YOUR PEOPLE"
        title="A familiar face goes a long way."
        description="Keep good company. Pick up where you left off."
        action={
          <Button
            variant="primary"
            icon="UserPlus"
            onClick={() => open({ type: "add-friend" })}
          >
            Add a friend
          </Button>
        }
      />
      {store.friendships
        .filter(
          (f) => f.status === "pending" && f.recipientId === store.profile.id,
        )
        .map((f) => (
          <div className="setting-row" key={f.requesterId}>
            <strong>{getUser(f.requesterId).name} sent a friend request</strong>
            <Button
              onClick={() =>
                command(`/friends/${f.requesterId}`, "PUT", { accept: true })
              }
            >
              Accept
            </Button>
            <Button
              onClick={() =>
                command(`/friends/${f.requesterId}`, "PUT", { accept: false })
              }
            >
              Decline
            </Button>
          </div>
        ))}
      <div className="filter-toolbar">
        <div className="tabs">
          {["All friends", "Online"].map((tab) => (
            <button
              key={tab}
              className={tab === filter ? "active" : ""}
              onClick={() => setFilter(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Find a friend"
          label="Find a friend"
        />
      </div>
      <div className="friends-grid">
        {filtered.map((user) => (
          <article className="friend-card" key={user.id}>
            <Avatar
              user={user.id}
              size={54}
              onClick={() => open({ type: "profile", id: user.id })}
            />
            <div>
              <h3>{user.name}</h3>
              <span>@{user.handle}</span>
            </div>
            <p>{user.activity}</p>
            <Button
              icon="MessageCircle"
              onClick={() => void openConversation(user.id)}
            >
              Send message
            </Button>
          </article>
        ))}
      </div>
      {!filtered.length && (
        <EmptyState
          title="No friends found"
          description="Try a different name or clear your search."
        />
      )}
    </div>
  );
}
