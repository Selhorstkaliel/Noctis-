import {
  ConnectionError,
  ConnectionErrorReason,
  Room,
  RoomEvent,
  Track,
  VideoQuality,
  type RemoteParticipant,
  type RemoteTrackPublication,
  type RemoteTrack,
} from "livekit-client";

export type MediaKind = "audio" | "camera" | "screen";
export type Streams = Partial<Record<MediaKind, MediaStream>>;
const source = {
  audio: Track.Source.Microphone,
  camera: Track.Source.Camera,
  screen: Track.Source.ScreenShare,
};
const kind = (publication: RemoteTrackPublication): MediaKind | undefined =>
  publication.source === Track.Source.Microphone
    ? "audio"
    : publication.source === Track.Source.Camera
      ? "camera"
      : publication.source === Track.Source.ScreenShare
        ? "screen"
        : undefined;

/** Loaded only when a call starts. The SFU owns routing; no per-member RTCPeerConnection. */
export class NoctisCall {
  private room: Room;
  private closing = false;
  private established = false;
  private visible = new Set<string>();
  private screens = new Set<string>();
  constructor(
    private callbacks: {
      remote: (id: string, key: MediaKind, stream?: MediaStream) => void;
      speaking: (ids: Set<string>) => void;
      disconnected: () => void;
    },
  ) {
    this.room = this.createRoom();
  }
  private createRoom() {
    const room = new Room({
      dynacast: true,
      // Subscription is tied to the visible page, independent of DOM stream attachment.
      adaptiveStream: false,
      publishDefaults: {
        simulcast: true,
        videoCodec: "vp8",
        dtx: true,
        red: true,
        videoEncoding: { maxBitrate: 1200000, maxFramerate: 30 },
        screenShareEncoding: { maxBitrate: 1800000, maxFramerate: 15 },
      },
    });
    const track = (
      t: RemoteTrack,
      p: RemoteTrackPublication,
      participant: RemoteParticipant,
      active: boolean,
    ) => {
      const key = kind(p);
      if (key)
        this.callbacks.remote(
          participant.identity,
          key,
          active ? new MediaStream([t.mediaStreamTrack]) : undefined,
        );
    };
    room.on(RoomEvent.TrackSubscribed, (t, p, u) => track(t, p, u, true));
    room.on(RoomEvent.TrackUnsubscribed, (t, p, u) => track(t, p, u, false));
    room.on(RoomEvent.TrackPublished, () => this.subscriptions());
    room.on(RoomEvent.ParticipantConnected, () => this.subscriptions());
    room.on(RoomEvent.ActiveSpeakersChanged, (people) =>
      this.callbacks.speaking(new Set(people.map((p) => p.identity))),
    );
    room.on(RoomEvent.Disconnected, () => {
      if (this.established && !this.closing) {
        this.established = false;
        this.callbacks.disconnected();
      }
    });
    return room;
  }
  async connect(url: string, token: string) {
    const retryable = new Set([
      ConnectionErrorReason.ServerUnreachable,
      ConnectionErrorReason.InternalError,
      ConnectionErrorReason.Timeout,
      ConnectionErrorReason.WebSocket,
    ]);
    let failure: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.room.connect(url, token, {
          autoSubscribe: false,
          maxRetries: 1,
          peerConnectionTimeout: 12000,
          websocketTimeout: 12000,
        });
        if (this.closing) {
          await this.room.disconnect();
          throw new Error("Voice connection cancelled.");
        }
        this.established = true;
        this.subscriptions();
        return;
      } catch (error) {
        failure = error;
        const shouldRetry =
          error instanceof ConnectionError && retryable.has(error.reason);
        this.room.removeAllListeners();
        await this.room.disconnect().catch(() => {});
        if (!shouldRetry || this.closing || attempt === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 300 * 3 ** attempt));
        if (this.closing) break;
        this.room = this.createRoom();
      }
    }
    throw failure;
  }
  setVisible(ids: string[], screens: string[] = []) {
    this.visible = new Set(ids);
    this.screens = new Set(screens);
    this.subscriptions();
  }
  private subscriptions() {
    for (const user of this.room.remoteParticipants.values()) {
      for (const publication of user.trackPublications.values()) {
        const key = kind(publication);
        const wanted =
          key === "audio" ||
          (key === "camera" && this.visible.has(user.identity)) ||
          (key === "screen" && this.screens.has(user.identity));
        if (publication.isDesired !== wanted) publication.setSubscribed(wanted);
        if (wanted && key !== "audio")
          publication.setVideoQuality(
            key === "screen" ? VideoQuality.HIGH : VideoQuality.MEDIUM,
          );
      }
    }
  }
  async publish(key: MediaKind, track: MediaStreamTrack) {
    await this.room.localParticipant.publishTrack(track, {
      source: source[key],
      name: key,
    });
  }
  async unpublish(track: MediaStreamTrack) {
    await this.room.localParticipant.unpublishTrack(track, false);
  }
  async muteAudio(muted: boolean) {
    const publication = this.room.localParticipant.getTrackPublication(
      Track.Source.Microphone,
    );
    if (muted) await publication?.mute();
    else await publication?.unmute();
  }
  close() {
    this.closing = true;
    this.established = false;
    void this.room.disconnect(true);
  }
}
