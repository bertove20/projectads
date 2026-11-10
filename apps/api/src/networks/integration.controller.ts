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
import { RollerAdsError } from './rollerads.client';

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

  /** Simpan token API (terenkripsi) lalu uji dengan /whoami. Token tidak pernah dikembalikan. */
  @Put('api-token')
  @RequirePermissions('networks.credentials')
  async setToken(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApiTokenDto) {
    assertFullScope(org);
    const acc = await this.account(org, id);
    const token = dto.token.trim();
    let who;
    try {
      who = await this.sync.clientFor(acc, token).whoami();
    } catch (err) {
      const status = err instanceof RollerAdsError ? err.status : 0;
      throw new BadRequestException({
        code: 'CONNECTION_FAILED',
        message: status === 401 || status === 403 ? 'Token ditolak RollerAds' : `Tidak dapat terhubung ke RollerAds: ${(err as Error).message}`,
      });
    }
    if (!who.is_logged_in || !who.account) throw new BadRequestException({ code: 'CONNECTION_FAILED', message: 'Token tidak valid (is_logged_in=false)' });

    const tz = who.account.account_timezone;
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
          externalAccountId: String(who.account!.account_id),
          networkTimezone: isValidTimezone(tz) ? tz : null,
          networkCurrency: /^[A-Z]{3}$/.test(who.account!.account_currency ?? '') ? who.account!.account_currency : null,
        },
      });
      await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'network_account.set_api_token', entityType: 'network_account', entityId: acc.id, after: { externalAccountId: who.account!.account_id } }, tx);
    });
    return {
      ok: true,
      account: { id: who.account.account_id, title: who.account.account_title, currency: who.account.account_currency, timezone: tz },
      timezoneRecognized: isValidTimezone(tz),
      apiEnabled: who.account.is_api_enabled === 1,
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
      const who = await this.sync.clientFor(acc, token).whoami();
      return { ok: who.is_logged_in, account: who.account ? { id: who.account.account_id, title: who.account.account_title, timezone: who.account.account_timezone, currency: who.account.account_currency } : null };
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

  /** Daftar campaign di RollerAds untuk membantu memetakan external campaign ID. */
  @Get('remote-campaigns')
  @RequirePermissions('campaigns.read')
  async remoteCampaigns(@Org() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    const acc = await this.account(org, id);
    const token = await this.sync.tokenFor(acc.id);
    if (!token) throw new BadRequestException({ code: 'NO_TOKEN', message: 'Token API belum dikonfigurasi' });
    const [remote, mapped] = await Promise.all([
      this.sync.clientFor(acc, token).listCampaigns(),
      this.prisma.campaign.findMany({ where: { networkAccountId: acc.id, externalCampaignId: { not: null } }, select: { id: true, name: true, externalCampaignId: true } }),
    ]);
    const byExt = new Map(mapped.map((m) => [m.externalCampaignId, m]));
    return remote.map((r) => ({ ...r, mappedTo: byExt.get(String(r.campaign_id)) ?? null }));
  }
}
