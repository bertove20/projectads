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
  rclone copy "$FILE" "$BACKUP_REMOTE/" --quiet
  echo "✓ dikirim ke $BACKUP_REMOTE"
fi

find "$BACKUP_DIR" -name 'eaip-*.dump*' -mtime +"$RETENTION_DAYS" -delete
echo "[$(date -u +%FT%TZ)] backup selesai"
