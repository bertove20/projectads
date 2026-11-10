# EAIP Design System

Arah visual: **konsol operasional "meja trading"** untuk tim pembeli iklan. Hal yang paling sering dicari pengguna adalah untung/rugi, jadi hijau/merah dicadangkan untuk itu. Semua yang lain tenang dan padat informasi.

Sumber token: `apps/dashboard/src/app/globals.css`. Komponen: `apps/dashboard/src/components/ui.tsx`.

## Warna (token semantik)

| Token | Light | Dark | Dipakai untuk |
|---|---|---|---|
| `bg` | #f3f5f4 | #101413 | latar aplikasi (abu kehijauan dingin) |
| `surface` | #ffffff | #161b19 | panel, sidebar, topbar |
| `surface-2` | #eef1ef | #1d2421 | hover, kode, skeleton |
| `border` / `border-strong` | #dee3e0 / #c9d0cc | #28302d / #36403c | pemisah / kontrol & header tabel |
| `text` / `muted` | #18201c / #5e6a64 | #e6ebe8 / #96a39d | teks utama / sekunder |
| `primary` (petrol) | #135e6e | #5fb0c2 | satu-satunya aksen: aksi utama, navigasi aktif, tautan |
| `success` / `danger` | #17804a / #c0392b | #3fb873 / #ef6a5a | **hanya** profit/rugi dan status |
| `warning` | #a35d06 | #e0a23a | status perlu perhatian |
| `series-1` / `series-2` | #2a78d6 / #eb6834 | #3987e5 / #d95926 | chart (palet tervalidasi buta warna) |

Komponen tidak boleh memakai warna hex langsung.

## Tipografi

- IBM Plex Sans 400/500/600, di-host sendiri lewat `next/font`.
- Ukuran: 13px isi & tabel, 12px label/keterangan, 20px judul halaman, 34px angka profit utama.
- Semua angka metrik memakai `tabular` (tabular numbers) dan rata kanan.
- Sentence case. Tidak ada label huruf kapital semua, tidak ada pemisah titik tengah ("·").

## Komponen & aturan

- **PageHeader**: judul kiri, filter/aksi satu baris di kanan; di mobile turun ke bawah judul.
- **Kontrol**: tinggi 32px (`h-8`), radius 6px. Lebar dari pemanggil selalu menang (`cn()` = clsx + tailwind-merge).
- **Card**: border, radius 8px, tanpa bayangan. Header 44px.
- **Table**: header sticky, sentence case, garis bawah `border-strong`; baris 36px; kolom angka rata kanan (`numericFrom` / `numericCols`).
- **Profit**: selalu bertanda (+/−) dan berwarna (`ProfitText`, `RoiBadge`).
- **Catatan/definisi**: di dalam `Notes` (bisa dibuka), bukan daftar yang selalu tampil.
- **Loading**: skeleton baris, bukan teks "Memuat…".
- **Status**: `StatusBadge` dengan label Bahasa Indonesia.
- **Elemen utama Overview**: baris laba-rugi (P&L line). Hanya satu elemen "berani" per halaman.

## Verifikasi

Setiap perubahan UI besar diperiksa lewat screenshot di 1440px dan 390px, light & dark, serta dicek tidak ada scroll horizontal (read.md 21.9).
