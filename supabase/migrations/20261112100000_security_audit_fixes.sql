-- Security audit fixes (report "Yekun Təhlükəsizlik və Arxitektura Audit Hesabatı", 2026-11-12).
-- Every statement is safe on the live database: functions are replaced with the
-- production logic plus the fixes, triggers are recreated, new constraints
-- start NOT VALID and are validated when the existing rows allow it.

-- ---------------------------------------------------------------------------
-- H-02: the guard functions and their triggers were created in the dashboard
-- and existed only in production. They are now defined here.
-- ---------------------------------------------------------------------------

-- Only staff (or trusted server code) change a company's status.
create or replace function public.guard_company_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if new.status is distinct from old.status then
    raise exception 'Şirkət statusunu yalnız Karyera Mərkəzi dəyişə bilər'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_company_status() from public, anon, authenticated;
drop trigger if exists companies_guard_status on public.companies;
create trigger companies_guard_status before update on public.companies
  for each row execute function public.guard_company_status();

-- Only staff publish or close vacancies. M-04: when an approved or published
-- vacancy's public content (text, links, conditions) changes, it goes back to
-- review, so a reviewed listing cannot later be pointed at another site.
create or replace function public.guard_job_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if new.status is distinct from old.status
     and new.status::text in ('approved','published','rejected','changes_requested','expired','archived') then
    raise exception 'Elanın statusunu yalnız Karyera Mərkəzi dəyişə bilər'
      using errcode = 'insufficient_privilege';
  end if;
  if old.status::text in ('approved','published') and (
       new.title, new.type, new.mode, new.location, new.duration, new.pay, new.summary, new.duties, new.requirements,
       new.skills, new.preferred_skills, new.faculty_ids, new.major_ids, new.min_course, new.min_gpa, new.department,
       new.salary_min, new.salary_max, new.currency, new.salary_visible, new.experience_level,
       new.application_method, new.application_url
     ) is distinct from (
       old.title, old.type, old.mode, old.location, old.duration, old.pay, old.summary, old.duties, old.requirements,
       old.skills, old.preferred_skills, old.faculty_ids, old.major_ids, old.min_course, old.min_gpa, old.department,
       old.salary_min, old.salary_max, old.currency, old.salary_visible, old.experience_level,
       old.application_method, old.application_url
     ) then
    new.status := 'pending';
    new.approved_at := null;
    new.approved_by := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_job_status() from public, anon, authenticated;
drop trigger if exists jobs_guard_status on public.jobs;
create trigger jobs_guard_status before update on public.jobs
  for each row execute function public.guard_job_status();

-- Users cannot change their role, account state or alumni verification.
-- Low finding: the profile email (shown on candidate cards) follows the sign-in
-- account and cannot be edited directly either. The education status
-- (account_status) stays self-reported by design; alumni_verified is the
-- trusted signal and only staff set it.
create or replace function public.guard_profile_privileges()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.is_admin() then
    new.updated_at := now();
    return new;
  end if;
  if new.role is distinct from old.role or new.status is distinct from old.status then
    raise exception 'Rol və hesab statusunu dəyişmək icazəsi yoxdur' using errcode = 'insufficient_privilege';
  end if;
  if new.alumni_verified is distinct from old.alumni_verified then
    raise exception 'Məzun təsdiqini yalnız Karyera Mərkəzi dəyişə bilər' using errcode = 'insufficient_privilege';
  end if;
  if new.email is distinct from old.email then
    raise exception 'E-poçt ünvanı giriş hesabından idarə olunur' using errcode = 'insufficient_privilege';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.guard_profile_privileges() from public, anon, authenticated;
drop trigger if exists profiles_guard_privileges on public.profiles;
create trigger profiles_guard_privileges before update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- H-01: a new account never starts as a verified alumnus; staff verify it.
-- (The other half of H-01, email confirmation, is an Auth setting: see
-- docs/IT-HANDOVER.md §4.4.)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested text := lower(coalesce(new.raw_user_meta_data ->> 'role', 'student'));
  requested_status text := lower(coalesce(new.raw_user_meta_data ->> 'account_status', 'student'));
  provider text := coalesce(new.raw_app_meta_data ->> 'provider', 'email');
  safe_role public.user_role;
  new_status public.account_status;
  is_uni boolean := lower(new.email) like '%@asoiu.edu.az';
  disp text;
  new_company uuid;
  selected_plan text := coalesce(new.raw_user_meta_data ->> 'plan_id','free');
  v_start integer;
  v_end integer;
