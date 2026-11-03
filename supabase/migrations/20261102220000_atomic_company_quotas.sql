-- VIBE-03: transaction-safe company limits. This upgrades the complete schema;
-- it does not replace the missing original handover baseline.
begin;

-- Block writes while establishing the initial counters and installing every
-- lifecycle hook. Existing over-limit rows are retained, not silently removed.
lock table public.jobs, public.company_members, public.posts in share row exclusive mode;

create table private.company_quota_counters (
  subject_id uuid not null,
  feature_key text not null check (feature_key in ('active_vacancies','team_members','monthly_network_posts')),
  period_start date not null,
  used_count bigint not null check (used_count >= 0),
  primary key(subject_id,feature_key,period_start)
);
alter table private.company_quota_counters enable row level security;
revoke all on private.company_quota_counters from public, anon, authenticated, service_role;

-- Supabase's existing default UTC month is explicit, independent of any
-- session/request timezone. Jobs/team use one lifetime occupancy bucket.
create function private.quota_month(p_at timestamptz)
returns date language sql immutable strict set search_path = '' as $$
  select date_trunc('month',p_at at time zone 'UTC')::date;
$$;
revoke all on function private.quota_month(timestamptz) from public, anon, authenticated, service_role;

do $$ begin
  if exists(select 1 from public.posts where author_id is null or created_at is null) then
    raise exception 'Posts without author/creation time require explicit reconciliation before quota migration';
  end if;
end $$;
insert into private.company_quota_counters(subject_id,feature_key,period_start,used_count)
  select company_id,'active_vacancies',date '0001-01-01',count(*) from public.jobs
  where company_id is not null and status::text in ('pending','pending_approval','approved','published') group by company_id;
insert into private.company_quota_counters(subject_id,feature_key,period_start,used_count)
  select company_id,'team_members',date '0001-01-01',count(*) from public.company_members
  where company_id is not null and status::text in ('invited','active') group by company_id;
-- The previous post cap counted all posts by the author, not just one company
-- row. Track every author so later company activation cannot erase prior use.
insert into private.company_quota_counters(subject_id,feature_key,period_start,used_count)
  select author_id,'monthly_network_posts',private.quota_month(created_at),count(*) from public.posts
  group by author_id,private.quota_month(created_at);

