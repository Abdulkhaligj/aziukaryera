-- Production core workflow for the connected ADNSU Career ecosystem.
-- Keeps the existing schema and data, while adding configurable SaaS limits,
-- company teams, richer registration data and auditable approval pipelines.

alter type public.job_status add value if not exists 'pending_approval';
alter type public.job_status add value if not exists 'changes_requested';
alter type public.job_status add value if not exists 'published';
alter type public.job_status add value if not exists 'expired';
alter type public.job_status add value if not exists 'archived';

alter type public.application_status add value if not exists 'applied';
alter type public.application_status add value if not exists 'under_review';
alter type public.application_status add value if not exists 'shortlisted';
alter type public.application_status add value if not exists 'interview';
alter type public.application_status add value if not exists 'offer';
alter type public.application_status add value if not exists 'rejected';
alter type public.application_status add value if not exists 'hired';

alter table public.profiles
  add column if not exists university text not null default 'Azərbaycan Dövlət Neft və Sənaye Universiteti',
  add column if not exists group_name text not null default '',
  add column if not exists avatar_url text;

alter table public.companies
  add column if not exists phone text not null default '',
  add column if not exists company_size text not null default '',
  add column if not exists address text not null default '',
  add column if not exists contact_position text not null default '',
  add column if not exists contact_email text not null default '',
  add column if not exists contact_phone text not null default '';

alter table public.jobs
  add column if not exists preferred_skills text[] not null default '{}',
  add column if not exists experience_level text not null default 'Təcrübə tələb olunmur',
  add column if not exists salary_visible boolean not null default false,
  add column if not exists positions integer not null default 1 check (positions > 0),
  add column if not exists application_method text not null default 'platform',
  add column if not exists application_url text,
  add column if not exists rejection_reason text,
  add column if not exists changes_requested text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.applications
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists company_note text not null default '',
  add column if not exists candidate_tags text[] not null default '{}';

alter table public.plans
  add column if not exists description text not null default '',
  add column if not exists updated_at timestamptz not null default now();

update public.plans
set currency = 'AZN',
    description = case id
      when 'free' then 'Platformaya başlamaq və əsas işə qəbul ehtiyacları üçün.'
      when 'pro' then 'Daimi işə qəbul, namizəd axtarışı və AI alətləri üçün.'
      when 'business' then 'Böyük komandalar, limitsiz elanlar və premium yerləşdirmə üçün.'
      else description
    end;

create table if not exists public.plan_features (
  plan_id text not null references public.plans(id) on delete cascade,
  feature_key text not null,
  label text not null,
  enabled boolean not null default true,
  limit_value integer check (limit_value is null or limit_value >= 0),
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (plan_id, feature_key)
);

create table if not exists public.subscription_usage (
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  feature_key text not null,
  period_start date not null,
  period_end date not null,
  used_count integer not null default 0 check (used_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (subscription_id, feature_key, period_start)
);

create table if not exists public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  member_role text not null default 'recruiter' check (member_role in ('owner','admin','recruiter','viewer')),
  status text not null default 'active' check (status in ('invited','active','suspended')),
  created_at timestamptz not null default now(),
  unique (company_id, profile_id)
);

create table if not exists public.application_status_history (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_by uuid references public.profiles(id) on delete set null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  media_type text not null check (media_type in ('image','pdf','document','link')),
  storage_path text,
  public_url text,
  title text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  check (storage_path is not null or public_url is not null)
);

create table if not exists public.follows (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followed_profile_id uuid references public.profiles(id) on delete cascade,
  followed_company_id uuid references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (num_nonnulls(followed_profile_id, followed_company_id) = 1)
);

