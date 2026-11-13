-- ============================================================================
-- Payments review fixes. Additive and idempotent.
--
-- 1) Webhook-only RPCs fail closed in the function body as well. EXECUTE was
--    already revoked from anon/authenticated (20250420095200); each function
--    now also starts with an is_service_caller() guard, so a future grant
--    (e.g. Supabase default privileges re-applied) cannot reopen them.
--    is_service_caller() reads the session role, which SECURITY DEFINER does
--    not change (current_user would always be the owner here).
--    Covered: set_stripe_connect_account, apply_stripe_payment,
--    apply_stripe_refund, claim_stripe_event, finish_stripe_event.
--    recompute_invoice / refresh_installment_status / next_invoice_number are
--    called from user-facing SECURITY DEFINER RPCs (record_manual_payment,
--    book_training_session, ...), so they stay grant-protected only.
--
-- 2) record_manual_payment rounds the amount to the invoice currency's minor
--    unit (the org check was added in 20250420095200).
--
-- 3) apply_stripe_dispute_loss: a lost chargeback is recorded as a negative
--    adjustment row (idempotent on the dispute id), so the invoice and the
--    payment ledger stop showing money Stripe has taken back.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Guards
-- ---------------------------------------------------------------------------
create or replace function public.set_stripe_connect_account(
  p_org               uuid,
  p_account_id        text,
  p_account_type      text default 'standard',
  p_charges_enabled   boolean default false,
  p_payouts_enabled   boolean default false,
  p_details_submitted boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_new jsonb;
begin
  if not public.is_service_caller() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_account_type not in ('standard', 'express') then
    raise exception 'INVALID_ACCOUNT_TYPE' using errcode = 'P0001';
  end if;
  update public.organizations
     set payment_settings = jsonb_set(payment_settings, '{stripe}', jsonb_build_object(
           'account_id', p_account_id,
           'account_type', p_account_type,
           'charges_enabled', p_charges_enabled,
           'payouts_enabled', p_payouts_enabled,
           'details_submitted', p_details_submitted,
           'updated_at', now()))
   where id = p_org
   returning payment_settings->'stripe' into v_new;
  if v_new is null then raise exception 'ORG_NOT_FOUND' using errcode = 'P0002'; end if;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (p_org, null, 'STRIPE_CONNECT_UPDATED', 'organizations', p_org, v_new);
  return v_new;
end;
$$;

create or replace function public.claim_stripe_event(p_id text, p_type text, p_account text default null, p_livemode boolean default false)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_status text;
begin
  if not public.is_service_caller() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  insert into public.stripe_events (id, type, account_id, livemode)
  values (p_id, p_type, p_account, coalesce(p_livemode, false))
  on conflict (id) do nothing;
  if found then return true; end if;

  update public.stripe_events
     set attempts = attempts + 1
   where id = p_id
   returning status into v_status;
  return v_status in ('received', 'failed');
end;
$$;

-- Was LANGUAGE sql; same signature and return type, so replace in place.
create or replace function public.finish_stripe_event(p_id text, p_status text, p_error text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_service_caller() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update public.stripe_events
     set status = p_status, error = p_error, processed_at = now()
   where id = p_id;
end;
$$;

create or replace function public.apply_stripe_payment(
  p_invoice         uuid,
  p_amount          numeric,
  p_payment_intent  text,
  p_charge          text    default null,
  p_method          text    default 'card',
  p_currency        text    default null,
  p_account         text    default null,
  p_fee             numeric default null,
  p_method_detail   text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid;
  v_status  public.invoice_status;
  v_cur     text;
  v_acct    text;
  v_method  text := coalesce(nullif(p_method, ''), 'card');
  v_pay     uuid;
begin
  if not public.is_service_caller() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_payment_intent is null or p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_PAYMENT' using errcode = 'P0001';
  end if;

  -- Idempotency: ignore a payment_intent we've already applied.
  if exists (select 1 from public.payments where stripe_payment_intent_id = p_payment_intent and amount_chf > 0) then
    select status into v_status from public.invoices where id = p_invoice;
    return jsonb_build_object('invoice_id', p_invoice, 'status', v_status, 'duplicate', true);
  end if;

  select i.org_id, i.status, i.currency, o.payment_settings->'stripe'->>'account_id'
    into v_org, v_status, v_cur, v_acct
    from public.invoices i join public.organizations o on o.id = i.org_id
   where i.id = p_invoice;
  if not found then raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0002'; end if;

  -- A connected-account payment must belong to the invoice's club.
  if p_account is not null and v_acct is distinct from p_account then
    raise exception 'ACCOUNT_MISMATCH' using errcode = 'P0001';
  end if;
  if p_currency is not null and upper(p_currency) <> v_cur then
    raise exception 'CURRENCY_MISMATCH' using errcode = 'P0001';
  end if;
  if not public.is_known_payment_method(v_method) or v_method in ('manual', 'bank_transfer', 'qr_bill') then
    v_method := 'card';
  end if;

  insert into public.payments (org_id, invoice_id, amount_chf, currency, method, status,
                               stripe_payment_intent_id, stripe_charge_id, stripe_account_id,
                               application_fee_amount, method_detail, recorded_by, paid_at)
  values (v_org, p_invoice, p_amount, v_cur, v_method::public.payment_method, 'succeeded',
          p_payment_intent, p_charge, p_account, p_fee, p_method_detail, null, now())
  returning id into v_pay;

  update public.invoices set stripe_payment_intent_id = p_payment_intent where id = p_invoice;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, null, 'STRIPE_PAYMENT', 'payments', v_pay,
          jsonb_build_object('invoice_id', p_invoice, 'payment_id', v_pay, 'amount', p_amount, 'currency', v_cur,
                             'method', v_method, 'payment_intent', p_payment_intent, 'account', p_account));

  perform public.recompute_invoice(p_invoice);

  select status into v_status from public.invoices where id = p_invoice;
  return jsonb_build_object('payment_id', v_pay, 'invoice_id', p_invoice, 'status', v_status, 'duplicate', false);
end;
$$;

create or replace function public.apply_stripe_refund(
  p_payment_intent text,
  p_refund_id      text,
  p_amount         numeric,
  p_currency       text default null,
  p_account        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orig public.payments%rowtype;
  v_pay  uuid;
  v_status public.invoice_status;
begin
  if not public.is_service_caller() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_refund_id is null or p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_REFUND' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.payments where stripe_refund_id = p_refund_id) then
    return jsonb_build_object('refund_id', p_refund_id, 'duplicate', true);
  end if;

  select * into v_orig from public.payments
   where stripe_payment_intent_id = p_payment_intent and amount_chf > 0
   limit 1;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_account is not null and v_orig.stripe_account_id is not null and v_orig.stripe_account_id <> p_account then
    raise exception 'ACCOUNT_MISMATCH' using errcode = 'P0001';
  end if;
  if p_currency is not null and upper(p_currency) <> v_orig.currency then
    raise exception 'CURRENCY_MISMATCH' using errcode = 'P0001';
  end if;

  insert into public.payments (org_id, invoice_id, amount_chf, currency, method, status,
                               stripe_payment_intent_id, stripe_charge_id, stripe_account_id,
                               stripe_refund_id, recorded_by, paid_at, notes)
  values (v_orig.org_id, v_orig.invoice_id, -p_amount, v_orig.currency, v_orig.method,
          case when p_amount >= v_orig.amount_chf then 'refunded' else 'partially_refunded' end::public.payment_status,
          p_payment_intent, v_orig.stripe_charge_id, v_orig.stripe_account_id, p_refund_id, null, now(), 'Stripe refund')
  returning id into v_pay;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_orig.org_id, null, 'STRIPE_REFUND', 'payments', v_pay,
          jsonb_build_object('invoice_id', v_orig.invoice_id, 'refund_id', p_refund_id, 'amount', p_amount));

  perform public.recompute_invoice(v_orig.invoice_id);
  select status into v_status from public.invoices where id = v_orig.invoice_id;
  return jsonb_build_object('payment_id', v_pay, 'invoice_id', v_orig.invoice_id, 'status', v_status, 'duplicate', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) record_manual_payment: amount rounded to the invoice currency
-- ---------------------------------------------------------------------------
create or replace function public.record_manual_payment(p_invoice uuid, p_amount numeric, p_method text,
                                                        p_reference text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid;
  v_status public.invoice_status;
  v_cur    text;
  v_amount numeric;
  v_pay    uuid;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
  if p_method not in ('bank_transfer','twint','manual','card','qr_bill') then
    raise exception 'INVALID_METHOD' using errcode = 'P0001';
  end if;

  select org_id, status, currency into v_org, v_status, v_cur
    from public.invoices
   where id = p_invoice and org_id = public.current_org_id();
  if not found or v_org is null then
    raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status = 'cancelled' then raise exception 'INVOICE_CANCELLED' using errcode = 'P0001'; end if;

  v_amount := round(p_amount, public.currency_exponent(v_cur));
  if v_amount <= 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;

  insert into public.payments (org_id, invoice_id, amount_chf, method, status, qr_reference, recorded_by, paid_at, notes)
  values (v_org, p_invoice, v_amount, p_method::public.payment_method, 'succeeded', p_reference, auth.uid(), now(), p_note)
  returning id into v_pay;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, auth.uid(), 'PAYMENT_RECORDED', 'payments', null,
          jsonb_build_object('invoice_id', p_invoice, 'payment_id', v_pay, 'amount_chf', v_amount, 'method', p_method));

  perform public.recompute_invoice(p_invoice);

  select status into v_status from public.invoices where id = p_invoice;
  return jsonb_build_object('payment_id', v_pay, 'invoice_id', p_invoice, 'status', v_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Lost disputes (chargebacks)
-- ---------------------------------------------------------------------------
-- Service role (webhook, charge.dispute.closed with status 'lost'). Appends a
-- negative 'refunded' row keyed on the dispute id (stored in stripe_refund_id,
-- which is unique), so redeliveries are no-ops and invoice_net_paid() /
-- recompute_invoice() treat it like a refund.
create or replace function public.apply_stripe_dispute_loss(
  p_payment_intent text,
  p_dispute_id     text,
  p_amount         numeric,
  p_currency       text default null,
  p_account        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orig   public.payments%rowtype;
  v_pay    uuid;
  v_amount numeric;
  v_status public.invoice_status;
begin
  if not public.is_service_caller() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_dispute_id is null or p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_REFUND' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.payments where stripe_refund_id = p_dispute_id) then
    return jsonb_build_object('dispute_id', p_dispute_id, 'duplicate', true);
  end if;

  select * into v_orig from public.payments
   where stripe_payment_intent_id = p_payment_intent and amount_chf > 0
   limit 1;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_account is not null and v_orig.stripe_account_id is not null and v_orig.stripe_account_id <> p_account then
    raise exception 'ACCOUNT_MISMATCH' using errcode = 'P0001';
  end if;
  if p_currency is not null and upper(p_currency) <> v_orig.currency then
    raise exception 'CURRENCY_MISMATCH' using errcode = 'P0001';
  end if;

  -- Never take back more than was paid on this intent net of earlier refunds.
  select least(p_amount, greatest(0, coalesce(sum(amount_chf), 0))) into v_amount
    from public.payments
   where stripe_payment_intent_id = p_payment_intent
     and (amount_chf > 0 or status in ('refunded', 'partially_refunded'));
  if v_amount <= 0 then
    return jsonb_build_object('dispute_id', p_dispute_id, 'duplicate', false, 'skipped', 'already refunded');
  end if;

  insert into public.payments (org_id, invoice_id, amount_chf, currency, method, status,
                               stripe_payment_intent_id, stripe_charge_id, stripe_account_id,
                               stripe_refund_id, recorded_by, paid_at, notes)
  values (v_orig.org_id, v_orig.invoice_id, -v_amount, v_orig.currency, v_orig.method,
          case when v_amount >= v_orig.amount_chf then 'refunded' else 'partially_refunded' end::public.payment_status,
          p_payment_intent, v_orig.stripe_charge_id, v_orig.stripe_account_id, p_dispute_id, null, now(),
          'Stripe dispute lost')
  returning id into v_pay;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_orig.org_id, null, 'STRIPE_DISPUTE_LOST', 'payments', v_pay,
          jsonb_build_object('invoice_id', v_orig.invoice_id, 'dispute_id', p_dispute_id, 'amount', v_amount));

  perform public.recompute_invoice(v_orig.invoice_id);
  select status into v_status from public.invoices where id = v_orig.invoice_id;
  return jsonb_build_object('payment_id', v_pay, 'invoice_id', v_orig.invoice_id, 'status', v_status, 'duplicate', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: service role only for the webhook functions (re-asserted, since
-- create or replace keeps grants but a fresh function gets default ones).
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.set_stripe_connect_account(uuid, text, text, boolean, boolean, boolean)',
    'public.apply_stripe_payment(uuid, numeric, text, text, text, text, text, numeric, text)',
    'public.apply_stripe_refund(text, text, numeric, text, text)',
    'public.apply_stripe_dispute_loss(text, text, numeric, text, text)',
    'public.claim_stripe_event(text, text, text, boolean)',
    'public.finish_stripe_event(text, text, text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon, authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;
