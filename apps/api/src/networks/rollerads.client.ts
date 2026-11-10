/**
 * Klien RollerAds API v2 — hanya endpoint yang terverifikasi di dokumentasi resmi
 * (docs/providers/rollerads/openapi-v2-2026-11-10.json, read.md Bagian 20).
 * Phase 2 = READ-ONLY. Aksi tulis (status, bid, budget, zone) menunggu approval workflow (Phase 6).
 */
import { NetworkApiError } from './network-errors';
import type { MinuteRateLimiter } from './rate-limiter';

/** Batas resmi per token per menit (read.md 20.2). Dipakai sedikit di bawah batas. */
export const ROLLERADS_LIMITS = { global: 280, statistics: 9 };

export interface RollerWhoami {
  is_logged_in: boolean;
  account?: {
    account_id: number;
    account_title: string;
    account_currency: string;
    account_timezone: string;
    is_api_enabled: number;
  };
}

/** Field AdvStatRow yang dipakai platform. */
export interface RollerStatRow {
  campaign_id: number;
  campaign_title: string;
  zone_id: number;
  country_iso2: string;
  cnt_impression: number;
  cnt_click: number;
  cnt_conversion: number;
  amt_imoney: number;
  ts_title?: string;
}

export interface RollerStatsPage {
  rows: RollerStatRow[];
  page?: { current: number; limit: number; max: number };
  rows_count: number;
  reportId?: string;
  last_update?: string;
}

export interface RollerCampaignListItem {
  campaign_id: number;
  campaign_title: string;
  campaign_status: string;
  format_id: number | null;
  bid_model_id: number;
  account_id: number;
}

/** Error RollerAds = NetworkApiError (status, retryAfterSec, isAuthError). */
export class RollerAdsError extends NetworkApiError {}

export class RollerAdsClient {
  public requestCount = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly limiter: MinuteRateLimiter,
    private readonly limiterKey: string,
    private readonly timeoutMs = 30_000,
  ) {}

  private async get<T>(path: string, query: Record<string, string | number> = {}, bucket: 'global' | 'statistics' = 'global'): Promise<T> {
    await this.limiter.acquire(`rollerads:${this.limiterKey}:global`, ROLLERADS_LIMITS.global);
    if (bucket === 'statistics') await this.limiter.acquire(`rollerads:${this.limiterKey}:stats`, ROLLERADS_LIMITS.statistics);

    const url = new URL(this.baseUrl.replace(/\/$/, '') + path);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    this.requestCount++;
    const res = await fetch(url, {
      // Token lewat header, bukan query string (agar tidak tercatat di log) — read.md 20.1
      headers: { 'X-ACCESS-TOKEN': this.token, Accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
      redirect: 'error',
    });
    const text = await res.text();
    if (!res.ok) {
      const retry = Number(res.headers.get('retry-after')) || undefined;
      let message = `HTTP ${res.status}`;
      try {
        const body = JSON.parse(text) as { error?: { message?: string }; message?: string };
        message += `: ${body.error?.message ?? body.message ?? ''}`.trimEnd();
      } catch {
        /* body bukan JSON */
      }
      throw new RollerAdsError(message.slice(0, 300), res.status, retry);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new RollerAdsError('Respons bukan JSON', res.status);
    }
  }

  whoami() {
    return this.get<RollerWhoami>('/whoami');
  }

  listCampaigns() {
    return this.get<RollerCampaignListItem[]>('/campaigns/list');
  }

  /**
   * Statistik advertiser satu hari, dikelompokkan campaign × negara × zone.
   * Rentang waktu memakai filter resmi `filters[ts]=bw|<from>;<to>` (zona waktu akun).
   */
  async dailyStats(date: string, maxPages = 50): Promise<{ rows: RollerStatRow[]; pending: boolean }> {
    const rows: RollerStatRow[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const res = await this.get<RollerStatsPage>(
        '/statistics/adv',
        {
          group: 'campaign-country-zone',
          'filters[ts]': `bw|${date} 00:00:00;${date} 23:59:59`,
          limit: 1000,
          page,
        },
        'statistics',
      );
      // Laporan besar dapat diproses asinkron (reportId). Endpoint polling-nya tidak terdokumentasi
      // di spesifikasi, jadi tandai "pending" dan ulangi pada sinkronisasi berikutnya.
      if (res.reportId && (!res.rows || res.rows.length === 0)) return { rows, pending: true };
      rows.push(...(res.rows ?? []));
      const max = res.page?.max ?? 1;
      if (page >= max || !res.rows?.length) break;
    }
    return { rows, pending: false };
  }
}
