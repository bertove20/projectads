# EAIP — Enterprise Ads Intelligence Platform

Spesifikasi lengkap: [read.md](read.md). Roadmap: read.md bagian 17.6.

## Status Phase 1

| Komponen | Status |
|---|---|
| Skema database (22 tabel) + migrasi awal | ✅ selesai |
| Autentikasi (argon2id, session cookie, lockout, MFA TOTP wajib untuk admin) | ✅ selesai |
| RBAC: 7 role sistem, 22 permission, cakupan data ALL / ASSIGNED per campaign | ✅ selesai |
| Organisasi, anggota, assignment campaign | ✅ selesai |
| Website, landing page, affiliate network, offer, akun jaringan iklan, campaign (ad format & bid model) | ✅ selesai |
| Click redirect `/c/:token`, click-out, bot filter dasar, buffer Redis saat DB mati | ✅ selesai |
| Postback masuk (terautentikasi token + IP allowlist, idempoten, transisi status) | ✅ selesai |
| Postback keluar (antrean BullMQ, retry eksponensial, dead-letter, test mode, anti-SSRF) | ✅ selesai |
| Laporan ROI per campaign / offer / landing / zone / negara / hari, spend manual | ✅ selesai |
| Audit log | ✅ selesai |
| Dashboard Next.js: login, MFA (QR), overview ROI + grafik, campaign, jaringan iklan, offer, affiliate, landing page, konversi, postback (kirim ulang), analytics + ekspor CSV, spend, tim & akses, audit log, pengaturan | ✅ selesai |
| Docker Compose (api, tracker, worker, dashboard, postgres, redis, caddy) | ✅ diuji lokal, termasuk routing HTTPS Caddy |
| Unit test (47) | ✅ lulus |
| E2E test terhadap stack Docker (46 pemeriksaan) | ✅ lulus — `node apps/api/test/smoke.e2e.mjs` |
| Backup & restore | ⚠️ script siap, **belum diuji** (uji di VPS) |

## Status Phase 2

| Komponen | Status |
|---|---|
| Token API RollerAds (terenkripsi) + uji koneksi `/whoami` (zona waktu & mata uang akun terbaca otomatis) | ✅ |
| Sinkronisasi statistik harian campaign × negara × zone, terjadwal (default 60 menit) + manual, lookback 3 hari, idempoten | ✅ |
| Rate limit RollerAds dipatuhi (statistik ≤ 9/menit, global ≤ 280/menit, `Retry-After`) | ✅ |
| Spend API per campaign per hari (menggantikan estimasi) + daftar campaign RollerAds yang belum dipetakan | ✅ |
| Rekonsiliasi jaringan vs internal dalam zona waktu akun jaringan + alert selisih | ✅ |
| Analisis per zone (spend, bot rate, konversi, ROI) + kandidat blacklist/whitelist + daftar internal + ekspor CSV | ✅ |
| Alert (dedupe, acknowledge/resolve) + pengiriman Telegram + alert postback gagal permanen & sinkronisasi gagal | ✅ |
| Dashboard: integrasi API, rekonsiliasi, zone, alert, channel Telegram | ✅ |
| E2E Phase 2 (31 pemeriksaan, mock RollerAds & Telegram) | ✅ lulus |
| **Diuji dengan akun RollerAds asli** | ⏳ menunggu access token |
| Impor CSV spend untuk jaringan tanpa API | ⏳ belum (spend manual per hari sudah tersedia) |
| Push blacklist/bid/status ke RollerAds | ⏳ Phase 6 (wajib approval) |

## Menjalankan stack lengkap secara lokal (Docker Desktop)

```bash
cd infra
# .env.local dibuat sekali dengan secret acak (lihat .env.example); jangan dipakai di VPS
docker compose -f compose.yaml -f compose.local.yaml --env-file .env.local up -d --build
```

| Layanan | URL lokal |
|---|---|
| Dashboard | `npm run dev:dashboard` → http://localhost:3000 (meneruskan /api ke port 4000). Container dashboard di :3001 hanya untuk health check; di VPS /api diteruskan oleh Caddy. |
| API + dokumentasi OpenAPI | http://127.0.0.1:4000/api/v1 (docs hanya di non-produksi) |
| Tracker | http://127.0.0.1:4100 |
| Mock jaringan iklan (penerima postback uji) | http://127.0.0.1:4900/_received |

## Struktur

