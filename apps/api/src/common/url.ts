import { promises as dns } from 'dns';
import { isIP } from 'net';

export function isHttpUrl(value: string, opts: { httpsOnly?: boolean } = {}): boolean {
  try {
    const u = new URL(value);
    if (opts.httpsOnly) return u.protocol === 'https:';
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Tambahkan / timpa query parameter pada URL. */
export function withQuery(url: string, params: Record<string, string>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

/** Ganti placeholder {name} dengan nilai yang di-encode. Placeholder tak dikenal dibiarkan kosong. */
export function renderTemplate(template: string, values: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
    const v = values[key];
    return v === null || v === undefined ? '' : encodeURIComponent(String(v));
  });
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

export class UnsafeUrlError extends Error {}

/**
 * Perlindungan SSRF untuk request keluar: hanya http(s), port standar,
 * dan host tidak boleh resolve ke IP privat/loopback/link-local.
 */
export async function assertSafeOutboundUrl(
  url: string,
  opts: { allowHttp: boolean; allowPrivate: boolean },
): Promise<URL> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new UnsafeUrlError('URL tidak valid');
  }
  if (u.protocol !== 'https:' && !(opts.allowHttp && u.protocol === 'http:')) {
    throw new UnsafeUrlError('Hanya HTTPS yang diizinkan');
  }
  if (u.username || u.password) throw new UnsafeUrlError('URL tidak boleh memuat kredensial');
  if (u.port && !['80', '443'].includes(u.port) && !opts.allowPrivate) {
    throw new UnsafeUrlError('Port tidak diizinkan');
  }
  if (opts.allowPrivate) return u;

  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (!addresses.length || addresses.some(isPrivateIp)) {
    throw new UnsafeUrlError('Host tujuan mengarah ke alamat internal');
  }
  return u;
}
