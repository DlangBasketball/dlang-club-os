-- ============================================================================
-- Service instalments: pay an eligible service booking in 1, 2, 3 or 4 payments
--
--   1. Eligibility is data: training_services.max_instalments (1..4, default
--      1 = pay in full only). The server never allows more than 4 whatever the
--      column says. No service ids in this file: the club sets the value per
--      service (services editor, or a data UPDATE).
--   2. The choice is stored with the booking, before any invoice exists:
--        booking_orders.instalment_count (+ instalment_dates: due dates set by
--        admin / finance, optional)       -> staff New Booking (orders)
--        training_bookings.instalment_count -> family requests (parent app;
--        parents never choose dates)
--      Wrappers validate the choice and call the existing RPCs unchanged:
--        booking_order_confirm_plan(payload, request_id)
--        booking_family_request_plan(payload, request_id)
--   3. The plan is the EXISTING instalment model (20250420101000): one invoice
--      per payer (as today) + one payment_plans row (kind 'installments',
--      source 'service') with its payment_plan_installments. The invoice total
--      is the amount owed and is counted once; instalments only split its
--      outstanding balance (amount due - net paid, i.e. after discounts and
--      credits). Payments land on the invoice and refresh_installment_status
--      marks instalments paid oldest first (unchanged).
--   4. When: a deferred constraint trigger on invoices attaches the plan at
--      COMMIT of the transaction that issues the invoice (created as sent, or a
--      draft sent later), when its lines, total and booking links exist. It is
--      a no-op for every other invoice (membership, EYBL, camps, shop ...).
--      Idempotent: one active plan per invoice; a retry / replay finds it.
--   5. Split (authoritative): service_instalment_split = plan_split (minor
--      units, remainder on the LAST instalment) restricted to 1..4.
--      Due dates: first = the invoice due date (issue day + the booking
--      invoice term, or today when later), then +1 month each (same day,
--      clamped to the month end). Staff dates: ascending, from today, within
--      12 months; dates that are already in the past when the invoice is
--      issued fall back to the default rule (audited).
--   6. Group orders: one invoice per payer (unchanged), each gets its own plan
--      on its own total.
--
-- Additive and idempotent. Club Membership and EYBL plan code is untouched
-- (plan_choose_internal, selection_plan_internal, membership_issue,
-- plan_split, plan_due_dates are not redefined here).
-- Contract: docs/service-instalments.md. Tests: tests/db/service_instalments.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.training_services add column if not exists max_instalments smallint not null default 1;
alter table public.booking_orders add column if not exists instalment_count smallint not null default 1;
alter table public.booking_orders add column if not exists instalment_dates date[];
alter table public.booking_orders add column if not exists instalment_dates_by uuid references public.profiles(id) on delete set null;
alter table public.training_bookings add column if not exists instalment_count smallint not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'training_services_max_instalments_chk') then
    alter table public.training_services add constraint training_services_max_instalments_chk
      check (max_instalments between 1 and 4);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'booking_orders_instalments_chk') then
    alter table public.booking_orders add constraint booking_orders_instalments_chk check (
      instalment_count between 1 and 4
      and (instalment_dates is null or cardinality(instalment_dates) = instalment_count));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'training_bookings_instalments_chk') then
    alter table public.training_bookings add constraint training_bookings_instalments_chk
      check (instalment_count between 1 and 4);
  end if;
end $$;

-- Plans of a service booking carry source 'service' (superset of the existing list).
alter table public.payment_plans drop constraint if exists payment_plans_source_chk;
alter table public.payment_plans add constraint payment_plans_source_chk
  check (source is null or source in ('season','camp','training_package','shop','invoice','admin','recurring','service'));

-- ---------------------------------------------------------------------------
-- 2. Pure helpers (mirrored in src/lib/booking/instalments.ts)
-- ---------------------------------------------------------------------------
-- Absolute maximum of payments for a service booking.
create or replace function public.service_instalments_max()
returns smallint language sql immutable set search_path = public as $$ select 4::smallint $$;

