import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ActiveStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
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
  ) {}

  @Get('websites')
  @RequirePermissions('websites.read')
  list(@Org() org: OrgContext) {
    return this.prisma.website.findMany({ where: { organizationId: org.organizationId }, orderBy: { createdAt: 'desc' } });
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
    const after = await this.prisma.website.update({ where: { id }, data: dto });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'website.update', entityType: 'website', entityId: id, before, after });
    return after;
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
