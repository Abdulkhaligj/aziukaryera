#!/usr/bin/env bash
# Restores the cloud dump into a fresh self-hosted database in one transaction.
# Run it on an empty database only (see README → reset).
source "$(dirname "$0")/lib.sh"
load_kit_env
for f in roles schema data; do [ -s "$DUMP_DIR/$f.sql" ] || die "$DUMP_DIR/$f.sql yoxdur: əvvəlcə 01-export-cloud.sh."; done

step "Servislər işə salınır (auth və storage öz cədvəllərini ilk dəfə yaradır)"
dc up -d
wait_healthy "supabase-db supabase-auth supabase-storage" 600

step "Boş baza olduğu yoxlanılır"
existing="$(db_psql -At -c "select count(*) from auth.users")"
[ "$existing" = 0 ] || die "Bazada artıq $existing istifadəçi var. Təkrar import üçün README → 'Bazanı sıfırlamaq'."

step "Data yüklənir (tək tranzaksiya: xəta olarsa heç nə yazılmır)"
{
  cat "$DUMP_DIR/roles.sql" "$DUMP_DIR/schema.sql"
  echo 'SET session_replication_role = replica;'
  cat "$DUMP_DIR/data.sql"
} | db_psql --single-transaction -q

step "Sətir sayları müqayisə olunur"
db_psql -At -F " " < "$KIT_DIR/sql/counts.sql" > "$DUMP_DIR/counts-new.txt"
if diff "$DUMP_DIR/counts-cloud.txt" "$DUMP_DIR/counts-new.txt"; then
  echo "Bütün saylar buludla eynidir."
else
  die "Saylar fərqlidir (yuxarıdakı diff). Davam etməyin."
fi

step "Servislər yenidən başladılır"
dc restart
wait_healthy "supabase-db supabase-auth supabase-storage supabase-rest" 600
step "Hazırdır. Növbəti addım: scripts/03-copy-storage.sh"
