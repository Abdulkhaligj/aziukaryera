#!/usr/bin/env bash
# Starts the stack and points the moderation webhook at this server.
. "$(dirname "$0")/lib.sh"
load_env
case "$(api_env_get ENABLE_EMAIL_AUTOCONFIRM)" in
  false|'') [ -n "$(api_env_get SMTP_HOST)" ] || die "api.env: e-poçt təsdiqi aktivdir, amma SMTP_HOST boşdur. SMTP_* dəyərlərini doldurun." ;;
  true) echo "XƏBƏRDARLIQ: ENABLE_EMAIL_AUTOCONFIRM=true — e-poçt təsdiqsiz qeydiyyat. Yalnız sınaq üçün." ;;
  *) die "api.env: ENABLE_EMAIL_AUTOCONFIRM true və ya false olmalıdır." ;;
esac
step "Servislər"
dc up -d --build mysql
for _ in $(seq 1 60); do [ "$(docker inspect -f '{{.State.Health.Status}}' "$(dc ps -q mysql)" 2>/dev/null)" = healthy ] && break; sleep 2; done
# New migrations of an update are applied as root before the API starts (#55, #72).
step "Migration-lar"
migrate
dc up -d --build

step "Moderasiya webhook-u"
SECRET="$(api_env_get MODERATION_WEBHOOK_SECRET)"
[ ${#SECRET} -ge 32 ] || die "api.env: MODERATION_WEBHOOK_SECRET ən azı 32 simvol olmalıdır."
ENDPOINT="https://$API_DOMAIN/functions/v1/content-moderation"
# The secret lives only in api.env (the API reads it from there); the table
# keeps the endpoint and an empty secret (audit 2026-11-13, #73).
printf "REPLACE INTO private_moderation_webhook_config (singleton, endpoint, secret, enabled) VALUES (1, '%s', '', 1);\n" \
  "$ENDPOINT" | mysql_app
echo "Webhook: $ENDPOINT"
echo
echo "Növbəti addım: scripts/04-verify.sh"
