# Telegram Bot API — catatan terverifikasi (2026-11-11)

Sumber: https://core.telegram.org/bots/api dan https://core.telegram.org/bots/features#privacy-mode

## Menerima perintah (long polling)
- `getUpdates` params: `offset` (ID update pertama; = update_id terbesar yang sudah diterima + 1), `limit` 1–100 (default 100), `timeout` (detik long polling; 0 = short polling, hanya untuk uji), `allowed_updates` (array string).
- `getUpdates` **tidak berfungsi bila webhook aktif** (keduanya saling meniadakan). Update disimpan maksimal 24 jam.
- `Update`: `update_id`, paling banyak satu field opsional, mis. `message`.
- `Message`: `message_id`, `from` (User, opsional), `chat` (Chat), `text` (opsional), `entities`, `reply_to_message`.
- `User`: `id`, `is_bot`, `first_name`, `username` (opsional). `Chat`: `id`, `type` (`private` | `group` | `supergroup` | `channel`).

## Privacy mode (default aktif)
Di grup, bot hanya menerima: perintah yang ditujukan kepadanya (`/perintah@nama_bot`), perintah umum bila bot terakhir yang memposting, balasan ke pesan bot, dan pesan service. Pesan private chat selalu diterima. → EAIP memakai format perintah, tidak perlu mematikan privacy mode.

## Mengirim
- `sendMessage`: `chat_id`, `text` (1–4096 karakter setelah parsing entity), `parse_mode` (`HTML`), `reply_parameters` (`message_id`), `link_preview_options`, `reply_markup`.
- HTML yang didukung: `<b> <strong> <i> <em> <u> <s> <a href> <code> <pre> <blockquote> <tg-spoiler>` — selain itu tidak didukung (escape `& < >`).

## Keputusan EAIP
- Worker melakukan long polling `getUpdates` per channel yang mengaktifkan perintah; offset disimpan di DB agar tidak memproses ulang.
- Identitas pengirim (`from.id`) wajib ditautkan ke anggota EAIP lewat kode sekali pakai (`/hubungkan KODE`); izin dicek dari role EAIP, bukan dari status admin grup.
- Persetujuan eksekusi usulan TIDAK dilakukan lewat teks chat (read.md bagian 5): bot mengirim tautan ke Approval Center.
