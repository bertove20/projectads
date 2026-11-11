# MASTER PROMPT: ENTERPRISE ADS INTELLIGENCE & TRACKING MANAGEMENT PLATFORM

## 1. ROLE & OBJECTIVE

Bertindak sebagai Principal Software Architect, Senior Full-Stack Engineer, DevOps Engineer, Database Architect, Cybersecurity Specialist, Advertising Technology Engineer, dan AI Systems Engineer.

Bangun aplikasi produksi bernama:

**Enterprise Ads Intelligence Platform (EAIP)**

Tujuan utama adalah menciptakan platform terintegrasi untuk:

1. Mengelola banyak advertising network dari satu dashboard.
2. Memantau campaign, click, spending, CPC, CPA, CTR, conversion rate, dan ROI/ROAS bila data pendapatan tersedia.
3. Menangkap dan memverifikasi event dari banyak website.
4. Mengelola server-side tracking, attribution, dan S2S postback.
5. Mengelola akun karyawan, departemen, hak akses, shift, dan tugas.
6. Mengintegrasikan OpenRouter agar setiap karyawan bisa menggunakan model AI yang berbeda.
7. Mengintegrasikan Telegram Bot dan Discord untuk notifikasi, laporan, dan kolaborasi tim.
8. Menjalankan analisis AI terhadap data iklan serta memberikan rekomendasi optimasi.
9. Membuat automation rules dengan persetujuan dan audit.
10. Mendukung perkembangan dari VPS kecil menuju arsitektur multi-server.

Bangun aplikasi menggunakan kode nyata, bukan sekadar mockup, pseudocode, atau rancangan visual.

## 2. INITIAL INFRASTRUCTURE

Kondisi awal:

- VPS belum tersedia.
- Domain tracking belum tersedia.
- Estimasi traffic: di bawah 10.000 klik per hari.
- Pengguna awal: satu owner dan beberapa karyawan.
- Sistem harus siap berkembang menjadi multi-tenant dan multi-network.
- Tidak memerlukan GPU karena AI menggunakan API OpenRouter.

Target server awal:

- Ubuntu Server 24.04 LTS
- 4 vCPU
- 8 GB RAM
- 100 GB NVMe SSD
- Docker Engine + Docker Compose

Gunakan arsitektur Modular Monolith dengan background workers. Hindari microservices berlebihan pada tahap awal.

## 3. TECHNOLOGY STACK

Frontend:
- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui
- TanStack Table
- TanStack Query
- Recharts
- Zod

Backend:
- NestJS
- TypeScript
- REST API
- OpenAPI documentation
- Server-side input validation
- Structured logging

Database:
- PostgreSQL
- Prisma ORM
- Database migration
- Tenant isolation
- Indexed queries
- Table partitioning jika diperlukan

Background processing:
- Redis
- BullMQ
- Retry queue
- Dead-letter queue
- Scheduler

Infrastructure:
- Docker Compose
- Caddy atau Nginx
- HTTPS otomatis
- Firewall
- Database backup
- Monitoring
- Environment variables
- Secret management

AI Integration:
- OpenRouter API
- Model Registry
- Per-user Model Assignment
- AI Usage Analytics
- AI Budget Controller

Communication:
- Telegram Bot API
- Discord Bot API
- Discord Webhooks

Jelaskan bila suatu teknologi perlu diganti karena alasan performa, keamanan, atau kompatibilitas.

## 4. MAIN APPLICATION MODULES

Bangun modul berikut:

### A. Super Admin Dashboard

Super Admin harus dapat:

- Melihat seluruh organisasi.
- Melihat semua website.
- Melihat seluruh advertising network.
- Melihat semua campaign.
- Memantau spending dan conversion.
- Memantau aktivitas karyawan.
- Mengelola role dan permission.
- Mengelola model OpenRouter.
- Mengatur budget AI.
- Memantau Telegram dan Discord integration.
- Melihat system health, database, worker, API latency, dan error rate.
- Melihat riwayat audit.
- Mengaktifkan atau menonaktifkan automation.
- Mengonfigurasi approval workflow.

Dashboard harus mendukung desktop dan mobile.

### B. Multi-User & Team Management

Role default:

1. Super Admin
2. Organization Owner
3. Team Leader
4. Media Buyer
5. Data Analyst
6. Tracking Specialist
7. Quality & Compliance Analyst
8. Viewer

Gunakan RBAC dengan izin granular.

Karyawan hanya dapat mengakses website, network, campaign, dan laporan yang ditugaskan.

Sediakan:
- Employee management.
- Team management.
- Campaign assignment.
- Shift schedules.
- Task assignment.
- Task priority.
- Task deadlines.
- Handover antar-shift.
- Activity history.
- Approval request.
- Internal comments.
- Performance review berdasarkan tugas dan hasil kerja yang relevan.

Semua aktivitas administratif penting harus masuk audit log.

Jangan membuat monitoring tersembunyi, keylogger, atau pengambilan data pribadi karyawan yang tidak diperlukan.

### C. Multi-Network Ads Manager

Siapkan adapter untuk:

- RollerAds
- Clickadu
- PropellerAds
- EvaDav
- Meta Ads
- Google Ads

Setiap adapter mendukung kemampuan yang benar-benar tersedia pada API resmi masing-masing provider.

Pisahkan capability berikut:

- Click tracking
- Conversion postback
- Report import
- Spend synchronization
- Campaign read access
- Campaign write access
- Budget modification
- Bid modification
- Pause/resume campaign

Jangan mengasumsikan semua jaringan mendukung seluruh kemampuan tersebut.

Sediakan:
- Network account manager.
- Credential manager.
- Connection testing.
- Campaign mapping.
- Network-specific macros.
- Event mapping.
- Postback configuration.
- API error handling.
- Rate limiting.
- Retry and delivery logs.

Verifikasi dokumentasi API resmi sebelum mengimplementasikan integrasi.

Patuhi persyaratan akun, lisensi, kategori iklan, dan kebijakan masing-masing penyedia. Jangan membangun mekanisme untuk menyamarkan konten atau menghindari peninjauan iklan.

### D. Universal Tracking Engine

Buat JavaScript SDK yang dapat digunakan pada:

- HTML landing page.
- PHP website.
- WordPress.
- Website yang hanya mengizinkan script tambahan di HEAD dan BODY.

Fitur:
- Capture advertising Click ID.
- Capture campaign parameters.
- First-party session management.
- Campaign source identification.
- Event collection.
- Event batching.
- Event deduplication.
- Offline retry dengan batas yang aman.
- Consent-aware tracking.
- Lightweight performance.
- Domain allowlist.
- Data minimization.

Jenis event:

- page_view
- landing_view
- registration_started
- registration_submitted
- registration_success_observed
- registration_success_verified
- purchase_verified
- custom_event

PENTING:

Event yang hanya dideteksi dari browser harus berstatus OBSERVED.

Event VERIFIED hanya boleh diterbitkan dari backend, webhook resmi, atau sumber lain yang terautentikasi dan mampu membuktikan keberhasilan event.

Jangan mengirim browser-only registration success sebagai konversi terverifikasi.

### E. Server-Side Postback Engine

Sediakan:
- Universal event ingestion.
- Event normalization.
- Click ID mapping.
- Event verification.
- Attribution processing.
- Network adapter routing.
- Postback queue.
- Idempotency key.
- Duplicate prevention.
- Exponential backoff.
- Dead-letter queue.
- Delivery retry.
- Postback response logging.
- Controlled test mode.

Satu event harus disimpan lebih dahulu sebelum diproses oleh worker.

Sediakan status:
- Received
- Observed
- Pending Verification
- Verified
- Rejected
- Queued
- Delivered
- Failed
- Revoked

Jangan otomatis menyamakan keberhasilan HTTP 200 dengan konversi yang diterima secara bisnis. Gunakan respons dan aturan provider yang relevan.

### F. Attribution Engine

Sediakan model atribusi internal:

- First Touch
- Last Touch
- Last Paid Click
- Linear
- Position Based

Fitur:
- Attribution window.
- Cross-campaign attribution.
- Click-to-conversion linking.
- Session-level attribution.
- Conversion deduplication.
- Attribution reports.
- Attribution rule versioning.

Jangan mengasumsikan atribusi internal dapat menggantikan atribusi resmi Meta Ads atau Google Ads.

### G. Analytics & Reporting

Buat laporan berdasarkan:

- Date/time
- Advertising network
- Campaign
- Website
- GEO
- Device
- Operating system
- Browser
- Feed ID
- Zone ID
- Creative ID
- Traffic source
- Employee/team

Metric:
- Clicks
- Impressions jika tersedia
- Spend
- CPC
- CTR
- Observed registrations
- Verified registrations
- Conversion rate
- CPA
- Revenue jika tersedia
- Profit jika tersedia
- ROI/ROAS jika tersedia
- Postback success rate
- Data latency

Semua metrik harus memiliki definisi yang jelas.

Bedakan:
- Data real-time.
- Data yang terlambat masuk.
- Data estimasi.
- Data belum terverifikasi.
- Data dari jaringan iklan.

Sediakan ekspor CSV dan Excel.

### H. OpenRouter AI Gateway

Integrasikan OpenRouter melalui backend.

Jangan pernah mengekspos OpenRouter API key ke browser.

Setiap karyawan memiliki konfigurasi:

- Assigned model.
- Allowed models.
- Fallback model.
- AI usage permission.
- Daily budget.
- Monthly budget.
- Token limits.
- Request limits.
- Model usage logs.
- AI task history.

Sediakan Model Registry yang menyimpan:
- Model ID.
- Provider.
- Context limits.
- Pricing.
- Capabilities.
- Status.
- Last validation time.

Model harus dapat diganti melalui dashboard tanpa deployment ulang.

Jangan hardcode model karena ketersediaan dan harga dapat berubah.

Sediakan AI Chat Workspace untuk setiap karyawan.

AI dapat:
- Menganalisis data campaign.
- Menjelaskan perubahan CPA.
- Membandingkan performa.
- Menelusuri masalah tracking.
- Merangkum error postback.
- Membuat laporan.
- Menyarankan investigasi.
- Menyusun rekomendasi optimasi.

AI hanya boleh membaca data sesuai izin pengguna.

Gunakan server-side tools yang memiliki whitelist query dan permission checks. Jangan memberi model akses SQL mentah tanpa pembatasan.

### I. AI Model Evaluation

Buat sistem benchmark untuk membandingkan model AI berdasarkan:

- Accuracy.
- Latency.
- Token consumption.
- API cost.
- Task completion.
- Hallucination rate.
- Quality of recommendations.

Sediakan model leaderboard internal.

Pemilihan model didasarkan pada hasil evaluasi nyata dan biaya, bukan asumsi bahwa model termahal selalu terbaik.

### J. Automation Rules Engine

Dukung aturan berbasis:

- CPA
- CPC
- Conversion rate
- Spend
- Verified conversions
- Postback errors
- Campaign anomalies
- Tracking outages
- AI budget usage
- Employee task SLA

