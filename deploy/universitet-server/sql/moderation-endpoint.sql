-- Self-hosted: the database calls content-moderation inside the Docker
-- network (http://api-gw:8000) or on the server's own HTTPS domain.
-- Migration 20261112100000_security_audit_fixes.sql already defines exactly
-- this check; re-applying it here only matters for a database that was
-- restored from a dump older than that migration.
alter table private.moderation_webhook_config
  drop constraint if exists moderation_webhook_config_endpoint_check,
  add constraint moderation_webhook_config_endpoint_check check (
    endpoint ~ '^https://[a-z0-9.-]+(:[0-9]+)?/functions/v1/content-moderation$'
    or endpoint ~ '^http://(127\.0\.0\.1|localhost|kong|api-gw)(:[0-9]+)?/functions/v1/content-moderation$');
