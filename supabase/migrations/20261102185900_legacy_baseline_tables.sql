-- The live project was provisioned through integrate_admin_panel rather than
-- the original admin_panel baseline, so two legacy relations never existed.
-- The security upgrade and the platform reset it installs still reference
-- them. Create them empty and closed; the apps use site_content and
-- admin_audit_logs instead.
begin;

create table if not exists public.content (
  id uuid primary key default gen_random_uuid(), title text not null, subtitle text not null default '',
  status text not null default 'Qaralama', meta text not null default '', content_key text unique not null,
  body jsonb not null default '{}'::jsonb, created_by uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(), title text not null, subtitle text not null default '',
  status text not null default 'Aktiv', meta text not null default '', actor_id uuid references auth.users(id) on delete set null,
  resource text not null, resource_id uuid, action text not null, before_data jsonb, after_data jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

alter table public.content enable row level security;
alter table public.audit_logs enable row level security;
revoke all on public.content, public.audit_logs from anon, authenticated;

commit;
