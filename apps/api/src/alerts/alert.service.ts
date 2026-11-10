import { Inject, Injectable, Logger } from '@nestjs/common';
import { Severity } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../common/prisma/prisma.service';
import { NOTIFY_QUEUE, NotifyJob } from '../common/queues';
import { TasksService } from '../tasks/tasks.service';

export interface RaiseAlert {
  organizationId: string;
  type: string;
  severity: Severity;
  title: string;
  body: string;
  /** Alert dengan kunci sama yang masih OPEN/ACKNOWLEDGED hanya menambah hitungan, tidak dikirim ulang. */
  dedupeKey: string;
  entityType?: string;
  entityId?: string;
}

const SEVERITY_RANK: Record<Severity, number> = { INFO: 0, WARNING: 1, HIGH: 2, CRITICAL: 3 };
export const severityAtLeast = (s: Severity, min: Severity) => SEVERITY_RANK[s] >= SEVERITY_RANK[min];

/**
 * Notification engine (read.md Bagian 7, cakupan Phase 2): alert disimpan di database lebih dulu,
 * lalu pengiriman ke channel (Telegram) dilakukan worker — tidak hilang saat pengiriman gagal.
 */
@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFY_QUEUE) private readonly queue: Queue<NotifyJob>,
    private readonly tasks: TasksService,
  ) {}

  async raise(a: RaiseAlert): Promise<{ id: string; isNew: boolean }> {
    const existing = await this.prisma.alert.findUnique({
      where: { organizationId_dedupeKey: { organizationId: a.organizationId, dedupeKey: a.dedupeKey } },
    });
    if (existing && existing.status !== 'RESOLVED') {
      await this.prisma.alert.update({
        where: { id: existing.id },
        data: { occurrences: { increment: 1 }, lastSeenAt: new Date(), body: a.body.slice(0, 4000) },
      });
      return { id: existing.id, isNew: false };
    }
    const data = {
      type: a.type,
      severity: a.severity,
      title: a.title.slice(0, 200),
      body: a.body.slice(0, 4000),
      entityType: a.entityType,
      entityId: a.entityId,
      status: 'OPEN' as const,
      occurrences: 1,
      lastSeenAt: new Date(),
      acknowledgedAt: null,
      acknowledgedById: null,
      resolvedAt: null,
    };
    // Alert RESOLVED dengan kunci sama dibuka kembali sebagai kejadian baru.
    const alert = existing
      ? await this.prisma.alert.update({ where: { id: existing.id }, data: { ...data, createdAt: new Date() } })
      : await this.prisma.alert.create({ data: { ...data, organizationId: a.organizationId, dedupeKey: a.dedupeKey } });
    try {
      await this.queue.add('notify', { alertId: alert.id }, { attempts: 5, backoff: { type: 'exponential', delay: 20_000 }, removeOnComplete: 1000, removeOnFail: 5000 });
    } catch (err) {
      this.logger.warn({ err: (err as Error).message, alertId: alert.id }, 'Gagal mengantrikan notifikasi');
    }
    // Alert serius menjadi incident card di Kanban (read.md 19.3).
    if (severityAtLeast(alert.severity, 'HIGH')) {
      try {
        await this.tasks.incidentFromAlert(alert.id);
      } catch (err) {
        this.logger.warn({ err: (err as Error).message, alertId: alert.id }, 'Gagal membuat incident card');
      }
    }
    return { id: alert.id, isNew: true };
  }
}
