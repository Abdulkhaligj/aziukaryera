-- ADNSU Career platform expansion: education history, alumni, plans,
-- network moderation, AI usage, CV and interview history.

alter table public.profiles
  add column if not exists personal_email text,
  add column if not exists account_status text not null default 'student',
  add column if not exists alumni_verified boolean not null default false,
  add column if not exists profile_visibility text not null default 'platform';

alter table public.posts
  add column if not exists kind text not null default 'general',
  add column if not exists tags text[] not null default '{}',
  add column if not exists attachment_url text,
  add column if not exists moderation_status text not null default 'visible';

alter table public.jobs
  add column if not exists department text,
  add column if not exists salary_min numeric,
  add column if not exists salary_max numeric,
  add column if not exists currency text not null default 'AZN',
  add column if not exists featured_until timestamptz;

alter table public.companies
  add column if not exists verified boolean not null default false,
  add column if not exists logo_url text,
  add column if not exists cover_url text;

create table if not exists public.education (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  degree_type text not null check (degree_type in ('bachelor','master','phd','other')),
  university text not null,
  faculty text not null default '',
  specialty text not null,
  specialization text not null default '',
  group_name text not null default '',
  start_year integer check (start_year between 1950 and 2100),
  graduation_year integer check (graduation_year between 1950 and 2100),
  is_current boolean not null default false,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.plans (
  id text primary key,
  name text not null,
  monthly_price numeric(8,2) not null default 0,
  currency text not null default 'USD',
  active_job_limit integer,
  featured_job_limit integer not null default 0,
  candidate_search boolean not null default false,
  ai_ranking boolean not null default false,
  advanced_analytics boolean not null default false,
  priority_support boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  plan_id text not null references public.plans(id),
  status text not null default 'active' check (status in ('pending','active','past_due','cancelled')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  requested_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id),
  unique (company_id)
);

create table if not exists public.post_saves (
  post_id uuid not null references public.posts(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, profile_id)
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('post','comment','profile','company','job')),
  target_id uuid not null,
  reason text not null,
  details text not null default '',
  status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  reviewed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists public.cv_documents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'CV',
  storage_path text,
  source_text text,
  template_id text,
  language text not null default 'az',
  ats_score integer check (ats_score between 0 and 100),
  ai_feedback jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.interview_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  target_role text not null,
  interview_type text not null,
  major text,
  questions jsonb not null default '[]'::jsonb,
  answers jsonb not null default '[]'::jsonb,
  score integer check (score between 0 and 100),
  deterministic_result jsonb,
  ai_feedback jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  profile_id uuid references public.profiles(id) on delete set null,
  task text not null,
  provider text,
  model text,
  input_chars integer not null default 0,
  output_chars integer not null default 0,
  success boolean not null default true,
  error_code text,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists education_profile_idx on public.education(profile_id);
create index if not exists posts_feed_idx on public.posts(moderation_status, created_at desc);
create index if not exists posts_kind_idx on public.posts(kind, created_at desc);
create index if not exists reports_status_idx on public.reports(status, created_at desc);
create index if not exists subscriptions_status_idx on public.subscriptions(status, plan_id);
create index if not exists cv_documents_profile_idx on public.cv_documents(profile_id, updated_at desc);
create index if not exists interview_sessions_profile_idx on public.interview_sessions(profile_id, created_at desc);
create index if not exists ai_usage_created_idx on public.ai_usage(created_at desc);
create index if not exists notifications_profile_idx on public.notifications(profile_id, read_at, created_at desc);
create unique index if not exists companies_name_ci_idx on public.companies(lower(name));

insert into public.plans
  (id, name, monthly_price, active_job_limit, featured_job_limit, candidate_search, ai_ranking, advanced_analytics, priority_support, sort_order)
values
  ('free', 'Free', 0, 1, 0, false, false, false, false, 1),
  ('pro', 'Pro', 24.99, 10, 2, true, true, true, false, 2),
  ('business', 'Business', 49.99, null, 10, true, true, true, true, 3)
on conflict (id) do update set
  name=excluded.name, monthly_price=excluded.monthly_price,
  active_job_limit=excluded.active_job_limit, featured_job_limit=excluded.featured_job_limit,
  candidate_search=excluded.candidate_search, ai_ranking=excluded.ai_ranking,
  advanced_analytics=excluded.advanced_analytics, priority_support=excluded.priority_support,
  sort_order=excluded.sort_order, active=true;

-- Reference faculties, majors, employers, jobs, events and benefits are seeded
-- by the existing project migrations; this expansion preserves their IDs.

create or replace function public.select_company_plan(p_plan_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_status text; v_row public.subscriptions;
begin
  select id into v_company from public.companies where owner_id=auth.uid() limit 1;
  if v_company is null then raise exception 'Şirkət hesabı tapılmadı'; end if;
  if not exists (select 1 from public.plans where id=p_plan_id and active) then raise exception 'Paket tapılmadı'; end if;
  v_status := case when p_plan_id='free' then 'active' else 'pending' end;
  insert into public.subscriptions(company_id,plan_id,status)
  values(v_company,p_plan_id,v_status)
  on conflict(company_id) do update set plan_id=excluded.plan_id,status=excluded.status,requested_at=now(),ends_at=null
  returning * into v_row;
  return to_jsonb(v_row);
end $$;

create or replace function public.enforce_company_job_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_limit integer; v_count integer;
begin
  select p.active_job_limit into v_limit
  from public.subscriptions s join public.plans p on p.id=s.plan_id
  where s.company_id=new.company_id and s.status='active';
  if not found then v_limit := 1; end if;
  if v_limit is not null then
    select count(*) into v_count from public.jobs
    where company_id=new.company_id and status in ('pending','approved');
    if v_count >= v_limit then raise exception 'Paketinizin aktiv vakansiya limiti dolub'; end if;
  end if;
  return new;
end $$;

drop trigger if exists jobs_plan_limit on public.jobs;
create trigger jobs_plan_limit before insert on public.jobs
for each row execute function public.enforce_company_job_limit();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
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
begin
  if requested='company' then
    safe_role := 'company';
  elsif requested in ('graduate','alumni') then
    safe_role := 'graduate';
    requested_status := case when requested='alumni' then 'alumni' else 'graduate' end;
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
  new_status := case when safe_role='company' or (safe_role='graduate' and not is_uni)
                     then 'pending' else 'active' end;
  disp := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'),''),nullif(trim(new.raw_user_meta_data ->> 'name'),''),split_part(new.email,'@',1));
  insert into public.profiles(id,role,status,email,full_name,account_status,alumni_verified)
  values(new.id,safe_role,new_status,new.email,disp,requested_status,(safe_role='graduate' and is_uni));
  if safe_role='company' then
    insert into public.companies(owner_id,name,email,contact,sector,status)
    values(new.id,coalesce(nullif(new.raw_user_meta_data ->> 'company_name',''),disp),new.email,disp,coalesce(new.raw_user_meta_data ->> 'sector',''),'pending')
    returning id into new_company;
    if not exists(select 1 from public.plans where id=selected_plan and active) then selected_plan := 'free'; end if;
    insert into public.subscriptions(company_id,plan_id,status)
    values(new_company,selected_plan,case when selected_plan='free' then 'active' else 'pending' end);
  end if;
  return new;
end $$;

alter table public.education enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.post_saves enable row level security;
alter table public.reports enable row level security;
alter table public.cv_documents enable row level security;
alter table public.interview_sessions enable row level security;
alter table public.ai_usage enable row level security;
alter table public.notifications enable row level security;

drop policy if exists education_read on public.education;
create policy education_read on public.education for select to authenticated
using (profile_id=auth.uid() or public.is_admin() or public.has_active_company());
drop policy if exists education_own_write on public.education;
create policy education_own_write on public.education for all to authenticated
using (profile_id=auth.uid() or public.is_admin()) with check (profile_id=auth.uid() or public.is_admin());

drop policy if exists plans_public_read on public.plans;
create policy plans_public_read on public.plans for select to anon,authenticated using (active=true);
drop policy if exists plans_admin_write on public.plans;
create policy plans_admin_write on public.plans for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists subscriptions_read on public.subscriptions;
create policy subscriptions_read on public.subscriptions for select to authenticated
using (public.is_admin() or exists(select 1 from public.companies c where c.id=company_id and c.owner_id=auth.uid()));
drop policy if exists subscriptions_admin_write on public.subscriptions;
create policy subscriptions_admin_write on public.subscriptions for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists post_saves_own on public.post_saves;
create policy post_saves_own on public.post_saves for all to authenticated
using (profile_id=auth.uid()) with check (profile_id=auth.uid());

drop policy if exists reports_insert_own on public.reports;
create policy reports_insert_own on public.reports for insert to authenticated with check (reporter_id=auth.uid());
drop policy if exists reports_admin_read on public.reports;
create policy reports_admin_read on public.reports for select to authenticated using (public.is_admin() or reporter_id=auth.uid());
drop policy if exists reports_admin_update on public.reports;
create policy reports_admin_update on public.reports for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists cv_own on public.cv_documents;
create policy cv_own on public.cv_documents for all to authenticated
using (profile_id=auth.uid() or public.is_admin()) with check (profile_id=auth.uid() or public.is_admin());
drop policy if exists interviews_own on public.interview_sessions;
create policy interviews_own on public.interview_sessions for all to authenticated
using (profile_id=auth.uid() or public.is_admin()) with check (profile_id=auth.uid() or public.is_admin());
drop policy if exists ai_usage_read on public.ai_usage;
create policy ai_usage_read on public.ai_usage for select to authenticated using (profile_id=auth.uid() or public.is_admin());
drop policy if exists ai_usage_insert on public.ai_usage;
create policy ai_usage_insert on public.ai_usage for insert to authenticated with check (profile_id=auth.uid());
drop policy if exists notifications_own on public.notifications;
create policy notifications_own on public.notifications for all to authenticated
using (profile_id=auth.uid() or public.is_admin()) with check (profile_id=auth.uid() or public.is_admin());

drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts for select to authenticated using (moderation_status='visible' or author_id=auth.uid() or public.is_admin());

grant select on public.plans to anon,authenticated;
grant select,insert,update,delete on public.education,public.subscriptions,public.post_saves,public.reports,public.cv_documents,public.interview_sessions,public.notifications to authenticated;
grant select,insert on public.ai_usage to authenticated;
grant usage,select on sequence public.ai_usage_id_seq to authenticated;
grant execute on function public.select_company_plan(text) to authenticated;

insert into public.subscriptions(company_id,plan_id,status)
select c.id,'free','active' from public.companies c
where not exists(select 1 from public.subscriptions s where s.company_id=c.id);
