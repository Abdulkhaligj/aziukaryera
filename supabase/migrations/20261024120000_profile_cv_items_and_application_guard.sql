-- 1) Experience and projects that students add in CV Mərkəzi lived only in
--    the browser (localStorage), so companies never saw them and they were
--    lost on another device. They are now part of the profile, with size
--    limits so a profile row stays small.
alter table public.profiles
  add column if not exists experience jsonb not null default '[]'::jsonb,
  add column if not exists projects jsonb not null default '[]'::jsonb;

alter table public.profiles drop constraint if exists profiles_experience_shape;
alter table public.profiles add constraint profiles_experience_shape check (
  jsonb_typeof(experience) = 'array' and jsonb_array_length(experience) <= 30 and octet_length(experience::text) <= 30000
);
alter table public.profiles drop constraint if exists profiles_projects_shape;
alter table public.profiles add constraint profiles_projects_shape check (
  jsonb_typeof(projects) = 'array' and jsonb_array_length(projects) <= 30 and octet_length(projects::text) <= 30000
);

-- 2) applications_update lets the company that owns the job update the row,
--    but nothing limited which columns. A company may now only move the
--    pipeline: status, its private note and tags. Withdrawing stays the
--    student's action (delete), so a company cannot set geri_goturuldu.
alter table public.applications drop constraint if exists applications_company_note_len;
alter table public.applications add constraint applications_company_note_len check (company_note is null or char_length(company_note) <= 2000);
alter table public.applications drop constraint if exists applications_tags_len;
alter table public.applications add constraint applications_tags_len check (candidate_tags is null or cardinality(candidate_tags) <= 10);

create or replace function public.guard_application_update()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if auth.uid() is null or public.is_admin() then
    new.updated_at := now();
    return new;
  end if;
  if new.job_id is distinct from old.job_id
     or new.student_id is distinct from old.student_id
     or new.note is distinct from old.note
     or new.created_at is distinct from old.created_at then
    raise exception 'Müraciətin bu sahələrini dəyişmək icazəsi yoxdur' using errcode = 'insufficient_privilege';
  end if;
  if new.status is distinct from old.status and new.status::text = 'geri_goturuldu' then
    raise exception 'Müraciəti yalnız tələbə geri götürə bilər' using errcode = 'insufficient_privilege';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists applications_update_guard on public.applications;
create trigger applications_update_guard before update on public.applications
  for each row execute function public.guard_application_update();
