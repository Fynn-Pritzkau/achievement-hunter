import type { SyncEngine, SyncResult } from './engine';

export interface SchedulerOptions {
  engine: SyncEngine;
  /** Library sync interval. */
  intervalMs: number;
  /** How often to check which games are running (free, local). */
  runningPollMs?: number;
  /** How often to refresh each running game's achievements (1 API call each). Unused when the engine reads Steam's local cache. */
  liveIntervalMs?: number;
  /** All games Steam runs right now; several when idling games side by side. */
  getRunningAppIds: () => Promise<number[]>;
  onRunningChange?: (appids: number[]) => void;
  /** A game closed and got its final refresh. `startedAt` = when it was first seen running. */
  onClosed?: (appid: number, startedAt: number, result: SyncResult) => void;
  onError?: (e: unknown) => void;
}

/**
 * Keeps data fresh with as few calls as possible:
 * - a library sync every `intervalMs` (usually 1 call),
 * - with Steam's local cache: every tick, the games whose stats file Steam rewrote (free),
 * - without it, while games run: only those, each every `liveIntervalMs`,
 * - when a game closes: one last refresh of it.
 */
export class Scheduler {
  private timers: ReturnType<typeof setInterval>[] = [];
  /** Running appid → time of its last live refresh (or of its start). */
  private running = new Map<number, number>();
  /** Running appid → when it was first seen running. */
  private startedAt = new Map<number, number>();

  constructor(private opts: SchedulerOptions) {}

  start(): void {
    this.stop();
    const { intervalMs, runningPollMs = 15_000 } = this.opts;
    this.timers.push(setInterval(() => this.librarySync(), intervalMs));
    this.timers.push(setInterval(() => this.tick(), runningPollMs));
    void this.tick();
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  get runningAppIds(): number[] {
    return [...this.running.keys()];
  }

  async librarySync(force = false): Promise<void> {
    try {
      await this.opts.engine.sync({ force });
    } catch (e) {
      this.opts.onError?.(e);
    }
  }

  /** Exposed for tests; normally driven by the timer. */
  async tick(now = Date.now()): Promise<void> {
    const { engine, liveIntervalMs = 150_000 } = this.opts;
    let ids: number[];
    try {
      ids = await this.opts.getRunningAppIds();
    } catch {
      return;
    }
    const current = new Set(ids);
    const closed = [...this.running.keys()].filter((id) => !current.has(id));
    const started = ids.filter((id) => !this.running.has(id));
    if (closed.length || started.length) {
      const since = new Map(closed.map((id) => [id, this.startedAt.get(id) ?? now]));
      for (const id of closed) {
        this.running.delete(id);
        this.startedAt.delete(id);
      }
      for (const id of started) {
        this.running.set(id, now);
        this.startedAt.set(id, now);
      }
      this.opts.onRunningChange?.(this.runningAppIds);
      // Closed games: Steam has the final state now — refresh each once.
      for (const id of closed) {
        await this.safe(async () => {
          const result = await engine.syncGame(id);
          this.opts.onClosed?.(id, since.get(id)!, result);
        });
      }
      return;
    }
    if (engine.hasLocal) {
      await this.safe(() => engine.syncLocal());
      return;
    }
    for (const [id, last] of this.running) {
      if (now - last < liveIntervalMs || engine.busy) continue;
      this.running.set(id, now);
      await this.safe(() => engine.syncGame(id));
    }
  }

  private async safe(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (e) {
      this.opts.onError?.(e);
    }
  }
}
