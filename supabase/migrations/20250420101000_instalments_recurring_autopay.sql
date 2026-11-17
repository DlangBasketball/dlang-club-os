-- ============================================================================
-- Instalment plans, recurring club fees and card autopay.
-- Additive and idempotent. Extends the payment-plan model of
-- 20250420091800_regional_payments.sql (payment_plans / payment_plan_installments,
-- refresh_installment_status, run_recurring_billing) instead of duplicating it.
--
-- 1) payment_plan_settings (one row per club): instalments per product type
--    (season / camp / training_package / shop / invoice), allowed counts,
--    minimum amount, optional fee (fixed or %), first payment at signup,
--    schedule (monthly on a day-of-month or custom dates), camp deadline
--    (last instalment X days before the start), autopay switches, reminder
--    and retry timings.
-- 2) Instalments on one invoice. Each instalment = due date + amount (split in
--    minor units, remainder on the LAST one). Payments always land on the
--    invoice and are allocated to the earliest open instalment; overpayment
--    rolls forward (cumulative allocation in refresh_installment_status).
--    The optional fee is a debit note (invoice_adjustments) so the issued total
--    never changes; cancelling the plan voids it and restores the due date.
--    QR-bill: ONE structured reference per invoice, one QR-bill per instalment
--    carrying that instalment's amount (the SIX IG allows a reference on
--    several payments; reconciliation keys on the reference and allocation is
--    by amount, so paying slips out of order is still correct).
-- 3) Recurring fees: recurring_fee_templates + enrolments (payment_plans of
--    kind 'recurring' with template_id), pauses (holiday / injury), skip a
--    period, proration on join (none / daily / half-month), shared discounts
--    (sibling + manual) and an idempotent per-period generator
--    (unique (plan_id, period_start)).
-- 4) Autopay: autopay_mandates (Stripe customer + payment method ids on the
--    club's connected account, brand / last4 / expiry for display, consent
--    wording + version + timestamp + who) and autopay_charges (one row per
--    off-session attempt, idempotency key per instalment + attempt, retry
--    schedule, fallback to QR-bill). No card number ever reaches the database.
--
-- Every table: org_id, RLS enabled + forced, a policy per verb, audit trigger
-- (mandates use a redacted audit trigger: no card details in audit_logs).
-- Every RPC: SECURITY DEFINER, search_path pinned, caller + target org checked,
-- EXECUTE revoked from anon (service-only RPCs from authenticated too).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Settings
-- ---------------------------------------------------------------------------
create table if not exists public.payment_plan_settings (
  org_id                    uuid primary key references public.organizations(id) on delete cascade,
  enabled                   boolean not null default false,
  product_types             text[]  not null default '{}',
  allowed_counts            integer[] not null default '{2,3,4}',
  min_amount                numeric(12,2) not null default 0,
  fee_kind                  text not null default 'none',
  fee_value                 numeric(12,4) not null default 0,
  first_at_signup           boolean not null default false,
  schedule_kind             text not null default 'monthly',
  day_of_month              integer not null default 1,
  custom_dates              date[] not null default '{}',
  camp_last_days_before     integer,
  autopay_enabled           boolean not null default false,
  retry_days                integer[] not null default '{3,7}',
  remind_before_days        integer not null default 3,
  overdue_repeat_days       integer not null default 7,
  mandate_version           text not null default '1',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
do $$ begin
  alter table public.payment_plan_settings add constraint payment_plan_settings_chk check (
        product_types <@ array['season','camp','training_package','shop','invoice']::text[]
    and cardinality(allowed_counts) between 1 and 12
    and allowed_counts <@ array[2,3,4,5,6,7,8,9,10,11,12,18,24]::integer[]
    and min_amount >= 0 and min_amount <= 1000000
    and fee_kind in ('none','fixed','percent')
    and fee_value >= 0 and (fee_kind <> 'percent' or fee_value <= 20) and (fee_kind <> 'fixed' or fee_value <= 10000)
    and schedule_kind in ('monthly','custom')
    and day_of_month between 1 and 31
    and cardinality(custom_dates) <= 24
    and (camp_last_days_before is null or camp_last_days_before between 0 and 365)
    and cardinality(retry_days) <= 5
    and retry_days <@ array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30]::integer[]
    and remind_before_days between 0 and 30
    and overdue_repeat_days between 1 and 60
    and length(mandate_version) between 1 and 20);
exception when duplicate_object then null; end $$;

drop trigger if exists trg_payment_plan_settings_updated on public.payment_plan_settings;
create trigger trg_payment_plan_settings_updated before update on public.payment_plan_settings
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_payment_plan_settings on public.payment_plan_settings;
create trigger trg_audit_payment_plan_settings after insert or update or delete on public.payment_plan_settings
  for each row execute function public.audit_trigger();

alter table public.payment_plan_settings enable row level security;
alter table public.payment_plan_settings force row level security;
-- Members of the club read the rules (no personal data: shown at checkout).
drop policy if exists payment_plan_settings_select on public.payment_plan_settings;
create policy payment_plan_settings_select on public.payment_plan_settings for select
  using (org_id = public.current_org_id());
drop policy if exists payment_plan_settings_insert on public.payment_plan_settings;
create policy payment_plan_settings_insert on public.payment_plan_settings for insert
  with check (public.is_finance_of(org_id));
drop policy if exists payment_plan_settings_update on public.payment_plan_settings;
create policy payment_plan_settings_update on public.payment_plan_settings for update
  using (public.is_finance_of(org_id)) with check (public.is_finance_of(org_id));
drop policy if exists payment_plan_settings_delete on public.payment_plan_settings;
create policy payment_plan_settings_delete on public.payment_plan_settings for delete using (false);
grant select, insert, update on public.payment_plan_settings to authenticated, service_role;

-- Settings of one org with defaults when the club never saved any.
create or replace function public.plan_settings(p_org uuid)
returns public.payment_plan_settings
language plpgsql
stable
security definer
set search_path = public
as $$
declare s public.payment_plan_settings;
begin
  select * into s from public.payment_plan_settings where org_id = p_org;
  if not found then
    s.org_id := p_org; s.enabled := false; s.product_types := '{}'; s.allowed_counts := '{2,3,4}';
    s.min_amount := 0; s.fee_kind := 'none'; s.fee_value := 0; s.first_at_signup := false;
    s.schedule_kind := 'monthly'; s.day_of_month := 1; s.custom_dates := '{}'; s.camp_last_days_before := null;
    s.autopay_enabled := false; s.retry_days := '{3,7}'; s.remind_before_days := 3; s.overdue_repeat_days := 7;
    s.mandate_version := '1';
  end if;
  return s;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Recurring fee templates (before payment_plans.template_id)
-- ---------------------------------------------------------------------------
create table if not exists public.recurring_fee_templates (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  name             text not null,
  description      text,
  amount           numeric(12,2) not null,
  currency         text not null,
  frequency        text not null default 'monthly',
  billing_day      integer not null default 1,
  start_date       date not null,
  end_date         date,
  program_id       uuid references public.programs(id) on delete set null,
  team_id          uuid references public.teams(id) on delete set null,
  proration        text not null default 'none',
  due_days         integer not null default 14,
  apply_discounts  boolean not null default true,
  is_active        boolean not null default true,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists recurring_fee_templates_org_idx on public.recurring_fee_templates (org_id, is_active);
do $$ begin
  alter table public.recurring_fee_templates add constraint recurring_fee_templates_chk check (
        length(btrim(name)) between 1 and 120
    and coalesce(length(description), 0) <= 1000
    and amount > 0 and amount <= 1000000
    and currency ~ '^[A-Z]{3}$'
    and frequency in ('monthly','quarterly','yearly')
    and billing_day between 1 and 31
    and (end_date is null or end_date >= start_date)
    and proration in ('none','daily','half_month')
    and due_days between 0 and 120);
exception when duplicate_object then null; end $$;

-- Template's team / programme must be in the same club.
create or replace function public.recurring_template_same_org()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.program_id is not null and not exists (select 1 from public.programs where id = new.program_id and org_id = new.org_id) then
    raise exception 'PROGRAM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if new.team_id is not null and not exists (select 1 from public.teams where id = new.team_id and org_id = new.org_id) then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_recurring_template_same_org on public.recurring_fee_templates;
create trigger trg_recurring_template_same_org before insert or update on public.recurring_fee_templates
  for each row execute function public.recurring_template_same_org();
drop trigger if exists trg_recurring_fee_templates_updated on public.recurring_fee_templates;
create trigger trg_recurring_fee_templates_updated before update on public.recurring_fee_templates
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_recurring_fee_templates on public.recurring_fee_templates;
create trigger trg_audit_recurring_fee_templates after insert or update or delete on public.recurring_fee_templates
  for each row execute function public.audit_trigger();

alter table public.recurring_fee_templates enable row level security;
alter table public.recurring_fee_templates force row level security;
drop policy if exists recurring_fee_templates_select on public.recurring_fee_templates;
create policy recurring_fee_templates_select on public.recurring_fee_templates for select
  using (public.is_finance_of(org_id));
drop policy if exists recurring_fee_templates_insert on public.recurring_fee_templates;
create policy recurring_fee_templates_insert on public.recurring_fee_templates for insert
  with check (public.is_finance_of(org_id));
drop policy if exists recurring_fee_templates_update on public.recurring_fee_templates;
create policy recurring_fee_templates_update on public.recurring_fee_templates for update
  using (public.is_finance_of(org_id)) with check (public.is_finance_of(org_id));
-- Deleting is allowed only while no enrolment references it (FK restrict below).
drop policy if exists recurring_fee_templates_delete on public.recurring_fee_templates;
create policy recurring_fee_templates_delete on public.recurring_fee_templates for delete
  using (public.is_finance_of(org_id));
grant select, insert, update, delete on public.recurring_fee_templates to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) payment_plans / payment_plan_installments: new columns
-- ---------------------------------------------------------------------------
alter table public.payment_plans
  add column if not exists source              text,
  add column if not exists fee_amount          numeric(12,2) not null default 0,
  add column if not exists fee_adjustment_id   uuid references public.invoice_adjustments(id) on delete set null,
  add column if not exists original_due_date   date,
  add column if not exists autopay             boolean not null default true,
  add column if not exists template_id         uuid references public.recurring_fee_templates(id) on delete restrict,
  add column if not exists team_id             uuid references public.teams(id) on delete set null,
  add column if not exists manual_discount_ids uuid[] not null default '{}',
  add column if not exists paused_at           timestamptz,
  add column if not exists pause_reason        text,
  add column if not exists cancelled_at        timestamptz,
  add column if not exists cancel_reason       text;
do $$ begin
  alter table public.payment_plans add constraint payment_plans_source_chk
    check (source is null or source in ('season','camp','training_package','shop','invoice','admin','recurring'));
exception when duplicate_object then null; end $$;
create index if not exists payment_plans_template_idx on public.payment_plans (template_id) where template_id is not null;
create unique index if not exists payment_plans_one_enrolment
  on public.payment_plans (template_id, athlete_id) where kind = 'recurring' and template_id is not null and status in ('active','paused');

