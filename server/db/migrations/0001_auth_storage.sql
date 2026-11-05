-- Replaces Supabase Auth (auth.users, sessions, email tokens) and Storage
-- metadata. Ids keep their Supabase values so every foreign key and stored
-- path (avatar_path, …) stays valid after the data migration.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `auth_users` (
  `id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT (UUID()),
  `email` VARCHAR(191) NULL,
  -- bcrypt ($2a$/$2b$) hashes migrated as is: users keep their passwords.
  `encrypted_password` VARCHAR(255) NULL,
  `email_confirmed_at` DATETIME(6) NULL,
  `last_sign_in_at` DATETIME(6) NULL,
  -- Server-owned claims: provider, role mirrors, admin_role, must_change_password.
  `raw_app_meta_data` JSON NOT NULL DEFAULT (JSON_OBJECT()),
  `raw_user_meta_data` JSON NOT NULL DEFAULT (JSON_OBJECT()),
  `banned_until` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `deleted_at` DATETIME(6) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `auth_users_email_key` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

-- One row per signed-in device. Only a SHA-256 of the refresh token is kept.
CREATE TABLE IF NOT EXISTS `auth_sessions` (
  `id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT (UUID()),
  `user_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `refresh_token_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `refreshed_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `expires_at` DATETIME(6) NOT NULL,
  `revoked_at` DATETIME(6) NULL,
  `user_agent` VARCHAR(255) NULL,
  `ip` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `auth_sessions_refresh_token_hash_key` (`refresh_token_hash`),
  KEY `auth_sessions_user_idx` (`user_id`, `revoked_at`),
  CONSTRAINT `auth_sessions_user_fkey` FOREIGN KEY (`user_id`) REFERENCES `auth_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

-- Single-use codes and links: password recovery, email confirmation, invites.
CREATE TABLE IF NOT EXISTS `auth_one_time_tokens` (
  `id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT (UUID()),
  `user_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `purpose` ENUM('recovery','email_confirmation','invite','email_change') NOT NULL,
  `token_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `expires_at` DATETIME(6) NOT NULL,
  `used_at` DATETIME(6) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `auth_one_time_tokens_token_hash_key` (`token_hash`),
  KEY `auth_one_time_tokens_user_idx` (`user_id`, `purpose`),
  CONSTRAINT `auth_one_time_tokens_user_fkey` FOREIGN KEY (`user_id`) REFERENCES `auth_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE IF NOT EXISTS `storage_buckets` (
  `id` VARCHAR(64) NOT NULL,
  `public` TINYINT(1) NOT NULL DEFAULT 0,
  `file_size_limit` BIGINT NULL,
  `allowed_mime_types` JSON NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

-- File bytes live on disk under STORAGE_DIR/<bucket>/<name>; this is the index.
CREATE TABLE IF NOT EXISTS `storage_objects` (
  `id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT (UUID()),
  `bucket_id` VARCHAR(64) NOT NULL,
  `name` VARCHAR(512) NOT NULL,
  `owner_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `mimetype` VARCHAR(127) NULL,
  `size` BIGINT NOT NULL DEFAULT 0,
  `cache_control` VARCHAR(127) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`bucket_id`, `name`),
  UNIQUE KEY `storage_objects_id_key` (`id`),
  CONSTRAINT `storage_objects_bucket_fkey` FOREIGN KEY (`bucket_id`) REFERENCES `storage_buckets` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

-- Applied-migration ledger for server/db/migrate.mjs.
CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `version` VARCHAR(191) NOT NULL,
  `applied_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;
