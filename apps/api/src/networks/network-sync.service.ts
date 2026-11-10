import { Inject, Injectable, Logger } from '@nestjs/common';
import { NetworkAccount, Prisma } from '@prisma/client';
import { UnrecoverableError } from 'bullmq';
import type Redis from 'ioredis';
import { AlertService } from '../alerts/alert.service';
import { REDIS } from '../common/core.module';
import { CryptoService } from '../common/crypto/crypto.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { isValidTimezone, recentDates } from '../common/tz';
import { ENV, Env } from '../config/env';
import { MinuteRateLimiter } from './rate-limiter';
import { RollerAdsClient, RollerAdsError, RollerStatRow } from './rollerads.client';

/** Jaringan yang integrasi API-nya sudah diverifikasi dari dokumentasi resmi (read.md 20). */
export const API_SUPPORTED_NETWORKS = ['ROLLERADS'] as const;

export interface SyncResult {
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  rows: number;
  requests: number;
  unmapped: string[];
  pendingDates: string[];
}

@Injectable()
export class NetworkSyncService {
  private readonly logger = new Logger(NetworkSyncService.name);
  private readonly limiter: MinuteRateLimiter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly alerts: AlertService,
    @Inject(REDIS) redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.limiter = new MinuteRateLimiter(redis);
  }

  clientFor(account: Pick<NetworkAccount, 'id'>, token: string) {
    return new RollerAdsClient(this.env.ROLLERADS_API_BASE, token, this.limiter, account.id);
  }

  async tokenFor(networkAccountId: string): Promise<string | null> {
    const cred = await this.prisma.encryptedCredential.findUnique({
      where: { networkAccountId_kind: { networkAccountId, kind: 'API_TOKEN' } },
    });
    return cred ? this.crypto.decrypt(cred.ciphertext) : null;
  }

  /** Sinkronisasi statistik harian (hari ini + lookback) untuk satu akun jaringan. */
  async sync(networkAccountId: string, trigger: string): Promise<SyncResult> {
    const account = await this.prisma.networkAccount.findUnique({ where: { id: networkAccountId } });
    if (!account) throw new UnrecoverableError('akun jaringan tidak ditemukan');
    if (!(API_SUPPORTED_NETWORKS as readonly string[]).includes(account.network)) {
      throw new UnrecoverableError(`integrasi API ${account.network} belum didukung`);
    }
    const token = await this.tokenFor(account.id);
    if (!token) throw new UnrecoverableError('token API belum dikonfigurasi');

    // Lock agar dua sinkronisasi akun yang sama tidak berjalan bersamaan.
    const running = await this.prisma.syncRun.findFirst({
      where: { networkAccountId: account.id, status: 'RUNNING', startedAt: { gt: new Date(Date.now() - 30 * 60_000) } },
    });
    if (running) return { status: 'SUCCESS', rows: 0, requests: 0, unmapped: [], pendingDates: [] };

    const tz = isValidTimezone(account.networkTimezone) ? account.networkTimezone : 'UTC';
    const dates = recentDates(tz, this.env.SYNC_LOOKBACK_DAYS);
    const run = await this.prisma.syncRun.create({
      data: {
        organizationId: account.organizationId,
        networkAccountId: account.id,
        trigger,
        rangeFrom: new Date(`${dates[0]}T00:00:00Z`),
        rangeTo: new Date(`${dates[dates.length - 1]}T00:00:00Z`),
      },
    });

    const client = this.clientFor(account, token);
    const campaigns = await this.prisma.campaign.findMany({
      where: { networkAccountId: account.id, externalCampaignId: { not: null } },
      select: { id: true, externalCampaignId: true },
    });
    const campaignMap = new Map(campaigns.map((c) => [c.externalCampaignId!.trim(), c.id]));
    const unmapped = new Set<string>();
    const pendingDates: string[] = [];
    let rowsTotal = 0;
    const currency = account.networkCurrency ?? 'USD';

    try {
      for (const date of dates) {
        const { rows, pending } = await client.dailyStats(date);
        if (pending) {
          pendingDates.push(date);
          continue;
        }
        rowsTotal += await this.storeDay(account, date, rows, campaignMap, currency, unmapped);
      }
      const status = pendingDates.length ? 'PARTIAL' : 'SUCCESS';
      await this.finish(run.id, account.id, status, client.requestCount, rowsTotal, [...unmapped], pendingDates.length ? `laporan belum siap untuk ${pendingDates.join(', ')}` : null);
      await this.checkReconciliation(account, dates.slice(0, -1), tz);
      return { status, rows: rowsTotal, requests: client.requestCount, unmapped: [...unmapped], pendingDates };
    } catch (err) {
      const message = err instanceof RollerAdsError ? err.message : `${(err as Error).name}: ${(err as Error).message}`;
      await this.finish(run.id, account.id, 'FAILED', client.requestCount, rowsTotal, [...unmapped], message);
      await this.alerts.raise({
        organizationId: account.organizationId,
        type: 'NETWORK_SYNC_FAILED',
        severity: err instanceof RollerAdsError && err.isAuthError ? 'HIGH' : 'WARNING',
        title: `Sinkronisasi ${account.name} gagal`,
        body: err instanceof RollerAdsError && err.isAuthError ? 'Token API ditolak RollerAds. Periksa atau ganti token di menu Jaringan Iklan.' : message,
        dedupeKey: `sync-failed:${account.id}`,
        entityType: 'network_account',
        entityId: account.id,
      });
      if (err instanceof RollerAdsError && err.isAuthError) throw new UnrecoverableError(message);
      throw err;
    }
  }

  /** Ganti seluruh baris satu tanggal (idempoten), lalu perbarui spend API per campaign. */
  private async storeDay(
    account: NetworkAccount,
    date: string,
    rows: RollerStatRow[],
    campaignMap: Map<string, string>,
    currency: string,
    unmapped: Set<string>,
  ): Promise<number> {
    const day = new Date(`${date}T00:00:00Z`);
    // Gabungkan baris dengan kunci sama (jaga-jaga bila API mengembalikan duplikat)
    const merged = new Map<string, Prisma.NetworkStatDailyCreateManyInput>();
    for (const r of rows) {
      const ext = String(r.campaign_id);
      const zone = r.zone_id ? String(r.zone_id) : '';
      const country = /^[A-Za-z]{2}$/.test(r.country_iso2 ?? '') ? r.country_iso2.toUpperCase() : '';
      const key = `${ext}|${zone}|${country}`;
      const prev = merged.get(key);
      const spend = Number(r.amt_imoney) || 0;
      if (prev) {
        prev.impressions = (prev.impressions ?? 0) + (r.cnt_impression || 0);
        prev.clicks = (prev.clicks ?? 0) + (r.cnt_click || 0);
        prev.conversions = (prev.conversions ?? 0) + (r.cnt_conversion || 0);
        prev.spend = new Prisma.Decimal(prev.spend as Prisma.Decimal).plus(spend);
        continue;
      }
      const campaignId = campaignMap.get(ext) ?? null;
      if (!campaignId) unmapped.add(ext);
      merged.set(key, {
        organizationId: account.organizationId,
        networkAccountId: account.id,
        date: day,
        externalCampaignId: ext,
        campaignId,
        zoneId: zone,
        country,
        impressions: r.cnt_impression || 0,
        clicks: r.cnt_click || 0,
        conversions: r.cnt_conversion || 0,
        spend: new Prisma.Decimal(spend),
        currency,
      });
    }
    const data = [...merged.values()];

    // Spend per campaign internal untuk tanggal ini
    const spendByCampaign = new Map<string, Prisma.Decimal>();
    for (const d of data) {
      if (!d.campaignId) continue;
      spendByCampaign.set(d.campaignId, (spendByCampaign.get(d.campaignId) ?? new Prisma.Decimal(0)).plus(d.spend as Prisma.Decimal));
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.networkStatDaily.deleteMany({ where: { networkAccountId: account.id, date: day } });
      for (let i = 0; i < data.length; i += 1000) await tx.networkStatDaily.createMany({ data: data.slice(i, i + 1000) });
      for (const [campaignId, amount] of spendByCampaign) {
        await tx.spendEntry.upsert({
          where: { campaignId_date_source: { campaignId, date: day, source: 'API' } },
          create: { organizationId: account.organizationId, campaignId, date: day, amount, currency, source: 'API', note: `sync ${account.name}` },
          update: { amount, currency },
        });
      }
    }, { timeout: 60_000 });
    return data.length;
  }

  private async finish(runId: string, accountId: string, status: 'SUCCESS' | 'PARTIAL' | 'FAILED', requests: number, rows: number, unmapped: string[], error: string | null) {
    await this.prisma.$transaction([
      this.prisma.syncRun.update({
        where: { id: runId },
        data: { status, requestCount: requests, rowsUpserted: rows, unmappedCampaigns: unmapped.slice(0, 200), error, finishedAt: new Date() },
      }),
      this.prisma.networkAccount.update({
        where: { id: accountId },
        data: { lastSyncAt: new Date(), lastSyncStatus: status, lastSyncError: error },
      }),
    ]);
  }

  /** Alert bila klik internal vs jaringan berselisih melebihi ambang (hari yang sudah lengkap saja). */
  private async checkReconciliation(account: NetworkAccount, completedDates: string[], tz: string) {
    if (!completedDates.length) return;
    const from = completedDates[0];
    const to = completedDates[completedDates.length - 1];
    const rows = await this.prisma.$queryRaw<Array<{ campaign_id: string; name: string; date: string; network_clicks: bigint; internal_clicks: bigint }>>`
      WITH net AS (
        SELECT campaign_id, to_char(date, 'YYYY-MM-DD') AS date, sum(clicks) AS clicks
        FROM network_stats_daily
        WHERE network_account_id = ${account.id}::uuid AND campaign_id IS NOT NULL
          AND date BETWEEN ${from}::date AND ${to}::date
        GROUP BY 1, 2
      ), int AS (
        SELECT c.campaign_id, to_char((c.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS date, count(*) AS clicks
        FROM clicks c JOIN campaigns ca ON ca.id = c.campaign_id
        WHERE ca.network_account_id = ${account.id}::uuid
          AND c.created_at >= (${from}::date::timestamp AT TIME ZONE ${tz}) AT TIME ZONE 'UTC' - interval '1 day'
          AND c.created_at <  (${to}::date::timestamp AT TIME ZONE ${tz}) AT TIME ZONE 'UTC' + interval '2 day'
        GROUP BY 1, 2
      )
      SELECT net.campaign_id::text AS campaign_id, ca.name, net.date, net.clicks AS network_clicks, coalesce(int.clicks, 0) AS internal_clicks
      FROM net
      JOIN campaigns ca ON ca.id = net.campaign_id
      LEFT JOIN int ON int.campaign_id = net.campaign_id AND int.date = net.date`;
    for (const r of rows) {
      const n = Number(r.network_clicks);
      const i = Number(r.internal_clicks);
      if (n < this.env.RECON_MIN_CLICKS) continue;
      const gap = Math.abs(i - n) / n;
      if (gap * 100 < this.env.RECON_THRESHOLD_PCT) continue;
      await this.alerts.raise({
        organizationId: account.organizationId,
        type: 'RECONCILIATION_GAP',
        severity: gap >= 0.5 ? 'HIGH' : 'WARNING',
        title: `Selisih klik ${Math.round(gap * 100)}% — ${r.name}`,
        body: `${r.date} (${tz}): jaringan ${n} klik, tracking internal ${i} klik. Periksa tracking link, macro click ID, dan redirect.`,
        dedupeKey: `recon:${r.campaign_id}:${r.date}`,
        entityType: 'campaign',
        entityId: r.campaign_id,
      });
    }
  }
}
