#!/usr/bin/env bash
# First install: passwords and keys, image build, MySQL, schema and migrations.
#   scripts/01-init.sh api.career.asoiu.edu.az
. "$(dirname "$0")/lib.sh"
DOMAIN="${1:-}"
command -v docker >/dev/null || die "Docker quraşdırılmayıb."
docker compose version >/dev/null || die "Docker Compose plugin yoxdur."

step "kit.env və api.env"
if [ ! -f "$KIT_DIR/kit.env" ]; then
  [ -n "$DOMAIN" ] || die "Domen lazımdır: scripts/01-init.sh api.career.asoiu.edu.az"
  cp "$KIT_DIR/kit.env.example" "$KIT_DIR/kit.env"
  env_set "$KIT_DIR/kit.env" API_DOMAIN "$DOMAIN"
  env_set "$KIT_DIR/kit.env" MYSQL_ROOT_PASSWORD "$(random 32)"
  env_set "$KIT_DIR/kit.env" MYSQL_PASSWORD "$(random 32)"
  chmod 600 "$KIT_DIR/kit.env"
fi
[ -f "$KIT_DIR/api.env" ] || { cp "$KIT_DIR/api.env.example" "$KIT_DIR/api.env"; chmod 600 "$KIT_DIR/api.env"; }
load_env

step "API imici"
dc build api

if [ -z "$(api_env_get JWT_SECRET)" ]; then
  step "JWT secret və açarlar"
  keys="$(dc run --rm --no-deps -T api node server/tools/generate-keys.mjs)"
  for k in JWT_SECRET ANON_KEY SERVICE_ROLE_KEY; do
    env_set "$KIT_DIR/api.env" "$k" "$(printf '%s\n' "$keys" | awk -v k="$k" 'index($0, k"=")==1 { print substr($0, length(k)+2) }')"
  done
fi
[ -n "$(api_env_get MODERATION_WEBHOOK_SECRET)" ] || env_set "$KIT_DIR/api.env" MODERATION_WEBHOOK_SECRET "$(random 48)"

step "MySQL"
dc up -d mysql
dc run --rm -T api node server/db/setup.mjs

echo
echo "Hazırdır. Növbəti addım: scripts/02-import.sh (Supabase-dən data və fayllar)."
echo "api.env-də SMTP_* və GEMINI_API_KEY dəyərlərini doldurun."
