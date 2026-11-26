-- ============================================================================
-- Club OS
-- Migration 18 · Regional payments (CH / EU / US)
--
-- Generalises fee collection beyond CHF so every tenant gets the right local
-- payment rails:
--   1. payment_method enum extensions (SEPA Direct Debit, ACH, iDEAL,
--      Bancontact, Apple Pay / Google Pay — the wallets settle via card).
--   2. Currency on invoices + payments, defaulted from the organization.
--   3. Tax fields on invoices (rate, amount, label e.g. MWST/TVA/VAT/sales tax,
--      inclusive/exclusive, reverse-charge) kept consistent by a trigger.
--   4. organizations.payment_settings jsonb (enabled methods, IBAN/QR-IBAN,
--      creditor address, Stripe Connect account, SEPA / ACH toggles, tax
--      defaults) + an admin RPC to edit it. The Stripe account can only be
--      written by the service role (Connect onboarding), never by a client.
--   5. Stripe Connect: platform fee schedules per plan, idempotent webhook
--      event log, connected-account aware apply_stripe_payment, refunds.
--   6. Installment plans + recurring membership fees (data model + RPCs).
--   7. Country-aware structured payment references: Swiss QRR stays exactly as
--      before for CH/LI orgs; other orgs get an ISO 11649 RF creditor ref.
--
-- Invariants preserved:
--   * payments stay append-only (trg_payments_immutable is untouched; refunds
--     are NEW rows with a negative amount and status 'refunded').
--   * existing RLS policies are untouched; new tables get RLS enabled+forced.
--   * qrr_check_digit / gen_qr_reference are untouched.
--
-- Naming note: the legacy *_chf money columns (invoices.total_chf,
-- payments.amount_chf, invoice_items.*_chf) now hold amounts in the row's
-- `currency`. They keep their names to avoid breaking existing code; new
-- columns use currency-neutral names.
--
-- NOTE: enum values added below are not referenced as literals anywhere in this
-- file outside of function bodies (Postgres forbids using a freshly added enum
-- value in the same transaction).
-- ============================================================================

-- 1) payment_method enum extensions --------------------------------------------
alter type public.payment_method add value if not exists 'sepa_debit';
alter type public.payment_method add value if not exists 'ach';
alter type public.payment_method add value if not exists 'ideal';
alter type public.payment_method add value if not exists 'bancontact';
alter type public.payment_method add value if not exists 'apple_pay';
alter type public.payment_method add value if not exists 'google_pay';

-- 2) Currency helpers ------------------------------------------------------------
-- ISO 4217 minor-unit exponent (mirrors src/lib/payments/currency.ts).
create or replace function public.currency_exponent(p_currency text)
returns int
language sql
immutable
as $$
  select case upper(coalesce(p_currency, ''))
    when 'BIF' then 0 when 'CLP' then 0 when 'DJF' then 0 when 'GNF' then 0
    when 'ISK' then 0 when 'JPY' then 0 when 'KMF' then 0 when 'KRW' then 0
    when 'PYG' then 0 when 'RWF' then 0 when 'UGX' then 0 when 'VND' then 0
    when 'VUV' then 0 when 'XAF' then 0 when 'XOF' then 0 when 'XPF' then 0
    when 'BHD' then 3 when 'JOD' then 3 when 'KWD' then 3 when 'OMR' then 3
    when 'TND' then 3
    else 2
  end;
$$;

-- Organization default currency (organizations.currency -> app_settings -> CHF).
create or replace function public.org_currency(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select upper(coalesce(
    (select nullif(o.currency, '') from public.organizations o where o.id = p_org),
    (select nullif(s.currency, '') from public.app_settings s where s.org_id = p_org),
    'CHF'
  ));
$$;

-- 3) Organization payment settings -----------------------------------------------
alter table public.organizations
  add column if not exists payment_settings jsonb not null default '{}'::jsonb;

-- Backfill from the legacy app_settings.settings->'payments' + payment_methods.
update public.organizations o
   set payment_settings = jsonb_strip_nulls(jsonb_build_object(
         'enabled_methods', to_jsonb(coalesce(s.payment_methods, array['card','twint','bank_transfer','manual']::text[])),
         'creditor', jsonb_build_object(
            'name',     coalesce(s.settings->'payments'->>'creditor_name', o.name),
            'street',   s.settings->'payments'->>'creditor_street',
            'building', s.settings->'payments'->>'creditor_building',
            'zip',      s.settings->'payments'->>'creditor_zip',
            'city',     s.settings->'payments'->>'creditor_city',
            'country',  coalesce(s.settings->'payments'->>'creditor_country', o.country)
         ),
         'iban',             s.settings->'payments'->>'iban',
         'qr_iban',          s.settings->'payments'->>'qr_iban',
         'twint_number',     coalesce(s.settings->'payments'->>'twint_number', s.settings->'payments'->>'twint'),
         'reference_type',   s.settings->'payments'->>'reference_type',
         'reference_prefix', s.settings->'payments'->>'reference_prefix',
         'sepa_enabled',     false,
         'us_ach_enabled',   false,
         'epc_qr_enabled',   false,
         'plan_code',        'founding'
       ))
  from public.app_settings s
 where s.org_id = o.id
   and o.payment_settings = '{}'::jsonb;

create unique index if not exists organizations_stripe_account_uidx
  on public.organizations ((payment_settings->'stripe'->>'account_id'))
  where payment_settings->'stripe'->>'account_id' is not null;