alter table public.payment_plan_installments
  add column if not exists amount_paid          numeric(12,2) not null default 0,
  add column if not exists paid_at              timestamptz,
  add column if not exists period_start         date,
  add column if not exists period_end           date,
  add column if not exists skipped_reason       text,
  add column if not exists reminded_before_at   timestamptz,
  add column if not exists overdue_reminded_at  timestamptz,
  add column if not exists autopay_status       text,
  add column if not exists autopay_attempts     integer not null default 0,
  add column if not exists autopay_round_start  integer not null default 0,
  add column if not exists autopay_first_on     date,
  add column if not exists autopay_next_on      date;
alter table public.payment_plan_installments drop constraint if exists payment_plan_installments_status_check;
alter table public.payment_plan_installments add constraint payment_plan_installments_status_check
  check (status in ('scheduled','invoiced','paid','cancelled','skipped'));
do $$ begin
  alter table public.payment_plan_installments add constraint payment_plan_installments_autopay_chk
    check (autopay_status is null or autopay_status in ('processing','succeeded','requires_action','failed','fallback'));
exception when duplicate_object then null; end $$;
create unique index if not exists payment_plan_installments_period_uidx
  on public.payment_plan_installments (plan_id, period_start) where period_start is not null;

-- Per-verb policies (replace the earlier FOR ALL write policies: plans and
-- instalments are never deleted; cancellation is a status).
drop policy if exists payment_plans_finance_write on public.payment_plans;
drop policy if exists payment_plans_insert on public.payment_plans;
create policy payment_plans_insert on public.payment_plans for insert
  with check (public.is_finance_of(org_id));
drop policy if exists payment_plans_update on public.payment_plans;
create policy payment_plans_update on public.payment_plans for update
  using (public.is_finance_of(org_id)) with check (public.is_finance_of(org_id));
drop policy if exists payment_plans_delete on public.payment_plans;
create policy payment_plans_delete on public.payment_plans for delete using (false);

drop policy if exists payment_plan_installments_finance_write on public.payment_plan_installments;
drop policy if exists payment_plan_installments_insert on public.payment_plan_installments;
create policy payment_plan_installments_insert on public.payment_plan_installments for insert
  with check (public.is_finance_of(org_id));
drop policy if exists payment_plan_installments_update on public.payment_plan_installments;
create policy payment_plan_installments_update on public.payment_plan_installments for update
  using (public.is_finance_of(org_id)) with check (public.is_finance_of(org_id));
drop policy if exists payment_plan_installments_delete on public.payment_plan_installments;
create policy payment_plan_installments_delete on public.payment_plan_installments for delete using (false);

-- The instalment's org must be its plan's org (defence in depth for finance writes).
create or replace function public.payment_plan_installments_same_org()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from public.payment_plans p where p.id = new.plan_id and p.org_id = new.org_id) then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_payment_plan_installments_same_org on public.payment_plan_installments;
create trigger trg_payment_plan_installments_same_org before insert or update of plan_id, org_id on public.payment_plan_installments
  for each row execute function public.payment_plan_installments_same_org();

-- ---------------------------------------------------------------------------
-- 4) Pauses of recurring enrolments (holiday / injury)
-- ---------------------------------------------------------------------------
create table if not exists public.recurring_plan_pauses (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  plan_id     uuid not null references public.payment_plans(id) on delete cascade,
  starts_on   date not null,
  ends_on     date not null,
  kind        text not null default 'other',
  note        text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists recurring_plan_pauses_org_idx on public.recurring_plan_pauses (org_id);
create index if not exists recurring_plan_pauses_plan_idx on public.recurring_plan_pauses (plan_id, starts_on);
do $$ begin
  alter table public.recurring_plan_pauses add constraint recurring_plan_pauses_chk
    check (ends_on >= starts_on and kind in ('holiday','injury','other') and coalesce(length(note), 0) <= 300);
exception when duplicate_object then null; end $$;
drop trigger if exists trg_recurring_plan_pauses_updated on public.recurring_plan_pauses;
create trigger trg_recurring_plan_pauses_updated before update on public.recurring_plan_pauses
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_recurring_plan_pauses on public.recurring_plan_pauses;
create trigger trg_audit_recurring_plan_pauses after insert or update or delete on public.recurring_plan_pauses
  for each row execute function public.audit_trigger();

alter table public.recurring_plan_pauses enable row level security;
alter table public.recurring_plan_pauses force row level security;
drop policy if exists recurring_plan_pauses_select on public.recurring_plan_pauses;
create policy recurring_plan_pauses_select on public.recurring_plan_pauses for select
  using (public.is_finance_of(org_id) or exists (
    select 1 from public.payment_plans p where p.id = recurring_plan_pauses.plan_id and public.is_guardian_of_family(p.family_id)));
drop policy if exists recurring_plan_pauses_insert on public.recurring_plan_pauses;
create policy recurring_plan_pauses_insert on public.recurring_plan_pauses for insert
  with check (public.is_finance_of(org_id)
              and exists (select 1 from public.payment_plans p where p.id = recurring_plan_pauses.plan_id and p.org_id = recurring_plan_pauses.org_id));
drop policy if exists recurring_plan_pauses_update on public.recurring_plan_pauses;
create policy recurring_plan_pauses_update on public.recurring_plan_pauses for update
  using (public.is_finance_of(org_id)) with check (public.is_finance_of(org_id));
drop policy if exists recurring_plan_pauses_delete on public.recurring_plan_pauses;
create policy recurring_plan_pauses_delete on public.recurring_plan_pauses for delete
  using (public.is_finance_of(org_id));
grant select, insert, update, delete on public.recurring_plan_pauses to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) Autopay mandates (saved card on the club's connected account)
-- ---------------------------------------------------------------------------
create table if not exists public.autopay_mandates (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references public.organizations(id) on delete cascade,
  family_id                 uuid not null references public.families(id) on delete cascade,
  status                    text not null default 'pending',
  enabled                   boolean not null default true,
  stripe_account_id         text,
  stripe_customer_id        text,
  stripe_payment_method_id  text,
  setup_session_id          text,
  card_brand                text,
  card_last4                text,
  card_exp_month            integer,
  card_exp_year             integer,
  consent_version           text not null,
  consent_text              text not null,
  consented_at              timestamptz not null default now(),
  consented_by              uuid references public.profiles(id) on delete set null,
  activated_at              timestamptz,
  revoked_at                timestamptz,
  revoked_by                uuid references public.profiles(id) on delete set null,
  expiry_notified_at        timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index if not exists autopay_mandates_org_idx on public.autopay_mandates (org_id, status);
create index if not exists autopay_mandates_family_idx on public.autopay_mandates (family_id);
create index if not exists autopay_mandates_pm_idx on public.autopay_mandates (stripe_payment_method_id) where stripe_payment_method_id is not null;
create unique index if not exists autopay_mandates_one_active on public.autopay_mandates (family_id) where status = 'active';
do $$ begin
  alter table public.autopay_mandates add constraint autopay_mandates_chk check (
        status in ('pending','active','replaced','revoked','detached')
    and (card_last4 is null or card_last4 ~ '^[0-9]{4}$')
    and (card_exp_month is null or card_exp_month between 1 and 12)
    and (card_exp_year is null or card_exp_year between 2000 and 2100)
    and (card_brand is null or length(card_brand) <= 30)
    and (stripe_customer_id is null or stripe_customer_id ~ '^cus_[A-Za-z0-9]+$')
    and (stripe_payment_method_id is null or stripe_payment_method_id ~ '^(pm|card|src)_[A-Za-z0-9]+$')
    and length(consent_text) between 20 and 4000
    and length(consent_version) between 1 and 20);
exception when duplicate_object then null; end $$;

drop trigger if exists trg_autopay_mandates_updated on public.autopay_mandates;
create trigger trg_autopay_mandates_updated before update on public.autopay_mandates
  for each row execute function public.set_updated_at();

-- Redacted audit: lifecycle only, never card brand / last4 / expiry / Stripe ids.
create or replace function public.autopay_mandate_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_keep constant text[] := array['id','org_id','family_id','status','enabled','consent_version','consented_at',
                                  'consented_by','activated_at','revoked_at','revoked_by'];
  v_old jsonb; v_new jsonb;
begin
  if tg_op in ('UPDATE','DELETE') then
    select jsonb_object_agg(k, v) into v_old from jsonb_each(to_jsonb(old)) e(k, v) where k = any(v_keep);
  end if;
  if tg_op in ('UPDATE','INSERT') then
    select jsonb_object_agg(k, v) into v_new from jsonb_each(to_jsonb(new)) e(k, v) where k = any(v_keep);
  end if;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (coalesce(new.org_id, old.org_id), auth.uid(), tg_op, 'autopay_mandates', coalesce(new.id, old.id), v_old, v_new);
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_audit_autopay_mandates on public.autopay_mandates;
create trigger trg_audit_autopay_mandates after insert or update or delete on public.autopay_mandates
  for each row execute function public.autopay_mandate_audit();

alter table public.autopay_mandates enable row level security;
alter table public.autopay_mandates force row level security;
drop policy if exists autopay_mandates_select on public.autopay_mandates;
create policy autopay_mandates_select on public.autopay_mandates for select
  using (public.is_finance_of(org_id) or (org_id = public.current_org_id() and public.is_guardian_of_family(family_id)));
-- All writes go through the RPCs below (consent + Stripe state machine).
drop policy if exists autopay_mandates_insert on public.autopay_mandates;
create policy autopay_mandates_insert on public.autopay_mandates for insert with check (false);
drop policy if exists autopay_mandates_update on public.autopay_mandates;
create policy autopay_mandates_update on public.autopay_mandates for update using (false) with check (false);
drop policy if exists autopay_mandates_delete on public.autopay_mandates;
create policy autopay_mandates_delete on public.autopay_mandates for delete using (false);
grant select on public.autopay_mandates to authenticated;
grant select, insert, update on public.autopay_mandates to service_role;

-- ---------------------------------------------------------------------------
-- 6) Autopay charge attempts (one row per off-session PaymentIntent)
-- ---------------------------------------------------------------------------
create table if not exists public.autopay_charges (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  family_id          uuid not null references public.families(id) on delete cascade,
  mandate_id         uuid not null references public.autopay_mandates(id) on delete restrict,
  installment_id     uuid not null references public.payment_plan_installments(id) on delete restrict,
  invoice_id         uuid not null references public.invoices(id) on delete restrict,
  amount             numeric(12,2) not null check (amount > 0),
  currency           text not null check (currency ~ '^[A-Z]{3}$'),
  attempt            integer not null check (attempt between 1 and 100),
  idempotency_key    text not null,
  payment_intent_id  text,
  status             text not null default 'processing',
  failure_code       text,
  decline_code       text,
  next_retry_on      date,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (installment_id, attempt),
  unique (idempotency_key)
);
create index if not exists autopay_charges_org_idx on public.autopay_charges (org_id, status, created_at desc);
create index if not exists autopay_charges_pi_idx on public.autopay_charges (payment_intent_id) where payment_intent_id is not null;
do $$ begin
  alter table public.autopay_charges add constraint autopay_charges_status_chk
    check (status in ('processing','succeeded','requires_action','failed'));
exception when duplicate_object then null; end $$;
drop trigger if exists trg_autopay_charges_updated on public.autopay_charges;
create trigger trg_autopay_charges_updated before update on public.autopay_charges
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_autopay_charges on public.autopay_charges;
create trigger trg_audit_autopay_charges after insert or update or delete on public.autopay_charges
  for each row execute function public.audit_trigger();

alter table public.autopay_charges enable row level security;
alter table public.autopay_charges force row level security;
drop policy if exists autopay_charges_select on public.autopay_charges;
create policy autopay_charges_select on public.autopay_charges for select
  using (public.is_finance_of(org_id) or (org_id = public.current_org_id() and public.is_guardian_of_family(family_id)));
drop policy if exists autopay_charges_insert on public.autopay_charges;
create policy autopay_charges_insert on public.autopay_charges for insert with check (false);
drop policy if exists autopay_charges_update on public.autopay_charges;
create policy autopay_charges_update on public.autopay_charges for update using (false) with check (false);
drop policy if exists autopay_charges_delete on public.autopay_charges;
create policy autopay_charges_delete on public.autopay_charges for delete using (false);
grant select on public.autopay_charges to authenticated;
grant select, insert, update on public.autopay_charges to service_role;

-- ---------------------------------------------------------------------------
-- 7) Pure helpers (mirrored in src/lib/payments/plans.ts)
-- ---------------------------------------------------------------------------
-- Day D of the month that is p_months after (y, m), clamped to the month end.
create or replace function public.plan_month_day(p_year int, p_month int, p_add int, p_day int)
returns date
language sql
immutable
set search_path = public
as $$
  with b as (select make_date(p_year, p_month, 1) + make_interval(months => p_add) as first)
  select (b.first + make_interval(days => least(p_day, extract(day from (b.first + interval '1 month - 1 day'))::int) - 1))::date
    from b;
