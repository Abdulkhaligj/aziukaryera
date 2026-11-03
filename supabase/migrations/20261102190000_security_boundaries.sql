-- Security remediation F01/F02/F03/F07/F08/F11/F13/F14.
-- Requires the complete original schema plus the preceding migrations. This is
-- an upgrade, not a replacement for the missing base schema in the handover.
begin;

create or replace function public.current_admin_role()
returns text language sql stable security definer set search_path = '' as $$
  select p.admin_role
  from public.profiles p join auth.users u on u.id = p.id
  where p.id = (select auth.uid()) and p.role::text = 'admin' and p.status::text = 'active'
    and p.admin_role in ('super_admin','manager','editor','reviewer')
    and p.admin_role = u.raw_app_meta_data ->> 'admin_role'
    and p.admin_role = (select auth.jwt() -> 'app_metadata' ->> 'admin_role')
    and coalesce(u.raw_app_meta_data ->> 'must_change_password', 'false') = 'false'
    and coalesce((select auth.jwt() -> 'app_metadata' ->> 'must_change_password'), 'false') = 'false';
$$;
revoke all on function public.current_admin_role() from public, anon;
grant execute on function public.current_admin_role() to authenticated, service_role;

create or replace function private.is_admin_check()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_admin_role() is not null;
$$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_admin_role() is not null;
$$;
create or replace function private.is_billing_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_admin_role() in ('super_admin','manager'), false);
$$;

-- Identify a staff principal even while suspended, demoted, or waiting for a
-- password change, so a broad owner policy cannot bypass staff restrictions.
create or replace function private.actor_is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'admin')
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') <> '';
$$;

