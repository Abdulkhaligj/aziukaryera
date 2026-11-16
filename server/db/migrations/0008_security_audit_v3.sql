-- Security audit of 2026-11-16 (v3). Every statement can run again.
-- Rollback: restore the backup taken before the upgrade (deploy/universitet-mysql/README.md §6).

-- H4: one lock row serialises changes of the admin seats (at most 5 active admins).
INSERT IGNORE INTO `private_sequences` (`name`, `value`) VALUES ('admin_seat_lock', 0);

-- M27: a reservation whose provider call failed is released and not counted.
SET @s = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE()
    AND table_name = 'private_ai_reservations' AND column_name = 'released_at') = 0,
  'ALTER TABLE `private_ai_reservations` ADD COLUMN `released_at` DATETIME(6) NULL', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
