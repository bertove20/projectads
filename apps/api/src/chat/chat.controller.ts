import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Req, Res, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Severity } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { AuthUser, CurrentUser, Org, OrgContext, Public, RequirePermissions } from '../common/decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { notFound } from '../common/scope';
import { ENV, Env } from '../config/env';
import { ChatCommandService } from './chat-command.service';
import { clip, DISCORD_COMMANDS, DISCORD_SNOWFLAKE, parseDiscordCommand, parseDiscordWebhook, verifyDiscordSignature } from './chat-core';
import { ChatButton, ChatNotifier, ChatReply, DiscordSecret } from './chat-notifier.service';

const STYLE: Record<NonNullable<ChatButton['style']>, number> = { success: 3, danger: 4, secondary: 2 };
/** Tombol → komponen Discord: action row (1) berisi button (2), maks 5 per baris & 5 baris. */
const components = (rows?: ChatButton[][]) =>
  (rows ?? []).slice(0, 5).map((r) => ({ type: 1, components: r.slice(0, 5).map((b) => ({ type: 2, style: STYLE[b.style ?? 'secondary'], label: b.label.slice(0, 80), custom_id: b.data.slice(0, 100) })) }));

class DiscordChannelDto {
  @IsString() @Length(2, 100) name: string;
  @Matches(DISCORD_SNOWFLAKE, { message: 'Server (guild) ID Discord berupa angka' }) guildId: string;
  @IsString() @Length(30, 300) webhookUrl: string;
  @IsOptional() @Matches(DISCORD_SNOWFLAKE, { message: 'Application ID Discord berupa angka' }) applicationId?: string;
  @IsOptional() @Matches(/^[0-9a-f]{64}$/i, { message: 'Public key aplikasi Discord berupa 64 karakter hex' }) publicKey?: string;
  @IsOptional() @IsString() @Length(50, 120) botToken?: string;
  @IsOptional() @IsEnum(Severity) minSeverity?: Severity;
}

/**
 * Integrasi chat: tautan akun, channel Discord, dan endpoint interaksi Discord (publik, diverifikasi Ed25519).
 * Telegram menerima perintah lewat long polling di worker (TelegramPoller).
 */