begin
  if requested='company' then
    safe_role := 'company';
  elsif requested in ('graduate','alumni') then
    safe_role := 'graduate';
    requested_status := 'alumni';
  else
    safe_role := 'student';
    if requested_status not in ('student','master_student') then requested_status := 'student'; end if;
  end if;
  if provider <> 'email' and not is_uni and safe_role <> 'graduate' then
    raise exception 'Universitet girişi üçün @asoiu.edu.az hesabı tələb olunur' using errcode='check_violation';
  end if;
  if safe_role='student' and not is_uni then
    raise exception 'Tələbə qeydiyyatı üçün @asoiu.edu.az e-poçtu tələb olunur' using errcode='check_violation';
  end if;
  new_status := case when safe_role='company' or (safe_role='graduate' and not is_uni) then 'pending' else 'active' end;
  disp := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'),''),split_part(new.email,'@',1));

  insert into public.profiles(id,role,status,email,full_name,phone,university,group_name,avatar_url,account_status,alumni_verified)
  values(new.id,safe_role,new_status,new.email,disp,
    coalesce(new.raw_user_meta_data ->> 'phone',''),
    coalesce(nullif(new.raw_user_meta_data ->> 'university',''),'Azərbaycan Dövlət Neft və Sənaye Universiteti'),
    coalesce(new.raw_user_meta_data ->> 'group_name',''),
    nullif(new.raw_user_meta_data ->> 'avatar_url',''),
    requested_status,false);

  if safe_role in ('student','graduate') then
    v_start := nullif(new.raw_user_meta_data ->> 'bachelor_start_year','')::integer;
    v_end := nullif(new.raw_user_meta_data ->> 'bachelor_end_year','')::integer;
    if nullif(new.raw_user_meta_data ->> 'major_name','') is not null then
      insert into public.education(profile_id,degree_type,university,faculty,specialty,group_name,start_year,graduation_year,is_current)
      values(new.id,'bachelor',coalesce(nullif(new.raw_user_meta_data ->> 'university',''),'Azərbaycan Dövlət Neft və Sənaye Universiteti'),
        coalesce(new.raw_user_meta_data ->> 'faculty_name',''),new.raw_user_meta_data ->> 'major_name',
        coalesce(new.raw_user_meta_data ->> 'group_name',''),v_start,v_end,requested_status='student');
    end if;
    if requested_status='master_student' and nullif(new.raw_user_meta_data ->> 'master_specialty','') is not null then
      insert into public.education(profile_id,degree_type,university,faculty,specialty,specialization,group_name,start_year,graduation_year,is_current)
      values(new.id,'master',new.raw_user_meta_data ->> 'master_university',coalesce(new.raw_user_meta_data ->> 'master_faculty',''),
        new.raw_user_meta_data ->> 'master_specialty',coalesce(new.raw_user_meta_data ->> 'master_specialization',''),
        coalesce(new.raw_user_meta_data ->> 'master_group',''),nullif(new.raw_user_meta_data ->> 'master_start_year','')::integer,
        nullif(new.raw_user_meta_data ->> 'master_end_year','')::integer,true);
    end if;
  end if;

  if safe_role='company' then
    insert into public.companies(owner_id,name,email,phone,website,sector,company_size,address,logo_url,about,contact,contact_position,contact_email,contact_phone,status)
    values(new.id,coalesce(nullif(new.raw_user_meta_data ->> 'company_name',''),disp),new.email,
      coalesce(new.raw_user_meta_data ->> 'phone',''),nullif(new.raw_user_meta_data ->> 'website',''),coalesce(new.raw_user_meta_data ->> 'sector',''),
      coalesce(new.raw_user_meta_data ->> 'company_size',''),coalesce(new.raw_user_meta_data ->> 'address',''),nullif(new.raw_user_meta_data ->> 'logo_url',''),
      coalesce(new.raw_user_meta_data ->> 'description',''),coalesce(new.raw_user_meta_data ->> 'contact_name',''),
      coalesce(new.raw_user_meta_data ->> 'contact_position',''),coalesce(new.raw_user_meta_data ->> 'contact_email',''),
      coalesce(new.raw_user_meta_data ->> 'contact_phone',''),'pending')
    returning id into new_company;
    if not exists(select 1 from public.plans where id=selected_plan and active) then selected_plan := 'free'; end if;
    insert into public.subscriptions(company_id,plan_id,status)
    values(new_company,selected_plan,case when selected_plan='free' then 'active' else 'pending' end);
    insert into public.company_members(company_id,profile_id,member_role,status)
    values(new_company,new.id,'owner','active');
  end if;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- M-06: the assistant voice bucket and its policies (an admin's own folder).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('assistant-audio', 'assistant-audio', false, 10485760, array['audio/wav', 'audio/x-wav'])
on conflict (id) do nothing;

drop policy if exists assistant_audio_admin_select on storage.objects;
create policy assistant_audio_admin_select on storage.objects for select to authenticated
  using (bucket_id = 'assistant-audio' and (select public.is_admin())
         and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists assistant_audio_admin_insert on storage.objects;
create policy assistant_audio_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'assistant-audio' and (select public.is_admin())
              and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists assistant_audio_admin_delete on storage.objects;
create policy assistant_audio_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'assistant-audio' and (select public.is_admin())
         and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Low finding: site images (public-media) are uploaded by super admins,
-- managers and editors; only super admins and managers replace or delete them.
drop policy if exists public_media_admin_insert on storage.objects;
create policy public_media_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'public-media' and coalesce((select public.current_admin_role()), '') in ('super_admin', 'manager', 'editor'));
drop policy if exists public_media_admin_update on storage.objects;
create policy public_media_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'public-media' and coalesce((select public.current_admin_role()), '') in ('super_admin', 'manager'))
  with check (bucket_id = 'public-media' and coalesce((select public.current_admin_role()), '') in ('super_admin', 'manager'));
