import type { MusicRepeatMode, MusicTrack } from "../../shared/music.js";

export class MusicQueue {
  private items: MusicTrack[];

  constructor(
    items: MusicTrack[] = [],
    private readonly maximum = 100,
  ) {
    this.items = [...items];
  }

  list() {
    return [...this.items];
  }

  enqueue(tracks: MusicTrack[]) {
    if (this.items.length + tracks.length > this.maximum)
      throw Object.assign(
        new Error(`The queue can hold up to ${this.maximum} tracks.`),
        {
          statusCode: 409,
          code: "MUSIC_QUEUE_FULL",
        },
      );
    this.items.push(...tracks);
  }

  dequeue() {
    return this.items.shift() || null;
  }

  next(current: MusicTrack | null, repeat: MusicRepeatMode) {
    if (current && repeat === "ONE") return current;
    if (current && repeat === "ALL") this.items.push(current);
    return this.dequeue();
  }

  previous(history: MusicTrack[]) {
    return history.at(-1) || null;
  }

  remove(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.items.length)
      throw Object.assign(
        new Error("Choose a track that is still in the queue."),
        {
          statusCode: 404,
          code: "MUSIC_TRACK_NOT_FOUND",
        },
      );
    return this.items.splice(index, 1)[0]!;
  }

  clear() {
    const removed = this.items.length;
    this.items = [];
    return removed;
  }

  shuffle(random: () => number = Math.random) {
    for (let i = this.items.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [this.items[i], this.items[j]] = [this.items[j]!, this.items[i]!];
    }
  }
}

export function validateVolume(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 100)
    throw Object.assign(
      new Error("Volume must be a whole number from 0 to 100."),
      {
        statusCode: 400,
        code: "MUSIC_VOLUME_INVALID",
      },
    );
  return value;
}
