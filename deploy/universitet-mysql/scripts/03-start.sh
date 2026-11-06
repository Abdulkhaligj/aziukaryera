#!/usr/bin/env bash
# Starts the stack and points the moderation webhook at this server.
. "$(dirname "$0")/lib.sh"
load_env
step "Servislər"
dc up -d --build

step "Moderasiya webhook-u"
SECRET="$(api_env_get MODERATION_WEBHOOK_SECRET)"
[ ${#SECRET} -ge 32 ] || die "api.env: MODERATION_WEBHOOK_SECRET ən azı 32 simvol olmalıdır."
ENDPOINT="https://$API_DOMAIN/functions/v1/content-moderation"
# SQL on stdin, so the secret is not in the process list.
printf "REPLACE INTO private_moderation_webhook_config (singleton, endpoint, secret, enabled) VALUES (1, '%s', '%s', 1);\n" \
  "$ENDPOINT" "$SECRET" | mysql_app
echo "Webhook: $ENDPOINT"
echo
echo "Növbəti addım: scripts/04-verify.sh"
