-- Security audit of 2026-11-16 (v3). Every statement can run again.
-- Rollback: restore the backup taken before the upgrade (deploy/universitet-mysql/README.md §6).

-- H4: one lock row serialises changes of the admin seats (at most 5 active admins).
INSERT IGNORE INTO `private_sequences` (`name`, `value`) VALUES ('admin_seat_lock', 0);

-- M27: a reservation whose provider call failed is released and not counted.
SET @s = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE()
    AND table_name = 'private_ai_reservations' AND column_name = 'released_at') = 0,
  'ALTER TABLE `private_ai_reservations` ADD COLUMN `released_at` DATETIME(6) NULL', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- L48: email links in the code (PKCE) flow. A link carries a one-time code; the
-- browser that asked for it trades the code and its secret verifier for the
-- session, so no token ends up in the address bar or the browser history.
SET @s = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE()
    AND table_name = 'auth_one_time_tokens' AND column_name = 'code_challenge') = 0,
  'ALTER TABLE `auth_one_time_tokens` ADD COLUMN `code_challenge` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL, ADD COLUMN `code_challenge_method` VARCHAR(8) NULL', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
CREATE TABLE IF NOT EXISTS `auth_flow_codes` (
  `code_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `user_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `purpose` VARCHAR(32) NOT NULL,
  `code_challenge` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `code_challenge_method` VARCHAR(8) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `expires_at` DATETIME(6) NOT NULL,
  `used_at` DATETIME(6) NULL,
  PRIMARY KEY (`code_hash`),
  KEY `auth_flow_codes_user` (`user_id`),
  CONSTRAINT `auth_flow_codes_user_fkey` FOREIGN KEY (`user_id`) REFERENCES `auth_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;
