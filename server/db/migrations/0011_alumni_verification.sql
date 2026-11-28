-- Graduate verification (2026-11-28). A graduate who signs up with a personal
-- address (Google or email) gives their diploma details here; the Career
-- Center checks them and approves the account in the admin panel. Until then
-- the profile stays 'pending': it can be filled in, but applications need an
-- active account (applications_insert, app_account_active()). Diploma details
-- are readable only by their owner and by staff (policies.generated.json).
-- Every statement can run again.

CREATE TABLE IF NOT EXISTS `alumni_verifications` (
  `profile_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `full_name` VARCHAR(200) NOT NULL,
  `diploma_number` VARCHAR(40) NOT NULL,
  `graduation_year` INT NOT NULL,
  `faculty` VARCHAR(200) NOT NULL,
  `specialty` VARCHAR(200) NOT NULL,
  `status` ENUM('submitted','approved','rejected') NOT NULL DEFAULT 'submitted',
  `review_note` TEXT NULL,
  `reviewed_by` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `reviewed_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`profile_id`),
  CONSTRAINT `alumni_verifications_profile_id_fkey` FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `alumni_verifications_year_check` CHECK ((`graduation_year` >= 1950) AND (`graduation_year` <= 2100)),
  KEY `alumni_verifications_status_idx` (`status`, `updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;
