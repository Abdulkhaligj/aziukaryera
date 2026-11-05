-- Self-hosted: the database calls content-moderation inside the Docker
-- network (http://api-gw:8000) or on the server's own HTTPS domain. Keep the
-- path check, allow those hosts. Commit this as a migration at cutover.
alter table private.moderation_webhook_config
  drop constraint if exists moderation_webhook_config_endpoint_check,
  add constraint moderation_webhook_config_endpoint_check
    check (endpoint ~ '^(https://[a-z0-9.-]+|http://api-gw:8000)/functions/v1/content-moderation$');
