-- Author names in the network feed. profiles RLS keeps other students' rows
-- (phone, e-mail, GPA, CV) private, so the feed reads this instead: only name,
-- role, faculty and major, and only for people with a visible post or comment.
-- Company accounts are shown under the company name.
create or replace function public.profile_cards(p_ids uuid[])
returns table(id uuid, full_name text, role text, faculty_id text, major_id text)
language sql stable security definer set search_path = '' as $$
  select p.id,
         case when p.role = 'company' then coalesce(
           (select c.name from public.companies c
             where c.owner_id = p.id and c.status = 'active'
             order by c.created_at limit 1),
           p.full_name)
         else p.full_name end,
         p.role::text,
         p.faculty_id,
         p.major_id
  from public.profiles p
  where (select auth.uid()) is not null
    and p.id = any(p_ids[1:500])
    and (p.id = (select auth.uid())
      or exists (select 1 from public.posts po where po.author_id = p.id and po.moderation_status = 'visible')
      or exists (select 1 from public.post_comments pc where pc.author_id = p.id and pc.moderation_status = 'visible'));
$$;

revoke execute on function public.profile_cards(uuid[]) from public, anon;
grant execute on function public.profile_cards(uuid[]) to authenticated;
