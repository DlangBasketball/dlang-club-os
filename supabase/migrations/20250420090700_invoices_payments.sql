-- ============================================================================
-- DLang Basketball — Club OS
-- Migration 06b · Invoice & payment module
--
-- Builds on existing audit_logs + audit triggers (invoices/payments) and the
-- existing RLS (finance full; guardians read their family's invoices/payments).
-- Adds: status backfill, append-only payments, payment-application RPCs
-- (manual + Stripe), invoice creation RPC, and an overdue flagger.
-- ============================================================================

-- 1) Migrate legacy statuses to the canonical set --------------------------------
update public.invoices set status = 'sent'      where status = 'pending';
update public.invoices set status = 'cancelled' where status = 'void';

-- 2) Payments are immutable (append-only) ---------------------------------------
-- Refunds are recorded as NEW rows, never by mutating an existing payment.
create or replace function public.payments_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'payments are append-only; record a new payment/refund row instead of % ', tg_op
    using errcode = 'P0001';
end;
$$;

drop trigger if exists trg_payments_immutable on public.payments;
create trigger trg_payments_immutable
  before update or delete on public.payments
  for each row execute function public.payments_block_mutation();

-- 3) Recompute an invoice's status from its succeeded payments ------------------
create or replace function public.recompute_invoice(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
  v_paid  numeric;
  v_cur   public.invoice_status;
begin
  select total_chf, status into v_total, v_cur from public.invoices where id = p_invoice for update;
  if not found then return; end if;

  select coalesce(sum(amount_chf), 0) into v_paid
    from public.payments where invoice_id = p_invoice and status = 'succeeded';

  if v_paid <= 0 then
    -- A refund may have reversed everything previously paid.
    if v_cur in ('paid', 'partially_paid') then
      update public.invoices set status = 'sent', paid_at = null where id = p_invoice;
    end if;
    return;
  elsif v_paid < v_total then
    update public.invoices set status = 'partially_paid', paid_at = null where id = p_invoice;
  else
    update public.invoices set status = 'paid', paid_at = now() where id = p_invoice;
  end if;
end;
$$;

-- 4) Manual payment (bank transfer / TWINT / cash) — finance only ---------------
create or replace function public.record_manual_payment(
  p_invoice   uuid,
  p_amount    numeric,
  p_method    text,
  p_reference text default null,
  p_note      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid;
  v_status public.invoice_status;
  v_pay    uuid;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
  if p_method not in ('bank_transfer','twint','manual','card','qr_bill') then
    raise exception 'INVALID_METHOD' using errcode = 'P0001';
  end if;

  select org_id, status into v_org, v_status from public.invoices where id = p_invoice;
  if not found then raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_status = 'cancelled' then raise exception 'INVOICE_CANCELLED' using errcode = 'P0001'; end if;

  insert into public.payments (org_id, invoice_id, amount_chf, method, status, qr_reference, recorded_by, paid_at, notes)
  values (v_org, p_invoice, p_amount, p_method::public.payment_method, 'succeeded', p_reference, auth.uid(), now(), p_note)
  returning id into v_pay;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, auth.uid(), 'PAYMENT_RECORDED', 'payments', null,
          jsonb_build_object('invoice_id', p_invoice, 'payment_id', v_pay, 'amount_chf', p_amount, 'method', p_method));

  perform public.recompute_invoice(p_invoice);

  select status into v_status from public.invoices where id = p_invoice;
  return jsonb_build_object('payment_id', v_pay, 'invoice_id', p_invoice, 'status', v_status);
end;
$$;

-- 5) Stripe payment application — service role (webhook); idempotent -----------
create or replace function public.apply_stripe_payment(
  p_invoice         uuid,
  p_amount          numeric,
  p_payment_intent  text,
  p_charge          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid;
  v_status public.invoice_status;
  v_pay    uuid;
begin
  -- Idempotency: ignore a payment_intent we've already applied.
  if exists (select 1 from public.payments where stripe_payment_intent_id = p_payment_intent) then
    select status into v_status from public.invoices where id = p_invoice;
    return jsonb_build_object('invoice_id', p_invoice, 'status', v_status, 'duplicate', true);
  end if;

  select org_id, status into v_org, v_status from public.invoices where id = p_invoice;
  if not found then raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0002'; end if;

  insert into public.payments (org_id, invoice_id, amount_chf, method, status,
                               stripe_payment_intent_id, stripe_charge_id, recorded_by, paid_at)
  values (v_org, p_invoice, p_amount, 'card', 'succeeded', p_payment_intent, p_charge, null, now())
  returning id into v_pay;

  update public.invoices set stripe_payment_intent_id = p_payment_intent where id = p_invoice;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, null, 'STRIPE_PAYMENT', 'payments', null,
          jsonb_build_object('invoice_id', p_invoice, 'payment_id', v_pay, 'amount_chf', p_amount, 'payment_intent', p_payment_intent));

  perform public.recompute_invoice(p_invoice);

  select status into v_status from public.invoices where id = p_invoice;
  return jsonb_build_object('payment_id', v_pay, 'invoice_id', p_invoice, 'status', v_status, 'duplicate', false);
