-- Company plans: a request no longer replaces the working plan, and a paid
-- plan is activated by a paid invoice (bank transfer) for 30 days per month.

alter table public.subscriptions
  add column if not exists requested_plan_id text references public.plans(id),
  add column if not exists reminder_sent_at timestamptz;

alter table public.payments
  add column if not exists plan_id text references public.plans(id),
  add column if not exists months integer not null default 1,
  add column if not exists invoice_number text,
  add column if not exists due_at timestamptz;

do $$ begin
  alter table public.payments add constraint payments_months_check check (months between 1 and 12);
exception when duplicate_object then null; end $$;

create unique index if not exists payments_invoice_number_key on public.payments(invoice_number) where invoice_number is not null;
create index if not exists payments_company_status_idx on public.payments(company_id, status);

create sequence if not exists private.invoice_seq;

/* ---------------- notification helpers ---------------- */

create or replace function private.notify_company(p_company_id uuid, p_kind text, p_title text, p_body text, p_link text default 'subscription')
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications(profile_id, kind, title, body, link)
  select r.pid, p_kind, p_title, coalesce(p_body, ''), p_link
  from (
    select c.owner_id as pid from public.companies c where c.id = p_company_id
    union
    select m.profile_id from public.company_members m
    where m.company_id = p_company_id and m.status = 'active' and m.member_role in ('owner', 'admin')
  ) r
  where r.pid is not null;
$$;

create or replace function private.notify_admins(p_kind text, p_title text, p_body text, p_link text default 'payments')
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications(profile_id, kind, title, body, link)
  select p.id, p_kind, p_title, coalesce(p_body, ''), p_link
  from public.profiles p
  where p.role = 'admin' and p.status = 'active';
$$;

/* ---------------- invoices ---------------- */

-- Returns the pending invoice for this plan/period, or replaces any other
-- pending plan invoice with a new one. Free plans never get an invoice.
create or replace function private.ensure_invoice(p_company_id uuid, p_plan_id text, p_months integer default 1)
returns public.payments language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.plans;
  v_inv public.payments;
  v_sub uuid;
  v_company text;
begin
  select * into v_plan from public.plans where id = p_plan_id;
  if not found or v_plan.monthly_price <= 0 then return null; end if;

  select * into v_inv from public.payments
  where company_id = p_company_id and status = 'pending' and plan_id = p_plan_id and months = p_months
  order by created_at desc limit 1;
  if found then return v_inv; end if;

  update public.payments
  set status = 'cancelled', metadata = metadata || jsonb_build_object('cancelled_reason', 'replaced')
  where company_id = p_company_id and status = 'pending' and plan_id is not null;

  select id into v_sub from public.subscriptions where company_id = p_company_id;
  select name into v_company from public.companies where id = p_company_id;

  insert into public.payments(company_id, subscription_id, provider, amount, currency, status, plan_id, months, invoice_number, due_at, metadata)
  values (
    p_company_id, v_sub, 'bank_transfer', round(v_plan.monthly_price * p_months, 2), v_plan.currency, 'pending',
    p_plan_id, p_months,
    'KM-' || to_char(now() at time zone 'Asia/Baku', 'YYYY') || '-' || lpad(nextval('private.invoice_seq')::text, 5, '0'),
    now() + interval '10 days',
    jsonb_build_object('plan_name', v_plan.name, 'company_name', v_company)
  )
  returning * into v_inv;

  perform private.notify_admins('invoice_created', 'Yeni hesab-faktura: ' || v_inv.invoice_number,
    coalesce(v_company, 'Şirkət') || ' — ' || v_plan.name || ', ' || v_inv.amount || ' ' || v_inv.currency
    || '. Ödəniş daxil olanda fakturanı "ödənildi" kimi qeyd edin.');
  return v_inv;
end $$;

/* ---------------- subscription invariants ---------------- */

