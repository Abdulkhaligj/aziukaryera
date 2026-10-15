-- Restrict direct RPC access to trigger-only functions and add covering indexes
-- for the highest-traffic relationships.

revoke execute on function public.enforce_company_job_limit() from public, anon, authenticated;
revoke execute on function public.guard_profile_privileges() from public, anon, authenticated;
revoke execute on function public.guard_company_status() from public, anon, authenticated;
revoke execute on function public.guard_job_status() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

revoke execute on function public.select_company_plan(text) from public, anon;
revoke execute on function public.app_role() from public, anon;
revoke execute on function public.owns_company(uuid) from public, anon;
revoke execute on function public.has_active_company() from public, anon;
revoke execute on function public.ranked_jobs_for() from public, anon;
revoke execute on function public.claim_benefit(uuid) from public, anon;
revoke execute on function public.redeem_benefit_code(text) from public, anon;

grant execute on function public.select_company_plan(text) to authenticated;
grant execute on function public.app_role() to authenticated;
grant execute on function public.owns_company(uuid) to authenticated;
grant execute on function public.has_active_company() to authenticated;
grant execute on function public.ranked_jobs_for() to authenticated;
grant execute on function public.claim_benefit(uuid) to authenticated;
grant execute on function public.redeem_benefit_code(text) to authenticated;

create index if not exists profiles_major_idx on public.profiles(major_id);
create index if not exists saved_jobs_job_idx on public.saved_jobs(job_id);
create index if not exists invites_student_idx on public.invites(student_id);
create index if not exists invites_job_idx on public.invites(job_id);
create index if not exists event_regs_profile_idx on public.event_registrations(profile_id);
create index if not exists post_likes_profile_idx on public.post_likes(profile_id);
create index if not exists post_comments_author_idx on public.post_comments(author_id);
create index if not exists post_saves_profile_idx on public.post_saves(profile_id);
create index if not exists reports_reporter_idx on public.reports(reporter_id);
create index if not exists reports_reviewer_idx on public.reports(reviewed_by);
create index if not exists ai_usage_profile_idx on public.ai_usage(profile_id);
create index if not exists interviews_job_idx on public.interview_sessions(job_id);
create index if not exists interviews_company_idx on public.interview_sessions(company_id);
create index if not exists subscriptions_plan_idx on public.subscriptions(plan_id);
create index if not exists subscriptions_approver_idx on public.subscriptions(approved_by);
create index if not exists audit_actor_idx on public.admin_audit_logs(actor_id);

drop policy if exists post_saves_own on public.post_saves;
create policy post_saves_own on public.post_saves for all to authenticated
using (profile_id=(select auth.uid())) with check (profile_id=(select auth.uid()));
drop policy if exists reports_insert_own on public.reports;
create policy reports_insert_own on public.reports for insert to authenticated with check (reporter_id=(select auth.uid()));
drop policy if exists ai_usage_insert on public.ai_usage;
create policy ai_usage_insert on public.ai_usage for insert to authenticated with check (profile_id=(select auth.uid()));
