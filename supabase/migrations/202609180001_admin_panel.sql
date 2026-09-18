-- ADNSU Career Admin v1
-- Run in Supabase SQL Editor, then create staff users in Authentication.
-- Set each staff user's app_metadata.role to one of:
-- super_admin, manager, editor, reviewer.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'student' check (role in ('student','company','super_admin','manager','editor','reviewer')),
  status text not null default 'active' check (status in ('active','suspended')),
  faculty text,
  major text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(), title text not null, subtitle text not null default '',
  status text not null default 'Qaralama', meta text not null default '', logo_url text, website text,
  industry text, description text, data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(), title text not null, subtitle text not null default '',
  status text not null default 'Qaralama', meta text not null default '', company_id uuid references public.companies(id) on delete set null,
  job_type text, location text, work_mode text, deadline date, description text, requirements text[], skills text[],
  target_faculties text[], target_majors text[], data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(), title text not null, subtitle text not null default '',
  status text not null default 'Qaralama', meta text not null default '', event_type text, venue text,
  starts_at timestamptz, ends_at timestamptz, capacity integer check (capacity is null or capacity >= 0),
  registration_url text, cover_url text, description text, data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.benefits (
  id uuid primary key default gen_random_uuid(), title text not null, subtitle text not null default '',
  status text not null default 'Qaralama', meta text not null default '', partner_name text, category text,
  discount_label text, valid_from date, valid_until date, redemption_type text default 'qr', redemption_value text,
  terms text, image_url text, data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade, title text not null default '', subtitle text not null default '',
  status text not null default 'Yoxlamada', meta text not null default '', cv_url text, note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,job_id)
);
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

create or replace view public.students with (security_invoker=true) as
select id, full_name as title, concat_ws(' · ', major, faculty) as subtitle,
       case when status='active' then 'Aktiv' else 'Bitib' end as status,
       coalesce(major,'Profil məlumatı yoxdur') as meta, updated_at
from public.profiles where role='student';

create or replace view public.admins with (security_invoker=true) as
select id, full_name as title, role as subtitle,
       case when status='active' then 'Aktiv' else 'Bitib' end as status,
       'Rol və giriş hüquqları'::text as meta, updated_at
from public.profiles where role in ('super_admin','manager','editor','reviewer');

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.jobs enable row level security;
alter table public.events enable row level security;
alter table public.benefits enable row level security;
alter table public.applications enable row level security;
alter table public.content enable row level security;
alter table public.audit_logs enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.companies, public.jobs, public.events, public.benefits, public.content to anon;
grant select on public.companies, public.jobs, public.events, public.benefits, public.content, public.students, public.admins to authenticated;
grant select, insert, update, delete on public.companies, public.jobs, public.events, public.benefits, public.content to authenticated;
grant select, insert, update on public.applications to authenticated;
grant select on public.profiles, public.audit_logs to authenticated;

create policy "published companies are public" on public.companies for select to anon using (status='Aktiv');
create policy "published jobs are public" on public.jobs for select to anon using (status='Aktiv');
create policy "published events are public" on public.events for select to anon using (status='Aktiv');
create policy "published benefits are public" on public.benefits for select to anon using (status='Aktiv');
create policy "published content is public" on public.content for select to anon using (status='Aktiv');

create policy "users read own profile" on public.profiles for select to authenticated
using ((select auth.uid())=id or coalesce((select auth.jwt()->'app_metadata'->>'role'),'') in ('super_admin','manager','editor','reviewer'));

create policy "staff read companies" on public.companies for select to authenticated using (true);
create policy "staff read jobs" on public.jobs for select to authenticated using (true);
create policy "staff read events" on public.events for select to authenticated using (true);
create policy "staff read benefits" on public.benefits for select to authenticated using (true);
create policy "staff read content" on public.content for select to authenticated using (true);

create policy "editors manage companies" on public.companies for all to authenticated
using (coalesce((select auth.jwt()->'app_metadata'->>'role'),'') in ('super_admin','manager','editor'))
with check (coalesce((select auth.jwt()->'app_metadata'->>'role'),'') in ('super_admin','manager','editor'));
create policy "editors manage jobs" on public.jobs for all to authenticated
using (coalesce((select auth.jwt()->'app_metadata'->>'role'),'') in ('super_admin','manager','editor'))
with check (coalesce((select auth.jwt()->'app_metadata'->>'role'),'') in ('super_admin','manager','editor'));
create policy "editors manage events" on public.events for all to authenticated
using (coalesce((select auth.jwt()->'app_metadata'->>'role'),'') in ('super_admin','manager','editor'))
with check (coalesce((select auth.jwt()->'app_metadata'->>'role'),'') in ('super_admin','manager','editor'));
create policy "editors manage benefits" on public.benefits for all to authenticated
using (coalesce((select auth.jwt()->'app_metadata'->>'role'),'') in ('super_admin','manager','editor'))
with check (coalesce((select auth.jwt()->'app_metadata'->>'role'),'') in ('super_admin','manager','editor'));
create policy "editors manage content" on public.content for all to authenticated
using (coalesce((select auth.jwt()->'app_metadata'->>'role'),'') in ('super_admin','manager','editor'))
with check (coalesce((select auth.jwt()->'app_metadata'->>'role'),'') in ('super_admin','manager','editor'));

create policy "students create own applications" on public.applications for insert to authenticated with check ((select auth.uid())=user_id);
create policy "students read own applications" on public.applications for select to authenticated
using ((select auth.uid())=user_id or coalesce((select auth.jwt()->'app_metadata'->>'role'),'') in ('super_admin','manager','editor','reviewer'));
create policy "staff update applications" on public.applications for update to authenticated
using (coalesce((select auth.jwt()->'app_metadata'->>'role'),'') in ('super_admin','manager','editor','reviewer'))
with check (coalesce((select auth.jwt()->'app_metadata'->>'role'),'') in ('super_admin','manager','editor','reviewer'));
create policy "staff read logs" on public.audit_logs for select to authenticated
using (coalesce((select auth.jwt()->'app_metadata'->>'role'),'') in ('super_admin','manager','editor','reviewer'));

create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at=now(); return new; end $$;
revoke all on function public.touch_updated_at() from public, anon, authenticated;

create or replace function public.write_audit_log() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.audit_logs(title,subtitle,meta,actor_id,resource,resource_id,action,before_data,after_data)
  values (
    case when tg_op='INSERT' then 'Qeyd yaradıldı' when tg_op='UPDATE' then 'Qeyd yeniləndi' else 'Qeyd silindi' end,
    coalesce(new.title,old.title,''), tg_table_name, (select auth.uid()), tg_table_name, coalesce(new.id,old.id), lower(tg_op),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new,old);
end $$;
revoke all on function public.write_audit_log() from public, anon, authenticated;

do $$ declare t text; begin
  foreach t in array array['profiles','companies','jobs','events','benefits','applications','content'] loop
    execute format('drop trigger if exists set_updated_at on public.%I',t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.touch_updated_at()',t);
  end loop;
  foreach t in array array['companies','jobs','events','benefits','content'] loop
    execute format('drop trigger if exists audit_changes on public.%I',t);
    execute format('create trigger audit_changes after insert or update or delete on public.%I for each row execute function public.write_audit_log()',t);
  end loop;
end $$;

create index if not exists jobs_status_deadline_idx on public.jobs(status,deadline);
create index if not exists applications_job_status_idx on public.applications(job_id,status);
create index if not exists events_status_starts_idx on public.events(status,starts_at);

