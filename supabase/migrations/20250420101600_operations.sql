-- ============================================================================
-- Club OS — Club operations: equipment & kit, facilities, board & committees,
-- sponsors & donations.
--
-- Additive and idempotent. Every table carries org_id, an org index, RLS with
-- a policy per verb, created_at/updated_at, and an audit trigger where it
-- holds personal data. Cross-org references are refused by
-- public.ops_same_org_guard().
--
-- 1. EQUIPMENT (club material, separate from the shop)
--    equipment_items        inventory per location (venue): quantity, condition,
--                           purchase date / value, optional link to an expense
--    equipment_checkouts    check-out / check-in to a coach or a team, due date
--    equipment_maintenance  maintenance notes
--    RPCs equipment_check_out / equipment_check_in (admin; coaches for
--    themselves or their teams), stock-safe under concurrency.
--
-- 2. KIT (per season and team)
--    kit_assignments        player kit: jersey number + size, shorts, warm-up,
--                           status (sizes requested -> handed out -> returned),
--                           optional deposit (invoice line on the family invoice)
--    Jersey numbers are unique per team among kit that is not returned.
--    RPC kit_submit_sizes   guardians send their child's sizes (quick form).
--
-- 3. FACILITIES
--    facility_allocations   recurring weekly court time per venue / space / team
--    facility_rentals       external rentals (renter, contact, price, invoice)
--    venue_closures         close a venue for a date range (holiday,
--                           maintenance, emergency); the app lists and
--                           cancels / moves what is affected and notifies.
--
-- 4. BOARD & COMMITTEES (members of the committee + admins only)
--    committees, committee_members, committee_meetings (agenda, minutes,
--    AGM flag), committee_meeting_attendees, committee_documents,
--    committee_decisions (decisions log / task list), committee_votes.
--
-- 5. SPONSORS & DONATIONS (admin + finance only; hidden from coaches/parents)
--    ops_customers          external customers (renters, sponsors, donors)
--    ops_invoices / ops_invoice_lines / ops_counters   external invoices
--    sponsors, sponsor_deliverables
--    fundraising_campaigns, donations
--    RPCs ops_create_invoice, record_online_donation (service role).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Shared guard: referenced rows must belong to the same org.
--    Trigger arguments are "column=table" pairs.
-- ---------------------------------------------------------------------------
create or replace function public.ops_same_org_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  jsonb := to_jsonb(new);
  v_org  uuid  := (v_row->>'org_id')::uuid;
  v_arg  text;
  v_col  text;
  v_tab  text;
  v_id   uuid;
  v_ok   boolean;
begin
  foreach v_arg in array tg_argv loop
    v_col := split_part(v_arg, '=', 1);
    v_tab := split_part(v_arg, '=', 2);
    v_id := nullif(v_row->>v_col, '')::uuid;
    continue when v_id is null;
    if v_tab not in ('venues', 'venue_spaces', 'teams', 'coaches', 'seasons', 'athletes', 'expenses', 'invoices',
                     'equipment_items', 'equipment_checkouts', 'committees', 'committee_meetings', 'committee_members',
                     'ops_customers', 'ops_invoices', 'sponsors', 'fundraising_campaigns', 'profiles', 'facility_rentals') then
      raise exception 'ops_same_org_guard: unknown table %', v_tab;
    end if;
    execute format('select exists (select 1 from public.%I where id = $1 and org_id = $2)', v_tab)
      into v_ok using v_id, v_org;
    if not v_ok then
      raise exception 'CROSS_ORG_REFERENCE: %', v_col using errcode = 'P0001';
    end if;
  end loop;
  return new;
end;
$$;

-- ===========================================================================
-- 1) EQUIPMENT
-- ===========================================================================
create table if not exists public.equipment_items (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  venue_id          uuid references public.venues(id) on delete set null,
  name              text not null check (char_length(btrim(name)) between 1 and 120),
  category          text not null default 'other'
                      check (category in ('balls', 'cones', 'bibs', 'first_aid', 'camp', 'training', 'electronics', 'other')),
  quantity          integer not null default 1 check (quantity between 0 and 100000),
  condition         text not null default 'good' check (condition in ('new', 'good', 'fair', 'poor', 'broken')),
  purchase_date     date,
  purchase_value    numeric(12,2) check (purchase_value is null or purchase_value >= 0),
  currency          text check (currency is null or currency ~ '^[A-Z]{3}$'),
  expense_id        uuid references public.expenses(id) on delete set null,
  notes             text check (notes is null or char_length(notes) <= 2000),
  is_active         boolean not null default true,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_equipment_items_org on public.equipment_items(org_id, is_active);
create index if not exists idx_equipment_items_venue on public.equipment_items(venue_id);

create table if not exists public.equipment_checkouts (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  item_id            uuid not null references public.equipment_items(id) on delete cascade,
  quantity           integer not null check (quantity between 1 and 100000),
  coach_id           uuid references public.coaches(id) on delete set null,
  team_id            uuid references public.teams(id) on delete set null,
  checked_out_by     uuid references public.profiles(id) on delete set null,
  checked_out_at     timestamptz not null default now(),
  due_on             date,
  returned_at        timestamptz,
  returned_by        uuid references public.profiles(id) on delete set null,
  return_condition   text check (return_condition is null or return_condition in ('new', 'good', 'fair', 'poor', 'broken')),
  notes              text check (notes is null or char_length(notes) <= 1000),
  last_reminded_at   timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint equipment_checkouts_holder_chk check (coach_id is not null or team_id is not null)
);
create index if not exists idx_equipment_checkouts_org on public.equipment_checkouts(org_id);
create index if not exists idx_equipment_checkouts_open on public.equipment_checkouts(item_id) where returned_at is null;
create index if not exists idx_equipment_checkouts_coach on public.equipment_checkouts(coach_id) where returned_at is null;

create table if not exists public.equipment_maintenance (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  item_id       uuid not null references public.equipment_items(id) on delete cascade,
  performed_on  date not null default current_date,
  note          text not null check (char_length(btrim(note)) between 1 and 2000),
  cost          numeric(12,2) check (cost is null or cost >= 0),
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_equipment_maintenance_org on public.equipment_maintenance(org_id);
create index if not exists idx_equipment_maintenance_item on public.equipment_maintenance(item_id, performed_on desc);

-- ===========================================================================
-- 2) KIT
-- ===========================================================================
create table if not exists public.kit_assignments (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  season_id            uuid references public.seasons(id) on delete set null,
  team_id              uuid not null references public.teams(id) on delete cascade,
  athlete_id           uuid not null references public.athletes(id) on delete cascade,
  jersey_number        smallint check (jersey_number is null or jersey_number between 0 and 999),
  jersey_size          text check (jersey_size is null or char_length(jersey_size) <= 12),
  shorts_size          text check (shorts_size is null or char_length(shorts_size) <= 12),
  warmup_size          text check (warmup_size is null or char_length(warmup_size) <= 12),
  include_jersey       boolean not null default true,
  include_shorts       boolean not null default true,
  include_warmup       boolean not null default false,
  status               text not null default 'sizes_requested'
                         check (status in ('sizes_requested', 'sizes_submitted', 'ordered', 'handed_out', 'returned')),
  deposit_amount       numeric(12,2) check (deposit_amount is null or deposit_amount >= 0),
  currency             text check (currency is null or currency ~ '^[A-Z]{3}$'),
  deposit_invoice_id   uuid references public.invoices(id) on delete set null,
  sizes_submitted_by   uuid references public.profiles(id) on delete set null,
  sizes_submitted_at   timestamptz,
  handed_out_at        timestamptz,
  returned_at          timestamptz,
  notes                text check (notes is null or char_length(notes) <= 1000),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (team_id, athlete_id)
);
create index if not exists idx_kit_assignments_org on public.kit_assignments(org_id, season_id);
create index if not exists idx_kit_assignments_athlete on public.kit_assignments(athlete_id);
-- Jersey numbers are unique per team among kit still in use.
create unique index if not exists kit_assignments_jersey_uniq
  on public.kit_assignments(team_id, jersey_number)
  where jersey_number is not null and status <> 'returned';

-- ===========================================================================
-- 3) FACILITIES
-- ===========================================================================
create table if not exists public.facility_allocations (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  venue_id        uuid not null references public.venues(id) on delete cascade,
  venue_space_id  uuid references public.venue_spaces(id) on delete set null,
  team_id         uuid references public.teams(id) on delete cascade,
  label           text check (label is null or char_length(label) <= 120),
  weekday         smallint not null check (weekday between 1 and 7),   -- ISO: 1 = Monday
  start_time      time not null,
  end_time        time not null,
  valid_from      date not null,
  valid_until     date,
  is_active       boolean not null default true,
  notes           text check (notes is null or char_length(notes) <= 1000),
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint facility_allocations_time_chk check (end_time > start_time),
  constraint facility_allocations_dates_chk check (valid_until is null or valid_until >= valid_from),
  constraint facility_allocations_holder_chk check (team_id is not null or label is not null)
);
create index if not exists idx_facility_allocations_org on public.facility_allocations(org_id, venue_id, weekday);

