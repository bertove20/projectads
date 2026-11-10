import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { trackerHost } from '../common/public-urls';
import { ENV, Env } from '../config/env';
import { checkDomainPointsTo, DnsCheck, Resolver } from './dns-verify';

/** Hook untuk pengujian: resolver DNS bisa diganti (mis. dengan peta statis). */
export const DNS_RESOLVER = Symbol('DNS_RESOLVER');

@Injectable()
export class DomainsService {
  private readonly logger = new Logger(DomainsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
    @Inject(DNS_RESOLVER) private readonly resolver: Resolver,
  ) {}

  /** Host platform yang tidak boleh didaftarkan sebagai domain kustom. */
  reservedHosts(): string[] {
    const hosts = [this.env.TRACKER_PUBLIC_URL, this.env.POSTBACK_PUBLIC_URL, this.env.DASHBOARD_ORIGIN]
      .filter((u): u is string => !!u)
      .map((u) => new URL(u).hostname.toLowerCase());
    return [...new Set(hosts)];
  }

  /** Periksa DNS lalu perbarui status. Domain yang tidak lagi mengarah ke platform → FAILED (sertifikat tidak diterbitkan lagi). */
  async verify(domainId: string): Promise<{ status: 'ACTIVE' | 'FAILED' | 'PENDING'; check: DnsCheck }> {
    const d = await this.prisma.trackingDomain.findUniqueOrThrow({ where: { id: domainId } });
    const check = await checkDomainPointsTo(d.hostname, trackerHost(this.env), this.resolver);
    const status = check.ok ? 'ACTIVE' : d.status === 'ACTIVE' ? 'FAILED' : 'PENDING';
    await this.prisma.trackingDomain.update({
      where: { id: d.id },
      data: { status, lastCheckAt: new Date(), lastError: check.ok ? null : check.detail, verifiedAt: check.ok ? (d.verifiedAt ?? new Date()) : d.verifiedAt },
    });
    if (d.status === 'ACTIVE' && !check.ok) this.logger.warn({ hostname: d.hostname, detail: check.detail }, 'Domain tracking tidak lagi mengarah ke platform');
    return { status, check };
  }

  /** Dipakai Caddy (on-demand TLS): sertifikat hanya untuk domain ACTIVE. */
  async isAllowedForTls(hostname: string): Promise<boolean> {
    const h = hostname.toLowerCase().replace(/\.$/, '');
    if (!h || h.length > 253) return false;
    const d = await this.prisma.trackingDomain.findUnique({ where: { hostname: h }, select: { status: true } });
    return d?.status === 'ACTIVE';
  }
}
