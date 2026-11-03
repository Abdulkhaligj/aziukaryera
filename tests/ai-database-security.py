"""Isolated PostgreSQL tests of the exact paid-work/claim migration.
No host ports, provider calls, real Supabase data or credentials are used.
This is a minimal contract fixture, not a replacement for the missing baseline.
"""
from pathlib import Path
import concurrent.futures
import json
import subprocess
import uuid

name = "career-ai-security-" + uuid.uuid4().hex[:10]
root = Path(__file__).resolve().parents[1]
sql_file = root / "supabase/migrations/20261102210000_ai_reservations.sql"

def command(args, data=None):
    run = subprocess.run(args, input=data, text=True, encoding="utf-8", capture_output=True)
    if run.returncode:
        raise RuntimeError(run.stdout + run.stderr)
    return run.stdout.strip()

def sql(text):
    return command(["docker", "exec", "-i", name, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres"], text)

setup = """
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema private; create schema net;
create table auth.users(id uuid primary key, raw_app_meta_data jsonb default '{}');
create table public.profiles(id uuid primary key,role text,status text,admin_role text,avatar_pending_path text,avatar_requested_at timestamptz,avatar_path text);
create table public.companies(id uuid primary key,owner_id uuid,status text);
create table public.company_members(company_id uuid,profile_id uuid,status text);
create table public.jobs(id uuid primary key,company_id uuid);
create table public.subscriptions(company_id uuid,plan_id text,status text,starts_at timestamptz,ends_at timestamptz);
create table public.plan_features(plan_id text,feature_key text,enabled boolean,limit_value integer);
create table public.ai_usage(profile_id uuid,company_id uuid,client_hash text,task text,success boolean,created_at timestamptz default now());
create table public.posts(id uuid primary key,body text,link_url text,moderation_status text,moderation_requested_at timestamptz);
create table public.post_comments(id uuid primary key,body text,moderation_status text,moderation_requested_at timestamptz);
create function public.company_has_feature(uuid,text) returns boolean language sql as $$select true$$;
create function net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer) returns bigint language sql as $$select 1::bigint$$;
create function public.moderation_apply(p_table text,p_id uuid,p_requested_at timestamptz,p_allow boolean,p_reason text,p_categories text[])
returns text language plpgsql as $$begin
 update public.posts set moderation_status=case when p_allow then 'visible' else 'hidden' end
 where id=p_id and moderation_status='pending' and moderation_requested_at=p_requested_at;
 return case when found then 'visible' else 'skipped' end;
end$$;
create function public.avatar_moderation_apply(p_profile_id uuid,p_path text,p_requested_at timestamptz,p_allow boolean,p_reason text,p_categories text[])
returns jsonb language sql as $$select jsonb_build_object('status','visible')$$;
insert into auth.users values('00000000-0000-4000-8000-000000000001','{}');
insert into public.profiles(id,role,status) values('00000000-0000-4000-8000-000000000001','student','active');
"""

try:
    command(["docker", "run", "--detach", "--rm", "--network", "none", "--name", name,
             "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine"])
    for attempt in range(60):
        ready = subprocess.run(["docker", "exec", name, "pg_isready", "-U", "postgres"], capture_output=True)
        if ready.returncode == 0:
            break
        import time
        time.sleep(.2)
    else:
        raise RuntimeError("postgres did not become ready")
    sql(setup)
    sql(sql_file.read_text(encoding="utf-8"))
    assert sql("select has_function_privilege('authenticated','public.ai_reserve_request(uuid,text,uuid,text)','execute')") == "f"
    assert sql("select has_function_privilege('anon','public.moderation_claim(text,uuid)','execute')") == "f"
    assert sql("select private.moderation_send('posts','00000000-0000-4000-8000-000000000001') is null") == "t"
    print("PASS: client execution denied; disabled sender makes no request")
    # A profile labelled admin without an assigned current Auth role gets no
    # unlimited-admin quota, even when both nullable values happen to match.
    sql("insert into auth.users values('00000000-0000-4000-8000-000000000003','{}');insert into public.profiles(id,role,status) values('00000000-0000-4000-8000-000000000003','admin','active')")
    assert not json.loads(sql("select public.ai_reserve_request('00000000-0000-4000-8000-000000000003','admin_assistant')"))["allowed"]
    # Existing company plan rows stop granting AI at expiry even if cron has
    # not yet materialized status='expired'. Free plan fallback still works.
    company = "00000000-0000-4000-8000-000000000004"
    owner = "00000000-0000-4000-8000-000000000005"
    sql(f"insert into auth.users values('{owner}','{{}}');insert into public.profiles(id,role,status) values('{owner}','company','active');insert into public.companies values('{company}','{owner}','active');insert into public.subscriptions values('{company}','pro','active',now()-interval '1 month',now()-interval '1 second');insert into public.plan_features values('pro','ai_requests_monthly',true,300)")
    assert not json.loads(sql(f"select public.ai_reserve_request('{owner}','job_post_write')"))["allowed"]
    sql(f"update public.subscriptions set ends_at=now()+interval '1 day' where company_id='{company}'")
    assert json.loads(sql(f"select public.ai_reserve_request('{owner}','job_post_write')"))["allowed"]
    print("PASS: missing admin role denied; expired paid AI denied; current paid plan permitted")
    hash_value = "a" * 40
    reserve = f"select public.ai_reserve_request(null,'aida_chat',null,'{hash_value}')"
    for i in range(19):
        assert json.loads(sql(reserve))["allowed"]
    def concurrent_reserve(_):
        result = sql("begin;" + reserve + ";select pg_sleep(.2);commit;")
        return json.loads(result.splitlines()[0])
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(concurrent_reserve, range(5)))
    assert sum(r["allowed"] for r in results) == 1, results
    reservation_id = next(r["reservation_id"] for r in results if r["allowed"])
    assert sql("select count(*) from private.ai_reservations where task='aida_chat'") == "20"
    for i in range(7):
        assert sql(f"select public.ai_consume_provider_attempt('{reservation_id}')") == "t"
    assert sql(f"select public.ai_consume_provider_attempt('{reservation_id}')") == "f"
    assert not json.loads(sql(reserve))["allowed"]
    print("PASS: parallel 19/20 permits one reservation; seven attempts max; failure never refunds budget")
    # The anonymous global cap holds even for a fresh/spoofed client hash.
    sql("insert into private.ai_reservations(task,budget,client_hash) select 'aida_chat','aida:anonymous:other',repeat('b',40) from generate_series(1,1980)")
    assert not json.loads(sql("select public.ai_reserve_request(null,'aida_chat',null,repeat('c',40))"))["allowed"]
    print("PASS: global anonymous ceiling survives changed client identity")
    post = "00000000-0000-4000-8000-000000000002"
    sql(f"insert into public.posts values('{post}','A','https://example.test/a','pending',now())")
    def claim(_):
        return json.loads(sql(f"select public.moderation_claim('posts','{post}')"))
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(claim, range(5)))
    assert sum(r["claimed"] for r in results) == 1, results
    claim_id = next(r["claim_id"] for r in results if r["claimed"])
    # Same requested_at, changed link: stale verdict must still be rejected.
    sql(f"update public.posts set link_url='https://example.test/b' where id='{post}'")
    assert json.loads(sql(f"select public.moderation_finish('{claim_id}',true)"))["status"] == "skipped"
    assert sql(f"select moderation_status from public.posts where id='{post}'") == "pending"
    new_claim = claim(0)
    assert new_claim["claimed"]
    assert json.loads(sql(f"select public.moderation_finish('{new_claim['claim_id']}',true)"))["status"] == "visible"
    assert sql(f"select moderation_status from public.posts where id='{post}'") == "visible"
    print("PASS: duplicate moderation delivery claims once; changed-link stale verdict skips; current verdict publishes")
    sql(f"update public.posts set body='new version',moderation_status='pending',moderation_requested_at=now() where id='{post}'")
    for i in range(5):
        item = claim(0)
        assert item["claimed"]
        assert json.loads(sql(f"select public.moderation_finish('{item['claim_id']}',null)"))["status"] == "retry"
    assert not claim(0)["claimed"]
    print("PASS: failed moderation retries are capped at five per exact content version")
    print("ALL AI DATABASE SECURITY CHECKS PASSED")
finally:
    subprocess.run(["docker", "rm", "-f", name], capture_output=True)
