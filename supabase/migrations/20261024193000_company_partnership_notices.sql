-- Notifications for the ADNSU Career partnership proposal workflow.
create or replace function public.notify_company_partnership_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_company_name text;
  v_owner uuid;
begin
  select name, owner_id into v_company_name, v_owner
  from public.companies where id = new.company_id;

  if tg_op = 'INSERT' then
    insert into public.notifications(profile_id,kind,title,body,link)
    select p.id, 'partnership', 'Yeni əməkdaşlıq müraciəti',
      left(coalesce(v_company_name,'Şirkət') || ': ' || new.title,500),
      'partnerships-admin'
    from public.profiles p
    where p.role = 'admin' and p.status = 'active';
  elsif new.status is distinct from old.status
      or new.admin_note is distinct from old.admin_note then
    if v_owner is not null then
      insert into public.notifications(profile_id,kind,title,body,link)
      values(
        v_owner, 'partnership', 'Əməkdaşlıq sorğunuz yeniləndi',
        left(new.title || ' · Status: ' || new.status,500),
        'partnerships'
      );
    end if;
  end if;
  return new;
end; $$;

create trigger company_partnership_requests_notify
  after insert or update of status,admin_note
  on public.company_partnership_requests
  for each row execute function public.notify_company_partnership_event();

revoke all on function public.notify_company_partnership_event() from public,anon,authenticated;
