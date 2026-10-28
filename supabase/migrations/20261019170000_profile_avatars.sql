-- Profile photos. Files live in the private 'avatars' bucket under {user_id}/.
-- A new photo waits in avatar_pending_path (only its owner can read it) until
-- the content-moderation edge function (Gemini vision) approves it; only then
-- does it become avatar_path, which other signed-in users may read through
-- signed URLs. Nothing is shown unchecked: on AI failure the photo stays
-- pending and the one-minute retry job sends it again.

/* ---------------- columns ---------------- */

alter table public.profiles
  add column if not exists avatar_path text,
  add column if not exists avatar_pending_path text,
  add column if not exists avatar_requested_at timestamptz,
  add column if not exists avatar_attempts integer not null default 0,
  add column if not exists avatar_reason text,
  add column if not exists avatar_moderated_at timestamptz,
  add column if not exists avatar_submit_day date,
  add column if not exists avatar_submit_count integer not null default 0;

create index if not exists profiles_avatar_path_idx on public.profiles(avatar_path) where avatar_path is not null;
create index if not exists profiles_avatar_pending_idx on public.profiles(avatar_requested_at) where avatar_pending_path is not null;

/* ---------------- write guard ---------------- */

-- Users may not set the avatar columns directly (that would skip the AI check).
-- They change only inside the SECURITY DEFINER functions below, where
-- current_user is the function owner, so this trigger runs as the caller.
create or replace function private.profile_avatar_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') or public.is_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.avatar_path := null;
    new.avatar_pending_path := null;
    new.avatar_requested_at := null;
    new.avatar_attempts := 0;
    new.avatar_reason := null;
    new.avatar_moderated_at := null;
    new.avatar_submit_day := null;
    new.avatar_submit_count := 0;
  else
    new.avatar_path := old.avatar_path;
    new.avatar_pending_path := old.avatar_pending_path;
    new.avatar_requested_at := old.avatar_requested_at;
    new.avatar_attempts := old.avatar_attempts;
    new.avatar_reason := old.avatar_reason;
    new.avatar_moderated_at := old.avatar_moderated_at;
    new.avatar_submit_day := old.avatar_submit_day;
    new.avatar_submit_count := old.avatar_submit_count;
  end if;
  return new;
end $$;

drop trigger if exists profiles_avatar_guard on public.profiles;
create trigger profiles_avatar_guard before insert or update on public.profiles
  for each row execute function private.profile_avatar_guard();

/* ---------------- bucket ---------------- */

-- Photos are resized to 400x400 in the browser, so 1 MB is generous.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 1048576, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- At most 20 files in a user's folder; replaced photos are deleted, so normal
-- use stays at 1–3 files.
create or replace function public.avatar_folder_has_room()
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
     and (select count(*) from storage.objects o
          where o.bucket_id = 'avatars'
            and o.name like (select auth.uid())::text || '/%') < 20;
$$;

-- An approved photo of an active account; readable by every signed-in user.
create or replace function public.avatar_is_shown(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
                 where p.avatar_path = p_name and p.status = 'active');
$$;

drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars'
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and (select public.avatar_folder_has_room()));

drop policy if exists avatars_select on storage.objects;
create policy avatars_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars'
         and ((storage.foldername(name))[1] = (select auth.uid())::text
              or public.avatar_is_shown(name)
              or (select public.is_admin())));

drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

/* ---------------- user actions ---------------- */

-- Called after the browser uploaded {uid}/{32 hex}.webp|jpg. Returns the
-- previous unchecked file (if any) so the browser can delete it.
create or replace function public.avatar_submit(p_path text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_old_pending text;
  v_day date;
  v_count integer;
  v_today date := (now() at time zone 'Asia/Baku')::date;
begin
  if v_uid is null then
    raise exception 'Sessiya yoxdur' using errcode = 'insufficient_privilege';
  end if;
  if p_path is null or p_path !~ ('^' || v_uid::text || '/[0-9a-f]{32}\.(webp|jpg)$') then
    raise exception 'Yanlış fayl yolu' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'avatars' and o.name = p_path) then
    raise exception 'Şəkil faylı tapılmadı. Yenidən yükləyin.' using errcode = 'no_data_found';
  end if;

  select avatar_pending_path, avatar_submit_day, avatar_submit_count
    into v_old_pending, v_day, v_count
  from public.profiles where id = v_uid for update;
  if not found then
    raise exception 'Profil tapılmadı' using errcode = 'no_data_found';
  end if;

  if v_day is distinct from v_today then v_count := 0; end if;
  if v_count >= 10 then
    raise exception 'Gün ərzində ən çox 10 şəkil göndərmək olar. Sabah yenidən cəhd edin.'
      using errcode = 'check_violation';
  end if;

  update public.profiles
  set avatar_pending_path = p_path, avatar_requested_at = now(), avatar_attempts = 0,
      avatar_reason = null, avatar_submit_day = v_today, avatar_submit_count = v_count + 1
  where id = v_uid;

  return jsonb_build_object('status', 'pending', 'replaced', nullif(v_old_pending, p_path));
end $$;

-- Clears both photos; the browser then deletes the returned files.
create or replace function public.avatar_remove()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_path text;
  v_pending text;
begin
  if v_uid is null then
    raise exception 'Sessiya yoxdur' using errcode = 'insufficient_privilege';
  end if;
  select avatar_path, avatar_pending_path into v_path, v_pending
  from public.profiles where id = v_uid for update;
  update public.profiles
  set avatar_path = null, avatar_pending_path = null, avatar_reason = null
  where id = v_uid;
  return jsonb_build_object('files', to_jsonb(array_remove(array[v_path, v_pending], null)));