@ApiTags('chat')
@Controller()
export class ChatController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly commands: ChatCommandService,
    private readonly notifier: ChatNotifier,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ───────────── tautan akun chat (per anggota) ─────────────

  @Post('chat/link-code')
  @RequirePermissions('org.read')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async linkCode(@Org() org: OrgContext) {
    if (!org.membershipId) throw new ForbiddenException({ code: 'NOT_MEMBER', message: 'Hanya anggota organisasi yang bisa menautkan akun chat' });
    const { code, expiresAt } = await this.commands.createLinkCode(org.membershipId);
    return { code, expiresAt, telegram: `/hubungkan ${code}`, discord: `/eaip hubungkan kode:${code}` };
  }

  @Get('chat/identities')
  @RequirePermissions('org.read')
  async identities(@Org() org: OrgContext) {
    const all = org.isSuperAdmin || org.permissions.has('notifications.manage');
    const rows = await this.prisma.chatIdentity.findMany({
      where: { organizationId: org.organizationId, ...(all ? {} : { membershipId: org.membershipId ?? '' }) },
      include: { membership: { select: { id: true, user: { select: { name: true } } } } },
      orderBy: { linkedAt: 'desc' },
    });
    return rows.map((r) => ({ id: r.id, platform: r.platform, username: r.username, linkedAt: r.linkedAt, member: { id: r.membership.id, name: r.membership.user.name }, mine: r.membershipId === org.membershipId }));
  }

  @Delete('chat/identities/:id')
  @RequirePermissions('org.read')
  async unlink(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const row = await this.prisma.chatIdentity.findFirst({ where: { id, organizationId: org.organizationId } });
    if (!row) notFound('Akun chat');
    if (row.membershipId !== org.membershipId && !(org.isSuperAdmin || org.permissions.has('notifications.manage'))) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Bukan akun Anda' });
    await this.prisma.chatIdentity.delete({ where: { id } });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'chat.identity.unlink', entityType: 'chat_identity', entityId: id, before: { platform: row.platform, username: row.username } });
    return { ok: true };
  }

  // ───────────── channel Discord ─────────────

  @Post('notification-channels/discord')
  @RequirePermissions('notifications.manage')
  async createDiscord(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Body() dto: DiscordChannelDto) {
    if (!parseDiscordWebhook(dto.webhookUrl)) throw new UnprocessableEntityException({ code: 'BAD_WEBHOOK', message: 'URL webhook Discord tidak valid (https://discord.com/api/webhooks/…)' });
    const secret: DiscordSecret = { webhookUrl: dto.webhookUrl.trim(), botToken: dto.botToken?.trim() || null };
    const ch = await this.prisma.notificationChannel.create({
      data: {
        organizationId: org.organizationId,
        type: 'DISCORD',
        name: dto.name,
        target: dto.guildId,
        secretEnc: this.crypto.encrypt(JSON.stringify(secret)),
        secretHint: `webhook …${dto.webhookUrl.trim().slice(-4)}`,
        config: { applicationId: dto.applicationId ?? null, publicKey: dto.publicKey?.toLowerCase() ?? null },
        minSeverity: dto.minSeverity ?? 'WARNING',
      },
    });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'notification_channel.create', entityType: 'notification_channel', entityId: ch.id, after: { name: ch.name, type: 'DISCORD', guildId: dto.guildId } });
    return { id: ch.id, interactionsUrl: this.interactionsUrl(ch.id) };
  }

  interactionsUrl(id: string) {
    return this.notifier.dashboardUrl(`/api/v1/integrations/discord/${id}/interactions`);
  }

  /** Daftarkan slash command /eaip di server Discord (butuh bot token & application ID). */
  @Post('notification-channels/:id/discord/commands')
  @RequirePermissions('notifications.manage')
  @HttpCode(200)
  async registerCommands(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const ch = await this.prisma.notificationChannel.findFirst({ where: { id, organizationId: org.organizationId, type: 'DISCORD' } });
    if (!ch) notFound('Channel Discord');
    const cfg = (ch.config ?? {}) as { applicationId?: string | null };
    const secret = this.notifier.discordSecret(ch);
    if (!cfg.applicationId || !secret.botToken) throw new UnprocessableEntityException({ code: 'DISCORD_INCOMPLETE', message: 'Isi Application ID dan bot token untuk mendaftarkan perintah' });
    const res = await fetch(`${this.env.DISCORD_API_BASE.replace(/\/$/, '')}/applications/${cfg.applicationId}/guilds/${ch.target}/commands`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bot ${secret.botToken}` },
      body: JSON.stringify(DISCORD_COMMANDS),
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    }).catch(() => null);
    if (!res?.ok) throw new UnprocessableEntityException({ code: 'DISCORD_REJECTED', message: `Discord menolak pendaftaran perintah${res ? ` (HTTP ${res.status})` : ''}. Periksa bot token, Application ID, dan bot sudah diundang ke server dengan scope applications.commands.` });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'discord.commands.register', entityType: 'notification_channel', entityId: id });
    return { ok: true, commands: DISCORD_COMMANDS.map((c) => c.name) };
  }

  // ───────────── endpoint interaksi Discord (publik) ─────────────

  @Public()
  @ApiExcludeEndpoint()
  @Post('integrations/discord/:channelId/interactions')
  async interaction(@Param('channelId') channelId: string, @Req() req: RawBodyRequest<Request>, @Res() res: Response) {
    if (!/^[0-9a-f-]{36}$/i.test(channelId)) throw new NotFoundException();
    const ch = await this.prisma.notificationChannel.findFirst({ where: { id: channelId, type: 'DISCORD', enabled: true } });
    const publicKey = (ch?.config as { publicKey?: string } | null)?.publicKey;
    if (!ch || !publicKey) throw new NotFoundException();
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    if (!verifyDiscordSignature(publicKey, req.header('x-signature-ed25519'), req.header('x-signature-timestamp'), raw)) {
      throw new UnauthorizedException({ code: 'BAD_SIGNATURE', message: 'invalid request signature' });
    }
    const body = req.body as { type?: number; data?: { custom_id?: string } & Record<string, unknown>; member?: { user?: { id?: string; username?: string } }; user?: { id?: string; username?: string } };
    if (body.type === 1) return res.status(200).json({ type: 1 });
    const send = (r: ChatReply, type = 4) =>
      res.status(200).json({
        type,
        data: { content: clip(r.text, 1990), allowed_mentions: { parse: [] }, components: components(r.buttons), ...(r.ephemeral && type === 4 ? { flags: 64 } : {}) },
      });
    const deny = (text: string) => send({ text, ephemeral: true });
    if (body.type !== 2 && body.type !== 3) return deny('Interaksi tidak didukung.');
    if (!ch.commandsEnabled) return deny('Perintah lewat Discord dinonaktifkan untuk channel ini. Aktifkan di dashboard EAIP.');
    const u = body.member?.user ?? body.user;
    if (!u?.id) return deny('Pengguna tidak dikenal.');
    const base = { channel: ch, platform: 'DISCORD' as const, externalUserId: String(u.id), username: u.username ?? null };
    if (body.type === 3) {
      // Klik tombol: konfirmasi baru (ephemeral) atau perbarui pesan konfirmasi dengan hasil (UPDATE_MESSAGE = 7).
      const r = await this.commands.handleButton({ ...base, data: String(body.data?.custom_id ?? '') });
      return send(r, r.update ? 7 : 4);
    }
    const parsed = parseDiscordCommand(body.data);
    if (!parsed) return deny('Perintah tidak dikenal. Gunakan /eaip status.');
    const replies = await this.commands.handle({ ...base, cmd: parsed.cmd, args: parsed.args });
    // Satu respons interaksi: gabungkan pesan; tombol tiap usulan menjadi baris komponen.
    return send({ text: replies.map((r) => r.text).join('\n\n'), buttons: replies.flatMap((r) => r.buttons ?? []), ephemeral: replies.every((r) => r.ephemeral) });
  }
}
