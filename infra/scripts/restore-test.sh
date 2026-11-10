#!/usr/bin/env bash
# Uji restore TANPA menyentuh produksi (read.md 17.10): backup terbaru dipulihkan ke container
# PostgreSQL sementara, lalu jumlah baris tiap tabel dibandingkan dengan database produksi.
#   ./scripts/restore-test.sh [file.dump]      (default: backup terbaru di backups/)
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; source .env; set +a

FILE="${1:-$(ls -t backups/eaip-*.dump 2>/dev/null | head -1)}"
[[ -n "$FILE" && -f "$FILE" ]] || { echo "Tidak ada file backup. Jalankan scripts/backup.sh dulu."; exit 1; }
if [[ "$FILE" == *.gpg ]]; then echo "File terenkripsi: dekripsi dulu sebelum uji restore."; exit 1; fi

NAME="eaip-restore-test-$$"
# Pakai image yang sama dengan container produksi
PG_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$(docker compose ps -q postgres 2>/dev/null)" 2>/dev/null || true)"
PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "→ backup: $FILE ($(du -h "$FILE" | cut -f1))"
echo "→ container sementara: $NAME ($PG_IMAGE, tanpa port & tanpa volume)"
docker run -d --rm --name "$NAME" --network none -e POSTGRES_PASSWORD=restoretest -e POSTGRES_DB=restore "$PG_IMAGE" >/dev/null
for _ in $(seq 1 60); do docker exec "$NAME" pg_isready -U postgres -d restore >/dev/null 2>&1 && break; sleep 1; done

START=$(date +%s)
docker exec -i "$NAME" pg_restore -U postgres -d restore --no-owner --exit-on-error < "$FILE"
echo "✓ restore selesai dalam $(( $(date +%s) - START )) detik"

exact_counts() {
  # hitung tepat (bukan statistik) untuk setiap tabel publik
  docker exec -i "$1" psql -U "$2" -d "$3" -At -c \
    "SELECT string_agg(format('SELECT %L AS t, count(*) FROM %I', tablename, tablename), ' UNION ALL ' ORDER BY tablename) FROM pg_tables WHERE schemaname='public'" \
    | docker exec -i "$1" psql -U "$2" -d "$3" -At -F ' '
}
PROD=$(exact_counts "$(docker compose ps -q postgres)" "$POSTGRES_USER" "$POSTGRES_DB" | sort)
RESTORED=$(exact_counts "$NAME" postgres restore | sort)

TABLES=$(echo "$RESTORED" | wc -l)
DIFF=$(diff <(echo "$PROD") <(echo "$RESTORED") || true)
echo "→ $TABLES tabel dibandingkan"
if [[ -z "$DIFF" ]]; then
  echo "✓ isi hasil restore SAMA dengan produksi (jumlah baris tiap tabel)"
else
  echo "Perbedaan (wajar bila ada data baru masuk setelah backup dibuat):"
  echo "$DIFF" | sed 's/^/   /'
fi
MIG=$(docker exec -i "$NAME" psql -U postgres -d restore -At -c "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL")
echo "✓ migrasi tercatat di hasil restore: $MIG"
echo "$(date -u +%FT%TZ) restore-test OK file=$(basename "$FILE") tables=$TABLES" >> backups/restore-tests.log
