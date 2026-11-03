"""Exact remediation migrations against an isolated synthetic PostgreSQL schema.

Requires Docker and the postgres:17-alpine image. No host ports, no network,
no live Supabase. This fixture is deliberately NOT the missing original base.
"""
from pathlib import Path
import concurrent.futures
import subprocess
import time
import uuid
import re

ROOT = Path(__file__).resolve().parents[1]
NAME = "career-security-" + uuid.uuid4().hex[:12]

def docker(*args, input=None, check=True):
    result = subprocess.run(["docker", *args], input=input, text=True, encoding="utf-8", capture_output=True)
    if check and result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    return result

def sql(source, check=True):
    return docker("exec", "-i", NAME, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", input=source, check=check)

FIXTURE = r"""
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema private; create schema storage;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
grant usage on schema auth,storage to authenticated,anon,service_role;
create table auth.users(id uuid primary key,raw_app_meta_data jsonb);
create table public.profiles(id uuid primary key,role text,status text,admin_role text,full_name text,email text,
personal_email text,phone text,faculty_id text,major_id text,course integer,gpa numeric,skills text[],summary text,
account_status text,avatar_path text,avatar_pending_path text);
create table public.companies(id uuid primary key,owner_id uuid,status text,name text);
create table public.jobs(id uuid primary key,company_id uuid,status text,title text);
create table public.applications(id uuid primary key,job_id uuid,student_id uuid,status text,note text,created_at timestamptz default now(),updated_at timestamptz default now());
create table public.plans(id text primary key,name text);
create table public.subscriptions(id uuid primary key default gen_random_uuid(),company_id uuid unique,plan_id text,status text,
starts_at timestamptz,ends_at timestamptz,requested_at timestamptz,requested_plan_id text,approved_by uuid,reminder_sent_at timestamptz);
create table public.plan_features(plan_id text,feature_key text,enabled boolean,limit_value integer,primary key(plan_id,feature_key));
create table public.payments(id uuid primary key default gen_random_uuid(),company_id uuid,plan_id text,status text,months integer default 1,
paid_at timestamptz,subscription_id uuid,amount numeric);
create table public.education(id uuid primary key default gen_random_uuid(),profile_id uuid,verified boolean default false,start_year integer);
create table public.admin_audit_logs(id uuid default gen_random_uuid(),title text,resource text,resource_id uuid,action text,actor_id uuid,actor_name text,created_at timestamptz default now());
create table public.posts(id uuid primary key,author_id uuid,created_at timestamptz default now(),attachment_url text,body text,
moderation_status text,moderation_reason text,moderated_at timestamptz,moderation_requested_at timestamptz,moderation_attempts integer default 0);
create table public.ai_usage(id uuid primary key default gen_random_uuid(),profile_id uuid,company_id uuid,task text,success boolean);
create table public.company_members(id uuid primary key,company_id uuid,profile_id uuid,status text);
create table public.company_interview_slots(id uuid primary key default gen_random_uuid(),application_id uuid,starts_at timestamptz,duration_minutes integer,status text);
create table public.notifications(id uuid default gen_random_uuid(),created_at timestamptz default now());
create table public.events(id uuid primary key,starts_at timestamptz);
create table public.faculties(id text,sort_order integer);
create table public.majors(id text);
create table public.saved_jobs(job_id uuid);
create table public.event_registrations(event_id uuid);
create table public.broadcast_notifications(id uuid,created_at timestamptz);
create table public.broadcast_notification_reads(broadcast_id uuid,read_at timestamptz);
create table public.reports(id uuid primary key,reporter_id uuid,status text,reviewed_by uuid,reviewed_at timestamptz,created_at timestamptz default now());
create table public.mentor_requests(id uuid primary key,student_id uuid,status text,mentor_name text,admin_note text,body text,created_at timestamptz default now(),updated_at timestamptz default now());
do $$declare t text;begin foreach t in array array['benefits','benefit_partners','company_awards','site_content','content',
'subscription_usage','ads','cv_documents','interview_sessions','moderation_logs','company_partnership_requests','invites'] loop
execute format('create table public.%I(id uuid primary key default gen_random_uuid())',t);end loop;end$$;
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,payload text);
alter table storage.objects enable row level security;
create policy storage_legacy on storage.objects to authenticated using(true) with check(true);
grant all on storage.objects to authenticated;
create function public.owns_company(cid uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.companies c where c.id=cid and c.owner_id=auth.uid())$$;
create function private.notify_company(uuid,text,text,text,text default 'subscription') returns void language sql as $$select$$;
do $$declare t text;begin foreach t in array array['profiles','companies','jobs','applications','plans','subscriptions','plan_features','payments',
'education','posts','ai_usage','company_members','company_interview_slots','notifications','events','benefits','benefit_partners','company_awards',
'site_content','content','reports','mentor_requests','subscription_usage','ads','cv_documents','interview_sessions','moderation_logs','broadcast_notifications','company_partnership_requests'] loop
execute format('alter table public.%I enable row level security',t);
execute format('create policy legacy_all on public.%I to authenticated using(true) with check(true)',t);
end loop;end$$;
grant select,insert,update,delete on all tables in schema public to authenticated;
insert into auth.users values
('11111111-1111-1111-1111-111111111111','{}'),('22222222-2222-2222-2222-222222222222','{"admin_role":"reviewer"}'),
('33333333-3333-3333-3333-333333333333','{}'),('44444444-4444-4444-4444-444444444444','{"admin_role":"manager"}'),
('55555555-5555-5555-5555-555555555555','{"admin_role":"editor"}');
insert into public.profiles(id,role,status,admin_role,full_name,email,personal_email,phone) values
('11111111-1111-1111-1111-111111111111','student','active',null,'Private Student','private@example.invalid','secret@example.invalid','secret'),
('22222222-2222-2222-2222-222222222222','admin','active','reviewer','Reviewer','reviewer@example.invalid',null,null),
('33333333-3333-3333-3333-333333333333','company','active',null,'Employer','employer@example.invalid',null,null),
('44444444-4444-4444-4444-444444444444','admin','active','manager','Manager','manager@example.invalid',null,null),
('55555555-5555-5555-5555-555555555555','admin','active','editor','Editor','editor@example.invalid',null,null);
insert into public.companies values('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','33333333-3333-3333-3333-333333333333','active','Company');
insert into public.jobs values('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','draft','Private Draft');
insert into public.applications(id,job_id,student_id,status,note) values('12121212-1212-1212-1212-121212121212','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','11111111-1111-1111-1111-111111111111','applied','Original note');
insert into public.posts(id,author_id,body,moderation_status) values('13131313-1313-1313-1313-131313131313','11111111-1111-1111-1111-111111111111','Original post','visible');
insert into public.reports(id,reporter_id,status) values('14141414-1414-1414-1414-141414141414','11111111-1111-1111-1111-111111111111','pending');
insert into public.mentor_requests(id,student_id,status,body) values('15151515-1515-1515-1515-151515151515','11111111-1111-1111-1111-111111111111','pending','Original request');
insert into public.plans values('pro','Pro'),('free','Free');
insert into public.plan_features values('pro','candidate_search',true,10),('pro','active_vacancies',true,2);
insert into public.subscriptions(company_id,plan_id,status,starts_at,ends_at) values('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','pro','active',now()-interval '1 day',now()+interval '29 days');
insert into public.payments(id,company_id,plan_id,status,months) values('cccccccc-cccc-cccc-cccc-cccccccccccc','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','pro','pending',1);
insert into public.payments(id,company_id,plan_id,status,months) values('cccccccc-cccc-cccc-cccc-cccccccccccd','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','pro','paid',1);
insert into public.payments(id,company_id,plan_id,status,months,paid_at) values('cccccccc-cccc-cccc-cccc-ccccccccccce','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','pro','pending',1,now()-interval '2 days');
insert into storage.objects(bucket_id,name,payload) values('avatars','11111111-1111-1111-1111-111111111111/approved.webp','A');
update public.profiles set avatar_path='11111111-1111-1111-1111-111111111111/approved.webp' where role='student';
"""

def actor(who, role=None):
    meta = '{}' if role is None else '{"admin_role":"' + role + '"}'
    return f"set role authenticated;set request.jwt.claim.sub='{who}';set request.jwt.claims='{{\"app_metadata\":{meta}}}';"

def assert_sql(body, message):
    return f"do $$begin if not ({body}) then raise exception '{message}';end if;end$$;"

def main():
    docker('run','--rm','-d','--network','none','--name',NAME,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine')
    try:
        for _ in range(60):
            if docker('exec',NAME,'pg_isready','-U','postgres',check=False).returncode == 0: break
            time.sleep(.25)
        sql(FIXTURE)
        for migration in ['20261102190000_security_boundaries.sql','20261102200000_business_integrity.sql']:
            sql((ROOT/'migrations'/migration).read_text(encoding='utf-8'))
        moderation_source=(ROOT/'migrations'/'20261019130000_network_content_moderation.sql').read_text(encoding='utf-8')
        moderation_guard=re.search(r'create or replace function private.moderation_guard\(\)[\s\S]*?\$\$;',moderation_source).group()
        sql("create function private.moderation_blocked_term(text) returns text language sql as $$select null::text$$;"+moderation_guard+
            "create trigger posts_moderation_guard before insert or update on public.posts for each row execute function private.moderation_guard();")
        sql("create trigger jobs_plan_limit before insert or update of status,company_id on public.jobs for each row execute function public.enforce_company_job_limit();")
        print('PASS: complete remediation migrations compile against explicit synthetic fixture')
        reviewer=actor('22222222-2222-2222-2222-222222222222','reviewer')
        manager=actor('44444444-4444-4444-4444-444444444444','manager')
        editor=actor('55555555-5555-5555-5555-555555555555','editor')
        student=actor('11111111-1111-1111-1111-111111111111')
        company=actor('33333333-3333-3333-3333-333333333333')
        sql(reviewer+"update public.payments set status='paid';"+assert_sql("(select count(*)=0 from public.payments where status='paid' and id='cccccccc-cccc-cccc-cccc-cccccccccccc')",'reviewer bypass')+"update public.applications set student_id=student_id;")
        sql(editor+assert_sql("private.admin_can('insert','events') and not private.admin_can('update','payments') and not private.admin_can('delete','jobs')",'editor matrix')+"insert into public.events(id) values(gen_random_uuid());")
        sql(manager+assert_sql("private.admin_can('update','payments') and not private.admin_can('update','admins')",'manager matrix'))
        sql(manager+"insert into public.plan_features(plan_id,feature_key,enabled,limit_value) values('pro','active_vacancies',true,2) on conflict(plan_id,feature_key) do update set enabled=excluded.enabled,limit_value=excluded.limit_value;")
        print('PASS F01: reviewer/editor billing denied with deliberately broad permissive legacy policy; legitimate editor create allowed')
        for principal in [reviewer,editor]:
            for statement in ["update public.applications set job_id=gen_random_uuid();", "update public.applications set student_id=gen_random_uuid();",
                "update public.applications set created_at=now()+interval '1 day';", "update public.posts set body='Forged post';",
                "update public.posts set author_id=gen_random_uuid();", "update public.reports set reporter_id=gen_random_uuid();",
                "update public.mentor_requests set body='Forged request';"]:
                result=sql(principal+statement,False)
                assert result.returncode and 'only change moderation fields' in result.stderr, (statement,result.stderr)
            sql(principal+"update public.applications set status='under_review',note='Staff note';update public.posts set moderation_status='pending';update public.reports set status='reviewed',reviewed_by=auth.uid(),reviewed_at='2001-01-01';update public.mentor_requests set status='matched',mentor_name='Mentor',admin_note='Assigned',updated_at='2001-01-01';"+
                assert_sql("(select moderation_requested_at is not null and body='Original post' from public.posts limit 1)",'moderation normalization failed')+
                assert_sql("(select reviewed_at > now()-interval '1 minute' from public.reports limit 1)",'forged report timestamp')+
                assert_sql("(select updated_at > now()-interval '1 minute' from public.mentor_requests limit 1)",'forged mentor timestamp'))
        result=sql(reviewer+"update public.reports set reviewed_by='11111111-1111-1111-1111-111111111111';",False)
        assert result.returncode and 'attribution must match' in result.stderr
        sql(reviewer+"update public.reports set status='reviewed';"+
            assert_sql("(select reviewed_by=auth.uid() from public.reports limit 1)",'status-only review retained another actor'))
        print('PASS F01 columns: limited staff cannot replace identities/content/timestamps; status/note/moderation with real later guard succeeds')
        sql(company+assert_sql("(select count(*)=1 from public.profiles where role='student')",'actual applicant access lost'))
        sql("delete from public.applications;")
        sql(reviewer.replace('"reviewer"','"super_admin"')+assert_sql('public.current_admin_role() is null','stale JWT role'))
        result=sql(reviewer.replace('"reviewer"','"super_admin"')+"select private.reset_career_platform('SIFIRLA');",False)
        assert result.returncode and 'Super Admin' in result.stderr
        sql("update auth.users set raw_app_meta_data='{"+'"admin_role":"reviewer","must_change_password":true'+"}' where id='22222222-2222-2222-2222-222222222222';"+reviewer+assert_sql('not public.is_admin()','password bypass'))
        print('PASS F08/F13: stale JWT and fresh must-change flag deny staff authority')
        sql(company+assert_sql("(select count(*)=0 from public.profiles where role='student')",'private profile leak')+assert_sql("(select count(*)=1 from public.candidate_profiles())",'candidate card absent')+
            assert_sql("not exists(select 1 from jsonb_object_keys((select to_jsonb(c) from public.candidate_profiles() c limit 1)) k where k in ('email','personal_email','phone'))",'candidate contact leak'))
        sql(student+assert_sql("(select count(*)=0 from public.jobs)",'draft leak'))
        print('PASS F02/F07: unrelated private contact and drafts denied, entitled safe candidate card retained')
        result=sql(student+"insert into public.ai_usage(profile_id,company_id,success) values(auth.uid(),'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true);",False)
        assert result.returncode and 'permission denied' in result.stderr
        result=sql(student+"insert into public.education(profile_id,verified) values(auth.uid(),true);",False)
        assert result.returncode and 'verification requires' in result.stderr
        sql(student+"insert into public.education(profile_id,verified) values(auth.uid(),false);")
        print('PASS F03/F11: client accounting and self-verification denied; ordinary education create works')
        sql("update public.subscriptions set ends_at=now()-interval '1 second';"+company+
            assert_sql("not public.company_has_feature('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','candidate_search')",'expired entitlement')+
            assert_sql("public.company_feature_limit('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','candidate_search') is null",'expired limit')+
            assert_sql('(select count(*)=0 from public.candidate_profiles())','expired candidate card'))
        sql(company+"insert into public.jobs(id,company_id,status) values('abababab-abab-abab-abab-ababababab01','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','pending');")
        result=sql(company+"insert into public.jobs(id,company_id,status) values('abababab-abab-abab-abab-ababababab02','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','pending');",False)
        assert result.returncode and 'limiti dolub' in result.stderr
        sql("update public.subscriptions set ends_at=now()+interval '1 day';"+company+"insert into public.jobs(id,company_id,status) values('abababab-abab-abab-abab-ababababab02','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','pending');")
        print('PASS R2-03: expired feature/limit/candidate rights denied; one Free vacancy allowed, expired second denied, active Pro second allowed without cron')
        sql("update public.payments set status='paid' where id='cccccccc-cccc-cccc-cccc-cccccccccccc';create table checkpoint as select ends_at from public.subscriptions;update public.payments set status='pending';update public.payments set status='paid';"+
            assert_sql('(select s.ends_at=c.ends_at from public.subscriptions s cross join checkpoint c)','invoice replay credit'))
        result=sql("update public.payments set months=12 where id='cccccccc-cccc-cccc-cccc-cccccccccccc';",False)
        assert result.returncode and 'immutable' in result.stderr
        result=sql("update public.payments set id=gen_random_uuid() where id='cccccccc-cccc-cccc-cccc-cccccccccccc';",False)
        assert result.returncode and 'identifiers are immutable' in result.stderr
        sql(assert_sql('(select s.ends_at=c.ends_at from public.subscriptions s cross join checkpoint c)','identifier mutation credited again'))
        sql("delete from public.payments where id='cccccccc-cccc-cccc-cccc-cccccccccccc';insert into public.payments(id,company_id,plan_id,status,months) values('cccccccc-cccc-cccc-cccc-cccccccccccc','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','pro','paid',1);"+
            assert_sql('(select s.ends_at=c.ends_at from public.subscriptions s cross join checkpoint c)','delete/reinsert invoice replay'))
        sql("update public.payments set status='paid' where id='cccccccc-cccc-cccc-cccc-ccccccccccce';"+
            assert_sql('(select s.ends_at=c.ends_at from public.subscriptions s cross join checkpoint c)','historical reversed invoice replay'))
        print('PASS R2-02: replay and historical-paid/reversed backfill grant no extra time; credited identity immutable')
        result=sql(student+"delete from storage.objects where bucket_id='avatars';select count(*) from storage.objects;",False)
        assert result.returncode == 0 and 'DELETE 0' in result.stdout
        result=sql(student+"update storage.objects set payload='B';",False)
        assert result.returncode == 0 and 'UPDATE 0' in result.stdout
        sql(assert_sql("(select payload='A' from storage.objects limit 1)",'avatar content changed'))
        sql("update public.profiles set avatar_path=null;"+student+"delete from storage.objects where bucket_id='avatars';insert into storage.objects(bucket_id,name,payload) values('avatars','11111111-1111-1111-1111-111111111111/new.webp','B');")
        result=sql(student+"insert into storage.objects(bucket_id,name,payload) values('avatars','11111111-1111-1111-1111-111111111111/approved.webp','C');",False)
        assert result.returncode and 'generation keys cannot be reused' in result.stderr
        print('PASS R2-01: approved DELETE/UPDATE blocked, removed signed-URL path reuse denied; cleanup/new generation allowed')
        for table in ['cv_documents','interview_sessions','ai_usage','notifications']:
            sql(f"insert into public.{table}(id) values('efefefef-efef-efef-efef-efefefefefef');")
        sql("create function private.reject_audit() returns trigger language plpgsql as $$begin raise exception 'audit unavailable';end$$;create trigger test_audit_failure before insert on public.admin_audit_logs for each row execute function private.reject_audit();")
        result=sql(manager+"insert into public.events(id) values('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');",False)
        assert result.returncode and 'audit unavailable' in result.stderr
        sql(assert_sql("not exists(select 1 from public.events where id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')",'unaudited write committed'))
        for table in ['cv_documents','interview_sessions','ai_usage','notifications']:
            result=sql(manager+f"delete from public.{table} where id='efefefef-efef-efef-efef-efefefefefef';",False)
            assert result.returncode and 'audit unavailable' in result.stderr
            sql(assert_sql(f"exists(select 1 from public.{table} where id='efefefef-efef-efef-efef-efefefefefef')",'unaudited removal committed'))
        sql("drop trigger test_audit_failure on public.admin_audit_logs;")
        print('PASS F14: audit failure rolls back business write and privileged CV/interview/usage/notification deletions')
        first="begin;set transaction isolation level repeatable read;insert into public.company_interview_slots(application_id,starts_at,duration_minutes,status) values('dddddddd-dddd-dddd-dddd-dddddddddddd','2027-01-01 10:00+00',45,'scheduled');select pg_sleep(1);commit;"
        second="begin;set transaction isolation level repeatable read;insert into public.company_interview_slots(application_id,starts_at,duration_minutes,status) values('dddddddd-dddd-dddd-dddd-dddddddddddd','2027-01-01 10:15+00',45,'scheduled');commit;"
        with concurrent.futures.ThreadPoolExecutor() as pool:
            a=pool.submit(sql,first,False);time.sleep(.2);b=pool.submit(sql,second,False)
            outcomes=[a.result(),b.result()]
        assert sorted(r.returncode for r in outcomes)==[0,3], [(r.returncode,r.stderr) for r in outcomes]
        assert any('exclusion constraint' in r.stderr for r in outcomes)
        sql("insert into public.company_interview_slots(application_id,starts_at,duration_minutes,status) values('dddddddd-dddd-dddd-dddd-dddddddddddd','2027-01-01 12:00+00',45,'scheduled');")
        result=sql("update public.company_interview_slots set starts_at='2027-01-01 10:00+00' where starts_at='2027-01-01 12:00+00';",False)
        assert result.returncode and 'exclusion constraint' in result.stderr
        print('PASS R2-04: concurrent overlapping transactions and overlapping UPDATE rejected; disjoint interval allowed')
        print('All DB remediation regression scenarios passed. Full Supabase baseline/gateway verification remains separate.')
    finally:
        docker('rm','-f',NAME,check=False)

if __name__ == '__main__':
    main()
