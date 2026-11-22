-- ============================================================================
-- Billing foundation (phase 1)
--
--   1. Activities: every invoice belongs to exactly one billing activity
--      (club_membership, selection, camp, training, booking, shop, other).
--      Existing rows are classified by rule (activity_source records how).
--   2. Billing entities: the issuing entity of every invoice (route per
--      activity -> default entity), snapshotted at issue, locked afterwards.
--   3. Strict separation: family credit is scoped to an activity; split /
--      child invoices inherit the parent's activity, membership, programme.
--   4. Payment receipts: one transfer allocated across several invoices,
--      each allocation a normal payment row (same path as today).
--   5. Idempotency: client request_id on receipts, allocations, membership
--      issue, manual invoices and carry-forwards.
--   6. Club season settings + an exact instalment schedule (centimes).
--   7. Season-fee memberships with multi-payer split billing.
--   8. Migration of the imported club fees into memberships; anything
--      ambiguous goes to data_review_flags instead of being guessed.
--   9. Payer visibility: a guardian sees the invoices they pay (or, without a
--      payer, the family's); a sponsor share is not shown to the family.
--  10. invoice_source(invoice): the record an invoice was raised for.
--
-- Contract for the app: docs/billing-foundation.md.
-- Additive and idempotent: if not exists / create or replace / drop policy if
-- exists; the data steps only fill new columns and skip rows already done.
-- Synthetic test coverage: tests/db/billing_foundation.sql.
-- ============================================================================

-- ===========================================================================
-- 0. Helpers
-- ===========================================================================
create or replace function public.billing_activities()
returns text[] language sql immutable set search_path = public as $$
  select array['club_membership', 'selection', 'camp', 'training', 'booking', 'shop', 'other']::text[]
$$;

create or replace function public.is_billing_activity(p_activity text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_activity = any(public.billing_activities()), false)
$$;

-- Club-membership fees imported as plain invoices ("Membership fee 2026-27
-- (U14 National) – balance"). Kept in one place so the migration, the insert
-- trigger and the tests agree.
create or replace function public.billing_is_club_fee_text(p_text text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_text ~* '^\s*(club\s+)?membership\s+fee\M|^\s*cotisation\M|^\s*mitglieder-?beitrag\M|^\s*quota\s+(sociale|associativa)\M', false)
$$;

-- Season label in a description: "2026-27", "2026/2027", "2026–27" -> 2026.
create or replace function public.billing_season_label_year(p_text text)
returns integer language sql immutable set search_path = public as $$
  select (regexp_match(coalesce(p_text, ''), '\m(20\d{2})\s*[-/–]\s*(?:20)?\d{2}\M'))[1]::int
$$;

-- Session flags used by the guards below (transaction-local).
create or replace function public.billing_flag_on(p_name text)
returns boolean language sql stable set search_path = public as $$
  select coalesce(current_setting(p_name, true), '') = 'on'
$$;

-- ===========================================================================
-- 1. Review flags (written by the migration and by guards; resolved by staff)
-- ===========================================================================
create table if not exists public.data_review_flags (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  entity_table       text not null,
  entity_id          uuid,
  reason_code        text not null,
  details            jsonb not null default '{}'::jsonb,
  original_reference text,
  resolved_at        timestamptz,
  resolved_by        uuid references public.profiles(id) on delete set null,
  resolution_note    text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint data_review_flags_chk check (
    length(btrim(entity_table)) between 1 and 80
    and reason_code ~ '^[A-Z][A-Z0-9_]{1,62}$'
    and coalesce(length(original_reference), 0) <= 500
    and coalesce(length(resolution_note), 0) <= 1000)
);
create index if not exists idx_data_review_flags_org on public.data_review_flags (org_id, resolved_at, created_at desc);
create unique index if not exists data_review_flags_open_uidx
  on public.data_review_flags (org_id, entity_table, coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid), reason_code)
  where resolved_at is null;

-- Audit rows never carry a bank account in full: the issuing entity's IBAN
-- and the snapshot an invoice keeps of it are redacted (existing entries kept).
create or replace function public.audit_sensitive_columns(p_table text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select case p_table
    when 'athlete_medical'  then array['allergies','conditions','medications','insurance',
                                       'emergency_contact_name','emergency_contact_phone','notes']
    when 'registrations'    then array['notes','cancellation_reason']
    when 'billing_entities' then array['iban','qr_iban']
    when 'invoices'         then array['billing_entity_snapshot']
    else array[]::text[]
  end;
$$;

-- ===========================================================================
-- 2. Billing entities + routing
-- ===========================================================================
create table if not exists public.billing_entities (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  legal_name      text,
  street          text,
  building_number text,
  address_extra   text,
  postal_code     text,
  city            text,
  country         text not null default 'CH',
  vat_number      text,
  iban            text,
  qr_iban         text,
  email           text,
  phone           text,
  is_default      boolean not null default false,
  is_active       boolean not null default true,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint billing_entities_chk check (
    length(btrim(name)) between 1 and 140
    and coalesce(length(legal_name), 0) <= 140
    and coalesce(length(street), 0) <= 70
    and coalesce(length(building_number), 0) <= 16
    and coalesce(length(address_extra), 0) <= 140
    and coalesce(length(postal_code), 0) <= 16
    and coalesce(length(city), 0) <= 35
    and country ~ '^[A-Z]{2}$'
    and coalesce(length(vat_number), 0) <= 40
    and (iban is null or replace(iban, ' ', '') ~ '^[A-Z]{2}[0-9]{2}[0-9A-Z]{10,30}$')
    and (qr_iban is null or replace(qr_iban, ' ', '') ~ '^[A-Z]{2}[0-9]{2}[0-9A-Z]{10,30}$')
    and coalesce(length(email), 0) <= 200
    and coalesce(length(phone), 0) <= 40
    and (not is_default or is_active))
);
create index if not exists idx_billing_entities_org on public.billing_entities (org_id, is_active);
create unique index if not exists billing_entities_one_default on public.billing_entities (org_id) where is_default;

create table if not exists public.billing_entity_routes (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  activity          text not null,
  billing_entity_id uuid not null references public.billing_entities(id) on delete cascade,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint billing_entity_routes_activity_chk check (public.is_billing_activity(activity)),
  constraint billing_entity_routes_org_activity_key unique (org_id, activity)
);
create index if not exists idx_billing_entity_routes_org on public.billing_entity_routes (org_id);
create index if not exists idx_billing_entity_routes_entity on public.billing_entity_routes (billing_entity_id);

-- ===========================================================================
-- 3. Club season settings (app_settings) + seasons
-- ===========================================================================
alter table public.app_settings add column if not exists club_season_start_month smallint not null default 8;
alter table public.app_settings add column if not exists club_installment_count smallint not null default 11;
alter table public.app_settings add column if not exists club_installment_due_day smallint not null default 28;
alter table public.app_settings add column if not exists club_first_installment_month smallint;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_settings_club_billing_chk' and conrelid = 'public.app_settings'::regclass) then
    alter table public.app_settings add constraint app_settings_club_billing_chk check (
      club_season_start_month between 1 and 12
      and club_installment_count between 1 and 12
      and club_installment_due_day between 1 and 31
      and (club_first_installment_month is null or club_first_installment_month between 1 and 12));
  end if;
end $$;

-- ===========================================================================
-- 4. Memberships per season + payers
-- ===========================================================================
alter table public.memberships add column if not exists season_id uuid references public.seasons(id) on delete restrict;
alter table public.memberships add column if not exists kind text;
alter table public.memberships add column if not exists agreed_fee numeric(12,2);
alter table public.memberships add column if not exists installment_count smallint;
alter table public.memberships add column if not exists first_due_month date;
alter table public.memberships add column if not exists due_day smallint;
alter table public.memberships add column if not exists sponsored boolean not null default false;
alter table public.memberships add column if not exists sponsored_notes text;
alter table public.memberships add column if not exists request_id uuid;
alter table public.memberships add column if not exists source text;
-- A season fee is not a typed (membership_types) membership.
alter table public.memberships alter column membership_type_id drop not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'memberships_season_fee_chk' and conrelid = 'public.memberships'::regclass) then
    alter table public.memberships add constraint memberships_season_fee_chk check (
      (kind is null and membership_type_id is not null)
      or (kind = 'season_fee' and season_id is not null and athlete_id is not null and agreed_fee is not null and agreed_fee >= 0
          and (installment_count is null or installment_count between 1 and 24)
          and (due_day is null or due_day between 1 and 31)
          and (first_due_month is null or extract(day from first_due_month) = 1)
          and coalesce(length(sponsored_notes), 0) <= 1000
          and (source is null or source in ('issue', 'migration'))));
  end if;
end $$;
create unique index if not exists memberships_one_season_fee
  on public.memberships (athlete_id, season_id) where kind = 'season_fee' and status <> 'cancelled';
create unique index if not exists memberships_request_uidx on public.memberships (org_id, request_id) where request_id is not null;
create index if not exists idx_memberships_season on public.memberships (season_id) where season_id is not null;

create table if not exists public.membership_payers (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  membership_id    uuid not null references public.memberships(id) on delete cascade,
  sort             smallint not null default 1,
  payer_kind       text not null,
  payer_profile_id uuid references public.profiles(id) on delete set null,
  family_id        uuid references public.families(id) on delete set null,
  payer_name       text,
  payer_email      text,
  share_kind       text not null,
  share_value      numeric(12,2) not null,
  amount           numeric(12,2) not null,
  currency         text not null,
  invoice_id       uuid references public.invoices(id) on delete set null,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint membership_payers_chk check (
    payer_kind in ('guardian', 'family', 'sponsor', 'other')
    and share_kind in ('fixed', 'percent')
    and share_value > 0 and (share_kind <> 'percent' or share_value <= 100)
    and amount >= 0
    and currency ~ '^[A-Z]{3}$'
    and coalesce(length(payer_name), 0) <= 140
    and coalesce(length(payer_email), 0) <= 200
    and sort between 1 and 20)
);
create index if not exists idx_membership_payers_org on public.membership_payers (org_id);
create index if not exists idx_membership_payers_membership on public.membership_payers (membership_id, sort);
create index if not exists idx_membership_payers_invoice on public.membership_payers (invoice_id) where invoice_id is not null;
create index if not exists idx_membership_payers_profile on public.membership_payers (payer_profile_id) where payer_profile_id is not null;

-- ===========================================================================
-- 5. Invoice columns
-- ===========================================================================
alter table public.invoices add column if not exists activity text;
alter table public.invoices add column if not exists activity_source text;
alter table public.invoices add column if not exists billing_entity_id uuid references public.billing_entities(id) on delete restrict;
alter table public.invoices add column if not exists billing_entity_snapshot jsonb;
alter table public.invoices add column if not exists billing_entity_source text;
alter table public.invoices add column if not exists membership_id uuid references public.memberships(id) on delete set null;
alter table public.invoices add column if not exists charge_kind text;
alter table public.invoices add column if not exists request_id uuid;
alter table public.invoices add column if not exists payer_kind text;
alter table public.invoices add column if not exists payer_name text;
create index if not exists idx_invoices_activity on public.invoices (org_id, activity);
create index if not exists idx_invoices_membership on public.invoices (membership_id) where membership_id is not null;
create index if not exists idx_invoices_billing_entity on public.invoices (billing_entity_id) where billing_entity_id is not null;
create unique index if not exists invoices_request_uidx on public.invoices (org_id, request_id) where request_id is not null;

-- Payments: receipt link, idempotency key, informational instalment target.
alter table public.payments add column if not exists receipt_id uuid;
alter table public.payments add column if not exists request_id uuid;
alter table public.payments add column if not exists installment_id uuid;

-- Credits: activity pool (null = unassigned / legacy).
alter table public.family_credit_entries add column if not exists activity text;

-- Bank entries booked as a receipt.
alter table public.bank_entries add column if not exists receipt_id uuid;

-- ===========================================================================
-- 6. Payment receipts
-- ===========================================================================
create table if not exists public.payment_receipts (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  family_id     uuid references public.families(id) on delete set null,
  payer_name    text,
  amount        numeric(12,2) not null,
  currency      text not null,
  received_on   date not null,
  method        text not null,
  reference     text,
  note          text,
  bank_entry_id uuid references public.bank_entries(id) on delete set null,
  request_id    uuid not null,
  status        text not null default 'open',
  voided_at     timestamptz,
  void_reason   text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint payment_receipts_chk check (
    amount > 0
    and currency ~ '^[A-Z]{3}$'
    and public.is_offline_payment_method(method)
    and status in ('open', 'partially_allocated', 'allocated', 'void')
    and coalesce(length(payer_name), 0) <= 140
    and coalesce(length(reference), 0) <= 140
    and coalesce(length(note), 0) <= 1000
    and coalesce(length(void_reason), 0) <= 500),
  constraint payment_receipts_request_key unique (org_id, request_id)
);
create index if not exists idx_payment_receipts_org on public.payment_receipts (org_id, status, received_on desc);
create index if not exists idx_payment_receipts_family on public.payment_receipts (family_id) where family_id is not null;
create unique index if not exists payment_receipts_bank_entry_uidx on public.payment_receipts (bank_entry_id) where bank_entry_id is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_receipt_id_fkey' and conrelid = 'public.payments'::regclass) then
    alter table public.payments add constraint payments_receipt_id_fkey foreign key (receipt_id) references public.payment_receipts(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bank_entries_receipt_id_fkey' and conrelid = 'public.bank_entries'::regclass) then
    alter table public.bank_entries add constraint bank_entries_receipt_id_fkey foreign key (receipt_id) references public.payment_receipts(id) on delete set null;
  end if;
end $$;
create index if not exists idx_payments_receipt on public.payments (receipt_id) where receipt_id is not null;
-- One allocation per invoice per request: a retried allocation never books twice.
create unique index if not exists payments_request_invoice_uidx on public.payments (org_id, request_id, invoice_id)
  where request_id is not null and reverses_payment_id is null;

-- ===========================================================================
-- 7. Billing entity helpers
-- ===========================================================================
create or replace function public.billing_entity_snapshot_of(p_entity uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'id', e.id, 'name', e.name, 'legal_name', e.legal_name, 'street', e.street,
           'building_number', e.building_number, 'address_extra', e.address_extra, 'postal_code', e.postal_code,
           'city', e.city, 'country', e.country, 'vat_number', e.vat_number,
           'iban', nullif(replace(coalesce(e.iban, ''), ' ', ''), ''),
           'qr_iban', nullif(replace(coalesce(e.qr_iban, ''), ' ', ''), ''),
           'email', e.email, 'phone', e.phone, 'captured_at', now())
    from public.billing_entities e where e.id = p_entity
$$;

-- Route for (org, activity) -> the org's default entity -> none.
create or replace function public.billing_entity_resolve(p_org uuid, p_activity text)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select r.billing_entity_id from public.billing_entity_routes r join public.billing_entities e on e.id = r.billing_entity_id
      where r.org_id = p_org and r.activity = p_activity and e.is_active and e.org_id = p_org),
    (select e.id from public.billing_entities e where e.org_id = p_org and e.is_default and e.is_active limit 1))
