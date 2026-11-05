#!/usr/bin/env bash
# Copies Storage files (profile photos, public media) to the new server.
# Runs Node in a container on the Supabase network, so it reaches the API
# gateway directly (the Caddy proxy removes the gateway's host port).
source "$(dirname "$0")/lib.sh"
load_kit_env
require CLOUD_URL CLOUD_SERVICE_ROLE_KEY

network="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' supabase-db | awk '{print $1}')"
[ -n "$network" ] || die "supabase-db konteynerinin şəbəkəsi tapılmadı. Servislər işləyirmi?"

step "Avatar generasiya qeydləri sıfırlanır (fayllar eyni yolla yenidən yüklənəcək)"
db_psql -q < "$KIT_DIR/sql/before-storage-copy.sql"

step "Fayllar köçürülür"
SRC_URL="$CLOUD_URL" SRC_KEY="$CLOUD_SERVICE_ROLE_KEY" \
DST_URL="http://api-gw:8000" DST_KEY="$(env_get SERVICE_ROLE_KEY)" \
  docker run --rm --network "$network" -e SRC_URL -e SRC_KEY -e DST_URL -e DST_KEY \
    -v "$KIT_DIR/scripts/copy-storage.mjs:/copy-storage.mjs:ro" node:20-alpine node /copy-storage.mjs

step "storage sayları müqayisə olunur"
db_psql -At -F " " < "$KIT_DIR/sql/counts.sql" > "$DUMP_DIR/counts-new.txt"
if diff <(grep '^storage' "$DUMP_DIR/counts-cloud.txt") <(grep '^storage' "$DUMP_DIR/counts-new.txt"); then
  echo "Storage sayları eynidir."
else
  die "Storage sayları fərqlidir."
fi
step "Hazırdır. Növbəti addım: scripts/04-deploy-functions.sh"