Contoh:

IF CPA > 150% Target CPA
AND Verified Conversions >= 20
THEN Create Alert.

IF Postback Failure Rate > 10%
THEN Notify Tracking Team.

IF Daily AI Spending > 80% Limit
THEN Notify Owner.

Automation harus mendukung:

- Read-only mode.
- Dry-run mode.
- Manual approval.
- Cooldown.
- Maximum action limits.
- Role-based permissions.
- Full audit history.
- Emergency disable.
- Rollback bila didukung provider.

Jangan izinkan AI langsung mengubah budget atau menonaktifkan campaign tanpa otorisasi dan mekanisme persetujuan yang telah disetujui owner.

## 5. TELEGRAM INTEGRATION

Bangun Telegram Bot Integration.

Fitur:

1. Hubungkan akun Telegram karyawan dengan user dashboard melalui proses verifikasi.
2. Kirim notifikasi berdasarkan role dan campaign assignment.
3. Kirim daily campaign summary.
4. Kirim tracking failure alert.
5. Kirim postback failure alert.
6. Kirim AI budget warning.
7. Kirim task notification.
8. Kirim shift reminders.
9. Kirim approval request.
10. Kirim system health alert.

Contoh perintah bot:

/start
/help
/status
/mytasks
/campaigns
/alerts
/report
/postback
/aiusage

Batasi command sesuai role.

Untuk approval, gunakan tombol interaktif atau deep link menuju dashboard dengan token sekali pakai, masa berlaku singkat, verifikasi identitas, dan pemeriksaan permission.

Jangan mengekspos credential iklan, API key, atau data pengguna sensitif di pesan Telegram.

Jangan mengizinkan perubahan finansial hanya berdasarkan pesan teks yang tidak terverifikasi.

## 6. DISCORD INTEGRATION

Bangun Discord Bot dan Webhook Integration.

Fitur:

- Campaign notification.
- Team alerts.
- Daily reports.
- Shift handover summaries.
- Tracking incident reports.
- AI analysis summaries.
- Task assignments.
- Escalation workflows.
- Discussion thread references.

Rekomendasi channel:

#ads-overview
#campaign-monitoring
#tracking-alerts
#postback-errors
#team-tasks
#daily-reports
#ai-analysis
#approval-requests
#system-health

Gunakan Discord slash commands untuk operasi read-only yang diizinkan.

Petakan Discord user ID dengan employee ID.

Batasi akses berdasarkan role, channel, organization, dan permission internal.

Jangan mengandalkan permission channel Discord saja sebagai sistem otorisasi utama.

Untuk alert, dukung:
- Severity.
- Acknowledgment.
- Assigned owner.
- Incident status.
- Resolution time.

Semua notifikasi harus tersimpan di database agar tidak hilang ketika webhook gagal.

## 7. NOTIFICATION CENTER

Buat satu Notification Engine yang dapat mengirim melalui:

- Dashboard
- Telegram
- Discord
- Email (opsional)

Gunakan Notification Router agar aturan notifikasi dapat diatur dari dashboard.

Fitur:
- Notification templates.
- Severity levels.
- Per-user preferences.
- Quiet hours.
- Deduplication.
- Rate limits.
- Retry.
- Escalation.
- Delivery logs.
- Acknowledgment.
- Incident timeline.

Severity:
- INFO
- WARNING
- HIGH
- CRITICAL

Untuk critical alert, kirim ke channel tim serta owner sesuai aturan eskalasi.

## 8. DATABASE ARCHITECTURE

Gunakan PostgreSQL.

Buat migration untuk:

Core:
- organizations
- users
- memberships
- roles
- permissions
- teams
- employees

Ads:
- websites
- network_accounts
- campaigns
- tracking_sessions
- ad_clicks
- events
- conversions
- attribution_touches
- attribution_results
- postback_deliveries

AI:
- ai_models
- ai_assignments
- ai_sessions
- ai_requests
- ai_usage_logs
- ai_budget_policies
- ai_evaluations

Operations:
- tasks
- shifts
- incidents
- alerts
- automation_rules
- automation_executions
- approval_requests
- audit_logs

Notifications:
- telegram_connections
- discord_connections
- notification_channels
- notification_rules
- notification_deliveries

Security:
- api_keys
- encrypted_credentials
- consent_records
- security_events

Gunakan foreign keys, indexes, constraints, tenant isolation, idempotency, dan database transactions.

Data dengan volume tinggi harus memiliki strategi partisi dan retensi.

## 9. API ARCHITECTURE

Buat REST API:

/api/v1/auth
/api/v1/organizations
/api/v1/users
/api/v1/teams
/api/v1/websites
/api/v1/networks
/api/v1/campaigns
/api/v1/tracking
/api/v1/events
/api/v1/conversions
/api/v1/attribution
/api/v1/postbacks
/api/v1/analytics
/api/v1/automation
/api/v1/ai
/api/v1/ai/models
/api/v1/ai/usage
/api/v1/tasks
/api/v1/shifts
/api/v1/alerts
/api/v1/notifications
/api/v1/integrations/telegram
/api/v1/integrations/discord
/api/v1/audit

Wajib ada:
- Authentication.
- Authorization.
- Tenant isolation.
- Input validation.
- API versioning.
- Error handling.
- Rate limits.
- OpenAPI documentation.

## 10. SECURITY REQUIREMENTS

Implementasikan:

- MFA untuk administrator.
- Strong password hashing.
- Session expiration.
- RBAC.
- Tenant isolation.
- Encrypted API credentials.
- Secure environment secrets.
- HTTPS.
- Firewall.
- SQL injection protection.
- XSS and CSRF protection.
- SSRF protection.
- Webhook signature validation.
- Replay protection.
- Rate limits.
- Audit logs.
- Database backup.
- Disaster recovery.
- Data retention.
- Privacy compliance.
- Least-privilege service accounts.

Setiap karyawan hanya boleh melihat data yang diizinkan.

Minimalisir data pribadi yang dikirim ke provider AI.

Terapkan consent dan kebijakan privasi yang sesuai untuk penggunaan cookie, identifier iklan, dan pengiriman conversion data.

## 11. USER INTERFACE DESIGN

Bangun dashboard enterprise dengan:

- Modern dark mode.
- Light mode.
- Responsive layout.
- Collapsible sidebar.
- Search.
- Filtering.
- Date range selector.
- Realtime status.
- Interactive charts.
- Data tables.
- Drill-down reports.
- Toast notification.
- Role-aware navigation.

Sidebar utama:

1. Overview
2. Advertising Networks
3. Campaigns
4. Websites
5. Tracking
6. Conversions
7. Attribution
8. Postbacks
9. Analytics
10. Automation
11. AI Workspace
12. AI Model Manager
13. Team Management
14. Tasks & Shifts
15. Alerts & Incidents
16. Telegram
17. Discord
18. Notifications
19. Audit Logs
20. Settings

Pastikan setiap halaman memiliki fungsi nyata sesuai tahap implementasi. Jangan membuat tombol yang terlihat aktif tetapi tidak bekerja.

## 12. DEPLOYMENT

Buat deployment berbasis Docker Compose.

Layanan:
- dashboard
- api
- worker
- scheduler
- postgres
- redis
- reverse-proxy

Gunakan Docker private network.

PostgreSQL dan Redis tidak boleh terbuka langsung ke internet.

Sediakan:
- Dockerfile.
- compose.yaml.
- .env.example.
- Database migrations.
- Initialization scripts.
- Health checks.
- Restart policies.
- Logging.
- Backup scripts.
- Restore guide.
- SSL configuration.
- Deployment instructions.
- Rollback procedures.

Buat setup yang bisa dijalankan pada VPS Ubuntu baru.

## 13. IMPLEMENTATION ROADMAP

Kerjakan secara bertahap.

PHASE 1 — Foundation
- Project structure.
- Docker.
- Database.
- Authentication.
- Multi-user.
- RBAC.
- Basic dashboard.

PHASE 2 — Tracking Core
- Website registration.
- Tracking SDK.
- Click ingestion.
- Event collection.
- Conversion verification.
- Attribution.
- Postback queue.

PHASE 3 — Advertising Networks
- RollerAds integration.
- Clickadu integration.
- PropellerAds integration.
- EvaDav integration.
- Integration tests.

PHASE 4 — AI Workspace
- OpenRouter integration.
- Model registry.
- Per-user model assignment.
- AI budget controller.
- AI usage dashboard.
- AI task evaluation.

PHASE 5 — Team Operations
- Teams.
- Employees.
- Tasks.
- Shifts.
- Incidents.
- Approval workflows.

PHASE 6 — Telegram & Discord
- Telegram Bot.
- Discord Bot.
- Notification Router.
- Delivery logs.
- Alert escalation.

PHASE 7 — Advanced Analytics & Automation
- Statistical anomaly detection.
- AI-assisted analysis.
- Automation rules.
- Approval execution.
- Meta/Google integrations where eligible.

PHASE 8 — Production Hardening
- Load testing.
- Security review.
- Backup restore testing.
- Monitoring.
- Disaster recovery.
- Performance optimization.

## 14. TESTING REQUIREMENTS

Buat pengujian otomatis untuk:

- Authentication.
- RBAC.
- Cross-tenant isolation.
- Tracking event validation.
- Click ID mapping.
- Conversion verification.
- Deduplication.
- Attribution.
- Postback delivery.
- Retry behavior.
- OpenRouter model assignment.
- AI budget enforcement.
- Telegram authorization.
- Discord authorization.
- Automation approval.
- Database recovery.

Gunakan mock services untuk pengujian integrasi provider jika credentials asli belum tersedia.

Jangan membuat atau mengirim event konversi palsu ke akun iklan produksi.

## 15. ACCEPTANCE CRITERIA

Tahap pertama dianggap berhasil apabila:

1. Aplikasi dapat dijalankan melalui Docker Compose.
2. Administrator dapat login dengan aman.
3. Multi-tenant authorization bekerja.
4. Website dapat didaftarkan.
5. Tracking SDK dapat menerima Click ID.
6. Event tersimpan di PostgreSQL.
7. Observed event dan verified event dibedakan.
8. Tidak ada event duplikat yang tercatat sebagai konversi terpisah.
9. Worker dapat memproses mock postback.
10. Dashboard menampilkan data yang benar.
11. Semua API memiliki validasi dan error handling.
12. Seluruh konfigurasi rahasia berada di server.
13. Backup dan restore database telah diuji.

Tahap AI dan komunikasi dianggap berhasil apabila:

1. Karyawan dapat diberi model AI berbeda.
2. Budget AI dibatasi per user.
3. Penggunaan AI tercatat.
4. Telegram dan Discord dapat menerima notifikasi.
5. Identitas karyawan pada bot terverifikasi.
6. Tindakan sensitif memerlukan otorisasi dan approval.
7. Aktivitas administratif tercatat di audit log.

