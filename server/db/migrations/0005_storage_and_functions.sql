-- Object names are case-sensitive in Postgres and on the server's disk, so
-- the keys that hold them compare byte for byte.
ALTER TABLE `storage_objects` MODIFY `name` VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;
ALTER TABLE `private_avatar_generations` MODIFY `path` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

-- The moderation webhook now targets this API's own Edge Function route
-- (https://<api host>/functions/v1/content-moderation; http only for loopback).
ALTER TABLE `private_moderation_webhook_config` DROP CHECK `moderation_webhook_config_endpoint_check`;
ALTER TABLE `private_moderation_webhook_config` ADD CONSTRAINT `moderation_webhook_config_endpoint_check`
  CHECK (REGEXP_LIKE(`endpoint`, '^(https://[a-z0-9.-]+(:[0-9]+)?|http://(127\\.0\\.0\\.1|localhost)(:[0-9]+)?)/functions/v1/content-moderation$', 'c'));