-- Known method keys (mirrors PAYMENT_METHOD_KEYS in src/lib/payments/methods.ts).
create or replace function public.is_known_payment_method(p_method text)
returns boolean
language sql
immutable
as $$
  select p_method in ('card','twint','bank_transfer','qr_bill','manual',
                      'sepa_debit','ach','ideal','bancontact','apple_pay','google_pay');
$$;

-- Guard: the Stripe Connect block + platform-controlled keys may only be
-- changed by privileged roles (service role / migration owner). An admin
-- updating organizations directly keeps the old values for those keys.
create or replace function public.organizations_payment_settings_guard()
returns trigger
language plpgsql
as $$
declare
  k text;
begin
  if new.payment_settings is distinct from old.payment_settings
     and current_user not in ('service_role', 'postgres', 'supabase_admin') then
    foreach k in array array['stripe', 'plan_code', 'application_fee_bps'] loop
      if old.payment_settings ? k then
        new.payment_settings := jsonb_set(new.payment_settings, array[k], old.payment_settings->k);
      else
        new.payment_settings := new.payment_settings - k;
      end if;
    end loop;
  end if;
  if jsonb_typeof(new.payment_settings->'enabled_methods') = 'array' and exists (
       select 1 from jsonb_array_elements_text(new.payment_settings->'enabled_methods') m
        where not public.is_known_payment_method(m)) then
    raise exception 'INVALID_METHOD' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_organizations_payment_settings_guard on public.organizations;
create trigger trg_organizations_payment_settings_guard
  before update on public.organizations
  for each row execute function public.organizations_payment_settings_guard();

-- Admin edits (IBAN, creditor, enabled methods, toggles, tax defaults).
-- Platform-controlled keys are stripped. Creditor/IBAN fields are mirrored to
-- the legacy app_settings.settings->'payments' so QR-bill/PDF code keeps working.
create or replace function public.update_payment_settings(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org   uuid;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb) - 'stripe' - 'plan_code' - 'application_fee_bps';
  v_new   jsonb;
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  v_org := public.current_org_id();
  if v_org is null then raise exception 'NO_ORG' using errcode = 'P0001'; end if;

  if v_patch ? 'enabled_methods' then
    if jsonb_typeof(v_patch->'enabled_methods') <> 'array' or exists (
         select 1 from jsonb_array_elements_text(v_patch->'enabled_methods') m
          where not public.is_known_payment_method(m)) then
      raise exception 'INVALID_METHOD' using errcode = 'P0001';
    end if;
  end if;
  if v_patch ? 'tax' and coalesce((v_patch->'tax'->>'rate')::numeric, 0) not between 0 and 100 then
    raise exception 'INVALID_TAX_RATE' using errcode = 'P0001';
  end if;

  update public.organizations
     set payment_settings = payment_settings || v_patch
   where id = v_org
   returning payment_settings into v_new;

  update public.app_settings
     set settings = jsonb_set(settings, '{payments}', coalesce(settings->'payments', '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
           'creditor',          v_new->'creditor'->>'name',      -- key used by the Billing & tax form
           'creditor_name',     v_new->'creditor'->>'name',
           'creditor_street',   v_new->'creditor'->>'street',
           'creditor_building', v_new->'creditor'->>'building',
           'creditor_zip',      v_new->'creditor'->>'zip',
           'creditor_city',     v_new->'creditor'->>'city',
           'creditor_country',  v_new->'creditor'->>'country',
           'iban',              v_new->>'iban',
           'qr_iban',           v_new->>'qr_iban',
           'twint',             v_new->>'twint_number',
           'twint_number',      v_new->>'twint_number'))),
         payment_methods = case when jsonb_typeof(v_new->'enabled_methods') = 'array'
                                then array(select jsonb_array_elements_text(v_new->'enabled_methods'))
                                else payment_methods end
   where org_id = v_org;

  if v_patch ? 'tax' then
    update public.app_settings
       set settings = jsonb_set(settings, '{tax}', coalesce(settings->'tax', '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
             'vat_rate',   (v_new->'tax'->>'rate')::numeric,
             'inclusive',  (v_new->'tax'->>'inclusive')::boolean,
             'vat_number', v_new->'tax'->>'registration_number')))
     where org_id = v_org;
  end if;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, auth.uid(), 'PAYMENT_SETTINGS_UPDATED', 'organizations', v_org, v_patch);

  return v_new - 'stripe';
end;
$$;

-- Payer-facing profile (display-safe). Members of the org, or service role.
create or replace function public.get_org_payment_profile(p_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'org_id',   o.id,
           'name',     o.name,
           'country',  upper(coalesce(o.country, 'CH')),
           'currency', public.org_currency(o.id),
           'settings', o.payment_settings - 'application_fee_bps',
           'stripe_connected', coalesce((o.payment_settings->'stripe'->>'charges_enabled')::boolean, false)
         )
    from public.organizations o
   where o.id = p_org
     and (o.id = public.current_org_id() or current_user in ('service_role','postgres','supabase_admin'));
$$;

