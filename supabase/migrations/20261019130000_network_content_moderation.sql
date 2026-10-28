-- Network posts and comments. A word-list check blocks obvious profanity on
-- write; every new or edited text then waits as 'pending' (only its author
-- sees it) until the content-moderation edge function (AI) marks it
-- 'visible' or 'hidden'. A one-minute job retries texts the AI has not
-- answered yet, so nothing is published unchecked.

create extension if not exists pg_net with schema extensions;

/* ---------------- columns ---------------- */

alter table public.posts
  add column if not exists moderation_reason text,
  add column if not exists moderated_at timestamptz,
  add column if not exists moderation_requested_at timestamptz,
  add column if not exists moderation_attempts integer not null default 0;
alter table public.posts alter column moderation_status set default 'pending';

-- Existing comments stay visible; new ones start as pending.
alter table public.post_comments
  add column if not exists moderation_status text not null default 'visible',
  add column if not exists moderation_reason text,
  add column if not exists moderated_at timestamptz,
  add column if not exists moderation_requested_at timestamptz,
  add column if not exists moderation_attempts integer not null default 0;
alter table public.post_comments alter column moderation_status set default 'pending';

do $$ begin
  alter table public.post_comments add constraint post_comments_moderation_status_check
    check (moderation_status in ('pending', 'visible', 'hidden'));
exception when duplicate_object then null; end $$;

create index if not exists posts_moderation_pending_idx on public.posts(moderation_requested_at) where moderation_status = 'pending';
create index if not exists post_comments_moderation_pending_idx on public.post_comments(moderation_requested_at) where moderation_status = 'pending';

/* ---------------- word list ---------------- */

