export interface LimiterOptions {
  /** Requests running at the same time. */
  concurrency: number;
  /** Minimum gap between two request starts. */
  minIntervalMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Global request gate: at most `concurrency` calls in flight, and starts spaced
 * by `minIntervalMs`. All Steam calls go through one instance, so a big first
 * import can never hammer the API.
 */
export class Limiter {
  private active = 0;
  private queue: (() => void)[] = [];
  private nextStart = 0;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private opts: LimiterOptions) {
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.opts.concurrency) {
      await new Promise<void>((r) => this.queue.push(r));
    }
    this.active++;
    try {
      const wait = this.nextStart - this.now();
      this.nextStart = Math.max(this.now(), this.nextStart) + this.opts.minIntervalMs;
      if (wait > 0) await this.sleep(wait);
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
  /** Decides whether an error is worth another try. */
  retryable: (e: unknown) => boolean;
  /** Server-requested delay (Retry-After), if the error carries one. */
  delayHint?: (e: unknown) => number | null;
  sleep?: (ms: number) => Promise<void>;
}

/** Exponential backoff with jitter: base, 2×base, 4×base … */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= opts.retries || !opts.retryable(e)) throw e;
      const hint = opts.delayHint?.(e);
      const backoff = opts.baseDelayMs * 2 ** attempt;
      await sleep(hint ?? backoff + Math.random() * backoff * 0.25);
    }
  }
}