$$;

-- Due dates for a new plan (null = schedule cannot produce p_count dates).
--   monthly: day D each month; first date = the first day D on/after today
--            (strictly after today when the first payment is taken at signup,
--            which then is "today").
--   custom : the club's custom dates on/after today (after today when the
--            first payment is at signup), ascending.
create or replace function public.plan_due_dates(
  p_today date, p_count int, p_first_at_signup boolean, p_kind text, p_day int, p_custom date[])
returns date[]
language plpgsql
immutable
set search_path = public
as $$
declare
  v_out   date[] := '{}';
  v_rest  int;
  v_first date;
  v_add   int := 0;
  k       int;
begin
  if p_count is null or p_count < 1 or p_count > 60 or p_today is null then return null; end if;
  if p_first_at_signup then v_out := array[p_today]; end if;
  v_rest := p_count - coalesce(cardinality(v_out), 0);
  if v_rest = 0 then return v_out; end if;

  if p_kind = 'custom' then
    select coalesce(array_agg(d order by d), '{}') into v_out
      from (select distinct d from unnest(coalesce(p_custom, '{}')) d
             where d > p_today or (d = p_today and not p_first_at_signup)) x
      where true;
    if cardinality(v_out) < v_rest then return null; end if;
    v_out := v_out[1:v_rest];
    if p_first_at_signup then v_out := array[p_today] || v_out; end if;
    return v_out;
  end if;

  -- monthly
  v_first := public.plan_month_day(extract(year from p_today)::int, extract(month from p_today)::int, 0, coalesce(p_day, 1));
  if v_first < p_today or (p_first_at_signup and v_first = p_today) then v_add := 1; end if;
  for k in 0 .. v_rest - 1 loop
    v_out := v_out || public.plan_month_day(extract(year from p_today)::int, extract(month from p_today)::int, v_add + k, coalesce(p_day, 1));
  end loop;
  return v_out;
end;
$$;

-- Split p_total into p_count amounts in minor units; the remainder goes on the LAST one.
create or replace function public.plan_split(p_total numeric, p_count int, p_currency text)
returns numeric[]
language plpgsql
immutable
set search_path = public
as $$
declare
  v_scale numeric := power(10, public.currency_exponent(p_currency));
  v_minor bigint;
  v_base  bigint;
  v_out   numeric[] := '{}';
  k       int;
begin
  if p_count is null or p_count < 1 or p_count > 60 then raise exception 'INVALID_COUNT' using errcode = 'P0001'; end if;
  if p_total is null or p_total < 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
  v_minor := round(p_total * v_scale)::bigint;
  v_base := v_minor / p_count;
  for k in 1 .. p_count loop
    v_out := v_out || ((case when k = p_count then v_minor - v_base * (p_count - 1) else v_base end) / v_scale);
  end loop;
  return v_out;
end;
$$;

-- Instalment fee on an amount, rounded to the currency minor unit.
create or replace function public.plan_fee(p_kind text, p_value numeric, p_amount numeric, p_currency text)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case p_kind
           when 'fixed'   then round(greatest(coalesce(p_value, 0), 0), public.currency_exponent(p_currency))
           when 'percent' then round(greatest(coalesce(p_amount, 0), 0) * least(greatest(coalesce(p_value, 0), 0), 20) / 100,
                                     public.currency_exponent(p_currency))
           else 0
         end;
$$;

