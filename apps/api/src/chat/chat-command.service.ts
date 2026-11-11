import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { ChatPlatform, NotificationChannel } from '@prisma/client';
import { createHash, randomInt } from 'crypto';
import type Redis from 'ioredis';
import { AuditService } from '../common/audit/audit.service';
import { REDIS } from '../common/core.module';
import type { OrgContext } from '../common/decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { periodStarts, sanitizeText } from '../ai/ai-core';
import { AiTeamService } from '../ai/team.service';
import { ChatCommand, parseApprovalButton } from './chat-core';
import { ChatNotifier, ChatOrigin, ChatReply, shortCode } from './chat-notifier.service';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_TTL_MS = 10 * 60_000;
const RATE_PER_MIN = 10;
const PLATFORM_NAME: Record<ChatPlatform, string> = { TELEGRAM: 'Telegram', DISCORD: 'Discord' };

export const hashCode = (code: string) => createHash('sha256').update(code.trim().toUpperCase()).digest('hex');

export function newLinkCode(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

export interface CommandInput {
  channel: NotificationChannel;
  platform: ChatPlatform;
  externalUserId: string;
  username?: string | null;
  cmd: ChatCommand;
  args: string;
  /** Telegram: chat & message asal (untuk balasan saat sesi selesai) */
  chatId?: string;
  messageId?: number;
}

export type ButtonInput = Omit<CommandInput, 'cmd' | 'args'> & { data: string };

export const HELP_TEXT = [
  '**Perintah Tim AI EAIP**',
  '- status — status tim, sesi berjalan, usulan menunggu',
  '- perintah <teks> — beri perintah ke Kepala Tim AI',
  '- rapat — mulai rapat tim sekarang',
  '- usulan — usulan yang menunggu persetujuan, dengan tombol Setujui/Tolak',
  '- revisi <kode> <catatan> — minta revisi usulan ke Kepala Tim AI',
  '- stop — tombol darurat (hentikan tim AI)',
  '- lanjut — lanjutkan tim AI',
  '- hubungkan <kode> — tautkan akun chat ke akun EAIP (kode dari dashboard: AI → Telegram & Discord)',
  '',
  'Persetujuan lewat chat butuh izin approve, akun tertaut, dan konfirmasi dua langkah.',
].join('\n');

const reply = (text: string, extra: Partial<ChatReply> = {}): ChatReply => ({ text, ...extra });

/**
 * Perintah & persetujuan dari Telegram/Discord.
 * - Hanya platform chat yang dipilih organisasi yang aktif.
 * - Identitas chat wajib ditautkan ke anggota EAIP; izin dicek dari role EAIP, bukan dari status admin grup.
 * - Persetujuan: izin ai.approve + pengaturan "approval lewat chat" + konfirmasi dua langkah; tercatat di audit log.
 */
@Injectable()
export class ChatCommandService {
  private readonly logger = new Logger(ChatCommandService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly team: AiTeamService,
    private readonly notifier: ChatNotifier,
    private readonly audit: AuditService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private async member(organizationId: string, platform: ChatPlatform, externalUserId: string) {
    const identity = await this.prisma.chatIdentity.findUnique({ where: { organizationId_platform_externalUserId: { organizationId, platform, externalUserId } } });
    if (!identity) return null;
    const m = await this.prisma.membership.findUnique({
      where: { id: identity.membershipId },
      include: { user: { select: { id: true, name: true, isSuperAdmin: true } }, role: { include: { permissions: { include: { permission: true } } } } },
    });
    if (!m || m.status !== 'ACTIVE' || m.organizationId !== organizationId) return null;
    const perms = new Set(m.user.isSuperAdmin ? ['*'] : m.role.permissions.map((p) => p.permission.key));
    return { membership: m, userId: m.user.id, can: (p: string) => perms.has('*') || perms.has(p) };
  }

  /** Cek platform aktif, tautan akun, izin, dan rate limit. Mengembalikan pesan tolak atau data anggota. */
  private async gate(base: Omit<CommandInput, 'cmd' | 'args'>, permission: string) {
    const orgId = base.channel.organizationId;
    const { platform } = await this.notifier.activePlatform(orgId);
    if (platform !== base.platform) return { deny: `Platform chat aktif organisasi ini adalah ${PLATFORM_NAME[platform]}. Perintah dari ${PLATFORM_NAME[base.platform]} dinonaktifkan.` };
    const who = await this.member(orgId, base.platform, base.externalUserId);
    if (!who) return { deny: 'Akun chat Anda belum terhubung ke EAIP. Buka dashboard → AI → Telegram & Discord, buat kode, lalu kirim: hubungkan <kode>.' };
    if (!who.can(permission)) return { deny: `Anda tidak memiliki izin untuk ini (${permission}).` };
    const key = `chat:rate:${base.platform}:${base.externalUserId}`;
    const n = await this.redis.incr(key).catch(() => 1);
    if (n === 1) await this.redis.expire(key, 60).catch(() => undefined);
    if (n > RATE_PER_MIN) return { deny: 'Terlalu banyak perintah. Coba lagi dalam 1 menit.' };
    return { who };
  }

  /** Perintah teks. Bisa menghasilkan beberapa pesan (mis. kartu usulan bertombol). */
  async handle(input: CommandInput): Promise<ChatReply[]> {
    const { channel, cmd } = input;
    const orgId = channel.organizationId;
    if (cmd === 'bantuan') return [reply(HELP_TEXT, { ephemeral: true })];
    if (cmd === 'hubungkan') return [reply(await this.link(input), { ephemeral: true })];

    const g = await this.gate(input, 'ai.supervise');
    if ('deny' in g) return [reply(g.deny!, { ephemeral: true })];
    const { who } = g;
    await this.audit.log({ organizationId: orgId, actorUserId: who.userId, action: 'chat.command', entityType: 'notification_channel', entityId: channel.id, after: { platform: input.platform, cmd, args: sanitizeText(input.args, 300) } });
    const origin: ChatOrigin = { platform: input.platform, channelId: channel.id, chatId: input.chatId, messageId: input.messageId };
    const via = PLATFORM_NAME[input.platform];
    try {
      switch (cmd) {
        case 'status':
          return [reply(await this.status(orgId))];
        case 'usulan':
          return await this.pending(orgId, who.can('ai.approve'));
        case 'revisi':
          return [reply(await this.revise(input, who))];
        case 'perintah': {
          if (input.args.length < 5) return [reply('Tulis perintahnya, mis.: perintah evaluasi campaign Thailand minggu ini', { ephemeral: true })];
          const run = await this.team.startDirective(orgId, who.userId, input.args, undefined, origin);
          return [reply(`📨 Perintah diterima Kepala Tim AI: "${sanitizeText(run.title, 120)}". Hasilnya dikirim ke sini setelah tim selesai.\n${this.notifier.dashboardUrl(`/ai/team/runs/${run.id}`)}`)];
        }
        case 'rapat': {
          const run = await this.team.startMeeting(orgId, who.userId, true, origin);
          return [reply(`🗓 Rapat tim dimulai (${run?.title ?? ''}). Rangkuman dikirim ke sini setelah selesai.\n${this.notifier.dashboardUrl(`/ai/team/runs/${run?.id}`)}`)];
        }
        case 'stop':
          await this.team.setPaused({ organizationId: orgId }, who.userId, true, via);
          return [reply('⏹ Tim AI dihentikan. Kirim "lanjut" untuk melanjutkan.')];
        case 'lanjut':
          await this.team.setPaused({ organizationId: orgId }, who.userId, false, via);
          return [reply('▶️ Tim AI dilanjutkan.')];
        default:
          return [reply(HELP_TEXT, { ephemeral: true })];
      }
    } catch (err) {
      return [reply(this.errorText(err, cmd), { ephemeral: true })];
    }
  }

  private errorText(err: unknown, ctx: string) {
    if (err instanceof HttpException) {
      const r = err.getResponse() as { message?: string };
      return `Tidak bisa: ${r?.message ?? err.message}`;
    }
    this.logger.error({ err: String(err), ctx }, 'Perintah chat gagal');
    return 'Terjadi kesalahan di server. Coba lagi nanti.';
  }

  private orgCtx(organizationId: string, membershipId: string): OrgContext {
    return { organizationId, membershipId, roleKey: null, permissions: new Set(), campaignIds: null, isSuperAdmin: false };
  }

  /**
   * Tombol approval: langkah 1 (Setujui/Tolak) meminta konfirmasi, langkah 2 menjalankan keputusan lewat
   * jalur yang sama dengan Approval Center (status dicek ulang, eksekusi server, audit log).
   */
  async handleButton(input: ButtonInput): Promise<ChatReply> {
    const b = parseApprovalButton(input.data);
    if (!b) return reply('Tombol tidak dikenal.', { ephemeral: true });
    if (b.step === 'cancel') return reply('Dibatalkan. Tidak ada perubahan.', { update: true });
    const orgId = input.channel.organizationId;
    const { approvals } = await this.notifier.activePlatform(orgId);
    if (!approvals) return reply(`Persetujuan lewat chat dinonaktifkan owner. Gunakan Approval Center: ${this.notifier.dashboardUrl('/approvals')}`, { ephemeral: true });
    const g = await this.gate(input, 'ai.approve');
    if ('deny' in g) return reply(g.deny!, { ephemeral: true });
    const { who } = g;
    const p = await this.prisma.aiProposal.findFirst({ where: { id: b.proposalId!, organizationId: orgId }, include: { agent: { select: { name: true } } } });
    if (!p) return reply('Usulan tidak ditemukan.', { ephemeral: true });
    if (p.status !== 'PENDING_OWNER') return reply(`Usulan ${p.ref} "${p.title}" sudah diputuskan (${p.status.toLowerCase()}).`, { update: b.step === 'confirm', ephemeral: b.step === 'ask' });
    const verb = b.decision === 'APPROVE' ? 'setujui & jalankan' : 'tolak';
    if (b.step === 'ask') {
      return reply(`Konfirmasi: ${verb} usulan **${p.ref} · ${p.title}** dari ${p.agent.name}?`, {
        ephemeral: true,
        buttons: [
          [
            { label: b.decision === 'APPROVE' ? '✅ Ya, jalankan' : '❌ Ya, tolak', data: `${b.decision === 'APPROVE' ? 'apc' : 'rjc'}:${p.id}`, style: b.decision === 'APPROVE' ? 'success' : 'danger' },
            { label: 'Batal', data: 'x', style: 'secondary' },
          ],
        ],
      });
    }
    try {
      const r = (await this.team.decide(this.orgCtx(orgId, who.membership.id), who.userId, p.id, b.decision!, `Diputuskan lewat ${PLATFORM_NAME[input.platform]}`)) as { status: string; error?: string; result?: Record<string, unknown> };
      await this.audit.log({ organizationId: orgId, actorUserId: who.userId, action: 'chat.approval', entityType: 'ai_proposal', entityId: p.id, after: { platform: input.platform, decision: b.decision, status: r.status } });
      const result =
        r.status === 'EXECUTED'
          ? r.result?.cardId
            ? `Kartu T-${String(r.result.number)} dibuat.`
            : `Dijalankan: ${String(r.result?.before ?? 'tidak ada')} → ${String(r.result?.after)}${r.result?.noop ? ' (sudah sesuai)' : ''}.`
          : r.status === 'FAILED'
            ? `Eksekusi gagal: ${r.error}`
            : 'Usulan ditolak.';
      return reply(`${r.status === 'FAILED' ? '⚠️' : b.decision === 'APPROVE' ? '✅' : '❌'} ${p.ref} · ${p.title} — ${result} (oleh ${who.membership.user.name})`, { update: true });
    } catch (err) {
      return reply(this.errorText(err, 'approval'), { update: true });
    }
  }

  private async revise(input: CommandInput, who: { userId: string; membership: { id: string }; can: (p: string) => boolean }) {
    if (!who.can('ai.approve')) return 'Meminta revisi butuh izin approve (ai.approve).';
    const m = /^([A-Za-z0-9]{6,12})\s+([\s\S]{3,})$/.exec(input.args.trim());
    if (!m) return 'Format: revisi <kode> <catatan>. Kode ada di kartu usulan.';
    const code = m[1].toUpperCase();
    const pending = await this.prisma.aiProposal.findMany({ where: { organizationId: input.channel.organizationId, status: 'PENDING_OWNER' }, select: { id: true, ref: true, title: true }, take: 200 });
    const p = pending.find((x) => shortCode(x.id).startsWith(code));
    if (!p) return `Usulan dengan kode ${code} tidak ditemukan atau sudah diputuskan.`;
    const r = (await this.team.decide(this.orgCtx(input.channel.organizationId, who.membership.id), who.userId, p.id, 'REVISION', m[2].trim())) as { revisionRunId?: string | null };
    return `✏️ Revisi ${p.ref} "${p.title}" dikirim ke Kepala Tim AI.${r.revisionRunId ? `\n${this.notifier.dashboardUrl(`/ai/team/runs/${r.revisionRunId}`)}` : ''}`;
  }

  private async link(input: CommandInput): Promise<string> {
    const code = input.args.trim().toUpperCase();
    if (!/^[A-Z0-9]{6,12}$/.test(code)) return 'Format: hubungkan <kode>. Buat kode di dashboard → AI → Telegram & Discord.';
    const row = await this.prisma.chatLinkCode.findUnique({ where: { codeHash: hashCode(code) }, include: { membership: { include: { user: { select: { id: true, name: true } } } } } });
    if (!row || row.usedAt || row.expiresAt < new Date() || row.membership.organizationId !== input.channel.organizationId || row.membership.status !== 'ACTIVE') {
      return 'Kode tidak valid atau sudah kedaluwarsa. Buat kode baru di dashboard.';
    }
    const used = await this.prisma.chatLinkCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (!used.count) return 'Kode sudah dipakai.';
    const orgId = input.channel.organizationId;
    await this.prisma.chatIdentity.upsert({
      where: { organizationId_platform_externalUserId: { organizationId: orgId, platform: input.platform, externalUserId: input.externalUserId } },
      create: { organizationId: orgId, membershipId: row.membershipId, platform: input.platform, externalUserId: input.externalUserId, username: input.username ? sanitizeText(input.username, 64) : null },
      update: { membershipId: row.membershipId, username: input.username ? sanitizeText(input.username, 64) : null, linkedAt: new Date() },
    });
    await this.audit.log({ organizationId: orgId, actorUserId: row.membership.user.id, action: 'chat.identity.link', entityType: 'chat_identity', after: { platform: input.platform, username: input.username ?? null } });
    return `✅ Akun ${PLATFORM_NAME[input.platform]} terhubung ke ${row.membership.user.name}. Kirim "bantuan" untuk daftar perintah.`;
  }

  private async status(orgId: string) {
    const { day } = periodStarts();
    const [s, running, pending, cost, last] = await Promise.all([
      this.team.settings(orgId),
      this.prisma.aiRun.findMany({ where: { organizationId: orgId, status: { in: ['QUEUED', 'RUNNING'] } }, select: { title: true, stage: true, status: true } }),
      this.prisma.aiProposal.count({ where: { organizationId: orgId, status: 'PENDING_OWNER' } }),
      this.prisma.aiUsageLog.aggregate({ where: { organizationId: orgId, agentId: { not: null }, createdAt: { gte: day } }, _sum: { costUsd: true } }),
      this.prisma.aiRun.findFirst({ where: { organizationId: orgId, status: 'COMPLETED' }, orderBy: { finishedAt: 'desc' }, select: { title: true } }),
    ]);
    return [
      `**Status Tim AI** — ${s.paused ? '⏹ dihentikan (tombol darurat)' : s.enabled ? '🟢 aktif' : '⚪ nonaktif'}`,
      `Rapat harian: ${s.meetingEnabled ? `jam ${s.meetingTime}` : 'otomatis mati'}`,
      running.length ? `Sedang berjalan: ${running.map((r) => `${r.title} (${r.stage ?? r.status.toLowerCase()})`).join('; ')}` : 'Tidak ada sesi berjalan.',
      `Usulan menunggu persetujuan: ${pending}${pending ? ' — kirim "usulan" untuk memutuskan' : ''}`,
      `Biaya tim AI hari ini: $${Number(cost._sum.costUsd ?? 0).toFixed(4)}`,
      last ? `Sesi terakhir selesai: ${last.title}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private async pending(orgId: string, canApprove: boolean): Promise<ChatReply[]> {
    const { approvals } = await this.notifier.activePlatform(orgId);
    const cards = await this.team.approvalCards(orgId);
    if (!cards.length) return [reply('Tidak ada usulan yang menunggu persetujuan.')];
    const withButtons = approvals && canApprove;
    const footer = withButtons ? 'Tekan tombol untuk memutuskan (ada konfirmasi). Minta revisi: revisi <kode> <catatan>.' : `Putuskan di Approval Center: ${this.notifier.dashboardUrl('/approvals')}`;
    return [reply(`**${cards.length} usulan menunggu persetujuan** (5 terbaru). ${footer}`), ...cards.map((c) => reply(c.text, withButtons ? { buttons: c.buttons } : {}))];
  }

  /** Kode tautan untuk anggota (dibuat dari dashboard). Kode hanya dikembalikan sekali; disimpan sebagai hash. */
  async createLinkCode(membershipId: string) {
    await this.prisma.chatLinkCode.deleteMany({ where: { membershipId, usedAt: null } });
    const code = newLinkCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    await this.prisma.chatLinkCode.create({ data: { membershipId, codeHash: hashCode(code), expiresAt } });
    return { code, expiresAt };
  }
}
