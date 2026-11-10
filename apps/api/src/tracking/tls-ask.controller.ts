import { Controller, Get, Inject, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { CryptoService } from '../common/crypto/crypto.service';
import { ENV, Env } from '../config/env';
import { DomainsService } from '../domains/domains.service';

/**
 * Endpoint "ask" untuk on-demand TLS Caddy: sertifikat HTTPS hanya diterbitkan untuk domain kustom ACTIVE.
 * Caddy memanggilnya lewat jaringan internal Docker; Caddyfile TIDAK meneruskan path /internal/* dari internet.
 */
@ApiExcludeController()
@Controller('internal')
export class TlsAskController {
  constructor(
    private readonly domains: DomainsService,
    private readonly crypto: CryptoService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('tls-allowed')
  async allowed(@Query('domain') domain: string | undefined, @Query('key') key: string | undefined, @Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    if (this.env.INTERNAL_ASK_KEY && !(key && this.crypto.safeEqual(key, this.env.INTERNAL_ASK_KEY))) {
      res.status(403).send('forbidden');
      return;
    }
    const ok = typeof domain === 'string' && (await this.domains.isAllowedForTls(domain));
    res.status(ok ? 200 : 404).send(ok ? 'ok' : 'not allowed');
  }
}
