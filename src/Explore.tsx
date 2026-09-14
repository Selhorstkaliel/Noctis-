import { useState, useEffect } from "react";
import {
  Avatar,
  AvatarStack,
  Badge,
  Button,
  EmptyState,
  Icon,
  PageHeading,
  Progress,
  SearchInput,
  useUI,
} from "./components";
import { formatNumber, integrations, users } from "./data";
import { api } from "./api";
import { getUser } from "./data";
import { MissionCard, ServerCard } from "./Home";
import { navigate, updateStore, useStore } from "./store";
import { useI18n } from "./i18n";

export function Missions() {
  const store = useStore();
  const { open } = useUI();
  const { t } = useI18n();
  const [tab, setTab] = useState("My missions");
  const [query, setQuery] = useState("");
  const filtered = store.missions.filter(
    (m) =>
      (tab === "Explore missions"
        ? !m.claimed
        : tab === "Completed"
          ? m.claimed
          : m.joined && !m.claimed) &&
      `${m.title} ${m.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="page-content standard-page">
      <PageHeading
        eyebrow={t("MAKE YOUR MOMENTS COUNT")}
        title={t("A little purpose. A lot of possibility.")}
        description={t(
          "Learn something, make something, or bring your community a little closer.",
        )}
        action={
          <Button
            variant="primary"
            icon="Plus"
            onClick={() => open({ type: "create-mission" })}
          >
            {t("Create mission")}
          </Button>
        }
      />
      <div className="mission-overview">
        <div className="mission-overview-intro">
          <span className="large-mission-icon">
            <Icon name="Orbit" size={47} />
          </span>
          <div>
            <Badge tone="violet">{t("YOUR NEXT CHAPTER")}</Badge>
            <h2>{t("Good things happen when you show up.")}</h2>
            <p>
              {t(
                "One small step at a time. Your next achievement is closer than you think.",
              )}
            </p>
          </div>
        </div>
        <div className="mission-stats">
          <div>
            <strong>
              {store.missions
                .filter((m) => m.joined && !m.claimed)
                .length.toString()
                .padStart(2, "0")}
            </strong>
            <span>{t("In progress")}</span>
          </div>
          <div>
            <strong>
              {store.missions
                .filter((m) => m.claimed)
                .length.toString()
                .padStart(2, "0")}
            </strong>
            <span>{t("Completed")}</span>
          </div>
          <div>
            <strong>{formatNumber(store.profile.xp)}</strong>
            <span>{t("Total XP")}</span>
          </div>
        </div>
      </div>
      <div className="filter-toolbar">
        <div className="tabs">
          {["My missions", "Explore missions", "Completed"].map((tabLabel) => (
            <button
              key={tabLabel}
              className={tab === tabLabel ? "active" : ""}
              onClick={() => setTab(tabLabel)}
            >
              {t(tabLabel)}
              {tabLabel === "My missions" && (
                <span className="count-badge">
                  {store.missions.filter((m) => m.joined && !m.claimed).length}
                </span>
              )}
            </button>
          ))}
        </div>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t("Find a mission")}
          label={t("Find a mission")}
        />
      </div>
      <div className="mission-grid full-mission-grid">
        {filtered.map((m) => (
          <MissionCard key={m.id} mission={m} />
        ))}
      </div>
      {!filtered.length && (
        <EmptyState
          icon="Flag"
          title={t(
            query
              ? "No missions found"
              : tab === "Completed"
                ? "Your first achievement is waiting"
                : "You're all caught up",
          )}
          description={t(
            query
              ? "Try a different phrase or clear your search."
              : "Explore a challenge and start your next chapter.",
          )}
          action={
            <Button
              onClick={() => {
                setQuery("");
                setTab("Explore missions");
              }}
            >
              {t("Explore missions")}
            </Button>
          }
        />
      )}
      <div className="missions-bottom-note">
        <Icon name="ShieldCheck" size={18} />
        <span>
          {t("Progress at your own pace. Every contribution matters.")}
        </span>
        <a className="subtle-link" href="#/leaderboard">
          {t("Meet the community leaders")}
          <Icon name="ArrowRight" size={14} />
        </a>
      </div>
    </div>
  );
}

export function MissionDetail({ id }: { id: string }) {
  const store = useStore();
  const mission = store.missions.find((m) => m.id === id);
  const { toast } = useUI();
  if (!mission)
    return (
      <EmptyState
        icon="Flag"
        title="Mission not found"
        description="This mission may have moved. Find your next challenge."
        action={
          <Button onClick={() => navigate("missions")}>Back to missions</Button>
        }
      />
    );
  const completed = mission.objectives.filter((o) => o.done).length;
  const ready = completed === mission.objectives.length;
  const server = store.servers.find((s) => s.id === mission.server);
  const claim = async () => {
    await updateStore((s) => {
      const current = s.missions.find((m) => m.id === id);
      if (
        !current ||
        current.claimed ||
        !current.objectives.every((o) => o.done)
      )
        return s;
      return {
        ...s,
        profile: { ...s.profile, xp: s.profile.xp + current.xp },
        missions: s.missions.map((m) =>
          m.id === id ? { ...m, claimed: true, due: "Completed" } : m,
        ),
      };
    });
    toast(`Mission completed. ${mission.xp} XP added to your profile.`);
  };
  return (
    <div className="page-content standard-page mission-detail">
      <a className="back-link" href="#/missions">
        <Icon name="ArrowLeft" size={15} />
        All missions
      </a>
      <div className={`mission-detail-banner ${mission.color}`}>
        <span className="mission-detail-orbit">
          <Icon name={mission.icon} size={100} />
        </span>
        <Badge tone={mission.color}>{mission.category}</Badge>
        <h1>{mission.title}</h1>
        <div>
          <span className="mini-server-mark" style={{ color: server?.color }}>
            {server?.mark}
          </span>
          {server?.name}
          <span className="dot-separator">·</span>
          <Icon name="Clock3" size={14} />
          {mission.due}
        </div>
      </div>
      <div className="detail-columns">
        <div>
          <section className="detail-section">
            <h2>A little about this mission</h2>
            <p>{mission.description}</p>
            <p>
              There’s no perfect way to contribute. Bring your perspective, be
              generous with your feedback, and enjoy the process.
            </p>
          </section>
          <section className="detail-section">
            <div className="section-heading">
              <h2>Your objectives</h2>
              <Badge tone={ready ? "mint" : "neutral"}>
                {completed} / {mission.objectives.length} complete
              </Badge>
            </div>
            <Progress
              value={(completed / mission.objectives.length) * 100}
              label="Mission completion"
            />
            <p className="field-hint">
              Complete these in your community, then check them off here.
            </p>
            <div className="objectives">
              {mission.objectives.map((o, i) => (
                <label className={`objective ${o.done ? "done" : ""}`} key={i}>
                  <input
                    type="checkbox"
                    checked={o.done}
                    disabled={!mission.joined || mission.claimed}
                    onChange={async () =>
                      await updateStore((s) => ({
                        ...s,
                        missions: s.missions.map((m) =>
                          m.id === id
                            ? {
                                ...m,
                                objectives: m.objectives.map((obj, j) =>
                                  j === i ? { ...obj, done: !obj.done } : obj,
                                ),
                              }
                            : m,
                        ),
                      }))
                    }
                  />
                  <span className="objective-check">
                    <Icon name={o.done ? "Check" : "Circle"} size={16} />
                  </span>
                  <span>{o.text}</span>
                  {o.done && <small>Complete</small>}
                </label>
              ))}
            </div>
          </section>
          <section className="detail-section">
            <h2>In good company</h2>
            <div className="mission-participants">
              <AvatarStack
                ids={mission.memberIds || []}
                total={mission.people}
                size={31}
              />
              <span>
                <strong>
                  {mission.people} {mission.people === 1 ? "member" : "members"}
                </strong>{" "}
                {mission.people === 1 ? "is" : "are"} taking on this mission.
              </span>
            </div>
            <Button
              variant="ghost"
              icon="Hash"
              onClick={() => navigate(`server/${mission.server}/general`)}
            >
              Meet them in the conversation
              <Icon name="ArrowUpRight" size={14} />
            </Button>
          </section>
        </div>
        <aside>
          <div
            className={`reward-card ${mission.claimed ? "reward-claimed" : ""}`}
          >
            <span className="reward-orbit">
              <Icon name={mission.claimed ? "BadgeCheck" : "Award"} size={45} />
            </span>
            <span className="eyebrow">A LITTLE SOMETHING, EARNED</span>
            <h2>{mission.claimed ? "You made it happen." : "Your rewards"}</h2>
            <div className="reward-xp">
              <Icon name="Zap" size={22} />
              <strong>{mission.xp}</strong>
              <span>XP</span>
            </div>
            <div className="reward-badge">
              <Icon name={mission.icon} size={21} />
              <div>
                <strong>{mission.badge}</strong>
                <span>Profile badge</span>
              </div>
            </div>
            <p>
              {mission.claimed
                ? "Your XP and badge are now on your profile. Keep that momentum going."
                : "Complete every objective to claim your XP and a badge that tells your story."}
            </p>
            <Button
              variant="primary"
              className="full-width"
              disabled={mission.claimed || (mission.joined && !ready)}
              icon={
                mission.claimed ? "Check" : mission.joined ? "Gift" : "Flag"
              }
              onClick={async () =>
                mission.joined
                  ? claim()
                  : (await updateStore((s) => ({
                      ...s,
                      missions: s.missions.map((m) =>
                        m.id === id && !m.joined
                          ? { ...m, joined: true, people: m.people + 1 }
                          : m,
                      ),
                    })),
                    toast("Mission joined. Make it yours."))
              }
            >
              {mission.claimed
                ? "Rewards claimed"
                : !mission.joined
                  ? "Join mission"
                  : ready
                    ? "Claim rewards"
                    : "Complete the objectives"}
            </Button>
          </div>
          <div className="mission-help">
            <Icon name="CircleHelp" size={18} />
            <p>
              A question along the way?
              <button
                onClick={() => navigate(`server/${mission.server}/general`)}
              >
                Ask your community
                <Icon name="ArrowUpRight" size={12} />
              </button>
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

export function Leaderboard() {
  const store = useStore();
  const [period, setPeriod] = useState("All time");
  const { open } = useUI();
  const [serverId, setServerId] = useState(
    store.servers.find((s) => s.joined)?.id || "",
  );
  const [rows, setRows] = useState<
    { userId: string; xp: number; badges: number }[]
  >([]);
  useEffect(() => {
    if (!serverId) return;
    const controller = new AbortController();
    api(
      "/servers/" +
        serverId +
        "/leaderboard?period=" +
        (period === "This week" ? "week" : "all"),
      "GET",
      undefined,
      controller.signal,
    )
      .then(setRows)
      .catch(() => {});
    return () => controller.abort();
  }, [serverId, period, store.profile.xp]);
  const sorted = rows.map((row) => ({
    ...getUser(row.userId),
    xp: row.xp,
    badges: row.badges,
    role: store.roles[serverId + ":" + row.userId] || "Member",
  }));
  return (
    <div className="page-content standard-page">
      <PageHeading
        eyebrow="THE PEOPLE WHO MAKE IT HAPPEN"
        title="A little recognition, well earned."
        description="Celebrating the people who bring our community to life."
        action={
          <Button icon="Target" onClick={() => navigate("missions")}>
            Find your next mission
          </Button>
        }
      />
      <div className="leaderboard-podium">
        {[sorted[1], sorted[0], sorted[2]].filter(Boolean).map((u, i) => (
          <button
            className={`podium-card rank-${i === 1 ? 1 : i === 0 ? 2 : 3}`}
            key={u.id}
            onClick={() => open({ type: "profile", id: u.id })}
          >
            {i === 1 && <Icon name="Crown" size={25} className="crown" />}
            <Avatar user={u.id} size={72} status={false} />
            <span className="podium-number">
              {i === 1 ? 1 : i === 0 ? 2 : 3}
            </span>
            <h3>{u.name}</h3>
            <span>{u.role} · Studio Collective</span>
            <strong>
              {formatNumber(
                period === "This week" ? Math.round(u.xp * 0.22) : u.xp,
              )}{" "}
              <small>XP</small>
            </strong>
          </button>
        ))}
      </div>
      <div className="filter-toolbar">
        <h2>Community leaderboard</h2>
        <select
          aria-label="Leaderboard community"
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
        <div className="tabs">
          {["All time", "This week"].map((t) => (
            <button
              key={t}
              className={t === period ? "active" : ""}
              onClick={() => setPeriod(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="leaderboard-table-wrap">
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Member</th>
              <th scope="col">Role</th>
              <th scope="col">Badges</th>
              <th scope="col">
                {period === "This week" ? "Weekly XP" : "Total XP"}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((user, i) => (
              <tr
                key={user.id}
                className={user.id === store.profile.id ? "current-user" : ""}
              >
                <td>
                  <span className="table-rank">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </td>
                <td>
                  <button
                    className="table-user"
                    onClick={() => open({ type: "profile", id: user.id })}
                  >
                    <Avatar user={user.id} size={33} />
                    <strong>{user.name}</strong>
                    {user.id === store.profile.id && <Badge>You</Badge>}
                  </button>
                </td>
                <td>
                  <Badge tone={user.role === "Owner" ? "violet" : "neutral"}>
                    {store.roles[user.id] || user.role}
                  </Badge>
                </td>
                <td>
                  <div className="table-badges">
                    <Icon name="Award" size={17} />
                    <span>{user.badges}</span>
                  </div>
                </td>
                <td>
                  <strong>{formatNumber(user.xp)}</strong>
                  <span className="muted"> XP</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Discover() {
  const store = useStore();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All communities");
  const filtered = store.servers.filter(
    (s) =>
      (category === "All communities" || s.category === category) &&
      `${s.name} ${s.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="page-content standard-page">
      <div className="discovery-hero">
        <img src="/images/night.jpg" alt="A star-filled night sky" />
        <div />
        <span className="eyebrow">A WORLD OF GOOD COMPANY</span>
        <h1>Your people are out there.</h1>
        <p>Find a corner of the internet that feels like you.</p>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="What are you into?"
          label="Search communities"
        />
      </div>
      <div className="category-filters">
        {[
          "All communities",
          "Design & creativity",
          "Gaming",
          "Music",
          "Technology",
          "Lifestyle",
        ].map((c) => (
          <button
            className={category === c ? "active" : ""}
            key={c}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="section-heading">
        <h2>
          {query
            ? `Results for “${query}”`
            : category === "All communities"
              ? "Spaces you might call home"
              : category}
        </h2>
        <span className="muted">{filtered.length} communities</span>
      </div>
      <div className="server-grid discovery-grid">
        {filtered.map((server) => (
          <ServerCard key={server.id} server={server} discover />
        ))}
      </div>
      {!filtered.length && (
        <EmptyState
          title="No communities found"
          description="Try another interest or explore all communities."
          action={
            <Button
              onClick={() => {
                setQuery("");
                setCategory("All communities");
              }}
            >
              Explore all communities
            </Button>
          }
        />
      )}
      <div className="discovery-footer">
        <Icon name="Orbit" size={30} />
        <div>
          <h3>Haven’t found your space? Make it.</h3>
          <p>Start a community around something you love.</p>
        </div>
        <CreateServerButton />
      </div>
    </div>
  );
}
function CreateServerButton() {
  const { open } = useUI();
  return (
    <Button icon="Plus" onClick={() => open({ type: "create-server" })}>
      Create a server
    </Button>
  );
}

export function Events() {
  const store = useStore();
  const { open } = useUI();
  const [tab, setTab] = useState("Upcoming");
  const filtered = store.events.filter((e) => tab !== "Going" || e.rsvp);
  return (
    <div className="page-content standard-page">
      <PageHeading
        eyebrow="SOMETHING TO LOOK FORWARD TO"
        title="Make time for your people."
        description="Shared moments. Good conversations. Put something good on the calendar."
        action={
          <Button
            icon="Plus"
            variant="primary"
            onClick={() => open({ type: "create-event" })}
          >
            Schedule an event
          </Button>
        }
      />
      <div className="filter-toolbar">
        <div className="tabs">
          {["Upcoming", "Going"].map((t) => (
            <button
              key={t}
              className={tab === t ? "active" : ""}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <span className="muted">Upcoming events · Your local time</span>
      </div>
      <div className="events-grid">
        {filtered.map((event) => (
          <article className="event-card" key={event.id}>
            <div className={`event-art event-art-${event.server}`}>
              <Icon name={event.icon} size={70} />
              <span className="date-block">
                <small>{event.month}</small>
                <strong>{event.day}</strong>
              </span>
              {event.rsvp && (
                <Badge tone="mint" icon="Check">
                  You’re going
                </Badge>
              )}
            </div>
            <div className="event-card-body">
              <span className="eyebrow">
                {store.servers.find((s) => s.id === event.server)?.name}
              </span>
              <h2>{event.title}</h2>
              <span className="event-time">
                <Icon name="Clock3" size={14} />
                {event.time}
              </span>
              <p>{event.description}</p>
              <div className="event-card-foot">
                <AvatarStack
                  ids={event.memberIds || []}
                  total={event.attendees + (event.rsvp ? 1 : 0)}
                />
                <Button onClick={() => open({ type: "event", id: event.id })}>
                  View event
                  <Icon name="ArrowUpRight" size={14} />
                </Button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {!filtered.length && (
        <EmptyState
          icon="CalendarDays"
          title="Your calendar has room for something good"
          description="Find an upcoming event and let your people know you’re coming."
          action={
            <Button onClick={() => setTab("Upcoming")}>Explore events</Button>
          }
        />
      )}
    </div>
  );
}

export function Integrations() {
  const store = useStore();
  const { open } = useUI();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("All integrations");
  const list = integrations.filter(
    (i) =>
      (tab !== "Connected" || store.connected.includes(i.id)) &&
      `${i.name} ${i.category}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="page-content standard-page">
      <PageHeading
        eyebrow="BETTER, CONNECTED"
        title="Your favorite things. In good company."
        description="Bring the tools, music, and moments you love into your community."
      />
      <div className="integration-feature">
        <span className="integration-orbits">
          <Icon name="Blocks" size={55} />
        </span>
        <div>
          <Badge tone="violet">A MORE CONNECTED SPACE</Badge>
          <h2>A little more of your world.</h2>
          <p>
            Keep projects moving, share what’s playing, and bring everyone
            together.
          </p>
        </div>
        <span className="integration-feature-icons">
          <Icon name="Github" size={26} />
          <Icon name="Music2" size={26} />
          <Icon name="Twitch" size={26} />
        </span>
      </div>
      <div className="filter-toolbar">
        <div className="tabs">
          {["All integrations", "Connected"].map((t) => (
            <button
              key={t}
              className={tab === t ? "active" : ""}
              onClick={() => setTab(t)}
            >
              {t}
              {t === "Connected" && (
                <span className="count-badge">{store.connected.length}</span>
              )}
            </button>
          ))}
        </div>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Find an integration"
          label="Find an integration"
        />
      </div>
      <div className="integration-grid">
        {list.map((integration) => (
          <article key={integration.id} className="integration-card">
            <div className="integration-card-top">
              <span
                className="integration-logo"
                style={{ color: integration.color }}
              >
                <Icon name={integration.icon} size={27} />
              </span>
              {store.connected.includes(integration.id) ? (
                <Badge tone="mint" icon="Check">
                  Connected
                </Badge>
              ) : (
                <Badge>{integration.category}</Badge>
              )}
            </div>
            <h3>{integration.name}</h3>
            <p>{integration.description}</p>
            <button
              className="integration-action"
              onClick={() => open({ type: "integration", id: integration.id })}
            >
              {store.connected.includes(integration.id)
                ? "Manage integration"
                : "Explore integration"}
              <Icon name="ArrowUpRight" size={15} />
            </button>
          </article>
        ))}
      </div>
      {!list.length && (
        <EmptyState
          icon="Blocks"
          title="No integrations found"
          description="Try another name or explore all integrations."
          action={
            <Button
              onClick={() => {
                setTab("All integrations");
                setQuery("");
              }}
            >
              Explore integrations
            </Button>
          }
        />
      )}
      <div className="integration-note">
        <Icon name="Info" size={16} />
        <span>
          Connect a provider to see your real activity here. Providers must be
          enabled by your administrator.
        </span>
      </div>
    </div>
  );
}
