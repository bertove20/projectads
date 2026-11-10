import { All, Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ConversionService } from '../postbacks/conversion.service';
import { ClickService } from './click.service';

const CID_COOKIE = 'eaip_cid';

function noStore(res: Response) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  // Jangan bocorkan tracking URL (dan parameternya) sebagai Referer ke halaman tujuan.
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
}

/**
 * Endpoint publik di domain tracking (proses "tracker", terpisah dari API dashboard).
 * - GET /c/:token          → catat klik, redirect 302 ke offer / landing page
 * - GET /click-out?cid=…   → dari landing page ke offer
 * - GET|POST /postback/in/:token → postback masuk dari affiliate network
 */
@ApiExcludeController()
@Controller()
export class TrackerController {
  constructor(
    private readonly clicks: ClickService,
    private readonly conversions: ConversionService,
  ) {}

  @Get('c/:token')
  async click(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    const { location, clickId } = await this.clicks.handleClick({
      token,
      query: req.query as Record<string, unknown>,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      acceptLanguage: req.headers['accept-language'],
      referer: req.headers.referer,
    });
    noStore(res);
    if (clickId) {
      res.cookie(CID_COOKIE, clickId, { httpOnly: true, secure: req.secure, sameSite: 'lax', maxAge: 30 * 86400_000, path: '/' });
    }
    res.redirect(302, location);
  }

  @Get('click-out')
  async clickOut(@Query('cid') cid: string | undefined, @Req() req: Request, @Res() res: Response) {
    const id = typeof cid === 'string' && cid ? cid : (req.cookies?.[CID_COOKIE] as string | undefined);
    const location = await this.clicks.handleClickOut(id);
    noStore(res);
    res.redirect(302, location);
  }

  @All('postback/in/:token')
  async inbound(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    if (!['GET', 'POST'].includes(req.method)) {
      res.status(405).json({ status: 'method_not_allowed' });
      return;
    }
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const out = await this.conversions.handleInbound({
      token,
      params: { ...body, ...(req.query as Record<string, unknown>) },
      ip: req.ip,
      method: req.method,
    });
    noStore(res);
    res.status(out.httpStatus).json({ status: out.result.toLowerCase(), message: out.message, conversion_id: out.conversionId });
  }

  @Get('healthz')
  health(@Res() res: Response) {
    res.json({ status: 'ok' });
  }
}
