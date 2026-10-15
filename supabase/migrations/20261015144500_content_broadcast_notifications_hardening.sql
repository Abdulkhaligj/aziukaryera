create index if not exists broadcast_notifications_creator_idx
  on public.broadcast_notifications(created_by) where created_by is not null;

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
