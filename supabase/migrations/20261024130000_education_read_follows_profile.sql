-- education_read let any approved company read the education rows of every
-- active student, even with no application and no candidate_search plan.
-- Education is now visible exactly when the profile itself is visible:
-- the EXISTS runs under the caller's RLS on profiles, so a company sees its
-- applicants (and the search pool only with the paid feature), a student
-- sees their own rows, and admins see everything.
drop policy if exists education_read on public.education;
create policy education_read on public.education
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (select public.is_admin())
    or exists (select 1 from public.profiles p where p.id = education.profile_id)
  );
