import { twoProportionPValue, verdict, wilson } from '../reports/stats';
import { matchRoute, normalizeConditions, pickVariant, primaryLanguage, RouteDef, VariantDef, VisitorContext } from './routing';

const variant = (id: string, weight: number, extra: Partial<VariantDef> = {}): VariantDef => ({
  id,
  weight,
  enabled: true,
  offerId: `offer-${id}`,
  offerUrl: `https://offer.test/${id}?s={click_id}`,
  offerActive: true,
  landingPageId: null,
  landingUrl: null,
  landingActive: false,
  ...extra,
});

const visitor = (v: Partial<VisitorContext> = {}): VisitorContext => ({ country: 'ID', device: 'mobile', os: 'Android', browser: 'Chrome', language: 'id', ...v });

describe('normalizeConditions', () => {
  it('menormalkan nilai dan membuang duplikat', () => {
    expect(normalizeConditions({ countries: ['id', 'ID', ' my '], devices: ['Mobile'] })).toEqual({ countries: ['ID', 'MY'], devices: ['mobile'] });
  });
  it.each([
    [{ countries: ['IDN'] }, 'Kode negara'],
    [{ devices: ['phone'] }, 'Device tidak dikenal'],
    [{ hacker: ['x'] }, 'Kondisi tidak dikenal'],
    [{ countries: 'ID' }, 'harus berupa daftar'],
  ])('menolak %j', (input, msg) => {
    expect(() => normalizeConditions(input)).toThrow(msg);
  });
});

describe('matchRoute', () => {
  const routes: RouteDef[] = [
    { id: 'disabled', enabled: false, conditions: {}, variants: [variant('a', 1)] },
    { id: 'id-mobile', enabled: true, conditions: { countries: ['ID'], devices: ['mobile'] }, variants: [variant('b', 1)] },
    { id: 'no-usable', enabled: true, conditions: {}, variants: [variant('c', 0)] },
    { id: 'catch-all', enabled: true, conditions: {}, variants: [variant('d', 1)] },
  ];

  it('route pertama yang cocok dipakai, route nonaktif dilewati', () => {
    expect(matchRoute(routes, visitor())?.id).toBe('id-mobile');
  });
  it('tidak cocok → lanjut ke route berikutnya yang punya varian terpakai', () => {
    expect(matchRoute(routes, visitor({ country: 'MY' }))?.id).toBe('catch-all');
  });
  it('kondisi negara ada tetapi negara pengunjung tidak diketahui → tidak cocok', () => {
    expect(matchRoute(routes, visitor({ country: null }))?.id).toBe('catch-all');
  });
  it('tanpa route → null (memakai tujuan default campaign)', () => {
    expect(matchRoute([], visitor())).toBeNull();
  });
});

describe('pickVariant', () => {
  const route: RouteDef = { id: 'r', enabled: true, conditions: {}, variants: [variant('a', 70), variant('b', 30)] };

  it('pembagian traffic mengikuti bobot', () => {
    const counts = { a: 0, b: 0 } as Record<string, number>;
    for (let i = 0; i < 10_000; i++) counts[pickVariant(route, i / 10_000)!.id]++;
    expect(counts.a).toBe(7000);
    expect(counts.b).toBe(3000);
  });

  it('varian sticky dipertahankan selama masih aktif', () => {
    expect(pickVariant(route, 0.01, 'b')!.id).toBe('b');
  });

  it('sticky ke varian yang sudah nonaktif → dipilih ulang', () => {
    const r2: RouteDef = { ...route, variants: [variant('a', 70), variant('b', 30, { enabled: false })] };
    expect(pickVariant(r2, 0.99, 'b')!.id).toBe('a');
  });

  it('varian dengan offer/landing nonaktif tidak pernah dipilih', () => {
    const r3: RouteDef = {
      ...route,
      variants: [variant('a', 50, { offerActive: false }), variant('b', 50, { landingPageId: 'lp', landingUrl: 'https://lp.test', landingActive: false }), variant('c', 1)],
    };
    for (let i = 0; i < 100; i++) expect(pickVariant(r3, i / 100)!.id).toBe('c');
  });
});

describe('primaryLanguage', () => {
  it.each([
    ['id-ID,id;q=0.9,en;q=0.8', 'id'],
    ['en-US', 'en'],
    ['*', null],
    [undefined, null],
  ])('%s → %s', (input, out) => expect(primaryLanguage(input)).toBe(out));
});

describe('statistik split test', () => {
  it('interval Wilson berada di sekitar CR dan di dalam [0,1]', () => {
    const w = wilson(50, 1000)!;
    expect(w.low).toBeGreaterThan(0.035);
    expect(w.high).toBeLessThan(0.068);
    expect(wilson(0, 10)!.low).toBe(0);
    expect(wilson(0, 0)).toBeNull();
  });

  it('p-value: selisih besar signifikan, selisih kecil tidak', () => {
    expect(twoProportionPValue(80, 1000, 40, 1000)!).toBeLessThan(0.001);
    expect(twoProportionPValue(41, 1000, 40, 1000)!).toBeGreaterThan(0.8);
  });

  it('verdict konservatif', () => {
    expect(verdict(true, 10, 1, 10, 1, null)).toBe('control');
    expect(verdict(false, 50, 5, 1000, 40, 0.01)).toBe('insufficient_data'); // varian < 100 klik
    expect(verdict(false, 1000, 80, 1000, 40, 0.0001)).toBe('better');
    expect(verdict(false, 1000, 20, 1000, 40, 0.004)).toBe('worse');
    expect(verdict(false, 1000, 41, 1000, 40, 0.9)).toBe('no_difference');
  });
});
