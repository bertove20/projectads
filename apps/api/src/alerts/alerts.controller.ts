import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AlertStatus, Prisma, Severity } from '@prisma/client';
import { Queue } from 'bullmq';
import { IsBoolean, IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { AuthUser, CurrentUser, Org, OrgContext, RequirePermissions } from '../common/decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { NOTIFY_QUEUE, NotifyJob } from '../common/queues';
import { notFound } from '../common/scope';
import { TELEGRAM_CHAT_RE, TELEGRAM_TOKEN_RE } from './telegram';

class ChannelDto {
  @IsString() @Length(2, 100) name: string;
  @Matches(TELEGRAM_CHAT_RE, { message: 'Chat ID Telegram tidak valid (angka, mis. -1001234567890, atau @namachannel)' }) target: string;
  @Matches(TELEGRAM_TOKEN_RE, { message: 'Format token bot Telegram tidak valid' }) botToken: string;
  @IsOptional() @IsEnum(Severity) minSeverity?: Severity;
}
class UpdateChannelDto {
  @IsOptional() @IsString() @Length(2, 100) name?: string;
  @IsOptional() @Matches(TELEGRAM_CHAT_RE) target?: string;
  @IsOptional() @Matches(TELEGRAM_TOKEN_RE) botToken?: string;
  @IsOptional() @IsEnum(Severity) minSeverity?: Severity;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

/**
 * Anggota dengan cakupan ASSIGNED hanya melihat alert campaign yang di-assign kepadanya.
 * Alert tingkat akun/organisasi (sinkronisasi, postback gagal) tetap terlihat karena tidak memuat data campaign lain.
 */
function alertScope(org: OrgContext): Prisma.AlertWhereInput {
  if (!org.campaignIds) return {};
  return { OR: [{ entityType: { not: 'campaign' } }, { entityType: null }, { entityType: 'campaign', entityId: { in: org.campaignIds } }] };
}

const CHANNEL_SELECT = { id: true, type: true, name: true, target: true, secretHint: true, minSeverity: true, enabled: true, lastTestAt: true, createdAt: true } as const;

@ApiTags('alerts')
@Controller()
export class AlertsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    @Inject(NOTIFY_QUEUE) private readonly queue: Queue<NotifyJob>,
  ) {}

  @Get('alerts')
  @RequirePermissions('alerts.read')
  list(@Org() org: OrgContext, @Query('status') status?: string) {
    if (status && !(status in AlertStatus)) throw new BadRequestException({ code: 'BAD_STATUS', message: 'Status tidak valid' });
    return this.prisma.alert.findMany({
      where: { organizationId: org.organizationId, ...(status ? { status: status as AlertStatus } : {}), ...alertScope(org) },
      include: { deliveries: { select: { status: true, error: true, channel: { select: { name: true } } } } },
      orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }],
      take: 200,
    });
  }

  @Get('alerts/summary')
  @RequirePermissions('alerts.read')
  async summary(@Org() org: OrgContext) {
    const rows = await this.prisma.alert.groupBy({ by: ['severity'], where: { organizationId: org.organizationId, status: 'OPEN', ...alertScope(org) }, _count: true });
    return { open: rows.reduce((s, r) => s + r._count, 0), bySeverity: Object.fromEntries(rows.map((r) => [r.severity, r._count])) };
  }

  @Post('alerts/:id/:action')
  @RequirePermissions('alerts.manage')
  @HttpCode(200)
  async transition(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('action') action: string) {
    if (!['acknowledge', 'resolve'].includes(action)) throw new BadRequestException({ code: 'BAD_ACTION', message: 'Aksi tidak dikenal' });
    const a = await this.prisma.alert.findFirst({ where: { id, organizationId: org.organizationId, ...alertScope(org) } });
    if (!a) notFound('Alert');
    const updated = await this.prisma.alert.update({
      where: { id },
      data:
        action === 'acknowledge'
          ? { status: 'ACKNOWLEDGED', acknowledgedAt: new Date(), acknowledgedById: user.id }
          : { status: 'RESOLVED', resolvedAt: new Date() },
    });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: `alert.${action}`, entityType: 'alert', entityId: id });
    return updated;
  }

  @Get('notification-channels')
  @RequirePermissions('notifications.manage')
  channels(@Org() org: OrgContext) {
    return this.prisma.notificationChannel.findMany({ where: { organizationId: org.organizationId }, select: CHANNEL_SELECT, orderBy: { createdAt: 'asc' } });
  }

  @Post('notification-channels')
  @RequirePermissions('notifications.manage')
  async createChannel(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Body() dto: ChannelDto) {
    const ch = await this.prisma.notificationChannel.create({
      data: {
        organizationId: org.organizationId,
        type: 'TELEGRAM',
        name: dto.name,
        target: dto.target,
        secretEnc: this.crypto.encrypt(dto.botToken),
        secretHint: this.crypto.hint(dto.botToken),
        minSeverity: dto.minSeverity ?? 'WARNING',
      },
      select: CHANNEL_SELECT,
    });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'notification_channel.create', entityType: 'notification_channel', entityId: ch.id, after: { name: ch.name, target: ch.target } });
    return ch;
  }

  @Patch('notification-channels/:id')
  @RequirePermissions('notifications.manage')
  async updateChannel(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateChannelDto) {
    const ch = await this.prisma.notificationChannel.findFirst({ where: { id, organizationId: org.organizationId } });
    if (!ch) notFound('Channel');
    const after = await this.prisma.notificationChannel.update({
      where: { id },
      data: {
        name: dto.name,
        target: dto.target,
        minSeverity: dto.minSeverity,
        enabled: dto.enabled,
        ...(dto.botToken ? { secretEnc: this.crypto.encrypt(dto.botToken), secretHint: this.crypto.hint(dto.botToken) } : {}),
      },
      select: CHANNEL_SELECT,
    });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'notification_channel.update', entityType: 'notification_channel', entityId: id, after: { ...dto, botToken: dto.botToken ? '[changed]' : undefined } });
    return after;
  }

  @Delete('notification-channels/:id')
  @RequirePermissions('notifications.manage')
  async deleteChannel(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const ch = await this.prisma.notificationChannel.findFirst({ where: { id, organizationId: org.organizationId } });
    if (!ch) notFound('Channel');
    await this.prisma.notificationChannel.delete({ where: { id } });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'notification_channel.delete', entityType: 'notification_channel', entityId: id, before: { name: ch.name } });
    return { ok: true };
  }

  /** Kirim pesan uji ke satu channel (melalui antrean worker, hasil terlihat di riwayat alert). */
  @Post('notification-channels/:id/test')
  @RequirePermissions('notifications.manage')
  @HttpCode(202)
  async testChannel(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const ch = await this.prisma.notificationChannel.findFirst({ where: { id, organizationId: org.organizationId } });
    if (!ch) notFound('Channel');
    const alert = await this.prisma.alert.create({
      data: {
        organizationId: org.organizationId,
        type: 'TEST',
        severity: 'INFO',
        title: 'Pesan uji dari EAIP',
        body: `Channel "${ch.name}" terhubung. Dikirim oleh ${user.name}.`,
        dedupeKey: `test:${ch.id}:${Date.now()}`,
        status: 'RESOLVED',
        resolvedAt: new Date(),
      },
    });
    await this.queue.add('notify', { alertId: alert.id, channelId: ch.id }, { attempts: 1, removeOnComplete: 100, removeOnFail: 100 });
    await this.prisma.notificationChannel.update({ where: { id }, data: { lastTestAt: new Date() } });
    return { queued: true, alertId: alert.id };
  }
}
