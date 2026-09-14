import { useEffect, useMemo, useState } from "react";
import { api, onLive } from "./api";
import { Badge, Button, Icon, IconButton, useUI } from "./components";
import { getUser } from "./data";
import {
  loadMusic,
  loadMusicQueue,
  musicAction,
  playMusic,
  type MusicQueuePage,
  type MusicSession,
  type MusicSettings,
} from "./music";
import { useStore } from "./store";
import { ProviderPlayback } from "./ProviderPlayback";
import { useI18n } from "./i18n";

const formatTime = (seconds: number | null | undefined) => {
  if (seconds === null || seconds === undefined) return "--:--";
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
};

export function MusicPlayForm({
  serverId,
  afterPlay,
}: {
  serverId: string;
  afterPlay?: () => void;
}) {
  const { toast } = useUI();
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="music-play-form"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        if (!input.trim() || busy) return;
        setBusy(true);
        setError("");
        try {
          const result = await playMusic(serverId, input.trim());
          const first = result.added[0];
          toast(
            result.added.length > 1
              ? t("{count} tracks added to the queue", {
                  count: result.added.length,
                })
              : t("{title} added to the queue", { title: first.title }),
          );
          setInput("");
          afterPlay?.();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor={`music-input-${serverId}`}>
        {t("Type a song name or paste a music link")}
      </label>
      <div>
        <Icon name="Search" size={16} />
        <input
          id={`music-input-${serverId}`}
          value={input}
          maxLength={2048}
          autoComplete="off"
          placeholder={t("Song, artist, or licensed audio URL")}
          onChange={(event) => setInput(event.target.value)}
        />
        <Button
          variant="primary"
          type="submit"
          disabled={!input.trim() || busy}
        >
          {t(busy ? "Finding…" : "Add to queue")}
        </Button>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <small>
        {t(
          "YouTube, Spotify, and SoundCloud use their official players. Licensed direct audio plays through the room bot.",
        )}
      </small>
    </form>
  );
}

