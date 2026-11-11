# Discord — Interactions & Webhook (terverifikasi 2026-11-11)

Sumber: https://docs.discord.com/developers/interactions/overview, /interactions/receiving-and-responding, /interactions/application-commands, /resources/webhook

## Interactions endpoint (HTTP, tanpa gateway)
- Setiap request membawa header `X-Signature-Ed25519` dan `X-Signature-Timestamp`. Pesan yang ditandatangani = timestamp + **raw body** (string apa adanya). Verifikasi dengan public key aplikasi (hex, dari Developer Portal). Gagal → balas **401**. Discord juga sengaja mengirim tanda tangan salah untuk menguji.
- PING (`type: 1`) → balas `200` dengan `{"type": 1}` (PONG).
- Tipe interaksi: 1 PING, 2 APPLICATION_COMMAND, 3 MESSAGE_COMPONENT, 4 AUTOCOMPLETE, 5 MODAL_SUBMIT.
- Tipe callback: 1 PONG, 4 CHANNEL_MESSAGE_WITH_SOURCE, 5 DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE. Respons awal wajib < 3 detik; token interaksi berlaku 15 menit (follow-up: `POST /webhooks/{application_id}/{token}`).
- Objek interaksi: `id`, `application_id`, `type`, `data` (`name`, `options[]` berisi `name`, `type`, `value`, `options`), `guild_id`, `channel_id`, `member` (di guild, berisi `user`), `user` (di DM), `token`.
- Flag ephemeral: `64`.

## Mendaftarkan slash command
- Guild (langsung aktif): `PUT /applications/{application.id}/guilds/{guild.id}/commands` — menimpa semua command guild. Header `Authorization: Bot <token>`. Base `https://discord.com/api/v10`.
- Command CHAT_INPUT (`type: 1`): nama 1–32 huruf kecil, deskripsi 1–100. Option type: 1 SUB_COMMAND, 3 STRING (`max_length` ≤ 6000), 4 INTEGER, 5 BOOLEAN.

## Execute webhook (kirim ke channel)
- `POST /webhooks/{webhook.id}/{webhook.token}` (URL webhook dari pengaturan channel). `content` ≤ 2000 karakter, `embeds` ≤ 10, `username`, `allowed_mentions` (dipakai untuk konten buatan pengguna). `?wait=true` → mengembalikan objek pesan; tanpa itu 204.

## Keputusan EAIP
- Satu command `/eaip` dengan subcommand: `status`, `rapat`, `perintah teks:`, `usulan`, `stop`, `lanjut`, `hubungkan kode:`.
- Endpoint publik `POST /api/v1/integrations/discord/{channelId}/interactions` di domain admin; verifikasi Ed25519 sebelum apa pun.
- Discord user ID ditautkan ke anggota EAIP lewat kode sekali pakai; otorisasi memakai permission EAIP (read.md bagian 6), `allowed_mentions: { parse: [] }` untuk semua pesan.
