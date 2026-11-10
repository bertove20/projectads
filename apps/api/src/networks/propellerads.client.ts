/**
 * Klien Propeller SSP API v5 — hanya endpoint terverifikasi dari spesifikasi OpenAPI resmi
 * (docs/providers/propellerads/ssp-api-v5-2026-11-12, https://ssp-api.propellerads.com/v5/docs/).
 * Read-only: aksi tulis (play/stop, zone include/exclude, rates) menunggu approval workflow (Phase 6).
 */
import { NetworkApiError } from './network-errors';
import type { MinuteRateLimiter } from './rate-limiter';

/**
 * Spesifikasi menyebut header X-RateLimit-* "per minute" tanpa angka pasti → batas lokal konservatif;
 * 429 + X-RateLimit-Reset/Retry-After tetap dihormati.
 */
export const PROPELLER_LIMIT_PER_MINUTE = 30;
const PER_PAGE = 5000;

export interface PropellerCampaign {
  id: number;
  name: string;
  status: number;
  rate_model: string;
  direction_id: number;
  is_archived: number;
}

export interface PropellerStatRow {
  campaign_id: number;
  zone_id?: number | string | null;
  impressions?: number;
  clicks?: number;
  conversions?: number;
  spent?: number | string;
}

interface StatPage {
  items?: PropellerStatRow[];
  total_pages?: number;
}

export class PropellerAdsClient {
  public requestCount = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly limiter: MinuteRateLimiter,
    private readonly limiterKey: string,
    private readonly timeoutMs = 30_000,
  ) {}

  private async get<T>(path: string, query: Array<[string, string | number]> = []): Promise<T> {
    await this.limiter.acquire(`propeller:${this.limiterKey}`, PROPELLER_LIMIT_PER_MINUTE);
    const url = new URL(this.baseUrl.replace(/\/$/, '') + path);
    for (const [k, v] of query) url.searchParams.append(k, String(v));
    this.requestCount++;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
      redirect: 'error',
    });
    const text = await res.text();
    if (!res.ok) {
      let retry = Number(res.headers.get('retry-after')) || undefined;
      const reset = res.headers.get('x-ratelimit-reset');
      if (!retry && reset) retry = Math.max(1, Math.ceil((new Date(reset).getTime() - Date.now()) / 1000)) || undefined;
      let message = `HTTP ${res.status}`;
      try {
        const body = JSON.parse(text) as { message?: string; error?: string };
        message += `: ${body.message ?? body.error ?? ''}`.trimEnd();
      } catch {
        /* bukan JSON */
      }
      throw new NetworkApiError(message.slice(0, 300), res.status, retry);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new NetworkApiError('Respons bukan JSON', res.status);
    }
  }

  /** GET /adv/balance — dipakai untuk menguji token. */
  balance() {
    return this.get<string | number>('/adv/balance');
  }

  /** GET /adv/campaigns (paginasi page/page_size, maks 1000). */
  async listCampaigns(maxPages = 20): Promise<PropellerCampaign[]> {
    const out: PropellerCampaign[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const res = await this.get<{ result?: PropellerCampaign[]; meta?: { total_pages?: number } }>('/adv/campaigns', [
        ['page', page],
        ['page_size', 1000],
      ]);
      out.push(...(res.result ?? []));
      if (page >= (res.meta?.total_pages ?? 1)) break;
    }
    return out;
  }

  /**
   * GET /adv/statistics untuk satu tanggal, group_by campaign_id + zone_id, tz=+0000 (UTC).
   * Spesifikasi mendefinisikan respons sebagai array StatResponseWrapped; objek tunggal juga diterima.
   */
  async dailyStats(date: string, maxPages = 50): Promise<PropellerStatRow[]> {
    const rows: PropellerStatRow[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const res = await this.get<StatPage | StatPage[]>('/adv/statistics', [
        ['group_by[]', 'campaign_id'],
        ['group_by[]', 'zone_id'],
        ['day_from', `${date} 00:00:00`],
        ['day_to', `${date} 23:59:59`],
        ['tz', '+0000'],
        ['page', page],
        ['per_page', PER_PAGE],
      ]);
      const wrapped = Array.isArray(res) ? res[0] : res;
      const items = wrapped?.items ?? [];
      rows.push(...items);
      if (!items.length || page >= (wrapped?.total_pages ?? 1)) break;
    }
    return rows;
  }
}
