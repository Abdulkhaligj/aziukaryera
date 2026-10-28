-- Companies created by staff in the admin panel have no owner account
-- (owner_id is null). The workflow trigger still tried to notify that owner,
-- so the insert into notifications failed and took the student's application
-- (and owner-less job/company status changes) down with it. Notifications are
-- now skipped when there is nobody to notify.

create or replace function public.notify_core_workflow()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_owner uuid;
begin
  if tg_table_name='jobs' then
    if new.status::text in ('approved','published') and (old.status is null or old.status is distinct from new.status) then
      select owner_id into v_owner from public.companies where id=new.company_id;
      if v_owner is not null then
        insert into public.notifications(profile_id,kind,title,body,link)
        values(v_owner,'vacancy_approved','Vakansiya təsdiqləndi',new.title,'vacancies');
      end if;
    elsif new.status::text in ('rejected','changes_requested') and old.status is distinct from new.status then
      select owner_id into v_owner from public.companies where id=new.company_id;
      if v_owner is not null then
        insert into public.notifications(profile_id,kind,title,body,link)
        values(v_owner,'vacancy_review','Vakansiyaya admin rəyi var',new.title,'vacancies');
      end if;
    end if;
  elsif tg_table_name='applications' then
    if tg_op='INSERT' then
      select c.owner_id into v_owner from public.jobs j join public.companies c on c.id=j.company_id where j.id=new.job_id;
      if v_owner is not null then
        insert into public.notifications(profile_id,kind,title,body,link)
        values(v_owner,'new_application','Yeni müraciət','Vakansiyanıza yeni müraciət daxil olub.','applications');
      end if;
    elsif new.status is distinct from old.status then
      insert into public.notifications(profile_id,kind,title,body,link)
      values(new.student_id,'application_status','Müraciət statusu dəyişdi',new.status::text,'applications');
    end if;
  elsif tg_table_name='companies' and new.status is distinct from old.status and new.owner_id is not null then
    insert into public.notifications(profile_id,kind,title,body,link)
    values(new.owner_id,'company_status','Şirkət hesabının statusu dəyişdi',new.status::text,'company-profile');
  end if;
  return new;
end;
$function$;
