import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ActiveStatus } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
import { Website } from '@prisma/client';
import { randomBytes } from 'crypto';
import { ENV, Env } from '../config/env';
import { customDomainBase, trackerBase } from '../common/public-urls';
import { AuditService } from '../common/audit/audit.service';
import { AuthUser, CurrentUser, Org, OrgContext, RequirePermissions } from '../common/decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { assertFullScope, notFound } from '../common/scope';
import { isHttpUrl } from '../common/url';

const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

class WebsiteDto {
  @IsString() @Length(2, 100) name: string;
  @Matches(DOMAIN_RE, { message: 'Domain tidak valid (contoh: example.com)' }) domain: string;
}
class UpdateWebsiteDto {
  @IsOptional() @IsString() @Length(2, 100) name?: string;
  @IsOptional() @IsEnum(ActiveStatus) status?: ActiveStatus;
  /** Wajibkan consent sebelum SDK mengirim event */
  @IsOptional() @IsBoolean() requireConsent?: boolean;
  /** Domain tambahan yang boleh mengirim event JS SDK */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @Matches(DOMAIN_RE, { each: true, message: 'Domain tambahan tidak valid' }) extraDomains?: string[];
}
class LandingDto {
  @IsString() @Length(2, 100) name: string;
  @IsString() @MaxLength(2048) url: string;
  @IsOptional() @IsUUID() websiteId?: string;
}
class UpdateLandingDto {
  @IsOptional() @IsString() @Length(2, 100) name?: string;
  @IsOptional() @IsString() @MaxLength(2048) url?: string;
  @IsOptional() @IsEnum(ActiveStatus) status?: ActiveStatus;
}

@ApiTags('websites')
@Controller()
export class WebsitesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Website + potongan kode pemasangan JS SDK (sdkKey bersifat publik, bukan rahasia). */
  private withSdk(w: Website & { trackingDomains?: Array<{ hostname: string; status: string }> }) {
    // Domain tracking kustom milik website (first-party) dipakai bila ACTIVE: lebih jarang diblokir ad blocker
    const own = w.trackingDomains?.find((d) => d.status === 'ACTIVE');
    const base = own ? customDomainBase(own.hostname) : trackerBase(this.env);
    const { trackingDomains: _domains, ...rest } = w;
    return {
      ...rest,
      sdkHost: new URL(base).host,
      sdkSnippet: w.sdkKey
        ? [
            '<script>window.eaip=window.eaip||function(){(window.eaipq=window.eaipq||[]).push(arguments)}</script>',
            `<script async src="${base}/sdk.js?k=${w.sdkKey}"></script>`,
          ].join('\n')
        : null,
    };
  }

  @Get('websites')
  @RequirePermissions('websites.read')
  async list(@Org() org: OrgContext) {
    const rows = await this.prisma.website.findMany({
      where: { organizationId: org.organizationId },
      include: { trackingDomains: { select: { hostname: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((w) => this.withSdk(w));
  }

  /** Buat atau rotasi kunci JS SDK. Kunci lama langsung berhenti berlaku. */
  @Post('websites/:id/sdk-key')
  @RequirePermissions('websites.manage')
  @HttpCode(200)
  async rotateSdkKey(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    assertFullScope(org);
    const w = await this.prisma.website.findFirst({ where: { id, organizationId: org.organizationId } });
    if (!w) notFound('Website');
    const after = await this.prisma.website.update({
      where: { id },
      data: { sdkKey: randomBytes(18).toString('base64url') },
      include: { trackingDomains: { select: { hostname: true, status: true } } },
    });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: w.sdkKey ? 'website.sdk_key_rotate' : 'website.sdk_key_create', entityType: 'website', entityId: id });
    return this.withSdk(after);
  }

  @Post('websites')
  @RequirePermissions('websites.manage')
  async create(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Body() dto: WebsiteDto) {
    assertFullScope(org);
    const w = await this.prisma.website.create({ data: { organizationId: org.organizationId, name: dto.name, domain: dto.domain.toLowerCase() } });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'website.create', entityType: 'website', entityId: w.id, after: w });
    return w;
  }

  @Patch('websites/:id')
  @RequirePermissions('websites.manage')
  async update(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWebsiteDto) {
    assertFullScope(org);
    const before = await this.prisma.website.findFirst({ where: { id, organizationId: org.organizationId } });
    if (!before) notFound('Website');
    const after = await this.prisma.website.update({
      where: { id },
      data: { ...dto, extraDomains: dto.extraDomains ? [...new Set(dto.extraDomains.map((d) => d.toLowerCase()))] : undefined },
      include: { trackingDomains: { select: { hostname: true, status: true } } },
    });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'website.update', entityType: 'website', entityId: id, before, after });
    return this.withSdk(after);
  }

  @Get('landing-pages')
  @RequirePermissions('websites.read')
  listLanding(@Org() org: OrgContext) {
    return this.prisma.landingPage.findMany({
      where: { organizationId: org.organizationId },
      include: { website: { select: { id: true, name: true, domain: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('landing-pages')
  @RequirePermissions('websites.manage')
  async createLanding(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Body() dto: LandingDto) {
    assertFullScope(org);
    if (!isHttpUrl(dto.url)) throw new BadRequestException({ code: 'BAD_URL', message: 'URL landing page harus http(s)' });
    if (dto.websiteId) {
      const w = await this.prisma.website.findFirst({ where: { id: dto.websiteId, organizationId: org.organizationId } });
      if (!w) notFound('Website');
    }
    const lp = await this.prisma.landingPage.create({ data: { organizationId: org.organizationId, ...dto } });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'landing.create', entityType: 'landing_page', entityId: lp.id, after: lp });
    return lp;
  }

  @Patch('landing-pages/:id')
  @RequirePermissions('websites.manage')
  async updateLanding(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLandingDto) {
    assertFullScope(org);
    if (dto.url && !isHttpUrl(dto.url)) throw new BadRequestException({ code: 'BAD_URL', message: 'URL landing page harus http(s)' });
    const before = await this.prisma.landingPage.findFirst({ where: { id, organizationId: org.organizationId } });
    if (!before) notFound('Landing page');
    const after = await this.prisma.landingPage.update({ where: { id }, data: dto });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'landing.update', entityType: 'landing_page', entityId: id, before, after });
    return after;
  }
}
