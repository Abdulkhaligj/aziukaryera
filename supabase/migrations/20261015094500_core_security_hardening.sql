-- Follow-up hardening after running Supabase security/performance advisors.

create or replace function public.company_feature_limit(p_company_id uuid, p_feature_key text)
returns integer
language sql
stable
security invoker
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
security invoker
set search_path = ''
as $$
  select exists(
    select 1 from public.subscriptions s
    join public.plan_features pf on pf.plan_id=s.plan_id
    where s.company_id=p_company_id and s.status='active' and pf.feature_key=p_feature_key and pf.enabled
  );
$$;

revoke execute on function public.company_feature_limit(uuid,text) from public,anon;
revoke execute on function public.company_has_feature(uuid,text) from public,anon;
grant execute on function public.company_feature_limit(uuid,text) to authenticated;
grant execute on function public.company_has_feature(uuid,text) to authenticated;

create index if not exists application_history_actor_idx on public.application_status_history(changed_by);
create index if not exists company_members_profile_idx on public.company_members(profile_id);
create index if not exists moderation_logs_report_idx on public.moderation_logs(report_id);
create index if not exists moderation_logs_actor_idx on public.moderation_logs(actor_id);
create index if not exists payments_subscription_idx on public.payments(subscription_id);

drop policy if exists plan_features_admin on public.plan_features;
create policy plan_features_admin_insert on public.plan_features for insert to authenticated with check ((select public.is_admin()));
create policy plan_features_admin_update on public.plan_features for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy plan_features_admin_delete on public.plan_features for delete to authenticated using ((select public.is_admin()));

drop policy if exists usage_read on public.subscription_usage;
drop policy if exists usage_admin on public.subscription_usage;
create policy usage_read on public.subscription_usage for select to authenticated using (
  (select public.is_admin()) or exists(select 1 from public.subscriptions s where s.id=subscription_id and public.owns_company(s.company_id))
);
create policy usage_admin_insert on public.subscription_usage for insert to authenticated with check ((select public.is_admin()));
create policy usage_admin_update on public.subscription_usage for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy usage_admin_delete on public.subscription_usage for delete to authenticated using ((select public.is_admin()));

drop policy if exists company_members_read on public.company_members;
drop policy if exists company_members_manage on public.company_members;
create policy company_members_read on public.company_members for select to authenticated using (profile_id=(select auth.uid()) or public.owns_company(company_id) or (select public.is_admin()));
create policy company_members_insert on public.company_members for insert to authenticated with check (public.owns_company(company_id) or (select public.is_admin()));
create policy company_members_update on public.company_members for update to authenticated using (public.owns_company(company_id) or (select public.is_admin())) with check (public.owns_company(company_id) or (select public.is_admin()));
create policy company_members_delete on public.company_members for delete to authenticated using (public.owns_company(company_id) or (select public.is_admin()));

drop policy if exists application_history_read on public.application_status_history;
create policy application_history_read on public.application_status_history for select to authenticated using (
  (select public.is_admin()) or exists(select 1 from public.applications a join public.jobs j on j.id=a.job_id where a.id=application_id and (a.student_id=(select auth.uid()) or public.owns_company(j.company_id)))
);

drop policy if exists post_media_read on public.post_media;
drop policy if exists post_media_write on public.post_media;
create policy post_media_read on public.post_media for select to authenticated using (exists(select 1 from public.posts p where p.id=post_id));
create policy post_media_insert on public.post_media for insert to authenticated with check (exists(select 1 from public.posts p where p.id=post_id and (p.author_id=(select auth.uid()) or (select public.is_admin()))));
create policy post_media_update on public.post_media for update to authenticated using (exists(select 1 from public.posts p where p.id=post_id and (p.author_id=(select auth.uid()) or (select public.is_admin())))) with check (exists(select 1 from public.posts p where p.id=post_id and (p.author_id=(select auth.uid()) or (select public.is_admin()))));
create policy post_media_delete on public.post_media for delete to authenticated using (exists(select 1 from public.posts p where p.id=post_id and (p.author_id=(select auth.uid()) or (select public.is_admin()))));

drop policy if exists follows_own on public.follows;
create policy follows_select on public.follows for select to authenticated using (follower_id=(select auth.uid()));
create policy follows_insert on public.follows for insert to authenticated with check (follower_id=(select auth.uid()));
create policy follows_delete on public.follows for delete to authenticated using (follower_id=(select auth.uid()));

drop policy if exists payments_read on public.payments;
drop policy if exists payments_admin on public.payments;
create policy payments_read on public.payments for select to authenticated using ((select public.is_admin()) or public.owns_company(company_id));
create policy payments_admin_insert on public.payments for insert to authenticated with check ((select public.is_admin()));
create policy payments_admin_update on public.payments for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy payments_admin_delete on public.payments for delete to authenticated using ((select public.is_admin()));
