#!/usr/bin/env bash
# Copies the data (with password hashes) and the storage files from Supabase.
# Needs, in the environment (not in a file in the repo):
#   SOURCE_DB_URL              Supabase → Connect → Session pooler connection string
#   SUPABASE_URL               https://<ref>.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY  Supabase service_role / secret key
. "$(dirname "$0")/lib.sh"
load_env
[ -n "${SOURCE_DB_URL:-}" ] || die "SOURCE_DB_URL lazımdır."
[ -n "${SUPABASE_URL:-}" ] || die "SUPABASE_URL lazımdır."
[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] || die "SUPABASE_SERVICE_ROLE_KEY lazımdır."

step "Sxem yenidən qurulur (boş baza)"
dc stop api >/dev/null 2>&1 || true
# As root (dropping the database needs it); the password goes through the environment.
ROOT="$MYSQL_ROOT_PASSWORD" dc run --rm -T -e ALLOW_RESET=1 -e ROOT api \
  sh -c 'MYSQL_URL="mysql://root:$ROOT@mysql:3306/asoiu_career" node server/db/setup.mjs --reset'
dc exec -T -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql mysql -uroot -e "GRANT ALL ON asoiu_career.* TO 'asoiu'@'%'; FLUSH PRIVILEGES;"

step "Data (sətir sayları və xarici açarlar yoxlanılır)"
dc run --rm -T -e SOURCE_DB_URL api node server/db/import-from-supabase.mjs

step "Fayllar"
dc run --rm -T -e SUPABASE_URL -e SUPABASE_SERVICE_ROLE_KEY api node server/db/import-storage-files.mjs

echo
echo "Köçürüldü. Növbəti addım: scripts/03-start.sh"
