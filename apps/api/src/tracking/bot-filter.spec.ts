import { detectBot, isBot, RAPID_REPEAT_THRESHOLD } from './bot-filter';

const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

describe('bot filter', () => {
  it('browser normal tidak ditandai bot', () => {
    const reasons = detectBot({ userAgent: CHROME_ANDROID, acceptLanguage: 'id-ID,id;q=0.9', recentClicksFromIp: 0 });
    expect(reasons).toEqual([]);
    expect(isBot(reasons)).toBe(false);
  });

  it.each([
    ['Googlebot/2.1 (+http://www.google.com/bot.html)', 'ua_bot_keyword'],
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/120.0 Safari/537.36', 'ua_headless'],
    ['python-requests/2.31.0 something-longer-here', 'ua_http_library'],
    ['curl/8.4.0 with extra padding text', 'ua_http_library'],
  ])('UA %s → %s', (ua, reason) => {
    const reasons = detectBot({ userAgent: ua, acceptLanguage: 'en', recentClicksFromIp: 0 });
    expect(reasons).toContain(reason);
    expect(isBot(reasons)).toBe(true);
  });

  it('UA kosong ditandai bot', () => {
    expect(isBot(detectBot({ userAgent: undefined, acceptLanguage: 'en', recentClicksFromIp: 0 }))).toBe(true);
  });

  it('klik berulang cepat dari IP yang sama ditandai bot', () => {
    const reasons = detectBot({ userAgent: CHROME_ANDROID, acceptLanguage: 'id', recentClicksFromIp: RAPID_REPEAT_THRESHOLD });
    expect(reasons).toContain('rapid_repeat_ip');
    expect(isBot(reasons)).toBe(true);
  });

  it('tanpa Accept-Language hanya sinyal lemah (bukan bot)', () => {
    const reasons = detectBot({ userAgent: CHROME_ANDROID, acceptLanguage: undefined, recentClicksFromIp: 0 });
    expect(reasons).toEqual(['no_accept_language']);
    expect(isBot(reasons)).toBe(false);
  });
});
