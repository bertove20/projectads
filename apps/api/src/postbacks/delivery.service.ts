import { Inject, Injectable, Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { CryptoService } from '../common/crypto/crypto.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { assertSafeOutboundUrl, UnsafeUrlError } from '../common/url';
import { ENV, Env } from '../config/env';
import { sendPostback } from './http-sender';
import { buildPostbackUrl, evaluateAcceptance } from './outbound';

/**
 * Mengirim satu postback keluar. Dipanggil oleh worker BullMQ.
 * - Melempar Error biasa  → BullMQ akan retry dengan backoff eksponensial.
 * - Melempar UnrecoverableError → tidak di-retry (konfigurasi salah / data tidak lengkap).
 */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async deliver(deliveryId: string): Promise<void> {
    const d = await this.prisma.postbackDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        conversion: { include: { click: { select: { id: true, externalClickId: true } } } },
        networkAccount: { include: { credentials: { where: { kind: 'POSTBACK_TEMPLATE' } } } },
      },
    });
    if (!d) throw new UnrecoverableError('delivery tidak ditemukan');
    if (d.status === 'DELIVERED' || d.status === 'TEST_SKIPPED') return; // idempoten

    const fail = async (message: string, unrecoverable: boolean) => {
      await this.prisma.postbackDelivery.update({
        where: { id: d.id },
        data: { status: unrecoverable ? 'DEAD' : 'FAILED', lastError: message.slice(0, 500), attempts: { increment: 1 } },
      });
      throw unrecoverable ? new UnrecoverableError(message) : new Error(message);
    };

    if (d.conversion.status !== 'VERIFIED') return fail(`konversi berstatus ${d.conversion.status}, bukan VERIFIED`, true);
    const externalClickId = d.conversion.click.externalClickId;
    if (!externalClickId) return fail('klik tidak memiliki click ID jaringan', true);
    const cred = d.networkAccount.credentials[0];
    if (!cred) return fail('template postback belum dikonfigurasi', true);

    let template: string;
    try {
      template = this.crypto.decrypt(cred.ciphertext);
    } catch {
      return fail('gagal mendekripsi template postback', true);
    }
    const urlString = buildPostbackUrl(template, {
      externalClickId,
      payout: d.conversion.payout.toString(),
      currency: d.conversion.currency,
      goal: d.conversion.goal,
      transactionId: d.conversion.transactionId,
      conversionId: d.conversion.id,
      clickId: d.conversion.click.id,
    });

    let url: URL;
    try {
      url = await assertSafeOutboundUrl(urlString, {
        allowHttp: this.env.ALLOW_INSECURE_POSTBACK,
        allowPrivate: this.env.ALLOW_PRIVATE_POSTBACK_TARGETS,
      });
    } catch (err) {
      if (err instanceof UnsafeUrlError) return fail(`URL ditolak: ${err.message}`, true);
      return fail(`DNS gagal: ${(err as Error).message}`, false);
    }

    if (d.networkAccount.testMode) {
      await this.prisma.postbackDelivery.update({
        where: { id: d.id },
        data: { status: 'TEST_SKIPPED', targetHost: url.host, lastError: null, attempts: { increment: 1 } },
      });
      this.logger.log({ deliveryId: d.id, host: url.host }, 'Test mode: postback tidak dikirim');
      return;
    }

    try {
      const res = await sendPostback(url, { allowPrivate: this.env.ALLOW_PRIVATE_POSTBACK_TARGETS });
      const accepted = evaluateAcceptance(res.statusCode, res.body, d.networkAccount.postbackSuccessPattern);
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      await this.prisma.postbackDelivery.update({
        where: { id: d.id },
        data: {
          status: ok ? 'DELIVERED' : 'FAILED',
          targetHost: url.host,
          lastStatusCode: res.statusCode,
          lastResponse: res.body.slice(0, 1000),
          providerAccepted: accepted,
          lastError: ok ? null : `HTTP ${res.statusCode}`,
          attempts: { increment: 1 },
          deliveredAt: ok ? new Date() : null,
        },
      });
      if (!ok) {
        // 4xx selain 408/429 umumnya kesalahan permanen
        const permanent = res.statusCode >= 400 && res.statusCode < 500 && ![408, 429].includes(res.statusCode);
        if (permanent) {
          await this.prisma.postbackDelivery.update({ where: { id: d.id }, data: { status: 'DEAD' } });
          throw new UnrecoverableError(`HTTP ${res.statusCode}`);
        }
        throw new Error(`HTTP ${res.statusCode}`);
      }
    } catch (err) {
      if (err instanceof UnrecoverableError || (err as Error).message.startsWith('HTTP ')) throw err;
      if (err instanceof UnsafeUrlError) return fail(`URL ditolak: ${err.message}`, true);
      return fail(`network error: ${(err as Error).message}`, false);
    }
  }

  /** Dipanggil saat semua percobaan habis. */
  async markDead(deliveryId: string, reason: string) {
    await this.prisma.postbackDelivery.updateMany({
      where: { id: deliveryId, status: { in: ['QUEUED', 'FAILED'] } },
      data: { status: 'DEAD', lastError: reason.slice(0, 500) },
    });
  }
}
