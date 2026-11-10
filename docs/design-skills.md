# Design Skills — Provenance & Review

Dipasang di `.claude/skills/` pada 11 November 2026 sesuai read.md Bagian 21 (Addendum V3).
Tidak ada installer (`npx …`) yang dijalankan; file diunduh lewat `git sparse-checkout`, dipindai, lalu disalin manual.

| Skill | Sumber | Commit | Lisensi | Yang dipasang | Yang TIDAK dipasang |
|---|---|---|---|---|---|
| frontend-design | github.com/anthropics/skills — `skills/frontend-design` | `2c5958e` | Apache-2.0 (LICENSE.txt) | Semua (SKILL.md, LICENSE.txt) | — |
| impeccable | github.com/pbakaus/impeccable — `.claude/skills/impeccable` | `ebe9c26` (v4.8.2) | Apache-2.0 (LICENSE, NOTICE.md) | SKILL.md, `reference/*.md` | `scripts/` — launcher yang **mengunduh dan menjalankan binary** platform, dipanggil hook di setiap edit, plus script browser live-mode. |
| ui-ux-pro-max | github.com/nextlevelbuilder/ui-ux-pro-max-skill — `.claude/skills/ui-ux-pro-max` | `6ae86f6` | MIT (LICENSE) | SKILL.md, `data/`, `references/`, `scripts/*.py` (pencarian lokal atas CSV; tidak ada akses jaringan) | `scripts/tests/` |

## Temuan review

- **`npx uipro-cli init`** (perintah yang diberikan) memakai paket npm `uipro-cli` v2.2.3 **tanpa tautan repository**. README resmi menyebut paket **`ui-ux-pro-max-cli`** (v2.15.0). Paket `uipro-cli` tidak diverifikasi berasal dari pembuat yang sama → **tidak dijalankan**.
- **`npx impeccable install`** memasang CLI yang mengunduh binary engine. Diganti dengan pemasangan markdown saja. Konsekuensi: perintah berbasis engine (`impeccable context`, `live`, `pin`, deteksi otomatis) tidak tersedia; panduan critique/audit/polish/typeset/layout tetap dapat dipakai.
- **`npx skills add`** (Vercel `skills` CLI) tidak diperlukan; skill frontend-design hanya berupa satu file markdown.
- Tidak ditemukan instruksi prompt-injection atau perintah eksfiltrasi pada file markdown yang dipasang.

## Menjalankan pencarian UI UX Pro Max

Python tidak ada di PATH Windows; gunakan Python bawaan Laragon:

```bash
C:/laragon/bin/python/python-3.13/python.exe -I .claude/skills/ui-ux-pro-max/scripts/search.py "ad operations dashboard" --design-system -p "EAIP"
```

## Pembaruan

Ulangi proses yang sama (sparse checkout → pindai → salin) dan perbarui kolom commit di atas. Jangan menimpa folder tanpa membaca perubahan (`git diff` antara commit lama dan baru).
