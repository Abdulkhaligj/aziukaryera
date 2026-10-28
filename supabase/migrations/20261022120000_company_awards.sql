-- ADNSU Career Awards: annual company awards. The Career Center (admins) adds
-- winners per year and nomination with a gold / silver / bronze tier. Only
-- published rows are public (landing page, anon included); drafts are visible
-- to admins only.

create table if not exists public.company_awards (
  id uuid primary key default gen_random_uuid(),
  year integer not null check (year between 2020 and 2100),
  nomination text not null check (char_length(trim(nomination)) between 2 and 80),
  tier text not null check (tier in ('gold', 'silver', 'bronze')),
  -- Optional link to a registered company; the name is stored so the award
  -- stays readable if the company is not on the platform or is removed.
  company_id uuid references public.companies(id) on delete set null,
  company_name text not null check (char_length(trim(company_name)) between 1 and 120),
  logo_url text check (logo_url is null or logo_url ~ '^https://'),
  citation text check (citation is null or char_length(citation) <= 300),
  published boolean not null default false,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (year, nomination, company_name)
);

create index if not exists company_awards_public_idx on public.company_awards(year desc) where published;

create or replace function private.company_awards_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.nomination := trim(new.nomination);
  new.company_name := trim(new.company_name);
  return new;
end $$;

drop trigger if exists company_awards_touch on public.company_awards;
create trigger company_awards_touch before insert or update on public.company_awards
  for each row execute function private.company_awards_touch();

alter table public.company_awards enable row level security;

drop policy if exists company_awards_public on public.company_awards;
create policy company_awards_public on public.company_awards for select to anon
  using (published);

drop policy if exists company_awards_read on public.company_awards;
create policy company_awards_read on public.company_awards for select to authenticated
  using (published or (select public.is_admin()));

drop policy if exists company_awards_admin_insert on public.company_awards;
create policy company_awards_admin_insert on public.company_awards for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists company_awards_admin_update on public.company_awards;
create policy company_awards_admin_update on public.company_awards for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists company_awards_admin_delete on public.company_awards;
create policy company_awards_admin_delete on public.company_awards for delete to authenticated
  using ((select public.is_admin()));

revoke all on public.company_awards from anon, authenticated;
grant select on public.company_awards to anon;
grant select, insert, update, delete on public.company_awards to authenticated;
revoke execute on function private.company_awards_touch() from public, anon, authenticated;
