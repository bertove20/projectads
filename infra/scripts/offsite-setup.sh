#!/usr/bin/env bash
# Siapkan backup offsite ke Cloudflare R2 (S3-compatible) dengan enkripsi passphrase.
#
# 1) Di Cloudflare: R2 → Create bucket (mis. "eaip-backups"), lalu
#    R2 → Manage API tokens → Create token (izin: Object Read & Write, hanya bucket itu).
# 2) Tambahkan ke infra/.env DI VPS (jangan kirim lewat chat):
#      R2_ACCOUNT_ID=...
#      R2_ACCESS_KEY_ID=...
#      R2_SECRET_ACCESS_KEY=...
#      R2_BUCKET=eaip-backups
# 3) Jalankan:  sudo ./scripts/offsite-setup.sh
#
# Script ini: memasang rclone, menulis konfigurasi remote "eaip-r2", membuat passphrase enkripsi
# (bila belum ada), menambahkan BACKUP_REMOTE & BACKUP_PASSPHRASE_FILE ke .env, lalu menguji
# backup → upload → download → dekripsi → validasi.
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; source .env; set +a
: "${R2_ACCOUNT_ID:?isi R2_ACCOUNT_ID di .env}" "${R2_ACCESS_KEY_ID:?isi R2_ACCESS_KEY_ID di .env}" "${R2_SECRET_ACCESS_KEY:?isi R2_SECRET_ACCESS_KEY di .env}" "${R2_BUCKET:?isi R2_BUCKET di .env}"

command -v rclone >/dev/null || { apt-get update -qq && apt-get install -y -qq rclone; }
command -v gpg >/dev/null || { apt-get update -qq && apt-get install -y -qq gnupg; }

CONF_DIR=/root/.config/rclone
mkdir -p "$CONF_DIR" && chmod 700 "$CONF_DIR"
umask 077
# Hapus remote lama dengan nama sama lalu tulis ulang
if [[ -f "$CONF_DIR/rclone.conf" ]]; then
  awk 'BEGIN{skip=0} /^\[eaip-r2\]/{skip=1;next} /^\[/{skip=0} !skip' "$CONF_DIR/rclone.conf" > "$CONF_DIR/rclone.conf.new"
  mv "$CONF_DIR/rclone.conf.new" "$CONF_DIR/rclone.conf"
fi
cat >> "$CONF_DIR/rclone.conf" <<EOF
[eaip-r2]
type = s3
provider = Cloudflare
access_key_id = ${R2_ACCESS_KEY_ID}
secret_access_key = ${R2_SECRET_ACCESS_KEY}
endpoint = https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com
acl = private
no_check_bucket = true
EOF
chmod 600 "$CONF_DIR/rclone.conf"

PASS_FILE=/root/.eaip-backup-passphrase
if [[ ! -f "$PASS_FILE" ]]; then
  openssl rand -base64 48 > "$PASS_FILE"
  chmod 600 "$PASS_FILE"
  NEW_PASS=1
fi

REMOTE="eaip-r2:${R2_BUCKET}/eaip"
grep -q '^BACKUP_REMOTE=' .env && sed -i "s|^BACKUP_REMOTE=.*|BACKUP_REMOTE=${REMOTE}|" .env || echo "BACKUP_REMOTE=${REMOTE}" >> .env
grep -q '^BACKUP_PASSPHRASE_FILE=' .env && sed -i "s|^BACKUP_PASSPHRASE_FILE=.*|BACKUP_PASSPHRASE_FILE=${PASS_FILE}|" .env || echo "BACKUP_PASSPHRASE_FILE=${PASS_FILE}" >> .env

echo "→ uji akses bucket"
rclone lsf "eaip-r2:${R2_BUCKET}" --max-depth 1 >/dev/null

echo "→ backup + upload terenkripsi"
./scripts/backup.sh

echo "→ uji pemulihan dari offsite"
TMP=$(mktemp -d)
LATEST=$(rclone lsf "$REMOTE/" --include 'eaip-*.dump.gpg' | sort | tail -1)
rclone copy "$REMOTE/$LATEST" "$TMP/" --quiet
gpg --batch --yes --pinentry-mode loopback --passphrase-file "$PASS_FILE" --output "$TMP/check.dump" --decrypt "$TMP/$LATEST"
docker compose exec -T postgres pg_restore --list < "$TMP/check.dump" > /dev/null
rm -rf "$TMP"
echo "✓ backup offsite berfungsi: $REMOTE/$LATEST dapat diunduh, didekripsi, dan dibaca"

if [[ "${NEW_PASS:-0}" == 1 ]]; then
  echo
  echo "PENTING: simpan isi $PASS_FILE di tempat aman DI LUAR VPS (password manager)."
  echo "Tanpa passphrase ini, backup offsite tidak bisa dibuka bila VPS hilang."
fi
