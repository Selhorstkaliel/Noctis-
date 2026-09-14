import { useEffect, useRef, useState } from "react";
import type { MusicPlaybackState, MusicTrack } from "../shared/music";
import { Button, Icon } from "./components";
import { useI18n } from "./i18n";

type PlaybackProps = {
  track: MusicTrack;
  playbackState: MusicPlaybackState;
  position: number;
  revision: number;
  volume: number;
  onEnded: () => void;
  variant?: "default" | "tile";
};

function script(id: string, source: string) {
  let element = document.getElementById(id) as HTMLScriptElement | null;
  if (element) return element;
  element = document.createElement("script");
  element.id = id;
  element.src = source;
  element.async = true;
  document.head.appendChild(element);
  return element;
}

type YouTubePlayer = {
  destroy(): void;
  getCurrentTime(): number;
  pauseVideo(): void;
  playVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  stopVideo(): void;
};
type YouTubeApi = {
  Player: new (
    target: HTMLElement,
    options: {
      videoId?: string;
      width: string;
      height: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady: () => void;
        onStateChange: (event: { data: number }) => void;
      };
    },
  ) => YouTubePlayer;
};
type YouTubeWindow = Window & {
  YT?: YouTubeApi;
  onYouTubeIframeAPIReady?: () => void;
};
let youtubePromise: Promise<YouTubeApi> | undefined;
function loadYouTube() {
  const target = window as YouTubeWindow;
  if (target.YT?.Player) return Promise.resolve(target.YT);
  if (youtubePromise) return youtubePromise;
  youtubePromise = new Promise((resolve, reject) => {
    const previous = target.onYouTubeIframeAPIReady;
    target.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (target.YT?.Player) resolve(target.YT);
      else reject(new Error("YouTube player did not initialize."));
    };
    script(
      "noctis-youtube-api",
      "https://www.youtube.com/iframe_api",
    ).addEventListener(
      "error",
      () => reject(new Error("YouTube player could not be loaded.")),
      { once: true },
    );
  });
  return youtubePromise;
}

function youtubeSource(value: string) {
  const url = new URL(value);
  const segments = url.pathname.split("/").filter(Boolean);
  const videoId =
    (url.hostname === "youtu.be" ? segments[0] : url.searchParams.get("v")) ||
    (["embed", "shorts", "live"].includes(segments[0] || "")
      ? segments[1]
      : undefined);
  return { videoId: videoId || undefined, list: url.searchParams.get("list") };
}

function YouTubePlayback(props: PlaybackProps) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement | null>(null);
  const player = useRef<YouTubePlayer | null>(null);
  const [ready, setReady] = useState(false);
  const source = youtubeSource(props.track.url);
  const playlist = !!source.list;
  const synchronize = () => {
    const current = player.current;
    if (!current) return;
    current.setVolume(props.volume);
    if (props.playbackState === "PLAYING") {
      if (Math.abs(current.getCurrentTime() - props.position) > 4)
        current.seekTo(props.position, true);
      current.playVideo();
    } else if (props.playbackState === "PAUSED") current.pauseVideo();
    else current.stopVideo();
  };
  useEffect(() => {
    let cancelled = false;
    void loadYouTube()
      .then((api) => {
        if (cancelled || !host.current) return;
        const playerVars: Record<string, string | number> = {
          controls: 1,
          playsinline: 1,
          rel: 0,
          origin: window.location.origin,
          start: Math.floor(props.position),
        };
        if (source.list) {
          playerVars.listType = "playlist";
          playerVars.list = source.list;
        }
        player.current = new api.Player(host.current, {
          videoId: source.videoId,
          width: "100%",
          height: "200",
          playerVars,
          events: {
            onReady: () => setReady(true),
            onStateChange: (event) => {
              if (event.data === 0 && !playlist) props.onEnded();
            },
          },
        });
      })
      .catch(() => setReady(false));
    return () => {
      cancelled = true;
      player.current?.destroy();
      player.current = null;
      setReady(false);
    };
  }, [props.track.id]);
  useEffect(() => {
    if (ready) synchronize();
  }, [ready, props.playbackState, props.revision, props.volume]);
  return (
    <>
      <div className="provider-playback-host youtube" ref={host} />
      <Button variant="secondary" disabled={!ready} onClick={synchronize}>
        <Icon name="Play" size={15} /> {t("Play here")}
      </Button>
    </>
  );
}

