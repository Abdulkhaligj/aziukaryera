-- Sync approved company records with the sign-in account status.
-- A company owner's profile should not remain pending after the company is approved.
create or replace function public.sync_company_owner_profile_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is not null and new.status is distinct from old.status then
    update public.profiles p
    set status = new.status
    where p.id = new.owner_id
      and p.role = 'company'::public.user_role
      and p.status is distinct from new.status;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_company_owner_profile_status() from public, anon, authenticated;

drop trigger if exists companies_sync_owner_profile_status on public.companies;
create trigger companies_sync_owner_profile_status
after update of status on public.companies
for each row
when (old.status is distinct from new.status)
execute function public.sync_company_owner_profile_status();

-- Backfill only company accounts already explicitly approved by staff.
update public.profiles p
set status = 'active'::public.account_status
where p.role = 'company'::public.user_role
  and p.status = 'pending'::public.account_status
  and exists (
    select 1 from public.companies c
    where c.owner_id = p.id and c.status = 'active'::public.account_status
  );