$$;

-- Activity a new invoice gets from what it is linked to (null = no rule).
create or replace function public.billing_derive_activity(p_org uuid, p_program uuid, p_registration uuid, p_membership uuid,
                                                          p_split_from uuid, p_description text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text; r record;
begin
  if p_split_from is not null then
    select activity into v from public.invoices where id = p_split_from and org_id = p_org;
    if v is not null then return v; end if;
  end if;
  if p_membership is not null then return 'club_membership'; end if;
  if p_registration is not null then
    select reg.camp_edition_id, p.kind::text as kind into r
      from public.registrations reg left join public.programs p on p.id = reg.program_id
     where reg.id = p_registration and reg.org_id = p_org;
    if r.camp_edition_id is not null or r.kind = 'camp' then return 'camp'; end if;
    if r.kind = 'selection' then return 'selection'; end if;
  end if;
  if p_program is not null then
    select kind::text into v from public.programs where id = p_program and org_id = p_org;
    if v = 'selection' then return 'selection'; end if;
    if v = 'camp' then return 'camp'; end if;
    return null;
  end if;
  if public.billing_is_club_fee_text(p_description) then return 'club_membership'; end if;
  return null;
end $$;

-- ===========================================================================
-- 8. Invoice triggers: activity, issuing entity, inheritance, locks
-- ===========================================================================
create or replace function public.invoices_billing_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p public.invoices;
  v_entity uuid;
begin
  -- A split / child invoice inherits the parent's activity, membership,
  -- programme and issuing entity; it never carries the parent's request id.
  if new.split_from_invoice_id is not null then
    select * into p from public.invoices where id = new.split_from_invoice_id;
    if found then
      if p.org_id <> new.org_id then raise exception 'CROSS_ORG_REFERENCE: split_from_invoice_id' using errcode = 'P0001'; end if;
      if (new.activity is not null and new.activity is distinct from p.activity)
         or new.membership_id is distinct from p.membership_id
         or new.program_id is distinct from p.program_id then
        raise exception 'ACTIVITY_MISMATCH: a split invoice keeps the activity, membership and programme of its parent' using errcode = 'P0001';
      end if;
      new.activity := p.activity;
      new.activity_source := p.activity_source;
      new.charge_kind := p.charge_kind;
      if new.billing_entity_id is null then
        new.billing_entity_id := p.billing_entity_id;
        new.billing_entity_snapshot := p.billing_entity_snapshot;
        new.billing_entity_source := p.billing_entity_source;
      end if;
    end if;
    new.request_id := null;
  end if;

  if new.activity is null then
    new.activity := public.billing_derive_activity(new.org_id, new.program_id, new.registration_id, new.membership_id,
                                                   new.split_from_invoice_id, new.description);
    new.activity_source := case when new.activity is null then 'default' else 'derived' end;
    new.activity := coalesce(new.activity, 'other');
  else
    new.activity_source := coalesce(new.activity_source, 'set');
  end if;
  if not public.is_billing_activity(new.activity) then raise exception 'INVALID_ACTIVITY' using errcode = 'P0001'; end if;

  if new.membership_id is not null then
    if new.activity <> 'club_membership' then
      raise exception 'ACTIVITY_MISMATCH: a membership invoice is a club_membership invoice' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.memberships where id = new.membership_id and org_id = new.org_id) then
      raise exception 'CROSS_ORG_REFERENCE: membership_id' using errcode = 'P0001';
    end if;
  end if;
  if new.charge_kind is not null and new.membership_id is null then
    raise exception 'MEMBERSHIP_REQUIRED' using errcode = 'P0001';
  end if;

  -- Issuing entity: explicit (same org, active) -> route -> default.
  if new.billing_entity_id is not null then
    if not exists (select 1 from public.billing_entities where id = new.billing_entity_id and org_id = new.org_id) then
      raise exception 'CROSS_ORG_REFERENCE: billing_entity_id' using errcode = 'P0001';
    end if;
    new.billing_entity_source := coalesce(new.billing_entity_source, 'set');
  else
    v_entity := public.billing_entity_resolve(new.org_id, new.activity);
    if v_entity is not null then
      new.billing_entity_id := v_entity;
      new.billing_entity_source := case when exists (select 1 from public.billing_entity_routes
                                                      where org_id = new.org_id and activity = new.activity and billing_entity_id = v_entity)
                                        then 'route' else 'default' end;
    end if;
  end if;
  if new.billing_entity_id is not null and new.billing_entity_snapshot is null then
    new.billing_entity_snapshot := public.billing_entity_snapshot_of(new.billing_entity_id);
  end if;
  return new;
end $$;

drop trigger if exists trg_invoices_0_billing on public.invoices;
create trigger trg_invoices_0_billing before insert on public.invoices
  for each row execute function public.invoices_billing_before_insert();

create or replace function public.invoices_billing_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_edit   boolean := public.billing_flag_on('app.billing_edit');
  v_entity uuid;
begin
  if not public.is_billing_activity(new.activity) then raise exception 'INVALID_ACTIVITY' using errcode = 'P0001'; end if;

  -- Activity / membership: free on a draft; afterwards only through the
  -- billing functions (link triggers, invoice_set_activity).
  if (new.activity is distinct from old.activity or new.membership_id is distinct from old.membership_id
      or new.charge_kind is distinct from old.charge_kind)
     and old.status::text <> 'draft' and not v_edit then
    raise exception 'ACTIVITY_LOCKED: the activity of an issued invoice cannot change' using errcode = 'P0001';
  end if;
  if new.activity is distinct from old.activity and not v_edit then
    new.activity_source := 'set';
  end if;
  if new.membership_id is not null and new.activity <> 'club_membership' then
    raise exception 'ACTIVITY_MISMATCH: a membership invoice is a club_membership invoice' using errcode = 'P0001';
  end if;
  if new.split_from_invoice_id is not null and new.activity is distinct from old.activity and not v_edit then
    raise exception 'ACTIVITY_MISMATCH: a split invoice keeps the activity of its parent' using errcode = 'P0001';
  end if;

  -- Issuing entity: never changes once issued; on a draft only an admin
  -- (or a server job) may correct it.
  if new.billing_entity_id is distinct from old.billing_entity_id
     or new.billing_entity_snapshot is distinct from old.billing_entity_snapshot then
    if old.status::text <> 'draft' and not v_edit then
      raise exception 'BILLING_ENTITY_LOCKED: the issuing entity of an issued invoice cannot change' using errcode = 'P0001';
    end if;
    if old.status::text = 'draft' and auth.uid() is not null and not public.is_admin() and not v_edit then
      raise exception 'NOT_AUTHORIZED: only an admin can change the issuing entity' using errcode = 'P0001';
    end if;
    if new.billing_entity_id is not null
       and not exists (select 1 from public.billing_entities where id = new.billing_entity_id and org_id = new.org_id) then
      raise exception 'CROSS_ORG_REFERENCE: billing_entity_id' using errcode = 'P0001';
    end if;
    if new.billing_entity_id is distinct from old.billing_entity_id then
      new.billing_entity_snapshot := case when new.billing_entity_id is null then null
                                          else public.billing_entity_snapshot_of(new.billing_entity_id) end;
      if not v_edit then new.billing_entity_source := 'set'; end if;
    end if;
  end if;

  if old.status::text = 'draft' then
    -- A draft whose activity changed is re-routed (unless an entity was chosen).
    if new.activity is distinct from old.activity and coalesce(new.billing_entity_source, 'default') in ('route', 'default')
       and new.billing_entity_id is not distinct from old.billing_entity_id then
      v_entity := public.billing_entity_resolve(new.org_id, new.activity);
      if v_entity is not null and v_entity is distinct from new.billing_entity_id then
        new.billing_entity_id := v_entity;
        new.billing_entity_snapshot := public.billing_entity_snapshot_of(v_entity);
      end if;
    end if;
    -- Issuing a draft captures the entity as it is now.
    if new.status::text <> 'draft' and new.billing_entity_id is not null then
      new.billing_entity_snapshot := public.billing_entity_snapshot_of(new.billing_entity_id);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_invoices_0_billing_guard on public.invoices;
create trigger trg_invoices_0_billing_guard before update on public.invoices
  for each row execute function public.invoices_billing_guard();

