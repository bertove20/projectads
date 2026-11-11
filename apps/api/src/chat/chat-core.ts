/** Logika murni integrasi chat (Telegram & Discord) — tanpa I/O. Lihat docs/providers/{telegram,discord}. */
import { createPublicKey, verify } from 'crypto';

export type ChatCommand = 'bantuan' | 'status' | 'rapat' | 'perintah' | 'usulan' | 'revisi' | 'stop' | 'lanjut' | 'hubungkan';

const ALIASES: Record<string, ChatCommand> = {
  start: 'bantuan',
  help: 'bantuan',
  bantuan: 'bantuan',
  status: 'status',
  rapat: 'rapat',
  meeting: 'rapat',
  perintah: 'perintah',
  tugas: 'perintah',
  usulan: 'usulan',
  approval: 'usulan',
  revisi: 'revisi',
  revision: 'revisi',
  stop: 'stop',
  darurat: 'stop',
  lanjut: 'lanjut',
  resume: 'lanjut',
  hubungkan: 'hubungkan',
  link: 'hubungkan',
};

/** "/perintah@NamaBot evaluasi campaign" → { cmd: 'perintah', args: 'evaluasi campaign' }. Teks biasa → null. */
export function parseTelegramCommand(text: string | undefined, botUsername?: string | null): { cmd: ChatCommand; args: string } | null {
  if (!text) return null;
  const m = /^\/([A-Za-z_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return null;
  // Perintah untuk bot lain di grup yang sama diabaikan.
  if (m[2] && botUsername && m[2].toLowerCase() !== botUsername.toLowerCase()) return null;
  const cmd = ALIASES[m[1].toLowerCase()];
  return cmd ? { cmd, args: (m[3] ?? '').trim() } : null;
}

/** Interaksi slash command Discord `/eaip <subcommand> [teks|kode]`. */
export function parseDiscordCommand(data: unknown): { cmd: ChatCommand; args: string } | null {
  const d = (data ?? {}) as { name?: string; options?: { name?: string; type?: number; value?: unknown; options?: { name?: string; value?: unknown }[] }[] };
  if (d.name !== 'eaip') return null;
  const sub = d.options?.[0];
  const cmd = sub?.name ? ALIASES[sub.name] : undefined;
  if (!cmd) return null;
  const val = (n: string) => {
    const v = sub?.options?.find((o) => o.name === n)?.value;
    return typeof v === 'string' ? v.trim() : '';
  };
  // revisi: "KODE catatan"; lainnya: satu argumen teks/kode.
  const args = cmd === 'revisi' ? `${val('kode')} ${val('catatan')}`.trim() : val('teks') || val('kode');
  return { cmd, args };
}

/** Definisi slash command Discord (guild). Nama huruf kecil, deskripsi ≤ 100 karakter. */
export const DISCORD_COMMANDS = [
  {
    name: 'eaip',
    type: 1,
    description: 'Perintah Tim AI EAIP',
    options: [
      { type: 1, name: 'status', description: 'Status tim AI, sesi berjalan, dan usulan menunggu' },
      { type: 1, name: 'rapat', description: 'Mulai rapat tim AI sekarang' },
      { type: 1, name: 'perintah', description: 'Beri perintah ke Kepala Tim AI', options: [{ type: 3, name: 'teks', description: 'Isi perintah', required: true, max_length: 2000 }] },
      { type: 1, name: 'usulan', description: 'Usulan yang menunggu persetujuan (dengan tombol setujui/tolak)' },
      {
        type: 1,
        name: 'revisi',
        description: 'Minta revisi usulan ke Kepala Tim AI',
        options: [
          { type: 3, name: 'kode', description: 'Kode usulan (8 karakter)', required: true, max_length: 12 },
          { type: 3, name: 'catatan', description: 'Apa yang perlu diperbaiki', required: true, max_length: 1500 },
        ],
      },
      { type: 1, name: 'stop', description: 'Tombol darurat: hentikan tim AI' },
      { type: 1, name: 'lanjut', description: 'Lanjutkan tim AI setelah dihentikan' },
      { type: 1, name: 'hubungkan', description: 'Tautkan akun Discord ke akun EAIP', options: [{ type: 3, name: 'kode', description: 'Kode dari dashboard EAIP', required: true, max_length: 20 }] },
    ],
  },
];

/** Verifikasi tanda tangan interaksi Discord: Ed25519 atas (timestamp + raw body) dengan public key aplikasi (hex). */
export function verifyDiscordSignature(publicKeyHex: string, signatureHex: string | undefined, timestamp: string | undefined, rawBody: Buffer): boolean {
  if (!signatureHex || !timestamp || !/^[0-9a-f]{64}$/i.test(publicKeyHex) || !/^[0-9a-f]{128}$/i.test(signatureHex)) return false;
  try {
    // SPKI DER untuk kunci Ed25519 mentah 32 byte.
    const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKeyHex, 'hex')]), format: 'der', type: 'spki' });
    return verify(null, Buffer.concat([Buffer.from(timestamp, 'utf8'), rawBody]), key, Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

/** URL webhook Discord → { id, token }. Hanya host resmi Discord. */
export function parseDiscordWebhook(url: string): { id: string; token: string } | null {
  const m = /^https:\/\/(?:ptb\.|canary\.)?(?:discord\.com|discordapp\.com)\/api(?:\/v\d+)?\/webhooks\/(\d{5,25})\/([A-Za-z0-9_-]{20,120})\/?$/.exec(url.trim());
  return m ? { id: m[1], token: m[2] } : null;
}

export const DISCORD_SNOWFLAKE = /^\d{5,25}$/;

/** Markdown sederhana (output tim AI) → HTML Telegram yang aman. */
export function toTelegramHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return md
    .split('\n')
    .map((line) => {
      const h = /^#{1,4}\s+(.*)$/.exec(line);
      const body = esc(h ? h[1] : line.replace(/^\s*[-*]\s+/, '• ')).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
      return h ? `<b>${body}</b>` : body;
    })
    .join('\n');
}

/** Potong teks dengan aman di batas karakter platform. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Data tombol approval: ap/rj = minta konfirmasi, apc/rjc = konfirmasi, x = batal. */
export function parseApprovalButton(data: string | undefined): { step: 'ask' | 'confirm' | 'cancel'; decision: 'APPROVE' | 'REJECT' | null; proposalId: string | null } | null {
  if (data === 'x') return { step: 'cancel', decision: null, proposalId: null };
  const m = /^(ap|rj|apc|rjc):([0-9a-f-]{36})$/i.exec(data ?? '');
  if (!m) return null;
  const k = m[1].toLowerCase();
  return { step: k.endsWith('c') ? 'confirm' : 'ask', decision: k.startsWith('ap') ? 'APPROVE' : 'REJECT', proposalId: m[2].toLowerCase() };
}
