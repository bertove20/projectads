#!/usr/bin/env bash
# Restore database dari file backup.
#   ./scripts/restore.sh backups/eaip-20261111T023000Z.dump
#
# PERINGATAN: menimpa seluruh isi database. Layanan aplikasi dihentikan selama restore.
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; source .env; set +a

FILE="${1:?Gunakan: restore.sh <file.dump>}"
[[ -f "$FILE" ]] || { echo "File tidak ditemukan: $FILE"; exit 1; }

if [[ "$FILE" == *.gpg ]]; then
  DECRYPTED="${FILE%.gpg}"
  gpg --batch --yes --output "$DECRYPTED" --decrypt "$FILE"
  FILE="$DECRYPTED"
fi

read -r -p "Restore $FILE ke database '$POSTGRES_DB'? Data saat ini akan DITIMPA. Ketik 'restore': " CONFIRM
[[ "$CONFIRM" == "restore" ]] || { echo "Dibatalkan"; exit 1; }

echo "→ menghentikan aplikasi"
docker compose stop api tracker worker

echo "→ restore"
docker compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner < "$FILE"

echo "→ menjalankan migrasi yang belum ada & menyalakan aplikasi"
docker compose up -d migrate
docker compose up -d api tracker worker
echo "✓ restore selesai. Periksa: docker compose ps"
