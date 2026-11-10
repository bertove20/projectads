import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type Redis from 'ioredis';
import { UAParser } from 'ua-parser-js';
import { v7 as uuidv7 } from 'uuid';
import { REDIS } from '../common/core.module';
import { CryptoService } from '../common/crypto/crypto.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { CLICK_BUFFER_KEY } from '../common/queues';
import { hostOf, withQuery } from '../common/url';
import { ENV, Env } from '../config/env';
import { CLICK_FIELDS, readMapping } from '../postbacks/mapping';
import { detectBot, isBot, RAPID_REPEAT_WINDOW_SECONDS } from './bot-filter';
import { matchRoute, normalizeConditions, pickVariant, primaryLanguage, RouteDef, VisitorContext } from './routing';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CACHE_TTL_MS = 30_000;
const DB_WRITE_TIMEOUT_MS = 1500;
/** Cookie sticky varian berlaku 30 hari di domain tracking. */
export const VARIANT_COOKIE_PREFIX = 'eaip_v_';

/** Data campaign yang di-cache untuk jalur klik (tanpa query DB pada setiap klik). */
interface CampaignCache {
  id: string;
  organizationId: string;
  status: string;
  flowType: 'DIRECT' | 'LANDING';
  offerId: string | null;
  offerUrl: string | null;
  offerActive: boolean;
  landingPageId: string | null;
  landingUrl: string | null;
  landingActive: boolean;
  fallbackUrl: string | null;
  mapping: Record<keyof typeof CLICK_FIELDS, string>;
  routes: RouteDef[];
}

export interface ClickRequest {
  token: string;
  query: Record<string, unknown>;
  ip: string | undefined;
  userAgent: string | undefined;
  acceptLanguage: string | undefined;
  referer: string | undefined;
  /** Cookie tracker milik pengunjung (untuk varian sticky) */
  cookies?: Record<string, string | undefined>;
}

export interface ClickResult {
  location: string;
  clickId: string | null;
  /** Cookie sticky varian yang perlu di-set */
  variantCookie?: { name: string; value: string };
}

function str(v: unknown, max = 200): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

function safeConditions(raw: unknown) {
  try {
    return normalizeConditions(raw);
  } catch {
    return { countries: ['__invalid__'] }; // data rusak → route tidak pernah cocok
  }
}

@Injectable()
export class ClickService {
  private readonly logger = new Logger(ClickService.name);
  private readonly cache = new Map<string, { at: number; campaign: CampaignCache | null }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async load(token: string): Promise<CampaignCache | null> {
    const hit = this.cache.get(token);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.campaign;
    const c = await this.prisma.campaign.findUnique({
      where: { token },
      include: {
        offer: { select: { url: true, status: true } },
        landingPage: { select: { url: true, status: true } },
        networkAccount: { select: { paramMapping: true } },
        routes: {
          orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
          include: {
            variants: {
              orderBy: { createdAt: 'asc' },
              include: { offer: { select: { url: true, status: true } }, landingPage: { select: { url: true, status: true } } },
            },
          },
        },
      },
    });
    const campaign: CampaignCache | null = c
      ? {
          id: c.id,
          organizationId: c.organizationId,
          status: c.status,
          flowType: c.flowType,
          offerId: c.offerId,
          offerUrl: c.offer?.url ?? null,
          offerActive: c.offer?.status === 'ACTIVE',
          landingPageId: c.landingPageId,
          landingUrl: c.landingPage?.url ?? null,
          landingActive: c.landingPage?.status === 'ACTIVE',
          fallbackUrl: c.fallbackUrl,
          mapping: readMapping(c.networkAccount.paramMapping, CLICK_FIELDS),
          routes: c.routes.map((r) => ({
            id: r.id,
            enabled: r.enabled,
            conditions: safeConditions(r.conditions),
            variants: r.variants.map((v) => ({
              id: v.id,
              weight: v.weight,
              enabled: v.enabled,
              offerId: v.offerId,
              offerUrl: v.offer.url,
              offerActive: v.offer.status === 'ACTIVE',
              landingPageId: v.landingPageId,
              landingUrl: v.landingPage?.url ?? null,
              landingActive: v.landingPage?.status === 'ACTIVE',
            })),
          })),
        }
      : null;
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(token, { at: Date.now(), campaign });
    return campaign;
  }

