import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConversionStatus, InboundResult, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { CryptoService } from '../common/crypto/crypto.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { POSTBACK_JOB_OPTIONS, POSTBACK_QUEUE, PostbackJob } from '../common/queues';
import { INBOUND_FIELDS, mapInboundStatus, readMapping } from './mapping';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONEY_RE = /^-?\d{1,12}(\.\d{1,6})?$/;

export interface InboundRequest {
  token: string;
  params: Record<string, unknown>;
  ip: string | undefined;
  method: string;
}

export interface InboundResponse {
  httpStatus: number;
  result: InboundResult | 'NOT_FOUND';
  message?: string;
  conversionId?: string;
}

/** Transisi status yang diizinkan untuk konversi yang sudah ada. */
const ALLOWED_TRANSITIONS: Record<ConversionStatus, ConversionStatus[]> = {
  RECEIVED: ['PENDING_VERIFICATION', 'VERIFIED', 'REJECTED'],
  OBSERVED: ['PENDING_VERIFICATION', 'VERIFIED', 'REJECTED'],
  PENDING_VERIFICATION: ['VERIFIED', 'REJECTED'],
  VERIFIED: ['REVOKED'],
  REJECTED: ['VERIFIED'],
  REVOKED: [],
};

function str(v: unknown, max = 255): string | undefined {
  if (Array.isArray(v)) v = v[0];
  if (typeof v === 'number') v = String(v);
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

@Injectable()
export class ConversionService {
  private readonly logger = new Logger(ConversionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Inject(POSTBACK_QUEUE) private readonly postbackQueue: Queue<PostbackJob>,
  ) {}

  /** Postback identik yang datang bersamaan bisa bentrok (unique/serialization); ulangi agar hasilnya DUPLICATE. */
  async handleInbound(req: InboundRequest): Promise<InboundResponse> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.processInbound(req);
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (attempt < 3 && (code === 'P2002' || code === 'P2034')) continue;
        throw err;
      }
    }
  }

  /**
   * Memproses postback masuk dari affiliate network (sumber TERAUTENTIKASI → konversi VERIFIED).
   * Urutan: autentikasi token → cek IP → log mentah → validasi → upsert idempoten → antrikan postback keluar.
   */
  private async processInbound(req: InboundRequest): Promise<InboundResponse> {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(req.token)) return { httpStatus: 404, result: 'NOT_FOUND' };
    const affiliate = await this.prisma.affiliateNetwork.findUnique({
      where: { postbackTokenHash: this.crypto.sha256(req.token) },
    });
    if (!affiliate || affiliate.status !== 'ACTIVE') return { httpStatus: 404, result: 'NOT_FOUND' };

    const ipHash = this.crypto.hashIp(req.ip);
    const safeParams: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.params)) {
      const s = str(v, 500);
      if (s !== undefined && Object.keys(safeParams).length < 40) safeParams[k.slice(0, 64)] = s;
    }
    const logRow = (result: InboundResult, message?: string, conversionId?: string) =>
      this.prisma.inboundPostback.create({
        data: {
          organizationId: affiliate.organizationId,
          affiliateNetworkId: affiliate.id,
          ipHash,
          method: req.method,
          params: safeParams,
          result,
          message,
          conversionId,
        },
      });

    if (affiliate.allowedIps.length && (!req.ip || !affiliate.allowedIps.includes(req.ip))) {
      await logRow('FORBIDDEN_IP', 'IP pengirim tidak ada di allowlist');
      return { httpStatus: 403, result: 'FORBIDDEN_IP' };
    }

    const m = readMapping(affiliate.paramMapping, INBOUND_FIELDS);
    const clickId = str(req.params[m.clickId], 64);
    const payoutRaw = str(req.params[m.payout], 32);
    const currencyRaw = str(req.params[m.currency], 3)?.toUpperCase();
    const status = mapInboundStatus(str(req.params[m.status], 32));
    const transactionId = str(req.params[m.transactionId], 255);
    const goal = (str(req.params[m.goal], 50) ?? 'default').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'default';

    if (!clickId || !UUID_RE.test(clickId)) {
      await logRow('INVALID', 'click_id kosong atau bukan click ID platform');
      return { httpStatus: 200, result: 'INVALID', message: 'invalid click_id' };
    }
    if (!status) {
      await logRow('INVALID', 'status tidak dikenal');
      return { httpStatus: 200, result: 'INVALID', message: 'unknown status' };
    }
    if (payoutRaw !== undefined && !MONEY_RE.test(payoutRaw)) {
      await logRow('INVALID', 'payout tidak valid');
      return { httpStatus: 200, result: 'INVALID', message: 'invalid payout' };
    }
    if (currencyRaw !== undefined && !/^[A-Z]{3}$/.test(currencyRaw)) {
      await logRow('INVALID', 'currency tidak valid');
      return { httpStatus: 200, result: 'INVALID', message: 'invalid currency' };
    }

    const click = await this.prisma.click.findFirst({
      where: { id: clickId, organizationId: affiliate.organizationId },
      include: { offer: true, campaign: { include: { networkAccount: true } } },
    });
    if (!click) {
      await logRow('UNKNOWN_CLICK', 'click_id tidak ditemukan pada organisasi ini');
      return { httpStatus: 200, result: 'UNKNOWN_CLICK', message: 'unknown click' };
    }

    const payout = payoutRaw ?? click.offer?.payoutAmount.toString() ?? '0';
    const currency = currencyRaw ?? click.offer?.currency ?? 'USD';
    const idempotencyKey = transactionId ? `${affiliate.id}:tx:${transactionId}` : `${clickId}:goal:${goal}`;

    const outcome = await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.conversion.findUnique({ where: { idempotencyKey } });
        let conversionId: string;
        let result: InboundResult;
        let becameVerified = false;

        if (!existing) {
          const created = await tx.conversion.create({
            data: {
              organizationId: affiliate.organizationId,
              clickId,
              campaignId: click.campaignId,
              offerId: click.offerId,
              affiliateNetworkId: affiliate.id,
              goal,
              idempotencyKey,
              transactionId,
              status,
              source: 'INBOUND_POSTBACK',
              payout,
              currency,
              verifiedAt: status === 'VERIFIED' ? new Date() : null,
            },
          });
          conversionId = created.id;
          result = 'ACCEPTED';
          becameVerified = status === 'VERIFIED';
        } else if (existing.status === status) {
          conversionId = existing.id;
          result = 'DUPLICATE';
        } else if (ALLOWED_TRANSITIONS[existing.status].includes(status)) {
          await tx.conversion.update({
            where: { id: existing.id },
            data: { status, payout, currency, verifiedAt: status === 'VERIFIED' ? new Date() : existing.verifiedAt },
          });
          await tx.conversionAdjustment.create({
            data: {
              conversionId: existing.id,
              fromStatus: existing.status,
              toStatus: status,
              fromPayout: existing.payout,
              toPayout: new Prisma.Decimal(payout),
              reason: 'inbound_postback',
            },
          });
          conversionId = existing.id;
          result = 'UPDATED';
          becameVerified = status === 'VERIFIED';
        } else {
          conversionId = existing.id;
          result = 'DUPLICATE';
        }

        await tx.inboundPostback.create({
          data: {
            organizationId: affiliate.organizationId,
            affiliateNetworkId: affiliate.id,
            ipHash,
            method: req.method,
            params: safeParams,
            result,
            message: result === 'DUPLICATE' && existing && existing.status !== status ? `transisi ${existing.status}→${status} tidak diizinkan` : undefined,
            conversionId,
          },
        });

        // Hanya konversi VERIFIED dari klik non-bot dengan click ID jaringan yang dikirim ke jaringan iklan.
        let deliveryId: string | null = null;
        const campaign = click.campaign;
        if (
          becameVerified &&
          campaign.postbackEnabled &&
          goal === campaign.conversionGoal &&
          campaign.networkAccount.postbackConfigured &&
          click.externalClickId
        ) {
          const delivery = await tx.postbackDelivery.upsert({
            where: { idempotencyKey: `${conversionId}:${campaign.networkAccountId}` },
            create: {
              organizationId: affiliate.organizationId,
              conversionId,
              networkAccountId: campaign.networkAccountId,
              idempotencyKey: `${conversionId}:${campaign.networkAccountId}`,
            },
            update: {},
          });
          if (delivery.status === 'QUEUED') deliveryId = delivery.id;
        }
        return { conversionId, result, deliveryId };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 },
    );

    if (outcome.deliveryId) {
      try {
        await this.postbackQueue.add('deliver', { deliveryId: outcome.deliveryId }, { ...POSTBACK_JOB_OPTIONS, jobId: outcome.deliveryId });
      } catch (err) {
        // Tidak fatal: sweeper di worker akan mengantrikan ulang delivery berstatus QUEUED.
        this.logger.warn({ err, deliveryId: outcome.deliveryId }, 'Gagal mengantrikan postback; menunggu sweeper');
      }
    }
    return { httpStatus: 200, result: outcome.result, conversionId: outcome.conversionId };
  }
}
