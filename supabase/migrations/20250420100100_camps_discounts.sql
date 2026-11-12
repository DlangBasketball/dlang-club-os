-- ============================================================================
-- Club OS — Camps (editions, price options, age groups, time slots) and the
-- shared DISCOUNTS model.
--
-- Design
--   * A camp is a programme with kind = 'camp' (public.programs). Its
--     EDITIONS (dates, venue, capacity, registration window, status) are rows
--     of camp_editions under that programme, so one camp page lists all its
--     weeks and shares its price options, age groups and time slots.
--   * camp_price_options / camp_time_slots: edition_id null = applies to every
--     edition of the camp; set = only that edition (overrides the camp rows).
--   * camp_age_groups belong to the camp (optionally linked to a time slot).
--   * registrations gain the chosen edition / option / age group / days /
--     lunch and a frozen PRICE SNAPSHOT (list, discount, net, currency, lines).
--     An athlete may join several editions of the same camp, so the old
--     unique (athlete_id, program_id) becomes two partial unique indexes.
--   * discounts: one model for the whole app (camps now, training packages
--     later): percent | fixed_amount, scope all | camps | training | program |
--     service, rule promo_code | sibling | early_bird | manual.
--     applied_discounts records every use with an amount snapshot and links to
--     the registration / invoice line / credit note (or any other source via
--     source + source_id), and is what promo usage limits count.
--   * register_camp(): one transaction for a camp registration (public form
--     or parent app): capacity (row lock), window, days, age group, price
--     integrity, promo limits (row lock), invoice with the option line and
--     negative discount lines. Service role only: the server action computes
--     the quote with the pure pricing function and this RPC re-checks it.
--   * apply_manual_discount(): admin / finance applies a discount to an
--     existing camp registration (negative line on a draft invoice, credit
--     note on an issued one).
--
-- Additive and idempotent. Tenant scope: every policy and RPC resolves the
-- org server-side (current_org_id() or the programme's org), never from input.
-- ============================================================================

-- ===========================================================================
-- 1) CAMP EDITIONS
-- ===========================================================================
create table if not exists public.camp_editions (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations(id) on delete cascade,
  program_id             uuid not null references public.programs(id) on delete cascade,
  name                   text,                          -- optional label, e.g. "Easter week"
  starts_on              date not null,
  ends_on                date not null,
  venue_id               uuid references public.venues(id) on delete set null,
  location_name          text,                          -- free place name when not a club venue
  address                text,
  city                   text,
  capacity               integer,
  registration_opens_at  timestamptz,
  registration_closes_at timestamptz,
  status                 text not null default 'draft',
  notes                  text,
  archived_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists idx_camp_editions_org on public.camp_editions(org_id);
create index if not exists idx_camp_editions_program on public.camp_editions(program_id, starts_on);

do $$ begin
  alter table public.camp_editions add constraint camp_editions_dates_chk check (ends_on >= starts_on and ends_on - starts_on <= 62);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.camp_editions add constraint camp_editions_status_chk check (status in ('draft', 'published', 'archived', 'cancelled'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.camp_editions add constraint camp_editions_capacity_chk check (capacity is null or capacity between 1 and 100000);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.camp_editions add constraint camp_editions_window_chk
    check (registration_opens_at is null or registration_closes_at is null or registration_closes_at > registration_opens_at);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.camp_editions add constraint camp_editions_text_len_chk
    check (coalesce(length(name), 0) <= 120 and coalesce(length(location_name), 0) <= 200
       and coalesce(length(address), 0) <= 200 and coalesce(length(city), 0) <= 100
       and coalesce(length(notes), 0) <= 2000);
exception when duplicate_object then null; end $$;

drop trigger if exists trg_camp_editions_updated on public.camp_editions;
create trigger trg_camp_editions_updated before update on public.camp_editions
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 2) TIME SLOTS (daily), AGE GROUPS, PRICE OPTIONS
-- ===========================================================================
create table if not exists public.camp_time_slots (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  program_id  uuid not null references public.programs(id) on delete cascade,
  edition_id  uuid references public.camp_editions(id) on delete cascade,  -- null = every edition
  label       text not null,
  starts_at   time not null,
  ends_at     time not null,
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_camp_time_slots_org on public.camp_time_slots(org_id);
create index if not exists idx_camp_time_slots_program on public.camp_time_slots(program_id, sort);
do $$ begin
  alter table public.camp_time_slots add constraint camp_time_slots_chk
    check (ends_at > starts_at and length(btrim(label)) between 1 and 80);
exception when duplicate_object then null; end $$;
drop trigger if exists trg_camp_time_slots_updated on public.camp_time_slots;
create trigger trg_camp_time_slots_updated before update on public.camp_time_slots
  for each row execute function public.set_updated_at();

create table if not exists public.camp_age_groups (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  program_id    uuid not null references public.programs(id) on delete cascade,
  label         text not null,
  min_age       smallint,
  max_age       smallint,
  time_slot_id  uuid references public.camp_time_slots(id) on delete set null,
  is_active     boolean not null default true,
  sort          integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_camp_age_groups_org on public.camp_age_groups(org_id);
create index if not exists idx_camp_age_groups_program on public.camp_age_groups(program_id, sort);
do $$ begin
  alter table public.camp_age_groups add constraint camp_age_groups_chk
    check (length(btrim(label)) between 1 and 80
       and (min_age is null or min_age between 0 and 99)
       and (max_age is null or max_age between 0 and 99)
       and (min_age is null or max_age is null or max_age >= min_age));
exception when duplicate_object then null; end $$;
drop trigger if exists trg_camp_age_groups_updated on public.camp_age_groups;
create trigger trg_camp_age_groups_updated before update on public.camp_age_groups
  for each row execute function public.set_updated_at();

create table if not exists public.camp_price_options (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  program_id      uuid not null references public.programs(id) on delete cascade,
  edition_id      uuid references public.camp_editions(id) on delete cascade,  -- null = every edition
  label           text not null,
  days_count      smallint not null,
  includes_lunch  boolean not null default false,
  price           numeric(12,2) not null,
  currency        text,               -- null = the programme's / club's currency
  is_active       boolean not null default true,
  sort            integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_camp_price_options_org on public.camp_price_options(org_id);
create index if not exists idx_camp_price_options_program on public.camp_price_options(program_id, sort);
do $$ begin
  alter table public.camp_price_options add constraint camp_price_options_chk
    check (length(btrim(label)) between 1 and 120 and days_count between 1 and 63 and price >= 0
       and (currency is null or currency ~ '^[A-Z]{3}$'));
exception when duplicate_object then null; end $$;
drop trigger if exists trg_camp_price_options_updated on public.camp_price_options;
create trigger trg_camp_price_options_updated before update on public.camp_price_options
  for each row execute function public.set_updated_at();

-- Every reference must stay inside the row's org; the programme must be a camp.
create or replace function public.camps_same_org_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_id  uuid;
begin
  if not exists (select 1 from public.programs where id = new.program_id and org_id = new.org_id) then
    raise exception 'CROSS_TENANT_REFERENCE: program' using errcode = '42501';
  end if;
  if not exists (select 1 from public.programs where id = new.program_id and kind = 'camp') then
    raise exception 'NOT_A_CAMP' using errcode = 'P0001';
  end if;
  v_id := nullif(v_row->>'edition_id', '')::uuid;
  if v_id is not null and not exists (
       select 1 from public.camp_editions where id = v_id and org_id = new.org_id and program_id = new.program_id) then
    raise exception 'CROSS_TENANT_REFERENCE: edition' using errcode = '42501';
  end if;
  v_id := nullif(v_row->>'venue_id', '')::uuid;
  if v_id is not null and not exists (select 1 from public.venues where id = v_id and org_id = new.org_id) then
    raise exception 'CROSS_TENANT_REFERENCE: venue' using errcode = '42501';
  end if;
  v_id := nullif(v_row->>'time_slot_id', '')::uuid;
  if v_id is not null and not exists (
       select 1 from public.camp_time_slots where id = v_id and org_id = new.org_id and program_id = new.program_id) then
    raise exception 'CROSS_TENANT_REFERENCE: time slot' using errcode = '42501';
  end if;
  if tg_table_name = 'camp_price_options' then
    new.currency := upper(nullif(btrim(new.currency), ''));
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['camp_editions', 'camp_time_slots', 'camp_age_groups', 'camp_price_options'] loop
    execute format('drop trigger if exists trg_camps_same_org on public.%I', t);
    execute format('create trigger trg_camps_same_org before insert or update on public.%I
                      for each row execute function public.camps_same_org_check()', t);
  end loop;
end $$;

-- An edition with registrations is archived, never deleted (the programme
-- delete cascade still works once the programme itself may be deleted).
create or replace function public.camp_editions_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.programs where id = old.program_id)
     and exists (select 1 from public.registrations where camp_edition_id = old.id) then
    raise exception 'EDITION_HAS_REGISTRATIONS' using errcode = 'P0001';
  end if;
  return old;
end;
$$;

create or replace function public.camp_editions_status_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'archived' then
    if tg_op = 'INSERT' or old.status is distinct from 'archived' then new.archived_at := now(); end if;
  else
    new.archived_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_camp_editions_status_stamp on public.camp_editions;
create trigger trg_camp_editions_status_stamp before insert or update on public.camp_editions
  for each row execute function public.camp_editions_status_stamp();

-- ===========================================================================
-- 3) DISCOUNTS (shared model) + APPLIED DISCOUNTS
-- ===========================================================================
create table if not exists public.discounts (
  id                          uuid primary key default gen_random_uuid(),
  org_id                      uuid not null references public.organizations(id) on delete cascade,
  name                        text not null,
  description                 text,
  kind                        text not null,              -- percent | fixed_amount
  value                       numeric(12,2) not null,
  currency                    text,                       -- fixed_amount only
  scope                       text not null default 'all',-- all | camps | training | program | service
  scope_program_id            uuid references public.programs(id) on delete cascade,
  scope_service_id            uuid references public.training_services(id) on delete cascade,
  rule                        text not null,              -- promo_code | sibling | early_bird | manual
  code                        text,                       -- promo_code: stored upper-case
  max_redemptions             integer,                    -- promo_code: total uses
  max_redemptions_per_family  integer,                    -- promo_code: uses per family
  valid_from                  timestamptz,
  valid_until                 timestamptz,                -- early_bird: book before this
  sibling_min_position        smallint,                   -- sibling: applies from the nth child (2 = 2nd child on)
  early_bird_days_before      integer,                    -- early_bird: book at least N days before the start
  stackable                   boolean not null default true,
  is_active                   boolean not null default true,
  created_by                  uuid references public.profiles(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
create index if not exists idx_discounts_org on public.discounts(org_id);
create index if not exists idx_discounts_org_rule on public.discounts(org_id, rule) where is_active;
create unique index if not exists discounts_org_code_uidx on public.discounts(org_id, upper(code)) where code is not null;

do $$ begin
  alter table public.discounts add constraint discounts_kind_chk check (kind in ('percent', 'fixed_amount'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.discounts add constraint discounts_value_chk
    check (value > 0 and (kind <> 'percent' or value <= 100));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.discounts add constraint discounts_currency_chk
    check ((kind = 'percent' and currency is null) or (kind = 'fixed_amount' and currency ~ '^[A-Z]{3}$'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.discounts add constraint discounts_scope_chk
    check (scope in ('all', 'camps', 'training', 'program', 'service')
       and (scope <> 'program' or scope_program_id is not null)
       and (scope <> 'service' or scope_service_id is not null));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.discounts add constraint discounts_rule_chk
    check (rule in ('promo_code', 'sibling', 'early_bird', 'manual')
       and (rule <> 'promo_code' or (code is not null and code ~ '^[A-Z0-9_-]{3,40}$'))
       and (rule = 'promo_code' or code is null)
       and (rule <> 'sibling' or coalesce(sibling_min_position, 2) between 2 and 20)
       and (rule <> 'early_bird' or valid_until is not null or early_bird_days_before is not null));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.discounts add constraint discounts_limits_chk
    check ((max_redemptions is null or max_redemptions >= 1)
       and (max_redemptions_per_family is null or max_redemptions_per_family >= 1)
       and (early_bird_days_before is null or early_bird_days_before between 0 and 730)
       and (valid_from is null or valid_until is null or valid_until > valid_from)
       and length(btrim(name)) between 1 and 120 and coalesce(length(description), 0) <= 1000);
exception when duplicate_object then null; end $$;

drop trigger if exists trg_discounts_updated on public.discounts;
create trigger trg_discounts_updated before update on public.discounts
  for each row execute function public.set_updated_at();

create or replace function public.discounts_normalize()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.code := upper(nullif(btrim(new.code), ''));
  new.currency := upper(nullif(btrim(new.currency), ''));
  if new.rule = 'sibling' then new.sibling_min_position := coalesce(new.sibling_min_position, 2); end if;
  if new.scope_program_id is not null
     and not exists (select 1 from public.programs where id = new.scope_program_id and org_id = new.org_id) then
    raise exception 'CROSS_TENANT_REFERENCE: program' using errcode = '42501';
  end if;
  if new.scope_service_id is not null
     and not exists (select 1 from public.training_services where id = new.scope_service_id and org_id = new.org_id) then
    raise exception 'CROSS_TENANT_REFERENCE: service' using errcode = '42501';
  end if;
  if new.scope <> 'program' then new.scope_program_id := null; end if;
  if new.scope <> 'service' then new.scope_service_id := null; end if;
  return new;
end;
$$;
drop trigger if exists trg_discounts_normalize on public.discounts;
create trigger trg_discounts_normalize before insert or update on public.discounts
  for each row execute function public.discounts_normalize();

create table if not exists public.applied_discounts (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations(id) on delete cascade,
  discount_id            uuid not null references public.discounts(id) on delete restrict,
  registration_id        uuid references public.registrations(id) on delete set null,
  invoice_id             uuid references public.invoices(id) on delete set null,
  invoice_item_id        uuid references public.invoice_items(id) on delete set null,
  invoice_adjustment_id  uuid references public.invoice_adjustments(id) on delete set null,
  source                 text not null default 'registration', -- registration | training_package | booking | other
  source_id              uuid,                                 -- id in the source module
  family_id              uuid references public.families(id) on delete set null,
  athlete_id             uuid references public.athletes(id) on delete set null,
  rule                   text not null,
  name                   text not null,       -- snapshot of the discount at the time
  code                   text,
  kind                   text not null,
  value                  numeric(12,2) not null,
  amount                 numeric(12,2) not null,   -- positive: what was taken off
  currency               text not null,
  reason                 text,
  created_by             uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  voided_at              timestamptz,
  void_reason            text
);
create index if not exists idx_applied_discounts_org on public.applied_discounts(org_id);
create index if not exists idx_applied_discounts_discount on public.applied_discounts(discount_id) where voided_at is null;
create index if not exists idx_applied_discounts_registration on public.applied_discounts(registration_id);
create index if not exists idx_applied_discounts_family on public.applied_discounts(family_id);
do $$ begin
  alter table public.applied_discounts add constraint applied_discounts_chk
    check (amount > 0 and currency ~ '^[A-Z]{3}$'
       and source in ('registration', 'training_package', 'booking', 'other')
       and coalesce(length(reason), 0) <= 500 and coalesce(length(void_reason), 0) <= 500);
exception when duplicate_object then null; end $$;

create or replace function public.applied_discounts_same_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.discounts where id = new.discount_id and org_id = new.org_id) then
    raise exception 'CROSS_TENANT_REFERENCE: discount' using errcode = '42501';
  end if;
  if new.registration_id is not null
     and not exists (select 1 from public.registrations where id = new.registration_id and org_id = new.org_id) then
    raise exception 'CROSS_TENANT_REFERENCE: registration' using errcode = '42501';
  end if;
  if new.invoice_id is not null
     and not exists (select 1 from public.invoices where id = new.invoice_id and org_id = new.org_id) then
    raise exception 'CROSS_TENANT_REFERENCE: invoice' using errcode = '42501';
  end if;
  if new.family_id is not null
     and not exists (select 1 from public.families where id = new.family_id and org_id = new.org_id) then
    raise exception 'CROSS_TENANT_REFERENCE: family' using errcode = '42501';
  end if;
  if new.athlete_id is not null
     and not exists (select 1 from public.athletes where id = new.athlete_id and org_id = new.org_id) then
    raise exception 'CROSS_TENANT_REFERENCE: athlete' using errcode = '42501';
  end if;
  -- Amount snapshot is immutable; only the void fields may change.
  if tg_op = 'UPDATE' and (new.amount, new.currency, new.discount_id, new.org_id, new.kind, new.value)
       is distinct from (old.amount, old.currency, old.discount_id, old.org_id, old.kind, old.value) then
    raise exception 'APPLIED_DISCOUNT_LOCKED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_applied_discounts_same_org on public.applied_discounts;
create trigger trg_applied_discounts_same_org before insert or update on public.applied_discounts
  for each row execute function public.applied_discounts_same_org();

-- ===========================================================================
-- 4) REGISTRATIONS: camp choices + price snapshot
-- ===========================================================================
alter table public.registrations
  add column if not exists camp_edition_id        uuid references public.camp_editions(id) on delete restrict,
  add column if not exists camp_price_option_id   uuid references public.camp_price_options(id) on delete set null,
  add column if not exists camp_age_group_id      uuid references public.camp_age_groups(id) on delete set null,
  add column if not exists camp_days              date[],
  add column if not exists camp_includes_lunch    boolean,
  add column if not exists invoice_id             uuid references public.invoices(id) on delete set null,
  add column if not exists price_list_amount      numeric(12,2),
  add column if not exists price_discount_amount  numeric(12,2),
  add column if not exists price_amount           numeric(12,2),
  add column if not exists price_currency         text,
  add column if not exists price_snapshot         jsonb;

create index if not exists idx_registrations_camp_edition on public.registrations(camp_edition_id) where camp_edition_id is not null;

do $$ begin
  alter table public.registrations add constraint registrations_price_chk
    check ((price_amount is null or price_amount >= 0)
       and (price_list_amount is null or price_list_amount >= 0)
       and (price_discount_amount is null or price_discount_amount >= 0)
       and (price_currency is null or price_currency ~ '^[A-Z]{3}$'));
exception when duplicate_object then null; end $$;

-- One registration per athlete per programme, except camps: one per EDITION.
-- (Relaxes the original unique constraint; no data change.)
alter table public.registrations drop constraint if exists registrations_athlete_id_program_id_key;
create unique index if not exists registrations_athlete_program_uidx
  on public.registrations(athlete_id, program_id) where camp_edition_id is null;
create unique index if not exists registrations_athlete_edition_uidx
  on public.registrations(athlete_id, camp_edition_id) where camp_edition_id is not null;

-- The edition must belong to the registration's programme and org.
create or replace function public.registrations_camp_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.camp_edition_id is not null and not exists (
       select 1 from public.camp_editions
        where id = new.camp_edition_id and org_id = new.org_id and program_id = new.program_id) then
    raise exception 'CROSS_TENANT_REFERENCE: edition' using errcode = '42501';
  end if;
  if new.camp_price_option_id is not null and not exists (
       select 1 from public.camp_price_options
        where id = new.camp_price_option_id and org_id = new.org_id and program_id = new.program_id) then
    raise exception 'CROSS_TENANT_REFERENCE: price option' using errcode = '42501';
  end if;
  if new.camp_age_group_id is not null and not exists (
       select 1 from public.camp_age_groups
        where id = new.camp_age_group_id and org_id = new.org_id and program_id = new.program_id) then
    raise exception 'CROSS_TENANT_REFERENCE: age group' using errcode = '42501';
  end if;
  if new.invoice_id is not null and not exists (
       select 1 from public.invoices where id = new.invoice_id and org_id = new.org_id) then
    raise exception 'CROSS_TENANT_REFERENCE: invoice' using errcode = '42501';
  end if;

  -- Families and the parent app register for a camp with editions only
  -- through register_camp() (capacity, days, price snapshot, invoice).
  if tg_op = 'INSERT' and not public.is_service_caller()
     and coalesce(current_setting('app.camp_pricing', true), '') <> 'on'
     and not (public.current_org_id() is not distinct from new.org_id and public.is_finance()) then
    if new.camp_edition_id is not null
       or exists (select 1 from public.camp_editions where program_id = new.program_id) then
      raise exception 'USE_CAMP_REGISTRATION' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_registrations_camp_refs on public.registrations;
create trigger trg_registrations_camp_refs
  before insert or update of org_id, program_id, camp_edition_id, camp_price_option_id, camp_age_group_id, invoice_id
  on public.registrations
  for each row execute function public.registrations_camp_refs();

-- The price snapshot and the camp choices it prices are frozen: only the
-- registration / discount RPCs (app.camp_pricing = on) or the service role
-- may change them. Guardians may still cancel; staff may still edit status.
create or replace function public.registrations_price_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_service_caller() or coalesce(current_setting('app.camp_pricing', true), '') = 'on' then
    return new;
  end if;
  if (new.price_list_amount, new.price_discount_amount, new.price_amount, new.price_currency, new.price_snapshot,
      new.camp_edition_id, new.camp_price_option_id, new.camp_days, new.camp_includes_lunch, new.invoice_id)
     is distinct from
     (old.price_list_amount, old.price_discount_amount, old.price_amount, old.price_currency, old.price_snapshot,
      old.camp_edition_id, old.camp_price_option_id, old.camp_days, old.camp_includes_lunch, old.invoice_id) then
    raise exception 'PRICE_SNAPSHOT_LOCKED' using errcode = 'P0001';
  end if;
  -- A camp registration stays in its camp (move = cancel + new registration).
  if old.camp_edition_id is not null and new.program_id is distinct from old.program_id then
    raise exception 'PRICE_SNAPSHOT_LOCKED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_registrations_price_guard on public.registrations;
create trigger trg_registrations_price_guard
  before update on public.registrations
  for each row execute function public.registrations_price_guard();

-- Also block direct inserts that carry a price snapshot (only the RPC writes one).
create or replace function public.registrations_price_insert_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_service_caller() or coalesce(current_setting('app.camp_pricing', true), '') = 'on' then
    return new;
  end if;
  if new.price_snapshot is not null or new.price_amount is not null or new.price_list_amount is not null
     or new.price_discount_amount is not null or new.camp_price_option_id is not null or new.camp_days is not null then
    raise exception 'PRICE_SNAPSHOT_LOCKED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_registrations_price_insert_guard on public.registrations;
create trigger trg_registrations_price_insert_guard
  before insert on public.registrations
  for each row execute function public.registrations_price_insert_guard();

-- ===========================================================================
-- 4b) FAMILIES: member | guest (non-member who registered from a public
--     camp page; admins can filter them). Existing families are members.
-- ===========================================================================
alter table public.families add column if not exists membership_status text not null default 'member';
do $$ begin
  alter table public.families add constraint families_membership_status_chk check (membership_status in ('member', 'guest'));
exception when duplicate_object then null; end $$;
create index if not exists idx_families_org_membership on public.families(org_id, membership_status);

-- ===========================================================================
-- 5) RLS
-- ===========================================================================
alter table public.camp_editions      enable row level security;
alter table public.camp_time_slots    enable row level security;
alter table public.camp_age_groups    enable row level security;
alter table public.camp_price_options enable row level security;
alter table public.discounts          enable row level security;
alter table public.applied_discounts  enable row level security;

-- Camp catalogue: every member of the club reads it (parent app shows the
-- camps); admins write. Anonymous visitors get the public camp page through
-- the server (service role), never through RLS.
do $$
declare t text;
begin
  foreach t in array array['camp_editions', 'camp_time_slots', 'camp_age_groups', 'camp_price_options'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select using (org_id = public.current_org_id())', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert with check (org_id = public.current_org_id() and public.is_admin())', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update using (org_id = public.current_org_id() and public.is_admin())
                      with check (org_id = public.current_org_id() and public.is_admin())', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete using (org_id = public.current_org_id() and public.is_admin())', t || '_delete', t);
  end loop;
end $$;

-- Discounts (promo codes!) are visible to the club's admin / finance only;
-- families get prices computed server-side.
drop policy if exists discounts_select on public.discounts;
create policy discounts_select on public.discounts for select
  using (org_id = public.current_org_id() and public.is_finance());
drop policy if exists discounts_insert on public.discounts;
create policy discounts_insert on public.discounts for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists discounts_update on public.discounts;
create policy discounts_update on public.discounts for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists discounts_delete on public.discounts;
create policy discounts_delete on public.discounts for delete
  using (org_id = public.current_org_id() and public.is_admin());

-- Applied discounts: finance + the family's guardians read; written by the
-- RPCs (security definer) only; voiding through the RPC as well.
drop policy if exists applied_discounts_select on public.applied_discounts;
create policy applied_discounts_select on public.applied_discounts for select
  using (org_id = public.current_org_id()
         and (public.is_finance() or (family_id is not null and public.is_guardian_of_family(family_id))));
drop policy if exists applied_discounts_no_insert on public.applied_discounts;
create policy applied_discounts_no_insert on public.applied_discounts for insert with check (false);
drop policy if exists applied_discounts_no_update on public.applied_discounts;
create policy applied_discounts_no_update on public.applied_discounts for update using (false) with check (false);
drop policy if exists applied_discounts_no_delete on public.applied_discounts;
create policy applied_discounts_no_delete on public.applied_discounts for delete using (false);

do $$
declare t text;
begin
  foreach t in array array['camp_editions', 'camp_time_slots', 'camp_age_groups', 'camp_price_options', 'discounts', 'applied_discounts'] loop
    execute format('drop policy if exists platform_tenant_isolation on public.%I', t);
    execute format(
      'create policy platform_tenant_isolation on public.%I as restrictive for all
         using (org_id = (select public.current_org_id()))
         with check (org_id = (select public.current_org_id()))', t);
    execute format('drop policy if exists platform_suspension_guard on public.%I', t);
    execute format(
      'create policy platform_suspension_guard on public.%I as restrictive for all
         using (not coalesce(org_id = any ((select public.suspended_org_ids())::uuid[]), false))
         with check (not coalesce(org_id = any ((select public.suspended_org_ids())::uuid[]), false))', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on public.%I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant all on public.%I to service_role', t);
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 6) AUDIT (who changed what)
-- ===========================================================================
do $$
declare t text;
begin
  foreach t in array array['camp_editions', 'camp_time_slots', 'camp_age_groups', 'camp_price_options', 'discounts', 'applied_discounts'] loop
    execute format('drop trigger if exists %I on public.%I', 'trg_audit_' || t, t);
    execute format('create trigger %I after insert or update or delete on public.%I
                      for each row execute function public.audit_trigger()', 'trg_audit_' || t, t);
  end loop;
end $$;

-- ===========================================================================
-- 7) register_camp(payload): one camp registration (public form / parent app)
--
-- payload = {
--   program_id, edition_id, mode: 'public' | 'parent',
--   family_id                              (parent mode; verified by the server),
--   parent: {name,email,phone,address,emergency_name,emergency_phone} (public),
--   children: [{ athlete_id | first_name,last_name,dob,gender,allergies,conditions,medical_notes,
--                age_group_id, price_option_id, days: [date], list_amount,
--                discounts: [{discount_id, amount, code?}] }],
--   consents: [key], ip, registered_by (profile id, parent mode)
-- }
-- Service role only. The caller computed the quote with the pure pricing
-- function; this re-checks everything that money or capacity depends on.
-- ===========================================================================
create or replace function public.register_camp(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_program   public.programs%rowtype;
  v_edition   public.camp_editions%rowtype;
  v_org       uuid;
  v_mode      text := coalesce(p_payload->>'mode', 'public');
  v_children  jsonb := coalesce(p_payload->'children', '[]'::jsonb);
  v_child     jsonb;
  v_disc      jsonb;
  v_opt       public.camp_price_options%rowtype;
  v_grp       public.camp_age_groups%rowtype;
  d           public.discounts%rowtype;
  v_currency  text;
  v_exp       int;
  v_email     citext;
  v_family    uuid;
  v_athlete   uuid;
  v_dob       date;
  v_age       int;
  v_reg       uuid;
  v_invoice   uuid;
  v_invnum    text;
  v_item      uuid;
  v_total     numeric := 0;
  v_list      numeric;
  v_damount   numeric;
  v_dsum      numeric;
  v_nominal   numeric;
  v_days      date[];
  v_taken     int;
  v_used      int;
  v_lines     jsonb;
  v_name      text;
  v_desc      text;
  v_reg_ids   uuid[] := '{}';
  v_ath_ids   uuid[] := '{}';
  v_consent   text;
  v_form      record;
  v_ip        inet;
  v_vpc       boolean;
  v_due       date := (now() + interval '14 days')::date;
  v_by        uuid := nullif(p_payload->>'registered_by', '')::uuid;
begin
  if not public.is_service_caller() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_program from public.programs where id = nullif(p_payload->>'program_id', '')::uuid;
  if not found or v_program.kind <> 'camp' then raise exception 'PROGRAM_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_program.status <> 'published' or (v_mode = 'public' and not v_program.is_public) then
    raise exception 'PROGRAM_NOT_OPEN' using errcode = 'P0001';
  end if;
  v_org := v_program.org_id;

  -- Lock the edition: capacity checks are serialised per edition.
  select * into v_edition from public.camp_editions
   where id = nullif(p_payload->>'edition_id', '')::uuid and program_id = v_program.id and org_id = v_org
   for update;
  if not found then raise exception 'EDITION_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_edition.status <> 'published' then raise exception 'EDITION_NOT_OPEN' using errcode = 'P0001'; end if;
  if (v_edition.registration_opens_at is not null and now() < v_edition.registration_opens_at)
     or (v_edition.registration_closes_at is not null and now() >= v_edition.registration_closes_at)
     or (v_edition.registration_closes_at is null and current_date > v_edition.starts_on) then
    raise exception 'REGISTRATION_CLOSED' using errcode = 'P0001';
  end if;

  if jsonb_typeof(v_children) <> 'array' or jsonb_array_length(v_children) < 1 then
    raise exception 'NO_CHILDREN' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_children) > 10 then raise exception 'TOO_MANY_CHILDREN' using errcode = 'P0001'; end if;

  if v_edition.capacity is not null then
    select count(*) into v_taken from public.registrations
     where camp_edition_id = v_edition.id and status in ('pending', 'confirmed');
    if v_taken + jsonb_array_length(v_children) > v_edition.capacity then
      raise exception 'EDITION_FULL' using errcode = 'P0001';
    end if;
  end if;

  v_currency := upper(coalesce(v_program.currency, public.org_currency(v_org)));
  v_exp := public.currency_exponent(v_currency);
  begin v_ip := nullif(p_payload->>'ip', '')::inet; exception when others then v_ip := null; end;

  -- ---- family -----------------------------------------------------------
  if v_mode = 'parent' then
    select id into v_family from public.families
     where id = nullif(p_payload->>'family_id', '')::uuid and org_id = v_org;
    if v_family is null then raise exception 'FAMILY_NOT_FOUND' using errcode = 'P0002'; end if;
  elsif v_mode = 'public' then
    v_vpc := public.org_requires_vpc(v_org);
    if v_vpc and exists (
      select 1 from jsonb_array_elements(v_children) c
       where nullif(c->>'dob', '')::date > (current_date - interval '13 years')) then
      raise exception 'VPC_REQUIRED' using errcode = 'P0001';
    end if;
    v_email := nullif(p_payload->'parent'->>'email', '');
    if v_email is null then raise exception 'EMAIL_REQUIRED' using errcode = 'P0001'; end if;
    select id into v_family from public.families where org_id = v_org and contact_email = v_email limit 1;
    if v_family is null then
      -- A family first seen on a public camp page is a guest (non-member).
      insert into public.families (org_id, name, address, phone, contact_name, contact_email, membership_status)
      values (v_org,
              coalesce(nullif(p_payload->>'family_name', ''), (p_payload->'parent'->>'name') || ' family'),
              nullif(p_payload->'parent'->>'address', ''), nullif(p_payload->'parent'->>'phone', ''),
              nullif(p_payload->'parent'->>'name', ''), v_email, 'guest')
      returning id into v_family;
    else
      update public.families set
        phone        = coalesce(nullif(p_payload->'parent'->>'phone', ''), phone),
        address      = coalesce(nullif(p_payload->'parent'->>'address', ''), address),
        contact_name = coalesce(nullif(p_payload->'parent'->>'name', ''), contact_name)
      where id = v_family;
    end if;
  else
    raise exception 'INVALID_MODE' using errcode = 'P0001';
  end if;

  -- ---- invoice header (lines + total below) -------------------------------
  v_invnum := public.next_invoice_number(v_org);
  insert into public.invoices (org_id, number, family_id, program_id, description, status, due_date, currency)
  values (v_org, v_invnum, v_family, v_program.id, v_program.name, 'sent', v_due, v_currency)
  returning id into v_invoice;

  perform set_config('app.camp_pricing', 'on', true);

  for v_child in select * from jsonb_array_elements(v_children)
  loop
    -- athlete
    if v_mode = 'parent' then
      select id, dob into v_athlete, v_dob from public.athletes
       where id = nullif(v_child->>'athlete_id', '')::uuid and org_id = v_org and family_id = v_family;
      if v_athlete is null then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
    else
      v_dob := nullif(v_child->>'dob', '')::date;
      if v_dob is null or v_dob >= current_date then raise exception 'INVALID_DOB' using errcode = 'P0001'; end if;
      insert into public.athletes (org_id, family_id, first_name, last_name, dob, gender, status)
      values (v_org, v_family, btrim(v_child->>'first_name'), btrim(v_child->>'last_name'), v_dob,
              nullif(v_child->>'gender', ''), 'active')
      returning id into v_athlete;
      insert into public.athlete_medical (org_id, athlete_id, allergies, conditions, notes,
                                          emergency_contact_name, emergency_contact_phone)
      values (v_org, v_athlete, nullif(v_child->>'allergies', ''), nullif(v_child->>'conditions', ''),
              nullif(v_child->>'medical_notes', ''),
              nullif(p_payload->'parent'->>'emergency_name', ''), nullif(p_payload->'parent'->>'emergency_phone', ''))
      on conflict (athlete_id) do nothing;
    end if;
    select btrim(first_name || ' ' || last_name) into v_name from public.athletes where id = v_athlete;

    if exists (select 1 from public.registrations
                where athlete_id = v_athlete and camp_edition_id = v_edition.id and status <> 'cancelled') then
      raise exception 'ALREADY_REGISTERED' using errcode = 'P0001';
    end if;

    -- age group: belongs to the camp, child's age on the first day fits
    select * into v_grp from public.camp_age_groups
     where id = nullif(v_child->>'age_group_id', '')::uuid and program_id = v_program.id and org_id = v_org and is_active;
    if not found then raise exception 'AGE_GROUP_NOT_FOUND' using errcode = 'P0002'; end if;
    if v_dob is not null then
      v_age := extract(year from age(v_edition.starts_on, v_dob))::int;
      if (v_grp.min_age is not null and v_age < v_grp.min_age) or (v_grp.max_age is not null and v_age > v_grp.max_age) then
        raise exception 'AGE_OUT_OF_RANGE' using errcode = 'P0001';
      end if;
    end if;

    -- price option: active, this camp, for every edition or this one
    select * into v_opt from public.camp_price_options
     where id = nullif(v_child->>'price_option_id', '')::uuid and program_id = v_program.id and org_id = v_org
       and is_active and (edition_id is null or edition_id = v_edition.id);
    if not found then raise exception 'PRICE_OPTION_NOT_FOUND' using errcode = 'P0002'; end if;
    if upper(coalesce(v_opt.currency, v_currency)) <> v_currency then
      raise exception 'CURRENCY_MISMATCH' using errcode = 'P0001';
    end if;
    -- price integrity: the quote's list amount is the option's current price
    v_list := round(v_opt.price, v_exp);
    if round(coalesce((v_child->>'list_amount')::numeric, -1), v_exp) <> v_list then
      raise exception 'PRICE_CHANGED' using errcode = 'P0001';
    end if;

    -- days: N distinct dates inside the edition
    select coalesce(array_agg(distinct x::date order by x::date), '{}') into v_days
      from jsonb_array_elements_text(coalesce(v_child->'days', '[]'::jsonb)) x;
    if coalesce(array_length(v_days, 1), 0) <> v_opt.days_count
       or jsonb_array_length(coalesce(v_child->'days', '[]'::jsonb)) <> v_opt.days_count
       or exists (select 1 from unnest(v_days) x where x < v_edition.starts_on or x > v_edition.ends_on) then
      raise exception 'INVALID_DAYS' using errcode = 'P0001';
    end if;

    -- discounts: org, active, scope, validity, nominal bound, promo limits
    v_dsum := 0;
    v_lines := '[]'::jsonb;
    for v_disc in select * from jsonb_array_elements(coalesce(v_child->'discounts', '[]'::jsonb))
    loop
      select * into d from public.discounts
       where id = nullif(v_disc->>'discount_id', '')::uuid and org_id = v_org
       for update;
      if not found or not d.is_active then raise exception 'DISCOUNT_NOT_AVAILABLE' using errcode = 'P0001'; end if;
      if d.rule = 'manual' then raise exception 'DISCOUNT_NOT_AVAILABLE' using errcode = 'P0001'; end if;
      if not (d.scope in ('all', 'camps') or (d.scope = 'program' and d.scope_program_id = v_program.id)) then
        raise exception 'DISCOUNT_NOT_AVAILABLE' using errcode = 'P0001';
      end if;
      if (d.valid_from is not null and now() < d.valid_from) or (d.valid_until is not null and now() > d.valid_until) then
        raise exception 'DISCOUNT_EXPIRED' using errcode = 'P0001';
      end if;
      if d.rule = 'early_bird' and d.early_bird_days_before is not null
         and current_date > v_edition.starts_on - d.early_bird_days_before then
        raise exception 'DISCOUNT_EXPIRED' using errcode = 'P0001';
      end if;
      if d.kind = 'fixed_amount' and d.currency <> v_currency then
        raise exception 'CURRENCY_MISMATCH' using errcode = 'P0001';
      end if;
      if d.rule = 'promo_code' then
        if upper(coalesce(v_disc->>'code', '')) <> d.code then raise exception 'PROMO_INVALID' using errcode = 'P0001'; end if;
        if d.max_redemptions is not null then
          select count(*) into v_used from public.applied_discounts where discount_id = d.id and voided_at is null;
          if v_used >= d.max_redemptions then raise exception 'PROMO_LIMIT_REACHED' using errcode = 'P0001'; end if;
        end if;
        if d.max_redemptions_per_family is not null then
          select count(*) into v_used from public.applied_discounts
           where discount_id = d.id and family_id = v_family and voided_at is null;
          if v_used >= d.max_redemptions_per_family then raise exception 'PROMO_FAMILY_LIMIT' using errcode = 'P0001'; end if;
        end if;
      end if;

      v_nominal := case when d.kind = 'percent' then round(v_list * d.value / 100, v_exp) else least(d.value, v_list) end;
      v_damount := round(coalesce((v_disc->>'amount')::numeric, 0), v_exp);
      if v_damount <= 0 or v_damount > v_nominal then raise exception 'DISCOUNT_AMOUNT_INVALID' using errcode = 'P0001'; end if;
      v_dsum := v_dsum + v_damount;
      if v_dsum > v_list then raise exception 'DISCOUNT_AMOUNT_INVALID' using errcode = 'P0001'; end if;
      v_lines := v_lines || jsonb_build_object('discount_id', d.id, 'name', d.name, 'rule', d.rule, 'code', d.code,
                                               'kind', d.kind, 'value', d.value, 'amount', v_damount);
    end loop;

    insert into public.registrations
      (org_id, athlete_id, program_id, status, registered_by, camp_edition_id, camp_price_option_id, camp_age_group_id,
       camp_days, camp_includes_lunch, invoice_id, price_list_amount, price_discount_amount, price_amount, price_currency,
       price_snapshot)
    values
      (v_org, v_athlete, v_program.id, 'pending', v_by, v_edition.id, v_opt.id, v_grp.id,
       v_days, v_opt.includes_lunch, v_invoice, v_list, v_dsum, v_list - v_dsum, v_currency,
       jsonb_build_object(
         'program', v_program.name, 'edition_id', v_edition.id, 'edition_name', v_edition.name,
         'starts_on', v_edition.starts_on, 'ends_on', v_edition.ends_on,
         'option_id', v_opt.id, 'option_label', v_opt.label, 'days_count', v_opt.days_count,
         'includes_lunch', v_opt.includes_lunch, 'age_group', v_grp.label, 'days', to_jsonb(v_days),
         'currency', v_currency, 'list_amount', v_list, 'discount_amount', v_dsum, 'amount', v_list - v_dsum,
         'discounts', v_lines, 'priced_at', now()))
    returning id into v_reg;

    v_desc := v_program.name || ' — ' || v_opt.label || ' — ' || v_name;
    insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
    values (v_org, v_invoice, left(v_desc, 500), 1, v_list, v_list);
    v_total := v_total + v_list;

    for v_disc in select * from jsonb_array_elements(v_lines)
    loop
      v_damount := (v_disc->>'amount')::numeric;
      insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
      values (v_org, v_invoice, left((v_disc->>'name') || ' — ' || v_name, 500), 1, -v_damount, -v_damount)
      returning id into v_item;
      insert into public.applied_discounts
        (org_id, discount_id, registration_id, invoice_id, invoice_item_id, source, source_id, family_id, athlete_id,
         rule, name, code, kind, value, amount, currency, created_by)
      values
        (v_org, (v_disc->>'discount_id')::uuid, v_reg, v_invoice, v_item, 'registration', v_reg, v_family, v_athlete,
         v_disc->>'rule', v_disc->>'name', nullif(v_disc->>'code', ''), v_disc->>'kind', (v_disc->>'value')::numeric,
         v_damount, v_currency, v_by);
      v_total := v_total - v_damount;
    end loop;

    v_reg_ids := v_reg_ids || v_reg;
    v_ath_ids := v_ath_ids || v_athlete;
  end loop;

  perform set_config('app.camp_pricing', 'off', true);

  update public.invoices set total_chf = v_total, registration_id = case when array_length(v_reg_ids, 1) = 1 then v_reg_ids[1] end
   where id = v_invoice;

  -- consent acceptances (latest active version per key) × each athlete
  if jsonb_typeof(p_payload->'consents') = 'array' then
    for v_consent in select jsonb_array_elements_text(p_payload->'consents')
    loop
      select id, version into v_form from public.consent_forms
       where org_id = v_org and key = v_consent and is_active order by version desc limit 1;
      if found then
        for v_athlete in select unnest(v_ath_ids)
        loop
          insert into public.consent_acceptances
            (org_id, athlete_id, consent_form_id, accepted_version, status, program_id, ip_address, accepted_by)
          values (v_org, v_athlete, v_form.id, v_form.version, 'accepted', v_program.id, v_ip, v_by);
        end loop;
      end if;
    end loop;
  end if;

  if v_mode = 'public' and not exists (
    select 1 from public.invitations where org_id = v_org and email = v_email and status = 'pending') then
    insert into public.invitations (org_id, email, role, family_id, status, expires_at)
    values (v_org, v_email, 'parent', v_family, 'pending', now() + interval '30 days');
  end if;

  return jsonb_build_object(
    'family_id', v_family, 'invoice_id', v_invoice, 'invoice_number', v_invnum,
    'total', (select total_chf from public.invoices where id = v_invoice), 'currency', v_currency,
    'registration_ids', to_jsonb(v_reg_ids), 'athlete_ids', to_jsonb(v_ath_ids));
end;
$$;

revoke all on function public.register_camp(jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.register_camp(jsonb) to service_role;
  end if;
end $$;

-- ===========================================================================
-- 8) apply_manual_discount: admin / finance takes a discount off a camp
--    registration after the fact. Draft invoice -> negative line; issued
--    invoice -> credit note (issue_invoice_adjustment, audited there).
-- ===========================================================================
create or replace function public.apply_manual_discount(
  p_registration uuid, p_discount uuid, p_reason text default null, p_amount numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r          public.registrations%rowtype;
  d          public.discounts%rowtype;
  v_inv      public.invoices%rowtype;
  v_exp      int;
  v_amount   numeric;
  v_nominal  numeric;
  v_item     uuid;
  v_adj      uuid;
  v_res      jsonb;
  v_family   uuid;
  v_name     text;
  v_id       uuid;
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if v_reason is not null and length(v_reason) > 500 then raise exception 'REASON_TOO_LONG' using errcode = 'P0001'; end if;

  select * into r from public.registrations where id = p_registration and org_id = public.current_org_id() for update;
  if not found then raise exception 'REGISTRATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if r.price_amount is null or r.price_currency is null then raise exception 'NOT_PRICED' using errcode = 'P0001'; end if;
  if r.status = 'cancelled' then raise exception 'REGISTRATION_CANCELLED' using errcode = 'P0001'; end if;

  select * into d from public.discounts where id = p_discount and org_id = r.org_id;
  if not found or not d.is_active then raise exception 'DISCOUNT_NOT_AVAILABLE' using errcode = 'P0001'; end if;
  if d.kind = 'fixed_amount' and d.currency <> r.price_currency then raise exception 'CURRENCY_MISMATCH' using errcode = 'P0001'; end if;
  if exists (select 1 from public.applied_discounts where registration_id = r.id and discount_id = d.id and voided_at is null) then
    raise exception 'DISCOUNT_ALREADY_APPLIED' using errcode = 'P0001';
  end if;

  v_exp := public.currency_exponent(r.price_currency);
  v_nominal := case when d.kind = 'percent' then round(r.price_list_amount * d.value / 100, v_exp) else d.value end;
  v_amount := least(round(coalesce(p_amount, v_nominal), v_exp), v_nominal, r.price_amount);
  if v_amount <= 0 then raise exception 'NOTHING_TO_DISCOUNT' using errcode = 'P0001'; end if;

  select a.family_id, btrim(a.first_name || ' ' || a.last_name) into v_family, v_name from public.athletes a where a.id = r.athlete_id;

  if r.invoice_id is not null then
    select * into v_inv from public.invoices where id = r.invoice_id and org_id = r.org_id for update;
    if v_inv.status::text = 'draft' then
      insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
      values (r.org_id, v_inv.id, left(d.name || ' — ' || coalesce(v_name, ''), 500), 1, -v_amount, -v_amount)
      returning id into v_item;
      update public.invoices set total_chf = total_chf - v_amount where id = v_inv.id;
    else
      v_res := public.issue_invoice_adjustment(v_inv.id, 'credit_note', v_amount, coalesce(v_reason, d.name), d.name);
      v_adj := (v_res->>'adjustment_id')::uuid;
    end if;
  end if;

  insert into public.applied_discounts
    (org_id, discount_id, registration_id, invoice_id, invoice_item_id, invoice_adjustment_id, source, source_id,
     family_id, athlete_id, rule, name, code, kind, value, amount, currency, reason, created_by)
  values
    (r.org_id, d.id, r.id, r.invoice_id, v_item, v_adj, 'registration', r.id, v_family, r.athlete_id,
     d.rule, d.name, d.code, d.kind, d.value, v_amount, r.price_currency, v_reason, auth.uid())
  returning id into v_id;

  perform set_config('app.camp_pricing', 'on', true);
  update public.registrations
     set price_discount_amount = coalesce(price_discount_amount, 0) + v_amount,
         price_amount = price_amount - v_amount,
         price_snapshot = jsonb_set(
           jsonb_set(coalesce(price_snapshot, '{}'::jsonb), '{discounts}',
             coalesce(price_snapshot->'discounts', '[]'::jsonb) || jsonb_build_object(
               'discount_id', d.id, 'name', d.name, 'rule', d.rule, 'code', d.code, 'kind', d.kind,
               'value', d.value, 'amount', v_amount, 'applied_at', now(), 'applied_by', auth.uid())),
           '{amount}', to_jsonb(price_amount - v_amount))
   where id = r.id;
  perform set_config('app.camp_pricing', 'off', true);

  return jsonb_build_object('applied_discount_id', v_id, 'amount', v_amount, 'currency', r.price_currency,
                            'invoice_item_id', v_item, 'invoice_adjustment_id', v_adj);
end;
$$;

revoke all on function public.apply_manual_discount(uuid, uuid, text, numeric) from public, anon;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.apply_manual_discount(uuid, uuid, text, numeric) to authenticated, service_role;
  end if;
end $$;

-- Internal trigger / helper functions: never callable through the API.
revoke all on function public.camps_same_org_check() from public, anon, authenticated;
revoke all on function public.camp_editions_delete_guard() from public, anon, authenticated;
revoke all on function public.discounts_normalize() from public, anon, authenticated;
revoke all on function public.applied_discounts_same_org() from public, anon, authenticated;
revoke all on function public.registrations_camp_refs() from public, anon, authenticated;

drop trigger if exists trg_camp_editions_delete_guard on public.camp_editions;
create trigger trg_camp_editions_delete_guard before delete on public.camp_editions
  for each row execute function public.camp_editions_delete_guard();
