-- ============================================================================
-- Personal / pro training system (editable services, session packages,
-- weekly coach availability, blackouts, venue opening hours, group capacity,
-- package purchases, athlete training profiles).
--
-- Extends the existing booking module (training_services, credit_packages,
-- coach_availability, training_bookings, training_credits) instead of
-- replacing it. Additive and idempotent.
--
--   * training_services: session type (individual / group + max participants),
--     default venue or free address, currency, colour, sort order. Which
--     coaches offer a service stays in coaches.serves (service slugs).
--   * credit_packages: become per-service session packages (service_id,
--     validity_days, sort_order). Legacy category packages keep working.
--   * training_package_purchases (new): one row per package (or single
--     session) sold to an athlete. It is also the per-service credit lot:
--     remaining = sessions - sessions_used, usable while status = 'active'
--     and not expired. A purchase paid by invoice is 'pending' until the
--     invoice is paid (any path: Stripe webhook, QR/bank reconciliation,
--     manual payment), then a trigger activates it and starts the validity.
--     DISCOUNT HOOK: discount_total / discount_ids are filled by
--     public.training_purchase_discount(), which returns no discount here.
--     The shared discounts model replaces that function body later.
--   * coach_availability_templates (new): weekly recurring windows per coach
--     (+ venue, optional service, capacity, validity range).
--   * coach_availability: one-off windows gain venue, service and capacity.
--   * training_blackouts (new): club-wide, per coach or per venue.
--   * venues.opening_hours: default bounds for bookable times.
--   * athlete_training_profiles (new): goals / notes, coach-visible.
--   * book_training(): books a time computed from real availability, with
--     group capacity, paying with package credits, legacy category credits,
--     a new package (first session reserved, the rest granted on payment)
--     or a single-session invoice. reschedule_training(), and
--     cancel_training_booking() now returns package credits too.
--
-- Group sessions: several athletes share one coach + start + service, so the
-- old unique index (coach_id, slot_start) is replaced by a per-athlete one;
-- capacity is enforced inside book_training() under a coach row lock.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Helpers
-- ---------------------------------------------------------------------------
create or replace function public.training_org_tz(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select nullif(btrim(o.timezone), '') from public.organizations o
      where o.id = p_org and exists (select 1 from pg_timezone_names z where z.name = o.timezone)),
    'UTC');
$$;

create or replace function public.training_org_currency(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select upper(coalesce(
    (select nullif(btrim(s.currency), '') from public.app_settings s where s.org_id = p_org),
    (select nullif(btrim(o.currency), '') from public.organizations o where o.id = p_org),
    'CHF'));
$$;

-- Every foreign key named in the trigger arguments must point at a row of
-- the same org (no cross-tenant references, whoever writes the row).
create or replace function public.training_same_org_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_org uuid  := (v_row->>'org_id')::uuid;
  v_col text;
  v_id  uuid;
  v_tab text;
  v_ok  boolean;
begin
  foreach v_col in array tg_argv loop
    v_id := nullif(v_row->>v_col, '')::uuid;
    continue when v_id is null;
    v_tab := case v_col
      when 'coach_id'    then 'coaches'
      when 'venue_id'    then 'venues'
      when 'service_id'  then 'training_services'
      when 'athlete_id'  then 'athletes'
      when 'family_id'   then 'families'
      when 'package_id'  then 'credit_packages'
      when 'invoice_id'  then 'invoices'
      when 'purchase_id' then 'training_package_purchases'
    end;
    if v_tab is null then raise exception 'training_same_org_guard: unknown column %', v_col; end if;
    execute format('select exists (select 1 from public.%I where id = $1 and org_id = $2)', v_tab)
      into v_ok using v_id, v_org;
    if not v_ok then
      raise exception 'CROSS_ORG_REFERENCE: %', v_col using errcode = 'P0001';
    end if;
  end loop;
  return new;
end;
$$;

-- Opening hours: {"1": [["10:00","18:00"]], ..., "7": [["10:00","22:00"]]}
-- (ISO weekday keys, 1 = Monday). NULL = no bounds; a missing day = closed.
create or replace function public.training_within_hours(p_hours jsonb, p_dow integer, p_from interval, p_to interval)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare r jsonb;
begin
  if p_hours is null or jsonb_typeof(p_hours) <> 'object' or p_hours = '{}'::jsonb then return true; end if;
  if not (p_hours ? p_dow::text) or jsonb_typeof(p_hours->p_dow::text) <> 'array' then return false; end if;
  for r in select * from jsonb_array_elements(p_hours->p_dow::text) loop
    if jsonb_typeof(r) = 'array' and jsonb_array_length(r) = 2
       and p_from >= ((r->>0)::time - time '00:00')
       and p_to <= (case when r->>1 in ('24:00', '24:00:00') then interval '24 hours' else (r->>1)::time - time '00:00' end) then
      return true;
    end if;
  end loop;
  return false;
exception when others then
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) Services: type, capacity, location, currency, colour, order
-- ---------------------------------------------------------------------------
alter table public.training_services
  add column if not exists session_type     text not null default 'individual',
  add column if not exists max_participants integer not null default 1,
  add column if not exists min_participants integer not null default 1,
  add column if not exists venue_id         uuid references public.venues(id) on delete set null,
  add column if not exists location_text    text,
  add column if not exists currency         text,
  add column if not exists color            text,
  add column if not exists sort_order       integer not null default 0;

do $$
begin
  alter table public.training_services drop constraint if exists training_services_session_type_chk;
  alter table public.training_services add constraint training_services_session_type_chk
    check (session_type in ('individual', 'group'));
  alter table public.training_services drop constraint if exists training_services_participants_chk;
  alter table public.training_services add constraint training_services_participants_chk
    check (max_participants between 1 and 100 and (session_type = 'group' or max_participants = 1));
  alter table public.training_services drop constraint if exists training_services_min_participants_chk;
  alter table public.training_services add constraint training_services_min_participants_chk
    check (min_participants between 1 and max_participants);
  alter table public.training_services drop constraint if exists training_services_currency_chk;
  alter table public.training_services add constraint training_services_currency_chk
    check (currency is null or currency ~ '^[A-Z]{3}$');
  alter table public.training_services drop constraint if exists training_services_color_chk;
  alter table public.training_services add constraint training_services_color_chk
    check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');
  alter table public.training_services drop constraint if exists training_services_location_len_chk;
  alter table public.training_services add constraint training_services_location_len_chk
    check (location_text is null or length(location_text) <= 300);
end $$;

drop trigger if exists trg_training_services_same_org on public.training_services;
create trigger trg_training_services_same_org
  before insert or update of venue_id on public.training_services
  for each row execute function public.training_same_org_guard('venue_id');

-- ---------------------------------------------------------------------------
-- 2) Venue opening hours (default bounds for bookable times)
-- ---------------------------------------------------------------------------
alter table public.venues add column if not exists opening_hours jsonb;
do $$
begin
  alter table public.venues drop constraint if exists venues_opening_hours_chk;
  alter table public.venues add constraint venues_opening_hours_chk
    check (opening_hours is null or jsonb_typeof(opening_hours) = 'object');
end $$;

-- ---------------------------------------------------------------------------
-- 3) Session packages per service (extends credit_packages)
-- ---------------------------------------------------------------------------
alter table public.credit_packages
  add column if not exists service_id    uuid references public.training_services(id) on delete cascade,
  add column if not exists validity_days integer,
  add column if not exists sort_order    integer not null default 0,
  add column if not exists description   text,
  add column if not exists updated_at    timestamptz not null default now();

do $$
begin
  alter table public.credit_packages drop constraint if exists credit_packages_validity_chk;
  alter table public.credit_packages add constraint credit_packages_validity_chk
    check (validity_days is null or validity_days between 1 and 3650);
  alter table public.credit_packages drop constraint if exists credit_packages_credits_max_chk;
  alter table public.credit_packages add constraint credit_packages_credits_max_chk
    check (credits <= 1000);
  alter table public.credit_packages drop constraint if exists credit_packages_price_chk;
  alter table public.credit_packages add constraint credit_packages_price_chk
    check (price_chf >= 0);
end $$;

create index if not exists idx_credit_packages_org     on public.credit_packages(org_id);
create index if not exists idx_credit_packages_service on public.credit_packages(service_id, sort_order);

drop trigger if exists trg_credit_packages_updated on public.credit_packages;
create trigger trg_credit_packages_updated before update on public.credit_packages
  for each row execute function public.set_updated_at();
drop trigger if exists trg_credit_packages_same_org on public.credit_packages;
create trigger trg_credit_packages_same_org
  before insert or update of service_id on public.credit_packages
  for each row execute function public.training_same_org_guard('service_id');
