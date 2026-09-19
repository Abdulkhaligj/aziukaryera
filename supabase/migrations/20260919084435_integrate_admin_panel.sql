-- Integrates the standalone admin UI with the existing ASOIU Career schema.
-- Existing jobs, companies, events, benefits, applications and profiles are reused.

create table if not exists public.site_content (
  id uuid primary key default gen_random_uuid(),
  content_key text not null unique,
  title text not null,
  summary text not null default '',
  body text not null default '',
  status text not null default 'Qaralama' check (status in ('Aktiv', 'Qaralama', 'Bitib')),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  resource text not null,
  resource_id uuid,
  action text not null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text not null default '',
  created_at timestamptz not null default now()
);

alter table public.site_content enable row level security;
alter table public.admin_audit_logs enable row level security;

grant select on public.site_content to anon;
grant select, insert, update, delete on public.site_content to authenticated;
grant select, insert on public.admin_audit_logs to authenticated;

drop policy if exists "active site content is public" on public.site_content;
create policy "active site content is public" on public.site_content
for select to anon using (status = 'Aktiv');

drop policy if exists "admins manage site content" on public.site_content;
create policy "admins manage site content" on public.site_content
for all to authenticated using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "admins read audit logs" on public.admin_audit_logs;
create policy "admins read audit logs" on public.admin_audit_logs
for select to authenticated using ((select public.is_admin()));

drop policy if exists "admins write audit logs" on public.admin_audit_logs;
create policy "admins write audit logs" on public.admin_audit_logs
for insert to authenticated with check (
  (select public.is_admin()) and actor_id = (select auth.uid())
);

drop policy if exists "admins insert companies" on public.companies;
create policy "admins insert companies" on public.companies
for insert to authenticated with check ((select public.is_admin()));

drop policy if exists "admins delete companies" on public.companies;
create policy "admins delete companies" on public.companies
for delete to authenticated using ((select public.is_admin()));

drop policy if exists "admins insert jobs" on public.jobs;
create policy "admins insert jobs" on public.jobs
for insert to authenticated with check ((select public.is_admin()));

create or replace function public.touch_site_content_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.touch_site_content_updated_at() from public, anon, authenticated;

drop trigger if exists set_site_content_updated_at on public.site_content;
create trigger set_site_content_updated_at
before update on public.site_content
for each row execute function public.touch_site_content_updated_at();

insert into public.site_content (content_key, title, summary, body, status)
values
  ('home.announcement', 'Karyera və İnnovasiya imkanları', 'Ana səhifədə görünən elan', 'Yeni imkanları və tədbirləri Karyera Mərkəzindən izləyin.', 'Aktiv'),
  ('footer.faq', 'Tez-tez verilən suallar', 'Tələbələr üçün əsas məlumatlar', 'Vakansiyalara müraciət etmək üçün profilinizi və CV-nizi tamamlayın.', 'Aktiv')
on conflict (content_key) do nothing;
