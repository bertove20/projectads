#!/usr/bin/env bash
# Pasang/perbarui server block Nginx untuk EAIP (mode "Nginx di depan") + sertifikat Let's Encrypt.
# Tidak menyentuh konfigurasi situs lain: hanya menulis /etc/nginx/conf.d/eaip.conf.
#   sudo ./scripts/nginx-setup.sh            (dijalankan dari folder infra/, membaca .env)
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; source .env; set +a
: "${ADMIN_DOMAIN:?}" "${TRACKER_DOMAIN:?}" "${POSTBACK_DOMAIN:?}" "${ACME_EMAIL:?}"

CONF=/etc/nginx/conf.d/eaip.conf
WEBROOT=/var/www/eaip-acme
mkdir -p "$WEBROOT"

command -v certbot >/dev/null || { apt-get update -qq && apt-get install -y -qq certbot; }

reload_nginx() { nginx -t && systemctl reload nginx; }

# 1) Belum ada sertifikat → pasang blok HTTP saja untuk tantangan ACME
if [[ ! -f "/etc/letsencrypt/live/${ADMIN_DOMAIN}/fullchain.pem" ]]; then
  cat > "$CONF" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${ADMIN_DOMAIN} ${TRACKER_DOMAIN} ${POSTBACK_DOMAIN};
    location ^~ /.well-known/acme-challenge/ { root ${WEBROOT}; default_type text/plain; }
    location / { return 503; }
}
EOF
  reload_nginx
  certbot certonly --webroot -w "$WEBROOT" --non-interactive --agree-tos -m "$ACME_EMAIL" \
    --cert-name "$ADMIN_DOMAIN" -d "$ADMIN_DOMAIN" -d "$TRACKER_DOMAIN" -d "$POSTBACK_DOMAIN"
fi

# 2) Konfigurasi lengkap (HTTPS) dari template
envsubst '${ADMIN_DOMAIN} ${TRACKER_DOMAIN} ${POSTBACK_DOMAIN}' < nginx/eaip.conf.template > "$CONF.new"
mv "$CONF.new" "$CONF"
if ! nginx -t; then
  echo "Konfigurasi Nginx tidak valid — eaip.conf dinonaktifkan agar situs lain tetap berjalan" >&2
  mv "$CONF" "$CONF.invalid"
  exit 1
fi
systemctl reload nginx

# 3) Perpanjangan otomatis: certbot.timer bawaan + reload Nginx setelah sertifikat baru
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nsystemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
echo "✓ Nginx EAIP aktif untuk ${ADMIN_DOMAIN}, ${TRACKER_DOMAIN}, ${POSTBACK_DOMAIN}"
