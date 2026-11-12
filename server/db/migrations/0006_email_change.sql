-- Email change by the user (GoTrue's secure email change): the new address
-- waits here until both the current and the new address confirm it.
ALTER TABLE `auth_users`
  ADD COLUMN `email_change` VARCHAR(191) NULL,
  ADD COLUMN `email_change_confirm_status` TINYINT NOT NULL DEFAULT 0,
  ADD COLUMN `email_change_sent_at` DATETIME(6) NULL;
-- The address an email-change link was sent to.
ALTER TABLE `auth_one_time_tokens` ADD COLUMN `relates_to` VARCHAR(191) NULL;
