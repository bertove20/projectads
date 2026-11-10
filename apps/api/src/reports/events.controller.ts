import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TrackingEventType } from '@prisma/client';
import { Org, OrgContext, RequirePermissions } from '../common/decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { assertCampaignAccess } from '../common/scope';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function range(from?: string, to?: string) {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 7 * 86400_000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end || end.getTime() - start.getTime() > 400 * 86400_000) {
    throw new BadRequestException({ code: 'BAD_RANGE', message: 'Rentang tanggal tidak valid' });
  }
  return { start, end };
}

/** Urutan tahap funnel (event OBSERVED dari JS SDK) sebelum konversi VERIFIED. */
const FUNNEL: Array<{ key: string; type: TrackingEventType; label: string }> = [
  { key: 'landing_view', type: 'LANDING_VIEW', label: 'Lihat landing page' },
  { key: 'registration_started', type: 'REGISTRATION_STARTED', label: 'Mulai registrasi' },
  { key: 'registration_submitted', type: 'REGISTRATION_SUBMITTED', label: 'Kirim registrasi' },
  { key: 'registration_success_observed', type: 'REGISTRATION_SUCCESS_OBSERVED', label: 'Registrasi berhasil' },
];

@ApiTags('events')
@Controller()
export class EventsController {
  constructor(private readonly prisma: PrismaService) {}

  /** Event terbaru dari JS SDK (status OBSERVED). */
  @Get('events')
  @RequirePermissions('analytics.read')
  async list(@Org() org: OrgContext, @Query('websiteId') websiteId?: string, @Query('campaignId') campaignId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    if (websiteId && !UUID_RE.test(websiteId)) throw new BadRequestException({ code: 'BAD_ID', message: 'websiteId tidak valid' });
    if (campaignId) {
      if (!UUID_RE.test(campaignId)) throw new BadRequestException({ code: 'BAD_ID', message: 'campaignId tidak valid' });
      assertCampaignAccess(org, campaignId);
    }
    const { start, end } = range(from, to);
    return this.prisma.trackingEvent.findMany({
      where: {
        organizationId: org.organizationId,
        occurredAt: { gte: start, lt: end },
        ...(websiteId ? { websiteId } : {}),
        ...(campaignId ? { campaignId } : org.campaignIds ? { campaignId: { in: org.campaignIds } } : {}),
      },
      select: { id: true, type: true, name: true, path: true, occurredAt: true, receivedAt: true, clickId: true, campaignId: true, sessionId: true, props: true, website: { select: { id: true, name: true, domain: true } } },
      orderBy: { occurredAt: 'desc' },
      take: 200,
    });
  }

  /**
   * Funnel campaign: klik (non-bot) → tahap event SDK (klik unik yang mencapai tahap) → konversi VERIFIED.
   * Dihitung per klik, sehingga sebanding antar tahap. Tahap SDK = OBSERVED, bukan bukti konversi.
   */
  @Get('analytics/funnel')
  @RequirePermissions('analytics.read')
  async funnel(@Org() org: OrgContext, @Query('campaignId') campaignId: string, @Query('from') from?: string, @Query('to') to?: string) {
    if (!campaignId || !UUID_RE.test(campaignId)) throw new BadRequestException({ code: 'BAD_ID', message: 'campaignId wajib' });
    assertCampaignAccess(org, campaignId);
    const { start, end } = range(from, to);

    const [clickRow] = await this.prisma.$queryRaw<Array<{ clicks: bigint }>>`
      SELECT count(*) AS clicks FROM clicks
      WHERE campaign_id = ${campaignId}::uuid AND organization_id = ${org.organizationId}::uuid
        AND NOT is_bot AND created_at >= ${start} AND created_at < ${end}`;
    const stageRows = await this.prisma.$queryRaw<Array<{ type: string; clicks: bigint }>>`
      SELECT e.type::text AS type, count(DISTINCT e.click_id) AS clicks
      FROM tracking_events e
      JOIN clicks c ON c.id = e.click_id AND NOT c.is_bot
      WHERE e.campaign_id = ${campaignId}::uuid AND e.organization_id = ${org.organizationId}::uuid
        AND c.created_at >= ${start} AND c.created_at < ${end}
      GROUP BY 1`;
    const [convRow] = await this.prisma.$queryRaw<Array<{ clicks: bigint }>>`
      SELECT count(DISTINCT v.click_id) AS clicks
      FROM conversions v JOIN clicks c ON c.id = v.click_id AND NOT c.is_bot
      WHERE v.campaign_id = ${campaignId}::uuid AND v.organization_id = ${org.organizationId}::uuid AND v.status = 'VERIFIED'
        AND c.created_at >= ${start} AND c.created_at < ${end}`;

    const byType = new Map(stageRows.map((r) => [r.type, Number(r.clicks)]));
    const clicks = Number(clickRow?.clicks ?? 0);
    const stages = [
      { key: 'click', label: 'Klik (non-bot)', count: clicks, source: 'tracker' as const },
      ...FUNNEL.map((f) => ({ key: f.key, label: f.label, count: byType.get(f.type) ?? 0, source: 'sdk_observed' as const })),
      { key: 'conversion_verified', label: 'Konversi', count: Number(convRow?.clicks ?? 0), source: 'postback_verified' as const },
    ];
    return {
      range: { from: start.toISOString(), to: end.toISOString() },
      sdkActive: FUNNEL.some((f) => (byType.get(f.type) ?? 0) > 0),
      stages: stages.map((s, i) => ({
        ...s,
        rateFromClick: clicks > 0 ? s.count / clicks : null,
        rateFromPrevious: i > 0 && stages[i - 1].count > 0 ? s.count / stages[i - 1].count : null,
      })),
      notes: [
        'Setiap tahap dihitung sebagai jumlah klik unik yang mencapai tahap itu, untuk klik pada rentang tanggal ini.',
        'Tahap dari JS SDK berstatus OBSERVED (terlihat di browser) dan tidak dihitung sebagai konversi.',
        'Konversi VERIFIED hanya berasal dari postback affiliate network yang terautentikasi.',
      ],
    };
  }
}

