"""Exact VIBE-03 migration against isolated PostgreSQL 17.

The original full baseline is absent. This fixture reuses the documented
synthetic schema and exact supplied INSERT policies; missing original owner
UPDATE/DELETE policies are explicit fixture assumptions, not a live grant claim.
No host ports, cloud services or provider requests are used.
"""
from pathlib import Path
import concurrent.futures
import re
import time
import uuid
import test_security_migrations as base

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "migrations/20261102220000_atomic_company_quotas.sql"
CID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
CID2 = "abababab-abab-abab-abab-abababababab"
EMP = "33333333-3333-3333-3333-333333333333"
OTHER = "66666666-6666-4666-8666-666666666666"
MEMBER1 = "11111111-1111-1111-1111-111111111111"
MEMBER2 = "22222222-2222-2222-2222-222222222222"
MANAGER = "44444444-4444-4444-4444-444444444444"
base.NAME = "career-atomic-quotas-" + uuid.uuid4().hex[:12]


def extract(kind, name, filename):
    source = (ROOT / "migrations" / filename).read_text(encoding="utf-8")
    pattern = (r"create or replace function " + re.escape(name) + r"\([\s\S]*?\$\$;"
               if kind == "function" else r"create policy " + re.escape(name) + r"(?=\s)[\s\S]*?;")
    match = re.search(pattern, source, re.I)
    assert match, name
    return match.group()


def assert_sql(predicate, message):
    base.sql(base.assert_sql(predicate, message))


def denied(source, expected):
    result = base.sql(source, check=False)
    assert result.returncode != 0 and expected in result.stderr, (result.stdout, result.stderr)
    return result


def counter(subject, feature, expected):
    period = "private.quota_month(now())" if feature == "monthly_network_posts" else "date '0001-01-01'"
    assert_sql(f"(select used_count={expected} from private.company_quota_counters where subject_id='{subject}' "
               f"and feature_key='{feature}' and period_start={period})", "wrong quota counter")


def clear():
    base.sql("delete from public.jobs;delete from public.company_members;delete from public.posts;")


def job(company=CID, status="pending", row_id=None):
    return ("insert into public.jobs(id,company_id,status,title) values(" +
            ("'" + row_id + "'" if row_id else "gen_random_uuid()") + f",'{company}','{status}','Fixture');")


def member(profile=MEMBER1, company=CID, status="active", row_id=None):
    return ("insert into public.company_members(id,company_id,profile_id,status) values(" +
            ("'" + row_id + "'" if row_id else "gen_random_uuid()") + f",'{company}','{profile}','{status}');")


def post(author=EMP, row_id=None):
    return ("insert into public.posts(id,author_id,body,moderation_status) values(" +
            ("'" + row_id + "'" if row_id else "gen_random_uuid()") + f",'{author}','Ordinary post','pending');")


def race(label, first, second, table, isolation, who=EMP):
    clear()
    actor = base.actor(who)
    a = f"begin;set transaction isolation level {isolation};" + actor + first + "select pg_sleep(.7);commit;"
    b = f"begin;set transaction isolation level {isolation};" + actor + second + "commit;"
    with concurrent.futures.ThreadPoolExecutor() as pool:
        one = pool.submit(base.sql, a, False)
        time.sleep(.15)
        two = pool.submit(base.sql, b, False)
        results = [one.result(), two.result()]
    assert sum(r.returncode == 0 for r in results) == 1, [(r.returncode, r.stderr) for r in results]
    failed = next(r for r in results if r.returncode)
    assert "limiti dolub" in failed.stderr or "could not serialize" in failed.stderr, failed.stderr
    assert_sql(f"(select count(*)=1 from public.{table})", "parallel quota exceeded")
    print(f"PASS {label} {isolation}: last slot permits one commit, other denied/serialized", flush=True)