-- Equal shares of p_total in minor units; the LAST one absorbs the rounding.
create or replace function public.service_instalment_split(p_total numeric, p_count int, p_currency text)
returns numeric[]
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_count is null or p_count < 1 or p_count > public.service_instalments_max() then
    raise exception 'INSTALMENTS_OUT_OF_RANGE' using errcode = 'P0001';
  end if;
  return public.plan_split(p_total, p_count, p_currency);
end $$;

-- Default due dates: p_first, then the same day each following month (clamped).
create or replace function public.service_instalment_dates(p_first date, p_count int)
returns date[]
language sql
immutable
set search_path = public
as $$
  select array_agg(public.plan_month_day(extract(year from p_first)::int, extract(month from p_first)::int, k,
                                         extract(day from p_first)::int) order by k)
    from generate_series(0, greatest(coalesce(p_count, 1), 1) - 1) k;
$$;

-- Staff-chosen due dates: null when valid, else the error code.
create or replace function public.service_instalment_dates_error(p_dates date[], p_count int, p_today date)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare k int;
begin
  if p_dates is null or cardinality(p_dates) is distinct from p_count then return 'INSTALMENT_DATES_INVALID'; end if;
  for k in 1 .. p_count loop
    if p_dates[k] is null then return 'INSTALMENT_DATES_INVALID'; end if;
    if k > 1 and p_dates[k] <= p_dates[k - 1] then return 'INSTALMENT_DATES_INVALID'; end if;
  end loop;
  if p_dates[1] < p_today then return 'INSTALMENT_DATES_INVALID'; end if;
  if p_dates[p_count] > (p_today + interval '12 months')::date then return 'INSTALMENT_DATES_INVALID'; end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Validation of a choice (internal)
