begin;
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

    select s.plan_id into v_plan from public.subscriptions s where s.company_id = v_company and s.status = 'active' and (s.starts_at is null or s.starts_at<=now()) and (s.plan_id='free' or s.ends_at>now());
    if p_task = 'candidate_rank' and not public.company_has_feature(v_company, 'ai_cv_ranking') then
      return jsonb_build_object('allowed', false, 'reason', 'plan_required', 'company_id', v_company,
                                'plan_id', coalesce(v_plan, 'free'));
    end if;

    select pf.enabled, pf.limit_value into v_enabled, v_limit
    from public.subscriptions s
    join public.plan_features pf on pf.plan_id = s.plan_id and pf.feature_key = 'ai_requests_monthly'
    where s.company_id = v_company and s.status = 'active' and (s.starts_at is null or s.starts_at<=now()) and (s.plan_id='free' or s.ends_at>now());
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

-- Paid work is reserved before any provider request. Only trusted Edge services
-- may call these RPCs. Failed attempts consume budget; deleting telemetry cannot
-- refund it. No production URL or webhook credential is bundled.
create table private.ai_reservations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid,
  company_id uuid,
  client_hash text,
  task text not null,
  budget text not null,
  created_at timestamptz not null default clock_timestamp(),
  provider_attempts integer not null default 0 check (provider_attempts between 0 and 7)
);
create index ai_reservations_budget_created on private.ai_reservations(budget, created_at);
alter table private.ai_reservations enable row level security;
revoke all on private.ai_reservations from public, anon, authenticated, service_role;

-- Preserve this period's already recorded spend when switching accounting.
-- Historical failures did not prove whether a provider was called, so the new
-- non-refundable accounting starts enforcing failures at this migration.
insert into private.ai_reservations(profile_id,company_id,client_hash,task,budget,created_at)
select u.profile_id,u.company_id,u.client_hash,u.task,
  case when u.task='aida_chat' and u.profile_id is null then 'aida:anonymous:'||u.client_hash
       when u.task='aida_chat' then 'aida:profile:'||u.profile_id::text
       when u.task in ('content_moderation','avatar_moderation') then 'moderation'
       when u.task='admin_assistant' or p.role::text='admin' then 'admin:'||u.profile_id::text
       when u.company_id is not null then 'career:company:'||u.company_id::text
       else 'career:profile:'||u.profile_id::text end,u.created_at
from public.ai_usage u left join public.profiles p on p.id=u.profile_id
where u.success and u.created_at>=date_trunc('month',clock_timestamp() at time zone 'Asia/Baku') at time zone 'Asia/Baku'
  and u.task in ('aida_chat','admin_assistant','content_moderation','avatar_moderation',
    'cv_analyze','cv_rewrite','job_match_explain','interview_questions','interview_evaluate','candidate_rank','job_post_write')
  and (u.profile_id is not null or u.client_hash is not null or u.task in ('content_moderation','avatar_moderation'));

