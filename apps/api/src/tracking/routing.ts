/**
 * Routing & rotasi (read.md 17.3) — fungsi murni, tanpa I/O.
 *
 * Aturan:
 * - Route dievaluasi berurutan (priority); route pertama yang semua kondisinya cocok dipakai.
 * - Kondisi kosong/tidak diisi = cocok untuk semua nilai.
 * - Pemilihan varian berbobot; pengunjung yang sama tetap di varian yang sama (sticky) selama varian masih aktif.
 * - Kondisi hanya memakai atribut teknis yang SAMA untuk setiap pengunjung yang cocok (negara, device, OS,
 *   browser, bahasa). Tidak ada aturan yang membedakan reviewer/moderator jaringan → tidak ada cloaking.
 */

export const CONDITION_KEYS = ['countries', 'devices', 'os', 'browsers', 'languages'] as const;
export type ConditionKey = (typeof CONDITION_KEYS)[number];
export type RouteConditions = Partial<Record<ConditionKey, string[]>>;

export const DEVICE_VALUES = ['mobile', 'tablet', 'desktop', 'smarttv', 'console', 'wearable', 'embedded'];

export interface VisitorContext {
  country: string | null;
  device: string | null;
  os: string | null;
  browser: string | null;
  language: string | null;
}

export interface VariantDef {
  id: string;
  weight: number;
  enabled: boolean;
  offerId: string;
  offerUrl: string;
  offerActive: boolean;
  landingPageId: string | null;
  landingUrl: string | null;
  landingActive: boolean;
}

export interface RouteDef {
  id: string;
  enabled: boolean;
  conditions: RouteConditions;
  variants: VariantDef[];
}

const norm = (v: string) => v.trim().toLowerCase();

/** Validasi & normalisasi kondisi dari input admin. Melempar Error berisi pesan yang bisa ditampilkan. */
export function normalizeConditions(input: unknown): RouteConditions {
  if (input === null || input === undefined) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Kondisi harus berupa objek');
  const out: RouteConditions = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!(CONDITION_KEYS as readonly string[]).includes(k)) throw new Error(`Kondisi tidak dikenal: ${k}`);
    if (!Array.isArray(v)) throw new Error(`Kondisi ${k} harus berupa daftar`);
    if (v.length > 300) throw new Error(`Kondisi ${k} terlalu panjang`);
    // Seragamkan huruf DULU, baru buang duplikat ("id" dan "ID" = satu nilai)
    const canon = (x: string) => (k === 'countries' ? x.toUpperCase() : norm(x));
    const values = [...new Set(v.map((x) => (typeof x === 'string' ? canon(x.trim()) : '')).filter(Boolean))];
    for (const x of values) {
      if (k === 'countries' && !/^[A-Za-z]{2}$/.test(x)) throw new Error(`Kode negara tidak valid: ${x}`);
      if (k === 'languages' && !/^[A-Za-z]{2,3}$/.test(x)) throw new Error(`Kode bahasa tidak valid: ${x}`);
      if (k === 'devices' && !DEVICE_VALUES.includes(norm(x))) throw new Error(`Device tidak dikenal: ${x}`);
      if ((k === 'os' || k === 'browsers') && !/^[A-Za-z0-9 ._-]{1,40}$/.test(x)) throw new Error(`Nilai ${k} tidak valid: ${x}`);
    }
    if (values.length) out[k as ConditionKey] = values;
  }
  return out;
}

function matches(cond: RouteConditions, ctx: VisitorContext): boolean {
  const check = (allowed: string[] | undefined, value: string | null, upper = false) => {
    if (!allowed || allowed.length === 0) return true;
    if (!value) return false;
    const v = upper ? value.toUpperCase() : norm(value);
    return allowed.includes(v);
  };
  return (
    check(cond.countries, ctx.country, true) &&
    check(cond.devices, ctx.device) &&
    check(cond.os, ctx.os) &&
    check(cond.browsers, ctx.browser) &&
    check(cond.languages, ctx.language)
  );
}

/** Varian yang bisa melayani traffic: aktif, berbobot, offer aktif, dan landing (bila ada) aktif. */
export function usableVariants(route: RouteDef): VariantDef[] {
  return route.variants.filter((v) => v.enabled && v.weight > 0 && v.offerActive && (!v.landingPageId || (v.landingUrl && v.landingActive)));
}

/** Route pertama (sesuai urutan) yang aktif, cocok, dan punya minimal satu varian yang bisa dipakai. */
export function matchRoute(routes: RouteDef[], ctx: VisitorContext): RouteDef | null {
  for (const r of routes) {
    if (r.enabled && matches(r.conditions, ctx) && usableVariants(r).length > 0) return r;
  }
  return null;
}

/** Pilih varian berbobot. `rand` ∈ [0,1). Varian sticky dipakai bila masih bisa dipakai. */
export function pickVariant(route: RouteDef, rand: number, stickyVariantId?: string | null): VariantDef | null {
  const usable = usableVariants(route);
  if (!usable.length) return null;
  if (stickyVariantId) {
    const sticky = usable.find((v) => v.id === stickyVariantId);
    if (sticky) return sticky;
  }
  const total = usable.reduce((s, v) => s + v.weight, 0);
  let point = Math.min(Math.max(rand, 0), 0.999999999) * total;
  for (const v of usable) {
    if (point < v.weight) return v;
    point -= v.weight;
  }
  return usable[usable.length - 1];
}

/** Bahasa utama dari header Accept-Language, mis. "id-ID,id;q=0.9,en;q=0.8" → "id". */
export function primaryLanguage(acceptLanguage: string | undefined): string | null {
  if (!acceptLanguage) return null;
  const first = acceptLanguage.split(',')[0]?.trim().split(';')[0]?.split('-')[0]?.toLowerCase();
  return first && /^[a-z]{2,3}$/.test(first) ? first : null;
}
