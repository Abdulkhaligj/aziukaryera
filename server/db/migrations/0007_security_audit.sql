-- Security audit of 2026-11-13. Every statement can run again: columns,
-- indexes and keys are only added or changed when they are not there yet (#72).
-- Rollback: restore the backup taken before the upgrade (deploy/universitet-mysql/README.md §6).

-- #15: a session opened by a password-recovery link may only set a new password.
SET @s = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE()
    AND table_name = 'auth_sessions' AND column_name = 'restricted') = 0,
  'ALTER TABLE `auth_sessions` ADD COLUMN `restricted` TINYINT(1) NOT NULL DEFAULT 0', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- #52: when the user agreed that their texts may be sent to the AI providers.
SET @s = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE()
    AND table_name = 'profiles' AND column_name = 'ai_consent_at') = 0,
  'ALTER TABLE `profiles` ADD COLUMN `ai_consent_at` DATETIME(6) NULL', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- #73: claim codes are stored encrypted; they are found by their SHA-256.
SET @s = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE()
    AND table_name = 'benefit_claims' AND column_name = 'code_hash') = 0,
  'ALTER TABLE `benefit_claims` ADD COLUMN `code_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE()
    AND table_name = 'benefit_claims' AND index_name = 'benefit_claims_code_hash_key') = 0,
  'CREATE UNIQUE INDEX `benefit_claims_code_hash_key` ON `benefit_claims` (`code_hash`)', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- #48, H-12: AI budgets are counted per task and person without a table scan.
SET @s = IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE()
    AND table_name = 'private_ai_reservations' AND index_name = 'ai_reservations_task_profile_created') = 0,
  'CREATE INDEX `ai_reservations_task_profile_created` ON `private_ai_reservations` (`task`(64), `profile_id`, `created_at`)', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- #48: one lock row per AI budget instead of one lock for every reservation.
CREATE TABLE IF NOT EXISTS `private_ai_budget_locks` (
  `budget` VARCHAR(191) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`budget`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

-- #50: who used the candidate search, when, and how many profiles it returned.
CREATE TABLE IF NOT EXISTS `private_candidate_search_log` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `profile_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `results` INT NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `candidate_search_log_profile_created` (`profile_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

-- #54: deleting a person's profile no longer deletes their company (and with it
-- every vacancy and application); the company stays without an owner. Payments
-- are financial records: a company that has any cannot be deleted.
SET @s = IF((SELECT delete_rule FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE()
    AND constraint_name = 'companies_owner_id_fkey') = 'CASCADE',
  'ALTER TABLE `companies` DROP FOREIGN KEY `companies_owner_id_fkey`', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE()
    AND constraint_name = 'companies_owner_id_fkey') = 0,
  'ALTER TABLE `companies` ADD CONSTRAINT `companies_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `profiles` (`id`) ON DELETE SET NULL', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT delete_rule FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE()
    AND constraint_name = 'payments_company_id_fkey') = 'CASCADE',
  'ALTER TABLE `payments` DROP FOREIGN KEY `payments_company_id_fkey`', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE()
    AND constraint_name = 'payments_company_id_fkey') = 0,
  'ALTER TABLE `payments` ADD CONSTRAINT `payments_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- H-06: a company manages its data only while it is active and its owner is.
DROP FUNCTION IF EXISTS `owns_active_company`;
CREATE FUNCTION `owns_active_company`(c_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin) RETURNS TINYINT(1)
  READS SQL DATA
  RETURN EXISTS (SELECT 1 FROM `companies` c JOIN `profiles` p ON p.`id` = c.`owner_id`
    WHERE c.`id` = c_id AND c.`owner_id` = @auth_uid AND c.`status` = 'active' AND p.`status` = 'active');

-- #73: the moderation webhook secret lives only in the API's environment.
UPDATE `private_moderation_webhook_config` SET `secret` = '' WHERE `secret` <> '';
