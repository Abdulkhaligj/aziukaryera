"""Cross-migration security integration, using an explicit synthetic base.

The actual five upgrade files run in timestamp order with real quota, audit,
moderation, claim, verdict and usage hooks. This is not original-base replay.
"""
from pathlib import Path
import json
import time
import uuid
import test_atomic_company_quotas as quota

base = quota.base
ROOT = Path(__file__).resolve().parents[1]
base.NAME = "career-security-integration-" + uuid.uuid4().hex[:10]


def check(predicate, message):
    base.sql(base.assert_sql(predicate, message))


def scalar(statement):
    result = base.docker("exec", "-i", base.NAME, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", input=statement)
    return result.stdout.strip()


def main():
    base.docker("run", "--rm", "--detach", "--network", "none", "--name", base.NAME,
                "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine")
    try:
        for _ in range(60):
            if base.docker("exec", base.NAME, "pg_isready", "-U", "postgres", check=False).returncode == 0:
                break
            time.sleep(.2)
        else:
            raise RuntimeError("PostgreSQL not ready")
        # setup(False) executes 190000/200000 and installs the known historical
        # quota/usage bindings. Original missing owner policies stay explicit
        # fixture assumptions in that helper.
        quota.setup(apply_upgrade=False)
        base.sql("""
create schema net;
create function net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer) returns bigint language sql as $$select 1::bigint$$;
alter table public.profiles add column avatar_requested_at timestamptz;
alter table public.ai_usage add column client_hash text,add column created_at timestamptz default now();
alter table public.posts add column link_url text,add column tags text[] default '{}';
create table public.post_comments(id uuid primary key,author_id uuid,body text,moderation_status text default 'pending',
moderation_reason text,moderated_at timestamptz,moderation_requested_at timestamptz,moderation_attempts integer default 0);
create table public.moderation_terms(term text,match text,active boolean);
alter table public.moderation_logs add column target_type text,add column target_id uuid,add column action text,add column reason text,add column actor_id uuid;
alter table public.notifications add column profile_id uuid,add column kind text,add column title text,add column body text,add column link text;
""")
        for name in ["private.moderation_normalize", "private.moderation_blocked_term", "private.moderation_guard", "private.moderation_request", "public.moderation_apply"]:
            base.sql(quota.extract("function", name, "20261019130000_network_content_moderation.sql"))
        base.sql("""
create trigger posts_moderation_guard before insert or update on public.posts for each row execute function private.moderation_guard();
create trigger post_comments_moderation_guard before insert or update on public.post_comments for each row execute function private.moderation_guard();
create trigger posts_moderation_request after insert or update on public.posts for each row execute function private.moderation_request();
create trigger post_comments_moderation_request after insert or update on public.post_comments for each row execute function private.moderation_request();
""")
        for filename in ["20261102210000_ai_reservations.sql", "20261102220000_atomic_company_quotas.sql", "20261102230000_complete_moderation_input.sql"]:
            base.sql((ROOT / "migrations" / filename).read_text(encoding="utf-8"))
        print("PASS: all five actual security upgrades compile in timestamp order with combined original trigger hooks")

        quota.clear()
        post_id = "90909090-9090-4090-8090-909090909090"
        base.sql(base.actor(quota.EMP) + quota.post(row_id=post_id))
        quota.counter(quota.EMP, "monthly_network_posts", 1)
        assert scalar(f"select moderation_status from public.posts where id='{post_id}'") == "pending"

        def claim():
            return json.loads(scalar(f"select public.moderation_claim('posts','{post_id}')"))

        def finish(item):
            return json.loads(scalar(f"select public.moderation_finish('{item['claim_id']}',true,null,'{{}}',2)"))

        first = claim()
        assert first["claimed"] and first["row"]["content_version"] == 2
        assert finish(first)["status"] == "visible"
        quota.counter(quota.EMP, "monthly_network_posts", 1)
        base.sql(base.actor(quota.EMP) + f"update public.posts set link_url='https://example.invalid/review',tags=array['complete'] where id='{post_id}';")
        second = claim()
        assert second["claimed"] and second["row"]["tags"] == ["complete"]
        base.sql(base.actor(quota.EMP) + f"update public.posts set tags=array['changed'] where id='{post_id}';")
        assert finish(second)["status"] == "skipped"
        assert finish(claim())["status"] == "visible"
        quota.counter(quota.EMP, "monthly_network_posts", 1)
        print("PASS: owner post create, complete claim/verdict, link/tag requeue and stale-verdict rejection preserve one quota slot")

        failed_id = "91919191-9191-4191-8191-919191919191"
        denied = base.sql(base.actor(quota.EMP) + quota.post(row_id=failed_id), check=False)
        assert denied.returncode and "limiti dolub" in denied.stderr
        check(f"not exists(select 1 from public.posts where id='{failed_id}')", "over-cap post committed")
        denied = base.sql(base.actor(quota.EMP) + f"update public.posts set body=repeat('A',6001) where id='{post_id}';", check=False)
        assert denied.returncode and "6000" in denied.stderr
        quota.counter(quota.EMP, "monthly_network_posts", 1)
        check("exists(select 1 from public.admin_audit_logs where resource='posts')", "combined post writes not audited")
        base.sql(base.actor(quota.EMP) + f"delete from public.posts where id='{post_id}';")
        quota.counter(quota.EMP, "monthly_network_posts", 0)
        check(f"(select used_count=0 from public.subscription_usage where subscription_id=(select id from public.subscriptions where company_id='{quota.CID}') and feature_key='monthly_network_posts' limit 1)", "usage projection stale after deletion")
        print("PASS: moderation and quota failures roll back together; audit persists; delete refunds occupancy and usage projection")
        print("ALL SECURITY UPGRADE INTEGRATION CHECKS PASSED; original baseline and Supabase gateway not reconstructed")
    finally:
        base.docker("rm", "-f", base.NAME, check=False)


if __name__ == "__main__":
    main()
