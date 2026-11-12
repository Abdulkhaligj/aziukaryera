#!/usr/bin/env bash
# Daily backup: MySQL dump and the storage files, kept for 14 days.
#   crontab: 30 3 * * * /path/to/deploy/universitet-mysql/scripts/backup.sh /srv/backups/asoiu
# With BACKUP_KEY_FILE (kit.env) both files are encrypted (AES-256, PBKDF2)
# before they touch the disk; with BACKUP_REMOTE they are also copied off-host.
. "$(dirname "$0")/lib.sh"
load_env
DEST="${1:-$KIT_DIR/backups}"
umask 077
mkdir -p "$DEST"
chmod 700 "$DEST"
stamp="$(date -u +%Y%m%d-%H%M%S)"
key="${BACKUP_KEY_FILE:-}"
if [ -n "$key" ]; then
  [ -r "$key" ] || die "BACKUP_KEY_FILE oxunmur: $key"
  [ "$(wc -c < "$key")" -ge 32 ] || die "BACKUP_KEY_FILE çox qısadır (ən azı 32 simvol)."
  seal() { openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$key" -out "$1"; }
  ext=".enc"
else
  seal() { cat > "$1"; }
  ext=""
  echo "XƏBƏRDARLIQ: BACKUP_KEY_FILE boşdur — nüsxələr şifrələnmədən yazılır."
fi
db="$DEST/db-$stamp.sql.gz$ext"
files="$DEST/storage-$stamp.tar.gz$ext"
# Temporary names first: a failed run never leaves a file that looks complete.
dc exec -T -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql mysqldump -uroot --single-transaction --routines --triggers --hex-blob \
  --set-gtid-purged=OFF asoiu_career | gzip | seal "$db.part"
dc run --rm -T --no-deps --entrypoint tar api -C /data -czf - storage | seal "$files.part"
mv "$db.part" "$db"
mv "$files.part" "$files"
find "$DEST" -name 'db-*.sql.gz*' -mtime +14 -delete
find "$DEST" -name 'storage-*.tar.gz*' -mtime +14 -delete
echo "Backup: $db, $files"
if [ -n "${BACKUP_REMOTE:-}" ]; then
  rsync -a "$db" "$files" "$BACKUP_REMOTE/"
  echo "Off-host copy: $BACKUP_REMOTE"
fi
