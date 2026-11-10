# Deploy mode "Nginx di depan"

Dipakai bila VPS sudah menjalankan Nginx untuk situs lain (contoh: VPS produksi `47.236.228.31`).
Konfigurasi situs lain **tidak disentuh** — EAIP hanya menambah `/etc/nginx/conf.d/eaip.conf`.

## Pemasangan pertama

```bash
# di VPS, sebagai root
cd /opt/eaip/infra
cp .env.example .env && chmod 600 .env        # isi semua nilai (secret: openssl rand -hex 24)
docker compose -f compose.yaml -f compose.nginx.yaml --env-file .env up -d --build
./scripts/nginx-setup.sh                       # sertifikat Let's Encrypt + server block admin/trk/pb
(crontab -l; echo "30 2 * * * /opt/eaip/infra/scripts/backup.sh >> /var/log/eaip-backup.log 2>&1") | crontab -
```

## Update versi

Dari komputer pengembang (repo lokal), kirim commit yang sudah lulus pengujian:

```bash
git archive --format=tar <commit> | ssh root@VPS "tar -x -C /opt/eaip && echo <commit> > /opt/eaip/DEPLOYED_COMMIT"
ssh root@VPS "cd /opt/eaip/infra && ./scripts/backup.sh && docker compose -f compose.yaml -f compose.nginx.yaml --env-file .env up -d --build"
```

`.env` di VPS tidak ikut terkirim/tertimpa (tidak ada di repo).

## Batasan mode ini

- Domain tracking kustom (`go.brand.com`) bisa didaftarkan & diverifikasi DNS-nya, tetapi **sertifikat HTTPS-nya belum otomatis** (on-demand TLS hanya ada di mode Caddy). Sampai dimigrasi ke Caddy, tambahkan server block + `certbot certonly --webroot` per domain secara manual.
- Rollback Nginx: backup konfigurasi sebelum pemasangan ada di `/root/nginx-backup-*.tar.gz`; menonaktifkan EAIP cukup `mv /etc/nginx/conf.d/eaip.conf /root/ && systemctl reload nginx`.
