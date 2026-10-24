-- ADNSU Karyera Mərkəzi — Mentor dəstəyi müraciətləri.
-- Bu cədvəl mövcud profil, AI, CV və autentifikasiya strukturlarını dəyişmir.
create table if not exists public.mentor_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category in ('karyera','cv','müsahibə','texniki','startap','magistr','şəbəkələşmə')),
  topic text not null check (char_length(btrim(topic)) between 5 and 140),
  details text not null check (char_length(btrim(details)) between 15 and 1800),
  format text not null default 'either' check (format in ('online','in_person','either')),
  preferred_time text not null default '' check (char_length(preferred_time) <= 180),
  status text not null default 'pending' check (status in ('pending','in_review','matched','completed','cancelled')),
  mentor_name text not null default '' check (char_length(mentor_name) <= 120),
  admin_note text not null default '' check (char_length(admin_note) <= 1200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mentor_requests_student_created_idx on public.mentor_requests(student_id, created_at desc);
create index if not exists mentor_requests_admin_status_idx on public.mentor_requests(status, created_at desc);
alter table public.mentor_requests enable row level security;
grant select, insert, update on public.mentor_requests to authenticated;
drop policy if exists mentor_requests_student_read on public.mentor_requests;
create policy mentor_requests_student_read on public.mentor_requests
  for select to authenticated using ((select auth.uid()) = student_id);
drop policy if exists mentor_requests_admin_read on public.mentor_requests;
create policy mentor_requests_admin_read on public.mentor_requests
  for select to authenticated using ((select public.is_admin()));
drop policy if exists mentor_requests_student_create on public.mentor_requests;
create policy mentor_requests_student_create on public.mentor_requests
  for insert to authenticated with check (
    (select auth.uid()) = student_id and status = 'pending'
    and mentor_name = '' and admin_note = ''
  );
drop policy if exists mentor_requests_admin_update on public.mentor_requests;
create policy mentor_requests_admin_update on public.mentor_requests
  for update to authenticated using ((select public.is_admin()))
  with check ((select public.is_admin()));