type SpotifyController = {
  addListener(
    event: string,
    listener: (event: {
      data?: { duration?: number; position?: number; isPaused?: boolean };
    }) => void,
  ): void;
  destroy(): void;
  pause(): void;
  play(): void;
  seek(seconds: number): void;
};
type SpotifyApi = {
  createController(
    target: HTMLElement,
    options: { url: string; width: string; height: number },
    callback: (controller: SpotifyController) => void,
  ): void;
};
type SpotifyWindow = Window & {
  onSpotifyIframeApiReady?: (api: SpotifyApi) => void;
};
let spotifyPromise: Promise<SpotifyApi> | undefined;
function loadSpotify() {
  if (spotifyPromise) return spotifyPromise;
  const target = window as SpotifyWindow;
  spotifyPromise = new Promise((resolve, reject) => {
    const previous = target.onSpotifyIframeApiReady;
    target.onSpotifyIframeApiReady = (api) => {
      previous?.(api);
      resolve(api);
    };
    script(
      "noctis-spotify-api",
      "https://open.spotify.com/embed/iframe-api/v1",
    ).addEventListener(
      "error",
      () => reject(new Error("Spotify player could not be loaded.")),
      { once: true },
    );
  });
  return spotifyPromise;
}

function SpotifyPlayback(props: PlaybackProps) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement | null>(null);
  const controller = useRef<SpotifyController | null>(null);
  const ended = useRef(false);
  const [ready, setReady] = useState(false);
  const synchronize = () => {
    if (!controller.current) return;
    controller.current.seek(Math.max(0, Math.floor(props.position)));
    if (props.playbackState === "PLAYING") controller.current.play();
    else controller.current.pause();
  };
  useEffect(() => {
    let cancelled = false;
    ended.current = false;
    void loadSpotify()
      .then((api) => {
        if (cancelled || !host.current) return;
        api.createController(
          host.current,
          { url: props.track.url, width: "100%", height: 152 },
          (next) => {
            if (cancelled) {
              next.destroy();
              return;
            }
            controller.current = next;
            next.addListener("ready", () => setReady(true));
            next.addListener("playback_update", (event) => {
              const state = event.data;
              if (
                !ended.current &&
                state?.isPaused &&
                state.duration &&
                state.position !== undefined &&
                state.position >= state.duration - 750
              ) {
                ended.current = true;
                props.onEnded();
              }
            });
          },
        );
      })
      .catch(() => setReady(false));
    return () => {
      cancelled = true;
      controller.current?.destroy();
      controller.current = null;
      setReady(false);
    };
  }, [props.track.id]);
  useEffect(() => {
    if (ready) synchronize();
  }, [ready, props.playbackState, props.revision]);
  return (
    <>
      <div className="provider-playback-host spotify" ref={host} />
      <Button variant="secondary" disabled={!ready} onClick={synchronize}>
        <Icon name="Play" size={15} /> {t("Play here")}
      </Button>
    </>
  );
}

