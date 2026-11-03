"""Exact moderation upgrade against an explicit synthetic PostgreSQL fixture.

Uses no host ports/network/providers. Baseline Auth/RLS helpers are modelled,
not a reconstruction of the missing original Supabase schema.
"""
from pathlib import Path
import ast
import concurrent.futures
import json
import re
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
NAME = "career-moderation-boundary-" + uuid.uuid4().hex[:10]
OWNER = "00000000-0000-4000-8000-000000000001"
OTHER = "00000000-0000-4000-8000-000000000003"
POST = "00000000-0000-4000-8000-000000000002"
COMMENT = "00000000-0000-4000-8000-000000000004"
HISTORICAL = "00000000-0000-4000-8000-000000000010"
BODY_ONLY = "00000000-0000-4000-8000-000000000011"
OLD_UNICODE_POST = "00000000-0000-4000-8000-000000000012"
OLD_UNICODE_COMMENT = "00000000-0000-4000-8000-000000000013"


def command(*args, data=None, check=True):
    result = subprocess.run(["docker", *args], input=data, text=True, encoding="utf-8", capture_output=True)
    if check and result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    return result


def sql(source, check=True):
    return command("exec", "-i", NAME, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", data=source, check=check)


def value(source):
    return sql(source).stdout.strip()


def literal(text):
    return "'" + text.replace("'", "''") + "'"


def actor(who=OWNER):
    return f"set role authenticated;set request.jwt.claim.sub='{who}';"


def function(name, source):
    match = re.search(r"create or replace function " + re.escape(name) + r"\([\s\S]*?\$\$;", source, re.I)
    assert match, name
    return match.group()


def main():
    command("run", "--rm", "--detach", "--network", "none", "--name", NAME,
            "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine")
    try:
        for _ in range(60):
            if command("exec", NAME, "pg_isready", "-U", "postgres", check=False).returncode == 0:
                break
            time.sleep(.2)
        else:
            raise RuntimeError("PostgreSQL not ready")

        # Reuse the small AI contract fixture's literal, without importing its
        # running tests or replacing the functions under test.
        source = (ROOT.parent / "tests/ai-database-security.py").read_text(encoding="utf-8")
        setup = next(ast.literal_eval(node.value) for node in ast.parse(source).body
                     if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "setup" for t in node.targets))
        sql(setup)
        sql(f"""
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function public.is_admin() returns boolean language sql stable as $$select false$$;
grant usage on schema auth to authenticated;
alter table public.posts add column tags text[] default '{{}}', add column author_id uuid default '{OWNER}',
 add column moderation_reason text,add column moderated_at timestamptz,add column moderation_attempts integer default 0;
alter table public.post_comments add column author_id uuid default '{OWNER}',add column moderation_reason text,
 add column moderated_at timestamptz,add column moderation_attempts integer default 0;
create table public.moderation_terms(term text,match text,active boolean);
insert into public.moderation_terms values('siktir','stem',true);
create table public.moderation_logs(target_type text,target_id uuid,action text,reason text,actor_id uuid);
create table public.notifications(profile_id uuid,kind text,title text,body text,link text);
""")
        old = (ROOT / "migrations/20261019130000_network_content_moderation.sql").read_text(encoding="utf-8")
        for name in ["private.moderation_normalize", "private.moderation_blocked_term", "private.moderation_guard",
                     "private.moderation_request", "public.moderation_apply"]:
            sql(function(name, old))
        sql((ROOT / "migrations/20261102210000_ai_reservations.sql").read_text(encoding="utf-8"))
        sql("""
revoke all on function public.moderation_apply(text,uuid,timestamptz,boolean,text,text[]) from public,anon,authenticated;
grant execute on function public.moderation_apply(text,uuid,timestamptz,boolean,text,text[]) to service_role;
create trigger posts_moderation_guard before insert or update on public.posts for each row execute function private.moderation_guard();
create trigger post_comments_moderation_guard before insert or update on public.post_comments for each row execute function private.moderation_guard();
create trigger posts_moderation_request after insert or update on public.posts for each row execute function private.moderation_request();
create trigger post_comments_moderation_request after insert or update on public.post_comments for each row execute function private.moderation_request();
""")
        # These historical rows predate the new bound; migration must retain
        # their bytes while taking their unchecked suffixes out of publication.
        sql(f"insert into public.posts(id,body,moderation_status) values('{POST}',repeat('A',6001),'visible');"
            f"insert into public.post_comments(id,body,moderation_status) values('{COMMENT}',repeat('B',6001),'visible');"
            f"insert into public.posts(id,body,link_url,tags,moderation_status) values('{HISTORICAL}','Safe body','https://example.invalid/unchecked',array['unchecked-tag'],'visible');"
            f"insert into public.posts(id,body,moderation_status) values('{BODY_ONLY}','Already bounded body','visible');"
            f"insert into public.posts(id,body,moderation_status) values('{OLD_UNICODE_POST}',repeat(chr(128512),4000),'visible');"
            f"insert into public.post_comments(id,body,moderation_status) values('{OLD_UNICODE_COMMENT}',repeat(chr(128512),4000),'visible');")
        sql((ROOT / "migrations/20261102230000_complete_moderation_input.sql").read_text(encoding="utf-8"))
        assert value(f"select moderation_status||':'||char_length(body) from public.posts where id='{POST}'") == "hidden:6001"
        assert value(f"select moderation_status||':'||char_length(body) from public.post_comments where id='{COMMENT}'") == "hidden:6001"
        assert value(f"select moderation_status||':'||link_url||':'||tags[1] from public.posts where id='{HISTORICAL}'") == "hidden:https://example.invalid/unchecked:unchecked-tag"
        assert not json.loads(value(f"select public.moderation_claim('posts','{HISTORICAL}')"))["claimed"]
        assert value(f"select moderation_status from public.posts where id='{BODY_ONLY}'") == "visible"
        assert value(f"select moderation_status||':'||char_length(body) from public.posts where id='{OLD_UNICODE_POST}'") == "hidden:4000"
        assert value(f"select moderation_status||':'||char_length(body) from public.post_comments where id='{OLD_UNICODE_COMMENT}'") == "hidden:4000"
        print("PASS: exact moderation upgrade compiles; legacy oversized posts/comments hidden without truncation")
        print("PASS: historical unchecked link/tag and UTF-16 tails quarantined unchanged; bounded fully-inspected body-only control retained")

        # Missing original owner UPDATE policy is an explicit fixture premise.
        sql("""
alter table public.posts enable row level security;
alter table public.post_comments enable row level security;
create policy fixture_posts_owner on public.posts to authenticated using(author_id=auth.uid()) with check(author_id=auth.uid());
create policy fixture_comments_owner on public.post_comments to authenticated using(author_id=auth.uid()) with check(author_id=auth.uid());
grant select,insert,update,delete on public.posts,public.post_comments to authenticated;
""")
        assert value("select has_function_privilege('authenticated','public.moderation_claim(text,uuid)','execute')") == "f"
        assert value("select has_function_privilege('authenticated','private.moderation_text(text,text,text[])','execute')") == "f"

        # Reset legacy content to a valid new generation as its owner.
        sql(actor() + f"update public.posts set body='Original body',link_url='https://example.invalid/old',tags=array['first'] where id='{POST}';")
        assert value(f"select moderation_status from public.posts where id='{POST}'") == "pending"

        def claim(table="posts", target=POST):
            return json.loads(value(f"select public.moderation_claim('{table}','{target}')"))

        def finish(item, allow=True):
            return json.loads(value(f"select public.moderation_finish('{item['claim_id']}',{'true' if allow else 'false'},null,'{{}}',2)"))

        item = claim()
        assert item["claimed"] and item["row"]["content_version"] == 2 and item["row"]["tags"] == ["first"]
        legacy = json.loads(value(f"select public.moderation_finish('{item['claim_id']}',true)"))
        assert legacy["status"] == "retry" and legacy["code"] == "content_version_required"
        assert value(f"select moderation_status from public.posts where id='{POST}'") == "pending"
        item = claim()
        assert finish(item)["status"] == "visible"
        before = value(f"select moderation_requested_at from public.posts where id='{POST}'")
        sql(actor() + f"update public.posts set link_url='https://example.invalid/new' where id='{POST}';")
        assert value(f"select moderation_status from public.posts where id='{POST}'") == "pending"
        assert value(f"select moderation_requested_at from public.posts where id='{POST}'") != before
        assert claim()["claimed"]
        print("PASS: link-only owner edit becomes pending and claimable; current complete generation may publish")

        # A stale allow cannot approve a tag replacement, even in the same
        # transaction/request timestamp family. Full snapshot equality remains.
        sql(f"update private.moderation_claims set claimed_until=clock_timestamp()-interval '1 second';")
        old_claim = claim()
        sql(actor() + f"update public.posts set tags=array['changed-tag'] where id='{POST}';")
        assert finish(old_claim)["status"] == "skipped"
        latest = claim()
        assert latest["row"]["tags"] == ["changed-tag"] and finish(latest)["status"] == "visible"
        print("PASS: tag edits requeue and stale verdict cannot approve the new full snapshot")

        # Sequential controls and complete field bounds, including separators.
        for expression in ["repeat('X',6001)", "repeat(chr(128512),6001)"]:
            result = sql(actor() + f"update public.posts set body={expression},link_url=null,tags='{{}}' where id='{POST}';", check=False)
            assert result.returncode and "6000" in result.stderr
        result = sql(actor() + f"update public.posts set body=repeat('X',6000),link_url='x',tags='{{}}' where id='{POST}';", check=False)
        assert result.returncode and "6000" in result.stderr
        result = sql(actor() + f"update public.posts set body='ok',link_url=null,tags=array['siktir'] where id='{POST}';", check=False)
        assert result.returncode and result.stderr
        sql(actor() + f"update public.posts set body=repeat(chr(128512),6000),link_url=null,tags='{{}}' where id='{POST}';")
        assert value(f"select char_length(body) from public.posts where id='{POST}'") == "6000"
        assert finish(claim())["status"] == "visible"
        sql(actor() + f"update public.posts set body=repeat('X',5998),link_url='Y',tags='{{}}' where id='{POST}';")
        assert finish(claim())["status"] == "visible"
        print("PASS: full length counts separators and Unicode points; overbound and bad tags denied; exact boundary accepted")

        sql(actor(OTHER) + f"update public.posts set link_url='https://example.invalid/foreign' where id='{POST}';")
        assert value(f"select link_url from public.posts where id='{POST}'") == "Y"
        sql(actor() + f"update public.posts set moderation_status='hidden' where id='{POST}';")
        assert value(f"select moderation_status from public.posts where id='{POST}'") == "visible"
        # A service/admin moderation-only action preserves explicit decisions.
        sql(f"update public.posts set moderation_status='hidden' where id='{POST}';")
        assert value(f"select moderation_status from public.posts where id='{POST}'") == "hidden"
        print("PASS: foreign-owner write and owner status forgery denied; trusted moderation-only action retained")

        sql(actor() + f"update public.post_comments set body='Complete comment' where id='{COMMENT}';")
        comment = claim("post_comments", COMMENT)
        assert comment["row"]["content_version"] == 2 and "link_url" not in comment["row"]
        assert finish(comment)["status"] == "visible"
        result = sql(actor() + f"update public.post_comments set body=repeat('X',6001) where id='{COMMENT}';", check=False)
        assert result.returncode and "6000" in result.stderr
        print("PASS: comments share the bound and verdict lifecycle without referencing post-only columns")

        samples = [("", None, None), ("A", "B", ["x", None, "", "y"]), ("😀", "url", []), ("e\u0301", "", ["", ""])]
        for body, link, tags in samples:
            tag_sql = "null" if tags is None else "array[" + ",".join("null" if t is None else literal(t) for t in tags) + "]::text[]"
            actual = value(f"select encode(convert_to(private.moderation_text({literal(body)},{'null' if link is None else literal(link)},{tag_sql}),'UTF8'),'hex')")
            fields = [body, link, None if tags is None else "\n".join(t for t in tags if t is not None)]
            expected = "\n".join(f for f in fields if f)
            assert bytes.fromhex(actual).decode("utf-8") == expected
        print("PASS: SQL serializer matches Edge field/separator/null/Unicode contract")
        print("ALL COMPLETE MODERATION BOUNDARY CHECKS PASSED; real baseline/gateway still unverified")
    finally:
        command("rm", "-f", NAME, check=False)


if __name__ == "__main__":
    main()