-- Lowercase, Azerbaijani letters to Latin, common digit/symbol swaps,
-- separators inside words removed (s.i.k), repeated letters collapsed.
create or replace function private.moderation_normalize(p_text text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(
           regexp_replace(
             translate(lower(coalesce(p_text, '')), 'əıöüşçğ0134@$5ё' || chr(775), 'eiouscgoieaassе'),
             '([a-zа-я])[._*-]+(?=[a-zа-я])', '\1', 'g'),
           '([a-zа-я])\1+', '\1', 'g');
$$;

create table if not exists public.moderation_terms (
  term text primary key check (term ~ '^[a-zа-я]+$'),
  match text not null default 'stem' check (match in ('stem', 'word')),
  lang text not null default 'az',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.moderation_terms enable row level security;
drop policy if exists moderation_terms_admin on public.moderation_terms;
create policy moderation_terms_admin on public.moderation_terms for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Terms added from the admin panel are stored in normalized form.
create or replace function private.moderation_terms_normalize()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.term := private.moderation_normalize(trim(new.term));
  return new;
end $$;

drop trigger if exists moderation_terms_normalize on public.moderation_terms;
create trigger moderation_terms_normalize before insert or update of term on public.moderation_terms
  for each row execute function private.moderation_terms_normalize();

-- 'stem' matches words that start with the term, 'word' only the whole word.
-- Short or ambiguous roots are left to the AI on purpose (şikayət, sikkə, Amina,
-- Turkish sıkıldım / sıktı / sıkmak, which normalize like the swear roots).
insert into public.moderation_terms(term, match, lang) values
  ('siktir', 'stem', 'az'), ('sikd', 'stem', 'az'), ('sikim', 'stem', 'az'), ('siker', 'stem', 'az'),
  ('sikey', 'stem', 'az'), ('sikmek', 'stem', 'az'), ('sikib', 'stem', 'az'),
  ('amciq', 'stem', 'az'), ('amcig', 'stem', 'az'), ('amcix', 'stem', 'az'),
  ('qehbe', 'stem', 'az'), ('gehbe', 'stem', 'az'), ('qanciq', 'stem', 'az'), ('qancig', 'stem', 'az'),
  ('ogras', 'stem', 'az'), ('gotver', 'stem', 'az'), ('gijdilaq', 'stem', 'az'), ('gicdilaq', 'stem', 'az'),
  ('dalbayob', 'stem', 'az'), ('dalbayok', 'stem', 'az'), ('dolbayob', 'stem', 'az'),
  ('pox', 'word', 'az'), ('poxu', 'word', 'az'), ('poxlu', 'word', 'az'),
  ('orospu', 'stem', 'tr'), ('orosbu', 'stem', 'tr'), ('amk', 'word', 'tr'), ('yarak', 'word', 'tr'),
  ('ibne', 'word', 'tr'), ('pezevenk', 'stem', 'tr'), ('kahpe', 'stem', 'tr'),
  ('хуй', 'stem', 'ru'), ('хуе', 'stem', 'ru'), ('хуя', 'stem', 'ru'), ('хуи', 'stem', 'ru'),
  ('пизд', 'stem', 'ru'), ('ебан', 'stem', 'ru'), ('ебат', 'stem', 'ru'), ('ебал', 'stem', 'ru'),
  ('ебл', 'stem', 'ru'), ('ебу', 'stem', 'ru'), ('уеб', 'stem', 'ru'), ('долбоеб', 'stem', 'ru'),
  ('бляд', 'stem', 'ru'), ('блят', 'stem', 'ru'), ('бля', 'word', 'ru'), ('сука', 'word', 'ru'),
  ('суки', 'word', 'ru'), ('мудак', 'stem', 'ru'), ('мудил', 'stem', 'ru'), ('пидор', 'stem', 'ru'),
  ('пидар', 'stem', 'ru'), ('пидр', 'stem', 'ru'), ('залуп', 'stem', 'ru'), ('гандон', 'stem', 'ru'),
  ('шлюх', 'stem', 'ru'),
  ('blyat', 'stem', 'ru'), ('blyad', 'stem', 'ru'), ('bilyat', 'stem', 'ru'), ('suka', 'word', 'ru'),
  ('pizd', 'stem', 'ru'), ('nahuy', 'stem', 'ru'), ('naxuy', 'stem', 'ru'), ('mudak', 'stem', 'ru'),
  ('pidor', 'stem', 'ru'), ('pidar', 'stem', 'ru'), ('pidr', 'word', 'ru'), ('gandon', 'stem', 'ru'),
  ('dolboeb', 'stem', 'ru'), ('zalup', 'stem', 'ru'),
  ('fuck', 'stem', 'en'), ('motherf', 'stem', 'en'), ('shit', 'word', 'en'), ('shity', 'word', 'en'),
  ('bulshit', 'word', 'en'), ('bitch', 'stem', 'en'), ('cunt', 'stem', 'en'), ('ashole', 'stem', 'en'),
  ('bastard', 'stem', 'en'), ('whore', 'stem', 'en'), ('slut', 'stem', 'en'), ('pusy', 'word', 'en')
on conflict (term) do nothing;

create or replace function private.moderation_blocked_term(p_text text)
returns text language sql stable security definer set search_path = '' as $$
  select t.term
  from public.moderation_terms t,
       (select ' ' || private.moderation_normalize(p_text) || ' ' as s) n
  where t.active
    and n.s ~ ('[^a-zа-я0-9]' || t.term || case when t.match = 'word' then '[^a-zа-я0-9]' else '' end)
  limit 1;
$$;

/* ---------------- write guard ---------------- */

create or replace function private.moderation_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  -- The moderation service, cron and SQL editor run without a user; admins may moderate.
  v_privileged boolean := auth.uid() is null or public.is_admin();
begin
  if tg_op = 'UPDATE' and new.body is not distinct from old.body then
    if not v_privileged then
      new.moderation_status := old.moderation_status;
      new.moderation_reason := old.moderation_reason;
      new.moderated_at := old.moderated_at;
      new.moderation_requested_at := old.moderation_requested_at;
      new.moderation_attempts := old.moderation_attempts;
    elsif new.moderation_status = 'pending' and old.moderation_status is distinct from 'pending' then
      -- An admin sent the text back for another check.
      new.moderation_requested_at := now();
      new.moderation_attempts := 0;
    end if;
    return new;
  end if;

  if not v_privileged and private.moderation_blocked_term(new.body) is not null then
    raise exception 'Mətndə nalayiq ifadə var. Zəhmət olmasa, mətni düzəldib yenidən göndərin.'
      using errcode = 'check_violation';
  end if;

  if not v_privileged or new.moderation_status = 'pending' then
    new.moderation_status := 'pending';
    new.moderation_reason := null;
    new.moderated_at := null;
    new.moderation_requested_at := now();
    new.moderation_attempts := 0;
  end if;
  return new;
end $$;

drop trigger if exists posts_moderation_guard on public.posts;
create trigger posts_moderation_guard before insert or update on public.posts
  for each row execute function private.moderation_guard();
drop trigger if exists post_comments_moderation_guard on public.post_comments;
create trigger post_comments_moderation_guard before insert or update on public.post_comments
  for each row execute function private.moderation_guard();

/* ---------------- AI request ---------------- */

create or replace function private.moderation_send(p_table text, p_id uuid)
returns bigint language sql security definer set search_path = '' as $$
  select net.http_post(
    url := 'https://ttfsbgbhyomfheglefkn.supabase.co/functions/v1/content-moderation',
    body := jsonb_build_object('table', p_table, 'id', p_id),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 30000);
$$;

-- pg_net sends after the transaction commits, so the function sees the row.
create or replace function private.moderation_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.moderation_status = 'pending'
     and (tg_op = 'INSERT' or new.moderation_requested_at is distinct from old.moderation_requested_at) then
    perform private.moderation_send(tg_table_name, new.id);
  end if;
  return null;
end $$;

drop trigger if exists posts_moderation_request on public.posts;
create trigger posts_moderation_request after insert or update on public.posts
  for each row execute function private.moderation_request();
drop trigger if exists post_comments_moderation_request on public.post_comments;
create trigger post_comments_moderation_request after insert or update on public.post_comments
  for each row execute function private.moderation_request();

/* ---------------- AI verdict (service role only) ---------------- */

create or replace function public.moderation_apply(
  p_table text, p_id uuid, p_requested_at timestamptz, p_allow boolean,
  p_reason text default null, p_categories text[] default '{}')
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_author uuid;
  v_status text := case when p_allow then 'visible' else 'hidden' end;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if p_table = 'posts' then
    update public.posts
    set moderation_status = v_status, moderation_reason = v_reason, moderated_at = now()
    where id = p_id and moderation_status = 'pending' and moderation_requested_at = p_requested_at
    returning author_id into v_author;
  elsif p_table = 'post_comments' then
    update public.post_comments
    set moderation_status = v_status, moderation_reason = v_reason, moderated_at = now()
    where id = p_id and moderation_status = 'pending' and moderation_requested_at = p_requested_at
    returning author_id into v_author;
  else
    raise exception 'Unsupported table %', p_table;
  end if;

  -- The text changed or was decided meanwhile.
  if v_author is null then return 'skipped'; end if;

  if not p_allow then
    insert into public.moderation_logs(target_type, target_id, action, reason, actor_id)
    values (case when p_table = 'posts' then 'post' else 'comment' end, p_id, 'hide',
            'AI: ' || coalesce(v_reason, 'davranış qaydalarını pozur')
            || case when cardinality(p_categories) > 0 then ' [' || array_to_string(p_categories, ', ') || ']' else '' end,
            null);
    insert into public.notifications(profile_id, kind, title, body, link)
    values (v_author, 'content_hidden',
            case when p_table = 'posts' then 'Paylaşımınız dərc olunmadı' else 'Şərhiniz dərc olunmadı' end,
            coalesce(v_reason, 'Mətn platformanın davranış qaydalarına uyğun deyil.')
            || ' Səhv olduğunu düşünürsünüzsə, Karyera Mərkəzinə yazın.',
            'network');
  end if;
  return v_status;
end $$;

/* ---------------- retry job ---------------- */

create or replace function private.moderation_retry()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_sent integer := 0;
begin
  for r in
    select * from (
      select 'posts'::text as tbl, id, moderation_attempts, moderation_requested_at from public.posts
      where moderation_status = 'pending' and moderation_requested_at < now() - interval '1 minute' and moderation_attempts < 5
      union all
      select 'post_comments', id, moderation_attempts, moderation_requested_at from public.post_comments
      where moderation_status = 'pending' and moderation_requested_at < now() - interval '1 minute' and moderation_attempts < 5
    ) q
    order by moderation_requested_at
    limit 50
  loop
    execute format('update public.%I set moderation_attempts = moderation_attempts + 1 where id = $1', r.tbl) using r.id;
    perform private.moderation_send(r.tbl, r.id);
    v_sent := v_sent + 1;
    if r.moderation_attempts + 1 = 5 then
      perform private.notify_admins('moderation_stuck', 'AI moderasiyası cavab vermir',
        case when r.tbl = 'posts' then 'Paylaşım' else 'Şərh' end || ' 5 cəhddən sonra yoxlanılmayıb və gizli qalır. Admin paneldən əllə yoxlayın.',
        'network');
    end if;
  end loop;
  return jsonb_build_object('sent', v_sent, 'ran_at', now());
end $$;

select cron.schedule('content-moderation-retry', '* * * * *', 'select private.moderation_retry()');

/* ---------------- visibility ---------------- */

-- Others see only checked texts; the author sees own text while it is checked.
drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts for select to authenticated
  using (moderation_status = 'visible'
         or (author_id = (select auth.uid()) and moderation_status = 'pending')
         or (select public.is_admin()));

drop policy if exists comments_select on public.post_comments;
create policy comments_select on public.post_comments for select to authenticated
  using (moderation_status = 'visible'
         or (author_id = (select auth.uid()) and moderation_status = 'pending')
         or (select public.is_admin()));

/* ---------------- grants ---------------- */

revoke execute on function private.moderation_normalize(text) from public, anon, authenticated;
revoke execute on function private.moderation_blocked_term(text) from public, anon, authenticated;
revoke execute on function private.moderation_guard() from public, anon, authenticated;
revoke execute on function private.moderation_send(text, uuid) from public, anon, authenticated;
revoke execute on function private.moderation_request() from public, anon, authenticated;
revoke execute on function private.moderation_retry() from public, anon, authenticated;
revoke execute on function private.moderation_terms_normalize() from public, anon, authenticated;
revoke execute on function public.moderation_apply(text, uuid, timestamptz, boolean, text, text[]) from public, anon, authenticated;
grant execute on function public.moderation_apply(text, uuid, timestamptz, boolean, text, text[]) to service_role;
