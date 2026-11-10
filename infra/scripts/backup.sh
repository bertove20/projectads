#!/usr/bin/env bash
# Backup PostgreSQL (format custom, terkompresi) dengan retensi lokal.
# Jadwalkan via cron di VPS, contoh (setiap hari 02:30):
#   30 2 * * * /opt/eaip/infra/scripts/backup.sh >> /var/log/eaip-backup.log 2>&1
#
# Opsional offsite: set BACKUP_REMOTE (remote rclone, mis. "b2:eaip-backups") — wajib untuk DR (read.md 17.10).
# Opsional enkripsi: set BACKUP_GPG_RECIPIENT untuk mengenkripsi file sebelum dikirim offsite.
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; source .env; set +a

BACKUP_DIR="${BACKUP_DIR:-$(pwd)/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/eaip-$STAMP.dump"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

echo "[$(date -u +%FT%TZ)] backup dimulai → $FILE"
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner > "$FILE"

# Verifikasi file dump dapat dibaca
docker compose exec -T postgres pg_restore --list < "$FILE" > /dev/null
echo "✓ dump valid ($(du -h "$FILE" | cut -f1))"

if [[ -n "${BACKUP_GPG_RECIPIENT:-}" ]]; then
  gpg --batch --yes --encrypt --recipient "$BACKUP_GPG_RECIPIENT" "$FILE"
  rm -f "$FILE"
  FILE="$FILE.gpg"
fi

if [[ -n "${BACKUP_REMOTE:-}" ]]; then
  UPLOAD="$FILE"
  # Salinan offsite dienkripsi (AES-256, passphrase) — penyedia storage tidak bisa membaca isi database.
  # Salinan lokal di VPS tetap tidak terenkripsi agar restore cepat.
  if [[ -n "${BACKUP_PASSPHRASE_FILE:-}" && "$FILE" != *.gpg ]]; then
    [[ -r "$BACKUP_PASSPHRASE_FILE" ]] || { echo "BACKUP_PASSPHRASE_FILE tidak terbaca: $BACKUP_PASSPHRASE_FILE" >&2; exit 1; }
    UPLOAD="$FILE.gpg"
    gpg --batch --yes --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" \
      --symmetric --cipher-algo AES256 --output "$UPLOAD" "$FILE"
  elif [[ "$FILE" != *.gpg ]]; then
    echo "PERINGATAN: backup offsite TIDAK terenkripsi (atur BACKUP_PASSPHRASE_FILE)" >&2
  fi
  rclone copy "$UPLOAD" "$BACKUP_REMOTE/" --quiet
  [[ "$UPLOAD" != "$FILE" ]] && rm -f "$UPLOAD"
  echo "✓ dikirim ke $BACKUP_REMOTE ($(basename "$UPLOAD"))"
  # Retensi offsite (default 30 hari)
  rclone delete "$BACKUP_REMOTE/" --min-age "${OFFSITE_RETENTION_DAYS:-30}d" --include 'eaip-*.dump*' --quiet || true
fi

find "$BACKUP_DIR" -name 'eaip-*.dump*' -mtime +"$RETENTION_DAYS" -delete
echo "[$(date -u +%FT%TZ)] backup selesai"
