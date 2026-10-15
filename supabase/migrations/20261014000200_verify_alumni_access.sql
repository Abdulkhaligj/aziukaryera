-- Personal-email alumni accounts can register, but career actions require
-- Career Center verification (profiles.status = active).

create or replace function public.guard_profile_privileges()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.is_admin() then
    new.updated_at := now();
    return new;
  end if;
  if new.role is distinct from old.role or new.status is distinct from old.status then
    raise exception 'Rol və hesab statusunu dəyişmək icazəsi yoxdur' using errcode='insufficient_privilege';
  end if;
  if new.alumni_verified is distinct from old.alumni_verified then
    raise exception 'Məzun təsdiqini yalnız Karyera Mərkəzi dəyişə bilər' using errcode='insufficient_privilege';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using (
  id=auth.uid() or public.is_admin() or
  (status='active' and role in ('student','graduate') and public.has_active_company())
);

drop policy if exists applications_insert on public.applications;
create policy applications_insert on public.applications for insert to authenticated
with check (
  student_id=auth.uid()
  and public.app_role() in ('student','graduate')
  and exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active')
  and exists(select 1 from public.jobs j where j.id=job_id and j.status='approved')
);

drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts for insert to authenticated
with check (
  author_id=auth.uid()
  and exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active')
);

drop policy if exists comments_insert on public.post_comments;
create policy comments_insert on public.post_comments for insert to authenticated
with check (
  author_id=auth.uid()
  and exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active')
);

drop policy if exists education_read on public.education;
create policy education_read on public.education for select to authenticated
using (
  profile_id=auth.uid() or public.is_admin() or
  (public.has_active_company() and exists(select 1 from public.profiles p where p.id=profile_id and p.status='active'))
);