-- 4) Stripe Connect --------------------------------------------------------------
-- Platform application fee per SaaS plan (basis points + fixed minor units).
-- Org override: payment_settings.application_fee_bps (service-role only).
create table if not exists public.platform_fee_schedules (
  plan_code                  text primary key,
  application_fee_bps        integer not null default 0 check (application_fee_bps between 0 and 2000),
  application_fee_fixed_minor integer not null default 0 check (application_fee_fixed_minor >= 0),
  description                text,
  updated_at                 timestamptz not null default now()
);
insert into public.platform_fee_schedules (plan_code, application_fee_bps, application_fee_fixed_minor, description) values
  ('founding', 0,   0, 'Founding club — no platform fee on member payments'),
  ('starter',  150, 0, 'Starter plan — 1.5% platform fee'),
  ('club',     100, 0, 'Club plan — 1.0% platform fee'),
  ('pro',      50,  0, 'Pro plan — 0.5% platform fee'),
  ('default',  100, 0, 'Fallback when an org has no plan_code')
on conflict (plan_code) do nothing;

alter table public.platform_fee_schedules enable row level security;
alter table public.platform_fee_schedules force row level security;
drop policy if exists platform_fee_schedules_read on public.platform_fee_schedules;
create policy platform_fee_schedules_read on public.platform_fee_schedules for select using (true);
grant select on public.platform_fee_schedules to authenticated, service_role;
grant insert, update, delete on public.platform_fee_schedules to service_role;

create or replace function public.resolve_application_fee(p_org uuid, p_amount_minor bigint)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ps    jsonb;
  v_bps   integer;
  v_fixed integer := 0;
begin
  select payment_settings into v_ps from public.organizations where id = p_org;
  if v_ps is null or p_amount_minor is null or p_amount_minor <= 0 then return 0; end if;

  select application_fee_bps, application_fee_fixed_minor into v_bps, v_fixed
    from public.platform_fee_schedules
   where plan_code = coalesce(v_ps->>'plan_code', 'default');
  if not found then
    select application_fee_bps, application_fee_fixed_minor into v_bps, v_fixed
      from public.platform_fee_schedules where plan_code = 'default';
  end if;
  if v_ps ? 'application_fee_bps' then v_bps := (v_ps->>'application_fee_bps')::integer; end if;

  return least(p_amount_minor, floor(p_amount_minor * coalesce(v_bps, 0) / 10000.0)::bigint + coalesce(v_fixed, 0));
end;
$$;

-- Service role: persist the connected account after onboarding / account.updated.
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

