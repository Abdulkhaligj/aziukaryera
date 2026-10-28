-- Paid advertising on the main site, a public image bucket for logos,
-- posters and ad banners, and richer events (description, organizers, image).

/* ---------------- public-media bucket ---------------- */

-- Public read (served from /storage/v1/object/public/...), writes by admins only.
-- No SVG: an SVG opened directly could run script on the storage origin.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('public-media', 'public-media', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists public_media_admin_select on storage.objects;
create policy public_media_admin_select on storage.objects for select to authenticated
  using (bucket_id = 'public-media' and (select public.is_admin()));
drop policy if exists public_media_admin_insert on storage.objects;
create policy public_media_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'public-media' and (select public.is_admin()));
drop policy if exists public_media_admin_update on storage.objects;
create policy public_media_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'public-media' and (select public.is_admin()))
  with check (bucket_id = 'public-media' and (select public.is_admin()));
drop policy if exists public_media_admin_delete on storage.objects;
create policy public_media_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'public-media' and (select public.is_admin()));

/* ---------------- events and partners ---------------- */

alter table public.events
  add column if not exists description text,
  add column if not exists organizers text[] not null default '{}',
  add column if not exists image_url text;
alter table public.benefit_partners
  add column if not exists logo_url text;

do $$ begin
  alter table public.events add constraint events_image_url_https check (image_url is null or image_url ~ '^https://');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.benefit_partners add constraint benefit_partners_logo_url_https check (logo_url is null or logo_url ~ '^https://');
exception when duplicate_object then null; end $$;

/* ---------------- ads ---------------- */

create table if not exists public.ads (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 2 and 90),
  advertiser text not null check (char_length(trim(advertiser)) between 1 and 120),
  company_id uuid references public.companies(id) on delete set null,
  description text check (description is null or char_length(description) <= 280),
  image_url text check (image_url is null or image_url ~ '^https://'),
  link_url text check (link_url is null or link_url ~ '^https://'),
  cta_label text not null default 'Ətraflı' check (char_length(cta_label) <= 30),
  -- landing_hero: big banner on the home page; landing_strip: sponsor cards on
  -- the home page; dashboard: inside the student / company cabinet
  placement text not null check (placement in ('landing_hero', 'landing_strip', 'dashboard')),
  starts_on date not null default current_date,
  ends_on date not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'ended')),
  priority integer not null default 0,
  price_azn numeric(10, 2) check (price_azn is null or price_azn >= 0),
  paid boolean not null default false,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index if not exists ads_live_idx on public.ads(placement, priority desc) where status = 'active';

create or replace function private.ads_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists ads_touch on public.ads;
create trigger ads_touch before update on public.ads for each row execute function private.ads_touch();

-- Prices, payment state and counters are admin-only; the site reads ads
-- through active_ads(), which returns only the public fields.
alter table public.ads enable row level security;
drop policy if exists ads_admin_all on public.ads;
create policy ads_admin_all on public.ads for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.ads from anon, authenticated;
grant select, insert, update, delete on public.ads to authenticated;

create or replace function public.active_ads(p_placement text default null)
returns table(id uuid, title text, advertiser text, description text, image_url text,
              link_url text, cta_label text, placement text, priority integer)
language sql stable security definer set search_path = '' as $$
  select a.id, a.title, a.advertiser, a.description, a.image_url, a.link_url, a.cta_label, a.placement, a.priority
  from public.ads a
  where a.status = 'active'
    and (now() at time zone 'Asia/Baku')::date between a.starts_on and a.ends_on
    and (p_placement is null or a.placement = p_placement)
  order by a.priority desc, a.created_at desc
  limit 20;
$$;

-- View / click counters for live ads only.
create or replace function public.ad_track(p_id uuid, p_kind text)
returns void language sql security definer set search_path = '' as $$
  update public.ads
  set impressions = impressions + case when p_kind = 'view' then 1 else 0 end,
      clicks = clicks + case when p_kind = 'click' then 1 else 0 end
  where id = p_id and p_kind in ('view', 'click') and status = 'active'
    and (now() at time zone 'Asia/Baku')::date between starts_on and ends_on;
$$;

revoke execute on function private.ads_touch() from public, anon, authenticated;
revoke execute on function public.active_ads(text) from public;
grant execute on function public.active_ads(text) to anon, authenticated;
revoke execute on function public.ad_track(uuid, text) from public;
grant execute on function public.ad_track(uuid, text) to anon, authenticated;
