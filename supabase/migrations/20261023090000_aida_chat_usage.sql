-- AIDA chat (edge function aida-chat) is open to visitors who are not signed
-- in. Their daily limit is counted per client: a SHA-256 of the IP with a
-- salt that changes every day, so the value cannot be linked across days and
-- the raw IP is never stored. Signed-in users keep using profile_id.
alter table public.ai_usage add column if not exists client_hash text;
create index if not exists ai_usage_task_client_created
  on public.ai_usage (task, client_hash, created_at) where client_hash is not null;
create index if not exists ai_usage_task_created on public.ai_usage (task, created_at);