create or replace function public.org_for_stripe_account(p_account text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.organizations
   where payment_settings->'stripe'->>'account_id' = p_account
   limit 1;
$$;

-- Webhook idempotency log (service role only; no client policies).
create table if not exists public.stripe_events (
  id            text primary key,          -- evt_...
  type          text not null,
  account_id    text,                      -- connected account (event.account)
  livemode      boolean not null default false,
  status        text not null default 'received' check (status in ('received','processed','ignored','failed')),
  error         text,
  attempts      integer not null default 1,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz
);
create index if not exists stripe_events_received_idx on public.stripe_events (received_at desc);
alter table public.stripe_events enable row level security;
alter table public.stripe_events force row level security;
grant select, insert, update on public.stripe_events to service_role;

-- Returns true when the caller should process the event (new, or a previous
-- attempt failed / never finished); false for an already-processed duplicate.
create or replace function public.claim_stripe_event(p_id text, p_type text, p_account text default null, p_livemode boolean default false)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_status text;
begin
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

create or replace function public.finish_stripe_event(p_id text, p_status text, p_error text default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.stripe_events
     set status = p_status, error = p_error, processed_at = now()
   where id = p_id;
$$;

-- 5) Invoices: currency + tax ------------------------------------------------------
alter table public.invoices
  add column if not exists subtotal_amount   numeric(12,2),
  add column if not exists tax_rate          numeric(6,3),
  add column if not exists tax_amount        numeric(12,2),
  add column if not exists tax_label         text,
  add column if not exists tax_inclusive     boolean,
  add column if not exists reverse_charge    boolean,
  add column if not exists tax_exempt_reason text,
  add column if not exists buyer_tax_id      text;

-- Backfill existing rows: no tax, prices were gross.
update public.invoices
   set subtotal_amount = coalesce(subtotal_amount, total_chf),
       tax_rate        = coalesce(tax_rate, 0),
       tax_amount      = coalesce(tax_amount, 0),
       tax_inclusive   = coalesce(tax_inclusive, true),
       reverse_charge  = coalesce(reverse_charge, false)
 where subtotal_amount is null or tax_rate is null or tax_amount is null
    or tax_inclusive is null or reverse_charge is null;

alter table public.invoices alter column currency drop default;
alter table public.invoices alter column tax_rate set not null;
alter table public.invoices alter column tax_amount set not null;
alter table public.invoices alter column tax_inclusive set not null;
alter table public.invoices alter column reverse_charge set not null;

alter table public.invoices drop constraint if exists invoices_currency_iso;
alter table public.invoices add constraint invoices_currency_iso check (currency ~ '^[A-Z]{3}$');
alter table public.invoices drop constraint if exists invoices_tax_rate_range;
alter table public.invoices add constraint invoices_tax_rate_range check (tax_rate >= 0 and tax_rate <= 100);
alter table public.invoices drop constraint if exists invoices_reverse_charge_no_tax;
alter table public.invoices add constraint invoices_reverse_charge_no_tax check (not reverse_charge or tax_amount = 0);

-- Pure tax split (mirrors computeTax in src/lib/payments/tax.ts).
create or replace function public.tax_breakdown(
  p_base numeric, p_rate numeric, p_inclusive boolean, p_reverse_charge boolean default false, p_exponent int default 2)
returns table (net numeric, tax numeric, gross numeric)
language sql
immutable
as $$
  with r as (select case when coalesce(p_reverse_charge, false) then 0 else coalesce(p_rate, 0) end as rate,
                    coalesce(p_base, 0) as base)
  select
    case when p_inclusive then r.base - round(r.base * r.rate / (100 + r.rate), p_exponent) else r.base end,
    case when p_inclusive then round(r.base * r.rate / (100 + r.rate), p_exponent) else round(r.base * r.rate / 100, p_exponent) end,
    case when p_inclusive then r.base else r.base + round(r.base * r.rate / 100, p_exponent) end
  from r;
$$;

-- Keeps currency, tax and totals consistent on every write:
--   * INSERT: currency + tax defaults come from the org's payment_settings.
--   * inclusive: total_chf is the gross; tax is extracted from it.
--   * exclusive: the net (subtotal_amount) is the source of truth. Writers that
--     only touch total_chf (existing RPCs) are treated as writing the net.
create or replace function public.invoices_currency_tax()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ps   jsonb;
  v_app  jsonb;
  v_exp  int;
  v_net  numeric;
  b      record;
begin
  if tg_op = 'INSERT' then
    select payment_settings into v_ps from public.organizations where id = new.org_id;
    select settings->'tax' into v_app from public.app_settings where org_id = new.org_id;
    v_ps := coalesce(v_ps, '{}'::jsonb);
    new.currency       := upper(coalesce(nullif(new.currency, ''), public.org_currency(new.org_id)));
    -- payment_settings.tax wins; else the Billing & tax settings form (app_settings.settings.tax).
    new.tax_rate       := coalesce(new.tax_rate, (v_ps->'tax'->>'rate')::numeric, (v_app->>'vat_rate')::numeric, 0);
    new.tax_inclusive  := coalesce(new.tax_inclusive, (v_ps->'tax'->>'inclusive')::boolean, (v_app->>'inclusive')::boolean, true);
    new.reverse_charge := coalesce(new.reverse_charge, false);
    new.tax_label      := coalesce(new.tax_label, nullif(v_ps->'tax'->>'label', ''));
  else
    if old.status in ('paid', 'partially_paid', 'refunded')
       and (new.tax_rate is distinct from old.tax_rate
         or new.tax_inclusive is distinct from old.tax_inclusive
         or new.reverse_charge is distinct from old.reverse_charge
         or new.currency is distinct from old.currency) then
      raise exception 'TAX_LOCKED: tax/currency cannot change once payments exist' using errcode = 'P0001';
    end if;
    new.currency := upper(new.currency);
  end if;

  v_exp := public.currency_exponent(new.currency);
  new.total_chf := coalesce(new.total_chf, 0);

  if new.tax_inclusive then
    select * into b from public.tax_breakdown(new.total_chf, new.tax_rate, true, new.reverse_charge, v_exp);
  else
    if tg_op = 'UPDATE'
       and new.total_chf is distinct from old.total_chf
       and new.subtotal_amount is not distinct from old.subtotal_amount then
      v_net := new.total_chf;
    else
      v_net := coalesce(new.subtotal_amount, new.total_chf);
    end if;
    select * into b from public.tax_breakdown(v_net, new.tax_rate, false, new.reverse_charge, v_exp);
  end if;

  new.subtotal_amount := b.net;
  new.tax_amount      := b.tax;
  new.total_chf       := b.gross;
  return new;
end;
$$;

drop trigger if exists trg_invoices_currency_tax on public.invoices;
create trigger trg_invoices_currency_tax
  before insert or update on public.invoices
  for each row execute function public.invoices_currency_tax();

-- 6) Payments: currency, Stripe Connect metadata, refunds --------------------------
alter table public.payments
  add column if not exists stripe_account_id      text,
  add column if not exists stripe_refund_id       text,
  add column if not exists application_fee_amount numeric(12,2),
  add column if not exists method_detail          text;   -- e.g. card brand / wallet / bank name

alter table public.payments alter column currency drop default;
create unique index if not exists payments_stripe_pi_uidx
  on public.payments (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null and amount_chf > 0;
create unique index if not exists payments_stripe_refund_uidx
  on public.payments (stripe_refund_id)
  where stripe_refund_id is not null;

-- Payments inherit (and must match) the invoice currency.
create or replace function public.payments_set_currency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_cur text;
begin
  select currency into v_cur from public.invoices where id = new.invoice_id;
  new.currency := upper(coalesce(nullif(new.currency, ''), v_cur, 'CHF'));
  if v_cur is not null and new.currency <> v_cur then
    raise exception 'CURRENCY_MISMATCH: payment % vs invoice %', new.currency, v_cur using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_payments_currency on public.payments;
create trigger trg_payments_currency
  before insert on public.payments
  for each row execute function public.payments_set_currency();

-- Net amount paid on an invoice: succeeded payments minus refund rows.
create or replace function public.invoice_net_paid(p_invoice uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount_chf), 0)
    from public.payments
   where invoice_id = p_invoice
     and (status = 'succeeded' or (status in ('refunded', 'partially_refunded') and amount_chf < 0));
$$;

