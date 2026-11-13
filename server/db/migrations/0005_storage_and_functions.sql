-- Object names are case-sensitive in Postgres and on the server's disk, so
-- the keys that hold them compare byte for byte.
ALTER TABLE `storage_objects` MODIFY `name` VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;
ALTER TABLE `private_avatar_generations` MODIFY `path` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

-- The moderation webhook now targets this API's own Edge Function route
-- (https://<api host>/functions/v1/content-moderation; http only for loopback).
-- Every statement can run again (audit 2026-11-13, #72): the check is replaced
-- only while it is not the new one yet.
SET @s = IF((SELECT COUNT(*) FROM information_schema.check_constraints WHERE constraint_schema = DATABASE()
    AND constraint_name = 'moderation_webhook_config_endpoint_check' AND check_clause LIKE '%functions/v1/content-moderation%') = 0
    AND (SELECT COUNT(*) FROM information_schema.check_constraints WHERE constraint_schema = DATABASE()
    AND constraint_name = 'moderation_webhook_config_endpoint_check') = 1,
  'ALTER TABLE `private_moderation_webhook_config` DROP CHECK `moderation_webhook_config_endpoint_check`', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.check_constraints WHERE constraint_schema = DATABASE()
    AND constraint_name = 'moderation_webhook_config_endpoint_check') = 0,
  'ALTER TABLE `private_moderation_webhook_config` ADD CONSTRAINT `moderation_webhook_config_endpoint_check` CHECK (REGEXP_LIKE(`endpoint`, ''^(https://[a-z0-9.-]+(:[0-9]+)?|http://(127\\\\.0\\\\.0\\\\.1|localhost)(:[0-9]+)?)/functions/v1/content-moderation$'', ''c''))', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
