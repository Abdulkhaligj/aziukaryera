-- Security audit v4 (2026-11-23). Every statement can run again.

-- L-4: daily limits count in a counter per author and day.
CREATE TABLE IF NOT EXISTS `private_daily_counters` (
  `profile_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `kind` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `day` DATE NOT NULL,
  `n` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`profile_id`, `kind`, `day`),
  KEY `private_daily_counters_day` (`day`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

-- M-04: the guest's network, for the per-network AIDA cap.
SET @s = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE()
    AND table_name = 'private_ai_reservations' AND column_name = 'subnet_hash') = 0,
  'ALTER TABLE `private_ai_reservations` ADD COLUMN `subnet_hash` CHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL, ADD KEY `private_ai_reservations_subnet` (`subnet_hash`, `created_at`)', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
