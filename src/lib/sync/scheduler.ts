import type { SyncEngine } from './engine';

export interface SchedulerOptions {
  engine: SyncEngine;
  /** Library sync interval. */
  intervalMs: number;
  /** How often to check which game is running (free, local). */
  runningPollMs?: number;
  /** How often to refresh the running game's achievements (1 API call each). Unused when the engine reads Steam's local cache. */
  liveIntervalMs?: number;
  getRunningAppId: () => Promise<number | null>;
  onRunningChange?: (appid: number | null) => void;
  onError?: (e: unknown) => void;
}

/**
 * Keeps data fresh with as few calls as possible:
 * - a library sync every `intervalMs` (usually 1 call),
 * - with Steam's local cache: every tick, the games whose stats file Steam rewrote (free),
 * - without it, while a game runs: only that game, every `liveIntervalMs`,
 * - when the game closes: one last refresh of it.
 */
export class Scheduler {
  private timers: ReturnType<typeof setInterval>[] = [];
  private running: number | null = null;
  private lastLive = 0;

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

  get runningAppId(): number | null {
    return this.running;
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
    let id: number | null;
    try {
      id = await this.opts.getRunningAppId();
    } catch {
      return;
    }
    const prev = this.running;
    if (id !== prev) {
      this.running = id;
      this.opts.onRunningChange?.(id);
      this.lastLive = now;
      // Game closed: Steam has the final state now — refresh it once.
      if (prev) await this.safe(() => engine.syncGame(prev));
      return;
    }
    if (engine.hasLocal) {
      await this.safe(() => engine.syncLocal());
      return;
    }
    if (id && now - this.lastLive >= liveIntervalMs && !engine.busy) {
      this.lastLive = now;
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
