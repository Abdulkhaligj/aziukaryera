#!/usr/bin/env bash
# Dumps roles, schema and data (auth users, storage metadata, cron jobs
# included) from the cloud project, using Supabase's documented procedure.
source "$(dirname "$0")/lib.sh"
load_kit_env
require CLOUD_DB_URL
command -v supabase >/dev/null || die "Supabase CLI tapılmadı (README → 3.2)."

mkdir -p "$DUMP_DIR"
chmod 700 "$DUMP_DIR"
umask 077

step "Rollar"
supabase db dump --db-url "$CLOUD_DB_URL" -f "$DUMP_DIR/roles.sql" --role-only
step "Sxem"
supabase db dump --db-url "$CLOUD_DB_URL" -f "$DUMP_DIR/schema.sql"
step "Data"
supabase db dump --db-url "$CLOUD_DB_URL" -f "$DUMP_DIR/data.sql" --use-copy --data-only

step "Buluddakı sətir sayları"
DBURL="$CLOUD_DB_URL" docker run --rm -i -e DBURL "$PG_IMAGE" \
  sh -c 'psql "$DBURL" -v ON_ERROR_STOP=1 -At -F " " -f -' < "$KIT_DIR/sql/counts.sql" > "$DUMP_DIR/counts-cloud.txt"
cat "$DUMP_DIR/counts-cloud.txt"
ls -la "$DUMP_DIR"
step "Hazırdır. Növbəti addım: scripts/02-import.sh"
