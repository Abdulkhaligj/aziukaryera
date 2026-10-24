-- ADNSU Career: applicant interview calendar and company partnership requests.
-- Additive migration. Production data is neither deleted nor backfilled.

create table if not exists public.company_interview_slots (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  starts_at timestamptz not null,
  duration_minutes integer not null default 45 check (duration_minutes between 15 and 180),
  meeting_mode text not null default 'on_site'
    check (meeting_mode in ('on_site','online','phone')),
  location text not null default '' check (char_length(location) <= 300),
  meeting_url text not null default '' check (char_length(meeting_url) <= 1000),
  notes text not null default '' check (char_length(notes) <= 2000),
  status text not null default 'scheduled'
    check (status in ('scheduled','completed','cancelled')),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists company_interview_slots_application_idx
  on public.company_interview_slots(application_id);
create index if not exists company_interview_slots_start_idx
  on public.company_interview_slots(starts_at);

create table if not exists public.company_partnership_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid not null default auth.uid() references public.profiles(id),
  category text not null check (category in (
    'career_day','workshop','campus_visit','internship','capstone','guest_lecture','other'
  )),
  title text not null check (char_length(trim(title)) between 5 and 160),
  details text not null check (char_length(trim(details)) between 20 and 4000),
  preferred_date date,
  contact_email text not null check (char_length(trim(contact_email)) between 3 and 200),
  status text not null default 'submitted'
    check (status in ('submitted','reviewing','approved','rejected','completed')),
  admin_note text not null default '' check (char_length(admin_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists company_partnership_requests_company_idx
  on public.company_partnership_requests(company_id,created_at desc);
create index if not exists company_partnership_requests_status_idx
  on public.company_partnership_requests(status,created_at desc);

alter table public.company_interview_slots enable row level security;
alter table public.company_partnership_requests enable row level security;

-- For interviews, an owning employer (or an admin) may schedule; an applicant
-- can view their own interview but cannot schedule, cancel, or edit it.
create policy company_interview_slots_select
  on public.company_interview_slots for select to authenticated using (
    (select public.is_admin())
    or exists (
      select 1 from public.applications a
      where a.id = company_interview_slots.application_id
        and a.student_id = (select auth.uid())
    )
    or exists (
      select 1 from public.applications a
      join public.jobs j on j.id = a.job_id
      where a.id = company_interview_slots.application_id
        and public.owns_company(j.company_id)
    )
  );

create policy company_interview_slots_insert
  on public.company_interview_slots for insert to authenticated with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.applications a
      join public.jobs j on j.id = a.job_id
      where a.id = company_interview_slots.application_id
        and public.owns_company(j.company_id)
    )
  );

create policy company_interview_slots_update
  on public.company_interview_slots for update to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.applications a
      join public.jobs j on j.id = a.job_id
      where a.id = company_interview_slots.application_id
        and public.owns_company(j.company_id)
    )
  )
  with check (
    (select public.is_admin())
    or exists (
      select 1 from public.applications a
      join public.jobs j on j.id = a.job_id
      where a.id = company_interview_slots.application_id
        and public.owns_company(j.company_id)
    )
  );

-- Employers may only create/read their own requests. Only admins can change
-- a request decision or review note.
create policy company_partnership_requests_select
  on public.company_partnership_requests for select to authenticated using (
    (select public.is_admin()) or public.owns_company(company_id)
  );

create policy company_partnership_requests_insert
  on public.company_partnership_requests for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and status = 'submitted'
    and admin_note = ''
    and public.owns_company(company_id)
    and exists(select 1 from public.companies c
      where c.id = company_id and c.status = 'active')
  );

create policy company_partnership_requests_update
  on public.company_partnership_requests for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Prevent clients from changing the identity fields after creation.
create or replace function public.company_employer_record_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if tg_table_name = 'company_interview_slots' then
      if new.application_id is distinct from old.application_id
        or new.created_by is distinct from old.created_by
        or new.created_at is distinct from old.created_at then
        raise exception 'Müsahibənin namizəd və müəllif məlumatı dəyişdirilə bilməz';
      end if;
    else
      if new.company_id is distinct from old.company_id
        or new.created_by is distinct from old.created_by
        or new.created_at is distinct from old.created_at
        or new.category is distinct from old.category
        or new.title is distinct from old.title
        or new.details is distinct from old.details
        or new.preferred_date is distinct from old.preferred_date
        or new.contact_email is distinct from old.contact_email then
        raise exception 'Əməkdaşlıq müraciətinin ilkin məlumatı dəyişdirilə bilməz';
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end; $$;

create trigger company_interview_slots_guard
  before update on public.company_interview_slots
  for each row execute function public.company_employer_record_guard();

create trigger company_partnership_requests_guard
  before update on public.company_partnership_requests
  for each row execute function public.company_employer_record_guard();

-- Deliver a student notification when an interview is scheduled/rescheduled.
create or replace function public.notify_company_interview_slot()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_student uuid;
  v_job_title text;
  v_subject text;
begin
  select a.student_id, j.title into v_student, v_job_title
  from public.applications a
  join public.jobs j on j.id = a.job_id
  where a.id = new.application_id;
  if v_student is null then return new; end if;

  if tg_op = 'UPDATE'
    and new.starts_at is not distinct from old.starts_at
    and new.status is not distinct from old.status then
    return new;
  end if;

  v_subject := case new.status
    when 'cancelled' then 'Müsahibə ləğv edildi'
    when 'completed' then 'Müsahibə tamamlandı'
    else 'Müsahibə vaxtınız təyin olundu'
  end;

  insert into public.notifications(profile_id,kind,title,body,link)
  values(
    v_student, 'interview', v_subject,
    coalesce(v_job_title,'Vakansiya') || ' · ' ||
    to_char(new.starts_at at time zone 'Asia/Baku','DD.MM.YYYY HH24:MI') || ' (Bakı vaxtı)',
    'applications'
  );
  return new;
end; $$;

create trigger company_interview_slots_notify
  after insert or update of starts_at,status on public.company_interview_slots
  for each row execute function public.notify_company_interview_slot();

revoke all on function public.company_employer_record_guard() from public,anon,authenticated;
revoke all on function public.notify_company_interview_slot() from public,anon,authenticated;

revoke all on public.company_interview_slots from public,anon,authenticated;
revoke all on public.company_partnership_requests from public,anon,authenticated;
grant select,insert,update on public.company_interview_slots to authenticated;
grant select,insert,update on public.company_partnership_requests to authenticated;

comment on table public.company_interview_slots is 'Interview bookings for real applicant-company relationships.';
comment on table public.company_partnership_requests is 'University partnership proposals created by verified companies.';
