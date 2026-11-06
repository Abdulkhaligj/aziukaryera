#!/usr/bin/env bash
# Daily backup: MySQL dump and the storage files, kept for 14 days.
#   crontab: 30 3 * * * /path/to/deploy/universitet-mysql/scripts/backup.sh /srv/backups/asoiu
. "$(dirname "$0")/lib.sh"
load_env
DEST="${1:-$KIT_DIR/backups}"
mkdir -p "$DEST"
stamp="$(date -u +%Y%m%d-%H%M%S)"
dc exec -T -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql mysqldump -uroot --single-transaction --routines --triggers --hex-blob \
  --set-gtid-purged=OFF asoiu_career | gzip > "$DEST/db-$stamp.sql.gz"
dc run --rm -T --no-deps --entrypoint tar api -C /data -czf - storage > "$DEST/storage-$stamp.tar.gz"
find "$DEST" -name 'db-*.sql.gz' -mtime +14 -delete
find "$DEST" -name 'storage-*.tar.gz' -mtime +14 -delete
echo "Backup: $DEST/db-$stamp.sql.gz, $DEST/storage-$stamp.tar.gz"