type SoundCloudWidget = {
  bind(event: string, listener: () => void): void;
  pause(): void;
  play(): void;
  seekTo(milliseconds: number): void;
  setVolume(volume: number): void;
  unbind(event: string): void;
};
type SoundCloudApi = {
  Widget: ((frame: HTMLIFrameElement) => SoundCloudWidget) & {
    Events: { READY: string; FINISH: string };
  };
};
type SoundCloudWindow = Window & { SC?: SoundCloudApi };
let soundCloudPromise: Promise<SoundCloudApi> | undefined;
function loadSoundCloud() {
  const target = window as SoundCloudWindow;
  if (target.SC?.Widget) return Promise.resolve(target.SC);
  if (soundCloudPromise) return soundCloudPromise;
  soundCloudPromise = new Promise((resolve, reject) => {
    const element = script(
      "noctis-soundcloud-api",
      "https://w.soundcloud.com/player/api.js",
    );
    element.addEventListener(
      "load",
      () =>
        target.SC?.Widget
          ? resolve(target.SC)
          : reject(new Error("SoundCloud player did not initialize.")),
      { once: true },
    );
    element.addEventListener(
      "error",
      () => reject(new Error("SoundCloud player could not be loaded.")),
      { once: true },
    );
  });
  return soundCloudPromise;
}

function SoundCloudPlayback(props: PlaybackProps) {
  const { t } = useI18n();
  const frame = useRef<HTMLIFrameElement | null>(null);
  const widget = useRef<SoundCloudWidget | null>(null);
  const [ready, setReady] = useState(false);
  const synchronize = () => {
    if (!widget.current) return;
    widget.current.setVolume(props.volume);
    widget.current.seekTo(Math.max(0, props.position * 1000));
    if (props.playbackState === "PLAYING") widget.current.play();
    else widget.current.pause();
  };
  useEffect(() => {
    let cancelled = false;
    void loadSoundCloud()
      .then((api) => {
        if (cancelled || !frame.current) return;
        const next = api.Widget(frame.current);
        widget.current = next;
        next.bind(api.Widget.Events.READY, () => setReady(true));
        next.bind(api.Widget.Events.FINISH, props.onEnded);
      })
      .catch(() => setReady(false));
    return () => {
      cancelled = true;
      if (widget.current) {
        const events = (window as SoundCloudWindow).SC?.Widget.Events;
        if (events) {
          widget.current.unbind(events.READY);
          widget.current.unbind(events.FINISH);
        }
      }
      widget.current = null;
      setReady(false);
    };
  }, [props.track.id]);
  useEffect(() => {
    if (ready) synchronize();
  }, [ready, props.playbackState, props.revision, props.volume]);
  const source = `https://w.soundcloud.com/player/?url=${encodeURIComponent(
    props.track.url,
  )}&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&visual=false`;
  return (
    <>
      <iframe
        ref={frame}
        className="provider-playback-frame soundcloud"
        title={t("SoundCloud player for {title}", { title: props.track.title })}
        src={source}
        allow="autoplay"
      />
      <Button variant="secondary" disabled={!ready} onClick={synchronize}>
        <Icon name="Play" size={15} /> {t("Play here")}
      </Button>
    </>
  );
}

export function ProviderPlayback(props: PlaybackProps) {
  const { t } = useI18n();
  if (props.track.playbackMode !== "embed") return null;
  return (
    <section
      className={`provider-playback ${props.variant === "tile" ? "tile" : ""}`}
      aria-label={t("Official {provider} playback", {
        provider: props.track.provider,
      })}
    >
      <div className="provider-playback-copy">
        <span>
          <Icon name="ShieldCheck" size={15} /> {t("OFFICIAL PROVIDER STREAM")}
        </span>
        <p>
          {t(
            "Audio is delivered directly by {provider}. Use Noctis controls to keep the room state aligned.",
            { provider: props.track.provider },
          )}
        </p>
      </div>
      {props.track.provider === "youtube" ? (
        <YouTubePlayback {...props} />
      ) : props.track.provider === "spotify" ? (
        <SpotifyPlayback {...props} />
      ) : (
        <SoundCloudPlayback {...props} />
      )}
      <small>
        {t(
          "Your browser may require you to press Play here once before shared controls can start audio.",
        )}
        {props.track.provider === "spotify" &&
          ` ${t("Spotify keeps listening volume inside its player.")}`}
      </small>
    </section>
  );
}