## 16. OUTPUT YANG HARUS DIHASILKAN

Berikan:

1. System architecture diagram.
2. Technology stack dan justifikasinya.
3. Database ERD.
4. Prisma schema.
5. Project folder structure.
6. REST API specification.
7. Docker Compose.
8. Backend implementation.
9. Frontend implementation.
10. Tracking SDK.
11. Worker dan postback engine.
12. OpenRouter Gateway.
13. Telegram Bot integration.
14. Discord integration.
15. Automation Engine.
16. Security configuration.
17. Testing suite.
18. Installation guide.
19. Production deployment guide.
20. Roadmap dan backlog pengembangan.

Jangan hanya memberikan gambaran konseptual.

Hasilkan kode lengkap untuk fase yang sedang dikerjakan, file demi file, dengan lokasi file yang jelas.

Jangan mengarang kredensial, endpoint provider, API permission, atau hasil pengujian.

Jika provider mensyaratkan akses khusus, tandai integrasinya sebagai belum aktif sampai akses tersebut tersedia.

Mulai dengan PHASE 1 sesuai roadmap revisi pada Bagian 17.6.

Tampilkan rancangan folder, database schema, Docker Compose, authentication, RBAC, Click Redirect Engine, Inbound Postback, dan Tracking API terlebih dahulu.

Pastikan fondasinya siap untuk OpenRouter, Telegram, Discord, dan semua network adapters tanpa perlu refactor besar di tahap berikutnya.

## 17. ADDENDUM: KEKURANGAN YANG WAJIB DITAMBAHKAN

Bagian ini melengkapi kekurangan pada bagian 1–16. Jika terjadi konflik, Bagian 17 yang berlaku.

### 17.1 Offer, Affiliate Network & Revenue

Tambahkan sisi pendapatan sebagai modul inti, bukan opsional.

Entitas:
- Affiliate networks / advertiser (sumber offer).
- Offers (URL offer, payout, mata uang, GEO yang diizinkan, status, kategori).
- Payout model: CPA, CPL, CPI, RevShare, dan payout dinamis dari postback.
- Landing pages (terpisah dari website).

Fitur:
- **Inbound Postback Endpoint**: menerima postback dari affiliate network/advertiser dengan parameter click ID, payout, status, dan transaction ID.
- Validasi inbound postback melalui secret token, signature, atau IP allowlist sesuai kemampuan provider.
- Inbound postback terautentikasi adalah sumber utama event VERIFIED dan revenue.
- Status konversi dari advertiser: approved, pending, rejected, chargeback/reversal.
- Revenue dan profit dihitung dari payout terverifikasi, bukan estimasi browser.
- Penyesuaian revenue saat terjadi reversal atau chargeback.

### 17.2 Click Redirect Engine (Server-Side Click Tracking)

JS SDK saja tidak cukup untuk traffic popunder, push, dan in-page push karena banyak pengunjung keluar sebelum JavaScript dijalankan, dan sebagian memakai ad blocker.

Sediakan:
- Campaign tracking link: `https://<tracking-domain>/c/<campaign_token>?<network macros>`.
- Click dicatat di server **sebelum** redirect, lalu diteruskan ke landing page atau offer.
- Pembuatan click ID internal yang unik dan diteruskan ke landing page/offer sebagai parameter.
- Target latency redirect p95 < 100 ms pada beban normal.
- Direct linking (langsung ke offer) dan landing page flow (iklan → landing → offer).
- Endpoint `/click-out` untuk mencatat klik dari landing page menuju offer.
- Tracking domain first-party atau custom domain per website untuk mengurangi pemblokiran.
- Fallback URL bila campaign nonaktif, offer mati, atau terjadi error.

### 17.3 Rotasi & Split Testing

- Rotasi landing page dan offer berdasarkan bobot (weight).
- Rule-based routing berdasarkan GEO, device, OS, browser, dan bahasa.
- A/B split testing dengan pencatatan varian per click.
- Laporan per varian dengan indikator jumlah sampel yang memadai sebelum menyimpulkan pemenang.
- Seluruh pengunjung pada aturan routing yang sama menerima konten yang sama. Routing tidak boleh dipakai untuk menampilkan konten berbeda kepada reviewer/moderator jaringan iklan (cloaking dilarang).

### 17.4 Traffic Quality & Bot Filtering

Tujuannya kualitas data dan perlindungan budget, bukan menyembunyikan konten.

- Deteksi IP datacenter/hosting (ASN), proxy/VPN bila data tersedia, user agent bot, dan header tidak wajar.
- Deteksi klik ganda dalam jangka waktu singkat dari IP/session yang sama.
- Skor kualitas traffic per click, zone, dan source.
- Klik yang terdeteksi bot tetap dicatat tetapi ditandai, dan dipisahkan dari laporan utama.
- Laporan persentase bot per zone/source untuk bahan klaim atau blacklist.
- Sumber data GEO/ASN harus berlisensi (misalnya database MaxMind GeoLite2 dengan akun sendiri).

### 17.5 Zone / Source Management

Optimasi utama pada jaringan push/popunder adalah mengelola zone. Sediakan:
- Daftar zone/source/feed per campaign dengan metrik spend, conversion, CPA, ROI, dan bot rate.
- Blacklist dan whitelist per campaign maupun global.
- Ekspor daftar blacklist dalam format yang dapat diunggah ke jaringan iklan.
- Sinkronisasi blacklist melalui API hanya bila didukung API resmi provider dan diaktifkan owner.
- Aturan otomatis, misalnya: IF spend zone > 2× target CPA AND conversion = 0 THEN rekomendasikan blacklist (memerlukan approval sesuai Bagian J).

### 17.6 Revisi Roadmap: MVP yang Menghasilkan Uang Lebih Dulu

Roadmap di Bagian 13 dan roadmap prompt V2 diganti dengan urutan berikut. Keputusan owner (10 November 2026): **tracking & ROI (A) dikerjakan lebih dulu, kemudian tim, Kanban & AI karyawan (B)**. Keduanya wajib ada dalam project ini.

**— TAHAP A: TRACKING & ROI —**

PHASE 1 — Foundation & Revenue-Ready Tracking MVP
- Monorepo, Docker, database.
- Authentication, MFA admin, RBAC dasar.
- Pemisahan **role sistem** (hak akses) dan **jabatan** (posisi kerja + AI Assistant, Bagian 19) sejak skema awal.
- Skema multi-tenant disiapkan (`organization_id` di semua tabel), UI multi-tenant penuh ditunda.
- Website, landing page, offer, affiliate network, campaign (dengan ad format & bid model, 17.18).
- Click Redirect Engine dan click-out.
- Inbound postback dan outbound postback ke traffic source.
- Bot filtering dasar.
- Dashboard ROI per campaign, offer, landing page, dan zone.

PHASE 2 — RollerAds Integration, Rekonsiliasi & Alert
- Adapter RollerAds read-only (Bagian 20): akun, campaign, statistik per zone/creative/negara.
- Sinkronisasi spend RollerAds. Jaringan lain via impor CSV sampai API-nya diverifikasi.
- Rekonsiliasi data (17.7).
- Zone blacklist/whitelist internal (17.5). Ekspor manual dulu, push ke API RollerAds menunggu Phase 6.
- Telegram alert dasar.

PHASE 3 — Rotasi, Split Test & JS SDK
- Rotasi dan split testing (17.3).
- JS SDK untuk event di landing page.
- Adapter jaringan lain (Clickadu, PropellerAds, EvaDav) setelah dokumentasi API resminya diverifikasi.

PHASE 3.5 — Design System & UI Refresh (Bagian 21)
- Token desain lengkap, identitas visual, review dengan skill desain.
- Diterapkan pada seluruh modul Tahap A tanpa mengubah logika bisnis.
- Wajib selesai sebelum Kanban & workspace karyawan dibangun, agar Tahap B langsung memakai design system.

**— TAHAP B: TIM, KANBAN & AI KARYAWAN —**

PHASE 4 — Team & Kanban
- Employees, teams, 8 jabatan (Bagian 19.1).
- Kanban board, task card lengkap, drag & drop, real-time sync, activity log (19.4).
- My Tasks dan workspace karyawan (tanpa AI dulu).
- Incident card otomatis dari alert tracking (Phase 2).

PHASE 5 — AI Workspace & Skill Library
- OpenRouter gateway, model registry, model per jabatan dan per karyawan, budget.
- 8 AI Assistant per jabatan (19.2).
- Skill Library berbasis SKILL.md dengan versi, test case, dan risk class (19.3).
- AI hanya membaca data lewat tool server-side yang diizinkan.
- AI dapat membuat **draft** task card.

PHASE 6 — Supervisor, Approval & Automation
- Tim AI otonom (Bagian 23): Kepala Tim AI, rapat harian, diskusi antar-agent, perintah owner, goal, transparansi percakapan.
- AI Team Supervisor dan KPI per jabatan (19.5).
- Approval Center.
- Automation rules (dry-run, approval, emergency stop).
- Aksi tulis ke RollerAds (pause, budget, bid, zone deny/allow, custom bid) **hanya lewat approval** (Bagian 20.3).

PHASE 7 — Discord & Notification Router
- Discord, Notification Router lengkap, eskalasi.
- Shift dan handover.

PHASE 8 — Lanjutan
- AI model evaluation, GitHub Reference Manager (Bagian 18 dan 19.6).
- Meta/Google integration bila memenuhi syarat.
- Multi-tenant penuh.

PHASE 9 — Production Hardening.

Performance review berbasis KPI dan AI benchmark ditempatkan di akhir karena butuh data historis yang cukup agar adil dan bermakna.

### 17.7 Rekonsiliasi Data, Timezone & Mata Uang

- Simpan semua timestamp dalam UTC. Laporan ditampilkan sesuai timezone organisasi.
- Catat timezone laporan masing-masing jaringan iklan dan normalisasi saat impor.
- Mata uang dasar per organisasi dengan tabel kurs harian dan sumber kurs yang tercatat.
- Simpan nilai asli beserta mata uang asal, lalu nilai hasil konversi.
- Laporan rekonsiliasi: klik dan spend menurut jaringan dibandingkan dengan data internal, beserta persentase selisih.
- Alert bila selisih melewati ambang yang dapat diatur (default 15%).
- Data jaringan yang datang terlambat dapat memperbarui laporan hari sebelumnya (backfill) dengan riwayat perubahan.

### 17.8 Build vs Buy

Sebelum implementasi, sertakan analisis singkat:
- Perbandingan membangun tracking core sendiri dengan memakai tracker yang sudah ada (misalnya Keitaro, Binom, RedTrack, Voluum) dari sisi biaya, waktu, kontrol data, dan risiko.
- Opsi hybrid: tracker pihak ketiga untuk tracking core, platform ini untuk dashboard tim, AI, notifikasi, dan automation.
- Desain adapter agar sumber data tracking dapat diganti tanpa refactor besar.

Keputusan akhir ada di tangan owner.

