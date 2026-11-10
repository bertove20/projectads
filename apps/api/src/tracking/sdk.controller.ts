import { Controller, Get, Options, Post, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Inject } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { EventsService } from './events.service';
import { sdkScript } from './sdk-source';
import { trackerBase, trackerHost } from '../common/public-urls';
import { DomainsService } from '../domains/domains.service';

/**
 * JS SDK di domain tracking:
 * - GET  /sdk.js?k=<sdkKey>  → skrip SDK dengan konfigurasi website
 * - POST /e                  → kumpulan event (text/plain JSON agar tidak memicu preflight CORS)
 */
@ApiExcludeController()
@Controller()
export class SdkController {
  constructor(
    private readonly events: EventsService,
    private readonly domains: DomainsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('sdk.js')
  async script(@Query('k') key: string | undefined, @Req() req: Request, @Res() res: Response) {
    const site = key ? await this.events.site(key) : null;
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Skrip dimuat lintas domain oleh landing page
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (!site || !site.active) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(404).send('/* EAIP: sdk key tidak dikenal atau website nonaktif */');
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=300');
    // SDK mengirim event ke domain tempat ia dimuat (domain kustom first-party bila ACTIVE)
    const host = req.hostname?.toLowerCase();
    const sameHost = host && (host === trackerHost(this.env) || (await this.domains.isAllowedForTls(host)));
    const base = sameHost ? `${req.protocol}://${req.get('host')}` : trackerBase(this.env);
    res.setHeader('Vary', 'Host');
    res.send(sdkScript({ key: key!, endpoint: `${base}/e`, clickOut: `${base}/click-out`, requireConsent: site.requireConsent }));
  }

  @Options('e')
  preflight(@Req() req: Request, @Res() res: Response) {
    this.cors(req, res, req.headers.origin);
    res.status(204).end();
  }

  @Post('e')
  async collect(@Req() req: Request, @Res() res: Response) {
    const out = await this.events.collect(req.body, req.headers.origin, req.headers.referer, req.ip);
    this.cors(req, res, out.allowOrigin);
    res.setHeader('Cache-Control', 'no-store');
    res.status(out.status).json(out.body);
  }

  /** CORS hanya untuk origin yang lolos allowlist domain website; tanpa kredensial/cookie. */
  private cors(_req: Request, res: Response, origin: string | undefined) {
    res.setHeader('Vary', 'Origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (!origin) return;
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}
