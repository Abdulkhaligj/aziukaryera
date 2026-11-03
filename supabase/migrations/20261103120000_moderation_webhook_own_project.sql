-- This deployment runs on project ttfsbgbhyomfheglefkn itself, so its own
-- content-moderation function is the correct webhook endpoint. The exclusion
-- added in ai_reservations kept other environments replaying migrations from
-- calling this project; an operator still provisions the endpoint row and its
-- secret per environment, out of band and never in Git.
begin;

alter table private.moderation_webhook_config
  drop constraint moderation_webhook_config_endpoint_check,
  add constraint moderation_webhook_config_endpoint_check
    check (endpoint ~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/content-moderation$');

commit;