  /**
   * Catat klik lalu tentukan tujuan redirect. Tidak pernah melempar error:
   * bila terjadi kegagalan, pengunjung tetap diarahkan ke fallback.
   */
  async handleClick(req: ClickRequest): Promise<ClickResult> {
    let campaign: CampaignCache | null = null;
    try {
      campaign = /^[A-Za-z0-9_-]{6,32}$/.test(req.token) ? await this.load(req.token) : null;
    } catch (err) {
      this.logger.error({ err }, 'Gagal membaca campaign; redirect ke fallback');
      return { location: this.env.DEFAULT_FALLBACK_URL, clickId: null };
    }
    const fallback = campaign?.fallbackUrl ?? this.env.DEFAULT_FALLBACK_URL;
    if (!campaign || campaign.status !== 'ACTIVE') return { location: fallback, clickId: null };

    const q = req.query;
    const m = campaign.mapping;
    const ua = new UAParser(req.userAgent ?? '').getResult();
    const countryRaw = str(q[m.country], 2)?.toUpperCase();
    const country = countryRaw && /^[A-Z]{2}$/.test(countryRaw) ? countryRaw : null;
    const visitor: VisitorContext = {
      country,
      device: ua.device.type ?? 'desktop',
      os: ua.os.name ?? null,
      browser: ua.browser.name ?? null,
      language: primaryLanguage(req.acceptLanguage),
    };

    // 1) Route yang cocok → varian berbobot (sticky); 2) bila tidak ada, tujuan default campaign.
    let offerId: string | null;
    let offerUrl: string;
    let landingPageId: string | null = null;
    let landingUrl: string | null = null;
    let routeId: string | null = null;
    let variantId: string | null = null;
    let variantCookie: ClickResult['variantCookie'];

    const route = matchRoute(campaign.routes, visitor);
    if (route) {
      const cookieName = `${VARIANT_COOKIE_PREFIX}${route.id.replace(/-/g, '').slice(0, 16)}`;
      const variant = pickVariant(route, Math.random(), req.cookies?.[cookieName]);
      if (!variant) return { location: fallback, clickId: null };
      routeId = route.id;
      variantId = variant.id;
      offerId = variant.offerId;
      offerUrl = variant.offerUrl;
      if (variant.landingPageId && variant.landingUrl) {
        landingPageId = variant.landingPageId;
        landingUrl = variant.landingUrl;
      }
      if (req.cookies?.[cookieName] !== variant.id) variantCookie = { name: cookieName, value: variant.id };
    } else {
      if (!campaign.offerUrl || !campaign.offerActive) return { location: fallback, clickId: null };
      offerId = campaign.offerId;
      offerUrl = campaign.offerUrl;
      if (campaign.flowType === 'LANDING' && campaign.landingUrl && campaign.landingActive) {
        landingPageId = campaign.landingPageId;
        landingUrl = campaign.landingUrl;
      }
    }

    const clickId = uuidv7();
    const ipHash = this.crypto.hashIp(req.ip);
    const costRaw = str(q[m.cost], 32);
    const cost = costRaw && /^\d{1,9}(\.\d{1,9})?$/.test(costRaw) ? costRaw : undefined;

    const known = new Set<string>(Object.values(m));
    const extra: Record<string, string> = {};
    for (const [k, v] of Object.entries(q)) {
      if (!known.has(k) && typeof v === 'string' && Object.keys(extra).length < 20) extra[k.slice(0, 64)] = v.slice(0, 200);
    }

    let recent = 0;
    if (ipHash) {
      try {
        const key = `rl:click:${campaign.id}:${ipHash}`;
        recent = await this.redis.incr(key);
        if (recent === 1) await this.redis.expire(key, RAPID_REPEAT_WINDOW_SECONDS);
        recent -= 1; // jumlah klik SEBELUM klik ini
      } catch {
        recent = 0; // Redis tidak tersedia: lewati pemeriksaan pengulangan
      }
    }
    const reasons = detectBot({ userAgent: req.userAgent, acceptLanguage: req.acceptLanguage, recentClicksFromIp: recent });

    const data: Prisma.ClickCreateManyInput = {
      id: clickId,
      organizationId: campaign.organizationId,
      campaignId: campaign.id,
      offerId,
      landingPageId,
      routeId,
      variantId,
      language: visitor.language,
      externalClickId: str(q[m.externalClickId], 255),
      zoneId: str(q[m.zoneId], 100),
      subId: str(q[m.subId], 255),
      creativeId: str(q[m.creativeId], 100),
      feedId: str(q[m.feedId], 100),
      cost,
      country,
      deviceType: visitor.device,
      os: visitor.os?.slice(0, 50) ?? null,
      browser: visitor.browser?.slice(0, 50) ?? null,
      ipHash,
      referrerDomain: req.referer ? hostOf(req.referer)?.slice(0, 255) ?? null : null,
      extraParams: Object.keys(extra).length ? extra : undefined,
      isBot: isBot(reasons),
      botReasons: reasons,
    };

    await this.persist(data);

    const location = landingUrl ? withQuery(landingUrl, { cid: clickId }) : offerUrl.replaceAll('{click_id}', encodeURIComponent(clickId));
    return { location, clickId, variantCookie };
  }

  /** Tulis ke PostgreSQL; bila gagal/lambat, simpan ke buffer Redis untuk ditulis ulang oleh worker. */
  private async persist(data: Prisma.ClickCreateManyInput) {
    try {
      await Promise.race([
        this.prisma.click.createMany({ data: [data], skipDuplicates: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('db write timeout')), DB_WRITE_TIMEOUT_MS)),
      ]);
    } catch (err) {
      this.logger.warn({ err: (err as Error).message, clickId: data.id }, 'Klik dialihkan ke buffer Redis');
      try {
        await this.redis.rpush(CLICK_BUFFER_KEY, JSON.stringify(data));
      } catch (err2) {
        this.logger.error({ err: err2, clickId: data.id }, 'Klik HILANG: PostgreSQL dan Redis tidak tersedia');
      }
    }
  }

  /** Click-out dari landing page menuju offer. */
  async handleClickOut(cid: string | undefined): Promise<string> {
    if (!cid || !UUID_RE.test(cid)) return this.env.DEFAULT_FALLBACK_URL;
    try {
      const click = await this.prisma.click.findUnique({
        where: { id: cid },
        select: { id: true, clickOutAt: true, offer: { select: { url: true, status: true } }, campaign: { select: { fallbackUrl: true } } },
      });
      if (!click) return this.env.DEFAULT_FALLBACK_URL;
      if (!click.offer || click.offer.status !== 'ACTIVE') return click.campaign.fallbackUrl ?? this.env.DEFAULT_FALLBACK_URL;
      if (!click.clickOutAt) {
        await this.prisma.click.updateMany({ where: { id: cid, clickOutAt: null }, data: { clickOutAt: new Date() } });
      }
      return click.offer.url.replaceAll('{click_id}', encodeURIComponent(cid));
    } catch (err) {
      this.logger.error({ err }, 'Click-out gagal');
      return this.env.DEFAULT_FALLBACK_URL;
    }
  }
}