### 17.9 Kelemahan Teknis yang Harus Diatasi

- Prisma tidak mendukung table partitioning secara native. Gunakan migrasi SQL manual untuk tabel partisi (`ad_clicks`, `events`, `postback_deliveries`) dan dokumentasikan caranya.
- Buat tabel agregasi (rollup) per jam dan per hari. Dashboard membaca rollup, bukan data mentah.
- Build Docker image di CI (misalnya GitHub Actions) lalu push ke container registry. VPS hanya menarik image, tidak melakukan build.
- Batasi memori setiap container di `compose.yaml`.

### 17.10 Ketersediaan & Disaster Recovery

- Click endpoint harus tetap berjalan saat dashboard, AI, atau worker mati.
- Bila PostgreSQL tidak tersedia, click endpoint tetap redirect ke fallback dan menyimpan click sementara di Redis/disk untuk diproses ulang.
- Backup database harian ke penyimpanan offsite (object storage di provider berbeda), terenkripsi.
- Target awal: RPO ≤ 24 jam, RTO ≤ 4 jam. Uji restore minimal sebulan sekali.
- Uptime monitoring eksternal untuk tracking domain dengan alert ke Telegram.
- Dokumentasikan langkah migrasi ke VPS baru bila server utama gagal.

### 17.11 Target Terukur

Lengkapi acceptance criteria dengan angka:
- Click redirect p95 < 100 ms, error rate < 0,1%.
- Inbound postback diproses dan tercatat < 5 detik.
- Outbound postback dikirim < 60 detik setelah konversi diverifikasi (di luar retry).
- Dashboard memuat laporan 30 hari < 3 detik.
- Retensi data: raw click 90 hari, event 180 hari, rollup dan konversi tanpa batas (dapat diatur).
- Audit log disimpan minimal 1 tahun.

### 17.12 Privasi & Consent per Wilayah

- Aturan consent berdasarkan GEO pengunjung: wajib consent sebelum cookie/identifier non-esensial untuk wilayah seperti Uni Eropa/EEA dan Inggris (GDPR, ePrivacy).
- Kepatuhan UU Pelindungan Data Pribadi (UU PDP) Indonesia untuk data pengguna dan karyawan.
- IP address di-hash atau dipotong setelah digunakan untuk GEO dan bot filtering, sesuai kebijakan retensi.
- Data Processing Record: daftar data yang dikirim ke jaringan iklan, affiliate network, dan OpenRouter.
- Pengiriman data ke OpenRouter hanya berupa data agregat/teranonimkan kecuali diperlukan dan diizinkan.

### 17.13 Evaluasi AI yang Terukur

Bagian I harus memiliki dasar pengukuran:
- Dataset evaluasi internal: kumpulan pertanyaan dengan jawaban benar yang dihitung langsung dari database.
- Accuracy = kecocokan angka dan kesimpulan AI dengan ground truth.
- Hallucination = AI menyebut angka, campaign, atau fakta yang tidak ada pada hasil tool/query.
- Penilaian kualitas rekomendasi oleh manusia (skor 1–5) dan dicatat.
- AI wajib menyertakan sumber data (tool/query yang dipakai) pada setiap jawaban analisis.

### 17.14 Tambahan Tabel Database

Offers & revenue:
- affiliate_networks
- offers
- landing_pages
- campaign_routes
- split_tests
- inbound_postbacks
- payouts
- conversion_adjustments

Traffic quality:
- traffic_sources
- zones
- zone_lists (blacklist/whitelist)
- bot_detections
- ip_reputation_cache

Reporting:
- stats_hourly
- stats_daily
- network_spend_reports
- reconciliation_reports
- exchange_rates

### 17.15 Tambahan API

/api/v1/offers
/api/v1/affiliate-networks
/api/v1/landing-pages
/api/v1/routes
/api/v1/split-tests
/api/v1/zones
/api/v1/traffic-quality
/api/v1/reconciliation
/api/v1/exchange-rates
/c/:campaignToken (public click redirect)
/click-out (public)
/postback/in/:token (public inbound postback)

### 17.16 Tambahan Sidebar

- Offers
- Affiliate Networks
- Landing Pages
- Zones & Sources
- Traffic Quality
- Reconciliation

### 17.17 Tambahan Pengujian

- Click redirect dan fallback saat database mati.
- Inbound postback: autentikasi, duplikat transaction ID, reversal.
- Bot detection.
- Rotasi berbobot dan konsistensi split test.
- Konversi timezone dan mata uang.
- Rekonsiliasi.
- Load test click endpoint minimal 10× rata-rata traffic puncak harian.

### 17.18 Ad Format & Bid Model

Campaign wajib menyimpan **ad format** dan **bid model** sebagai field terstruktur, karena keduanya memengaruhi cara tracking, perhitungan biaya, dan optimasi.

**Ad format** (enum, dapat diperluas per jaringan):

| Format | Karakteristik | Dampak pada platform |
|---|---|---|
| Push | Notifikasi teks + gambar di perangkat pengguna | Punya creative (judul, deskripsi, ikon, gambar). Wajib laporan per creative dan per zone. Pantau creative fatigue. |
| OnClick (Popunder) | Halaman terbuka di atas/bawah halaman saat pengguna berinteraksi | Tidak ada creative. Pengunjung langsung mendarat di landing/offer. Wajib click redirect server-side (17.2). Tingkat bot tinggi (17.4). |
| In-Page Push | Iklan bergaya push yang tampil di dalam halaman website | Punya creative seperti Push. Tidak bergantung pada subscription push. |
| Direct Click | Halaman terbuka di tab/jendela baru setelah klik pada area situs | Perlakuan tracking seperti OnClick. Laporan per zone/placement. |
| Lainnya (Banner, Native, Interstitial, Meta/Google formats) | Bergantung jaringan | Dipetakan melalui network adapter |

Nama format bisa berbeda antar jaringan. Simpan **nama asli jaringan** sekaligus **format internal yang dinormalisasi**.

**Bid model** (enum, dapat diperluas per jaringan):

| Bid model | Arti | Kebutuhan platform |
|---|---|---|
| CPC | Harga per klik tetap | Biaya = klik × bid. Bisa diestimasi dari data internal, tetapi spend final tetap dari laporan jaringan. |
| SmartCPC | Bid CPC disesuaikan otomatis per placement/zone oleh jaringan | Biaya per klik **berbeda per zone**. Spend akurat hanya didapat dari laporan/API jaringan per zone. Tampilkan sebagai estimasi sampai sinkronisasi spend selesai. |
| CPA Goal (CPC/CPM) | Jaringan mengatur bid dan memblokir zone otomatis untuk mencapai target CPA | **Wajib mengirim konversi kembali ke jaringan via S2S postback** (Bagian E). Tanpa postback yang benar, algoritma jaringan tidak bisa bekerja. |
| CPM / SmartCPM | Harga per 1.000 impresi | Klik dan impresi dari jaringan. CPC efektif dihitung = spend ÷ klik. |
| CPA | Bayar per konversi | Rekonsiliasi jumlah konversi platform dengan jaringan. |

Field campaign tambahan:
- `ad_format_internal`, `ad_format_network`
- `bid_model`, `bid_amount`, `target_cpa`, `currency`
- `conversion_goal_event` (event yang dikirim sebagai postback untuk model CPA Goal)
- `postback_required` (otomatis `true` untuk CPA Goal)

Aturan:
- Campaign dengan bid model CPA Goal **tidak boleh diaktifkan di tracking** sebelum postback ke jaringan dikonfigurasi dan diuji dalam test mode.
- Hanya konversi VERIFIED yang dikirim sebagai postback untuk CPA Goal. Jangan pernah mengirim event OBSERVED, karena akan merusak optimasi jaringan dan dapat melanggar kebijakan.
- Untuk CPA Goal, zone yang diblokir otomatis oleh jaringan tetap dicatat dan dibandingkan dengan blacklist internal (17.5). Bila jaringan menyediakan data ini lewat API atau laporan, simpan.
- Laporan wajib bisa difilter dan dibandingkan per ad format dan per bid model.
- Template tracking link dan macro dibuat **per jaringan dan per ad format**, karena macro yang tersedia (misalnya zone ID, creative ID, click ID, cost) dapat berbeda. Verifikasi macro dari dokumentasi resmi jaringan. Jangan menebak.
- Capability matrix (Bagian C) mencatat kombinasi format dan bid model mana yang dapat dibaca atau diubah lewat API resmi.

## 18. REFERENSI GITHUB TERVERIFIKASI

Diperiksa melalui GitHub API pada 10 November 2026. Jumlah bintang dan tanggal update akan berubah. Simpan commit hash saat review dilakukan.

Aturan umum:
- Semua repository diperlakukan sebagai **untrusted** sampai direview.
- Jangan menjalankan script instalasi dari repository secara otomatis.
- Jangan menyalin kode dari repository tanpa lisensi atau dengan lisensi yang belum jelas.
- Skill internal ditulis ulang sebagai SKILL.md milik platform. Repository hanya menjadi rujukan desain dan konten. Cantumkan atribusi sesuai lisensi bila ada bagian yang diadaptasi.
- Pemakaian kode berlisensi GPL/AGPL harus dibahas dulu dengan owner karena dapat mewajibkan source code platform dibuka.

### 18.1 Daftar Referensi Utama

| No | Repository | Lisensi | Fungsi | Status |
|---|---|---|---|---|
| 1 | https://github.com/anthropics/skills | Lihat per skill / THIRD_PARTY_NOTICES | **Spesifikasi resmi format Agent Skills (SKILL.md)**, template, dan contoh skill | Rujukan utama format skill |
| 2 | https://github.com/coreyhaines31/marketingskills | MIT | Skill marketing paling populer (±59 rb bintang): CRO, copywriting, analytics, growth | **Pengganti referensi Digital Marketing Agent Skills** (repo lensetek tidak ditemukan / 404) |
| 3 | https://github.com/AgriciDaniel/claude-ads | MIT | Skill operasional paid media untuk 12 platform iklan: audit berbasis sumber, Google, Meta, TikTok, dan lain-lain | **Pengganti AdKit Ads Skills** (lisensi AdKit tidak jelas) |
| 4 | https://github.com/kostja94/marketing-skills | MIT | 160+ skill marketing termasuk paid ads, channel, dan strategi | Pelengkap katalog skill |
| 5 | https://github.com/shalintripathi/saas-marketing-agents | MIT | 93 agent spesialis, orkestrator, pembagian tugas antar-agent, Campaign Board | Rujukan organisasi multi-agent dan Kanban |
| 6 | https://github.com/vidual-labs/digital-marketing-skills | MIT | Struktur SKILL.md, validasi input, checklist verifikasi, pengujian skill | Rujukan pengujian skill |
| 7 | https://github.com/gomarble-ai/marketing-agent | MIT | Diagnostik performa campaign, creative fatigue, aksi dengan approval | Sebagian fitur memerlukan layanan berbayar GoMarble. Jangan anggap backend-nya lengkap. |
| 8 | https://github.com/iamwaqargulzar/Marketing-Agent-OS | Apache-2.0 | Katalog skill marketing dan pola packaging | Pelengkap katalog skill |
| 9 | https://github.com/langchain-ai/langgraph | MIT | Orkestrasi agent stateful, human-in-the-loop, persistence, retry | Rujukan utama orkestrasi AI (tersedia versi JS/TS untuk NestJS) |
| 10 | https://github.com/jitsucom/jitsu | MIT | Ingestion event server-side, validasi, dan forwarding ke tujuan (alternatif open-source Segment) | **Pengganti Tracking Gateway** (repo misbahul-alam tanpa lisensi, 1 bintang) |
| 11 | https://github.com/umami-software/umami | MIT | Analytics privacy-first, tracking campaign/UTM, script ringan | Rujukan JS SDK yang ringan dan desain consent/data minimization |
| 12 | https://github.com/UjjwalSaini07/Affiliate-Postback-Engine | MIT | MVP affiliate tracking: click logging, S2S postback, dashboard (Next.js + Express + PostgreSQL) | Rujukan kecil untuk alur click → postback. Kualitas rendah (13 bintang, update terakhir 2025), hanya untuk dibaca. |

