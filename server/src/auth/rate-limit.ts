// In-memory sliding-window limits, keyed by client address or email. A single
// API process serves the university deployment, so memory is sufficient.
//
// Audit 2026-11-16, M10: the map has a fixed size. A key that is used moves to
// the end, so the oldest keys are dropped first when it is full, and a sweep
// of expired keys runs at most once per window instead of on every request.
import { isIP } from 'node:net';

const MAX_KEYS = 100_000;

export class RateLimiter {
  private hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private lastSweep = 0;
  constructor(limit: number, windowMs: number, maxKeys = MAX_KEYS) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  /** Records a hit; false when the key is over its limit. */
  take(key: string, now = Date.now()): boolean {
    const recent = this.recent(key, now);
    this.hits.delete(key);
    if (recent.length >= this.limit) { this.hits.set(key, recent); return false; }
    recent.push(now);
    this.hits.set(key, recent);
    this.trim(now);
    return true;
  }

  /** Failures so far in the window, without recording one. */
  count(key: string, now = Date.now()): number {
    return this.recent(key, now).length;
  }

  /** Seconds until the key may be used again. */
  retryAfter(key: string, now = Date.now()): number {
    const recent = this.recent(key, now);
    return recent.length < this.limit ? 0 : Math.ceil((this.windowMs - (now - recent[0])) / 1000);
  }

  get size() { return this.hits.size; }

  private recent(key: string, now: number) {
    return (this.hits.get(key) || []).filter(t => now - t < this.windowMs);
  }

  private trim(now: number) {
    if (now - this.lastSweep >= this.windowMs && this.hits.size > this.maxKeys / 2) {
      this.lastSweep = now;
      for (const [key, times] of this.hits) if (times.every(t => now - t >= this.windowMs)) this.hits.delete(key);
    }
    while (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest === undefined) break;
      this.hits.delete(oldest);
    }
  }
}

/** The address a limit counts: an IPv6 client is counted per /64, the block one
 *  home or host gets, so rotating addresses inside it does not reset the limit
 *  (audit 2026-11-16, L12). IPv4 (also written as ::ffff:a.b.c.d) is kept as is. */
export function clientKey(ip: string | undefined): string {
  const address = String(ip ?? '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return mapped[1];
  if (isIP(address) !== 6) return address;
  const [head, tail = ''] = address.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = address.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}
