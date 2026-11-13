-- Email change by the user (GoTrue's secure email change): the new address
-- waits here until both the current and the new address confirm it.
-- Every statement can run again (audit 2026-11-13, #72).
SET @s = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE()
    AND table_name = 'auth_users' AND column_name = 'email_change') = 0,
  'ALTER TABLE `auth_users` ADD COLUMN `email_change` VARCHAR(191) NULL', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE()
    AND table_name = 'auth_users' AND column_name = 'email_change_confirm_status') = 0,
  'ALTER TABLE `auth_users` ADD COLUMN `email_change_confirm_status` TINYINT NOT NULL DEFAULT 0', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE()
    AND table_name = 'auth_users' AND column_name = 'email_change_sent_at') = 0,
  'ALTER TABLE `auth_users` ADD COLUMN `email_change_sent_at` DATETIME(6) NULL', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
-- The address an email-change link was sent to.
SET @s = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE()
    AND table_name = 'auth_one_time_tokens' AND column_name = 'relates_to') = 0,
  'ALTER TABLE `auth_one_time_tokens` ADD COLUMN `relates_to` VARCHAR(191) NULL', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
