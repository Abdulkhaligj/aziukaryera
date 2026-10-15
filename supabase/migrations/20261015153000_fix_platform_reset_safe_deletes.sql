-- Make the Super Admin reset compatible with Supabase safeupdate and include
-- all connected platform tables introduced after the original reset function.

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

  if v_actor is null
     or coalesce((select auth.jwt() -> 'app_metadata' ->> 'admin_role'), '') <> 'super_admin'
     or not exists (
       select 1
       from public.profiles profile
       where profile.id = v_actor
         and profile.role = 'admin'::public.user_role
         and profile.status = 'active'::public.account_status
     ) then
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

revoke all on function private.reset_career_platform(text) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.reset_career_platform(text) to authenticated;
