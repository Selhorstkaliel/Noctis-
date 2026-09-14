import {
  Avatar,
  AvatarStack,
  Badge,
  Button,
  Icon,
  IconButton,
  Progress,
  useUI,
} from "./components";
import { getUser, formatNumber, type Server, type Mission } from "./data";
import { navigate, useStore, openConversation } from "./store";
import { useI18n } from "./i18n";

export function ServerCard({
  server,
  discover = false,
}: {
  server: Server;
  discover?: boolean;
}) {
  const { open } = useUI();
  const { t } = useI18n();
  return (
    <article className="server-card">
      <button
        className={`server-cover cover-${server.id}`}
        onClick={() =>
          discover && !server.joined
            ? open({ type: "server-preview", id: server.id })
            : navigate(`server/${server.id}/general`)
        }
        aria-label={t("Open {name}", { name: server.name })}
      >
        <img src={server.image} alt="" />
        <span className="server-cover-shade" />
        {server.unread > 0 && server.joined && (
          <span className="unread-pill">
            {t("{count} new", { count: server.unread })}
          </span>
        )}
        <span className="server-mark" style={{ color: server.color }}>
          {server.mark}
        </span>
      </button>
      <div className="server-card-body">
        <button
          className="text-link server-title"
          onClick={() =>
            discover && !server.joined
              ? open({ type: "server-preview", id: server.id })
              : navigate(`server/${server.id}/general`)
          }
        >
          {server.name}
          <Icon name="BadgeCheck" size={15} />
        </button>
        <p>{server.description}</p>
        <div className="server-card-foot">
          <span>
            <i className="online-dot" />
            {t("{count} online", { count: server.online })}
          </span>
          <span>
            <Icon name="Users" size={13} />
            {formatNumber(server.members)}
          </span>
          {discover && (
            <button
              className="small-link"
              onClick={() => open({ type: "server-preview", id: server.id })}
            >
              {t(server.joined ? "Joined" : "Explore")}
              <Icon name="ArrowUpRight" size={13} />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
export function MissionCard({
  mission,
  compact = false,
}: {
  mission: Mission;
  compact?: boolean;
}) {
  const store = useStore();
  const { t } = useI18n();
  const server = store.servers.find((s) => s.id === mission.server);
  const done = mission.objectives.filter((o) => o.done).length;
  return (
    <button
      className={`mission-card ${compact ? "compact-mission" : ""} ${mission.claimed ? "complete" : ""}`}
      onClick={() => navigate(`missions/${mission.id}`)}
    >
      <div className="mission-top">
        <span className={`mission-icon ${mission.color}`}>
          <Icon name={mission.claimed ? "Check" : mission.icon} size={19} />
        </span>
        <span className="xp-label">
          <Icon name="Zap" size={13} />
          {mission.xp} XP
        </span>
      </div>
      <span className="mission-category">
        {compact ? server?.name : mission.category}
      </span>
      <h3>{mission.title}</h3>
      {!compact && <p className="mission-description">{mission.description}</p>}
      <div className="mission-progress-label">
        <span>
          {mission.claimed
            ? t("Completed")
            : t("{done} of {total} objectives", {
                done,
                total: mission.objectives.length,
              })}
        </span>
        <span>{Math.round((done / mission.objectives.length) * 100)}%</span>
      </div>
      <Progress
        value={(done / mission.objectives.length) * 100}
        label={t("{name} progress", { name: mission.title })}
      />
      <div className="mission-foot">
        <span>
          <Icon name={mission.claimed ? "CircleCheck" : "Clock3"} size={12} />
          {mission.due}
        </span>
        {!compact && (
          <AvatarStack
            ids={
              mission.joined
                ? ["alex", "sophie", "james"]
                : ["sophie", "james", "maya"]
            }
            total={mission.people}
          />
        )}
        {compact && <Icon name="ArrowUpRight" size={14} />}
      </div>
    </button>
  );
}
export function Home() {
  const store = useStore();
  const { open } = useUI();
  const { t, locale } = useI18n();
  const friends = store.users.filter(
    (u) =>
      u.id !== store.profile.id &&
      u.status === "online" &&
      store.friendships.some(
        (f) =>
          f.status === "accepted" &&
          (f.requesterId === u.id || f.recipientId === u.id),
      ),
  );
  const liveChannel =
    store.channels.find((c) => c.id === store.voice[0]?.channelId) ||
    store.channels.find((c) => c.kind === "voice");
  return (
    <div className="home-layout">
      <div className="home-main page-content">
        <div className="home-greeting">
          <div>
            <span className="eyebrow">{t("YOUR SPACE. YOUR PEOPLE.")}</span>
            <h1>
              {locale === "pt-BR" ? "" : "Good "}
              {t(
                new Date().getHours() < 12
                  ? "morning"
                  : new Date().getHours() < 18
                    ? "afternoon"
                    : "evening",
              )}
              , {store.profile.name.split(" ")[0]}
              <span className="greeting-dot">.</span>
            </h1>
            <p>{t("A little connection goes a long way. Welcome back.")}</p>
          </div>
          <span className="date-label">
            <Icon name="CalendarDays" size={15} />
            {new Date().toLocaleDateString(locale, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </span>
        </div>
        <section className="home-hero">
          <img
            src="/images/mountains.jpg"
            alt={t("Dramatic mountain peaks rising through the mist")}
          />
          <div className="hero-shade" />
          <div className="hero-content">
            <Badge tone="glass" icon="Orbit">
              {t("MORE THAN A CONVERSATION")}
            </Badge>
            <h2>
              {t("Find your people.")}
              <br />
              {t("Make your space.")}
            </h2>
            <p>
              {t("Somewhere to belong. Something to build.")}
              <br />
              {t("The next good thing starts with a hello.")}
            </p>
            <Button
              variant="light"
              icon="Compass"
              onClick={() => navigate("discover")}
            >
              {t("Explore communities")}
              <Icon name="ArrowUpRight" size={15} />
            </Button>
          </div>
          <span className="hero-coordinate">
            <span className="coordinate-line" />
            {t("CONNECTED, IN YOUR ELEMENT.")}
          </span>
          <span className="hero-pagination">
            <i />
            <i />
            <i />
          </span>
        </section>
        <section>
          <div className="section-heading">
            <h2>
              {t("Your communities")}{" "}
              <span className="count-badge">
                {store.servers.filter((s) => s.joined).length}
              </span>
            </h2>
            <button
              className="subtle-link"
              onClick={() => open({ type: "create-server" })}
            >
              <Icon name="Plus" size={15} />
              {t("Create a server")}
            </button>
          </div>
          {!store.servers.some((s) => s.joined) && (
            <p className="muted">
              {t("Discover a community or create a space of your own.")}
            </p>
          )}
          <div className="server-grid">
            {store.servers
              .filter((s) => s.joined)
              .slice(0, 3)
              .map((server) => (
                <ServerCard key={server.id} server={server} />
              ))}
          </div>
        </section>
        <section>
          <div className="section-heading">
            <h2>
              <Icon name="Target" size={18} />
              {t("Your missions")}{" "}
              <Badge tone="violet">{t("In progress")}</Badge>
            </h2>
            <a href="#/missions" className="subtle-link">
              {t("View all")}
              <Icon name="ArrowRight" size={14} />
            </a>
          </div>
          <div className="mission-grid home-missions">
            {store.missions
              .filter((m) => m.joined && !m.claimed)
              .slice(0, 3)
              .map((mission) => (
                <MissionCard key={mission.id} mission={mission} compact />
              ))}
          </div>
          {store.missions.filter((m) => m.joined && !m.claimed).length ===
            0 && (
            <p className="muted">
              {t("You're all caught up. Discover your next mission.")}
            </p>
          )}
        </section>
        <section className="recent-section">
          <div className="section-heading">
            <h2>{t("Pick up the conversation")}</h2>
            <a href="#/messages" className="subtle-link">
              {t("All messages")}
              <Icon name="ArrowRight" size={14} />
            </a>
          </div>
          <div className="recent-conversations">
            {store.groups
              .filter((g) => !g.name)
              .slice(0, 2)
              .map((g) => g.members.find((id) => id !== store.profile.id)!)
              .filter(Boolean)
              .map((id) => {
                const user = getUser(id);
                const last = store.messages
                  .filter((m) => m.room === `dm/${id}`)
                  .at(-1);
                return (
                  <button
                    className="conversation-preview"
                    key={id}
                    onClick={() => void openConversation(id)}
                  >
                    <Avatar user={id} size={38} />
                    <span>
                      <strong>{user.name}</strong>
                      <span>{last?.text}</span>
                    </span>
                    <span className="conversation-time">
                      {last &&
                        new Date(last.time).toLocaleTimeString(locale, {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      <i />
                    </span>
                  </button>
                );
              })}
          </div>
        </section>
        <footer className="home-footer">
          <LogoMini />
          <span>{t("A little closer, even from here.")}</span>
          <span>
            {store.connection === "connected"
              ? t("Connected to Noctis")
              : t("Reconnecting…")}
            <i className="online-dot" />
          </span>
        </footer>
      </div>
      <aside className="activity-sidebar">
        <div className="section-heading">
          <h2>
            {t("Friends online")}{" "}
            <span className="count-badge">{friends.length}</span>
          </h2>
          <IconButton
            name="UserPlus"
            label={t("Add a friend")}
            onClick={() => open({ type: "add-friend" })}
          />
        </div>
        <div className="friend-list">
          {friends
            .slice(0, 4)
            .map((u) => u.id)
            .map((id) => {
              const user = getUser(id);
              return (
                <div className="friend-item" key={id}>
                  <Avatar
                    user={id}
                    size={35}
                    onClick={() => open({ type: "profile", id })}
                  />
                  <button
                    className="friend-info"
                    onClick={() => open({ type: "profile", id })}
                  >
                    <strong>{user.name}</strong>
                    <span className={id === "james" ? "music-activity" : ""}>
                      {id === "james" && <Icon name="Music2" size={11} />}
                      {user.activity}
                    </span>
                  </button>
                  <IconButton
                    name="MessageCircle"
                    label={`Message ${user.name}`}
                    onClick={() => navigate(`messages/${id}`)}
                  />
                </div>
              );
            })}
        </div>
        <button
          className="sidebar-wide-link"
          onClick={() => navigate("friends")}
        >
          {t("View all friends")}
          <Icon name="ChevronRight" size={14} />
        </button>
        <div className="sidebar-divider" />
        <div className="section-heading">
          <h2>{t("Happening now")}</h2>
          <span className="live-label">
            <i />
            {store.voice.length ? "LIVE" : t("OPEN")}
          </span>
        </div>
        <div className="live-room">
          <div className="live-room-heading">
            <span className="voice-room-icon">
              <Icon name="AudioLines" size={20} />
            </span>
            <div>
              <strong>{liveChannel?.name || t("Your voice spaces")}</strong>
              <span>
                {store.servers.find((s) => s.id === liveChannel?.serverId)
                  ?.name || t("Join a community to get started")}
              </span>
            </div>
            <span className="voice-wave">
              <i />
              <i />
              <i />
              <i />
            </span>
          </div>
          <p>
            {store.voice.length
              ? t("A few familiar faces. Drop in.")
              : t("Make a little room for a conversation.")}
          </p>
          <div className="live-room-bottom">
            <AvatarStack
              ids={store.voice
                .filter((v) => v.channelId === liveChannel?.id)
                .map((v) => v.userId)
                .slice(0, 3)}
              total={
                store.voice.filter((v) => v.channelId === liveChannel?.id)
                  .length
              }
            />
            <Button
              onClick={() =>
                navigate(
                  liveChannel
                    ? `voice/${liveChannel.serverId}/${liveChannel.slug}`
                    : "discover",
                )
              }
              variant="join"
            >
              {t("Join voice")}
              <Icon name="ArrowRight" size={13} />
            </Button>
          </div>
        </div>
        <div className="sidebar-divider" />
        <div className="section-heading">
          <h2>{t("On the horizon")}</h2>
          <a href="#/events" className="subtle-link">
            {t("View all")}
          </a>
        </div>
        <div className="upcoming-list">
          {store.events.slice(0, 2).map((event) => (
            <button
              className="upcoming-event"
              key={event.id}
              onClick={() => open({ type: "event", id: event.id })}
            >
              <span className="date-block">
                <small>{event.month}</small>
                <strong>{event.day}</strong>
              </span>
              <span>
                <strong>{event.title}</strong>
                <span>{event.time}</span>
                <small>
                  {store.servers.find((s) => s.id === event.server)?.name}
                </small>
              </span>
            </button>
          ))}
        </div>
        <div className="sidebar-divider" />
        <div className="section-heading">
          <h2>{t("Your momentum")}</h2>
          <Icon name="Sparkles" size={16} />
        </div>
        <div className="momentum">
          <div className="level-emblem">
            <Icon name="Orbit" size={28} />
            <span>{Math.floor(store.profile.xp / 250) + 1}</span>
          </div>
          <div>
            <strong>{t("Making your mark")}</strong>
            <span>
              {t("Level")} {Math.floor(store.profile.xp / 250) + 1} ·{" "}
              {t("Explorer")}
            </span>
          </div>
        </div>
        <div className="momentum-label">
          <span>{formatNumber(store.profile.xp)} XP</span>
          <span>{(Math.floor(store.profile.xp / 250) + 1) * 250} XP</span>
        </div>
        <Progress
          value={((store.profile.xp % 250) / 250) * 100}
          label={t("Progress to next level")}
        />
        <p className="momentum-hint">
          {t("Keep showing up. Good things add up.")}
        </p>
        <button
          className="sidebar-wide-link"
          onClick={() => navigate("leaderboard")}
        >
          {t("View leaderboard")}
          <Icon name="ArrowUpRight" size={14} />
        </button>
        <div className="sidebar-bottom">
          <span className="tiny-wordmark">NOCTIS</span>
          <span>{t("A space for your people.")}</span>
        </div>
      </aside>
    </div>
  );
}
function LogoMini() {
  return <img src="/noctis.svg" alt="Noctis" width="20" height="20" />;
}
