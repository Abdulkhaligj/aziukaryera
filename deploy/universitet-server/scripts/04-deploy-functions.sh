#!/usr/bin/env bash
# Copies the project's Edge Functions next to the official `main` router and
# restarts the functions container so it reads the new code and secrets.
source "$(dirname "$0")/lib.sh"
load_kit_env

src="$REPO_DIR/supabase/functions"
dst="$SUPABASE_DIR/volumes/functions"
[ -d "$dst/main" ] || die "$dst/main tapılmadı: rəsmi self-hosted qovluğu deyil?"

step "Funksiyalar köçürülür"
for fn in _shared admin-assistant admin-users aida-chat career-ai content-moderation; do
  [ -d "$src/$fn" ] || die "$src/$fn yoxdur."
  rm -rf "${dst:?}/$fn"
  cp -R "$src/$fn" "$dst/$fn"
  echo "  $fn"
done

step "Funksiyalar konteyneri yenidən yaradılır"
dc up -d --force-recreate functions
wait_healthy "supabase-edge-functions" 300
step "Hazırdır. Növbəti addım: scripts/05-configure-db.sh"
