import { useCallback, useEffect, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  Icon,
  IconButton,
  Logo,
  Toast,
  UIContext,
  type ModalState,
  type ToastState,
} from "./components";
import { Home } from "./Home";
import { Chat, Voice, Friends } from "./Community";
import {
  Missions,
  MissionDetail,
  Leaderboard,
  Discover,
  Events,
  Integrations,
} from "./Explore";
import { Settings, Admin } from "./Settings";
import { ModalContent } from "./Modals";
import { Login, Onboarding } from "./Auth";
import { SecurityRoute } from "./Security";
import { InvitePage } from "./ServicePanels";
import { getUser } from "./data";
import {
  navigate,
  updateStore,
  useRoute,
  useStore,
  initialize,
  updateSubscriptions,
} from "./store";
import { useI18n } from "./i18n";

const mainNav = [
  { path: "home", icon: "House", label: "Home" },
  {
    path: "messages",
    icon: "MessageCircle",
    label: "Direct messages",
    count: "3",
  },
  { path: "missions", icon: "Target", label: "Missions", tag: "NEW" },
  { path: "events", icon: "CalendarDays", label: "Events" },
];
const exploreNav = [
  { path: "discover", icon: "Compass", label: "Discover servers" },
  { path: "integrations", icon: "Blocks", label: "Integrations" },
];
export default function App() {
  const store = useStore();
  const { t, language } = useI18n();
  const route = useRoute();
  const parts = route.split("/");
  const page = parts[0];
  const serverContext = ["server", "voice", "admin"].includes(page);
  const routeServer = store.servers.find((item) => item.id === parts[1]);
  const rememberedServerId = (() => {
    try {
      return sessionStorage.getItem("noctis-active-server");
    } catch {
      return null;
    }
  })();
  const rememberedServer = store.servers.find(
    (item) => item.joined && item.id === rememberedServerId,
  );
  const manageableServer = store.servers.find(
    (item) =>
      item.joined &&
      (item.ownerId === store.profile.id ||
        item.permissions?.some((permission) =>
          [
            "MANAGE_SERVER",
            "MANAGE_ROLES",
            "MANAGE_CHANNELS",
            "VIEW_AUDIT_LOG",
            "KICK_MEMBERS",
          ].includes(permission),
        )),
  );
  const legacyAdminRoute =
    page === "admin" &&
    parts[1] === "studio" &&
    rememberedServer?.id !== undefined &&
    rememberedServer.id !== parts[1];
  const server =
    page === "admin"
      ? legacyAdminRoute
        ? rememberedServer
        : routeServer?.joined
          ? routeServer
          : rememberedServer || manageableServer
      : routeServer;
  const [voiceTarget, setVoiceTarget] = useState<{
    serverId: string;
    channelSlug: string;
  } | null>(null);
  useEffect(() => {
    if (page === "voice" && parts[1])
      setVoiceTarget({
        serverId: parts[1],
        channelSlug: parts[2] || "lounge",
      });
  }, [page, parts[1], parts[2]]);
  useEffect(() => {
    if (!serverContext) return;
    if (
      page === "admin" &&
      store.auth === "authenticated" &&
      server?.id &&
      server.id !== parts[1]
    ) {
      navigate(`admin/${server.id}`);
      return;
    }
    if (routeServer?.joined) {
      try {
        sessionStorage.setItem("noctis-active-server", routeServer.id);
      } catch {}
      return;
    }
    if (page === "admin" && store.auth === "authenticated" && server?.id)
      navigate(`admin/${server.id}`);
  }, [page, parts[1], routeServer?.id, server?.id, store.auth]);
  useEffect(() => {
    if (
      page === "invite" &&
      /^[\w-]{43}$/.test(parts[1] || "") &&
      store.auth !== "authenticated"
    )
      sessionStorage.setItem("noctis-pending-invite", parts[1]);
  }, [route, store.auth]);
  const [modal, setModal] = useState<ModalState>(null);
  const [toastValue, setToast] = useState<ToastState>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const toast = useCallback(
    (message: string, action?: () => void, actionLabel?: string) =>
      setToast({ message, action, actionLabel }),
    [],
  );
  const closeToast = useCallback(() => setToast(null), []);
  const title =
    page === "server"
      ? parts[2] || "general"
      : page === "voice"
        ? t("The Lounge")
        : page === "messages"
          ? t("Direct messages")
          : page === "admin"
            ? t("Server administration")
            : page === "discover"
              ? t("Discover")
              : page === "login"
                ? t("Welcome to Noctis")
                : t(page.charAt(0).toUpperCase() + page.slice(1));
  const securityRoute =
    ["mfa", "forgot-password", "verify-email", "reset-email"].includes(page) ||
    store.auth === "verification";
  useEffect(() => {
    if (!securityRoute) document.title = `${title} â€” Noctis`;
    setMobileNav(false);
    document.querySelector(".workspace")?.scrollTo(0, 0);
  }, [route, title, securityRoute]);
  useEffect(() => {
    document.documentElement.dataset.theme = String(store.settings.theme);
    document.documentElement.dataset.motion = store.settings.motion
      ? "on"
      : "off";
    if (!securityRoute) document.documentElement.lang = language;
  }, [store.settings.theme, store.settings.motion, language, securityRoute]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setModal((m) => (m?.type === "search" ? null : { type: "search" }));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        navigate("settings/account");
      }
      if (e.altKey && e.key === "1") {
        e.preventDefault();
        navigate("home");
      }
    };
    const error = () => setStorageError(true);
    const connection = () => setOffline(!navigator.onLine);
    window.addEventListener("keydown", handler);
    window.addEventListener("noctis-storage-error", error);
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("noctis-storage-error", error);
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
    };
  }, []);
  const unread = store.notifications
    .map((n) => n.id)
    .filter((id) => !store.readNotifications.includes(id)).length;
  const unreadMessages = Object.values(store.unreadDM).reduce(
    (sum, count) => sum + count,
    0,
  );
  const openServer = (id: string) =>
    navigate(
      "server/" +
        id +
        "/" +
        (store.channels.find((c) => c.serverId === id && c.kind === "text")
          ?.slug || "general"),
    );
  useEffect(() => {
    void initialize();
  }, []);
  useEffect(() => {
    const handler = (e: Event) => toast(t((e as CustomEvent).detail));
    window.addEventListener("noctis-api-error", handler);
    return () => window.removeEventListener("noctis-api-error", handler);
  }, [toast, t]);
  useEffect(() => {
    if (store.auth === "authenticated") updateSubscriptions();
  }, [route, store.auth]);
  if (
    ["mfa", "forgot-password", "verify-email", "reset-email"].includes(page) ||
    store.auth === "verification"
  )
    return (
      <SecurityRoute
        key={page}
        mode={
          store.auth === "verification" &&
          !["verify-email", "reset-email"].includes(page)
            ? "verification"
            : page
        }
      />
    );
  if (store.auth !== "authenticated")
    return (
      <UIContext.Provider value={{ open: setModal, toast }}>
        {store.auth === "anonymous" ? (
          <Login />
        ) : (
          <div className="connection-screen">
            <Logo />
            <h1>
              {store.auth === "loading"
                ? t("Finding your spaceâ€¦")
                : t("Your space is temporarily out of reach.")}
            </h1>
            <p>{store.error || t("Connecting securely to Noctis.")}</p>
            {store.auth === "error" && (
              <Button onClick={() => void initialize()}>
                {t("Try again")}
              </Button>
            )}
          </div>
        )}
      </UIContext.Provider>
    );
  const nav = (
    <>
      <div className="nav-brand">
        <Logo />
        <Badge>LIVE</Badge>
      </div>
      {!serverContext && (
        <>
          <button
            className="quick-search"
            onClick={() => setModal({ type: "search" })}
          >
            <Icon name="Search" size={15} />
            <span>{t("Find your way")}</span>
            <kbd>âŒ˜ K</kbd>
          </button>
          <nav aria-label={t("Main navigation")} className="main-nav">
            {mainNav.map((item) => (
              <a
                href={`#/${item.path}`}
                key={item.path}
                className={`nav-item ${page === item.path ? "active" : ""}`}
                aria-current={page === item.path ? "page" : undefined}
              >
                <Icon name={item.icon} />
                <span>{t(item.label)}</span>
                {item.count && unreadMessages > 0 && (
                  <span className="nav-count">{unreadMessages}</span>
                )}
                {item.tag && <span className="new-tag">{t(item.tag)}</span>}
              </a>
            ))}
          </nav>
          <div className="nav-section-label">{t("Explore").toUpperCase()}</div>
          <nav aria-label={t("Explore")} className="main-nav">
            {exploreNav.map((item) => (
              <a
                href={`#/${item.path}`}
                key={item.path}
                className={`nav-item ${page === item.path ? "active" : ""}`}
              >
                <Icon name={item.icon} />
                <span>{t(item.label)}</span>
              </a>
            ))}
          </nav>
        </>
      )}
      {serverContext ? (
        <div className="channel-navigation">
          <div className="nav-section-label">
            <span>{server?.name || "Studio Collective"}</span>
            <IconButton
              name="Settings2"
              label={t("Server administration")}
              disabled={!server}
              onClick={() => server && navigate(`admin/${server.id}`)}
            />
          </div>
          <button
            className="invite-mini"
            onClick={() =>
              setModal({ type: "invite", id: server?.id || "studio" })
            }
          >
            <Icon name="UserPlus" size={14} />
            {t("Invite your people")}
          </button>
          {store.categories
            .filter((c) => c.serverId === server?.id)
            .map((category) => (
              <div key={category.id}>
                <div className="channel-category">
                  <Icon name="ChevronDown" size={12} />
                  {category.name}
                </div>
                {store.channels
                  .filter(
                    (c) =>
                      c.serverId === server?.id && c.categoryId === category.id,
                  )
                  .map((c) => {
                    const voicePeople = [
                      ...new Map(
                        store.voice
                          .filter((voice) => voice.channelId === c.id)
                          .map((voice) => [
                            voice.userId,
                            voice.userId === store.profile.id
                              ? store.profile
                              : getUser(voice.userId),
                          ]),
                      ).values(),
                    ];
                    const visibleNames = voicePeople
                      .slice(0, 2)
                      .map((person) => person.name)
                      .join(", ");
                    return (
                      <div className="channel-entry" key={c.id}>
                        <a
                          className={`channel-link ${parts[2] === c.slug ? "selected" : ""}`}
                          href={`#/${c.kind === "voice" ? "voice" : "server"}/${c.serverId}/${c.slug}`}
                        >
                          <Icon
                            name={
                              c.kind === "voice"
                                ? "Volume2"
                                : c.isPrivate
                                  ? "Lock"
                                  : "Hash"
                            }
                            size={16}
                          />
                          {c.name}
                          {c.kind === "voice" ? (
                            <span className="voice-count">
                              {voicePeople.length}
                            </span>
                          ) : (
                            c.unread > 0 && (
                              <span className="nav-count">{c.unread}</span>
                            )
                          )}
                        </a>
                        {c.kind === "voice" && voicePeople.length > 0 && (
                          <div
                            className="mini-voice-users"
                            aria-label={`${c.name}: ${voicePeople.map((person) => person.name).join(", ")}`}
                          >
                            <span className="avatar-stack">
                              {voicePeople.slice(0, 3).map((person) => (
                                <Avatar
                                  key={person.id}
                                  user={person}
                                  size={22}
                                  status={false}
                                />
                              ))}
                            </span>
                            <span className="mini-voice-names">
                              {visibleNames}
                              {voicePeople.length > 2 &&
                                ` +${voicePeople.length - 2}`}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            ))}
        </div>
      ) : (
        <div className="your-spaces">
          <div className="nav-section-label">
            <span>{t("YOUR COMMUNITIES")}</span>
            <IconButton
              name="Plus"
              label={t("Create a server")}
              onClick={() => setModal({ type: "create-server" })}
            />
          </div>
          {store.servers
            .filter((s) => s.joined)
            .map((s) => (
              <button
                key={s.id}
                className="community-nav"
                onClick={() => openServer(s.id)}
              >
                <span
                  className={`mini-server-mark mark-${s.id}`}
                  style={{ color: s.color }}
                >
                  {s.mark}
                </span>
                <span>{s.name}</span>
                {s.unread > 0 && <i className="small-unread" />}
              </button>
            ))}
          <div className="nav-section-label">
            <span>{t("RECENT CONVERSATIONS")}</span>
            <IconButton
              name="Plus"
              label={t("New conversation")}
              onClick={() => setModal({ type: "new-message" })}
            />
          </div>
          {store.groups
            .filter((g) => !g.name)
            .slice(0, 3)
            .map((g) => g.members.find((id) => id !== store.profile.id)!)
            .filter(Boolean)
            .map((id) => (
              <a key={id} href={`#/messages/${id}`} className="recent-nav">
                <Avatar user={id} size={26} />
                <span>{getUser(id).name}</span>
                {store.unreadDM[id] > 0 && (
                  <span className="nav-count">{store.unreadDM[id]}</span>
                )}
              </a>
            ))}
        </div>
      )}
      <div className="nav-bottom">
        <div className="connection-note">
          <span className="tiny-orbit">
            <Icon name="Orbit" size={17} />
          </span>
          <div>
            <strong>{t("A space for your people.")}</strong>
            <span>{t("Make yourself at home.")}</span>
          </div>
        </div>
        <div className="user-controls">
          <Avatar
            user={store.profile.id}
            size={33}
            onClick={() => setModal({ type: "profile", id: store.profile.id })}
          />
          <button
            className="self-info"
            onClick={() => setModal({ type: "account-menu" })}
          >
            <strong>{store.profile.name}</strong>
            <span>
              <i className={`online-dot ${store.profile.status}`} />
              {t(
                store.profile.status === "idle"
                  ? "Away"
                  : store.profile.status.charAt(0).toUpperCase() +
                      store.profile.status.slice(1),
              )}
            </span>
          </button>
          <IconButton
            name="Settings"
            label={t("User settings")}
            onClick={() => navigate("settings/account")}
          />
        </div>
      </div>
    </>
  );
  let content;
  switch (page) {
    case "onboarding":
      content = <Onboarding />;
      break;
    case "home":
      content = <Home />;
      break;
    case "server":
      content = (
        <Chat key={route} room={`${parts[1]}/${parts[2] || "general"}`} />
      );
      break;
    case "messages":
      content = (
        <Chat
          key={route}
          room={`dm/${parts[1] || store.groups.find((g) => !g.name)?.members.find((id) => id !== store.profile.id) || "empty"}`}
          direct
        />
      );
      break;
    case "voice":
      content = null;
      break;
    case "missions":
      content = parts[1] ? <MissionDetail id={parts[1]} /> : <Missions />;
      break;
    case "leaderboard":
      content = <Leaderboard />;
      break;
    case "discover":
      content = <Discover />;
      break;
    case "events":
      content = <Events />;
      break;
    case "integrations":
      content = <Integrations />;
      break;
    case "settings":
      content = <Settings section={parts[1] || "account"} />;
      break;
    case "admin":
      content = (
        <Admin key={server?.id || parts[1]} serverId={server?.id || parts[1]} />
      );
      break;
    case "friends":
      content = <Friends />;
      break;
    case "login":
      content = <Login />;
      break;
    case "invite":
      content = <InvitePage token={parts[1]} />;
      break;
    default:
      content = (
        <div className="empty-state">
          <Icon name="Orbit" size={42} />
          <h1>{t("A little off the map.")}</h1>
          <p>{t("That space doesn't exist. Your people are still here.")}</p>
          <Button onClick={() => navigate("home")}>{t("Back to Home")}</Button>
        </div>
      );
  }
  return (
    <UIContext.Provider value={{ open: setModal, toast }}>
      {page === "login" ? (
        content
      ) : (
        <div className="app-shell">
          <a
            href="#main-content"
            className="skip-link"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById("main-content")?.focus();
            }}
          >
            {t("Skip to content")}
          </a>
          <aside className="server-rail" aria-label={t("Server switcher")}>
            <button
              className={`rail-home ${page === "home" ? "selected" : ""}`}
              aria-label={t("Noctis Home")}
              onClick={() => navigate("home")}
            >
              <Logo compact />
            </button>
            <span className="rail-divider" />
            {store.servers
              .filter((s) => s.joined)
              .map((s) => (
                <button
                  key={s.id}
                  className={`rail-server rail-${s.id} ${server?.id === s.id ? "selected" : ""}`}
                  title={s.name}
                  aria-label={t("Open {name}", { name: s.name })}
                  onClick={() => openServer(s.id)}
                  style={{ color: s.color }}
                >
                  {s.mark}
                  {s.unread > 0 && <span className="rail-dot" />}
                </button>
              ))}
            <button
              className="rail-add"
              aria-label={t("Create a server")}
              title={t("Create a server")}
              onClick={() => setModal({ type: "create-server" })}
            >
              <Icon name="Plus" size={23} />
            </button>
            <span className="rail-divider" />
            <button
              className="rail-discover"
              title={t("Discover servers")}
              aria-label={t("Discover servers")}
              onClick={() => navigate("discover")}
            >
              <Icon name="Compass" size={23} />
            </button>
            <div className="rail-bottom">
              <IconButton
                name="CircleHelp"
                label={t("Keyboard shortcuts")}
                onClick={() => setModal({ type: "shortcuts" })}
              />
              <Avatar
                user={store.profile.id}
                size={33}
                onClick={() => setModal({ type: "account-menu" })}
              />
            </div>
          </aside>
          <aside className="navigation-sidebar">{nav}</aside>
          <div className="app-main">
            <header className="topbar">
              <div className="topbar-title">
                <IconButton
                  name="Menu"
                  label={t("Open navigation")}
                  className="mobile-menu"
                  onClick={() => setMobileNav(true)}
                />
                <Icon
                  name={
                    page === "server"
                      ? "Hash"
                      : mainNav.find((x) => x.path === page)?.icon ||
                        exploreNav.find((x) => x.path === page)?.icon ||
                        "Orbit"
                  }
                  size={18}
                />
                <strong>{title}</strong>
                {page === "home" && (
                  <>
                    <span className="topbar-divider" />
                    <span className="topbar-subtitle">
                      {t("Your world, a little closer.")}
                    </span>
                  </>
                )}
                {page === "server" && (
                  <>
                    <span className="topbar-divider" />
                    <span className="topbar-subtitle">
                      {t("A place for the everyday conversations.")}
                    </span>
                  </>
                )}
              </div>
              <div className="topbar-actions">
                <span className="topbar-online">
                  <i className="online-dot" />
                  {t("All caught up with your world")}
                </span>
                <IconButton
                  name="Search"
                  label={t("Search Noctis")}
                  onClick={() => setModal({ type: "search" })}
                />
                <button
                  className="icon-button notification-button"
                  aria-label={t("{count} unread notifications", {
                    count: unread,
                  })}
                  title={t("Notifications")}
                  onClick={() => setModal({ type: "notifications" })}
                >
                  <Icon name="Bell" />
                  {unread > 0 && <i />}
                </button>
                <span className="topbar-divider" />
                <IconButton
                  name="PanelRight"
                  label={t("View members and friends")}
                  onClick={() => setModal({ type: "members" })}
                />
              </div>
            </header>
            {storageError && (
              <div className="inline-banner error" role="alert">
                {t(
                  "Browser storage is full. Changes will last for this session. Remove a large attachment or allow browser storage.",
                )}
              </div>
            )}
            {offline && (
              <div className="inline-banner">
                <Icon name="WifiOff" size={14} />
                {t(
                  "You're offline. Your local conversations and drafts are still available.",
                )}
              </div>
            )}
            <div className="app-view">
              {page !== "voice" && (
                <main
                  id="main-content"
                  tabIndex={-1}
                  className={`workspace ${["server", "messages"].includes(page) ? "fixed-workspace" : ""}`}
                  key={page}
                >
                  {content}
                </main>
              )}
              <Voice
                serverId={page === "voice" ? parts[1] : voiceTarget?.serverId}
                channelSlug={
                  page === "voice"
                    ? parts[2] || "lounge"
                    : voiceTarget?.channelSlug
                }
                visible={page === "voice"}
              />
            </div>
          </div>
          {mobileNav && (
            <Dialog
              title={t("Your spaces")}
              onClose={() => setMobileNav(false)}
              className="mobile-nav-dialog"
            >
              <div
                className="mobile-navigation"
                onClickCapture={(e) => {
                  if ((e.target as HTMLElement).closest("a"))
                    setMobileNav(false);
                }}
              >
                {nav}
              </div>
            </Dialog>
          )}
        </div>
      )}
      {modal && (
        <ModalContent
          key={`${modal.type}:${modal.id || ""}`}
          modal={modal}
          close={() => setModal(null)}
        />
      )}
      <Toast value={toastValue} close={closeToast} />
    </UIContext.Provider>
  );
}

