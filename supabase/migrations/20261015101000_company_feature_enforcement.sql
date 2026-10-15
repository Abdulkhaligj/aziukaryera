-- Enforce company package rights at the database boundary.

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
  where s.company_id=v_company and s.status='active' and pf.feature_key='monthly_network_posts' and pf.enabled
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
      where s.company_id=v_company and s.status='active' and pf.feature_key='post_media' and pf.enabled
    ) into v_media;
    if not v_media then raise exception 'Paketiniz şəkil və sənəd paylaşımını dəstəkləmir'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists posts_plan_limit on public.posts;
create trigger posts_plan_limit before insert on public.posts
for each row execute function public.enforce_company_post_plan();

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
    where s.company_id=v_company and s.status='active' and pf.feature_key='post_media' and pf.enabled
  ) then raise exception 'Paketiniz şəkil və sənəd paylaşımını dəstəkləmir'; end if;
  return new;
end;
$$;

drop trigger if exists post_media_plan_limit on public.post_media;
create trigger post_media_plan_limit before insert on public.post_media
for each row execute function public.enforce_post_media_plan();

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
  where s.company_id=new.company_id and s.status='active' and pf.feature_key='team_members' and pf.enabled limit 1;
  if not found then v_limit:=1; end if;
  if v_limit is not null then
    select count(*) into v_count from public.company_members m where m.company_id=new.company_id and m.status in ('invited','active') and m.id<>new.id;
    if v_count>=v_limit then raise exception 'Paketinizin komanda üzvü limiti dolub'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists company_members_plan_limit on public.company_members;
create trigger company_members_plan_limit before insert or update of status,company_id on public.company_members
for each row execute function public.enforce_company_team_limit();

create or replace function public.sync_company_subscription_usage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_company uuid; v_subscription uuid; v_feature text; v_used integer; v_author uuid;
begin
  if tg_table_name='jobs' then
    v_company:=case when tg_op='DELETE' then old.company_id else new.company_id end; v_feature:='active_vacancies';
    select count(*) into v_used from public.jobs where company_id=v_company and status::text in ('pending','pending_approval','approved','published');
  elsif tg_table_name='posts' then
    v_author:=case when tg_op='DELETE' then old.author_id else new.author_id end;
    select id into v_company from public.companies where owner_id=v_author limit 1;
    if v_company is null then return case when tg_op='DELETE' then old else new end; end if;
    v_feature:='monthly_network_posts';
    select count(*) into v_used from public.posts where author_id=v_author and created_at>=date_trunc('month',now()) and created_at<date_trunc('month',now())+interval '1 month';
  else
    v_company:=case when tg_op='DELETE' then old.company_id else new.company_id end; v_feature:='team_members';
    select count(*) into v_used from public.company_members where company_id=v_company and status in ('invited','active');
  end if;
  select id into v_subscription from public.subscriptions where company_id=v_company and status='active' limit 1;
  if v_subscription is not null then
    insert into public.subscription_usage(subscription_id,feature_key,period_start,period_end,used_count,updated_at)
    values(v_subscription,v_feature,date_trunc('month',current_date)::date,(date_trunc('month',current_date)+interval '1 month'-interval '1 day')::date,v_used,now())
    on conflict(subscription_id,feature_key,period_start) do update set used_count=excluded.used_count,period_end=excluded.period_end,updated_at=now();
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

drop trigger if exists jobs_sync_usage on public.jobs;
create trigger jobs_sync_usage after insert or update of status,company_id or delete on public.jobs
for each row execute function public.sync_company_subscription_usage();
drop trigger if exists posts_sync_usage on public.posts;
create trigger posts_sync_usage after insert or delete on public.posts
for each row execute function public.sync_company_subscription_usage();
drop trigger if exists members_sync_usage on public.company_members;
create trigger members_sync_usage after insert or update of status,company_id or delete on public.company_members
for each row execute function public.sync_company_subscription_usage();

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (
  id=(select auth.uid())
  or (select public.is_admin())
  or (
    status='active'
    and role in ('student'::public.user_role,'graduate'::public.user_role)
    and exists(
      select 1
      from public.companies c
      join public.subscriptions s on s.company_id=c.id and s.status='active'
      join public.plan_features pf on pf.plan_id=s.plan_id and pf.feature_key='candidate_search' and pf.enabled
      where c.owner_id=(select auth.uid()) and c.status='active'
    )
  )
);

revoke execute on function public.enforce_company_post_plan() from public,anon,authenticated;
revoke execute on function public.enforce_post_media_plan() from public,anon,authenticated;
revoke execute on function public.enforce_company_team_limit() from public,anon,authenticated;
revoke execute on function public.sync_company_subscription_usage() from public,anon,authenticated;
