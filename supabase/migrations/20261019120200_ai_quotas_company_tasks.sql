-- AI limits and data for company AI tasks. Both functions are called only by
-- the career-ai edge function with the service role.
--   Students/graduates: 25 successful AI requests per day (Baku time).
--   Companies: plan_features.ai_requests_monthly (Free 10, Pro 300, Business 1500).

alter table public.ai_usage
  add column if not exists company_id uuid references public.companies(id) on delete set null;

create index if not exists ai_usage_profile_created_idx on public.ai_usage(profile_id, created_at desc);
create index if not exists ai_usage_company_created_idx on public.ai_usage(company_id, created_at desc) where company_id is not null;

insert into public.plan_features(plan_id, feature_key, label, enabled, limit_value, config)
values
  ('free', 'ai_requests_monthly', 'AI sorğuları (aylıq)', true, 10, '{}'),
  ('pro', 'ai_requests_monthly', 'AI sorğuları (aylıq)', true, 300, '{}'),
  ('business', 'ai_requests_monthly', 'AI sorğuları (aylıq)', true, 1500, '{}')
on conflict (plan_id, feature_key) do nothing;

create or replace function public.ai_request_context(p_profile_id uuid, p_task text, p_job_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c_student_daily constant integer := 25;
  v_role text;
  v_status text;
  v_company uuid;
  v_company_status text;
  v_plan text;
  v_enabled boolean;
  v_limit integer;
  v_used integer;
  v_since timestamptz;
begin
  select p.role::text, p.status::text into v_role, v_status from public.profiles p where p.id = p_profile_id;
  if v_role is null then return jsonb_build_object('allowed', false, 'reason', 'profile_not_found'); end if;
  if v_status <> 'active' then return jsonb_build_object('allowed', false, 'reason', 'profile_inactive'); end if;

  if p_task in ('candidate_rank', 'job_post_write') then
    if v_role not in ('company', 'admin') then
      return jsonb_build_object('allowed', false, 'reason', 'company_only');
    end if;

    if p_job_id is not null then
      select j.company_id into v_company from public.jobs j where j.id = p_job_id;
      if v_company is null then return jsonb_build_object('allowed', false, 'reason', 'job_not_found'); end if;
      if v_role <> 'admin'
         and not exists (select 1 from public.companies c where c.id = v_company and c.owner_id = p_profile_id)
         and not exists (select 1 from public.company_members m
                         where m.company_id = v_company and m.profile_id = p_profile_id and m.status = 'active') then
        return jsonb_build_object('allowed', false, 'reason', 'not_member');
      end if;
    else
      select c.id into v_company
      from public.companies c
      where c.owner_id = p_profile_id
         or exists (select 1 from public.company_members m
                    where m.company_id = c.id and m.profile_id = p_profile_id and m.status = 'active')
      order by (c.owner_id = p_profile_id) desc nulls last
      limit 1;
    end if;

    if v_role = 'admin' then
      return jsonb_build_object('allowed', true, 'role', v_role, 'company_id', v_company,
                                'used', 0, 'limit', null, 'period', 'month');
    end if;
    if v_company is null then return jsonb_build_object('allowed', false, 'reason', 'no_company'); end if;

    select c.status::text into v_company_status from public.companies c where c.id = v_company;
    if v_company_status <> 'active' then
      return jsonb_build_object('allowed', false, 'reason', 'company_inactive', 'company_id', v_company);
    end if;

    select s.plan_id into v_plan from public.subscriptions s where s.company_id = v_company and s.status = 'active';
    if p_task = 'candidate_rank' and not public.company_has_feature(v_company, 'ai_cv_ranking') then
      return jsonb_build_object('allowed', false, 'reason', 'plan_required', 'company_id', v_company,
                                'plan_id', coalesce(v_plan, 'free'));
    end if;

    select pf.enabled, pf.limit_value into v_enabled, v_limit
    from public.subscriptions s
    join public.plan_features pf on pf.plan_id = s.plan_id and pf.feature_key = 'ai_requests_monthly'
    where s.company_id = v_company and s.status = 'active';
    if not found or not v_enabled then v_limit := 0; end if;

    v_since := date_trunc('month', now() at time zone 'Asia/Baku') at time zone 'Asia/Baku';
    select count(*) into v_used from public.ai_usage u
    where u.company_id = v_company and u.success and u.created_at >= v_since;

    return jsonb_build_object(
      'allowed', v_limit is null or v_used < v_limit,
      'reason', case when v_limit is not null and v_used >= v_limit then 'quota_exceeded' end,
      'role', v_role, 'company_id', v_company, 'plan_id', coalesce(v_plan, 'free'),
      'used', v_used, 'limit', v_limit, 'period', 'month');
  end if;

  if v_role = 'admin' then
    return jsonb_build_object('allowed', true, 'role', v_role, 'used', 0, 'limit', null, 'period', 'day');
  end if;

  v_since := date_trunc('day', now() at time zone 'Asia/Baku') at time zone 'Asia/Baku';
  select count(*) into v_used from public.ai_usage u
  where u.profile_id = p_profile_id and u.company_id is null and u.success and u.created_at >= v_since;

  return jsonb_build_object(
    'allowed', v_used < c_student_daily,
    'reason', case when v_used >= c_student_daily then 'quota_exceeded' end,
    'role', v_role, 'used', v_used, 'limit', c_student_daily, 'period', 'day');
end $$;

-- Applicants of one job without names or contact details, best formula match first.
create or replace function public.ai_candidate_pack(p_job_id uuid, p_limit integer default 25, p_offset integer default 0)
returns jsonb language sql stable security definer set search_path = '' as $$
  with j as (
    select * from public.jobs where id = p_job_id
  ),
  apps as (
    select a.id as application_id, a.student_id, a.status::text as status, a.created_at,
           p.faculty_id, p.major_id, p.course, p.gpa, p.skills, p.languages, p.certificates, p.summary,
           public.match_score(j.faculty_ids, j.major_ids, j.skills, p.faculty_id, p.major_id, p.skills) as deterministic_score
    from public.applications a
    join j on j.id = a.job_id
    join public.profiles p on p.id = a.student_id
    where a.status::text not in ('geri_goturuldu', 'imtina', 'rejected')
  )
  select jsonb_build_object(
    'job', (
      select jsonb_build_object(
        'title', j.title, 'type', j.type, 'summary', j.summary, 'duties', j.duties,
        'requirements', j.requirements, 'skills', j.skills, 'preferred_skills', j.preferred_skills,
        'experience_level', j.experience_level, 'min_course', j.min_course, 'min_gpa', j.min_gpa,
        'faculties', (select coalesce(jsonb_agg(f.name), '[]'::jsonb) from public.faculties f where f.id = any(j.faculty_ids)),
        'majors', (select coalesce(jsonb_agg(m.name), '[]'::jsonb) from public.majors m where m.id = any(j.major_ids)))
      from j),
    'total', (select count(*) from apps),
    'candidates', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.deterministic_score desc, c.created_at)
      from (
        select a.application_id, a.student_id, a.status, a.deterministic_score, a.created_at,
               (select f.name from public.faculties f where f.id = a.faculty_id) as faculty,
               (select m.name from public.majors m where m.id = a.major_id) as major,
               a.course, a.gpa, a.skills, a.languages, a.certificates, left(a.summary, 800) as summary,
               (select coalesce(jsonb_agg(jsonb_build_object(
                         'degree', e.degree_type, 'specialty', e.specialty,
                         'graduation_year', e.graduation_year, 'is_current', e.is_current)), '[]'::jsonb)
                  from public.education e where e.profile_id = a.student_id) as education,
               (select left(cv.source_text, 2500) from public.cv_documents cv
                  where cv.profile_id = a.student_id and cv.source_text is not null
                  order by cv.updated_at desc limit 1) as cv_text
        from apps a
        order by a.deterministic_score desc, a.created_at
        limit greatest(1, least(p_limit, 25)) offset greatest(p_offset, 0)
      ) c
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.ai_request_context(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.ai_candidate_pack(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.ai_request_context(uuid, text, uuid) to service_role;
grant execute on function public.ai_candidate_pack(uuid, integer, integer) to service_role;
