-- VIBE-04/05: moderate the complete displayed text, never a prefix. Upgrade
-- requires the original schema and the preceding migrations.
begin;

-- Execute data quarantine as the migration owner, independently of any
-- request JWT left on an administrative SQL connection. LOCAL restores it.
set local request.jwt.claims = '{}';
set local request.jwt.claim.sub = '';

lock table public.posts, public.post_comments in share row exclusive mode;

-- PostgreSQL char_length and the Edge code-point iterator use the same Unicode
-- unit. Empty/null fields are omitted; separators and displayed tags count.
create or replace function private.moderation_text(p_body text, p_link text default null, p_tags text[] default null)
returns text language sql immutable set search_path = '' as $$
  select concat_ws(E'\n', nullif(p_body,''), nullif(p_link,''),
    nullif(array_to_string(p_tags,E'\n'),''));
$$;
revoke all on function private.moderation_text(text,text,text[]) from public, anon, authenticated, service_role;

-- The previous JavaScript slice counted UTF-16 units. A bounded body-only row
-- with supplementary Unicode may also have had an unchecked tail. At most
-- 6001 code points are needed to identify that legacy condition.
create function private.legacy_moderation_truncated(p_text text)
returns boolean language sql immutable strict set search_path = '' as $$
  select coalesce(sum(char_length(part)+case when ascii(part)>65535 then 1 else 0 end),0)>6000
  from regexp_split_to_table(left(p_text,6001),'') as split(part);
$$;
revoke all on function private.legacy_moderation_truncated(text) from public, anon, authenticated, service_role;

-- Historical long content must not remain published with an unchecked suffix.
-- Preserve the original bytes for author correction/review; do not truncate.
update public.posts set moderation_status='hidden',
  moderation_reason='Məzmun yoxlama həddini aşır. Qısaldıb yenidən göndərin.', moderated_at=clock_timestamp()
where char_length(private.moderation_text(body,link_url,tags)) > 6000;
update public.post_comments set moderation_status='hidden',
  moderation_reason='Məzmun yoxlama həddini aşır. Qısaldıb yenidən göndərin.', moderated_at=clock_timestamp()
where char_length(private.moderation_text(body)) > 6000
  or (moderation_status='visible' and private.legacy_moderation_truncated(body));

-- The old body-only change detector cannot prove that a visible post's link
-- or independently rendered tags were checked. Quarantine those historical
-- rows for explicit review/requeue, preserving bytes and avoiding a bulk AI
-- queue/provider spend during migration. Plain bounded body-only posts stay.
update public.posts set moderation_status='hidden',
  moderation_reason='Keçid və teqlər yeni qayda ilə tam yoxlanmalıdır. Yenidən baxış tələb olunur.',
  moderated_at=clock_timestamp()
where moderation_status='visible' and (nullif(link_url,'') is not null or cardinality(tags)>0
  or private.legacy_moderation_truncated(body));

create or replace function private.moderation_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_privileged boolean := auth.uid() is null or public.is_admin();
  v_text text;
  v_changed boolean;
  v_new jsonb := to_jsonb(new);
  v_old jsonb;
begin
  if tg_op='UPDATE' then v_old:=to_jsonb(old); end if;
  if tg_table_name='posts' then
    v_text:=private.moderation_text(new.body, new.link_url, new.tags);
    v_changed:=tg_op='INSERT' or new.body is distinct from old.body
      or v_new->'link_url' is distinct from v_old->'link_url'
      or v_new->'tags' is distinct from v_old->'tags';
  else
    v_text:=private.moderation_text(new.body);
    v_changed:=tg_op='INSERT' or new.body is distinct from old.body;
  end if;

  if char_length(v_text)>6000 then
    -- A trusted verdict/maintenance action can hide an already stored legacy
    -- row. New or edited overlong text is rejected for every writer.
    if not (tg_op='UPDATE' and not v_changed and v_privileged and new.moderation_status='hidden') then
      raise exception 'Məzmun keçid və teqlərlə birlikdə ən çox 6000 simvol ola bilər.' using errcode='23514';
    end if;
  end if;

  if not v_changed then
    if not v_privileged then
      new.moderation_status:=old.moderation_status;
      new.moderation_reason:=old.moderation_reason;
      new.moderated_at:=old.moderated_at;
      new.moderation_requested_at:=old.moderation_requested_at;
      new.moderation_attempts:=old.moderation_attempts;
    elsif new.moderation_status='pending' and old.moderation_status is distinct from 'pending' then
      new.moderation_requested_at:=clock_timestamp();
      new.moderation_attempts:=0;
    end if;
    return new;
  end if;

  if not v_privileged and private.moderation_blocked_term(v_text) is not null then
    raise exception 'Mətndə nalayiq ifadə var. Zəhmət olmasa, mətni düzəldib yenidən göndərin.' using errcode='23514';
  end if;
  -- Every body/link/tag change gets a new content generation, including
  -- privileged edits. Explicit moderation-only admin/service actions remain.
  new.moderation_status:='pending';
  new.moderation_reason:=null;
  new.moderated_at:=null;
  new.moderation_requested_at:=clock_timestamp();
  new.moderation_attempts:=0;
  return new;