drop trigger if exists trg_audit_credit_packages on public.credit_packages;
create trigger trg_audit_credit_packages after insert or update or delete on public.credit_packages
  for each row execute function public.audit_trigger();

-- credit_packages already has select (org) + admin write policies; make the
-- verbs explicit so every verb has its own policy.
drop policy if exists credit_packages_admin_write on public.credit_packages;
drop policy if exists credit_packages_insert on public.credit_packages;
create policy credit_packages_insert on public.credit_packages for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists credit_packages_update on public.credit_packages;
create policy credit_packages_update on public.credit_packages for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists credit_packages_delete on public.credit_packages;
create policy credit_packages_delete on public.credit_packages for delete
  using (org_id = public.current_org_id() and public.is_admin());
grant select, insert, update, delete on public.credit_packages to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Package purchases (= per-service credit lots)
-- ---------------------------------------------------------------------------
create table if not exists public.training_package_purchases (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  athlete_id     uuid not null references public.athletes(id) on delete cascade,
  family_id      uuid references public.families(id) on delete set null,
  service_id     uuid not null references public.training_services(id) on delete restrict,
  package_id     uuid references public.credit_packages(id) on delete set null,
  sessions       integer not null check (sessions between 1 and 1000),
  sessions_used  integer not null default 0,
  list_price     numeric(12,2) not null default 0 check (list_price >= 0),
  -- Discount hook (shared discounts model, wired later): total taken off
  -- list_price and the ids of the discounts that produced it.
  discount_total numeric(12,2) not null default 0 check (discount_total >= 0),
  discount_ids   uuid[] not null default '{}',
  amount         numeric(12,2) not null default 0 check (amount >= 0),
  currency       text not null check (currency ~ '^[A-Z]{3}$'),
  payment_mode   text not null default 'invoice' check (payment_mode in ('invoice', 'paid', 'comp')),
  status         text not null default 'pending' check (status in ('pending', 'active', 'cancelled')),
  invoice_id     uuid references public.invoices(id) on delete set null,
  validity_days  integer check (validity_days is null or validity_days between 1 and 3650),
  granted_at     timestamptz,
  expires_at     timestamptz,
  cancelled_at   timestamptz,
  cancel_reason  text,
  notes          text check (notes is null or length(notes) <= 2000),
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (sessions_used between 0 and sessions),
  check (amount <= list_price)
);
create index if not exists idx_tpp_org      on public.training_package_purchases(org_id);
create index if not exists idx_tpp_athlete  on public.training_package_purchases(athlete_id, service_id, status);
create index if not exists idx_tpp_invoice  on public.training_package_purchases(invoice_id);

drop trigger if exists trg_tpp_updated on public.training_package_purchases;
create trigger trg_tpp_updated before update on public.training_package_purchases
  for each row execute function public.set_updated_at();
drop trigger if exists trg_tpp_same_org on public.training_package_purchases;
create trigger trg_tpp_same_org before insert or update on public.training_package_purchases
  for each row execute function public.training_same_org_guard('athlete_id', 'family_id', 'service_id', 'package_id', 'invoice_id');
drop trigger if exists trg_audit_tpp on public.training_package_purchases;
create trigger trg_audit_tpp after insert or update or delete on public.training_package_purchases
  for each row execute function public.audit_trigger();

alter table public.training_package_purchases enable row level security;
drop policy if exists tpp_select on public.training_package_purchases;
create policy tpp_select on public.training_package_purchases for select
  using (org_id = public.current_org_id() and (public.is_finance() or public.is_guardian_of_athlete(athlete_id)));
drop policy if exists tpp_insert on public.training_package_purchases;
create policy tpp_insert on public.training_package_purchases for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists tpp_update on public.training_package_purchases;
create policy tpp_update on public.training_package_purchases for update
  using (org_id = public.current_org_id() and public.is_finance())
  with check (org_id = public.current_org_id() and public.is_finance());
drop policy if exists tpp_delete on public.training_package_purchases;
create policy tpp_delete on public.training_package_purchases for delete
  using (org_id = public.current_org_id() and public.is_admin());
grant select, insert, update, delete on public.training_package_purchases to authenticated;
grant all on public.training_package_purchases to service_role;

-- ---------------------------------------------------------------------------
-- 5) Bookings: package link, location
-- ---------------------------------------------------------------------------
alter table public.training_bookings
  add column if not exists purchase_id   uuid references public.training_package_purchases(id) on delete set null,
  add column if not exists venue_id      uuid references public.venues(id) on delete set null,
  add column if not exists location_text text,
  -- Group sessions: set on every booking of the slot once the service's
  -- min_participants is reached (or an admin confirms the group anyway).
  -- Null on a group booking = "waiting for N more". Individual sessions
  -- are confirmed when booked.
  add column if not exists group_confirmed_at timestamptz;
create index if not exists idx_bookings_purchase on public.training_bookings(purchase_id);

drop trigger if exists trg_bookings_same_org on public.training_bookings;
create trigger trg_bookings_same_org
  before insert or update of purchase_id, venue_id on public.training_bookings
  for each row execute function public.training_same_org_guard('purchase_id', 'venue_id');

-- Group sessions share a coach + start: one row per athlete instead.
drop index if exists public.training_bookings_coach_slot_uniq;
create unique index if not exists training_bookings_athlete_slot_uniq
  on public.training_bookings (coach_id, slot_start, athlete_id)
  where status in ('booked', 'completed');

-- ---------------------------------------------------------------------------
-- 6) Availability: weekly templates, one-off windows, blackouts
-- ---------------------------------------------------------------------------
create table if not exists public.coach_availability_templates (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  coach_id    uuid not null references public.coaches(id) on delete cascade,
  venue_id    uuid references public.venues(id) on delete set null,
  service_id  uuid references public.training_services(id) on delete cascade,
  weekday     smallint not null check (weekday between 1 and 7),   -- ISO: 1 = Monday
  start_time  time not null,
  end_time    time not null,
  capacity    integer not null default 1 check (capacity between 1 and 100),
  valid_from  date,
  valid_until date,
  is_active   boolean not null default true,
  notes       text check (notes is null or length(notes) <= 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (end_time > start_time),
  check (valid_from is null or valid_until is null or valid_until >= valid_from)
);
create index if not exists idx_cat_org   on public.coach_availability_templates(org_id);
create index if not exists idx_cat_coach on public.coach_availability_templates(coach_id, weekday);

drop trigger if exists trg_cat_updated on public.coach_availability_templates;
create trigger trg_cat_updated before update on public.coach_availability_templates
  for each row execute function public.set_updated_at();
drop trigger if exists trg_cat_same_org on public.coach_availability_templates;
create trigger trg_cat_same_org before insert or update on public.coach_availability_templates
  for each row execute function public.training_same_org_guard('coach_id', 'venue_id', 'service_id');
drop trigger if exists trg_audit_cat on public.coach_availability_templates;
create trigger trg_audit_cat after insert or update or delete on public.coach_availability_templates
  for each row execute function public.audit_trigger();

alter table public.coach_availability_templates enable row level security;
drop policy if exists cat_select on public.coach_availability_templates;
create policy cat_select on public.coach_availability_templates for select
  using (org_id = public.current_org_id());
drop policy if exists cat_insert on public.coach_availability_templates;
create policy cat_insert on public.coach_availability_templates for insert
  with check (org_id = public.current_org_id() and (public.is_admin() or coach_id = public.current_coach_id()));
drop policy if exists cat_update on public.coach_availability_templates;
create policy cat_update on public.coach_availability_templates for update
  using (org_id = public.current_org_id() and (public.is_admin() or coach_id = public.current_coach_id()))
  with check (org_id = public.current_org_id() and (public.is_admin() or coach_id = public.current_coach_id()));
drop policy if exists cat_delete on public.coach_availability_templates;
create policy cat_delete on public.coach_availability_templates for delete
  using (org_id = public.current_org_id() and (public.is_admin() or coach_id = public.current_coach_id()));
grant select, insert, update, delete on public.coach_availability_templates to authenticated;
grant all on public.coach_availability_templates to service_role;

-- One-off windows (existing table): venue, service, capacity.
alter table public.coach_availability
  add column if not exists venue_id   uuid references public.venues(id) on delete set null,
  add column if not exists service_id uuid references public.training_services(id) on delete cascade,
  add column if not exists capacity   integer not null default 1;
do $$
begin
  alter table public.coach_availability drop constraint if exists coach_availability_capacity_chk;
  alter table public.coach_availability add constraint coach_availability_capacity_chk
    check (capacity between 1 and 100);
end $$;
drop trigger if exists trg_coach_availability_same_org on public.coach_availability;
create trigger trg_coach_availability_same_org
  before insert or update on public.coach_availability
  for each row execute function public.training_same_org_guard('coach_id', 'venue_id', 'service_id');

create table if not exists public.training_blackouts (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  coach_id    uuid references public.coaches(id) on delete cascade,   -- null = every coach
  venue_id    uuid references public.venues(id) on delete cascade,    -- null = every venue
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  reason      text check (reason is null or length(reason) <= 300),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '400 days')
);
create index if not exists idx_blackouts_org   on public.training_blackouts(org_id, starts_at);
create index if not exists idx_blackouts_coach on public.training_blackouts(coach_id);

