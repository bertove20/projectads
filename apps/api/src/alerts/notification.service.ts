import { Inject, Injectable, Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { CryptoService } from '../common/crypto/crypto.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { ENV, Env } from '../config/env';
import { severityAtLeast } from './alert.service';
import { formatAlert, sendTelegram, TelegramError } from './telegram';
import { ChatNotifier } from '../chat/chat-notifier.service';

/** Dijalankan worker: kirim satu alert ke semua channel aktif yang memenuhi severity minimum. */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Inject(ENV) private readonly env: Env,
    private readonly chat: ChatNotifier,
  ) {}

  async deliver(alertId: string, onlyChannelId?: string): Promise<void> {
    const alert = await this.prisma.alert.findUnique({ where: { id: alertId }, include: { organization: { select: { name: true } } } });
    if (!alert) throw new UnrecoverableError('alert tidak ditemukan');
    const channels = await this.prisma.notificationChannel.findMany({
      // Hanya platform chat aktif organisasi (Telegram atau Discord); uji kirim boleh ke channel mana pun.
      where: { organizationId: alert.organizationId, enabled: true, ...(onlyChannelId ? { id: onlyChannelId } : { type: (await this.chat.activePlatform(alert.organizationId)).platform }) },
    });

    let retryable: Error | null = null;
    for (const ch of channels) {
      if (!onlyChannelId && !severityAtLeast(alert.severity, ch.minSeverity)) continue;
      const delivery = await this.prisma.notificationDelivery.upsert({
        where: { alertId_channelId: { alertId: alert.id, channelId: ch.id } },
        create: { alertId: alert.id, channelId: ch.id },
        update: {},
      });
      if (delivery.status === 'SENT' && !onlyChannelId) continue;
      try {
        if (ch.type === 'DISCORD') {
          await this.chat.send(ch, `**${alert.severity}** · ${alert.organization.name}
**${alert.title}**
${alert.body}`);
        } else {
          const token = this.crypto.decrypt(ch.secretEnc);
          await sendTelegram(this.env.TELEGRAM_API_BASE, token, ch.target, formatAlert(alert, alert.organization.name));
        }
        await this.prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: { status: 'SENT', sentAt: new Date(), error: null, attempts: { increment: 1 } },
        });
      } catch (err) {
        const permanent = err instanceof TelegramError ? err.permanent : false;
        await this.prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: { status: 'FAILED', error: (err as Error).message.slice(0, 300), attempts: { increment: 1 } },
        });
        this.logger.warn({ alertId, channelId: ch.id, err: (err as Error).message }, 'Notifikasi gagal');
        if (!permanent) retryable = err as Error;
      }
    }
    if (retryable) throw retryable; // BullMQ retry; channel yang sudah SENT dilewati
  }
}
