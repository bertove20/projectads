import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Queue } from 'bullmq';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { AuthUser, CurrentUser, Org, OrgContext, RequirePermissions } from '../common/decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { NETWORK_SYNC_QUEUE, NetworkSyncJob } from '../common/queues';
import { assertFullScope, notFound } from '../common/scope';
import { isValidTimezone } from '../common/tz';
import { API_SUPPORTED_NETWORKS, NetworkSyncService } from './network-sync.service';
import { AccountInfo } from './adapters';
import { NetworkApiError } from './network-errors';

const NETWORK_NAME: Record<string, string> = { ROLLERADS: 'RollerAds', PROPELLERADS: 'PropellerAds' };

class ApiTokenDto {
  @IsString() @Length(8, 512) token: string;
}
class SyncSettingsDto {
  @IsOptional() @IsBoolean() syncEnabled?: boolean;
}

@ApiTags('network integration')
@Controller('network-accounts/:id')
export class IntegrationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly sync: NetworkSyncService,
    @Inject(NETWORK_SYNC_QUEUE) private readonly queue: Queue<NetworkSyncJob>,
  ) {}

  private async account(org: OrgContext, id: string) {
    const acc = await this.prisma.networkAccount.findFirst({ where: { id, organizationId: org.organizationId } });
    if (!acc) notFound('Akun jaringan');
    if (!(API_SUPPORTED_NETWORKS as readonly string[]).includes(acc.network)) {
      throw new BadRequestException({ code: 'API_NOT_SUPPORTED', message: `Integrasi API untuk ${acc.network} belum tersedia (belum diverifikasi dari dokumentasi resmi). Gunakan input spend manual.` });
    }
    return acc;
  }

  /** Simpan token API (terenkripsi) lalu uji koneksi lewat adapter jaringan. Token tidak pernah dikembalikan. */
  @Put('api-token')
  @RequirePermissions('networks.credentials')
  async setToken(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApiTokenDto) {
    assertFullScope(org);
    const acc = await this.account(org, id);
    const token = dto.token.trim();
    const name = NETWORK_NAME[acc.network] ?? acc.network;
    let info: AccountInfo;
    try {
      info = await this.sync.adapterFor(acc, token).testConnection();
    } catch (err) {
      const status = err instanceof NetworkApiError ? err.status : 0;
      throw new BadRequestException({
        code: 'CONNECTION_FAILED',
        message: status === 401 || status === 403 ? `Token ditolak ${name}` : `Tidak dapat terhubung ke ${name}: ${(err as Error).message}`,
      });
    }

    const tz = info.timezone;
    const ciphertext = this.crypto.encrypt(token);
    await this.prisma.$transaction(async (tx) => {
      await tx.encryptedCredential.upsert({
        where: { networkAccountId_kind: { networkAccountId: acc.id, kind: 'API_TOKEN' } },
        create: { organizationId: org.organizationId, networkAccountId: acc.id, kind: 'API_TOKEN', ciphertext, hint: this.crypto.hint(token) },
        update: { ciphertext, hint: this.crypto.hint(token), rotatedAt: new Date() },
      });
      await tx.networkAccount.update({
        where: { id: acc.id },
        data: {
          apiConfigured: true,
          externalAccountId: info.accountId,
          networkTimezone: isValidTimezone(tz) ? tz : null,
          networkCurrency: /^[A-Z]{3}$/.test(info.currency ?? '') ? info.currency : null,
        },
      });
      await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'network_account.set_api_token', entityType: 'network_account', entityId: acc.id, after: { externalAccountId: info.accountId } }, tx);
    });
    return {
      ok: true,
      account: { id: info.accountId, title: info.title, currency: info.currency, timezone: tz },
      timezoneRecognized: isValidTimezone(tz),
      apiEnabled: info.apiEnabled,
    };
  }

  @Post('test-connection')
  @RequirePermissions('networks.manage')
  @HttpCode(200)
  async test(@Org() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    const acc = await this.account(org, id);
    const token = await this.sync.tokenFor(acc.id);
    if (!token) throw new BadRequestException({ code: 'NO_TOKEN', message: 'Token API belum dikonfigurasi' });
    try {
      const info = await this.sync.adapterFor(acc, token).testConnection();
      return { ok: true, account: { id: info.accountId, title: info.title, timezone: info.timezone, currency: info.currency } };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  @Post('sync')
  @RequirePermissions('networks.manage')
  @HttpCode(202)
  async triggerSync(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const acc = await this.account(org, id);
    if (!acc.apiConfigured) throw new BadRequestException({ code: 'NO_TOKEN', message: 'Token API belum dikonfigurasi' });
    // jobId per menit: klik berulang tidak membuat antrean ganda
    await this.queue.add('sync', { networkAccountId: acc.id, trigger: 'manual' }, { jobId: `manual:${acc.id}:${Math.floor(Date.now() / 60_000)}`, attempts: 3, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 500, removeOnFail: 500 });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'network_account.sync_manual', entityType: 'network_account', entityId: acc.id });
    return { queued: true };
  }

  @Put('sync-settings')
  @RequirePermissions('networks.manage')
  async settings(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SyncSettingsDto) {
    const acc = await this.account(org, id);
    const after = await this.prisma.networkAccount.update({ where: { id: acc.id }, data: { syncEnabled: dto.syncEnabled } });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'network_account.sync_settings', entityType: 'network_account', entityId: acc.id, after: dto });
    return { syncEnabled: after.syncEnabled };
  }

  @Get('sync-runs')
  @RequirePermissions('networks.read')
  async runs(@Org() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.syncRun.findMany({
      where: { networkAccountId: id, organizationId: org.organizationId },
      orderBy: { startedAt: 'desc' },
      take: 30,
    });
  }

  /** Daftar campaign di jaringan iklan untuk membantu memetakan external campaign ID. */
  @Get('remote-campaigns')
  @RequirePermissions('campaigns.read')
  async remoteCampaigns(@Org() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    const acc = await this.account(org, id);
    const token = await this.sync.tokenFor(acc.id);
    if (!token) throw new BadRequestException({ code: 'NO_TOKEN', message: 'Token API belum dikonfigurasi' });
    const [remote, mapped] = await Promise.all([
      this.sync.adapterFor(acc, token).listCampaigns(),
      this.prisma.campaign.findMany({ where: { networkAccountId: acc.id, externalCampaignId: { not: null } }, select: { id: true, name: true, externalCampaignId: true } }),
    ]);
    const byExt = new Map(mapped.map((m) => [m.externalCampaignId, m]));
    return remote.map((r) => ({ ...r, mappedTo: byExt.get(r.id) ?? null }));
  }
}
