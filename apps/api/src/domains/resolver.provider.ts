import { Logger, Provider } from '@nestjs/common';
import { promises as dns } from 'dns';
import { ENV, Env } from '../config/env';
import type { Resolver } from './dns-verify';
import { DNS_RESOLVER } from './domains.service';

/**
 * Resolver DNS: produksi memakai DNS asli. Bila DNS_TEST_OVERRIDES diisi (hanya compose.local.yaml),
 * host yang terdaftar di peta dijawab statis; host lain tetap memakai DNS asli.
 */
export const dnsResolverProvider: Provider = {
  provide: DNS_RESOLVER,
  inject: [ENV],
  useFactory: (env: Env): Resolver => {
    if (!env.DNS_TEST_OVERRIDES) return dns;
    let map: Record<string, string> = {};
    try {
      map = JSON.parse(env.DNS_TEST_OVERRIDES) as Record<string, string>;
    } catch {
      throw new Error('DNS_TEST_OVERRIDES bukan JSON yang valid');
    }
    new Logger('DnsResolver').warn('DNS_TEST_OVERRIDES aktif — hanya untuk pengujian lokal');
    const get = (host: string, kind: 'cname' | 'a') => {
      const h = host.toLowerCase();
      // Kunci "*.suffix" cocok untuk semua subdomain suffix
      const wildcard = Object.keys(map).find((k) => k.startsWith('*.') && h.endsWith(k.slice(1)));
      const v = map[h] ?? (wildcard ? map[wildcard] : undefined);
      return v?.startsWith(`${kind}:`) ? v.slice(kind.length + 1).split(',') : null;
    };
    return {
      resolveCname: async (host: string) => get(host, 'cname') ?? dns.resolveCname(host),
      resolve4: async (host: string) => get(host, 'a') ?? dns.resolve4(host),
    } as Resolver;
  },
};
