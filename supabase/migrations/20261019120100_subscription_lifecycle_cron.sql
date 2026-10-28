-- Hourly job: 7 days before the end date send a reminder with a renewal
-- invoice; when the end date passes, move the company to Free.
-- Requires 20261019120000_company_billing_invoices.sql.

create or replace function private.process_subscription_lifecycle()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_inv public.payments;
  v_reminded integer := 0;
  v_expired integer := 0;
begin
  for r in
    select s.id, s.company_id, s.plan_id, s.ends_at, s.requested_plan_id, p.name as plan_name
    from public.subscriptions s
    join public.plans p on p.id = s.plan_id
    where s.status = 'active' and s.plan_id <> 'free' and s.reminder_sent_at is null
      and s.ends_at > now() and s.ends_at <= now() + interval '7 days'
    for update of s skip locked
  loop
    update public.subscriptions
    set reminder_sent_at = now(),
        requested_plan_id = coalesce(requested_plan_id, plan_id),
        requested_at = case when requested_plan_id is null then now() else requested_at end
    where id = r.id;
    v_inv := private.ensure_invoice(r.company_id, coalesce(r.requested_plan_id, r.plan_id), 1);
    perform private.notify_company(r.company_id, 'subscription_expiring',
      r.plan_name || ' paketinin müddəti bitir',
      r.plan_name || ' paketi ' || to_char(r.ends_at at time zone 'Asia/Baku', 'DD.MM.YYYY') || ' tarixində bitir.'
      || coalesce(' Davam etmək üçün ' || v_inv.invoice_number || ' nömrəli hesab-fakturanı ('
                  || v_inv.amount || ' ' || v_inv.currency || ') bank köçürməsi ilə ödəyin.', ''));
    v_reminded := v_reminded + 1;
  end loop;

  for r in
    select s.id, s.company_id, s.plan_id, p.name as plan_name
    from public.subscriptions s
    join public.plans p on p.id = s.plan_id
    where s.status = 'active' and s.plan_id <> 'free' and s.ends_at <= now()
    for update of s skip locked
  loop
    -- Keep the expired plan as the request so its pending invoice still
    -- reactivates the company when paid.
    update public.subscriptions
    set plan_id = 'free', starts_at = now(), ends_at = null, reminder_sent_at = null,
        requested_plan_id = coalesce(requested_plan_id, r.plan_id)
    where id = r.id;
    perform private.notify_company(r.company_id, 'subscription_expired',
      r.plan_name || ' paketinin müddəti bitdi',
      'Hesabınız Free paketə keçdi. ' || r.plan_name || ' imkanlarını bərpa etmək üçün hesab-fakturanı ödəyin.');
    v_expired := v_expired + 1;
  end loop;

  return jsonb_build_object('reminded', v_reminded, 'expired', v_expired, 'ran_at', now());
end $$;

revoke execute on function private.process_subscription_lifecycle() from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;

select cron.schedule('subscription-lifecycle', '7 * * * *', 'select private.process_subscription_lifecycle()');