export function MusicPlayer({
  serverId,
  channelId,
  view = "full",
}: {
  serverId: string;
  channelId?: string;
  view?: "full" | "participant" | "chat";
}) {
  const store = useStore();
  const { t } = useI18n();
  const { open, toast } = useUI();
  const server = store.servers.find((item) => item.id === serverId);
  const [session, setSession] = useState<MusicSession>();
  const [queue, setQueue] = useState<MusicQueuePage>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [volume, setVolume] = useState(50);
  const [settings, setSettings] = useState<MusicSettings>();
  const refresh = async () => {
    try {
      const [next, list, preferences] = await Promise.all([
        loadMusic(serverId),
        loadMusicQueue(serverId),
        api<MusicSettings>(`/servers/${serverId}/music/settings`),
      ]);
      setSession(next);
      setQueue(list);
      setVolume(next.volume);
      setSettings(preferences);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void refresh();
    const off = onLive((frame) => {
      if (frame.type.startsWith("music:") && frame.serverId === serverId)
        void refresh();
    });
    const local = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.serverId === serverId) void refresh();
    };
    window.addEventListener("noctis-music-changed", local);
    const sync = setInterval(() => void refresh(), 15000);
    return () => {
      off();
      window.removeEventListener("noctis-music-changed", local);
      clearInterval(sync);
    };
  }, [serverId]);
  useEffect(() => {
    if (session?.playbackState !== "PLAYING") return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [session?.playbackState]);
  const position = useMemo(() => {
    if (!session) return 0;
    if (session.playbackState !== "PLAYING" || !session.startedAt)
      return session.position;
    return (
      session.position +
      Math.max(0, (clock - new Date(session.startedAt).getTime()) / 1000)
    );
  }, [session, clock]);
  const duration = session?.currentTrack?.duration;
  const progress = duration ? Math.min(100, (position / duration) * 100) : 0;
  const can = (permission: string) =>
    !!server?.permissions?.includes(permission) ||
    (permission === "MUSIC_SKIP" && !!settings?.allowMemberSkip) ||
    (permission === "MUSIC_VOLUME" && !!settings?.allowMemberVolume);
  const act = async (
    action: string,
    body: Record<string, unknown> = {},
    message?: string,
  ) => {
    setBusy(action);
    setError("");
    try {
      setSession(await musicAction(serverId, action, body));
      await refresh();
      if (message) toast(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const current = session?.currentTrack;
  const official = current?.playbackMode === "embed";
  const providerOwnsVolume = official && current?.provider === "spotify";
  const idle = !current;
  const channelMismatch = !!(
    channelId &&
    session?.voiceChannelId &&
    channelId !== session.voiceChannelId
  );
  const finish = () => {
    if (!current) return;
    void musicAction(serverId, "ended", { trackId: current.id }).catch(
      () => {},
    );
  };
  const timeline = (
    <div
      className="music-timeline"
      aria-label={t("Playback position {time}", { time: formatTime(position) })}
    >
      <div className="music-progress">
        <span style={{ width: `${progress}%` }} />
      </div>
      <div>
        <time>{formatTime(position)}</time>
        <time>{formatTime(duration)}</time>
      </div>
    </div>
  );
  const transport = (
    <div className="music-transport">
      <IconButton
        name="Repeat2"
        label={t("Repeat {mode}", {
          mode: session?.repeatMode?.toLowerCase() || "off",
        })}
        className={session?.repeatMode !== "OFF" ? "active" : ""}
        disabled={!can("MUSIC_QUEUE_MANAGE") || !!busy}
        onClick={() => void act("repeat")}
      />
      <IconButton
        name={session?.playbackState === "PAUSED" ? "Play" : "Pause"}
        label={t(session?.playbackState === "PAUSED" ? "Resume" : "Pause")}
        disabled={!current || !can("MUSIC_PAUSE") || !!busy}
        onClick={() =>
          void act(session?.playbackState === "PAUSED" ? "resume" : "pause")
        }
      />
      <IconButton
        name="SkipForward"
        label={t("Skip track")}
        disabled={!current || !can("MUSIC_SKIP") || !!busy}
        onClick={() => void act("skip", {}, t("Skipped to the next track"))}
      />
      <IconButton
        name="Trash2"
        label={t("Stop and clear queue")}
        className="danger"
        disabled={!current || !can("MUSIC_STOP") || !!busy}
        onClick={() => void act("stop", {}, t("Noctis Music stopped"))}
      />
    </div>
  );
  const volumeControl = (
    <label className="music-volume">
      <Icon name="Volume2" size={16} />
      <input
        type="range"
        min="0"
        max="100"
        value={volume}
        disabled={providerOwnsVolume || !can("MUSIC_VOLUME") || !!busy}
        aria-label={
          providerOwnsVolume
            ? t("Spotify volume is controlled in its player")
            : t("Music Bot volume")
        }
        title={
          providerOwnsVolume
            ? t("Spotify controls listening volume in its official player")
            : undefined
        }
        onChange={(event) => setVolume(Number(event.target.value))}
        onPointerUp={() =>
          void act(
            "volume",
            { volume },
            t("Music volume set to {volume}%", { volume }),
          )
        }
        onKeyUp={(event) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            void act("volume", { volume });
        }}
      />
      <output>{providerOwnsVolume ? t("Player") : `${volume}%`}</output>
    </label>
  );
  if (view === "participant")
    return (
      <article
        className={`participant-tile music-participant ${session?.playbackState === "PLAYING" ? "playing" : ""}`}
        aria-label={t("Noctis Music participant")}
      >
        <div className="music-participant-media">
          {official && current && session ? (
            <ProviderPlayback
              track={current}
              playbackState={session.playbackState}
              position={position}
              revision={session.revision}
              volume={volume}
              onEnded={finish}
              variant="tile"
            />
          ) : current?.thumbnail?.startsWith("/") ? (
            <img src={current.thumbnail} alt="" />
          ) : (
            <span className="music-participant-mark">
              <Icon name={idle ? "Music2" : "AudioLines"} size={38} />
            </span>
          )}
        </div>
        <div className="music-participant-shade" />
        <div className="participant-label music-participant-label">
          <strong>
            Noctis Music <small>BOT</small>
          </strong>
          <span>
            <Icon
              name={
                session?.playbackState === "PLAYING" ? "AudioLines" : "Music2"
              }
              size={15}
            />
            {current?.title || t("Ready")}
          </span>
        </div>
        {channelMismatch && (
          <span className="music-participant-note">
            {t("Another voice room")}
          </span>
        )}
        {error && (
          <span className="music-participant-note error" role="alert">
            {t("Player unavailable")}
          </span>
        )}
      </article>
    );
  if (view === "chat")
    return (
      <section
        className="music-chat-player"
        aria-label={t("Noctis Music controls")}
      >
        <div className="music-chat-identity">
          <span className={session?.playbackState === "PLAYING" ? "live" : ""}>
            <Icon name="Music2" size={18} />
          </span>
          <div>
            <small>NOCTIS MUSIC</small>
            <strong>{current?.title || t("The queue is ready")}</strong>
            <p>{current?.artist || t("Add a track for the voice room.")}</p>
          </div>
        </div>
        <div className="music-chat-progress">{timeline}</div>
        <div className="music-controls music-chat-controls">
          {transport}
          {volumeControl}
          <IconButton
            name="ListMusic"
            label={t("Open music queue")}
            onClick={() => open({ type: "music-player", id: serverId })}
          />
          <IconButton
            name="Plus"
            label={t("Add a track")}
            onClick={() => open({ type: "music-play", id: serverId })}
          />
        </div>
        <Badge tone={current ? "mint" : "neutral"}>
          {t(session?.playbackState || "READY")}
        </Badge>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  return (
    <section className="music-player" aria-label="Noctis Music">
      <div className="music-player-topline">
        <span>
          <Icon name="AudioLines" size={15} /> NOCTIS MUSIC
        </span>
        <Badge
          tone={
            session?.botConnected || (official && current) ? "mint" : "neutral"
          }
        >
          {t(
            official && current
              ? "OFFICIAL STREAM"
              : session?.botConnected
                ? "LIVE"
                : idle
                  ? "READY"
                  : "CONNECTING",
          )}
        </Badge>
      </div>
      {channelMismatch && (
        <div className="music-room-note">
          <Icon name="Info" size={15} />{" "}
          {t("Music is playing in another voice room.")}
        </div>
      )}
      <div className="music-now-playing">
        <div className="music-cover">
          {current?.thumbnail?.startsWith("/") ? (
            <img src={current.thumbnail} alt="" />
          ) : (
            <Icon name={idle ? "Music2" : "AudioLines"} size={30} />
          )}
          {!idle && <span />}
        </div>
        <div className="music-track-copy">
          <small>{t(idle ? "QUEUE RESTING" : "NOW PLAYING")}</small>
          <h2>{current?.title || t("A quieter room")}</h2>
          <p>{current?.artist || t("Add a track when the moment is right.")}</p>
          {current && (
            <span>
              {current.provider.toUpperCase()} · {t("Requested by")}{" "}
              {getUser(current.requestedBy).name}
            </span>
          )}
        </div>
      </div>
      {current && session && (
        <ProviderPlayback
          track={current}
          playbackState={session.playbackState}
          position={position}
          revision={session.revision}
          volume={volume}
          onEnded={() => {
            void musicAction(serverId, "ended", { trackId: current.id }).catch(
              () => {},
            );
          }}
        />
      )}
      <div
        className="music-timeline"
        aria-label={t("Playback position {time}", {
          time: formatTime(position),
        })}
      >
        <div className="music-progress">
          <span style={{ width: `${progress}%` }} />
        </div>
        <div>
          <time>{formatTime(position)}</time>
          <time>{formatTime(duration)}</time>
        </div>
      </div>
      <div className="music-controls">
        <div>
          <IconButton
            name="Repeat2"
            label={t("Repeat {mode}", {
              mode: session?.repeatMode?.toLowerCase() || "off",
            })}
            className={session?.repeatMode !== "OFF" ? "active" : ""}
            disabled={!can("MUSIC_QUEUE_MANAGE") || !!busy}
            onClick={() => void act("repeat")}
          />
          <IconButton
            name={session?.playbackState === "PAUSED" ? "Play" : "Pause"}
            label={t(session?.playbackState === "PAUSED" ? "Resume" : "Pause")}
            disabled={!current || !can("MUSIC_PAUSE") || !!busy}
            onClick={() =>
              void act(session?.playbackState === "PAUSED" ? "resume" : "pause")
            }
          />
          <IconButton
            name="SkipForward"
            label={t("Skip track")}
            disabled={!current || !can("MUSIC_SKIP") || !!busy}
            onClick={() => void act("skip", {}, t("Skipped to the next track"))}
          />
          <IconButton
            name="Trash2"
            label={t("Stop and clear queue")}
            className="danger"
            disabled={!current || !can("MUSIC_STOP") || !!busy}
            onClick={() => void act("stop", {}, t("Noctis Music stopped"))}
          />
        </div>
        <label className="music-volume">
          <Icon name="Volume2" size={16} />
          <input
            type="range"
            min="0"
            max="100"
            value={volume}
            disabled={providerOwnsVolume || !can("MUSIC_VOLUME") || !!busy}
            aria-label={
              providerOwnsVolume
                ? t("Spotify volume is controlled in its player")
                : t("Music Bot volume")
            }
            title={
              providerOwnsVolume
                ? t("Spotify controls listening volume in its official player")
                : undefined
            }
            onChange={(event) => setVolume(Number(event.target.value))}
            onPointerUp={() =>
              void act(
                "volume",
                { volume },
                t("Music volume set to {volume}%", { volume }),
              )
            }
            onKeyUp={(event) => {
              if (
                ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                void act("volume", { volume });
            }}
          />
          <output>{providerOwnsVolume ? t("Player") : `${volume}%`}</output>
        </label>
      </div>
      {can("MUSIC_PLAY") && <MusicPlayForm serverId={serverId} />}
      <div className="music-queue-heading">
        <span>
          <Icon name="ListMusic" size={15} /> {t("Up next")}
        </span>
        <small>
          {t("{count} tracks", { count: queue?.total || 0 })} ·{" "}
          {formatTime(queue?.totalDuration)}
        </small>
      </div>
      <div className="music-queue" aria-live="polite">
        {queue?.items.length ? (
          queue.items.map((track, index) => (
            <div className="music-queue-row" key={track.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{track.title}</strong>
                <small>
                  {track.artist} · {formatTime(track.duration)} ·{" "}
                  {getUser(track.requestedBy).name}
                </small>
              </div>
              {can("MUSIC_QUEUE_MANAGE") && (
                <IconButton
                  name="X"
                  label={t("Remove {title}", { title: track.title })}
                  disabled={!!busy}
                  onClick={() => void act("remove", { index: index + 1 })}
                />
              )}
            </div>
          ))
        ) : (
          <p className="music-queue-empty">
            {t("The queue is open for the next track.")}
          </p>
        )}
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
