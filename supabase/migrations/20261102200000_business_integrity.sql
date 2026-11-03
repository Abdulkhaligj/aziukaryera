-- Security remediation R2-01/R2-02/R2-04. Upgrades a complete existing schema.
begin;

-- A generation key is never reused, even after removal. Previously issued
-- signed URLs may outlive a profile pointer; a path-only live-reference check
-- would otherwise let a removed photo's URL resolve to new unchecked bytes.
create table private.avatar_generations (
  path text primary key,
  object_id uuid,
  created_at timestamptz not null default now()
);
revoke all on private.avatar_generations from public, anon, authenticated;
insert into private.avatar_generations(path,object_id)
  select name,id from storage.objects where bucket_id = 'avatars';
insert into private.avatar_generations(path)
  select path from (
    select avatar_path as path from public.profiles
    union select avatar_pending_path from public.profiles
  ) p where path is not null on conflict(path) do nothing;
create or replace function private.avatar_new_generation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.bucket_id = 'avatars' then
    insert into private.avatar_generations(path,object_id) values(new.name,new.id)
      on conflict(path) do nothing;
    if not found then
      raise exception 'Avatar generation keys cannot be reused; upload a new random path' using errcode='23505';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.avatar_new_generation() from public, anon, authenticated;
drop trigger if exists security_avatar_new_generation on storage.objects;
create trigger security_avatar_new_generation before insert on storage.objects
  for each row execute function private.avatar_new_generation();

-- Approved and in-flight avatar generations cannot be replaced through the
-- owner's DELETE + INSERT path. Unreferenced obsolete generations remain
-- removable after avatar_remove() / replacement clears the profile pointer.
create or replace function public.avatar_path_is_referenced(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p
    where p.avatar_path = p_path or p.avatar_pending_path = p_path);
$$;
revoke all on function public.avatar_path_is_referenced(text) from public, anon;
grant execute on function public.avatar_path_is_referenced(text) to authenticated;
drop policy if exists security_avatar_insert_generation on storage.objects;
create policy security_avatar_insert_generation on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'avatars' or not public.avatar_path_is_referenced(name));
drop policy if exists security_avatar_delete_generation on storage.objects;
create policy security_avatar_delete_generation on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'avatars' or not public.avatar_path_is_referenced(name));
drop policy if exists security_avatar_update_generation on storage.objects;
create policy security_avatar_update_generation on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'avatars') with check (bucket_id <> 'avatars');

-- Trigger backstop also covers a future permissive policy and locks the
-- referring profile before a generation can be removed. Service cleanup uses
-- the Storage API after clearing the profile pointer, never SQL file deletion.
create or replace function private.avatar_generation_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('role',true),'') in ('authenticated','anon') and old.bucket_id = 'avatars' then
    perform 1 from public.profiles p
      where p.avatar_path = old.name or p.avatar_pending_path = old.name for update;
    if found then
      raise exception 'A referenced avatar generation is immutable' using errcode='42501';
    end if;
  end if;
  if tg_op = 'UPDATE' then return new; end if;
  return old;
end $$;
revoke all on function private.avatar_generation_guard() from public, anon, authenticated;
drop trigger if exists security_avatar_generation on storage.objects;
create trigger security_avatar_generation before delete or update on storage.objects
  for each row execute function private.avatar_generation_guard();

-- Immutable payment identity survives status reversals and deletion. Existing
-- paid rows are backfilled as already credited, without granting time again.
create table private.payment_entitlements (
  payment_id uuid primary key,
  company_id uuid not null,
  plan_id text not null,
  months integer not null check (months between 1 and 12),
  credited_at timestamptz not null default now()
);
revoke all on private.payment_entitlements from public, anon, authenticated;
insert into private.payment_entitlements(payment_id,company_id,plan_id,months,credited_at)
select id,company_id,plan_id,months,coalesce(paid_at,now()) from public.payments
where (status::text = 'paid' or paid_at is not null) and plan_id is not null;

create or replace function private.payments_apply()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_sub public.subscriptions;
  v_plan public.plans;
  v_existing private.payment_entitlements;
  v_extend boolean;
  v_base timestamptz;
  v_claimed uuid;
begin
  if tg_op = 'UPDATE' and new.id is distinct from old.id then
    raise exception 'Invoice identifiers are immutable' using errcode='23514';
  end if;
  select * into v_existing from private.payment_entitlements where payment_id = new.id;
  if found then
    if new.company_id is distinct from v_existing.company_id
       or new.plan_id is distinct from v_existing.plan_id
       or new.months is distinct from v_existing.months then
      raise exception 'Credited invoice identity and period are immutable' using errcode='23514';
    end if;
    new.paid_at := v_existing.credited_at;
    return new;
  end if;
  if new.status::text <> 'paid' then return new; end if;
  new.paid_at := coalesce(new.paid_at,now());
  if new.plan_id is null then return new; end if;
  select * into v_plan from public.plans where id = new.plan_id;
  if not found or new.months not between 1 and 12 then
    raise exception 'Invalid invoice plan or period' using errcode='23514';
  end if;
  insert into private.payment_entitlements(payment_id,company_id,plan_id,months)
    values(new.id,new.company_id,new.plan_id,new.months)
    on conflict(payment_id) do nothing returning payment_id into v_claimed;
  if v_claimed is null then return new; end if;
  insert into public.subscriptions(company_id,plan_id,status)
    values(new.company_id,'free','active') on conflict(company_id) do nothing;
  select * into v_sub from public.subscriptions where company_id = new.company_id for update;
  v_extend := v_sub.plan_id = new.plan_id and v_sub.status::text = 'active' and v_sub.ends_at > now();
  v_base := case when v_extend then v_sub.ends_at else now() end;
  update public.subscriptions set plan_id = new.plan_id,status = 'active',
    starts_at = case when v_extend then v_sub.starts_at else now() end,
    ends_at = v_base + make_interval(days => 30 * new.months),
    requested_plan_id = case when v_sub.requested_plan_id = new.plan_id then null else v_sub.requested_plan_id end,
    approved_by = coalesce(auth.uid(),v_sub.approved_by),reminder_sent_at = null
    where id = v_sub.id returning * into v_sub;
  new.subscription_id := v_sub.id;
  perform private.notify_company(new.company_id,'subscription_active',v_plan.name || ' paketi aktivdir',
    'Ödəniş qəbul edildi. Paket ' || to_char(v_sub.ends_at at time zone 'Asia/Baku','DD.MM.YYYY') || ' tarixinədək aktivdir.');
  return new;
end $$;
-- Fire for every update so changing plan/months/company cannot escape the
-- credited identity guard by omitting status from the PATCH payload.
drop trigger if exists payments_apply on public.payments;
create trigger payments_apply before insert or update on public.payments
  for each row execute function private.payments_apply();

-- Exclusion constraints enforce overlap under concurrent INSERT and UPDATE,
-- including REPEATABLE READ. Historical collisions fail this migration so an
-- operator can reconcile them explicitly; no appointment is silently removed.
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
create or replace function private.interview_end(p_start timestamptz,p_minutes integer)
returns timestamptz language sql immutable strict set search_path = '' as $$
  select p_start + make_interval(secs => p_minutes * 60);
$$;
revoke all on function private.interview_end(timestamptz,integer) from public, anon;
grant execute on function private.interview_end(timestamptz,integer) to authenticated;
alter table public.company_interview_slots
  add constraint company_interview_slots_no_overlap exclude using gist
    (application_id with =, tstzrange(starts_at,private.interview_end(starts_at,duration_minutes),'[)') with &&)
    where (status = 'scheduled');
commit;