-- recompute_invoice: same as migration 06b, but refund rows reduce the paid
-- amount, and installment statuses are refreshed afterwards.
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

  v_paid := public.invoice_net_paid(p_invoice);

  if v_paid <= 0 then
    if v_cur in ('paid', 'partially_paid') then
      update public.invoices set status = 'sent', paid_at = null where id = p_invoice;
    end if;
  elsif v_paid < v_total then
    update public.invoices set status = 'partially_paid', paid_at = null where id = p_invoice;
  else
    update public.invoices set status = 'paid', paid_at = coalesce(paid_at, now()) where id = p_invoice;
  end if;

  perform public.refresh_installment_status(p_invoice);
end;
$$;

-- Stripe payment application — service role (webhook); idempotent on the
-- payment_intent. Replaces the 4-arg version; extra params are optional so the
-- old call shape keeps working.
drop function if exists public.apply_stripe_payment(uuid, numeric, text, text);
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

-- Stripe refund — service role; idempotent on the refund id. Appends a
-- negative 'refunded' row (payments stay immutable).
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

-- 7) Country-aware structured references ------------------------------------------
-- ISO 11649 creditor reference "RFxx…" (mirrors scorReference in swiss-payments.ts).
create or replace function public.scor_reference(p_raw text)
returns text
language plpgsql
immutable
as $$
declare
  v_ref text := right(upper(regexp_replace(coalesce(p_raw, ''), '[^0-9A-Za-z]', '', 'g')), 21);
  v_num text := '';
  v_rem int := 0;
  ch    text;
begin
  if v_ref = '' then return null; end if;
  for ch in select regexp_split_to_table(v_ref || 'RF00', '') loop
    if ch ~ '[A-Z]' then v_num := v_num || (ascii(ch) - 55)::text; else v_num := v_num || ch; end if;
  end loop;
  for ch in select regexp_split_to_table(v_num, '') loop
    v_rem := (v_rem * 10 + ch::int) % 97;
  end loop;
  return 'RF' || lpad((98 - v_rem)::text, 2, '0') || v_ref;
end;
$$;

-- CH/LI orgs: unchanged QRR behaviour. Everyone else: RF creditor reference.
create or replace function public.set_invoice_payment_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_country text;
begin
  if new.payment_reference is null then
    select upper(coalesce(country, 'CH')) into v_country from public.organizations where id = new.org_id;
    if coalesce(v_country, 'CH') in ('CH', 'LI') then
      new.payment_reference := public.gen_qr_reference(new.org_id, new.number);
    else
      new.payment_reference := public.scor_reference(new.number);
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.find_invoice_by_reference(p_org uuid, p_reference text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.invoices
   where org_id = p_org
     and coalesce(p_reference, '') ~ '[0-9A-Za-z]'
     and (
       replace(payment_reference, ' ', '') = regexp_replace(coalesce(p_reference, ''), '\D', '', 'g')
       or upper(regexp_replace(payment_reference, '[^0-9A-Za-z]', '', 'g'))
          = upper(regexp_replace(coalesce(p_reference, ''), '[^0-9A-Za-z]', '', 'g'))
     )
   limit 1;
$$;

-- 8) Installment plans + recurring membership fees ---------------------------------
create table if not exists public.payment_plans (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  family_id           uuid not null references public.families(id) on delete restrict,
  invoice_id          uuid references public.invoices(id) on delete restrict,   -- installments: the invoice being split
  program_id          uuid references public.programs(id) on delete set null,
  athlete_id          uuid references public.athletes(id) on delete set null,
  kind                text not null check (kind in ('installments', 'recurring')),
  description         text,
  currency            text not null check (currency ~ '^[A-Z]{3}$'),
  amount_total        numeric(12,2),            -- installments
  amount_per_period   numeric(12,2),            -- recurring
  installment_count   integer check (installment_count between 1 and 60),
  frequency           text not null default 'monthly' check (frequency in ('weekly','monthly','quarterly','termly','yearly')),
  interval_count      integer not null default 1 check (interval_count between 1 and 12),
  start_date          date not null,
  end_date            date,
  next_run_date       date,                     -- recurring: next period to invoice
  due_days            integer not null default 14 check (due_days between 0 and 120),
  status              text not null default 'active' check (status in ('active','paused','completed','cancelled')),
  stripe_subscription_schedule_id text,         -- reserved for card/SEPA/ACH autopay
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check ((kind = 'installments' and invoice_id is not null and amount_total is not null and installment_count is not null)
      or (kind = 'recurring' and amount_per_period is not null and amount_per_period > 0))
);
create index if not exists payment_plans_org_idx on public.payment_plans (org_id, status);
create index if not exists payment_plans_family_idx on public.payment_plans (family_id);
create unique index if not exists payment_plans_one_active_per_invoice
  on public.payment_plans (invoice_id) where kind = 'installments' and status = 'active';
create index if not exists payment_plans_due_idx on public.payment_plans (next_run_date) where kind = 'recurring' and status = 'active';

create table if not exists public.payment_plan_installments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  plan_id      uuid not null references public.payment_plans(id) on delete cascade,
  seq          integer not null check (seq >= 1),
  due_date     date not null,
  amount       numeric(12,2) not null check (amount >= 0),
  currency     text not null,
  invoice_id   uuid references public.invoices(id) on delete set null,
  status       text not null default 'scheduled' check (status in ('scheduled','invoiced','paid','cancelled')),
  reminded_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (plan_id, seq)
);
create index if not exists payment_plan_installments_due_idx on public.payment_plan_installments (org_id, due_date) where status in ('scheduled','invoiced');
create index if not exists payment_plan_installments_invoice_idx on public.payment_plan_installments (invoice_id);

