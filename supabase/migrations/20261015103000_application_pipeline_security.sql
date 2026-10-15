-- Applicants are visible to the company they applied to, while full candidate
-- database access remains restricted to Pro/Business package rights.

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (
  id=(select auth.uid())
  or (select public.is_admin())
  or (
    status='active'
    and role in ('student'::public.user_role,'graduate'::public.user_role)
    and (
      exists(
        select 1
        from public.applications a
        join public.jobs j on j.id=a.job_id
        join public.companies c on c.id=j.company_id
        where a.student_id=profiles.id and c.owner_id=(select auth.uid()) and c.status='active'
      )
      or exists(
        select 1
        from public.companies c
        join public.subscriptions s on s.company_id=c.id and s.status='active'
        join public.plan_features pf on pf.plan_id=s.plan_id and pf.feature_key='candidate_search' and pf.enabled
        where c.owner_id=(select auth.uid()) and c.status='active'
      )
    )
  )
);

drop policy if exists applications_update on public.applications;
create policy applications_update on public.applications for update to authenticated
using (
  (select public.is_admin())
  or exists(select 1 from public.jobs j where j.id=applications.job_id and public.owns_company(j.company_id))
)
with check (
  (select public.is_admin())
  or exists(select 1 from public.jobs j where j.id=applications.job_id and public.owns_company(j.company_id))
);