-- ---------------------------------------------------------------------------
-- Count from a payload value (null / absent = 1). Raises on anything else.
create or replace function public.svc_instalments_read(p jsonb)
returns int
language plpgsql
immutable
set search_path = public
as $$
declare v_n numeric;
begin
  if p is null or jsonb_typeof(p) = 'null' then return 1; end if;
  if jsonb_typeof(p) <> 'number' then raise exception 'INSTALMENTS_OUT_OF_RANGE' using errcode = 'P0001'; end if;
  v_n := (p #>> '{}')::numeric;
  if v_n <> trunc(v_n) or v_n < 1 or v_n > public.service_instalments_max() then
    raise exception 'INSTALMENTS_OUT_OF_RANGE' using errcode = 'P0001';
  end if;
  return v_n::int;
end $$;

-- The service allows p_count payments (tenant-checked).
create or replace function public.svc_instalments_check(p_org uuid, p_service uuid, p_count int)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_max int;
begin
  if p_count = 1 then return; end if;
  select least(max_instalments, public.service_instalments_max()) into v_max
    from public.training_services where id = p_service and org_id = p_org;
  if v_max is null then raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_count > v_max then raise exception 'INSTALMENTS_NOT_ALLOWED' using errcode = 'P0001'; end if;
end $$;

-- Staff due dates from a payload value (null = default rule).
create or replace function public.svc_instalment_dates_read(p_org uuid, p jsonb, p_count int)
returns date[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_dates date[];
begin
  if p is null or jsonb_typeof(p) = 'null' or (jsonb_typeof(p) = 'array' and jsonb_array_length(p) = 0) then return null; end if;
  -- Only admin / finance set due dates; parents get the default schedule.
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if jsonb_typeof(p) <> 'array' or p_count < 2 then raise exception 'INSTALMENT_DATES_INVALID' using errcode = 'P0001'; end if;
  begin
    select array_agg((e #>> '{}')::date order by n) into v_dates from jsonb_array_elements(p) with ordinality x(e, n);
  exception when others then
    raise exception 'INSTALMENT_DATES_INVALID' using errcode = 'P0001';
  end;
  if public.service_instalment_dates_error(v_dates, p_count, public.ta_today(p_org)) is not null then
    raise exception 'INSTALMENT_DATES_INVALID' using errcode = 'P0001';
  end if;
  return v_dates;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Creating bookings with a choice (wrappers around the existing RPCs)
-- ---------------------------------------------------------------------------
-- Staff New Booking (orders). payload = booking_order_confirm payload +
--   instalments: 1..4 (default 1), instalment_dates?: ["YYYY-MM-DD", ...]
-- Idempotent with request_id (the order RPC replays; the choice is stored once).
create or replace function public.booking_order_confirm_plan(p_payload jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  x       jsonb := coalesce(p_payload, '{}'::jsonb);
  v_org   uuid := public.current_org_id();
  v_n     int;
  v_dates date[];
  v_res   jsonb;
  o       public.booking_orders;
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  v_n := public.svc_instalments_read(x->'instalments');
  if v_n > 1 then
    perform public.svc_instalments_check(v_org, nullif(x->>'service_id', '')::uuid, v_n);
    if x->>'option' = 'existing_package' then raise exception 'INSTALMENTS_NOTHING_TO_SPLIT' using errcode = 'P0001'; end if;
  end if;
  v_dates := public.svc_instalment_dates_read(v_org, x->'instalment_dates', v_n);

  v_res := public.booking_order_confirm(x - 'instalments' - 'instalment_dates', p_request_id);
  if not coalesce((v_res->>'ok')::boolean, false) or v_res->>'order_id' is null then return v_res; end if;

  select * into o from public.booking_orders where id = (v_res->>'order_id')::uuid and org_id = v_org for update;
  -- First call of this request: store the choice (a replay keeps what was stored).
  if not coalesce((v_res->>'replayed')::boolean, false) and o.request_id = p_request_id and v_n > 1
     and o.instalment_count = 1
     and not exists (select 1 from public.training_bookings b where b.order_id = o.id and b.invoice_id is not null) then
    update public.booking_orders
       set instalment_count = v_n, instalment_dates = v_dates, instalment_dates_by = case when v_dates is not null then auth.uid() end
     where id = o.id
    returning * into o;
    perform public.money_audit(v_org, 'BOOKING_ORDER_INSTALMENTS_CHOSEN', 'booking_orders', o.id, null,
      jsonb_build_object('count', v_n, 'dates', to_jsonb(v_dates)));
  end if;
  return v_res || jsonb_build_object('instalments', o.instalment_count, 'instalment_dates', to_jsonb(o.instalment_dates));
end $$;

-- Parent request (guardian of the child): payload = booking_family_request
-- payload + instalments: 1..4. Due dates cannot be chosen by parents.
create or replace function public.booking_family_request_plan(p_payload jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  x     jsonb := coalesce(p_payload, '{}'::jsonb);
  v_org uuid := public.current_org_id();
  v_n   int;
  v_res jsonb;
  v_bid uuid;
begin
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  if x ? 'instalment_dates' and jsonb_typeof(x->'instalment_dates') <> 'null' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  v_n := public.svc_instalments_read(x->'instalments');
  if v_n > 1 then perform public.svc_instalments_check(v_org, nullif(x->>'service_id', '')::uuid, v_n); end if;

  v_res := public.booking_family_request(x - 'instalments', p_request_id);
  v_bid := nullif(v_res->>'booking_id', '')::uuid;
  if v_n > 1 and v_bid is not null and not coalesce((v_res->>'replayed')::boolean, false) then
    if v_res->>'billing_mode' is distinct from 'invoice' or coalesce((v_res->>'price')::numeric, 0) <= 0 then
      raise exception 'INSTALMENTS_NOTHING_TO_SPLIT' using errcode = 'P0001';
    end if;
    perform set_config('app.bk_internal', 'on', true);
    update public.training_bookings set instalment_count = v_n where id = v_bid and org_id = v_org and invoice_id is null;
    perform set_config('app.bk_internal', '', true);
  end if;
  return v_res || jsonb_build_object('instalments',
    coalesce((select instalment_count from public.training_bookings where id = v_bid), v_n));
end $$;

-- ---------------------------------------------------------------------------
-- 5. Attaching the plan to the payer invoice
-- ---------------------------------------------------------------------------
-- Terms of an invoice from the bookings it bills (one agreed choice, or mixed).
create or replace function public.svc_invoice_terms(p_invoice uuid, out n int, out dates date[], out mixed boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_kinds int; v_first text;
begin
  with src as (
    select o.instalment_count::int as cnt, o.instalment_dates as dts
      from public.training_bookings b join public.booking_orders o on o.id = b.order_id
     where b.invoice_id = p_invoice
    union
    select o.instalment_count::int, o.instalment_dates
      from public.booking_orders o join public.training_package_purchases tp on tp.id = o.purchase_id
     where tp.invoice_id = p_invoice and o.option_kind = 'package'
    union
    select b.instalment_count::int, null::date[]
      from public.training_bookings b
     where b.invoice_id = p_invoice and b.order_id is null
  )
  -- Dates travel as text: array_agg over date[] would build a 2-D array (and refuse nulls).
  select count(*), max(cnt), min(dts::text) into v_kinds, n, v_first from src;
  mixed := v_kinds > 1;
  dates := case when v_kinds = 1 then v_first::date[] end;
  if v_kinds = 0 then n := 1; end if;
end $$;

-- Create (or find) the instalment plan of one issued service invoice.
-- Returns the plan id, or null when the invoice is paid in full.
create or replace function public.svc_plan_attach(p_invoice uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v       public.invoices;
  t       record;
  v_plan  uuid;
  v_bal   numeric;
  v_today date;
  v_dates date[];
  v_amts  numeric[];
  v_kind  text := 'monthly';
  v_note  text;
begin
  select * into v from public.invoices where id = p_invoice for update;
  if not found or v.status::text in ('draft', 'paid', 'cancelled', 'void', 'refunded', 'written_off') then return null; end if;
  select id into v_plan from public.payment_plans
   where invoice_id = p_invoice and kind = 'installments' and status in ('active', 'paused', 'completed')
   order by created_at limit 1;
  if v_plan is not null then return v_plan; end if;

  select * into t from public.svc_invoice_terms(p_invoice);
  if t.n is null or t.n < 2 then return null; end if;
  if t.mixed then
    perform public.money_audit(v.org_id, 'SERVICE_PLAN_SKIPPED', 'invoices', v.id, null,
                               jsonb_build_object('reason', 'MIXED_TERMS'));
    return null;
  end if;
  v_bal := public.invoice_amount_due(p_invoice) - public.invoice_net_paid(p_invoice);
  if v_bal <= 0 then return null; end if;

  v_today := public.ta_today(v.org_id);
  if t.dates is not null and public.service_instalment_dates_error(t.dates, least(t.n, 4), v_today) is null then
    v_dates := t.dates; v_kind := 'custom';
  else
    if t.dates is not null then v_note := 'CUSTOM_DATES_EXPIRED'; end if;
    v_dates := public.service_instalment_dates(greatest(coalesce(v.due_date, v_today), v_today), least(t.n, 4));
  end if;
  v_amts := public.service_instalment_split(v_bal, least(t.n, 4), v.currency);
  v_plan := public.plan_create_internal(v, v_dates, v_amts, 0, 'service', v_kind);
  if v_note is not null then
    perform public.money_audit(v.org_id, 'SERVICE_PLAN_DEFAULT_DATES', 'payment_plans', v_plan, null,
                               jsonb_build_object('reason', v_note, 'requested', to_jsonb(t.dates), 'dates', to_jsonb(v_dates)));
  end if;
  return v_plan;
end $$;

-- Deferred (commit-time) trigger: lines, total and booking links exist by then.
create or replace function public.invoices_service_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_status text; v_err text;
begin
  select status::text into v_status from public.invoices where id = new.id;
  if v_status is null or v_status in ('draft', 'paid', 'cancelled', 'void', 'refunded', 'written_off') then return null; end if;
  if exists (select 1 from public.payment_plans where invoice_id = new.id and kind = 'installments'
              and status in ('active', 'paused', 'completed')) then
    return null;
  end if;
  if not exists (select 1 from public.training_bookings b left join public.booking_orders o on o.id = b.order_id
                  where b.invoice_id = new.id and coalesce(o.instalment_count, b.instalment_count) > 1)
     and not exists (select 1 from public.booking_orders o join public.training_package_purchases tp on tp.id = o.purchase_id
                      where tp.invoice_id = new.id and o.instalment_count > 1) then
    return null;
  end if;
  begin
    perform public.svc_plan_attach(new.id);
  exception when others then
    -- Never block issuing the invoice: the invoice stays payable in full, the failure is audited.
    get stacked diagnostics v_err = message_text;
    begin
      insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
      values (new.org_id, auth.uid(), 'SERVICE_PLAN_ATTACH_FAILED', 'invoices', new.id, jsonb_build_object('error', left(v_err, 200)));
    exception when others then null;
    end;
  end;
  return null;
end $$;

drop trigger if exists trg_invoices_service_plan on public.invoices;
create constraint trigger trg_invoices_service_plan
  after insert or update of status on public.invoices
  deferrable initially deferred
  for each row
  when (new.status::text not in ('draft', 'paid', 'cancelled', 'void', 'refunded', 'written_off'))
  execute function public.invoices_service_plan();

-- ---------------------------------------------------------------------------
-- 6. Reads
-- ---------------------------------------------------------------------------
-- Instalment options of services for the booking forms (staff and families of the club).
create or replace function public.service_instalment_info(p_services uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'services', coalesce((select jsonb_object_agg(s.id::text, least(s.max_instalments, public.service_instalments_max()))
                            from public.training_services s
                           where s.org_id = public.current_org_id() and s.id = any(coalesce(p_services, '{}'::uuid[]))), '{}'::jsonb),
    'invoice_due_days', (public.bk_settings(public.current_org_id())->>'invoice_due_days')::int,
    'today', public.ta_today(public.current_org_id()),
    'max', public.service_instalments_max())
  where public.current_org_id() is not null;
$$;

-- The choice of one booking (staff, or a guardian of the athlete): count, dates, invoice.
create or replace function public.booking_instalment_choice(p_booking uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('booking_id', b.id, 'order_id', b.order_id,
                            'instalments', coalesce(o.instalment_count, b.instalment_count),
                            'instalment_dates', to_jsonb(o.instalment_dates), 'invoice_id', b.invoice_id)
    from public.training_bookings b
    left join public.booking_orders o on o.id = b.order_id
   where b.id = p_booking and b.org_id = public.current_org_id()
     and (public.is_finance() or public.is_guardian_of_athlete(b.athlete_id));
$$;

-- Services editor (admin / finance): payments allowed for one service.
create or replace function public.service_instalments_save(p_service uuid, p_max integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare s public.training_services;
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_max is null or p_max < 1 or p_max > public.service_instalments_max() then
    raise exception 'INSTALMENTS_OUT_OF_RANGE' using errcode = 'P0001';
  end if;
  select * into s from public.training_services where id = p_service and org_id = public.current_org_id() for update;
  if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002'; end if;
  if s.max_instalments is distinct from p_max then
    update public.training_services set max_instalments = p_max where id = s.id;
    perform public.money_audit(s.org_id, 'SERVICE_INSTALMENTS_SET', 'training_services', s.id,
                               jsonb_build_object('max_instalments', s.max_instalments), jsonb_build_object('max_instalments', p_max));
  end if;
  return jsonb_build_object('ok', true, 'service_id', s.id, 'max_instalments', p_max);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Privileges
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.svc_instalments_check(uuid, uuid, integer)', 'public.svc_instalment_dates_read(uuid, jsonb, integer)',
    'public.svc_invoice_terms(uuid)', 'public.svc_plan_attach(uuid)', 'public.invoices_service_plan()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;

  foreach f in array array[
    'public.service_instalments_max()', 'public.service_instalment_split(numeric, integer, text)',
    'public.service_instalment_dates(date, integer)', 'public.service_instalment_dates_error(date[], integer, date)',
    'public.svc_instalments_read(jsonb)',
    'public.booking_order_confirm_plan(jsonb, uuid)', 'public.booking_family_request_plan(jsonb, uuid)',
    'public.service_instalment_info(uuid[])', 'public.booking_instalment_choice(uuid)',
    'public.service_instalments_save(uuid, integer)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