def setup(apply_upgrade=True):
    base.sql(base.FIXTURE)
    for name in ["20261102190000_security_boundaries.sql", "20261102200000_business_integrity.sql"]:
        base.sql((ROOT / "migrations" / name).read_text(encoding="utf-8"))
    base.sql("""
      drop table public.subscription_usage;
      create table public.subscription_usage(
        subscription_id uuid not null references public.subscriptions(id) on delete cascade,
        feature_key text not null,period_start date not null,period_end date not null,
        used_count bigint not null default 0 check(used_count>=0),updated_at timestamptz not null default now(),
        primary key(subscription_id,feature_key,period_start));
      alter table public.company_members add foreign key(company_id) references public.companies(id);
      alter table public.company_members add foreign key(profile_id) references public.profiles(id);
      alter table public.company_members add unique(company_id,profile_id);
      delete from public.jobs;delete from public.posts;
      insert into auth.users values('66666666-6666-4666-8666-666666666666','{}');
      insert into public.profiles(id,role,status,full_name) values('66666666-6666-4666-8666-666666666666','company','active','Other employer');
      insert into public.companies values('abababab-abab-abab-abab-abababababab','66666666-6666-4666-8666-666666666666','active','Other company');
      update public.subscriptions set plan_id='free',ends_at=null;
      insert into public.subscriptions(company_id,plan_id,status) values('abababab-abab-abab-abab-abababababab','free','active');
      insert into public.plan_features values
        ('free','active_vacancies',true,1),('free','team_members',true,1),('free','monthly_network_posts',true,1),
        ('free','post_media',false,0);
      drop policy legacy_all on public.jobs;drop policy legacy_all on public.posts;drop policy legacy_all on public.company_members;
      create policy jobs_owner_read on public.jobs for select to authenticated using(public.owns_company(company_id) or public.is_admin());
      create policy jobs_owner_update_fixture on public.jobs for update to authenticated using(public.owns_company(company_id) or public.is_admin()) with check(public.owns_company(company_id) or public.is_admin());
      create policy jobs_owner_delete_fixture on public.jobs for delete to authenticated using(public.owns_company(company_id) or public.is_admin());
      create policy posts_owner_read on public.posts for select to authenticated using(author_id=auth.uid());
      create policy posts_owner_update_fixture on public.posts for update to authenticated using(author_id=auth.uid()) with check(author_id=auth.uid());
      create policy posts_owner_delete_fixture on public.posts for delete to authenticated using(author_id=auth.uid());
    """)
    base.sql(extract("policy", "jobs_insert", "20261015090000_core_saas_workflow.sql"))
    base.sql(extract("policy", '"admins insert jobs"', "20260919084435_integrate_admin_panel.sql"))
    base.sql(extract("policy", "posts_insert", "20261014000200_verify_alumni_access.sql"))
    for name in ["company_members_read", "company_members_insert", "company_members_update", "company_members_delete"]:
        base.sql(extract("policy", name, "20261015094500_core_security_hardening.sql"))
    # Existing exact usage sync and hooks are present before upgrade.
    base.sql(extract("function", "public.sync_company_subscription_usage", "20261015101000_company_feature_enforcement.sql"))
    base.sql("""
      create trigger jobs_plan_limit before insert or update of status,company_id on public.jobs for each row execute function public.enforce_company_job_limit();
      create trigger company_members_plan_limit before insert or update of status,company_id on public.company_members for each row execute function public.enforce_company_team_limit();
      create trigger posts_plan_limit before insert on public.posts for each row execute function public.enforce_company_post_plan();
      create trigger jobs_sync_usage after insert or update of status,company_id or delete on public.jobs for each row execute function public.sync_company_subscription_usage();
      create trigger members_sync_usage after insert or update of status,company_id or delete on public.company_members for each row execute function public.sync_company_subscription_usage();
      create trigger posts_sync_usage after insert or delete on public.posts for each row execute function public.sync_company_subscription_usage();
    """)
    base.sql(base.actor(EMP) + job() + member() + post())
    # Keep a historical overage intact while upgrading. Only future positive
    # reservations are denied; migration must not silently delete old rows.
    base.sql("set request.jwt.claim.sub='" + MANAGER + "';set request.jwt.claims='{\"app_metadata\":{\"admin_role\":\"manager\"}}';" + job())
    if apply_upgrade:
        base.sql(MIGRATION.read_text(encoding="utf-8"))