drop trigger if exists trg_payment_plans_updated on public.payment_plans;
create trigger trg_payment_plans_updated before update on public.payment_plans
  for each row execute function public.set_updated_at();
drop trigger if exists trg_payment_plan_installments_updated on public.payment_plan_installments;
create trigger trg_payment_plan_installments_updated before update on public.payment_plan_installments
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_payment_plans on public.payment_plans;
create trigger trg_audit_payment_plans after insert or update or delete on public.payment_plans
  for each row execute function public.audit_trigger();

alter table public.payment_plans             enable row level security;
alter table public.payment_plans             force row level security;
alter table public.payment_plan_installments enable row level security;
alter table public.payment_plan_installments force row level security;

drop policy if exists payment_plans_select on public.payment_plans;
create policy payment_plans_select on public.payment_plans for select
  using ((org_id = public.current_org_id() and public.is_finance()) or public.is_guardian_of_family(family_id));
drop policy if exists payment_plans_finance_write on public.payment_plans;
create policy payment_plans_finance_write on public.payment_plans for all
  using (org_id = public.current_org_id() and public.is_finance())
  with check (org_id = public.current_org_id() and public.is_finance());

drop policy if exists payment_plan_installments_select on public.payment_plan_installments;
create policy payment_plan_installments_select on public.payment_plan_installments for select
  using (exists (
    select 1 from public.payment_plans p
     where p.id = payment_plan_installments.plan_id
       and ((p.org_id = public.current_org_id() and public.is_finance()) or public.is_guardian_of_family(p.family_id))
  ));
drop policy if exists payment_plan_installments_finance_write on public.payment_plan_installments;
create policy payment_plan_installments_finance_write on public.payment_plan_installments for all
  using (org_id = public.current_org_id() and public.is_finance())
  with check (org_id = public.current_org_id() and public.is_finance());

grant select, insert, update on public.payment_plans, public.payment_plan_installments to authenticated, service_role;

-- Period length for a plan frequency.
create or replace function public.plan_interval(p_frequency text, p_interval_count int default 1)
returns interval
language sql
immutable
as $$
  select (case p_frequency
            when 'weekly'    then interval '7 days'
            when 'monthly'   then interval '1 month'
            when 'quarterly' then interval '3 months'
            when 'termly'    then interval '4 months'
            when 'yearly'    then interval '1 year'
          end) * greatest(coalesce(p_interval_count, 1), 1);
$$;

-- Pure schedule generator (mirrors buildInstallmentSchedule in
-- src/lib/payments/schedule.ts). Splits in minor units; the remainder goes one
-- minor unit at a time to the earliest installments, so the sum is exact.
-- Dates are start + k*interval (no drift; month ends clamp, e.g. Jan 31 -> Feb 28).
create or replace function public.installment_schedule(
  p_total          numeric,
  p_count          int,
  p_start          date,
  p_frequency      text default 'monthly',
  p_currency       text default 'CHF',
  p_interval_count int  default 1
)
returns table (seq int, due_date date, amount numeric)
language plpgsql
immutable
as $$
declare
  v_exp   int := public.currency_exponent(p_currency);
  v_scale numeric := power(10, v_exp);
  v_minor bigint;
  v_base  bigint;
  v_rem   bigint;
  k       int;
begin
  if p_count is null or p_count < 1 or p_count > 60 then raise exception 'INVALID_COUNT' using errcode = 'P0001'; end if;
  if p_total is null or p_total < 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
  if public.plan_interval(p_frequency, 1) is null then raise exception 'INVALID_FREQUENCY' using errcode = 'P0001'; end if;

  v_minor := round(p_total * v_scale)::bigint;
  v_base  := v_minor / p_count;
  v_rem   := v_minor - v_base * p_count;
  for k in 0 .. p_count - 1 loop
    seq      := k + 1;
    due_date := (p_start + public.plan_interval(p_frequency, p_interval_count) * k)::date;
    amount   := (v_base + case when k < v_rem then 1 else 0 end) / v_scale;
    return next;
  end loop;
end;
$$;

