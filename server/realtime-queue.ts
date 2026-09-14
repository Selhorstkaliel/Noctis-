/** Coalesces invalidations per connection; one delivery per connection at a time. */
export class RealtimeQueue<T> {
  private pending = new Map<string, T>();
  private active = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  readonly metrics = {
    submitted: 0,
    coalesced: 0,
    completed: 0,
    rejected: 0,
    peakActive: 0,
    peakPending: 0,
  };
  constructor(
    private concurrency: number,
    private capacity: number,
    private merge: (previous: T, next: T) => T,
    private run: (value: T) => Promise<void>,
    private failed: (value: T, error?: unknown) => void,
  ) {}
  push(key: string, value: T) {
    if (this.closed) return false;
    this.metrics.submitted++;
    const old = this.pending.get(key);
    if (old !== undefined) {
      this.pending.set(key, this.merge(old, value));
      this.metrics.coalesced++;
    } else {
      if (this.pending.size >= this.capacity) {
        this.metrics.rejected++;
        this.failed(value);
        return false;
      }
      this.pending.set(key, value);
      this.metrics.peakPending = Math.max(
        this.metrics.peakPending,
        this.pending.size,
      );
    }
    if (!this.timer)
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.drain();
      }, 25);
    return true;
  }
  private drain() {
    if (this.closed) return;
    for (const [key, value] of this.pending) {
      if (this.active.size >= this.concurrency) break;
      if (this.active.has(key)) continue;
      this.pending.delete(key);
      this.active.add(key);
      this.metrics.peakActive = Math.max(
        this.metrics.peakActive,
        this.active.size,
      );
      void Promise.resolve()
        .then(() => this.run(value))
        .catch((error) => this.failed(value, error))
        .finally(() => {
          this.active.delete(key);
          this.metrics.completed++;
          this.drain();
        });
    }
  }
  remove(key: string) {
    this.pending.delete(key);
  }
  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.pending.clear();
  }
}