```
apps/api/            NestJS — satu codebase, tiga proses:
  src/main.ts          api      → REST API dashboard (/api/v1/*), OpenAPI di /api/v1/docs (non-produksi)
  src/tracker.main.ts  tracker  → domain tracking publik: /c/:token, /click-out, /postback/in/:token
  src/worker.main.ts   worker   → pengiriman postback keluar, retry, sweeper
  prisma/              skema & migrasi
infra/               compose.yaml, Caddyfile, .env.example, scripts/backup.sh, scripts/restore.sh
docs/providers/      salinan dokumentasi API jaringan iklan (RollerAds)
```

Tracker dipisahkan dari API agar klik tetap ter-redirect saat API, worker, bahkan database bermasalah.

## Alur tracking

```
Iklan ──▶ https://trk.domain/c/<token>?click_id=[MACRO]&zone_id=[MACRO]…
            │ catat klik (UUIDv7), tandai bot, simpan click ID jaringan
            ▼
   Offer (URL dengan {click_id})  atau  Landing page (?cid=…) ──▶ /click-out?cid=… ──▶ Offer
            │
Affiliate network ──▶ https://trk.domain/postback/in/<token>?click_id=…&payout=…&status=…&txid=…
            │ konversi VERIFIED (sumber terautentikasi), idempoten per txid
            ▼
   Worker ──▶ postback ke jaringan iklan (template terenkripsi, {external_click_id})
```

Event yang hanya terlihat dari browser tidak pernah dikirim sebagai konversi ke jaringan iklan.

## Pengembangan lokal

Butuh Node.js 22+, PostgreSQL 15+ dan Redis 6.2+.

```bash
npm install
cp infra/.env.example apps/api/.env      # lalu isi; untuk lokal:
#   DATABASE_URL=postgresql://USER:PASS@127.0.0.1:5432/eaip
#   REDIS_URL=redis://127.0.0.1:6379
#   COOKIE_SECURE=false  DASHBOARD_ORIGIN=http://localhost:3000  TRACKER_PUBLIC_URL=http://localhost:4100
cd apps/api
npx prisma migrate deploy
npm run build && node --env-file=.env dist/seed.js
npm run dev:api        # http://localhost:4000/api/v1/docs
npm run dev:tracker    # http://localhost:4100
npm run dev:worker
npm test               # unit test
```

## Deploy ke VPS (Ubuntu 24.04+)

```bash
# 1. Docker
curl -fsSL https://get.docker.com | sudo sh
# 2. Firewall: hanya SSH, HTTP, HTTPS
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw allow 443/udp && sudo ufw enable
# 3. Kode & konfigurasi
git clone <repo> /opt/eaip && cd /opt/eaip/infra
cp .env.example .env && chmod 600 .env     # isi semua nilai GANTI_…
# 4. DNS: A record ADMIN_DOMAIN dan TRACKER_DOMAIN → IP VPS
# 5. Jalankan
docker compose --env-file .env up -d --build
docker compose ps
# 6. Backup harian
chmod +x scripts/*.sh
(crontab -l; echo "30 2 * * * /opt/eaip/infra/scripts/backup.sh >> /var/log/eaip-backup.log 2>&1") | crontab -
```

Docker mem-bypass aturan UFW untuk port yang dipublikasikan; compose ini hanya mempublikasikan 80/443 milik Caddy. PostgreSQL dan Redis tidak memiliki port ke host.

**Rollback:** set `APP_VERSION` ke tag image sebelumnya lalu `docker compose up -d`. Migrasi database hanya maju; sebelum upgrade selalu jalankan `scripts/backup.sh`.

**Restore:** `./scripts/restore.sh backups/eaip-<timestamp>.dump`. Uji restore minimal sebulan sekali (read.md 17.10).

## Keamanan — ringkas

- Password argon2id; lockout 15 menit setelah 10 kegagalan; MFA TOTP wajib untuk Super Admin & Owner (anti-replay).
- Session token acak, disimpan sebagai hash; cookie httpOnly + SameSite=Lax; pemeriksaan Origin untuk request yang mengubah data.
- Token API & template postback jaringan disimpan terenkripsi AES-256-GCM; tidak pernah dikirim ke browser.
- Token postback masuk hanya disimpan sebagai hash SHA-256 dan ditampilkan sekali.
- IP pengunjung hanya disimpan sebagai HMAC (tidak bisa dibalik tanpa secret).
- Postback keluar: hanya HTTPS, IP tujuan diperiksa saat koneksi dibuka (anti-SSRF & DNS rebinding), redirect tidak diikuti.
- Akun jaringan baru selalu dalam **test mode** (postback tidak dikirim) sampai dimatikan secara eksplisit; tercatat di audit log sebagai `network_account.go_live`.
