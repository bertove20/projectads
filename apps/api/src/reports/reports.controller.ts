import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConversionStatus, DeliveryStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { IsNumberString, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { AuthUser, CurrentUser, Org, OrgContext, RequirePermissions } from '../common/decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { POSTBACK_JOB_OPTIONS, POSTBACK_QUEUE, PostbackJob } from '../common/queues';
import { assertCampaignAccess, campaignIdScope, notFound } from '../common/scope';
import { AnalyticsService, GROUP_BY, GroupBy } from './analytics.service';

const MAX_RANGE_DAYS = 400;

function parseRange(from?: string, to?: string): { from: Date; to: Date } {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 7 * 86400_000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    throw new BadRequestException({ code: 'BAD_RANGE', message: 'Rentang tanggal tidak valid' });
  }
  if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * 86400_000) {
    throw new BadRequestException({ code: 'RANGE_TOO_LARGE', message: `Rentang maksimal ${MAX_RANGE_DAYS} hari` });
  }
  return { from: start, to: end };
}

function page(limit?: string, cursor?: string) {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return { take, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) };
}

class SpendDto {
  @IsUUID() campaignId: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date: string;
  @IsNumberString() amount: string;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

@ApiTags('reports')
@Controller()
export class ReportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly audit: AuditService,
    @Inject(POSTBACK_QUEUE) private readonly postbackQueue: Queue<PostbackJob>,
  ) {}

  @Get('analytics/report')
  @RequirePermissions('analytics.read')
  report(
    @Org() org: OrgContext,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy') groupBy: string = 'campaign',
    @Query('campaignId') campaignId?: string,
  ) {
    if (!(GROUP_BY as readonly string[]).includes(groupBy)) {
      throw new BadRequestException({ code: 'BAD_GROUP', message: `groupBy harus salah satu: ${GROUP_BY.join(', ')}` });
    }
    if (campaignId) {
      if (!/^[0-9a-f-]{36}$/i.test(campaignId)) throw new BadRequestException({ code: 'BAD_ID', message: 'campaignId tidak valid' });
      assertCampaignAccess(org, campaignId);
    }
    return this.analytics.report(org, { ...parseRange(from, to), groupBy: groupBy as GroupBy, campaignId });
  }

  @Get('clicks')
  @RequirePermissions('campaigns.read')
  clicks(@Org() org: OrgContext, @Query('from') from?: string, @Query('to') to?: string, @Query('campaignId') campaignId?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    if (campaignId) assertCampaignAccess(org, campaignId);
    const range = parseRange(from, to);
    return this.prisma.click.findMany({
      where: { AND: [campaignIdScope(org), campaignId ? { campaignId } : {}, { createdAt: { gte: range.from, lt: range.to } }] },
      select: {
        id: true, createdAt: true, campaignId: true, externalClickId: true, zoneId: true, creativeId: true, country: true,
        deviceType: true, os: true, browser: true, isBot: true, botReasons: true, clickOutAt: true, cost: true,
      },
      orderBy: { id: 'desc' },
      ...page(limit, cursor),
    });
  }

  @Get('conversions')
  @RequirePermissions('conversions.read')
  conversions(
    @Org() org: OrgContext,
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const range = parseRange(from, to);
    if (status && !(status in ConversionStatus)) throw new BadRequestException({ code: 'BAD_STATUS', message: 'Status tidak valid' });
    return this.prisma.conversion.findMany({
      where: { ...campaignIdScope(org), createdAt: { gte: range.from, lt: range.to }, ...(status ? { status: status as ConversionStatus } : {}) },
      include: {
        campaign: { select: { id: true, name: true } },
        offer: { select: { id: true, name: true } },
        affiliateNetwork: { select: { id: true, name: true } },
        deliveries: { select: { id: true, status: true, providerAccepted: true, attempts: true } },
      },
      orderBy: { createdAt: 'desc' },
      ...page(limit, cursor),
    });
  }

  @Get('postbacks/inbound')
  @RequirePermissions('postbacks.read')
  inbound(@Org() org: OrgContext, @Query('from') from?: string, @Query('to') to?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    const range = parseRange(from, to);
    return this.prisma.inboundPostback.findMany({
      where: { organizationId: org.organizationId, receivedAt: { gte: range.from, lt: range.to } },
      include: { affiliateNetwork: { select: { id: true, name: true } } },
      orderBy: { receivedAt: 'desc' },
      ...page(limit, cursor),
    });
  }

  @Get('postbacks/deliveries')
  @RequirePermissions('postbacks.read')
  deliveries(
    @Org() org: OrgContext,
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const range = parseRange(from, to);
    if (status && !(status in DeliveryStatus)) throw new BadRequestException({ code: 'BAD_STATUS', message: 'Status tidak valid' });
    return this.prisma.postbackDelivery.findMany({
      where: {
        organizationId: org.organizationId,
        createdAt: { gte: range.from, lt: range.to },
        ...(status ? { status: status as DeliveryStatus } : {}),
        ...(org.campaignIds ? { conversion: { campaignId: { in: org.campaignIds } } } : {}),
      },
      include: { networkAccount: { select: { id: true, name: true, network: true } }, conversion: { select: { id: true, campaignId: true, payout: true, currency: true } } },
      orderBy: { createdAt: 'desc' },
      ...page(limit, cursor),
    });
  }

  @Post('postbacks/deliveries/:id/retry')
  @RequirePermissions('postbacks.retry')
  @HttpCode(200)
  async retry(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const d = await this.prisma.postbackDelivery.findFirst({ where: { id, organizationId: org.organizationId }, include: { conversion: true } });
    if (!d) notFound('Delivery');
    assertCampaignAccess(org, d.conversion.campaignId);
    if (!['FAILED', 'DEAD'].includes(d.status)) {
      throw new BadRequestException({ code: 'NOT_RETRYABLE', message: `Delivery berstatus ${d.status} tidak dapat dikirim ulang` });
    }
    await this.prisma.postbackDelivery.update({ where: { id }, data: { status: 'QUEUED', lastError: null } });
    await this.postbackQueue.add('deliver', { deliveryId: id }, { ...POSTBACK_JOB_OPTIONS, jobId: `${id}:retry:${Date.now()}` });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'postback.retry', entityType: 'postback_delivery', entityId: id });
    return { ok: true };
  }

  @Get('spend')
  @RequirePermissions('analytics.read')
  spend(@Org() org: OrgContext, @Query('campaignId') campaignId?: string) {
    if (campaignId) assertCampaignAccess(org, campaignId);
    return this.prisma.spendEntry.findMany({
      where: { AND: [campaignIdScope(org), campaignId ? { campaignId } : {}] },
      include: { campaign: { select: { id: true, name: true } } },
      orderBy: { date: 'desc' },
      take: 500,
    });
  }

  /** Catat / timpa spend manual untuk satu campaign pada satu tanggal. */
  @Post('spend')
  @RequirePermissions('spend.manage')
  async upsertSpend(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Body() dto: SpendDto) {
    assertCampaignAccess(org, dto.campaignId);
    const campaign = await this.prisma.campaign.findFirst({ where: { id: dto.campaignId, organizationId: org.organizationId } });
    if (!campaign) notFound('Campaign');
    if (Number(dto.amount) < 0) throw new BadRequestException({ code: 'BAD_AMOUNT', message: 'Spend tidak boleh negatif' });
    const date = new Date(`${dto.date}T00:00:00Z`);
    const row = await this.prisma.spendEntry.upsert({
      where: { campaignId_date_source: { campaignId: dto.campaignId, date, source: 'MANUAL' } },
      create: {
        organizationId: org.organizationId,
        campaignId: dto.campaignId,
        date,
        amount: dto.amount,
        currency: dto.currency ?? campaign.currency,
        source: 'MANUAL',
        note: dto.note,
        createdById: user.id,
      },
      update: { amount: dto.amount, currency: dto.currency ?? campaign.currency, note: dto.note, createdById: user.id },
    });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'spend.upsert', entityType: 'spend_entry', entityId: row.id, after: row });
    return row;
  }

  @Get('audit-logs')
  @RequirePermissions('audit.read')
  auditLogs(@Org() org: OrgContext, @Query('limit') limit?: string, @Query('cursor') cursor?: string, @Query('entityType') entityType?: string) {
    return this.prisma.auditLog.findMany({
      where: { organizationId: org.organizationId, ...(entityType ? { entityType: entityType.slice(0, 50) } : {}) },
      orderBy: { createdAt: 'desc' },
      ...page(limit, cursor),
    });
  }
}