def main():
    base.docker("run", "--rm", "-d", "--network", "none", "--name", base.NAME,
                "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine")
    try:
        for _ in range(60):
            if base.docker("exec", base.NAME, "pg_isready", "-U", "postgres", check=False).returncode == 0:
                break
            time.sleep(.25)
        setup()
        counter(CID, "active_vacancies", 2)
        counter(CID, "team_members", 1)
        counter(EMP, "monthly_network_posts", 1)
        assert_sql("(select count(*)=2 from public.jobs)", "existing overage silently removed")
        denied(base.actor(EMP) + job(), "limiti dolub")
        denied(base.actor(EMP) + "select * from private.company_quota_counters;", "permission denied")
        denied(base.actor(EMP) + "select private.reserve_company_quota('" + CID + "','active_vacancies','0001-01-01',-1,1,false);", "permission denied")
        print("PASS exact migration seeds existing occupancy and denies direct counter/function access", flush=True)
        for isolation in ["read committed", "repeatable read"]:
            race("vacancy", job(), job(), "jobs", isolation)
            race("team", member(), member(MEMBER2), "company_members", isolation)
            race("monthly post", post(), post(), "posts", isolation)
        race("cold vacancy counter", job(CID2), job(CID2), "jobs", "read committed", OTHER)
        race("cold monthly post counter", post(OTHER), post(OTHER), "posts", "repeatable read", OTHER)
        clear()
        denied(base.actor(OTHER) + job(), "row-level security")
        base.sql(base.actor(EMP) + job() + member() + post())
        print("PASS unrelated owner denied and ordinary owner writes permitted under cap", flush=True)
        # An update of an existing row is not a second occupancy reservation.
        base.sql(base.actor(EMP) + "update public.company_members set status='invited';update public.company_members set status='active';update public.posts set body='Edited';update public.jobs set title='Edited';")
        for feature, subject in [("active_vacancies", CID), ("team_members", CID), ("monthly_network_posts", EMP)]:
            counter(subject, feature, 1)
        print("PASS edits/invited-active transitions at cap preserve occupancy", flush=True)
        # UPSERT calls BEFORE INSERT even on a conflict; AFTER accounting must
        # reserve only the final action, not leak one slot per retry.
        row = "90909090-9090-4090-8090-909090909090"
        clear()
        base.sql(base.actor(EMP) + member(row_id=row))
        base.sql(base.actor(EMP) + member(row_id=row).rstrip(';') + " on conflict(company_id,profile_id) do update set status='invited';")
        counter(CID, "team_members", 1)
        print("PASS UPSERT retries update once without leaked speculative reservation", flush=True)
        base.sql(base.actor(EMP) + "update public.company_members set status='inactive';")
        counter(CID, "team_members", 0)
        base.sql(base.actor(EMP) + member(MEMBER2))
        denied(base.actor(EMP) + "update public.company_members set status='active' where status='inactive';", "limiti dolub")
        base.sql(base.actor(EMP) + "delete from public.company_members where status='active';update public.company_members set status='active';")
        counter(CID, "team_members", 1)
        print("PASS deactivation/delete refunds and reactivation cannot exceed cap", flush=True)
        clear()
        base.sql("begin;" + base.actor(EMP) + job() + member() + post() + "rollback;")
        base.sql(base.actor(EMP) + job() + member() + post())
        print("PASS transaction rollback refunds every reservation", flush=True)
        # Trusted row moves adjust both counters/projections; non-admin cap
        # applies to destination and a rejected move restores the source.
        clear()
        base.sql(job() + job(CID2))
        denied("set request.jwt.claim.sub='" + EMP + "';update public.jobs set company_id='" + CID2 + "' where company_id='" + CID + "';", "limiti dolub")
        counter(CID, "active_vacancies", 1); counter(CID2, "active_vacancies", 1)
        base.sql("delete from public.jobs where company_id='" + CID2 + "';update public.jobs set company_id='" + CID2 + "';")
        counter(CID, "active_vacancies", 0); counter(CID2, "active_vacancies", 1)
        assert_sql("(select used_count=0 from public.subscription_usage u join public.subscriptions s on s.id=u.subscription_id where s.company_id='" + CID + "' and u.feature_key='active_vacancies')", "old company usage stale")
        print("PASS destination-cap failure rolls move back; permitted move updates both counters/usage", flush=True)
        clear()
        base.sql(member() + member(MEMBER2, CID2))
        denied("update public.company_members set company_id='" + CID2 + "' where company_id='" + CID + "';", "limiti dolub")
        counter(CID, "team_members", 1); counter(CID2, "team_members", 1)
        base.sql("delete from public.company_members where company_id='" + CID2 + "';update public.company_members set company_id='" + CID2 + "';")
        counter(CID, "team_members", 0); counter(CID2, "team_members", 1)
        clear()
        base.sql(post() + post(OTHER))
        denied("update public.posts set author_id='" + OTHER + "' where author_id='" + EMP + "';", "limiti dolub")
        counter(EMP, "monthly_network_posts", 1); counter(OTHER, "monthly_network_posts", 1)
        base.sql("delete from public.posts where author_id='" + OTHER + "';update public.posts set author_id='" + OTHER + "';")
        counter(EMP, "monthly_network_posts", 0); counter(OTHER, "monthly_network_posts", 1)
        print("PASS team/company and trusted post/author moves enforce destination caps and update both counters", flush=True)
        clear()
        base.sql(base.actor(MANAGER, "manager") + job() + job())
        counter(CID, "active_vacancies", 2)
        denied(base.actor(EMP) + job(), "limiti dolub")
        base.sql(base.actor(MANAGER, "manager") + "delete from public.jobs;")
        base.sql(base.actor(EMP) + job())
        print("PASS original admin vacancy bypass preserved while subsequent owner cap remains accurate", flush=True)
        clear()
        base.sql("set request.jwt.claim.sub='" + MANAGER + "';set request.jwt.claims='{\"app_metadata\":{\"admin_role\":\"manager\"}}';" + member() + member(MEMBER2))
        counter(CID, "team_members", 2)
        # A service/SQL trigger context preserves the old administrator bypass;
        # this does not add any browser INSERT grant denied by staff policies.
        print("PASS original privileged team bypass is tracked without granting new client capabilities", flush=True)
        clear()
        draft = "91919191-9191-4191-8191-919191919191"
        base.sql(base.actor(EMP) + job(row_id=draft) + "update public.jobs set status='draft';" + job())
        denied(base.actor(EMP) + "update public.jobs set status='pending' where id='" + draft + "';", "limiti dolub")
        counter(CID, "active_vacancies", 1)
        print("PASS vacancy deactivation refunds occupancy and reactivation cannot exceed cap", flush=True)
        clear()
        denied(base.actor(EMP) + "insert into public.posts(id,author_id,created_at,body) values(gen_random_uuid(),'"+EMP+"',now()-interval '1 month','Backdated');", "server-owned")
        base.sql(base.actor(EMP) + post())
        denied(base.actor(EMP) + "update public.posts set created_at=created_at-interval '1 month';", "server-owned")
        denied(base.actor(EMP) + "update public.posts set attachment_url='https://example.invalid/image';", "dəstəkləmir")
        base.sql("set timezone='Pacific/Honolulu';select 1;" + base.actor(EMP))
        assert_sql("private.quota_month('2027-02-01 00:30+00')=date '2027-02-01'", "timezone changed month bucket")
        print("PASS ordinary post timestamp shifts/media-plan bypass denied; month anchor remains UTC", flush=True)
        clear()
        base.sql(post() + "update public.posts set created_at=created_at-interval '1 month';")
        counter(EMP, "monthly_network_posts", 0)
        base.sql(base.actor(EMP) + post())
        denied("update public.posts set created_at=now() where created_at<now()-interval '1 day';", "limiti dolub")
        print("PASS trusted historical move refunds current occupancy and cannot overfill destination month", flush=True)
        clear()
        base.sql("update public.plan_features set limit_value=null where plan_id='free';")
        base.sql(base.actor(EMP) + job() + job() + member() + member(MEMBER2) + post() + post())
        print("PASS unlimited feature semantics retain ordinary writes", flush=True)
        clear()
        base.sql("update public.plan_features set limit_value=1 where plan_id='free';update public.subscriptions set plan_id='pro',ends_at=now()-interval '1 day';")
        base.sql(base.actor(EMP) + job() + member())
        denied(base.actor(EMP) + job(), "limiti dolub")
        denied(base.actor(EMP) + post(), "Aktiv şirkət paketiniz yoxdur")
        print("PASS expired package retains only existing Free fallback for vacancy/team and denies paid posts", flush=True)
        print("ALL ATOMIC COMPANY QUOTA TESTS PASSED (explicit synthetic baseline; no real Supabase gateway)", flush=True)
    finally:
        base.docker("rm", "-f", base.NAME, check=False)


if __name__ == "__main__":
    main()