drop trigger if exists trg_blackouts_updated on public.training_blackouts;
create trigger trg_blackouts_updated before update on public.training_blackouts
  for each row execute function public.set_updated_at();
drop trigger if exists trg_blackouts_same_org on public.training_blackouts;
create trigger trg_blackouts_same_org before insert or update on public.training_blackouts
  for each row execute function public.training_same_org_guard('coach_id', 'venue_id');
drop trigger if exists trg_audit_blackouts on public.training_blackouts;
create trigger trg_audit_blackouts after insert or update or delete on public.training_blackouts
  for each row execute function public.audit_trigger();

alter table public.training_blackouts enable row level security;
drop policy if exists blackouts_select on public.training_blackouts;
create policy blackouts_select on public.training_blackouts for select
  using (org_id = public.current_org_id());
-- Club-wide / venue blackouts: admins. A coach manages their own.
drop policy if exists blackouts_insert on public.training_blackouts;
create policy blackouts_insert on public.training_blackouts for insert
  with check (org_id = public.current_org_id() and (public.is_admin() or (coach_id is not null and coach_id = public.current_coach_id())));
drop policy if exists blackouts_update on public.training_blackouts;
create policy blackouts_update on public.training_blackouts for update
  using (org_id = public.current_org_id() and (public.is_admin() or (coach_id is not null and coach_id = public.current_coach_id())))
  with check (org_id = public.current_org_id() and (public.is_admin() or (coach_id is not null and coach_id = public.current_coach_id())));
drop policy if exists blackouts_delete on public.training_blackouts;
create policy blackouts_delete on public.training_blackouts for delete
  using (org_id = public.current_org_id() and (public.is_admin() or (coach_id is not null and coach_id = public.current_coach_id())));
grant select, insert, update, delete on public.training_blackouts to authenticated;
grant all on public.training_blackouts to service_role;

-- ---------------------------------------------------------------------------
-- 7) Athlete training profile (goals / notes; coach-visible)
-- ---------------------------------------------------------------------------
create table if not exists public.athlete_training_profiles (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  athlete_id  uuid not null references public.athletes(id) on delete cascade,
  goals       text check (goals is null or length(goals) <= 4000),
  notes       text check (notes is null or length(notes) <= 4000),
  level       text check (level is null or length(level) <= 80),
  focus_areas text[] not null default '{}',
  updated_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (athlete_id)
);
create index if not exists idx_atp_org on public.athlete_training_profiles(org_id);

drop trigger if exists trg_atp_updated on public.athlete_training_profiles;
create trigger trg_atp_updated before update on public.athlete_training_profiles
  for each row execute function public.set_updated_at();
drop trigger if exists trg_atp_same_org on public.athlete_training_profiles;
create trigger trg_atp_same_org before insert or update on public.athlete_training_profiles
  for each row execute function public.training_same_org_guard('athlete_id');
drop trigger if exists trg_audit_atp on public.athlete_training_profiles;
create trigger trg_audit_atp after insert or update or delete on public.athlete_training_profiles
  for each row execute function public.audit_trigger();

alter table public.athlete_training_profiles enable row level security;
drop policy if exists atp_select on public.athlete_training_profiles;
create policy atp_select on public.athlete_training_profiles for select
  using (org_id = public.current_org_id()
         and (public.is_admin() or public.is_guardian_of_athlete(athlete_id) or public.coach_can_access_athlete(athlete_id)));
drop policy if exists atp_insert on public.athlete_training_profiles;
create policy atp_insert on public.athlete_training_profiles for insert
  with check (org_id = public.current_org_id() and (public.is_admin() or public.coach_can_access_athlete(athlete_id)));
drop policy if exists atp_update on public.athlete_training_profiles;
create policy atp_update on public.athlete_training_profiles for update
  using (org_id = public.current_org_id() and (public.is_admin() or public.coach_can_access_athlete(athlete_id)))
  with check (org_id = public.current_org_id() and (public.is_admin() or public.coach_can_access_athlete(athlete_id)));
drop policy if exists atp_delete on public.athlete_training_profiles;
create policy atp_delete on public.athlete_training_profiles for delete
  using (org_id = public.current_org_id() and public.is_admin());
grant select, insert, update, delete on public.athlete_training_profiles to authenticated;
grant all on public.athlete_training_profiles to service_role;

-- ---------------------------------------------------------------------------
-- 8) Discount hook (extension point for the shared discounts model)
--
-- Returns {"discount_total": <number>, "discount_ids": [<uuid>...],
--          "label": <text|null>} for a purchase of p_amount (list price).
-- This version applies no discount. The discounts migration replaces this
-- function (create or replace, same signature); purchase_training_package()
-- and book_training() store its result on the purchase / invoice.
-- ---------------------------------------------------------------------------
create or replace function public.training_purchase_discount(
  p_org uuid, p_athlete uuid, p_service uuid, p_package uuid, p_amount numeric, p_currency text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('discount_total', 0, 'discount_ids', '[]'::jsonb, 'label', null);
$$;

-- ---------------------------------------------------------------------------
-- 9) Availability check (mirrors src/lib/training/slots.ts)
--    Capacity + venue of the best window that fully covers [p_start, p_end)
--    for the coach and service; no row = not bookable.
-- ---------------------------------------------------------------------------
create or replace function public.training_slot_window(
  p_org uuid, p_coach uuid, p_service uuid, p_start timestamptz, p_end timestamptz)
returns table (capacity integer, venue_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz   text := public.training_org_tz(p_org);
  v_ls   timestamp := p_start at time zone v_tz;
  v_le   timestamp := p_end at time zone v_tz;
  v_day  timestamp := date_trunc('day', p_start at time zone v_tz);
  v_dow  integer := extract(isodow from (p_start at time zone v_tz))::integer;
  v_from interval;
  v_to   interval;
begin
  if p_end <= p_start then return; end if;
  v_from := v_ls - v_day;
  v_to   := v_le - v_day;

  -- Club-wide or coach blackout.
  if exists (select 1 from public.training_blackouts b
              where b.org_id = p_org and b.venue_id is null
                and (b.coach_id is null or b.coach_id = p_coach)
                and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(p_start, p_end, '[)')) then
    return;
  end if;

  return query
  with w as (
    select t.capacity as cap, t.venue_id as v
      from public.coach_availability_templates t
     where t.org_id = p_org and t.coach_id = p_coach and t.is_active and t.weekday = v_dow
       and (t.service_id is null or t.service_id = p_service)
       and (t.valid_from is null or v_ls::date >= t.valid_from)
       and (t.valid_until is null or v_ls::date <= t.valid_until)
       and v_from >= (t.start_time - time '00:00') and v_to <= (t.end_time - time '00:00')
    union all
    select a.capacity, a.venue_id
      from public.coach_availability a
     where a.org_id = p_org and a.coach_id = p_coach
       and (a.service_id is null or a.service_id = p_service)
       and a.starts_at <= p_start and a.ends_at >= p_end
  ), r as (
    select w.cap, coalesce(w.v, s.venue_id) as v
      from w join public.training_services s on s.id = p_service and s.org_id = p_org
  )
  select r.cap, r.v
    from r
    left join public.venues ve on ve.id = r.v
   where public.training_within_hours(ve.opening_hours, v_dow, v_from, v_to)
     and not exists (select 1 from public.training_blackouts b
                      where b.org_id = p_org and b.venue_id is not null and b.venue_id = r.v
                        and (b.coach_id is null or b.coach_id = p_coach)
                        and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(p_start, p_end, '[)'))
   order by r.cap desc
   limit 1;
end;
$$;

-- Busy times of the caller's org for slot computation: no athlete data,
-- only coach / service / time / count, so parents can see spots left.
create or replace function public.training_busy(p_from timestamptz, p_to timestamptz)
returns table (coach_id uuid, service_id uuid, slot_start timestamptz, slot_end timestamptz, booked integer)
language sql
stable
security definer
set search_path = public
as $$
  select b.coach_id, b.service_id, b.slot_start,
         coalesce(b.slot_end, b.slot_start + interval '1 hour'), count(*)::integer
    from public.training_bookings b
   where b.org_id = public.current_org_id()
     and auth.uid() is not null
     and b.status in ('booked', 'completed')
     and b.slot_start < p_to
     and coalesce(b.slot_end, b.slot_start + interval '1 hour') > p_from
     and p_to - p_from <= interval '120 days'
   group by b.coach_id, b.service_id, b.slot_start, coalesce(b.slot_end, b.slot_start + interval '1 hour');
$$;

-- Remaining package sessions per service for one athlete (admin, guardian,
-- or a coach who works with the athlete). Expired / pending lots excluded.
create or replace function public.training_balances(p_athlete uuid)
returns table (service_id uuid, remaining integer, pending integer, next_expiry timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.athletes a where a.id = p_athlete and a.org_id = public.current_org_id()) then
    return;
  end if;
  if not (public.is_finance() or public.is_guardian_of_athlete(p_athlete) or public.coach_can_access_athlete(p_athlete)) then
    return;
  end if;
  return query
    select p.service_id,
           coalesce(sum(p.sessions - p.sessions_used) filter (
             where p.status = 'active' and (p.expires_at is null or p.expires_at > now())), 0)::integer,
           coalesce(sum(p.sessions - p.sessions_used) filter (where p.status = 'pending'), 0)::integer,
           min(p.expires_at) filter (where p.status = 'active' and p.expires_at > now() and p.sessions_used < p.sessions)
      from public.training_package_purchases p
     where p.athlete_id = p_athlete
     group by p.service_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10) Purchases
