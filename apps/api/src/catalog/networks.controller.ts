import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ActiveStatus, AdNetwork, Prisma } from '@prisma/client';
import { IsBoolean, IsEnum, IsObject, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { AuthUser, CurrentUser, Org, OrgContext, RequirePermissions } from '../common/decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { assertFullScope, notFound } from '../common/scope';
import { isHttpUrl } from '../common/url';
import { CLICK_FIELDS, normalizeMapping } from '../postbacks/mapping';
import { OUTBOUND_PLACEHOLDERS } from '../postbacks/outbound';

class NetworkAccountDto {
  @IsEnum(AdNetwork) network: AdNetwork;
  @IsString() @Length(2, 100) name: string;
  @IsOptional() @IsObject() paramMapping?: Record<string, string>;
}
class UpdateNetworkAccountDto {
  @IsOptional() @IsString() @Length(2, 100) name?: string;
  @IsOptional() @IsObject() paramMapping?: Record<string, string>;
  @IsOptional() @IsBoolean() testMode?: boolean;
  @IsOptional() @IsString() @MaxLength(500) postbackSuccessPattern?: string | null;
  @IsOptional() @IsEnum(ActiveStatus) status?: ActiveStatus;
}
class PostbackTemplateDto {
  /** URL postback dari dashboard jaringan iklan, dengan placeholder internal mis. {external_click_id} */
  @IsString() @MaxLength(2048) template: string;
}

const PUBLIC_SELECT = {
  id: true,
  network: true,
  name: true,
  paramMapping: true,
  postbackConfigured: true,
  postbackSuccessPattern: true,
  testMode: true,
  status: true,
  createdAt: true,
  apiConfigured: true,
  externalAccountId: true,
  networkTimezone: true,
  networkCurrency: true,
  syncEnabled: true,
  lastSyncAt: true,
  lastSyncStatus: true,
  lastSyncError: true,
} satisfies Prisma.NetworkAccountSelect;

@ApiTags('network accounts')
@Controller('network-accounts')
export class NetworksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
  ) {}

  @Get()
  @RequirePermissions('networks.read')
  async list(@Org() org: OrgContext) {
    const rows = await this.prisma.networkAccount.findMany({
      where: { organizationId: org.organizationId },
      select: { ...PUBLIC_SELECT, credentials: { select: { kind: true, hint: true, rotatedAt: true, createdAt: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows;
  }

  @Post()
  @RequirePermissions('networks.manage')
  async create(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Body() dto: NetworkAccountDto) {
    assertFullScope(org);
    const n = await this.prisma.networkAccount.create({
      data: {
        organizationId: org.organizationId,
        network: dto.network,
        name: dto.name,
        paramMapping: normalizeMapping(dto.paramMapping, CLICK_FIELDS) as Prisma.InputJsonValue,
      },
      select: PUBLIC_SELECT,
    });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'network_account.create', entityType: 'network_account', entityId: n.id, after: n });
    return n;
  }

  @Patch(':id')
  @RequirePermissions('networks.manage')
  async update(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateNetworkAccountDto) {
    assertFullScope(org);
    const before = await this.prisma.networkAccount.findFirst({ where: { id, organizationId: org.organizationId }, select: PUBLIC_SELECT });
    if (!before) notFound('Akun jaringan');
    if (dto.postbackSuccessPattern) {
      try {
        new RegExp(dto.postbackSuccessPattern);
      } catch {
        throw new BadRequestException({ code: 'BAD_PATTERN', message: 'Regex postbackSuccessPattern tidak valid' });
      }
    }
    // Mematikan test mode = postback asli akan dikirim ke jaringan iklan; dicatat khusus di audit.
    const after = await this.prisma.networkAccount.update({
      where: { id },
      data: {
        name: dto.name,
        testMode: dto.testMode,
        status: dto.status,
        postbackSuccessPattern: dto.postbackSuccessPattern,
        paramMapping: dto.paramMapping ? (normalizeMapping(dto.paramMapping, CLICK_FIELDS) as Prisma.InputJsonValue) : undefined,
      },
      select: PUBLIC_SELECT,
    });
    await this.audit.log({
      organizationId: org.organizationId,
      actorUserId: user.id,
      action: before.testMode && after.testMode === false ? 'network_account.go_live' : 'network_account.update',
      entityType: 'network_account',
      entityId: id,
      before,
      after,
    });
    return after;
  }

  /** Simpan template URL postback keluar (terenkripsi; mengandung kunci akun jaringan). */
  @Put(':id/postback-template')
  @RequirePermissions('networks.credentials')
  async setTemplate(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PostbackTemplateDto) {
    assertFullScope(org);
    const acc = await this.prisma.networkAccount.findFirst({ where: { id, organizationId: org.organizationId } });
    if (!acc) notFound('Akun jaringan');
    const probe = dto.template.replace(/\{[a-z_]+\}/g, 'x');
    if (!isHttpUrl(probe)) throw new BadRequestException({ code: 'BAD_URL', message: 'Template harus berupa URL http(s)' });
    if (!dto.template.includes('{external_click_id}')) {
      throw new BadRequestException({
        code: 'MISSING_PLACEHOLDER',
        message: 'Template wajib memuat {external_click_id} (click ID dari jaringan iklan). Ganti macro jaringan pada URL postback dengan placeholder ini.',
      });
    }
    const unknown = [...dto.template.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).filter((p) => !(OUTBOUND_PLACEHOLDERS as readonly string[]).includes(p));
    if (unknown.length) {
      throw new BadRequestException({ code: 'UNKNOWN_PLACEHOLDER', message: `Placeholder tidak dikenal: ${unknown.join(', ')}. Yang tersedia: ${OUTBOUND_PLACEHOLDERS.join(', ')}` });
    }
    const ciphertext = this.crypto.encrypt(dto.template);
    const hostHint = new URL(probe).host;
    await this.prisma.$transaction(async (tx) => {
      await tx.encryptedCredential.upsert({
        where: { networkAccountId_kind: { networkAccountId: id, kind: 'POSTBACK_TEMPLATE' } },
        create: { organizationId: org.organizationId, networkAccountId: id, kind: 'POSTBACK_TEMPLATE', ciphertext, hint: hostHint },
        update: { ciphertext, hint: hostHint, rotatedAt: new Date() },
      });
      await tx.networkAccount.update({ where: { id }, data: { postbackConfigured: true } });
      await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'network_account.set_postback_template', entityType: 'network_account', entityId: id, after: { host: hostHint } }, tx);
    });
    return { ok: true, host: hostHint };
  }
}