create function public.ai_reserve_request(p_profile_id uuid, p_task text, p_job_id uuid default null, p_client_hash text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ctx jsonb := '{}'::jsonb;
  v_company uuid;
  v_budget text;
  v_since timestamptz := date_trunc('day', clock_timestamp() at time zone 'Asia/Baku') at time zone 'Asia/Baku';
  v_limit integer;
  v_used integer;
  v_id uuid;
  v_role text;
  v_status text;
  v_admin_role text;
  v_meta jsonb;
begin
  -- A global lock also makes the anonymous cap independent of client headers.
  perform pg_advisory_xact_lock(hashtextextended('ai-reservation-global', 0));
  if p_profile_id is not null then
    select p.role::text, p.status::text, p.admin_role::text, u.raw_app_meta_data
      into v_role, v_status, v_admin_role, v_meta
    from public.profiles p join auth.users u on u.id=p.id where p.id=p_profile_id;
    if v_status is distinct from 'active' then
      return jsonb_build_object('allowed', false, 'reason', 'profile_inactive');
    end if;
    if v_role='admin' and (v_admin_role is null or v_admin_role not in ('super_admin','manager','editor','reviewer')
      or v_admin_role is distinct from v_meta->>'admin_role'
      or coalesce((v_meta->>'must_change_password')::boolean,false)) then
      return jsonb_build_object('allowed', false, 'reason', 'profile_inactive');
    end if;
  end if;
  if p_task='aida_chat' then
    if p_profile_id is null then
      if p_client_hash is null or p_client_hash !~ '^[0-9a-f]{40}$' then
        raise exception 'Invalid anonymous client' using errcode='22023';
      end if;
      select count(*) into v_used from private.ai_reservations
        where task='aida_chat' and profile_id is null and created_at>=v_since;
      if v_used>=2000 then return jsonb_build_object('allowed',false,'reason','quota_exceeded','limit',2000,'used',v_used); end if;
      v_budget := 'aida:anonymous:'||p_client_hash; v_limit:=20;
    else
      v_budget := 'aida:profile:'||p_profile_id::text; v_limit:=80;
    end if;
  elsif p_task='admin_assistant' then
    if v_role is distinct from 'admin' then return jsonb_build_object('allowed',false,'reason','forbidden'); end if;
    v_budget := 'admin:'||p_profile_id::text; v_limit:=200;
  elsif p_task in ('content_moderation','avatar_moderation') then
    v_budget := 'moderation'; v_limit:=5000;
  elsif p_task in ('cv_analyze','cv_rewrite','job_match_explain','interview_questions','interview_evaluate','candidate_rank','job_post_write') then
    if p_profile_id is null then return jsonb_build_object('allowed',false,'reason','forbidden'); end if;
    v_ctx := public.ai_request_context(p_profile_id,p_task,p_job_id);
    if not coalesce((v_ctx->>'allowed')::boolean,false) then return v_ctx; end if;
    v_company := (v_ctx->>'company_id')::uuid;
    if v_role='admin' then
      v_budget := 'admin:'||p_profile_id::text; v_limit:=200;
    elsif v_company is not null then
      v_budget := 'career:company:'||v_company::text;
      v_since := date_trunc('month',clock_timestamp() at time zone 'Asia/Baku') at time zone 'Asia/Baku';
      v_limit := (v_ctx->>'limit')::integer;
      -- Unlimited plans still have an explicit paid-work safety ceiling.
      v_limit := least(coalesce(v_limit,10000),10000);
    else
      v_budget := 'career:profile:'||p_profile_id::text; v_limit:=25;
    end if;
  else raise exception 'Unsupported AI task' using errcode='22023';
  end if;
  select count(*) into v_used from private.ai_reservations where budget=v_budget and created_at>=v_since;
  if v_used>=v_limit then
    return v_ctx || jsonb_build_object('allowed',false,'reason','quota_exceeded','used',v_used,'limit',v_limit);
  end if;
  insert into private.ai_reservations(profile_id,company_id,client_hash,task,budget)
    values(p_profile_id,v_company,p_client_hash,p_task,v_budget) returning id into v_id;
  return v_ctx || jsonb_build_object('allowed',true,'reservation_id',v_id,'used',v_used+1,'limit',v_limit);
end $$;

-- Every actual outbound call, including model fallback and thinking retries,
-- consumes one of at most seven attempts. DB errors fail closed in the handler.
create function public.ai_consume_provider_attempt(p_reservation_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  update private.ai_reservations set provider_attempts=provider_attempts+1
  where id=p_reservation_id and provider_attempts<7
    and created_at>clock_timestamp()-interval '5 minutes'
  returning provider_attempts into v_count;
  return v_count is not null;
end $$;

create table private.moderation_webhook_config (
  singleton boolean primary key default true check(singleton),
  endpoint text not null check(endpoint ~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/content-moderation$'
    and endpoint not like '%ttfsbgbhyomfheglefkn%'),
  secret text not null check(length(secret)>=32),
  enabled boolean not null default false
);
alter table private.moderation_webhook_config enable row level security;
revoke all on private.moderation_webhook_config from public, anon, authenticated, service_role;
create or replace function private.moderation_send(p_table text,p_id uuid)
returns bigint language plpgsql security definer set search_path='' as $$
declare v_config private.moderation_webhook_config; v_result bigint;
begin
  select * into v_config from private.moderation_webhook_config where singleton and enabled;
  -- An unconfigured staging project keeps content pending without calling any
  -- external system. An operator provisions its own endpoint and secret.
  if not found then return null; end if;
  select net.http_post(url:=v_config.endpoint,
    body:=jsonb_build_object('table',p_table,'id',p_id),
    headers:=jsonb_build_object('Content-Type','application/json','x-moderation-secret',v_config.secret),
    timeout_milliseconds:=30000) into v_result;
  return v_result;
end $$;

create table private.moderation_claims (
  target_table text not null check(target_table in ('posts','post_comments','profiles')),
  target_id uuid not null,
  snapshot jsonb not null,
  claim_id uuid not null unique,
  reservation_id uuid,
  claimed_until timestamptz not null,
  attempts integer not null check(attempts between 1 and 5),
  finished boolean not null default false,
  primary key(target_table,target_id)
);
alter table private.moderation_claims enable row level security;
revoke all on private.moderation_claims from public, anon, authenticated, service_role;

-- This function locks the actual target before the claim. The snapshot binds
-- verdicts to body, link, path and requested_at, rather than only an object ID.
create function private.moderation_snapshot(p_table text,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row jsonb;
begin
  if p_table='posts' then
    select jsonb_build_object('id',id,'body',body,'link_url',link_url,'moderation_requested_at',moderation_requested_at)
      into v_row from public.posts where id=p_id and moderation_status='pending' for update;
  elsif p_table='post_comments' then
    select jsonb_build_object('id',id,'body',body,'moderation_requested_at',moderation_requested_at)
      into v_row from public.post_comments where id=p_id and moderation_status='pending' for update;
  elsif p_table='profiles' then
    select jsonb_build_object('id',id,'avatar_pending_path',avatar_pending_path,'avatar_requested_at',avatar_requested_at)
      into v_row from public.profiles where id=p_id and avatar_pending_path is not null for update;
  else raise exception 'Unsupported moderation target' using errcode='22023';
  end if;
  return v_row;
end $$;

create function public.moderation_claim(p_table text,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_snapshot jsonb; v_old private.moderation_claims; v_claim uuid:=gen_random_uuid(); v_budget jsonb; v_attempts integer:=1;
begin
  v_snapshot:=private.moderation_snapshot(p_table,p_id);
  if v_snapshot is null then return jsonb_build_object('claimed',false); end if;
  select * into v_old from private.moderation_claims where target_table=p_table and target_id=p_id for update;
  if found and v_old.snapshot=v_snapshot then
    if v_old.finished or v_old.claimed_until>clock_timestamp() or v_old.attempts>=5 then
      return jsonb_build_object('claimed',false);
    end if;
    v_attempts:=v_old.attempts+1;
  end if;
  v_budget:=public.ai_reserve_request(null,case when p_table='profiles' then 'avatar_moderation' else 'content_moderation' end);
  if not coalesce((v_budget->>'allowed')::boolean,false) then return jsonb_build_object('claimed',false,'reason','quota_exceeded'); end if;
  insert into private.moderation_claims(target_table,target_id,snapshot,claim_id,reservation_id,claimed_until,attempts)
    values(p_table,p_id,v_snapshot,v_claim,(v_budget->>'reservation_id')::uuid,clock_timestamp()+interval '5 minutes',v_attempts)
  on conflict(target_table,target_id) do update set snapshot=excluded.snapshot,claim_id=excluded.claim_id,
    reservation_id=excluded.reservation_id,claimed_until=excluded.claimed_until,attempts=excluded.attempts,finished=false;
  return jsonb_build_object('claimed',true,'claim_id',v_claim,'reservation_id',v_budget->>'reservation_id','row',v_snapshot);
end $$;

create function public.moderation_finish(p_claim_id uuid,p_allow boolean default null,p_reason text default null,p_categories text[] default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_claim private.moderation_claims; v_snapshot jsonb; v_status text; v_result jsonb;
begin
  -- Consistent target-before-claim lock order prevents deadlock with claim().
  select * into v_claim from private.moderation_claims where claim_id=p_claim_id;
  if not found then return jsonb_build_object('status','skipped'); end if;
  v_snapshot:=private.moderation_snapshot(v_claim.target_table,v_claim.target_id);
  select * into v_claim from private.moderation_claims where claim_id=p_claim_id for update;
  if not found or v_claim.finished or v_claim.claimed_until<=clock_timestamp() then return jsonb_build_object('status','skipped'); end if;
  if p_allow is null then
    update private.moderation_claims set claimed_until=clock_timestamp() where claim_id=p_claim_id;
    return jsonb_build_object('status','retry');
  end if;
  if v_snapshot is distinct from v_claim.snapshot then
    update private.moderation_claims set finished=true where claim_id=p_claim_id;
    return jsonb_build_object('status','skipped');
  end if;
  if v_claim.target_table='profiles' then
    v_result:=public.avatar_moderation_apply(v_claim.target_id,v_snapshot->>'avatar_pending_path',
      (v_snapshot->>'avatar_requested_at')::timestamptz,p_allow,p_reason,p_categories);
  else
    v_status:=public.moderation_apply(v_claim.target_table,v_claim.target_id,
      (v_snapshot->>'moderation_requested_at')::timestamptz,p_allow,p_reason,p_categories);
    v_result:=jsonb_build_object('status',v_status);
  end if;
  update private.moderation_claims set finished=true where claim_id=p_claim_id;
  return v_result;
end $$;

revoke all on function public.ai_reserve_request(uuid,text,uuid,text) from public,anon,authenticated;
revoke all on function public.ai_consume_provider_attempt(uuid) from public,anon,authenticated;
revoke all on function public.moderation_claim(text,uuid) from public,anon,authenticated;
revoke all on function public.moderation_finish(uuid,boolean,text,text[]) from public,anon,authenticated;
revoke all on function private.moderation_snapshot(text,uuid) from public,anon,authenticated,service_role;
revoke all on function private.moderation_send(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.ai_reserve_request(uuid,text,uuid,text),public.ai_consume_provider_attempt(uuid),
  public.moderation_claim(text,uuid),public.moderation_finish(uuid,boolean,text,text[]) to service_role;

commit;
