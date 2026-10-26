-- ADNSU Karyera: student -> employer interview requests.
-- Additive migration: no existing tables, policies or functions are modified.
create table if not exists public.interview_requests (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.applications(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','accepted','declined','scheduled','cancelled')),
  message text not null default '' check (char_length(message) <= 1000),
  reply_note text not null default '' check (char_length(reply_note) <= 1000),
  scheduled_slot_id uuid references public.company_interview_slots(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists interview_requests_student_status_idx
  on public.interview_requests(student_id, status, created_at desc);
create index if not exists interview_requests_company_status_idx
  on public.interview_requests(company_id, status, created_at desc);

alter table public.interview_requests enable row level security;
revoke all on public.interview_requests from public, anon, authenticated;
grant select on public.interview_requests to authenticated;

create policy interview_requests_read on public.interview_requests
  for select to authenticated
  using (
    student_id = (select auth.uid())
    or exists (
      select 1 from public.companies c
      where c.id = interview_requests.company_id
        and c.owner_id = (select auth.uid())
        and c.status = 'active'::public.account_status
    )
    or (select public.is_admin())
  );

-- Mutations are only exposed through narrowly scoped, audited RPC functions.
create or replace function public.create_interview_request(
  p_application_id uuid, p_message text default ''
) returns uuid
language plpgsql security definer set search_path=''
as $$
declare v_student uuid; v_company uuid; v_id uuid; v_status text;
begin
  if auth.uid() is null or p_application_id is null then
    raise exception 'Giriş və müraciət tələb olunur' using errcode='42501';
  end if;
  if char_length(coalesce(p_message,'')) > 1000 then
    raise exception 'Mesaj 1000 simvoldan çox ola bilməz';
  end if;
  select a.student_id,j.company_id into v_student,v_company
    from public.applications a
    join public.jobs j on j.id=a.job_id
    join public.companies c on c.id=j.company_id
    join public.profiles p on p.id=a.student_id
    where a.id=p_application_id
      and a.student_id=auth.uid()
      and p.role in ('student'::public.user_role,'graduate'::public.user_role)
      and p.status='active'::public.account_status
      and c.status='active'::public.account_status;
  if v_student is null then
    raise exception 'Bu müraciət üzrə sorğu göndərməyə icazə yoxdur' using errcode='42501';
  end if;
  insert into public.interview_requests(application_id,student_id,company_id,message)
    values(p_application_id,v_student,v_company,trim(coalesce(p_message,'')))
    on conflict(application_id) do update set
      status='pending',message=excluded.message,reply_note='',scheduled_slot_id=null,
      updated_at=now(),created_at=now()
    where public.interview_requests.status in ('cancelled','declined')
    returning id into v_id;
  if v_id is null then
    raise exception 'Bu müraciət üçün artıq aktiv müsahibə sorğusu var';
  end if;
  return v_id;
end;
$$;

create or replace function public.respond_interview_request(
  p_request_id uuid, p_decision text, p_reply_note text default ''
) returns uuid
language plpgsql security definer set search_path=''
as $$
declare v_id uuid;
begin
  if auth.uid() is null or p_decision not in ('accepted','declined') then
    raise exception 'Etibarsız müsahibə qərarı' using errcode='42501';
  end if;
  if char_length(coalesce(p_reply_note,'')) > 1000 then
    raise exception 'Cavab 1000 simvoldan çox ola bilməz';
  end if;
  update public.interview_requests r set
    status=p_decision,reply_note=trim(coalesce(p_reply_note,'')),updated_at=now()
    where r.id=p_request_id and r.status='pending'
      and exists (
        select 1 from public.companies c
        join public.profiles p on p.id=c.owner_id
        where c.id=r.company_id and c.owner_id=auth.uid()
          and c.status='active'::public.account_status
          and p.status='active'::public.account_status
          and p.role='company'::public.user_role
      )
    returning r.id into v_id;
  if v_id is null then
    raise exception 'Sorğu tapılmadı, artıq cavablandırılıb və ya icazəniz yoxdur' using errcode='42501';
  end if;
  return v_id;
end;
$$;

create or replace function public.cancel_interview_request(p_request_id uuid)
returns uuid
language plpgsql security definer set search_path=''
as $$
declare v_id uuid;
begin
  update public.interview_requests r set status='cancelled', updated_at=now()
    where r.id=p_request_id and r.student_id=auth.uid()
      and r.status in ('pending','accepted')
    returning r.id into v_id;
  if v_id is null then
    raise exception 'Yalnız aktiv sorğunuzu ləğv edə bilərsiniz' using errcode='42501';
  end if;
  return v_id;
end;
$$;

-- Exactly one official notification is generated for each meaningful state change.
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
  if tg_op = 'INSERT' or (tg_op='UPDATE' and new.status='pending' and old.status is distinct from new.status) then
    if v_owner is not null then
      insert into public.notifications(profile_id,kind,title,body,link)
      values (v_owner,'interview_request','Yeni müsahibə sorğusu',
        coalesce(v_job,'Vakansiya')||' üzrə namizəd müsahibə istəyir.','interview-inbox');
    end if;
  elsif tg_op='UPDATE' and new.status is distinct from old.status then
    if new.status = 'accepted' then
      insert into public.notifications(profile_id,kind,title,body,link)
        values (new.student_id,'interview_request','Müsahibə sorğunuz qəbul edildi',
          coalesce(v_job,'Vakansiya')||' üzrə şirkət görüş təyin edə bilər.','interview-requests');
    elsif new.status = 'declined' then
      insert into public.notifications(profile_id,kind,title,body,link)
        values (new.student_id,'interview_request','Müsahibə sorğunuza cavab verildi',
          coalesce(v_job,'Vakansiya')||' üzrə sorğu qəbul edilmədi.','interview-requests');
    elsif new.status = 'cancelled' and v_owner is not null then
      insert into public.notifications(profile_id,kind,title,body,link)
        values (v_owner,'interview_request','Müsahibə sorğusu ləğv olundu',
          coalesce(v_job,'Vakansiya')||' üzrə namizəd sorğunu geri götürdü.','interview-inbox');
    end if;
    -- Scheduled interview already generates the student notification via the
    -- existing company_interview_slots_notify trigger. Avoid double-notifying.
  end if;
  return new;
end;
$$;

create trigger interview_requests_notify
  after insert or update of status on public.interview_requests
  for each row execute function public.notify_interview_request();

create or replace function public.sync_interview_request_on_slot()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.status='scheduled' then
    update public.interview_requests r
    set status='scheduled',scheduled_slot_id=new.id,updated_at=now()
    where r.application_id=new.application_id and r.status='accepted';
  end if;
  return new;
end;
$$;

create trigger interview_request_slot_sync
  after insert on public.company_interview_slots
  for each row execute function public.sync_interview_request_on_slot();

revoke all on function public.create_interview_request(uuid,text) from public,anon;
revoke all on function public.respond_interview_request(uuid,text,text) from public,anon;
revoke all on function public.cancel_interview_request(uuid) from public,anon;
grant execute on function public.create_interview_request(uuid,text) to authenticated;
grant execute on function public.respond_interview_request(uuid,text,text) to authenticated;
grant execute on function public.cancel_interview_request(uuid) to authenticated;
revoke all on function public.notify_interview_request() from public,anon,authenticated;
revoke all on function public.sync_interview_request_on_slot() from public,anon,authenticated;
