-- Prevent future duplicate interviews, require a venue for on-site interviews,
-- and advance a newly scheduled applicant into the interview stage.
-- Historical appointments are NOT deleted, moved or modified.
create or replace function public.validate_company_interview_slot()
returns trigger
language plpgsql security definer set search_path=''
as $$
begin
  if new.status <> 'scheduled' then return new; end if;

  if tg_op='UPDATE'
      and new.application_id is not distinct from old.application_id
      and new.starts_at is not distinct from old.starts_at
      and new.duration_minutes is not distinct from old.duration_minutes
      and new.meeting_mode is not distinct from old.meeting_mode
      and new.location is not distinct from old.location
      and new.status is not distinct from old.status then
    return new; -- preserve legacy rows during unrelated edits
  end if;

  if new.meeting_mode='on_site' and nullif(trim(coalesce(new.location,'')),'') is null then
    raise exception 'Əyani müsahibə üçün görüş məkanı daxil edilməlidir'
      using errcode='23514';
  end if;
  if exists (
    select 1 from public.company_interview_slots s
    where s.application_id=new.application_id
      and s.id is distinct from new.id
      and s.status='scheduled'
      and new.starts_at < s.starts_at + greatest(coalesce(s.duration_minutes,45),1)*interval '1 minute'
      and s.starts_at < new.starts_at + greatest(coalesce(new.duration_minutes,45),1)*interval '1 minute'
  ) then
    raise exception 'Bu namizəd üçün seçilən vaxtda artıq aktiv müsahibə var'
      using errcode='23505';
  end if;
  return new;
end;
$$;

drop trigger if exists company_interview_slots_validate on public.company_interview_slots;
create trigger company_interview_slots_validate
  before insert or update of application_id, starts_at, duration_minutes, meeting_mode, location, status
  on public.company_interview_slots
  for each row execute function public.validate_company_interview_slot();

create or replace function public.advance_interview_application_on_slot()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.status='scheduled' and (
      tg_op='INSERT' or (tg_op='UPDATE' and old.status is distinct from new.status)
  ) then
    update public.applications
      set status='interview'::public.application_status
      where id=new.application_id
        and status in (
          'gonderildi'::public.application_status,
          'baxilir'::public.application_status,
          'applied'::public.application_status,
          'under_review'::public.application_status,
          'shortlisted'::public.application_status
        );
  end if;
  return new;
end;
$$;

drop trigger if exists company_interview_slots_advance_application on public.company_interview_slots;
create trigger company_interview_slots_advance_application
  after insert or update of status
  on public.company_interview_slots
  for each row execute function public.advance_interview_application_on_slot();

-- One-time backfill only for applicants with an ACTIVE scheduled interview
-- still at an earlier stage; no record is deleted or replaced.
update public.applications a
  set status='interview'::public.application_status
  where status in (
    'gonderildi'::public.application_status,
    'baxilir'::public.application_status,
    'applied'::public.application_status,
    'under_review'::public.application_status,
    'shortlisted'::public.application_status
  )
  and exists (
    select 1 from public.company_interview_slots s
    where s.application_id=a.id and s.status='scheduled'
  );

revoke all on function public.validate_company_interview_slot() from public,anon,authenticated;
revoke all on function public.advance_interview_application_on_slot() from public,anon,authenticated;
