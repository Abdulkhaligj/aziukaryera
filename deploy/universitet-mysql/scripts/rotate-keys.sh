#!/usr/bin/env bash
# Replaces the JWT secret and the anon / service_role keys (audit 2026-11-13,
# M-08). The keys live two years; 04-verify.sh and the API log warn a month
# before they expire. Signed-in users stay signed in: their next refresh
# returns a token signed with the new secret.
#   deploy/universitet-mysql/scripts/rotate-keys.sh
. "$(dirname "$0")/lib.sh"
load_env
step "Yeni JWT secret və açarlar"
cp "$KIT_DIR/api.env" "$KIT_DIR/api.env.before-rotate"
chmod 600 "$KIT_DIR/api.env.before-rotate"
keys="$(dc run --rm --no-deps -T -e JWT_SECRET= api node server/tools/generate-keys.mjs)"
for k in JWT_SECRET ANON_KEY SERVICE_ROLE_KEY; do
  env_set "$KIT_DIR/api.env" "$k" "$(printf '%s\n' "$keys" | awk -v k="$k" 'index($0, k"=")==1 { print substr($0, length(k)+2) }')"
done
step "API yenidən başladılır"
dc up -d --force-recreate api
echo
echo "Hazırdır. Əvvəlki api.env: $KIT_DIR/api.env.before-rotate (yoxlamadan sonra silin)."
echo "İndi yeni ANON_KEY (api.env) bu iki yerə yazılmalıdır:"
echo "  1. student-web/assets/js/runtime-config.js → apiKey, sonra commit və push."
echo "  2. Vercel → admin panel → NEXT_PUBLIC_API_KEY (Production), sonra redeploy."
echo "Köhnə açar artıq qəbul edilmir; bu iki addım bitənə qədər saytlar API-yə qoşula bilmir."
