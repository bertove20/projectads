import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { OrgContext } from '../common/decorators';
import { PrismaService } from '../common/prisma/prisma.service';

export const GROUP_BY = ['campaign', 'offer', 'landing', 'zone', 'country', 'network', 'day', 'device', 'os'] as const;
export type GroupBy = (typeof GROUP_BY)[number];

export interface ReportQuery {
  from: Date;
  to: Date;
  groupBy: GroupBy;
  campaignId?: string;
}

export interface ReportRow {
  key: string | null;
  label: string;
  clicks: number;
  botClicks: number;
  clickOuts: number;
  conversions: number;
  pendingConversions: number;
  revenue: number;
  /** Konversi dalam mata uang lain yang belum dikonversi (read.md 17.7, Phase 2) */
  otherCurrencyConversions: number;
  spend: number;
  spendSource: 'reported' | 'estimated' | 'none';
  profit: number;
  cr: number | null;
  epc: number | null;
  cpa: number | null;
  roi: number | null;
}

/** Ekspresi SQL per dimensi. Hanya nilai dari whitelist ini yang masuk ke SQL (bukan input pengguna). */
function keyExpr(groupBy: GroupBy, tz: string): Prisma.Sql {
  switch (groupBy) {
    case 'campaign':
      return Prisma.sql`c.campaign_id::text`;
    case 'offer':
      return Prisma.sql`c.offer_id::text`;
    case 'landing':
      return Prisma.sql`c.landing_page_id::text`;
    case 'zone':
      return Prisma.sql`c.zone_id`;
    case 'country':
      return Prisma.sql`c.country`;
    case 'network':
      return Prisma.sql`ca.network_account_id::text`;
    case 'device':
      return Prisma.sql`c.device_type`;
    case 'os':
      return Prisma.sql`c.os`;
    case 'day':
      return Prisma.sql`to_char((c.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD')`;
  }
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async report(org: OrgContext, q: ReportQuery): Promise<{ currency: string; timezone: string; rows: ReportRow[]; totals: ReportRow; notes: string[] }> {
    const orgRow = await this.prisma.organization.findUniqueOrThrow({ where: { id: org.organizationId } });
    const tz = orgRow.timezone;
    const key = keyExpr(q.groupBy, tz);

    const scopeIds = org.campaignIds;
    if (scopeIds && scopeIds.length === 0) {
      const empty = this.finalize([], q.groupBy, orgRow.currency, tz);
      return empty;
    }
    const campaignFilter = q.campaignId
      ? Prisma.sql`AND c.campaign_id = ${q.campaignId}::uuid`
      : scopeIds
        ? Prisma.sql`AND c.campaign_id = ANY(${scopeIds}::uuid[])`
        : Prisma.empty;

    const clickRows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT ${key} AS key,
             count(*) FILTER (WHERE NOT c.is_bot)        AS clicks,
             count(*) FILTER (WHERE c.is_bot)            AS bot_clicks,
             count(c.click_out_at)                       AS click_outs,
             coalesce(sum(c.cost), 0)                    AS spend_estimated
      FROM clicks c
      JOIN campaigns ca ON ca.id = c.campaign_id
      WHERE c.organization_id = ${org.organizationId}::uuid
        AND c.created_at >= ${q.from} AND c.created_at < ${q.to}
        ${campaignFilter}
      GROUP BY 1`;

    // Konversi dihitung berdasarkan waktu konversi; dimensi diambil dari klik asalnya.
    const convRows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT ${key} AS key,
             count(*) FILTER (WHERE v.status = 'VERIFIED')                                   AS conversions,
             count(*) FILTER (WHERE v.status = 'PENDING_VERIFICATION')                       AS pending,
             coalesce(sum(v.payout) FILTER (WHERE v.status = 'VERIFIED' AND v.currency = ${orgRow.currency}), 0) AS revenue,
             count(*) FILTER (WHERE v.status = 'VERIFIED' AND v.currency <> ${orgRow.currency}) AS other_currency
      FROM conversions v
      JOIN clicks c ON c.id = v.click_id
      JOIN campaigns ca ON ca.id = c.campaign_id
      WHERE v.organization_id = ${org.organizationId}::uuid
        AND v.created_at >= ${q.from} AND v.created_at < ${q.to}
        ${campaignFilter}
      GROUP BY 1`;

    // Spend yang dilaporkan hanya tersedia per campaign & per hari.
    let spendRows: Array<Record<string, unknown>> = [];
    if (q.groupBy === 'campaign' || q.groupBy === 'day') {
      const spendKey = q.groupBy === 'campaign' ? Prisma.sql`s.campaign_id::text` : Prisma.sql`to_char(s.date, 'YYYY-MM-DD')`;
      const spendFilter = q.campaignId
        ? Prisma.sql`AND s.campaign_id = ${q.campaignId}::uuid`
        : scopeIds
          ? Prisma.sql`AND s.campaign_id = ANY(${scopeIds}::uuid[])`
          : Prisma.empty;
      // Satu sumber per campaign per hari, prioritas API → CSV → MANUAL (tidak dijumlahkan, agar tidak dobel).
      spendRows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
        WITH s AS (
          SELECT DISTINCT ON (s.campaign_id, s.date) s.campaign_id, s.date, s.amount
          FROM spend_entries s
          WHERE s.organization_id = ${org.organizationId}::uuid
            AND s.currency = ${orgRow.currency}
            AND s.date >= (${q.from}::timestamptz AT TIME ZONE ${tz})::date
            AND s.date <  (${q.to}::timestamptz AT TIME ZONE ${tz})::date
            ${spendFilter}
          ORDER BY s.campaign_id, s.date, CASE s.source WHEN 'API' THEN 0 WHEN 'CSV' THEN 1 ELSE 2 END
        )
        SELECT ${spendKey} AS key, coalesce(sum(s.amount), 0) AS spend
        FROM s
        GROUP BY 1`;
    }

    const map = new Map<string, Partial<ReportRow> & { spendEstimated?: number; spendReported?: number }>();
    const k = (v: unknown) => (v === null || v === undefined ? '__null__' : String(v));
    for (const r of clickRows) {
      map.set(k(r.key), { ...map.get(k(r.key)), key: (r.key as string) ?? null, clicks: num(r.clicks), botClicks: num(r.bot_clicks), clickOuts: num(r.click_outs), spendEstimated: num(r.spend_estimated) });
    }
    for (const r of convRows) {
      map.set(k(r.key), { ...map.get(k(r.key)), key: (r.key as string) ?? null, conversions: num(r.conversions), pendingConversions: num(r.pending), revenue: num(r.revenue), otherCurrencyConversions: num(r.other_currency) });
    }
    for (const r of spendRows) {
      map.set(k(r.key), { ...map.get(k(r.key)), key: (r.key as string) ?? null, spendReported: num(r.spend) });
    }

    const labels = await this.labels(q.groupBy, org.organizationId, [...map.values()].map((v) => v.key ?? null));
    const rows: ReportRow[] = [...map.values()].map((v) => {
      const spendSource: ReportRow['spendSource'] = v.spendReported ? 'reported' : v.spendEstimated ? 'estimated' : 'none';
      const spend = v.spendReported || v.spendEstimated || 0;
      return this.metrics({
        key: v.key ?? null,
        label: v.key ? (labels.get(v.key) ?? v.key) : '(tidak ada)',
        clicks: v.clicks ?? 0,
        botClicks: v.botClicks ?? 0,
        clickOuts: v.clickOuts ?? 0,
        conversions: v.conversions ?? 0,
        pendingConversions: v.pendingConversions ?? 0,
        revenue: v.revenue ?? 0,
        otherCurrencyConversions: v.otherCurrencyConversions ?? 0,
        spend,
        spendSource,
      });
    });
    return this.finalize(rows, q.groupBy, orgRow.currency, tz);
  }

  private metrics(r: Omit<ReportRow, 'profit' | 'cr' | 'epc' | 'cpa' | 'roi'>): ReportRow {
    const profit = r.revenue - r.spend;
    return {
      ...r,
      profit,
      cr: ratio(r.conversions, r.clicks),
      epc: ratio(r.revenue, r.clicks),
      cpa: r.conversions > 0 && r.spend > 0 ? r.spend / r.conversions : null,
      roi: ratio(profit, r.spend),
    };
  }

  private finalize(rows: ReportRow[], groupBy: GroupBy, currency: string, timezone: string) {
    rows.sort((a, b) => (groupBy === 'day' ? String(a.key).localeCompare(String(b.key)) : b.clicks - a.clicks));
    const sum = (f: (r: ReportRow) => number) => rows.reduce((s, r) => s + f(r), 0);
    const totals = this.metrics({
      key: null,
      label: 'Total',
      clicks: sum((r) => r.clicks),
      botClicks: sum((r) => r.botClicks),
      clickOuts: sum((r) => r.clickOuts),
      conversions: sum((r) => r.conversions),
      pendingConversions: sum((r) => r.pendingConversions),
      revenue: sum((r) => r.revenue),
      otherCurrencyConversions: sum((r) => r.otherCurrencyConversions),
      spend: sum((r) => r.spend),
      spendSource: rows.some((r) => r.spendSource === 'reported') ? 'reported' : rows.some((r) => r.spendSource === 'estimated') ? 'estimated' : 'none',
    });
    const notes = [
      'Klik = klik non-bot. Klik bot tetap dicatat terpisah (botClicks).',
      'Konversi & revenue = hanya status VERIFIED dari postback affiliate network yang terautentikasi.',
      'Spend "reported" = input manual/CSV/API; "estimated" = dari macro biaya per klik. Spend final mengikuti laporan jaringan.',
    ];
    if (totals.otherCurrencyConversions > 0) {
      notes.push(`Ada ${totals.otherCurrencyConversions} konversi dalam mata uang selain ${currency} yang belum dihitung ke revenue (konversi kurs: Phase 2).`);
    }
    if (groupBy !== 'campaign' && groupBy !== 'day') {
      notes.push('Pada pengelompokan ini spend hanya berupa estimasi dari macro biaya per klik.');
    }
    return { currency, timezone, rows, totals, notes };
  }

  private async labels(groupBy: GroupBy, orgId: string, keys: Array<string | null>): Promise<Map<string, string>> {
    const ids = keys.filter((k): k is string => !!k && /^[0-9a-f-]{36}$/i.test(k));
    const m = new Map<string, string>();
    if (!ids.length) return m;
    const where = { organizationId: orgId, id: { in: ids } };
    const rows =
      groupBy === 'campaign'
        ? await this.prisma.campaign.findMany({ where, select: { id: true, name: true } })
        : groupBy === 'offer'
          ? await this.prisma.offer.findMany({ where, select: { id: true, name: true } })
          : groupBy === 'landing'
            ? await this.prisma.landingPage.findMany({ where, select: { id: true, name: true } })
            : groupBy === 'network'
              ? await this.prisma.networkAccount.findMany({ where, select: { id: true, name: true } })
              : [];
    for (const r of rows) m.set(r.id, r.name);
    return m;
  }
}