-- Records created around an invoice (booking, package, shop order, legacy
-- membership, selection enrolment, registration) classify an invoice that
-- no rule could classify; the issuing entity follows the new activity while
-- the invoice is still being created (same transaction).
create or replace function public.billing_link_invoice_activity(p_invoice uuid, p_activity text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.invoices; v_entity uuid;
begin
  if p_invoice is null or p_activity is null then return; end if;
  select * into v from public.invoices where id = p_invoice;
  if not found or v.activity = p_activity then return; end if;
  if not (v.activity = 'other' and coalesce(v.activity_source, 'default') in ('default', 'migration_default')) then return; end if;
  if v.membership_id is not null or v.split_from_invoice_id is not null then return; end if;
  v_entity := v.billing_entity_id;
  if coalesce(v.billing_entity_source, 'default') in ('route', 'default') and (v.status::text = 'draft' or v.created_at = now()) then
    v_entity := coalesce(public.billing_entity_resolve(v.org_id, p_activity), v.billing_entity_id);
  end if;
  perform set_config('app.billing_edit', 'on', true);
  update public.invoices
     set activity = p_activity, activity_source = 'linked',
         billing_entity_id = v_entity,
         billing_entity_snapshot = case when v_entity is distinct from v.billing_entity_id
                                        then public.billing_entity_snapshot_of(v_entity) else billing_entity_snapshot end
   where id = p_invoice;
  perform set_config('app.billing_edit', 'off', true);
  -- Split children follow their parent.
  perform set_config('app.billing_edit', 'on', true);
  update public.invoices set activity = p_activity, activity_source = 'linked'
   where split_from_invoice_id = p_invoice and activity is distinct from p_activity;
  perform set_config('app.billing_edit', 'off', true);
end $$;

create or replace function public.billing_link_activity_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_activity text := tg_argv[0];
begin
  if new.invoice_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.invoice_id is not distinct from old.invoice_id then return new; end if;
  if tg_table_name = 'registrations' then
    v_activity := public.billing_derive_activity(new.org_id, new.program_id, new.id, null, null, null);
  end if;
  perform public.billing_link_invoice_activity(new.invoice_id, v_activity);
  return new;
end $$;

drop trigger if exists trg_billing_link_activity on public.training_bookings;
create trigger trg_billing_link_activity after insert or update of invoice_id on public.training_bookings
  for each row execute function public.billing_link_activity_trigger('booking');
drop trigger if exists trg_billing_link_activity on public.training_package_purchases;
create trigger trg_billing_link_activity after insert or update of invoice_id on public.training_package_purchases
  for each row execute function public.billing_link_activity_trigger('training');
drop trigger if exists trg_billing_link_activity on public.shop_orders;
create trigger trg_billing_link_activity after insert or update of invoice_id on public.shop_orders
  for each row execute function public.billing_link_activity_trigger('shop');
drop trigger if exists trg_billing_link_activity on public.memberships;
create trigger trg_billing_link_activity after insert or update of invoice_id on public.memberships
  for each row execute function public.billing_link_activity_trigger('club_membership');
drop trigger if exists trg_billing_link_activity on public.program_applications;
create trigger trg_billing_link_activity after insert or update of invoice_id on public.program_applications
  for each row execute function public.billing_link_activity_trigger('selection');
drop trigger if exists trg_billing_link_activity on public.registrations;
create trigger trg_billing_link_activity after insert or update of invoice_id on public.registrations
  for each row execute function public.billing_link_activity_trigger(null);

-- ===========================================================================
-- 9. Credits scoped to an activity
-- ===========================================================================
-- Balance of one pool; p_activity null = the unassigned (legacy / manual) pool.
create or replace function public.family_credit_balance_activity(p_family uuid, p_currency text, p_activity text)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from public.family_credit_entries
   where family_id = p_family and currency = upper(p_currency) and activity is not distinct from p_activity
$$;

create or replace function public.family_credit_entries_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_pool numeric; v_total numeric;
begin
  if new.activity is null and new.invoice_id is not null and not public.billing_flag_on('app.credit_unassigned') then
    select activity into new.activity from public.invoices where id = new.invoice_id;
  end if;
  if new.activity is not null and not public.is_billing_activity(new.activity) then
    raise exception 'INVALID_ACTIVITY' using errcode = 'P0001';
  end if;
  -- No pool may go negative: club credit never pays a selection invoice.
  if new.amount < 0 then
    v_pool := public.family_credit_balance_activity(new.family_id, new.currency, new.activity);
    if v_pool + new.amount < 0 then
      v_total := public.family_credit_balance(new.family_id, new.currency);
      if v_total + new.amount >= 0 then
        raise exception 'ACTIVITY_MISMATCH: the credit belongs to another activity' using errcode = 'P0001';
      end if;
      raise exception 'CREDIT_NEGATIVE' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_family_credit_activity on public.family_credit_entries;
create trigger trg_family_credit_activity before insert on public.family_credit_entries
  for each row execute function public.family_credit_entries_activity();

-- Apply credit to an invoice: the invoice's activity pool first, then the
-- unassigned pool; credit of another activity is never used (ACTIVITY_MISMATCH).
create or replace function public.apply_family_credit(p_invoice uuid, p_amount numeric default null, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v        public.invoices;
  v_before jsonb;
  v_open   numeric;
  v_pool   numeric;
  v_free   numeric;
  v_credit numeric;
  v_amount numeric;
  v_from_pool numeric;
  v_pay    uuid;
  v_reason text := coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Family credit');
begin
  v := public.money_invoice_for_update(p_invoice);
  if v.status::text in ('draft', 'cancelled', 'void', 'written_off') then raise exception 'INVOICE_NOT_PAYABLE' using errcode = 'P0001'; end if;
  perform 1 from public.families where id = v.family_id for update;
  v_before := public.invoice_money_snapshot(v.id);
  v_open := (v.total_chf + v.adjustments_total) - public.invoice_net_paid(v.id);
  if v_open <= 0 then raise exception 'NOTHING_DUE' using errcode = 'P0001'; end if;
  v_pool := greatest(public.family_credit_balance_activity(v.family_id, v.currency, v.activity), 0);
  v_free := greatest(public.family_credit_balance_activity(v.family_id, v.currency, null), 0);
  v_credit := v_pool + v_free;
  if v_credit <= 0 then
    if public.family_credit_balance(v.family_id, v.currency) > 0 then
      raise exception 'ACTIVITY_MISMATCH: the family credit belongs to another activity' using errcode = 'P0001';
    end if;
    raise exception 'NO_CREDIT' using errcode = 'P0001';
  end if;
  v_amount := round(coalesce(p_amount, least(v_open, v_credit)), public.currency_exponent(v.currency));
  if v_amount <= 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
  if v_amount > least(v_open, v_credit) then
    if v_amount <= v_open and public.family_credit_balance(v.family_id, v.currency) >= v_amount then
      raise exception 'ACTIVITY_MISMATCH: the family credit belongs to another activity' using errcode = 'P0001';
    end if;
    raise exception 'AMOUNT_TOO_HIGH' using errcode = 'P0001';
  end if;

  insert into public.payments (org_id, invoice_id, amount_chf, currency, method, status, method_detail, recorded_by, paid_at, notes)
  values (v.org_id, v.id, v_amount, v.currency, 'manual', 'succeeded', 'family_credit', auth.uid(), now(), v_reason)
  returning id into v_pay;
  v_from_pool := least(v_amount, v_pool);
  if v_from_pool > 0 then
    insert into public.family_credit_entries (org_id, family_id, amount, currency, kind, invoice_id, payment_id, reason, created_by, activity)
    values (v.org_id, v.family_id, -v_from_pool, v.currency, 'applied', v.id, v_pay, v_reason, auth.uid(), v.activity);
  end if;
  if v_amount - v_from_pool > 0 then
    perform set_config('app.credit_unassigned', 'on', true);
    insert into public.family_credit_entries (org_id, family_id, amount, currency, kind, invoice_id, payment_id, reason, created_by, activity)
    values (v.org_id, v.family_id, -(v_amount - v_from_pool), v.currency, 'applied', v.id, v_pay, v_reason, auth.uid(), null);
    perform set_config('app.credit_unassigned', 'off', true);
  end if;

  perform public.recompute_invoice(v.id);
  perform public.refresh_invoice_overdue(v.id);
  perform public.money_audit(v.org_id, 'FAMILY_CREDIT_APPLIED', 'payments', v_pay, v_before,
    public.invoice_money_snapshot(v.id) || jsonb_build_object(
      'invoice_id', v.id, 'payment_id', v_pay, 'family_id', v.family_id, 'amount_chf', v_amount, 'activity', v.activity,
      'family_credit', public.family_credit_balance(v.family_id, v.currency)));

  return jsonb_build_object('payment_id', v_pay, 'amount', v_amount, 'activity', v.activity,
                            'family_credit', public.family_credit_balance(v.family_id, v.currency),
                            'activity_credit', public.family_credit_balance_activity(v.family_id, v.currency, v.activity));
end;
$$;

-- Manual credit with an activity (the 4-argument version stays: unassigned).
create or replace function public.adjust_family_credit(p_family uuid, p_currency text, p_amount numeric, p_reason text, p_activity text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid;
  v_cur    text := upper(coalesce(p_currency, ''));
  v_amount numeric;
  v_before numeric;
  v_id     uuid;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if v_cur !~ '^[A-Z]{3}$' then raise exception 'INVALID_CURRENCY' using errcode = 'P0001'; end if;
  if p_activity is not null and not public.is_billing_activity(p_activity) then raise exception 'INVALID_ACTIVITY' using errcode = 'P0001'; end if;
  select org_id into v_org from public.families where id = p_family and org_id = public.current_org_id() for update;
  if not found then raise exception 'FAMILY_NOT_FOUND' using errcode = 'P0002'; end if;
  v_amount := round(coalesce(p_amount, 0), public.currency_exponent(v_cur));
  if v_amount = 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
  v_before := public.family_credit_balance_activity(p_family, v_cur, p_activity);
  if v_before + v_amount < 0 then raise exception 'CREDIT_NEGATIVE' using errcode = 'P0001'; end if;

  insert into public.family_credit_entries (org_id, family_id, amount, currency, kind, reason, created_by, activity)
  values (v_org, p_family, v_amount, v_cur, 'manual', btrim(p_reason), auth.uid(), p_activity)
  returning id into v_id;

  perform public.money_audit(v_org, 'FAMILY_CREDIT_ADJUSTED', 'family_credit_entries', v_id,
    jsonb_build_object('family_id', p_family, 'currency', v_cur, 'activity', p_activity, 'balance', v_before),
    jsonb_build_object('family_id', p_family, 'currency', v_cur, 'activity', p_activity, 'amount', v_amount,
                       'balance', v_before + v_amount, 'reason', btrim(p_reason)));
  return jsonb_build_object('entry_id', v_id, 'balance', v_before + v_amount, 'activity', p_activity);
end;
$$;

-- Move unassigned (legacy) credit into one activity's pool.
create or replace function public.family_credit_assign_activity(p_family uuid, p_currency text, p_activity text, p_amount numeric, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid; v_cur text := upper(coalesce(p_currency, '')); v_amount numeric; v_free numeric; v_out uuid; v_in uuid;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if not public.is_billing_activity(p_activity) then raise exception 'INVALID_ACTIVITY' using errcode = 'P0001'; end if;
  if v_cur !~ '^[A-Z]{3}$' then raise exception 'INVALID_CURRENCY' using errcode = 'P0001'; end if;
  select org_id into v_org from public.families where id = p_family and org_id = public.current_org_id() for update;
  if not found then raise exception 'FAMILY_NOT_FOUND' using errcode = 'P0002'; end if;
  v_amount := round(coalesce(p_amount, 0), public.currency_exponent(v_cur));
  if v_amount <= 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
  v_free := public.family_credit_balance_activity(p_family, v_cur, null);
  if v_amount > v_free then raise exception 'AMOUNT_TOO_HIGH' using errcode = 'P0001'; end if;
  insert into public.family_credit_entries (org_id, family_id, amount, currency, kind, reason, created_by, activity)
  values (v_org, p_family, -v_amount, v_cur, 'manual', btrim(p_reason), auth.uid(), null) returning id into v_out;
  insert into public.family_credit_entries (org_id, family_id, amount, currency, kind, reason, created_by, activity)
  values (v_org, p_family, v_amount, v_cur, 'manual', btrim(p_reason), auth.uid(), p_activity) returning id into v_in;
  perform public.money_audit(v_org, 'FAMILY_CREDIT_ASSIGNED', 'family_credit_entries', v_in,
    jsonb_build_object('family_id', p_family, 'currency', v_cur, 'unassigned', v_free),
    jsonb_build_object('family_id', p_family, 'currency', v_cur, 'activity', p_activity, 'amount', v_amount, 'reason', btrim(p_reason)));
  return jsonb_build_object('activity', p_activity, 'amount', v_amount,
                            'unassigned', public.family_credit_balance_activity(p_family, v_cur, null),
                            'activity_credit', public.family_credit_balance_activity(p_family, v_cur, p_activity));
end;
$$;

-- Open money per activity and currency for one family (RLS applies: a
-- guardian only counts the invoices they can see; another club sees nothing).
create or replace function public.family_balance_by_activity(p_family uuid)
returns table (activity text, currency text, open_count integer, amount_due numeric, paid numeric, balance numeric,
               overdue_count integer, overdue_balance numeric, credit numeric)
language sql
stable
security invoker
set search_path = public
as $$
  with inv as (
    select i.activity, i.currency, i.status::text as status, i.due_date,
           (i.total_chf + coalesce(i.adjustments_total, 0)) as due,
           public.invoice_net_paid(i.id) as paid
      from public.invoices i
     where i.family_id = p_family and i.status::text in ('pending', 'sent', 'partially_paid', 'overdue')
  ), open_money as (
    select activity, currency, count(*)::int as open_count, sum(due) as amount_due, sum(paid) as paid,
           sum(greatest(due - paid, 0)) as balance,
           count(*) filter (where status = 'overdue' or (due_date is not null and due_date < current_date))::int as overdue_count,
           coalesce(sum(greatest(due - paid, 0)) filter (where status = 'overdue' or (due_date is not null and due_date < current_date)), 0) as overdue_balance
      from inv group by activity, currency
  ), cred as (
    select coalesce(c.activity, 'unassigned') as activity, c.currency, sum(c.amount) as credit
      from public.family_credit_entries c where c.family_id = p_family
     group by coalesce(c.activity, 'unassigned'), c.currency
  )
  select coalesce(o.activity, c.activity), coalesce(o.currency, c.currency),
         coalesce(o.open_count, 0), coalesce(o.amount_due, 0), coalesce(o.paid, 0), coalesce(o.balance, 0),
         coalesce(o.overdue_count, 0), coalesce(o.overdue_balance, 0), coalesce(c.credit, 0)
    from open_money o full join cred c on c.activity = o.activity and c.currency = o.currency
   where coalesce(o.open_count, 0) > 0 or coalesce(c.credit, 0) <> 0
   order by 1, 2
$$;

-- ===========================================================================
-- 10. Payments <-> receipts
-- ===========================================================================
create or replace function public.payments_receipt_link()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.reverses_payment_id is not null then
    -- A reversal frees the money on the receipt again.
    select receipt_id into new.receipt_id from public.payments where id = new.reverses_payment_id;
    new.request_id := null;
    return new;
  end if;
  if new.receipt_id is null then
    new.receipt_id := nullif(current_setting('app.receipt_id', true), '')::uuid;
  end if;
  if new.request_id is null then
    new.request_id := nullif(current_setting('app.payment_request_id', true), '')::uuid;
  end if;
  if new.installment_id is null then
    new.installment_id := nullif(current_setting('app.installment_id', true), '')::uuid;
  end if;
  if new.receipt_id is not null and not exists (select 1 from public.payment_receipts where id = new.receipt_id and org_id = new.org_id) then
    raise exception 'CROSS_ORG_REFERENCE: receipt_id' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_payments_receipt_link on public.payments;
create trigger trg_payments_receipt_link before insert on public.payments
  for each row execute function public.payments_receipt_link();

create or replace function public.receipt_allocated(p_receipt uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount_chf), 0) from public.payments where receipt_id = p_receipt
$$;

create or replace function public.receipt_refresh_status(p_receipt uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.payment_receipts; v_alloc numeric; v_status text;
begin
  select * into r from public.payment_receipts where id = p_receipt;
  if not found or r.status = 'void' then return; end if;
  v_alloc := public.receipt_allocated(p_receipt);
  v_status := case when v_alloc <= 0 then 'open' when v_alloc < r.amount then 'partially_allocated' else 'allocated' end;
  if v_status is distinct from r.status then
    update public.payment_receipts set status = v_status where id = p_receipt;
  end if;
end $$;

create or replace function public.payments_receipt_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.receipt_id is not null then perform public.receipt_refresh_status(new.receipt_id); end if;
  return new;
end $$;

drop trigger if exists trg_payments_receipt_status on public.payments;
create trigger trg_payments_receipt_status after insert on public.payments
  for each row execute function public.payments_receipt_status();

-- A receipt allocation is corrected by voiding it and allocating again, not
-- by editing the payment (the replacement would lose the receipt link).
create or replace function public.payments_receipt_edit_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.replaced_by_payment_id is not null and old.replaced_by_payment_id is null and new.receipt_id is not null then
    raise exception 'RECEIPT_PAYMENT_LOCKED: void the allocation and allocate the receipt again' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_payments_receipt_edit_guard on public.payments;
create trigger trg_payments_receipt_edit_guard after update of replaced_by_payment_id on public.payments
  for each row execute function public.payments_receipt_edit_guard();

-- ===========================================================================
-- 11. Same-org / updated_at / audit triggers + RLS for the new tables
-- ===========================================================================
drop trigger if exists trg_billing_entity_routes_same_org on public.billing_entity_routes;
create trigger trg_billing_entity_routes_same_org before insert or update on public.billing_entity_routes
  for each row execute function public.ca_same_org_guard('billing_entity_id:billing_entities');
drop trigger if exists trg_membership_payers_same_org on public.membership_payers;
create trigger trg_membership_payers_same_org before insert or update on public.membership_payers
  for each row execute function public.ca_same_org_guard('membership_id:memberships', 'family_id:families', 'invoice_id:invoices');
drop trigger if exists trg_payment_receipts_same_org on public.payment_receipts;
create trigger trg_payment_receipts_same_org before insert or update on public.payment_receipts
  for each row execute function public.ca_same_org_guard('family_id:families', 'bank_entry_id:bank_entries');

create or replace function public.memberships_season_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.season_id is not null and not exists (select 1 from public.seasons where id = new.season_id and org_id = new.org_id) then
    raise exception 'CROSS_ORG_REFERENCE: season_id' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_memberships_season_guard on public.memberships;
create trigger trg_memberships_season_guard before insert or update of season_id, org_id on public.memberships
  for each row execute function public.memberships_season_guard();

-- Season dates corrected later (data fix) move the season-fee validity too.
create or replace function public.seasons_sync_memberships()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.starts_on is distinct from old.starts_on or new.ends_on is distinct from old.ends_on then
    update public.memberships set valid_from = new.starts_on, valid_until = new.ends_on
     where season_id = new.id and kind = 'season_fee' and org_id = new.org_id
       and (valid_from, valid_until) is distinct from (new.starts_on, new.ends_on)
       and new.ends_on - new.starts_on <= 731;
  end if;
  return new;
end $$;
drop trigger if exists trg_seasons_sync_memberships on public.seasons;
create trigger trg_seasons_sync_memberships after update of starts_on, ends_on on public.seasons
  for each row execute function public.seasons_sync_memberships();

do $$
declare t text;
begin
  foreach t in array array['billing_entities', 'billing_entity_routes', 'membership_payers', 'payment_receipts', 'data_review_flags'] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$s', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$s for each row execute function public.set_updated_at()', t);
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$s', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.audit_trigger()', t);
    execute format('alter table public.%1$s enable row level security', t);
    execute format('alter table public.%1$s force row level security', t);
    execute format('drop policy if exists platform_tenant_isolation on public.%1$s', t);
    execute format('create policy platform_tenant_isolation on public.%1$s as restrictive for all using (org_id = (select public.current_org_id())) with check (org_id = (select public.current_org_id()))', t);
  end loop;
end $$;

-- billing_entities / routes: admin manages, finance reads.
drop policy if exists billing_entities_select on public.billing_entities;
create policy billing_entities_select on public.billing_entities for select
  using (org_id = public.current_org_id() and public.is_finance());
drop policy if exists billing_entities_insert on public.billing_entities;
create policy billing_entities_insert on public.billing_entities for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists billing_entities_update on public.billing_entities;
create policy billing_entities_update on public.billing_entities for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists billing_entities_delete on public.billing_entities;
create policy billing_entities_delete on public.billing_entities for delete
  using (org_id = public.current_org_id() and public.is_admin()
         and not exists (select 1 from public.invoices i where i.billing_entity_id = billing_entities.id));

drop policy if exists billing_entity_routes_select on public.billing_entity_routes;
create policy billing_entity_routes_select on public.billing_entity_routes for select
  using (org_id = public.current_org_id() and public.is_finance());
drop policy if exists billing_entity_routes_insert on public.billing_entity_routes;
create policy billing_entity_routes_insert on public.billing_entity_routes for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists billing_entity_routes_update on public.billing_entity_routes;
create policy billing_entity_routes_update on public.billing_entity_routes for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists billing_entity_routes_delete on public.billing_entity_routes;
create policy billing_entity_routes_delete on public.billing_entity_routes for delete
  using (org_id = public.current_org_id() and public.is_admin());

-- membership_payers: written only by the membership functions; finance reads,
-- a payer reads their own share, the family's guardians read a family share.
drop policy if exists membership_payers_select on public.membership_payers;
create policy membership_payers_select on public.membership_payers for select
  using (org_id = public.current_org_id()
         and (public.is_finance()
              or payer_profile_id = auth.uid()
              or (payer_kind = 'family' and family_id is not null and public.is_guardian_of_family(family_id))));
drop policy if exists membership_payers_insert on public.membership_payers;
create policy membership_payers_insert on public.membership_payers for insert with check (false);
drop policy if exists membership_payers_update on public.membership_payers;
create policy membership_payers_update on public.membership_payers for update using (false) with check (false);
drop policy if exists membership_payers_delete on public.membership_payers;
create policy membership_payers_delete on public.membership_payers for delete using (false);

-- payment_receipts: finance reads; written only by the receipt functions.
drop policy if exists payment_receipts_select on public.payment_receipts;
create policy payment_receipts_select on public.payment_receipts for select
  using (org_id = public.current_org_id() and public.is_finance());
drop policy if exists payment_receipts_insert on public.payment_receipts;
create policy payment_receipts_insert on public.payment_receipts for insert with check (false);
drop policy if exists payment_receipts_update on public.payment_receipts;
create policy payment_receipts_update on public.payment_receipts for update using (false) with check (false);
drop policy if exists payment_receipts_delete on public.payment_receipts;
create policy payment_receipts_delete on public.payment_receipts for delete using (false);

-- data_review_flags: admin / finance read and resolve; rows come from the
-- migration and server functions only; never deleted (history).
drop policy if exists data_review_flags_select on public.data_review_flags;
create policy data_review_flags_select on public.data_review_flags for select
  using (org_id = public.current_org_id() and public.is_finance());
drop policy if exists data_review_flags_insert on public.data_review_flags;
create policy data_review_flags_insert on public.data_review_flags for insert with check (false);
drop policy if exists data_review_flags_update on public.data_review_flags;
create policy data_review_flags_update on public.data_review_flags for update
  using (org_id = public.current_org_id() and public.is_finance())
  with check (org_id = public.current_org_id() and public.is_finance());
drop policy if exists data_review_flags_delete on public.data_review_flags;
create policy data_review_flags_delete on public.data_review_flags for delete using (false);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update, delete on public.billing_entities, public.billing_entity_routes to authenticated;
    grant select on public.membership_payers, public.payment_receipts to authenticated;
    grant select, update on public.data_review_flags to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.billing_entities, public.billing_entity_routes, public.membership_payers,
                 public.payment_receipts, public.data_review_flags to service_role;
  end if;
end $$;

-- ===========================================================================
-- 12. Payer visibility (invoices, instalment plans)
-- ===========================================================================
-- A guardian sees an issued invoice of their family when they are its payer,
-- or when it has no individual payer and is not a sponsor / third-party
-- share. Admin / finance see everything of their club.
drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices for select
  using (
    public.is_finance()
    or (status <> 'draft'::public.invoice_status
        and public.is_guardian_of_family(family_id)
        and (payer_profile_id = auth.uid()
             or (payer_profile_id is null and coalesce(payer_kind, 'family') not in ('sponsor', 'other'))))
  );

drop policy if exists payment_plans_select on public.payment_plans;
create policy payment_plans_select on public.payment_plans for select
  using (
    (org_id = public.current_org_id() and public.is_finance())
    or (public.is_guardian_of_family(family_id)
        and (invoice_id is null or exists (select 1 from public.invoices i where i.id = payment_plans.invoice_id)))
  );

-- ===========================================================================
-- 13. Organisation default entity (new tenants get one automatically)
-- ===========================================================================
create or replace function public.billing_entity_default_for_org(p_org uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  o public.organizations; s jsonb; c jsonb; v_id uuid; v_iban text; v_qr text;
begin
  select id into v_id from public.billing_entities where org_id = p_org and is_default;
  if v_id is not null then return v_id; end if;
  select * into o from public.organizations where id = p_org;
  if not found then return null; end if;
  select coalesce(settings->'payments', '{}'::jsonb) into s from public.app_settings where org_id = p_org;
  s := coalesce(s, '{}'::jsonb);
  c := coalesce(o.payment_settings->'creditor', '{}'::jsonb);
  v_iban := upper(replace(coalesce(nullif(s->>'iban', ''), nullif(o.payment_settings->>'iban', ''), ''), ' ', ''));
  v_qr   := upper(replace(coalesce(nullif(s->>'qr_iban', ''), nullif(o.payment_settings->>'qr_iban', ''), ''), ' ', ''));
  insert into public.billing_entities (org_id, name, legal_name, street, building_number, postal_code, city, country,
                                       iban, qr_iban, is_default, is_active)
  values (p_org,
          left(coalesce(nullif(btrim(s->>'creditor_name'), ''), nullif(btrim(c->>'name'), ''), o.name), 140),
          left(coalesce(nullif(btrim(s->>'creditor_name'), ''), nullif(btrim(c->>'name'), ''), o.name), 140),
          left(coalesce(nullif(s->>'creditor_street', ''), nullif(c->>'street', '')), 70),
          left(coalesce(nullif(s->>'creditor_building', ''), nullif(c->>'building', '')), 16),
          left(coalesce(nullif(s->>'creditor_zip', ''), nullif(c->>'zip', '')), 16),
          left(coalesce(nullif(s->>'creditor_city', ''), nullif(c->>'city', '')), 35),
          case when upper(coalesce(nullif(s->>'creditor_country', ''), nullif(c->>'country', ''), o.country, 'CH')) ~ '^[A-Z]{2}$'
               then upper(coalesce(nullif(s->>'creditor_country', ''), nullif(c->>'country', ''), o.country, 'CH')) else 'CH' end,
          case when v_iban ~ '^[A-Z]{2}[0-9]{2}[0-9A-Z]{10,30}$' then v_iban end,
          case when v_qr ~ '^[A-Z]{2}[0-9]{2}[0-9A-Z]{10,30}$' then v_qr end,
          true, true)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.organizations_default_billing_entity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.billing_entity_default_for_org(new.id);
  return new;
end $$;
drop trigger if exists trg_organizations_default_billing_entity on public.organizations;
create trigger trg_organizations_default_billing_entity after insert on public.organizations
  for each row execute function public.organizations_default_billing_entity();

-- Rule-based classification of an existing invoice (null = no rule matched).
-- Order: legacy membership link, selection enrolment / programme, camp,
-- training booking (single paid session = 'booking'), training package
-- purchase (multi-session package = 'training'), shop order, imported
-- club-fee description without a programme.
create or replace function public.billing_classify_invoice(p_invoice uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.memberships m where m.invoice_id = i.id) then 'club_membership'
    when exists (select 1 from public.program_applications a where a.invoice_id = i.id) then 'selection'
    when p.kind::text = 'selection' or rp.kind::text = 'selection' then 'selection'
    when reg.camp_edition_id is not null or p.kind::text = 'camp' or rp.kind::text = 'camp'
         or exists (select 1 from public.registrations x where x.invoice_id = i.id and x.camp_edition_id is not null) then 'camp'
    when exists (select 1 from public.training_bookings b where b.invoice_id = i.id) then 'booking'
    when exists (select 1 from public.training_package_purchases tp where tp.invoice_id = i.id) then 'training'
    when exists (select 1 from public.shop_orders so where so.invoice_id = i.id) then 'shop'
    when i.program_id is null and public.billing_is_club_fee_text(i.description) then 'club_membership'
  end
  from public.invoices i
  left join public.programs p on p.id = i.program_id
  left join public.registrations reg on reg.id = i.registration_id
  left join public.programs rp on rp.id = reg.program_id
  where i.id = p_invoice
$$;

-- ===========================================================================
-- 14. DATA: classify invoices, issuing entity, credit pools
-- ===========================================================================
do $$
declare
  r record;
  n int;
begin
  -- Default entity per organisation (from today's creditor settings).
  for r in select id from public.organizations loop
    perform public.billing_entity_default_for_org(r.id);
  end loop;

  -- Plain column backfill: no business trigger may run (period locks, audit
  -- per row, sponsorship, money guards). One summary audit row per org below.
  alter table public.invoices disable trigger user;

  update public.invoices i
     set activity = coalesce(public.billing_classify_invoice(i.id), 'other'),
         activity_source = case when public.billing_classify_invoice(i.id) is null then 'migration_default' else 'migration_rule' end
   where i.activity is null and i.split_from_invoice_id is null;

  -- Split children take their parent's classification (any depth).
  loop
    update public.invoices ch
       set activity = par.activity, activity_source = par.activity_source
      from public.invoices par
     where ch.split_from_invoice_id = par.id and ch.activity is null and par.activity is not null;
    get diagnostics n = row_count;
    exit when n = 0;
  end loop;
  update public.invoices set activity = 'other', activity_source = 'migration_default' where activity is null;

  -- Issuing entity: the org's default, marked for the founder's review.
  update public.invoices i
     set billing_entity_id = e.id,
         billing_entity_snapshot = public.billing_entity_snapshot_of(e.id),
         billing_entity_source = 'migration_default'
    from public.billing_entities e
   where e.org_id = i.org_id and e.is_default and i.billing_entity_id is null;

  -- Legacy typed memberships keep their link both ways.
  update public.invoices i set membership_id = m.id
    from public.memberships m
   where m.invoice_id = i.id and i.membership_id is null and i.activity = 'club_membership' and m.org_id = i.org_id;

  alter table public.invoices enable trigger user;

  for r in select org_id, count(*) as n,
                  jsonb_object_agg(activity, c) as by_activity
             from (select org_id, activity, count(*) as c from public.invoices group by org_id, activity) x
            group by org_id loop
    insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
    values (r.org_id, null, 'BILLING_ACTIVITY_BACKFILL', 'invoices', null,
            jsonb_build_object('invoices', r.n, 'by_activity', r.by_activity));
  end loop;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_activity_chk' and conrelid = 'public.invoices'::regclass) then
    alter table public.invoices add constraint invoices_activity_chk check (
      public.is_billing_activity(activity)
      and activity_source in ('migration_rule', 'migration_default', 'set', 'derived', 'default', 'linked')
      and (billing_entity_source is null or billing_entity_source in ('route', 'default', 'set', 'migration_default'))
      and (charge_kind is null or (charge_kind in ('season_fee', 'carry_forward', 'adjustment') and membership_id is not null))
      and (membership_id is null or activity = 'club_membership')
      and (payer_kind is null or payer_kind in ('guardian', 'family', 'sponsor', 'other'))
      and coalesce(length(payer_name), 0) <= 140);
  end if;
end $$;
alter table public.invoices alter column activity set not null;
alter table public.invoices alter column activity_source set not null;

-- Credit pools: an entry linked to an invoice takes its activity; manual
-- entries of a family whose linked credit is all one activity take that one.
-- If any pool would be negative the family's credit stays unassigned (null)
-- and is flagged for review.
do $$
declare r record;
begin
  alter table public.family_credit_entries disable trigger user;
  update public.family_credit_entries c set activity = i.activity
    from public.invoices i where i.id = c.invoice_id and c.activity is null;
  update public.family_credit_entries c set activity = x.act
    from (select family_id, currency, min(activity) as act from public.family_credit_entries
           where activity is not null group by family_id, currency having count(distinct activity) = 1) x
   where c.family_id = x.family_id and c.currency = x.currency and c.activity is null and c.invoice_id is null;
  for r in select distinct family_id, currency, org_id from (
             select family_id, currency, org_id, activity, sum(amount) as bal
               from public.family_credit_entries group by family_id, currency, org_id, activity) p
            where p.bal < 0 loop
    update public.family_credit_entries set activity = null where family_id = r.family_id and currency = r.currency;
    insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
    values (r.org_id, 'families', r.family_id, 'CREDIT_ACTIVITY_UNRESOLVED',
            jsonb_build_object('currency', r.currency, 'balance', public.family_credit_balance(r.family_id, r.currency)))
    on conflict do nothing;
  end loop;
  alter table public.family_credit_entries enable trigger user;
end $$;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'family_credit_entries_activity_chk' and conrelid = 'public.family_credit_entries'::regclass) then
    alter table public.family_credit_entries add constraint family_credit_entries_activity_chk
      check (activity is null or public.is_billing_activity(activity));
  end if;
end $$;
create index if not exists idx_family_credit_activity on public.family_credit_entries (family_id, currency, activity);

-- ===========================================================================
-- 15. Club season settings + instalment schedule
-- ===========================================================================
create or replace function public.club_month_due_date(p_month date, p_due_day integer)
returns date language sql immutable set search_path = public as $$
  select (date_trunc('month', p_month)::date
          + (least(p_due_day, extract(day from (date_trunc('month', p_month) + interval '1 month - 1 day'))::int) - 1))
$$;

-- Exact schedule: amounts in minor units (centimes) sum to the total. The
-- remainder after an even split is given one minor unit at a time to the
-- FIRST instalments (11 x on 1000.00 -> 10 x 90.91 + 1 x 90.90). Due on
-- p_due_day of each month (clamped to the month's last day), starting with
-- the month of p_first_due_month. Refused when the last due date falls after
-- the season end.
create or replace function public.club_installment_schedule(p_total numeric, p_count integer, p_first_due_month date,
                                                            p_due_day integer, p_season_end date, p_currency text default 'CHF')
returns table (seq integer, due_on date, amount numeric)
language plpgsql
immutable
set search_path = public
as $$
declare
  v_scale numeric;
  v_minor bigint;
  v_base  bigint;
  v_rem   bigint;
  v_first date;
  k       integer;
begin
  if p_count is null or p_count < 1 or p_count > 24 then raise exception 'INVALID_INSTALLMENT_COUNT' using errcode = 'P0001'; end if;
  if p_total is null or p_total < 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
  if p_due_day is null or p_due_day < 1 or p_due_day > 31 then raise exception 'INVALID_DUE_DAY' using errcode = 'P0001'; end if;
  if p_first_due_month is null then raise exception 'INVALID_FIRST_DUE_MONTH' using errcode = 'P0001'; end if;
  v_scale := power(10::numeric, public.currency_exponent(coalesce(p_currency, 'CHF')));
  v_minor := round(p_total * v_scale)::bigint;
  v_base  := v_minor / p_count;
  v_rem   := v_minor - v_base * p_count;
  v_first := date_trunc('month', p_first_due_month)::date;
  if p_season_end is not null
     and public.club_month_due_date((v_first + make_interval(months => p_count - 1))::date, p_due_day) > p_season_end then
    raise exception 'SCHEDULE_AFTER_SEASON_END' using errcode = 'P0001';
  end if;
  for k in 1 .. p_count loop
    seq := k;
    due_on := public.club_month_due_date((v_first + make_interval(months => k - 1))::date, p_due_day);
    amount := round((v_base + case when k <= v_rem then 1 else 0 end)::numeric / v_scale, public.currency_exponent(coalesce(p_currency, 'CHF')));
    return next;
  end loop;
end $$;

-- Season months (first day) that get no instalment.
create or replace function public.club_season_months_without_installment(p_first_due_month date, p_count integer,
                                                                         p_season_start date, p_season_end date)
returns setof date
language sql
immutable
set search_path = public
as $$
  select m::date
    from generate_series(date_trunc('month', p_season_start), date_trunc('month', p_season_end), interval '1 month') m
   where p_season_start is not null and p_season_end is not null and p_season_end >= p_season_start
     and not (m >= date_trunc('month', p_first_due_month)
              and m < date_trunc('month', p_first_due_month) + make_interval(months => greatest(coalesce(p_count, 0), 0)))
   order by 1
$$;

-- The club's billing defaults (caller's org).
create or replace function public.club_billing_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.app_settings; v_org uuid := public.current_org_id();
begin
  if v_org is null or not (public.is_finance() or public.has_role('coach') or public.is_admin()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select * into s from public.app_settings where org_id = v_org;
  return jsonb_build_object(
    'season_start_month', coalesce(s.club_season_start_month, 8),
    'installment_count', coalesce(s.club_installment_count, 11),
    'installment_due_day', coalesce(s.club_installment_due_day, 28),
    'first_installment_month', coalesce(s.club_first_installment_month, s.club_season_start_month, 8),
    'first_installment_month_set', s.club_first_installment_month is not null,
    'currency', public.org_currency(v_org));
end $$;

create or replace function public.club_billing_settings_set(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.current_org_id(); v_old jsonb; v_new jsonb;
begin
  if v_org is null or not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.app_settings where org_id = v_org) then raise exception 'SETTINGS_NOT_FOUND' using errcode = 'P0002'; end if;
  v_old := public.club_billing_settings();
  begin
    update public.app_settings
       set club_season_start_month = coalesce(nullif(p_payload->>'season_start_month', '')::smallint, club_season_start_month),
           club_installment_count = coalesce(nullif(p_payload->>'installment_count', '')::smallint, club_installment_count),
           club_installment_due_day = coalesce(nullif(p_payload->>'installment_due_day', '')::smallint, club_installment_due_day),
           club_first_installment_month = case when p_payload ? 'first_installment_month'
                                               then nullif(p_payload->>'first_installment_month', '')::smallint
                                               else club_first_installment_month end,
           updated_at = now()
     where org_id = v_org;
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'INVALID_SETTINGS' using errcode = 'P0001';
  end;
  v_new := public.club_billing_settings();
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (v_org, auth.uid(), 'CLUB_BILLING_SETTINGS', 'app_settings', null, v_old, v_new);
  return v_new;
end $$;

-- Season bounds containing a date for the club's season start month
-- (start month 8: 2026-11-22 -> 2026-08-01 .. 2027-07-31).
create or replace function public.club_season_bounds(p_on date, p_start_month integer default null)
returns table (starts_on date, ends_on date)
language plpgsql stable security definer set search_path = public as $$
declare v_m int; v_y int;
begin
  v_m := coalesce(p_start_month, (select club_season_start_month from public.app_settings where org_id = public.current_org_id()), 8);
  if v_m < 1 or v_m > 12 then raise exception 'INVALID_SETTINGS' using errcode = 'P0001'; end if;
  v_y := extract(year from p_on)::int - case when extract(month from p_on)::int < v_m then 1 else 0 end;
  starts_on := make_date(v_y, v_m, 1);
  ends_on := (make_date(v_y, v_m, 1) + interval '1 year - 1 day')::date;
  return next;
end $$;

-- Make one season current (admin).
create or replace function public.season_set_current(p_season uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.seasons;
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into s from public.seasons where id = p_season and org_id = public.current_org_id() for update;
  if not found then raise exception 'SEASON_NOT_FOUND' using errcode = 'P0002'; end if;
  update public.seasons set is_current = false where org_id = s.org_id and is_current and id <> s.id;
  update public.seasons set is_current = true where id = s.id and not is_current;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (s.org_id, auth.uid(), 'SEASON_SET_CURRENT', 'seasons', s.id, jsonb_build_object('name', s.name));
  return jsonb_build_object('season_id', s.id);
end $$;

-- ===========================================================================
-- 16. Billing entities: save / route (admin)
-- ===========================================================================
create or replace function public.billing_entity_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.current_org_id();
  v_id uuid := nullif(p_payload->>'id', '')::uuid;
  v_default boolean := coalesce((p_payload->>'is_default')::boolean, false);
  v_active boolean := coalesce((p_payload->>'is_active')::boolean, true);
  e public.billing_entities;
  t text;
begin
  if v_org is null or not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_payload->>'name'), '') = '' then raise exception 'NAME_REQUIRED' using errcode = 'P0001'; end if;
  if v_default and not v_active then raise exception 'DEFAULT_MUST_BE_ACTIVE' using errcode = 'P0001'; end if;
  foreach t in array array['iban', 'qr_iban'] loop
    if coalesce(p_payload->>t, '') <> '' and upper(replace(p_payload->>t, ' ', '')) !~ '^[A-Z]{2}[0-9]{2}[0-9A-Z]{10,30}$' then
      raise exception 'INVALID_IBAN' using errcode = 'P0001';
    end if;
  end loop;
  if v_id is not null then
    select * into e from public.billing_entities where id = v_id and org_id = v_org for update;
    if not found then raise exception 'BILLING_ENTITY_NOT_FOUND' using errcode = 'P0002'; end if;
    if e.is_default and (not v_default or not v_active) then raise exception 'DEFAULT_REQUIRED' using errcode = 'P0001'; end if;
  end if;
  if v_default then
    update public.billing_entities set is_default = false where org_id = v_org and is_default and id is distinct from v_id;
  end if;
  begin
    if v_id is null then
      insert into public.billing_entities (org_id, name, legal_name, street, building_number, address_extra, postal_code, city, country,
                                           vat_number, iban, qr_iban, email, phone, is_default, is_active, created_by)
      values (v_org, btrim(p_payload->>'name'), nullif(btrim(p_payload->>'legal_name'), ''), nullif(btrim(p_payload->>'street'), ''),
              nullif(btrim(p_payload->>'building_number'), ''), nullif(btrim(p_payload->>'address_extra'), ''),
              nullif(btrim(p_payload->>'postal_code'), ''), nullif(btrim(p_payload->>'city'), ''),
              upper(coalesce(nullif(btrim(p_payload->>'country'), ''), 'CH')), nullif(btrim(p_payload->>'vat_number'), ''),
              nullif(upper(replace(coalesce(p_payload->>'iban', ''), ' ', '')), ''), nullif(upper(replace(coalesce(p_payload->>'qr_iban', ''), ' ', '')), ''),
              nullif(btrim(p_payload->>'email'), ''), nullif(btrim(p_payload->>'phone'), ''),
              v_default or not exists (select 1 from public.billing_entities where org_id = v_org and is_default),
              v_active or not exists (select 1 from public.billing_entities where org_id = v_org and is_default),
              auth.uid())
      returning * into e;
    else
      update public.billing_entities
         set name = btrim(p_payload->>'name'), legal_name = nullif(btrim(p_payload->>'legal_name'), ''),
             street = nullif(btrim(p_payload->>'street'), ''), building_number = nullif(btrim(p_payload->>'building_number'), ''),
             address_extra = nullif(btrim(p_payload->>'address_extra'), ''), postal_code = nullif(btrim(p_payload->>'postal_code'), ''),
             city = nullif(btrim(p_payload->>'city'), ''), country = upper(coalesce(nullif(btrim(p_payload->>'country'), ''), 'CH')),
             vat_number = nullif(btrim(p_payload->>'vat_number'), ''),
             iban = nullif(upper(replace(coalesce(p_payload->>'iban', ''), ' ', '')), ''),
             qr_iban = nullif(upper(replace(coalesce(p_payload->>'qr_iban', ''), ' ', '')), ''),
             email = nullif(btrim(p_payload->>'email'), ''), phone = nullif(btrim(p_payload->>'phone'), ''),
             is_default = v_default, is_active = v_active
       where id = v_id
      returning * into e;
    end if;
  exception when check_violation then
    raise exception 'INVALID_BILLING_ENTITY' using errcode = 'P0001';
  end;
  if not e.is_active then
    delete from public.billing_entity_routes where billing_entity_id = e.id;
  end if;
  return jsonb_build_object('id', e.id, 'is_default', e.is_default);
end $$;

create or replace function public.billing_entity_route_set(p_activity text, p_entity uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if not public.is_billing_activity(p_activity) then raise exception 'INVALID_ACTIVITY' using errcode = 'P0001'; end if;
  if p_entity is null then
    delete from public.billing_entity_routes where org_id = v_org and activity = p_activity;
    return jsonb_build_object('activity', p_activity, 'billing_entity_id', null);
  end if;
  if not exists (select 1 from public.billing_entities where id = p_entity and org_id = v_org and is_active) then
    raise exception 'BILLING_ENTITY_NOT_FOUND' using errcode = 'P0002';
  end if;
  insert into public.billing_entity_routes (org_id, activity, billing_entity_id, created_by)
  values (v_org, p_activity, p_entity, auth.uid())
  on conflict (org_id, activity) do update set billing_entity_id = excluded.billing_entity_id;
  return jsonb_build_object('activity', p_activity, 'billing_entity_id', p_entity);
end $$;

-- Correct the issuing entity of a DRAFT invoice (admin).
create or replace function public.invoice_set_billing_entity(p_invoice uuid, p_entity uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.invoices;
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into v from public.invoices where id = p_invoice and org_id = public.current_org_id() for update;
  if not found then raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.status::text <> 'draft' then raise exception 'BILLING_ENTITY_LOCKED' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.billing_entities where id = p_entity and org_id = v.org_id and is_active) then
    raise exception 'BILLING_ENTITY_NOT_FOUND' using errcode = 'P0002';
  end if;
  update public.invoices set billing_entity_id = p_entity where id = v.id;
  return jsonb_build_object('invoice_id', v.id, 'billing_entity_id', p_entity);
end $$;

-- Reclassify an invoice (admin): a draft, or one the migration / insert
-- trigger could only default. Never a membership invoice, never one whose
-- money already moved through family credit.
create or replace function public.invoice_set_activity(p_invoice uuid, p_activity text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.invoices;
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if not public.is_billing_activity(p_activity) then raise exception 'INVALID_ACTIVITY' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  select * into v from public.invoices where id = p_invoice and org_id = public.current_org_id() for update;
  if not found then raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.activity = p_activity then return jsonb_build_object('invoice_id', v.id, 'activity', v.activity); end if;
  if v.membership_id is not null or v.split_from_invoice_id is not null then raise exception 'ACTIVITY_LOCKED' using errcode = 'P0001'; end if;
  if v.status::text <> 'draft' and v.activity_source not in ('migration_default', 'default', 'migration_rule') then
    raise exception 'ACTIVITY_LOCKED' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.family_credit_entries where invoice_id = v.id) then raise exception 'CREDIT_LINKED' using errcode = 'P0001'; end if;
  perform set_config('app.billing_edit', 'on', true);
  update public.invoices set activity = p_activity, activity_source = 'set' where id = v.id;
  update public.invoices set activity = p_activity, activity_source = 'set' where split_from_invoice_id = v.id;
  perform set_config('app.billing_edit', 'off', true);
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (v.org_id, auth.uid(), 'INVOICE_ACTIVITY_SET', 'invoices', v.id,
          jsonb_build_object('activity', v.activity, 'activity_source', v.activity_source),
          jsonb_build_object('activity', p_activity, 'reason', btrim(p_reason)));
  return jsonb_build_object('invoice_id', v.id, 'activity', p_activity);
end $$;

-- Resolve a review flag (admin / finance).
create or replace function public.data_review_flag_resolve(p_flag uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.data_review_flags;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into f from public.data_review_flags where id = p_flag and org_id = public.current_org_id() for update;
  if not found then raise exception 'FLAG_NOT_FOUND' using errcode = 'P0002'; end if;
  if f.resolved_at is not null then return jsonb_build_object('id', f.id, 'resolved_at', f.resolved_at); end if;
  update public.data_review_flags set resolved_at = now(), resolved_by = auth.uid(), resolution_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = f.id returning * into f;
  return jsonb_build_object('id', f.id, 'resolved_at', f.resolved_at);
end $$;

-- ===========================================================================
-- 17. Manual invoices: request_id (idempotent) and activity
-- ===========================================================================
create or replace function public.create_manual_invoice(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      uuid;
  v_invoice  uuid;
  v_number   text;
  v_item     jsonb;
  v_total    numeric := 0;
  v_amount   numeric;
  v_disc     numeric;
  v_family   uuid := (p_payload->>'family_id')::uuid;
  v_athlete  uuid := nullif(p_payload->>'athlete_id','')::uuid;
  v_program  uuid := nullif(p_payload->>'program_id','')::uuid;
  v_request  uuid := nullif(p_payload->>'request_id','')::uuid;
  v_activity text := nullif(p_payload->>'activity','');
  v_entity   uuid := nullif(p_payload->>'billing_entity_id','')::uuid;
  v_prev     public.invoices;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  v_org := public.current_org_id();
  if v_org is null then raise exception 'NO_ORG' using errcode = 'P0001'; end if;

  -- Idempotent: the same request id returns the invoice it created.
  if v_request is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':invoice:' || v_request::text, 0));
    select * into v_prev from public.invoices where org_id = v_org and request_id = v_request;
    if found then
      return jsonb_build_object('invoice_id', v_prev.id, 'number', v_prev.number, 'total_chf', v_prev.total_chf, 'replayed', true);
    end if;
  end if;
  if v_activity is not null and not public.is_billing_activity(v_activity) then raise exception 'INVALID_ACTIVITY' using errcode = 'P0001'; end if;
  if v_activity = 'club_membership' then raise exception 'USE_MEMBERSHIP_ISSUE' using errcode = 'P0001'; end if;
  if v_entity is not null and not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if v_entity is not null and not exists (select 1 from public.billing_entities where id = v_entity and org_id = v_org and is_active) then
    raise exception 'BILLING_ENTITY_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Linked records must belong to this club.
  if v_family is not null and not exists (select 1 from public.families where id = v_family and org_id = v_org) then
    raise exception 'FAMILY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_athlete is not null and not exists (select 1 from public.athletes where id = v_athlete and org_id = v_org) then
    raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_program is not null and not exists (select 1 from public.programs where id = v_program and org_id = v_org) then
    raise exception 'PROGRAM_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_number := public.next_invoice_number(v_org);

  insert into public.invoices (org_id, number, family_id, athlete_id, program_id, description, status, due_date,
                               request_id, activity, activity_source, billing_entity_id)
  values (
    v_org, v_number, v_family, v_athlete, v_program,
    nullif(p_payload->>'description',''),
    'draft',
    nullif(p_payload->>'due_date','')::date,
    v_request, v_activity, case when v_activity is not null then 'set' end, v_entity
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
  return jsonb_build_object('invoice_id', v_invoice, 'number', v_number, 'total_chf', v_total, 'replayed', false);
end;
$$;

-- ===========================================================================
-- 18. Receipts: record, allocate, list unallocated, void
-- ===========================================================================
create or replace function public.receipt_summary(p_receipt uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'receipt_id', r.id, 'status', r.status, 'amount', r.amount, 'currency', r.currency,
    'allocated', public.receipt_allocated(r.id), 'unallocated', r.amount - public.receipt_allocated(r.id),
    'received_on', r.received_on, 'method', r.method, 'family_id', r.family_id, 'bank_entry_id', r.bank_entry_id,
    'request_id', r.request_id,
    'allocations', coalesce((
      select jsonb_agg(jsonb_build_object('payment_id', p.id, 'invoice_id', p.invoice_id, 'invoice_number', i.number,
                                          'activity', i.activity, 'amount', p.amount_chf, 'installment_id', p.installment_id,
                                          'voided', p.voided_at is not null)
                       order by p.created_at, p.id)
        from public.payments p join public.invoices i on i.id = p.invoice_id
       where p.receipt_id = r.id and p.reverses_payment_id is null), '[]'::jsonb))
  from public.payment_receipts r where r.id = p_receipt
$$;

create or replace function public.receipt_allocate_internal(p_receipt uuid, p_allocations jsonb, p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r        public.payment_receipts;
  v        public.invoices;
  a        record;
  v_exp    int;
  v_sum    numeric := 0;
  v_amount numeric;
  v_bal    numeric;
  v_res    jsonb;
  v_out    jsonb := '[]'::jsonb;
  v_seen   uuid[] := '{}';
begin
  select * into r from public.payment_receipts where id = p_receipt for update;
  if not found then raise exception 'RECEIPT_NOT_FOUND' using errcode = 'P0002'; end if;
  if r.status = 'void' then raise exception 'RECEIPT_VOID' using errcode = 'P0001'; end if;
  if jsonb_typeof(coalesce(p_allocations, '[]'::jsonb)) <> 'array' then raise exception 'INVALID_ALLOCATION' using errcode = 'P0001'; end if;
  v_exp := public.currency_exponent(r.currency);

  -- Validate everything first (no partial booking), in invoice-id order (locks).
  for a in
    select (x->>'invoice_id')::uuid as invoice_id, round(coalesce((x->>'amount')::numeric, 0), v_exp) as amount,
           nullif(x->>'installment_id', '')::uuid as installment_id
      from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) x
     order by (x->>'invoice_id')
  loop
    if a.invoice_id is null then raise exception 'INVALID_ALLOCATION' using errcode = 'P0001'; end if;
    if a.invoice_id = any(v_seen) then raise exception 'DUPLICATE_ALLOCATION' using errcode = 'P0001'; end if;
    v_seen := v_seen || a.invoice_id;
    if a.amount <= 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
    v := public.money_invoice_for_update(a.invoice_id);
    if v.status::text not in ('pending', 'sent', 'partially_paid', 'overdue') then raise exception 'INVOICE_NOT_PAYABLE' using errcode = 'P0001'; end if;
    if v.currency <> r.currency then raise exception 'CURRENCY_MISMATCH' using errcode = 'P0001'; end if;
    v_bal := (v.total_chf + v.adjustments_total) - public.invoice_net_paid(v.id);
    if a.amount > v_bal then raise exception 'ALLOCATION_EXCEEDS_BALANCE' using errcode = 'P0001'; end if;
    if a.installment_id is not null and not exists (
         select 1 from public.payment_plan_installments pi join public.payment_plans pp on pp.id = pi.plan_id
          where pi.id = a.installment_id and pp.invoice_id = v.id and pi.status not in ('paid', 'cancelled', 'skipped')) then
      raise exception 'INSTALLMENT_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_sum := v_sum + a.amount;
  end loop;
  if v_sum > r.amount - public.receipt_allocated(r.id) then raise exception 'ALLOCATION_EXCEEDS_RECEIPT' using errcode = 'P0001'; end if;

  -- Book: one ordinary payment per invoice (balances, plans, overdue as today).
  for a in
    select (x->>'invoice_id')::uuid as invoice_id, round(coalesce((x->>'amount')::numeric, 0), v_exp) as amount,
           nullif(x->>'installment_id', '')::uuid as installment_id
      from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) x
     order by (x->>'invoice_id')
  loop
    perform set_config('app.receipt_id', r.id::text, true);
    perform set_config('app.payment_request_id', coalesce(p_request::text, ''), true);
    perform set_config('app.installment_id', coalesce(a.installment_id::text, ''), true);
    v_res := public.record_offline_payment(a.invoice_id, a.amount, r.method, r.received_on, r.reference, r.note);
    perform set_config('app.receipt_id', '', true);
    perform set_config('app.payment_request_id', '', true);
    perform set_config('app.installment_id', '', true);
    v_out := v_out || jsonb_build_array(jsonb_build_object('invoice_id', a.invoice_id, 'payment_id', v_res->>'payment_id',
                                                           'amount', a.amount, 'status', v_res->>'status'));
  end loop;
  perform public.receipt_refresh_status(r.id);
  return v_out;
end;
$$;

create or replace function public.receipt_record(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid := public.current_org_id();
  v_request uuid;
  v_id      uuid;
  v_cur     text;
  v_amount  numeric;
  v_on      date;
  v_method  text := coalesce(nullif(p_payload->>'method', ''), 'bank_transfer');
  v_family  uuid := nullif(p_payload->>'family_id', '')::uuid;
  v_bank    uuid := nullif(p_payload->>'bank_entry_id', '')::uuid;
  e         public.bank_entries;
  v_alloc   jsonb := coalesce(p_payload->'allocations', '[]'::jsonb);
  v_booked  jsonb;
begin
  if v_org is null or not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  begin
    v_request := (p_payload->>'request_id')::uuid;
  exception when invalid_text_representation then v_request := null; end;
  if v_request is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':receipt:' || v_request::text, 0));
  select id into v_id from public.payment_receipts where org_id = v_org and request_id = v_request;
  if v_id is not null then
    return public.receipt_summary(v_id) || jsonb_build_object('replayed', true);
  end if;

  v_cur := upper(coalesce(nullif(p_payload->>'currency', ''), public.org_currency(v_org)));
  if v_cur !~ '^[A-Z]{3}$' then raise exception 'INVALID_CURRENCY' using errcode = 'P0001'; end if;
  v_amount := round(coalesce(nullif(p_payload->>'amount', '')::numeric, 0), public.currency_exponent(v_cur));
  if v_amount <= 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
  if not public.is_offline_payment_method(v_method) then raise exception 'INVALID_METHOD' using errcode = 'P0001'; end if;
  v_on := coalesce(nullif(p_payload->>'received_on', '')::date, public.ca_org_today(v_org));
  if v_on > current_date + 1 then raise exception 'INVALID_DATE' using errcode = 'P0001'; end if;
  v_on := least(v_on, current_date);
  if v_family is not null and not exists (select 1 from public.families where id = v_family and org_id = v_org) then
    raise exception 'FAMILY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if jsonb_typeof(v_alloc) <> 'array' then raise exception 'INVALID_ALLOCATION' using errcode = 'P0001'; end if;

  if v_bank is not null then
    select * into e from public.bank_entries where id = v_bank and org_id = v_org for update;
    if not found then raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0002'; end if;
    if e.status in ('booked', 'ignored') or e.receipt_id is not null then raise exception 'ENTRY_ALREADY_BOOKED' using errcode = 'P0001'; end if;
    if e.currency <> v_cur or e.amount <> v_amount then raise exception 'BANK_AMOUNT_MISMATCH' using errcode = 'P0001'; end if;
    if jsonb_array_length(v_alloc) = 0 then raise exception 'BANK_ENTRY_NEEDS_ALLOCATION' using errcode = 'P0001'; end if;
  end if;

  insert into public.payment_receipts (org_id, family_id, payer_name, amount, currency, received_on, method, reference, note,
                                       bank_entry_id, request_id, created_by)
  values (v_org, v_family, nullif(btrim(coalesce(p_payload->>'payer_name', '')), ''), v_amount, v_cur, v_on, v_method,
          nullif(btrim(coalesce(p_payload->>'reference', '')), ''), nullif(btrim(coalesce(p_payload->>'note', '')), ''),
          v_bank, v_request, auth.uid())
  returning id into v_id;

  v_booked := public.receipt_allocate_internal(v_id, v_alloc, v_request);

  if v_bank is not null then
    update public.bank_entries
       set status = 'booked', receipt_id = v_id,
           invoice_id = (v_booked->0->>'invoice_id')::uuid, payment_id = (v_booked->0->>'payment_id')::uuid,
           booked_by = auth.uid(), booked_at = now(), match_kind = coalesce(match_kind, 'manual')
     where id = v_bank;
    update public.bank_statement_imports
       set booked_count = (select count(*) from public.bank_entries where import_id = e.import_id and status = 'booked')
     where id = e.import_id;
  end if;

  perform public.money_audit(v_org, 'RECEIPT_RECORDED', 'payment_receipts', v_id, null,
    jsonb_build_object('amount', v_amount, 'currency', v_cur, 'method', v_method, 'allocations', v_booked, 'bank_entry_id', v_bank));
  return public.receipt_summary(v_id) || jsonb_build_object('replayed', false);
end;
$$;

create or replace function public.receipt_allocate(p_receipt uuid, p_allocations jsonb, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.payment_receipts; v_booked jsonb;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into r from public.payment_receipts where id = p_receipt and org_id = public.current_org_id() for update;
  if not found then raise exception 'RECEIPT_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(r.org_id::text || ':alloc:' || p_request_id::text, 0));
    if exists (select 1 from public.payments where org_id = r.org_id and request_id = p_request_id and receipt_id = r.id) then
      return public.receipt_summary(r.id) || jsonb_build_object('replayed', true);
    end if;
  end if;
  v_booked := public.receipt_allocate_internal(r.id, p_allocations, p_request_id);
  perform public.money_audit(r.org_id, 'RECEIPT_ALLOCATED', 'payment_receipts', r.id, null,
    jsonb_build_object('allocations', v_booked, 'request_id', p_request_id));
  return public.receipt_summary(r.id) || jsonb_build_object('replayed', false);
end;
$$;

create or replace function public.receipt_void(p_receipt uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.payment_receipts;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  select * into r from public.payment_receipts where id = p_receipt and org_id = public.current_org_id() for update;
  if not found then raise exception 'RECEIPT_NOT_FOUND' using errcode = 'P0002'; end if;
  if r.status = 'void' then return public.receipt_summary(r.id); end if;
  if public.receipt_allocated(r.id) <> 0 then raise exception 'RECEIPT_HAS_ALLOCATIONS' using errcode = 'P0001'; end if;
  update public.payment_receipts set status = 'void', voided_at = now(), void_reason = btrim(p_reason) where id = r.id;
  return public.receipt_summary(r.id);
end $$;

-- Receipts with money not yet allocated (Finance worklist).
create or replace function public.receipt_unallocated()
returns table (receipt_id uuid, family_id uuid, payer_name text, amount numeric, allocated numeric, unallocated numeric,
               currency text, received_on date, method text, reference text, bank_entry_id uuid, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  return query
    select r.id, r.family_id, r.payer_name, r.amount, x.alloc, r.amount - x.alloc, r.currency, r.received_on, r.method,
           r.reference, r.bank_entry_id, r.created_at
      from public.payment_receipts r
      cross join lateral (select public.receipt_allocated(r.id) as alloc) x
     where r.org_id = public.current_org_id() and r.status <> 'void' and r.amount - x.alloc > 0
     order by r.received_on, r.created_at;
end $$;

-- ===========================================================================
-- 19. Season-fee memberships
-- ===========================================================================
-- Validates a membership payload and computes payer amounts + schedules.
-- Shares: fixed amounts are taken first; percent shares split the rest and
-- must total exactly 100; the LAST percent payer absorbs the rounding
-- centimes. Without percent payers the fixed amounts must equal the fee.
create or replace function public.membership_plan_internal(p_payload jsonb, p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s        public.app_settings;
  se       public.seasons;
  a        public.athletes;
  v_cur    text;
  v_exp    int;
  v_scale  numeric;
  v_fee    numeric;
  v_fee_m  bigint;
  v_count  int;
  v_day    int;
  v_first  date;
  v_month  int;
  v_pay    jsonb := coalesce(p_payload->'payers', '[]'::jsonb);
  v_n      int;
  p        jsonb;
  i        int;
  v_fixed  bigint := 0;
  v_pct    numeric := 0;
  v_npct   int := 0;
  v_rest   bigint;
  v_acc    bigint := 0;
  v_seen   int := 0;
  v_amts   bigint[] := '{}';
  v_kind   text;
  v_share  text;
  v_val    numeric;
  v_amt    bigint;
  v_out    jsonb := '[]'::jsonb;
  v_fam    uuid;
  v_name   text;
  v_email  text;
  v_prof   uuid;
  v_sched  jsonb;
  v_profiles uuid[] := '{}';
begin
  select * into s from public.app_settings where org_id = p_org;
  select * into a from public.athletes where id = nullif(p_payload->>'athlete_id', '')::uuid and org_id = p_org;
  if a.id is null then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into se from public.seasons where id = nullif(p_payload->>'season_id', '')::uuid and org_id = p_org;
  if se.id is null then raise exception 'SEASON_NOT_FOUND' using errcode = 'P0002'; end if;

  v_cur := upper(coalesce(nullif(p_payload->>'currency', ''), public.org_currency(p_org)));
  if v_cur !~ '^[A-Z]{3}$' then raise exception 'INVALID_CURRENCY' using errcode = 'P0001'; end if;
  v_exp := public.currency_exponent(v_cur);
  v_scale := power(10::numeric, v_exp);
  v_fee := nullif(p_payload->>'agreed_fee', '')::numeric;
  if v_fee is null or v_fee < 0 or v_fee > 1000000 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
  v_fee := round(v_fee, v_exp);
  v_fee_m := round(v_fee * v_scale)::bigint;

  v_count := coalesce(nullif(p_payload->>'installment_count', '')::int, s.club_installment_count, 11);
  v_day := coalesce(nullif(p_payload->>'due_day', '')::int, s.club_installment_due_day, 28);
  if nullif(p_payload->>'first_due_month', '') is not null then
    v_first := date_trunc('month', (p_payload->>'first_due_month')::date)::date;
  else
    v_month := coalesce(s.club_first_installment_month, s.club_season_start_month, extract(month from se.starts_on)::int);
    v_first := make_date(extract(year from se.starts_on)::int, v_month, 1);
    if v_first < date_trunc('month', se.starts_on)::date then v_first := (v_first + interval '1 year')::date; end if;
  end if;
  if v_first < date_trunc('month', se.starts_on)::date then raise exception 'SCHEDULE_BEFORE_SEASON_START' using errcode = 'P0001'; end if;
  -- Validates count / day and the season end even without payers.
  perform 1 from public.club_installment_schedule(0, v_count, v_first, v_day, se.ends_on, v_cur);

  if jsonb_typeof(v_pay) <> 'array' then raise exception 'INVALID_PAYER' using errcode = 'P0001'; end if;
  v_n := jsonb_array_length(v_pay);
  if v_fee_m = 0 and v_n > 0 then raise exception 'SHARES_MISMATCH' using errcode = 'P0001'; end if;
  if v_fee_m > 0 and v_n = 0 then raise exception 'PAYERS_REQUIRED' using errcode = 'P0001'; end if;
  if v_n > 10 then raise exception 'TOO_MANY_PAYERS' using errcode = 'P0001'; end if;

  -- Pass 1: shares.
  for i in 0 .. v_n - 1 loop
    p := v_pay->i;
    v_share := coalesce(p->>'share_kind', '');
    v_val := nullif(p->>'share_value', '')::numeric;
    if v_share not in ('fixed', 'percent') or v_val is null or v_val <= 0 or (v_share = 'percent' and v_val > 100) then
      raise exception 'INVALID_SHARE' using errcode = 'P0001';
    end if;
    if v_share = 'fixed' then
      v_fixed := v_fixed + round(round(v_val, v_exp) * v_scale)::bigint;
    else
      v_pct := v_pct + v_val; v_npct := v_npct + 1;
    end if;
  end loop;
  if v_npct = 0 and v_fixed <> v_fee_m then raise exception 'SHARES_MISMATCH' using errcode = 'P0001'; end if;
  if v_npct > 0 and (v_pct <> 100 or v_fixed > v_fee_m) then raise exception 'SHARES_MISMATCH' using errcode = 'P0001'; end if;
  v_rest := v_fee_m - v_fixed;

  -- Pass 2: amounts (last percent payer absorbs the rounding).
  for i in 0 .. v_n - 1 loop
    p := v_pay->i;
    v_val := (p->>'share_value')::numeric;
    if p->>'share_kind' = 'fixed' then
      v_amt := round(round(v_val, v_exp) * v_scale)::bigint;
    else
      v_seen := v_seen + 1;
      if v_seen = v_npct then v_amt := v_rest - v_acc;
      else v_amt := round(v_rest * v_val / 100)::bigint; v_acc := v_acc + v_amt; end if;
    end if;
    if v_amt <= 0 then raise exception 'ZERO_SHARE' using errcode = 'P0001'; end if;
    v_amts := v_amts || v_amt;
  end loop;

  -- Pass 3: payers.
  for i in 0 .. v_n - 1 loop
    p := v_pay->i;
    v_kind := coalesce(p->>'kind', '');
    v_prof := nullif(p->>'profile_id', '')::uuid;
    v_fam := null; v_name := nullif(btrim(coalesce(p->>'name', '')), ''); v_email := nullif(btrim(coalesce(p->>'email', '')), '');
    if v_kind = 'guardian' then
      if v_prof is not null then
        if not exists (select 1 from public.family_members fm where fm.family_id = a.family_id and fm.profile_id = v_prof) then
          raise exception 'PAYER_NOT_GUARDIAN' using errcode = 'P0001';
        end if;
        if v_prof = any(v_profiles) then raise exception 'DUPLICATE_PAYER' using errcode = 'P0001'; end if;
        v_profiles := v_profiles || v_prof;
        select coalesce(v_name, pr.full_name), coalesce(v_email, pr.email::text) into v_name, v_email from public.profiles pr where pr.id = v_prof;
      elsif v_name is null then
        raise exception 'PAYER_NAME_REQUIRED' using errcode = 'P0001';
      end if;
      v_fam := a.family_id;
    elsif v_kind = 'family' then
      v_prof := null;
      v_fam := coalesce(nullif(p->>'family_id', '')::uuid, a.family_id);
      select coalesce(v_name, f.contact_name, f.name), coalesce(v_email, f.contact_email::text) into v_name, v_email
        from public.families f where f.id = v_fam and f.org_id = p_org;
      if not found then raise exception 'FAMILY_NOT_FOUND' using errcode = 'P0002'; end if;
    elsif v_kind in ('sponsor', 'other') then
      v_prof := null;
      if v_name is null then raise exception 'PAYER_NAME_REQUIRED' using errcode = 'P0001'; end if;
      v_fam := a.family_id;
    else
      raise exception 'INVALID_PAYER' using errcode = 'P0001';
    end if;
    if v_email is not null and length(v_email) > 200 then raise exception 'INVALID_PAYER' using errcode = 'P0001'; end if;

    select coalesce(jsonb_agg(jsonb_build_object('seq', x.seq, 'due_on', x.due_on, 'amount', x.amount) order by x.seq), '[]'::jsonb)
      into v_sched
      from public.club_installment_schedule(round(v_amts[i + 1]::numeric / v_scale, v_exp), v_count, v_first, v_day, se.ends_on, v_cur) x;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'index', i, 'kind', v_kind, 'profile_id', v_prof, 'family_id', v_fam, 'name', left(v_name, 140), 'email', v_email,
      'share_kind', p->>'share_kind', 'share_value', (p->>'share_value')::numeric,
      'amount', round(v_amts[i + 1]::numeric / v_scale, v_exp), 'schedule', v_sched));
  end loop;

  return jsonb_build_object(
    'athlete_id', a.id, 'family_id', a.family_id,
    'season', jsonb_build_object('id', se.id, 'name', se.name, 'starts_on', se.starts_on, 'ends_on', se.ends_on),
    'currency', v_cur, 'agreed_fee', v_fee, 'installment_count', v_count, 'first_due_month', v_first, 'due_day', v_day,
    'sponsored', coalesce((p_payload->>'sponsored')::boolean, false),
    'payers', v_out,
    'months_without_installment', coalesce((
      select jsonb_agg(m order by m) from public.club_season_months_without_installment(v_first, v_count, se.starts_on, se.ends_on) m), '[]'::jsonb),
    'existing_membership_id', (select m.id from public.memberships m
                                where m.athlete_id = a.id and m.season_id = se.id and m.kind = 'season_fee' and m.status <> 'cancelled'));
end;
$$;

create or replace function public.membership_preview(p_payload jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_org_id() is null or not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  return public.membership_plan_internal(p_payload, public.current_org_id());
end $$;

create or replace function public.membership_issue_result(p_membership uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'membership_id', m.id, 'season_id', m.season_id, 'athlete_id', m.athlete_id, 'agreed_fee', m.agreed_fee, 'currency', m.currency,
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object('payer_id', mp.id, 'payer_index', mp.sort - 1, 'payer_kind', mp.payer_kind,
                                          'invoice_id', mp.invoice_id, 'number', i.number, 'amount', mp.amount,
                                          'plan_id', (select pp.id from public.payment_plans pp
                                                       where pp.invoice_id = mp.invoice_id and pp.kind = 'installments'
                                                       order by pp.created_at desc limit 1))
                       order by mp.sort)
        from public.membership_payers mp left join public.invoices i on i.id = mp.invoice_id
       where mp.membership_id = m.id), '[]'::jsonb))
  from public.memberships m where m.id = p_membership
$$;

create or replace function public.membership_issue(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid := public.current_org_id();
  v_request uuid;
  v_prev    uuid;
  v_plan    jsonb;
  v_mid     uuid;
  p         jsonb;
  v_inv     public.invoices;
  v_iid     uuid;
  v_payer   uuid;
  v_dates   date[];
  v_amounts numeric[];
  v_label   text;
  v_season  text;
  k         int := 0;
begin
  if v_org is null or not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  begin
    v_request := (p_payload->>'request_id')::uuid;
  exception when invalid_text_representation then v_request := null; end;
  if v_request is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':membership:' || v_request::text, 0));
  select id into v_prev from public.memberships where org_id = v_org and request_id = v_request;
  if v_prev is not null then return public.membership_issue_result(v_prev) || jsonb_build_object('replayed', true); end if;

  v_plan := public.membership_plan_internal(p_payload, v_org);
  perform pg_advisory_xact_lock(hashtextextended((v_plan->>'athlete_id') || ':' || (v_plan->'season'->>'id'), 0));
  if exists (select 1 from public.memberships m where m.athlete_id = (v_plan->>'athlete_id')::uuid
              and m.season_id = (v_plan->'season'->>'id')::uuid and m.kind = 'season_fee' and m.status <> 'cancelled') then
    raise exception 'ALREADY_MEMBER' using errcode = 'P0001';
  end if;
  v_season := v_plan->'season'->>'name';
  v_label := left(coalesce(nullif(btrim(p_payload->>'description'), ''), v_season), 500);

  insert into public.memberships (org_id, membership_type_id, family_id, athlete_id, valid_from, valid_until, status, price_amount,
                                  currency, created_by, season_id, kind, agreed_fee, installment_count, first_due_month, due_day,
                                  sponsored, sponsored_notes, request_id, source)
  values (v_org, null, (v_plan->>'family_id')::uuid, (v_plan->>'athlete_id')::uuid,
          (v_plan->'season'->>'starts_on')::date, (v_plan->'season'->>'ends_on')::date, 'active', (v_plan->>'agreed_fee')::numeric,
          v_plan->>'currency', auth.uid(), (v_plan->'season'->>'id')::uuid, 'season_fee', (v_plan->>'agreed_fee')::numeric,
          (v_plan->>'installment_count')::smallint, (v_plan->>'first_due_month')::date, (v_plan->>'due_day')::smallint,
          coalesce((p_payload->>'sponsored')::boolean, false), nullif(btrim(coalesce(p_payload->>'sponsored_notes', '')), ''),
          v_request, 'issue')
  returning id into v_mid;

  for p in select * from jsonb_array_elements(v_plan->'payers') loop
    k := k + 1;
    insert into public.membership_payers (org_id, membership_id, sort, payer_kind, payer_profile_id, family_id, payer_name, payer_email,
                                          share_kind, share_value, amount, currency, created_by)
    values (v_org, v_mid, k, p->>'kind', nullif(p->>'profile_id', '')::uuid, nullif(p->>'family_id', '')::uuid,
            p->>'name', p->>'email', p->>'share_kind', (p->>'share_value')::numeric, (p->>'amount')::numeric, v_plan->>'currency', auth.uid())
    returning id into v_payer;

    select array_agg((x->>'due_on')::date order by (x->>'seq')::int), array_agg((x->>'amount')::numeric order by (x->>'seq')::int)
      into v_dates, v_amounts from jsonb_array_elements(p->'schedule') x;

    insert into public.invoices (org_id, number, family_id, athlete_id, description, status, due_date, currency, total_chf, created_by,
                                 activity, activity_source, membership_id, charge_kind, payer_profile_id, payer_kind, payer_name)
    values (v_org, public.next_invoice_number(v_org), (p->>'family_id')::uuid, (v_plan->>'athlete_id')::uuid, v_label, 'sent',
            v_dates[1], v_plan->>'currency', (p->>'amount')::numeric, auth.uid(),
            'club_membership', 'set', v_mid, 'season_fee', nullif(p->>'profile_id', '')::uuid, p->>'kind', left(p->>'name', 140))
    returning * into v_inv;
    v_iid := v_inv.id;
    insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
    values (v_org, v_iid, v_label, 1, (p->>'amount')::numeric, (p->>'amount')::numeric);
    update public.membership_payers set invoice_id = v_iid where id = v_payer;
    if cardinality(v_dates) >= 2 then
      perform public.plan_create_internal(v_inv, v_dates, v_amounts, 0, 'season', 'club_season');
    end if;
  end loop;

  perform public.money_audit(v_org, 'MEMBERSHIP_ISSUED', 'memberships', v_mid, null,
    jsonb_build_object('athlete_id', v_plan->>'athlete_id', 'season_id', v_plan->'season'->>'id', 'agreed_fee', v_plan->'agreed_fee',
                       'payers', jsonb_array_length(v_plan->'payers'), 'installment_count', v_plan->'installment_count'));
  return public.membership_issue_result(v_mid) || jsonb_build_object('replayed', false);
end;
$$;

-- Carry an amount from one season's membership to a later one: a separate
-- club_membership invoice (charge_kind carry_forward), never part of the
-- season-fee totals.
create or replace function public.membership_carry_forward(p_from uuid, p_to uuid, p_amount numeric, p_reason text, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  f public.memberships; t public.memberships; sf public.seasons; st public.seasons;
  v_amount numeric; v_inv uuid; v_num text; v_prev public.invoices;
begin
  if v_org is null or not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if p_request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':invoice:' || p_request_id::text, 0));
    select * into v_prev from public.invoices where org_id = v_org and request_id = p_request_id;
    if found then return jsonb_build_object('invoice_id', v_prev.id, 'number', v_prev.number, 'amount', v_prev.total_chf, 'replayed', true); end if;
  end if;
  select * into f from public.memberships where id = p_from and org_id = v_org and kind = 'season_fee';
  if not found then raise exception 'MEMBERSHIP_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into t from public.memberships where id = p_to and org_id = v_org and kind = 'season_fee' for update;
  if not found then raise exception 'MEMBERSHIP_NOT_FOUND' using errcode = 'P0002'; end if;
  if t.status = 'cancelled' then raise exception 'MEMBERSHIP_CANCELLED' using errcode = 'P0001'; end if;
  if f.id = t.id or f.athlete_id is distinct from t.athlete_id then raise exception 'CARRY_FORWARD_MISMATCH' using errcode = 'P0001'; end if;
  select * into sf from public.seasons where id = f.season_id;
  select * into st from public.seasons where id = t.season_id;
  if st.starts_on <= sf.starts_on then raise exception 'CARRY_FORWARD_SEASON_ORDER' using errcode = 'P0001'; end if;
  v_amount := round(coalesce(p_amount, 0), public.currency_exponent(t.currency));
  if v_amount <= 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;

  v_num := public.next_invoice_number(v_org);
  insert into public.invoices (org_id, number, family_id, athlete_id, description, status, due_date, currency, total_chf, created_by,
                               activity, activity_source, membership_id, charge_kind, request_id)
  values (v_org, v_num, t.family_id, t.athlete_id, left(btrim(p_reason), 500), 'sent', public.ca_org_today(v_org) + 30, t.currency,
          v_amount, auth.uid(), 'club_membership', 'set', t.id, 'carry_forward', p_request_id)
  returning id into v_inv;
  insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
  values (v_org, v_inv, left(btrim(p_reason), 500), 1, v_amount, v_amount);
  perform public.money_audit(v_org, 'MEMBERSHIP_CARRY_FORWARD', 'invoices', v_inv, null,
    jsonb_build_object('from_membership', f.id, 'to_membership', t.id, 'amount', v_amount, 'reason', btrim(p_reason)));
  return jsonb_build_object('invoice_id', v_inv, 'number', v_num, 'amount', v_amount, 'replayed', false);
end;
$$;

-- Money of one membership: season fee (charge_kind season_fee) separate from
-- carry-forwards and adjustments. RLS applies (security invoker).
create or replace function public.membership_summary(p_membership uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with inv as (
    select i.id, i.charge_kind, i.status::text as status, i.currency,
           case when i.status::text in ('cancelled', 'void') then 0 else i.total_chf + coalesce(i.adjustments_total, 0) end as due,
           public.invoice_net_paid(i.id) as paid
      from public.invoices i where i.membership_id = p_membership
  )
  select jsonb_build_object(
    'membership_id', m.id, 'season_id', m.season_id, 'agreed_fee', m.agreed_fee, 'currency', m.currency, 'sponsored', m.sponsored,
    'season_fee', jsonb_build_object(
       'invoiced', coalesce((select sum(due) from inv where charge_kind = 'season_fee'), 0),
       'paid', coalesce((select sum(paid) from inv where charge_kind = 'season_fee'), 0),
       'balance', coalesce((select sum(greatest(due - paid, 0)) from inv where charge_kind = 'season_fee'), 0)),
    'carry_forward', jsonb_build_object(
       'invoiced', coalesce((select sum(due) from inv where charge_kind = 'carry_forward'), 0),
       'paid', coalesce((select sum(paid) from inv where charge_kind = 'carry_forward'), 0),
       'balance', coalesce((select sum(greatest(due - paid, 0)) from inv where charge_kind = 'carry_forward'), 0)),
    'other', jsonb_build_object(
       'invoiced', coalesce((select sum(due) from inv where coalesce(charge_kind, 'adjustment') = 'adjustment'), 0),
       'paid', coalesce((select sum(paid) from inv where coalesce(charge_kind, 'adjustment') = 'adjustment'), 0)),
    'invoice_ids', coalesce((select jsonb_agg(id) from inv), '[]'::jsonb))
  from public.memberships m where m.id = p_membership
$$;

-- ===========================================================================
-- 20. invoice_source: the record an invoice was raised for
-- ===========================================================================
create or replace function public.invoice_source(p_invoice uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare v record; x record;
begin
  select i.id, i.membership_id, i.registration_id, i.program_id into v from public.invoices i where i.id = p_invoice;
  if not found then return null; end if;
  if v.membership_id is not null then
    select m.id, coalesce(s.name, mt.name) as label into x
      from public.memberships m left join public.seasons s on s.id = m.season_id left join public.membership_types mt on mt.id = m.membership_type_id
     where m.id = v.membership_id;
    if found then return jsonb_build_object('kind', 'membership', 'id', x.id, 'label', x.label); end if;
  end if;
  select m.id, mt.name as label into x from public.memberships m left join public.membership_types mt on mt.id = m.membership_type_id
   where m.invoice_id = p_invoice limit 1;
  if found then return jsonb_build_object('kind', 'membership', 'id', x.id, 'label', x.label); end if;
  select a.id, p.name as label into x from public.program_applications a join public.programs p on p.id = a.program_id
   where a.invoice_id = p_invoice order by a.created_at desc limit 1;
  if found then return jsonb_build_object('kind', 'programme', 'id', x.id, 'label', x.label, 'program_id', (select program_id from public.program_applications where id = x.id)); end if;
  select r.id, p.name as label into x from public.registrations r left join public.programs p on p.id = r.program_id
   where r.id = v.registration_id or r.invoice_id = p_invoice order by coalesce(r.id = v.registration_id, false) desc limit 1;
  if found then return jsonb_build_object('kind', 'registration', 'id', x.id, 'label', x.label); end if;
  select b.id, ts.name || ' · ' || to_char(b.slot_start, 'YYYY-MM-DD HH24:MI') as label into x
    from public.training_bookings b left join public.training_services ts on ts.id = b.service_id
   where b.invoice_id = p_invoice order by b.slot_start limit 1;
  if found then return jsonb_build_object('kind', 'booking', 'id', x.id, 'label', x.label); end if;
  select tp.id, ts.name as label into x from public.training_package_purchases tp left join public.training_services ts on ts.id = tp.service_id
   where tp.invoice_id = p_invoice limit 1;
  if found then return jsonb_build_object('kind', 'training_package', 'id', x.id, 'label', x.label); end if;
  select so.id, so.number as label into x from public.shop_orders so where so.invoice_id = p_invoice limit 1;
  if found then return jsonb_build_object('kind', 'shop', 'id', x.id, 'label', x.label); end if;
  if v.program_id is not null then
    select p.id, p.name as label into x from public.programs p where p.id = v.program_id;
    if found then return jsonb_build_object('kind', 'programme', 'id', x.id, 'label', x.label, 'program_id', x.id); end if;
  end if;
  return null;
end $$;

-- ===========================================================================
-- 21. DATA: imported club fees -> season memberships (generic, per org)
-- ===========================================================================
-- Per athlete, in the org's current season: one membership; agreed fee =
-- sum of the live (not cancelled) club-fee invoices ("payments received" +
-- "balance"); sponsored when every balance invoice was cancelled for
-- sponsorship. Invoices and payments are not changed (only linked).
-- Ambiguous cases are written to data_review_flags and left alone.
create or replace function public.billing_migrate_club_fees(p_org uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n_members int := 0;
  n_flags   int := 0;
  n_linked  int := 0;
  o       record;
  g       record;
  se      public.seasons;
  v_mid   uuid;
  v_fee   numeric;
  v_sponsored boolean;
  v_bad   text;
  v_fam   public.families;
  v_bal   uuid;
  v_label int;
  v_ids   uuid[];
  v_det   jsonb;
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  for o in select distinct org_id from public.invoices
            where activity = 'club_membership' and membership_id is null and program_id is null
              and (p_org is null or org_id = p_org) loop
    select * into se from public.seasons where org_id = o.org_id and is_current limit 1;

    -- Invoices without an athlete cannot be attributed.
    insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details, original_reference)
    select i.org_id, 'invoices', i.id, 'NO_ATHLETE',
           jsonb_build_object('number', i.number, 'description', i.description, 'status', i.status, 'total', i.total_chf),
           i.number
      from public.invoices i
     where i.org_id = o.org_id and i.activity = 'club_membership' and i.membership_id is null and i.program_id is null
       and i.athlete_id is null
    on conflict do nothing;

    if se.id is null then
      insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details, original_reference)
      select i.org_id, 'invoices', i.id, 'NO_CURRENT_SEASON',
             jsonb_build_object('number', i.number, 'description', i.description, 'status', i.status), i.number
        from public.invoices i
       where i.org_id = o.org_id and i.activity = 'club_membership' and i.membership_id is null and i.program_id is null
         and i.athlete_id is not null
      on conflict do nothing;
      continue;
    end if;

    for g in
      select i.athlete_id,
             array_agg(i.id order by i.issued_at, i.number) as ids,
             array_agg(i.number order by i.issued_at, i.number) as numbers,
             count(distinct i.family_id) as families,
             min(i.family_id::text)::uuid as family_id,
             count(distinct i.currency) as currencies,
             min(i.currency) as currency,
             count(distinct public.billing_season_label_year(i.description)) as labels,
             min(public.billing_season_label_year(i.description)) as label_year,
             bool_or(public.billing_season_label_year(i.description) is null) as unlabelled,
             count(*) filter (where i.status::text not in ('cancelled', 'void')
                               and i.description ~* '\m(balance|solde|saldo|restbetrag)\M') as live_balance,
             count(*) filter (where i.description ~* '\m(balance|solde|saldo|restbetrag)\M') as all_balance,
             count(*) filter (where i.status::text in ('cancelled', 'void')
                               and i.description ~* '\m(balance|solde|saldo|restbetrag)\M'
                               and (i.description ~* 'sponsor' or coalesce(i.cancel_reason, '') ~* 'sponsor')) as sponsored_balance,
             count(*) filter (where i.status::text not in ('cancelled', 'void')
                               and i.description ~* 'payments?\s+received|paiements?\s+re[çc]us|zahlungen\s+erhalten') as received,
             count(*) filter (where i.status::text not in ('cancelled', 'void')
                               and i.description !~* '\m(balance|solde|saldo|restbetrag)\M'
                               and i.description !~* 'payments?\s+received|paiements?\s+re[çc]us|zahlungen\s+erhalten') as unknown,
             coalesce(sum(i.total_chf + coalesce(i.adjustments_total, 0)) filter (where i.status::text not in ('cancelled', 'void')), 0) as fee,
             min(i.id::text) filter (where i.status::text not in ('cancelled', 'void')
                               and i.description ~* '\m(balance|solde|saldo|restbetrag)\M')::uuid as balance_invoice
        from public.invoices i
       where i.org_id = o.org_id and i.activity = 'club_membership' and i.membership_id is null and i.program_id is null
         and i.athlete_id is not null
       group by i.athlete_id
    loop
      v_bad := null;
      v_label := extract(year from se.starts_on)::int;
      if g.families > 1 then v_bad := 'SEVERAL_FAMILIES';
      elsif g.currencies > 1 then v_bad := 'SEVERAL_CURRENCIES';
      elsif g.labels > 1 then v_bad := 'SEVERAL_SEASON_PATTERNS';
      elsif g.unlabelled then v_bad := 'FEE_PATTERN_MISMATCH';
      elsif not (g.label_year = v_label
                 or se.name ~ (g.label_year::text || '\s*[-/–]\s*(20)?' || lpad(((g.label_year + 1) % 100)::text, 2, '0'))) then
        v_bad := 'SEASON_MISMATCH';
      elsif g.unknown > 0 or g.live_balance > 1 or g.received > 1 then v_bad := 'FEE_PATTERN_MISMATCH';
      elsif g.fee <= 0 and not (g.all_balance > 0 and g.sponsored_balance = g.all_balance) then v_bad := 'FEE_PATTERN_MISMATCH';
      elsif exists (select 1 from public.memberships m where m.athlete_id = g.athlete_id and m.season_id = se.id
                     and m.kind = 'season_fee' and m.status <> 'cancelled') then v_bad := 'MEMBERSHIP_EXISTS';
      end if;

      v_det := jsonb_build_object('invoice_ids', to_jsonb(g.ids), 'numbers', to_jsonb(g.numbers), 'season_id', se.id,
                                  'season_name', se.name, 'label_year', g.label_year, 'fee', g.fee);
      if v_bad is null then
        v_fee := g.fee;
        v_sponsored := g.all_balance > 0 and g.sponsored_balance = g.all_balance;
        select * into v_fam from public.families where id = g.family_id;
        begin
          insert into public.memberships (org_id, membership_type_id, family_id, athlete_id, valid_from, valid_until, status,
                                          price_amount, currency, season_id, kind, agreed_fee, sponsored, sponsored_notes, source)
          values (o.org_id, null, g.family_id, g.athlete_id, se.starts_on, se.ends_on, 'active', v_fee, g.currency,
                  se.id, 'season_fee', v_fee, v_sponsored, null, 'migration')
          returning id into v_mid;
          if v_fee > 0 then
            insert into public.membership_payers (org_id, membership_id, sort, payer_kind, family_id, payer_name, payer_email,
                                                  share_kind, share_value, amount, currency, invoice_id)
            values (o.org_id, v_mid, 1, 'family', g.family_id, left(coalesce(v_fam.contact_name, v_fam.name), 140),
                    left(v_fam.contact_email::text, 200), 'fixed', v_fee, v_fee, g.currency, g.balance_invoice);
          end if;
          -- Link only (activity unchanged, no money column touched).
          perform set_config('app.billing_edit', 'on', true);
          update public.invoices set membership_id = v_mid, charge_kind = 'season_fee' where id = any(g.ids);
          perform set_config('app.billing_edit', 'off', true);
          n_members := n_members + 1;
          n_linked := n_linked + cardinality(g.ids);
        exception when others then
          v_bad := 'MIGRATION_ERROR';
          v_det := v_det || jsonb_build_object('error', sqlerrm);
        end;
      end if;
      if v_bad is not null then
        insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details, original_reference)
        values (o.org_id, 'athletes', g.athlete_id, v_bad, v_det, left(array_to_string(g.numbers, ', '), 500))
        on conflict do nothing;
        n_flags := n_flags + 1;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('memberships', n_members, 'invoices_linked', n_linked, 'athletes_flagged', n_flags);
end $$;

select public.billing_migrate_club_fees(null);

-- ===========================================================================
-- 22. Grants
-- ===========================================================================
do $$
declare f text;
begin
  -- Internal: service role only.
  foreach f in array array[
    'public.billing_entity_snapshot_of(uuid)',
    'public.billing_entity_resolve(uuid, text)',
    'public.billing_derive_activity(uuid, uuid, uuid, uuid, uuid, text)',
    'public.billing_link_invoice_activity(uuid, text)',
    'public.billing_entity_default_for_org(uuid)',
    'public.receipt_allocate_internal(uuid, jsonb, uuid)',
    'public.receipt_refresh_status(uuid)',
    'public.receipt_allocated(uuid)',
    'public.receipt_summary(uuid)',
    'public.membership_plan_internal(jsonb, uuid)',
    'public.membership_issue_result(uuid)',
    'public.family_credit_balance_activity(uuid, text, text)',
    'public.billing_classify_invoice(uuid)',
    'public.billing_migrate_club_fees(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
  -- Trigger functions: not callable directly.
  foreach f in array array[
    'public.invoices_billing_before_insert()', 'public.invoices_billing_guard()', 'public.billing_link_activity_trigger()',
    'public.family_credit_entries_activity()', 'public.payments_receipt_link()', 'public.payments_receipt_status()',
    'public.payments_receipt_edit_guard()',
    'public.memberships_season_guard()', 'public.seasons_sync_memberships()', 'public.organizations_default_billing_entity()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  -- App-facing: authenticated (each re-checks role and org).
  foreach f in array array[
    'public.billing_activities()', 'public.is_billing_activity(text)', 'public.billing_is_club_fee_text(text)',
    'public.billing_season_label_year(text)', 'public.billing_flag_on(text)',
    'public.club_month_due_date(date, integer)',
    'public.club_installment_schedule(numeric, integer, date, integer, date, text)',
    'public.club_season_months_without_installment(date, integer, date, date)',
    'public.club_billing_settings()', 'public.club_billing_settings_set(jsonb)', 'public.club_season_bounds(date, integer)',
    'public.season_set_current(uuid)',
    'public.billing_entity_save(jsonb)', 'public.billing_entity_route_set(text, uuid)',
    'public.invoice_set_billing_entity(uuid, uuid)', 'public.invoice_set_activity(uuid, text, text)',
    'public.data_review_flag_resolve(uuid, text)',
    'public.create_manual_invoice(jsonb)',
    'public.apply_family_credit(uuid, numeric, text)',
    'public.adjust_family_credit(uuid, text, numeric, text, text)',
    'public.family_credit_assign_activity(uuid, text, text, numeric, text)',
    'public.family_balance_by_activity(uuid)',
    'public.receipt_record(jsonb)', 'public.receipt_allocate(uuid, jsonb, uuid)', 'public.receipt_void(uuid, text)',
    'public.receipt_unallocated()',
    'public.membership_preview(jsonb)', 'public.membership_issue(jsonb)',
    'public.membership_carry_forward(uuid, uuid, numeric, text, uuid)', 'public.membership_summary(uuid)',
    'public.invoice_source(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;
