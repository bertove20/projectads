import { createAdapter, NetworkApiError } from './adapters';
import { MinuteRateLimiter } from './rate-limiter';

const limiter = { acquire: async () => undefined } as unknown as MinuteRateLimiter;
const cfg = { rolleradsBase: 'https://roller.test/v2', propellerBase: 'https://propeller.test/v5', limiter };

function mockFetch(handler: (url: URL, init: RequestInit) => { status?: number; body: unknown; headers?: Record<string, string> }) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  global.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const r = handler(url, init);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers });
  }) as typeof fetch;
  return calls;
}

describe('adapter PropellerAds (Propeller SSP API v5)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('statistik: parameter sesuai spesifikasi resmi dan baris dinormalisasi', async () => {
    const calls = mockFetch(() => ({
      body: [{ items: [{ campaign_id: 7001, zone_id: 880001, impressions: 10, clicks: 5, conversions: 1, spent: '1.25' }], total_pages: 1 }],
    }));
    const a = createAdapter('PROPELLERADS', 'acc-1', 'tok', cfg);
    const { rows, pending } = await a.dailyStats('2026-11-10');
    expect(pending).toBe(false);
    expect(rows).toEqual([{ externalCampaignId: '7001', zoneId: '880001', country: '', impressions: 10, clicks: 5, conversions: 1, spend: 1.25 }]);
    const u = calls[0].url;
    expect(u.pathname).toBe('/v5/adv/statistics');
    expect(u.searchParams.getAll('group_by[]')).toEqual(['campaign_id', 'zone_id']);
    expect(u.searchParams.get('tz')).toBe('+0000');
    expect(u.searchParams.get('day_from')).toBe('2026-11-10 00:00:00');
    expect(u.searchParams.get('day_to')).toBe('2026-11-10 23:59:59');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(a.fixedReportTimezone).toBe('UTC');
  });

  it('statistik: respons objek tunggal & paginasi', async () => {
    mockFetch((url) => {
      const page = Number(url.searchParams.get('page'));
      return { body: { items: [{ campaign_id: page, zone_id: null, clicks: 1, spent: 0.5 }], total_pages: 2 } };
    });
    const { rows } = await createAdapter('PROPELLERADS', 'acc-1', 'tok', cfg).dailyStats('2026-11-10');
    expect(rows.map((r) => [r.externalCampaignId, r.zoneId, r.spend])).toEqual([
      ['1', '', 0.5],
      ['2', '', 0.5],
    ]);
  });

  it('token ditolak → NetworkApiError dengan isAuthError', async () => {
    mockFetch(() => ({ status: 401, body: { message: 'Unauthorized' } }));
    const err = await createAdapter('PROPELLERADS', 'acc-1', 'bad', cfg).testConnection().catch((e) => e);
    expect(err).toBeInstanceOf(NetworkApiError);
    expect(err.isAuthError).toBe(true);
  });

  it('daftar campaign: status angka diterjemahkan', async () => {
    mockFetch(() => ({ body: { result: [{ id: 1, name: 'A', status: 6 }, { id: 2, name: 'B', status: 7 }], meta: { total_pages: 1 } } }));
    expect(await createAdapter('PROPELLERADS', 'acc-1', 'tok', cfg).listCampaigns()).toEqual([
      { id: '1', title: 'A', status: 'working' },
      { id: '2', title: 'B', status: 'paused' },
    ]);
  });

  it('jaringan tanpa dokumentasi terverifikasi tidak bisa dibuat adapternya', () => {
    expect(() => createAdapter('EVADAV', 'acc-1', 'tok', cfg)).toThrow('belum didukung');
  });
});
