-- Postgres sequences that are not column identities. One row per sequence;
-- next value = UPDATE … SET value = LAST_INSERT_ID(value + 1), as in MySQL docs.
CREATE TABLE IF NOT EXISTS `private_sequences` (
  `name` VARCHAR(64) NOT NULL,
  `value` BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

-- invoice_seq numbers KM-YYYY-NNNNN invoices (private.ensure_invoice).
INSERT IGNORE INTO `private_sequences` (`name`, `value`) VALUES ('invoice_seq', 0);