-- Recurring period that contains p_date for a template anchored at p_start
-- (periods start on billing day D every 1 / 3 / 12 months from p_start's month).
create or replace function public.recurring_period_bounds(
  p_start date, p_day int, p_frequency text, p_date date,
  out period_start date, out period_end date)
language plpgsql
immutable
set search_path = public
as $$
declare
  v_m   int := case p_frequency when 'quarterly' then 3 when 'yearly' then 12 else 1 end;
  v_y0  int := extract(year from p_start)::int;
  v_mo  int := extract(month from p_start)::int;
  v_k   int;
  v_s   date;
begin
  v_k := floor(((extract(year from p_date)::int * 12 + extract(month from p_date)::int) - (v_y0 * 12 + v_mo))::numeric / v_m)::int;
  if v_k < 0 then v_k := 0; end if;
  loop
    v_s := public.plan_month_day(v_y0, v_mo, v_k * v_m, p_day);
    exit when v_s <= p_date or v_k = 0;
    v_k := v_k - 1;
  end loop;
  period_start := v_s;
  period_end := public.plan_month_day(v_y0, v_mo, (v_k + 1) * v_m, p_day) - 1;
end;
$$;

-- Amount for a first period joined on p_join (none / daily / half_month:
-- full fee when more than half of the period is left, else half).
create or replace function public.recurring_prorate(
  p_amount numeric, p_period_start date, p_period_end date, p_join date, p_rule text, p_currency text)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  v_days int := p_period_end - p_period_start + 1;
  v_left int;
  v_exp  int := public.currency_exponent(p_currency);
begin
  if p_join is null or p_join <= p_period_start or p_rule = 'none' or v_days <= 0 then return p_amount; end if;
  if p_join > p_period_end then return 0; end if;
  v_left := p_period_end - p_join + 1;
  if p_rule = 'daily' then
    return round(p_amount * v_left / v_days, v_exp);
  elsif p_rule = 'half_month' then
    return case when v_left * 2 > v_days then p_amount else round(p_amount / 2, v_exp) end;
  end if;
  return p_amount;
end;
$$;

-- What an invoice is for (decides which instalment rules apply).
create or replace function public.invoice_product_type(p_invoice uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v public.invoices;
begin
  select * into v from public.invoices where id = p_invoice;
  if not found then return null; end if;
  if to_regclass('public.shop_orders') is not null
     and exists (select 1 from public.shop_orders where invoice_id = p_invoice) then return 'shop'; end if;
  if to_regclass('public.training_package_purchases') is not null
     and exists (select 1 from public.training_package_purchases where invoice_id = p_invoice) then return 'training_package'; end if;
  if exists (select 1 from public.registrations where invoice_id = p_invoice and camp_edition_id is not null) then return 'camp'; end if;
  if exists (select 1 from public.payment_plan_installments i join public.payment_plans p on p.id = i.plan_id
              where i.invoice_id = p_invoice and p.kind = 'recurring') then return 'recurring'; end if;
  if v.program_id is not null then
    return case when (select kind::text from public.programs where id = v.program_id) = 'camp' then 'camp' else 'season' end;
  end if;
  return 'other';
end;
$$;

-- Start of the activity an invoice pays for (camps: the edition start).
create or replace function public.invoice_activity_start(p_invoice uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select min(e.starts_on)
    from public.registrations r join public.camp_editions e on e.id = r.camp_edition_id
   where r.invoice_id = p_invoice;
$$;

-- Outstanding amount of one instalment / period row.
create or replace function public.installment_outstanding(p_installment uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare r record; v_due numeric;
begin
  select i.*, p.kind into r from public.payment_plan_installments i join public.payment_plans p on p.id = i.plan_id
   where i.id = p_installment;
  if not found or r.status in ('paid','cancelled','skipped') then return 0; end if;
  if r.kind = 'recurring' then
    if r.invoice_id is null then return 0; end if;
    v_due := public.invoice_amount_due(r.invoice_id) - public.invoice_net_paid(r.invoice_id);
    return greatest(v_due, 0);
  end if;
  return greatest(r.amount - r.amount_paid, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) Allocation: payments -> earliest open instalment, overpayment rolls forward
-- ---------------------------------------------------------------------------
create or replace function public.refresh_installment_status(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid   numeric;
  v_due    numeric;
  v_left   numeric;
  v_alloc  numeric;
  v_status text;
  pl       record;
  r        record;
begin
  if not exists (select 1 from public.payment_plan_installments where invoice_id = p_invoice) then
    return;
  end if;
  v_paid := greatest(public.invoice_net_paid(p_invoice), 0);
  v_due  := public.invoice_amount_due(p_invoice);

  -- Instalment plans on this invoice: cumulative allocation by sequence.
  for pl in
    select * from public.payment_plans
     where invoice_id = p_invoice and kind = 'installments' and status in ('active','paused','completed')
  loop
    v_left := v_paid;
    for r in
      select * from public.payment_plan_installments
       where plan_id = pl.id and status not in ('cancelled','skipped')
       order by seq
    loop
      v_alloc := least(v_left, r.amount);
      v_left := v_left - v_alloc;
      v_status := case when v_alloc >= r.amount or (v_due > 0 and v_paid >= v_due) then 'paid' else 'scheduled' end;
      if v_status = 'paid' then v_alloc := r.amount; end if;
      if r.status is distinct from v_status or r.amount_paid is distinct from v_alloc then
        update public.payment_plan_installments
           set status = v_status,
               amount_paid = v_alloc,
               paid_at = case when v_status = 'paid' then coalesce(paid_at, now()) else null end,
               autopay_status = case when v_status = 'paid' and autopay_status in ('failed','requires_action') then null else autopay_status end,
               autopay_next_on = case when v_status = 'paid' then null else autopay_next_on end
         where id = r.id;
      end if;
    end loop;

    if pl.status in ('active','paused') and not exists (
         select 1 from public.payment_plan_installments where plan_id = pl.id and status not in ('paid','cancelled','skipped')) then
      update public.payment_plans set status = 'completed' where id = pl.id;
    elsif pl.status = 'completed' and exists (
         select 1 from public.payment_plan_installments where plan_id = pl.id and status = 'scheduled') then
      -- a refund re-opened an instalment
      update public.payment_plans set status = 'active' where id = pl.id;
    end if;
  end loop;

  -- Recurring periods invoiced as their own invoice.
  update public.payment_plan_installments i
     set status = case when v_due >= 0 and v_paid >= v_due then 'paid' else 'invoiced' end,
         amount_paid = least(v_paid, greatest(v_due, 0)),
         paid_at = case when v_due >= 0 and v_paid >= v_due then coalesce(i.paid_at, now()) else null end
   where i.invoice_id = p_invoice
     and i.status not in ('cancelled','skipped')
     and exists (select 1 from public.payment_plans pp where pp.id = i.plan_id and pp.kind = 'recurring');
end;
$$;

-- ---------------------------------------------------------------------------
-- 9) Creating instalment plans
-- ---------------------------------------------------------------------------
-- Internal: create the plan rows for an invoice (locked by the caller).
create or replace function public.plan_create_internal(
  v public.invoices, p_dates date[], p_amounts numeric[], p_fee numeric, p_source text,
  p_schedule_kind text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan  uuid;
  v_adj   uuid;
  v_n     int := cardinality(p_dates);
  v_total numeric := 0;
  k       int;
begin
  if v_n is null or v_n < 2 or v_n > 60 or cardinality(p_amounts) is distinct from v_n then
    raise exception 'INVALID_COUNT' using errcode = 'P0001';
  end if;
  for k in 1 .. v_n loop
    if p_dates[k] is null or p_amounts[k] is null or p_amounts[k] < 0 then raise exception 'INVALID_SCHEDULE' using errcode = 'P0001'; end if;
    if k > 1 and p_dates[k] < p_dates[k - 1] then raise exception 'INVALID_SCHEDULE' using errcode = 'P0001'; end if;
    v_total := v_total + p_amounts[k];
  end loop;

  if coalesce(p_fee, 0) > 0 then
    -- No description: screens and PDFs label it from the document kind (translated).
    v_adj := public.money_add_adjustment(v, 'debit_note', p_fee, 'Instalment fee', null);
    perform public.recompute_invoice(v.id);
  end if;

  insert into public.payment_plans (org_id, family_id, invoice_id, program_id, athlete_id, kind, description,
                                    currency, amount_total, installment_count, frequency, start_date, created_by,
                                    source, fee_amount, fee_adjustment_id, original_due_date)
  values (v.org_id, v.family_id, v.id, v.program_id, v.athlete_id, 'installments', v.number,
          v.currency, v_total, v_n, 'monthly', p_dates[1], auth.uid(),
          coalesce(p_source, 'admin'), coalesce(p_fee, 0), v_adj, v.due_date)
  returning id into v_plan;

  insert into public.payment_plan_installments (org_id, plan_id, seq, due_date, amount, currency, invoice_id, status)
  select v.org_id, v_plan, g.n, p_dates[g.n], p_amounts[g.n], v.currency, v.id, 'scheduled'
    from generate_series(1, v_n) as g(n);

  -- The invoice is only overdue once the final instalment is missed.
  update public.invoices set due_date = p_dates[v_n] where id = v.id;
  perform public.refresh_installment_status(v.id);
  perform public.refresh_invoice_overdue(v.id);

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v.org_id, auth.uid(), 'PAYMENT_PLAN_CREATED', 'payment_plans', v_plan,
          jsonb_build_object('invoice_id', v.id, 'source', coalesce(p_source, 'admin'), 'count', v_n,
                             'total', v_total, 'fee', coalesce(p_fee, 0), 'schedule_kind', p_schedule_kind,
                             'dates', to_jsonb(p_dates), 'amounts', to_jsonb(p_amounts)));
  return v_plan;
end;
$$;

-- Internal: the club's rules applied to one invoice (count chosen by the payer).
create or replace function public.plan_choose_internal(p_invoice uuid, p_org uuid, p_count int, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v        public.invoices;
  s        public.payment_plan_settings;
  v_bal    numeric;
  v_fee    numeric;
  v_type   text;
  v_start  date;
  v_dates  date[];
  v_amts   numeric[];
  v_plan   uuid;
begin
  select * into v from public.invoices where id = p_invoice and org_id = p_org for update;
  if not found then raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.status::text = 'draft' then raise exception 'INVOICE_IS_DRAFT' using errcode = 'P0001'; end if;
  if v.status::text in ('paid','cancelled','void','refunded','written_off') then raise exception 'INVOICE_NOT_PAYABLE' using errcode = 'P0001'; end if;
  if exists (select 1 from public.payment_plans where invoice_id = p_invoice and kind = 'installments' and status in ('active','paused')) then
    raise exception 'PLAN_EXISTS' using errcode = 'P0001';
  end if;

  s := public.plan_settings(p_org);
  if not s.enabled then raise exception 'PLANS_DISABLED' using errcode = 'P0001'; end if;
  v_type := public.invoice_product_type(p_invoice);
  if not (v_type = any(s.product_types) or 'invoice' = any(s.product_types)) then
    raise exception 'PRODUCT_NOT_ELIGIBLE' using errcode = 'P0001';
  end if;
  if p_count is null or not (p_count = any(s.allowed_counts)) then raise exception 'COUNT_NOT_ALLOWED' using errcode = 'P0001'; end if;

  v_bal := public.invoice_amount_due(p_invoice) - public.invoice_net_paid(p_invoice);
  if v_bal <= 0 then raise exception 'NOTHING_OUTSTANDING' using errcode = 'P0001'; end if;
  if v_bal < s.min_amount then raise exception 'BELOW_MINIMUM' using errcode = 'P0001'; end if;

  v_dates := public.plan_due_dates(current_date, p_count, s.first_at_signup, s.schedule_kind, s.day_of_month, s.custom_dates);
  if v_dates is null then raise exception 'SCHEDULE_UNAVAILABLE' using errcode = 'P0001'; end if;
  if v_type = 'camp' and s.camp_last_days_before is not null then
    v_start := public.invoice_activity_start(p_invoice);
    if v_start is not null and v_dates[p_count] > v_start - s.camp_last_days_before then
      raise exception 'LAST_AFTER_DEADLINE' using errcode = 'P0001';
    end if;
  end if;

  v_fee := public.plan_fee(s.fee_kind, s.fee_value, v_bal, v.currency);
  v_amts := public.plan_split(v_bal + v_fee, p_count, v.currency);
  v_plan := public.plan_create_internal(v, v_dates, v_amts, v_fee,
    coalesce(p_source, case when v_type in ('season','camp','training_package','shop','recurring') then v_type else 'invoice' end),
    s.schedule_kind);
  return jsonb_build_object('plan_id', v_plan, 'invoice_id', p_invoice, 'fee', v_fee,
                            'dates', to_jsonb(v_dates), 'amounts', to_jsonb(v_amts));
end;
$$;

-- Parent (guardian of the invoice's family) or finance: pay this invoice in N instalments.
create or replace function public.plan_choose(p_invoice uuid, p_count int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid; v_fam uuid;
begin
  select org_id, family_id into v_org, v_fam from public.invoices where id = p_invoice;
  if v_org is null or v_org is distinct from public.current_org_id()
     or not (public.is_finance_of(v_org) or public.is_guardian_of_family(v_fam)) then
    raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0002';
  end if;
  return public.plan_choose_internal(p_invoice, v_org, p_count, null);
end;
$$;

-- Service role (public checkout flows): the org was resolved server-side from the slug.
create or replace function public.plan_attach_checkout(p_org uuid, p_invoice uuid, p_count int, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_source is not null and p_source not in ('season','camp','training_package','shop','invoice') then
    raise exception 'INVALID_SOURCE' using errcode = 'P0001';
  end if;
  return public.plan_choose_internal(p_invoice, p_org, p_count, p_source);
end;
$$;

-- Finance: any schedule on an open invoice (amounts must add up to balance + fee).
create or replace function public.plan_admin_create(p_invoice uuid, p_dates date[], p_amounts numeric[], p_fee numeric default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v      public.invoices;
  v_bal  numeric;
  v_sum  numeric := 0;
  v_exp  int;
  v_amts numeric[] := '{}';
  v_fee  numeric;
  v_plan uuid;
  k      int;
begin
  v := public.money_invoice_for_update(p_invoice);
  if v.status::text = 'draft' then raise exception 'INVOICE_IS_DRAFT' using errcode = 'P0001'; end if;
  if v.status::text in ('paid','cancelled','void','refunded','written_off') then raise exception 'INVOICE_NOT_PAYABLE' using errcode = 'P0001'; end if;
  if exists (select 1 from public.payment_plans where invoice_id = p_invoice and kind = 'installments' and status in ('active','paused')) then
    raise exception 'PLAN_EXISTS' using errcode = 'P0001';
  end if;
  v_exp := public.currency_exponent(v.currency);
  v_fee := round(greatest(coalesce(p_fee, 0), 0), v_exp);
  v_bal := public.invoice_amount_due(p_invoice) - public.invoice_net_paid(p_invoice);
  if v_bal <= 0 then raise exception 'NOTHING_OUTSTANDING' using errcode = 'P0001'; end if;
  if cardinality(p_amounts) is null then raise exception 'INVALID_COUNT' using errcode = 'P0001'; end if;
  for k in 1 .. cardinality(p_amounts) loop
    v_amts := v_amts || round(p_amounts[k], v_exp);
    v_sum := v_sum + round(p_amounts[k], v_exp);
  end loop;
  if v_sum <> v_bal + v_fee then raise exception 'TOTAL_MISMATCH' using errcode = 'P0001'; end if;
  v_plan := public.plan_create_internal(v, p_dates, v_amts, v_fee, 'admin', 'custom');
  return jsonb_build_object('plan_id', v_plan, 'invoice_id', p_invoice);
end;
$$;

-- What the payer may choose for one invoice (product type, activity start, balance).
create or replace function public.plan_invoice_context(p_invoice uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v public.invoices;
begin
  select * into v from public.invoices where id = p_invoice;
  if not found or v.org_id is distinct from public.current_org_id()
     or not (public.is_finance_of(v.org_id) or public.is_guardian_of_family(v.family_id)) then
    return null;
  end if;
  return jsonb_build_object(
    'invoice_id', v.id, 'status', v.status, 'currency', v.currency,
    'product_type', public.invoice_product_type(v.id),
    'activity_start', public.invoice_activity_start(v.id),
    'balance', public.invoice_amount_due(v.id) - public.invoice_net_paid(v.id),
    'has_plan', exists (select 1 from public.payment_plans where invoice_id = v.id and kind = 'installments' and status in ('active','paused')));
end;
$$;

-- ---------------------------------------------------------------------------
-- 10) Editing plans (finance)
-- ---------------------------------------------------------------------------
create or replace function public.plan_for_update(p_plan uuid)
returns public.payment_plans
language plpgsql
security definer
set search_path = public
as $$
declare p public.payment_plans;
begin
  select * into p from public.payment_plans where id = p_plan for update;
  if not found or not public.is_finance_of(p.org_id) then raise exception 'PLAN_NOT_FOUND' using errcode = 'P0002'; end if;
  return p;
end;
$$;

-- Reschedule / change amounts of unpaid instalments, keeping the plan total.
-- p_items: [{ "id": uuid, "due_date": "YYYY-MM-DD", "amount": 123.45 }, ...]
create or replace function public.plan_reschedule(p_plan uuid, p_items jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p        public.payment_plans;
  v_before jsonb;
  v_exp    int;
  it       jsonb;
  r        public.payment_plan_installments;
  v_sum    numeric;
  v_prev   date;
  q        record;
begin
  p := public.plan_for_update(p_plan);
  if p.kind <> 'installments' then raise exception 'NOT_INSTALMENT_PLAN' using errcode = 'P0001'; end if;
  if p.status not in ('active','paused') then raise exception 'PLAN_CLOSED' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'INVALID_SCHEDULE' using errcode = 'P0001'; end if;
  v_exp := public.currency_exponent(p.currency);
  select jsonb_agg(jsonb_build_object('seq', seq, 'due_date', due_date, 'amount', amount, 'status', status) order by seq)
    into v_before from public.payment_plan_installments where plan_id = p.id;

  for it in select * from jsonb_array_elements(p_items) loop
    select * into r from public.payment_plan_installments where id = (it->>'id')::uuid and plan_id = p.id for update;
    if not found then raise exception 'INSTALMENT_NOT_FOUND' using errcode = 'P0002'; end if;
    if r.status in ('paid','cancelled','skipped') then raise exception 'INSTALMENT_LOCKED' using errcode = 'P0001'; end if;
    if (it->>'amount') is not null and round((it->>'amount')::numeric, v_exp) < r.amount_paid then
      raise exception 'BELOW_PAID' using errcode = 'P0001';
    end if;
    update public.payment_plan_installments
       set due_date = coalesce(nullif(it->>'due_date', '')::date, due_date),
           amount = coalesce(round((it->>'amount')::numeric, v_exp), amount),
           reminded_before_at = null, overdue_reminded_at = null,
           autopay_status = null, autopay_next_on = null,
           autopay_round_start = autopay_attempts, autopay_first_on = null
     where id = r.id;
  end loop;

  select coalesce(sum(amount), 0) into v_sum from public.payment_plan_installments
   where plan_id = p.id and status not in ('cancelled','skipped');
  if v_sum <> p.amount_total then raise exception 'TOTAL_MISMATCH' using errcode = 'P0001'; end if;
  for q in select due_date from public.payment_plan_installments where plan_id = p.id and status not in ('cancelled','skipped') order by seq loop
    if v_prev is not null and q.due_date < v_prev then raise exception 'INVALID_SCHEDULE' using errcode = 'P0001'; end if;
    v_prev := q.due_date;
  end loop;

  update public.invoices set due_date = v_prev where id = p.invoice_id;
  perform public.refresh_installment_status(p.invoice_id);
  perform public.refresh_invoice_overdue(p.invoice_id);

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (p.org_id, auth.uid(), 'PAYMENT_PLAN_RESCHEDULED', 'payment_plans', p.id,
          jsonb_build_object('installments', v_before),
          jsonb_build_object('reason', nullif(btrim(coalesce(p_reason, '')), ''),
            'installments', (select jsonb_agg(jsonb_build_object('seq', seq, 'due_date', due_date, 'amount', amount, 'status', status) order by seq)
                               from public.payment_plan_installments where plan_id = p.id)));
  return jsonb_build_object('plan_id', p.id, 'last_due', v_prev);
end;
$$;

create or replace function public.plan_set_paused(p_plan uuid, p_paused boolean, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare p public.payment_plans;
begin
  p := public.plan_for_update(p_plan);
  if p.status not in ('active','paused') then raise exception 'PLAN_CLOSED' using errcode = 'P0001'; end if;
  update public.payment_plans
     set status = case when p_paused then 'paused' else 'active' end,
         paused_at = case when p_paused then now() else null end,
         pause_reason = case when p_paused then nullif(btrim(coalesce(p_reason, '')), '') else null end
   where id = p.id;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (p.org_id, auth.uid(), case when p_paused then 'PAYMENT_PLAN_PAUSED' else 'PAYMENT_PLAN_RESUMED' end,
          'payment_plans', p.id, jsonb_build_object('status', p.status),
          jsonb_build_object('status', case when p_paused then 'paused' else 'active' end, 'reason', p_reason));
  return jsonb_build_object('plan_id', p.id, 'status', case when p_paused then 'paused' else 'active' end);
end;
$$;

-- Cancel: unpaid instalments cancelled, instalment fee voided, the invoice is
-- back to its normal balance and original due date. Recurring: no more periods.
create or replace function public.plan_cancel(p_plan uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare p public.payment_plans; v_due date;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  p := public.plan_for_update(p_plan);
  if p.status not in ('active','paused') then raise exception 'PLAN_CLOSED' using errcode = 'P0001'; end if;

  update public.payment_plans
     set status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason),
         end_date = case when kind = 'recurring' then least(coalesce(end_date, current_date), current_date) else end_date end
   where id = p.id;

  if p.kind = 'installments' then
    update public.payment_plan_installments set status = 'cancelled'
     where plan_id = p.id and status not in ('paid','cancelled','skipped');
    if p.fee_adjustment_id is not null
       and exists (select 1 from public.invoice_adjustments where id = p.fee_adjustment_id and voided_at is null) then
      perform public.void_invoice_adjustment(p.fee_adjustment_id, 'Instalment plan cancelled: ' || btrim(p_reason));
    end if;
    select due_date into v_due from public.invoices where id = p.invoice_id;
    update public.invoices set due_date = coalesce(p.original_due_date, v_due) where id = p.invoice_id;
    perform public.recompute_invoice(p.invoice_id);
    perform public.refresh_invoice_overdue(p.invoice_id);
  else
    -- future periods never generated; generated period invoices stay as they are
    update public.payment_plan_installments set status = 'cancelled'
     where plan_id = p.id and invoice_id is null and status = 'scheduled';
  end if;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (p.org_id, auth.uid(), 'PAYMENT_PLAN_CANCELLED', 'payment_plans', p.id,
          jsonb_build_object('status', p.status), jsonb_build_object('status', 'cancelled', 'reason', btrim(p_reason)));
  return jsonb_build_object('plan_id', p.id, 'status', 'cancelled');
end;
$$;

-- ---------------------------------------------------------------------------
-- 11) Recurring fees: enrol, pause, skip, end, generate
-- ---------------------------------------------------------------------------
create or replace function public.recurring_enrol(p_template uuid, p_athletes uuid[], p_start date, p_amount numeric default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  t       public.recurring_fee_templates;
  a       record;
  v_n     int := 0;
  v_start date;
  b       record;
begin
  select * into t from public.recurring_fee_templates where id = p_template;
  if not found or not public.is_finance_of(t.org_id) then raise exception 'TEMPLATE_NOT_FOUND' using errcode = 'P0002'; end if;
  if not t.is_active then raise exception 'TEMPLATE_INACTIVE' using errcode = 'P0001'; end if;
  if p_amount is not null and (p_amount <= 0 or p_amount > 1000000) then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
  v_start := greatest(coalesce(p_start, current_date), t.start_date);
  if t.end_date is not null and v_start > t.end_date then raise exception 'INVALID_DATE' using errcode = 'P0001'; end if;
  select * into b from public.recurring_period_bounds(t.start_date, t.billing_day, t.frequency, v_start);

  for a in
    select x.id, x.family_id from public.athletes x
     where x.id = any(coalesce(p_athletes, '{}')) and x.org_id = t.org_id and x.family_id is not null
  loop
    continue when exists (select 1 from public.payment_plans
                           where template_id = t.id and athlete_id = a.id and kind = 'recurring' and status in ('active','paused'));
    insert into public.payment_plans (org_id, family_id, program_id, athlete_id, team_id, kind, description, currency,
                                      amount_per_period, frequency, interval_count, start_date, end_date, next_run_date,
                                      due_days, created_by, source, template_id)
    values (t.org_id, a.family_id, t.program_id, a.id, t.team_id, 'recurring', t.name, t.currency,
            round(coalesce(p_amount, t.amount), public.currency_exponent(t.currency)), t.frequency, 1, v_start, t.end_date,
            b.period_start, t.due_days, auth.uid(), 'recurring', t.id);
    v_n := v_n + 1;
  end loop;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (t.org_id, auth.uid(), 'RECURRING_ENROLLED', 'recurring_fee_templates', t.id,
          jsonb_build_object('enrolled', v_n, 'start', v_start, 'requested', cardinality(coalesce(p_athletes, '{}'))));
  return v_n;
end;
$$;

-- Bulk: every active member of a team.
create or replace function public.recurring_enrol_team(p_template uuid, p_team uuid, p_start date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare t public.recurring_fee_templates; v_ids uuid[];
begin
  select * into t from public.recurring_fee_templates where id = p_template;
  if not found or not public.is_finance_of(t.org_id) then raise exception 'TEMPLATE_NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.teams where id = p_team and org_id = t.org_id) then raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002'; end if;
  select coalesce(array_agg(m.athlete_id), '{}') into v_ids
    from public.team_memberships m
   where m.team_id = p_team and m.org_id = t.org_id and m.status::text = 'active' and m.left_on is null;
  return public.recurring_enrol(p_template, v_ids, p_start, null);
end;
$$;

create or replace function public.recurring_end(p_plan uuid, p_end date, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare p public.payment_plans;
begin
  p := public.plan_for_update(p_plan);
  if p.kind <> 'recurring' then raise exception 'NOT_RECURRING' using errcode = 'P0001'; end if;
  if p.status not in ('active','paused') then raise exception 'PLAN_CLOSED' using errcode = 'P0001'; end if;
  if p_end is null or p_end < p.start_date then raise exception 'INVALID_DATE' using errcode = 'P0001'; end if;
  update public.payment_plans
     set end_date = p_end,
         status = case when next_run_date is null or next_run_date > p_end then 'completed' else status end
   where id = p.id;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (p.org_id, auth.uid(), 'RECURRING_ENDED', 'payment_plans', p.id,
          jsonb_build_object('end_date', p.end_date), jsonb_build_object('end_date', p_end, 'reason', p_reason));
  return jsonb_build_object('plan_id', p.id, 'end_date', p_end);
end;
$$;

create or replace function public.recurring_add_pause(p_plan uuid, p_from date, p_to date, p_kind text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare p public.payment_plans; v_id uuid;
begin
  p := public.plan_for_update(p_plan);
  if p.kind <> 'recurring' then raise exception 'NOT_RECURRING' using errcode = 'P0001'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'INVALID_DATE' using errcode = 'P0001'; end if;
  if coalesce(p_kind, '') not in ('holiday','injury','other') then raise exception 'INVALID_KIND' using errcode = 'P0001'; end if;
  insert into public.recurring_plan_pauses (org_id, plan_id, starts_on, ends_on, kind, note, created_by)
  values (p.org_id, p.id, p_from, p_to, p_kind, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.recurring_remove_pause(p_pause uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid;
begin
  select org_id into v_org from public.recurring_plan_pauses where id = p_pause;
  if v_org is null or not public.is_finance_of(v_org) then raise exception 'PAUSE_NOT_FOUND' using errcode = 'P0002'; end if;
  delete from public.recurring_plan_pauses where id = p_pause;
end;
$$;

-- Skip a period: a future period is recorded as skipped (never invoiced); an
-- unpaid generated period invoice is cancelled (paid ones: credit note instead).
create or replace function public.recurring_skip_period(p_plan uuid, p_period_start date, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p     public.payment_plans;
  t     public.recurring_fee_templates;
  r     public.payment_plan_installments;
  b     record;
  v_seq int;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  p := public.plan_for_update(p_plan);
  if p.kind <> 'recurring' then raise exception 'NOT_RECURRING' using errcode = 'P0001'; end if;

  select * into r from public.payment_plan_installments where plan_id = p.id and period_start = p_period_start for update;
  if found then
    if r.status in ('skipped','cancelled') then raise exception 'ALREADY_SKIPPED' using errcode = 'P0001'; end if;
    if r.invoice_id is not null then
      if public.invoice_net_paid(r.invoice_id) <> 0 then raise exception 'USE_CREDIT_NOTE' using errcode = 'P0001'; end if;
      perform public.cancel_invoice(r.invoice_id, btrim(p_reason));
    end if;
    update public.payment_plan_installments set status = 'skipped', skipped_reason = btrim(p_reason) where id = r.id;
  else
    if p.template_id is not null then
      select * into t from public.recurring_fee_templates where id = p.template_id;
      select * into b from public.recurring_period_bounds(t.start_date, t.billing_day, t.frequency, p_period_start);
      if b.period_start <> p_period_start then raise exception 'INVALID_PERIOD' using errcode = 'P0001'; end if;
    end if;
    if p.next_run_date is null or p_period_start < p.next_run_date then raise exception 'INVALID_PERIOD' using errcode = 'P0001'; end if;
    select coalesce(max(seq), 0) + 1 into v_seq from public.payment_plan_installments where plan_id = p.id;
    insert into public.payment_plan_installments (org_id, plan_id, seq, due_date, amount, currency, status, period_start, skipped_reason)
    values (p.org_id, p.id, v_seq, p_period_start, 0, p.currency, 'skipped', p_period_start, btrim(p_reason));
  end if;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (p.org_id, auth.uid(), 'RECURRING_PERIOD_SKIPPED', 'payment_plans', p.id,
          jsonb_build_object('period_start', p_period_start, 'reason', btrim(p_reason)));
  return jsonb_build_object('plan_id', p.id, 'period_start', p_period_start);
end;
$$;

-- Discount for one recurring period: sibling (position among the family's
-- enrolments in the same template, eldest first) + manual discounts on the
-- enrolment, from the shared public.discounts model. Capped at the amount.
create or replace function public.recurring_discount(p_plan public.payment_plans, p_amount numeric, p_period date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_exp   int := public.currency_exponent(p_plan.currency);
  v_pos   int;
  d       public.discounts%rowtype;
  v_amt   numeric;
  v_total numeric := 0;
  v_names text;
  v_eval  jsonb;
  l       jsonb;
begin
  if p_amount <= 0 then return jsonb_build_object('amount', 0, 'label', null); end if;
  if p_plan.template_id is not null then
    select pos into v_pos from (
      select p.id, row_number() over (order by a.dob nulls last, p.created_at, p.id) as pos
        from public.payment_plans p left join public.athletes a on a.id = p.athlete_id
       where p.template_id = p_plan.template_id and p.family_id = p_plan.family_id
         and p.kind = 'recurring' and p.status in ('active','paused')) x
     where x.id = p_plan.id;
    for d in select * from public.discounts
              where org_id = p_plan.org_id and is_active and rule = 'sibling'
                and (scope = 'all' or (scope = 'program' and scope_program_id = p_plan.program_id))
                and (valid_from is null or valid_from <= now()) and (valid_until is null or valid_until >= now())
                and (kind = 'percent' or currency = p_plan.currency)
              order by name, id
    loop
      continue when coalesce(v_pos, 1) < coalesce(d.sibling_min_position, 2);
      v_amt := case when d.kind = 'percent' then round(p_amount * least(d.value, 100) / 100, v_exp) else round(d.value, v_exp) end;
      v_amt := least(v_amt, p_amount - v_total);
      continue when v_amt <= 0;
      v_total := v_total + v_amt;
      v_names := coalesce(v_names || ' + ', '') || d.name;
    end loop;
  end if;
  if cardinality(p_plan.manual_discount_ids) > 0 and v_total < p_amount then
    v_eval := public.discount_evaluate(p_plan.org_id, 'recurring', p_plan.program_id, null, p_amount - v_total,
                                       p_plan.currency, null, p_plan.family_id, p_period, p_plan.manual_discount_ids, false);
    for l in select x from jsonb_array_elements(coalesce(v_eval->'lines', '[]'::jsonb)) x loop
      continue when l->>'rule' <> 'manual';
      v_amt := least((l->>'amount')::numeric, p_amount - v_total);
      continue when v_amt <= 0;
      v_total := v_total + v_amt;
      v_names := coalesce(v_names || ' + ', '') || (l->>'name');
    end loop;
  end if;
  return jsonb_build_object('amount', v_total, 'label', v_names);
end;
$$;

-- Generator: one invoice per due period (idempotent on (plan_id, period_start)).
-- p_dry_run = true previews without writing. Catches up at most 12 periods per plan.
create or replace function public.recurring_generate(p_org uuid, p_as_of date default current_date, p_dry_run boolean default false)
returns table (plan_id uuid, family_id uuid, athlete_id uuid, period_start date, period_end date,
               amount numeric, discount numeric, net numeric, action text, installment_id uuid, invoice_id uuid)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_plan    public.payment_plans%rowtype;
  t         public.recurring_fee_templates%rowtype;
  v_period  date;
  v_end     date;
  v_next    date;
  v_loops   int;
  v_seq     int;
  v_amount  numeric;
  v_disc    jsonb;
  v_net     numeric;
  v_number  text;
  v_invoice uuid;
  v_inst    uuid;
  v_kind    text;
  b         record;
begin
  if not (public.is_service_caller() or public.is_finance_of(p_org)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  for v_plan in
    select * from public.payment_plans pp
     where pp.org_id = p_org and pp.kind = 'recurring' and pp.status = 'active'
       and pp.next_run_date is not null and pp.next_run_date <= p_as_of
     order by pp.created_at
     for update skip locked
  loop
    t := null;
    if v_plan.template_id is not null then
      select * into t from public.recurring_fee_templates where id = v_plan.template_id;
    end if;
    v_loops := 0;
    v_period := v_plan.next_run_date;
    while v_period <= p_as_of and (v_plan.end_date is null or v_period <= v_plan.end_date) and v_loops < 12 loop
      if t.id is not null then
        select * into b from public.recurring_period_bounds(t.start_date, t.billing_day, t.frequency, v_period);
        v_end := b.period_end;
      else
        v_end := (v_period + public.plan_interval(v_plan.frequency, v_plan.interval_count))::date - 1;
      end if;
      v_next := v_end + 1;

      if exists (select 1 from public.payment_plan_installments x where x.plan_id = v_plan.id and x.period_start = v_period) then
        null;  -- already generated or skipped
      else
        v_kind := null;
        select x.kind into v_kind from public.recurring_plan_pauses x
         where x.plan_id = v_plan.id and x.starts_on <= v_period and x.ends_on >= v_period
         order by x.starts_on limit 1;
        v_amount := v_plan.amount_per_period;
        if t.id is not null then
          v_amount := public.recurring_prorate(v_amount, v_period, v_end, v_plan.start_date, t.proration, v_plan.currency);
        end if;
        v_disc := case when t.id is null or t.apply_discounts then public.recurring_discount(v_plan, v_amount, v_period)
                       else jsonb_build_object('amount', 0) end;
        v_net := v_amount - coalesce((v_disc->>'amount')::numeric, 0);

        plan_id := v_plan.id; family_id := v_plan.family_id; athlete_id := v_plan.athlete_id;
        period_start := v_period; period_end := v_end;
        amount := v_amount; discount := coalesce((v_disc->>'amount')::numeric, 0); net := v_net;
        installment_id := null; invoice_id := null;

        if v_kind is not null or v_net <= 0 then
          action := case when v_kind is not null then 'skip_pause' else 'skip_zero' end;
          if not p_dry_run then
            select coalesce(max(x.seq), 0) + 1 into v_seq from public.payment_plan_installments x where x.plan_id = v_plan.id;
            insert into public.payment_plan_installments (org_id, plan_id, seq, due_date, amount, currency, status,
                                                          period_start, period_end, skipped_reason)
            values (p_org, v_plan.id, v_seq, v_period, 0, v_plan.currency, 'skipped', v_period, v_end,
                    case when v_kind is not null then 'pause:' || v_kind else 'zero' end)
            returning id into v_inst;
            installment_id := v_inst;
          end if;
        else
          action := 'invoice';
          if not p_dry_run then
            select coalesce(max(x.seq), 0) + 1 into v_seq from public.payment_plan_installments x where x.plan_id = v_plan.id;
            v_number := public.next_invoice_number(p_org);
            insert into public.invoices (org_id, number, family_id, athlete_id, program_id, description, status, due_date, currency)
            values (p_org, v_number, v_plan.family_id, v_plan.athlete_id, v_plan.program_id,
                    coalesce(v_plan.description, 'Membership fee') || ' · ' || to_char(v_period, 'YYYY-MM-DD') || ' – ' || to_char(v_end, 'YYYY-MM-DD'),
                    'sent', v_period + v_plan.due_days, v_plan.currency)
            returning id into v_invoice;
            insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
            values (p_org, v_invoice, coalesce(v_plan.description, 'Membership fee'), 1, v_amount, v_amount);
            if (v_disc->>'amount')::numeric > 0 then
              insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
              values (p_org, v_invoice, coalesce(v_disc->>'label', 'Discount'), 1, -(v_disc->>'amount')::numeric, -(v_disc->>'amount')::numeric);
            end if;
            update public.invoices set total_chf = v_net where id = v_invoice;
            insert into public.payment_plan_installments (org_id, plan_id, seq, due_date, amount, currency, invoice_id, status,
                                                          period_start, period_end)
            values (p_org, v_plan.id, v_seq, v_period + v_plan.due_days, v_net, v_plan.currency, v_invoice, 'invoiced', v_period, v_end)
            returning id into v_inst;
            installment_id := v_inst; invoice_id := v_invoice;
          end if;
        end if;
        return next;
      end if;

      v_loops := v_loops + 1;
      v_period := v_next;
    end loop;

    if not p_dry_run then
      update public.payment_plans pp
         set next_run_date = v_period,
             status = case when v_plan.end_date is not null and v_period > v_plan.end_date then 'completed' else pp.status end
       where pp.id = v_plan.id;
    end if;
  end loop;
end;
$$;

-- Kept for existing callers: number of period invoices issued.
create or replace function public.run_recurring_billing(p_org uuid, p_as_of date default current_date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n int;
begin
  if not (public.is_service_caller() or public.is_finance_of(p_org)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select count(*) into v_n from public.recurring_generate(p_org, p_as_of, false) g where g.action = 'invoice';
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12) Daily work list for the billing cron (service role)
-- ---------------------------------------------------------------------------
create or replace function public.plans_cron_work(p_org uuid, p_today date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s        public.payment_plan_settings;
  v_rows   jsonb;
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  s := public.plan_settings(p_org);

  with base as (
    select i.id as installment_id, i.plan_id, i.invoice_id, p.family_id, i.seq, p.kind, p.installment_count,
           i.due_date, i.currency, public.installment_outstanding(i.id) as outstanding,
           i.reminded_before_at, i.overdue_reminded_at, i.autopay_status, i.autopay_next_on, i.autopay_attempts,
           p.autopay as plan_autopay, inv.number as invoice_number, inv.reminders_paused, inv.locale,
           m.id as mandate_id, m.enabled as mandate_enabled
      from public.payment_plan_installments i
      join public.payment_plans p on p.id = i.plan_id
      join public.invoices inv on inv.id = i.invoice_id
      left join public.autopay_mandates m on m.family_id = p.family_id and m.status = 'active' and m.org_id = p_org
     where i.org_id = p_org and p.status = 'active'
       and i.status in ('scheduled','invoiced')
       and inv.status::text not in ('paid','cancelled','void','written_off','refunded','draft')
  )
  select jsonb_build_object(
    'remind_before', coalesce((select jsonb_agg(to_jsonb(b) order by b.due_date) from base b
       where b.outstanding > 0 and b.reminded_before_at is null and not b.reminders_paused
         and b.due_date > p_today and b.due_date <= p_today + s.remind_before_days
         and not (b.mandate_id is not null and b.mandate_enabled and b.plan_autopay and s.autopay_enabled)), '[]'::jsonb),
    'overdue', coalesce((select jsonb_agg(to_jsonb(b) order by b.due_date) from base b
       where b.outstanding > 0 and not b.reminders_paused and b.due_date < p_today
         and (b.autopay_status is null or b.autopay_status in ('fallback','requires_action','succeeded'))
         and (b.overdue_reminded_at is null or b.overdue_reminded_at < (p_today - s.overdue_repeat_days)::timestamptz)), '[]'::jsonb),
    'charges', coalesce((select jsonb_agg(to_jsonb(b) order by b.due_date) from base b
       where s.autopay_enabled and b.outstanding > 0 and b.mandate_id is not null and b.mandate_enabled and b.plan_autopay
         and b.due_date <= p_today
         and (b.autopay_status is null or b.autopay_status = 'failed')
         and (b.autopay_next_on is null or b.autopay_next_on <= p_today)), '[]'::jsonb),
    'expiring', coalesce((select jsonb_agg(jsonb_build_object('mandate_id', m.id, 'family_id', m.family_id,
                                                          'exp_month', m.card_exp_month, 'exp_year', m.card_exp_year))
       from public.autopay_mandates m
      where m.org_id = p_org and m.status = 'active' and m.expiry_notified_at is null
        and m.card_exp_year is not null and m.card_exp_month is not null
        and make_date(m.card_exp_year, m.card_exp_month, 1) <= (date_trunc('month', p_today) + interval '1 month')::date), '[]'::jsonb),
    'settings', jsonb_build_object('autopay_enabled', s.autopay_enabled, 'retry_days', to_jsonb(s.retry_days),
                                   'remind_before_days', s.remind_before_days))
  into v_rows;
  return v_rows;
end;
$$;

create or replace function public.plan_mark_reminded(p_installment uuid, p_kind text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_n int;
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_kind = 'before' then
    update public.payment_plan_installments set reminded_before_at = now() where id = p_installment and reminded_before_at is null;
  elsif p_kind = 'overdue' then
    update public.payment_plan_installments set overdue_reminded_at = now() where id = p_installment;
  else
    raise exception 'INVALID_KIND' using errcode = 'P0001';
  end if;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- 13) Autopay mandates
-- ---------------------------------------------------------------------------
-- Guardian: record consent and open a pending mandate (Stripe setup follows).
create or replace function public.autopay_start_setup(p_family uuid, p_consent_version text, p_consent_text text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org  uuid;
  s      public.payment_plan_settings;
  v_id   uuid;
  v_cus  text;
begin
  select org_id into v_org from public.families where id = p_family;
  if v_org is null or v_org is distinct from public.current_org_id() or not public.is_guardian_of_family(p_family) then
    raise exception 'FAMILY_NOT_FOUND' using errcode = 'P0002';
  end if;
  s := public.plan_settings(v_org);
  if not s.autopay_enabled then raise exception 'AUTOPAY_DISABLED' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_consent_text), '') = '' or length(p_consent_text) < 20 then raise exception 'CONSENT_REQUIRED' using errcode = 'P0001'; end if;
  if p_consent_version is distinct from s.mandate_version then raise exception 'CONSENT_OUTDATED' using errcode = 'P0001'; end if;

  -- Re-use the family's Stripe customer on the club's account.
  select stripe_customer_id into v_cus from public.autopay_mandates
   where family_id = p_family and org_id = v_org and stripe_customer_id is not null
   order by created_at desc limit 1;

  insert into public.autopay_mandates (org_id, family_id, status, consent_version, consent_text, consented_by, stripe_customer_id)
  values (v_org, p_family, 'pending', p_consent_version, btrim(p_consent_text), auth.uid(), v_cus)
  returning id into v_id;
  return jsonb_build_object('mandate_id', v_id, 'org_id', v_org, 'customer_id', v_cus);
end;
$$;

-- Service: Stripe customer + Checkout (setup mode) session created for a pending mandate.
create or replace function public.autopay_attach_session(p_mandate uuid, p_org uuid, p_customer text, p_session text, p_account text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  update public.autopay_mandates
     set stripe_customer_id = p_customer, setup_session_id = p_session, stripe_account_id = p_account
   where id = p_mandate and org_id = p_org and status = 'pending';
  if not found then raise exception 'MANDATE_NOT_FOUND' using errcode = 'P0002'; end if;
end;
$$;

-- Service (webhook): the setup succeeded; activate, replacing the previous card.
-- Returns the replaced payment methods so the caller can detach them in Stripe.
create or replace function public.autopay_activate(
  p_mandate uuid, p_account text, p_customer text, p_payment_method text,
  p_brand text, p_last4 text, p_exp_month int, p_exp_year int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m        public.autopay_mandates;
  v_acct   text;
  v_old    jsonb;
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into m from public.autopay_mandates where id = p_mandate for update;
  if not found then raise exception 'MANDATE_NOT_FOUND' using errcode = 'P0002'; end if;
  select payment_settings->'stripe'->>'account_id' into v_acct from public.organizations where id = m.org_id;
  if p_account is not null and v_acct is distinct from p_account then raise exception 'ACCOUNT_MISMATCH' using errcode = 'P0001'; end if;
  if m.stripe_customer_id is not null and p_customer is not null and m.stripe_customer_id <> p_customer then
    raise exception 'CUSTOMER_MISMATCH' using errcode = 'P0001';
  end if;
  if m.status = 'active' and m.stripe_payment_method_id = p_payment_method then
    return jsonb_build_object('mandate_id', m.id, 'duplicate', true, 'replaced', '[]'::jsonb);
  end if;
  if m.status <> 'pending' then raise exception 'MANDATE_NOT_PENDING' using errcode = 'P0001'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('mandate_id', o.id, 'payment_method', o.stripe_payment_method_id)), '[]'::jsonb)
    into v_old from public.autopay_mandates o
   where o.family_id = m.family_id and o.status = 'active' and o.id <> m.id;
  update public.autopay_mandates set status = 'replaced'
   where family_id = m.family_id and status = 'active' and id <> m.id;

  update public.autopay_mandates
     set status = 'active', enabled = true, activated_at = now(),
         stripe_customer_id = coalesce(p_customer, stripe_customer_id),
         stripe_payment_method_id = p_payment_method,
         stripe_account_id = coalesce(p_account, stripe_account_id),
         card_brand = left(p_brand, 30), card_last4 = p_last4, card_exp_month = p_exp_month, card_exp_year = p_exp_year,
         expiry_notified_at = null
   where id = m.id;
  -- Charges that were waiting for the parent can be retried with the new card.
  update public.payment_plan_installments i
     set autopay_status = null, autopay_next_on = null, autopay_round_start = i.autopay_attempts, autopay_first_on = null
   where i.org_id = m.org_id and i.autopay_status in ('requires_action','fallback','failed')
     and i.status in ('scheduled','invoiced')
     and exists (select 1 from public.payment_plans p where p.id = i.plan_id and p.family_id = m.family_id);
  return jsonb_build_object('mandate_id', m.id, 'duplicate', false, 'replaced', v_old,
                            'org_id', m.org_id, 'family_id', m.family_id);
end;
$$;

-- Guardian or finance: turn autopay on / off (the saved card stays).
create or replace function public.autopay_set_enabled(p_mandate uuid, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare m public.autopay_mandates;
begin
  select * into m from public.autopay_mandates where id = p_mandate for update;
  if not found or m.org_id is distinct from public.current_org_id()
     or not (public.is_finance_of(m.org_id) or public.is_guardian_of_family(m.family_id)) then
    raise exception 'MANDATE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if m.status <> 'active' then raise exception 'MANDATE_NOT_ACTIVE' using errcode = 'P0001'; end if;
  update public.autopay_mandates set enabled = coalesce(p_enabled, false) where id = m.id;
  return jsonb_build_object('mandate_id', m.id, 'enabled', coalesce(p_enabled, false));
end;
$$;

-- Guardian or finance: remove the saved card. Returns what to detach in Stripe.
create or replace function public.autopay_revoke(p_mandate uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare m public.autopay_mandates;
begin
  select * into m from public.autopay_mandates where id = p_mandate for update;
  if not found or m.org_id is distinct from public.current_org_id()
     or not (public.is_finance_of(m.org_id) or public.is_guardian_of_family(m.family_id)) then
    raise exception 'MANDATE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if m.status not in ('active','pending') then raise exception 'MANDATE_NOT_ACTIVE' using errcode = 'P0001'; end if;
  update public.autopay_mandates set status = 'revoked', enabled = false, revoked_at = now(), revoked_by = auth.uid()
   where id = m.id;
  return jsonb_build_object('mandate_id', m.id, 'org_id', m.org_id, 'payment_method', m.stripe_payment_method_id);
end;
$$;

-- Service (webhook): payment method detached / updated in Stripe.
create or replace function public.autopay_payment_method_event(
  p_account text, p_payment_method text, p_detached boolean,
  p_brand text default null, p_last4 text default null, p_exp_month int default null, p_exp_year int default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n int;
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_detached then
    update public.autopay_mandates m set status = 'detached', enabled = false
     where m.stripe_payment_method_id = p_payment_method and m.status = 'active'
       and (p_account is null or m.stripe_account_id = p_account
            or (select payment_settings->'stripe'->>'account_id' from public.organizations o where o.id = m.org_id) = p_account);
  else
    update public.autopay_mandates m
       set card_exp_month = coalesce(p_exp_month, card_exp_month), card_exp_year = coalesce(p_exp_year, card_exp_year),
           card_last4 = coalesce(p_last4, card_last4), card_brand = coalesce(left(p_brand, 30), card_brand),
           expiry_notified_at = case when p_exp_year is distinct from card_exp_year or p_exp_month is distinct from card_exp_month
                                     then null else expiry_notified_at end
     where m.stripe_payment_method_id = p_payment_method and m.status = 'active'
       and (p_account is null or m.stripe_account_id = p_account
            or (select payment_settings->'stripe'->>'account_id' from public.organizations o where o.id = m.org_id) = p_account);
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.autopay_mark_expiry_notified(p_mandate uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_n int;
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  update public.autopay_mandates set expiry_notified_at = now() where id = p_mandate and expiry_notified_at is null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- 14) Autopay charges
-- ---------------------------------------------------------------------------
-- Service: claim the next attempt for one instalment. Null when it isn't
-- chargeable any more (paid, no active mandate, already processing).
create or replace function public.autopay_begin_charge(p_installment uuid, p_today date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  i        public.payment_plan_installments;
  p        public.payment_plans;
  m        public.autopay_mandates;
  inv      public.invoices;
  s        public.payment_plan_settings;
  v_amt    numeric;
  v_att    int;
  v_key    text;
  v_id     uuid;
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into i from public.payment_plan_installments where id = p_installment for update skip locked;
  if not found then return null; end if;
  select * into p from public.payment_plans where id = i.plan_id;
  s := public.plan_settings(i.org_id);
  if not s.autopay_enabled or p.status <> 'active' or not p.autopay or i.status not in ('scheduled','invoiced')
     or i.due_date > p_today
     or coalesce(i.autopay_status, '') in ('processing','requires_action','fallback','succeeded')
     or (i.autopay_next_on is not null and i.autopay_next_on > p_today) then
    return null;
  end if;
  select * into m from public.autopay_mandates
   where family_id = p.family_id and org_id = i.org_id and status = 'active' and enabled;
  if not found or m.stripe_customer_id is null or m.stripe_payment_method_id is null then return null; end if;
  select * into inv from public.invoices where id = i.invoice_id;
  if inv.status::text in ('paid','cancelled','void','written_off','refunded','draft') then return null; end if;

  v_amt := least(public.installment_outstanding(i.id),
                 public.invoice_amount_due(i.invoice_id) - public.invoice_net_paid(i.invoice_id));
  if v_amt is null or v_amt <= 0 then return null; end if;

  v_att := i.autopay_attempts + 1;
  if v_att - i.autopay_round_start > 1 + cardinality(s.retry_days) then return null; end if;
  v_key := 'autopay:' || i.id || ':' || v_att;
  insert into public.autopay_charges (org_id, family_id, mandate_id, installment_id, invoice_id, amount, currency, attempt, idempotency_key)
  values (i.org_id, p.family_id, m.id, i.id, i.invoice_id, v_amt, i.currency, v_att, v_key)
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  if v_id is null then return null; end if;

  update public.payment_plan_installments
     set autopay_status = 'processing', autopay_attempts = v_att,
         autopay_first_on = coalesce(autopay_first_on, p_today), autopay_next_on = null
   where id = i.id;

  return jsonb_build_object(
    'charge_id', v_id, 'attempt', v_att, 'idempotency_key', v_key, 'amount', v_amt, 'currency', i.currency,
    'org_id', i.org_id, 'family_id', p.family_id, 'installment_id', i.id, 'invoice_id', i.invoice_id,
    'invoice_number', inv.number, 'seq', i.seq, 'plan_kind', p.kind, 'installment_count', p.installment_count,
    'mandate_id', m.id, 'customer_id', m.stripe_customer_id, 'payment_method_id', m.stripe_payment_method_id);
end;
$$;

-- Service (cron + webhook): record the outcome of one attempt. Idempotent:
-- only a transition from 'processing' (or a later, stronger outcome) is applied.
-- Returns {transitioned, outcome, fallback, next_retry_on, ...}.
create or replace function public.autopay_charge_result(
  p_charge uuid, p_payment_intent text, p_status text, p_code text default null, p_decline text default null,
  p_account text default null, p_today date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c        public.autopay_charges;
  i        public.payment_plan_installments;
  s        public.payment_plan_settings;
  v_acct   text;
  v_next   date;
  v_fall   boolean := false;
  v_ist    text;
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_status not in ('succeeded','requires_action','failed') then raise exception 'INVALID_STATUS' using errcode = 'P0001'; end if;
  if p_charge is not null then
    select * into c from public.autopay_charges where id = p_charge for update;
  else
    select * into c from public.autopay_charges where payment_intent_id = p_payment_intent for update;
  end if;
  if not found then return jsonb_build_object('transitioned', false, 'outcome', 'unknown'); end if;
  select payment_settings->'stripe'->>'account_id' into v_acct from public.organizations where id = c.org_id;
  if p_account is not null and v_acct is distinct from p_account then raise exception 'ACCOUNT_MISMATCH' using errcode = 'P0001'; end if;

  if c.payment_intent_id is null and p_payment_intent is not null then
    update public.autopay_charges set payment_intent_id = p_payment_intent where id = c.id;
  end if;
  if c.status = p_status or c.status = 'succeeded' then
    return jsonb_build_object('transitioned', false, 'outcome', c.status, 'charge_id', c.id);
  end if;
  s := public.plan_settings(c.org_id);
  select * into i from public.payment_plan_installments where id = c.installment_id for update;

  if p_status = 'failed' then
    -- Retries are counted from the first attempt: +retry_days[n] days. An
    -- expired / stolen card is not retried.
    if coalesce(p_decline, p_code, '') in ('expired_card','lost_card','stolen_card','pickup_card')
       or c.attempt - coalesce(i.autopay_round_start, 0) > cardinality(s.retry_days) then
      v_fall := true;
    else
      v_next := coalesce(i.autopay_first_on, p_today) + s.retry_days[c.attempt - coalesce(i.autopay_round_start, 0)];
      if v_next <= p_today then v_next := p_today + 1; end if;
    end if;
    v_ist := case when v_fall then 'fallback' else 'failed' end;
  elsif p_status = 'requires_action' then
    v_ist := 'requires_action';
  else
    v_ist := 'succeeded';
  end if;

  update public.autopay_charges
     set status = p_status, failure_code = left(p_code, 60), decline_code = left(p_decline, 60), next_retry_on = v_next
   where id = c.id;
  update public.payment_plan_installments
     set autopay_status = v_ist, autopay_next_on = v_next
   where id = c.installment_id and status in ('scheduled','invoiced');

  return jsonb_build_object('transitioned', true, 'outcome', p_status, 'fallback', v_fall, 'next_retry_on', v_next,
                            'charge_id', c.id, 'org_id', c.org_id, 'family_id', c.family_id,
                            'installment_id', c.installment_id, 'invoice_id', c.invoice_id,
                            'amount', c.amount, 'currency', c.currency, 'attempt', c.attempt);
end;
$$;

-- Finance: retry a failed / fallen-back charge now (next cron run picks it up).
create or replace function public.autopay_retry_now(p_installment uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare i public.payment_plan_installments;
begin
  select * into i from public.payment_plan_installments where id = p_installment for update;
  if not found or not public.is_finance_of(i.org_id) then raise exception 'INSTALMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if i.status not in ('scheduled','invoiced') then raise exception 'INSTALMENT_LOCKED' using errcode = 'P0001'; end if;
  if coalesce(i.autopay_status, '') not in ('failed','fallback','requires_action') then raise exception 'NOT_FAILED' using errcode = 'P0001'; end if;
  -- A fresh round of attempts: the round starts at the current attempt count,
  -- so the idempotency key (installment + attempt number) stays unique.
  update public.payment_plan_installments
     set autopay_status = null, autopay_next_on = null,
         autopay_round_start = autopay_attempts, autopay_first_on = null
   where id = i.id;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (i.org_id, auth.uid(), 'AUTOPAY_RETRY_REQUESTED', 'payment_plan_installments', i.id,
          jsonb_build_object('attempts', i.autopay_attempts, 'previous_status', i.autopay_status));
  return jsonb_build_object('installment_id', i.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 15) EXECUTE grants: nothing for anon; service-only RPCs closed to clients
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  -- signed-in members (each function checks role + org itself)
  foreach f in array array[
    'public.plan_choose(uuid, integer)',
    'public.plan_admin_create(uuid, date[], numeric[], numeric)',
    'public.plan_invoice_context(uuid)',
    'public.plan_reschedule(uuid, jsonb, text)',
    'public.plan_set_paused(uuid, boolean, text)',
    'public.plan_cancel(uuid, text)',
    'public.recurring_enrol(uuid, uuid[], date, numeric)',
    'public.recurring_enrol_team(uuid, uuid, date)',
    'public.recurring_end(uuid, date, text)',
    'public.recurring_add_pause(uuid, date, date, text, text)',
    'public.recurring_remove_pause(uuid)',
    'public.recurring_skip_period(uuid, date, text)',
    'public.recurring_generate(uuid, date, boolean)',
    'public.run_recurring_billing(uuid, date)',
    'public.autopay_start_setup(uuid, text, text)',
    'public.autopay_set_enabled(uuid, boolean)',
    'public.autopay_revoke(uuid)',
    'public.autopay_retry_now(uuid)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;

  -- service role only / internal
  foreach f in array array[
    'public.plan_settings(uuid)',
    'public.plan_create_internal(public.invoices, date[], numeric[], numeric, text, text)',
    'public.plan_choose_internal(uuid, uuid, integer, text)',
    'public.plan_attach_checkout(uuid, uuid, integer, text)',
    'public.plan_for_update(uuid)',
    'public.invoice_product_type(uuid)',
    'public.invoice_activity_start(uuid)',
    'public.installment_outstanding(uuid)',
    'public.refresh_installment_status(uuid)',
    'public.recurring_discount(public.payment_plans, numeric, date)',
    'public.plans_cron_work(uuid, date)',
    'public.plan_mark_reminded(uuid, text)',
    'public.autopay_attach_session(uuid, uuid, text, text, text)',
    'public.autopay_activate(uuid, text, text, text, text, text, integer, integer)',
    'public.autopay_payment_method_event(text, text, boolean, text, text, integer, integer)',
    'public.autopay_mark_expiry_notified(uuid)',
    'public.autopay_begin_charge(uuid, date)',
    'public.autopay_charge_result(uuid, text, text, text, text, text, date)',
    'public.autopay_mandate_audit()',
    'public.recurring_template_same_org()',
    'public.payment_plan_installments_same_org()'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;

  -- pure helpers (no data access)
  foreach f in array array[
    'public.plan_month_day(integer, integer, integer, integer)',
    'public.plan_due_dates(date, integer, boolean, text, integer, date[])',
    'public.plan_split(numeric, integer, text)',
    'public.plan_fee(text, numeric, numeric, text)',
    'public.recurring_period_bounds(date, integer, text, date)',
    'public.recurring_prorate(numeric, date, date, date, text, text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;
end $$;
