#!/usr/bin/env bash
# Daily backup: full database dump (all schemas, auth users included) and the
# Storage files. Keeps the last BACKUP_DAYS days. Example cron line:
#   30 2 * * *  /opt/asoiu-career/deploy/universitet-server/scripts/backup.sh >> /var/log/asoiu-backup.log 2>&1
# With BACKUP_KEY_FILE set, both files are encrypted (AES-256, PBKDF2) before
# they touch the disk. With BACKUP_REMOTE set, they are also copied off-host.
source "$(dirname "$0")/lib.sh"
load_kit_env

target="${BACKUP_DIR:-/var/backups/asoiu-career}"
keep="${BACKUP_DAYS:-14}"
key="${BACKUP_KEY_FILE:-}"
stamp="$(date +%F-%H%M)"
mkdir -p "$target"
chmod 700 "$target"
umask 077

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

db="$target/db-$stamp.dump$ext"
files="$target/storage-$stamp.tar.gz$ext"
# Write to a temporary name first: a failed run never leaves a file that looks complete.
docker exec supabase-db pg_dump -U postgres -d postgres -Fc | seal "$db.part"
tar -C "$SUPABASE_DIR/volumes" -czf - storage | seal "$files.part"
mv "$db.part" "$db"
mv "$files.part" "$files"

find "$target" -type f \( -name 'db-*.dump*' -o -name 'storage-*.tar.gz*' \) -mtime "+$keep" -delete
echo "$(date '+%F %T') backup: $db, $files"

if [ -n "${BACKUP_REMOTE:-}" ]; then
  rsync -a "$db" "$files" "$BACKUP_REMOTE/"
  echo "$(date '+%F %T') copied to $BACKUP_REMOTE"
fi
