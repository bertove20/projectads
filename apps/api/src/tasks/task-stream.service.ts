import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import { Observable } from 'rxjs';
import { REDIS } from '../common/core.module';
import { TASK_CHANNEL_PREFIX, TaskEvent } from './tasks.service';

type Listener = (evt: TaskEvent) => void;

/**
 * Satu koneksi Redis subscriber per proses api, dibagi ke semua klien SSE.
 * Event dari worker (incident card) dan dari instance api lain ikut sampai.
 */
@Injectable()
export class TaskStreamService implements OnModuleDestroy {
  private readonly logger = new Logger(TaskStreamService.name);
  private sub: Redis | null = null;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private ensureSubscriber() {
    if (this.sub) return;
    this.sub = this.redis.duplicate({ enableOfflineQueue: true });
    this.sub.on('error', (err) => this.logger.warn({ err: err.message }, 'Subscriber Redis error'));
    void this.sub.psubscribe(TASK_CHANNEL_PREFIX + '*');
    this.sub.on('pmessage', (_p, channel, message) => {
      const orgId = channel.slice(TASK_CHANNEL_PREFIX.length);
      const set = this.listeners.get(orgId);
      if (!set?.size) return;
      let evt: TaskEvent;
      try {
        evt = JSON.parse(message) as TaskEvent;
      } catch {
        return;
      }
      for (const l of set) l(evt);
    });
  }

  stream(organizationId: string): Observable<{ type: string; data: unknown }> {
    this.ensureSubscriber();
    return new Observable((subscriber) => {
      const listener: Listener = (evt) => subscriber.next({ type: 'task', data: evt });
      const set = this.listeners.get(organizationId) ?? new Set();
      set.add(listener);
      this.listeners.set(organizationId, set);
      subscriber.next({ type: 'ready', data: { ok: true } });
      // Heartbeat menjaga koneksi tetap hidup di balik proxy (timeout baca ~60 detik).
      const hb = setInterval(() => subscriber.next({ type: 'ping', data: Date.now() }), 25_000);
      return () => {
        clearInterval(hb);
        set.delete(listener);
        if (!set.size) this.listeners.delete(organizationId);
      };
    });
  }

  async onModuleDestroy() {
    await this.sub?.quit().catch(() => undefined);
  }
}
