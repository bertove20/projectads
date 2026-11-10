# Changelog

Format: tanggal (UTC) · jenis perubahan. Riwayat lengkap ada di `git log`.
Roadmap & status fase: [read.md](read.md) bagian 17.6 dan [README.md](README.md).

## [Unreleased] — branch `develop`

### Ditambahkan
- **Pemisahan domain per fungsi**: admin (dashboard), tracking (klik/SDK), postback (affiliate) — Caddy hanya membuka endpoint sesuai fungsi tiap domain; URL postback affiliate memakai `POSTBACK_PUBLIC_URL`.
- **Manajemen domain tracking kustom**: tambah domain, instruksi DNS, verifikasi CNAME/A record, HTTPS on-demand (hanya domain aktif), pilih domain per campaign, snippet SDK first-party per website, verifikasi ulang tiap 6 jam + alert.

### Ditambahkan (Phase 3)
- **Rotasi & split test**: routing per campaign berdasarkan negara, device, OS, browser, bahasa; varian offer/landing berbobot; varian sticky per pengunjung; laporan split test (CR, interval 95%, p-value, verdict konservatif). Editor routing di halaman campaign.
- **JS SDK**: event landing page (OBSERVED) dengan batching, antrean offline, consent, sendBeacon, link click-out otomatis; collector dengan allowlist domain, rate limit, deduplikasi, dan pembuangan PII. Panel pemasangan di halaman Websites.
- **Funnel campaign**: klik → tahap SDK → konversi VERIFIED.
- Uji browser sungguhan untuk SDK (`apps/api/test/sdk.browser.mjs`).
- **Adapter PropellerAds** (Propeller SSP API v5, spesifikasi resmi disimpan di docs/): uji token, daftar campaign, sinkronisasi statistik & spend per campaign × zone dalam UTC. Arsitektur adapter jaringan agar RollerAds dan PropellerAds memakai alur sinkronisasi yang sama.

### Diperbaiki
- **RBAC**: anggota dengan cakupan terbatas tidak lagi melihat/menutup alert campaign di luar cakupannya, dan tidak melihat campaign RollerAds yang belum dipetakan.
- **Dashboard**: filter tanggal ("Hari ini", "7 hari", …) memakai zona waktu organisasi, sama dengan server.

## 2026-11-11 — Baseline (`main`, commit a4d383e)

Commit awal repository; mencakup pekerjaan sebelum repository dibuat.

### Ditambahkan
- Spesifikasi lengkap (read.md bagian 1–21), termasuk addendum kekurangan, gabungan prompt V2, integrasi RollerAds terverifikasi, dan design system V3.
- **Phase 1**: autentikasi + MFA, RBAC & isolasi tenant, website/landing/offer/affiliate/akun jaringan/campaign, click redirect & bot filter, postback masuk & keluar, laporan ROI, spend manual, audit log, dashboard Next.js, Docker Compose + Caddy, backup/restore.
- **Phase 2**: token API RollerAds, sinkronisasi statistik per zone, rekonsiliasi, analisis & blacklist zone, alert + Telegram.
- **Design refresh** (Phase 3.5 dimajukan): token warna/tipografi, P&L line, tabel padat, dark mode — lihat docs/design-system.md.
- Skill desain terpasang manual setelah review (docs/design-skills.md).

### Diperbaiki sebelum baseline (ditemukan oleh pengujian)
- Kebocoran akses: campaign yang tidak di-assign bisa dibuka lewat URL langsung.
- Postback keluar gagal di Node 22 (lookup DNS mode `all`).
- Tracker gagal start saat database mati.
- File hilang dari hasil build (incremental build + deleteOutDir).
- Endpoint daftar (konversi, postback, klik) menolak parameter `limit`.
- Spend manual + API pada hari yang sama terhitung dobel.
- Lebar dropdown/filter menimpa lebar yang diminta halaman.