end $$;

/* ---------------- AI request ---------------- */

-- Reuses the posts/comments sender: body {table: 'profiles', id}.
create or replace function private.profile_avatar_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.avatar_pending_path is not null
     and new.avatar_requested_at is distinct from old.avatar_requested_at then
    perform private.moderation_send('profiles', new.id);
  end if;
  return null;
end $$;

drop trigger if exists profiles_avatar_request on public.profiles;
create trigger profiles_avatar_request after update of avatar_pending_path, avatar_requested_at on public.profiles
  for each row execute function private.profile_avatar_request();

/* ---------------- AI verdict (service role only) ---------------- */

create or replace function public.avatar_moderation_apply(
  p_profile_id uuid, p_path text, p_requested_at timestamptz, p_allow boolean,
  p_reason text default null, p_categories text[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_old text;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select avatar_path into v_old from public.profiles
  where id = p_profile_id and avatar_pending_path = p_path and avatar_requested_at = p_requested_at
  for update;
  -- The photo was replaced or removed meanwhile.
  if not found then return jsonb_build_object('status', 'skipped'); end if;

  if p_allow then
    update public.profiles
    set avatar_path = p_path, avatar_pending_path = null, avatar_reason = null, avatar_moderated_at = now()
    where id = p_profile_id;
    return jsonb_build_object('status', 'visible', 'previous_path', nullif(v_old, p_path));
  end if;

  v_reason := coalesce(v_reason, 'Şəkil platformanın qaydalarına uyğun deyil.');
  update public.profiles
  set avatar_pending_path = null, avatar_reason = v_reason, avatar_moderated_at = now()
  where id = p_profile_id;
  -- The rejected file is kept for admin review; its path is in the log.
  insert into public.moderation_logs(target_type, target_id, action, reason, actor_id)
  values ('avatar', p_profile_id, 'hide',
          'AI: ' || v_reason
          || case when cardinality(p_categories) > 0 then ' [' || array_to_string(p_categories, ', ') || ']' else '' end
          || ' · avatars/' || p_path,
          null);
  insert into public.notifications(profile_id, kind, title, body, link)
  values (p_profile_id, 'avatar_hidden', 'Profil şəkliniz qəbul edilmədi',
          v_reason || ' Başqa şəkil yükləyə bilərsiniz.', 'profile');
  return jsonb_build_object('status', 'hidden');
end $$;

/* ---------------- retry job ---------------- */

create or replace function private.avatar_moderation_retry()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_sent integer := 0;
begin
  for r in
    select id, avatar_attempts from public.profiles
    where avatar_pending_path is not null
      and avatar_requested_at < now() - interval '1 minute'
      and avatar_attempts < 5
    order by avatar_requested_at
    limit 50
  loop
    update public.profiles set avatar_attempts = avatar_attempts + 1 where id = r.id;
    perform private.moderation_send('profiles', r.id);
    v_sent := v_sent + 1;
    if r.avatar_attempts + 1 = 5 then
      perform private.notify_admins('moderation_stuck', 'AI şəkil yoxlaması cavab vermir',
        'Profil şəkli 5 cəhddən sonra yoxlanılmayıb və gizli qalır. Admin paneldən əllə yoxlayın.',
        'profile');
    end if;
  end loop;
  return jsonb_build_object('sent', v_sent, 'ran_at', now());
end $$;

select cron.schedule('avatar-moderation-retry', '* * * * *', 'select private.avatar_moderation_retry()');

/* ---------------- network cards ---------------- */

-- Same visibility rules as before, plus the approved photo path.
drop function if exists public.profile_cards(uuid[]);
create function public.profile_cards(p_ids uuid[])
returns table(id uuid, full_name text, role text, faculty_id text, major_id text, avatar_path text)
language sql stable security definer set search_path = '' as $$
  select p.id,
         case when p.role = 'company' then coalesce(
           (select c.name from public.companies c
             where c.owner_id = p.id and c.status = 'active'
             order by c.created_at limit 1),
           p.full_name)
         else p.full_name end,
         p.role::text, p.faculty_id, p.major_id,
         case when p.status = 'active' then p.avatar_path end
  from public.profiles p
  where (select auth.uid()) is not null
    and p.id = any(p_ids[1:500])
    and (p.id = (select auth.uid())
      or exists (select 1 from public.posts po where po.author_id = p.id and po.moderation_status = 'visible')
      or exists (select 1 from public.post_comments pc where pc.author_id = p.id and pc.moderation_status = 'visible'));
$$;

/* ---------------- grants ---------------- */

revoke execute on function private.profile_avatar_guard() from public, anon, authenticated;
revoke execute on function private.profile_avatar_request() from public, anon, authenticated;
revoke execute on function private.avatar_moderation_retry() from public, anon, authenticated;

revoke execute on function public.avatar_folder_has_room() from public, anon;
grant execute on function public.avatar_folder_has_room() to authenticated;
revoke execute on function public.avatar_is_shown(text) from public, anon;
grant execute on function public.avatar_is_shown(text) to authenticated;
revoke execute on function public.avatar_submit(text) from public, anon;
grant execute on function public.avatar_submit(text) to authenticated;
revoke execute on function public.avatar_remove() from public, anon;
grant execute on function public.avatar_remove() to authenticated;
revoke execute on function public.avatar_moderation_apply(uuid, text, timestamptz, boolean, text, text[]) from public, anon, authenticated;
grant execute on function public.avatar_moderation_apply(uuid, text, timestamptz, boolean, text, text[]) to service_role;
revoke execute on function public.profile_cards(uuid[]) from public, anon;
grant execute on function public.profile_cards(uuid[]) to authenticated;
