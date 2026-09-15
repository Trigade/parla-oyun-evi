#!/bin/sh
# Parla Oyun Evi - üretim veritabanı yedek servisi (docker-compose.prod.yml -> backup).
# Her gün BACKUP_TIME (SSDD, TZ saat dilimine göre) anında pg_dump alır,
# BACKUP_KEEP_DAYS günden eski yedekleri siler. Bağlantı bilgileri PG* ortam
# değişkenlerinden okunur.
set -eu

KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
BACKUP_TIME="${BACKUP_TIME:-0300}"
mkdir -p /backups

yedek_al() {
	dosya="/backups/parla_oyun_evi_$(date +%Y-%m-%d_%H%M%S).dump"
	if pg_dump --format=custom --file="$dosya.tmp"; then
		mv "$dosya.tmp" "$dosya"
		echo "$(date '+%F %T') yedek alındı: $dosya"
	else
		rm -f "$dosya.tmp"
		echo "$(date '+%F %T') HATA: yedek alınamadı" >&2
	fi
	find /backups -name 'parla_oyun_evi_*.dump' -mtime +"$KEEP_DAYS" -delete
}

if [ "${1:-}" = "now" ]; then
	yedek_al
	exit 0
fi

echo "yedek servisi başladı: her gün $BACKUP_TIME (TZ=${TZ:-UTC}), $KEEP_DAYS gün saklama"
son_gun=""
while true; do
	bugun="$(date +%Y-%m-%d)"
	if [ "$(date +%H%M)" = "$BACKUP_TIME" ] && [ "$son_gun" != "$bugun" ]; then
		yedek_al
		son_gun="$bugun"
	fi
	sleep 30
done
