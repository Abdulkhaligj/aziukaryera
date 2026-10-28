-- Applying to a job failed with "infinite recursion detected in policy for
-- relation applications": applications_insert read profiles (to check the
-- student is active), and profiles_select reads applications (company owners
-- see their applicants). The status check now runs in a SECURITY DEFINER
-- helper, like app_role(), so it does not go through profiles RLS.
-- Applications are also closed once the job's deadline has passed (Baku date).

create or replace function public.app_account_active()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce((select status = 'active'::public.account_status from public.profiles where id = auth.uid()), false);
$$;

revoke execute on function public.app_account_active() from public, anon;
grant execute on function public.app_account_active() to authenticated;

drop policy if exists applications_insert on public.applications;
create policy applications_insert on public.applications
  for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and (select public.app_role()) = any (array['student', 'graduate']::public.user_role[])
    and (select public.app_account_active())
    and exists (
      select 1 from public.jobs j
      where j.id = applications.job_id
        and j.status::text = any (array['approved', 'published'])
        and (j.deadline is null or j.deadline >= (now() at time zone 'Asia/Baku')::date)
    )
  );