create or replace function private.admin_can(p_action text, p_resource text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare r text := public.current_admin_role();
begin
  if r is null then return false; end if;
  if p_resource = 'admins' then return r = 'super_admin'; end if;
  if p_action = 'select' then return true; end if;
  if p_action = 'insert' and p_resource not in
    ('jobs','companies','events','benefits','benefit_partners','company_awards','ads','site_content','content','students','admins','plan_features') then return false; end if;
  if p_action = 'update' and p_resource not in
    ('jobs','companies','events','benefits','benefit_partners','company_awards','site_content','content','applications','posts','reports','mentor_requests','students','subscriptions','plans','plan_features','subscription_usage','payments','ads','company_partnership_requests','company_interview_slots') then return false; end if;
  if p_action = 'delete' and p_resource not in
    ('jobs','companies','events','benefits','benefit_partners','company_awards','site_content','content','applications','posts','reports','students','subscriptions','payments','ads','cv_documents','interview_sessions','ai_usage','notifications') then return false; end if;
  if r in ('super_admin','manager') then return true; end if;
  if r = 'editor' then return p_action <> 'delete' and
    (p_resource in ('jobs','companies','events','benefits','benefit_partners','company_awards','site_content','content')
      or (p_action = 'update' and p_resource in ('applications','posts','reports','mentor_requests'))); end if;
  return r = 'reviewer' and p_action = 'update' and p_resource in ('applications','posts','reports','mentor_requests');
end;
$$;
revoke all on function private.actor_is_staff() from public, anon;
revoke all on function private.admin_can(text,text) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.actor_is_staff(), private.admin_can(text,text) to authenticated;

-- Restrictive policies AND with every permissive legacy policy. Additions to
-- a permissive policy must never reopen the role matrix by OR composition.
do $$
declare t text; a text; resource text; expr text;
begin
  foreach t in array array['profiles','education','companies','jobs','events','benefits','benefit_partners',
    'company_awards','site_content','content','applications','posts','reports','mentor_requests',
    'subscriptions','plans','plan_features','subscription_usage','payments','ads','cv_documents',
    'interview_sessions','ai_usage','notifications','company_members','moderation_logs',
    'broadcast_notifications','company_partnership_requests','company_interview_slots'] loop
    if to_regclass('public.' || t) is null then
      raise exception 'Missing required baseline relation public.%', t;
    end if;
    execute format('alter table public.%I enable row level security', t);
    foreach a in array array['insert','update','delete'] loop
      resource := case when t = 'profiles' then 'students' when t = 'education' then 'students' else t end;
      if t = 'profiles' then
        expr := format('(not private.actor_is_staff() or private.admin_can(%L, case when role::text = ''admin'' then ''admins'' else ''students'' end))', a);
      else
        expr := format('(not private.actor_is_staff() or private.admin_can(%L,%L))', a, resource);
      end if;
      execute format('drop policy if exists %I on public.%I', 'security_staff_' || a, t);
      execute format('create policy %I on public.%I as restrictive for %s to authenticated %s',
        'security_staff_' || a, t, a,
        case when a = 'insert' then 'with check (' || expr || ')'
          when a = 'delete' then 'using (' || expr || ')'
          else 'using (' || expr || ') with check (' || expr || ')' end);
    end loop;
  end loop;
end $$;

-- Limited moderators may change the fields exposed by their API, rather than
-- inherit an admin guard exemption for every column in the underlying row.
-- This runs BEFORE existing normalization/moderation triggers, so server-made
-- moderation timestamps are not mistaken for client-supplied columns.
create or replace function private.limited_admin_fields_guard()
returns trigger language plpgsql set search_path = '' as $$
declare allowed text[];
begin
  if coalesce(public.current_admin_role(),'') not in ('reviewer','editor') then return new; end if;
  allowed := case tg_table_name
    when 'applications' then array['status','note']
    when 'posts' then array['moderation_status']
    when 'reports' then array['status','reviewed_by','reviewed_at']
    when 'mentor_requests' then array['status','mentor_name','admin_note','updated_at']
  end;
  if (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
    raise exception 'Limited administrators may only change moderation fields' using errcode='42501';
  end if;
  if tg_table_name = 'reports' then
    if new.reviewed_by is distinct from old.reviewed_by and new.reviewed_by is distinct from auth.uid() then
      raise exception 'Review attribution must match the current administrator' using errcode='42501';
    end if;
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  elsif tg_table_name = 'mentor_requests' then
    new := jsonb_populate_record(new,jsonb_build_object('updated_at',now()));
  end if;
  return new;
end $$;
revoke all on function private.limited_admin_fields_guard() from public, anon, authenticated;
do $$ declare t text;
begin
  foreach t in array array['applications','posts','reports','mentor_requests'] loop
    execute format('drop trigger if exists "000_security_limited_admin_fields" on public.%I',t);
    execute format('create trigger "000_security_limited_admin_fields" before update on public.%I for each row execute function private.limited_admin_fields_guard()',t);
  end loop;
end $$;

-- No browser/client may author provider accounting, including forged success
-- rows for another company. The service role remains the only writer.
revoke insert, update on public.ai_usage from authenticated, anon, public;
drop policy if exists security_ai_usage_insert on public.ai_usage;
create policy security_ai_usage_insert on public.ai_usage as restrictive for insert to authenticated with check (false);
drop policy if exists security_ai_usage_update on public.ai_usage;
create policy security_ai_usage_update on public.ai_usage as restrictive for update to authenticated using (false) with check (false);

-- Expiry is an access predicate; cron only materializes state/notifications.
create or replace function public.company_has_feature(p_company_id uuid, p_feature_key text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.subscriptions s
    join public.plan_features pf on pf.plan_id = s.plan_id
    where s.company_id = p_company_id and s.status::text = 'active'
      and (s.starts_at is null or s.starts_at <= now())
      and (s.plan_id = 'free' or s.ends_at > now()) and pf.feature_key = p_feature_key and pf.enabled);
$$;
create or replace function public.company_feature_limit(p_company_id uuid, p_feature_key text)
returns integer language sql stable security invoker set search_path = '' as $$
  select pf.limit_value from public.subscriptions s
    join public.plan_features pf on pf.plan_id = s.plan_id
    where s.company_id = p_company_id and s.status::text = 'active'
      and (s.starts_at is null or s.starts_at <= now())
      and (s.plan_id = 'free' or s.ends_at > now()) and pf.feature_key = p_feature_key and pf.enabled
    order by s.starts_at desc nulls last limit 1;
$$;

create or replace function private.can_read_profile(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_id = auth.uid() or public.is_admin() or exists(
    select 1 from public.applications a join public.jobs j on j.id = a.job_id
    join public.companies c on c.id = j.company_id
    join public.profiles owner on owner.id = c.owner_id
    join public.profiles student on student.id = a.student_id
    where a.student_id = p_id and c.owner_id = auth.uid() and c.status::text = 'active'
      and owner.status::text = 'active' and owner.role::text = 'company'
      and student.status::text = 'active' and student.role::text in ('student','graduate'));
$$;
revoke all on function private.can_read_profile(uuid) from public, anon;
grant execute on function private.can_read_profile(uuid) to authenticated;
drop policy if exists security_profile_private_read on public.profiles;
create policy security_profile_private_read on public.profiles as restrictive for select to authenticated
  using (private.can_read_profile(id));
drop policy if exists security_education_private_read on public.education;
create policy security_education_private_read on public.education as restrictive for select to authenticated
  using (private.can_read_profile(profile_id));

-- Expose only the existing Talent Pool card fields. Definer access is bounded
-- by an explicit current company/subscription or actual application relation.
create or replace function public.candidate_profiles()
returns table(id uuid, full_name text, role text, status text, faculty_id text, major_id text,
  course integer, gpa numeric, skills text[], summary text, account_status text)
language sql stable security definer set search_path = '' as $$
  select p.id,p.full_name,p.role::text,p.status::text,p.faculty_id::text,p.major_id::text,
         p.course::integer,p.gpa::numeric,p.skills,p.summary,p.account_status::text
  from public.profiles p
  where auth.uid() is not null and p.role::text in ('student','graduate') and p.status::text = 'active'
    and (private.can_read_profile(p.id) or exists(
      select 1 from public.companies c join public.profiles actor on actor.id = c.owner_id
      join public.subscriptions s on s.company_id = c.id
      join public.plan_features pf on pf.plan_id = s.plan_id
      where c.owner_id = auth.uid() and c.status::text = 'active'
        and actor.role::text = 'company' and actor.status::text = 'active'
        and s.status::text = 'active' and (s.starts_at is null or s.starts_at <= now())
        and (s.plan_id = 'free' or s.ends_at > now())
        and pf.feature_key = 'candidate_search' and pf.enabled));
$$;
revoke all on function public.candidate_profiles() from public, anon;
grant execute on function public.candidate_profiles() to authenticated;

drop policy if exists security_jobs_read on public.jobs;
create policy security_jobs_read on public.jobs as restrictive for select to authenticated
  using (status::text in ('approved','published') or public.is_admin() or public.owns_company(company_id));
drop policy if exists security_companies_read on public.companies;
create policy security_companies_read on public.companies as restrictive for select to authenticated
  using (status::text = 'active' or public.is_admin() or public.owns_company(id));

create or replace function private.education_verification_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon','authenticated') and not coalesce(public.current_admin_role() in ('super_admin','manager'),false) then
    if (tg_op = 'INSERT' and new.verified is true)
       or (tg_op = 'UPDATE' and new.verified is distinct from old.verified) then
      raise exception 'Education verification requires an authorized staff account' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.education_verification_guard() from public, anon, authenticated;
drop trigger if exists security_education_verification on public.education;
create trigger security_education_verification before insert or update on public.education
  for each row execute function private.education_verification_guard();

-- Transactional, non-PII backstop: a failed audit insert aborts the business
-- write. Covers newer resources as well as the five legacy audited tables.
create or replace function private.audit_security_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare row_data jsonb; rid uuid;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  begin rid := nullif(row_data ->> 'id','')::uuid; exception when invalid_text_representation then rid := null; end;
  insert into public.admin_audit_logs(title,resource,resource_id,action,actor_id,actor_name)
  values ('Database ' || lower(tg_op) || ': ' || tg_table_name, tg_table_name, rid,
    'db_' || lower(tg_op), auth.uid(), coalesce((select p.full_name from public.profiles p where p.id = auth.uid()),'System'));
  return coalesce(new,old);
end $$;
revoke all on function private.audit_security_change() from public, anon, authenticated;
do $$ declare t text;
begin
  foreach t in array array['profiles','education','companies','jobs','events','benefits','benefit_partners',
    'company_awards','site_content','content','applications','posts','reports','mentor_requests','subscriptions',
    'plans','plan_features','payments','ads','company_members','moderation_logs','broadcast_notifications',
    'company_partnership_requests','company_interview_slots'] loop
    execute format('drop trigger if exists security_audit_changes on public.%I', t);
    execute format('create trigger security_audit_changes after insert or update or delete on public.%I for each row execute function private.audit_security_change()', t);
  end loop;
end $$;

-- These operational records are deleted by the admin API. Audit removals
-- transactionally without logging every high-volume usage/notification insert.
do $$ declare t text;
begin
  foreach t in array array['cv_documents','interview_sessions','ai_usage','notifications'] loop
    execute format('drop trigger if exists security_audit_deletes on public.%I',t);
    execute format('create trigger security_audit_deletes after delete on public.%I for each row execute function private.audit_security_change()',t);
  end loop;
end $$;

-- Active vacancy publication uses the same strict expiry and retains the one-vacancy Free fallback.
create or replace function public.enforce_company_job_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_count integer;
begin
  if public.is_admin() then return new; end if;
  if new.status::text not in ('pending','pending_approval','approved','published') then return new; end if;

  select pf.limit_value into v_limit
  from public.subscriptions s
  join public.plan_features pf on pf.plan_id=s.plan_id and pf.feature_key='active_vacancies' and pf.enabled
  where s.company_id=new.company_id and s.status='active' and (s.starts_at is null or s.starts_at <= now()) and (s.plan_id='free' or s.ends_at > now())
  limit 1;
  if not found then v_limit := 1; end if;

  if v_limit is not null then
    select count(*) into v_count
    from public.jobs j
    where j.company_id=new.company_id
      and j.status::text in ('pending','pending_approval','approved','published')
      and (tg_op='INSERT' or j.id<>new.id);
    if v_count >= v_limit then
      raise exception 'Paketinizin aktiv vakansiya limiti dolub';
    end if;
  end if;
  return new;
end;
$$;

-- Enforce the same expiry in definer triggers, which do not rely on RLS.
create or replace function public.enforce_company_post_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_limit integer;
  v_count integer;
  v_media boolean;
begin
  select c.id into v_company
  from public.companies c
  where c.owner_id=new.author_id and c.status='active'
  limit 1;
  if v_company is null then return new; end if;

  select pf.limit_value into v_limit
  from public.subscriptions s join public.plan_features pf on pf.plan_id=s.plan_id
  where s.company_id=v_company and s.status='active' and (s.starts_at is null or s.starts_at <= now()) and (s.plan_id='free' or s.ends_at > now()) and pf.feature_key='monthly_network_posts' and pf.enabled
  limit 1;
  if not found then raise exception 'Aktiv şirkət paketiniz yoxdur'; end if;

  if v_limit is not null then
    select count(*) into v_count from public.posts p
    where p.author_id=new.author_id and p.created_at>=date_trunc('month',now()) and p.created_at<date_trunc('month',now())+interval '1 month';
    if v_count>=v_limit then raise exception 'Paketinizin aylıq paylaşım limiti dolub'; end if;
  end if;

  if new.attachment_url is not null then
    select exists(
      select 1 from public.subscriptions s join public.plan_features pf on pf.plan_id=s.plan_id
      where s.company_id=v_company and s.status='active' and (s.starts_at is null or s.starts_at <= now()) and (s.plan_id='free' or s.ends_at > now()) and pf.feature_key='post_media' and pf.enabled
    ) into v_media;
    if not v_media then raise exception 'Paketiniz şəkil və sənəd paylaşımını dəstəkləmir'; end if;
  end if;
  return new;
end;
$$;

-- Enforce the same expiry in definer triggers, which do not rely on RLS.
create or replace function public.enforce_post_media_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_company uuid;
begin
  select c.id into v_company
  from public.posts p join public.companies c on c.owner_id=p.author_id
  where p.id=new.post_id limit 1;
  if v_company is not null and not exists(
    select 1 from public.subscriptions s join public.plan_features pf on pf.plan_id=s.plan_id
    where s.company_id=v_company and s.status='active' and (s.starts_at is null or s.starts_at <= now()) and (s.plan_id='free' or s.ends_at > now()) and pf.feature_key='post_media' and pf.enabled
  ) then raise exception 'Paketiniz şəkil və sənəd paylaşımını dəstəkləmir'; end if;
  return new;
end;
$$;

-- Enforce the same expiry in definer triggers, which do not rely on RLS.
create or replace function public.enforce_company_team_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_limit integer; v_count integer;
begin
  if public.is_admin() then return new; end if;
  select pf.limit_value into v_limit
  from public.subscriptions s join public.plan_features pf on pf.plan_id=s.plan_id
  where s.company_id=new.company_id and s.status='active' and (s.starts_at is null or s.starts_at <= now()) and (s.plan_id='free' or s.ends_at > now()) and pf.feature_key='team_members' and pf.enabled limit 1;
  if not found then v_limit:=1; end if;
  if v_limit is not null then
    select count(*) into v_count from public.company_members m where m.company_id=new.company_id and m.status in ('invited','active') and m.id<>new.id;
    if v_count>=v_limit then raise exception 'Paketinizin komanda üzvü limiti dolub'; end if;
  end if;
  return new;
end;
$$;

-- Reset checks current DB/Auth role, including the password-change gate.
create or replace function private.reset_career_platform(p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_removed_users integer := 0;
  v_kept_admins integer := 0;
begin
  if p_confirmation <> 'SIFIRLA' then
    raise exception 'Sıfırlama təsdiqi yanlışdır';
  end if;

  if coalesce(public.current_admin_role(),'') <> 'super_admin' then
    raise exception 'Bu əməliyyatı yalnız aktiv Super Admin icra edə bilər';
  end if;

  perform set_config('lock_timeout', '5s', true);
  perform set_config('statement_timeout', '30s', true);

  -- Supabase safeupdate requires a WHERE clause on every DELETE. Child tables
  -- are cleared first so the operation remains atomic and foreign-key safe.
  delete from public.broadcast_notification_reads where true;
  delete from public.moderation_logs where true;
  delete from public.notifications where true;
  delete from public.ai_usage where true;
  delete from public.post_saves where true;
  delete from public.post_media where true;
  delete from public.post_comments where true;
  delete from public.post_likes where true;
  delete from public.messages where true;
  delete from public.connections where true;
  delete from public.follows where true;
  delete from public.reports where true;
  delete from public.benefit_claims where true;
  delete from public.event_registrations where true;
  delete from public.invites where true;
  delete from public.saved_jobs where true;
  delete from public.application_status_history where true;
  delete from public.applications where true;
  delete from public.payments where true;
  delete from public.subscription_usage where true;
  delete from public.interview_sessions where true;
  delete from public.cv_documents where true;
  delete from public.education where true;
  delete from public.company_members where true;
  delete from public.subscriptions where true;
  delete from public.jobs where true;
  delete from public.events where true;
  delete from public.benefits where true;
  delete from public.benefit_partners where true;
  delete from public.posts where true;
  delete from public.broadcast_notifications where true;
  delete from public.companies where true;
  delete from public.site_content where true;
  delete from public.content where true;
  delete from public.audit_logs where true;
  delete from public.admin_audit_logs where true;

  -- Deleting Auth users cascades to their profiles. All administrator seats
  -- are deliberately retained.
  delete from auth.users as auth_user
  where not exists (
    select 1
    from public.profiles profile
    where profile.id = auth_user.id
      and profile.role = 'admin'::public.user_role
  );
  get diagnostics v_removed_users = row_count;

  select count(*) into v_kept_admins
  from public.profiles profile
  where profile.role = 'admin'::public.user_role;

  insert into public.admin_audit_logs
    (title, resource, resource_id, action, actor_id, actor_name)
  select
    'Platforma məlumatları sıfırlandı',
    'system',
    null,
    'reset',
    v_actor,
    profile.full_name
  from public.profiles profile
  where profile.id = v_actor;

  return jsonb_build_object(
    'ok', true,
    'removed_users', v_removed_users,
    'kept_admins', v_kept_admins
  );
end;
$$;

-- Safe Talent Pool projection is used by the batched and fallback paths.
create or replace function public.career_bootstrap_v1()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'Hesaba daxil olmaq tələb olunur.' using errcode='28000';
  end if;
  return (
    select jsonb_build_object(
      'uid', me,
      'email', coalesce(auth.jwt()->>'email', ''),
      'faculties', (select coalesce(jsonb_agg(to_jsonb(f) order by f.sort_order),'[]'::jsonb) from public.faculties f),
      'majors', (select coalesce(jsonb_agg(to_jsonb(m)),'[]'::jsonb) from public.majors m),
      'profile', (select to_jsonb(p) from public.profiles p where p.id = me limit 1),
      'education', (select coalesce(jsonb_agg(to_jsonb(e) order by e.start_year asc),'[]'::jsonb) from public.education e where e.profile_id = me),
      'candidates', (select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
        select id,full_name,role,status,faculty_id,major_id,course,gpa,skills,summary,account_status
        from public.candidate_profiles()
      ) x),
      'companies', (select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) from public.companies c),
      'jobs', (select coalesce(jsonb_agg(to_jsonb(j)),'[]'::jsonb) from public.jobs j),
      'applications', (select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from public.applications a),
      'saved', (select coalesce(jsonb_agg(s.job_id),'[]'::jsonb) from public.saved_jobs s),
      'invites', (select coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) from public.invites i),
      'events', (select coalesce(jsonb_agg(to_jsonb(e) order by e.starts_at asc),'[]'::jsonb) from public.events e),
      'eventRegistrations', (select coalesce(jsonb_agg(r.event_id),'[]'::jsonb) from public.event_registrations r),
      'subscription', (select to_jsonb(s) || jsonb_build_object('status',case when s.plan_id <> 'free' and (s.ends_at is null or s.ends_at <= now() or s.starts_at > now()) then 'expired' else s.status::text end,'plans',to_jsonb(p))
        from public.subscriptions s left join public.plans p on p.id = s.plan_id
        order by (s.status='active') desc,s.starts_at desc limit 1),
      'notifications', (select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc),'[]'::jsonb)
        from (select * from public.notifications order by created_at desc limit 100) n),
      'broadcasts', (select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc),'[]'::jsonb)
        from (select * from public.broadcast_notifications order by created_at desc limit 100) n),
      'broadcastReads', (select coalesce(jsonb_agg(jsonb_build_object('broadcast_id',r.broadcast_id,'read_at',r.read_at)),'[]'::jsonb)
        from public.broadcast_notification_reads r)
    )
  );
end;
$$;
commit;