### 18.2 Referensi yang Diganti atau Dibatasi

| Referensi lama | Masalah | Tindakan |
|---|---|---|
| lensetek/Digital-Marketing-Agent_Skills | Tidak ditemukan (404), akun tidak punya repo publik | Dihapus, diganti No. 2 |
| adkit/ads-skills | Lisensi tidak jelas (NOASSERTION) | Diganti No. 3. Boleh dibaca, jangan disalin sebelum lisensi dikonfirmasi. |
| misbahul-alam/tracking-gateway | Tidak memiliki lisensi | Diganti No. 10. Tanpa lisensi berarti kode tidak boleh disalin. |
| realkimbarrett/advertising-skills | Tidak memiliki lisensi | Tidak dipakai |

### 18.3 Referensi yang Sengaja Tidak Dipakai

- PostHog, RudderStack: lisensi campuran/non-OSI pada sebagian komponen dan terlalu berat untuk VPS awal.
- Matomo (GPL-3.0): boleh dipelajari, tetapi jangan disalin ke kode platform.
- Repository bertema "cloaker" atau TDS untuk menyembunyikan konten dari reviewer jaringan iklan: **dilarang** (lihat Bagian C dan 17.3).

### 18.4 Catatan Tracker Komersial

Belum ada tracker affiliate open-source yang matang. Untuk perbandingan fitur tracking (redirect, rotasi, postback, bot filter), gunakan **dokumentasi publik** Keitaro, Binom, RedTrack, atau Voluum sebagai rujukan, bukan kode mereka (lihat 17.8).

### 18.5 Pemetaan Skill ke 8 Jabatan

Skill internal dibuat per jabatan (Bagian 3 prompt V2), dengan rujukan:

| Jabatan | AI Assistant | Rujukan skill |
|---|---|---|
| Ads Manager | Strategy Agent | 5 (orkestrator & delegasi), 7 (diagnostik), 3 (audit) |
| Media Buyer | Media Buyer Agent | 3 (paid media multi-platform), 4 (paid ads) |
| Ads Analyst | Analytics Agent | 2 (analytics), 7 (diagnostik performa) |
| Tracking Specialist | Tracking Agent | 10 (event pipeline), 11 (SDK ringan), 12 (alur postback) |
| Fraud Analyst | Fraud Agent | Ditulis internal berdasarkan Bagian 17.4 (tidak ada rujukan open-source yang layak) |
| Creative Specialist | Creative Agent | 2 (copywriting), 3 (creative per platform), 7 (creative fatigue) |
| Landing Page Specialist | CRO Agent | 2 (CRO), 4 (page types) |
| Automation Specialist | Automation Agent | 9 (workflow & retry), 5 (handoff antar-agent) |

Format semua SKILL.md mengikuti spesifikasi No. 1, dengan pengujian mengikuti pola No. 6.

## 19. TIM, KANBAN & AI KARYAWAN (GABUNGAN PROMPT V2)

Bagian ini memasukkan kebutuhan dari "Enterprise AI Ads Team Management Platform V2" dan dikerjakan pada Tahap B (Phase 4–8, lihat 17.6).

Prinsip utama: Ads Manager dapat melihat apa yang sedang dikerjakan setiap karyawan, apa rekomendasi AI Assistant mereka, task mana yang blocked, campaign mana yang perlu perhatian, dan aksi mana yang menunggu approval.

### 19.1 Role Sistem vs Jabatan

Dua konsep ini dipisahkan:

- **Role sistem** (Bagian B): mengatur hak akses. Contoh: Super Admin, Organization Owner, Team Leader, Member, Viewer.
- **Jabatan**: posisi kerja yang menentukan AI Assistant, skill, KPI, dan jenis task.

Satu karyawan memiliki satu role sistem dan satu atau lebih jabatan. Hak akses data tetap ditentukan oleh role sistem dan assignment, bukan oleh jabatan.

Delapan jabatan:

| Jabatan | AI Assistant | Fokus skill | Tanggung jawab Kanban | KPI utama |
|---|---|---|---|---|
| Ads Manager | Strategy Agent | Strategi, KPI, budget, ROI/ROAS, forecasting, alokasi sumber daya, approval | Membuat objective, assign task, review, approve aksi berisiko | Profitabilitas, budget pacing, ROI/ROAS, kualitas penyelesaian tim, waktu approval |
| Media Buyer | Media Buyer Agent | Setup campaign, targeting, bidding, optimasi CPC/CPA, pacing, testing, scaling | Setup, testing, optimasi, budget review, usulan scaling | CPA, CPC, ROI, volume konversi, akurasi pacing, kualitas eksperimen |
| Ads Analyst | Analytics Agent | Analisis CTR/CPM/CPC/CPA/ROAS, atribusi, funnel, statistik, kualitas data | Laporan harian/mingguan, investigasi atribusi, funnel, rekonsiliasi | Akurasi laporan, kelengkapan data, turnaround, kualitas rekomendasi |
| Tracking Specialist | Tracking Agent | Postback S2S, click ID, deduplikasi, diagnostik, debugging API | Implementasi tracking, debugging postback, incident tracking | Uptime tracking, keberhasilan postback, MTTR |
| Fraud Analyst | Fraud Agent | Deteksi bot, klik invalid, reputasi IP/ASN, anomali, pengumpulan bukti | Investigasi traffic, audit kualitas source/zone | Temuan terverifikasi, false positive rate, kualitas bukti |
| Creative Specialist | Creative Agent | Creative push/in-page/native, copywriting, A/B test, creative fatigue, kepatuhan | Produksi banner, revisi, copy, testing, approval creative | Kualitas & ketepatan waktu, cakupan testing, lift CTR/CR bila terukur, hasil review kepatuhan |
| Landing Page Specialist | CRO Agent | CRO, kecepatan halaman, UX mobile, funnel, A/B test | Audit landing, optimasi kecepatan, eksperimen konversi | Conversion rate, metrik kecepatan, kualitas eksperimen |
| Automation Specialist | Automation Agent | Integrasi API, webhook, alert, Telegram/Discord, retry, recovery | Integrasi, aturan automation, debugging webhook, monitoring | Success rate workflow, reliabilitas API, waktu respons insiden |

Fraud Agent tidak boleh menyimpulkan fraud tanpa bukti yang cukup. Hasilnya berupa temuan dengan bukti untuk diverifikasi manusia.

### 19.2 AI Assistant per Karyawan

Setiap karyawan memiliki workspace dengan:
- **My AI Assistant**: agent sesuai jabatan, model OpenRouter dari admin, system prompt per jabatan, skill aktif, riwayat percakapan dengan aturan retensi, konteks hanya dari campaign yang di-assign.
- **My Skills**: daftar skill, versi, tool yang tersedia, riwayat eksekusi.
- **My Tasks**: card yang di-assign, due date, prioritas, checklist, review tertunda, blocked.
- **My Campaigns**: akun dan campaign yang di-assign, metrik, alert, rekomendasi.
- **My Performance**: KPI jabatan, kualitas penyelesaian, ketepatan deadline, hasil review.

Model OpenRouter:
- Default model per jabatan, dengan override per karyawan.
- Fallback model, max tokens, temperature, batas konteks, budget harian dan bulanan.
- Biaya estimasi dan aktual dicatat per request.
- Daftar model diambil dari OpenRouter dan dipilih admin. Tidak ada nama model yang di-hardcode.

Alur eksekusi:
1. Karyawan meminta bantuan.
2. Platform memeriksa jabatan, role, dan izin.
3. Orchestrator memilih skill yang diizinkan.
4. Model OpenRouter yang ditetapkan memproses permintaan.
5. Tool server-side mengambil data sesuai izin (tanpa SQL mentah).
6. Output divalidasi dengan schema dan dicatat.
7. Bila perlu, AI membuat **draft** task card.
8. Karyawan mereview hasil.
9. Aksi berisiko tinggi diajukan ke Ads Manager untuk approval.
10. Hasil akhir dicatat.

Orkestrasi memakai LangGraph JS atau pendekatan setara yang mendukung state persisten, human-in-the-loop, dan retry. Pertahanan terhadap prompt injection wajib, terutama untuk data dari luar (nama campaign, URL, komentar, isi repository).

### 19.3 Skill Library

Setiap skill memiliki:
- ID unik, nama, deskripsi, kategori.
- File SKILL.md (format mengikuti spesifikasi Agent Skills, Bagian 18.1 No. 1).
- Jabatan yang didukung.
- Tool yang dibutuhkan.
- Schema validasi input dan output.
- Klasifikasi risiko (read-only, draft, aksi tulis).
- Versi, test case, riwayat perubahan, syarat approval.

Admin dapat mengaktifkan, menonaktifkan, memperbarui, dan meng-assign skill per karyawan. Skill impor dianggap untrusted sampai direview. Script instalasi dari repository tidak pernah dijalankan otomatis.

### 19.4 Kanban

Kolom default: Backlog, To Do, In Progress, Review, Waiting Approval, Blocked, Done. Board dan kolom kustom didukung.

Isi task card: ID, judul, deskripsi, owner, kolaborator, tim, campaign terkait, jaringan iklan, prioritas, status, tanggal mulai, due date, checklist, lampiran, komentar, mention, insight AI, AI Assistant terkait, dependensi, syarat approval, time entry, bukti penyelesaian, riwayat aktivitas lengkap.

Teknis:
- Drag & drop (dnd-kit) dengan urutan card disimpan secara atomik.
- Sinkronisasi real-time (WebSocket atau SSE).
- Lampiran disimpan dengan batas ukuran dan validasi tipe file.