create function private.reserve_company_quota(
  p_subject uuid,p_feature text,p_period date,p_delta integer,p_limit integer,p_enforce boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare changed bigint;
begin
  if p_limit < 0 then raise exception 'Invalid negative quota limit' using errcode='23514'; end if;
  insert into private.company_quota_counters(subject_id,feature_key,period_start,used_count)
    values(p_subject,p_feature,p_period,0) on conflict do nothing;
  -- UPDATE locks and tests the current counter version atomically. Under
  -- REPEATABLE READ a conflicting stale writer is serialized/aborted instead
  -- of authorizing a stale count after waiting for a lock.
  update private.company_quota_counters set used_count=used_count+p_delta
    where subject_id=p_subject and feature_key=p_feature and period_start=p_period
      and used_count+p_delta>=0
      and (p_delta<=0 or not p_enforce or p_limit is null or used_count+p_delta<=p_limit)
    returning used_count into changed;
  if not found then
    if p_delta>0 then raise exception 'Paketinizin limiti dolub' using errcode='23514'; end if;
    raise exception 'Quota accounting is inconsistent; operation rolled back' using errcode='23514';
  end if;
end $$;
revoke all on function private.reserve_company_quota(uuid,text,date,integer,integer,boolean) from public, anon, authenticated, service_role;

create function private.apply_company_quota()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  feature text;
  old_subject uuid; new_subject uuid;
  old_period date:=date '0001-01-01'; new_period date:=date '0001-01-01';
  old_counted boolean:=false; new_counted boolean:=false;
  company uuid; cap integer; enforce boolean; is_staff boolean:=public.is_admin();
  actor_role text:=coalesce(current_setting('role',true),'');
  delta_row record;
begin
  if tg_table_name='jobs' then
    feature:='active_vacancies';
    if tg_op<>'INSERT' then old_subject:=old.company_id; old_counted:=coalesce(old.status::text in ('pending','pending_approval','approved','published'),false); end if;
    if tg_op<>'DELETE' then new_subject:=new.company_id; new_counted:=coalesce(new.status::text in ('pending','pending_approval','approved','published'),false); end if;
    company:=new_subject;
  elsif tg_table_name='company_members' then
    feature:='team_members';
    if tg_op<>'INSERT' then old_subject:=old.company_id; old_counted:=coalesce(old.status::text in ('invited','active'),false); end if;
    if tg_op<>'DELETE' then new_subject:=new.company_id; new_counted:=coalesce(new.status::text in ('invited','active'),false); end if;
    company:=new_subject;
  else
    feature:='monthly_network_posts';
    if tg_op<>'INSERT' then old_subject:=old.author_id; old_period:=private.quota_month(old.created_at); old_counted:=true; end if;
    if tg_op<>'DELETE' then
      if new.author_id is null or new.created_at is null then raise exception 'Post author and creation time are required' using errcode='23514'; end if;
      -- Browser createPost omits created_at. Its DB default is now(). An
      -- ordinary author may neither backdate INSERT nor move existing posts
      -- into a different owner's/month's bucket. Trusted imports can do so.
      if actor_role in ('authenticated','anon') and not is_staff then
        if (tg_op='INSERT' and new.created_at is distinct from transaction_timestamp())
           or (tg_op='UPDATE' and (new.author_id is distinct from old.author_id or new.created_at is distinct from old.created_at)) then
          raise exception 'Post author and creation time are server-owned' using errcode='42501';
        end if;
      end if;
      new_subject:=new.author_id; new_period:=private.quota_month(new.created_at); new_counted:=true;
      select c.id into company from public.companies c where c.owner_id=new.author_id and c.status::text='active' order by c.id limit 1;
      if company is not null and new.attachment_url is not null
         and (tg_op='INSERT' or new.attachment_url is distinct from old.attachment_url or new.author_id is distinct from old.author_id)
         and not public.company_has_feature(company,'post_media') then
        raise exception 'Paketiniz şəkil və sənəd paylaşımını dəstəkləmir' using errcode='23514';
      end if;
    end if;
  end if;

  -- A no-op/edit or invited->active transition has delta zero and must remain
  -- usable at the cap. Deterministic old/new key order also covers moves.
  for delta_row in
    select subject,period,sum(delta)::integer as delta from (values
      (old_subject,old_period,case when old_counted then -1 else 0 end),
      (new_subject,new_period,case when new_counted then 1 else 0 end)
    ) q(subject,period,delta) where subject is not null and delta<>0
    group by subject,period having sum(delta)<>0 order by subject,period
  loop
    cap:=null; enforce:=false;
    if delta_row.delta>0 then
      if feature='monthly_network_posts' then
        -- Historical trusted imports keep their historical bucket; current
        -- published-month use is governed by the current package.
        enforce:=company is not null and delta_row.period=private.quota_month(transaction_timestamp());
      else enforce:=not is_staff;
      end if;
      if enforce then
        select pf.limit_value into cap from public.subscriptions s join public.plan_features pf on pf.plan_id=s.plan_id
          where s.company_id=company and s.status::text='active'
            and (s.starts_at is null or s.starts_at<=now()) and (s.plan_id='free' or s.ends_at>now())
            and pf.feature_key=feature and pf.enabled order by s.starts_at desc nulls last,s.id limit 1;
        if not found then
          if feature='monthly_network_posts' then raise exception 'Aktiv şirkət paketiniz yoxdur' using errcode='23514'; end if;
          cap:=1;
        end if;
      end if;
    end if;
    perform private.reserve_company_quota(delta_row.subject,feature,delta_row.period,delta_row.delta,cap,enforce);
  end loop;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function private.apply_company_quota() from public, anon, authenticated, service_role;

-- AFTER runs only for the row actually inserted/updated, including an UPSERT.
-- Exceeding a cap raises in this transaction and rolls back the business row,
-- counter, audit and queued pg_net work together. BEFORE speculative INSERT
-- reservations would otherwise leak capacity on ON CONFLICT DO UPDATE.
drop trigger if exists jobs_plan_limit on public.jobs;
drop trigger if exists company_members_plan_limit on public.company_members;
drop trigger if exists posts_plan_limit on public.posts;
create trigger "000_atomic_company_quota" after insert or update or delete on public.jobs
  for each row execute function private.apply_company_quota();
create trigger "000_atomic_company_quota" after insert or update or delete on public.company_members
  for each row execute function private.apply_company_quota();
create trigger "000_atomic_company_quota" after insert or update or delete on public.posts
  for each row execute function private.apply_company_quota();

-- Usage is a projection of the authoritative counters. Do not recount an old
-- MVCC snapshot after waiting, or forget the source company on a row move.
create or replace function public.sync_company_subscription_usage()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  feature text; subjects uuid[]; companies uuid[];
  quota_period date:=date '0001-01-01';
  month_start date:=private.quota_month(transaction_timestamp());
  item record; sub_id uuid; used bigint;
begin
  if tg_table_name='posts' then
    feature:='monthly_network_posts';quota_period:=month_start;
    subjects:=array[case when tg_op<>'INSERT' then old.author_id end,case when tg_op<>'DELETE' then new.author_id end];
  else
    feature:=case when tg_table_name='jobs' then 'active_vacancies' else 'team_members' end;
    companies:=array[case when tg_op<>'INSERT' then old.company_id end,case when tg_op<>'DELETE' then new.company_id end];
  end if;
  for item in select c.id,c.owner_id from public.companies c
    where (feature='monthly_network_posts' and c.owner_id=any(subjects)) or c.id=any(companies)
    order by c.id
  loop
    select s.id into sub_id from public.subscriptions s where s.company_id=item.id and s.status::text='active' order by s.id limit 1;
    if sub_id is null then continue; end if;
    select q.used_count into used from private.company_quota_counters q
      where q.subject_id=case when feature='monthly_network_posts' then item.owner_id else item.id end
        and q.feature_key=feature and q.period_start=quota_period;
    insert into public.subscription_usage(subscription_id,feature_key,period_start,period_end,used_count,updated_at)
      values(sub_id,feature,month_start,(month_start+interval '1 month'-interval '1 day')::date,coalesce(used,0),now())
      on conflict(subscription_id,feature_key,period_start) do update set used_count=excluded.used_count,period_end=excluded.period_end,updated_at=now();
  end loop;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.sync_company_subscription_usage() from public, anon, authenticated, service_role;
drop trigger if exists jobs_sync_usage on public.jobs;
create trigger jobs_sync_usage after insert or update or delete on public.jobs
  for each row execute function public.sync_company_subscription_usage();
drop trigger if exists posts_sync_usage on public.posts;
create trigger posts_sync_usage after insert or update or delete on public.posts
  for each row execute function public.sync_company_subscription_usage();
drop trigger if exists members_sync_usage on public.company_members;
create trigger members_sync_usage after insert or update or delete on public.company_members
  for each row execute function public.sync_company_subscription_usage();
commit;
