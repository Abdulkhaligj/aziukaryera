-- Scalable content notifications: one broadcast row per published item.
-- Per-user read state is stored separately, avoiding 10k duplicate rows.

create schema if not exists private;

create table if not exists public.broadcast_notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  title text not null,
  body text not null default '',
  link text,
  source_type text not null,
  source_id uuid not null,
  target_roles text[] not null default array['student','graduate']::text[],
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_type, source_id)
);

create table if not exists public.broadcast_notification_reads (
  broadcast_id uuid not null references public.broadcast_notifications(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (broadcast_id, profile_id)
);

create index if not exists broadcast_notifications_created_idx
  on public.broadcast_notifications(created_at desc);
create index if not exists broadcast_notifications_creator_idx
  on public.broadcast_notifications(created_by) where created_by is not null;
create index if not exists broadcast_notification_reads_profile_idx
  on public.broadcast_notification_reads(profile_id, read_at desc);

alter table public.broadcast_notifications enable row level security;
alter table public.broadcast_notification_reads enable row level security;

grant select on public.broadcast_notifications to authenticated;
grant insert, update, delete on public.broadcast_notifications to authenticated;
grant select, insert, update, delete on public.broadcast_notification_reads to authenticated;

drop policy if exists broadcast_notifications_read on public.broadcast_notifications;
create policy broadcast_notifications_read on public.broadcast_notifications
for select to authenticated using (
  (select public.is_admin()) or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role::text = any (broadcast_notifications.target_roles)
      and p.status::text in ('active','pending')
  )
);

drop policy if exists broadcast_notifications_admin_write on public.broadcast_notifications;
drop policy if exists broadcast_notifications_admin_insert on public.broadcast_notifications;
create policy broadcast_notifications_admin_insert on public.broadcast_notifications
for insert to authenticated with check ((select public.is_admin()));
drop policy if exists broadcast_notifications_admin_update on public.broadcast_notifications;
create policy broadcast_notifications_admin_update on public.broadcast_notifications
for update to authenticated using ((select public.is_admin()))
with check ((select public.is_admin()));
drop policy if exists broadcast_notifications_admin_delete on public.broadcast_notifications;
create policy broadcast_notifications_admin_delete on public.broadcast_notifications
for delete to authenticated using ((select public.is_admin()));

drop policy if exists broadcast_notification_reads_own on public.broadcast_notification_reads;
create policy broadcast_notification_reads_own on public.broadcast_notification_reads
for all to authenticated using (profile_id = (select auth.uid()))
with check (profile_id = (select auth.uid()));

create or replace function private.publish_content_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_title text;
  v_body text;
  v_link text;
  v_publish boolean := false;
  v_author_role text;
begin
  if tg_table_name = 'events' then
    v_publish := tg_op = 'INSERT';
    v_kind := 'new_event';
    v_title := 'Yeni tədbir: ' || new.title;
    v_body := concat_ws(' · ', nullif(new.kind, ''), nullif(new.place, ''),
      to_char(new.starts_at at time zone 'Asia/Baku', 'DD.MM.YYYY HH24:MI'));
    v_link := 'events';

  elsif tg_table_name = 'jobs' then
    v_publish := new.status::text in ('approved','published')
      and (tg_op = 'INSERT' or old.status is distinct from new.status);
    v_kind := case new.type::text
      when 'tecrube' then 'new_internship'
      when 'konullu' then 'new_volunteer'
      when 'graduate' then 'new_graduate_program'
      else 'new_job' end;
    v_title := case new.type::text
      when 'tecrube' then 'Yeni təcrübə imkanı'
      when 'konullu' then 'Yeni könüllülük imkanı'
      when 'graduate' then 'Yeni graduate proqramı'
      else 'Yeni vakansiya' end;
    v_body := new.title;
    v_link := 'jobs';

  elsif tg_table_name = 'benefits' then
    v_publish := new.active = true and (tg_op = 'INSERT' or old.active is distinct from new.active);
    v_kind := 'new_benefit';
    v_title := 'Yeni tələbə güzəşti';
    v_body := concat_ws(' · ', new.title, nullif(new.discount_label, ''));
    v_link := 'benefits';

  elsif tg_table_name = 'site_content' then
    v_publish := new.status = 'Aktiv'
      and (tg_op = 'INSERT' or old.status is distinct from new.status);
    v_kind := 'new_content';
    v_title := new.title;
    v_body := coalesce(nullif(new.summary, ''), left(new.body, 240));
    v_link := 'dashboard';

  elsif tg_table_name = 'posts' then
    select p.role::text into v_author_role from public.profiles p where p.id = new.author_id;
    v_publish := v_author_role = 'admin' and new.moderation_status = 'visible'
      and (tg_op = 'INSERT' or old.moderation_status is distinct from new.moderation_status);
    v_kind := 'new_post';
    v_title := 'Karyera Mərkəzindən yeni paylaşım';
    v_body := left(new.body, 240);
    v_link := 'network';
  end if;

  if v_publish then
    insert into public.broadcast_notifications
      (kind, title, body, link, source_type, source_id, created_by)
    values
      (v_kind, v_title, coalesce(v_body, ''), v_link, tg_table_name, new.id, auth.uid())
    on conflict (source_type, source_id) do update set
      kind = excluded.kind,
      title = excluded.title,
      body = excluded.body,
      link = excluded.link,
      created_by = excluded.created_by,
      created_at = now(),
      updated_at = now();
  end if;

  return new;
end;
$$;

-- The admin authorization helper also lives in `private`. Authenticated users
-- need schema usage so RLS can call it, while function-level permissions keep
-- notification publishing inaccessible from clients.
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
revoke all on function private.publish_content_notification() from public, anon, authenticated;

drop trigger if exists events_broadcast_notification on public.events;
create trigger events_broadcast_notification
after insert on public.events
for each row execute function private.publish_content_notification();

drop trigger if exists jobs_broadcast_notification on public.jobs;
create trigger jobs_broadcast_notification
after insert or update of status on public.jobs
for each row execute function private.publish_content_notification();

drop trigger if exists benefits_broadcast_notification on public.benefits;
create trigger benefits_broadcast_notification
after insert or update of active on public.benefits
for each row execute function private.publish_content_notification();

drop trigger if exists site_content_broadcast_notification on public.site_content;
create trigger site_content_broadcast_notification
after insert or update of status on public.site_content
for each row execute function private.publish_content_notification();

drop trigger if exists posts_broadcast_notification on public.posts;
create trigger posts_broadcast_notification
after insert or update of moderation_status on public.posts
for each row execute function private.publish_content_notification();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'broadcast_notifications'
    ) then
      alter publication supabase_realtime add table public.broadcast_notifications;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
    ) then
      alter publication supabase_realtime add table public.notifications;
    end if;
  end if;
end $$;