create table if not exists public.ops_customers (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  kind          text not null default 'company' check (kind in ('company', 'person', 'organization')),
  name          text not null check (char_length(btrim(name)) between 1 and 160),
  contact_name  text check (contact_name is null or char_length(contact_name) <= 160),
  email         text check (email is null or (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+$')),
  phone         text check (phone is null or char_length(phone) <= 40),
  street        text check (street is null or char_length(street) <= 160),
  postal_code   text check (postal_code is null or char_length(postal_code) <= 16),
  city          text check (city is null or char_length(city) <= 80),
  country       text check (country is null or country ~ '^[A-Z]{2}$'),
  notes         text check (notes is null or char_length(notes) <= 2000),
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_ops_customers_org on public.ops_customers(org_id, lower(name));
create unique index if not exists ops_customers_email_uniq on public.ops_customers(org_id, lower(email)) where email is not null;

create table if not exists public.ops_invoices (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  customer_id   uuid not null references public.ops_customers(id) on delete restrict,
  number        text not null,
  source        text not null default 'other' check (source in ('rental', 'sponsor', 'donation', 'other')),
  source_id     uuid,
  description   text check (description is null or char_length(description) <= 500),
  currency      text not null check (currency ~ '^[A-Z]{3}$'),
  total         numeric(12,2) not null default 0 check (total >= 0),
  status        text not null default 'issued' check (status in ('draft', 'issued', 'paid', 'cancelled')),
  issued_on     date not null default current_date,
  due_on        date,
  paid_on       date,
  reference     text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, number),
  constraint ops_invoices_paid_chk check (status <> 'paid' or paid_on is not null)
);
create index if not exists idx_ops_invoices_org on public.ops_invoices(org_id, issued_on desc);
create index if not exists idx_ops_invoices_customer on public.ops_invoices(customer_id);

create table if not exists public.ops_invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  invoice_id   uuid not null references public.ops_invoices(id) on delete cascade,
  description  text not null check (char_length(btrim(description)) between 1 and 300),
  quantity     numeric(10,2) not null default 1 check (quantity > 0),
  unit_price   numeric(12,2) not null check (unit_price >= 0),
  amount       numeric(12,2) not null,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_ops_invoice_lines_org on public.ops_invoice_lines(org_id);
create index if not exists idx_ops_invoice_lines_invoice on public.ops_invoice_lines(invoice_id, sort_order);

create table if not exists public.ops_counters (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  kind        text not null check (kind in ('invoice')),
  year        integer not null,
  value       integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (org_id, kind, year)
);

create table if not exists public.facility_rentals (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  venue_id        uuid not null references public.venues(id) on delete cascade,
  venue_space_id  uuid references public.venue_spaces(id) on delete set null,
  customer_id     uuid references public.ops_customers(id) on delete set null,
  renter_name     text not null check (char_length(btrim(renter_name)) between 1 and 160),
  contact_email   text check (contact_email is null or char_length(contact_email) <= 254),
  contact_phone   text check (contact_phone is null or char_length(contact_phone) <= 40),
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  price           numeric(12,2) not null default 0 check (price >= 0),
  currency        text not null check (currency ~ '^[A-Z]{3}$'),
  status          text not null default 'confirmed' check (status in ('tentative', 'confirmed', 'cancelled')),
  invoice_id      uuid references public.ops_invoices(id) on delete set null,
  notes           text check (notes is null or char_length(notes) <= 1000),
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint facility_rentals_time_chk check (ends_at > starts_at and ends_at - starts_at <= interval '3 days')
);
create index if not exists idx_facility_rentals_org on public.facility_rentals(org_id, starts_at);
create index if not exists idx_facility_rentals_venue on public.facility_rentals(venue_id, starts_at);

create table if not exists public.venue_closures (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  venue_id        uuid not null references public.venues(id) on delete cascade,
  venue_space_id  uuid references public.venue_spaces(id) on delete set null,
  starts_on       date not null,
  ends_on         date not null,
  reason          text not null default 'other' check (reason in ('holiday', 'maintenance', 'emergency', 'other')),
  note            text check (note is null or char_length(note) <= 1000),
  applied_at      timestamptz,
  notified_at     timestamptz,
  summary         jsonb,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint venue_closures_dates_chk check (ends_on >= starts_on and ends_on - starts_on <= 366)
);
create index if not exists idx_venue_closures_org on public.venue_closures(org_id, starts_on desc);

-- ===========================================================================
-- 4) BOARD & COMMITTEES
-- ===========================================================================
create table if not exists public.committees (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 120),
  kind         text not null default 'board' check (kind in ('board', 'technical', 'events', 'finance', 'other')),
  description  text check (description is null or char_length(description) <= 2000),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (org_id, name)
);
create index if not exists idx_committees_org on public.committees(org_id);

