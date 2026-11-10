import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ActiveStatus, PayoutType, Prisma } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIP,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { AuthUser, CurrentUser, Org, OrgContext, RequirePermissions } from '../common/decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { assertFullScope, notFound } from '../common/scope';
import { isHttpUrl } from '../common/url';
import { ENV, Env } from '../config/env';
import { INBOUND_FIELDS, normalizeMapping } from '../postbacks/mapping';

class AffiliateDto {
  @IsString() @Length(2, 100) name: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsIP(undefined, { each: true }) allowedIps?: string[];
  @IsOptional() @IsObject() paramMapping?: Record<string, string>;
}
class UpdateAffiliateDto {
  @IsOptional() @IsString() @Length(2, 100) name?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsIP(undefined, { each: true }) allowedIps?: string[];
  @IsOptional() @IsObject() paramMapping?: Record<string, string>;
  @IsOptional() @IsEnum(ActiveStatus) status?: ActiveStatus;
}
class OfferDto {
  @IsString() @Length(2, 150) name: string;
  @IsString() @MaxLength(2048) url: string;
  @IsOptional() @IsUUID() affiliateNetworkId?: string;
  @IsOptional() @IsEnum(PayoutType) payoutType?: PayoutType;
  @IsOptional() @IsNumberString() payoutAmount?: string;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(250) @Matches(/^[A-Z]{2}$/, { each: true }) geos?: string[];
  @IsOptional() @IsString() @MaxLength(100) category?: string;
}
class UpdateOfferDto {
  @IsOptional() @IsString() @Length(2, 150) name?: string;
  @IsOptional() @IsString() @MaxLength(2048) url?: string;
  @IsOptional() @IsEnum(PayoutType) payoutType?: PayoutType;
  @IsOptional() @IsNumberString() payoutAmount?: string;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(250) @Matches(/^[A-Z]{2}$/, { each: true }) geos?: string[];
  @IsOptional() @IsEnum(ActiveStatus) status?: ActiveStatus;
}

function assertOfferUrl(url: string) {
  if (!isHttpUrl(url)) throw new BadRequestException({ code: 'BAD_URL', message: 'URL offer harus http(s)' });
  if (!url.includes('{click_id}')) {
    throw new BadRequestException({ code: 'MISSING_CLICK_ID', message: 'URL offer wajib memuat placeholder {click_id} agar konversi bisa dilacak' });
  }
}

@ApiTags('affiliates & offers')
@Controller()
export class AffiliatesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private inboundUrl(token: string) {
    return `${this.env.TRACKER_PUBLIC_URL}/postback/in/${token}?click_id={click_id}&payout={payout}&status={status}&txid={txid}`;
  }

  @Get('affiliate-networks')
  @RequirePermissions('affiliates.read')
  list(@Org() org: OrgContext) {
    return this.prisma.affiliateNetwork.findMany({
      where: { organizationId: org.organizationId },
      select: { id: true, name: true, allowedIps: true, paramMapping: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Token postback hanya ditampilkan SEKALI pada respons ini. */
  @Post('affiliate-networks')
  @RequirePermissions('affiliates.manage')
  async create(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Body() dto: AffiliateDto) {
    assertFullScope(org);
    const token = this.crypto.randomToken(24);
    const a = await this.prisma.affiliateNetwork.create({
      data: {
        organizationId: org.organizationId,
        name: dto.name,
        allowedIps: dto.allowedIps ?? [],
        paramMapping: normalizeMapping(dto.paramMapping, INBOUND_FIELDS) as Prisma.InputJsonValue,
        postbackTokenHash: this.crypto.sha256(token),
      },
    });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'affiliate.create', entityType: 'affiliate_network', entityId: a.id, after: { name: a.name } });
    return { id: a.id, name: a.name, postbackToken: token, postbackUrl: this.inboundUrl(token) };
  }

  @Patch('affiliate-networks/:id')
  @RequirePermissions('affiliates.manage')
  async update(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAffiliateDto) {
    assertFullScope(org);
    const before = await this.prisma.affiliateNetwork.findFirst({ where: { id, organizationId: org.organizationId } });
    if (!before) notFound('Affiliate network');
    const after = await this.prisma.affiliateNetwork.update({
      where: { id },
      data: {
        name: dto.name,
        allowedIps: dto.allowedIps,
        status: dto.status,
        paramMapping: dto.paramMapping ? (normalizeMapping(dto.paramMapping, INBOUND_FIELDS) as Prisma.InputJsonValue) : undefined,
      },
    });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'affiliate.update', entityType: 'affiliate_network', entityId: id, before, after });
    return { id: after.id, name: after.name, allowedIps: after.allowedIps, paramMapping: after.paramMapping, status: after.status };
  }

  @Post('affiliate-networks/:id/rotate-token')
  @RequirePermissions('affiliates.manage')
  @HttpCode(200)
  async rotate(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    assertFullScope(org);
    const a = await this.prisma.affiliateNetwork.findFirst({ where: { id, organizationId: org.organizationId } });
    if (!a) notFound('Affiliate network');
    const token = this.crypto.randomToken(24);
    await this.prisma.affiliateNetwork.update({ where: { id }, data: { postbackTokenHash: this.crypto.sha256(token) } });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'affiliate.rotate_token', entityType: 'affiliate_network', entityId: id });
    return { postbackToken: token, postbackUrl: this.inboundUrl(token) };
  }

  @Get('offers')
  @RequirePermissions('offers.read')
  listOffers(@Org() org: OrgContext) {
    return this.prisma.offer.findMany({
      where: { organizationId: org.organizationId },
      include: { affiliateNetwork: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('offers')
  @RequirePermissions('offers.manage')
  async createOffer(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Body() dto: OfferDto) {
    assertFullScope(org);
    assertOfferUrl(dto.url);
    if (dto.affiliateNetworkId) {
      const a = await this.prisma.affiliateNetwork.findFirst({ where: { id: dto.affiliateNetworkId, organizationId: org.organizationId } });
      if (!a) notFound('Affiliate network');
    }
    const o = await this.prisma.offer.create({
      data: {
        organizationId: org.organizationId,
        name: dto.name,
        url: dto.url,
        affiliateNetworkId: dto.affiliateNetworkId,
        payoutType: dto.payoutType,
        payoutAmount: dto.payoutAmount,
        currency: dto.currency,
        geos: dto.geos,
        category: dto.category,
      },
    });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'offer.create', entityType: 'offer', entityId: o.id, after: o });
    return o;
  }

  @Patch('offers/:id')
  @RequirePermissions('offers.manage')
  async updateOffer(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOfferDto) {
    assertFullScope(org);
    if (dto.url) assertOfferUrl(dto.url);
    const before = await this.prisma.offer.findFirst({ where: { id, organizationId: org.organizationId } });
    if (!before) notFound('Offer');
    const after = await this.prisma.offer.update({ where: { id }, data: dto });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'offer.update', entityType: 'offer', entityId: id, before, after });
    return after;
  }
}
