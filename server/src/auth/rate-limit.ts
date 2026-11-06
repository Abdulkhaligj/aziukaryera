// In-memory sliding-window limits, keyed by client IP or email. A single API
// process serves the university deployment, so memory is sufficient.
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Records a hit; false when the key is over its limit. */
  take(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) || []).filter(t => now - t < this.windowMs);
    if (recent.length >= this.limit) { this.hits.set(key, recent); return false; }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 50_000) this.sweep(now);
    return true;
  }

  /** Seconds until the key may be used again. */
  retryAfter(key: string, now = Date.now()): number {
    const recent = (this.hits.get(key) || []).filter(t => now - t < this.windowMs);
    return recent.length < this.limit ? 0 : Math.ceil((this.windowMs - (now - recent[0])) / 1000);
  }

  private sweep(now: number) {
    for (const [key, times] of this.hits) if (times.every(t => now - t >= this.windowMs)) this.hits.delete(key);
  }
}
