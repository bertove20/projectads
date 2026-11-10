import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, TrackingEventType } from '@prisma/client';
import type Redis from 'ioredis';
import { REDIS } from '../common/core.module';
import { CryptoService } from '../common/crypto/crypto.service';
import { PrismaService } from '../common/prisma/prisma.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;
const CACHE_TTL_MS = 30_000;
export const MAX_EVENTS_PER_BATCH = 25;
/** Batas event per IP per website per menit. */
export const EVENTS_PER_MINUTE = 120;

const TYPE_MAP: Record<string, TrackingEventType> = {
  page_view: 'PAGE_VIEW',
  landing_view: 'LANDING_VIEW',
  registration_started: 'REGISTRATION_STARTED',
  registration_submitted: 'REGISTRATION_SUBMITTED',
  registration_success_observed: 'REGISTRATION_SUCCESS_OBSERVED',
  custom_event: 'CUSTOM_EVENT',
};
/** Event yang hanya boleh berasal dari backend/webhook terautentikasi (read.md Bagian D). */
const VERIFIED_ONLY = new Set(['registration_success_verified', 'purchase_verified']);
/** Nama properti yang berpotensi data pribadi — dibuang (minimasi data, read.md 17.12). */
const PII_TOKENS = new Set([
  'email', 'mail', 'phone', 'telp', 'telepon', 'hp', 'whatsapp', 'wa', 'msisdn', 'name', 'nama', 'firstname', 'lastname', 'fullname',
  'address', 'alamat', 'password', 'pass', 'pwd', 'pin', 'card', 'kartu', 'cc', 'cvv', 'nik', 'ktp', 'ssn', 'dob', 'birth', 'birthday',
  'lahir', 'token', 'ip', 'otp',
]);
/** Nama properti dianggap PII bila salah satu katanya (dipisah _ . - atau camelCase) ada di daftar. */
export function isPiiKey(key: string): boolean {
  const words = key
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[_.-]+/)
    .filter(Boolean);
  return words.some((w) => PII_TOKENS.has(w)) || /e-?mail|password|whatsapp/i.test(key);
}
const PII_VALUE = /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})|(\+?\d[\d\s-]{8,}\d)/i;

interface SiteCache {
  id: string;
  organizationId: string;
  domains: string[];
  requireConsent: boolean;
  active: boolean;
}

export interface CollectResult {
  status: number;
  body: { accepted: number; duplicates: number; rejected: Array<{ id?: string; reason: string }> } | { error: string };
  allowOrigin?: string;
}