create table if not exists public.committee_members (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  committee_id  uuid not null references public.committees(id) on delete cascade,
  profile_id    uuid references public.profiles(id) on delete set null,
  display_name  text not null check (char_length(btrim(display_name)) between 1 and 160),
  role          text not null default 'member'
                  check (role in ('chair', 'vice_chair', 'secretary', 'treasurer', 'member', 'advisor')),
  email         text check (email is null or char_length(email) <= 254),
  starts_on     date,
  ends_on       date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint committee_members_dates_chk check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index if not exists idx_committee_members_org on public.committee_members(org_id);
create index if not exists idx_committee_members_profile on public.committee_members(profile_id) where profile_id is not null;
create unique index if not exists committee_members_profile_uniq
  on public.committee_members(committee_id, profile_id) where profile_id is not null;

create table if not exists public.committee_meetings (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  committee_id          uuid not null references public.committees(id) on delete cascade,
  title                 text not null check (char_length(btrim(title)) between 1 and 160),
  kind                  text not null default 'meeting' check (kind in ('meeting', 'agm', 'extraordinary')),
  starts_at             timestamptz not null,
  location              text check (location is null or char_length(location) <= 200),
  status                text not null default 'planned' check (status in ('planned', 'held', 'cancelled')),
  agenda                jsonb not null default '[]'::jsonb check (jsonb_typeof(agenda) = 'array'),
  minutes               text check (minutes is null or char_length(minutes) <= 100000),
  minutes_approved_at   timestamptz,
  invitation_sent_at    timestamptz,
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_committee_meetings_org on public.committee_meetings(org_id, starts_at desc);
create index if not exists idx_committee_meetings_committee on public.committee_meetings(committee_id, starts_at desc);

create table if not exists public.committee_meeting_attendees (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  meeting_id    uuid not null references public.committee_meetings(id) on delete cascade,
  member_id     uuid references public.committee_members(id) on delete set null,
  display_name  text not null check (char_length(btrim(display_name)) between 1 and 160),
  status        text not null default 'present' check (status in ('present', 'absent', 'excused', 'proxy')),
  proxy_for     text check (proxy_for is null or char_length(proxy_for) <= 160),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_committee_attendees_org on public.committee_meeting_attendees(org_id);
create index if not exists idx_committee_attendees_meeting on public.committee_meeting_attendees(meeting_id);

create table if not exists public.committee_documents (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  committee_id  uuid not null references public.committees(id) on delete cascade,
  meeting_id    uuid references public.committee_meetings(id) on delete cascade,
  title         text not null check (char_length(btrim(title)) between 1 and 200),
  url           text not null check (url ~ '^https://' and char_length(url) <= 2000),
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_committee_documents_org on public.committee_documents(org_id);
create index if not exists idx_committee_documents_committee on public.committee_documents(committee_id, meeting_id);

create table if not exists public.committee_decisions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  committee_id    uuid not null references public.committees(id) on delete cascade,
  meeting_id      uuid references public.committee_meetings(id) on delete set null,
  title           text not null check (char_length(btrim(title)) between 1 and 200),
  description     text check (description is null or char_length(description) <= 4000),
  owner_member_id uuid references public.committee_members(id) on delete set null,
  due_on          date,
  status          text not null default 'open' check (status in ('open', 'in_progress', 'done', 'cancelled')),
  decided_on      date not null default current_date,
  completed_at    timestamptz,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_committee_decisions_org on public.committee_decisions(org_id);
create index if not exists idx_committee_decisions_committee on public.committee_decisions(committee_id, status, due_on);

create table if not exists public.committee_votes (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  meeting_id      uuid not null references public.committee_meetings(id) on delete cascade,
  motion          text not null check (char_length(btrim(motion)) between 1 and 500),
  votes_for       integer not null default 0 check (votes_for >= 0),
  votes_against   integer not null default 0 check (votes_against >= 0),
  abstentions     integer not null default 0 check (abstentions >= 0),
  result          text generated always as (
                    case when votes_for > votes_against then 'carried'
                         when votes_for < votes_against then 'rejected'
                         else 'tied' end) stored,
  notes           text check (notes is null or char_length(notes) <= 1000),
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_committee_votes_org on public.committee_votes(org_id);
create index if not exists idx_committee_votes_meeting on public.committee_votes(meeting_id, sort_order);

-- ===========================================================================
-- 5) SPONSORS & DONATIONS
-- ===========================================================================
create table if not exists public.sponsors (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references public.organizations(id) on delete cascade,
  customer_id               uuid not null references public.ops_customers(id) on delete restrict,
  tier                      text not null default 'partner' check (tier in ('platinum', 'gold', 'silver', 'bronze', 'partner', 'supplier')),
  package_name              text check (package_name is null or char_length(package_name) <= 160),
  amount                    numeric(12,2) not null default 0 check (amount >= 0),
  currency                  text not null check (currency ~ '^[A-Z]{3}$'),
  contract_start            date,
  contract_end              date,
  renewal_reminder_days     integer not null default 60 check (renewal_reminder_days between 0 and 365),
  status                    text not null default 'active' check (status in ('prospect', 'active', 'expired', 'cancelled')),
  notes                     text check (notes is null or char_length(notes) <= 2000),
  renewal_reminded_at       timestamptz,
  created_by                uuid references public.profiles(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint sponsors_dates_chk check (contract_end is null or contract_start is null or contract_end >= contract_start)
);
create index if not exists idx_sponsors_org on public.sponsors(org_id, status, contract_end);

create table if not exists public.sponsor_deliverables (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  sponsor_id    uuid not null references public.sponsors(id) on delete cascade,
  kind          text not null default 'other'
                  check (kind in ('jersey_logo', 'banner', 'website', 'social_post', 'event', 'newsletter', 'other')),
  title         text not null check (char_length(btrim(title)) between 1 and 200),
  due_on        date,
  done_at       timestamptz,
  notes         text check (notes is null or char_length(notes) <= 1000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_sponsor_deliverables_org on public.sponsor_deliverables(org_id);
create index if not exists idx_sponsor_deliverables_sponsor on public.sponsor_deliverables(sponsor_id, due_on);

create table if not exists public.fundraising_campaigns (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  slug          text not null check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$'),
  title         text not null check (char_length(btrim(title)) between 1 and 160),
  description   text check (description is null or char_length(description) <= 4000),
  goal_amount   numeric(12,2) not null check (goal_amount > 0),
  currency      text not null check (currency ~ '^[A-Z]{3}$'),
  starts_on     date,
  ends_on       date,
  is_public     boolean not null default false,
  status        text not null default 'draft' check (status in ('draft', 'active', 'closed')),
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, slug),
  constraint fundraising_campaigns_dates_chk check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index if not exists idx_fundraising_campaigns_org on public.fundraising_campaigns(org_id, status);

create table if not exists public.donations (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  campaign_id        uuid references public.fundraising_campaigns(id) on delete set null,
  donor_id           uuid references public.ops_customers(id) on delete set null,
  amount             numeric(12,2) not null check (amount > 0 and amount <= 10000000),
  currency           text not null check (currency ~ '^[A-Z]{3}$'),
  donated_on         date not null default current_date,
  purpose            text check (purpose is null or char_length(purpose) <= 300),
  method             text not null default 'bank_transfer'
                       check (method in ('bank_transfer', 'cash', 'card', 'twint', 'online', 'other')),
  is_anonymous       boolean not null default false,
  status             text not null default 'received' check (status in ('received', 'refunded')),
  stripe_session_id  text unique,
  notes              text check (notes is null or char_length(notes) <= 1000),
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_donations_org on public.donations(org_id, donated_on desc);
create index if not exists idx_donations_campaign on public.donations(campaign_id) where campaign_id is not null;
create index if not exists idx_donations_donor on public.donations(donor_id, donated_on) where donor_id is not null;

-- ===========================================================================
-- Triggers: updated_at, same-org guards, audit (personal data)
-- ===========================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'equipment_items', 'equipment_checkouts', 'equipment_maintenance', 'kit_assignments', 'facility_allocations',
    'ops_customers', 'ops_invoices', 'ops_invoice_lines', 'ops_counters', 'facility_rentals', 'venue_closures',
    'committees', 'committee_members', 'committee_meetings', 'committee_meeting_attendees', 'committee_documents',
    'committee_decisions', 'committee_votes', 'sponsors', 'sponsor_deliverables', 'fundraising_campaigns', 'donations'
  ] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$I', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$I for each row execute function public.set_updated_at()', t);
  end loop;
  -- Audit: personal data and money.
  foreach t in array array[
    'equipment_checkouts', 'kit_assignments', 'ops_customers', 'ops_invoices', 'facility_rentals', 'venue_closures',
    'committee_members', 'committee_meetings', 'committee_decisions', 'committee_votes', 'sponsors', 'donations'
  ] loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$I', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

drop trigger if exists trg_equipment_items_same_org on public.equipment_items;
create trigger trg_equipment_items_same_org before insert or update on public.equipment_items
  for each row execute function public.ops_same_org_guard('venue_id=venues', 'expense_id=expenses');
drop trigger if exists trg_equipment_checkouts_same_org on public.equipment_checkouts;
create trigger trg_equipment_checkouts_same_org before insert or update on public.equipment_checkouts
  for each row execute function public.ops_same_org_guard('item_id=equipment_items', 'coach_id=coaches', 'team_id=teams');
drop trigger if exists trg_equipment_maintenance_same_org on public.equipment_maintenance;
create trigger trg_equipment_maintenance_same_org before insert or update on public.equipment_maintenance
  for each row execute function public.ops_same_org_guard('item_id=equipment_items');
drop trigger if exists trg_kit_assignments_same_org on public.kit_assignments;
create trigger trg_kit_assignments_same_org before insert or update on public.kit_assignments
  for each row execute function public.ops_same_org_guard('season_id=seasons', 'team_id=teams', 'athlete_id=athletes', 'deposit_invoice_id=invoices');
drop trigger if exists trg_facility_allocations_same_org on public.facility_allocations;
create trigger trg_facility_allocations_same_org before insert or update on public.facility_allocations
  for each row execute function public.ops_same_org_guard('venue_id=venues', 'venue_space_id=venue_spaces', 'team_id=teams');
drop trigger if exists trg_ops_invoices_same_org on public.ops_invoices;
create trigger trg_ops_invoices_same_org before insert or update on public.ops_invoices
  for each row execute function public.ops_same_org_guard('customer_id=ops_customers');
drop trigger if exists trg_ops_invoice_lines_same_org on public.ops_invoice_lines;
create trigger trg_ops_invoice_lines_same_org before insert or update on public.ops_invoice_lines
  for each row execute function public.ops_same_org_guard('invoice_id=ops_invoices');
drop trigger if exists trg_facility_rentals_same_org on public.facility_rentals;
create trigger trg_facility_rentals_same_org before insert or update on public.facility_rentals
  for each row execute function public.ops_same_org_guard('venue_id=venues', 'venue_space_id=venue_spaces', 'customer_id=ops_customers', 'invoice_id=ops_invoices');
drop trigger if exists trg_venue_closures_same_org on public.venue_closures;
create trigger trg_venue_closures_same_org before insert or update on public.venue_closures
  for each row execute function public.ops_same_org_guard('venue_id=venues', 'venue_space_id=venue_spaces');
drop trigger if exists trg_committee_members_same_org on public.committee_members;
create trigger trg_committee_members_same_org before insert or update on public.committee_members
  for each row execute function public.ops_same_org_guard('committee_id=committees', 'profile_id=profiles');
drop trigger if exists trg_committee_meetings_same_org on public.committee_meetings;
create trigger trg_committee_meetings_same_org before insert or update on public.committee_meetings
  for each row execute function public.ops_same_org_guard('committee_id=committees');
drop trigger if exists trg_committee_attendees_same_org on public.committee_meeting_attendees;
create trigger trg_committee_attendees_same_org before insert or update on public.committee_meeting_attendees
  for each row execute function public.ops_same_org_guard('meeting_id=committee_meetings', 'member_id=committee_members');
drop trigger if exists trg_committee_documents_same_org on public.committee_documents;
create trigger trg_committee_documents_same_org before insert or update on public.committee_documents
  for each row execute function public.ops_same_org_guard('committee_id=committees', 'meeting_id=committee_meetings');
drop trigger if exists trg_committee_decisions_same_org on public.committee_decisions;
create trigger trg_committee_decisions_same_org before insert or update on public.committee_decisions
  for each row execute function public.ops_same_org_guard('committee_id=committees', 'meeting_id=committee_meetings', 'owner_member_id=committee_members');
drop trigger if exists trg_committee_votes_same_org on public.committee_votes;
create trigger trg_committee_votes_same_org before insert or update on public.committee_votes
  for each row execute function public.ops_same_org_guard('meeting_id=committee_meetings');
drop trigger if exists trg_sponsors_same_org on public.sponsors;
create trigger trg_sponsors_same_org before insert or update on public.sponsors
  for each row execute function public.ops_same_org_guard('customer_id=ops_customers');
drop trigger if exists trg_sponsor_deliverables_same_org on public.sponsor_deliverables;
create trigger trg_sponsor_deliverables_same_org before insert or update on public.sponsor_deliverables
  for each row execute function public.ops_same_org_guard('sponsor_id=sponsors');
drop trigger if exists trg_donations_same_org on public.donations;
create trigger trg_donations_same_org before insert or update on public.donations
  for each row execute function public.ops_same_org_guard('campaign_id=fundraising_campaigns', 'donor_id=ops_customers');

-- A meeting's sub-rows must stay in the meeting's committee.
create or replace function public.committee_child_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_committee uuid;
begin
  if new.meeting_id is not null then
    select committee_id into v_committee from public.committee_meetings where id = new.meeting_id;
    if v_committee is distinct from new.committee_id then
      raise exception 'COMMITTEE_MISMATCH' using errcode = 'P0001';
    end if;
  end if;
  if tg_table_name = 'committee_decisions' then
    if (to_jsonb(new)->>'owner_member_id') is not null and not exists (
         select 1 from public.committee_members m
         where m.id = (to_jsonb(new)->>'owner_member_id')::uuid and m.committee_id = new.committee_id) then
      raise exception 'COMMITTEE_MISMATCH' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_committee_documents_child on public.committee_documents;
create trigger trg_committee_documents_child before insert or update on public.committee_documents
  for each row execute function public.committee_child_guard();
drop trigger if exists trg_committee_decisions_child on public.committee_decisions;
create trigger trg_committee_decisions_child before insert or update on public.committee_decisions
  for each row execute function public.committee_child_guard();

-- Venue spaces must belong to the chosen venue.
create or replace function public.ops_space_in_venue_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.venue_space_id is not null
     and not exists (select 1 from public.venue_spaces s where s.id = new.venue_space_id and s.venue_id = new.venue_id) then
    raise exception 'SPACE_NOT_IN_VENUE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_facility_allocations_space on public.facility_allocations;
create trigger trg_facility_allocations_space before insert or update on public.facility_allocations
  for each row execute function public.ops_space_in_venue_guard();
drop trigger if exists trg_facility_rentals_space on public.facility_rentals;
create trigger trg_facility_rentals_space before insert or update on public.facility_rentals
  for each row execute function public.ops_space_in_venue_guard();
drop trigger if exists trg_venue_closures_space on public.venue_closures;
create trigger trg_venue_closures_space before insert or update on public.venue_closures
  for each row execute function public.ops_space_in_venue_guard();

-- ===========================================================================
-- RLS helpers
-- ===========================================================================
-- Current (not ended) member of a committee of the caller's org.
create or replace function public.is_committee_member(p_committee uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.committee_members m
    join public.committees c on c.id = m.committee_id
    where m.committee_id = p_committee
      and m.profile_id = auth.uid()
      and c.org_id = public.current_org_id()
      and (m.starts_on is null or m.starts_on <= current_date)
      and (m.ends_on is null or m.ends_on >= current_date)
  );
$$;

create or replace function public.can_access_committee(p_committee uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (public.is_admin() and exists (select 1 from public.committees c where c.id = p_committee and c.org_id = public.current_org_id()))
      or public.is_committee_member(p_committee);
$$;

create or replace function public.can_access_meeting(p_meeting uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_access_committee((select committee_id from public.committee_meetings where id = p_meeting));
$$;

-- Does the signed-in user sit on any committee? (nav visibility)
create or replace function public.is_any_committee_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.committee_members m join public.committees c on c.id = m.committee_id
    where m.profile_id = auth.uid() and c.org_id = public.current_org_id() and c.is_active
      and (m.ends_on is null or m.ends_on >= current_date)
  );
$$;

-- Coach holds this checkout (personally or as a coach of the team).
create or replace function public.coach_holds_checkout(p_coach uuid, p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_coach_id() is not null
     and ((p_coach is not null and p_coach = public.current_coach_id()) or public.coach_coaches_team(p_team));
$$;

revoke all on function public.is_committee_member(uuid), public.can_access_committee(uuid), public.can_access_meeting(uuid),
  public.is_any_committee_member(), public.coach_holds_checkout(uuid, uuid) from public;
grant execute on function public.is_committee_member(uuid), public.can_access_committee(uuid), public.can_access_meeting(uuid),
  public.is_any_committee_member(), public.coach_holds_checkout(uuid, uuid) to authenticated, service_role;

-- ===========================================================================
-- RLS policies
-- ===========================================================================
alter table public.equipment_items enable row level security;
alter table public.equipment_checkouts enable row level security;
alter table public.equipment_maintenance enable row level security;
alter table public.kit_assignments enable row level security;
alter table public.facility_allocations enable row level security;
alter table public.ops_customers enable row level security;
alter table public.ops_invoices enable row level security;
alter table public.ops_invoice_lines enable row level security;
alter table public.ops_counters enable row level security;
alter table public.facility_rentals enable row level security;
alter table public.venue_closures enable row level security;
alter table public.committees enable row level security;
alter table public.committee_members enable row level security;
alter table public.committee_meetings enable row level security;
alter table public.committee_meeting_attendees enable row level security;
alter table public.committee_documents enable row level security;
alter table public.committee_decisions enable row level security;
alter table public.committee_votes enable row level security;
alter table public.sponsors enable row level security;
alter table public.sponsor_deliverables enable row level security;
alter table public.fundraising_campaigns enable row level security;
alter table public.donations enable row level security;

-- ---- Staff-readable, admin-written (equipment catalogue, allocations, closures)
do $$
declare
  t text;
begin
  foreach t in array array['equipment_items', 'equipment_maintenance', 'facility_allocations', 'venue_closures'] loop
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format($p$create policy %1$s_select on public.%1$I for select
      using (org_id = public.current_org_id() and (public.is_finance() or public.has_role('coach')))$p$, t);
    execute format('drop policy if exists %1$s_insert on public.%1$I', t);
    execute format($p$create policy %1$s_insert on public.%1$I for insert
      with check (org_id = public.current_org_id() and public.is_admin())$p$, t);
    execute format('drop policy if exists %1$s_update on public.%1$I', t);
    execute format($p$create policy %1$s_update on public.%1$I for update
      using (org_id = public.current_org_id() and public.is_admin())
      with check (org_id = public.current_org_id() and public.is_admin())$p$, t);
    execute format('drop policy if exists %1$s_delete on public.%1$I', t);
    execute format($p$create policy %1$s_delete on public.%1$I for delete
      using (org_id = public.current_org_id() and public.is_admin())$p$, t);
  end loop;
end $$;

-- ---- Money and external contacts: admin + finance only (never coaches/parents)
do $$
declare
  t text;
begin
  foreach t in array array['ops_customers', 'ops_invoices', 'ops_invoice_lines', 'facility_rentals', 'sponsors',
                           'sponsor_deliverables', 'fundraising_campaigns', 'donations'] loop
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format($p$create policy %1$s_select on public.%1$I for select
      using (org_id = public.current_org_id() and public.is_finance())$p$, t);
    execute format('drop policy if exists %1$s_insert on public.%1$I', t);
    execute format($p$create policy %1$s_insert on public.%1$I for insert
      with check (org_id = public.current_org_id() and public.is_finance())$p$, t);
    execute format('drop policy if exists %1$s_update on public.%1$I', t);
    execute format($p$create policy %1$s_update on public.%1$I for update
      using (org_id = public.current_org_id() and public.is_finance())
      with check (org_id = public.current_org_id() and public.is_finance())$p$, t);
    execute format('drop policy if exists %1$s_delete on public.%1$I', t);
    execute format($p$create policy %1$s_delete on public.%1$I for delete
      using (org_id = public.current_org_id() and public.is_admin())$p$, t);
  end loop;
end $$;
-- Issued invoices are never hard-deleted (cancel instead); lines follow their invoice.
drop policy if exists ops_invoices_delete on public.ops_invoices;
create policy ops_invoices_delete on public.ops_invoices for delete using (false);
drop policy if exists ops_invoice_lines_delete on public.ops_invoice_lines;
create policy ops_invoice_lines_delete on public.ops_invoice_lines for delete using (false);
drop policy if exists ops_invoice_lines_update on public.ops_invoice_lines;
create policy ops_invoice_lines_update on public.ops_invoice_lines for update using (false);
drop policy if exists ops_invoice_lines_insert on public.ops_invoice_lines;
create policy ops_invoice_lines_insert on public.ops_invoice_lines for insert with check (false);
-- Counters: only through ops_create_invoice (security definer).
drop policy if exists ops_counters_all on public.ops_counters;
create policy ops_counters_all on public.ops_counters for all using (false) with check (false);

-- ---- Equipment check-outs: admin manages; coaches read what they hold
drop policy if exists equipment_checkouts_select on public.equipment_checkouts;
create policy equipment_checkouts_select on public.equipment_checkouts for select
  using (org_id = public.current_org_id() and (public.is_finance() or public.coach_holds_checkout(coach_id, team_id)));
drop policy if exists equipment_checkouts_insert on public.equipment_checkouts;
create policy equipment_checkouts_insert on public.equipment_checkouts for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists equipment_checkouts_update on public.equipment_checkouts;
create policy equipment_checkouts_update on public.equipment_checkouts for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists equipment_checkouts_delete on public.equipment_checkouts;
create policy equipment_checkouts_delete on public.equipment_checkouts for delete
  using (org_id = public.current_org_id() and public.is_admin());

-- ---- Kit: admin manages; coaches of the team and the child's guardians read
drop policy if exists kit_assignments_select on public.kit_assignments;
create policy kit_assignments_select on public.kit_assignments for select
  using (org_id = public.current_org_id()
         and (public.is_admin() or public.coach_coaches_team(team_id) or public.is_guardian_of_athlete(athlete_id)));
drop policy if exists kit_assignments_insert on public.kit_assignments;
create policy kit_assignments_insert on public.kit_assignments for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists kit_assignments_update on public.kit_assignments;
create policy kit_assignments_update on public.kit_assignments for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists kit_assignments_delete on public.kit_assignments;
create policy kit_assignments_delete on public.kit_assignments for delete
  using (org_id = public.current_org_id() and public.is_admin());

-- ---- Committees: members of the committee + admins only
drop policy if exists committees_select on public.committees;
create policy committees_select on public.committees for select
  using (org_id = public.current_org_id() and (public.is_admin() or public.is_committee_member(id)));
drop policy if exists committees_insert on public.committees;
create policy committees_insert on public.committees for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists committees_update on public.committees;
create policy committees_update on public.committees for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists committees_delete on public.committees;
create policy committees_delete on public.committees for delete
  using (org_id = public.current_org_id() and public.is_admin());

drop policy if exists committee_members_select on public.committee_members;
create policy committee_members_select on public.committee_members for select
  using (org_id = public.current_org_id() and public.can_access_committee(committee_id));
drop policy if exists committee_members_insert on public.committee_members;
create policy committee_members_insert on public.committee_members for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists committee_members_update on public.committee_members;
create policy committee_members_update on public.committee_members for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists committee_members_delete on public.committee_members;
create policy committee_members_delete on public.committee_members for delete
  using (org_id = public.current_org_id() and public.is_admin());

do $$
declare
  t text;
begin
  -- Rows keyed by committee_id: members of that committee read and write.
  foreach t in array array['committee_meetings', 'committee_documents', 'committee_decisions'] loop
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format($p$create policy %1$s_select on public.%1$I for select
      using (org_id = public.current_org_id() and public.can_access_committee(committee_id))$p$, t);
    execute format('drop policy if exists %1$s_insert on public.%1$I', t);
    execute format($p$create policy %1$s_insert on public.%1$I for insert
      with check (org_id = public.current_org_id() and public.can_access_committee(committee_id))$p$, t);
    execute format('drop policy if exists %1$s_update on public.%1$I', t);
    execute format($p$create policy %1$s_update on public.%1$I for update
      using (org_id = public.current_org_id() and public.can_access_committee(committee_id))
      with check (org_id = public.current_org_id() and public.can_access_committee(committee_id))$p$, t);
    execute format('drop policy if exists %1$s_delete on public.%1$I', t);
    execute format($p$create policy %1$s_delete on public.%1$I for delete
      using (org_id = public.current_org_id() and public.can_access_committee(committee_id))$p$, t);
  end loop;
  -- Rows keyed by meeting_id.
  foreach t in array array['committee_meeting_attendees', 'committee_votes'] loop
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format($p$create policy %1$s_select on public.%1$I for select
      using (org_id = public.current_org_id() and public.can_access_meeting(meeting_id))$p$, t);
    execute format('drop policy if exists %1$s_insert on public.%1$I', t);
    execute format($p$create policy %1$s_insert on public.%1$I for insert
      with check (org_id = public.current_org_id() and public.can_access_meeting(meeting_id))$p$, t);
    execute format('drop policy if exists %1$s_update on public.%1$I', t);
    execute format($p$create policy %1$s_update on public.%1$I for update
      using (org_id = public.current_org_id() and public.can_access_meeting(meeting_id))
      with check (org_id = public.current_org_id() and public.can_access_meeting(meeting_id))$p$, t);
    execute format('drop policy if exists %1$s_delete on public.%1$I', t);
    execute format($p$create policy %1$s_delete on public.%1$I for delete
      using (org_id = public.current_org_id() and public.can_access_meeting(meeting_id))$p$, t);
  end loop;
end $$;

grant select, insert, update, delete on
  public.equipment_items, public.equipment_checkouts, public.equipment_maintenance, public.kit_assignments,
  public.facility_allocations, public.ops_customers, public.ops_invoices, public.ops_invoice_lines,
  public.facility_rentals, public.venue_closures, public.committees, public.committee_members, public.committee_meetings,
  public.committee_meeting_attendees, public.committee_documents, public.committee_decisions, public.committee_votes,
  public.sponsors, public.sponsor_deliverables, public.fundraising_campaigns, public.donations
  to authenticated;
grant all on
  public.equipment_items, public.equipment_checkouts, public.equipment_maintenance, public.kit_assignments,
  public.facility_allocations, public.ops_customers, public.ops_invoices, public.ops_invoice_lines, public.ops_counters,
  public.facility_rentals, public.venue_closures, public.committees, public.committee_members, public.committee_meetings,
  public.committee_meeting_attendees, public.committee_documents, public.committee_decisions, public.committee_votes,
  public.sponsors, public.sponsor_deliverables, public.fundraising_campaigns, public.donations
  to service_role;

-- ===========================================================================
-- RPCs
-- ===========================================================================

-- Check out equipment to a coach or a team. Admins: anyone of the org.
-- Coaches: themselves or a team they coach. Refuses more than is available.
create or replace function public.equipment_check_out(
  p_item uuid, p_quantity integer, p_coach uuid, p_team uuid, p_due_on date, p_notes text
) returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org      uuid := public.current_org_id();
  v_admin    boolean := public.is_admin();
  v_me_coach uuid := public.current_coach_id();
  v_item     public.equipment_items%rowtype;
  v_out      integer;
  v_coach    uuid := p_coach;
  v_id       uuid;
begin
  if auth.uid() is null or v_org is null or not (v_admin or public.has_role('coach')) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if coalesce(p_quantity, 0) < 1 then raise exception 'INVALID_QUANTITY' using errcode = 'P0001'; end if;
  if not v_admin then
    if v_me_coach is null then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
    if v_coach is null and p_team is null then v_coach := v_me_coach; end if;
    if v_coach is not null and v_coach <> v_me_coach then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
    if p_team is not null and not public.coach_coaches_team(p_team) then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  elsif v_coach is null and p_team is null then
    raise exception 'HOLDER_REQUIRED' using errcode = 'P0001';
  end if;
  select * into v_item from public.equipment_items where id = p_item and org_id = v_org for update;
  if not found or not v_item.is_active then raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001'; end if;
  select coalesce(sum(quantity), 0) into v_out from public.equipment_checkouts where item_id = p_item and returned_at is null;
  if v_out + p_quantity > v_item.quantity then raise exception 'NOT_ENOUGH_STOCK' using errcode = 'P0001'; end if;
  if p_due_on is not null and p_due_on < current_date then raise exception 'INVALID_DUE_DATE' using errcode = 'P0001'; end if;
  insert into public.equipment_checkouts (org_id, item_id, quantity, coach_id, team_id, checked_out_by, due_on, notes)
  values (v_org, p_item, p_quantity, v_coach, p_team, auth.uid(), p_due_on, nullif(btrim(coalesce(p_notes, '')), ''))
  returning id into v_id;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, auth.uid(), 'equipment.check_out', 'equipment_checkouts', v_id,
          jsonb_build_object('item_id', p_item, 'quantity', p_quantity, 'coach_id', v_coach, 'team_id', p_team, 'due_on', p_due_on));
  return v_id;
end;
$$;

-- Check in (return) a checkout. Admins, or the coach who holds it.
create or replace function public.equipment_check_in(p_checkout uuid, p_condition text, p_notes text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_row public.equipment_checkouts%rowtype;
begin
  if auth.uid() is null or v_org is null then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into v_row from public.equipment_checkouts where id = p_checkout and org_id = v_org for update;
  if not found then raise exception 'CHECKOUT_NOT_FOUND' using errcode = 'P0001'; end if;
  if not (public.is_admin() or public.coach_holds_checkout(v_row.coach_id, v_row.team_id)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if v_row.returned_at is not null then raise exception 'ALREADY_RETURNED' using errcode = 'P0001'; end if;
  if p_condition is not null and p_condition not in ('new', 'good', 'fair', 'poor', 'broken') then
    raise exception 'INVALID_CONDITION' using errcode = 'P0001';
  end if;
  update public.equipment_checkouts
     set returned_at = now(), returned_by = auth.uid(), return_condition = p_condition,
         notes = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), notes)
   where id = p_checkout;
  if p_condition in ('poor', 'broken') then
    update public.equipment_items set condition = p_condition where id = v_row.item_id and org_id = v_org;
  end if;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, auth.uid(), 'equipment.check_in', 'equipment_checkouts', p_checkout,
          jsonb_build_object('item_id', v_row.item_id, 'condition', p_condition));
end;
$$;

-- Guardians send their child's kit sizes (quick form). Allowed while the
-- kit is not yet ordered / handed out.
create or replace function public.kit_submit_sizes(p_assignment uuid, p_jersey text, p_shorts text, p_warmup text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_row public.kit_assignments%rowtype;
  v_clean text := '^[A-Za-z0-9 /.-]{1,12}$';
begin
  if auth.uid() is null or v_org is null then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into v_row from public.kit_assignments where id = p_assignment and org_id = v_org for update;
  if not found or not (public.is_guardian_of_athlete(v_row.athlete_id) or public.is_admin()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if v_row.status not in ('sizes_requested', 'sizes_submitted') then raise exception 'KIT_LOCKED' using errcode = 'P0001'; end if;
  if (v_row.include_jersey and coalesce(p_jersey, '') !~ v_clean)
     or (v_row.include_shorts and coalesce(p_shorts, '') !~ v_clean)
     or (v_row.include_warmup and coalesce(p_warmup, '') !~ v_clean) then
    raise exception 'INVALID_SIZE' using errcode = 'P0001';
  end if;
  update public.kit_assignments
     set jersey_size = case when include_jersey then btrim(p_jersey) end,
         shorts_size = case when include_shorts then btrim(p_shorts) end,
         warmup_size = case when include_warmup then btrim(p_warmup) end,
         status = 'sizes_submitted', sizes_submitted_by = auth.uid(), sizes_submitted_at = now()
   where id = p_assignment;
end;
$$;

-- External invoice with lines and a per-org yearly number (EXT-YYYY-####).
create or replace function public.ops_create_invoice(
  p_customer uuid, p_source text, p_source_id uuid, p_description text, p_currency text, p_due_on date, p_lines jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org    uuid := public.current_org_id();
  v_year   integer := extract(year from current_date)::int;
  v_n      integer;
  v_number text;
  v_id     uuid;
  v_line   jsonb;
  v_qty    numeric;
  v_price  numeric;
  v_total  numeric := 0;
  v_i      integer := 0;
  v_cur    text := upper(btrim(coalesce(p_currency, '')));
begin
  if auth.uid() is null or v_org is null or not public.is_finance() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.ops_customers where id = p_customer and org_id = v_org) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_cur !~ '^[A-Z]{3}$' then raise exception 'INVALID_CURRENCY' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 50 then
    raise exception 'INVALID_LINES' using errcode = 'P0001';
  end if;
  insert into public.ops_counters (org_id, kind, year, value) values (v_org, 'invoice', v_year, 1)
  on conflict (org_id, kind, year) do update set value = public.ops_counters.value + 1
  returning value into v_n;
  v_number := 'EXT-' || v_year || '-' || lpad(v_n::text, 4, '0');
  insert into public.ops_invoices (org_id, customer_id, number, source, source_id, description, currency, status, due_on, created_by)
  values (v_org, p_customer, v_number, coalesce(p_source, 'other'), p_source_id, nullif(btrim(coalesce(p_description, '')), ''),
          v_cur, 'issued', p_due_on, auth.uid())
  returning id into v_id;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := coalesce((v_line->>'quantity')::numeric, 1);
    v_price := coalesce((v_line->>'unit_price')::numeric, 0);
    if v_qty <= 0 or v_price < 0 then raise exception 'INVALID_LINES' using errcode = 'P0001'; end if;
    insert into public.ops_invoice_lines (org_id, invoice_id, description, quantity, unit_price, amount, sort_order)
    values (v_org, v_id, left(coalesce(nullif(btrim(v_line->>'description'), ''), '-'), 300), v_qty, v_price, round(v_qty * v_price, 2), v_i);
    v_total := v_total + round(v_qty * v_price, 2);
    v_i := v_i + 1;
  end loop;
  update public.ops_invoices set total = v_total where id = v_id;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, auth.uid(), 'ops_invoice.create', 'ops_invoices', v_id,
          jsonb_build_object('number', v_number, 'total', v_total, 'currency', v_cur, 'source', p_source));
  return jsonb_build_object('id', v_id, 'number', v_number, 'total', v_total);
end;
$$;

-- Online donation from a Stripe Checkout session (webhook, service role).
-- Idempotent on the session id; the donor is found (or created) by email.
create or replace function public.record_online_donation(
  p_org uuid, p_campaign uuid, p_session_id text, p_amount numeric, p_currency text,
  p_name text, p_email text, p_anonymous boolean
) returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_donor uuid;
  v_id    uuid;
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
begin
  if p_campaign is not null and not exists (select 1 from public.fundraising_campaigns where id = p_campaign and org_id = p_org) then
    raise exception 'CAMPAIGN_NOT_FOUND' using errcode = 'P0001';
  end if;
  select id into v_id from public.donations where stripe_session_id = p_session_id;
  if v_id is not null then return v_id; end if;
  if v_email is not null and v_email ~ '^[^@\s]+@[^@\s]+$' then
    select id into v_donor from public.ops_customers where org_id = p_org and lower(email) = v_email;
    if v_donor is null then
      insert into public.ops_customers (org_id, kind, name, email)
      values (p_org, 'person', left(coalesce(nullif(btrim(p_name), ''), v_email), 160), v_email)
      returning id into v_donor;
    end if;
  end if;
  insert into public.donations (org_id, campaign_id, donor_id, amount, currency, method, is_anonymous, stripe_session_id)
  values (p_org, p_campaign, v_donor, round(p_amount, 2), upper(p_currency), 'online', coalesce(p_anonymous, false), p_session_id)
  on conflict (stripe_session_id) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.equipment_check_out(uuid, integer, uuid, uuid, date, text) from public, anon;
revoke all on function public.equipment_check_in(uuid, text, text) from public, anon;
revoke all on function public.kit_submit_sizes(uuid, text, text, text) from public, anon;
revoke all on function public.ops_create_invoice(uuid, text, uuid, text, text, date, jsonb) from public, anon;
revoke all on function public.record_online_donation(uuid, uuid, text, numeric, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.equipment_check_out(uuid, integer, uuid, uuid, date, text) to authenticated, service_role;
grant execute on function public.equipment_check_in(uuid, text, text) to authenticated, service_role;
grant execute on function public.kit_submit_sizes(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.ops_create_invoice(uuid, text, uuid, text, text, date, jsonb) to authenticated, service_role;
grant execute on function public.record_online_donation(uuid, uuid, text, numeric, text, text, text, boolean) to service_role;