-- Marks installments paid using the invoice's cumulative net payments.
create or replace function public.refresh_installment_status(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid numeric;
  v_cum  numeric := 0;
  r      record;
begin
  if not exists (select 1 from public.payment_plans where invoice_id = p_invoice and kind = 'installments' and status = 'active')
     and not exists (select 1 from public.payment_plan_installments where invoice_id = p_invoice) then
    return;
  end if;
  v_paid := public.invoice_net_paid(p_invoice);

  -- Installment plan on this invoice: cumulative allocation.
  for r in
    select i.id, i.amount, i.status
      from public.payment_plan_installments i
      join public.payment_plans p on p.id = i.plan_id
     where p.invoice_id = p_invoice and p.kind = 'installments' and i.status <> 'cancelled'
     order by i.seq
  loop
    v_cum := v_cum + r.amount;
    update public.payment_plan_installments
       set status = case when v_paid >= v_cum then 'paid' else 'scheduled' end
     where id = r.id
       and status is distinct from case when v_paid >= v_cum then 'paid' else 'scheduled' end;
  end loop;
  update public.payment_plans p
     set status = 'completed'
   where p.invoice_id = p_invoice and p.kind = 'installments' and p.status = 'active'
     and not exists (select 1 from public.payment_plan_installments i
                      where i.plan_id = p.id and i.status not in ('paid','cancelled'));

  -- Recurring period invoiced as its own invoice.
  update public.payment_plan_installments i
     set status = case when v_paid >= i.amount then 'paid' else 'invoiced' end
   where i.invoice_id = p_invoice
     and exists (select 1 from public.payment_plans p where p.id = i.plan_id and p.kind = 'recurring')
     and i.status <> 'cancelled';
end;
$$;

-- Finance: split an invoice's outstanding balance into installments.
create or replace function public.create_installment_plan(
  p_invoice   uuid,
  p_count     int,
  p_first_due date,
  p_frequency text default 'monthly'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv     public.invoices%rowtype;
  v_balance numeric;
  v_plan    uuid;
  v_last    date;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into v_inv from public.invoices where id = p_invoice for update;
  if not found or v_inv.org_id is distinct from public.current_org_id() then
    raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_inv.status in ('paid', 'cancelled', 'refunded', 'void') then
    raise exception 'INVOICE_NOT_PAYABLE' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.payment_plans where invoice_id = p_invoice and kind = 'installments' and status = 'active') then
    raise exception 'PLAN_EXISTS' using errcode = 'P0001';
  end if;

  v_balance := v_inv.total_chf - public.invoice_net_paid(p_invoice);
  if v_balance <= 0 then raise exception 'NOTHING_OUTSTANDING' using errcode = 'P0001'; end if;

  insert into public.payment_plans (org_id, family_id, invoice_id, program_id, athlete_id, kind, description,
                                    currency, amount_total, installment_count, frequency, start_date, created_by)
  values (v_inv.org_id, v_inv.family_id, p_invoice, v_inv.program_id, v_inv.athlete_id, 'installments',
          'Installments — ' || v_inv.number, v_inv.currency, v_balance, p_count, p_frequency, p_first_due, auth.uid())
  returning id into v_plan;

  insert into public.payment_plan_installments (org_id, plan_id, seq, due_date, amount, currency, invoice_id, status)
  select v_inv.org_id, v_plan, s.seq, s.due_date, s.amount, v_inv.currency, p_invoice, 'scheduled'
    from public.installment_schedule(v_balance, p_count, p_first_due, p_frequency, v_inv.currency) s;

  -- The invoice is only overdue once the final installment is missed; per-
  -- installment reminders use installments_due().
  select max(due_date) into v_last from public.payment_plan_installments where plan_id = v_plan;
  update public.invoices set due_date = v_last where id = p_invoice;

  return jsonb_build_object('plan_id', v_plan, 'invoice_id', p_invoice, 'amount_total', v_balance,
                            'installments', (select jsonb_agg(jsonb_build_object('seq', seq, 'due_date', due_date, 'amount', amount) order by seq)
                                               from public.payment_plan_installments where plan_id = v_plan));
end;
$$;

-- Finance: create a recurring membership fee (monthly / termly / yearly dues).
create or replace function public.create_recurring_plan(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org  uuid;
  v_plan uuid;
  v_fam  uuid := (p_payload->>'family_id')::uuid;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  v_org := public.current_org_id();
  if not exists (select 1 from public.families where id = v_fam and org_id = v_org) then
    raise exception 'FAMILY_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.payment_plans (org_id, family_id, program_id, athlete_id, kind, description, currency,
                                    amount_per_period, frequency, interval_count, start_date, end_date,
                                    next_run_date, due_days, created_by)
  values (v_org, v_fam,
          nullif(p_payload->>'program_id', '')::uuid,
          nullif(p_payload->>'athlete_id', '')::uuid,
          'recurring',
          coalesce(nullif(p_payload->>'description', ''), 'Membership fee'),
          upper(coalesce(nullif(p_payload->>'currency', ''), public.org_currency(v_org))),
          (p_payload->>'amount_per_period')::numeric,
          coalesce(nullif(p_payload->>'frequency', ''), 'monthly'),
          coalesce((p_payload->>'interval_count')::int, 1),
          (p_payload->>'start_date')::date,
          nullif(p_payload->>'end_date', '')::date,
          (p_payload->>'start_date')::date,
          coalesce((p_payload->>'due_days')::int, 14),
          auth.uid())
  returning id into v_plan;
  return jsonb_build_object('plan_id', v_plan);
end;
$$;

-- Issue invoices for every recurring period that has come due (catches up at
-- most 12 periods per plan per run). Idempotent via unique(plan_id, seq).
-- Finance (own org) or service role (cron).
create or replace function public.run_recurring_billing(p_org uuid, p_as_of date default current_date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan    public.payment_plans%rowtype;
  v_count   int := 0;
  v_seq     int;
  v_period  date;
  v_number  text;
  v_invoice uuid;
  v_loops   int;
begin
  if not (current_user in ('service_role','postgres','supabase_admin')
          or (public.is_finance() and public.current_org_id() = p_org)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  for v_plan in
    select * from public.payment_plans
     where org_id = p_org and kind = 'recurring' and status = 'active'
       and next_run_date is not null and next_run_date <= p_as_of
     for update skip locked
  loop
    v_loops := 0;
    v_period := v_plan.next_run_date;
    while v_period <= p_as_of and (v_plan.end_date is null or v_period <= v_plan.end_date) and v_loops < 12 loop
      select coalesce(max(seq), 0) + 1 into v_seq from public.payment_plan_installments where plan_id = v_plan.id;

      v_number := public.next_invoice_number(p_org);
      insert into public.invoices (org_id, number, family_id, athlete_id, program_id, description, status, due_date, currency)
      values (p_org, v_number, v_plan.family_id, v_plan.athlete_id, v_plan.program_id,
              coalesce(v_plan.description, 'Membership fee') || ' — ' || to_char(v_period, 'YYYY-MM-DD'),
              'sent', v_period + v_plan.due_days, v_plan.currency)
      returning id into v_invoice;

      insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
      values (p_org, v_invoice, coalesce(v_plan.description, 'Membership fee'), 1, v_plan.amount_per_period, v_plan.amount_per_period);
      update public.invoices set total_chf = v_plan.amount_per_period where id = v_invoice;

      insert into public.payment_plan_installments (org_id, plan_id, seq, due_date, amount, currency, invoice_id, status)
      values (p_org, v_plan.id, v_seq, v_period + v_plan.due_days,
              (select total_chf from public.invoices where id = v_invoice), v_plan.currency, v_invoice, 'invoiced');

      v_count  := v_count + 1;
      v_loops  := v_loops + 1;
      v_period := (v_period + public.plan_interval(v_plan.frequency, v_plan.interval_count))::date;
    end loop;

    update public.payment_plans
       set next_run_date = v_period,
           status = case when v_plan.end_date is not null and v_period > v_plan.end_date then 'completed' else status end
     where id = v_plan.id;
  end loop;
  return v_count;
end;
$$;

-- Installments that are due/overdue and not covered by payments (reminders).
create or replace function public.installments_due(p_org uuid, p_as_of date default current_date)
returns table (installment_id uuid, plan_id uuid, invoice_id uuid, family_id uuid, seq int, due_date date, amount numeric, currency text)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.plan_id, i.invoice_id, p.family_id, i.seq, i.due_date, i.amount, i.currency
    from public.payment_plan_installments i
    join public.payment_plans p on p.id = i.plan_id
   where i.org_id = p_org
     and (p_org = public.current_org_id() and public.is_finance()
          or current_user in ('service_role','postgres','supabase_admin'))
     and i.status in ('scheduled', 'invoiced')
     and i.due_date <= p_as_of
   order by i.due_date, i.seq;
$$;

-- 9) Grants ------------------------------------------------------------------------
revoke all on function public.update_payment_settings(jsonb)                                         from public;
revoke all on function public.get_org_payment_profile(uuid)                                          from public;
revoke all on function public.resolve_application_fee(uuid, bigint)                                  from public;
revoke all on function public.set_stripe_connect_account(uuid, text, text, boolean, boolean, boolean) from public;
revoke all on function public.org_for_stripe_account(text)                                           from public;
revoke all on function public.claim_stripe_event(text, text, text, boolean)                          from public;
revoke all on function public.finish_stripe_event(text, text, text)                                  from public;
revoke all on function public.apply_stripe_payment(uuid, numeric, text, text, text, text, text, numeric, text) from public;
revoke all on function public.apply_stripe_refund(text, text, numeric, text, text)                   from public;
revoke all on function public.create_installment_plan(uuid, int, date, text)                         from public;
revoke all on function public.create_recurring_plan(jsonb)                                           from public;
revoke all on function public.run_recurring_billing(uuid, date)                                      from public;
revoke all on function public.installments_due(uuid, date)                                           from public;
revoke all on function public.refresh_installment_status(uuid)                                       from public;
revoke all on function public.invoice_net_paid(uuid)                                                 from public;

grant execute on function public.update_payment_settings(jsonb)                                         to authenticated, service_role;
grant execute on function public.get_org_payment_profile(uuid)                                          to authenticated, service_role;
grant execute on function public.resolve_application_fee(uuid, bigint)                                  to service_role;
grant execute on function public.set_stripe_connect_account(uuid, text, text, boolean, boolean, boolean) to service_role;
grant execute on function public.org_for_stripe_account(text)                                           to service_role;
grant execute on function public.claim_stripe_event(text, text, text, boolean)                          to service_role;
grant execute on function public.finish_stripe_event(text, text, text)                                  to service_role;
grant execute on function public.apply_stripe_payment(uuid, numeric, text, text, text, text, text, numeric, text) to service_role;
grant execute on function public.apply_stripe_refund(text, text, numeric, text, text)                   to service_role;
grant execute on function public.create_installment_plan(uuid, int, date, text)                         to authenticated, service_role;
grant execute on function public.create_recurring_plan(jsonb)                                           to authenticated, service_role;
grant execute on function public.run_recurring_billing(uuid, date)                                      to authenticated, service_role;
grant execute on function public.installments_due(uuid, date)                                           to authenticated, service_role;
grant execute on function public.refresh_installment_status(uuid)                                       to service_role;
grant execute on function public.invoice_net_paid(uuid)                                                 to authenticated, service_role;
grant execute on function public.currency_exponent(text)                                                to authenticated, service_role;
grant execute on function public.org_currency(uuid)                                                     to authenticated, service_role;
grant execute on function public.scor_reference(text)                                                   to authenticated, service_role;
grant execute on function public.tax_breakdown(numeric, numeric, boolean, boolean, int)                 to authenticated, service_role;
grant execute on function public.installment_schedule(numeric, int, date, text, text, int)              to authenticated, service_role;
grant execute on function public.plan_interval(text, int)                                               to authenticated, service_role;
grant execute on function public.is_known_payment_method(text)                                          to authenticated, service_role;