-- ---------------------------------------------------------------------------
-- Internal: create a purchase (+ invoice when money is due). Caller has
-- checked the role and the org. Returns the purchase row.
create or replace function public.training_create_purchase(
  p_org uuid, p_athlete uuid, p_service uuid, p_package uuid, p_mode text, p_note text)
returns public.training_package_purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_svc     public.training_services%rowtype;
  v_pkg     public.credit_packages%rowtype;
  v_ath     public.athletes%rowtype;
  v_cur     text;
  v_exp     integer;
  v_list    numeric;
  v_disc    jsonb;
  v_dtotal  numeric;
  v_amount  numeric;
  v_ids     uuid[];
  v_inv     uuid;
  v_sessions integer;
  v_validity integer;
  v_label   text;
  v_row     public.training_package_purchases;
begin
  select * into v_ath from public.athletes where id = p_athlete and org_id = p_org;
  if not found then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_svc from public.training_services where id = p_service and org_id = p_org;
  if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002'; end if;

  if p_package is not null then
    select * into v_pkg from public.credit_packages
     where id = p_package and org_id = p_org and service_id = p_service and is_active;
    if not found then raise exception 'PACKAGE_NOT_FOUND' using errcode = 'P0002'; end if;
    v_sessions := v_pkg.credits;
    v_list     := v_pkg.price_chf;
    v_validity := v_pkg.validity_days;
    v_label    := v_svc.name || ' — ' || v_pkg.name;
  else
    v_sessions := 1;
    v_list     := v_svc.price_chf;
    v_validity := null;
    v_label    := v_svc.name;
  end if;

  v_cur := coalesce(v_svc.currency, public.training_org_currency(p_org));
  v_exp := public.currency_exponent(v_cur);
  v_list := round(coalesce(v_list, 0), v_exp);

  -- Discount hook.
  v_disc := coalesce(public.training_purchase_discount(p_org, p_athlete, p_service, p_package, v_list, v_cur), '{}'::jsonb);
  v_dtotal := least(v_list, greatest(0, round(coalesce((v_disc->>'discount_total')::numeric, 0), v_exp)));
  select coalesce(array_agg(x::uuid), '{}') into v_ids
    from jsonb_array_elements_text(coalesce(v_disc->'discount_ids', '[]'::jsonb)) x;
  v_amount := case when p_mode = 'comp' then 0 else v_list - v_dtotal end;
  if p_mode = 'comp' then v_dtotal := v_list; end if;

  if p_mode in ('invoice', 'paid') and v_amount > 0 then
    insert into public.invoices (org_id, number, family_id, athlete_id, description, currency, status, due_date, created_by)
    values (p_org, public.next_invoice_number(p_org), v_ath.family_id, p_athlete,
            v_label || ' — ' || v_ath.first_name || ' ' || v_ath.last_name, v_cur, 'sent',
            (now() + interval '7 days')::date, auth.uid())
    returning id into v_inv;
    insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
    values (p_org, v_inv, v_label || ' — ' || v_ath.first_name || ' ' || v_ath.last_name, 1, v_list, v_list);
    if v_dtotal > 0 then
      insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
      values (p_org, v_inv, coalesce(nullif(btrim(v_disc->>'label'), ''), v_label), 1, -v_dtotal, -v_dtotal);
    end if;
    update public.invoices set total_chf = v_amount where id = v_inv;
  end if;

  insert into public.training_package_purchases
    (org_id, athlete_id, family_id, service_id, package_id, sessions, list_price, discount_total, discount_ids,
     amount, currency, payment_mode, status, invoice_id, validity_days, granted_at, expires_at, notes, created_by)
  values
    (p_org, p_athlete, v_ath.family_id, p_service, p_package, v_sessions, v_list, v_dtotal, v_ids,
     v_amount, v_cur, p_mode,
     case when v_inv is null then 'active' else 'pending' end,
     v_inv, v_validity,
     case when v_inv is null then now() end,
     case when v_inv is null and v_validity is not null then now() + make_interval(days => v_validity) end,
     nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning * into v_row;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (p_org, auth.uid(), 'TRAINING_PACKAGE_SOLD', 'training_package_purchases', v_row.id,
          jsonb_build_object('athlete_id', p_athlete, 'service_id', p_service, 'package_id', p_package,
                             'sessions', v_sessions, 'list_price', v_list, 'discount_total', v_dtotal,
                             'amount', v_amount, 'currency', v_cur, 'mode', p_mode, 'invoice_id', v_inv));

  if p_mode = 'paid' and v_inv is not null then
    -- Recorded like any manual payment; the invoice trigger activates the lot.
    perform public.record_offline_payment(v_inv, v_amount, 'manual', null, null, p_note);
    select * into v_row from public.training_package_purchases where id = v_row.id;
  end if;

  return v_row;
end;
$$;

-- Sell / buy a package (or a single session as a one-credit lot).
--   guardians: p_mode 'invoice' only, own children, bookings enabled
--   admins:    'invoice' | 'paid' (manual payment recorded) | 'comp' (free)
create or replace function public.purchase_training_package(
  p_athlete uuid, p_service uuid, p_package uuid default null, p_mode text default 'invoice', p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid;
  v_admin   boolean := public.is_admin();
  v_enabled boolean;
  v_row     public.training_package_purchases;
begin
  select org_id into v_org from public.athletes where id = p_athlete;
  if v_org is null or v_org is distinct from public.current_org_id() then
    raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_mode not in ('invoice', 'paid', 'comp') then raise exception 'INVALID_MODE' using errcode = 'P0001'; end if;
  if not v_admin then
    if not public.is_guardian_of_athlete(p_athlete) then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
    if p_mode <> 'invoice' then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
    select coalesce((settings->>'bookings_enabled')::boolean, false) into v_enabled
      from public.app_settings where org_id = v_org;
    if not coalesce(v_enabled, false) then raise exception 'BOOKINGS_DISABLED' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.training_services where id = p_service and org_id = v_org and is_active) then
      raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;
  if length(coalesce(p_note, '')) > 2000 then raise exception 'NOTE_TOO_LONG' using errcode = 'P0001'; end if;

  v_row := public.training_create_purchase(v_org, p_athlete, p_service, p_package, p_mode, p_note);
  return jsonb_build_object('purchase_id', v_row.id, 'invoice_id', v_row.invoice_id, 'status', v_row.status,
                            'sessions', v_row.sessions, 'amount', v_row.amount, 'currency', v_row.currency,
                            'discount_total', v_row.discount_total);
end;
$$;

-- Admin: cancel a purchase. An unpaid invoice is cancelled with it; unused
-- sessions are forfeited (money back goes through a credit note).
create or replace function public.cancel_training_purchase(p_purchase uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v       public.training_package_purchases;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if length(v_reason) > 500 then raise exception 'REASON_TOO_LONG' using errcode = 'P0001'; end if;
  select * into v from public.training_package_purchases
   where id = p_purchase and org_id = public.current_org_id() for update;
  if not found then raise exception 'PURCHASE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.status = 'cancelled' then raise exception 'NOT_CANCELLABLE' using errcode = 'P0001'; end if;

  if v.invoice_id is not null and exists (
       select 1 from public.invoices i where i.id = v.invoice_id
          and i.status::text in ('draft', 'sent', 'pending', 'overdue')
          and public.invoice_net_paid(i.id) = 0) then
    perform public.cancel_invoice(v.invoice_id, v_reason);   -- trigger cancels the purchase
  end if;

  update public.training_package_purchases
     set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()), cancel_reason = v_reason
   where id = p_purchase;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (v.org_id, auth.uid(), 'TRAINING_PACKAGE_CANCELLED', 'training_package_purchases', p_purchase,
          jsonb_build_object('status', v.status, 'sessions', v.sessions, 'used', v.sessions_used),
          jsonb_build_object('status', 'cancelled', 'reason', v_reason));
  return jsonb_build_object('purchase_id', p_purchase, 'status', 'cancelled');
end;
$$;

-- Invoice paid -> activate the pending lot (start validity). Invoice
-- cancelled / voided -> cancel the pending lot and its upcoming bookings.
create or replace function public.training_purchase_on_invoice_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_p public.training_package_purchases;
begin
  if new.status::text = 'paid' then
    update public.training_package_purchases
       set status = 'active', granted_at = now(),
           expires_at = case when validity_days is not null then now() + make_interval(days => validity_days) end
     where invoice_id = new.id and status = 'pending';
  elsif new.status::text in ('cancelled', 'void') then
    for v_p in select * from public.training_package_purchases
                where invoice_id = new.id and status = 'pending' loop
      update public.training_package_purchases
         set status = 'cancelled', cancelled_at = now(), cancel_reason = coalesce(cancel_reason, 'invoice_cancelled')
       where id = v_p.id;
      update public.training_bookings
         set status = 'cancelled', cancel_reason = coalesce(cancel_reason, 'invoice_cancelled'), updated_at = now()
       where purchase_id = v_p.id and status = 'booked' and slot_start > now();
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_invoices_training_purchase on public.invoices;
create trigger trg_invoices_training_purchase
  after update of status on public.invoices
  for each row when (old.status is distinct from new.status)
  execute function public.training_purchase_on_invoice_status();

-- ---------------------------------------------------------------------------
-- 11) Booking from real availability
-- ---------------------------------------------------------------------------
-- Internal: is (coach, service, start..end) bookable for one more athlete?
-- Returns the venue to use; raises a coded error otherwise. Locks the coach.
create or replace function public.training_check_slot(
  p_org uuid, p_coach uuid, p_svc public.training_services, p_athlete uuid,
  p_start timestamptz, p_end timestamptz, p_override boolean, p_exclude uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cap   integer;
  v_venue uuid;
  v_count integer;
begin
  perform 1 from public.coaches where id = p_coach and org_id = p_org and is_active for update;
  if not found then raise exception 'COACH_NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.coaches c where c.id = p_coach and p_svc.slug = any(c.serves)) and not p_override then
    raise exception 'COACH_NOT_OFFERING' using errcode = 'P0001';
  end if;

  select w.capacity, w.venue_id into v_cap, v_venue
    from public.training_slot_window(p_org, p_coach, p_svc.id, p_start, p_end) w;
  if v_cap is null then
    if not p_override then raise exception 'SLOT_NOT_AVAILABLE' using errcode = 'P0001'; end if;
    v_cap := p_svc.max_participants;
    v_venue := p_svc.venue_id;
  end if;
  v_cap := least(v_cap, p_svc.max_participants);

  -- A different session of this coach overlaps -> busy.
  if exists (select 1 from public.training_bookings o
              where o.org_id = p_org and o.coach_id = p_coach and o.status in ('booked', 'completed')
                and o.id is distinct from p_exclude
                and tstzrange(o.slot_start, coalesce(o.slot_end, o.slot_start + interval '1 hour'), '[)')
                    && tstzrange(p_start, p_end, '[)')
                and not (o.service_id = p_svc.id and o.slot_start = p_start)) then
    raise exception 'COACH_BUSY' using errcode = 'P0001';
  end if;

  select count(*) into v_count from public.training_bookings o
   where o.org_id = p_org and o.coach_id = p_coach and o.service_id = p_svc.id and o.slot_start = p_start
     and o.status in ('booked', 'completed') and o.id is distinct from p_exclude;
  if v_count >= v_cap then raise exception 'SLOT_FULL' using errcode = 'P0001'; end if;

  if exists (select 1 from public.training_bookings o
              where o.athlete_id = p_athlete and o.status in ('booked', 'completed')
                and o.id is distinct from p_exclude
                and tstzrange(o.slot_start, coalesce(o.slot_end, o.slot_start + interval '1 hour'), '[)')
                    && tstzrange(p_start, p_end, '[)')) then
    raise exception 'ATHLETE_BUSY' using errcode = 'P0001';
  end if;
  return v_venue;
end;
$$;

-- p_pay_with:
--   'credits' - one session from an active, unexpired package of this service
--               (p_purchase picks the lot, else first to expire); falls back
--               to legacy category credits when the service takes them.
--   'package' - buys p_package now (invoice; admins may pass p_mode 'paid' /
--               'comp') and reserves the first session from it.
--   'invoice' - single session invoiced at the service price.
-- p_override (admins only): book outside the published availability.
create or replace function public.book_training(
  p_athlete uuid, p_service uuid, p_coach uuid, p_start timestamptz,
  p_pay_with text default 'credits', p_purchase uuid default null, p_package uuid default null,
  p_mode text default 'invoice', p_override boolean default false, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      uuid;
  v_family   uuid;
  v_name     text;
  v_admin    boolean := public.is_admin();
  v_enabled  boolean;
  v_svc      public.training_services%rowtype;
  v_end      timestamptz;
  v_venue    uuid;
  v_lot      public.training_package_purchases;
  v_balance  integer;
  v_booking  uuid;
  v_invoice  uuid;
  v_price    numeric;
  v_cur      text;
  v_credits  integer := 0;
  v_purchase uuid;
  v_disc     jsonb;
  v_dtotal   numeric := 0;
begin
  select org_id, family_id, first_name || ' ' || last_name into v_org, v_family, v_name
    from public.athletes where id = p_athlete;
  if v_org is null or v_org is distinct from public.current_org_id() then
    raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (v_admin or public.is_guardian_of_athlete(p_athlete)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if p_pay_with not in ('credits', 'package', 'invoice') then raise exception 'INVALID_PAYMENT' using errcode = 'P0001'; end if;
  if length(coalesce(p_notes, '')) > 2000 then raise exception 'NOTE_TOO_LONG' using errcode = 'P0001'; end if;

  if not v_admin then
    select coalesce((settings->>'bookings_enabled')::boolean, false) into v_enabled
      from public.app_settings where org_id = v_org;
    if not coalesce(v_enabled, false) then raise exception 'BOOKINGS_DISABLED' using errcode = 'P0001'; end if;
    if p_start <= now() then raise exception 'SLOT_IN_PAST' using errcode = 'P0001'; end if;
  end if;

  select * into v_svc from public.training_services where id = p_service and org_id = v_org and is_active;
  if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_start is null then raise exception 'INVALID_TIME' using errcode = 'P0001'; end if;
  v_end := p_start + make_interval(mins => v_svc.duration_min);

  v_venue := public.training_check_slot(v_org, p_coach, v_svc, p_athlete, p_start, v_end,
                                        v_admin and coalesce(p_override, false), null);

  if p_pay_with = 'package' then
    if p_package is null then raise exception 'PACKAGE_NOT_FOUND' using errcode = 'P0002'; end if;
    if not v_admin and p_mode <> 'invoice' then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
    if p_mode not in ('invoice', 'paid', 'comp') then raise exception 'INVALID_MODE' using errcode = 'P0001'; end if;
    v_lot := public.training_create_purchase(v_org, p_athlete, p_service, p_package, p_mode, null);
    update public.training_package_purchases set sessions_used = sessions_used + 1 where id = v_lot.id;
    v_purchase := v_lot.id; v_credits := 1; v_price := 0; v_invoice := v_lot.invoice_id;

  elsif p_pay_with = 'credits' then
    if p_purchase is not null then
      select * into v_lot from public.training_package_purchases
       where id = p_purchase and org_id = v_org and athlete_id = p_athlete and service_id = p_service
         and sessions_used < sessions
         and (status = 'active' and (expires_at is null or expires_at > now())
              -- the remaining sessions of a package bought in this booking
              -- flow can be scheduled before the invoice is paid
              or (status = 'pending' and (created_by = auth.uid() or v_admin)))
       for update;
    else
      select * into v_lot from public.training_package_purchases
       where org_id = v_org and athlete_id = p_athlete and service_id = p_service
         and status = 'active' and (expires_at is null or expires_at > now()) and sessions_used < sessions
       order by expires_at nulls last, granted_at, created_at
       limit 1
       for update;
    end if;
    if v_lot.id is not null then
      update public.training_package_purchases set sessions_used = sessions_used + 1 where id = v_lot.id;
      v_purchase := v_lot.id; v_credits := 1; v_price := 0;
    elsif p_purchase is null and v_svc.credits_required > 0 then
      -- Legacy category credits.
      select (total_credits - used_credits) into v_balance from public.training_credits
       where athlete_id = p_athlete and credit_category = v_svc.credit_category for update;
      if coalesce(v_balance, 0) < v_svc.credits_required then
        raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
      end if;
      update public.training_credits set used_credits = used_credits + v_svc.credits_required, updated_at = now()
       where athlete_id = p_athlete and credit_category = v_svc.credit_category;
      v_credits := v_svc.credits_required; v_price := 0;
    else
      raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
    end if;

  else -- single session invoice
    v_cur := coalesce(v_svc.currency, public.training_org_currency(v_org));
    v_price := round(v_svc.price_chf, public.currency_exponent(v_cur));
    v_disc := coalesce(public.training_purchase_discount(v_org, p_athlete, p_service, null, v_price, v_cur), '{}'::jsonb);
    v_dtotal := least(v_price, greatest(0, round(coalesce((v_disc->>'discount_total')::numeric, 0), public.currency_exponent(v_cur))));
    if v_price - v_dtotal > 0 then
      insert into public.invoices (org_id, number, family_id, athlete_id, description, currency, status, due_date, created_by)
      values (v_org, public.next_invoice_number(v_org), v_family, p_athlete, v_svc.name || ' — ' || v_name,
              v_cur, 'sent', (now() + interval '7 days')::date, auth.uid())
      returning id into v_invoice;
      insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
      values (v_org, v_invoice, v_svc.name || ' — ' || v_name, 1, v_price, v_price);
      if v_dtotal > 0 then
        insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
        values (v_org, v_invoice, coalesce(nullif(btrim(v_disc->>'label'), ''), v_svc.name), 1, -v_dtotal, -v_dtotal);
      end if;
      update public.invoices set total_chf = v_price - v_dtotal where id = v_invoice;
    end if;
    v_price := v_price - v_dtotal;
  end if;

  insert into public.training_bookings
    (org_id, athlete_id, service_id, coach_id, slot_start, slot_end, status, invoice_id,
     credits_used, price_chf, purchase_id, venue_id, location_text, notes, created_by)
  values
    (v_org, p_athlete, p_service, p_coach, p_start, v_end, 'booked',
     case when p_pay_with = 'invoice' then v_invoice end,
     v_credits, v_price, v_purchase, v_venue, v_svc.location_text,
     nullif(btrim(coalesce(p_notes, '')), ''), auth.uid())
  returning id into v_booking;

  perform public.training_refresh_group(v_org, p_coach, p_service, p_start);

  return jsonb_build_object('booking_id', v_booking, 'purchase_id', v_purchase, 'invoice_id', v_invoice,
                            'credits_used', v_credits, 'price', v_price, 'slot_start', p_start, 'slot_end', v_end,
                            'venue_id', v_venue, 'pay_with', p_pay_with);
end;
$$;

-- Move a booking to another bookable time (same service). Guardians only
-- while outside the cancellation window; admins any time.
create or replace function public.reschedule_training(p_booking uuid, p_coach uuid, p_start timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b     public.training_bookings%rowtype;
  v_svc   public.training_services%rowtype;
  v_admin boolean := public.is_admin();
  v_min   numeric;
  v_end   timestamptz;
  v_venue uuid;
begin
  select * into v_b from public.training_bookings where id = p_booking for update;
  if not found or v_b.org_id is distinct from public.current_org_id() then
    raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (v_admin or public.is_guardian_of_athlete(v_b.athlete_id)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if v_b.status <> 'booked' then raise exception 'NOT_RESCHEDULABLE' using errcode = 'P0001'; end if;
  if not v_admin then
    select coalesce((settings->'booking'->>'cancellation_hours')::numeric, 24) into v_min
      from public.app_settings where org_id = v_b.org_id;
    if extract(epoch from (v_b.slot_start - now())) / 3600.0 < coalesce(v_min, 24) then
      raise exception 'NOT_RESCHEDULABLE' using errcode = 'P0001';
    end if;
    if p_start <= now() then raise exception 'SLOT_IN_PAST' using errcode = 'P0001'; end if;
  end if;
  select * into v_svc from public.training_services where id = v_b.service_id and org_id = v_b.org_id;
  if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002'; end if;
  v_end := p_start + make_interval(mins => v_svc.duration_min);

  v_venue := public.training_check_slot(v_b.org_id, p_coach, v_svc, v_b.athlete_id, p_start, v_end, false, p_booking);

  -- Legacy slot bookkeeping (no-op for bookings made from templates).
  update public.coach_availability set is_booked = false
   where org_id = v_b.org_id and coach_id = v_b.coach_id and starts_at = v_b.slot_start and is_booked;

  update public.training_bookings
     set coach_id = p_coach, slot_start = p_start, slot_end = v_end, venue_id = coalesce(v_venue, venue_id), updated_at = now()
   where id = p_booking;
  update public.training_bookings set group_confirmed_at = null where id = p_booking and v_svc.session_type = 'group';
  perform public.training_refresh_group(v_b.org_id, p_coach, v_svc.id, p_start);
  return jsonb_build_object('booking_id', p_booking, 'slot_start', p_start, 'slot_end', v_end, 'coach_id', p_coach);
end;
$$;

-- Cancellation (same rules as before) now also returns a package session.
create or replace function public.cancel_training_booking(p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b        public.training_bookings%rowtype;
  v_hours    numeric;
  v_min      numeric;
  v_refund   boolean;
  v_category public.credit_category;
  v_within   boolean;
  v_staff    boolean;
  v_did_refund boolean := false;
begin
  select * into v_b from public.training_bookings where id = p_booking for update;
  if not found or v_b.org_id is distinct from public.current_org_id() then
    raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_staff := public.is_finance();
  if not (public.is_guardian_of_athlete(v_b.athlete_id) or v_staff) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if v_b.status <> 'booked' then raise exception 'NOT_CANCELLABLE' using errcode = 'P0001'; end if;

  select coalesce((settings->'booking'->>'cancellation_hours')::numeric, 24),
         coalesce((settings->'booking'->>'refund_credits_on_cancel')::boolean, true)
    into v_min, v_refund
    from public.app_settings where org_id = v_b.org_id;

  v_hours  := extract(epoch from (v_b.slot_start - now())) / 3600.0;
  v_within := v_hours >= coalesce(v_min, 24);

  update public.training_bookings set status = 'cancelled', updated_at = now() where id = p_booking;
  update public.coach_availability set is_booked = false
    where coach_id = v_b.coach_id and starts_at = v_b.slot_start and org_id = v_b.org_id;

  if v_b.credits_used > 0 and coalesce(v_refund, true) and (v_within or v_staff) then
    if v_b.purchase_id is not null then
      update public.training_package_purchases
         set sessions_used = greatest(0, sessions_used - v_b.credits_used)
       where id = v_b.purchase_id and org_id = v_b.org_id;
    else
      select credit_category into v_category from public.training_services where id = v_b.service_id;
      update public.training_credits set used_credits = greatest(0, used_credits - v_b.credits_used), updated_at = now()
        where athlete_id = v_b.athlete_id and credit_category = v_category;
    end if;
    v_did_refund := true;
  end if;

  if v_b.invoice_id is not null and (v_within or v_staff) then
    update public.invoices set status = 'cancelled'
      where id = v_b.invoice_id and org_id = v_b.org_id and status in ('draft', 'sent', 'pending', 'overdue');
  end if;

  return jsonb_build_object('booking_id', p_booking, 'status', 'cancelled',
                            'within_policy', v_within, 'credits_refunded', v_did_refund);
end;
$$;

-- Coach (own sessions) or admin: attended / no-show / back to booked.
create or replace function public.mark_training_booking(p_booking uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_b public.training_bookings%rowtype;
begin
  select * into v_b from public.training_bookings where id = p_booking for update;
  if not found or v_b.org_id is distinct from public.current_org_id() then
    raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (public.is_admin() or coalesce(v_b.coach_id = public.current_coach_id(), false)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if p_status not in ('booked', 'completed', 'no_show') then raise exception 'INVALID_STATUS' using errcode = 'P0001'; end if;
  if v_b.status = 'cancelled' then raise exception 'NOT_EDITABLE' using errcode = 'P0001'; end if;
  update public.training_bookings set status = p_status::public.booking_status, updated_at = now() where id = p_booking;
  return jsonb_build_object('booking_id', p_booking, 'status', p_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- 12) Grants: client RPCs (each checks role + org); internal helpers none.
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.training_busy(timestamptz, timestamptz)',
    'public.training_balances(uuid)',
    'public.purchase_training_package(uuid, uuid, uuid, text, text)',
    'public.cancel_training_purchase(uuid, text)',
    'public.book_training(uuid, uuid, uuid, timestamptz, text, uuid, uuid, text, boolean, text)',
    'public.reschedule_training(uuid, uuid, timestamptz)',
    'public.mark_training_booking(uuid, text)',
    'public.cancel_training_booking(uuid)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;

  foreach f in array array[
    'public.training_create_purchase(uuid, uuid, uuid, uuid, text, text)',
    'public.training_check_slot(uuid, uuid, public.training_services, uuid, timestamptz, timestamptz, boolean, uuid)',
    'public.training_slot_window(uuid, uuid, uuid, timestamptz, timestamptz)',
    'public.training_purchase_discount(uuid, uuid, uuid, uuid, numeric, text)',
    'public.training_purchase_on_invoice_status()',
    'public.training_same_org_guard()',
    'public.training_org_tz(uuid)',
    'public.training_org_currency(uuid)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 13) Group sessions: minimum participants, admin confirm / cancel
-- ---------------------------------------------------------------------------
-- Internal: confirm every booking of a group slot once the minimum is met.
-- Individual services: the booking is confirmed when made.
create or replace function public.training_refresh_group(p_org uuid, p_coach uuid, p_service uuid, p_start timestamptz)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_svc   public.training_services%rowtype;
  v_count integer;
begin
  select * into v_svc from public.training_services where id = p_service and org_id = p_org;
  if not found then return false; end if;
  select count(*) into v_count from public.training_bookings
   where org_id = p_org and coach_id = p_coach and service_id = p_service and slot_start = p_start and status = 'booked';
  if v_svc.session_type <> 'group' or v_count >= v_svc.min_participants
     or exists (select 1 from public.training_bookings
                 where org_id = p_org and coach_id = p_coach and service_id = p_service and slot_start = p_start
                   and status in ('booked', 'completed') and group_confirmed_at is not null) then
    update public.training_bookings set group_confirmed_at = now()
     where org_id = p_org and coach_id = p_coach and service_id = p_service and slot_start = p_start
       and status = 'booked' and group_confirmed_at is null;
    return true;
  end if;
  return false;
end;
$$;

-- Admin: confirm a group slot below its minimum (the session runs anyway).
create or replace function public.confirm_training_group(p_coach uuid, p_service uuid, p_start timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id(); v_n integer;
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.training_bookings
                  where org_id = v_org and coach_id = p_coach and service_id = p_service
                    and slot_start = p_start and status = 'booked') then
    raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002';
  end if;
  update public.training_bookings set group_confirmed_at = now()
   where org_id = v_org and coach_id = p_coach and service_id = p_service and slot_start = p_start
     and status = 'booked' and group_confirmed_at is null;
  get diagnostics v_n = row_count;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, auth.uid(), 'TRAINING_GROUP_CONFIRMED', 'training_services', p_service,
          jsonb_build_object('coach_id', p_coach, 'slot_start', p_start, 'bookings', v_n));
  return jsonb_build_object('confirmed', v_n);
end;
$$;

-- Admin: cancel a whole group slot (e.g. minimum not reached). Every booking
-- is cancelled as a staff cancellation: credits back, unpaid invoices void.
create or replace function public.cancel_training_group(p_coach uuid, p_service uuid, p_start timestamptz, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid := public.current_org_id();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id     uuid;
  v_n      integer := 0;
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if length(v_reason) > 500 then raise exception 'REASON_TOO_LONG' using errcode = 'P0001'; end if;
  for v_id in select id from public.training_bookings
               where org_id = v_org and coach_id = p_coach and service_id = p_service
                 and slot_start = p_start and status = 'booked' loop
    perform public.cancel_training_booking(v_id);
    update public.training_bookings set cancel_reason = v_reason, cancelled_by = auth.uid() where id = v_id;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, auth.uid(), 'TRAINING_GROUP_CANCELLED', 'training_services', p_service,
          jsonb_build_object('coach_id', p_coach, 'slot_start', p_start, 'bookings', v_n, 'reason', v_reason));
  return jsonb_build_object('cancelled', v_n);
end;
$$;

-- ---------------------------------------------------------------------------
-- 14) Public booking page (non-members): catalogue + guest checkout
-- ---------------------------------------------------------------------------
-- Everything a public page needs to show services, packages, coaches and
-- real availability for ONE club, resolved from its slug. No personal data:
-- coach display names (staff), venue addresses, time windows and booked
-- counts only. Returns null when the club does not take online bookings.
create or replace function public.training_public_catalog(p_slug text, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org  public.organizations%rowtype;
  v_on   boolean;
  v_from timestamptz := greatest(coalesce(p_from, now()), now());
  v_to   timestamptz;
begin
  select * into v_org from public.organizations where slug = lower(btrim(coalesce(p_slug, '')));
  if not found then return null; end if;
  if coalesce(to_jsonb(v_org)->>'status', 'active') in ('suspended', 'cancelled', 'closed', 'deleted') then return null; end if;
  select coalesce((settings->>'bookings_enabled')::boolean, false) into v_on from public.app_settings where org_id = v_org.id;
  if not coalesce(v_on, false) then return null; end if;
  v_to := least(coalesce(p_to, v_from + interval '28 days'), v_from + interval '62 days');

  return jsonb_build_object(
    'org', jsonb_build_object('id', v_org.id, 'name', v_org.name, 'slug', v_org.slug,
                              'timezone', public.training_org_tz(v_org.id), 'currency', public.training_org_currency(v_org.id)),
    'settings', coalesce((select jsonb_build_object(
                    'cancellation_hours', coalesce((settings->'booking'->>'cancellation_hours')::numeric, 24),
                    'slot_step_min', coalesce((settings->'booking'->>'slot_step_min')::integer, 30),
                    'lead_hours', coalesce((settings->'booking'->>'lead_hours')::integer, 0),
                    'horizon_days', coalesce((settings->'booking'->>'horizon_days')::integer, 28))
                   from public.app_settings where org_id = v_org.id), '{}'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'slug', s.slug, 'name', s.name, 'description', s.description, 'duration_min', s.duration_min,
        'price', s.price_chf, 'currency', coalesce(s.currency, public.training_org_currency(v_org.id)),
        'session_type', s.session_type, 'max_participants', s.max_participants, 'min_participants', s.min_participants,
        'venue_id', s.venue_id, 'location_text', s.location_text, 'color', s.color) order by s.sort_order, s.name)
      from public.training_services s where s.org_id = v_org.id and s.is_active), '[]'::jsonb),
    'packages', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'service_id', p.service_id, 'name', p.name, 'sessions', p.credits, 'price', p.price_chf,
        'validity_days', p.validity_days, 'description', p.description) order by p.sort_order, p.credits)
      from public.credit_packages p join public.training_services s on s.id = p.service_id and s.is_active
      where p.org_id = v_org.id and p.is_active), '[]'::jsonb),
    'coaches', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.display_name, 'title', c.role_title, 'serves', c.serves) order by c.display_name)
      from public.coaches c where c.org_id = v_org.id and c.is_active), '[]'::jsonb),
    'venues', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'address', v.address,
        'postal_code', v.postal_code, 'city', v.city, 'opening_hours', v.opening_hours))
      from public.venues v where v.org_id = v_org.id and v.is_active), '[]'::jsonb),
    'templates', coalesce((select jsonb_agg(jsonb_build_object('coach_id', t.coach_id, 'venue_id', t.venue_id, 'service_id', t.service_id,
        'weekday', t.weekday, 'start_time', to_char(t.start_time, 'HH24:MI'), 'end_time', to_char(t.end_time, 'HH24:MI'),
        'capacity', t.capacity, 'valid_from', t.valid_from, 'valid_until', t.valid_until))
      from public.coach_availability_templates t join public.coaches c on c.id = t.coach_id and c.is_active
      where t.org_id = v_org.id and t.is_active), '[]'::jsonb),
    'windows', coalesce((select jsonb_agg(jsonb_build_object('coach_id', a.coach_id, 'venue_id', a.venue_id, 'service_id', a.service_id,
        'starts_at', a.starts_at, 'ends_at', a.ends_at, 'capacity', a.capacity))
      from public.coach_availability a
      where a.org_id = v_org.id and a.ends_at > v_from and a.starts_at < v_to and not a.is_booked), '[]'::jsonb),
    'blackouts', coalesce((select jsonb_agg(jsonb_build_object('coach_id', b.coach_id, 'venue_id', b.venue_id,
        'starts_at', b.starts_at, 'ends_at', b.ends_at))
      from public.training_blackouts b where b.org_id = v_org.id and b.ends_at > v_from and b.starts_at < v_to), '[]'::jsonb),
    'busy', coalesce((select jsonb_agg(jsonb_build_object('coach_id', x.coach_id, 'service_id', x.service_id,
        'start', x.slot_start, 'end', x.slot_end, 'booked', x.n))
      from (select bk.coach_id, bk.service_id, bk.slot_start,
                   coalesce(bk.slot_end, bk.slot_start + interval '1 hour') as slot_end, count(*)::integer as n
              from public.training_bookings bk
             where bk.org_id = v_org.id and bk.status in ('booked', 'completed')
               and bk.slot_start < v_to and coalesce(bk.slot_end, bk.slot_start + interval '1 hour') > v_from
             group by 1, 2, 3, 4) x), '[]'::jsonb),
    'consents', coalesce((select jsonb_agg(jsonb_build_object('key', f.key, 'title', f.title, 'version', f.version,
        'required', f.is_required) order by f.key)
      from public.consent_forms f where f.org_id = v_org.id and f.is_active
        and f.version = (select max(f2.version) from public.consent_forms f2 where f2.org_id = f.org_id and f2.key = f.key and f2.is_active)), '[]'::jsonb),
    'requires_vpc', public.org_requires_vpc(v_org.id)
  );
