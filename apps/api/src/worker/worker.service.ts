import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import type Redis from 'ioredis';
import { AlertService } from '../alerts/alert.service';
import { NotificationService } from '../alerts/notification.service';
import { REDIS } from '../common/core.module';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  CLICK_BUFFER_KEY,
  NETWORK_SYNC_QUEUE,
  NetworkSyncJob,
  NotifyJob,
  POSTBACK_JOB_OPTIONS,
  POSTBACK_QUEUE,
  PostbackJob,
  QUEUE_MAINTENANCE,
  QUEUE_NETWORK_SYNC,
  QUEUE_NOTIFY,
  QUEUE_POSTBACK,
} from '../common/queues';
import { ENV, Env } from '../config/env';
import { API_SUPPORTED_NETWORKS, NetworkSyncService } from '../networks/network-sync.service';
import { DeliveryService } from '../postbacks/delivery.service';

const SWEEP_EVERY_MS = 60_000;
const DRAIN_BATCH = 500;

/**
 * Proses worker:
 * - Postback keluar (retry & dead-letter) — Phase 1
 * - Sinkronisasi statistik jaringan terjadwal — Phase 2
 * - Pengiriman notifikasi alert (Telegram) — Phase 2
 * - Sweeper berkala: antrean postback yang tertinggal, buffer klik
 */
@Injectable()
export class WorkerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerService.name);
  private workers: Worker[] = [];
  private maintenance: Queue;

  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: DeliveryService,
    private readonly networkSync: NetworkSyncService,
    private readonly notifications: NotificationService,
    private readonly alerts: AlertService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(POSTBACK_QUEUE) private readonly postbackQueue: Queue<PostbackJob>,
    @Inject(NETWORK_SYNC_QUEUE) private readonly syncQueue: Queue<NetworkSyncJob>,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private conn() {
    return this.redis.duplicate({ enableOfflineQueue: true });
  }

  async onModuleInit() {
    const postbackWorker = new Worker<PostbackJob>(QUEUE_POSTBACK, async (job) => this.delivery.deliver(job.data.deliveryId), {
      connection: this.conn(),
      concurrency: 10,
    });
    postbackWorker.on('failed', async (job, err) => {
      if (!job) return;
      const max = job.opts.attempts ?? 1;
      if (job.attemptsMade >= max || err.name === 'UnrecoverableError') {
        await this.delivery.markDead(job.data.deliveryId, err.message);
        this.logger.error({ deliveryId: job.data.deliveryId, err: err.message }, 'Postback masuk dead-letter');
        await this.alertDeadPostback(job.data.deliveryId, err.message).catch((e) => this.logger.error({ err: e }, 'Gagal membuat alert'));
      }
    });

    // Satu sinkronisasi per waktu agar batas 10 request statistik/menit RollerAds tidak terlampaui.
    const syncWorker = new Worker<NetworkSyncJob>(QUEUE_NETWORK_SYNC, async (job) => this.networkSync.sync(job.data.networkAccountId, job.data.trigger), {
      connection: this.conn(),
      concurrency: 1,
      lockDuration: 10 * 60_000,
    });
    syncWorker.on('failed', (job, err) => this.logger.warn({ accountId: job?.data.networkAccountId, err: err.message }, 'Sinkronisasi gagal'));

    const notifyWorker = new Worker<NotifyJob>(QUEUE_NOTIFY, async (job) => this.notifications.deliver(job.data.alertId, job.data.channelId), {
      connection: this.conn(),
      concurrency: 5,
    });

    this.maintenance = new Queue(QUEUE_MAINTENANCE, { connection: this.redis });
    await this.maintenance.upsertJobScheduler('sweep', { every: SWEEP_EVERY_MS }, { name: 'sweep' });
    await this.maintenance.upsertJobScheduler('schedule-syncs', { every: this.env.SYNC_INTERVAL_MINUTES * 60_000 }, { name: 'schedule-syncs' });
    const maintenanceWorker = new Worker(
      QUEUE_MAINTENANCE,
      async (job) => (job.name === 'schedule-syncs' ? this.scheduleSyncs() : this.sweep()),
      { connection: this.conn(), concurrency: 1 },
    );

    this.workers = [postbackWorker, syncWorker, notifyWorker, maintenanceWorker];
    this.logger.log({ syncEveryMinutes: this.env.SYNC_INTERVAL_MINUTES }, 'Worker berjalan');
  }

  async scheduleSyncs() {
    const accounts = await this.prisma.networkAccount.findMany({
      where: { apiConfigured: true, syncEnabled: true, status: 'ACTIVE', network: { in: [...API_SUPPORTED_NETWORKS] } },
      select: { id: true },
    });
    const slot = Math.floor(Date.now() / (this.env.SYNC_INTERVAL_MINUTES * 60_000));
    for (const a of accounts) {
      await this.syncQueue.add('sync', { networkAccountId: a.id, trigger: 'schedule' }, { jobId: `sched:${a.id}:${slot}`, attempts: 3, backoff: { type: 'exponential', delay: 120_000 }, removeOnComplete: 500, removeOnFail: 500 });
    }
    if (accounts.length) this.logger.log({ accounts: accounts.length }, 'Sinkronisasi dijadwalkan');
  }

  private async alertDeadPostback(deliveryId: string, reason: string) {
    const d = await this.prisma.postbackDelivery.findUnique({ where: { id: deliveryId }, include: { networkAccount: { select: { id: true, name: true } } } });
    if (!d) return;
    const hour = new Date().toISOString().slice(0, 13);
    await this.alerts.raise({
      organizationId: d.organizationId,
      type: 'POSTBACK_DEAD',
      severity: 'HIGH',
      title: `Postback ke ${d.networkAccount.name} gagal permanen`,
      body: `Konversi tidak terkirim ke jaringan iklan setelah ${d.attempts} percobaan. Alasan terakhir: ${reason.slice(0, 200)}. Kirim ulang dari menu Postbacks setelah penyebabnya diperbaiki.`,
      dedupeKey: `postback-dead:${d.networkAccount.id}:${hour}`,
      entityType: 'network_account',
      entityId: d.networkAccount.id,
    });
  }

  async sweep() {
    // 1) Delivery QUEUED yang tidak pernah masuk antrean (mis. Redis sempat mati)
    const stale = await this.prisma.postbackDelivery.findMany({
      where: { status: 'QUEUED', updatedAt: { lt: new Date(Date.now() - SWEEP_EVERY_MS) } },
      select: { id: true },
      take: 500,
    });
    for (const d of stale) {
      await this.postbackQueue.add('deliver', { deliveryId: d.id }, { ...POSTBACK_JOB_OPTIONS, jobId: d.id });
    }

    // 2) Buffer klik dari tracker saat PostgreSQL tidak tersedia
    let drained = 0;
    for (;;) {
      const items = await this.redis.lpop(CLICK_BUFFER_KEY, DRAIN_BATCH);
      if (!items || items.length === 0) break;
      const rows = items.map((s) => JSON.parse(s) as Prisma.ClickCreateManyInput);
      try {
        await this.prisma.click.createMany({ data: rows, skipDuplicates: true });
        drained += rows.length;
      } catch (err) {
        await this.redis.rpush(CLICK_BUFFER_KEY, ...items);
        this.logger.error({ err }, 'Gagal menulis buffer klik; dicoba lagi pada sweep berikutnya');
        break;
      }
    }
    if (stale.length || drained) this.logger.log({ requeued: stale.length, drainedClicks: drained }, 'Sweep selesai');
  }

  async onApplicationShutdown() {
    await Promise.all(this.workers.map((w) => w.close()));
    await this.maintenance?.close();
  }
}