AI dapat membuat draft task, menyarankan prioritas dan PIC, membuat checklist, menjelaskan blocker, merangkum pekerjaan, dan membuat ringkasan harian. Pembuatan dan pemindahan task oleh AI mengikuti aturan izin dan approval. **AI tidak boleh memindahkan card ke Done hanya karena sudah menghasilkan jawaban.** Done memerlukan bukti penyelesaian.

Contoh alur insiden:
1. Tracking Agent mendeteksi kegagalan postback.
2. Sistem membuat incident card.
3. Tracking Specialist menerima notifikasi.
4. Bila belum selesai melewati batas waktu, Ads Manager menerima eskalasi.
5. Setelah perbaikan diverifikasi, card pindah ke Review.
6. Manager mengonfirmasi, card pindah ke Done.

### 19.5 AI Team Supervisor & Kinerja

AI Team Supervisor untuk Ads Manager memantau: task terbuka, in progress, menunggu review, blocked, overdue, distribusi beban kerja, approval tertunda, insiden campaign dan tracking, serta rekomendasi optimasi yang belum ditindaklanjuti. Filter per tim, karyawan, campaign, jaringan, dan tanggal.

Semua ringkasan harus berasal dari data task dan aktivitas yang tercatat, bukan karangan AI.

Penilaian kinerja:
- Tidak boleh hanya berdasarkan jumlah task selesai, aktivitas mouse, jam online, atau skor subjektif AI.
- Manager dapat menambahkan konteks, termasuk faktor di luar kendali karyawan.
- Tidak ada pemantauan tersembunyi atau pengawasan yang intrusif.
- Laporan tim mingguan dan bulanan.

### 19.6 GitHub Reference Manager

Halaman admin untuk mengelola referensi di Bagian 18: URL, deskripsi, skill terkait, commit hash yang direview, lisensi, tanggal review terakhir, adaptasi skill internal, dan usulan pembaruan yang memerlukan approval admin.

### 19.7 Tambahan Tabel Database

employee_positions, employee_skills, ai_agents, ai_agent_assignments, ai_skills, ai_skill_versions, skill_executions, workspaces, boards, board_columns, task_cards, task_assignees, task_checklists, task_comments, task_attachments, task_activity_logs, task_dependencies, work_logs, kpi_definitions, kpi_snapshots, performance_reviews, github_references, github_reference_reviews.

Tabel `tasks` di Bagian 8 digantikan oleh `task_cards` beserta tabel pendukungnya.

### 19.8 Tambahan Sidebar

AI Skill Library, Kanban Task Boards, My Tasks, Employee Performance, AI Team Supervisor, Approval Center, GitHub Reference Manager. Navigasi hanya menampilkan menu yang diizinkan.

### 19.9 Tambahan Acceptance Criteria (Tahap B)

1. Admin dapat membuat karyawan dan menetapkan role sistem serta jabatan.
2. Setiap karyawan dapat login dan membuka workspace sendiri dengan AI Assistant yang sesuai jabatannya.
3. Admin dapat menetapkan model OpenRouter berbeda per jabatan dan per karyawan.
4. Skill dapat di-assign, diaktifkan, dinonaktifkan, dan memiliki versi.
5. Perubahan Kanban tersimpan dan tersinkron antar pengguna yang berhak.
6. Karyawan tidak dapat mengakses campaign yang tidak di-assign, termasuk lewat AI Assistant.
7. Rekomendasi AI dapat membuat draft task.
8. Aksi berisiko tinggi memerlukan approval manager.
9. Riwayat task dapat diaudit.

## 20. INTEGRASI ROLLERADS (TERVERIFIKASI)

Sumber: dokumentasi resmi https://my.rollerads.com/api/docs (OpenAPI 3.0, "RollerAds API" versi 2.0), diperiksa 10 November 2026. Salinan spesifikasi disimpan di `docs/providers/rollerads/openapi-v2-2026-11-10.json`. Periksa ulang dokumentasi sebelum implementasi karena API dapat berubah.

### 20.1 Dasar Koneksi

- Base URL: `https://api.rollerads.com/v2`
- Autentikasi: `ACCESS_TOKEN` yang diminta ke account manager RollerAds. Token tidak kedaluwarsa sampai dihapus atau diganti.
- Token dapat dikirim lewat header `X-ACCESS-TOKEN` atau query `?access_token=`. **Platform wajib memakai header**, karena query string bisa tercatat di log.
- Token disimpan terenkripsi di `encrypted_credentials` dan tidak pernah dikirim ke browser.
- Uji koneksi menggunakan `GET /whoami`.

### 20.2 Rate Limit

