import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const base64Key32 = z.string().refine(
  (v) => {
    try {
      return Buffer.from(v, 'base64').length === 32;
    } catch {
      return false;
    }
  },
  { message: 'harus 32 byte dalam base64 (buat dengan: openssl rand -base64 32)' },
);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),

  API_PORT: z.coerce.number().int().default(4000),
  TRACKER_PORT: z.coerce.number().int().default(4100),

  /** Origin dashboard (untuk CORS & pemeriksaan Origin/CSRF), mis. https://admin.example.com */
  DASHBOARD_ORIGIN: z.string().url().default('http://localhost:3000'),
  /** Base URL publik tracker, mis. https://trk.example.com */
  TRACKER_PUBLIC_URL: z.string().url().default('http://localhost:4100'),
  /** Base URL publik untuk postback MASUK dari affiliate network, mis. https://pb.example.com (default = TRACKER_PUBLIC_URL). */
  POSTBACK_PUBLIC_URL: z.string().url().optional(),
  /** Kunci opsional untuk endpoint internal 'ask' on-demand TLS Caddy. */
  INTERNAL_ASK_KEY: z.string().min(16).optional(),
  /** HANYA untuk pengujian lokal: JSON {"host": "cname:target" | "a:1.2.3.4"} menggantikan DNS asli. */
  DNS_TEST_OVERRIDES: z.string().optional(),
  /** Tujuan bila campaign tidak ditemukan / nonaktif dan campaign tidak punya fallback */
  DEFAULT_FALLBACK_URL: z.string().url().default('https://www.google.com'),

  /** Kunci enkripsi kredensial (AES-256-GCM). */
  APP_ENCRYPTION_KEY: base64Key32,
  APP_ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).default(1),
  /** Secret HMAC untuk hash IP. */
  IP_HASH_SECRET: z.string().min(32),

  SESSION_TTL_HOURS: z.coerce.number().int().min(1).default(12),
  SESSION_ABSOLUTE_DAYS: z.coerce.number().int().min(1).default(7),
  COOKIE_SECURE: bool.default('true'),
  /** Wajibkan MFA untuk Super Admin & Owner. */
  MFA_ENFORCE_ADMIN: bool.default('true'),

  /** Izinkan postback keluar via http:// (hanya untuk pengujian lokal). */
  ALLOW_INSECURE_POSTBACK: bool.default('false'),
  /** Izinkan postback keluar ke IP privat (hanya untuk pengujian lokal dengan mock server). */
  ALLOW_PRIVATE_POSTBACK_TARGETS: bool.default('false'),

  /** Jumlah proxy terpercaya di depan aplikasi (Caddy = 1) untuk membaca IP klien. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // ── Phase 2: integrasi jaringan & notifikasi ──
  /** Base URL API RollerAds (dokumentasi resmi: https://my.rollerads.com/api/docs). Diubah hanya untuk mock lokal. */
  ROLLERADS_API_BASE: z.string().url().default('https://api.rollerads.com/v2'),
  /** Base URL Propeller SSP API v5 (spesifikasi resmi: https://ssp-api.propellerads.com/v5/docs/). Diubah hanya untuk mock lokal. */
  PROPELLERADS_API_BASE: z.string().url().default('https://ssp-api.propellerads.com/v5'),
  /** Base URL Telegram Bot API. Diubah hanya untuk mock lokal. */
  TELEGRAM_API_BASE: z.string().url().default('https://api.telegram.org'),
  /** Interval sinkronisasi statistik jaringan (menit). */
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(15).default(60),
  /** Jumlah hari ke belakang yang disinkronkan ulang untuk menangkap data terlambat. */
  SYNC_LOOKBACK_DAYS: z.coerce.number().int().min(0).max(14).default(3),
  /** Ambang selisih rekonsiliasi (persen) yang memicu alert. */
  RECON_THRESHOLD_PCT: z.coerce.number().min(1).max(100).default(15),
  /** Minimum klik jaringan per campaign-hari sebelum selisih dianggap bermakna. */
  RECON_MIN_CLICKS: z.coerce.number().int().min(1).default(100),

  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(12).optional(),
  SEED_ORG_NAME: z.string().default('My Organization'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached && source === process.env) return cached;
  // Nilai kosong (mis. "SEED_ADMIN_PASSWORD=") diperlakukan sebagai tidak diisi.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Konfigurasi environment tidak valid:\n${issues}`);
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}

export const ENV = Symbol('ENV');