end;
$$;

-- 6) Manual invoice creation (finance) — atomic number + items -----------------
create or replace function public.create_manual_invoice(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid;
  v_invoice uuid;
  v_number  text;
  v_item    jsonb;
  v_total   numeric := 0;
  v_amount  numeric;
  v_disc    numeric;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  v_org := public.current_org_id();
  if v_org is null then raise exception 'NO_ORG' using errcode = 'P0001'; end if;

  v_number := public.next_invoice_number(v_org);

  insert into public.invoices (org_id, number, family_id, athlete_id, program_id, description, status, due_date)
  values (
    v_org, v_number,
    (p_payload->>'family_id')::uuid,
    nullif(p_payload->>'athlete_id','')::uuid,
    nullif(p_payload->>'program_id','')::uuid,
    nullif(p_payload->>'description',''),
    'draft',
    nullif(p_payload->>'due_date','')::date
  ) returning id into v_invoice;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb))
  loop
    v_amount := round((coalesce((v_item->>'quantity')::numeric,1)) * (coalesce((v_item->>'unit_price_chf')::numeric,0)), 2);
    insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
    values (v_org, v_invoice, coalesce(v_item->>'description','Item'),
            coalesce((v_item->>'quantity')::numeric,1), coalesce((v_item->>'unit_price_chf')::numeric,0), v_amount);
    v_total := v_total + v_amount;
  end loop;

  v_disc := coalesce((p_payload->>'discount_chf')::numeric, 0);
  if v_disc > 0 then
    insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
    values (v_org, v_invoice, coalesce(p_payload->>'discount_label','Discount'), 1, -v_disc, -v_disc);
    v_total := v_total - v_disc;
  end if;

  update public.invoices set total_chf = v_total where id = v_invoice;
  return jsonb_build_object('invoice_id', v_invoice, 'number', v_number, 'total_chf', v_total);
end;
$$;

-- 7) Flag overdue invoices (idempotent; cron-friendly) -------------------------
create or replace function public.flag_overdue_invoices(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  update public.invoices
     set status = 'overdue'
   where org_id = p_org
     and status in ('sent','partially_paid')
     and due_date is not null
     and due_date < current_date;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 8) Grants --------------------------------------------------------------------
revoke all on function public.record_manual_payment(uuid,numeric,text,text,text) from public;
revoke all on function public.apply_stripe_payment(uuid,numeric,text,text)       from public;
revoke all on function public.create_manual_invoice(jsonb)                       from public;
revoke all on function public.flag_overdue_invoices(uuid)                        from public;
grant execute on function public.record_manual_payment(uuid,numeric,text,text,text) to authenticated, service_role;
grant execute on function public.apply_stripe_payment(uuid,numeric,text,text)       to service_role;
grant execute on function public.create_manual_invoice(jsonb)                       to authenticated, service_role;
grant execute on function public.flag_overdue_invoices(uuid)                        to authenticated, service_role;
grant execute on function public.recompute_invoice(uuid)                            to service_role;

