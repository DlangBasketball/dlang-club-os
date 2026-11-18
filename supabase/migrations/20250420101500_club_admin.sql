-- ============================================================================
-- Club OS — Club administration, part 1:
--   1. Club MEMBERSHIP (types, records per person / family, renewal, member
--      pricing hook, digital card through the existing member card token)
--   2. Self-filling WAITING LISTS (programmes, camp weeks, training slots)
--   3. J+S (Jeunesse+Sport) support: settings, offers, coach numbers, AHV
--      number (encrypted, admin only), attendance export inputs
--   4. STAFF COMPLIANCE: certificates and checks with expiry, verification,
--      reminders, youth-team assignment block with admin override
--   5. INJURY & INCIDENT log (minors' health data: admin, the athlete's
--      guardians and the athlete's coaches only — finance never)
--
-- Design notes
--   * Every new table: org_id + index, RLS with a policy per verb, the
--     platform restrictive tenant / suspension policies, created_at /
--     updated_at, audit trigger. Tables holding health or identity data use
--     public.ca_audit_trigger(<columns to redact>) so audit_logs never hold
--     the sensitive values.
--   * Money-moving and multi-row writes are SECURITY DEFINER RPCs that are
--     either service-only (called by server actions after their own role /
--     tenant checks, org resolved server-side) or check the caller's role and
--     current_org_id() themselves. No RPC trusts a client org.
--   * Settings for the five features live in club_admin_settings (one row per
--     org; defaults apply when absent) — no per-club code paths.
--   * The J+S export is a file for MANUAL upload to the national database
--     (NDS). Field formats are marked [Verify with J+S/NDS] in the app/docs.
--
-- Additive and idempotent (if not exists / create or replace / drop policy if
-- exists + create policy / guarded constraint blocks).
-- ============================================================================

-- ===========================================================================
-- 0) HELPERS
-- ===========================================================================

