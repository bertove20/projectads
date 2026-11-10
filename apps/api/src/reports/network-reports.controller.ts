import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma, ZoneListType } from '@prisma/client';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { AuthUser, CurrentUser, Org, OrgContext, RequirePermissions } from '../common/decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { assertCampaignAccess, notFound } from '../common/scope';
import { dateInTz, isDateString, isValidTimezone } from '../common/tz';
import { ENV, Env } from '../config/env';

class ZoneListDto {
  @IsUUID() networkAccountId: string;
  /** Kosong = berlaku untuk semua campaign pada akun jaringan */
  @IsOptional() @IsUUID() campaignId?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @Matches(/^[A-Za-z0-9_-]{1,64}$/, { each: true }) zoneIds: string[];
  @IsEnum(ZoneListType) listType: ZoneListType;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/** Rentang tanggal dalam zona waktu jaringan. `days` (1–92) = N hari terakhir termasuk hari ini. */
function dateRange(from: string | undefined, to: string | undefined, tz: string, days?: string): { from: string; to: string } {
  const today = dateInTz(new Date(), tz);
  const t = isDateString(to) ? to : today;
  const n = days && /^\d{1,2}$/.test(days) ? Math.min(Math.max(Number(days), 1), 92) : 7;
  const f = isDateString(from) ? from : new Date(new Date(`${t}T00:00:00Z`).getTime() - (n - 1) * 86400_000).toISOString().slice(0, 10);
  if (f > t) throw new BadRequestException({ code: 'BAD_RANGE', message: 'Tanggal awal setelah tanggal akhir' });
  if ((new Date(`${t}T00:00:00Z`).getTime() - new Date(`${f}T00:00:00Z`).getTime()) / 86400_000 > 92) {
    throw new BadRequestException({ code: 'RANGE_TOO_LARGE', message: 'Rentang maksimal 92 hari' });
  }
  return { from: f, to: t };
}

@ApiTags('network reports')
@Controller()
export class NetworkReportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Rekonsiliasi per campaign per tanggal (read.md 17.7): data jaringan vs tracking internal,
   * dengan tanggal internal dihitung dalam zona waktu akun jaringan.
   */
  @Get('analytics/reconciliation')
  @RequirePermissions('analytics.read')
  async reconciliation(@Org() org: OrgContext, @Query('networkAccountId', ParseUUIDPipe) networkAccountId: string, @Query('from') from?: string, @Query('to') to?: string, @Query('days') days?: string) {
    const acc = await this.prisma.networkAccount.findFirst({ where: { id: networkAccountId, organizationId: org.organizationId } });
    if (!acc) notFound('Akun jaringan');
    const tz = isValidTimezone(acc.networkTimezone) ? acc.networkTimezone : 'UTC';
    const range = dateRange(from, to, tz, days);
    const scope = org.campaignIds ? Prisma.sql`AND ca.id = ANY(${org.campaignIds}::uuid[])` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      WITH net AS (
        SELECT s.campaign_id, to_char(s.date, 'YYYY-MM-DD') AS date,
               sum(s.impressions) AS impressions, sum(s.clicks) AS clicks, sum(s.conversions) AS conversions, sum(s.spend) AS spend
        FROM network_stats_daily s
        WHERE s.network_account_id = ${acc.id}::uuid AND s.campaign_id IS NOT NULL
          AND s.date BETWEEN ${range.from}::date AND ${range.to}::date
        GROUP BY 1, 2
      ), clk AS (
        SELECT c.campaign_id, to_char((c.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS date,
               count(*) AS clicks, count(*) FILTER (WHERE c.is_bot) AS bot_clicks
        FROM clicks c JOIN campaigns ca ON ca.id = c.campaign_id
        WHERE ca.network_account_id = ${acc.id}::uuid
          AND c.created_at >= (${range.from}::date::timestamp AT TIME ZONE ${tz}) AT TIME ZONE 'UTC'
          AND c.created_at <  ((${range.to}::date + 1)::timestamp AT TIME ZONE ${tz}) AT TIME ZONE 'UTC'
        GROUP BY 1, 2
      ), conv AS (
        SELECT v.campaign_id, to_char((v.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS date,
               count(*) FILTER (WHERE v.status = 'VERIFIED') AS verified,
               count(DISTINCT d.conversion_id) FILTER (WHERE d.status = 'DELIVERED') AS delivered
        FROM conversions v JOIN campaigns ca ON ca.id = v.campaign_id
        LEFT JOIN postback_deliveries d ON d.conversion_id = v.id
        WHERE ca.network_account_id = ${acc.id}::uuid
          AND v.created_at >= (${range.from}::date::timestamp AT TIME ZONE ${tz}) AT TIME ZONE 'UTC'
          AND v.created_at <  ((${range.to}::date + 1)::timestamp AT TIME ZONE ${tz}) AT TIME ZONE 'UTC'
        GROUP BY 1, 2
      ), keys AS (
        SELECT campaign_id, date FROM net UNION SELECT campaign_id, date FROM clk UNION SELECT campaign_id, date FROM conv
      )
      SELECT k.campaign_id::text AS campaign_id, ca.name, k.date,
             coalesce(net.impressions, 0) AS network_impressions, coalesce(net.clicks, 0) AS network_clicks,
             coalesce(net.conversions, 0) AS network_conversions, coalesce(net.spend, 0) AS network_spend,
             coalesce(clk.clicks, 0) AS internal_clicks, coalesce(clk.bot_clicks, 0) AS internal_bot_clicks,
             coalesce(conv.verified, 0) AS internal_verified, coalesce(conv.delivered, 0) AS postbacks_delivered
      FROM keys k
      JOIN campaigns ca ON ca.id = k.campaign_id
      LEFT JOIN net  ON net.campaign_id  = k.campaign_id AND net.date  = k.date
      LEFT JOIN clk  ON clk.campaign_id  = k.campaign_id AND clk.date  = k.date
      LEFT JOIN conv ON conv.campaign_id = k.campaign_id AND conv.date = k.date
      WHERE ca.organization_id = ${org.organizationId}::uuid ${scope}
      ORDER BY k.date DESC, ca.name`;

    const threshold = this.env.RECON_THRESHOLD_PCT / 100;
    const today = dateInTz(new Date(), tz);
    const out = rows.map((r) => {
      const nc = num(r.network_clicks);
      const ic = num(r.internal_clicks);
      const clickGap = nc > 0 ? (ic - nc) / nc : null;
      const nConv = num(r.network_conversions);
      const delivered = num(r.postbacks_delivered);
      return {
        campaignId: r.campaign_id as string,
        campaign: r.name as string,
        date: r.date as string,
        isToday: r.date === today,
        networkImpressions: num(r.network_impressions),
        networkClicks: nc,
        internalClicks: ic,
        internalBotClicks: num(r.internal_bot_clicks),
        clickGap,
        networkConversions: nConv,
        internalVerified: num(r.internal_verified),
        postbacksDelivered: delivered,
        conversionGap: delivered > 0 ? (nConv - delivered) / delivered : null,
        networkSpend: num(r.network_spend),
        flagged: clickGap !== null && nc >= this.env.RECON_MIN_CLICKS && Math.abs(clickGap) >= threshold && r.date !== today,
      };
    });
    const unmapped = await this.prisma.networkStatDaily.groupBy({
      by: ['externalCampaignId'],
      where: { networkAccountId: acc.id, campaignId: null, date: { gte: new Date(`${range.from}T00:00:00Z`), lte: new Date(`${range.to}T00:00:00Z`) } },
      _sum: { spend: true, clicks: true },
    });
    return {
      timezone: tz,
      timezoneSource: acc.networkTimezone && isValidTimezone(acc.networkTimezone) ? 'network' : 'fallback-utc',
      currency: acc.networkCurrency ?? 'USD',
      thresholdPct: this.env.RECON_THRESHOLD_PCT,
      minClicks: this.env.RECON_MIN_CLICKS,
      lastSyncAt: acc.lastSyncAt,
      range,
      rows: out,
      unmappedCampaigns: unmapped.map((u) => ({ externalCampaignId: u.externalCampaignId, spend: num(u._sum.spend), clicks: num(u._sum.clicks) })),
    };
  }

  /**
   * Analisis per zone untuk satu campaign: spend & klik dari jaringan, klik/bot/konversi/revenue dari tracking internal,
   * plus rekomendasi (read.md 17.5). Rekomendasi bersifat saran; tidak ada aksi otomatis ke jaringan.
   */
  @Get('campaigns/:id/zones')
  @RequirePermissions('campaigns.read')
  async zones(@Org() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Query('from') from?: string, @Query('to') to?: string, @Query('days') days?: string) {
    assertCampaignAccess(org, id);
    const c = await this.prisma.campaign.findFirst({
      where: { id, organizationId: org.organizationId },
      include: { networkAccount: true, offer: { select: { payoutAmount: true, currency: true } } },
    });
    if (!c) notFound('Campaign');
    const tz = isValidTimezone(c.networkAccount.networkTimezone) ? c.networkAccount.networkTimezone : 'UTC';
    const range = dateRange(from, to, tz, days);
    const orgRow = await this.prisma.organization.findUniqueOrThrow({ where: { id: org.organizationId } });

    const internal = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT coalesce(c.zone_id, '') AS zone_id,
             count(*) AS clicks, count(*) FILTER (WHERE c.is_bot) AS bot_clicks, coalesce(sum(c.cost), 0) AS cost_est,
             coalesce(sum(v.cnt), 0) AS conversions, coalesce(sum(v.revenue), 0) AS revenue
      FROM clicks c
      LEFT JOIN (
        SELECT click_id, count(*) AS cnt, sum(payout) FILTER (WHERE currency = ${orgRow.currency}) AS revenue
        FROM conversions
        WHERE campaign_id = ${id}::uuid AND status = 'VERIFIED'
        GROUP BY click_id
      ) v ON v.click_id = c.id
      WHERE c.campaign_id = ${id}::uuid
        AND c.created_at >= (${range.from}::date::timestamp AT TIME ZONE ${tz}) AT TIME ZONE 'UTC'
        AND c.created_at <  ((${range.to}::date + 1)::timestamp AT TIME ZONE ${tz}) AT TIME ZONE 'UTC'
      GROUP BY 1`;
    const network = await this.prisma.networkStatDaily.groupBy({
      by: ['zoneId'],
      where: { campaignId: id, date: { gte: new Date(`${range.from}T00:00:00Z`), lte: new Date(`${range.to}T00:00:00Z`) } },
      _sum: { impressions: true, clicks: true, conversions: true, spend: true },
    });
    const lists = await this.prisma.zoneListEntry.findMany({
      where: { networkAccountId: c.networkAccountId, OR: [{ campaignId: id }, { campaignId: null }] },
    });
    const listed = new Map(lists.map((l) => [l.zoneId, l]));

    const target = c.targetCpa ? Number(c.targetCpa) : c.offer ? Number(c.offer.payoutAmount) : null;
    const zones = new Map<string, Record<string, number | string | null>>();
    for (const r of internal) {
      zones.set(String(r.zone_id), { zoneId: String(r.zone_id), clicks: num(r.clicks), botClicks: num(r.bot_clicks), conversions: num(r.conversions), revenue: num(r.revenue), costEstimate: num(r.cost_est) });
    }
    for (const n of network) {
      const z = zones.get(n.zoneId) ?? { zoneId: n.zoneId, clicks: 0, botClicks: 0, conversions: 0, revenue: 0, costEstimate: 0 };
      Object.assign(z, { networkImpressions: num(n._sum.impressions), networkClicks: num(n._sum.clicks), networkConversions: num(n._sum.conversions), networkSpend: num(n._sum.spend) });
      zones.set(n.zoneId, z);
    }
    const rows = [...zones.values()].map((z) => {
      const hasNetwork = z.networkSpend !== undefined;
      const spend = hasNetwork ? Number(z.networkSpend) : Number(z.costEstimate);
      const clicks = Number(z.clicks);
      const conv = Number(z.conversions);
      const revenue = Number(z.revenue);
      const botRate = clicks > 0 ? Number(z.botClicks) / clicks : null;
      const roi = spend > 0 ? (revenue - spend) / spend : null;
      const flags: string[] = [];
      if (target && spend >= 2 * target && conv === 0) flags.push('blacklist_candidate');
      if (clicks >= 50 && botRate !== null && botRate >= 0.5) flags.push('high_bot_rate');
      if (conv >= 3 && roi !== null && roi >= 0.3) flags.push('whitelist_candidate');
      const entry = listed.get(String(z.zoneId));
      return {
        zoneId: z.zoneId as string,
        clicks,
        botClicks: Number(z.botClicks),
        botRate,
        conversions: conv,
        revenue,
        networkClicks: hasNetwork ? Number(z.networkClicks) : null,
        networkConversions: hasNetwork ? Number(z.networkConversions) : null,
        spend,
        spendSource: hasNetwork ? 'network' : spend > 0 ? 'estimated' : 'none',
        profit: revenue - spend,
        roi,
        cpa: conv > 0 && spend > 0 ? spend / conv : null,
        flags,
        listed: entry ? { id: entry.id, listType: entry.listType, scope: entry.campaignId ? 'campaign' : 'account' } : null,
      };
    });
    rows.sort((a, b) => b.spend - a.spend || b.clicks - a.clicks);
    return {
      timezone: tz,
      currency: orgRow.currency,
      networkCurrency: c.networkAccount.networkCurrency,
      range,
      targetCpa: target,
      targetSource: c.targetCpa ? 'campaign' : c.offer ? 'offer_payout' : null,
      rows,
      notes: [
        'Kandidat blacklist: spend ≥ 2× target CPA tanpa konversi VERIFIED.',
        'Bot rate tinggi: ≥ 50% klik terdeteksi bot (minimal 50 klik).',
        'Kandidat whitelist: ≥ 3 konversi dengan ROI ≥ 30%.',
        'Rekomendasi hanya saran. Menerapkan blacklist ke jaringan dilakukan manual (ekspor) sampai approval workflow tersedia.',
      ],
    };
  }

  @Get('zone-lists')
  @RequirePermissions('campaigns.read')
  async listZoneLists(@Org() org: OrgContext, @Query('networkAccountId') networkAccountId?: string, @Query('campaignId') campaignId?: string) {
    if (campaignId) assertCampaignAccess(org, campaignId);
    return this.prisma.zoneListEntry.findMany({
      where: {
        organizationId: org.organizationId,
        ...(networkAccountId && /^[0-9a-f-]{36}$/i.test(networkAccountId) ? { networkAccountId } : {}),
        ...(campaignId ? { OR: [{ campaignId }, { campaignId: null }] } : org.campaignIds ? { OR: [{ campaignId: { in: org.campaignIds } }, { campaignId: null }] } : {}),
      },
      include: { campaign: { select: { id: true, name: true } }, networkAccount: { select: { id: true, name: true, network: true } } },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });
  }

  @Post('zone-lists')
  @RequirePermissions('campaigns.manage')
  async addZones(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Body() dto: ZoneListDto) {
    const acc = await this.prisma.networkAccount.findFirst({ where: { id: dto.networkAccountId, organizationId: org.organizationId } });
    if (!acc) notFound('Akun jaringan');
    if (dto.campaignId) {
      assertCampaignAccess(org, dto.campaignId);
      const c = await this.prisma.campaign.findFirst({ where: { id: dto.campaignId, organizationId: org.organizationId, networkAccountId: acc.id } });
      if (!c) notFound('Campaign');
    } else if (org.campaignIds) {
      throw new BadRequestException({ code: 'SCOPE_FORBIDDEN', message: 'Daftar tingkat akun memerlukan akses ke seluruh organisasi' });
    }
    const zoneIds = [...new Set(dto.zoneIds)];
    const created = await this.prisma.$transaction(async (tx) => {
      // Satu zone hanya boleh ada di satu daftar per cakupan: hapus entri lama pada cakupan yang sama.
      await tx.zoneListEntry.deleteMany({ where: { networkAccountId: acc.id, campaignId: dto.campaignId ?? null, zoneId: { in: zoneIds } } });
      await tx.zoneListEntry.createMany({
        data: zoneIds.map((zoneId) => ({
          organizationId: org.organizationId,
          networkAccountId: acc.id,
          campaignId: dto.campaignId ?? null,
          zoneId,
          listType: dto.listType,
          reason: dto.reason,
          createdById: user.id,
        })),
      });
      await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: `zone_list.add_${dto.listType.toLowerCase()}`, entityType: 'zone_list', entityId: dto.campaignId ?? acc.id, after: { zoneIds, reason: dto.reason } }, tx);
      return zoneIds.length;
    });
    return { ok: true, count: created };
  }

  @Delete('zone-lists/:id')
  @RequirePermissions('campaigns.manage')
  async removeZone(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const e = await this.prisma.zoneListEntry.findFirst({ where: { id, organizationId: org.organizationId } });
    if (!e) notFound('Entri zone');
    if (e.campaignId) assertCampaignAccess(org, e.campaignId);
    else if (org.campaignIds) throw new BadRequestException({ code: 'SCOPE_FORBIDDEN', message: 'Memerlukan akses ke seluruh organisasi' });
    await this.prisma.zoneListEntry.delete({ where: { id } });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'zone_list.remove', entityType: 'zone_list', entityId: id, before: e });
    return { ok: true };
  }
}
