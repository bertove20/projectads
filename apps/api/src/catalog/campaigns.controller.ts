import { BadRequestException, Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ActiveStatus, AdFormat, BidModel, Campaign, FlowType, NetworkAccount } from '@prisma/client';
import { randomBytes } from 'crypto';
import { IsBoolean, IsEnum, IsNumberString, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { AuthUser, CurrentUser, Org, OrgContext, RequirePermissions } from '../common/decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { assertCampaignAccess, campaignScope, notFound } from '../common/scope';
import { isHttpUrl } from '../common/url';
import { ENV, Env } from '../config/env';
import { CLICK_FIELDS, readMapping } from '../postbacks/mapping';

class CampaignDto {
  @IsUUID() networkAccountId: string;
  @IsString() @Length(2, 150) name: string;
  @IsOptional() @IsString() @MaxLength(100) externalCampaignId?: string;
  @IsEnum(AdFormat) adFormat: AdFormat;
  @IsOptional() @IsString() @MaxLength(100) adFormatNetwork?: string;
  @IsEnum(BidModel) bidModel: BidModel;
  @IsOptional() @IsNumberString() bidAmount?: string;
  @IsOptional() @IsNumberString() targetCpa?: string;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsEnum(FlowType) flowType: FlowType;
  @IsOptional() @IsUUID() offerId?: string;
  @IsOptional() @IsUUID() landingPageId?: string;
  @IsOptional() @IsString() @MaxLength(2048) fallbackUrl?: string;
  @IsOptional() @Matches(/^[a-z0-9_-]{1,50}$/) conversionGoal?: string;
  @IsOptional() @IsBoolean() postbackEnabled?: boolean;
}

class UpdateCampaignDto {
  @IsOptional() @IsString() @Length(2, 150) name?: string;
  @IsOptional() @IsString() @MaxLength(100) externalCampaignId?: string;
  @IsOptional() @IsString() @MaxLength(100) adFormatNetwork?: string;
  @IsOptional() @IsEnum(BidModel) bidModel?: BidModel;
  @IsOptional() @IsNumberString() bidAmount?: string;
  @IsOptional() @IsNumberString() targetCpa?: string;
  @IsOptional() @IsEnum(FlowType) flowType?: FlowType;
  @IsOptional() @IsUUID() offerId?: string;
  @IsOptional() @IsUUID() landingPageId?: string;
  @IsOptional() @IsString() @MaxLength(2048) fallbackUrl?: string;
  @IsOptional() @Matches(/^[a-z0-9_-]{1,50}$/) conversionGoal?: string;
  @IsOptional() @IsBoolean() postbackEnabled?: boolean;
  @IsOptional() @IsEnum(ActiveStatus) status?: ActiveStatus;
}

const CPA_GOAL: BidModel[] = ['CPA_GOAL_CPC', 'CPA_GOAL_CPM'];

function newToken(): string {
  // 12 karakter base62-ish dari 9 byte acak; tidak dapat ditebak
  return randomBytes(9).toString('base64url');
}

@ApiTags('campaigns')
@Controller('campaigns')
export class CampaignsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Contoh tracking link. Ganti [MACRO_...] dengan macro resmi jaringan iklan (lihat dokumentasi jaringan). */
  private trackingLink(c: Campaign, acc: Pick<NetworkAccount, 'paramMapping'>) {
    const m = readMapping(acc.paramMapping, CLICK_FIELDS);
    const params = [
      `${m.externalClickId}=[MACRO_CLICK_ID]`,
      `${m.zoneId}=[MACRO_ZONE_ID]`,
      `${m.creativeId}=[MACRO_CREATIVE_ID]`,
      `${m.cost}=[MACRO_COST]`,
    ];
    return {
      base: `${this.env.TRACKER_PUBLIC_URL}/c/${c.token}`,
      example: `${this.env.TRACKER_PUBLIC_URL}/c/${c.token}?${params.join('&')}`,
      clickOut: `${this.env.TRACKER_PUBLIC_URL}/click-out?cid={cid}`,
    };
  }

  @Get()
  @RequirePermissions('campaigns.read')
  list(@Org() org: OrgContext) {
    return this.prisma.campaign.findMany({
      where: campaignScope(org),
      include: {
        networkAccount: { select: { id: true, name: true, network: true } },
        offer: { select: { id: true, name: true } },
        landingPage: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id')
  @RequirePermissions('campaigns.read')
  async get(@Org() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    const c = await this.prisma.campaign.findFirst({
      where: { AND: [campaignScope(org), { id }] },
      include: { networkAccount: true, offer: true, landingPage: true },
    });
    if (!c) notFound('Campaign');
    const { networkAccount, ...rest } = c;
    return {
      ...rest,
      networkAccount: { id: networkAccount.id, name: networkAccount.name, network: networkAccount.network, testMode: networkAccount.testMode, postbackConfigured: networkAccount.postbackConfigured },
      trackingLink: this.trackingLink(c, networkAccount),
    };
  }

  @Post()
  @RequirePermissions('campaigns.manage')
  async create(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Body() dto: CampaignDto) {
    const acc = await this.prisma.networkAccount.findFirst({ where: { id: dto.networkAccountId, organizationId: org.organizationId } });
    if (!acc) notFound('Akun jaringan');
    await this.validateTargets(org.organizationId, dto.flowType, dto.offerId, dto.landingPageId, dto.fallbackUrl);

    const isCpaGoal = CPA_GOAL.includes(dto.bidModel);
    const c = await this.prisma.$transaction(async (tx) => {
      const created = await tx.campaign.create({
        data: {
          organizationId: org.organizationId,
          networkAccountId: dto.networkAccountId,
          name: dto.name,
          token: newToken(),
          externalCampaignId: dto.externalCampaignId,
          adFormat: dto.adFormat,
          adFormatNetwork: dto.adFormatNetwork,
          bidModel: dto.bidModel,
          bidAmount: dto.bidAmount,
          targetCpa: dto.targetCpa,
          currency: dto.currency,
          flowType: dto.flowType,
          offerId: dto.offerId,
          landingPageId: dto.landingPageId,
          fallbackUrl: dto.fallbackUrl,
          conversionGoal: dto.conversionGoal,
          postbackEnabled: isCpaGoal ? true : (dto.postbackEnabled ?? false),
          status: 'PAUSED',
        },
      });
      // Anggota dengan cakupan ASSIGNED otomatis mendapat akses ke campaign yang dibuatnya.
      if (org.campaignIds && org.membershipId) {
        await tx.resourceAssignment.create({ data: { membershipId: org.membershipId, resourceType: 'CAMPAIGN', resourceId: created.id } });
      }
      await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'campaign.create', entityType: 'campaign', entityId: created.id, after: created }, tx);
      return created;
    });
    return { ...c, trackingLink: this.trackingLink(c, acc) };
  }

  @Patch(':id')
  @RequirePermissions('campaigns.manage')
  async update(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCampaignDto) {
    assertCampaignAccess(org, id);
    const before = await this.prisma.campaign.findFirst({ where: { id, organizationId: org.organizationId }, include: { networkAccount: true } });
    if (!before) notFound('Campaign');

    const flowType = dto.flowType ?? before.flowType;
    const offerId = dto.offerId ?? before.offerId ?? undefined;
    const landingPageId = dto.landingPageId ?? before.landingPageId ?? undefined;
    await this.validateTargets(org.organizationId, flowType, offerId, landingPageId, dto.fallbackUrl);

    const bidModel = dto.bidModel ?? before.bidModel;
    const isCpaGoal = CPA_GOAL.includes(bidModel);
    const postbackEnabled = isCpaGoal ? true : (dto.postbackEnabled ?? before.postbackEnabled);

    // Aturan read.md 17.18: CPA Goal tidak boleh aktif sebelum postback ke jaringan dikonfigurasi.
    const willBeActive = (dto.status ?? before.status) === 'ACTIVE';
    if (willBeActive && isCpaGoal && !before.networkAccount.postbackConfigured) {
      throw new BadRequestException({
        code: 'POSTBACK_REQUIRED',
        message: 'Campaign CPA Goal membutuhkan template postback pada akun jaringan sebelum diaktifkan',
      });
    }

    const after = await this.prisma.campaign.update({
      where: { id },
      data: { ...dto, postbackEnabled },
    });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'campaign.update', entityType: 'campaign', entityId: id, before: { ...before, networkAccount: undefined }, after });
    return after;
  }

  private async validateTargets(orgId: string, flow: FlowType, offerId?: string, landingPageId?: string, fallbackUrl?: string) {
    if (fallbackUrl && !isHttpUrl(fallbackUrl)) throw new BadRequestException({ code: 'BAD_URL', message: 'Fallback URL harus http(s)' });
    if (!offerId) throw new BadRequestException({ code: 'OFFER_REQUIRED', message: 'Campaign membutuhkan offer' });
    const offer = await this.prisma.offer.findFirst({ where: { id: offerId, organizationId: orgId } });
    if (!offer) notFound('Offer');
    if (flow === 'LANDING') {
      if (!landingPageId) throw new BadRequestException({ code: 'LANDING_REQUIRED', message: 'Flow LANDING membutuhkan landing page' });
      const lp = await this.prisma.landingPage.findFirst({ where: { id: landingPageId, organizationId: orgId } });
      if (!lp) notFound('Landing page');
    }
  }
}
