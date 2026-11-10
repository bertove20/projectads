import { escapeHtml, formatAlert, TELEGRAM_CHAT_RE, TELEGRAM_TOKEN_RE } from '../alerts/telegram';
import { severityAtLeast } from '../alerts/alert.service';
import { dateInTz, isDateString, isValidTimezone, recentDates } from '../common/tz';
import { MinuteRateLimiter } from './rate-limiter';

describe('timezone utils', () => {
  it('tanggal mengikuti zona waktu jaringan', () => {
    const instant = new Date('2026-11-10T20:30:00Z');
    expect(dateInTz(instant, 'UTC')).toBe('2026-11-10');
    expect(dateInTz(instant, 'Asia/Jakarta')).toBe('2026-11-11'); // UTC+7
    expect(dateInTz(instant, 'America/New_York')).toBe('2026-11-10');
  });

  it('recentDates = lookback + hari ini, urut naik', () => {
    expect(recentDates('Asia/Jakarta', 3, new Date('2026-11-10T20:30:00Z'))).toEqual(['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11']);
  });

  it('validasi timezone & tanggal', () => {
    expect(isValidTimezone('Asia/Jakarta')).toBe(true);
    expect(isValidTimezone('GMT+3 Moscow')).toBe(false);
    expect(isValidTimezone(null)).toBe(false);
    expect(isDateString('2026-11-10')).toBe(true);
    expect(isDateString('2026-13-45')).toBe(false);
    expect(isDateString("2026-11-10' OR 1=1")).toBe(false);
  });
});

describe('telegram', () => {
  it('escape HTML agar teks dari data tidak bisa menyisipkan markup', () => {
    expect(escapeHtml('<b>x</b> & y')).toBe('&lt;b&gt;x&lt;/b&gt; &amp; y');
    const msg = formatAlert({ severity: 'HIGH', title: 'Campaign <script>', body: 'a & b', createdAt: new Date('2026-11-11T01:02:00Z') }, 'Org');
    expect(msg).toContain('Campaign &lt;script&gt;');
    expect(msg).toContain('2026-11-11 01:02 UTC');
  });

  it('format token & chat id', () => {
    expect(TELEGRAM_TOKEN_RE.test(`123456789:${'A'.repeat(35)}`)).toBe(true);
    expect(TELEGRAM_TOKEN_RE.test('bukan-token')).toBe(false);
    expect(TELEGRAM_CHAT_RE.test('-1001234567890')).toBe(true);
    expect(TELEGRAM_CHAT_RE.test('@tim_ads_kami')).toBe(true);
    expect(TELEGRAM_CHAT_RE.test('https://t.me/x')).toBe(false);
  });

  it('urutan severity', () => {
    expect(severityAtLeast('HIGH', 'WARNING')).toBe(true);
    expect(severityAtLeast('INFO', 'WARNING')).toBe(false);
    expect(severityAtLeast('CRITICAL', 'CRITICAL')).toBe(true);
  });
});

describe('MinuteRateLimiter', () => {
  /** Redis palsu minimal (incr/expire) */
  function fakeRedis() {
    const store = new Map<string, number>();
    return {
      incr: async (k: string) => {
        const v = (store.get(k) ?? 0) + 1;
        store.set(k, v);
        return v;
      },
      expire: async () => 1,
    } as never;
  }

  it('mengizinkan hingga batas per menit lalu melempar bila waktu tunggu melebihi maxWait', async () => {
    const limiter = new MinuteRateLimiter(fakeRedis(), 0);
    for (let i = 0; i < 3; i++) await limiter.acquire('k', 3);
    await expect(limiter.acquire('k', 3)).rejects.toThrow('rate limit');
  });
});
