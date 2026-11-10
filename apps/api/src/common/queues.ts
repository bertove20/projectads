import { Provider } from '@nestjs/common';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';

export const QUEUE_POSTBACK = 'postback-delivery';
/** Token DI untuk producer antrean postback. */
export const POSTBACK_QUEUE = Symbol('POSTBACK_QUEUE');
export const QUEUE_MAINTENANCE = 'maintenance';

/** List Redis untuk klik yang gagal ditulis ke PostgreSQL (read.md 17.10). */
export const CLICK_BUFFER_KEY = 'buffer:clicks';

export interface PostbackJob {
  deliveryId: string;
}

/** Retry postback: 8 percobaan, backoff eksponensial mulai 30 detik (~2 jam total). */
export const POSTBACK_JOB_OPTIONS = {
  attempts: 8,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: { age: 7 * 86400, count: 10_000 },
  removeOnFail: { age: 30 * 86400 },
};

export const QUEUE_NETWORK_SYNC = 'network-sync';
export const QUEUE_NOTIFY = 'notifications';
export const NETWORK_SYNC_QUEUE = Symbol('NETWORK_SYNC_QUEUE');
export const NOTIFY_QUEUE = Symbol('NOTIFY_QUEUE');

export interface NetworkSyncJob {
  networkAccountId: string;
  trigger: 'schedule' | 'manual';
}

export interface NotifyJob {
  alertId: string;
  /** Kirim hanya ke channel ini (uji kirim) */
  channelId?: string;
}

export function networkSyncQueueProvider(redisToken: symbol): Provider {
  return {
    provide: NETWORK_SYNC_QUEUE,
    inject: [redisToken],
    useFactory: (redis: Redis) => new Queue<NetworkSyncJob>(QUEUE_NETWORK_SYNC, { connection: redis }),
  };
}

export function notifyQueueProvider(redisToken: symbol): Provider {
  return {
    provide: NOTIFY_QUEUE,
    inject: [redisToken],
    useFactory: (redis: Redis) => new Queue<NotifyJob>(QUEUE_NOTIFY, { connection: redis }),
  };
}

/** Provider producer antrean postback; memakai koneksi Redis bersama (REDIS). */
export function postbackQueueProvider(redisToken: symbol): Provider {
  return {
    provide: POSTBACK_QUEUE,
    inject: [redisToken],
    useFactory: (redis: Redis) => new Queue<PostbackJob>(QUEUE_POSTBACK, { connection: redis }),
  };
}
