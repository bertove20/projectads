# Changelog

Format: tanggal (UTC) · jenis perubahan. Riwayat lengkap ada di `git log`.
Roadmap & status fase: [read.md](read.md) bagian 17.6 dan [README.md](README.md).

## [Unreleased] — branch `develop`

### Ditambahkan (Phase 6 — Tim AI otonom, read.md Bagian 23)
- **Struktur tim**: Owner → Kepala Tim AI → 8 karyawan AI per jabatan. Karyawan AI melapor ke Kepala Tim AI, bukan langsung ke owner.
- **Rapat harian & evaluasi campaign**: terjadwal (jam rapat per organisasi) atau manual; tahap laporan → diskusi antar-agent (tanya-jawab & tanggapan usulan) → rangkuman Kepala Tim + evaluasi per campaign + progres goal.
- **Perintah owner**: owner memberi permintaan ke Kepala Tim AI → rencana & pembagian tugas ke agent terkait → laporan → rangkuman untuk owner.
- **Reason dengan data, ditegakkan server**: setiap hasil tool menjadi bukti ber-ID (E1, E2, …); temuan/usulan tanpa bukti valid atau di luar wewenang jabatan ditolak sistem dan tercatat.
- **Goal tim**: profit, ROI, revenue, konversi, CPA, spend — harian/mingguan/bulanan, per organisasi atau per campaign.
- **Approval Center**: usulan yang diteruskan Kepala Tim AI dengan alasan, bukti, tanggapan rekan, dan pratinjau sebelum–sesudah; owner menyetujui (server mengeksekusi + audit log), menolak, atau meminta revisi (otomatis jadi perintah baru ke Kepala Tim). Aksi tahap ini: buat tugas, ubah status campaign internal, blokir/izinkan zone (daftar internal).
- **Kontrol owner**: tombol darurat (hentikan semua sesi & blokir eksekusi), aktif/nonaktif & model per agent, instruksi khusus per agent, budget harian tim dan per sesi.
- **Transparansi**: owner membaca seluruh transkrip tim AI dan percakapan AI Assistant karyawan (setiap pembukaan tercatat di audit log; karyawan diberi tahu).
- Izin baru `ai.supervise` dan `ai.approve` (default hanya Owner).

### Ditambahkan (Phase 6 — ingatan, anti-halusinasi, Ruang Tim, kantor 3D, Telegram & Discord)
- **Anti-halusinasi**: setiap angka yang ditulis karyawan AI dicocokkan dengan data bukti yang dirujuk; temuan dengan angka karangan dibuang, usulan ditolak, rangkuman ditandai.
- **Ingatan kerja**: keputusan owner/Kepala Tim/sistem, hasil nyata eksekusi (profit/spend/konversi per hari sebelum vs sesudah, dihitung server), pelajaran ber-bukti, dan catatan owner dimuat ke sesi berikutnya agar tim belajar dari hasil sebelumnya. Owner dapat menambah, menyematkan, dan menghapus ingatan.
- **Ruang Tim**: tampilan chat semua pekerjaan karyawan AI (per sesi dan per karyawan) + profil, statistik, dan ingatan; perintah ke Kepala Tim dari kolom chat.
- **Kantor 3D**: robot karyawan AI per jabatan dengan animasi sesuai status nyata (siaga, ikut sesi, mengambil data, menulis, nonaktif, dihentikan); klik untuk melihat pekerjaannya.
- **Telegram**: perintah dari grup/chat pribadi (`/perintah`, `/rapat`, `/status`, `/usulan`, `/stop`, `/lanjut`, `/hubungkan`) lewat long polling; hasil sesi dibalas ke grup.
- **Discord**: channel Discord (webhook) untuk kabar tim & alert, slash command `/eaip` lewat Interactions Endpoint dengan verifikasi Ed25519, pendaftaran perintah dari dashboard.
- Tautan akun chat ke anggota EAIP dengan kode sekali pakai; izin mengikuti role EAIP.
- **Approval lewat chat**: kartu usulan dengan tombol Setujui/Tolak (Telegram) dan `/eaip usulan` (Discord), konfirmasi dua langkah, wajib izin `ai.approve`; revisi lewat `revisi <kode> <catatan>`; bisa dimatikan owner.
- **Satu platform chat aktif**: owner memilih Telegram atau Discord; perintah, kabar, alert, dan approval hanya lewat platform itu.
- Halaman: Ruang Tim, Telegram & Discord; tab Kantor 3D di Tim AI.

### Ditambahkan (Phase 5 — AI Workspace & Skill Library)
- **Gateway OpenRouter** (server-side): API key diuji lalu disimpan terenkripsi, tidak pernah dikirim ke browser; model registry disinkron dari OpenRouter (harga, konteks, dukungan tool) dan hanya model yang diaktifkan admin yang bisa dipakai.
- **AI Assistant per jabatan**: 8 agent (Strategy, Media Buyer, Analytics, Tracking, Fraud, Creative, CRO, Automation); model, fallback, temperature, maks token, budget harian/bulanan per jabatan dengan override per karyawan; budget organisasi & batas request.
- **Tool server-side ber-cakupan**: AI membaca daftar campaign, performa, alert, kesehatan postback, dan tugas hanya dalam cakupan pengguna; tidak ada SQL dari model; tool di luar skill/izin ditolak.
- **Draft task dari AI**: AI hanya mengusulkan; kartu Kanban (sumber AI) dibuat setelah karyawan menyetujui.
- **Skill Library**: 8 skill bawaan, SKILL.md berversi, versi baru wajib direview; skill impor dianggap untrusted (catatan review + disetujui admin lain); override skill per karyawan.
- **Pemakaian & biaya**: log token dan biaya per request (aktual dari OpenRouter), grafik harian, per model, kegagalan & blokir budget; retensi riwayat percakapan (default 90 hari).
- Halaman: AI Assistant, Skill Library, Pengaturan AI.

### Ditambahkan (Phase 4 — Tim & Kanban)
- **Tim & jabatan**: 8 jabatan kerja (terpisah dari role hak akses), tim dengan ketua & anggota, halaman "Tim kerja".
- **Board Kanban**: 7 kolom default + kolom custom dengan batas WIP, drag & drop (mouse, sentuh, keyboard), tampilan board & daftar, filter (orang, prioritas, campaign, lewat tenggat), pengaturan kolom.
- **Kartu tugas**: nomor T-n, prioritas, owner, kolaborator, campaign/akun jaringan, jadwal, checklist, komentar dengan @mention, dependensi (anti siklus), tautan, catatan waktu, timeline aktivitas.
- **Aturan kerja**: Done wajib bukti penyelesaian dan dependensi selesai; kartu "wajib approval" hanya bisa diselesaikan Owner/Team Leader (`tasks.approve`); anggota cakupan ASSIGNED hanya melihat kartu campaign miliknya atau yang ia pegang/ikuti.
- **Real-time**: perubahan board tampil di semua sesi tanpa reload (SSE + Redis pub/sub); pemindahan kartu atomik dengan versi (bentrok → 409).
- **Incident card otomatis**: alert HIGH/CRITICAL menjadi kartu di board default, di-assign ke Tracking Specialist; alert serupa berulang digabung ke kartu yang sama.
- **Tugas saya**: kartu milik/diikuti dikelompokkan per tenggat + daftar mention.

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