- 300 request per menit per token untuk semua endpoint.
- Statistik (`/statistics/*`, `/sites/stat`): 10 request per menit.
- Pembuatan campaign (`POST /campaigns`): 10 request per menit.
- Polling status report (`/common/report`) tidak dihitung.
- Setiap respons berisi header `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
- Saat ini limit masih "observation mode" (beta). Nantinya request berlebih akan ditolak dengan `429` dan header `Retry-After`.

Platform harus mematuhi limit ini sejak awal: rate limiter per token di BullMQ, membaca header limit, dan menghormati `Retry-After`.

### 20.3 Capability Matrix RollerAds

| Capability | Status | Endpoint | Phase |
|---|---|---|---|
| Uji koneksi / info akun | ✅ Didukung | `GET /whoami` | 2 |
| Daftar campaign | ✅ Didukung | `GET /campaigns/list`, `GET /campaigns/adv` | 2 |
| Detail campaign | ✅ Didukung | `GET /campaigns/{id}` | 2 |
| Statistik / spend sync | ✅ Didukung | `GET /statistics/adv` | 2 |
| Batas pembuatan campaign | ✅ Didukung | `GET /campaigns/limitation` | 2 |
| Data referensi (negara, browser, OS, platform, bahasa, kategori, tipe konversi, rekomendasi CPC) | ✅ Didukung | `GET /misc/*` | 2 |
| Buat campaign | ✅ Didukung | `POST /campaigns` | 6, dengan approval |
| Ubah campaign (status, bid, budget, frekuensi, smart bidding, CPA optimizer, creative) | ✅ Didukung | `POST /campaigns/{id}` | 6, dengan approval |
| Pause / resume / archive | ✅ Didukung via `campaign_status` | `POST /campaigns/{id}` | 6, dengan approval |
| Zone / feed blacklist & whitelist | ✅ Didukung (`allow` / `deny`) | `POST /campaigns/{id}/zone`, `POST /campaigns/{id}/feed` | 6, dengan approval |
| Custom bid per zone / feed | ✅ Didukung | `POST /campaigns/{id}/custom-bid` | 6, dengan approval |
| Aturan optimizer bawaan RollerAds | ✅ Didukung (pause, bid_increase, bid_decrease) | `optimizer_rules` di `POST /campaigns/{id}` | 6, dengan approval |
| Filter traffic proxy | ✅ Didukung (allow, only, deny) | `targetings.proxy` | 6, dengan approval |
| **Format URL postback & macro** | ⚠️ **Tidak ada di spesifikasi API** | – | Harus diambil dari pengaturan tracking di dashboard RollerAds atau dari account manager. Jangan menebak. |

Endpoint publisher (`/statistics/pub`, `/sites/*`), affiliate (`/statistics/aff`, `/statistics/aff-clicks`), dan CRM tidak dipakai kecuali owner juga menjalankan peran tersebut di RollerAds.

### 20.4 Ad Format & Bid Model RollerAds

Nilai resmi dari API, dipetakan ke enum internal (17.18):

| `format_id` | Format |
|---|---|
| 1 | Push notifications |
| 2 | OnClick |
| 3 | In-page push |
| 4 | Native |
| 7 | Direct Click |

| `bid_model_id` | Bid model |
|---|---|
| 1 | CPC |
| 2 | CPM |
| 5 | SmartCPC |
| 6 | SmartCPM |
| 7 | CPA Goal CPC |
| 8 | CPA Goal CPM |
| 9 | CPC (Direct Click) |
| 10 | SmartCPC (Direct Click) |

Creative wajib untuk format 1, 3, dan 4. Field creative: `creative_title` (3–64 karakter), `creative_descr` (maks. 128, native maks. 90), `image_360` (360×240, native 1200×675), `image_192` (192×192). Validasi ini diterapkan di form platform sebelum dikirim ke API.

Field campaign penting yang disimpan dan disinkronkan:
- `campaign_bid`, `campaign_spent_day`, `campaign_spent_total`, `campaign_smooth_limit`
- Frequency cap: `campaign_freq_impression_cnt/hour`, `campaign_freq_click_cnt/hour`
- Smart bidding: `campaign_smart_mode` (default, uniform, zone_country_limit), `campaign_smart_zone_country_limit`, `campaign_smart_coefficient`
- CPA: `campaign_cpa_optimizer` (0 nonaktif, 1 recommended, 2 custom), `campaign_cpa_target`, `campaign_cpa_zone_limit` (untuk bid model 7 dan 8)
- `campaign_status`: active, draft, paused, archived

### 20.5 Sinkronisasi Statistik

`GET /statistics/adv` mendukung:
- Pengelompokan (`group`): campaign, zone, campaign-zone, campaign-country, campaign-country-zone, campaign-country-hour, campaign-country-hour-os, creative, feed, format, country, platform, bidder, hour, day, week, month, dan lainnya.
- Filter: campaign, zone, negara, creative, format, bid model, OS, rentang waktu (`ts`).
- Metrik: impresi, klik, konversi, CR, spend (`amt_imoney`), CPC, CPM, CTR, CPA, serta konversi dan CPA per goal (goal1–goal3).

Strategi sync:
- Karena limit statistik hanya 10 request per menit, gunakan sedikit request dengan pengelompokan yang tepat (misalnya `campaign-country-zone` per hari).
- Sinkronisasi per jam untuk hari berjalan, dan sinkronisasi ulang 2–3 hari terakhir untuk menangkap data terlambat (17.7).
- Data dari RollerAds disimpan di `network_spend_reports` sebagai **data jaringan**, terpisah dari data tracking internal, lalu dibandingkan di laporan rekonsiliasi.
- Timezone laporan RollerAds harus dikonfirmasi dan dicatat sebelum normalisasi ke UTC.
- Konversi milik RollerAds (goal1–goal3) ditampilkan sebagai "konversi menurut jaringan", bukan konversi VERIFIED internal.

### 20.6 Aturan Aksi Tulis

- Semua aksi tulis (buat/ubah campaign, status, budget, bid, zone, custom bid, optimizer rules) **wajib melalui approval** dan tercatat di audit log dengan nilai sebelum dan sesudah.
- Sebelum mengubah, ambil kondisi terbaru campaign (`GET /campaigns/{id}`) untuk mencegah menimpa perubahan yang dibuat langsung di dashboard RollerAds.
- Rollback dilakukan dengan menerapkan kembali nilai sebelumnya yang tersimpan.
- **Hindari konflik otomasi.** Bila CPA optimizer atau `optimizer_rules` RollerAds aktif pada sebuah campaign, aturan otomasi internal untuk bid/pause/zone pada campaign tersebut hanya boleh dalam mode rekomendasi, kecuali owner mengizinkan secara eksplisit.
- Untuk bid model 7 dan 8 (CPA Goal), postback ke RollerAds wajib sudah diuji sebelum campaign diaktifkan (17.18).

### 20.7 Pengujian

- Mock server dibuat dari spesifikasi OpenAPI yang disimpan.
- Uji: autentikasi header, penanganan error, rate limit dan `Retry-After`, parsing statistik, pemetaan format dan bid model, alur approval aksi tulis.
- Pengujian dengan akun asli hanya memakai endpoint read-only, kecuali owner menyetujui pengujian aksi tulis pada campaign uji.

## 21. DESIGN SYSTEM & UI/UX (ADDENDUM V3)

Dikerjakan pada Phase 3.5 (lihat 17.6), lalu dipakai oleh semua modul Tahap B. **Tidak boleh mengubah** arsitektur tracking, permission, orkestrasi OpenRouter, logika Kanban, atau fitur backend yang sudah berjalan hanya demi alasan visual.

### 21.1 Skill Desain

| Skill | Fungsi | Status pemasangan |
|---|---|---|
| frontend-design (anthropics/skills) | Arah visual, tipografi, komposisi; menghindari pola generik | Terpasang penuh |
| impeccable (pbakaus/impeccable) | Audit, critique, polish, deteksi pola "AI generik" | Terpasang **tanpa engine binary** (lihat docs/design-skills.md) |
| ui-ux-pro-max (nextlevelbuilder/ui-ux-pro-max-skill) | Riset gaya, palet, tipografi, pola dashboard & chart | Terpasang; pencarian memakai Python Laragon |

Semua skill dipasang manual setelah review lisensi dan isi. Perintah `npx uipro-cli init` **tidak dipakai** karena paket `uipro-cli` tidak terverifikasi berasal dari repository resmi (paket resminya `ui-ux-pro-max-cli`). Detail: `docs/design-skills.md`.

### 21.2 Identitas Desain

Konsol operasional enterprise yang matang: minimalis tetapi padat informasi, spacing presisi, tipografi konsisten, border halus, warna terbatas, tabel yang sangat mudah dibaca, interaksi bertujuan, light & dark mode yang sama baiknya.

Referensi konseptual (bukan template untuk ditiru): Linear (kejelasan task & interaksi), Attio (hierarki record terstruktur), Stripe Dashboard (penyajian data finansial), Vercel (tipografi presisi & tampilan terkendali). Platform harus punya identitas visual sendiri.

### 21.3 Larangan Pola Generik

Hindari: gradient ungu-biru default, glassmorphism berlebihan, kartu besar dengan padding berlebih, layout kartu identik untuk konten yang tidak berhubungan, hero dekoratif di dalam dashboard, ilustrasi acak, border bercahaya, sudut terlalu bulat, terlalu banyak warna aksen terang, grafik dekoratif tanpa nilai analitis, layout template SaaS generik, animasi tidak perlu, ikon berulang tanpa makna, kompleksitas visual buatan.

Keunikan tidak boleh mengorbankan kegunaan.

### 21.4 Design Token

Token wajib untuk: warna, tipografi, spacing, border, radius, shadow, ukuran komponen, state interaktif, indikator status, warna chart, breakpoint responsif.

- Komponen hanya memakai **token semantik**, bukan warna hardcoded.
- Light mode: latar netral hangat atau netral dingin, permukaan putih/hampir putih, teks charcoal gelap, satu aksen yang terkendali.
- Dark mode: latar netral gelap, panel sedikit terangkat, border halus, teks kontras tinggi.
- Angka finansial dan metrik campaign selalu memakai tabular numbers.
- Warna chart memakai palet kategorikal tervalidasi untuk buta warna (sudah diterapkan pada chart Overview, Phase 1).

### 21.5 Dashboard Enterprise

Sidebar yang bisa diciutkan, pencarian global, pemilih workspace/organisasi, filter campaign, pemilih rentang tanggal, pusat notifikasi, menu profil, KPI, chart performa campaign, tabel padat data, alert operasional, approval tertunda, ringkasan aktivitas tim. Prioritaskan informasi yang bisa ditindaklanjuti.

Komponen yang bergantung pada modul Tahap B (notifikasi, approval, aktivitas tim) ditampilkan setelah modulnya ada — tidak boleh ada tombol yang terlihat aktif tetapi tidak berfungsi (Bagian 11).

### 21.6 Kanban (melengkapi 19.4)

Header kolom ringkas, kartu mudah dibaca, drag & drop dengan drop target yang jelas, indikator prioritas, avatar karyawan, indikator due date, progres checklist, label campaign, indikator AI Assistant, drawer detail task, timeline aktivitas, aksesibilitas keyboard, update real-time.

Tampilan board **dan** list. Filter: karyawan, tim, campaign, jaringan iklan, prioritas, status, due date. Saved views untuk Ads Manager dan karyawan.

### 21.7 Workspace per Jabatan (melengkapi 19.2)

| Jabatan | Fokus tampilan |
|---|---|
| Ads Manager | KPI eksekutif, ringkasan budget, antrean approval, beban kerja tim, rekomendasi strategis |
| Media Buyer | Performa campaign, budget pacing, CPC/CPA, task optimasi, rekomendasi pengujian |
| Ads Analyst | Chart analitis, tabel data, insight atribusi, alat laporan, task investigasi |
| Tracking Specialist | Log event, diagnostik postback, kesehatan tracking, status integrasi, incident card |
| Fraud Analyst | Indikator kualitas traffic, investigasi aktivitas mencurigakan, catatan bukti, antrean review |
| Creative Specialist | Aset creative, board review, hasil A/B test, creative brief, task produksi |
| Landing Page Specialist | Audit landing, laporan kecepatan halaman, funnel konversi, eksperimen, task optimasi |
| Automation Specialist | Aturan workflow, log eksekusi, kesehatan API, alert error, task integrasi |

Semua workspace memakai design system yang sama dengan penekanan informasi sesuai jabatan.

### 21.8 Alur Review Desain

Untuk setiap modul UI besar:
1. Analisis alur kerja pengguna.
2. Riset pola desain dengan skill yang terpasang.
3. Buat dua konsep berbeda bila relevan.
4. Pilih arah visual yang jelas.
5. Definisikan komponen dan perilaku interaksinya.
6. Implementasikan kode frontend yang berfungsi.
7. Uji layout desktop, tablet, dan mobile.
8. Review aksesibilitas dan navigasi keyboard.
9. Critique visual dengan Impeccable.
10. Perbaiki hierarki visual dan hapus pola generik.

Jangan mendesain ulang modul yang tidak terkait tanpa alasan.

### 21.9 Quality Assurance Frontend

- Tidak ada pola visual "AI generik" yang jelas.
- Komponen konsisten antar modul.
- Hierarki informasi jelas; chart dan tabel mudah dibaca.
- Navigasi berfungsi; layout responsif; tidak ada scroll horizontal di layar mobile standar.
- Form dan kontrol aksesibel; kontras baik.
- State loading dan error konsisten; tidak ada interaksi rusak.
- Tidak ada fungsi bisnis yang hilang.
- Bila pengujian visual berbasis browser tersedia, periksa screenshot di beberapa ukuran viewport dan perbaiki masalah layout yang terlihat.

Tujuan akhirnya bukan sekadar layar yang menarik, tetapi aplikasi enterprise yang khas, praktis, mudah dirawat, dan terasa dirancang dengan sengaja oleh desainer produk berpengalaman.

## 20B. INTEGRASI PROPELLERADS (TERVERIFIKASI)

Sumber: spesifikasi OpenAPI resmi "Propeller SSP API" v5 di https://ssp-api.propellerads.com/v5/docs/ (diperiksa 12 November 2026). Seluruh file spesifikasi (146 file YAML, termasuk `$ref`) disimpan di `docs/providers/propellerads/ssp-api-v5-2026-11-12/`.

### 20B.1 Dasar Koneksi

- Base URL: `https://ssp-api.propellerads.com/v5`
- Autentikasi: Bearer token (`Authorization: Bearer <token>`), dibuat di halaman Profile akun SSP.
- Uji koneksi: `GET /adv/balance` (API tidak memiliki endpoint "whoami").
- Rate limit: spesifikasi menyebut header `X-RateLimit-Limit/Remaining/Reset` per menit tanpa angka pasti → platform memakai batas lokal konservatif 30 request/menit dan menghormati `429`.

### 20B.2 Capability Matrix PropellerAds

| Capability | Status | Endpoint | Phase |
|---|---|---|---|
| Uji token | ✅ | `GET /adv/balance` | 3 |
| Daftar campaign (status 1 draft, 2 moderation, 3 rejected, 6 working, 7 paused, 8 stopped) | ✅ | `GET /adv/campaigns` | 3 |
| Statistik / spend per campaign × zone per hari | ✅ | `GET /adv/statistics` (`group_by[]=campaign_id&group_by[]=zone_id`, `tz=+0000`) | 3 |
| Play / stop campaign | ✅ tersedia di API | `PUT /adv/campaigns/play`, `/stop` | 6, dengan approval |
| Include/exclude zone & sub-zone | ✅ tersedia di API | `/adv/campaigns/{id}/targeting/include|exclude/zone` | 6, dengan approval |
| Bid per zone | ✅ tersedia di API | `/adv/campaigns/{id}/zone_rates` | 6, dengan approval |
| Format URL postback & macro | ⚠️ tidak ada di spesifikasi API | – | Ambil dari dashboard PropellerAds |

### 20B.3 Keputusan & Asumsi (perlu dikonfirmasi dengan token asli)

- **Zona waktu**: statistik diminta dengan `tz=+0000`, sehingga tanggal laporan = UTC. Rekonsiliasi memakai UTC.
- **Mata uang**: `GET /adv/balance` hanya mengembalikan angka tanpa mata uang → spend dianggap **USD**.
- **Spend**: field `spent` (tanpa PPN); `spent_with_vat` tidak dipakai.
- **Negara**: format nilai `country_id` tidak dijelaskan di spesifikasi → statistik PropellerAds belum dipecah per negara (kolom negara kosong). Ditambahkan setelah format dikonfirmasi lewat `/collections/countries`.
- **zone_id pada baris respons**: `zone_id` adalah nilai `group_by` resmi, tetapi tidak tercantum pada skema `StatResponseRow` → dibaca secara defensif; verifikasi pada sinkronisasi pertama dengan token asli.
- Respons statistik didefinisikan sebagai *array* `StatResponseWrapped`; adapter juga menerima objek tunggal.

### 20B.4 Jaringan Lain

| Jaringan | Status dokumentasi | Tindakan |
|---|---|---|
| Clickadu | Hanya artikel help center yang saling bertentangan (host `ssp.clickadu.com` vs `v2.api.clickadu.com`), batas 200 request/jam | Minta dokumentasi versi terbaru ke account manager; integrasi API ditolak sampai terverifikasi |
| EvaDav | Dokumentasi API 2.2 hanya lewat personal manager | Sama seperti di atas |

## 22. MANAJEMEN DOMAIN

### 22.1 Pemisahan Domain Platform

| Variabel | Contoh | Fungsi | Dibagikan ke |
|---|---|---|---|
| `ADMIN_DOMAIN` | admin.trkads.org | Login & dashboard, `/api/*` | Tim internal |
| `TRACKER_DOMAIN` | trk.trkads.org | `/c/*`, `/click-out`, `/sdk.js`, `/e` | Jaringan iklan, landing page |
| `POSTBACK_DOMAIN` | pb.trkads.org | `/postback/in/*` | Affiliate network |

Reverse proxy hanya membuka path sesuai fungsi tiap domain. Domain admin tidak pernah muncul di tracking link atau URL postback.

### 22.2 Domain Tracking Kustom

- Organisasi dapat mendaftarkan domain sendiri (mis. `go.brand.com`) untuk tracking link dan JS SDK first-party.
- Verifikasi kepemilikan: CNAME ke `TRACKER_DOMAIN`, atau A record yang semua IP-nya sama dengan IP `TRACKER_DOMAIN` (domain apex).
- Sertifikat HTTPS diterbitkan otomatis (Caddy on-demand TLS) **hanya** untuk domain berstatus ACTIVE, lewat endpoint internal `/internal/tls-allowed` yang tidak terbuka ke internet dan dilindungi `INTERNAL_ASK_KEY`.
- Domain platform tidak bisa didaftarkan sebagai domain kustom; satu hostname hanya bisa dimiliki satu organisasi.
- Verifikasi ulang otomatis tiap 6 jam. Bila DNS tidak lagi mengarah ke platform: status FAILED, sertifikat tidak diperpanjang, tracking link campaign kembali ke domain platform, alert HIGH dikirim.
- Domain yang masih dipakai campaign tidak bisa dihapus.

## 23. TIM AI OTONOM (AI TEAM) — melengkapi 19.2 & 19.5

Keputusan owner (2026-11-11): selain AI Assistant untuk karyawan manusia, organisasi memiliki **tim karyawan AI** yang bekerja sendiri dengan struktur atasan–bawahan. Owner adalah pemberi persetujuan akhir.

### 23.1 Struktur

```
Owner (manusia) ── persetujuan akhir, memberi perintah
   └─ Kepala Tim AI (AI Supervisor) ── merangkum, menilai, meneruskan ke owner, membagi tugas
        ├─ Strategy Agent (Ads Manager)        ├─ Fraud Agent (Fraud Analyst)
        ├─ Media Buying Agent (Media Buyer)    ├─ Creative Agent (Creative Specialist)
        ├─ Analytics Agent (Ads Analyst)       ├─ CRO Agent (Landing Page Specialist)
        ├─ Tracking Agent (Tracking Specialist)└─ Automation Agent (Automation Specialist)
```

- Setiap karyawan AI = satu jabatan, memakai model & skill jabatan tersebut (Bagian 19.2/19.3), bisa dinonaktifkan per agent.
- Karyawan AI **tidak pernah melapor langsung ke owner**; semua laporan dan usulan lewat Kepala Tim AI. Kepala Tim AI meneruskan ke owner dalam bentuk ringkasan.

### 23.2 Aturan kerja (ditegakkan server, bukan hanya prompt)

1. **Rule per jabatan**: tool dan jenis usulan yang boleh dibuat dibatasi per jabatan (mis. hanya Media Buyer/Strategy boleh mengusulkan perubahan status campaign; Fraud boleh mengusulkan blokir zone; Tracking hanya membuat tugas). Usulan di luar rule ditolak server dan dicatat sebagai pelanggaran.
2. **Reason dengan data**: setiap temuan dan usulan wajib menyertakan alasan dan **bukti** yang merujuk hasil tool yang benar-benar dipanggil di sesi itu (ID bukti `E1`, `E2`, …). Usulan tanpa bukti valid ditolak otomatis.
3. **Target goal**: owner menetapkan goal (profit, ROI, CPA, revenue, konversi, batas spend; per organisasi atau per campaign; harian/mingguan/bulanan). Semua laporan menilai progres terhadap goal.
4. **Tidak ada eksekusi tanpa owner**: aksi yang mengubah campaign/zone/tugas hanya dijalankan server setelah owner menyetujui, dengan pratinjau nilai sebelum–sesudah dan audit log. Model tidak pernah memanggil API tulis secara langsung.
5. Data dari luar (nama campaign, komentar, isi alert) tetap DATA, bukan instruksi (Bagian 19.2).

### 23.3 Rapat harian & evaluasi campaign

Dijadwalkan sekali sehari pada jam yang diatur owner (zona waktu organisasi), bisa juga dimulai manual.
1. **Laporan**: setiap karyawan AI aktif menganalisis data (kemarin & 7 hari) sesuai jabatannya → temuan, evaluasi campaign, usulan, dan pertanyaan untuk rekan.
2. **Diskusi**: setiap agent membaca laporan rekan, menjawab pertanyaan yang ditujukan kepadanya, dan memberi tanggapan (mendukung/keberatan/informasi) pada usulan rekan — dengan data.
3. **Rangkuman Kepala Tim AI**: evaluasi per campaign, progres goal, risiko, lalu memutuskan tiap usulan: diteruskan ke owner (dengan alasan gabungan), ditolak (dengan alasan), atau ditunda.
4. Owner menerima ringkasan + antrean persetujuan di **Approval Center**.

### 23.4 Perintah owner

Owner menulis permintaan ke Kepala Tim AI → Kepala Tim AI membuat rencana dan membagi tugas ke agent terkait → setiap agent mengerjakan dan melapor dengan data → Kepala Tim AI merangkum jawaban + usulan → owner menyetujui/menolak/minta revisi.

### 23.5 Approval Center & eksekusi

- Status usulan: `DRAFT` (agent) → `SUPERVISOR_REJECTED` / `PENDING_OWNER` (diteruskan Kepala Tim AI) → `APPROVED` / `REJECTED` / `REVISION` → `EXECUTED` / `FAILED`.
- Jenis aksi tahap ini: buat tugas Kanban, ubah status campaign internal (aktifkan/pause — campaign baru tidak berjalan sebelum disetujui), blokir/izinkan zone (daftar internal). Aksi tulis ke API jaringan (Bagian 20.3/20.6) menyusul memakai jalur approval yang sama.
- Setelah eksekusi, agent penanggung jawab mengevaluasi hasilnya di rapat berikutnya.

### 23.6 Transparansi & kontrol owner

- Owner (izin `ai.supervise`) dapat membaca **seluruh** percakapan karyawan AI (termasuk data tool yang dipakai) dan percakapan AI Assistant karyawan manusia. Setiap pembukaan percakapan karyawan manusia dicatat di audit log, dan karyawan diberi tahu di layar bahwa percakapan AI dapat diaudit.
- **Tombol darurat**: menghentikan seluruh aktivitas tim AI dan eksekusi seketika.
- Budget harian tim AI dan batas per sesi rapat/perintah; pemakaian tercatat per agent.

### 23.7 Anti-halusinasi (ditegakkan server)

- Setiap angka yang ditulis karyawan AI (temuan, alasan usulan, dampak, pelajaran, jawaban diskusi) dicocokkan dengan angka di data bukti yang dirujuk (toleransi pembulatan; rasio ↔ persen; tanda rugi). Angka periode (“7 hari”), tanggal, ID, dan 0/1 tidak diperiksa.
- Temuan/tanggapan dengan angka yang tidak ada di bukti dibuang dan dicatat; usulan seperti itu ditolak; ringkasan agent dan rangkuman Kepala Tim yang memuat angka tak terverifikasi diberi tanda peringatan untuk owner.

### 23.8 Ingatan kerja (belajar dari hasil sebelumnya)

- Jenis ingatan: **Hasil nyata** (dihitung server: rata-rata harian profit/spend/konversi campaign 7 hari sebelum vs sesudah eksekusi, dievaluasi ≥2 hari setelah eksekusi), **Keputusan** (owner/Kepala Tim/sistem menolak, menyetujui, meminta revisi + alasannya), **Pelajaran** (ditulis agent, wajib ber-bukti dan lolos cek angka), **Catatan owner** (manual, disematkan).
- Ingatan dimuat ke prompt sesi berikutnya sebagai DATA (bukan instruksi); maksimal 200 per agent, yang disematkan selalu dimuat. Owner dapat menambah, menyematkan, dan menghapus ingatan.

### 23.9 Ruang Tim & kantor 3D

- Ruang Tim: tampilan chat seluruh pekerjaan karyawan AI (laporan, diskusi, pengambilan data + bukti, catatan sistem) per sesi, dapat difilter per karyawan; owner memberi perintah dari kolom chat (selalu lewat Kepala Tim AI).
- Kantor 3D: setiap karyawan AI tampil sebagai robot di mejanya; animasi dan gelembung kerja mengikuti status nyata dari transkrip (siaga, ikut sesi, mengambil data, menulis, nonaktif, dihentikan).

### 23.10 Perintah lewat Telegram & Discord (melengkapi bagian 5–6)

- Telegram: long polling `getUpdates` di worker; perintah `/status /perintah /rapat /usulan /stop /lanjut /hubungkan` (format `/perintah@bot` di grup; privacy mode tidak perlu dimatikan). Hanya grup terdaftar atau chat pribadi.
- Discord: slash command `/eaip …` lewat Interactions Endpoint (tanda tangan Ed25519 diverifikasi), kabar dikirim lewat webhook dengan `allowed_mentions` kosong.
- Akun chat ditautkan ke anggota EAIP dengan kode sekali pakai (10 menit, disimpan sebagai hash); otorisasi memakai permission EAIP (`ai.supervise`), rate limit 10 perintah/menit, semua perintah masuk audit log.
- Hasil sesi (rangkuman, jumlah usulan menunggu, tautan) dibalas ke chat asal dan dikirim ke channel yang mengaktifkan “kabar Tim AI”.
- **Hanya satu platform chat aktif** per organisasi (Telegram atau Discord, dipilih owner). Perintah, kabar Tim AI, alert, dan persetujuan hanya berjalan di platform aktif; platform lain menolak/mengabaikan.
- **Persetujuan lewat chat** (keputusan owner 2026-11-11, melengkapi bagian 5): tombol Setujui/Tolak pada kartu usulan (Telegram inline keyboard; Discord button lewat `/eaip usulan`). Syarat: akun tertaut, izin `ai.approve`, pengaturan “approval lewat chat” aktif, dan **konfirmasi kedua** sebelum eksekusi. Keputusan melewati jalur yang sama dengan Approval Center (status dicek ulang, eksekusi server, audit log `chat.approval`). Revisi: `revisi <kode> <catatan>`. Owner dapat mematikan approval lewat chat kapan saja.