end;
$$;

-- Guest checkout from the public page (service role only, called by the
-- server action after it created the parent's auth account). The club is
-- the one owning p_slug (never a client-supplied org id). Creates the guest
-- family (non-member), the guardian link, the child (minimum data: name +
-- date of birth), the guardian's consents, then books through
-- book_training() AS that parent, so every booking rule applies.
-- Payment: a package ('package') or a single session ('invoice'); the parent
-- pays the invoice in the parent app (card / TWINT when Stripe is set up) or
-- by QR-bill / bank transfer.
create or replace function public.training_guest_checkout(p_slug text, p_user uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      uuid;
  v_email    text;
  v_profile  public.profiles%rowtype;
  v_family   uuid;
  v_athlete  uuid;
  v_dob      date;
  v_form     record;
  v_ip       inet;
  v_accepted text[];
  v_res      jsonb;
  v_prev     text;
  v_pay      text := coalesce(p_payload->>'pay_with', 'invoice');
begin
  if auth.uid() is not null then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;  -- service role only
  select id into v_org from public.organizations where slug = lower(btrim(coalesce(p_slug, '')));
  if v_org is null then raise exception 'CLUB_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_pay not in ('package', 'invoice') then raise exception 'INVALID_PAYMENT' using errcode = 'P0001'; end if;

  select lower(email) into v_email from auth.users where id = p_user;
  if v_email is null or v_email <> lower(btrim(coalesce(p_payload->'parent'->>'email', ''))) then
    raise exception 'ACCOUNT_MISMATCH' using errcode = 'P0001';
  end if;
  select * into v_profile from public.profiles where id = p_user for update;
  if not found then raise exception 'ACCOUNT_MISMATCH' using errcode = 'P0001'; end if;
  if v_profile.org_id is not null and v_profile.org_id <> v_org then
    raise exception 'ACCOUNT_OTHER_CLUB' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.staff_roles where profile_id = p_user) then
    raise exception 'ACCOUNT_EXISTS' using errcode = 'P0001';
  end if;

  -- Child: minimum data only.
  if coalesce(btrim(p_payload->'child'->>'first_name'), '') = '' or coalesce(btrim(p_payload->'child'->>'last_name'), '') = '' then
    raise exception 'CHILD_REQUIRED' using errcode = 'P0001';
  end if;
  begin v_dob := (p_payload->'child'->>'dob')::date; exception when others then v_dob := null; end;
  if v_dob is null or v_dob >= current_date or v_dob < current_date - interval '100 years' then
    raise exception 'INVALID_DOB' using errcode = 'P0001';
  end if;
  if public.org_requires_vpc(v_org) and v_dob > (current_date - interval '13 years') then
    raise exception 'VPC_REQUIRED' using errcode = 'P0001';
  end if;
  if coalesce((p_payload->>'guardian_confirmed')::boolean, false) is not true then
    raise exception 'GUARDIAN_CONSENT_REQUIRED' using errcode = 'P0001';
  end if;

  -- Required consents (authoritative list from the club).
  select coalesce(array_agg(x), '{}') into v_accepted
    from jsonb_array_elements_text(coalesce(p_payload->'consents', '[]'::jsonb)) x;
  if exists (select 1 from public.consent_forms f where f.org_id = v_org and f.is_active and f.is_required
              and not (f.key = any(v_accepted))) then
    raise exception 'CONSENT_REQUIRED' using errcode = 'P0001';
  end if;
  begin v_ip := nullif(p_payload->>'ip', '')::inet; exception when others then v_ip := null; end;

  update public.profiles
     set org_id = v_org,
         full_name = coalesce(nullif(btrim(p_payload->'parent'->>'name'), ''), full_name),
         phone = coalesce(nullif(btrim(p_payload->'parent'->>'phone'), ''), phone)
   where id = p_user;

  -- The parent's own family in this club, or a new guest family.
  select fm.family_id into v_family from public.family_members fm
    join public.families f on f.id = fm.family_id and f.org_id = v_org
   where fm.profile_id = p_user order by fm.is_primary desc limit 1;
  if v_family is null then
    insert into public.families (org_id, name, phone, primary_contact_id, contact_name, contact_email)
    values (v_org,
            coalesce(nullif(btrim(p_payload->'parent'->>'name'), ''), v_email),
            nullif(btrim(p_payload->'parent'->>'phone'), ''), p_user,
            nullif(btrim(p_payload->'parent'->>'name'), ''), v_email)
    returning id into v_family;
    insert into public.family_members (family_id, profile_id, relation, is_primary)
    values (v_family, p_user, 'guardian', true);
    -- Non-member marker. families.membership_status belongs to the
    -- membership / camps migration; set it only when that column exists.
    if exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'families' and column_name = 'membership_status') then
      execute 'update public.families set membership_status = $1 where id = $2' using 'guest', v_family;
    end if;
  end if;

  insert into public.athletes (org_id, family_id, first_name, last_name, dob, status)
  values (v_org, v_family, btrim(p_payload->'child'->>'first_name'), btrim(p_payload->'child'->>'last_name'), v_dob, 'active')
  returning id into v_athlete;

  for v_form in select distinct on (f.key) f.id, f.version from public.consent_forms f
                 where f.org_id = v_org and f.is_active and f.key = any(v_accepted)
                 order by f.key, f.version desc loop
    insert into public.consent_acceptances (org_id, athlete_id, consent_form_id, accepted_version, accepted_by, status, ip_address)
    values (v_org, v_athlete, v_form.id, v_form.version, p_user, 'accepted', v_ip);
  end loop;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, p_user, 'TRAINING_GUEST_SIGNUP', 'families', v_family,
          jsonb_build_object('athlete_id', v_athlete, 'consents', to_jsonb(v_accepted), 'guardian_confirmed', true));

  -- Book as the parent (transaction-local identity), then restore.
  v_prev := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  begin
    v_res := public.book_training(
      v_athlete, (p_payload->>'service_id')::uuid, (p_payload->>'coach_id')::uuid, (p_payload->>'start')::timestamptz,
      v_pay, null, nullif(p_payload->>'package_id', '')::uuid, 'invoice', false, null);
  exception when others then
    perform set_config('request.jwt.claim.sub', coalesce(v_prev, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claim.sub', coalesce(v_prev, ''), true);

  return v_res || jsonb_build_object('family_id', v_family, 'athlete_id', v_athlete, 'org_id', v_org);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.confirm_training_group(uuid, uuid, timestamptz)',
    'public.cancel_training_group(uuid, uuid, timestamptz, text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;

  -- Public catalogue: anonymous visitors of the club's booking page.
  execute 'revoke all on function public.training_public_catalog(text, timestamptz, timestamptz) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.training_public_catalog(text, timestamptz, timestamptz) to anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.training_public_catalog(text, timestamptz, timestamptz) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.training_public_catalog(text, timestamptz, timestamptz) to service_role';
  end if;

  foreach f in array array[
    'public.training_guest_checkout(text, uuid, jsonb)',
    'public.training_refresh_group(uuid, uuid, uuid, timestamptz)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;
end $$;
