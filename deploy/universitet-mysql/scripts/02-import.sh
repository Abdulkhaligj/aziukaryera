#!/usr/bin/env bash
# Moves the data (with password hashes) and the files from the final backup of
# the old database into MySQL. The old database was shut down on 2026-11-12;
# everything it held is in that backup folder:
#   full.dump            pg_dump (custom format) of the public, private, auth and storage schemas
#   storage/<bucket>/…   every stored file
# Needs, in the environment:
#   IMPORT_BACKUP_DIR    path to that folder on this server
. "$(dirname "$0")/lib.sh"
load_env
[ -n "${IMPORT_BACKUP_DIR:-}" ] || die "IMPORT_BACKUP_DIR lazımdır: full.dump və storage/ olan qovluq."
IMPORT_BACKUP_DIR="$(cd "$IMPORT_BACKUP_DIR" && pwd)" || die "IMPORT_BACKUP_DIR tapılmadı."
[ -f "$IMPORT_BACKUP_DIR/full.dump" ] || die "$IMPORT_BACKUP_DIR/full.dump yoxdur."
[ -d "$IMPORT_BACKUP_DIR/storage" ] || die "$IMPORT_BACKUP_DIR/storage qovluğu yoxdur."
export IMPORT_BACKUP_DIR

# A throwaway Postgres reads the backup; it is removed at the end, also on errors.
export PGRESTORE_PASSWORD="$(random 32)"
cleanup() { dc --profile import rm -sf pgrestore >/dev/null 2>&1 || true; }
trap cleanup EXIT

step "Ehtiyat nüsxə müvəqqəti Postgres-ə yüklənir"
dc --profile import up -d pgrestore
for _ in $(seq 1 60); do dc exec -T pgrestore pg_isready -U postgres -q && break; sleep 2; done
dc exec -T pgrestore pg_isready -U postgres -q || die "Müvəqqəti Postgres başlamadı."
# Roles and extensions the dump refers to, so every table, view and index restores.
dc exec -T pgrestore psql -q -U postgres -v ON_ERROR_STOP=1 -c "
  do \$\$ declare r text; begin
    foreach r in array array['anon','authenticated','service_role'] loop
      if not exists (select 1 from pg_roles where rolname = r) then execute format('create role %I', r); end if;
    end loop; end \$\$;
  create schema if not exists extensions;
  create extension if not exists pgcrypto with schema extensions;
  create extension if not exists \"uuid-ossp\" with schema extensions;
  create extension if not exists btree_gist with schema extensions;"
# "schema public already exists" is the one expected message; the row-count
# check of the import below catches anything that did not restore.
dc exec -T pgrestore pg_restore -U postgres -d postgres --no-owner --no-privileges /backup/full.dump || true

step "Sxem yenidən qurulur (boş baza)"
dc stop api >/dev/null 2>&1 || true
# As root (dropping the database needs it); the password goes through the environment.
ROOT="$MYSQL_ROOT_PASSWORD" dc run --rm -T -e ALLOW_RESET=1 -e ROOT api \
  sh -c 'MYSQL_URL="mysql://root:$ROOT@mysql:3306/asoiu_career" node server/db/setup.mjs --reset'
# The API's account gets rows and functions only, not the schema (#55).
app_grants

step "Data (sətir sayları və xarici açarlar yoxlanılır)"
export SOURCE_DB_URL="postgresql://postgres:${PGRESTORE_PASSWORD}@pgrestore:5432/postgres"
dc run --rm -T -e SOURCE_DB_URL api node server/db/import-from-backup.mjs

step "Fayllar"
dc run --rm -T -v "$IMPORT_BACKUP_DIR/storage:/backup-storage:ro" -e STORAGE_SOURCE_DIR=/backup-storage \
  api node server/db/import-storage-files.mjs

echo
echo "Köçürüldü. Növbəti addım: scripts/03-start.sh"
