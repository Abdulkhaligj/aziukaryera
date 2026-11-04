-- Approved profile photos for the avatar circles in the portal: the viewer's
-- own photo, network authors (as profile_cards already exposes), and the
-- candidates a company may already see through candidate_profiles(). Only
-- the storage path is returned; storage RLS still decides who may sign it.
begin;

create or replace function public.profile_avatar_paths(p_ids uuid[])
returns table(id uuid, avatar_path text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.avatar_path
  from public.profiles p
  where (select auth.uid()) is not null
    and p.id = any(p_ids[1:500])
    and p.status = 'active' and p.avatar_path is not null
    and (p.id = (select auth.uid())
      or public.is_admin()
      or exists (select 1 from public.posts po where po.author_id = p.id and po.moderation_status = 'visible')
      or exists (select 1 from public.post_comments pc where pc.author_id = p.id and pc.moderation_status = 'visible')
      or p.id in (select cp.id from public.candidate_profiles() cp));
$$;
revoke all on function public.profile_avatar_paths(uuid[]) from public, anon;
grant execute on function public.profile_avatar_paths(uuid[]) to authenticated;

commit;
