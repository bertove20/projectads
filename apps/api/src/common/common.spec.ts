import { randomBytes } from 'crypto';
import { validatePasswordStrength } from '../auth/password';
import { redact } from './audit/audit.service';
import { CryptoService } from './crypto/crypto.service';
import { assertSafeOutboundUrl, isPrivateIp, renderTemplate, UnsafeUrlError, withQuery } from './url';

const crypto = new CryptoService({
  APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  APP_ENCRYPTION_KEY_VERSION: 1,
  IP_HASH_SECRET: 'x'.repeat(40),
});

describe('CryptoService', () => {
  it('enkripsi → dekripsi kembali ke teks asli', () => {
    const secret = 'https://trk.example.com/conversion/aid/123/SECRETKEY?click_id={external_click_id}';
    const enc = crypto.encrypt(secret);
    expect(enc).not.toContain('SECRETKEY');
    expect(crypto.decrypt(enc)).toBe(secret);
  });

  it('ciphertext yang diubah ditolak (AES-GCM auth tag)', () => {
    const enc = crypto.encrypt('hello');
    const parts = enc.split(':');
    const data = Buffer.from(parts[3], 'base64');
    data[0] ^= 0xff;
    parts[3] = data.toString('base64');
    expect(() => crypto.decrypt(parts.join(':'))).toThrow();
  });

  it('hash IP konsisten dan tidak memuat IP asli', () => {
    const h = crypto.hashIp('203.0.113.10')!;
    expect(h).toHaveLength(32);
    expect(h).toBe(crypto.hashIp('203.0.113.10'));
    expect(h).not.toContain('203');
    expect(crypto.hashIp(undefined)).toBeNull();
  });
});

describe('url helpers', () => {
  it.each(['10.0.0.1', '127.0.0.1', '192.168.1.5', '172.16.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:127.0.0.1'])(
    '%s dianggap privat',
    (ip) => expect(isPrivateIp(ip)).toBe(true),
  );
  it.each(['8.8.8.8', '203.0.113.10', '2606:4700::1111'])('%s publik', (ip) => expect(isPrivateIp(ip)).toBe(false));

  it('menolak target SSRF', async () => {
    const opts = { allowHttp: false, allowPrivate: false };
    await expect(assertSafeOutboundUrl('http://example.com/x', opts)).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeOutboundUrl('https://169.254.169.254/latest/meta-data', opts)).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeOutboundUrl('https://user:pass@example.com/', opts)).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeOutboundUrl('https://127.0.0.1:8080/', opts)).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeOutboundUrl('file:///etc/passwd', opts)).rejects.toThrow(UnsafeUrlError);
  });

  it('renderTemplate meng-encode nilai dan mengosongkan placeholder tanpa nilai', () => {
    expect(renderTemplate('https://x.test/?a={a}&b={b}', { a: 'x y' })).toBe('https://x.test/?a=x%20y&b=');
  });

  it('withQuery menambah parameter tanpa merusak query lama', () => {
    expect(withQuery('https://lp.test/p?x=1', { cid: 'abc' })).toBe('https://lp.test/p?x=1&cid=abc');
  });
});

describe('password policy', () => {
  it('menolak password lemah', () => {
    expect(validatePasswordStrength('short')).not.toBeNull();
    expect(validatePasswordStrength('alllowercaseletters')).not.toBeNull();
  });
  it('menerima password kuat', () => {
    expect(validatePasswordStrength('Kuat-Sekali-2026')).toBeNull();
  });
});

describe('audit redact', () => {
  it('menyembunyikan field rahasia secara rekursif', () => {
    expect(redact({ name: 'a', passwordHash: 'x', nested: { postbackToken: 'y', ok: 1 } })).toEqual({
      name: 'a',
      passwordHash: '[REDACTED]',
      nested: { postbackToken: '[REDACTED]', ok: 1 },
    });
  });
});
