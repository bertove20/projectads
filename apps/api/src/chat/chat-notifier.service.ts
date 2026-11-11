import { Inject, Injectable, Logger } from '@nestjs/common';
import { ChatPlatform, NotificationChannel } from '@prisma/client';
import { sendTelegram } from '../alerts/telegram';
import { CryptoService } from '../common/crypto/crypto.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { ENV, Env } from '../config/env';
import { clip, parseDiscordWebhook, toTelegramHtml } from './chat-core';

export interface ChatOrigin {
  platform: 'TELEGRAM' | 'DISCORD';
  channelId: string;
  /** Telegram: chat_id asal (grup/private) */
  chatId?: string;
  /** Telegram: message_id perintah, untuk dibalas */
  messageId?: number;
}

export interface DiscordSecret {
  webhookUrl: string;
  botToken?: string | null;
}

/** Tombol pilihan untuk pesan chat (Telegram inline keyboard / Discord button). */
export interface ChatButton {
  label: string;
  data: string;
  style?: 'success' | 'danger' | 'secondary';
}

export interface ChatReply {
  text: string;
  buttons?: ChatButton[][];
  /** Discord: hanya terlihat oleh pengirim */
  ephemeral?: boolean;
  /** Discord: ganti pesan tombol yang diklik (konfirmasi selesai) */
  update?: boolean;
}

/** Usulan maksimal yang dikirim sebagai kartu bertombol setelah sesi selesai. */
const MAX_APPROVAL_CARDS = 5;

/**
 * Pengiriman pesan Tim AI ke Telegram/Discord. Hanya platform chat yang aktif (pengaturan Tim AI) yang dipakai.
 * Kegagalan kirim tidak pernah menggagalkan proses utama.
 */
