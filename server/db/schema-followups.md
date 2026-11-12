# Schema rules the API must enforce

Generated with schema.sql. Each item is a Postgres rule MySQL cannot express.

- `ads`: `created_by` defaulted to auth.uid(); the API must set it to the caller's id.
- `company_awards`: `created_by` defaulted to auth.uid(); the API must set it to the caller's id.
- `company_interview_slots`: `created_by` defaulted to auth.uid(); the API must set it to the caller's id.
- `company_interview_slots`: EXCLUDE `company_interview_slots_no_overlap` (no overlapping ranges) must be enforced in the API inside a transaction: EXCLUDE USING gist (application_id WITH =, tstzrange(starts_at, private.interview_end(starts_at, duration_minutes), '[)'::text) WITH &&) WHERE ((status = 'scheduled'::text))
- `company_partnership_requests`: `created_by` defaulted to auth.uid(); the API must set it to the caller's id.
- `connections`: CHECK `connections_check` uses a column with an FK action (not allowed in MySQL); enforce in the API: CHECK ((requester_id <> addressee_id))
- `follows`: CHECK `follows_check` uses a column with an FK action (not allowed in MySQL); enforce in the API: CHECK ((num_nonnulls(followed_profile_id, followed_company_id) = 1))
- `jobs`: GIN index `jobs_faculty_idx` only speeds up array lookups; no rule is lost (a MySQL multi-valued index can be added if needed).
- `jobs`: GIN index `jobs_skills_idx` only speeds up array lookups; no rule is lost (a MySQL multi-valued index can be added if needed).
- `messages`: CHECK `messages_check` uses a column with an FK action (not allowed in MySQL); enforce in the API: CHECK ((sender_id <> recipient_id))
- `profiles`: GIN index `profiles_skills_idx` only speeds up array lookups; no rule is lost (a MySQL multi-valued index can be added if needed).
