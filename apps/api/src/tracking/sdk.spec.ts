import { Script } from 'vm';
import { hostAllowed, isPiiKey, sanitizeProps } from './events.service';
import { sdkScript } from './sdk-source';

describe('allowlist domain JS SDK', () => {
  const domains = ['promo.example.com', 'brand.id'];
  it.each([
    ['promo.example.com', true],
    ['www.promo.example.com', true],
    ['PROMO.EXAMPLE.COM', true],
    ['brand.id', true],
    ['lp.brand.id', true],
    ['example.com', false],
    ['evilpromo.example.com', false],
    ['promo.example.com.evil.net', false],
    ['brand.id.evil.net', false],
  ])('%s → %s', (host, ok) => expect(hostAllowed(host, domains)).toBe(ok));
});

describe('minimasi data pada properti event', () => {
  it.each([
    ['email', true],
    ['userEmail', true],
    ['phone_number', true],
    ['wa', true],
    ['first_name', true],
    ['password', true],
    ['plan', false],
    ['software', false],
    ['zip_zone', false],
    ['form_step', false],
  ])('kunci %s → PII %s', (key, pii) => expect(isPiiKey(key)).toBe(pii));

  it('membuang PII, nilai non-primitif, dan nilai yang tampak seperti email/telepon', () => {
    expect(
      sanitizeProps({ plan: 'gold', step: 2, ok: true, email: 'a@b.com', note: 'hubungi a@b.com', contact: '+62 812 3456 7890', nested: { x: 1 }, 'bad key!': 1 }),
    ).toEqual({ plan: 'gold', step: 2, ok: true });
  });

  it('maksimal 10 properti, string dipotong 100 karakter', () => {
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, 'x'.repeat(300)]));
    const out = sanitizeProps(many)!;
    expect(Object.keys(out)).toHaveLength(10);
    expect((out.k0 as string).length).toBe(100);
  });
});

describe('sdkScript', () => {
  const cfg = { key: 'abcDEF123_-abcDEF123', endpoint: 'https://trk.example.com/e', clickOut: 'https://trk.example.com/click-out', requireConsent: true };

  it('menghasilkan JavaScript yang valid', () => {
    expect(() => new Script(sdkScript(cfg))).not.toThrow();
  });

  it('konfigurasi tidak bisa menyisipkan tag </script>', () => {
    const js = sdkScript({ ...cfg, endpoint: 'https://x.test/</script><script>alert(1)</script>' });
    expect(js).not.toContain('</script>');
    expect(() => new Script(js)).not.toThrow();
  });

  it('tidak mengenal jenis event "verified" di sisi browser', () => {
    const js = sdkScript(cfg);
    expect(js).not.toContain('registration_success_verified');
    expect(js).not.toContain('purchase_verified');
  });
});
