-- Preserve old interviews and automatically register direct employer bookings.
-- Existing student-initiated requests continue to work unchanged.
create or replace function public.sync_interview_request_on_slot()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_student uuid; v_company uuid;
begin
  if new.status <> 'scheduled' then return new; end if;
  select a.student_id,j.company_id into v_student,v_company
    from public.applications a
    join public.jobs j on j.id=a.job_id
    where a.id=new.application_id;
  if v_student is null or v_company is null then return new; end if;

  insert into public.interview_requests(
    application_id,student_id,company_id,status,scheduled_slot_id)
  values(new.application_id,v_student,v_company,'scheduled',new.id)
  on conflict(application_id) do update
    set status='scheduled',scheduled_slot_id=excluded.scheduled_slot_id,
        updated_at=now()
    where public.interview_requests.status in ('pending','accepted','scheduled');
  return new;
end;
$$;

-- A company-initiated scheduled interview is NOT a new student request.
-- Do not erroneously notify the company that it received a request from itself.
create or replace function public.notify_interview_request()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_owner uuid; v_job text;
begin
  select c.owner_id,j.title into v_owner,v_job
    from public.companies c
    join public.jobs j on j.company_id=c.id
    join public.applications a on a.job_id=j.id
    where a.id=new.application_id and c.id=new.company_id;
  if (tg_op='INSERT' and new.status='pending') or
     (tg_op='UPDATE' and new.status='pending' and old.status is distinct from new.status) then
    if v_owner is not null then
      insert into public.notifications(profile_id,kind,title,body,link)
      values(v_owner,'interview_request','Yeni müsahibə sorğusu',
        coalesce(v_job,'Vakansiya')||' üzrə namizəd müsahibə istəyir.','interview-inbox');
    end if;
  elsif tg_op='UPDATE' and new.status is distinct from old.status then
    if new.status='accepted' then
      insert into public.notifications(profile_id,kind,title,body,link)
      values(new.student_id,'interview_request','Müsahibə sorğunuz qəbul edildi',
        coalesce(v_job,'Vakansiya')||' üzrə şirkət görüş təyin edə bilər.','interview-requests');
    elsif new.status='declined' then
      insert into public.notifications(profile_id,kind,title,body,link)
      values(new.student_id,'interview_request','Müsahibə sorğunuza cavab verildi',
        coalesce(v_job,'Vakansiya')||' üzrə sorğu qəbul edilmədi.','interview-requests');
    elsif new.status='cancelled' and v_owner is not null then
      insert into public.notifications(profile_id,kind,title,body,link)
      values(v_owner,'interview_request','Müsahibə sorğusu ləğv olundu',
        coalesce(v_job,'Vakansiya')||' üzrə namizəd sorğunu geri götürdü.','interview-inbox');
    end if;
    -- Scheduled interview notifications remain owned by
    -- notify_company_interview_slot (avoids duplicates).
  end if;
  return new;
end;
$$;

-- Backfill any pre-existing standalone bookings without deleting a single slot.
-- Unique(application_id) means one request per application, while UI now
-- displays each company_interview_slots record separately.
insert into public.interview_requests(
  application_id, student_id, company_id, status, scheduled_slot_id
)
select distinct on (s.application_id)
  s.application_id,a.student_id,j.company_id,'scheduled',s.id
from public.company_interview_slots s
join public.applications a on a.id=s.application_id
join public.jobs j on j.id=a.job_id
where s.status='scheduled'
order by s.application_id,s.starts_at desc,s.created_at desc
on conflict(application_id) do update
set status='scheduled',scheduled_slot_id=excluded.scheduled_slot_id,updated_at=now()
where public.interview_requests.status in ('pending','accepted','scheduled');