create table if not exists public.moderation_logs (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references public.reports(id) on delete set null,
  target_type text not null,
  target_id uuid not null,
  action text not null check (action in ('approve','hide','delete','warn','suspend','restore')),
  reason text not null default '',
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  provider text not null default 'manual',
  provider_reference text,
  amount numeric(10,2) not null check (amount >= 0),
  currency text not null default 'AZN',
  status text not null default 'pending' check (status in ('pending','paid','failed','refunded','cancelled')),
  paid_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists jobs_company_status_idx on public.jobs(company_id, status, created_at desc);
create index if not exists applications_student_updated_idx on public.applications(student_id, updated_at desc);
create index if not exists application_history_application_idx on public.application_status_history(application_id, created_at desc);
create index if not exists company_members_company_idx on public.company_members(company_id, status);
create index if not exists post_media_post_idx on public.post_media(post_id, sort_order);
create index if not exists follows_profile_idx on public.follows(followed_profile_id) where followed_profile_id is not null;
create index if not exists follows_company_idx on public.follows(followed_company_id) where followed_company_id is not null;
create unique index if not exists follows_unique_profile_idx on public.follows(follower_id,followed_profile_id) where followed_profile_id is not null;
create unique index if not exists follows_unique_company_idx on public.follows(follower_id,followed_company_id) where followed_company_id is not null;
create index if not exists moderation_logs_target_idx on public.moderation_logs(target_type, target_id, created_at desc);
create index if not exists payments_company_idx on public.payments(company_id, created_at desc);

insert into public.plan_features (plan_id, feature_key, label, enabled, limit_value)
values
  ('free','active_vacancies','Aktiv vakansiyalar',true,1),
  ('free','internship_listings','Təcrübə elanları',true,1),
  ('free','candidate_search','Namizəd axtarışı',false,0),
  ('free','ai_candidate_matching','AI namizəd uyğunluğu',false,0),
  ('free','ai_cv_ranking','AI CV sıralaması',false,0),
  ('free','advanced_analytics','Qabaqcıl analitika',false,0),
  ('free','featured_vacancies','Önə çıxarılan vakansiyalar',false,0),
  ('free','monthly_network_posts','Aylıq şirkət paylaşımları',true,4),
  ('free','post_media','Paylaşımda şəkil və sənəd',false,0),
  ('free','bulk_messaging','Kütləvi mesajlaşma',false,0),
  ('free','team_members','Komanda üzvləri',true,1),
  ('free','premium_branding','Premium şirkət səhifəsi',false,0),
  ('free','priority_support','Prioritet dəstək',false,0),
  ('pro','active_vacancies','Aktiv vakansiyalar',true,10),
  ('pro','internship_listings','Təcrübə elanları',true,10),
  ('pro','candidate_search','Namizəd axtarışı',true,null),
  ('pro','ai_candidate_matching','AI namizəd uyğunluğu',true,null),
  ('pro','ai_cv_ranking','AI CV sıralaması',true,null),
  ('pro','advanced_analytics','Qabaqcıl analitika',true,null),
  ('pro','featured_vacancies','Önə çıxarılan vakansiyalar',true,2),
  ('pro','monthly_network_posts','Aylıq şirkət paylaşımları',true,30),
  ('pro','post_media','Paylaşımda şəkil və sənəd',true,null),
  ('pro','bulk_messaging','Kütləvi mesajlaşma',false,0),
  ('pro','team_members','Komanda üzvləri',true,3),
  ('pro','premium_branding','Premium şirkət səhifəsi',false,0),
  ('pro','priority_support','Prioritet dəstək',false,0),
  ('business','active_vacancies','Aktiv vakansiyalar',true,null),
  ('business','internship_listings','Təcrübə elanları',true,null),
  ('business','candidate_search','Namizəd axtarışı',true,null),
  ('business','ai_candidate_matching','AI namizəd uyğunluğu',true,null),
  ('business','ai_cv_ranking','AI CV sıralaması',true,null),
  ('business','advanced_analytics','Qabaqcıl analitika',true,null),
  ('business','featured_vacancies','Önə çıxarılan vakansiyalar',true,10),
  ('business','monthly_network_posts','Aylıq şirkət paylaşımları',true,null),
  ('business','post_media','Paylaşımda şəkil və sənəd',true,null),
  ('business','bulk_messaging','Kütləvi mesajlaşma',true,null),
  ('business','team_members','Komanda üzvləri',true,null),
  ('business','premium_branding','Premium şirkət səhifəsi',true,null),
  ('business','priority_support','Prioritet dəstək',true,null)
on conflict (plan_id, feature_key) do update set
  label=excluded.label, enabled=excluded.enabled, limit_value=excluded.limit_value, updated_at=now();

create or replace function public.company_feature_limit(p_company_id uuid, p_feature_key text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select pf.limit_value
  from public.subscriptions s
  join public.plan_features pf on pf.plan_id=s.plan_id
  where s.company_id=p_company_id and s.status='active' and pf.feature_key=p_feature_key and pf.enabled
  limit 1;
$$;

create or replace function public.company_has_feature(p_company_id uuid, p_feature_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1 from public.subscriptions s
    join public.plan_features pf on pf.plan_id=s.plan_id
    where s.company_id=p_company_id and s.status='active' and pf.feature_key=p_feature_key and pf.enabled
  );
$$;

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
  where s.company_id=new.company_id and s.status='active'
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

drop trigger if exists jobs_plan_limit on public.jobs;
create trigger jobs_plan_limit
before insert or update of status, company_id on public.jobs
for each row execute function public.enforce_company_job_limit();

create or replace function public.guard_job_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if new.status is distinct from old.status
     and new.status::text in ('approved','published','rejected','changes_requested','expired','archived') then
    raise exception 'Elanın statusunu yalnız Karyera Mərkəzi dəyişə bilər'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create or replace function public.record_application_status_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op='INSERT' or new.status is distinct from old.status then
    insert into public.application_status_history(application_id,old_status,new_status,changed_by,note)
    values(new.id,case when tg_op='UPDATE' then old.status::text else null end,new.status::text,auth.uid(),coalesce(new.company_note,''));
  end if;
  return new;
end;
$$;

drop trigger if exists applications_status_history on public.applications;
create trigger applications_status_history
after insert or update of status on public.applications
for each row execute function public.record_application_status_history();

create or replace function public.notify_core_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_owner uuid;
begin
  if tg_table_name='jobs' then
    if new.status::text in ('approved','published') and (old.status is null or old.status is distinct from new.status) then
      select owner_id into v_owner from public.companies where id=new.company_id;
      insert into public.notifications(profile_id,kind,title,body,link)
      values(v_owner,'vacancy_approved','Vakansiya təsdiqləndi',new.title,'vacancies');
    elsif new.status::text in ('rejected','changes_requested') and old.status is distinct from new.status then
      select owner_id into v_owner from public.companies where id=new.company_id;
      insert into public.notifications(profile_id,kind,title,body,link)
      values(v_owner,'vacancy_review','Vakansiyaya admin rəyi var',new.title,'vacancies');
    end if;
  elsif tg_table_name='applications' then
    if tg_op='INSERT' then
      select c.owner_id into v_owner from public.jobs j join public.companies c on c.id=j.company_id where j.id=new.job_id;
      insert into public.notifications(profile_id,kind,title,body,link)
      values(v_owner,'new_application','Yeni müraciət','Vakansiyanıza yeni müraciət daxil olub.','applications');
    elsif new.status is distinct from old.status then
      insert into public.notifications(profile_id,kind,title,body,link)
      values(new.student_id,'application_status','Müraciət statusu dəyişdi',new.status::text,'applications');
    end if;
  elsif tg_table_name='companies' and new.status is distinct from old.status then
    insert into public.notifications(profile_id,kind,title,body,link)
    values(new.owner_id,'company_status','Şirkət hesabının statusu dəyişdi',new.status::text,'company-profile');
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_workflow_notification on public.jobs;
create trigger jobs_workflow_notification after update of status on public.jobs
for each row execute function public.notify_core_workflow();
drop trigger if exists applications_workflow_notification on public.applications;
create trigger applications_workflow_notification after insert or update of status on public.applications
for each row execute function public.notify_core_workflow();
drop trigger if exists companies_workflow_notification on public.companies;
create trigger companies_workflow_notification after update of status on public.companies
for each row execute function public.notify_core_workflow();

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
    requested_status,(safe_role='graduate' and is_uni));

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

drop policy if exists jobs_insert on public.jobs;
create policy jobs_insert on public.jobs for insert to authenticated
with check (
  public.owns_company(company_id)
  and exists(select 1 from public.companies c where c.id=jobs.company_id and c.status='active')
  and status::text in ('pending','pending_approval')
);
drop policy if exists jobs_public_read on public.jobs;
create policy jobs_public_read on public.jobs for select to anon
using (status::text in ('approved','published'));
drop policy if exists jobs_select on public.jobs;
create policy jobs_select on public.jobs for select to authenticated
using (status::text in ('approved','published') or public.is_admin() or public.owns_company(company_id));
drop policy if exists applications_insert on public.applications;
create policy applications_insert on public.applications for insert to authenticated
with check (
  student_id=auth.uid()
  and public.app_role() in ('student'::public.user_role,'graduate'::public.user_role)
  and exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active')
  and exists(select 1 from public.jobs j where j.id=applications.job_id and j.status::text in ('approved','published'))
);

alter table public.plan_features enable row level security;
alter table public.subscription_usage enable row level security;
alter table public.company_members enable row level security;
alter table public.application_status_history enable row level security;
alter table public.post_media enable row level security;
alter table public.follows enable row level security;
alter table public.moderation_logs enable row level security;
alter table public.payments enable row level security;

create policy plan_features_read on public.plan_features for select to anon,authenticated using (true);
create policy plan_features_admin on public.plan_features for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy usage_read on public.subscription_usage for select to authenticated using (
  public.is_admin() or exists(select 1 from public.subscriptions s where s.id=subscription_id and public.owns_company(s.company_id))
);
create policy usage_admin on public.subscription_usage for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy company_members_read on public.company_members for select to authenticated using (profile_id=auth.uid() or public.owns_company(company_id) or public.is_admin());
create policy company_members_manage on public.company_members for all to authenticated using (public.owns_company(company_id) or public.is_admin()) with check (public.owns_company(company_id) or public.is_admin());
create policy application_history_read on public.application_status_history for select to authenticated using (
  public.is_admin() or exists(select 1 from public.applications a join public.jobs j on j.id=a.job_id where a.id=application_id and (a.student_id=auth.uid() or public.owns_company(j.company_id)))
);
create policy post_media_read on public.post_media for select to authenticated using (exists(select 1 from public.posts p where p.id=post_id));
create policy post_media_write on public.post_media for all to authenticated using (exists(select 1 from public.posts p where p.id=post_id and (p.author_id=auth.uid() or public.is_admin()))) with check (exists(select 1 from public.posts p where p.id=post_id and (p.author_id=auth.uid() or public.is_admin())));
create policy follows_own on public.follows for all to authenticated using (follower_id=auth.uid()) with check (follower_id=auth.uid());
create policy moderation_logs_admin on public.moderation_logs for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy payments_read on public.payments for select to authenticated using (public.is_admin() or public.owns_company(company_id));
create policy payments_admin on public.payments for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.plan_features to anon,authenticated;
grant select,insert,update,delete on public.subscription_usage,public.company_members,public.post_media,public.follows to authenticated;
grant select on public.application_status_history to authenticated;
grant select,insert,update,delete on public.moderation_logs,public.payments to authenticated;
grant execute on function public.company_feature_limit(uuid,text) to authenticated;
grant execute on function public.company_has_feature(uuid,text) to authenticated;
revoke execute on function public.enforce_company_job_limit() from public,anon,authenticated;
revoke execute on function public.record_application_status_history() from public,anon,authenticated;
revoke execute on function public.notify_core_workflow() from public,anon,authenticated;
revoke execute on function public.handle_new_user() from public,anon,authenticated;

create or replace view public.company_subscriptions with (security_invoker=true) as
select s.*, p.name as plan_name, p.monthly_price, p.currency
from public.subscriptions s join public.plans p on p.id=s.plan_id;
grant select on public.company_subscriptions to authenticated;