create or replace function private.subscriptions_normalize()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- A paid "pending" row (signup with a paid plan, older clients) is a request:
  -- keep the plan that already works and record the request instead.
  if new.status = 'pending' and new.plan_id <> 'free' then
    new.requested_plan_id := new.plan_id;
    new.requested_at := now();
    if tg_op = 'UPDATE' and old.status = 'active' then
      new.plan_id := old.plan_id;
      new.status := old.status;
      new.starts_at := old.starts_at;
      new.ends_at := old.ends_at;
    else
      new.plan_id := 'free';
      new.status := 'active';
      new.starts_at := now();
      new.ends_at := null;
    end if;
  end if;

  -- Every active paid plan has an end date (covers direct edits from the admin panel).
  if new.status = 'active' and new.plan_id <> 'free' and new.ends_at is null then
    if tg_op = 'UPDATE' and old.plan_id is distinct from new.plan_id then
      new.starts_at := now();
    end if;
    new.ends_at := coalesce(new.starts_at, now()) + interval '30 days';
  end if;

  if new.plan_id = 'free' then
    new.ends_at := null;
    new.reminder_sent_at := null;
  end if;

  if new.requested_plan_id = new.plan_id and new.status = 'active'
     and (tg_op = 'INSERT' or old.plan_id is distinct from new.plan_id) then
    new.requested_plan_id := null;
  end if;
  return new;
end $$;

drop trigger if exists subscriptions_normalize on public.subscriptions;
create trigger subscriptions_normalize before insert or update on public.subscriptions
  for each row execute function private.subscriptions_normalize();

create or replace function private.subscriptions_request_invoice()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.requested_plan_id is not null and new.requested_plan_id <> 'free'
     and (tg_op = 'INSERT' or old.requested_plan_id is distinct from new.requested_plan_id) then
    perform private.ensure_invoice(new.company_id, new.requested_plan_id, 1);
  end if;
  return null;
end $$;

drop trigger if exists subscriptions_request_invoice on public.subscriptions;
create trigger subscriptions_request_invoice after insert or update of requested_plan_id on public.subscriptions
  for each row execute function private.subscriptions_request_invoice();

/* ---------------- activation on payment ---------------- */

-- Fires however a payment becomes "paid" (RPC, admin panel, SQL editor).
-- Same plan still active: extend from the current end date. Otherwise the
-- new plan starts now. 30 days per paid month.
create or replace function private.payments_apply()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_sub public.subscriptions;
  v_plan public.plans;
  v_extend boolean;
  v_base timestamptz;
begin
  if new.status <> 'paid' or (tg_op = 'UPDATE' and old.status = 'paid') then return new; end if;
  new.paid_at := coalesce(new.paid_at, now());
  if new.plan_id is null then return new; end if;

  select * into v_plan from public.plans where id = new.plan_id;

  insert into public.subscriptions(company_id, plan_id, status)
  values (new.company_id, 'free', 'active')
  on conflict (company_id) do nothing;

  select * into v_sub from public.subscriptions where company_id = new.company_id for update;
  v_extend := v_sub.plan_id = new.plan_id and v_sub.status = 'active' and v_sub.ends_at > now();
  v_base := case when v_extend then v_sub.ends_at else now() end;

  update public.subscriptions set
    plan_id = new.plan_id,
    status = 'active',
    starts_at = case when v_extend then v_sub.starts_at else now() end,
    ends_at = v_base + make_interval(days => 30 * greatest(new.months, 1)),
    requested_plan_id = case when v_sub.requested_plan_id = new.plan_id then null else v_sub.requested_plan_id end,
    approved_by = coalesce(auth.uid(), v_sub.approved_by),
    reminder_sent_at = null
  where id = v_sub.id
  returning * into v_sub;

  new.subscription_id := v_sub.id;

  perform private.notify_company(new.company_id, 'subscription_active', v_plan.name || ' paketi aktivdir',
    'Ödəniş qəbul edildi. Paket ' || to_char(v_sub.ends_at at time zone 'Asia/Baku', 'DD.MM.YYYY') || ' tarixinədək aktivdir.');
  return new;