-- 9) Re-emit register_public so registration invoices use 'sent' (not legacy 'pending') --
create or replace function public.register_public(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_program  public.programs%rowtype;
  v_org      uuid;
  v_pct      numeric;
  v_price    numeric;
  v_email    citext;
  v_family   uuid;
  v_invoice  uuid;
  v_invnum   text;
  v_total    numeric := 0;
  v_child    jsonb;
  v_athlete  uuid;
  v_reg      uuid;
  v_idx      int := 0;
  v_disc     numeric;
  v_consent  text;
  v_form     record;
  v_ip       inet;
  v_reg_ids  uuid[] := '{}';
  v_ath_ids  uuid[] := '{}';
  v_children jsonb := coalesce(p_payload->'children', '[]'::jsonb);
  v_due      date := (now() + interval '14 days')::date;
begin
  -- Resolve + guard the program
  select * into v_program from public.programs where id = (p_payload->>'program_id')::uuid;
  if not found then raise exception 'PROGRAM_NOT_FOUND' using errcode = 'P0002'; end if;
  if not (v_program.is_public and v_program.is_active) then
    raise exception 'PROGRAM_NOT_OPEN' using errcode = 'P0001';
  end if;
  v_org   := v_program.org_id;
  v_price := v_program.price_chf;

  if jsonb_array_length(v_children) < 1 then
    raise exception 'NO_CHILDREN' using errcode = 'P0001';
  end if;

  v_email := nullif(p_payload->'parent'->>'email', '');
  if v_email is null then raise exception 'EMAIL_REQUIRED' using errcode = 'P0001'; end if;

  begin v_ip := nullif(p_payload->>'ip', '')::inet; exception when others then v_ip := null; end;

  -- Sibling-discount percentage (org setting; default 10%)
  select coalesce((settings->>'sibling_discount_pct')::numeric, 10)
    into v_pct from public.app_settings where org_id = v_org;
  v_pct := coalesce(v_pct, 10);

  -- Find-or-create the family by contact email (lets a returning parent add a child)
  select id into v_family from public.families
    where org_id = v_org and contact_email = v_email limit 1;
  if v_family is null then
    insert into public.families (org_id, name, address, phone, contact_name, contact_email)
    values (
      v_org,
      coalesce(nullif(p_payload->>'family_name', ''), (p_payload->'parent'->>'name') || ' family'),
      nullif(p_payload->'parent'->>'address', ''),
      nullif(p_payload->'parent'->>'phone', ''),
      nullif(p_payload->'parent'->>'name', ''),
      v_email
    ) returning id into v_family;
  else
    update public.families set
      phone        = coalesce(nullif(p_payload->'parent'->>'phone', ''), phone),
      address      = coalesce(nullif(p_payload->'parent'->>'address', ''), address),
      contact_name = coalesce(nullif(p_payload->'parent'->>'name', ''), contact_name)
    where id = v_family;
  end if;

  -- Invoice header (total filled after line items)
  v_invnum := public.next_invoice_number(v_org);
  insert into public.invoices (org_id, number, family_id, program_id, description, status, due_date)
  values (v_org, v_invnum, v_family, v_program.id, 'Registration — ' || v_program.name, 'sent', v_due)
  returning id into v_invoice;

  -- One athlete + medical + registration + fee line per child
  for v_child in select * from jsonb_array_elements(v_children)
  loop
    insert into public.athletes (org_id, family_id, first_name, last_name, dob, gender, status)
    values (v_org, v_family, v_child->>'first_name', v_child->>'last_name',
            (v_child->>'dob')::date, nullif(v_child->>'gender', ''), 'active')
    returning id into v_athlete;

    insert into public.athlete_medical (org_id, athlete_id, allergies, conditions, notes,
                                        emergency_contact_name, emergency_contact_phone)
    values (v_org, v_athlete, nullif(v_child->>'allergies', ''), nullif(v_child->>'conditions', ''),
            nullif(v_child->>'medical_notes', ''),
            nullif(p_payload->'parent'->>'emergency_name', ''),
            nullif(p_payload->'parent'->>'emergency_phone', ''))
    on conflict (athlete_id) do nothing;

    insert into public.registrations (org_id, athlete_id, program_id, status, notes)
    values (v_org, v_athlete, v_program.id, 'pending', nullif(v_child->>'medical_notes', ''))
    returning id into v_reg;

    insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
    values (v_org, v_invoice,
            v_program.name || ' — ' || (v_child->>'first_name') || ' ' || (v_child->>'last_name'),
            1, v_price, v_price);
    v_total := v_total + v_price;

    if v_idx >= 1 and v_pct > 0 then
      v_disc := round(v_price * v_pct / 100.0, 2);
      insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
      values (v_org, v_invoice, 'Sibling discount (' || v_pct || '%) — ' || (v_child->>'first_name'),
              1, -v_disc, -v_disc);
      v_total := v_total - v_disc;
    end if;

    v_reg_ids := v_reg_ids || v_reg;
    v_ath_ids := v_ath_ids || v_athlete;
    v_idx := v_idx + 1;
  end loop;

  update public.invoices set total_chf = v_total where id = v_invoice;

  -- Consent acceptances: each accepted key × each athlete (immutable audit row)
  if jsonb_typeof(p_payload->'consents') = 'array' then
    for v_consent in select jsonb_array_elements_text(p_payload->'consents')
    loop
      select id, version into v_form
        from public.consent_forms
        where org_id = v_org and key = v_consent and is_active
        order by version desc limit 1;
      if found then
        for v_athlete in select unnest(v_ath_ids)
        loop
          insert into public.consent_acceptances
            (org_id, athlete_id, consent_form_id, accepted_version, status, program_id, ip_address)
          values (v_org, v_athlete, v_form.id, v_form.version, 'accepted', v_program.id, v_ip);
        end loop;
      end if;
    end loop;
  end if;

  -- Pending parent invitation so they can later claim the account & become guardian
  if not exists (
    select 1 from public.invitations
    where org_id = v_org and email = v_email and status = 'pending'
  ) then
    insert into public.invitations (org_id, email, role, family_id, status, expires_at)
    values (v_org, v_email, 'parent', v_family, 'pending', now() + interval '30 days');
  end if;

  return jsonb_build_object(
    'family_id', v_family,
    'invoice_id', v_invoice,
    'invoice_number', v_invnum,
    'total_chf', v_total,
    'child_count', jsonb_array_length(v_children),
    'registration_ids', to_jsonb(v_reg_ids),
    'athlete_ids', to_jsonb(v_ath_ids)
  );
end;
$$;

