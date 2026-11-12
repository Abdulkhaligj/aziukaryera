-- Row locks standing in for Postgres transaction-level advisory locks
-- (pg_advisory_xact_lock): SELECT … FOR UPDATE on the row serialises callers
-- until commit. ai_reservation_lock: public.ai_reserve_request.
INSERT IGNORE INTO `private_sequences` (`name`, `value`) VALUES ('ai_reservation_lock', 0);