end $$;

drop trigger if exists payments_apply on public.payments;
create trigger payments_apply before insert or update of status on public.payments
  for each row execute function private.payments_apply();

/* ---------------- company RPC ---------------- */

create or replace function public.select_company_plan(p_plan_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_sub public.subscriptions;
  v_inv public.payments;
begin
  select c.id into v_company
  from public.companies c
  where c.owner_id = auth.uid()
     or exists (select 1 from public.company_members m
                where m.company_id = c.id and m.profile_id = auth.uid()
                  and m.status = 'active' and m.member_role in ('owner', 'admin'))
  order by (c.owner_id = auth.uid()) desc nulls last
  limit 1;
  if v_company is null then raise exception 'Şirkət hesabı tapılmadı'; end if;
  if not exists (select 1 from public.plans where id = p_plan_id and active) then raise exception 'Paket tapılmadı'; end if;

  insert into public.subscriptions(company_id, plan_id, status)
  values (v_company, 'free', 'active')
  on conflict (company_id) do nothing;

  if p_plan_id = 'free' then
    -- A paid plan stays until its end date; the lifecycle job moves it to Free.
    update public.payments
    set status = 'cancelled', metadata = metadata || jsonb_build_object('cancelled_reason', 'company_selected_free')
    where company_id = v_company and status = 'pending' and plan_id is not null;
    update public.subscriptions set requested_plan_id = null
    where company_id = v_company
    returning * into v_sub;
    return to_jsonb(v_sub) || jsonb_build_object('invoice', null);
  end if;

  update public.subscriptions set requested_plan_id = p_plan_id, requested_at = now()
  where company_id = v_company
  returning * into v_sub;
  v_inv := private.ensure_invoice(v_company, p_plan_id, 1);
  return to_jsonb(v_sub) || jsonb_build_object('invoice', to_jsonb(v_inv));
end $$;

/* ---------------- admin RPCs ---------------- */

create or replace function private.is_billing_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin()
     and coalesce((select auth.jwt() -> 'app_metadata' ->> 'admin_role'), '') in ('super_admin', 'manager');
$$;

create or replace function private.audit(p_title text, p_resource text, p_resource_id uuid, p_action text)
returns void language sql security definer set search_path = '' as $$
  insert into public.admin_audit_logs(title, resource, resource_id, action, actor_id, actor_name)
  values (p_title, p_resource, p_resource_id, p_action, auth.uid(),
          coalesce((select full_name from public.profiles where id = auth.uid()), ''));
$$;

create or replace function public.admin_mark_invoice_paid(p_payment_id uuid, p_bank_reference text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pay public.payments;
  v_sub public.subscriptions;
begin
  if not private.is_billing_admin() then
    raise exception 'Ödənişi yalnız super admin və ya menecer təsdiqləyə bilər' using errcode = 'insufficient_privilege';
  end if;
  update public.payments
  set status = 'paid', paid_at = now(),
      provider_reference = coalesce(nullif(trim(p_bank_reference), ''), provider_reference)
  where id = p_payment_id and status = 'pending'
  returning * into v_pay;
  if not found then raise exception 'Gözləyən hesab-faktura tapılmadı'; end if;
  select * into v_sub from public.subscriptions where company_id = v_pay.company_id;
  perform private.audit('Hesab-faktura ödənildi: ' || coalesce(v_pay.invoice_number, v_pay.id::text), 'payments', v_pay.id, 'payment_paid');
  return jsonb_build_object('payment', to_jsonb(v_pay), 'subscription', to_jsonb(v_sub));
end $$;

create or replace function public.admin_create_invoice(p_company_id uuid, p_plan_id text, p_months integer default 1)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_inv public.payments;
begin
  if not private.is_billing_admin() then
    raise exception 'Hesab-fakturanı yalnız super admin və ya menecer yarada bilər' using errcode = 'insufficient_privilege';
  end if;
  if p_months not between 1 and 12 then raise exception 'Müddət 1–12 ay olmalıdır'; end if;
  insert into public.subscriptions(company_id, plan_id, status) values (p_company_id, 'free', 'active')
  on conflict (company_id) do nothing;
  v_inv := private.ensure_invoice(p_company_id, p_plan_id, p_months);
  if v_inv.id is null then raise exception 'Bu paket üçün hesab-faktura yaradılmır'; end if;
  perform private.audit('Hesab-faktura yaradıldı: ' || v_inv.invoice_number, 'payments', v_inv.id, 'invoice_created');
  return to_jsonb(v_inv);
end $$;

-- Manual activation without a bank transfer (partner, trial, barter).
create or replace function public.admin_activate_subscription(p_company_id uuid, p_plan_id text, p_months integer default 1, p_amount numeric default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.plans;
  v_pay public.payments;
  v_sub public.subscriptions;
begin
  if not private.is_billing_admin() then
    raise exception 'Paketi yalnız super admin və ya menecer aktivləşdirə bilər' using errcode = 'insufficient_privilege';
  end if;
  if p_months not between 1 and 12 then raise exception 'Müddət 1–12 ay olmalıdır'; end if;
  select * into v_plan from public.plans where id = p_plan_id and active;
  if not found or p_plan_id = 'free' then raise exception 'Ödənişli paket seçin'; end if;
  insert into public.payments(company_id, provider, amount, currency, status, plan_id, months, metadata)
  values (p_company_id, 'manual', coalesce(p_amount, round(v_plan.monthly_price * p_months, 2)), v_plan.currency, 'paid',
          p_plan_id, p_months, jsonb_build_object('note', coalesce(p_note, ''), 'plan_name', v_plan.name))
  returning * into v_pay;
  select * into v_sub from public.subscriptions where company_id = p_company_id;
  perform private.audit('Paket əllə aktivləşdirildi: ' || v_plan.name, 'subscriptions', v_sub.id, 'subscription_activated');
  return jsonb_build_object('payment', to_jsonb(v_pay), 'subscription', to_jsonb(v_sub));
end $$;

/* ---------------- grants ---------------- */

revoke execute on function private.notify_company(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function private.notify_admins(text, text, text, text) from public, anon, authenticated;
revoke execute on function private.ensure_invoice(uuid, text, integer) from public, anon, authenticated;
revoke execute on function private.audit(text, text, uuid, text) from public, anon, authenticated;
revoke execute on function private.subscriptions_normalize() from public, anon, authenticated;
revoke execute on function private.subscriptions_request_invoice() from public, anon, authenticated;
revoke execute on function private.payments_apply() from public, anon, authenticated;

revoke execute on function public.admin_mark_invoice_paid(uuid, text) from public, anon;
revoke execute on function public.admin_create_invoice(uuid, text, integer) from public, anon;
revoke execute on function public.admin_activate_subscription(uuid, text, integer, numeric, text) from public, anon;
grant execute on function public.admin_mark_invoice_paid(uuid, text) to authenticated;
grant execute on function public.admin_create_invoice(uuid, text, integer) to authenticated;
grant execute on function public.admin_activate_subscription(uuid, text, integer, numeric, text) to authenticated;

/* ---------------- view + backfill ---------------- */

create or replace view public.company_subscriptions with (security_invoker = true) as
select s.id, s.company_id, s.plan_id, s.status, s.starts_at, s.ends_at, s.requested_at, s.approved_by,
       p.name as plan_name, p.monthly_price, p.currency, s.requested_plan_id
from public.subscriptions s
join public.plans p on p.id = s.plan_id;

-- Companies without a row had no active plan at all (posting was blocked).
insert into public.subscriptions(company_id, plan_id, status)
select c.id, 'free', 'active' from public.companies c
where not exists (select 1 from public.subscriptions s where s.company_id = c.id);
