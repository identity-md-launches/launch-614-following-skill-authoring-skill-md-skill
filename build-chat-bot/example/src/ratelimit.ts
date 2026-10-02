export type LimitVerdict = "allow" | "deny-notify" | "deny";

interface Slot {
  count: number;
  resetAt: number;
  notified: boolean;
}

/**
 * Fixed-window limiter keyed on a chat or user id. `deny-notify` is returned once
 * per window so the caller can send a single notice; further denials are silent.
 * The clock is injected so tests never sleep.
 */
export class RateLimiter {
  private slots = new Map<string, Slot>();
  private limit: number;
  private windowMs: number;
  private now: () => number;

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  check(key: string): LimitVerdict {
    const t = this.now();
    let slot = this.slots.get(key);
    if (!slot || t >= slot.resetAt) {
      slot = { count: 0, resetAt: t + this.windowMs, notified: false };
      this.slots.set(key, slot);
    }
    if (slot.count < this.limit) {
      slot.count += 1;
      return "allow";
    }
    if (!slot.notified) {
      slot.notified = true;
      return "deny-notify";
    }
    return "deny";
  }
}
