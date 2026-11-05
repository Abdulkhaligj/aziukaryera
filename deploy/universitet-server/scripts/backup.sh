#!/usr/bin/env bash
# Daily backup: full database dump (all schemas, auth users included) and the
# Storage files. Keeps the last BACKUP_DAYS days. Example cron line:
#   30 2 * * *  /opt/asoiu-career/deploy/universitet-server/scripts/backup.sh >> /var/log/asoiu-backup.log 2>&1
source "$(dirname "$0")/lib.sh"
load_kit_env

target="${BACKUP_DIR:-/var/backups/asoiu-career}"
keep="${BACKUP_DAYS:-14}"
stamp="$(date +%F-%H%M)"
mkdir -p "$target"
chmod 700 "$target"
umask 077

docker exec supabase-db pg_dump -U postgres -d postgres -Fc > "$target/db-$stamp.dump"
tar -C "$SUPABASE_DIR/volumes" -czf "$target/storage-$stamp.tar.gz" storage
find "$target" -type f \( -name 'db-*.dump' -o -name 'storage-*.tar.gz' \) -mtime "+$keep" -delete
echo "$(date '+%F %T') backup: $target/db-$stamp.dump, $target/storage-$stamp.tar.gz"
