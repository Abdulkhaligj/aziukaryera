-- Remaining audit items (2026-11-24). Every statement can run again.

-- M-03 (audit v4): a six-digit code by email confirms the platform reset.
ALTER TABLE `auth_one_time_tokens` MODIFY `purpose`
  ENUM('recovery','email_confirmation','invite','magic_link','email_change','reauthentication') NOT NULL;