-- The club's calendar day (club time zone).
create or replace function public.ca_org_today(p_org uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select (now() at time zone public.training_org_tz(p_org))::date;
$$;

-- Audit trigger that redacts the columns named in the trigger arguments
-- (special-category data: health, identity numbers, free-text notes).
create or replace function public.ca_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('UPDATE', 'INSERT') then to_jsonb(new) end;
  v_row jsonb;
  v_changed text[] := '{}';
  i int;
  c text;
begin
  v_row := coalesce(v_new, v_old);
  for i in 0 .. coalesce(tg_nargs, 0) - 1 loop
    c := tg_argv[i];
    if tg_op = 'UPDATE' and (v_old->c) is distinct from (v_new->c) then v_changed := v_changed || c; end if;
    if v_old ? c and jsonb_typeof(v_old->c) <> 'null' then v_old := jsonb_set(v_old, array[c], '"[redacted]"'); end if;
    if v_new ? c and jsonb_typeof(v_new->c) <> 'null' then v_new := jsonb_set(v_new, array[c], '"[redacted]"'); end if;
  end loop;
  if array_length(v_changed, 1) > 0 then
    v_new := v_new || jsonb_build_object('_changed_sensitive', to_jsonb(v_changed));
  end if;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values ((v_row->>'org_id')::uuid, auth.uid(), tg_op, tg_table_name, (v_row->>'id')::uuid, v_old, v_new);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Every "<column>:<table>" in the trigger arguments must point at a row of
-- the same org (no cross-tenant references, whoever writes the row).
create or replace function public.ca_same_org_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_org uuid  := (v_row->>'org_id')::uuid;
  v_arg text;
  v_id  uuid;
  v_ok  boolean;
begin
  foreach v_arg in array tg_argv loop
    v_id := nullif(v_row->>split_part(v_arg, ':', 1), '')::uuid;
    continue when v_id is null;
    execute format('select exists (select 1 from public.%I where id = $1 and org_id = $2)', split_part(v_arg, ':', 2))
      into v_ok using v_id, v_org;
    if not v_ok then
      raise exception 'CROSS_ORG_REFERENCE: %', split_part(v_arg, ':', 1) using errcode = 'P0001';
    end if;
  end loop;
  return new;
end;
$$;

-- Intent-level audit row written from inside an RPC.
create or replace function public.ca_audit(p_org uuid, p_action text, p_table text, p_id uuid, p_data jsonb default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (p_org, auth.uid(), p_action, p_table, p_id, p_data);
$$;

-- ===========================================================================
-- 1) SETTINGS (one row per org; defaults when absent)
-- ===========================================================================
create table if not exists public.club_admin_settings (
  org_id                          uuid primary key references public.organizations(id) on delete cascade,
  waitlist_offer_hours            integer not null default 48,
  waitlist_auto_offer             boolean not null default true,
  membership_renewal_window_days  integer not null default 30,
  js_enabled                      boolean not null default false,
  js_club_number                  text,
  js_age_min                      smallint not null default 5,
  js_age_max                      smallint not null default 20,
  js_rate_per_participant_hour    numeric(8,2),
  compliance_block_youth          boolean not null default false,
  compliance_mandatory_kinds      text[] not null default '{criminal_record_youth,child_protection,first_aid}',
  compliance_reminder_days        integer[] not null default '{60,30,7}',
  updated_by                      uuid references public.profiles(id) on delete set null,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);
create index if not exists idx_club_admin_settings_org on public.club_admin_settings(org_id);
do $$ begin
  alter table public.club_admin_settings add constraint club_admin_settings_chk check (
    waitlist_offer_hours between 1 and 336
    and membership_renewal_window_days between 1 and 180
    and (js_club_number is null or length(js_club_number) <= 40)
    and js_age_min between 0 and 99 and js_age_max between js_age_min and 99
    and (js_rate_per_participant_hour is null or js_rate_per_participant_hour between 0 and 1000)
    and compliance_mandatory_kinds <@ array['coaching_licence','first_aid','criminal_record','criminal_record_youth','child_protection','other']::text[]
    and cardinality(compliance_reminder_days) between 0 and 6
    and 0 < all(compliance_reminder_days) and 366 > all(compliance_reminder_days));
exception when duplicate_object then null; end $$;
drop trigger if exists trg_club_admin_settings_updated on public.club_admin_settings;
create trigger trg_club_admin_settings_updated before update on public.club_admin_settings
  for each row execute function public.set_updated_at();

create or replace function public.ca_settings(p_org uuid)
returns public.club_admin_settings
language plpgsql
stable
security definer
set search_path = public
as $$
declare s public.club_admin_settings;
begin
  select * into s from public.club_admin_settings where org_id = p_org;
  if not found then
    s.org_id := p_org;
    s.waitlist_offer_hours := 48; s.waitlist_auto_offer := true; s.membership_renewal_window_days := 30;
    s.js_enabled := false; s.js_age_min := 5; s.js_age_max := 20;
    s.compliance_block_youth := false;
    s.compliance_mandatory_kinds := '{criminal_record_youth,child_protection,first_aid}';
    s.compliance_reminder_days := '{60,30,7}';
  end if;
  return s;
end;
$$;

-- ===========================================================================
-- 2) MEMBERSHIP
-- ===========================================================================
create table if not exists public.membership_types (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  name                text not null,
  description         text,
  kind                text not null default 'player',     -- player | family | supporter | honorary | other
  scope               text not null default 'person',     -- person (one athlete) | family (household)
  price               numeric(12,2) not null default 0,
  currency            text,                                -- null = the club's currency
  period              text not null default 'season',     -- season | calendar_year
  season_start_month  smallint not null default 8,         -- season periods start on day 1 of this month
  min_age             smallint,
  max_age             smallint,
  is_active           boolean not null default true,
  sort                integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_membership_types_org on public.membership_types(org_id, sort);
do $$ begin
  alter table public.membership_types add constraint membership_types_chk check (
    length(btrim(name)) between 1 and 120 and coalesce(length(description), 0) <= 1000
    and kind in ('player', 'family', 'supporter', 'honorary', 'other')
    and scope in ('person', 'family')
    and price >= 0 and price <= 100000
    and (currency is null or currency ~ '^[A-Z]{3}$')
    and period in ('season', 'calendar_year')
    and season_start_month between 1 and 12
    and (min_age is null or min_age between 0 and 120)
    and (max_age is null or max_age between 0 and 120)
    and (min_age is null or max_age is null or max_age >= min_age));
exception when duplicate_object then null; end $$;
drop trigger if exists trg_membership_types_updated on public.membership_types;
create trigger trg_membership_types_updated before update on public.membership_types
  for each row execute function public.set_updated_at();

create table if not exists public.memberships (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  membership_type_id   uuid not null references public.membership_types(id) on delete restrict,
  family_id            uuid not null references public.families(id) on delete cascade,
  athlete_id           uuid references public.athletes(id) on delete cascade,
  valid_from           date not null,
  valid_until          date not null,
  status               text not null default 'pending_payment',  -- pending_payment | active | expired | cancelled
  price_amount         numeric(12,2) not null default 0,
  currency             text not null,
  invoice_id           uuid references public.invoices(id) on delete set null,
  renewed_from_id      uuid references public.memberships(id) on delete set null,
  renewal_reminded_at  timestamptz,
  cancelled_at         timestamptz,
  cancel_reason        text,
  created_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_memberships_org on public.memberships(org_id, status, valid_until);
create index if not exists idx_memberships_family on public.memberships(family_id, valid_from, valid_until);
create index if not exists idx_memberships_athlete on public.memberships(athlete_id);
create index if not exists idx_memberships_invoice on public.memberships(invoice_id);
create index if not exists idx_memberships_renewed_from on public.memberships(renewed_from_id);
do $$ begin
  alter table public.memberships add constraint memberships_chk check (
    valid_until >= valid_from and valid_until - valid_from <= 731
    and status in ('pending_payment', 'active', 'expired', 'cancelled')
    and price_amount >= 0 and currency ~ '^[A-Z]{3}$'
    and coalesce(length(cancel_reason), 0) <= 500);
exception when duplicate_object then null; end $$;
drop trigger if exists trg_memberships_updated on public.memberships;
create trigger trg_memberships_updated before update on public.memberships
  for each row execute function public.set_updated_at();
drop trigger if exists trg_memberships_same_org on public.memberships;
create trigger trg_memberships_same_org before insert or update on public.memberships
  for each row execute function public.ca_same_org_guard('membership_type_id:membership_types', 'family_id:families', 'athlete_id:athletes', 'invoice_id:invoices', 'renewed_from_id:memberships');

-- The athlete of a person membership belongs to the membership's family.
create or replace function public.memberships_athlete_family_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.athlete_id is not null and not exists (
       select 1 from public.athletes where id = new.athlete_id and family_id = new.family_id) then
    raise exception 'ATHLETE_NOT_IN_FAMILY' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_memberships_athlete_family on public.memberships;
create trigger trg_memberships_athlete_family before insert or update of athlete_id, family_id on public.memberships
  for each row execute function public.memberships_athlete_family_guard();

-- Member prices (optional, additive): camp price options and training packages.
alter table public.camp_price_options add column if not exists member_price numeric(12,2);
alter table public.credit_packages    add column if not exists member_price numeric(12,2);
do $$ begin
  alter table public.camp_price_options add constraint camp_price_options_member_price_chk
    check (member_price is null or (member_price >= 0 and member_price <= price));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.credit_packages add constraint credit_packages_member_price_chk
    check (member_price is null or (member_price >= 0 and member_price <= price_chf));
exception when duplicate_object then null; end $$;

-- Membership period containing a day. Mirrors src/lib/club-admin/membership.ts.
--   calendar_year: 1 Jan – 31 Dec of the day's year
--   season:        day 1 of p_start_month … the day before the next one
create or replace function public.membership_period(p_period text, p_start_month int, p_on date)
returns table (period_start date, period_end date)
language plpgsql
immutable
set search_path = public
as $$
declare v_start date; v_m int := coalesce(p_start_month, 8);
begin
  if p_period = 'calendar_year' then
    v_start := make_date(extract(year from p_on)::int, 1, 1);
  else
    v_start := make_date(extract(year from p_on)::int - case when extract(month from p_on)::int < v_m then 1 else 0 end, v_m, 1);
  end if;
  period_start := v_start;
  period_end := (v_start + interval '1 year' - interval '1 day')::date;
  return next;
end;
$$;

-- Is the family a club member on a day? An ACTIVE membership (paid or free)
-- whose validity covers the day. Service callers, or members of the same club.
create or replace function public.is_member(p_family uuid, p_on date default null)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid;
begin
  select org_id into v_org from public.families where id = p_family;
  if v_org is null then return false; end if;
  if not public.is_service_caller() and v_org is distinct from public.current_org_id() then return false; end if;
  return exists (
    select 1 from public.memberships m
     where m.family_id = p_family and m.status = 'active'
       and coalesce(p_on, public.ca_org_today(v_org)) between m.valid_from and m.valid_until);
end;
$$;

-- membership_create(payload): join or renew. Service only (server actions
-- check the role — admin, or the family's guardian for a renewal — first).
-- payload = { org_id, type_id, family_id, athlete_id?, valid_from?, renew_from_id?,
--             created_by?, due_days?, free? (admin: honorary / no invoice) }
create or replace function public.membership_create(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      uuid := nullif(p_payload->>'org_id', '')::uuid;
  v_type     public.membership_types;
  v_prev     public.memberships;
  v_family   uuid;
  v_athlete  uuid := nullif(p_payload->>'athlete_id', '')::uuid;
  v_dob      date;
  v_age      int;
  v_from     date;
  v_until    date;
  v_today    date;
  v_currency text;
  v_exp      int;
  v_price    numeric;
  v_free     boolean := coalesce((p_payload->>'free')::boolean, false);
  v_due      int := least(greatest(coalesce((p_payload->>'due_days')::int, 30), 0), 120);
  v_invoice  uuid;
  v_invnum   text;
  v_id       uuid;
  v_by       uuid := nullif(p_payload->>'created_by', '')::uuid;
  v_name     text;
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if v_org is null then raise exception 'ORG_REQUIRED' using errcode = 'P0001'; end if;
  v_today := public.ca_org_today(v_org);

  if nullif(p_payload->>'renew_from_id', '') is not null then
    select * into v_prev from public.memberships
     where id = (p_payload->>'renew_from_id')::uuid and org_id = v_org for update;
    if not found then raise exception 'MEMBERSHIP_NOT_FOUND' using errcode = 'P0002'; end if;
    if v_prev.status = 'cancelled' then raise exception 'MEMBERSHIP_CANCELLED' using errcode = 'P0001'; end if;
    if exists (select 1 from public.memberships where renewed_from_id = v_prev.id and status <> 'cancelled') then
      raise exception 'ALREADY_RENEWED' using errcode = 'P0001';
    end if;
    v_family := v_prev.family_id;
    v_athlete := v_prev.athlete_id;
    select * into v_type from public.membership_types
     where id = coalesce(nullif(p_payload->>'type_id', '')::uuid, v_prev.membership_type_id) and org_id = v_org;
    -- The renewal starts the day after the previous period (or today if it lapsed long ago).
    v_from := greatest(v_prev.valid_until + 1, (select period_start from public.membership_period(v_type.period, v_type.season_start_month, v_today)));
  else
    select * into v_type from public.membership_types where id = nullif(p_payload->>'type_id', '')::uuid and org_id = v_org;
    select id into v_family from public.families where id = nullif(p_payload->>'family_id', '')::uuid and org_id = v_org;
    v_from := coalesce(nullif(p_payload->>'valid_from', '')::date, v_today);
  end if;
  if v_type.id is null then raise exception 'TYPE_NOT_FOUND' using errcode = 'P0002'; end if;
  if not v_type.is_active then raise exception 'TYPE_INACTIVE' using errcode = 'P0001'; end if;
  if v_family is null then raise exception 'FAMILY_NOT_FOUND' using errcode = 'P0002'; end if;

  if v_type.scope = 'person' then
    if v_athlete is null then raise exception 'ATHLETE_REQUIRED' using errcode = 'P0001'; end if;
    select dob, btrim(first_name || ' ' || last_name) into v_dob, v_name
      from public.athletes where id = v_athlete and family_id = v_family and org_id = v_org;
    if not found then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
    v_age := extract(year from age(v_from, v_dob))::int;
    if (v_type.min_age is not null and v_age < v_type.min_age) or (v_type.max_age is not null and v_age > v_type.max_age) then
      raise exception 'AGE_OUT_OF_RANGE' using errcode = 'P0001';
    end if;
  else
    v_athlete := null;
    select name into v_name from public.families where id = v_family;
  end if;

  select period_end into v_until from public.membership_period(v_type.period, v_type.season_start_month, v_from);

  if exists (select 1 from public.memberships m
              where m.org_id = v_org and m.family_id = v_family and m.membership_type_id = v_type.id
                and m.athlete_id is not distinct from v_athlete and m.status in ('active', 'pending_payment')
                and daterange(m.valid_from, m.valid_until, '[]') && daterange(v_from, v_until, '[]')) then
    raise exception 'ALREADY_MEMBER' using errcode = 'P0001';
  end if;

  v_currency := upper(coalesce(v_type.currency, public.org_currency(v_org)));
  v_exp := public.currency_exponent(v_currency);
  v_price := case when v_free then 0 else round(v_type.price, v_exp) end;

  insert into public.memberships (org_id, membership_type_id, family_id, athlete_id, valid_from, valid_until, status,
                                  price_amount, currency, renewed_from_id, created_by)
  values (v_org, v_type.id, v_family, v_athlete, v_from, v_until,
          case when v_price > 0 then 'pending_payment' else 'active' end,
          v_price, v_currency, v_prev.id, v_by)
  returning id into v_id;

  if v_price > 0 then
    v_invnum := public.next_invoice_number(v_org);
    insert into public.invoices (org_id, number, family_id, athlete_id, description, status, due_date, currency, total_chf, created_by)
    values (v_org, v_invnum, v_family, v_athlete, left(v_type.name, 500), 'sent', v_today + v_due, v_currency, v_price, v_by)
    returning id into v_invoice;
    insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
    values (v_org, v_invoice, left(v_type.name || ' — ' || coalesce(v_name, '') || ' — '
                                   || to_char(v_from, 'DD.MM.YYYY') || '–' || to_char(v_until, 'DD.MM.YYYY'), 500),
            1, v_price, v_price);
    update public.memberships set invoice_id = v_invoice where id = v_id;
  end if;

  perform public.ca_audit(v_org, case when v_prev.id is null then 'membership.join' else 'membership.renew' end,
                          'memberships', v_id, jsonb_build_object('type_id', v_type.id, 'invoice_id', v_invoice, 'by', v_by));

  return jsonb_build_object('membership_id', v_id, 'invoice_id', v_invoice, 'invoice_number', v_invnum,
                            'amount', v_price, 'currency', v_currency, 'valid_from', v_from, 'valid_until', v_until,
                            'family_id', v_family, 'athlete_id', v_athlete);
end;
$$;

-- Paid invoice -> the pending membership becomes active (any payment path).
create or replace function public.memberships_on_invoice_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status::text = 'paid' and old.status::text is distinct from 'paid' then
    update public.memberships set status = 'active'
     where invoice_id = new.id and org_id = new.org_id and status = 'pending_payment';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_invoices_membership_paid on public.invoices;
create trigger trg_invoices_membership_paid after update of status on public.invoices
  for each row execute function public.memberships_on_invoice_paid();

-- Daily: active memberships past their end date -> expired. Service only.
create or replace function public.membership_expire_due(p_org uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n int;
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  update public.memberships m set status = 'expired'
   where m.status = 'active' and (p_org is null or m.org_id = p_org)
     and m.valid_until < public.ca_org_today(m.org_id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Member price hook (service only): after a camp registration / training
-- package purchase, a member family pays the member price. The difference is
-- a negative line on the still unpaid invoice; the registration's price
-- snapshot / the purchase's discount record it. Idempotent.
--   p_kind: 'camp_registration' | 'training_purchase'
create or replace function public.apply_member_price(p_kind text, p_id uuid, p_label text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r        public.registrations;
  p        public.training_package_purchases;
  v_org    uuid;
  v_family uuid;
  v_inv    public.invoices;
  v_member numeric;
  v_list   numeric;
  v_left   numeric;
  v_delta  numeric;
  v_on     date;
  v_cur    text;
  v_label  text := coalesce(nullif(btrim(p_label), ''), 'Member price');
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;

  if p_kind = 'camp_registration' then
    select * into r from public.registrations where id = p_id for update;
    if not found or r.camp_price_option_id is null or r.invoice_id is null or r.price_amount is null then
      return jsonb_build_object('applied', false, 'reason', 'not_applicable');
    end if;
    if coalesce((r.price_snapshot->>'member_price_applied')::boolean, false) then
      return jsonb_build_object('applied', false, 'reason', 'already_applied');
    end if;
    v_org := r.org_id;
    select family_id into v_family from public.athletes where id = r.athlete_id;
    select o.member_price into v_member from public.camp_price_options o where o.id = r.camp_price_option_id;
    select coalesce(e.starts_on, public.ca_org_today(v_org)) into v_on from public.camp_editions e where e.id = r.camp_edition_id;
    v_list := r.price_list_amount; v_left := r.price_amount; v_cur := r.price_currency;
  elsif p_kind = 'training_purchase' then
    select * into p from public.training_package_purchases where id = p_id for update;
    if not found or p.package_id is null or p.invoice_id is null then
      return jsonb_build_object('applied', false, 'reason', 'not_applicable');
    end if;
    v_org := p.org_id;
    v_family := coalesce(p.family_id, (select family_id from public.athletes where id = p.athlete_id));
    select k.member_price into v_member from public.credit_packages k where k.id = p.package_id;
    if v_member is not null and exists (
         select 1 from public.invoice_items where invoice_id = p.invoice_id and description like '% [member]') then
      return jsonb_build_object('applied', false, 'reason', 'already_applied');
    end if;
    v_on := public.ca_org_today(v_org);
    v_list := p.list_price; v_left := p.amount; v_cur := p.currency;
  else
    raise exception 'INVALID_KIND' using errcode = 'P0001';
  end if;

  if v_member is null or v_member >= v_list then return jsonb_build_object('applied', false, 'reason', 'no_member_price'); end if;
  if not public.is_member(v_family, v_on) then return jsonb_build_object('applied', false, 'reason', 'not_member'); end if;

  select * into v_inv from public.invoices where id = coalesce(r.invoice_id, p.invoice_id) and org_id = v_org for update;
  if v_inv.status::text not in ('draft', 'sent', 'pending')
     or exists (select 1 from public.payments where invoice_id = v_inv.id and status in ('succeeded', 'pending')) then
    return jsonb_build_object('applied', false, 'reason', 'invoice_not_open');
  end if;

  v_delta := least(round(v_list - v_member, public.currency_exponent(v_cur)), v_left);
  if v_delta <= 0 then return jsonb_build_object('applied', false, 'reason', 'nothing'); end if;

  insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
  values (v_org, v_inv.id, left(v_label, 480) || ' [member]', 1, -v_delta, -v_delta);
  perform set_config('app.money_edit', 'on', true);
  update public.invoices set total_chf = total_chf - v_delta where id = v_inv.id;
  perform set_config('app.money_edit', 'off', true);

  if p_kind = 'camp_registration' then
    perform set_config('app.camp_pricing', 'on', true);
    update public.registrations
       set price_discount_amount = coalesce(price_discount_amount, 0) + v_delta,
           price_amount = price_amount - v_delta,
           price_snapshot = coalesce(price_snapshot, '{}'::jsonb)
             || jsonb_build_object('member_price_applied', true, 'member_price', v_member, 'member_discount', v_delta,
                                   'amount', price_amount - v_delta)
     where id = r.id;
    perform set_config('app.camp_pricing', 'off', true);
  else
    update public.training_package_purchases
       set discount_total = discount_total + v_delta, amount = amount - v_delta
     where id = p.id;
  end if;

  perform public.ca_audit(v_org, 'membership.member_price', case when p_kind = 'camp_registration' then 'registrations' else 'training_package_purchases' end,
                          p_id, jsonb_build_object('amount', v_delta, 'currency', v_cur, 'invoice_id', v_inv.id));
  return jsonb_build_object('applied', true, 'amount', v_delta, 'currency', v_cur, 'invoice_id', v_inv.id);
end;
$$;

-- ===========================================================================
-- 3) WAITING LISTS
-- ===========================================================================
create table if not exists public.waitlist_entries (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  target_kind      text not null,                       -- program | camp_edition | training_slot
  target_key       text not null,                       -- set by trigger (groups one list)
  program_id       uuid references public.programs(id) on delete cascade,
  camp_edition_id  uuid references public.camp_editions(id) on delete cascade,
  service_id       uuid references public.training_services(id) on delete cascade,
  coach_id         uuid references public.coaches(id) on delete cascade,
  slot_start       timestamptz,
  athlete_id       uuid not null references public.athletes(id) on delete cascade,
  family_id        uuid not null references public.families(id) on delete cascade,
  position         integer not null default 0,
  status           text not null default 'waiting',     -- waiting | offered | accepted | declined | expired | skipped | removed
  request          jsonb not null default '{}'::jsonb,  -- camp: price_option_id, age_group_id, days
  offer_token_hash text,
  offered_at       timestamptz,
  offer_expires_at timestamptz,
  offer_count      integer not null default 0,
  responded_at     timestamptz,
  registration_id  uuid references public.registrations(id) on delete set null,
  booking_id       uuid references public.training_bookings(id) on delete set null,
  invoice_id       uuid references public.invoices(id) on delete set null,
  skip_reason      text,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_waitlist_org on public.waitlist_entries(org_id, status);
create index if not exists idx_waitlist_target on public.waitlist_entries(org_id, target_key, status, position);
create index if not exists idx_waitlist_athlete on public.waitlist_entries(athlete_id);
create index if not exists idx_waitlist_family on public.waitlist_entries(family_id);
create unique index if not exists waitlist_token_uidx on public.waitlist_entries(offer_token_hash) where offer_token_hash is not null;
create unique index if not exists waitlist_one_active_uidx on public.waitlist_entries(org_id, target_key, athlete_id)
  where status in ('waiting', 'offered');
do $$ begin
  alter table public.waitlist_entries add constraint waitlist_entries_chk check (
    target_kind in ('program', 'camp_edition', 'training_slot')
    and status in ('waiting', 'offered', 'accepted', 'declined', 'expired', 'skipped', 'removed')
    and position >= 0 and offer_count between 0 and 1000
    and (target_kind <> 'program' or program_id is not null)
    and (target_kind <> 'camp_edition' or camp_edition_id is not null)
    and (target_kind <> 'training_slot' or (service_id is not null and coach_id is not null and slot_start is not null))
    and (status <> 'offered' or (offer_token_hash is not null and offer_expires_at is not null))
    and coalesce(length(skip_reason), 0) <= 500
    and jsonb_typeof(request) = 'object');
exception when duplicate_object then null; end $$;
drop trigger if exists trg_waitlist_entries_updated on public.waitlist_entries;
create trigger trg_waitlist_entries_updated before update on public.waitlist_entries
  for each row execute function public.set_updated_at();
drop trigger if exists trg_waitlist_entries_same_org on public.waitlist_entries;
create trigger trg_waitlist_entries_same_org before insert or update on public.waitlist_entries
  for each row execute function public.ca_same_org_guard('program_id:programs', 'camp_edition_id:camp_editions', 'service_id:training_services',
                                                        'coach_id:coaches', 'athlete_id:athletes', 'family_id:families',
                                                        'registration_id:registrations', 'invoice_id:invoices',
                                                        'booking_id:training_bookings');

-- Normalise the target (edition -> its programme), check the athlete's
-- family, set the list key and append at the end of the list.
create or replace function public.waitlist_entries_prepare()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.target_kind = 'camp_edition' then
    select program_id into new.program_id from public.camp_editions where id = new.camp_edition_id and org_id = new.org_id;
    if new.program_id is null then raise exception 'CROSS_TENANT_REFERENCE: edition' using errcode = '42501'; end if;
  end if;
  if not exists (select 1 from public.athletes where id = new.athlete_id and family_id = new.family_id and org_id = new.org_id) then
    raise exception 'ATHLETE_NOT_IN_FAMILY' using errcode = 'P0001';
  end if;
  new.target_key := case new.target_kind
    when 'program' then 'p:' || new.program_id
    when 'camp_edition' then 'e:' || new.camp_edition_id
    else 't:' || new.coach_id || ':' || new.service_id || ':' || to_char(new.slot_start at time zone 'UTC', 'YYYYMMDD"T"HH24MI') end;
  if tg_op = 'INSERT' and coalesce(new.position, 0) = 0 then
    select coalesce(max(position), 0) + 1 into new.position from public.waitlist_entries
     where org_id = new.org_id and target_key = new.target_key;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_waitlist_entries_prepare on public.waitlist_entries;
create trigger trg_waitlist_entries_prepare before insert or update of target_kind, program_id, camp_edition_id, service_id, coach_id, slot_start, athlete_id, family_id
  on public.waitlist_entries for each row execute function public.waitlist_entries_prepare();

-- Spots of a list: capacity, taken (registrations / bookings) and held
-- (open, unexpired offers). capacity null = unlimited.
create or replace function public.waitlist_spots(p_entry public.waitlist_entries)
returns table (capacity integer, taken integer, held integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_entry.target_kind = 'program' then
    select pr.capacity into capacity from public.programs pr where pr.id = p_entry.program_id;
    select count(*) into taken from public.registrations r
     where r.program_id = p_entry.program_id and r.camp_edition_id is null and r.status in ('pending', 'confirmed');
  elsif p_entry.target_kind = 'camp_edition' then
    select e.capacity into capacity from public.camp_editions e where e.id = p_entry.camp_edition_id;
    select count(*) into taken from public.registrations r
     where r.camp_edition_id = p_entry.camp_edition_id and r.status in ('pending', 'confirmed');
  else
    select s.max_participants into capacity from public.training_services s where s.id = p_entry.service_id;
    select count(*) into taken from public.training_bookings b
     where b.coach_id = p_entry.coach_id and b.service_id = p_entry.service_id and b.slot_start = p_entry.slot_start
       and b.status in ('booked', 'completed');
  end if;
  select count(*) into held from public.waitlist_entries w
   where w.org_id = p_entry.org_id and w.target_key = p_entry.target_key and w.status = 'offered' and w.offer_expires_at > now();
  return next;
end;
$$;

-- Make one offer (internal): token returned once, only its hash is stored.
create or replace function public.waitlist_make_offer(p_entry uuid, p_hours int)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_token text := encode(gen_random_bytes(24), 'hex');
begin
  update public.waitlist_entries
     set status = 'offered', offer_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
         offered_at = now(), offer_expires_at = now() + make_interval(hours => greatest(1, p_hours)),
         offer_count = offer_count + 1, responded_at = null
   where id = p_entry and status in ('waiting', 'offered');
  if not found then raise exception 'ENTRY_NOT_WAITING' using errcode = 'P0001'; end if;
  return v_token;
end;
$$;

-- waitlist_process(org, target_key?, force_entry?): expire overdue offers,
-- then offer every free spot to the next waiting person (by position).
-- p_force_entry: an admin offers to this entry now, even without a free spot.
-- Service only. Returns [{entry_id, token, expires_at}] for the emails.
create or replace function public.waitlist_process(p_org uuid default null, p_target_key text default null, p_force_entry uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out   jsonb := '[]'::jsonb;
  v_key   record;
  v_head  public.waitlist_entries;
  v_spots record;
  v_free  int;
  v_set   public.club_admin_settings;
  v_tok   text;
  v_n     int := 0;
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;

  update public.waitlist_entries
     set status = 'expired', responded_at = now()
   where status = 'offered' and offer_expires_at <= now()
     and (p_org is null or org_id = p_org) and (p_target_key is null or target_key = p_target_key);

  if p_force_entry is not null then
    select * into v_head from public.waitlist_entries where id = p_force_entry and (p_org is null or org_id = p_org) for update;
    if not found or v_head.status <> 'waiting' then raise exception 'ENTRY_NOT_WAITING' using errcode = 'P0001'; end if;
    v_set := public.ca_settings(v_head.org_id);
    v_tok := public.waitlist_make_offer(v_head.id, v_set.waitlist_offer_hours);
    return jsonb_build_array(jsonb_build_object('entry_id', v_head.id, 'token', v_tok,
                             'expires_at', (select offer_expires_at from public.waitlist_entries where id = v_head.id)));
  end if;

  for v_key in
    select distinct w.org_id, w.target_key from public.waitlist_entries w
     where w.status = 'waiting' and (p_org is null or w.org_id = p_org) and (p_target_key is null or w.target_key = p_target_key)
  loop
    v_set := public.ca_settings(v_key.org_id);
    continue when not v_set.waitlist_auto_offer;
    -- Serialise per list: lock the target row.
    select * into v_head from public.waitlist_entries
     where org_id = v_key.org_id and target_key = v_key.target_key and status = 'waiting'
     order by position, created_at limit 1;
    if v_head.target_kind = 'program' then perform 1 from public.programs where id = v_head.program_id for update;
    elsif v_head.target_kind = 'camp_edition' then perform 1 from public.camp_editions where id = v_head.camp_edition_id for update;
    else perform 1 from public.training_services where id = v_head.service_id for update; end if;

    select * into v_spots from public.waitlist_spots(v_head);
    v_free := case when v_spots.capacity is null then 1000000 else v_spots.capacity - v_spots.taken - v_spots.held end;
    while v_free > 0 and v_n < 500 loop
      select * into v_head from public.waitlist_entries
       where org_id = v_key.org_id and target_key = v_key.target_key and status = 'waiting'
       order by position, created_at limit 1 for update skip locked;
      exit when not found;
      v_tok := public.waitlist_make_offer(v_head.id, v_set.waitlist_offer_hours);
      v_out := v_out || jsonb_build_object('entry_id', v_head.id, 'token', v_tok,
                                           'expires_at', now() + make_interval(hours => v_set.waitlist_offer_hours));
      v_free := v_free - 1;
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_out;
end;
$$;

-- Offer details for the public acceptance page (by token). Service only.
-- Child FIRST name only; no other personal data.
create or replace function public.waitlist_offer_lookup(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare w public.waitlist_entries; v_name text; v_child text; v_when text;
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into w from public.waitlist_entries where offer_token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if not found then return null; end if;
  select first_name into v_child from public.athletes where id = w.athlete_id;
  if w.target_kind = 'training_slot' then
    select name into v_name from public.training_services where id = w.service_id;
  else
    select name into v_name from public.programs where id = w.program_id;
  end if;
  if w.target_kind = 'camp_edition' then
    select to_char(starts_on, 'YYYY-MM-DD') || '/' || to_char(ends_on, 'YYYY-MM-DD') into v_when from public.camp_editions where id = w.camp_edition_id;
  elsif w.target_kind = 'training_slot' then
    v_when := to_char(w.slot_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;
  return jsonb_build_object('entry_id', w.id, 'org_id', w.org_id, 'status', w.status, 'kind', w.target_kind,
                            'target_name', v_name, 'when', v_when, 'child_first_name', v_child,
                            'expires_at', w.offer_expires_at,
                            'expired', w.status = 'offered' and w.offer_expires_at <= now());
end;
$$;

-- Accept / decline an offer (by token). Service only (public page action;
-- the token is the credential). Accept re-checks capacity, then confirms the
-- registration (programme / camp week) or the booking (training slot) and
-- issues the invoice. p_label = translated invoice line suffix (optional).
create or replace function public.waitlist_respond(p_token text, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  w         public.waitlist_entries;
  v_spots   record;
  v_prog    public.programs;
  v_ed      public.camp_editions;
  v_opt     public.camp_price_options;
  v_grp     public.camp_age_groups;
  v_svc     public.training_services;
  v_cur     text;
  v_exp     int;
  v_price   numeric := 0;
  v_reg     uuid;
  v_book    uuid;
  v_invoice uuid;
  v_invnum  text;
  v_name    text;
  v_desc    text;
  v_days    date[];
  v_today   date;
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into w from public.waitlist_entries
   where offer_token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') for update;
  if not found then raise exception 'OFFER_NOT_FOUND' using errcode = 'P0002'; end if;
  if w.status <> 'offered' then raise exception 'OFFER_NOT_OPEN' using errcode = 'P0001'; end if;
  if w.offer_expires_at <= now() then
    update public.waitlist_entries set status = 'expired', responded_at = now() where id = w.id;
    return jsonb_build_object('status', 'expired', 'entry_id', w.id, 'org_id', w.org_id, 'target_key', w.target_key);
  end if;

  if not p_accept then
    update public.waitlist_entries set status = 'declined', responded_at = now() where id = w.id;
    perform public.ca_audit(w.org_id, 'waitlist.decline', 'waitlist_entries', w.id, null);
    return jsonb_build_object('status', 'declined', 'entry_id', w.id, 'org_id', w.org_id, 'target_key', w.target_key);
  end if;

  v_today := public.ca_org_today(w.org_id);
  select btrim(first_name || ' ' || last_name) into v_name from public.athletes where id = w.athlete_id;

  -- Lock the target, re-check the spot (this offer holds one of the held spots).
  if w.target_kind = 'program' then
    select * into v_prog from public.programs where id = w.program_id for update;
  elsif w.target_kind = 'camp_edition' then
    select * into v_ed from public.camp_editions where id = w.camp_edition_id for update;
    select * into v_prog from public.programs where id = w.program_id;
  else
    select * into v_svc from public.training_services where id = w.service_id for update;
  end if;
  select * into v_spots from public.waitlist_spots(w);
  if v_spots.capacity is not null and v_spots.taken + greatest(v_spots.held - 1, 0) >= v_spots.capacity then
    raise exception 'NO_SPOT_LEFT' using errcode = 'P0001';
  end if;

  if w.target_kind in ('program', 'camp_edition') then
    v_cur := upper(coalesce(v_prog.currency, public.org_currency(w.org_id)));
  else
    v_cur := upper(coalesce(v_svc.currency, public.org_currency(w.org_id)));
  end if;
  v_exp := public.currency_exponent(v_cur);

  if w.target_kind = 'camp_edition' then
    select * into v_opt from public.camp_price_options
     where id = nullif(w.request->>'price_option_id', '')::uuid and program_id = w.program_id and org_id = w.org_id
       and is_active and (edition_id is null or edition_id = w.camp_edition_id);
    if not found then raise exception 'PRICE_OPTION_NOT_FOUND' using errcode = 'P0002'; end if;
    select * into v_grp from public.camp_age_groups
     where id = nullif(w.request->>'age_group_id', '')::uuid and program_id = w.program_id and org_id = w.org_id;
    select coalesce(array_agg(distinct x::date order by x::date), '{}') into v_days
      from jsonb_array_elements_text(coalesce(w.request->'days', '[]'::jsonb)) x;
    if coalesce(array_length(v_days, 1), 0) <> v_opt.days_count then
      -- default: the first N days of the week
      select array_agg(d::date order by d) into v_days
        from generate_series(v_ed.starts_on, v_ed.ends_on, interval '1 day') d
       where d::date - v_ed.starts_on < v_opt.days_count;
    end if;
    v_price := round(v_opt.price, v_exp);
  elsif w.target_kind = 'program' then
    v_price := round(coalesce(v_prog.price_chf, 0), v_exp);
  else
    v_price := round(coalesce(v_svc.price_chf, 0), v_exp);
  end if;

  if v_price > 0 then
    v_invnum := public.next_invoice_number(w.org_id);
    insert into public.invoices (org_id, number, family_id, athlete_id, program_id, description, status, due_date, currency, total_chf)
    values (w.org_id, v_invnum, w.family_id, w.athlete_id, w.program_id,
            left(coalesce(v_prog.name, v_svc.name), 500), 'sent', v_today + 14, v_cur, v_price)
    returning id into v_invoice;
    v_desc := coalesce(v_prog.name, v_svc.name) || coalesce(' — ' || v_opt.label, '') || ' — ' || coalesce(v_name, '');
    insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
    values (w.org_id, v_invoice, left(v_desc, 500), 1, v_price, v_price);
  end if;

  if w.target_kind = 'program' then
    select id into v_reg from public.registrations
     where athlete_id = w.athlete_id and program_id = w.program_id and camp_edition_id is null for update;
    if v_reg is not null then
      update public.registrations set status = 'confirmed', cancelled_at = null, cancellation_reason = null, cancelled_by = null
       where id = v_reg;
    else
      insert into public.registrations (org_id, athlete_id, program_id, status)
      values (w.org_id, w.athlete_id, w.program_id, 'confirmed') returning id into v_reg;
    end if;
    perform set_config('app.camp_pricing', 'on', true);
    update public.registrations set invoice_id = coalesce(v_invoice, invoice_id) where id = v_reg;
    perform set_config('app.camp_pricing', 'off', true);
  elsif w.target_kind = 'camp_edition' then
    perform set_config('app.camp_pricing', 'on', true);
    delete from public.registrations
     where athlete_id = w.athlete_id and camp_edition_id = w.camp_edition_id and status in ('cancelled', 'waitlist');
    insert into public.registrations
      (org_id, athlete_id, program_id, status, camp_edition_id, camp_price_option_id, camp_age_group_id, camp_days,
       camp_includes_lunch, invoice_id, price_list_amount, price_discount_amount, price_amount, price_currency, price_snapshot)
    values
      (w.org_id, w.athlete_id, w.program_id, 'confirmed', w.camp_edition_id, v_opt.id, v_grp.id, v_days,
       v_opt.includes_lunch, v_invoice, v_price, 0, v_price, v_cur,
       jsonb_build_object('program', v_prog.name, 'edition_id', v_ed.id, 'edition_name', v_ed.name,
                          'starts_on', v_ed.starts_on, 'ends_on', v_ed.ends_on, 'option_id', v_opt.id,
                          'option_label', v_opt.label, 'days_count', v_opt.days_count, 'includes_lunch', v_opt.includes_lunch,
                          'age_group', v_grp.label, 'days', to_jsonb(v_days), 'currency', v_cur,
                          'list_amount', v_price, 'discount_amount', 0, 'amount', v_price, 'discounts', '[]'::jsonb,
                          'source', 'waitlist', 'priced_at', now()))
    returning id into v_reg;
    perform set_config('app.camp_pricing', 'off', true);
  else
    insert into public.training_bookings (org_id, athlete_id, service_id, coach_id, slot_start, slot_end, status, price_chf, invoice_id)
    values (w.org_id, w.athlete_id, w.service_id, w.coach_id, w.slot_start,
            w.slot_start + make_interval(mins => coalesce(v_svc.duration_min, 60)), 'booked', v_price, v_invoice)
    returning id into v_book;
  end if;

  if v_invoice is not null and v_reg is not null then
    update public.invoices set registration_id = v_reg where id = v_invoice;
  end if;

  update public.waitlist_entries
     set status = 'accepted', responded_at = now(), registration_id = v_reg, booking_id = v_book, invoice_id = v_invoice
   where id = w.id;
  perform public.ca_audit(w.org_id, 'waitlist.accept', 'waitlist_entries', w.id,
                          jsonb_build_object('registration_id', v_reg, 'booking_id', v_book, 'invoice_id', v_invoice));
  return jsonb_build_object('status', 'accepted', 'entry_id', w.id, 'org_id', w.org_id, 'target_key', w.target_key,
                            'registration_id', v_reg, 'booking_id', v_book, 'invoice_id', v_invoice,
                            'invoice_number', v_invnum, 'amount', v_price, 'currency', v_cur, 'family_id', w.family_id);
end;
$$;

-- Admin: move an entry to a position in its list (1 = first). Renumbers the
-- open entries 1..n. Admin of the entry's club only.
create or replace function public.waitlist_move(p_entry uuid, p_position int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare w public.waitlist_entries; v_ids uuid[]; i int;
begin
  select * into w from public.waitlist_entries where id = p_entry;
  if not found or w.org_id is distinct from public.current_org_id() or not public.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if w.status not in ('waiting', 'offered') then raise exception 'ENTRY_NOT_WAITING' using errcode = 'P0001'; end if;
  select array_agg(id order by position, created_at) into v_ids from public.waitlist_entries
   where org_id = w.org_id and target_key = w.target_key and status in ('waiting', 'offered') and id <> w.id;
  v_ids := coalesce(v_ids, '{}');
  p_position := least(greatest(coalesce(p_position, 1), 1), coalesce(array_length(v_ids, 1), 0) + 1);
  v_ids := v_ids[1:p_position - 1] || w.id || v_ids[p_position:];
  for i in 1 .. array_length(v_ids, 1) loop
    update public.waitlist_entries set position = i where id = v_ids[i] and position <> i;
  end loop;
  perform public.ca_audit(w.org_id, 'waitlist.move', 'waitlist_entries', w.id, jsonb_build_object('position', p_position));
end;
$$;

-- ===========================================================================
-- 4) J+S (Jeunesse+Sport)
-- ===========================================================================
alter table public.coaches  add column if not exists js_person_number text;
alter table public.programs add column if not exists js_offer boolean not null default false;
alter table public.programs add column if not exists js_offer_number text;
alter table public.programs add column if not exists js_session_minutes smallint;
alter table public.teams    add column if not exists js_offer boolean not null default false;
alter table public.teams    add column if not exists is_youth boolean not null default true;
do $$ begin
  alter table public.coaches add constraint coaches_js_person_number_chk
    check (js_person_number is null or js_person_number ~ '^[0-9A-Za-z .-]{1,30}$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.programs add constraint programs_js_chk
    check ((js_offer_number is null or length(js_offer_number) <= 40)
       and (js_session_minutes is null or js_session_minutes between 15 and 600));
exception when duplicate_object then null; end $$;

-- Encryption keys for identity numbers (one per club). No policies: only the
-- security-definer functions below read them.
create table if not exists public.ca_pii_keys (
  org_id     uuid primary key references public.organizations(id) on delete cascade,
  secret     text not null,
  created_at timestamptz not null default now()
);
alter table public.ca_pii_keys enable row level security;
drop policy if exists ca_pii_keys_none on public.ca_pii_keys;
create policy ca_pii_keys_none on public.ca_pii_keys for all using (false) with check (false);

-- AHV/AVS number of an athlete (Swiss social insurance number), stored only
-- with documented consent, encrypted, readable by the club's admins only.
create table if not exists public.athlete_identifiers (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  athlete_id           uuid not null unique references public.athletes(id) on delete cascade,
  ahv_cipher           bytea,
  ahv_last4            text,
  consent_recorded_at  timestamptz,
  consent_recorded_by  uuid references public.profiles(id) on delete set null,
  consent_note         text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_athlete_identifiers_org on public.athlete_identifiers(org_id);
do $$ begin
  alter table public.athlete_identifiers add constraint athlete_identifiers_chk
    check ((ahv_last4 is null or ahv_last4 ~ '^[0-9]{4}$') and coalesce(length(consent_note), 0) <= 500
       and (ahv_cipher is null or consent_recorded_at is not null));
exception when duplicate_object then null; end $$;
drop trigger if exists trg_athlete_identifiers_updated on public.athlete_identifiers;
create trigger trg_athlete_identifiers_updated before update on public.athlete_identifiers
  for each row execute function public.set_updated_at();
drop trigger if exists trg_athlete_identifiers_same_org on public.athlete_identifiers;
create trigger trg_athlete_identifiers_same_org before insert or update on public.athlete_identifiers
  for each row execute function public.ca_same_org_guard('athlete_id:athletes');

-- 756.XXXX.XXXX.XC — 13 digits, prefix 756, EAN-13 check digit.
-- Mirrors isValidAhv() in src/lib/club-admin/js.ts.
create or replace function public.ahv_is_valid(p text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare d text := regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'); s int := 0; i int;
begin
  if length(d) <> 13 or left(d, 3) <> '756' then return false; end if;
  for i in 1 .. 12 loop
    s := s + substr(d, i, 1)::int * case when i % 2 = 0 then 3 else 1 end;
  end loop;
  return (10 - s % 10) % 10 = substr(d, 13, 1)::int;
end;
$$;

create or replace function public.ca_pii_key(p_org uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v text;
begin
  select secret into v from public.ca_pii_keys where org_id = p_org;
  if v is null then
    insert into public.ca_pii_keys (org_id, secret) values (p_org, encode(gen_random_bytes(32), 'hex'))
    on conflict (org_id) do nothing;
    select secret into v from public.ca_pii_keys where org_id = p_org;
  end if;
  return v;
end;
$$;

-- Admin: store / replace / clear (p_ahv null) an athlete's AHV number. Consent is mandatory.
create or replace function public.set_athlete_ahv(p_athlete uuid, p_ahv text, p_consent_note text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_org uuid; v_digits text;
begin
  select org_id into v_org from public.athletes where id = p_athlete;
  if v_org is null or v_org is distinct from public.current_org_id() or not public.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_ahv is null then
    update public.athlete_identifiers set ahv_cipher = null, ahv_last4 = null where athlete_id = p_athlete;
    perform public.ca_audit(v_org, 'athlete.ahv.clear', 'athletes', p_athlete, null);
    return;
  end if;
  if not public.ahv_is_valid(p_ahv) then raise exception 'AHV_INVALID' using errcode = 'P0001'; end if;
  if nullif(btrim(coalesce(p_consent_note, '')), '') is null then raise exception 'CONSENT_REQUIRED' using errcode = 'P0001'; end if;
  v_digits := regexp_replace(p_ahv, '[^0-9]', '', 'g');
  insert into public.athlete_identifiers (org_id, athlete_id, ahv_cipher, ahv_last4, consent_recorded_at, consent_recorded_by, consent_note)
  values (v_org, p_athlete, pgp_sym_encrypt(v_digits, public.ca_pii_key(v_org)), right(v_digits, 4), now(), auth.uid(), left(btrim(p_consent_note), 500))
  on conflict (athlete_id) do update set
    ahv_cipher = excluded.ahv_cipher, ahv_last4 = excluded.ahv_last4,
    consent_recorded_at = excluded.consent_recorded_at, consent_recorded_by = excluded.consent_recorded_by,
    consent_note = excluded.consent_note;
  perform public.ca_audit(v_org, 'athlete.ahv.set', 'athletes', p_athlete, null);
end;
$$;

-- Admin: decrypted AHV numbers for the J+S export (each read is audited).
create or replace function public.js_ahv_numbers(p_athletes uuid[])
returns table (athlete_id uuid, ahv text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_org uuid := public.current_org_id(); v_key text;
begin
  if v_org is null or not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  v_key := public.ca_pii_key(v_org);
  return query
    select i.athlete_id,
           regexp_replace(pgp_sym_decrypt(i.ahv_cipher, v_key), '^(\d{3})(\d{4})(\d{4})(\d{2})$', '\1.\2.\3.\4')
      from public.athlete_identifiers i
     where i.org_id = v_org and i.athlete_id = any (coalesce(p_athletes, '{}')) and i.ahv_cipher is not null
       and i.consent_recorded_at is not null;
  perform public.ca_audit(v_org, 'athlete.ahv.export', 'athlete_identifiers', null,
                          jsonb_build_object('count', coalesce(array_length(p_athletes, 1), 0)));
end;
$$;

-- ===========================================================================
-- 5) STAFF COMPLIANCE
-- ===========================================================================
create table if not exists public.staff_certificates (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  coach_id          uuid not null references public.coaches(id) on delete cascade,
  kind              text not null,   -- coaching_licence | first_aid | criminal_record | criminal_record_youth | child_protection | other
  title             text,            -- e.g. "J+S Leiter Basketball", "Swiss Basketball level 2"
  reference         text,
  issued_on         date,
  valid_until       date,            -- null = no expiry
  file_path         text,            -- private bucket club-admin-files
  file_name         text,
  status            text not null default 'pending',  -- pending | verified | rejected
  verified_by       uuid references public.profiles(id) on delete set null,
  verified_at       timestamptz,
  rejection_reason  text,
  notes             text,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_staff_certificates_org on public.staff_certificates(org_id, kind, valid_until);
create index if not exists idx_staff_certificates_coach on public.staff_certificates(coach_id);
do $$ begin
  alter table public.staff_certificates add constraint staff_certificates_chk check (
    kind in ('coaching_licence', 'first_aid', 'criminal_record', 'criminal_record_youth', 'child_protection', 'other')
    and status in ('pending', 'verified', 'rejected')
    and coalesce(length(title), 0) <= 160 and coalesce(length(reference), 0) <= 80
    and coalesce(length(file_name), 0) <= 200 and coalesce(length(rejection_reason), 0) <= 500
    and coalesce(length(notes), 0) <= 1000
    and (file_path is null or (file_path ~ '^[0-9a-f-]{36}/certificates/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|png|jpg|webp)$'))
    and (valid_until is null or issued_on is null or valid_until >= issued_on)
    and (status <> 'verified' or verified_at is not null));
exception when duplicate_object then null; end $$;
drop trigger if exists trg_staff_certificates_updated on public.staff_certificates;
create trigger trg_staff_certificates_updated before update on public.staff_certificates
  for each row execute function public.set_updated_at();
drop trigger if exists trg_staff_certificates_same_org on public.staff_certificates;
create trigger trg_staff_certificates_same_org before insert or update on public.staff_certificates
  for each row execute function public.ca_same_org_guard('coach_id:coaches');

-- A coach may add their own certificate (pending) but never verify it, and
-- may not change it once verified. Admins verify / reject.
create or replace function public.staff_certificates_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_service_caller() or (public.is_admin() and public.current_org_id() = new.org_id) then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'pending' or new.verified_by is not null or new.verified_at is not null then
      raise exception 'NOT_AUTHORIZED' using errcode = '42501';
    end if;
  else
    if old.status <> 'pending' or new.status <> 'pending' or new.verified_by is not null or new.coach_id <> old.coach_id then
      raise exception 'NOT_AUTHORIZED' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_staff_certificates_guard on public.staff_certificates;
create trigger trg_staff_certificates_guard before insert or update on public.staff_certificates
  for each row execute function public.staff_certificates_guard();

-- Expiry reminders sent (one per certificate and threshold).
create table if not exists public.staff_certificate_reminders (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  certificate_id  uuid not null references public.staff_certificates(id) on delete cascade,
  threshold_days  integer not null,
  valid_until     date not null,
  sent_at         timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (certificate_id, threshold_days, valid_until)
);
create index if not exists idx_staff_cert_reminders_org on public.staff_certificate_reminders(org_id);
drop trigger if exists trg_staff_cert_reminders_updated on public.staff_certificate_reminders;
create trigger trg_staff_cert_reminders_updated before update on public.staff_certificate_reminders
  for each row execute function public.set_updated_at();

-- Admin overrides: assign a coach to a youth team although mandatory checks
-- are missing / expired (reason recorded).
create table if not exists public.coach_assignment_overrides (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  team_id     uuid not null references public.teams(id) on delete cascade,
  coach_id    uuid not null references public.coaches(id) on delete cascade,
  reason      text not null,
  missing     text[] not null default '{}',
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_coach_overrides_org on public.coach_assignment_overrides(org_id);
create index if not exists idx_coach_overrides_pair on public.coach_assignment_overrides(team_id, coach_id);
do $$ begin
  alter table public.coach_assignment_overrides add constraint coach_assignment_overrides_chk
    check (length(btrim(reason)) between 3 and 500);
exception when duplicate_object then null; end $$;
drop trigger if exists trg_coach_overrides_updated on public.coach_assignment_overrides;
create trigger trg_coach_overrides_updated before update on public.coach_assignment_overrides
  for each row execute function public.set_updated_at();
drop trigger if exists trg_coach_overrides_same_org on public.coach_assignment_overrides;
create trigger trg_coach_overrides_same_org before insert or update on public.coach_assignment_overrides
  for each row execute function public.ca_same_org_guard('team_id:teams', 'coach_id:coaches');

-- Mandatory check kinds (club settings) a coach lacks on a day: no VERIFIED
-- certificate of that kind valid on the day. Service or same club.
create or replace function public.coach_compliance_missing(p_coach uuid, p_on date default null)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid; v_set public.club_admin_settings; v_day date; v_out text[] := '{}'; k text;
begin
  select org_id into v_org from public.coaches where id = p_coach;
  if v_org is null then return '{}'; end if;
  if not public.is_service_caller() and v_org is distinct from public.current_org_id() then return '{}'; end if;
  v_set := public.ca_settings(v_org);
  v_day := coalesce(p_on, public.ca_org_today(v_org));
  foreach k in array v_set.compliance_mandatory_kinds loop
    if not exists (select 1 from public.staff_certificates c
                    where c.coach_id = p_coach and c.kind = k and c.status = 'verified'
                      and (c.valid_until is null or c.valid_until >= v_day)) then
      v_out := v_out || k;
    end if;
  end loop;
  return v_out;
end;
$$;

-- Youth teams: when the club turned the block on, a coach with missing /
-- expired mandatory checks can only be assigned with an admin override.
create or replace function public.team_coaches_compliance_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_missing text[];
begin
  if not (public.ca_settings(new.org_id)).compliance_block_youth then return new; end if;
  if not coalesce((select is_youth from public.teams where id = new.team_id), true) then return new; end if;
  if exists (select 1 from public.coach_assignment_overrides o where o.team_id = new.team_id and o.coach_id = new.coach_id) then
    return new;
  end if;
  v_missing := public.coach_compliance_missing(new.coach_id, null);
  if coalesce(array_length(v_missing, 1), 0) > 0 then
    raise exception 'COACH_COMPLIANCE_MISSING' using errcode = 'P0001', detail = array_to_string(v_missing, ',');
  end if;
  return new;
end;
$$;
drop trigger if exists trg_team_coaches_compliance on public.team_coaches;
create trigger trg_team_coaches_compliance before insert on public.team_coaches
  for each row execute function public.team_coaches_compliance_guard();

-- Admin: assign anyway (override with reason) — one transaction.
create or replace function public.assign_coach_with_override(p_team uuid, p_coach uuid, p_role text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id(); v_id uuid;
begin
  if v_org is null or not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if not exists (select 1 from public.teams where id = p_team and org_id = v_org)
     or not exists (select 1 from public.coaches where id = p_coach and org_id = v_org) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  insert into public.coach_assignment_overrides (org_id, team_id, coach_id, reason, missing, created_by)
  values (v_org, p_team, p_coach, left(btrim(p_reason), 500), public.coach_compliance_missing(p_coach, null), auth.uid())
  returning id into v_id;
  insert into public.team_coaches (team_id, coach_id, org_id, role)
  values (p_team, p_coach, v_org, coalesce(nullif(p_role, ''), 'assistant'))
  on conflict (team_id, coach_id) do nothing;
  perform public.ca_audit(v_org, 'compliance.override', 'coach_assignment_overrides', v_id,
                          jsonb_build_object('team_id', p_team, 'coach_id', p_coach));
  return v_id;
end;
$$;

-- ===========================================================================
-- 6) INJURY & INCIDENT LOG
-- ===========================================================================
create table if not exists public.incident_reports (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations(id) on delete cascade,
  athlete_id             uuid not null references public.athletes(id) on delete cascade,
  occurred_at            timestamptz not null,
  program_id             uuid references public.programs(id) on delete set null,
  team_id                uuid references public.teams(id) on delete set null,
  attendance_session_id  uuid references public.attendance_sessions(id) on delete set null,
  location               text,
  description            text not null,
  body_part              text not null default 'other',
  severity               text not null default 'minor',     -- minor | moderate | serious | critical
  first_aid_given        boolean not null default false,
  first_aid_details      text,
  first_aid_by           text,
  parents_informed_at    timestamptz,
  parents_informed_how   text,                              -- phone | in_person | email | message | other
  referral               text not null default 'none',      -- none | doctor | hospital | ambulance
  follow_up_notes        text,
  return_status          text not null default 'not_applicable', -- not_applicable | out | modified | cleared
  cleared_on             date,
  clearance_file_path    text,
  clearance_file_name    text,
  status                 text not null default 'open',      -- open | closed
  reported_by            uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists idx_incident_reports_org on public.incident_reports(org_id, occurred_at desc);
create index if not exists idx_incident_reports_athlete on public.incident_reports(athlete_id);
do $$ begin
  alter table public.incident_reports add constraint incident_reports_chk check (
    length(btrim(description)) between 3 and 4000
    and coalesce(length(location), 0) <= 200 and coalesce(length(first_aid_details), 0) <= 2000
    and coalesce(length(first_aid_by), 0) <= 120 and coalesce(length(follow_up_notes), 0) <= 4000
    and coalesce(length(clearance_file_name), 0) <= 200
    and body_part in ('head', 'face', 'neck', 'shoulder', 'arm', 'elbow', 'wrist_hand', 'chest', 'back', 'hip',
                      'thigh', 'knee', 'lower_leg', 'ankle', 'foot', 'multiple', 'other')
    and severity in ('minor', 'moderate', 'serious', 'critical')
    and (parents_informed_how is null or parents_informed_how in ('phone', 'in_person', 'email', 'message', 'other'))
    and referral in ('none', 'doctor', 'hospital', 'ambulance')
    and return_status in ('not_applicable', 'out', 'modified', 'cleared')
    and status in ('open', 'closed')
    and (clearance_file_path is null or clearance_file_path ~ '^[0-9a-f-]{36}/incidents/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|png|jpg|webp)$'));
exception when duplicate_object then null; end $$;
drop trigger if exists trg_incident_reports_updated on public.incident_reports;
create trigger trg_incident_reports_updated before update on public.incident_reports
  for each row execute function public.set_updated_at();
drop trigger if exists trg_incident_reports_same_org on public.incident_reports;
create trigger trg_incident_reports_same_org before insert or update on public.incident_reports
  for each row execute function public.ca_same_org_guard('athlete_id:athletes', 'program_id:programs', 'team_id:teams', 'attendance_session_id:attendance_sessions');

-- Who may read an incident: admin of the club, the athlete's guardians, and
-- coaches who coach that athlete. Finance never (unless also a guardian).
create or replace function public.can_read_incident(p_athlete uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_org = public.current_org_id()
     and (public.is_admin()
          or public.is_guardian_of_athlete(p_athlete)
          or (public.has_role('coach') and public.coach_can_access_athlete(p_athlete)));
$$;

-- Staff who may write: admin, or a coach of the athlete.
create or replace function public.can_write_incident(p_athlete uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_org = public.current_org_id()
     and (public.is_admin() or (public.has_role('coach') and public.coach_can_access_athlete(p_athlete)));
$$;

-- ===========================================================================
-- 7) RLS
-- ===========================================================================
alter table public.club_admin_settings         enable row level security;
alter table public.membership_types            enable row level security;
alter table public.memberships                 enable row level security;
alter table public.waitlist_entries            enable row level security;
alter table public.athlete_identifiers         enable row level security;
alter table public.staff_certificates          enable row level security;
alter table public.staff_certificate_reminders enable row level security;
alter table public.coach_assignment_overrides  enable row level security;
alter table public.incident_reports            enable row level security;

-- Settings: admin + finance read; admin writes.
drop policy if exists club_admin_settings_select on public.club_admin_settings;
create policy club_admin_settings_select on public.club_admin_settings for select
  using (org_id = public.current_org_id() and public.is_finance());
drop policy if exists club_admin_settings_insert on public.club_admin_settings;
create policy club_admin_settings_insert on public.club_admin_settings for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists club_admin_settings_update on public.club_admin_settings;
create policy club_admin_settings_update on public.club_admin_settings for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists club_admin_settings_delete on public.club_admin_settings;
create policy club_admin_settings_delete on public.club_admin_settings for delete
  using (org_id = public.current_org_id() and public.is_admin());

-- Membership types: every member of the club reads (parents choose one); admin writes.
drop policy if exists membership_types_select on public.membership_types;
create policy membership_types_select on public.membership_types for select
  using (org_id = public.current_org_id());
drop policy if exists membership_types_insert on public.membership_types;
create policy membership_types_insert on public.membership_types for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists membership_types_update on public.membership_types;
create policy membership_types_update on public.membership_types for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists membership_types_delete on public.membership_types;
create policy membership_types_delete on public.membership_types for delete
  using (org_id = public.current_org_id() and public.is_admin());

-- Memberships: admin + finance (billing) and the family's guardians read;
-- created by membership_create() (service); admin edits / cancels.
drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships for select
  using (org_id = public.current_org_id() and (public.is_finance() or public.is_guardian_of_family(family_id)));
drop policy if exists memberships_insert on public.memberships;
create policy memberships_insert on public.memberships for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists memberships_update on public.memberships;
create policy memberships_update on public.memberships for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists memberships_delete on public.memberships;
create policy memberships_delete on public.memberships for delete
  using (org_id = public.current_org_id() and public.is_admin());

-- Waitlist: admin reads / manages; guardians read their own entries and may
-- join (status waiting, no offer fields). Offers are made by the service.
drop policy if exists waitlist_entries_select on public.waitlist_entries;
create policy waitlist_entries_select on public.waitlist_entries for select
  using (org_id = public.current_org_id() and (public.is_admin() or public.is_guardian_of_family(family_id)));
drop policy if exists waitlist_entries_insert on public.waitlist_entries;
create policy waitlist_entries_insert on public.waitlist_entries for insert
  with check (org_id = public.current_org_id()
              and (public.is_admin()
                   or (public.is_guardian_of_family(family_id) and status = 'waiting'
                       and offer_token_hash is null and offered_at is null and registration_id is null
                       and invoice_id is null and booking_id is null)));
drop policy if exists waitlist_entries_update on public.waitlist_entries;
create policy waitlist_entries_update on public.waitlist_entries for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists waitlist_entries_delete on public.waitlist_entries;
create policy waitlist_entries_delete on public.waitlist_entries for delete
  using (org_id = public.current_org_id() and public.is_admin());

-- AHV: admin only (and only the last 4 digits are in clear).
drop policy if exists athlete_identifiers_select on public.athlete_identifiers;
create policy athlete_identifiers_select on public.athlete_identifiers for select
  using (org_id = public.current_org_id() and public.is_admin());
drop policy if exists athlete_identifiers_insert on public.athlete_identifiers;
create policy athlete_identifiers_insert on public.athlete_identifiers for insert with check (false);
drop policy if exists athlete_identifiers_update on public.athlete_identifiers;
create policy athlete_identifiers_update on public.athlete_identifiers for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin() and ahv_cipher is null);
drop policy if exists athlete_identifiers_delete on public.athlete_identifiers;
create policy athlete_identifiers_delete on public.athlete_identifiers for delete
  using (org_id = public.current_org_id() and public.is_admin());

-- Certificates: admin all; the coach reads and adds their own (pending).
drop policy if exists staff_certificates_select on public.staff_certificates;
create policy staff_certificates_select on public.staff_certificates for select
  using (org_id = public.current_org_id() and (public.is_admin() or coach_id = public.current_coach_id()));
drop policy if exists staff_certificates_insert on public.staff_certificates;
create policy staff_certificates_insert on public.staff_certificates for insert
  with check (org_id = public.current_org_id() and (public.is_admin() or coach_id = public.current_coach_id()));
drop policy if exists staff_certificates_update on public.staff_certificates;
create policy staff_certificates_update on public.staff_certificates for update
  using (org_id = public.current_org_id() and (public.is_admin() or coach_id = public.current_coach_id()))
  with check (org_id = public.current_org_id() and (public.is_admin() or coach_id = public.current_coach_id()));
drop policy if exists staff_certificates_delete on public.staff_certificates;
create policy staff_certificates_delete on public.staff_certificates for delete
  using (org_id = public.current_org_id() and public.is_admin());

drop policy if exists staff_cert_reminders_select on public.staff_certificate_reminders;
create policy staff_cert_reminders_select on public.staff_certificate_reminders for select
  using (org_id = public.current_org_id() and public.is_admin());
drop policy if exists staff_cert_reminders_insert on public.staff_certificate_reminders;
create policy staff_cert_reminders_insert on public.staff_certificate_reminders for insert with check (false);
drop policy if exists staff_cert_reminders_update on public.staff_certificate_reminders;
create policy staff_cert_reminders_update on public.staff_certificate_reminders for update using (false) with check (false);
drop policy if exists staff_cert_reminders_delete on public.staff_certificate_reminders;
create policy staff_cert_reminders_delete on public.staff_certificate_reminders for delete
  using (org_id = public.current_org_id() and public.is_admin());

drop policy if exists coach_overrides_select on public.coach_assignment_overrides;
create policy coach_overrides_select on public.coach_assignment_overrides for select
  using (org_id = public.current_org_id() and public.is_admin());
drop policy if exists coach_overrides_insert on public.coach_assignment_overrides;
create policy coach_overrides_insert on public.coach_assignment_overrides for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists coach_overrides_update on public.coach_assignment_overrides;
create policy coach_overrides_update on public.coach_assignment_overrides for update using (false) with check (false);
drop policy if exists coach_overrides_delete on public.coach_assignment_overrides;
create policy coach_overrides_delete on public.coach_assignment_overrides for delete
  using (org_id = public.current_org_id() and public.is_admin());

-- Incidents: read by admin / guardians / the athlete's coaches; written by
-- admin or the athlete's coaches (a coach edits while the report is open);
-- deleted by admin only.
drop policy if exists incident_reports_select on public.incident_reports;
create policy incident_reports_select on public.incident_reports for select
  using (public.can_read_incident(athlete_id, org_id));
drop policy if exists incident_reports_insert on public.incident_reports;
create policy incident_reports_insert on public.incident_reports for insert
  with check (public.can_write_incident(athlete_id, org_id) and reported_by = auth.uid());
drop policy if exists incident_reports_update on public.incident_reports;
create policy incident_reports_update on public.incident_reports for update
  using (public.can_write_incident(athlete_id, org_id) and (public.is_admin() or status = 'open'))
  with check (public.can_write_incident(athlete_id, org_id));
drop policy if exists incident_reports_delete on public.incident_reports;
create policy incident_reports_delete on public.incident_reports for delete
  using (org_id = public.current_org_id() and public.is_admin());

-- Platform tenant isolation + suspension guards, grants.
do $$
declare t text;
begin
  foreach t in array array['club_admin_settings', 'membership_types', 'memberships', 'waitlist_entries',
                           'athlete_identifiers', 'staff_certificates', 'staff_certificate_reminders',
                           'coach_assignment_overrides', 'incident_reports', 'ca_pii_keys'] loop
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
      if t = 'ca_pii_keys' then
        execute format('revoke all on public.%I from authenticated', t);
      else
        execute format('grant select, insert, update, delete on public.%I to authenticated', t);
      end if;
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant all on public.%I to service_role', t);
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 8) AUDIT TRIGGERS (sensitive columns redacted)
-- ===========================================================================
do $$
declare t text;
begin
  foreach t in array array['club_admin_settings', 'membership_types', 'memberships', 'waitlist_entries',
                           'staff_certificates', 'coach_assignment_overrides'] loop
    execute format('drop trigger if exists %I on public.%I', 'trg_audit_' || t, t);
    execute format('create trigger %I after insert or update or delete on public.%I
                      for each row execute function public.ca_audit_trigger(%L)', 'trg_audit_' || t, t,
                   case when t = 'waitlist_entries' then 'offer_token_hash' else 'notes' end);
  end loop;
end $$;
drop trigger if exists trg_audit_athlete_identifiers on public.athlete_identifiers;
create trigger trg_audit_athlete_identifiers after insert or update or delete on public.athlete_identifiers
  for each row execute function public.ca_audit_trigger('ahv_cipher', 'ahv_last4', 'consent_note');
drop trigger if exists trg_audit_incident_reports on public.incident_reports;
create trigger trg_audit_incident_reports after insert or update or delete on public.incident_reports
  for each row execute function public.ca_audit_trigger('description', 'location', 'body_part', 'first_aid_details',
                                                        'first_aid_by', 'follow_up_notes', 'clearance_file_name');

-- ===========================================================================
-- 9) PRIVATE STORAGE BUCKET (certificates, clearance documents)
--    Keys: <org_id>/certificates/<coach_id>/<uuid>.<ext>
--          <org_id>/incidents/<incident_id>/<uuid>.<ext>
--    No Storage policies for signed-in users: the server checks access
--    through RLS on the row, then signs a short-lived URL with the service
--    client and audit-logs the read.
-- ===========================================================================
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('club-admin-files', 'club-admin-files', false)
    on conflict (id) do update set public = false;
    if exists (select 1 from information_schema.columns
                where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
      execute $q$update storage.buckets set file_size_limit = 5242880 where id = 'club-admin-files'$q$;
    end if;
    if exists (select 1 from information_schema.columns
                where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
      execute $q$update storage.buckets set allowed_mime_types = array['application/pdf','image/png','image/jpeg','image/webp']
                 where id = 'club-admin-files'$q$;
    end if;
  end if;
end $$;

-- ===========================================================================
-- 10) FUNCTION GRANTS
-- ===========================================================================
-- Service only (server actions / cron after their own checks).
revoke all on function public.membership_create(jsonb) from public, anon, authenticated;
revoke all on function public.membership_expire_due(uuid) from public, anon, authenticated;
revoke all on function public.apply_member_price(text, uuid, text) from public, anon, authenticated;
revoke all on function public.waitlist_process(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.waitlist_make_offer(uuid, int) from public, anon, authenticated;
revoke all on function public.waitlist_offer_lookup(text) from public, anon, authenticated;
revoke all on function public.waitlist_respond(text, boolean) from public, anon, authenticated;
revoke all on function public.waitlist_spots(public.waitlist_entries) from public, anon, authenticated;
revoke all on function public.ca_pii_key(uuid) from public, anon, authenticated;
revoke all on function public.ca_audit(uuid, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.ca_settings(uuid) from public, anon, authenticated;
revoke all on function public.ca_org_today(uuid) from public, anon, authenticated;
-- Trigger functions: never callable through the API.
revoke all on function public.ca_audit_trigger() from public, anon, authenticated;
revoke all on function public.ca_same_org_guard() from public, anon, authenticated;
revoke all on function public.memberships_athlete_family_guard() from public, anon, authenticated;
revoke all on function public.memberships_on_invoice_paid() from public, anon, authenticated;
revoke all on function public.waitlist_entries_prepare() from public, anon, authenticated;
revoke all on function public.staff_certificates_guard() from public, anon, authenticated;
revoke all on function public.team_coaches_compliance_guard() from public, anon, authenticated;
-- Signed-in callers (each checks role + org itself).
revoke all on function public.is_member(uuid, date) from public, anon;
revoke all on function public.waitlist_move(uuid, int) from public, anon;
revoke all on function public.set_athlete_ahv(uuid, text, text) from public, anon;
revoke all on function public.js_ahv_numbers(uuid[]) from public, anon;
revoke all on function public.coach_compliance_missing(uuid, date) from public, anon;
revoke all on function public.assign_coach_with_override(uuid, uuid, text, text) from public, anon;
revoke all on function public.can_read_incident(uuid, uuid) from public, anon;
revoke all on function public.can_write_incident(uuid, uuid) from public, anon;
do $$
declare f text;
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    foreach f in array array['public.is_member(uuid, date)', 'public.waitlist_move(uuid, int)',
                             'public.set_athlete_ahv(uuid, text, text)', 'public.js_ahv_numbers(uuid[])',
                             'public.coach_compliance_missing(uuid, date)',
                             'public.assign_coach_with_override(uuid, uuid, text, text)',
                             'public.can_read_incident(uuid, uuid)', 'public.can_write_incident(uuid, uuid)',
                             'public.ahv_is_valid(text)', 'public.membership_period(text, int, date)'] loop
      execute format('grant execute on function %s to authenticated', f);
    end loop;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    foreach f in array array['public.membership_create(jsonb)', 'public.membership_expire_due(uuid)',
                             'public.apply_member_price(text, uuid, text)', 'public.waitlist_process(uuid, text, uuid)',
                             'public.waitlist_offer_lookup(text)', 'public.waitlist_respond(text, boolean)',
                             'public.is_member(uuid, date)', 'public.coach_compliance_missing(uuid, date)',
                             'public.ca_settings(uuid)'] loop
      execute format('grant execute on function %s to service_role', f);
    end loop;
  end if;
end $$;