drop policy if exists public_media_admin_delete on storage.objects;
create policy public_media_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'public-media' and coalesce((select public.current_admin_role()), '') in ('super_admin', 'manager'));

-- ---------------------------------------------------------------------------
-- M-08: the moderation webhook may point at any HTTPS host (self-hosted
-- servers included) or at the in-cluster gateway over plain HTTP.
-- ---------------------------------------------------------------------------
alter table private.moderation_webhook_config drop constraint if exists moderation_webhook_config_endpoint_check;
alter table private.moderation_webhook_config add constraint moderation_webhook_config_endpoint_check check (
  endpoint ~ '^https://[a-z0-9.-]+(:[0-9]+)?/functions/v1/content-moderation$'
  or endpoint ~ '^http://(127\.0\.0\.1|localhost|kong|api-gw)(:[0-9]+)?/functions/v1/content-moderation$');

-- ---------------------------------------------------------------------------
-- Low finding: links people click and images the pages load must be web URLs
-- (no javascript:, data: or other schemes). Event images already have
-- events_image_url_https; ads, award and partner logos have their own checks.
-- ---------------------------------------------------------------------------
alter table public.jobs drop constraint if exists jobs_application_url_web;
alter table public.jobs add constraint jobs_application_url_web
  check (application_url is null or application_url = '' or application_url ~* '^https?://[^[:space:]]+$') not valid;
alter table public.posts drop constraint if exists posts_link_url_web;
alter table public.posts add constraint posts_link_url_web
  check (link_url is null or link_url = '' or link_url ~* '^https?://[^[:space:]]+$') not valid;
alter table public.companies drop constraint if exists companies_website_web;
alter table public.companies add constraint companies_website_web
  check (website is null or website = '' or website ~* '^https?://[^[:space:]]+$') not valid;
alter table public.companies drop constraint if exists companies_logo_url_web;
alter table public.companies add constraint companies_logo_url_web
  check (logo_url is null or logo_url = '' or logo_url ~* '^https://[^[:space:]]+$') not valid;
alter table public.companies drop constraint if exists companies_cover_url_web;
alter table public.companies add constraint companies_cover_url_web
  check (cover_url is null or cover_url = '' or cover_url ~* '^https://[^[:space:]]+$') not valid;
alter table public.benefit_partners drop constraint if exists benefit_partners_website_web;
alter table public.benefit_partners add constraint benefit_partners_website_web
  check (website is null or website = '' or website ~* '^https?://[^[:space:]]+$') not valid;

-- Existing rows: validate where they already comply; otherwise the constraint
-- still protects every new or edited row and a notice lists it for cleanup.
do $$
declare c record;
begin
  for c in select conrelid::regclass as tbl, conname from pg_constraint
    where conname in ('jobs_application_url_web','posts_link_url_web','companies_website_web','companies_logo_url_web',
                      'companies_cover_url_web','benefit_partners_website_web') and not convalidated
  loop
    begin
      execute format('alter table %s validate constraint %I', c.tbl, c.conname);
    exception when check_violation then
      raise notice 'Existing rows in % break %; fix them, then VALIDATE CONSTRAINT.', c.tbl, c.conname;
    end;
  end loop;
end $$;
