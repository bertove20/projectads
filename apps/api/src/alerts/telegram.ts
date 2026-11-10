/**
 * Pengiriman pesan lewat Telegram Bot API resmi (method sendMessage).
 * Token bot hanya ada di server; tidak pernah dicatat di log.
 */

export const TELEGRAM_TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/;
/** chat_id: angka (boleh negatif untuk grup/channel) atau @username channel publik. */
export const TELEGRAM_CHAT_RE = /^(-?\d{3,20}|@[A-Za-z0-9_]{5,32})$/;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export class TelegramError extends Error {
  constructor(
    message: string,
    public readonly permanent: boolean,
  ) {
    super(message);
  }
}

export async function sendTelegram(apiBase: string, token: string, chatId: string, html: string): Promise<void> {
  const url = `${apiBase.replace(/\/$/, '')}/bot${token}/sendMessage`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: html.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
  } catch (err) {
    // Jangan sertakan URL (berisi token) dalam pesan error.
    throw new TelegramError(`koneksi ke Telegram gagal: ${(err as Error).name}`, false);
  }
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (res.ok && body.ok) return;
  const desc = (body.description ?? `HTTP ${res.status}`).slice(0, 200);
  // 400 (chat tidak ditemukan / format salah), 401 (token salah), 403 (bot diblokir/dikeluarkan) = permanen
  throw new TelegramError(`Telegram: ${desc}`, [400, 401, 403].includes(res.status));
}

const SEVERITY_LABEL: Record<string, string> = { INFO: 'ℹ️ INFO', WARNING: '⚠️ WARNING', HIGH: '🔶 HIGH', CRITICAL: '🔴 CRITICAL' };

export function formatAlert(a: { severity: string; title: string; body: string; createdAt: Date }, orgName: string): string {
  return [
    `<b>${SEVERITY_LABEL[a.severity] ?? a.severity}</b> · ${escapeHtml(orgName)}`,
    `<b>${escapeHtml(a.title)}</b>`,
    escapeHtml(a.body),
    `<i>${a.createdAt.toISOString().replace('T', ' ').slice(0, 16)} UTC</i>`,
  ].join('\n');
}
