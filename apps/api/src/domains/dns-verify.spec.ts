import { checkDomainPointsTo, HOSTNAME_RE, Resolver } from './dns-verify';

function resolver(records: { cname?: Record<string, string[]>; a?: Record<string, string[]> }): Resolver {
  const nx = () => Promise.reject(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
  return {
    resolveCname: (h: string) => (records.cname?.[h] ? Promise.resolve(records.cname[h]) : nx()),
    resolve4: (h: string) => (records.a?.[h] ? Promise.resolve(records.a[h]) : nx()),
  } as Resolver;
}

describe('verifikasi DNS domain tracking kustom', () => {
  const target = 'trk.trkads.org';

  it('CNAME ke domain tracking utama → aktif', async () => {
    const r = await checkDomainPointsTo('go.brand.com', target, resolver({ cname: { 'go.brand.com': ['trk.trkads.org.'] } }));
    expect(r).toMatchObject({ ok: true, method: 'cname' });
  });

  it('domain apex dengan A record = IP domain tracking → aktif', async () => {
    const r = await checkDomainPointsTo('brand.com', target, resolver({ a: { 'brand.com': ['203.0.113.7'], 'trk.trkads.org': ['203.0.113.7'] } }));
    expect(r).toMatchObject({ ok: true, method: 'a-record' });
  });

  it('CNAME ke tempat lain → ditolak dengan penjelasan', async () => {
    const r = await checkDomainPointsTo('go.brand.com', target, resolver({ cname: { 'go.brand.com': ['other.example.net'] } }));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('seharusnya trk.trkads.org');
  });

  it('A record berbeda → ditolak', async () => {
    const r = await checkDomainPointsTo('brand.com', target, resolver({ a: { 'brand.com': ['198.51.100.1'], 'trk.trkads.org': ['203.0.113.7'] } }));
    expect(r.ok).toBe(false);
  });

  it('sebagian IP saja yang cocok → ditolak (semua IP harus milik platform)', async () => {
    const r = await checkDomainPointsTo('brand.com', target, resolver({ a: { 'brand.com': ['203.0.113.7', '198.51.100.1'], 'trk.trkads.org': ['203.0.113.7'] } }));
    expect(r.ok).toBe(false);
  });

  it('belum ada record → pesan propagasi', async () => {
    const r = await checkDomainPointsTo('baru.brand.com', target, resolver({}));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('belum ditemukan');
  });

  it.each([
    ['go.brand.com', true],
    ['brand.co.id', true],
    ['localhost', false],
    ['127.0.0.1', false],
    ['go_brand.com', false],
    ['-go.brand.com', false],
    ['go.brand.com/path', false],
  ])('format hostname %s → %s', (h, ok) => expect(HOSTNAME_RE.test(h)).toBe(ok));
});