@Injectable()
export class ChatNotifier {
  private readonly logger = new Logger(ChatNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async activePlatform(organizationId: string): Promise<{ platform: ChatPlatform; approvals: boolean }> {
    const s = await this.prisma.aiTeamSettings.findUnique({ where: { organizationId }, select: { chatPlatform: true, chatApprovals: true } });
    return { platform: s?.chatPlatform ?? 'TELEGRAM', approvals: s?.chatApprovals ?? true };
  }

  discordSecret(ch: Pick<NotificationChannel, 'secretEnc'>): DiscordSecret {
    return JSON.parse(this.crypto.decrypt(ch.secretEnc)) as DiscordSecret;
  }

  /** Kirim Markdown sederhana ke satu channel. Telegram: ke chatId (default target channel), bisa dengan tombol. */
  async send(ch: NotificationChannel, markdown: string, opts: { chatId?: string; replyTo?: number; buttons?: ChatButton[][] } = {}) {
    if (ch.type === 'TELEGRAM') {
      await sendTelegram(this.env.TELEGRAM_API_BASE, this.crypto.decrypt(ch.secretEnc), opts.chatId ?? ch.target, toTelegramHtml(clip(markdown, 3800)), {
        replyTo: opts.replyTo,
        buttons: opts.buttons?.map((row) => row.map((b) => ({ text: b.label, callback_data: b.data }))),
      });
      return;
    }
    const hook = parseDiscordWebhook(this.discordSecret(ch).webhookUrl);
    if (!hook) throw new Error('URL webhook Discord tidak valid');
    const res = await fetch(`${this.env.DISCORD_API_BASE.replace(/\/$/, '')}/webhooks/${hook.id}/${hook.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Konten berasal dari AI/pengguna: matikan semua mention.
      body: JSON.stringify({ content: clip(markdown, 1990), username: 'EAIP Tim AI', allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    }).catch((err: Error) => {
      throw new Error(`koneksi ke Discord gagal: ${err.name}`);
    });
    if (!res.ok) throw new Error(`Discord: HTTP ${res.status}`);
  }

  async safeSend(ch: NotificationChannel, markdown: string, opts: { chatId?: string; replyTo?: number; buttons?: ChatButton[][] } = {}) {
    try {
      await this.send(ch, markdown, opts);
      return true;
    } catch (err) {
      this.logger.warn({ channelId: ch.id, err: (err as Error).message }, 'Pesan chat gagal dikirim');
      return false;
    }
  }

  /** Channel aktif milik platform chat yang dipilih organisasi. */
  async channels(organizationId: string) {
    const { platform } = await this.activePlatform(organizationId);
    return this.prisma.notificationChannel.findMany({ where: { organizationId, enabled: true, type: platform } });
  }

  /** Kabar ke channel platform aktif yang mengaktifkan kabar Tim AI, plus chat asal perintah. */
  async broadcast(organizationId: string, markdown: string, origin?: ChatOrigin | null, buttons?: ChatButton[][]) {
    const channels = await this.channels(organizationId);
    const sentTo = new Set<string>();
    for (const ch of channels.filter((c) => c.teamUpdates)) {
      // Bila perintah berasal dari grup ini, balas langsung ke pesan perintahnya.
      const fromHere = origin?.channelId === ch.id && (origin.chatId ?? ch.target) === ch.target;
      await this.safeSend(ch, markdown, { ...(fromHere ? { replyTo: origin?.messageId } : {}), buttons });
      sentTo.add(`${ch.id}:${ch.target}`);
    }
    if (origin) {
      const ch = channels.find((c) => c.id === origin.channelId);
      const key = `${origin.channelId}:${origin.chatId ?? ch?.target}`;
      if (ch && !sentTo.has(key)) await this.safeSend(ch, markdown, { chatId: origin.chatId, replyTo: origin.messageId, buttons });
    }
    return channels;
  }

  dashboardUrl(path: string) {
    return `${this.env.DASHBOARD_ORIGIN.replace(/\/$/, '')}${path}`;
  }

  /** Teks kartu usulan untuk chat. */
  proposalCard(p: { id: string; ref: string; title: string; reason: string; risk: string; actionLabel: string; agentName: string; supervisorNote: string | null; preview?: string | null }) {
    return [
      `🗳 **${p.ref} · ${p.title}**`,
      `${p.agentName} · ${p.actionLabel} · risiko ${p.risk.toLowerCase()} · kode ${shortCode(p.id)}`,
      `Alasan: ${clip(p.reason, 400)}`,
      p.supervisorNote ? `Kepala Tim AI: ${clip(p.supervisorNote, 300)}` : '',
      p.preview ? `Perubahan: ${p.preview}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  /** Ringkasan sesi selesai/gagal untuk grup + kartu usulan bertombol (Telegram) bila approval lewat chat aktif. */
  async runFinished(runId: string, cards?: { text: string; buttons: ChatButton[][] }[]) {
    const run = await this.prisma.aiRun.findUnique({ where: { id: runId }, include: { _count: { select: { proposals: { where: { status: 'PENDING_OWNER' } } } } } });
    if (!run) return;
    const { platform, approvals } = await this.activePlatform(run.organizationId);
    const icon = run.status === 'COMPLETED' ? '✅' : run.status === 'CANCELLED' ? '⏹' : '⚠️';
    const pending = run._count.proposals;
    const howTo = !approvals ? `Putuskan di Approval Center: ${this.dashboardUrl('/approvals')}` : platform === 'TELEGRAM' ? 'Setujui/tolak lewat tombol di bawah, atau di Approval Center.' : 'Ketik /eaip usulan untuk menyetujui/menolak dari Discord, atau buka Approval Center.';
    const lines = [
      `${icon} **${run.title}** — ${run.status === 'COMPLETED' ? 'selesai' : run.status === 'CANCELLED' ? 'dihentikan' : 'gagal'}`,
      '',
      run.status === 'COMPLETED' ? clip(run.summary ?? '(tanpa rangkuman)', 1300) : (run.error ?? ''),
      '',
      pending ? `**${pending} usulan menunggu persetujuan Anda.** ${howTo}` : 'Tidak ada usulan yang menunggu persetujuan.',
      `Transkrip lengkap: ${this.dashboardUrl(`/ai/team/runs/${run.id}`)}`,
    ];
    const origin = (run.origin as ChatOrigin | null) ?? null;
    await this.broadcast(run.organizationId, lines.join('\n'), origin);
    if (pending && approvals && platform === 'TELEGRAM' && cards?.length) {
      for (const c of cards.slice(0, MAX_APPROVAL_CARDS)) await this.broadcast(run.organizationId, c.text, origin, c.buttons);
    }
  }
}

/** Kode pendek usulan untuk perintah teks (/revisi KODE …). */
export function shortCode(id: string) {
  return id.replace(/-/g, '').slice(0, 8).toUpperCase();
}
