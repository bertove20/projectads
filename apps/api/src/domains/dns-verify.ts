import { promises as dns } from 'dns';

export const HOSTNAME_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export interface DnsCheck {
  ok: boolean;
  method: 'cname' | 'a-record' | null;
  detail: string;
}

export type Resolver = Pick<typeof dns, 'resolveCname' | 'resolve4'>;

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('DNS timeout')), ms))]);

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await withTimeout(fn(), 5000);
  } catch {
    return fallback;
  }
}

const clean = (h: string) => h.toLowerCase().replace(/\.$/, '');

/**
 * Domain dianggap mengarah ke platform bila:
 *  1) CNAME-nya (langsung) = domain tracking utama, ATAU
 *  2) semua alamat IPv4-nya ada di alamat IPv4 domain tracking utama (untuk domain apex tanpa CNAME).
 * Kepemilikan terbukti karena hanya pemilik DNS yang bisa membuat record tersebut.
 */
export async function checkDomainPointsTo(hostname: string, target: string, resolver: Resolver = dns): Promise<DnsCheck> {
  const host = clean(hostname);
  const tgt = clean(target);
  const cnames = (await safe(() => resolver.resolveCname(host), [] as string[])).map(clean);
  if (cnames.includes(tgt)) return { ok: true, method: 'cname', detail: `CNAME ${host} → ${tgt}` };

  const [hostA, targetA] = await Promise.all([safe(() => resolver.resolve4(host), [] as string[]), safe(() => resolver.resolve4(tgt), [] as string[])]);
  if (hostA.length && targetA.length && hostA.every((ip) => targetA.includes(ip))) {
    return { ok: true, method: 'a-record', detail: `A ${host} → ${hostA.join(', ')}` };
  }
  if (cnames.length) return { ok: false, method: null, detail: `CNAME ${host} mengarah ke ${cnames.join(', ')}, seharusnya ${tgt}` };
  if (hostA.length) return { ok: false, method: null, detail: `A ${host} → ${hostA.join(', ')}, tidak sama dengan IP ${tgt} (${targetA.join(', ') || 'tidak ditemukan'})` };
  return { ok: false, method: null, detail: `Record DNS untuk ${host} belum ditemukan (propagasi DNS bisa memerlukan beberapa menit)` };
}
