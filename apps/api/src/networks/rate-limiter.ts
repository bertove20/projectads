import type Redis from 'ioredis';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Rate limiter fixed-window per menit jam (sesuai aturan RollerAds: "per clock minute").
 * acquire() menunggu sampai slot tersedia, maksimal maxWaitMs.
 */
export class MinuteRateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly maxWaitMs = 130_000,
  ) {}

  async acquire(key: string, limitPerMinute: number): Promise<void> {
    const deadline = Date.now() + this.maxWaitMs;
    for (;;) {
      const now = Date.now();
      const minute = Math.floor(now / 60_000);
      const k = `rl:${key}:${minute}`;
      const count = await this.redis.incr(k);
      if (count === 1) await this.redis.expire(k, 70);
      if (count <= limitPerMinute) return;
      const waitMs = (minute + 1) * 60_000 - now + 250;
      if (now + waitMs > deadline) throw new Error(`rate limit lokal ${key} terlampaui`);
      await sleep(waitMs);
    }
  }
}
