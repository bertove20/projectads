import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import type Redis from 'ioredis';
import { REDIS } from '../common/core.module';
import { CryptoService } from '../common/crypto/crypto.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { ENV, Env } from '../config/env';
import { ChatCommandService } from './chat-command.service';
import { parseTelegramCommand } from './chat-core';
import { ChatNotifier } from './chat-notifier.service';

interface TgMessage {
  message_id: number;
  from?: { id: number; is_bot?: boolean; username?: string; first_name?: string };
  chat: { id: number; type: string };
  text?: string;
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: { id: number; is_bot?: boolean; username?: string; first_name?: string }; message?: TgMessage; data?: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Menerima perintah Telegram dengan long polling `getUpdates` (docs/providers/telegram).
 * Hanya berjalan di proses worker; satu channel diproses satu worker (lock Redis); offset disimpan di DB.
 */
@Injectable()
export class TelegramPoller implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(TelegramPoller.name);
  private stopped = false;
  private readonly botNames = new Map<string, string | null>();
  private readonly backoffUntil = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly commands: ChatCommandService,
    private readonly notifier: ChatNotifier,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit() {
    void this.loop();
  }

  onApplicationShutdown() {
    this.stopped = true;
  }

  private api(token: string, method: string) {
    return `${this.env.TELEGRAM_API_BASE.replace(/\/$/, '')}/bot${token}/${method}`;
  }

  private async loop() {
    while (!this.stopped) {
      try {
        const channels = await this.prisma.notificationChannel.findMany({ where: {
            type: 'TELEGRAM',
            enabled: true,
            commandsEnabled: true,
            // Hanya organisasi yang memilih Telegram sebagai platform chat aktif (default Telegram).
            organization: { OR: [{ aiTeamSettings: { is: null } }, { aiTeamSettings: { is: { chatPlatform: 'TELEGRAM' } } }] },
          },
        });
        const active = channels.filter((c) => (this.backoffUntil.get(c.id) ?? 0) < Date.now());
        if (!active.length) {
          await sleep(5000);
          continue;
        }
        await Promise.all(active.map((c) => this.pollOne(c)));
        if (this.env.TELEGRAM_POLL_TIMEOUT_SECONDS === 0) await sleep(1000);
      } catch (err) {
        this.logger.warn({ err: String(err) }, 'Loop Telegram gagal');
        await sleep(5000);
      }
    }
  }

  private async botName(c: NotificationChannel, token: string): Promise<string | null> {
    if (this.botNames.has(c.id)) return this.botNames.get(c.id)!;
    const res = await fetch(this.api(token, 'getMe'), { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { ok?: boolean; result?: { username?: string } } | null;
    const name = body?.ok ? (body.result?.username ?? null) : null;
    this.botNames.set(c.id, name);
    return name;
  }

  async pollOne(c: NotificationChannel) {
    const timeout = this.env.TELEGRAM_POLL_TIMEOUT_SECONDS;
    const lockKey = `tg:poll:${c.id}`;
    const locked = await this.redis.set(lockKey, '1', 'EX', timeout + 20, 'NX').catch(() => null);
    if (locked !== 'OK') return;
    try {
      const token = this.crypto.decrypt(c.secretEnc);
      const bot = await this.botName(c, token);
      const res = await fetch(this.api(token, 'getUpdates'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offset: c.pollOffset != null ? Number(c.pollOffset) : undefined, timeout, allowed_updates: ['message', 'callback_query'] }),
        signal: AbortSignal.timeout((timeout + 10) * 1000),
        redirect: 'error',
      }).catch((err: Error) => {
        throw new Error(`koneksi ke Telegram gagal: ${err.name}`);
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: TgUpdate[]; description?: string };
      if (!res.ok || !body.ok) {
        // 401 token salah, 409 webhook aktif: tunda 5 menit agar tidak membanjiri API.
        this.logger.warn({ channelId: c.id, status: res.status, desc: body.description?.slice(0, 120) }, 'getUpdates ditolak');
        this.backoffUntil.set(c.id, Date.now() + 5 * 60_000);
        return;
      }
      for (const u of body.result ?? []) {
        await (u.callback_query ? this.handleButton(c, u, token) : this.handle(c, u, bot)).catch((err: unknown) => this.logger.warn({ channelId: c.id, err: String(err) }, 'Update Telegram gagal diproses'));
        await this.prisma.notificationChannel.update({ where: { id: c.id }, data: { pollOffset: BigInt(u.update_id + 1) } });
        c.pollOffset = BigInt(u.update_id + 1);
      }
    } catch (err) {
      this.logger.warn({ channelId: c.id, err: (err as Error).message }, 'Polling Telegram gagal');
      this.backoffUntil.set(c.id, Date.now() + 30_000);
    } finally {
      await this.redis.del(lockKey).catch(() => undefined);
    }
  }

  private async handle(c: NotificationChannel, u: TgUpdate, bot: string | null) {
    const m = u.message;
    if (!m?.from || m.from.is_bot) return;
    const chatId = String(m.chat.id);
    // Hanya grup yang terdaftar di channel ini, atau chat pribadi dengan bot.
    if (chatId !== c.target && m.chat.type !== 'private') return;
    let parsed = parseTelegramCommand(m.text, bot);
    // Di chat pribadi, teks biasa dianggap perintah ke Kepala Tim AI.
    if (!parsed && m.chat.type === 'private' && m.text && !m.text.startsWith('/')) parsed = { cmd: 'perintah', args: m.text.trim() };
    if (!parsed) return;
    const replies = await this.commands.handle({
      channel: c,
      platform: 'TELEGRAM',
      externalUserId: String(m.from.id),
      username: m.from.username ?? m.from.first_name ?? null,
      cmd: parsed.cmd,
      args: parsed.args,
      chatId,
      messageId: m.message_id,
    });
    for (const r of replies) await this.notifier.safeSend(c, r.text, { chatId, replyTo: m.message_id, buttons: r.buttons });
  }

  /** Tombol inline (approval): jawab callback lalu kirim hasil/konfirmasi sebagai balasan pesan tombol. */
  private async handleButton(c: NotificationChannel, u: TgUpdate, token: string) {
    const q = u.callback_query!;
    const m = q.message;
    const answer = (text: string) =>
      fetch(this.api(token, 'answerCallbackQuery'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: q.id, text: text.slice(0, 200) }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined);
    if (q.from.is_bot || !m) return void answer('Tidak didukung');
    const chatId = String(m.chat.id);
    if (chatId !== c.target && m.chat.type !== 'private') return void answer('Grup ini tidak terdaftar');
    const r = await this.commands.handleButton({ channel: c, platform: 'TELEGRAM', externalUserId: String(q.from.id), username: q.from.username ?? q.from.first_name ?? null, data: q.data ?? '', chatId, messageId: m.message_id });
    await answer(r.text.replace(/\*\*/g, '').split('\n')[0]);
    await this.notifier.safeSend(c, r.text, { chatId, replyTo: m.message_id, buttons: r.buttons });
  }
}
