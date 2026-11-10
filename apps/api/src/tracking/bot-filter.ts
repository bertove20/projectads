/**
 * Bot filter dasar (read.md 17.4). Klik yang terdeteksi TETAP dicatat dan TETAP diarahkan
 * ke tujuan yang sama (tidak ada cloaking); hanya ditandai is_bot agar dipisahkan di laporan.
 */

const BOT_UA_PATTERNS: Array<[RegExp, string]> = [
  [/bot|crawler|spider|crawling|slurp|bingpreview|mediapartners|facebookexternalhit|embedly|quora link preview|whatsapp|telegrambot|discordbot|slackbot|skypeuripreview/i, 'ua_bot_keyword'],
  [/headlesschrome|phantomjs|puppeteer|playwright|selenium|webdriver|electron/i, 'ua_headless'],
  [/curl\/|wget\/|python-requests|python-urllib|aiohttp|httpx|go-http-client|okhttp|java\/|libwww-perl|apache-httpclient|node-fetch|axios\/|undici|scrapy/i, 'ua_http_library'],
];

export interface BotCheckInput {
  userAgent: string | undefined;
  acceptLanguage: string | undefined;
  /** Jumlah klik dari ip_hash yang sama pada campaign yang sama dalam jendela waktu pendek */
  recentClicksFromIp: number;
}

export const RAPID_REPEAT_THRESHOLD = 5;
export const RAPID_REPEAT_WINDOW_SECONDS = 60;

export function detectBot(input: BotCheckInput): string[] {
  const reasons: string[] = [];
  const ua = (input.userAgent ?? '').trim();
  if (!ua) reasons.push('ua_missing');
  else {
    if (ua.length < 20) reasons.push('ua_too_short');
    for (const [re, reason] of BOT_UA_PATTERNS) if (re.test(ua)) reasons.push(reason);
  }
  if (!input.acceptLanguage) reasons.push('no_accept_language');
  if (input.recentClicksFromIp >= RAPID_REPEAT_THRESHOLD) reasons.push('rapid_repeat_ip');
  return [...new Set(reasons)];
}

/**
 * Hanya alasan kuat yang menjadikan klik is_bot=true. "no_accept_language" saja dianggap sinyal lemah
 * (beberapa webview tidak mengirimnya) dan hanya dicatat.
 */
export function isBot(reasons: string[]): boolean {
  return reasons.some((r) => r !== 'no_accept_language');
}