end $$;
revoke all on function private.moderation_guard() from public, anon, authenticated, service_role;
drop trigger if exists posts_moderation_guard on public.posts;
create trigger posts_moderation_guard before insert or update on public.posts
  for each row execute function private.moderation_guard();
drop trigger if exists post_comments_moderation_guard on public.post_comments;
create trigger post_comments_moderation_guard before insert or update on public.post_comments
  for each row execute function private.moderation_guard();

-- The same full fields are classified and compared before a verdict applies.
-- Versioning rejects a legacy claim created by the older snapshot contract.
create or replace function private.moderation_snapshot(p_table text,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row jsonb;
begin
  if p_table='posts' then
    select jsonb_build_object('content_version',2,'id',id,'body',body,'link_url',link_url,'tags',tags,
      'moderation_requested_at',moderation_requested_at)
      into v_row from public.posts where id=p_id and moderation_status='pending' for update;
  elsif p_table='post_comments' then
    select jsonb_build_object('content_version',2,'id',id,'body',body,'moderation_requested_at',moderation_requested_at)
      into v_row from public.post_comments where id=p_id and moderation_status='pending' for update;
  elsif p_table='profiles' then
    select jsonb_build_object('id',id,'avatar_pending_path',avatar_pending_path,'avatar_requested_at',avatar_requested_at)
      into v_row from public.profiles where id=p_id and avatar_pending_path is not null for update;
  else raise exception 'Unsupported moderation target' using errcode='22023';
  end if;
  return v_row;
end $$;
revoke all on function private.moderation_snapshot(text,uuid) from public, anon, authenticated, service_role;

-- A rolling deployment must not let the previous prefix-only Edge handler
-- approve the new complete snapshot. Legacy callers may hide/retry, but an
-- allow verdict must explicitly use the current classification contract.
drop function public.moderation_finish(uuid,boolean,text,text[]);
create function public.moderation_finish(p_claim_id uuid,p_allow boolean default null,
  p_reason text default null,p_categories text[] default '{}',p_content_version integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_claim private.moderation_claims; v_snapshot jsonb; v_result jsonb;
begin
  select * into v_claim from private.moderation_claims where claim_id=p_claim_id;
  if not found then return jsonb_build_object('status','skipped'); end if;
  v_snapshot:=private.moderation_snapshot(v_claim.target_table,v_claim.target_id);
  select * into v_claim from private.moderation_claims where claim_id=p_claim_id for update;
  if not found or v_claim.finished or v_claim.claimed_until<=clock_timestamp() then return jsonb_build_object('status','skipped'); end if;
  if p_allow is null then
    update private.moderation_claims set claimed_until=clock_timestamp() where claim_id=p_claim_id;
    return jsonb_build_object('status','retry');
  end if;
  if v_snapshot is distinct from v_claim.snapshot then
    update private.moderation_claims set finished=true where claim_id=p_claim_id;
    return jsonb_build_object('status','skipped');
  end if;
  if p_allow and v_claim.target_table<>'profiles' and
     (p_content_version is distinct from 2 or v_snapshot->>'content_version' is distinct from '2') then
    update private.moderation_claims set claimed_until=clock_timestamp() where claim_id=p_claim_id;
    return jsonb_build_object('status','retry','code','content_version_required');
  end if;
  if v_claim.target_table='profiles' then
    v_result:=public.avatar_moderation_apply(v_claim.target_id,v_snapshot->>'avatar_pending_path',
      (v_snapshot->>'avatar_requested_at')::timestamptz,p_allow,p_reason,p_categories);
  else
    v_result:=jsonb_build_object('status',public.moderation_apply(v_claim.target_table,v_claim.target_id,
      (v_snapshot->>'moderation_requested_at')::timestamptz,p_allow,p_reason,p_categories));
  end if;
  update private.moderation_claims set finished=true where claim_id=p_claim_id;
  return v_result;
end $$;
revoke all on function public.moderation_finish(uuid,boolean,text,text[],integer) from public, anon, authenticated;
grant execute on function public.moderation_finish(uuid,boolean,text,text[],integer) to service_role;

commit;
