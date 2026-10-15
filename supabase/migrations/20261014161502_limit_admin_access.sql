-- Keep the Career Center staff area limited to five active accounts and
-- require both trusted app metadata and an active admin profile for access.

create or replace function public.enforce_admin_seat_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  consumes_new_seat boolean := false;
begin
  if tg_op = 'INSERT' then
    consumes_new_seat := new.role = 'admin'::public.user_role and new.status = 'active';
  else
    consumes_new_seat := new.role = 'admin'::public.user_role and new.status = 'active'
      and (old.role is distinct from new.role or old.status is distinct from new.status);
  end if;

  if consumes_new_seat then
    if (
      select count(*)
      from public.profiles p
      where p.role = 'admin'::public.user_role
        and p.status = 'active'
        and p.id <> new.id
    ) >= 5 then
      raise exception 'Admin giriş limiti dolub (maksimum 5 aktiv hesab)';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_admin_seat_limit() from public, anon, authenticated;

drop trigger if exists profiles_admin_seat_limit on public.profiles;
create trigger profiles_admin_seat_limit
before insert or update of role, status on public.profiles
for each row execute function public.enforce_admin_seat_limit();

create schema if not exists private;

create or replace function private.is_admin_check()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(
      (select auth.jwt() -> 'app_metadata' ->> 'admin_role')
        in ('super_admin', 'manager', 'editor', 'reviewer'),
      false
    )
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'::public.user_role
        and p.status = 'active'
    );
$$;

revoke all on function private.is_admin_check() from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_admin_check() to authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.is_admin_check(); $$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
