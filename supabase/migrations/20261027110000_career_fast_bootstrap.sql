-- One PostgREST request replaces 16 independent startup requests.
-- SECURITY INVOKER: each subquery retains the caller's original table RLS.
-- No writes, no privileged grants to private tables.
create or replace function public.career_bootstrap_v1()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'Hesaba daxil olmaq tələb olunur.' using errcode='28000';
  end if;
  return (
    select jsonb_build_object(
      'uid', me,
      'email', coalesce(auth.jwt()->>'email', ''),
      'faculties', (select coalesce(jsonb_agg(to_jsonb(f) order by f.sort_order),'[]'::jsonb) from public.faculties f),
      'majors', (select coalesce(jsonb_agg(to_jsonb(m)),'[]'::jsonb) from public.majors m),
      'profile', (select to_jsonb(p) from public.profiles p where p.id = me limit 1),
      'education', (select coalesce(jsonb_agg(to_jsonb(e) order by e.start_year asc),'[]'::jsonb) from public.education e where e.profile_id = me),
      'candidates', (select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
        select id,full_name,role,status,faculty_id,major_id,course,gpa,skills,summary,account_status
        from public.profiles where role in ('student','graduate') and status='active'
      ) x),
      'companies', (select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) from public.companies c),
      'jobs', (select coalesce(jsonb_agg(to_jsonb(j)),'[]'::jsonb) from public.jobs j),
      'applications', (select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from public.applications a),
      'saved', (select coalesce(jsonb_agg(s.job_id),'[]'::jsonb) from public.saved_jobs s),
      'invites', (select coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) from public.invites i),
      'events', (select coalesce(jsonb_agg(to_jsonb(e) order by e.starts_at asc),'[]'::jsonb) from public.events e),
      'eventRegistrations', (select coalesce(jsonb_agg(r.event_id),'[]'::jsonb) from public.event_registrations r),
      'subscription', (select to_jsonb(s) || jsonb_build_object('plans',to_jsonb(p))
        from public.subscriptions s left join public.plans p on p.id = s.plan_id
        order by (s.status='active') desc,s.starts_at desc limit 1),
      'notifications', (select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc),'[]'::jsonb)
        from (select * from public.notifications order by created_at desc limit 100) n),
      'broadcasts', (select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc),'[]'::jsonb)
        from (select * from public.broadcast_notifications order by created_at desc limit 100) n),
      'broadcastReads', (select coalesce(jsonb_agg(jsonb_build_object('broadcast_id',r.broadcast_id,'read_at',r.read_at)),'[]'::jsonb)
        from public.broadcast_notification_reads r)
    )
  );
end;
$$;
revoke all on function public.career_bootstrap_v1() from public, anon;
grant execute on function public.career_bootstrap_v1() to authenticated;
