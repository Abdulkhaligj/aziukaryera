#!/usr/bin/env bash
# Points content moderation at this server and makes sure the scheduled jobs
# exist. The webhook secret is piped to psql, never passed as an argument.
source "$(dirname "$0")/lib.sh"
load_kit_env

secret="$(env_get MODERATION_WEBHOOK_SECRET)"
[ "${#secret}" -ge 32 ] || die ".env: MODERATION_WEBHOOK_SECRET yoxdur: əvvəlcə 00-prepare-server.sh."
case "$secret" in *[!0-9a-f]*) die "MODERATION_WEBHOOK_SECRET yalnız hex simvollardan ibarət olmalıdır." ;; esac

step "Moderasiya webhook-u bu serverə yönəldilir"
{
  cat "$KIT_DIR/sql/moderation-endpoint.sql"
  printf "insert into private.moderation_webhook_config(singleton, endpoint, secret, enabled)
values (true, 'http://api-gw:8000/functions/v1/content-moderation', '%s', true)
on conflict (singleton) do update
  set endpoint = excluded.endpoint, secret = excluded.secret, enabled = true;\n" "$secret"
} | db_psql --single-transaction -q

step "Planlı işlər (cron) yoxlanılır"
db_psql -q <<'SQL'
select cron.schedule('subscription-lifecycle', '7 * * * *', 'select private.process_subscription_lifecycle()');
select cron.schedule('content-moderation-retry', '* * * * *', 'select private.moderation_retry()');
select cron.schedule('avatar-moderation-retry', '* * * * *', 'select private.avatar_moderation_retry()');
SQL
db_psql -At -c "select jobname || '  ' || schedule || '  ' || command from cron.job order by jobid"
step "Hazırdır. Növbəti addım: scripts/06-verify.sh"
