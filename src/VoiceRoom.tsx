import { useEffect, useRef, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  EmptyState,
  Icon,
  IconButton,
} from "./components";
import { getUser } from "./data";
import { onLive, sendLive } from "./api";
import { command, navigate, useStore } from "./store";
import type { NoctisCall, Streams } from "./voice-client";
import { MusicPlayer } from "./MusicPlayer";
import { useI18n } from "./i18n";
type Participant = {
  id: string;
  userId: string;
  muted: boolean;
  deafened: boolean;
  camera: boolean;
  screen: boolean;
  serverMuted: boolean;
  serverDeafened: boolean;
  canSpeak?: boolean;
  canStream?: boolean;
};
function Media({
  stream,
  muted = false,
  video = true,
  volume = 1,
}: {
  stream?: MediaStream;
  muted?: boolean;
  video?: boolean;
  volume?: number;
}) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream || null;
      ref.current.volume = Math.max(0, Math.min(1, volume));
      if (stream) void ref.current.play().catch(() => {});
    }
  }, [stream, volume]);
  return video ? (
    <video ref={ref} autoPlay playsInline muted={muted} />
  ) : (
    <audio ref={ref} autoPlay muted={muted} />
  );
}
function Tile({
  participant,
  streams,
  self,
  onModerate,
  speaking,
  volume,
  onVolume,
}: {
  participant: Participant;
  streams: Streams;
  self: boolean;
  onModerate?: () => void;
  speaking: boolean;
  volume?: number;
  onVolume?: (value: number) => void;
}) {
  return (
    <div
      className={`participant-tile ${speaking && !participant.muted ? "speaking" : ""}`}
    >
      {participant.camera && streams.camera ? (
        <Media stream={streams.camera} muted />
      ) : (
        <Avatar user={participant.userId} size={76} status={false} />
      )}
      <div className="participant-label">
        <strong>{self ? "You" : getUser(participant.userId).name}</strong>
        <span>
          <Icon
            name={
              participant.muted || participant.serverMuted ? "MicOff" : "Mic"
            }
            size={15}
          />
          {participant.deafened && <Icon name="HeadphoneOff" size={15} />}
        </span>
      </div>
      {onModerate && (
        <button className="voice-moderate" onClick={onModerate}>
          {participant.serverMuted ? "Unmute member" : "Mute member"}
        </button>
      )}
      {!self && onVolume && (
        <label className="participant-volume">
          <Icon name="Volume2" size={13} />
          <input
            type="range"
            min="0"
            max="100"
            value={volume ?? 100}
            aria-label={`Volume for ${getUser(participant.userId).name}`}
            onChange={(event) => onVolume(Number(event.target.value))}
          />
          <span>{volume ?? 100}%</span>
        </label>
      )}
    </div>
  );
}
function ScreenTile({
  participant,
  stream,
  self,
}: {
  participant: Participant;
  stream?: MediaStream;
  self: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const name = self ? "Your" : `${getUser(participant.userId).name}'s`;
  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [expanded]);
  return (
    <article
      className={`participant-tile screen-share-tile ${expanded ? "expanded" : ""}`}
      aria-label={`${name} shared screen`}
      role={expanded ? "dialog" : undefined}
      aria-modal={expanded ? true : undefined}
    >
      {stream ? (
        <Media stream={stream} muted={self} />
      ) : (
        <div className="screen-share-loading">
          <Icon name="Monitor" size={32} />
          <span>Connecting to streamÃ¢â‚¬Â¦</span>
        </div>
      )}
      <div className="screen-share-tile-bar">
        <span>
          <Icon name="Monitor" size={14} />
          <strong>{name} screen</strong>
          <Badge tone="mint">LIVE</Badge>
        </span>
        <IconButton
          name={expanded ? "Minimize2" : "Maximize2"}
          label={
            expanded
              ? "Return shared screen to the grid"
              : `View ${name.toLowerCase()} shared screen full size`
          }
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        />
      </div>
    </article>
  );
}
export function Voice({
  serverId,
  channelSlug = "lounge",
  visible: activeView = true,
}: {
  serverId?: string;
  channelSlug?: string;
  visible?: boolean;
}) {
  const store = useStore();
  const { t } = useI18n();
  const server = store.servers.find((s) => s.id === serverId);
  const channel = store.channels.find(
    (c) =>
      c.serverId === serverId && c.slug === channelSlug && c.kind === "voice",
  );
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [remote, setRemote] = useState<Record<string, Streams>>({});
  const [local, setLocal] = useState<Streams>({});
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(true);
  const [deafened, setDeafened] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [screenPrompt, setScreenPrompt] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const active = useRef(true);
  const connection = useRef("");
  const call = useRef<NoctisCall | undefined>(undefined);
  const [speakers, setSpeakers] = useState(new Set<string>());
  const [page, setPage] = useState(0);
  const [participantVolumes, setParticipantVolumes] = useState<
    Record<string, number>
  >({});
  const [noiseSuppression, setNoiseSuppression] = useState(() => {
    try {
      return localStorage.getItem("noctis-noise-suppression") !== "off";
    } catch {
      return true;
    }
  });
  const noiseSuppressionSupported = Boolean(
    navigator.mediaDevices?.getSupportedConstraints?.().noiseSuppression,
  );
  const generation = useRef(0);
  const streams = useRef<Streams>({});

  const state = useRef({
    muted: true,
    deafened: false,
    camera: false,
    screen: false,
  });
  const joinedRef = useRef(false);
  const participantRef = useRef<Participant[]>([]);
  const stopStream = (stream?: MediaStream) =>
    stream?.getTracks().forEach((t) => t.stop());
  const cleanup = () => {
    generation.current++;
    call.current?.close();
    call.current = undefined;
    Object.values(streams.current).forEach(stopStream);
    streams.current = {};
    joinedRef.current = false;
    state.current = {
      muted: true,
      deafened: false,
      camera: false,
      screen: false,
    };
    setMuted(true);
    setDeafened(false);
    setSpeakers(new Set());
  };
  const update = () => {
    if (joinedRef.current) sendLive({ type: "voice.state", ...state.current });
  };
  useEffect(() => {
    active.current = true;
    const off = onLive((frame) => {
      void (async () => {
        if (frame.type === "voice.joined" && frame.channelId === channel?.id) {
          connection.current = frame.connectionId;
          const attempt = ++generation.current;
          joinedRef.current = true;
          setBusy(true);
          setError("");
          setParticipants(frame.participants);
          participantRef.current = frame.participants;
          const { NoctisCall } = await import("./voice-client");
          if (!active.current || generation.current !== attempt) return;
          const media = new NoctisCall({
            remote: (id, key, stream) =>
              setRemote((old) => ({
                ...old,
                [id]: { ...old[id], [key]: stream },
              })),
            speaking: setSpeakers,
            disconnected: () => {
              if (call.current !== media || !active.current) return;
              cleanup();
              setJoined(false);
              setParticipants([]);
              setRemote({});
              setLocal({});
              setBusy(false);
              setError("The call ended. Join again to reconnect.");
              try {
                sendLive({ type: "voice.leave" });
              } catch {}
            },
          });
          call.current = media;
          try {
            await media.connect(frame.media.url, frame.media.token);
            if (generation.current !== attempt) {
              media.close();
              return;
            }
            media.setVisible(
              frame.participants.slice(0, 12).map((p: Participant) => p.id),
              frame.participants
                .filter((p: Participant) => p.screen)
                .map((p: Participant) => p.id),
            );
            setPage(0);
            setJoined(true);
          } catch {
            cleanup();
            setJoined(false);
            setParticipants([]);
            try {
              sendLive({ type: "voice.leave" });
            } catch {}
            setError(
              "The voice connection could not be established. Please try again.",
            );
          } finally {
            if (active.current) setBusy(false);
          }
        }
        if (frame.type === "voice.participants" && joinedRef.current) {
          const next = frame.participants as Participant[];
          participantRef.current = next;
          setParticipants(next);
          setRemote((old) =>
            Object.fromEntries(
              Object.entries(old).filter(
                ([id]) =>
                  id.startsWith("music:") || next.some((p) => p.id === id),
              ),
            ),
          );
          const self = next.find((p) => p.id === connection.current);
          if (self?.serverMuted || self?.canSpeak === false) {
            state.current.muted = true;
            setMuted(true);
            void call.current?.muteAudio(true);
            streams.current.audio?.getAudioTracks().forEach((t) => {
              t.enabled = false;
            });
          }
          if (self?.serverDeafened) {
            state.current.deafened = true;
            setDeafened(true);
          }
          if (self?.canStream === false) {
            for (const key of ["camera", "screen"] as const) {
              for (const track of streams.current[key]?.getTracks() || [])
                void call.current?.unpublish(track);
              stopStream(streams.current[key]);
              delete streams.current[key];
              state.current[key] = false;
            }
            setLocal({ ...streams.current });
          }
        }
        if (
          frame.type === "voice.left" ||
          frame.type === "disconnected" ||
          (frame.type === "revoked" &&
            (frame.topic === `channel:${channel?.id}` ||
              frame.topic === `server:${serverId}`))
        ) {
          cleanup();
          setJoined(false);
          setBusy(false);
          setParticipants([]);
          setRemote({});
          setLocal({});
          state.current = {
            muted: true,
            deafened: false,
            camera: false,
            screen: false,
          };
          setMuted(true);
          setDeafened(false);
        }
        if (frame.type === "voice.move") {
          const next = store.channels.find((c) => c.id === frame.channelId);
          if (next) navigate(`voice/${next.serverId}/${next.slug}`);
        }
        if (frame.type === "error") {
          setError(frame.message);
          setBusy(false);
        }
      })().catch((e) => setError((e as Error).message));
    });
    return () => {
      active.current = false;
      off();
      if (joinedRef.current)
        try {
          sendLive({ type: "voice.leave" });
        } catch {}
      cleanup();
    };
  }, [channel?.id]);
  useEffect(() => {
    if (!joined) return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [joined]);
  const capture = async (
    key: "audio" | "camera" | "screen",
    shareAudio = false,
  ) => {
    if (!joined) return;
    setBusy(true);
    setError("");
    try {
      if (streams.current[key] && key !== "audio") {
        for (const track of streams.current[key]!.getTracks())
          await call.current?.unpublish(track);
        stopStream(streams.current[key]);
        delete streams.current[key];
        state.current[key] = false;

        setLocal({ ...streams.current });
        update();
        return;
      }
      if (key === "audio" && streams.current.audio) {
        state.current.muted = !state.current.muted;
        await call.current?.muteAudio(state.current.muted);
        streams.current.audio.getAudioTracks().forEach((t) => {
          t.enabled = !state.current.muted;
        });
        setMuted(state.current.muted);
        update();
        return;
      }
      const media =
        key === "screen"
          ? await navigator.mediaDevices.getDisplayMedia({
              video: true,
              audio: shareAudio,
            })
          : await navigator.mediaDevices.getUserMedia(
              key === "audio"
                ? {
                    audio: {
                      echoCancellation: true,
                      noiseSuppression,
                      autoGainControl: true,
                    },
                    video: false,
                  }
                : {
                    video: { width: { ideal: 1280 }, height: { ideal: 720 } },
                    audio: false,
                  },
            );
      if (!active.current || !joinedRef.current) {
        stopStream(media);
        return;
      }
      const track =
        key === "screen" ? media.getVideoTracks()[0] : media.getTracks()[0];
      if (!track) throw new Error("The selected source cannot be shared.");
      const displayAudio =
        key === "screen" ? media.getAudioTracks()[0] : undefined;
      try {
        if (!call.current) throw new Error("Rejoin the voice room.");
        await call.current.publish(key, track);
        if (displayAudio)
          await call.current.publish("screenAudio", displayAudio);
      } catch (error) {
        await call.current?.unpublish(track).catch(() => {});
        if (displayAudio)
          await call.current?.unpublish(displayAudio).catch(() => {});
        stopStream(media);
        throw error;
      }
      if (!active.current || !joinedRef.current) {
        stopStream(media);
        return;
      }
      streams.current[key] = media;
      if (key === "audio") {
        state.current.muted = false;
        setMuted(false);
      } else state.current[key] = true;
      setLocal({ ...streams.current });
      update();
      track.onended = () => {
        delete streams.current[key];
        if (key === "audio") {
          state.current.muted = true;
          setMuted(true);
        } else state.current[key] = false;
        for (const published of media.getTracks())
          void call.current?.unpublish(published);
        stopStream(media);
        setLocal({ ...streams.current });
        try {
          update();
        } catch {}
      };
      if (displayAudio)
        displayAudio.onended = () => {
          void call.current?.unpublish(displayAudio);
          media.removeTrack(displayAudio);
        };
      if (key === "screen" && shareAudio && !displayAudio)
        setError(
          t(
            "This source does not provide audio. The screen is being shared without sound.",
          ),
        );
    } catch (e) {
      setError(
        (e as Error).name === "NotAllowedError"
          ? "Media permission was declined. You can allow it in your browser and try again."
          : (e as Error).message,
      );
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const lastPage = Math.max(0, Math.ceil(participants.length / 12) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = participants.slice(currentPage * 12, currentPage * 12 + 12);
  useEffect(() => {
    call.current?.setVisible(
      visible.map((p) => p.id),
      visible.filter((p) => p.screen).map((p) => p.id),
    );
  }, [participants, currentPage, joined]);
  if (!server || !channel) {
    if (!activeView) return null;
    return (
      <main id="main-content" tabIndex={-1} className="workspace">
        <EmptyState
          icon="Headphones"
          title={t("This voice room is unavailable")}
          description={t(
            "Choose an accessible voice channel from your community.",
          )}
        />
      </main>
    );
  }
  const self = participants.find((p) => p.id === connection.current);
  const screenShares = visible.filter(
    (participant) =>
      participant.screen ||
      (participant.id === connection.current && Boolean(local.screen)),
  );
  const leave = (returnToChat: boolean) => {
    if (joinedRef.current)
      try {
        sendLive({ type: "voice.leave" });
      } catch {}
    cleanup();
    setJoined(false);
    setParticipants([]);
    setRemote({});
    setLocal({});
    if (returnToChat) navigate(`server/${serverId}/general`);
  };
  const audioOutput = (
    <div className="voice-audio" aria-hidden="true">
      {participants
        .filter((p) => p.id !== connection.current)
        .flatMap((p) => [
          <Media
            key={`${p.id}:microphone`}
            stream={remote[p.id]?.audio}
            video={false}
            muted={
              deafened || !!self?.serverDeafened || p.muted || p.serverMuted
            }
            volume={(participantVolumes[p.id] ?? 100) / 100}
          />,
          <Media
            key={`${p.id}:screen`}
            stream={remote[p.id]?.screenAudio}
            video={false}
            muted={deafened || !!self?.serverDeafened}
            volume={(participantVolumes[p.id] ?? 100) / 100}
          />,
        ])}
      <Media
        stream={remote[`music:${server.id}`]?.audio}
        video={false}
        muted={deafened || !!self?.serverDeafened}
      />
    </div>
  );
  const toggleNoiseSuppression = async () => {
    const next = !noiseSuppression;
    setError("");
    try {
      const track = streams.current.audio?.getAudioTracks()[0];
      if (track)
        await track.applyConstraints({
          echoCancellation: true,
          noiseSuppression: next,
          autoGainControl: true,
        });
      setNoiseSuppression(next);
      try {
        localStorage.setItem("noctis-noise-suppression", next ? "on" : "off");
      } catch {}
    } catch {
      setError("Your browser could not change noise suppression for this mic.");
    }
  };
  const voiceControls = (
    <div className="voice-controls">
      <IconButton
        name={muted ? "MicOff" : "Mic"}
        label={t(muted ? "Unmute microphone" : "Mute microphone")}
        disabled={
          !joined || busy || self?.serverMuted || self?.canSpeak === false
        }
        className={muted ? "muted" : ""}
        onClick={() => void capture("audio")}
      />
      <IconButton
        name={deafened ? "HeadphoneOff" : "Headphones"}
        label={t(deafened ? "Undeafen" : "Deafen")}
        disabled={!joined || self?.serverDeafened}
        onClick={() => {
          state.current.deafened = !deafened;
          setDeafened(!deafened);
          update();
        }}
      />
      <IconButton
        name={local.camera ? "VideoOff" : "Video"}
        label={t(local.camera ? "Turn camera off" : "Turn camera on")}
        disabled={!joined || busy || self?.canStream === false}
        onClick={() => void capture("camera")}
      />
      <IconButton
        name="ScreenShare"
        label={t(local.screen ? "Stop sharing screen" : "Share your screen")}
        disabled={!joined || busy || self?.canStream === false}
        onClick={() =>
          local.screen ? void capture("screen") : setScreenPrompt(true)
        }
      />
      <IconButton
        name="ShieldCheck"
        label={t(
          noiseSuppression
            ? "Turn noise suppression off"
            : "Turn noise suppression on",
        )}
        aria-pressed={noiseSuppression}
        className={noiseSuppression ? "active" : ""}
        disabled={!joined || busy || !noiseSuppressionSupported}
        onClick={() => void toggleNoiseSuppression()}
      />
      <IconButton
        name="PhoneOff"
        label={t("Leave voice room")}
        className="hang-up"
        onClick={() => leave(activeView)}
      />
    </div>
  );
  const voiceDock =
    !activeView && joined ? (
      <aside className="voice-dock" aria-label={t("Background call")}>
        <button
          className="voice-dock-summary"
          onClick={() => navigate(`voice/${server.id}/${channel.slug}`)}
          aria-label={t("Return to {name} voice room", { name: channel.name })}
        >
          <span className="voice-dock-signal">
            <Icon name="Signal" size={18} />
          </span>
          <span>
            <strong>{channel.name}</strong>
            <small>
              {server.name} Â· {participants.length}{" "}
              {t(participants.length === 1 ? "person" : "people")} Â·{" "}
              {String(Math.floor(seconds / 60)).padStart(2, "0")}:
              {String(seconds % 60).padStart(2, "0")}
            </small>
          </span>
        </button>
        {(local.camera || local.screen) && (
          <Badge tone="mint" icon={local.screen ? "Monitor" : "Video"}>
            {t(local.screen ? "Sharing" : "Camera on")}
          </Badge>
        )}
        {voiceControls}
      </aside>
    ) : null;
  return (
    <>
      {audioOutput}
      {screenPrompt && (
        <Dialog
          title={t("Share your screen")}
          className="screen-share-choice-dialog"
          closeLabel={t("Cancel screen sharing")}
          onClose={() => setScreenPrompt(false)}
        >
          <p>
            {t(
              "Choose whether people in the call should also hear audio from the shared source.",
            )}
          </p>
          <div className="screen-share-options">
            <button
              type="button"
              onClick={() => {
                setScreenPrompt(false);
                void capture("screen", true);
              }}
            >
              <Icon name="Volume2" size={22} />
              <span>
                <strong>{t("Share with sound")}</strong>
                <small>
                  {t("People will hear audio offered by the selected source.")}
                </small>
              </span>
              <Icon name="ArrowRight" size={16} />
            </button>
            <button
              type="button"
              onClick={() => {
                setScreenPrompt(false);
                void capture("screen", false);
              }}
            >
              <Icon name="VolumeX" size={22} />
              <span>
                <strong>{t("Share without sound")}</strong>
                <small>{t("Only the screen image will be shared.")}</small>
              </span>
              <Icon name="ArrowRight" size={16} />
            </button>
          </div>
          <p className="screen-share-audio-note">
            {t(
              "Audio availability depends on the browser and the window, tab, or screen you select next.",
            )}
          </p>
        </Dialog>
      )}
      {voiceDock}
      <main
        id={activeView ? "main-content" : undefined}
        tabIndex={activeView ? -1 : undefined}
        className={`${activeView ? "workspace" : "voice-background-workspace"} voice-page ${activeView ? "" : "voice-page-background"}`}
        aria-hidden={!activeView}
        inert={!activeView}
      >
        <div className="voice-page-heading">
          <div>
            <span className="eyebrow">
              {server.name.toUpperCase()} Â· {t("VOICE SPACE")}
            </span>
            <h1>
              {channel.name === "lounge" ? t("The Lounge") : channel.name}
            </h1>
            <p>
              {joined
                ? t("A little closer, even from here.")
                : t("Your people are one conversation away.")}
            </p>
          </div>
          <Badge tone={joined ? "mint" : "neutral"} icon="Radio">
            {t(joined ? "Connected" : "Ready to join")}
          </Badge>
        </div>
        {error && (
          <div className="inline-banner" role="alert">
            {error}
          </div>
        )}
        {joined ? (
          <div className="participant-grid">
            {visible.map((p) => (
              <Tile
                key={p.id}
                participant={p}
                speaking={speakers.has(p.id)}
                streams={
                  p.id === connection.current ? local : remote[p.id] || {}
                }
                self={p.id === connection.current}
                onModerate={
                  p.id !== connection.current &&
                  server.permissions?.includes("MUTE_MEMBERS")
                    ? () =>
                        void command(`/voice/${p.id}/moderation`, "PUT", {
                          muted: !p.serverMuted,
                        })
                    : undefined
                }
                volume={participantVolumes[p.id] ?? 100}
                onVolume={
                  p.id === connection.current
                    ? undefined
                    : (value) =>
                        setParticipantVolumes((current) => ({
                          ...current,
                          [p.id]: value,
                        }))
                }
              />
            ))}
            {screenShares.map((participant) => (
              <ScreenTile
                key={`screen:${participant.id}`}
                participant={participant}
                self={participant.id === connection.current}
                stream={
                  participant.id === connection.current
                    ? local.screen
                    : remote[participant.id]?.screen
                }
              />
            ))}
            <MusicPlayer
              serverId={server.id}
              channelId={channel.id}
              view="participant"
            />
          </div>
        ) : (
          <div className="voice-empty">
            <Icon name="Headphones" size={54} />
            <h2>{t("Settle in. Stay a while.")}</h2>
            <p>
              {t(
                "Join with your microphone muted. You control when to speak or share.",
              )}
            </p>
            <Button
              variant="primary"
              disabled={busy || store.connection !== "connected"}
              onClick={() => {
                setSeconds(0);
                setBusy(true);
                try {
                  sendLive({ type: "voice.join", channelId: channel.id });
                } catch (e) {
                  setBusy(false);
                  setError((e as Error).message);
                }
              }}
            >
              {t("Join voice room")}
            </Button>
          </div>
        )}
        {joined && lastPage > 0 && (
          <nav className="voice-pagination" aria-label={t("Call participants")}>
            <Button
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              {t("Previous people")}
            </Button>
            <span aria-live="polite">
              {currentPage + 1} / {lastPage + 1}
            </span>
            <Button
              disabled={currentPage === lastPage}
              onClick={() => setPage(currentPage + 1)}
            >
              {t("Next people")}
            </Button>
          </nav>
        )}
        <div className="voice-bottom">
          <div className="voice-connection">
            <Icon name="Signal" size={19} />
            <div>
              <strong>
                {joined
                  ? t(
                      participants.length === 1
                        ? "{count} person connected"
                        : "{count} people connected",
                      { count: participants.length },
                    )
                  : t("Encrypted voice & video")}
              </strong>
              <small>
                {joined
                  ? `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
                  : "WebRTC Â· Secure signaling"}
              </small>
            </div>
          </div>
          {voiceControls}
        </div>
      </main>
    </>
  );
}

