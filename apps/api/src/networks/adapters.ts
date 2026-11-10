/**
 * Antarmuka adapter jaringan iklan (read.md Bagian C): setiap jaringan menerjemahkan API resminya
 * ke bentuk internal yang sama. Hanya kemampuan yang terverifikasi dari dokumentasi resmi yang diimplementasikan.
 */
import { NetworkApiError } from './network-errors';
import { MinuteRateLimiter } from './rate-limiter';
import { RollerAdsClient } from './rollerads.client';
import { PropellerAdsClient } from './propellerads.client';

export interface AccountInfo {
  accountId: string | null;
  title: string | null;
  /** null = API tidak menyediakan; dipakai asumsi yang terdokumentasi */
  currency: string | null;
  /** Zona waktu IANA yang dipakai laporan statistik adapter ini */
  timezone: string | null;
  apiEnabled: boolean;
}

export interface RemoteCampaign {
  id: string;
  title: string;
  status: string;
}

/** Baris statistik harian yang sudah dinormalisasi. */
export interface NormalizedStatRow {
  externalCampaignId: string;
  zoneId: string;
  /** Kode ISO-2, atau '' bila jaringan tidak menyediakan negara dalam format yang terverifikasi */
  country: string;
  impressions: number;
  clicks: number;
  conversions: number;
  spend: number;
}

export interface NetworkAdapter {
  readonly network: 'ROLLERADS' | 'PROPELLERADS';
  /** Jumlah request HTTP yang sudah dilakukan (untuk riwayat sinkronisasi) */
  readonly requestCount: number;
  /** Zona waktu tetap untuk laporan, bila adapter yang menentukannya (bukan akun) */
  readonly fixedReportTimezone: string | null;
  /** Mata uang default bila API tidak menyediakannya (asumsi terdokumentasi) */
  readonly defaultCurrency: string | null;
  testConnection(): Promise<AccountInfo>;
  listCampaigns(): Promise<RemoteCampaign[]>;
  /** Statistik satu tanggal (YYYY-MM-DD dalam zona waktu laporan). pending = laporan belum siap. */
  dailyStats(date: string): Promise<{ rows: NormalizedStatRow[]; pending: boolean }>;
}

const num = (v: unknown) => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

class RollerAdsAdapter implements NetworkAdapter {
  readonly network = 'ROLLERADS' as const;
  readonly fixedReportTimezone = null;
  readonly defaultCurrency = null;
  constructor(private readonly client: RollerAdsClient) {}
  get requestCount() {
    return this.client.requestCount;
  }
  async testConnection(): Promise<AccountInfo> {
    const who = await this.client.whoami();
    if (!who.is_logged_in || !who.account) throw new NetworkApiError('Token tidak valid (is_logged_in=false)', 401);
    return {
      accountId: String(who.account.account_id),
      title: who.account.account_title,
      currency: who.account.account_currency ?? null,
      timezone: who.account.account_timezone ?? null,
      apiEnabled: who.account.is_api_enabled === 1,
    };
  }
  async listCampaigns(): Promise<RemoteCampaign[]> {
    return (await this.client.listCampaigns()).map((c) => ({ id: String(c.campaign_id), title: c.campaign_title, status: String(c.campaign_status) }));
  }
  async dailyStats(date: string) {
    const { rows, pending } = await this.client.dailyStats(date);
    return {
      pending,
      rows: rows.map((r) => ({
        externalCampaignId: String(r.campaign_id),
        zoneId: r.zone_id ? String(r.zone_id) : '',
        country: /^[A-Za-z]{2}$/.test(r.country_iso2 ?? '') ? r.country_iso2.toUpperCase() : '',
        impressions: num(r.cnt_impression),
        clicks: num(r.cnt_click),
        conversions: num(r.cnt_conversion),
        spend: num(r.amt_imoney),
      })),
    };
  }
}

const PROPELLER_STATUS: Record<number, string> = { 1: 'draft', 2: 'moderation', 3: 'rejected', 6: 'working', 7: 'paused', 8: 'stopped' };

class PropellerAdsAdapter implements NetworkAdapter {
  readonly network = 'PROPELLERADS' as const;
  /** Statistik diminta dengan tz=+0000, jadi tanggal laporan = UTC. */
  readonly fixedReportTimezone = 'UTC';
  /** API balance tidak menyertakan mata uang; akun PropellerAds ditagih dalam USD (asumsi, read.md 20B). */
  readonly defaultCurrency = 'USD';
  constructor(private readonly client: PropellerAdsClient) {}
  get requestCount() {
    return this.client.requestCount;
  }
  async testConnection(): Promise<AccountInfo> {
    await this.client.balance(); // 401 bila token salah
    return { accountId: null, title: null, currency: null, timezone: 'UTC', apiEnabled: true };
  }
  async listCampaigns(): Promise<RemoteCampaign[]> {
    return (await this.client.listCampaigns()).map((c) => ({ id: String(c.id), title: c.name, status: PROPELLER_STATUS[c.status] ?? String(c.status) }));
  }
  async dailyStats(date: string) {
    const rows = await this.client.dailyStats(date);
    return {
      pending: false,
      rows: rows.map((r) => ({
        externalCampaignId: String(r.campaign_id),
        // zone_id dipakai sebagai group_by resmi; nama field pada baris respons tidak tercantum di skema → dibaca defensif
        zoneId: r.zone_id !== undefined && r.zone_id !== null ? String(r.zone_id) : '',
        country: '', // format country_id tidak terdokumentasi → tidak dipakai
        impressions: num(r.impressions),
        clicks: num(r.clicks),
        conversions: num(r.conversions),
        spend: num(r.spent),
      })),
    };
  }
}

export interface AdapterConfig {
  rolleradsBase: string;
  propellerBase: string;
  limiter: MinuteRateLimiter;
}

export const API_SUPPORTED_NETWORKS = ['ROLLERADS', 'PROPELLERADS'] as const;

export function createAdapter(network: string, accountId: string, token: string, cfg: AdapterConfig): NetworkAdapter {
  if (network === 'ROLLERADS') return new RollerAdsAdapter(new RollerAdsClient(cfg.rolleradsBase, token, cfg.limiter, accountId));
  if (network === 'PROPELLERADS') return new PropellerAdsAdapter(new PropellerAdsClient(cfg.propellerBase, token, cfg.limiter, accountId));
  throw new NetworkApiError(`Integrasi API ${network} belum didukung`, 400);
}

export { NetworkApiError };
