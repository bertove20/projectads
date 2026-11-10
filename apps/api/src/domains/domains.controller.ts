import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { AuthUser, CurrentUser, Org, OrgContext, RequirePermissions } from '../common/decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { trackerHost } from '../common/public-urls';
import { assertFullScope, notFound } from '../common/scope';
import { ENV, Env } from '../config/env';
import { HOSTNAME_RE } from './dns-verify';
import { DomainsService } from './domains.service';

class DomainDto {
  @IsString() @Length(4, 253) hostname: string;
  @IsOptional() @IsUUID() websiteId?: string;
}

@ApiTags('domains')
@Controller('domains')
export class DomainsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly domains: DomainsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Instruksi DNS yang ditampilkan ke pengguna. */
  private dns(hostname: string) {
    return { type: 'CNAME', name: hostname, value: trackerHost(this.env) };
  }

  @Get()
  @RequirePermissions('websites.read')
  async list(@Org() org: OrgContext) {
    const rows = await this.prisma.trackingDomain.findMany({
      where: { organizationId: org.organizationId },
      include: { website: { select: { id: true, name: true, domain: true } }, _count: { select: { campaigns: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return {
      platform: { trackerHost: trackerHost(this.env), postbackHost: new URL(this.env.POSTBACK_PUBLIC_URL ?? this.env.TRACKER_PUBLIC_URL).hostname, adminHost: new URL(this.env.DASHBOARD_ORIGIN).hostname },
      domains: rows.map((d) => ({ ...d, campaignCount: d._count.campaigns, dns: this.dns(d.hostname) })),
    };
  }

  @Post()
  @RequirePermissions('websites.manage')
  async create(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Body() dto: DomainDto) {
    assertFullScope(org);
    const hostname = dto.hostname.trim().toLowerCase().replace(/\.$/, '');
    if (this.domains.reservedHosts().includes(hostname)) {
      throw new BadRequestException({ code: 'RESERVED_HOSTNAME', message: 'Domain ini dipakai platform (admin/tracking/postback) dan tidak bisa didaftarkan' });
    }
    if (!HOSTNAME_RE.test(hostname)) throw new BadRequestException({ code: 'BAD_HOSTNAME', message: 'Nama domain tidak valid (contoh: go.brandanda.com)' });
    if (dto.websiteId) {
      const w = await this.prisma.website.findFirst({ where: { id: dto.websiteId, organizationId: org.organizationId } });
      if (!w) notFound('Website');
    }
    const exists = await this.prisma.trackingDomain.findUnique({ where: { hostname } });
    // Pesan sama untuk domain milik organisasi lain: tidak membocorkan siapa pemiliknya
    if (exists) throw new BadRequestException({ code: 'HOSTNAME_TAKEN', message: 'Domain sudah terdaftar' });

    const d = await this.prisma.trackingDomain.create({ data: { organizationId: org.organizationId, hostname, websiteId: dto.websiteId } });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'domain.create', entityType: 'tracking_domain', entityId: d.id, after: { hostname } });
    const { check, status } = await this.domains.verify(d.id); // langsung cek, sering kali DNS sudah disiapkan
    return { ...d, status, lastError: check.ok ? null : check.detail, dns: this.dns(hostname) };
  }

  @Post(':id/verify')
  @RequirePermissions('websites.manage')
  @HttpCode(200)
  async verify(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const d = await this.prisma.trackingDomain.findFirst({ where: { id, organizationId: org.organizationId } });
    if (!d) notFound('Domain');
    const { status, check } = await this.domains.verify(id);
    if (status !== d.status) {
      await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: `domain.status_${status.toLowerCase()}`, entityType: 'tracking_domain', entityId: id, after: { hostname: d.hostname, detail: check.detail } });
    }
    return { id, hostname: d.hostname, status, detail: check.detail, method: check.method };
  }

  @Delete(':id')
  @RequirePermissions('websites.manage')
  async remove(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    assertFullScope(org);
    const d = await this.prisma.trackingDomain.findFirst({ where: { id, organizationId: org.organizationId }, include: { _count: { select: { campaigns: true } } } });
    if (!d) notFound('Domain');
    if (d._count.campaigns > 0) {
      throw new BadRequestException({ code: 'DOMAIN_IN_USE', message: `Domain masih dipakai ${d._count.campaigns} campaign. Pindahkan campaign ke domain lain dulu, karena tracking link lama akan berhenti bekerja.` });
    }
    await this.prisma.trackingDomain.delete({ where: { id } });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'domain.delete', entityType: 'tracking_domain', entityId: id, before: { hostname: d.hostname } });
    return { ok: true };
  }
}
