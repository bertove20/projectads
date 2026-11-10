import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { AuthUser, CurrentUser, Org, OrgContext, RequirePermissions } from '../common/decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { assertCampaignAccess, notFound } from '../common/scope';
import { MIN_CLICKS_PER_VARIANT, MIN_CONVERSIONS_PER_VARIANT, twoProportionPValue, verdict, wilson } from '../reports/stats';
import { normalizeConditions } from '../tracking/routing';

class VariantDto {
  @IsString() @Length(1, 60) label: string;
  @IsUUID() offerId: string;
  @IsOptional() @IsUUID() landingPageId?: string | null;
  @IsInt() @Min(0) @Max(1000) weight: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

class RouteDto {
  @IsString() @Length(1, 80) name: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsObject() conditions?: Record<string, string[]>;
  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => VariantDto) variants: VariantDto[];
}

class RoutesDto {
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => RouteDto) routes: RouteDto[];
}

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

@ApiTags('routing')
@Controller('campaigns/:id')
export class RoutesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async campaign(org: OrgContext, id: string) {
    assertCampaignAccess(org, id);
    const c = await this.prisma.campaign.findFirst({ where: { id, organizationId: org.organizationId } });
    if (!c) notFound('Campaign');
    return c;
  }

  @Get('routes')
  @RequirePermissions('campaigns.read')
  async list(@Org() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.campaign(org, id);
    return this.prisma.campaignRoute.findMany({
      where: { campaignId: id },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      include: {
        variants: {
          orderBy: { createdAt: 'asc' },
          include: { offer: { select: { id: true, name: true, status: true } }, landingPage: { select: { id: true, name: true, status: true } } },
        },
      },
    });
  }

  /**
   * Ganti seluruh konfigurasi routing campaign secara atomik. Urutan array = prioritas.
   * Varian dengan ID baru → klik lama tetap tercatat pada varian lama (riwayat laporan terjaga lewat label di audit).
   */
  @Put('routes')
  @RequirePermissions('campaigns.manage')
  async replace(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RoutesDto) {
    await this.campaign(org, id);
    const normalized = dto.routes.map((r, i) => {
      let conditions;
      try {
        conditions = normalizeConditions(r.conditions ?? {});
      } catch (err) {
        throw new BadRequestException({ code: 'BAD_CONDITIONS', message: `Route "${r.name}": ${(err as Error).message}` });
      }
      if (!r.variants.length) throw new BadRequestException({ code: 'NO_VARIANTS', message: `Route "${r.name}" belum punya varian` });
      if (!r.variants.some((v) => (v.enabled ?? true) && v.weight > 0)) {
        throw new BadRequestException({ code: 'NO_WEIGHT', message: `Route "${r.name}" butuh minimal satu varian aktif dengan bobot > 0` });
      }
      return { ...r, conditions, priority: i };
    });

    const offerIds = [...new Set(normalized.flatMap((r) => r.variants.map((v) => v.offerId)))];
    const landingIds = [...new Set(normalized.flatMap((r) => r.variants.map((v) => v.landingPageId).filter((x): x is string => !!x)))];
    const [offers, landers] = await Promise.all([
      this.prisma.offer.findMany({ where: { id: { in: offerIds }, organizationId: org.organizationId }, select: { id: true, url: true } }),
      this.prisma.landingPage.findMany({ where: { id: { in: landingIds }, organizationId: org.organizationId }, select: { id: true } }),
    ]);
    if (offers.length !== offerIds.length) throw new BadRequestException({ code: 'BAD_OFFER', message: 'Ada offer yang bukan milik organisasi ini' });
    if (landers.length !== landingIds.length) throw new BadRequestException({ code: 'BAD_LANDING', message: 'Ada landing page yang bukan milik organisasi ini' });
    const noClickId = offers.find((o) => !o.url.includes('{click_id}'));
    if (noClickId) throw new BadRequestException({ code: 'MISSING_CLICK_ID', message: 'Ada offer yang URL-nya belum memuat {click_id}' });

    const before = await this.list(org, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.campaignRoute.deleteMany({ where: { campaignId: id } });
      for (const r of normalized) {
        await tx.campaignRoute.create({
          data: {
            campaignId: id,
            name: r.name,
            priority: r.priority,
            enabled: r.enabled ?? true,
            conditions: r.conditions as Prisma.InputJsonValue,
            variants: {
              create: r.variants.map((v) => ({ label: v.label, offerId: v.offerId, landingPageId: v.landingPageId ?? null, weight: v.weight, enabled: v.enabled ?? true })),
            },
          },
        });
      }
      await this.audit.log(
        {
          organizationId: org.organizationId,
          actorUserId: user.id,
          action: 'campaign.routes_replace',
          entityType: 'campaign',
          entityId: id,
          before: before.map((r) => ({ name: r.name, conditions: r.conditions, variants: r.variants.map((v) => ({ label: v.label, weight: v.weight })) })),
          after: normalized.map((r) => ({ name: r.name, conditions: r.conditions, variants: r.variants.map((v) => ({ label: v.label, weight: v.weight })) })),
        },
        tx,
      );
    });
    return this.list(org, id);
  }

  /**
   * Hasil split test per route: klik, konversi VERIFIED, CR + interval Wilson 95%, p-value vs kontrol
   * (varian pertama), dan verdict yang konservatif.
   */
  @Get('split-test')
  @RequirePermissions('analytics.read')
  async splitTest(@Org() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Query('days') days?: string) {
    await this.campaign(org, id);
    const n = days && /^\d{1,3}$/.test(days) ? Math.min(Math.max(Number(days), 1), 365) : 30;
    const since = new Date(Date.now() - n * 86400_000);
    const orgRow = await this.prisma.organization.findUniqueOrThrow({ where: { id: org.organizationId } });

    const rows = await this.prisma.$queryRaw<Array<{ variant_id: string; clicks: bigint; bot_clicks: bigint; conversions: bigint; revenue: Prisma.Decimal | null }>>`
      SELECT c.variant_id::text AS variant_id,
             count(*) FILTER (WHERE NOT c.is_bot) AS clicks,
             count(*) FILTER (WHERE c.is_bot) AS bot_clicks,
             coalesce(sum(v.cnt) FILTER (WHERE NOT c.is_bot), 0) AS conversions,
             coalesce(sum(v.revenue) FILTER (WHERE NOT c.is_bot), 0) AS revenue
      FROM clicks c
      LEFT JOIN (
        SELECT click_id, count(*) AS cnt, sum(payout) FILTER (WHERE currency = ${orgRow.currency}) AS revenue
        FROM conversions WHERE campaign_id = ${id}::uuid AND status = 'VERIFIED' GROUP BY click_id
      ) v ON v.click_id = c.id
      WHERE c.campaign_id = ${id}::uuid AND c.variant_id IS NOT NULL AND c.created_at >= ${since}
      GROUP BY 1`;
    const stats = new Map(rows.map((r) => [r.variant_id, r]));
    const routes = await this.list(org, id);

    return {
      days: n,
      currency: orgRow.currency,
      thresholds: { minClicks: MIN_CLICKS_PER_VARIANT, minConversions: MIN_CONVERSIONS_PER_VARIANT, alpha: 0.05 },
      routes: routes.map((r) => {
        const variants = r.variants.map((v) => {
          const s = stats.get(v.id);
          const clicks = num(s?.clicks);
          const conversions = num(s?.conversions);
          return { id: v.id, label: v.label, weight: v.weight, enabled: v.enabled, offer: v.offer, landingPage: v.landingPage, clicks, botClicks: num(s?.bot_clicks), conversions, revenue: num(s?.revenue) };
        });
        const totalWeight = variants.filter((v) => v.enabled).reduce((s, v) => s + v.weight, 0);
        const control = variants[0];
        return {
          id: r.id,
          name: r.name,
          enabled: r.enabled,
          conditions: r.conditions,
          variants: variants.map((v, i) => {
            const p = i === 0 || !control ? null : twoProportionPValue(v.conversions, v.clicks, control.conversions, control.clicks);
            return {
              ...v,
              trafficShare: totalWeight > 0 && v.enabled ? v.weight / totalWeight : 0,
              cr: v.clicks > 0 ? v.conversions / v.clicks : null,
              crInterval: wilson(v.conversions, v.clicks),
              epc: v.clicks > 0 ? v.revenue / v.clicks : null,
              pValue: p,
              verdict: control ? verdict(i === 0, v.clicks, v.conversions, control.clicks, control.conversions, p) : 'insufficient_data',
            };
          }),
        };
      }),
    };
  }
}