/** Host diizinkan bila sama dengan domain terdaftar atau subdomain-nya. */
export function hostAllowed(host: string, domains: string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return domains.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Bersihkan properti event: maks 10 kunci, nilai primitif, tanpa PII. */
export function sanitizeProps(input: unknown): Record<string, string | number | boolean> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>).slice(0, 10)) {
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(k) || isPiiKey(k)) continue;
    if (typeof v === 'string') {
      if (PII_VALUE.test(v)) continue;
      out[k] = v.slice(0, 100);
    } else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  private readonly cache = new Map<string, { at: number; site: SiteCache | null }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async site(key: string): Promise<SiteCache | null> {
    if (!KEY_RE.test(key)) return null;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.site;
    const w = await this.prisma.website.findUnique({ where: { sdkKey: key } });
    const site = w
      ? { id: w.id, organizationId: w.organizationId, domains: [w.domain, ...w.extraDomains].map((d) => d.toLowerCase()), requireConsent: w.requireConsent, active: w.status === 'ACTIVE' }
      : null;
    if (this.cache.size > 2000) this.cache.clear();
    this.cache.set(key, { at: Date.now(), site });
    return site;
  }

  async collect(rawBody: unknown, origin: string | undefined, referer: string | undefined, ip: string | undefined): Promise<CollectResult> {
    let body: { k?: unknown; events?: unknown };
    try {
      body = typeof rawBody === 'string' ? JSON.parse(rawBody) : (rawBody as typeof body);
    } catch {
      return { status: 400, body: { error: 'invalid_json' } };
    }
    if (!body || typeof body !== 'object' || typeof body.k !== 'string') return { status: 400, body: { error: 'missing_key' } };

    const site = await this.site(body.k);
    if (!site || !site.active) return { status: 404, body: { error: 'unknown_key' } };

    // Allowlist domain: Origin (fetch/beacon) atau Referer sebagai cadangan
    let host: string | null = null;
    try {
      host = new URL(origin ?? referer ?? '').host.split(':')[0];
    } catch {
      host = null;
    }
    if (!host || !hostAllowed(host, site.domains)) return { status: 403, body: { error: 'origin_not_allowed' } };
    const allowOrigin = origin;

    const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS_PER_BATCH) : [];
    if (!events.length) return { status: 400, body: { error: 'no_events' }, allowOrigin };

    const ipHash = this.crypto.hashIp(ip);
    if (ipHash) {
      try {
        const k = `rl:events:${site.id}:${ipHash}:${Math.floor(Date.now() / 60_000)}`;
        const n = await this.redis.incrby(k, events.length);
        if (n === events.length) await this.redis.expire(k, 70);
        if (n > EVENTS_PER_MINUTE) return { status: 429, body: { error: 'rate_limited' }, allowOrigin };
      } catch {
        /* Redis mati: lanjut tanpa rate limit */
      }
    }

    const rejected: Array<{ id?: string; reason: string }> = [];
    const rows: Prisma.TrackingEventCreateManyInput[] = [];
    const cids = new Set<string>();
    const now = Date.now();
    for (const raw of events) {
      const e = raw as Record<string, unknown>;
      const id = typeof e.id === 'string' && UUID_RE.test(e.id) ? e.id : undefined;
      const t = typeof e.t === 'string' ? e.t : '';
      if (!id) {
        rejected.push({ reason: 'invalid_id' });
        continue;
      }
      if (VERIFIED_ONLY.has(t)) {
        rejected.push({ id, reason: 'verified_events_must_come_from_backend' });
        continue;
      }
      const type = TYPE_MAP[t];
      if (!type) {
        rejected.push({ id, reason: 'unknown_type' });
        continue;
      }
      const ts = typeof e.ts === 'number' && Math.abs(e.ts - now) < 86400_000 ? e.ts : now;
      const cid = typeof e.cid === 'string' && UUID_RE.test(e.cid) ? e.cid : null;
      if (cid) cids.add(cid);
      rows.push({
        organizationId: site.organizationId,
        websiteId: site.id,
        eventId: id,
        clickId: cid,
        sessionId: typeof e.sid === 'string' && UUID_RE.test(e.sid) ? e.sid : null,
        type,
        name: type === 'CUSTOM_EVENT' && typeof e.n === 'string' ? e.n.replace(/[^\w .:-]/g, '').slice(0, 60) || null : null,
        path: typeof e.p === 'string' ? e.p.split(/[?#]/)[0].slice(0, 300) : null,
        occurredAt: new Date(ts),
        props: sanitizeProps(e.props) as Prisma.InputJsonValue | undefined,
        ipHash,
      });
    }

    // Hubungkan ke campaign lewat click ID — hanya klik milik organisasi yang sama
    if (cids.size) {
      const clicks = await this.prisma.click.findMany({
        where: { id: { in: [...cids] }, organizationId: site.organizationId },
        select: { id: true, campaignId: true },
      });
      const map = new Map(clicks.map((c) => [c.id, c.campaignId]));
      for (const r of rows) {
        if (!r.clickId) continue;
        const campaignId = map.get(r.clickId);
        if (campaignId) r.campaignId = campaignId;
        else r.clickId = null; // click ID asing/palsu: event tetap disimpan tanpa atribusi
      }
    }

    let accepted = 0;
    if (rows.length) {
      const res = await this.prisma.trackingEvent.createMany({ data: rows, skipDuplicates: true });
      accepted = res.count;
    }
    return { status: 200, body: { accepted, duplicates: rows.length - accepted, rejected }, allowOrigin };
  }
}
