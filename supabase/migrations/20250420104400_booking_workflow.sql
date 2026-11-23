-- ============================================================================
-- Booking workflow (phase A): athlete onboarding from the booking form,
-- training sessions on the calendar, booking lifecycle, invoicing from the
-- booking, payer (Bill To) records, booking notifications.
--
-- Contract: docs/booking-workflow.md. Tests: tests/db/booking_workflow.sql.
--
-- Additive and idempotent:
--   * new tables: training_service_coaches, billing_payers, training_sessions,
--     training_booking_entitlements, booking_requests, booking_notifications
--     (org_id + index, RLS forced, policies for every verb, updated_at, audit)
--   * new columns on training_services, training_bookings, invoices, events
--   * team_attendance_sheets.team_id becomes nullable (session sheets)
--   * create or replace of the attendance helpers that must know about
--     session events (sheet roster = confirmed bookings of the session)
--   * data steps: eligible coaches from coaches.serves, service kind from
--     session_type, review flags for services without coaches / billing setup
-- No booking, invoice or payment is changed by this migration.
-- ============================================================================

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- 0. Small helpers
-- ---------------------------------------------------------------------------
-- Case- and accent-insensitive comparison key ("Müller" = "muller", "José" =
-- "jose"). Portable: no unaccent / pg_trgm dependency.
create or replace function public.bk_norm(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(btrim(regexp_replace(lower(translate(coalesce(p, ''),
    'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÝýÿŠšŽžŒœÆæß''’-.',
    'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOOooooooUUUUuuuuYyySsZzOoAas    ')), '\s+', ' ', 'g')), '');
$$;

-- Booking staff: admin and finance (same rule as athletes_admin_write).
create or replace function public.bk_is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_org_id() is not null and public.is_finance();
$$;

-- ---------------------------------------------------------------------------
-- 1. Service catalogue
-- ---------------------------------------------------------------------------
alter table public.training_services add column if not exists billing_category text not null default 'training';
alter table public.training_services add column if not exists kind text not null default 'private';
alter table public.training_services add column if not exists default_venue_space_id uuid references public.venue_spaces(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'training_services_kind_chk') then
    alter table public.training_services add constraint training_services_kind_chk
      check (kind in ('private', 'group', 'trial', 'package'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'training_services_billing_category_chk') then
    alter table public.training_services add constraint training_services_billing_category_chk
      check (public.is_billing_activity(billing_category) and billing_category <> 'other');
  end if;
end $$;

-- A group service is a group; everything else keeps 'private' (backfill once).
update public.training_services set kind = 'group' where session_type = 'group' and kind = 'private';

create or replace function public.training_services_bk_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.default_venue_space_id is not null then
    if not exists (select 1 from public.venue_spaces vs where vs.id = new.default_venue_space_id and vs.org_id = new.org_id) then
      raise exception 'CROSS_ORG_REFERENCE: default_venue_space_id' using errcode = 'P0001';
    end if;
    if new.venue_id is null then
      new.venue_id := (select venue_id from public.venue_spaces where id = new.default_venue_space_id);
    end if;
  end if;
  -- kind and session_type agree: a group is the only multi-participant kind.
  if new.kind = 'group' and new.session_type <> 'group' then new.session_type := 'group'; end if;
  if new.kind <> 'group' and tg_op = 'UPDATE' and new.kind is distinct from old.kind and new.session_type = 'group' then
    new.session_type := 'individual';
    new.max_participants := 1;
    new.min_participants := 1;
  end if;
  return new;
end $$;

drop trigger if exists trg_training_services_bk_guard on public.training_services;
create trigger trg_training_services_bk_guard
  before insert or update of kind, session_type, default_venue_space_id, venue_id on public.training_services
  for each row execute function public.training_services_bk_guard();

-- Eligible coaches per service. coaches.serves (slug list) stays valid for
-- the legacy parent booking flow; eligibility = a row here OR the slug.
create table if not exists public.training_service_coaches (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  service_id  uuid not null references public.training_services(id) on delete cascade,
  coach_id    uuid not null references public.coaches(id) on delete cascade,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (service_id, coach_id)
);
create index if not exists idx_training_service_coaches_org on public.training_service_coaches (org_id);
create index if not exists idx_training_service_coaches_coach on public.training_service_coaches (coach_id);
alter table public.training_service_coaches enable row level security;
alter table public.training_service_coaches force row level security;

drop policy if exists training_service_coaches_select on public.training_service_coaches;
create policy training_service_coaches_select on public.training_service_coaches for select
  using (org_id = public.current_org_id());
drop policy if exists training_service_coaches_insert on public.training_service_coaches;
create policy training_service_coaches_insert on public.training_service_coaches for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists training_service_coaches_update on public.training_service_coaches;
create policy training_service_coaches_update on public.training_service_coaches for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists training_service_coaches_delete on public.training_service_coaches;
create policy training_service_coaches_delete on public.training_service_coaches for delete
  using (org_id = public.current_org_id() and public.is_admin());

drop trigger if exists trg_training_service_coaches_org on public.training_service_coaches;
create trigger trg_training_service_coaches_org before insert or update on public.training_service_coaches
  for each row execute function public.ca_same_org_guard('service_id:training_services', 'coach_id:coaches');
drop trigger if exists trg_training_service_coaches_updated on public.training_service_coaches;
create trigger trg_training_service_coaches_updated before update on public.training_service_coaches
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_training_service_coaches on public.training_service_coaches;
create trigger trg_audit_training_service_coaches after insert or update or delete on public.training_service_coaches
  for each row execute function public.audit_trigger();

-- Backfill from the slug lists (idempotent).
insert into public.training_service_coaches (org_id, service_id, coach_id)
select s.org_id, s.id, c.id
  from public.training_services s
  join public.coaches c on c.org_id = s.org_id and s.slug = any(c.serves)
on conflict (service_id, coach_id) do nothing;

create or replace function public.bk_coach_eligible(p_service uuid, p_coach uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- The service's coach list is authoritative once it has rows; a service
  -- without rows falls back to the legacy slug lists (coaches.serves).
  select case
    when exists (select 1 from public.training_service_coaches x where x.service_id = p_service)
      then exists (select 1 from public.training_service_coaches x where x.service_id = p_service and x.coach_id = p_coach)
    else exists (select 1 from public.coaches c join public.training_services s on s.id = p_service and s.org_id = c.org_id
                  where c.id = p_coach and s.slug = any(c.serves))
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Payers (Bill To)
-- ---------------------------------------------------------------------------
create table if not exists public.billing_payers (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  kind         text not null,
  profile_id   uuid references public.profiles(id) on delete set null,
  family_id    uuid references public.families(id) on delete set null,
  athlete_id   uuid references public.athletes(id) on delete set null,
  name         text not null,
  email        citext,
  phone        text,
  street       text,
  postal_code  text,
  city         text,
  country      text,
  notes        text,
  is_active    boolean not null default true,
  request_id   uuid,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint billing_payers_kind_chk check (kind in ('athlete', 'guardian', 'sponsor', 'other')),
  constraint billing_payers_name_chk check (length(btrim(name)) between 1 and 140),
  constraint billing_payers_email_chk check (email is null or (length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  constraint billing_payers_phone_chk check (phone is null or length(phone) <= 40),
  constraint billing_payers_street_chk check (street is null or length(street) <= 140),
  constraint billing_payers_postal_chk check (postal_code is null or length(postal_code) <= 16),
  constraint billing_payers_city_chk check (city is null or length(city) <= 80),
  constraint billing_payers_country_chk check (country is null or country ~ '^[A-Z]{2}$'),
  constraint billing_payers_notes_chk check (notes is null or length(notes) <= 1000)
);
create index if not exists idx_billing_payers_org on public.billing_payers (org_id);
create index if not exists idx_billing_payers_family on public.billing_payers (family_id) where family_id is not null;
create index if not exists idx_billing_payers_profile on public.billing_payers (profile_id) where profile_id is not null;
create index if not exists idx_billing_payers_email on public.billing_payers (org_id, lower(email::text)) where email is not null;
create unique index if not exists billing_payers_request_uidx on public.billing_payers (org_id, request_id) where request_id is not null;
alter table public.billing_payers enable row level security;
alter table public.billing_payers force row level security;

-- Finance (admin + finance) manage payers; a payer with a login reads only
-- their own row. Coaches never read payers. Writes go through the RPCs, but
-- finance may also correct a row directly (same checks).
drop policy if exists billing_payers_select on public.billing_payers;
create policy billing_payers_select on public.billing_payers for select
  using (org_id = public.current_org_id() and (public.is_finance() or (profile_id is not null and profile_id = auth.uid())));
drop policy if exists billing_payers_insert on public.billing_payers;
create policy billing_payers_insert on public.billing_payers for insert
  with check (org_id = public.current_org_id() and public.is_finance());
drop policy if exists billing_payers_update on public.billing_payers;
create policy billing_payers_update on public.billing_payers for update
  using (org_id = public.current_org_id() and public.is_finance())
  with check (org_id = public.current_org_id() and public.is_finance());
drop policy if exists billing_payers_delete on public.billing_payers;
create policy billing_payers_delete on public.billing_payers for delete
  using (org_id = public.current_org_id() and public.is_admin());

drop trigger if exists trg_billing_payers_org on public.billing_payers;
create trigger trg_billing_payers_org before insert or update on public.billing_payers
  for each row execute function public.ca_same_org_guard('profile_id:profiles', 'family_id:families', 'athlete_id:athletes');
drop trigger if exists trg_billing_payers_updated on public.billing_payers;
create trigger trg_billing_payers_updated before update on public.billing_payers
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_billing_payers on public.billing_payers;
create trigger trg_audit_billing_payers after insert or update or delete on public.billing_payers
  for each row execute function public.ca_audit_trigger('email', 'phone', 'street', 'notes');

-- Invoice payer snapshot (existing payer_name / payer_kind / payer_profile_id
-- from the billing foundation, plus the payer record, e-mail and address).
alter table public.invoices add column if not exists payer_id uuid references public.billing_payers(id) on delete set null;
alter table public.invoices add column if not exists payer_email text;
alter table public.invoices add column if not exists payer_address jsonb;
create index if not exists idx_invoices_payer_record on public.invoices (payer_id) where payer_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Sessions (one calendar event each)
-- ---------------------------------------------------------------------------
create table if not exists public.training_sessions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  service_id      uuid not null references public.training_services(id) on delete restrict,
  coach_id        uuid not null references public.coaches(id) on delete restrict,
  venue_id        uuid references public.venues(id) on delete set null,
  venue_space_id  uuid references public.venue_spaces(id) on delete set null,
  location_text   text,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  capacity        integer not null default 1,
  is_exclusive    boolean not null default true,
  status          text not null default 'scheduled',
  event_id        uuid unique references public.events(id) on delete set null,
  rescheduled_from timestamptz,
  cancel_reason   text,
  cancelled_at    timestamptz,
  cancelled_by    uuid references public.profiles(id) on delete set null,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint training_sessions_time_chk check (ends_at > starts_at and ends_at - starts_at <= interval '24 hours'),
  constraint training_sessions_capacity_chk check (capacity between 1 and 100),
  constraint training_sessions_status_chk check (status in ('scheduled', 'cancelled', 'completed')),
  constraint training_sessions_location_chk check (location_text is null or length(location_text) <= 300),
  constraint training_sessions_reason_chk check (cancel_reason is null or length(cancel_reason) <= 500),
  constraint training_sessions_space_venue_chk check (venue_space_id is null or venue_id is not null)
);
create index if not exists idx_training_sessions_org on public.training_sessions (org_id, starts_at);
create index if not exists idx_training_sessions_coach on public.training_sessions (coach_id, starts_at);
create index if not exists idx_training_sessions_service on public.training_sessions (service_id, starts_at);

do $$
begin
  -- A coach cannot lead two overlapping scheduled sessions; a venue space
  -- cannot host two overlapping exclusive sessions (team events in the same
  -- space are already refused by events_space_no_overlap).
  if not exists (select 1 from pg_constraint where conname = 'training_sessions_coach_excl') then
    alter table public.training_sessions add constraint training_sessions_coach_excl
      exclude using gist (coach_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
      where (status = 'scheduled' and is_exclusive);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'training_sessions_space_excl') then
    alter table public.training_sessions add constraint training_sessions_space_excl
      exclude using gist (venue_space_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
      where (status = 'scheduled' and is_exclusive and venue_space_id is not null);
  end if;
end $$;

alter table public.training_sessions enable row level security;
alter table public.training_sessions force row level security;

drop trigger if exists trg_training_sessions_org on public.training_sessions;
create trigger trg_training_sessions_org before insert or update on public.training_sessions
  for each row execute function public.ca_same_org_guard('service_id:training_services', 'coach_id:coaches', 'venue_id:venues',
                                                          'venue_space_id:venue_spaces', 'event_id:events');
drop trigger if exists trg_training_sessions_updated on public.training_sessions;
create trigger trg_training_sessions_updated before update on public.training_sessions
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_training_sessions on public.training_sessions;
create trigger trg_audit_training_sessions after insert or update or delete on public.training_sessions
  for each row execute function public.audit_trigger();

-- events: the calendar row of a session.
alter table public.events add column if not exists training_session_id uuid references public.training_sessions(id) on delete set null;
create unique index if not exists events_training_session_uidx on public.events (training_session_id) where training_session_id is not null;

-- training_bookings: session, payer, billing mode, idempotency.
alter table public.training_bookings add column if not exists session_id uuid references public.training_sessions(id) on delete set null;
alter table public.training_bookings add column if not exists payer_id uuid references public.billing_payers(id) on delete set null;
alter table public.training_bookings add column if not exists billing_mode text;
alter table public.training_bookings add column if not exists list_price numeric(10,2);
alter table public.training_bookings add column if not exists currency text;
alter table public.training_bookings add column if not exists price_override_reason text;
alter table public.training_bookings add column if not exists price_override_by uuid references public.profiles(id) on delete set null;
alter table public.training_bookings add column if not exists availability_override_reason text;
alter table public.training_bookings add column if not exists warnings jsonb not null default '[]'::jsonb;
alter table public.training_bookings add column if not exists request_id uuid;
alter table public.training_bookings add column if not exists created_via text not null default 'legacy';
alter table public.training_bookings add column if not exists change_seq integer not null default 0;
alter table public.training_bookings add column if not exists rescheduled_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'training_bookings_bk_chk') then
    alter table public.training_bookings add constraint training_bookings_bk_chk check (
      (billing_mode is null or billing_mode in ('invoice', 'package', 'free', 'credits'))
      and created_via in ('legacy', 'workflow')
      and (price_override_reason is null or length(price_override_reason) <= 500)
      and (availability_override_reason is null or length(availability_override_reason) <= 500)
      and (currency is null or currency ~ '^[A-Z]{3}$'));
  end if;
end $$;
create index if not exists idx_bookings_session on public.training_bookings (session_id) where session_id is not null;
create index if not exists idx_bookings_payer on public.training_bookings (payer_id) where payer_id is not null;
create index if not exists idx_bookings_org on public.training_bookings (org_id, slot_start);
create unique index if not exists training_bookings_request_uidx on public.training_bookings (org_id, request_id) where request_id is not null;
-- One live booking per athlete and session; one invoice per workflow booking.
create unique index if not exists training_bookings_session_athlete_uidx on public.training_bookings (session_id, athlete_id)
  where session_id is not null and status in ('booked', 'completed', 'no_show');
create unique index if not exists training_bookings_invoice_uidx on public.training_bookings (invoice_id)
  where invoice_id is not null and created_via = 'workflow';

drop trigger if exists trg_bookings_bk_org on public.training_bookings;
create trigger trg_bookings_bk_org before insert or update of session_id, payer_id on public.training_bookings
  for each row execute function public.ca_same_org_guard('session_id:training_sessions', 'payer_id:billing_payers');

-- Session RLS: staff (admin/finance), the session coach, and guardians /
-- the player of a participant. Writes only through the booking RPCs.
create or replace function public.bk_viewer_sees_session(p_session uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.training_bookings b
     where b.session_id = p_session and b.org_id = public.current_org_id()
       and (public.is_guardian_of_athlete(b.athlete_id)
            or b.athlete_id = public.current_player_athlete_id()));
$$;

drop policy if exists training_sessions_select on public.training_sessions;
create policy training_sessions_select on public.training_sessions for select
  using (org_id = public.current_org_id()
         and (public.is_finance() or coach_id = public.current_coach_id() or public.bk_viewer_sees_session(id)));
drop policy if exists training_sessions_insert on public.training_sessions;
create policy training_sessions_insert on public.training_sessions for insert with check (false);
drop policy if exists training_sessions_update on public.training_sessions;
create policy training_sessions_update on public.training_sessions for update using (false) with check (false);
drop policy if exists training_sessions_delete on public.training_sessions;
create policy training_sessions_delete on public.training_sessions for delete using (false);

-- ---------------------------------------------------------------------------
-- 4. Package entitlement consumed by a booking (exactly once per booking)
-- ---------------------------------------------------------------------------
create table if not exists public.training_booking_entitlements (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  booking_id   uuid not null unique references public.training_bookings(id) on delete cascade,
  purchase_id  uuid not null references public.training_package_purchases(id) on delete restrict,
  consumed_at  timestamptz not null default now(),
  consumed_by  uuid references public.profiles(id) on delete set null,
  restored_at  timestamptz,
  restored_by  uuid references public.profiles(id) on delete set null,
  restore_reason text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint training_booking_entitlements_reason_chk check (restore_reason is null or length(restore_reason) <= 500)
);
create index if not exists idx_tbe_org on public.training_booking_entitlements (org_id);
create index if not exists idx_tbe_purchase on public.training_booking_entitlements (purchase_id);
alter table public.training_booking_entitlements enable row level security;
alter table public.training_booking_entitlements force row level security;
drop policy if exists tbe_select on public.training_booking_entitlements;
create policy tbe_select on public.training_booking_entitlements for select
  using (org_id = public.current_org_id() and public.is_finance());
drop policy if exists tbe_insert on public.training_booking_entitlements;
create policy tbe_insert on public.training_booking_entitlements for insert with check (false);
drop policy if exists tbe_update on public.training_booking_entitlements;
create policy tbe_update on public.training_booking_entitlements for update using (false) with check (false);
drop policy if exists tbe_delete on public.training_booking_entitlements;
create policy tbe_delete on public.training_booking_entitlements for delete using (false);
drop trigger if exists trg_tbe_org on public.training_booking_entitlements;
create trigger trg_tbe_org before insert or update on public.training_booking_entitlements
  for each row execute function public.ca_same_org_guard('booking_id:training_bookings', 'purchase_id:training_package_purchases');
drop trigger if exists trg_tbe_updated on public.training_booking_entitlements;
create trigger trg_tbe_updated before update on public.training_booking_entitlements
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_tbe on public.training_booking_entitlements;
create trigger trg_audit_tbe after insert or update or delete on public.training_booking_entitlements
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- 5. Idempotency keys of the booking RPCs
-- ---------------------------------------------------------------------------
create table if not exists public.booking_requests (
  request_id  uuid primary key,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  kind        text not null,
  actor_id    uuid,
  result      jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_booking_requests_org on public.booking_requests (org_id, created_at);
alter table public.booking_requests enable row level security;
alter table public.booking_requests force row level security;
drop policy if exists booking_requests_select on public.booking_requests;
create policy booking_requests_select on public.booking_requests for select using (false);
drop policy if exists booking_requests_insert on public.booking_requests;
create policy booking_requests_insert on public.booking_requests for insert with check (false);
drop policy if exists booking_requests_update on public.booking_requests;
create policy booking_requests_update on public.booking_requests for update using (false) with check (false);
drop policy if exists booking_requests_delete on public.booking_requests;
create policy booking_requests_delete on public.booking_requests for delete using (false);
drop trigger if exists trg_booking_requests_updated on public.booking_requests;
create trigger trg_booking_requests_updated before update on public.booking_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Booking notifications: one delivery row per recipient
-- ---------------------------------------------------------------------------
create table if not exists public.booking_notifications (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  booking_id           uuid not null references public.training_bookings(id) on delete cascade,
  kind                 text not null,
  change_seq           integer not null default 0,
  recipient_kind       text not null,
  recipient_key        text not null,
  recipient_profile_id uuid references public.profiles(id) on delete set null,
  recipient_email      text,
  recipient_name       text,
  status               text not null default 'pending',
  attempts             integer not null default 0,
  last_error           text,
  notification_id      uuid,
  email_log_id         uuid,
  claimed_at           timestamptz,
  sent_at              timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint booking_notifications_kind_chk check (kind in ('confirmed', 'rescheduled', 'cancelled')),
  constraint booking_notifications_recipient_chk check (recipient_kind in ('payer', 'guardian', 'family', 'coach', 'player')),
  constraint booking_notifications_status_chk check (status in ('pending', 'sending', 'sent', 'failed', 'no_contact', 'skipped')),
  constraint booking_notifications_error_chk check (last_error is null or length(last_error) <= 500),
  unique (booking_id, kind, change_seq, recipient_key)
);
create index if not exists idx_booking_notifications_org on public.booking_notifications (org_id, status);
create index if not exists idx_booking_notifications_booking on public.booking_notifications (booking_id);
alter table public.booking_notifications enable row level security;
alter table public.booking_notifications force row level security;
drop policy if exists booking_notifications_select on public.booking_notifications;
create policy booking_notifications_select on public.booking_notifications for select
  using (org_id = public.current_org_id() and public.is_finance());
drop policy if exists booking_notifications_insert on public.booking_notifications;
create policy booking_notifications_insert on public.booking_notifications for insert with check (false);
drop policy if exists booking_notifications_update on public.booking_notifications;
create policy booking_notifications_update on public.booking_notifications for update using (false) with check (false);
drop policy if exists booking_notifications_delete on public.booking_notifications;
create policy booking_notifications_delete on public.booking_notifications for delete using (false);
drop trigger if exists trg_booking_notifications_updated on public.booking_notifications;
create trigger trg_booking_notifications_updated before update on public.booking_notifications
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_booking_notifications on public.booking_notifications;
create trigger trg_audit_booking_notifications after insert or update or delete on public.booking_notifications
  for each row execute function public.ca_audit_trigger('recipient_email', 'recipient_name');

-- Session sheets have no team.
alter table public.team_attendance_sheets alter column team_id drop not null;

-- ===========================================================================
-- 7. Core helpers
-- ===========================================================================
create or replace function public.bk_replay(p_request uuid, p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare r public.booking_requests%rowtype;
begin
  if p_request is null then return null; end if;
  select * into r from public.booking_requests where request_id = p_request;
  if not found then return null; end if;
  if r.org_id is distinct from public.current_org_id() or r.actor_id is distinct from auth.uid() or r.kind <> p_kind then
    raise exception 'REQUEST_ID_REUSED' using errcode = 'P0001';
  end if;
  return r.result || jsonb_build_object('replayed', true);
end $$;

create or replace function public.bk_remember(p_request uuid, p_kind text, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_request is not null then
    insert into public.booking_requests (request_id, org_id, kind, actor_id, result)
    values (p_request, public.current_org_id(), p_kind, auth.uid(), p_result)
    on conflict (request_id) do nothing;
  end if;
  return p_result || jsonb_build_object('replayed', false);
end $$;

-- Club booking settings (app_settings.settings.booking) with defaults.
create or replace function public.bk_settings(p_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'cancellation_hours', coalesce((st.settings->'booking'->>'cancellation_hours')::numeric, 24),
    'refund_credits_on_cancel', coalesce((st.settings->'booking'->>'refund_credits_on_cancel')::boolean, true),
    'auto_invoice', coalesce((st.settings->'booking'->>'auto_invoice')::boolean, false),
    'athlete_overlap', coalesce(nullif(st.settings->'booking'->>'athlete_overlap', ''), 'warn'),
    'invoice_due_days', coalesce((st.settings->'booking'->>'invoice_due_days')::int, 14))
    from (select 1) x left join public.app_settings st on st.org_id = p_org;
$$;

create or replace function public.bk_currency(p_svc public.training_services)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select upper(coalesce(nullif(btrim(p_svc.currency), ''), public.training_org_currency(p_svc.org_id)));
$$;

-- What a paid service still needs before a booking can be invoiced.
create or replace function public.bk_setup_missing(p_svc public.training_services)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare v text[] := '{}';
begin
  if p_svc.id is null or coalesce(p_svc.price_chf, 0) <= 0 then return v; end if;
  if p_svc.billing_category is null or not public.is_billing_activity(p_svc.billing_category) or p_svc.billing_category = 'other' then
    v := v || 'BILLING_CATEGORY_MISSING'::text;
    return v;
  end if;
  if public.billing_entity_resolve(p_svc.org_id, p_svc.billing_category) is null then
    v := v || 'BILLING_ENTITY_MISSING'::text;
  end if;
  if public.billing_series_prefix(p_svc.org_id, p_svc.billing_category) is null then
    v := v || 'NUMBER_SERIES_MISSING'::text;
  end if;
  return v;
end $$;

create or replace function public.bk_flag(p_org uuid, p_table text, p_id uuid, p_code text, p_details jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
  values (p_org, p_table, p_id, p_code, coalesce(p_details, '{}'::jsonb))
  on conflict do nothing;
$$;

-- Live (confirmed) participants of a session.
create or replace function public.bk_session_count(p_session uuid, p_exclude uuid default null)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.training_bookings b
   where b.session_id = p_session and b.status in ('booked', 'completed', 'no_show')
     and b.id is distinct from p_exclude;
$$;

-- Roster of a session event: confirmed bookings (attendance sheet builder).
create or replace function public.bk_event_roster(p_event uuid)
returns table (athlete_id uuid, booking_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (b.athlete_id) b.athlete_id, b.id
    from public.events e
    join public.training_bookings b on b.session_id = e.training_session_id
   where e.id = p_event and e.training_session_id is not null and b.status in ('booked', 'completed', 'no_show')
   order by b.athlete_id, b.created_at;
$$;

-- Payer snapshot written on the invoice: the payer record, else the family.
create or replace function public.bk_payer_snapshot(p_org uuid, p_payer uuid, p_family uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare p public.billing_payers; f public.families;
begin
  if p_payer is not null then
    select * into p from public.billing_payers where id = p_payer and org_id = p_org;
    if found then
      return jsonb_build_object(
        'payer_id', p.id, 'kind', p.kind,
        'invoice_payer_kind', case p.kind when 'guardian' then case when p.profile_id is not null then 'guardian' else 'family' end
                                          when 'sponsor' then 'sponsor' else 'other' end,
        'profile_id', case when p.kind = 'guardian' then p.profile_id end,
        'name', p.name, 'email', p.email::text, 'phone', p.phone,
        'address', jsonb_build_object('street', p.street, 'postal_code', p.postal_code, 'city', p.city, 'country', p.country),
        'has_account', p.profile_id is not null);
    end if;
  end if;
  select * into f from public.families where id = p_family and org_id = p_org;
  return jsonb_build_object(
    'payer_id', null, 'kind', 'family', 'invoice_payer_kind', 'family', 'profile_id', null,
    'name', coalesce(nullif(btrim(f.contact_name), ''), f.name), 'email', f.contact_email::text, 'phone', f.phone,
    'address', jsonb_build_object('street', f.address, 'postal_code', f.postal_code, 'city', f.city, 'country', null),
    'has_account', exists (select 1 from public.family_members fm where fm.family_id = f.id));
end $$;

-- ---------------------------------------------------------------------------
-- Slot evaluation (no writes, no locks): availability, conflicts, capacity.
--   p_move_session: the session being moved by a reschedule (ignored in the
--   conflict checks); p_exclude: the booking being rescheduled.
-- ---------------------------------------------------------------------------
create or replace function public.bk_evaluate(
  p_org uuid, p_athlete uuid, p_svc public.training_services, p_coach uuid, p_start timestamptz,
  p_session uuid, p_space uuid, p_override boolean, p_exclude uuid, p_move_session uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_err   text[] := '{}';
  v_warn  jsonb := '[]'::jsonb;
  s       public.training_sessions;
  v_coach uuid := p_coach;
  v_start timestamptz := p_start;
  v_end   timestamptz;
  v_cap   integer;
  v_wcap  integer;
  v_wven  uuid;
  v_venue uuid;
  v_space uuid := p_space;
  v_count integer := 0;
  v_set   jsonb := public.bk_settings(p_org);
  v_ov    jsonb;
begin
  if p_session is not null then
    select * into s from public.training_sessions where id = p_session and org_id = p_org;
    if not found then
      return jsonb_build_object('errors', to_jsonb(array['SESSION_NOT_FOUND']), 'warnings', v_warn);
    end if;
    if s.service_id <> p_svc.id then v_err := v_err || 'SESSION_SERVICE_MISMATCH'::text; end if;
    if s.status <> 'scheduled' then v_err := v_err || 'SESSION_NOT_SCHEDULED'::text; end if;
  elsif p_svc.kind = 'group' and v_start is not null and v_coach is not null then
    -- A group slot that already has a session is joined, not duplicated.
    select * into s from public.training_sessions x
     where x.org_id = p_org and x.service_id = p_svc.id and x.coach_id = v_coach and x.starts_at = v_start
       and x.status = 'scheduled' and x.id is distinct from p_move_session
     order by x.created_at limit 1;
  end if;

  if s.id is not null then
    v_coach := s.coach_id; v_start := s.starts_at; v_end := s.ends_at; v_cap := s.capacity;
    v_venue := s.venue_id; v_space := s.venue_space_id;
  else
    if v_start is null then v_err := v_err || 'INVALID_TIME'::text; end if;
    if v_coach is null then v_err := v_err || 'COACH_REQUIRED'::text; end if;
    v_end := v_start + make_interval(mins => p_svc.duration_min);
  end if;

  if v_coach is not null then
    if not exists (select 1 from public.coaches c where c.id = v_coach and c.org_id = p_org and c.is_active) then
      v_err := v_err || 'COACH_NOT_FOUND'::text;
    elsif not public.bk_coach_eligible(p_svc.id, v_coach) then
      if p_override then v_warn := v_warn || jsonb_build_object('code', 'COACH_NOT_ELIGIBLE_OVERRIDDEN');
      else v_err := v_err || 'COACH_NOT_ELIGIBLE'::text; end if;
    end if;
  end if;

  if s.id is null and v_start is not null and v_coach is not null then
    select w.capacity, w.venue_id into v_wcap, v_wven
      from public.training_slot_window(p_org, v_coach, p_svc.id, v_start, v_end) w;
    if v_wcap is null then
      if p_override then v_warn := v_warn || jsonb_build_object('code', 'AVAILABILITY_OVERRIDDEN');
      else v_err := v_err || 'COACH_UNAVAILABLE'::text; end if;
    end if;
    v_space := coalesce(v_space, p_svc.default_venue_space_id);
    if v_space is not null then
      select vs.venue_id into v_venue from public.venue_spaces vs where vs.id = v_space and vs.org_id = p_org;
      if v_venue is null then v_err := v_err || 'SPACE_NOT_FOUND'::text; v_space := null; end if;
    end if;
    v_venue := coalesce(v_venue, v_wven, p_svc.venue_id);
    v_cap := case when p_svc.kind = 'group' then least(coalesce(v_wcap, p_svc.max_participants), p_svc.max_participants) else 1 end;

    if exists (select 1 from public.training_sessions x
                where x.org_id = p_org and x.coach_id = v_coach and x.status = 'scheduled' and x.is_exclusive
                  and x.id is distinct from p_move_session
                  and tstzrange(x.starts_at, x.ends_at, '[)') && tstzrange(v_start, v_end, '[)')) then
      v_err := v_err || 'COACH_BUSY'::text;
    end if;
    if v_space is not null and (
         exists (select 1 from public.training_sessions x
                  where x.venue_space_id = v_space and x.status = 'scheduled' and x.is_exclusive
                    and x.id is distinct from p_move_session
                    and tstzrange(x.starts_at, x.ends_at, '[)') && tstzrange(v_start, v_end, '[)'))
      or exists (select 1 from public.events e
                  where e.venue_space_id = v_space and e.status in ('scheduled', 'postponed')
                    and (e.training_session_id is null or e.training_session_id is distinct from p_move_session)
                    and tstzrange(e.starts_at, e.ends_at, '[)') && tstzrange(v_start, v_end, '[)'))) then
      v_err := v_err || 'SPACE_TAKEN'::text;
    end if;
    if exists (select 1 from public.events e join public.team_coaches tc on tc.team_id = e.team_id and tc.coach_id = v_coach
                where e.org_id = p_org and e.status in ('scheduled', 'postponed')
                  and tstzrange(e.starts_at, e.ends_at, '[)') && tstzrange(v_start, v_end, '[)')) then
      v_warn := v_warn || jsonb_build_object('code', 'COACH_TEAM_EVENT_OVERLAP');
    end if;
  end if;

  if s.id is not null then
    v_count := public.bk_session_count(s.id, p_exclude);
    if v_count >= s.capacity then v_err := v_err || 'SESSION_FULL'::text; end if;
    if p_athlete is not null and exists (select 1 from public.training_bookings b
                                          where b.session_id = s.id and b.athlete_id = p_athlete
                                            and b.status in ('booked', 'completed', 'no_show') and b.id is distinct from p_exclude) then
      v_err := v_err || 'ALREADY_BOOKED'::text;
    end if;
  end if;

  if p_athlete is not null and v_start is not null and v_end is not null then
    select coalesce(jsonb_agg(jsonb_build_object('booking_id', b.id, 'starts_at', b.slot_start)), '[]'::jsonb) into v_ov
      from public.training_bookings b
     where b.athlete_id = p_athlete and b.status = 'booked' and b.id is distinct from p_exclude
       and (s.id is null or b.session_id is distinct from s.id)
       and tstzrange(b.slot_start, coalesce(b.slot_end, b.slot_start + interval '1 hour'), '[)') && tstzrange(v_start, v_end, '[)');
    if jsonb_array_length(v_ov) > 0 then
      if v_set->>'athlete_overlap' = 'block' then v_err := v_err || 'ATHLETE_OVERLAP'::text;
      else v_warn := v_warn || jsonb_build_object('code', 'ATHLETE_OVERLAP', 'bookings', v_ov); end if;
    end if;
  end if;
  if v_start is not null and v_start < now() then
    v_warn := v_warn || jsonb_build_object('code', 'SLOT_IN_PAST');
  end if;

  return jsonb_build_object(
    'session_id', s.id, 'coach_id', v_coach, 'starts_at', v_start, 'ends_at', v_end,
    'venue_id', v_venue, 'venue_space_id', v_space, 'capacity', v_cap, 'participants', v_count,
    'places_left', case when v_cap is null then null else greatest(0, v_cap - v_count) end,
    'errors', to_jsonb(v_err), 'warnings', v_warn);
end $$;

-- Billing plan of a booking (no writes): package coverage, free / trial,
-- price override, setup_missing.
create or replace function public.bk_billing_plan(
  p_org uuid, p_athlete uuid, p_svc public.training_services, p_billing text, p_purchase uuid,
  p_price numeric, p_price_reason text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_err    text[] := '{}';
  v_cur    text := public.bk_currency(p_svc);
  v_exp    int := public.currency_exponent(public.bk_currency(p_svc));
  v_list   numeric := round(coalesce(p_svc.price_chf, 0), public.currency_exponent(public.bk_currency(p_svc)));
  v_price  numeric;
  v_mode   text := coalesce(nullif(p_billing, ''), 'auto');
  v_lot    public.training_package_purchases;
  v_over   boolean := false;
begin
  if v_mode not in ('auto', 'invoice', 'package', 'free') then
    return jsonb_build_object('errors', to_jsonb(array['INVALID_BILLING']));
  end if;
  select * into v_lot from public.training_package_purchases tp
   where tp.org_id = p_org and tp.athlete_id = p_athlete and tp.service_id = p_svc.id
     and (p_purchase is null or tp.id = p_purchase)
     and tp.status = 'active' and (tp.expires_at is null or tp.expires_at > now()) and tp.sessions_used < tp.sessions
   order by tp.expires_at nulls last, tp.granted_at, tp.created_at
   limit 1;
  if p_purchase is not null and v_lot.id is null then v_err := v_err || 'PACKAGE_NOT_AVAILABLE'::text; end if;

  if v_mode = 'auto' then
    v_mode := case when v_lot.id is not null then 'package'
                   when p_svc.kind = 'package' then 'package'
                   when v_list = 0 and p_price is null then 'free'
                   else 'invoice' end;
  end if;
  if v_mode = 'package' then
    if v_lot.id is null and 'PACKAGE_NOT_AVAILABLE' <> all(v_err) then v_err := v_err || 'PACKAGE_REQUIRED'::text; end if;
    v_price := 0;
  elsif v_mode = 'free' then
    v_price := 0;
    v_over := v_list > 0;
  else
    if p_svc.kind = 'package' then v_err := v_err || 'PACKAGE_REQUIRED'::text; end if;
    v_price := coalesce(round(p_price, v_exp), v_list);
    if v_price < 0 then v_err := v_err || 'INVALID_PRICE'::text; end if;
    v_over := v_price is distinct from v_list;
    if v_price = 0 then v_mode := 'free'; end if;
  end if;
  if v_over and length(btrim(coalesce(p_price_reason, ''))) = 0 then
    v_err := v_err || 'PRICE_OVERRIDE_REASON_REQUIRED'::text;
  end if;

  return jsonb_build_object(
    'billing_mode', v_mode, 'price', v_price, 'list_price', v_list, 'currency', v_cur, 'price_override', v_over,
    'purchase_id', case when v_mode = 'package' then v_lot.id end,
    'package_remaining', case when v_lot.id is not null then v_lot.sessions - v_lot.sessions_used end,
    'billing_status', case v_mode when 'package' then 'package' when 'free' then 'not_billable' else 'to_invoice' end,
    'setup_missing', to_jsonb(case when v_mode = 'invoice' then public.bk_setup_missing(p_svc) else '{}'::text[] end),
    'errors', to_jsonb(v_err));
end $$;

-- Derived billing status of a booking (from its mode, invoice and payments).
create or replace function public.booking_billing_status(p_booking uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare b public.training_bookings; i public.invoices; v_paid numeric; v_due numeric; v_mode text;
begin
  select * into b from public.training_bookings where id = p_booking;
  if not found then return null; end if;
  v_mode := coalesce(b.billing_mode,
                     case when b.purchase_id is not null then 'package'
                          when coalesce(b.credits_used, 0) > 0 then 'credits'
                          when b.invoice_id is not null or coalesce(b.price_chf, 0) > 0 then 'invoice'
                          else 'free' end);
  if b.invoice_id is null then
    if v_mode in ('package', 'credits') then return 'package'; end if;
    if v_mode = 'free' or coalesce(b.price_chf, 0) <= 0 or b.status = 'cancelled' then return 'not_billable'; end if;
    return 'to_invoice';
  end if;
  select * into i from public.invoices where id = b.invoice_id;
  if not found then return 'to_invoice'; end if;
  if i.status::text = 'draft' then return 'invoice_draft'; end if;
  if i.status::text in ('cancelled', 'void', 'refunded') then return 'credited'; end if;
  v_paid := public.invoice_net_paid(i.id);
  v_due := i.total_chf + i.adjustments_total;
  if v_due <= 0 then return case when i.adjustments_total < 0 then 'credited' else 'paid' end; end if;
  if v_paid >= v_due or i.status::text = 'paid' then return 'paid'; end if;
  if v_paid > 0 then return 'partially_paid'; end if;
  return 'invoiced';
end $$;

-- ---------------------------------------------------------------------------
-- Session + event creation / refresh
-- ---------------------------------------------------------------------------
create or replace function public.bk_session_create(
  p_org uuid, p_svc public.training_services, p_coach uuid, p_start timestamptz, p_end timestamptz,
  p_venue uuid, p_space uuid, p_capacity integer)
returns public.training_sessions
language plpgsql
security definer
set search_path = public
as $$
declare s public.training_sessions; v_event uuid; v_con text;
begin
  begin
    insert into public.training_sessions (org_id, service_id, coach_id, venue_id, venue_space_id, location_text,
                                          starts_at, ends_at, capacity, created_by)
    values (p_org, p_svc.id, p_coach, p_venue, p_space, p_svc.location_text, p_start, p_end, greatest(1, coalesce(p_capacity, 1)),
            auth.uid())
    returning * into s;
  exception when exclusion_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'training_sessions_space_excl' then raise exception 'SPACE_TAKEN' using errcode = 'P0001'; end if;
    raise exception 'COACH_BUSY' using errcode = 'P0001';
  end;
  begin
    insert into public.events (org_id, type, title, venue_id, venue_space_id, location_text, starts_at, ends_at, status,
                               training_session_id, created_by)
    values (p_org, 'training', p_svc.name, p_venue, p_space, p_svc.location_text, p_start, p_end, 'scheduled', s.id, auth.uid())
    returning id into v_event;
  exception when exclusion_violation then
    raise exception 'SPACE_TAKEN' using errcode = 'P0001';
  end;
  update public.training_sessions set event_id = v_event where id = s.id returning * into s;
  return s;
end $$;

-- After a booking left a session: cancel the empty session (and its event),
-- else keep a draft attendance sheet in step with the bookings.
create or replace function public.bk_session_refresh(p_session uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare s public.training_sessions; v_sheet uuid; v_prev text := current_setting('app.bk_internal', true);
begin
  if p_session is null then return; end if;
  select * into s from public.training_sessions where id = p_session for update;
  if not found then return; end if;
  perform set_config('app.bk_internal', 'on', true);
  if s.status = 'scheduled' and public.bk_session_count(s.id) = 0 then
    update public.training_sessions set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid() where id = s.id;
    update public.events set status = 'cancelled' where id = s.event_id and status <> 'cancelled';
  else
    select id into v_sheet from public.team_attendance_sheets where event_id = s.event_id and status = 'draft';
    if v_sheet is not null then perform public.ta_sheet_sync(v_sheet); end if;
  end if;
  perform set_config('app.bk_internal', coalesce(v_prev, ''), true);
end $$;

create or replace function public.bk_sync_event_sheet(p_session uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_sheet uuid;
begin
  select sh.id into v_sheet from public.team_attendance_sheets sh join public.training_sessions s on s.event_id = sh.event_id
   where s.id = p_session and sh.status = 'draft';
  if v_sheet is not null then perform public.ta_sheet_sync(v_sheet); end if;
end $$;

-- Legacy booking paths (book_training, book_training_session, guest
-- checkout, reschedule_training, admin_update_booking, cancels) keep their
-- own checks; their bookings are attached to a session here so that they
-- appear on the calendar and in attendance. Failures never block the legacy
-- path: they are flagged BOOKING_WITHOUT_SESSION instead.
create or replace function public.bk_attach_legacy(p_booking uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare b public.training_bookings; v_svc public.training_services; s public.training_sessions; v_end timestamptz; v_prev text;
begin
  select * into b from public.training_bookings where id = p_booking;
  if not found or b.session_id is not null or b.status <> 'booked' then return; end if;
  select * into v_svc from public.training_services where id = b.service_id;
  v_end := coalesce(b.slot_end, b.slot_start + make_interval(mins => coalesce(v_svc.duration_min, 60)));
  v_prev := current_setting('app.bk_internal', true);
  perform set_config('app.bk_internal', 'on', true);
  begin
    select * into s from public.training_sessions x
     where x.org_id = b.org_id and x.service_id = b.service_id and x.coach_id = b.coach_id and x.starts_at = b.slot_start
       and x.status = 'scheduled'
     order by x.created_at limit 1;
    if s.id is null then
      s := public.bk_session_create(b.org_id, v_svc, b.coach_id, b.slot_start, v_end, b.venue_id, null,
                                    case when v_svc.session_type = 'group' then v_svc.max_participants else 1 end);
    end if;
    update public.training_bookings set session_id = s.id where id = b.id;
    perform public.bk_sync_event_sheet(s.id);
  exception when others then
    perform public.bk_flag(b.org_id, 'training_bookings', b.id, 'BOOKING_WITHOUT_SESSION',
                           jsonb_build_object('slot_start', b.slot_start, 'error', left(sqlerrm, 200)));
  end;
  perform set_config('app.bk_internal', coalesce(v_prev, ''), true);
end $$;

create or replace function public.bk_bookings_legacy_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_old uuid;
begin
  if public.billing_flag_on('app.bk_internal') then return null; end if;
  if tg_op = 'INSERT' then
    if new.session_id is null and new.status = 'booked' then perform public.bk_attach_legacy(new.id); end if;
    return null;
  end if;
  if new.session_id is not null and (new.slot_start is distinct from old.slot_start or new.coach_id is distinct from old.coach_id) then
    v_old := new.session_id;
    perform set_config('app.bk_internal', 'on', true);
    update public.training_bookings set session_id = null where id = new.id;
    perform set_config('app.bk_internal', '', true);
    perform public.bk_session_refresh(v_old);
    perform public.bk_attach_legacy(new.id);
  elsif new.session_id is not null and new.status is distinct from old.status then
    perform public.bk_session_refresh(new.session_id);
  elsif new.session_id is null and new.status = 'booked' and old.status is distinct from 'booked' then
    perform public.bk_attach_legacy(new.id);
  end if;
  return null;
end $$;

drop trigger if exists trg_bookings_bk_legacy_sync on public.training_bookings;
create trigger trg_bookings_bk_legacy_sync after insert or update of status, slot_start, coach_id on public.training_bookings
  for each row execute function public.bk_bookings_legacy_sync();

-- A session's calendar row is managed by the booking RPCs: direct edits of
-- its time, place or status are refused (cancel / reschedule the bookings).
create or replace function public.events_session_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.training_session_id is null or public.billing_flag_on('app.bk_internal') or public.is_service_caller() then
    return new;
  end if;
  if new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at
     or new.status is distinct from old.status or new.venue_id is distinct from old.venue_id
     or new.venue_space_id is distinct from old.venue_space_id or new.team_id is distinct from old.team_id
     or new.training_session_id is distinct from old.training_session_id or new.type is distinct from old.type then
    raise exception 'SESSION_EVENT_MANAGED' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_events_session_guard on public.events;
create trigger trg_events_session_guard before update on public.events
  for each row execute function public.events_session_guard();

create or replace function public.events_session_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.training_session_id is not null and not public.billing_flag_on('app.bk_internal') and not public.is_service_caller()
     and exists (select 1 from public.training_sessions s where s.id = old.training_session_id and s.status = 'scheduled') then
    raise exception 'SESSION_EVENT_MANAGED' using errcode = 'P0001';
  end if;
  return old;
end $$;

drop trigger if exists trg_events_session_delete_guard on public.events;
create trigger trg_events_session_delete_guard before delete on public.events
  for each row execute function public.events_session_delete_guard();

-- ---------------------------------------------------------------------------
-- Notifications: queue one delivery row per recipient
-- ---------------------------------------------------------------------------
create or replace function public.bk_enqueue_notifications(p_booking uuid, p_kind text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.training_bookings; a public.athletes; f public.families; p public.billing_payers;
  v_n integer := 0; v_k integer; v_contact boolean := false;
begin
  select * into b from public.training_bookings where id = p_booking;
  if not found then return 0; end if;
  select * into a from public.athletes where id = b.athlete_id;
  select * into f from public.families where id = a.family_id;

  if b.payer_id is not null then
    select * into p from public.billing_payers where id = b.payer_id;
    if p.id is not null and (p.profile_id is not null or p.email is not null) then
      insert into public.booking_notifications (org_id, booking_id, kind, change_seq, recipient_kind, recipient_key,
                                                recipient_profile_id, recipient_email, recipient_name)
      values (b.org_id, b.id, p_kind, b.change_seq, 'payer',
              coalesce('p:' || p.profile_id::text, 'e:' || lower(p.email::text)), p.profile_id,
              coalesce(p.email::text, (select pf.email from public.profiles pf where pf.id = p.profile_id)), p.name)
      on conflict do nothing;
      get diagnostics v_k = row_count; v_n := v_n + v_k; v_contact := true;
    end if;
  end if;

  insert into public.booking_notifications (org_id, booking_id, kind, change_seq, recipient_kind, recipient_key,
                                            recipient_profile_id, recipient_email, recipient_name)
  select b.org_id, b.id, p_kind, b.change_seq, 'guardian', 'p:' || r.profile_id::text, r.profile_id,
         case when coalesce(fm.receives_emails, true) then pf.email end, pf.full_name
    from public.ta_alert_recipients(b.athlete_id) r
    join public.profiles pf on pf.id = r.profile_id
    left join public.family_members fm on fm.family_id = a.family_id and fm.profile_id = r.profile_id
  on conflict do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;
  if exists (select 1 from public.ta_alert_recipients(b.athlete_id)) then v_contact := true; end if;

  if not v_contact and f.contact_email is not null and public.ta_plausible_email(f.contact_email::text) then
    insert into public.booking_notifications (org_id, booking_id, kind, change_seq, recipient_kind, recipient_key,
                                              recipient_email, recipient_name)
    values (b.org_id, b.id, p_kind, b.change_seq, 'family', 'e:' || lower(f.contact_email::text), f.contact_email::text,
            coalesce(f.contact_name, f.name))
    on conflict do nothing;
    get diagnostics v_k = row_count; v_n := v_n + v_k; v_contact := true;
  end if;

  if a.player_profile_id is not null then
    insert into public.booking_notifications (org_id, booking_id, kind, change_seq, recipient_kind, recipient_key,
                                              recipient_profile_id, recipient_email, recipient_name)
    select b.org_id, b.id, p_kind, b.change_seq, 'player', 'p:' || pf.id::text, pf.id, null, pf.full_name
      from public.profiles pf where pf.id = a.player_profile_id
    on conflict do nothing;
    get diagnostics v_k = row_count; v_n := v_n + v_k;
  end if;

  if not v_contact then
    insert into public.booking_notifications (org_id, booking_id, kind, change_seq, recipient_kind, recipient_key, status)
    values (b.org_id, b.id, p_kind, b.change_seq, 'family', 'none', 'no_contact')
    on conflict do nothing;
  end if;

  insert into public.booking_notifications (org_id, booking_id, kind, change_seq, recipient_kind, recipient_key,
                                            recipient_profile_id, recipient_email, recipient_name)
  select b.org_id, b.id, p_kind, b.change_seq, 'coach', 'p:' || c.profile_id::text, c.profile_id, pf.email, c.display_name
    from public.coaches c join public.profiles pf on pf.id = c.profile_id
   where c.id = b.coach_id and c.profile_id is not null
  on conflict do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;
  return v_n;
end $$;

-- ===========================================================================
-- 8. Booking lifecycle RPCs
-- ===========================================================================
-- Shared payload reading for quote / confirm.
create or replace function public.bk_read_payload(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
begin
  return jsonb_build_object(
    'athlete_id', nullif(p->>'athlete_id', ''), 'service_id', nullif(p->>'service_id', ''),
    'coach_id', nullif(p->>'coach_id', ''), 'session_id', nullif(p->>'session_id', ''),
    'starts_at', nullif(p->>'starts_at', ''), 'venue_space_id', nullif(p->>'venue_space_id', ''),
    'payer_id', nullif(p->>'payer_id', ''), 'billing', coalesce(nullif(p->>'billing', ''), 'auto'),
    'purchase_id', nullif(p->>'purchase_id', ''), 'price', nullif(p->>'price', ''),
    'price_reason', nullif(btrim(coalesce(p->>'price_reason', '')), ''),
    'override_availability', coalesce((p->>'override_availability')::boolean, false),
    'override_reason', nullif(btrim(coalesce(p->>'override_reason', '')), ''),
    'notes', nullif(btrim(coalesce(p->>'notes', '')), ''),
    'notify', coalesce((p->>'notify')::boolean, true));
end $$;

create or replace function public.bk_first_error(p_eval jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select p_eval->'errors'->>0;
$$;

-- Quote: what confirming this payload would do. Writes nothing.
create or replace function public.booking_quote(p_payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  x       jsonb := public.bk_read_payload(coalesce(p_payload, '{}'::jsonb));
  v_org   uuid := public.current_org_id();
  v_ath   public.athletes;
  v_svc   public.training_services;
  v_eval  jsonb;
  v_bill  jsonb;
  v_err   jsonb;
  v_ent   uuid;
  v_ov    boolean;
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into v_ath from public.athletes where id = (x->>'athlete_id')::uuid and org_id = v_org;
  if not found then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_svc from public.training_services where id = (x->>'service_id')::uuid and org_id = v_org;
  if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002'; end if;
  v_ov := public.is_admin() and (x->>'override_availability')::boolean;

  v_eval := public.bk_evaluate(v_org, v_ath.id, v_svc, (x->>'coach_id')::uuid, (x->>'starts_at')::timestamptz,
                               (x->>'session_id')::uuid, (x->>'venue_space_id')::uuid, v_ov, null);
  v_bill := public.bk_billing_plan(v_org, v_ath.id, v_svc, x->>'billing', (x->>'purchase_id')::uuid,
                                   (x->>'price')::numeric, x->>'price_reason');
  v_err := coalesce(v_eval->'errors', '[]'::jsonb) || coalesce(v_bill->'errors', '[]'::jsonb);
  if not v_svc.is_active then v_err := v_err || '"SERVICE_INACTIVE"'::jsonb; end if;
  if (x->>'payer_id') is not null and not exists (select 1 from public.billing_payers where id = (x->>'payer_id')::uuid and org_id = v_org and is_active) then
    v_err := v_err || '"PAYER_NOT_FOUND"'::jsonb;
  end if;
  if (x->>'override_availability')::boolean and not public.is_admin() then v_err := v_err || '"OVERRIDE_NOT_ALLOWED"'::jsonb; end if;
  if v_ov and (x->>'override_reason') is null then v_err := v_err || '"OVERRIDE_REASON_REQUIRED"'::jsonb; end if;
  v_ent := public.billing_entity_resolve(v_org, v_svc.billing_category);

  return jsonb_build_object(
    'ok', jsonb_array_length(v_err) = 0,
    'errors', v_err,
    'warnings', coalesce(v_eval->'warnings', '[]'::jsonb),
    'slot', v_eval - 'errors' - 'warnings',
    'billing', v_bill - 'errors',
    'service', jsonb_build_object('id', v_svc.id, 'name', v_svc.name, 'kind', v_svc.kind, 'duration_min', v_svc.duration_min,
                                  'billing_category', v_svc.billing_category, 'max_participants', v_svc.max_participants),
    'billing_entity', (select jsonb_build_object('id', e.id, 'name', e.name) from public.billing_entities e where e.id = v_ent),
    'number_prefix', public.billing_series_prefix(v_org, v_svc.billing_category),
    'payer', public.bk_payer_snapshot(v_org, (x->>'payer_id')::uuid, v_ath.family_id));
end $$;

-- Confirm: create or join the session and record the booking, atomically.
create or replace function public.booking_confirm(p_payload jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  x       jsonb := public.bk_read_payload(coalesce(p_payload, '{}'::jsonb));
  v_org   uuid := public.current_org_id();
  v_rep   jsonb;
  v_ath   public.athletes;
  v_svc   public.training_services;
  v_coach uuid;
  v_eval  jsonb;
  v_bill  jsonb;
  v_ov    boolean;
  s       public.training_sessions;
  v_lot   public.training_package_purchases;
  v_bid   uuid;
  v_res   jsonb;
  v_code  text;
  v_set   jsonb;
  v_inv   jsonb;
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  v_rep := public.bk_replay(p_request_id, 'confirm');
  if v_rep is not null then return v_rep; end if;
  -- the same key already produced a booking (e.g. replayed by another path)
  select id into v_bid from public.training_bookings where org_id = v_org and request_id = p_request_id;
  if v_bid is not null then
    return jsonb_build_object('ok', true, 'booking_id', v_bid, 'replayed', true);
  end if;

  select * into v_ath from public.athletes where id = (x->>'athlete_id')::uuid and org_id = v_org;
  if not found then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_ath.archived_at is not null then raise exception 'ATHLETE_ARCHIVED' using errcode = 'P0001'; end if;
  select * into v_svc from public.training_services where id = (x->>'service_id')::uuid and org_id = v_org;
  if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002'; end if;
  if not v_svc.is_active then raise exception 'SERVICE_INACTIVE' using errcode = 'P0001'; end if;
  if (x->>'override_availability')::boolean and not public.is_admin() then
    raise exception 'OVERRIDE_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  v_ov := public.is_admin() and (x->>'override_availability')::boolean;
  if v_ov and (x->>'override_reason') is null then raise exception 'OVERRIDE_REASON_REQUIRED' using errcode = 'P0001'; end if;
  if length(coalesce(x->>'notes', '')) > 2000 then raise exception 'NOTE_TOO_LONG' using errcode = 'P0001'; end if;
  if (x->>'payer_id') is not null and not exists (select 1 from public.billing_payers where id = (x->>'payer_id')::uuid and org_id = v_org and is_active) then
    raise exception 'PAYER_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform set_config('app.bk_internal', 'on', true);
  -- Serialise per coach: two staff confirming the same slot run one after
  -- the other; the exclusion constraint is the backstop.
  if (x->>'session_id') is not null then
    select coach_id into v_coach from public.training_sessions where id = (x->>'session_id')::uuid and org_id = v_org;
  else
    v_coach := (x->>'coach_id')::uuid;
  end if;
  if v_coach is not null then
    perform 1 from public.coaches where id = v_coach and org_id = v_org for update;
  end if;

  v_eval := public.bk_evaluate(v_org, v_ath.id, v_svc, (x->>'coach_id')::uuid, (x->>'starts_at')::timestamptz,
                               (x->>'session_id')::uuid, (x->>'venue_space_id')::uuid, v_ov, null);
  v_code := public.bk_first_error(v_eval);
  if v_code is not null then raise exception '%', v_code using errcode = 'P0001'; end if;
  v_bill := public.bk_billing_plan(v_org, v_ath.id, v_svc, x->>'billing', (x->>'purchase_id')::uuid,
                                   (x->>'price')::numeric, x->>'price_reason');
  v_code := public.bk_first_error(v_bill);
  if v_code is not null then raise exception '%', v_code using errcode = 'P0001'; end if;

  if (v_eval->>'session_id') is not null then
    select * into s from public.training_sessions where id = (v_eval->>'session_id')::uuid for update;
    if s.status <> 'scheduled' then raise exception 'SESSION_NOT_SCHEDULED' using errcode = 'P0001'; end if;
    if public.bk_session_count(s.id) >= s.capacity then raise exception 'SESSION_FULL' using errcode = 'P0001'; end if;
  else
    s := public.bk_session_create(v_org, v_svc, (v_eval->>'coach_id')::uuid, (v_eval->>'starts_at')::timestamptz,
                                  (v_eval->>'ends_at')::timestamptz, (v_eval->>'venue_id')::uuid,
                                  (v_eval->>'venue_space_id')::uuid, (v_eval->>'capacity')::int);
  end if;

  if v_bill->>'billing_mode' = 'package' then
    select * into v_lot from public.training_package_purchases where id = (v_bill->>'purchase_id')::uuid for update;
    if v_lot.status <> 'active' or v_lot.sessions_used >= v_lot.sessions or (v_lot.expires_at is not null and v_lot.expires_at <= now()) then
      raise exception 'PACKAGE_NOT_AVAILABLE' using errcode = 'P0001';
    end if;
  end if;

  begin
    insert into public.training_bookings
      (org_id, athlete_id, service_id, coach_id, slot_start, slot_end, status, paid_with, credits_used, price_chf, list_price,
       currency, purchase_id, venue_id, location_text, notes, created_by, session_id, payer_id, billing_mode,
       price_override_reason, price_override_by, availability_override_reason, warnings, request_id, created_via)
    values
      (v_org, v_ath.id, v_svc.id, s.coach_id, s.starts_at, s.ends_at, 'booked',
       null,
       case when v_bill->>'billing_mode' = 'package' then 1 else 0 end,
       (v_bill->>'price')::numeric, (v_bill->>'list_price')::numeric, v_bill->>'currency',
       case when v_bill->>'billing_mode' = 'package' then v_lot.id end,
       s.venue_id, coalesce(s.location_text, v_svc.location_text), x->>'notes', auth.uid(), s.id, (x->>'payer_id')::uuid,
       v_bill->>'billing_mode',
       case when (v_bill->>'price_override')::boolean then x->>'price_reason' end,
       case when (v_bill->>'price_override')::boolean then auth.uid() end,
       case when v_ov then x->>'override_reason' end,
       coalesce(v_eval->'warnings', '[]'::jsonb), p_request_id, 'workflow')
    returning id into v_bid;
  exception when unique_violation then
    raise exception 'ALREADY_BOOKED' using errcode = 'P0001';
  end;

  if v_bill->>'billing_mode' = 'package' then
    update public.training_package_purchases set sessions_used = sessions_used + 1 where id = v_lot.id;
    insert into public.training_booking_entitlements (org_id, booking_id, purchase_id, consumed_by)
    values (v_org, v_bid, v_lot.id, auth.uid());
  end if;
  if (v_bill->>'price_override')::boolean then
    perform public.money_audit(v_org, 'BOOKING_PRICE_OVERRIDE', 'training_bookings', v_bid,
      jsonb_build_object('list_price', v_bill->'list_price'),
      jsonb_build_object('price', v_bill->'price', 'reason', x->>'price_reason', 'billing_mode', v_bill->>'billing_mode'));
  end if;
  if v_ov then
    perform public.money_audit(v_org, 'BOOKING_AVAILABILITY_OVERRIDE', 'training_bookings', v_bid, null,
      jsonb_build_object('reason', x->>'override_reason', 'warnings', v_eval->'warnings'));
  end if;

  perform public.bk_sync_event_sheet(s.id);
  if (x->>'notify')::boolean then perform public.bk_enqueue_notifications(v_bid, 'confirmed'); end if;

  -- Billing is an explicit action unless the club turned auto-invoicing on.
  v_set := public.bk_settings(v_org);
  if (v_set->>'auto_invoice')::boolean and v_bill->>'billing_mode' = 'invoice'
     and jsonb_array_length(coalesce(v_bill->'setup_missing', '[]'::jsonb)) = 0 then
    v_inv := public.bk_create_invoice(v_bid, false);
  end if;
  perform set_config('app.bk_internal', '', true);

  v_res := jsonb_build_object(
    'ok', true, 'booking_id', v_bid, 'session_id', s.id, 'event_id', s.event_id,
    'starts_at', s.starts_at, 'ends_at', s.ends_at, 'coach_id', s.coach_id,
    'billing_mode', v_bill->>'billing_mode', 'billing_status', public.booking_billing_status(v_bid),
    'price', v_bill->'price', 'currency', v_bill->>'currency', 'purchase_id', v_bill->'purchase_id',
    'invoice_id', v_inv->'invoice_id', 'warnings', coalesce(v_eval->'warnings', '[]'::jsonb),
    'setup_missing', coalesce(v_bill->'setup_missing', '[]'::jsonb));
  return public.bk_remember(p_request_id, 'confirm', v_res);
end $$;

-- Invoice of one booking (internal; callers check role and locks).
create or replace function public.bk_create_invoice(p_booking uuid, p_send boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.training_bookings; v_svc public.training_services; a public.athletes; v_pay jsonb;
  v_inv uuid; v_cur text; v_desc text; v_label text; v_due int; v_tz text; v_num text;
begin
  select * into b from public.training_bookings where id = p_booking for update;
  select * into v_svc from public.training_services where id = b.service_id;
  select * into a from public.athletes where id = b.athlete_id;
  v_pay := public.bk_payer_snapshot(b.org_id, b.payer_id, a.family_id);
  v_cur := coalesce(b.currency, public.bk_currency(v_svc));
  v_tz := public.ta_tz(b.org_id);
  v_desc := v_svc.name || ' — ' || a.first_name || ' ' || a.last_name;
  v_label := left(v_svc.name || ' · ' || to_char(b.slot_start at time zone v_tz, 'YYYY-MM-DD HH24:MI'), 200);
  v_due := (public.bk_settings(b.org_id)->>'invoice_due_days')::int;

  insert into public.invoices (org_id, number, family_id, athlete_id, description, currency, status, due_date, created_by,
                               activity, activity_source, payer_kind, payer_name, payer_profile_id, payer_id, payer_email,
                               payer_address, source_label)
  values (b.org_id, public.next_invoice_number(b.org_id), a.family_id, a.id, v_desc, v_cur,
          case when p_send then 'sent' else 'draft' end::public.invoice_status,
          (public.ta_today(b.org_id) + v_due), auth.uid(),
          v_svc.billing_category, 'set', v_pay->>'invoice_payer_kind', left(v_pay->>'name', 140),
          (v_pay->>'profile_id')::uuid, (v_pay->>'payer_id')::uuid, v_pay->>'email', v_pay->'address', v_label)
  returning id, number into v_inv, v_num;
  insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
  values (b.org_id, v_inv, v_desc, 1, b.price_chf, b.price_chf);
  update public.invoices set total_chf = b.price_chf where id = v_inv;

  perform set_config('app.bk_internal', 'on', true);
  update public.training_bookings set invoice_id = v_inv where id = b.id;
  -- The link trigger relabels a fresh invoice with the service name; keep
  -- "service · date" (the billing functions may still set it now).
  perform set_config('app.billing_edit', 'on', true);
  update public.invoices set source_label = v_label where id = v_inv and source_label is distinct from v_label;
  perform set_config('app.billing_edit', 'off', true);

  return (select jsonb_build_object('ok', true, 'invoice_id', i.id, 'number', i.number, 'status', i.status,
                                    'total', i.total_chf, 'currency', i.currency, 'activity', i.activity,
                                    'billing_entity_id', i.billing_entity_id, 'send', p_send)
            from public.invoices i where i.id = v_inv);
end $$;

create or replace function public.booking_invoice_preview(p_booking uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare b public.training_bookings; v_svc public.training_services; a public.athletes; v_ent uuid; v_prefix text; v_year text;
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into b from public.training_bookings where id = p_booking and org_id = public.current_org_id();
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_svc from public.training_services where id = b.service_id;
  select * into a from public.athletes where id = b.athlete_id;
  v_ent := public.billing_entity_resolve(b.org_id, v_svc.billing_category);
  v_prefix := public.billing_series_prefix(b.org_id, v_svc.billing_category);
  v_year := to_char(public.ta_today(b.org_id), 'YYYY');
  return jsonb_build_object(
    'booking_id', b.id,
    'billable', b.status <> 'cancelled' and coalesce(b.billing_mode, 'invoice') = 'invoice' and coalesce(b.price_chf, 0) > 0,
    'invoice_id', b.invoice_id,
    'invoice_number', (select number from public.invoices where id = b.invoice_id),
    'recipient', public.bk_payer_snapshot(b.org_id, b.payer_id, a.family_id),
    'amount', b.price_chf, 'currency', coalesce(b.currency, public.bk_currency(v_svc)),
    'category', v_svc.billing_category,
    'billing_entity', (select jsonb_build_object('id', e.id, 'name', e.name) from public.billing_entities e where e.id = v_ent),
    'number_prefix', v_prefix,
    'number_preview', case when v_prefix is not null then v_prefix || '-' || v_year || '-' ||
        lpad((coalesce((select c.last_value from public.invoice_number_counters c
                         where c.org_id = b.org_id and c.prefix = v_prefix and c.year = v_year::int), 0) + 1)::text, 4, '0') end,
    'source_label', v_svc.name || ' · ' || to_char(b.slot_start at time zone public.ta_tz(b.org_id), 'YYYY-MM-DD HH24:MI'),
    'setup_missing', to_jsonb(public.bk_setup_missing(v_svc)));
end $$;

-- One invoice per booking. Refusal with data: {ok:false, code:'SETUP_MISSING', setup_missing:[…]}.
create or replace function public.booking_create_invoice(p_booking uuid, p_request_id uuid, p_send boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare b public.training_bookings; v_svc public.training_services; v_rep jsonb; v_missing text[]; v_res jsonb;
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  v_rep := public.bk_replay(p_request_id, 'invoice');
  if v_rep is not null then return v_rep; end if;
  select * into b from public.training_bookings where id = p_booking and org_id = public.current_org_id() for update;
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002'; end if;
  if b.invoice_id is not null then
    return jsonb_build_object('ok', true, 'invoice_id', b.invoice_id, 'already_invoiced', true, 'replayed', false,
                              'number', (select number from public.invoices where id = b.invoice_id));
  end if;
  if b.status = 'cancelled' or coalesce(b.billing_mode, 'invoice') <> 'invoice' or coalesce(b.price_chf, 0) <= 0 then
    raise exception 'NOT_BILLABLE' using errcode = 'P0001';
  end if;
  select * into v_svc from public.training_services where id = b.service_id;
  v_missing := public.bk_setup_missing(v_svc);
  if cardinality(v_missing) > 0 then
    perform public.bk_flag(b.org_id, 'training_services', v_svc.id, 'SERVICE_BILLING_SETUP',
                           jsonb_build_object('missing', to_jsonb(v_missing), 'name', v_svc.name));
    return jsonb_build_object('ok', false, 'code', 'SETUP_MISSING', 'setup_missing', to_jsonb(v_missing));
  end if;
  v_res := public.bk_create_invoice(b.id, coalesce(p_send, false));
  perform set_config('app.bk_internal', '', true);
  return public.bk_remember(p_request_id, 'invoice', v_res);
end $$;

-- Reschedule: release the old place, take the new one (or move a private
-- session in place). Package entitlement stays; the invoice only changes
-- through a credit / debit note when the price changes.
create or replace function public.booking_reschedule(p_booking uuid, p_payload jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  x       jsonb := public.bk_read_payload(coalesce(p_payload, '{}'::jsonb));
  v_org   uuid := public.current_org_id();
  v_rep   jsonb;
  b       public.training_bookings;
  v_svc   public.training_services;
  s0      public.training_sessions;
  s       public.training_sessions;
  v_coach uuid;
  v_ov    boolean;
  v_eval  jsonb;
  v_code  text;
  v_sole  boolean := false;
  v_price numeric;
  v_diff  numeric;
  v_adj   jsonb;
  v_res   jsonb;
  v_old_start timestamptz;
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  v_rep := public.bk_replay(p_request_id, 'reschedule');
  if v_rep is not null then return v_rep; end if;
  select * into b from public.training_bookings where id = p_booking and org_id = v_org for update;
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002'; end if;
  if b.status <> 'booked' then raise exception 'BOOKING_NOT_ACTIVE' using errcode = 'P0001'; end if;
  if (x->>'override_availability')::boolean and not public.is_admin() then raise exception 'OVERRIDE_NOT_ALLOWED' using errcode = 'P0001'; end if;
  v_ov := public.is_admin() and (x->>'override_availability')::boolean;
  if v_ov and (x->>'override_reason') is null then raise exception 'OVERRIDE_REASON_REQUIRED' using errcode = 'P0001'; end if;
  select * into v_svc from public.training_services where id = b.service_id;
  v_old_start := b.slot_start;

  perform set_config('app.bk_internal', 'on', true);
  if b.session_id is not null then
    select * into s0 from public.training_sessions where id = b.session_id;
    if exists (select 1 from public.team_attendance_sheets sh where sh.event_id = s0.event_id and sh.status in ('final', 'reopened')) then
      raise exception 'BOOKING_ATTENDED' using errcode = 'P0001';
    end if;
    v_sole := public.bk_session_count(s0.id, b.id) = 0;
  end if;
  if (x->>'session_id') is not null then
    select coach_id into v_coach from public.training_sessions where id = (x->>'session_id')::uuid and org_id = v_org;
  else
    v_coach := coalesce((x->>'coach_id')::uuid, b.coach_id);
  end if;
  -- lock both coaches in a stable order
  perform 1 from public.coaches where id in (b.coach_id, v_coach) and org_id = v_org order by id for update;
  if (x->>'session_id') is null and (x->>'starts_at') is null then raise exception 'INVALID_TIME' using errcode = 'P0001'; end if;

  v_eval := public.bk_evaluate(v_org, b.athlete_id, v_svc, v_coach, (x->>'starts_at')::timestamptz,
                               (x->>'session_id')::uuid, (x->>'venue_space_id')::uuid, v_ov, b.id,
                               case when v_sole then s0.id end);
  v_code := public.bk_first_error(v_eval);
  if v_code is not null then raise exception '%', v_code using errcode = 'P0001'; end if;
  if (v_eval->>'session_id')::uuid is not distinct from b.session_id and b.session_id is not null then
    raise exception 'SAME_SLOT' using errcode = 'P0001';
  end if;

  if (v_eval->>'session_id') is null and v_sole then
    -- private (or now-empty group) session: move it, the event follows
    begin
      update public.training_sessions
         set starts_at = (v_eval->>'starts_at')::timestamptz, ends_at = (v_eval->>'ends_at')::timestamptz,
             coach_id = (v_eval->>'coach_id')::uuid, venue_id = (v_eval->>'venue_id')::uuid,
             venue_space_id = (v_eval->>'venue_space_id')::uuid,
             rescheduled_from = coalesce(rescheduled_from, starts_at)
       where id = s0.id
      returning * into s;
      update public.events
         set starts_at = s.starts_at, ends_at = s.ends_at, venue_id = s.venue_id, venue_space_id = s.venue_space_id
       where id = s.event_id;
    exception when exclusion_violation then
      raise exception 'SPACE_TAKEN' using errcode = 'P0001';
    end;
  else
    if (v_eval->>'session_id') is not null then
      select * into s from public.training_sessions where id = (v_eval->>'session_id')::uuid for update;
      if public.bk_session_count(s.id, b.id) >= s.capacity then raise exception 'SESSION_FULL' using errcode = 'P0001'; end if;
    else
      s := public.bk_session_create(v_org, v_svc, (v_eval->>'coach_id')::uuid, (v_eval->>'starts_at')::timestamptz,
                                    (v_eval->>'ends_at')::timestamptz, (v_eval->>'venue_id')::uuid,
                                    (v_eval->>'venue_space_id')::uuid, (v_eval->>'capacity')::int);
    end if;
  end if;

  begin
    update public.training_bookings
       set session_id = s.id, slot_start = s.starts_at, slot_end = s.ends_at, coach_id = s.coach_id, venue_id = s.venue_id,
           change_seq = change_seq + 1, rescheduled_at = now(),
           availability_override_reason = case when v_ov then x->>'override_reason' else availability_override_reason end,
           warnings = coalesce(v_eval->'warnings', '[]'::jsonb)
     where id = b.id;
  exception when unique_violation then
    raise exception 'ALREADY_BOOKED' using errcode = 'P0001';
  end;
  if s0.id is not null and s0.id <> s.id then perform public.bk_session_refresh(s0.id); end if;
  perform public.bk_sync_event_sheet(s.id);

  -- Price change (optional)
  if (x->>'price') is not null then
    v_price := round((x->>'price')::numeric, public.currency_exponent(coalesce(b.currency, public.bk_currency(v_svc))));
    if v_price < 0 then raise exception 'INVALID_PRICE' using errcode = 'P0001'; end if;
    if v_price is distinct from b.price_chf then
      if (x->>'price_reason') is null then raise exception 'PRICE_OVERRIDE_REASON_REQUIRED' using errcode = 'P0001'; end if;
      if coalesce(b.billing_mode, 'invoice') <> 'invoice' then raise exception 'NOT_BILLABLE' using errcode = 'P0001'; end if;
      v_diff := v_price - coalesce(b.price_chf, 0);
      if b.invoice_id is not null then
        if v_diff < 0 then
          v_adj := public.issue_invoice_adjustment(b.invoice_id, 'credit_note', -v_diff, x->>'price_reason', null);
        else
          v_adj := public.issue_invoice_adjustment(b.invoice_id, 'debit_note', v_diff, x->>'price_reason', null);
        end if;
      end if;
      update public.training_bookings
         set price_chf = v_price, price_override_reason = x->>'price_reason', price_override_by = auth.uid()
       where id = b.id;
      perform public.money_audit(v_org, 'BOOKING_PRICE_OVERRIDE', 'training_bookings', b.id,
        jsonb_build_object('price', b.price_chf), jsonb_build_object('price', v_price, 'reason', x->>'price_reason', 'adjustment', v_adj));
    end if;
  end if;

  if (x->>'notify')::boolean then perform public.bk_enqueue_notifications(b.id, 'rescheduled'); end if;
  perform set_config('app.bk_internal', '', true);
  v_res := jsonb_build_object('ok', true, 'booking_id', b.id, 'session_id', s.id, 'event_id', s.event_id,
                              'previous_session_id', s0.id, 'moved_in_place', s.id = s0.id,
                              'starts_at', s.starts_at, 'ends_at', s.ends_at, 'previous_starts_at', v_old_start,
                              'coach_id', s.coach_id, 'adjustment', v_adj,
                              'billing_status', public.booking_billing_status(b.id),
                              'warnings', coalesce(v_eval->'warnings', '[]'::jsonb));
  return public.bk_remember(p_request_id, 'reschedule', v_res);
end $$;

-- Cancel: frees the place, keeps history, restores the package entitlement
-- per policy (or the staff decision), optional invoice cancellation / credit
-- note through the existing money functions.
create or replace function public.booking_cancel(
  p_booking uuid, p_reason text, p_request_id uuid, p_refund_mode text default 'none',
  p_restore_package boolean default null, p_notify boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid := public.current_org_id();
  v_rep    jsonb;
  b        public.training_bookings;
  e        public.training_booking_entitlements;
  v_set    jsonb;
  v_policy boolean;
  v_restore boolean := false;
  v_inv    public.invoices;
  v_paid   numeric;
  v_due    numeric;
  v_amt    numeric;
  v_money  jsonb;
  v_res    jsonb;
  v_mode   text := coalesce(nullif(p_refund_mode, ''), 'none');
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if length(p_reason) > 500 then raise exception 'REASON_TOO_LONG' using errcode = 'P0001'; end if;
  if v_mode not in ('none', 'cancel_invoice', 'credit_note') then raise exception 'INVALID_REFUND_MODE' using errcode = 'P0001'; end if;
  v_rep := public.bk_replay(p_request_id, 'cancel');
  if v_rep is not null then return v_rep; end if;
  select * into b from public.training_bookings where id = p_booking and org_id = v_org for update;
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002'; end if;
  if b.status = 'cancelled' then raise exception 'ALREADY_CANCELLED' using errcode = 'P0001'; end if;
  if b.status <> 'booked' then raise exception 'BOOKING_NOT_CANCELLABLE' using errcode = 'P0001'; end if;

  perform set_config('app.bk_internal', 'on', true);
  update public.training_bookings
     set status = 'cancelled', cancel_reason = btrim(p_reason), cancelled_at = now(), cancelled_by = auth.uid(),
         change_seq = change_seq + 1
   where id = b.id;
  perform public.bk_session_refresh(b.session_id);

  -- Package entitlement
  select * into e from public.training_booking_entitlements where booking_id = b.id for update;
  if e.id is not null and e.restored_at is null then
    v_set := public.bk_settings(v_org);
    v_policy := (v_set->>'refund_credits_on_cancel')::boolean
                and b.slot_start - now() >= make_interval(hours => (v_set->>'cancellation_hours')::numeric::int);
    v_restore := coalesce(p_restore_package, v_policy);
    if v_restore then
      update public.training_package_purchases set sessions_used = greatest(0, sessions_used - 1) where id = e.purchase_id;
      update public.training_booking_entitlements
         set restored_at = now(), restored_by = auth.uid(),
             restore_reason = case when p_restore_package is not null then 'staff' else 'policy' end
       where id = e.id;
    end if;
  end if;

  -- Invoice: issued invoices are never deleted
  if b.invoice_id is not null and v_mode <> 'none' then
    select * into v_inv from public.invoices where id = b.invoice_id;
    v_paid := public.invoice_net_paid(v_inv.id);
    v_due := v_inv.total_chf + v_inv.adjustments_total;
    if v_mode = 'cancel_invoice' or (v_mode = 'credit_note' and v_paid <= 0 and least(coalesce(b.price_chf, 0), v_due) >= v_due) then
      if v_inv.status::text not in ('cancelled', 'void') then
        v_money := public.cancel_invoice(v_inv.id, btrim(p_reason));
      end if;
    else
      v_amt := least(coalesce(b.price_chf, 0), v_due);
      if v_amt > 0 then
        v_money := public.issue_invoice_adjustment(v_inv.id, 'credit_note', v_amt, btrim(p_reason), null);
      end if;
    end if;
  end if;

  if coalesce(p_notify, true) then perform public.bk_enqueue_notifications(b.id, 'cancelled'); end if;
  perform set_config('app.bk_internal', '', true);
  v_res := jsonb_build_object('ok', true, 'booking_id', b.id, 'session_id', b.session_id,
                              'session_status', (select status from public.training_sessions where id = b.session_id),
                              'package_restored', v_restore, 'refund_mode', v_mode, 'invoice', v_money,
                              'billing_status', public.booking_billing_status(b.id));
  return public.bk_remember(p_request_id, 'cancel', v_res);
end $$;

-- Payments: recorded with the existing money RPCs (record_offline_payment,
-- receipt_record); online payments only through the Stripe webhook. This
-- wrapper records an offline payment against the booking's invoice with
-- request-id idempotency (receipt_record), so a retried click never books
-- the money twice.
create or replace function public.booking_record_payment(p_booking uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare b public.training_bookings; v_req uuid := nullif(p_payload->>'request_id', '')::uuid;
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if v_req is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  select * into b from public.training_bookings where id = p_booking and org_id = public.current_org_id();
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002'; end if;
  if b.invoice_id is null then raise exception 'NOT_INVOICED' using errcode = 'P0001'; end if;
  return public.receipt_record(jsonb_build_object(
    'request_id', v_req, 'amount', p_payload->'amount', 'currency', (select currency from public.invoices where id = b.invoice_id),
    'received_on', p_payload->'received_on', 'method', coalesce(p_payload->>'method', 'bank_transfer'),
    'family_id', (select family_id from public.invoices where id = b.invoice_id),
    'payer_name', (select payer_name from public.invoices where id = b.invoice_id),
    'reference', p_payload->'reference', 'note', p_payload->'note',
    'allocations', jsonb_build_array(jsonb_build_object('invoice_id', b.invoice_id, 'amount', p_payload->'amount'))));
end $$;

-- ---------------------------------------------------------------------------
-- Notification delivery (service role claims and records; staff retries)
-- ---------------------------------------------------------------------------
create or replace function public.booking_notifications_claim(p_org uuid default null, p_booking uuid default null, p_limit integer default 50)
returns table (
  id uuid, org_id uuid, booking_id uuid, kind text, recipient_kind text, recipient_profile_id uuid, recipient_email text,
  recipient_name text, attempts integer, service_name text, coach_name text, athlete_first_name text,
  starts_at timestamptz, ends_at timestamptz, previous_starts_at timestamptz, location_name text, timezone text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  return query
  with c as (
    select n.id from public.booking_notifications n
     where (p_org is null or n.org_id = p_org) and (p_booking is null or n.booking_id = p_booking)
       and (n.status = 'pending' or (n.status = 'sending' and n.claimed_at < now() - interval '10 minutes'))
       and n.attempts < 5
     order by n.created_at
     limit greatest(1, least(coalesce(p_limit, 50), 200))
     for update skip locked
  ), u as (
    update public.booking_notifications n set status = 'sending', claimed_at = now(), attempts = n.attempts + 1
      from c where n.id = c.id
    returning n.*
  )
  select u.id, u.org_id, u.booking_id, u.kind, u.recipient_kind, u.recipient_profile_id, u.recipient_email, u.recipient_name,
         u.attempts, ts.name, co.display_name, a.first_name, b.slot_start, b.slot_end,
         (select ss.rescheduled_from from public.training_sessions ss where ss.id = b.session_id),
         coalesce((select v.name from public.venues v where v.id = b.venue_id), b.location_text),
         public.ta_tz(u.org_id)
    from u
    join public.training_bookings b on b.id = u.booking_id
    join public.training_services ts on ts.id = b.service_id
    join public.athletes a on a.id = b.athlete_id
    left join public.coaches co on co.id = b.coach_id;
end $$;

create or replace function public.booking_notification_record(
  p_id uuid, p_status text, p_error text default null, p_notification uuid default null, p_email_log uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_status not in ('sent', 'failed', 'no_contact', 'skipped') then raise exception 'INVALID_STATUS' using errcode = 'P0001'; end if;
  update public.booking_notifications
     set status = p_status, last_error = left(p_error, 500), notification_id = coalesce(p_notification, notification_id),
         email_log_id = coalesce(p_email_log, email_log_id), sent_at = case when p_status = 'sent' then now() else sent_at end
   where id = p_id;
end $$;

create or replace function public.booking_notification_retry(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare n public.booking_notifications;
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into n from public.booking_notifications where id = p_id and org_id = public.current_org_id() for update;
  if not found then raise exception 'NOTIFICATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if n.status = 'no_contact' then
    -- a contact may have been added since: queue the recipients again
    delete from public.booking_notifications where id = n.id;
    perform public.bk_enqueue_notifications(n.booking_id, n.kind);
    return jsonb_build_object('ok', true, 'requeued', true, 'booking_id', n.booking_id);
  end if;
  if n.status not in ('failed', 'sending') then raise exception 'NOT_RETRYABLE' using errcode = 'P0001'; end if;
  update public.booking_notifications set status = 'pending', attempts = least(attempts, 4), claimed_at = null where id = n.id;
  return jsonb_build_object('ok', true, 'requeued', false, 'booking_id', n.booking_id);
end $$;

-- ===========================================================================
-- 9. People: duplicate check, athlete quick create, payers
-- ===========================================================================
create or replace function public.people_duplicate_check(p_payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org   uuid := public.current_org_id();
  v_first text := public.bk_norm(p_payload->>'first_name');
  v_last  text := public.bk_norm(p_payload->>'last_name');
  v_dob   date := nullif(p_payload->>'dob', '')::date;
  v_email text := lower(nullif(btrim(coalesce(p_payload->>'email', '')), ''));
  v_pname text := public.bk_norm(coalesce(p_payload->>'payer_name', ''));
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  return jsonb_build_object(
    'athletes', coalesce((
      select jsonb_agg(x order by (x->>'score')::int desc, x->>'last_name', x->>'first_name')
        from (
          select jsonb_build_object('id', a.id, 'first_name', a.first_name, 'last_name', a.last_name, 'dob', a.dob,
                                    'family_id', a.family_id, 'family_name', f.name, 'archived', a.archived_at is not null,
                                    'score', m.score, 'reason', m.reason) x
            from public.athletes a
            left join public.families f on f.id = a.family_id
            cross join lateral (
              select case
                when public.bk_norm(a.first_name) = v_first and public.bk_norm(a.last_name) = v_last and a.dob = v_dob then 100
                when public.bk_norm(a.first_name) = v_first and public.bk_norm(a.last_name) = v_last then 80
                when public.bk_norm(a.first_name) = v_last and public.bk_norm(a.last_name) = v_first then 70
                when public.bk_norm(a.last_name) = v_last and a.dob = v_dob then 60
                when public.bk_norm(a.first_name) = v_first and a.dob = v_dob then 50
                when public.bk_norm(a.last_name) = v_last and left(public.bk_norm(a.first_name), 3) = left(v_first, 3) then 40
                else 0 end as score,
                case
                when public.bk_norm(a.first_name) = v_first and public.bk_norm(a.last_name) = v_last and a.dob = v_dob then 'NAME_DOB'
                when public.bk_norm(a.first_name) = v_first and public.bk_norm(a.last_name) = v_last then 'NAME'
                when public.bk_norm(a.first_name) = v_last and public.bk_norm(a.last_name) = v_first then 'NAME_SWAPPED'
                when public.bk_norm(a.last_name) = v_last and a.dob = v_dob then 'LAST_NAME_DOB'
                when public.bk_norm(a.first_name) = v_first and a.dob = v_dob then 'FIRST_NAME_DOB'
                else 'NAME_SIMILAR' end as reason) m
           where a.org_id = v_org and (v_first is not null or v_last is not null) and m.score > 0
           order by m.score desc limit 10) y), '[]'::jsonb),
    'payers', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'name', p.name, 'email', p.email, 'family_id', p.family_id,
                                          'reason', case when v_email is not null and lower(p.email::text) = v_email then 'EMAIL' else 'NAME' end))
        from (select * from public.billing_payers p
               where p.org_id = v_org and p.is_active
                 and ((v_email is not null and lower(p.email::text) = v_email)
                      or (v_pname is not null and public.bk_norm(p.name) = v_pname))
               limit 10) p), '[]'::jsonb),
    'families', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'contact_name', f.contact_name, 'reason', 'EMAIL'))
        from (select * from public.families f
               where f.org_id = v_org and v_email is not null and lower(f.contact_email::text) = v_email limit 10) f), '[]'::jsonb),
    'guardians', coalesce((
      select jsonb_agg(jsonb_build_object('profile_id', g.id, 'full_name', g.full_name, 'family_id', g.family_id, 'reason', 'EMAIL'))
        from (select distinct on (pf.id) pf.id, pf.full_name, fm.family_id
                from public.profiles pf
                join public.family_members fm on fm.profile_id = pf.id
                join public.families f on f.id = fm.family_id and f.org_id = v_org
               where v_email is not null and lower(pf.email) = v_email
               order by pf.id limit 10) g), '[]'::jsonb));
end $$;

-- Create an athlete from the booking form. Never creates a membership,
-- roster row or programme enrolment.
create or replace function public.athlete_quick_create(p_payload jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid := public.current_org_id();
  v_rep     jsonb;
  v_first   text := btrim(coalesce(p_payload->>'first_name', ''));
  v_last    text := btrim(coalesce(p_payload->>'last_name', ''));
  v_dob     date;
  v_minor   boolean;
  v_family  uuid := nullif(p_payload->>'family_id', '')::uuid;
  v_guard   uuid := nullif(p_payload->>'guardian_profile_id', '')::uuid;
  nf        jsonb := p_payload->'new_family';
  cp        jsonb := p_payload->'create_payer';
  v_email   text := nullif(btrim(coalesce(p_payload->>'email', '')), '');
  v_phone   text := nullif(btrim(coalesce(p_payload->>'phone', '')), '');
  v_created boolean := false;
  v_ath     uuid;
  v_payer   uuid;
  v_dups    jsonb;
  v_res     jsonb;
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  v_rep := public.bk_replay(p_request_id, 'athlete_create');
  if v_rep is not null then return v_rep; end if;

  if length(v_first) = 0 or length(v_first) > 80 or length(v_last) = 0 or length(v_last) > 80 then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001';
  end if;
  begin
    v_dob := nullif(p_payload->>'dob', '')::date;
  exception when others then v_dob := null; end;
  if v_dob is null then raise exception 'DOB_REQUIRED' using errcode = 'P0001'; end if;
  if v_dob > public.ta_today(v_org) or v_dob < date '1900-01-01' then raise exception 'INVALID_DOB' using errcode = 'P0001'; end if;
  v_minor := age(public.ta_today(v_org), v_dob) < interval '18 years';
  if v_email is not null and not public.ta_plausible_email(v_email) then raise exception 'INVALID_EMAIL' using errcode = 'P0001'; end if;

  -- Possible duplicates must be confirmed explicitly.
  if not coalesce((p_payload->>'confirm_duplicate')::boolean, false) then
    v_dups := public.people_duplicate_check(jsonb_build_object('first_name', v_first, 'last_name', v_last, 'dob', v_dob))->'athletes';
    select coalesce(jsonb_agg(d), '[]'::jsonb) into v_dups from jsonb_array_elements(v_dups) d where (d->>'score')::int >= 60;
    if jsonb_array_length(v_dups) > 0 then
      return jsonb_build_object('ok', false, 'code', 'DUPLICATE_SUSPECTED', 'candidates', v_dups);
    end if;
  end if;

  if v_guard is not null then
    select fm.family_id into v_family from public.family_members fm join public.families f on f.id = fm.family_id
     where fm.profile_id = v_guard and f.org_id = v_org and (v_family is null or fm.family_id = v_family)
     order by fm.is_primary desc, fm.created_at limit 1;
    if v_family is null then raise exception 'GUARDIAN_NOT_FOUND' using errcode = 'P0002'; end if;
  elsif v_family is not null then
    if not exists (select 1 from public.families where id = v_family and org_id = v_org) then
      raise exception 'FAMILY_NOT_FOUND' using errcode = 'P0002';
    end if;
  elsif nf is not null and jsonb_typeof(nf) = 'object' then
    if length(btrim(coalesce(nf->>'contact_name', ''))) = 0 then raise exception 'GUARDIAN_NAME_REQUIRED' using errcode = 'P0001'; end if;
    if nullif(btrim(coalesce(nf->>'contact_email', '')), '') is null and nullif(btrim(coalesce(nf->>'contact_phone', '')), '') is null then
      raise exception 'GUARDIAN_CONTACT_REQUIRED' using errcode = 'P0001';
    end if;
    if nullif(btrim(coalesce(nf->>'contact_email', '')), '') is not null and not public.ta_plausible_email(btrim(nf->>'contact_email')) then
      raise exception 'INVALID_EMAIL' using errcode = 'P0001';
    end if;
    insert into public.families (org_id, name, contact_name, contact_email, phone, address, postal_code, city)
    values (v_org, left(coalesce(nullif(btrim(coalesce(nf->>'name', '')), ''), v_last), 120), left(btrim(nf->>'contact_name'), 140),
            nullif(btrim(coalesce(nf->>'contact_email', '')), ''), nullif(btrim(coalesce(nf->>'contact_phone', '')), ''),
            nullif(btrim(coalesce(nf->>'street', '')), ''), nullif(btrim(coalesce(nf->>'postal_code', '')), ''),
            nullif(btrim(coalesce(nf->>'city', '')), ''))
    returning id into v_family;
    v_created := true;
  elsif v_minor then
    raise exception 'GUARDIAN_REQUIRED' using errcode = 'P0001';
  else
    -- An adult without a family gets a household of their own (athletes
    -- always belong to a family; it carries the contact and the invoices).
    insert into public.families (org_id, name, contact_name, contact_email, phone)
    values (v_org, left(v_last, 120), left(v_first || ' ' || v_last, 140), v_email, v_phone)
    returning id into v_family;
    v_created := true;
  end if;

  insert into public.athletes (org_id, family_id, first_name, last_name, dob, gender, status)
  values (v_org, v_family, v_first, v_last, v_dob, nullif(btrim(coalesce(p_payload->>'gender', '')), ''), 'active')
  returning id into v_ath;

  if cp is not null and jsonb_typeof(cp) = 'object' then
    v_payer := (public.bk_payer_upsert(cp || jsonb_build_object(
                  'family_id', coalesce(nullif(cp->>'family_id', ''), v_family::text),
                  'athlete_id', case when cp->>'kind' = 'athlete' then v_ath::text else nullif(cp->>'athlete_id', '') end,
                  'name', coalesce(nullif(btrim(coalesce(cp->>'name', '')), ''),
                                   case when cp->>'kind' = 'athlete' then v_first || ' ' || v_last end,
                                   (select coalesce(contact_name, name) from public.families where id = v_family))),
                null)->>'payer_id')::uuid;
  end if;

  v_res := jsonb_build_object('ok', true, 'athlete_id', v_ath, 'family_id', v_family, 'created_family', v_created,
                              'payer_id', v_payer, 'is_minor', v_minor);
  return public.bk_remember(p_request_id, 'athlete_create', v_res);
end $$;

-- Payer insert / update (internal; role checked by the callers).
create or replace function public.bk_payer_upsert(p jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org   uuid := public.current_org_id();
  v_id    uuid := nullif(p->>'id', '')::uuid;
  v_kind  text := coalesce(nullif(p->>'kind', ''), 'guardian');
  v_prof  uuid := nullif(p->>'profile_id', '')::uuid;
  v_fam   uuid := nullif(p->>'family_id', '')::uuid;
  v_ath   uuid := nullif(p->>'athlete_id', '')::uuid;
  v_name  text := btrim(coalesce(p->>'name', ''));
  v_email text := nullif(btrim(coalesce(p->>'email', '')), '');
  v_ctry  text := upper(nullif(btrim(coalesce(p->>'country', '')), ''));
begin
  if v_kind not in ('athlete', 'guardian', 'sponsor', 'other') then raise exception 'INVALID_PAYER_KIND' using errcode = 'P0001'; end if;
  if length(v_name) = 0 or length(v_name) > 140 then raise exception 'PAYER_NAME_REQUIRED' using errcode = 'P0001'; end if;
  if v_email is not null and not public.ta_plausible_email(v_email) then raise exception 'INVALID_EMAIL' using errcode = 'P0001'; end if;
  if v_ctry is not null and v_ctry !~ '^[A-Z]{2}$' then raise exception 'INVALID_COUNTRY' using errcode = 'P0001'; end if;
  if v_prof is not null then
    -- a login can only be attached when it is a guardian (or the player) in this club
    if not exists (select 1 from public.family_members fm join public.families f on f.id = fm.family_id
                    where fm.profile_id = v_prof and f.org_id = v_org)
       and not exists (select 1 from public.athletes a where a.player_profile_id = v_prof and a.org_id = v_org) then
      raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;
  if v_kind = 'athlete' and v_ath is null then raise exception 'ATHLETE_REQUIRED' using errcode = 'P0001'; end if;
  if v_ath is not null and not exists (select 1 from public.athletes where id = v_ath and org_id = v_org) then
    raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_fam is not null and not exists (select 1 from public.families where id = v_fam and org_id = v_org) then
    raise exception 'FAMILY_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_id is null then
    if p_request_id is not null then
      select id into v_id from public.billing_payers where org_id = v_org and request_id = p_request_id;
      if v_id is not null then return jsonb_build_object('payer_id', v_id, 'replayed', true); end if;
    end if;
    insert into public.billing_payers (org_id, kind, profile_id, family_id, athlete_id, name, email, phone, street, postal_code,
                                       city, country, notes, request_id, created_by)
    values (v_org, v_kind, v_prof, v_fam, v_ath, v_name, v_email, nullif(btrim(coalesce(p->>'phone', '')), ''),
            nullif(btrim(coalesce(p->>'street', '')), ''), nullif(btrim(coalesce(p->>'postal_code', '')), ''),
            nullif(btrim(coalesce(p->>'city', '')), ''), v_ctry, nullif(btrim(coalesce(p->>'notes', '')), ''), p_request_id, auth.uid())
    returning id into v_id;
  else
    update public.billing_payers
       set kind = v_kind, profile_id = v_prof, family_id = v_fam, athlete_id = v_ath, name = v_name, email = v_email,
           phone = nullif(btrim(coalesce(p->>'phone', '')), ''), street = nullif(btrim(coalesce(p->>'street', '')), ''),
           postal_code = nullif(btrim(coalesce(p->>'postal_code', '')), ''), city = nullif(btrim(coalesce(p->>'city', '')), ''),
           country = v_ctry, notes = nullif(btrim(coalesce(p->>'notes', '')), ''),
           is_active = coalesce((p->>'is_active')::boolean, is_active)
     where id = v_id and org_id = v_org;
    if not found then raise exception 'PAYER_NOT_FOUND' using errcode = 'P0002'; end if;
  end if;
  return jsonb_build_object('payer_id', v_id, 'replayed', false);
end $$;

create or replace function public.billing_payer_save(p_payload jsonb, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  return jsonb_build_object('ok', true) || public.bk_payer_upsert(coalesce(p_payload, '{}'::jsonb), p_request_id);
end $$;

-- Bill To choices for an athlete: saved payers of the family / athlete, the
-- family's guardians (with or without a login) and the family contact.
create or replace function public.billing_payer_candidates(p_athlete uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare a public.athletes;
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into a from public.athletes where id = p_athlete and org_id = public.current_org_id();
  if not found then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'payers', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'name', p.name, 'email', p.email,
                                                            'has_account', p.profile_id is not null, 'family_id', p.family_id,
                                                            'athlete_id', p.athlete_id, 'city', p.city) order by p.name)
                          from public.billing_payers p
                         where p.org_id = a.org_id and p.is_active and (p.family_id = a.family_id or p.athlete_id = a.id)), '[]'::jsonb),
    'guardians', coalesce((select jsonb_agg(jsonb_build_object('profile_id', pf.id, 'full_name', pf.full_name, 'email', pf.email,
                                                               'is_primary', fm.is_primary, 'can_pay', fm.can_pay,
                                                               'payer_id', (select p.id from public.billing_payers p
                                                                             where p.org_id = a.org_id and p.profile_id = pf.id and p.is_active
                                                                             order by p.created_at limit 1))
                                            order by fm.is_primary desc, pf.full_name)
                             from public.family_members fm join public.profiles pf on pf.id = fm.profile_id
                            where fm.family_id = a.family_id), '[]'::jsonb),
    'family_default', public.bk_payer_snapshot(a.org_id, null, a.family_id));
end $$;

-- ===========================================================================
-- 10. Reads (role-checked)
-- ===========================================================================
create or replace function public.training_service_catalog(p_include_inactive boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id();
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'slug', s.slug, 'name', s.name, 'kind', s.kind, 'session_type', s.session_type,
             'is_active', s.is_active, 'billing_category', s.billing_category,
             'price', s.price_chf, 'currency', public.bk_currency(s), 'duration_min', s.duration_min,
             'max_participants', s.max_participants, 'min_participants', s.min_participants,
             'venue_id', s.venue_id, 'venue_name', (select v.name from public.venues v where v.id = s.venue_id),
             'default_venue_space_id', s.default_venue_space_id,
             'default_venue_space_name', (select vs.name from public.venue_spaces vs where vs.id = s.default_venue_space_id),
             'location_text', s.location_text, 'credits_required', s.credits_required,
             'coaches', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'display_name', c.display_name) order by c.display_name)
                                    from public.coaches c
                                   where c.org_id = s.org_id and c.is_active and public.bk_coach_eligible(s.id, c.id)), '[]'::jsonb),
             'packages', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name)) from public.credit_packages p
                                    where p.service_id = s.id), '[]'::jsonb),
             'setup_missing', to_jsonb(public.bk_setup_missing(s)),
             'number_prefix', public.billing_series_prefix(s.org_id, s.billing_category))
           order by s.sort_order, s.name)
      from public.training_services s
     where s.org_id = v_org and (p_include_inactive or s.is_active)), '[]'::jsonb);
end $$;

-- One booking row for staff lists.
create or replace function public.bk_row(b public.training_bookings)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'booking_id', b.id, 'status', b.status,
    'state', case b.status::text when 'booked' then 'confirmed' else b.status::text end,
    'billing_status', public.booking_billing_status(b.id), 'billing_mode', b.billing_mode,
    'slot_start', b.slot_start, 'slot_end', b.slot_end, 'created_via', b.created_via, 'created_at', b.created_at,
    'service', jsonb_build_object('id', ts.id, 'name', ts.name, 'kind', ts.kind, 'billing_category', ts.billing_category),
    'coach', jsonb_build_object('id', c.id, 'display_name', c.display_name),
    'athlete', jsonb_build_object('id', a.id, 'first_name', a.first_name, 'last_name', a.last_name, 'family_id', a.family_id),
    'payer', case when b.payer_id is not null then jsonb_build_object('id', p.id, 'kind', p.kind, 'name', p.name) end,
    'session', case when s.id is not null then jsonb_build_object('id', s.id, 'event_id', s.event_id, 'status', s.status,
                                                                 'capacity', s.capacity, 'participants', public.bk_session_count(s.id),
                                                                 'rescheduled_from', s.rescheduled_from) end,
    'location', coalesce((select v.name from public.venues v where v.id = b.venue_id), b.location_text),
    'price', b.price_chf, 'list_price', b.list_price, 'currency', coalesce(b.currency, i.currency, public.bk_currency(ts)),
    'price_override_reason', b.price_override_reason,
    'invoice', case when i.id is not null then jsonb_build_object(
                 'id', i.id, 'number', i.number, 'status', i.status, 'due_date', i.due_date,
                 'total', i.total_chf + i.adjustments_total, 'paid', public.invoice_net_paid(i.id),
                 'balance', i.total_chf + i.adjustments_total - public.invoice_net_paid(i.id)) end,
    'warnings', b.warnings, 'cancel_reason', b.cancel_reason, 'cancelled_at', b.cancelled_at)
    from public.training_services ts
    left join public.coaches c on c.id = b.coach_id
    left join public.athletes a on a.id = b.athlete_id
    left join public.billing_payers p on p.id = b.payer_id
    left join public.training_sessions s on s.id = b.session_id
    left join public.invoices i on i.id = b.invoice_id
   where ts.id = b.service_id;
$$;

create or replace function public.booking_list(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f       jsonb := coalesce(p_filters, '{}'::jsonb);
  v_org   uuid := public.current_org_id();
  v_limit int := greatest(1, least(coalesce((f->>'limit')::int, 50), 200));
  v_off   int := greatest(0, coalesce((f->>'offset')::int, 0));
  v_q     text := public.bk_norm(f->>'search');
  v_rows  jsonb;
  v_total int;
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  with base as (
    select b.* from public.training_bookings b
      join public.athletes a on a.id = b.athlete_id
     where b.org_id = v_org
       and (f->>'from' is null or b.slot_start >= (f->>'from')::timestamptz)
       and (f->>'to' is null or b.slot_start < (f->>'to')::timestamptz)
       and (f->>'status' is null or b.status::text = f->>'status')
       and (f->>'coach_id' is null or b.coach_id = (f->>'coach_id')::uuid)
       and (f->>'service_id' is null or b.service_id = (f->>'service_id')::uuid)
       and (f->>'athlete_id' is null or b.athlete_id = (f->>'athlete_id')::uuid)
       and (f->>'payer_id' is null or b.payer_id = (f->>'payer_id')::uuid)
       and (v_q is null or public.bk_norm(a.first_name || ' ' || a.last_name) like '%' || v_q || '%')
       and (f->>'billing_status' is null or public.booking_billing_status(b.id) = f->>'billing_status')
  )
  select (select count(*) from base),
         coalesce((select jsonb_agg(public.bk_row(x) order by x.slot_start desc)
                     from (select * from base order by slot_start desc limit v_limit offset v_off) x), '[]'::jsonb)
    into v_total, v_rows;
  return jsonb_build_object('rows', v_rows, 'total', v_total, 'limit', v_limit, 'offset', v_off);
end $$;

create or replace function public.booking_detail(p_booking uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare b public.training_bookings; a public.athletes;
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into b from public.training_bookings where id = p_booking and org_id = public.current_org_id();
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into a from public.athletes where id = b.athlete_id;
  return public.bk_row(b) || jsonb_build_object(
    'notes', b.notes, 'availability_override_reason', b.availability_override_reason,
    'recipient', public.bk_payer_snapshot(b.org_id, b.payer_id, a.family_id),
    'participants', coalesce((select jsonb_agg(jsonb_build_object('booking_id', o.id, 'athlete_id', o.athlete_id,
                                                                  'first_name', oa.first_name, 'last_name', oa.last_name,
                                                                  'status', o.status) order by oa.last_name, oa.first_name)
                                from public.training_bookings o join public.athletes oa on oa.id = o.athlete_id
                               where b.session_id is not null and o.session_id = b.session_id
                                 and o.status in ('booked', 'completed', 'no_show')), '[]'::jsonb),
    'entitlement', (select jsonb_build_object('purchase_id', e.purchase_id, 'consumed_at', e.consumed_at, 'restored_at', e.restored_at,
                                              'sessions', tp.sessions, 'sessions_used', tp.sessions_used)
                      from public.training_booking_entitlements e join public.training_package_purchases tp on tp.id = e.purchase_id
                     where e.booking_id = b.id),
    'attendance', (select jsonb_build_object('sheet_status', sh.status, 'status', m.status, 'finalized_status', m.finalized_status)
                     from public.training_sessions s
                     join public.team_attendance_sheets sh on sh.event_id = s.event_id
                     left join public.team_attendance_marks m on m.sheet_id = sh.id and m.athlete_id = b.athlete_id
                    where s.id = b.session_id),
    'notifications', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'recipient_kind', n.recipient_kind,
                                                                   'recipient_name', n.recipient_name, 'recipient_email', n.recipient_email,
                                                                   'status', n.status, 'attempts', n.attempts, 'last_error', n.last_error,
                                                                   'sent_at', n.sent_at, 'created_at', n.created_at) order by n.created_at)
                                 from public.booking_notifications n where n.booking_id = b.id), '[]'::jsonb),
    'invoice_deliveries', coalesce((select jsonb_agg(jsonb_build_object('email_log_id', l.id, 'to_email', l.to_email, 'status', l.status,
                                                                        'error', l.error, 'attempts', l.attempts, 'sent_at', l.sent_at,
                                                                        'created_at', l.created_at) order by l.created_at)
                                      from public.email_logs l where b.invoice_id is not null and l.invoice_id = b.invoice_id), '[]'::jsonb),
    'invoice_preview', case when b.invoice_id is null then public.booking_invoice_preview(b.id) end);
end $$;

create or replace function public.bookings_to_invoice(p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  return coalesce((
    select jsonb_agg(public.bk_row(b) order by b.slot_start)
      from (select b.* from public.training_bookings b
             where b.org_id = public.current_org_id() and b.status in ('booked', 'completed', 'no_show')
               and b.invoice_id is null and coalesce(b.price_chf, 0) > 0
               and coalesce(b.billing_mode, case when b.purchase_id is null and coalesce(b.credits_used, 0) = 0 then 'invoice' end) = 'invoice'
             order by b.slot_start
             limit greatest(1, least(coalesce(p_limit, 100), 500))) b), '[]'::jsonb);
end $$;

-- Athlete booking history for staff (admin/finance).
create or replace function public.athlete_booking_history(p_athlete uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.athletes where id = p_athlete and org_id = public.current_org_id()) then
    raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'upcoming', coalesce((select jsonb_agg(public.bk_row(b) order by b.slot_start)
                            from public.training_bookings b
                           where b.athlete_id = p_athlete and b.slot_start >= now() and b.status = 'booked'), '[]'::jsonb),
    'past', coalesce((select jsonb_agg(public.bk_row(b) order by b.slot_start desc)
                        from (select * from public.training_bookings b
                               where b.athlete_id = p_athlete and (b.slot_start < now() or b.status <> 'booked')
                               order by b.slot_start desc limit 200) b), '[]'::jsonb));
end $$;

-- Coach agenda: sessions the coach leads, roster names only (no payer, no money).
create or replace function public.coach_booking_agenda(p_from timestamptz default null, p_to timestamptz default null, p_coach uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_coach uuid;
begin
  if p_coach is not null and public.is_admin() then v_coach := p_coach; else v_coach := public.current_coach_id(); end if;
  if v_coach is null then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'session_id', s.id, 'event_id', s.event_id, 'service_id', s.service_id, 'service_name', ts.name, 'kind', ts.kind,
             'starts_at', s.starts_at, 'ends_at', s.ends_at, 'status', s.status, 'rescheduled_from', s.rescheduled_from,
             'location', coalesce((select v.name from public.venues v where v.id = s.venue_id), s.location_text),
             'venue_space', (select vs.name from public.venue_spaces vs where vs.id = s.venue_space_id),
             'capacity', s.capacity, 'participants_count', public.bk_session_count(s.id),
             'sheet_status', (select sh.status from public.team_attendance_sheets sh where sh.event_id = s.event_id),
             'participants', coalesce((select jsonb_agg(jsonb_build_object('athlete_id', a.id, 'first_name', a.first_name,
                                                                           'last_name', a.last_name, 'booking_status', b.status)
                                                        order by a.last_name, a.first_name)
                                         from public.training_bookings b join public.athletes a on a.id = b.athlete_id
                                        where b.session_id = s.id and b.status in ('booked', 'completed', 'no_show')), '[]'::jsonb))
           order by s.starts_at)
      from public.training_sessions s join public.training_services ts on ts.id = s.service_id
     where s.org_id = public.current_org_id() and s.coach_id = v_coach
       and s.starts_at >= coalesce(p_from, now() - interval '1 day')
       and s.starts_at < coalesce(p_to, now() + interval '14 days')), '[]'::jsonb);
end $$;

-- Is this invoice one the signed-in guardian may see as its payer?
create or replace function public.bk_guardian_sees_invoice(p_invoice uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.invoices i
                  where i.id = p_invoice and i.org_id = public.current_org_id() and i.status::text <> 'draft'
                    and public.is_guardian_of_family(i.family_id)
                    and (i.payer_profile_id = auth.uid()
                         or (i.payer_profile_id is null and coalesce(i.payer_kind, 'family') not in ('sponsor', 'other'))));
$$;

create or replace function public.bk_portal_rows(p_athlete uuid, p_money boolean)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'athlete', (select jsonb_build_object('id', a.id, 'first_name', a.first_name, 'last_name', a.last_name)
                  from public.athletes a where a.id = p_athlete),
    'upcoming', coalesce((
      select jsonb_agg(jsonb_build_object(
               'booking_id', b.id, 'service_name', ts.name, 'coach_name', c.display_name,
               'starts_at', b.slot_start, 'ends_at', b.slot_end, 'status', b.status,
               'rescheduled_from', s.rescheduled_from, 'rescheduled_at', b.rescheduled_at,
               'location', coalesce((select v.name from public.venues v where v.id = b.venue_id), b.location_text))
             order by b.slot_start)
        from public.training_bookings b
        join public.training_services ts on ts.id = b.service_id
        left join public.coaches c on c.id = b.coach_id
        left join public.training_sessions s on s.id = b.session_id
       where b.athlete_id = p_athlete and b.status = 'booked' and b.slot_end >= now()), '[]'::jsonb),
    'changes', coalesce((
      select jsonb_agg(jsonb_build_object('booking_id', b.id, 'service_name', ts.name, 'starts_at', b.slot_start,
                                          'change', case when b.status = 'cancelled' then 'cancelled' else 'rescheduled' end,
                                          'at', coalesce(b.cancelled_at, b.rescheduled_at))
             order by coalesce(b.cancelled_at, b.rescheduled_at) desc)
        from public.training_bookings b join public.training_services ts on ts.id = b.service_id
       where b.athlete_id = p_athlete
         and ((b.status = 'cancelled' and b.cancelled_at >= now() - interval '30 days')
              or (b.rescheduled_at is not null and b.rescheduled_at >= now() - interval '30 days'))), '[]'::jsonb),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object('event_id', e.id, 'service_name', ts.name, 'starts_at', e.starts_at,
                                          'status', m.finalized_status) order by e.starts_at desc)
        from public.team_attendance_marks m
        join public.team_attendance_sheets sh on sh.id = m.sheet_id and sh.finalize_count > 0
        join public.events e on e.id = m.event_id and e.training_session_id is not null
        join public.training_sessions s on s.id = e.training_session_id
        join public.training_services ts on ts.id = s.service_id
       where m.athlete_id = p_athlete and m.finalized_status is not null), '[]'::jsonb),
    'invoices', case when p_money then coalesce((
      select jsonb_agg(jsonb_build_object('invoice_id', i.id, 'number', i.number, 'status', i.status, 'due_date', i.due_date,
                                          'currency', i.currency, 'total', i.total_chf + i.adjustments_total,
                                          'balance', i.total_chf + i.adjustments_total - public.invoice_net_paid(i.id),
                                          'booking_id', b.id, 'service_name', ts.name) order by i.issued_at desc)
        from public.training_bookings b
        join public.invoices i on i.id = b.invoice_id
        join public.training_services ts on ts.id = b.service_id
       where b.athlete_id = p_athlete and public.bk_guardian_sees_invoice(i.id)), '[]'::jsonb) else '[]'::jsonb end);
$$;

-- Guardian portal: own children only; invoices only where they are the payer.
create or replace function public.guardian_booking_overview(p_athlete uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.current_org_id() is null then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_athlete is not null and not public.is_guardian_of_athlete(p_athlete) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(public.bk_portal_rows(a.id, true) order by a.first_name)
      from public.athletes a
     where a.org_id = public.current_org_id() and a.archived_at is null
       and (p_athlete is null or a.id = p_athlete)
       and public.is_guardian_of_athlete(a.id)), '[]'::jsonb);
end $$;

-- Player portal: own bookings and attendance, no money.
create or replace function public.player_booking_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_ath uuid := public.current_player_athlete_id();
begin
  if v_ath is null then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  return public.bk_portal_rows(v_ath, false);
end $$;

create or replace function public.booking_dashboard_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id(); v_tz text; v_day timestamptz;
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  v_tz := public.ta_tz(v_org);
  v_day := (public.ta_today(v_org)::timestamp) at time zone v_tz;
  return jsonb_build_object(
    'today', (select count(*) from public.training_bookings b where b.org_id = v_org and b.status in ('booked', 'completed', 'no_show')
                and b.slot_start >= v_day and b.slot_start < v_day + interval '1 day'),
    'next_7_days', (select count(*) from public.training_bookings b where b.org_id = v_org and b.status = 'booked'
                      and b.slot_start >= now() and b.slot_start < now() + interval '7 days'),
    'awaiting_invoice', (select count(*) from public.training_bookings b
                          where b.org_id = v_org and b.status in ('booked', 'completed', 'no_show') and b.invoice_id is null
                            and coalesce(b.price_chf, 0) > 0
                            and coalesce(b.billing_mode, case when b.purchase_id is null and coalesce(b.credits_used, 0) = 0 then 'invoice' end) = 'invoice'),
    'outstanding', coalesce((select jsonb_agg(jsonb_build_object('currency', x.currency, 'amount', x.amount, 'count', x.n))
                               from (select i.currency, sum(i.total_chf + i.adjustments_total - public.invoice_net_paid(i.id)) as amount, count(*) as n
                                       from public.invoices i
                                      where i.org_id = v_org and i.status::text in ('pending', 'sent', 'partially_paid', 'overdue')
                                        and exists (select 1 from public.training_bookings b where b.invoice_id = i.id)
                                      group by i.currency) x), '[]'::jsonb),
    'failed_notifications', (select count(*) from public.booking_notifications n
                              where n.org_id = v_org and n.status in ('failed', 'no_contact')));
end $$;

-- Staff follow-up: notification deliveries that failed or had no contact,
-- and booking invoices whose e-mail failed.
create or replace function public.booking_followups(p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id(); v_lim int := greatest(1, least(coalesce(p_limit, 100), 500));
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  return jsonb_build_object(
    'notifications', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'booking_id', n.booking_id, 'kind', n.kind, 'recipient_kind', n.recipient_kind,
                                          'recipient_name', n.recipient_name, 'status', n.status, 'attempts', n.attempts,
                                          'last_error', n.last_error, 'created_at', n.created_at,
                                          'athlete_name', a.first_name || ' ' || a.last_name, 'starts_at', b.slot_start)
             order by n.created_at desc)
        from (select * from public.booking_notifications n
               where n.org_id = v_org and (n.status in ('failed', 'no_contact') or (n.status = 'sending' and n.claimed_at < now() - interval '10 minutes'))
               order by n.created_at desc limit v_lim) n
        join public.training_bookings b on b.id = n.booking_id
        join public.athletes a on a.id = b.athlete_id), '[]'::jsonb),
    'invoice_emails', coalesce((
      select jsonb_agg(jsonb_build_object('email_log_id', l.id, 'invoice_id', l.invoice_id, 'number', i.number, 'to_email', l.to_email,
                                          'error', l.error, 'attempts', l.attempts, 'created_at', l.created_at, 'booking_id', b.id)
             order by l.created_at desc)
        from (select * from public.email_logs l where l.org_id = v_org and l.status::text = 'failed' and l.invoice_id is not null
               order by l.created_at desc limit v_lim) l
        join public.invoices i on i.id = l.invoice_id
        join public.training_bookings b on b.invoice_id = i.id), '[]'::jsonb));
end $$;

-- Review flags of the service catalogue (refreshed by the migration and on
-- demand): services without an eligible coach, paid services whose billing
-- setup is incomplete. Fixed services resolve their flags.
create or replace function public.booking_review_flags(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer := 0; v_k integer;
begin
  if not (public.is_service_caller() or (p_org = public.current_org_id() and public.is_admin())) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
  select s.org_id, 'training_services', s.id, 'SERVICE_WITHOUT_COACH', jsonb_build_object('name', s.name, 'slug', s.slug)
    from public.training_services s
   where s.org_id = p_org and s.is_active
     and not exists (select 1 from public.coaches c where c.org_id = s.org_id and c.is_active and public.bk_coach_eligible(s.id, c.id))
  on conflict do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;
  insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
  select s.org_id, 'training_services', s.id, 'SERVICE_BILLING_SETUP',
         jsonb_build_object('name', s.name, 'missing', to_jsonb(public.bk_setup_missing(s)))
    from public.training_services s
   where s.org_id = p_org and s.is_active and cardinality(public.bk_setup_missing(s)) > 0
  on conflict do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;
  update public.data_review_flags f
     set resolved_at = now(), resolution_note = 'setup complete'
   where f.org_id = p_org and f.resolved_at is null and f.entity_table = 'training_services'
     and ((f.reason_code = 'SERVICE_BILLING_SETUP'
           and exists (select 1 from public.training_services s where s.id = f.entity_id
                        and (not s.is_active or cardinality(public.bk_setup_missing(s)) = 0)))
       or (f.reason_code = 'SERVICE_WITHOUT_COACH'
           and exists (select 1 from public.training_services s where s.id = f.entity_id
                        and (not s.is_active or exists (select 1 from public.coaches c where c.org_id = s.org_id and c.is_active
                                                          and public.bk_coach_eligible(s.id, c.id))))));
  return v_n;
end $$;

-- Eligible coaches of a service (admin): full replace.
create or replace function public.training_service_coaches_set(p_service uuid, p_coaches uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id();
begin
  if not (v_org is not null and public.is_admin()) then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.training_services where id = p_service and org_id = v_org) then
    raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if exists (select 1 from unnest(coalesce(p_coaches, '{}')) c
              where not exists (select 1 from public.coaches x where x.id = c and x.org_id = v_org)) then
    raise exception 'COACH_NOT_FOUND' using errcode = 'P0002';
  end if;
  delete from public.training_service_coaches where service_id = p_service and not (coach_id = any(coalesce(p_coaches, '{}')));
  insert into public.training_service_coaches (org_id, service_id, coach_id, created_by)
  select v_org, p_service, c, auth.uid() from unnest(coalesce(p_coaches, '{}')) c
  on conflict (service_id, coach_id) do nothing;
  perform public.booking_review_flags(v_org);
  return jsonb_build_object('ok', true, 'coaches', (select count(*) from public.training_service_coaches where service_id = p_service));
end $$;

-- ===========================================================================
-- 11. Attendance for training sessions (backward compatible)
-- Generated from the current definitions (20250420104000..104300) with the
-- session-event branches added; team behaviour is unchanged.
-- ===========================================================================
-- Session events (training_session_id) take a sheet without a team.
create or replace function public.ta_event_for_write(p_event uuid)
 RETURNS events
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_ev public.events%rowtype;
begin
  select * into v_ev from public.events where id = p_event;
  if not found or v_ev.org_id is distinct from public.current_org_id() then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.ta_can_run(p_event) then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if v_ev.team_id is null and v_ev.training_session_id is null then raise exception 'EVENT_HAS_NO_TEAM' using errcode = 'P0001'; end if;
  if not (v_ev.type::text = any(public.ta_sheet_types())) then
    raise exception 'EVENT_TYPE_NOT_SUPPORTED' using errcode = 'P0001';
  end if;
  return v_ev;
end;
$function$;

-- Sheet builder: team roster, or the confirmed bookings of a session event.
create or replace function public.ta_sheet_sync(p_sheet uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s public.team_attendance_sheets%rowtype;
begin
  select * into s from public.team_attendance_sheets where id = p_sheet;
  if s.status <> 'draft' then return; end if;
  insert into public.team_attendance_marks (org_id, sheet_id, event_id, athlete_id, membership_id, is_guest, status, added_by)
  select s.org_id, s.id, s.event_id, r.athlete_id, r.membership_id, false, 'unmarked', auth.uid()
    from public.ta_roster_on(s.team_id, s.roster_date) r
   where s.team_id is not null
  on conflict (sheet_id, athlete_id) do nothing;
  -- Session sheets: the roster is the confirmed bookings of the session.
  insert into public.team_attendance_marks (org_id, sheet_id, event_id, athlete_id, membership_id, is_guest, status, added_by)
  select s.org_id, s.id, s.event_id, r.athlete_id, null, false, 'unmarked', auth.uid()
    from public.bk_event_roster(s.event_id) r
   where s.team_id is null
  on conflict (sheet_id, athlete_id) do nothing;
  delete from public.team_attendance_marks m
   where m.sheet_id = s.id and not m.is_guest and m.status = 'unmarked' and m.rev = 0
     and not exists (select 1 from public.ta_roster_on(s.team_id, s.roster_date) r where s.team_id is not null and r.athlete_id = m.athlete_id)
     and not exists (select 1 from public.bk_event_roster(s.event_id) r where s.team_id is null and r.athlete_id = m.athlete_id);
end;
$function$;

-- Sheet JSON: session events show the service name and the booking roster.
create or replace function public.ta_sheet_json(p_event uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ev    public.events%rowtype;
  s       public.team_attendance_sheets%rowtype;
  v_team  text;
  v_tz    text;
  v_marks jsonb;
  v_admin boolean := public.is_admin();
  v_tc    boolean;
  v_sub   boolean;
begin
  select * into v_ev from public.events where id = p_event;
  select name into v_team from public.teams where id = v_ev.team_id;
  if v_team is null and v_ev.training_session_id is not null then
    select ts.name into v_team from public.training_sessions x join public.training_services ts on ts.id = x.service_id
     where x.id = v_ev.training_session_id;
  end if;
  v_tz := public.ta_tz(v_ev.org_id);
  v_tc := v_ev.team_id is not null and public.coach_coaches_team(v_ev.team_id);
  v_sub := not v_tc and public.coach_can_run_event(p_event);
  select * into s from public.team_attendance_sheets where event_id = p_event;

  if s.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'mark_id', m.id, 'athlete_id', m.athlete_id, 'first_name', a.first_name, 'last_name', a.last_name,
             'jersey_number', coalesce(tm.jersey_number, pp.jersey_number), 'position', coalesce(tm.position, pp.position),
             'photo_path', case when public.athlete_has_media_consent(a.org_id, a.id) then a.photo_path end,
             'is_guest', m.is_guest, 'status', m.status, 'finalized_status', m.finalized_status, 'rev', m.rev,
             'note', m.note, 'updated_by', m.updated_by, 'updated_by_name', up.full_name, 'updated_at', m.updated_at,
             'reported_absence_ack', m.reported_absence_ack,
             'reported_absence', (select jsonb_build_object('report_id', r.id, 'reason', r.reason, 'reason_category', r.reason_category,
                                                            'status', r.status, 'needs_review', r.needs_review,
                                                            'reporter_kind', r.reporter_kind, 'created_at', r.created_at)
                                    from public.team_absence_reports r
                                   where r.event_id = p_event and r.athlete_id = m.athlete_id and r.status in ('reported', 'acknowledged')
                                   limit 1))
             order by m.is_guest, a.last_name, a.first_name), '[]'::jsonb)
      into v_marks
      from public.team_attendance_marks m
      join public.athletes a on a.id = m.athlete_id
      left join public.team_memberships tm on tm.id = m.membership_id and tm.team_id = s.team_id
      left join lateral (select p.jersey_number, p.position from public.team_membership_periods p
                          where p.team_id = s.team_id and p.athlete_id = m.athlete_id
                            and s.roster_date between p.joined_on and p.left_on limit 1) pp on tm.id is null
      left join public.profiles up on up.id = m.updated_by
     where m.sheet_id = s.id;
  else
    -- No sheet yet: preview of the roster of the event date (not saved).
    select coalesce(jsonb_agg(jsonb_build_object(
             'mark_id', null, 'athlete_id', r.athlete_id, 'first_name', a.first_name, 'last_name', a.last_name,
             'jersey_number', r.jersey_number, 'position', r.player_position,
             'photo_path', case when public.athlete_has_media_consent(a.org_id, a.id) then a.photo_path end,
             'is_guest', false, 'status', 'unmarked', 'finalized_status', null, 'rev', 0, 'note', null,
             'updated_by', null, 'updated_by_name', null, 'updated_at', null, 'reported_absence_ack', false,
             'reported_absence', (select jsonb_build_object('report_id', x.id, 'reason', x.reason, 'reason_category', x.reason_category,
                                                            'status', x.status, 'needs_review', x.needs_review,
                                                            'reporter_kind', x.reporter_kind, 'created_at', x.created_at)
                                    from public.team_absence_reports x
                                   where x.event_id = p_event and x.athlete_id = r.athlete_id and x.status in ('reported', 'acknowledged')
                                   limit 1))
             order by a.last_name, a.first_name), '[]'::jsonb)
      into v_marks
      from (select ro.athlete_id, ro.jersey_number, ro.player_position
              from public.ta_roster_on(v_ev.team_id, (v_ev.starts_at at time zone v_tz)::date) ro
             where v_ev.team_id is not null
            union all
            select br.athlete_id, null::smallint, null::text
              from public.bk_event_roster(v_ev.id) br
             where v_ev.team_id is null) r
      join public.athletes a on a.id = r.athlete_id;
  end if;

  return jsonb_build_object(
    'event', jsonb_build_object('id', v_ev.id, 'team_id', v_ev.team_id, 'team_name', v_team, 'type', v_ev.type,
                                'title', v_ev.title, 'training_session_id', v_ev.training_session_id, 'starts_at', v_ev.starts_at, 'ends_at', v_ev.ends_at,
                                'status', v_ev.status, 'cancel_reason', v_ev.cancel_reason, 'timezone', v_tz,
                                'local_date', (v_ev.starts_at at time zone v_tz)::date,
                                'ended', v_ev.ends_at < now(), 'tracked', public.ta_event_tracked(v_ev.id),
                                'location_name', coalesce((select name from public.venues where id = v_ev.venue_id), v_ev.location_name, v_ev.location_text)),
    'sheet', case when s.id is null then null else jsonb_build_object(
                'id', s.id, 'status', s.status, 'version', s.version, 'roster_date', s.roster_date,
                'led_by_coach_id', s.led_by_coach_id,
                'led_by_name', (select display_name from public.coaches where id = s.led_by_coach_id),
                'finalized_at', s.finalized_at, 'finalized_by', s.finalized_by, 'first_finalized_at', s.first_finalized_at,
                'reopened_at', s.reopened_at, 'finalize_count', s.finalize_count, 'correction_count', s.correction_count) end,
    'access', jsonb_build_object('is_admin', v_admin, 'is_team_coach', v_tc, 'is_substitute', v_sub,
                                 'can_edit', v_ev.status <> 'cancelled' and coalesce(s.status, 'draft') in ('draft', 'reopened'),
                                 'can_correct', s.status = 'final',
                                 'can_resolve_requests', v_admin or v_tc),
    'marks', v_marks,
    'counts', jsonb_build_object(
       'total', jsonb_array_length(v_marks),
       'unmarked', (select count(*) from jsonb_array_elements(v_marks) x where x->>'status' = 'unmarked'),
       'present', (select count(*) from jsonb_array_elements(v_marks) x where x->>'status' = 'present'),
       'late', (select count(*) from jsonb_array_elements(v_marks) x where x->>'status' = 'late'),
       'excused', (select count(*) from jsonb_array_elements(v_marks) x where x->>'status' = 'excused'),
       'unexcused', (select count(*) from jsonb_array_elements(v_marks) x where x->>'status' = 'unexcused'),
       'guests', (select count(*) from jsonb_array_elements(v_marks) x where (x->>'is_guest')::boolean),
       'reported_absences', (select count(*) from jsonb_array_elements(v_marks) x where x->'reported_absence' <> 'null'::jsonb)));
end;
$function$;

-- The coach leading a training session runs its sheet.
create or replace function public.coach_can_run_event(p_event uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.events e
     where e.id = p_event and e.org_id = public.current_org_id()
       and public.current_coach_id() is not null
       and ((e.team_id is not null and public.coach_coaches_team(e.team_id))
            or (e.training_session_id is not null and exists (
                  select 1 from public.training_sessions ts
                   where ts.id = e.training_session_id and ts.coach_id = public.current_coach_id()))
            or exists (
              select 1 from public.event_coach_assignments a
               where a.event_id = e.id and a.coach_id = public.current_coach_id() and a.status = 'approved'
                 and not exists (select 1 from public.team_attendance_sheets s
                                  where s.event_id = e.id and s.status = 'final'
                                    and s.finalized_at < now() - make_interval(days => public.ta_grace_days())))));
$function$;

-- Session coach is staff of the session event.
create or replace function public.ta_is_event_staff(p_event uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.events e
     where e.id = p_event and e.org_id = public.current_org_id()
       and (public.is_admin() or (e.team_id is not null and public.coach_coaches_team(e.team_id))
            or (e.training_session_id is not null and exists (
                  select 1 from public.training_sessions ts
                   where ts.id = e.training_session_id and ts.coach_id = public.current_coach_id()))));
$function$;

-- A player sees a session event only when booked on it.
create or replace function public.player_sees_event(p_event uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.events e
     where e.id = p_event and e.org_id = public.current_org_id() and public.current_player_athlete_id() is not null
       and ((e.team_id is null and e.training_session_id is null)
            or (e.training_session_id is not null and exists (
                  select 1 from public.training_bookings b
                   where b.session_id = e.training_session_id and b.athlete_id = public.current_player_athlete_id()))
            or exists (select 1 from public.ta_roster_on(e.team_id, (e.starts_at at time zone public.ta_tz(e.org_id))::date) r
                        where r.athlete_id = public.current_player_athlete_id())
            or (e.starts_at >= now() and exists (
                  select 1 from public.ta_roster_on(e.team_id, public.ta_today(e.org_id)) r
                   where r.athlete_id = public.current_player_athlete_id()))));
$function$;

-- TRAINING_WITHOUT_TEAM ignores training-session events (their roster is the bookings).
create or replace function public.attendance_review_flags(p_org uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_n integer := 0; v_k integer;
begin
  if not (public.is_service_caller() or (p_org = public.current_org_id() and public.is_admin())) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
  select tm.org_id, 'team_memberships', tm.id, 'MEMBERSHIP_INACTIVE_NO_END',
         jsonb_build_object('team_id', tm.team_id, 'athlete_id', tm.athlete_id, 'joined_on', tm.joined_on)
    from public.team_memberships tm
   where tm.org_id = p_org and tm.status = 'inactive' and tm.left_on is null
  on conflict do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
  select tm.org_id, 'team_memberships', tm.id, 'MEMBERSHIP_DATE_UNCERTAIN',
         jsonb_build_object('team_id', tm.team_id, 'athlete_id', tm.athlete_id, 'joined_on', tm.joined_on)
    from public.team_memberships tm
   where tm.org_id = p_org and tm.dates_source = 'uncertain'
  on conflict do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
  select e.org_id, 'events', e.id, 'TRAINING_WITHOUT_TEAM',
         jsonb_build_object('starts_at', e.starts_at, 'title', e.title)
    from public.events e
   where e.org_id = p_org and e.type = 'training' and e.team_id is null and e.training_session_id is null and e.status <> 'cancelled'
     and public.ta_event_tracked(e.id)
  on conflict do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
  select t.org_id, 'teams', t.id, 'TEAM_WITHOUT_COACH', jsonb_build_object('name', t.name)
    from public.teams t
   where t.org_id = p_org and t.is_active
     and not exists (select 1 from public.team_coaches tc where tc.team_id = t.id)
     and exists (select 1 from public.events e where e.team_id = t.id and e.type = 'training' and e.status <> 'cancelled'
                  and e.starts_at >= now() - interval '30 days' and public.ta_event_tracked(e.id))
  on conflict do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
  select distinct a.org_id, 'athletes', a.id, 'ATHLETE_WITHOUT_GUARDIAN',
         jsonb_build_object('team_id', t.id, 'has_family', a.family_id is not null)
    from public.teams t
    cross join lateral public.ta_roster_on(t.id, public.ta_today(t.org_id)) r
    join public.athletes a on a.id = r.athlete_id
   where t.org_id = p_org and t.is_active
     and not exists (select 1 from public.ta_alert_recipients(a.id))
  on conflict do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
  select x.org_id, 'attendance_sessions', x.id, 'LEGACY_ATTENDANCE_SESSION',
         jsonb_build_object('event_id', e.id, 'team_id', e.team_id, 'program_session_id', x.program_session_id)
    from public.attendance_sessions x
    join public.events e on e.program_session_id = x.program_session_id and e.org_id = x.org_id and e.team_id is not null
   where x.org_id = p_org
  on conflict do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
  select e.org_id, 'events', e.id, 'ATTENDANCE_UNFINISHED',
         jsonb_build_object('team_id', e.team_id, 'starts_at', e.starts_at, 'sheet_status', s.status)
    from public.events e
    left join public.team_attendance_sheets s on s.event_id = e.id
   where e.org_id = p_org and e.team_id is not null and e.type::text = any(public.ta_sheet_types())
     and e.status <> 'cancelled' and e.ends_at < now() - interval '2 days'
     and (s.id is null or s.status <> 'final')
     and public.ta_event_tracked(e.id)
  on conflict do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  -- A flagged unfinished session that is now final resolves itself.
  update public.data_review_flags f
     set resolved_at = now(), resolution_note = 'attendance finalized'
   where f.org_id = p_org and f.reason_code = 'ATTENDANCE_UNFINISHED' and f.resolved_at is null
     and exists (select 1 from public.team_attendance_sheets s where s.event_id = f.entity_id and s.status = 'final');
  return v_n;
end;
$function$;

-- Coach sessions include the training sessions the coach leads.
create or replace function public.coach_sessions(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(event_id uuid, team_id uuid, team_name text, event_type text, title text, starts_at timestamp with time zone, ends_at timestamp with time zone, event_status text, access text, can_run boolean, sheet_status text, sheet_version integer, unmarked integer, marked integer, reported_absences integer, tracked boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with me as (select public.current_coach_id() as coach, public.current_org_id() as org),
  ev as (
    select e.*, 'team_coach'::text as access
      from public.events e, me
     where me.coach is not null and e.org_id = me.org and e.team_id is not null
       and exists (select 1 from public.team_coaches tc where tc.team_id = e.team_id and tc.coach_id = me.coach)
    union all
    select e.*, case when a.status = 'pending' then 'pending' else a.role end
      from public.events e join public.event_coach_assignments a on a.event_id = e.id, me
     where me.coach is not null and e.org_id = me.org and a.coach_id = me.coach and a.status in ('approved', 'pending')
       and not exists (select 1 from public.team_coaches tc where tc.team_id = e.team_id and tc.coach_id = me.coach)
    union all
    select e.*, 'session_coach'::text
      from public.events e join public.training_sessions ts on ts.id = e.training_session_id, me
     where me.coach is not null and e.org_id = me.org and ts.coach_id = me.coach
       and not exists (select 1 from public.event_coach_assignments a where a.event_id = e.id and a.coach_id = me.coach
                                                                       and a.status in ('approved', 'pending'))
  )
  select ev.id, ev.team_id, coalesce(t.name, (select sv.name from public.training_sessions x join public.training_services sv on sv.id = x.service_id where x.id = ev.training_session_id)), ev.type::text, ev.title, ev.starts_at, ev.ends_at, ev.status::text, ev.access,
         public.coach_can_run_event(ev.id), s.status, s.version,
         (select count(*)::int from public.team_attendance_marks m where m.sheet_id = s.id and m.status = 'unmarked'),
         (select count(*)::int from public.team_attendance_marks m where m.sheet_id = s.id and m.status <> 'unmarked'),
         (select count(*)::int from public.team_absence_reports r where r.event_id = ev.id and r.status in ('reported', 'acknowledged')),
         public.ta_event_tracked(ev.id)
    from ev
    left join public.teams t on t.id = ev.team_id
    left join public.team_attendance_sheets s on s.event_id = ev.id
   where ev.type::text = any(public.ta_sheet_types())
     and ev.starts_at >= coalesce(p_from, now() - interval '1 day')
     and ev.starts_at < coalesce(p_to, now() + interval '14 days')
   order by ev.starts_at;
$function$;

-- Roster size of a session card = confirmed bookings.
create or replace function public.coach_training_cards(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(event_id uuid, team_id uuid, team_name text, event_type text, title text, starts_at timestamp with time zone, ends_at timestamp with time zone, event_status text, cancel_reason text, access text, can_run boolean, sheet_status text, sheet_version integer, unmarked integer, marked integer, reported_absences integer, tracked boolean, location_name text, roster_size integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.event_id, c.team_id, c.team_name, c.event_type, c.title, c.starts_at, c.ends_at, c.event_status,
         e.cancel_reason, c.access, c.can_run, c.sheet_status, c.sheet_version, c.unmarked, c.marked,
         case when c.can_run then c.reported_absences else 0 end,
         c.tracked,
         coalesce((select v.name from public.venues v where v.id = e.venue_id), e.location_name, e.location_text),
         case
           when not c.can_run then null
           when c.sheet_status is not null then c.unmarked + c.marked
           when c.team_id is null then (select count(*)::int from public.bk_event_roster(c.event_id))
           else (select count(*)::int from public.ta_roster_on(c.team_id, public.ta_event_date(c.event_id)))
         end
    from public.coach_sessions(p_from, p_to) c
    join public.events e on e.id = c.event_id and e.org_id = public.current_org_id()
   order by c.starts_at;
$function$;

-- Awaiting attendance lists training sessions too.
create or replace function public.sessions_awaiting_attendance(p_team uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100)
 RETURNS TABLE(event_id uuid, team_id uuid, team_name text, event_type text, starts_at timestamp with time zone, ends_at timestamp with time zone, sheet_status text, unmarked integer, days_since_end integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select e.id, e.team_id, coalesce(t.name, (select sv.name from public.training_sessions x join public.training_services sv on sv.id = x.service_id where x.id = e.training_session_id)), e.type::text, e.starts_at, e.ends_at, s.status,
         (select count(*)::int from public.team_attendance_marks m where m.sheet_id = s.id and m.status = 'unmarked'),
         (public.ta_today(e.org_id) - (e.ends_at at time zone public.ta_tz(e.org_id))::date)::int
    from public.events e
    left join public.teams t on t.id = e.team_id
    left join public.team_attendance_sheets s on s.event_id = e.id
   where e.org_id = public.current_org_id()
     and (e.team_id is not null or e.training_session_id is not null)
     and (p_team is null or e.team_id = p_team)
     and e.type::text = any(public.ta_sheet_types())
     and e.status <> 'cancelled' and e.ends_at < now()
     and (s.id is null or s.status <> 'final')
     and (public.is_admin() or public.coach_can_run_event(e.id))
     and public.ta_event_tracked(e.id)
   order by e.ends_at desc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
$function$;

-- Athlete attendance overview includes booked training sessions.
create or replace function public.ta_athlete_overview(p_athlete uuid, p_from date, p_to date, p_viewer uuid, p_guardian boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org  uuid;
  v_tz   text;
  v_from date;
  v_to   date;
  v_teams uuid[];
begin
  select org_id into v_org from public.athletes where id = p_athlete;
  v_tz := public.ta_tz(v_org);
  v_to := coalesce(p_to, public.ta_today(v_org));
  v_from := coalesce(p_from, v_to - 120);
  select array_agg(distinct x.team_id) into v_teams from (
    select tm.team_id from public.team_memberships tm where tm.athlete_id = p_athlete
    union select p.team_id from public.team_membership_periods p where p.athlete_id = p_athlete
    union select s.team_id from public.team_attendance_marks m join public.team_attendance_sheets s on s.id = m.sheet_id
           where m.athlete_id = p_athlete) x;

  return jsonb_build_object(
    'athlete', (select jsonb_build_object('id', a.id, 'first_name', a.first_name, 'last_name', a.last_name)
                  from public.athletes a where a.id = p_athlete),
    'timezone', v_tz,
    'upcoming', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event_id', e.id, 'team_id', e.team_id, 'team_name', coalesce(t.name, e.title), 'type', e.type, 'title', e.title,
               'training_session_id', e.training_session_id,
               'starts_at', e.starts_at, 'ends_at', e.ends_at, 'status', e.status,
               'cancel_reason', case when e.status = 'cancelled' then e.cancel_reason end,
               'rescheduled_from', e.rescheduled_from,
               'location', coalesce((select v.name from public.venues v where v.id = e.venue_id), e.location_name, e.location_text),
               'can_report', e.status in ('scheduled', 'postponed') and e.starts_at > now(),
               'report', (select jsonb_build_object('report_id', r.id, 'status', r.status, 'reason', r.reason,
                                                    'reason_category', r.reason_category, 'needs_review', r.needs_review,
                                                    'created_at', r.created_at)
                            from public.team_absence_reports r
                           where r.event_id = e.id and r.athlete_id = p_athlete and r.status in ('reported', 'acknowledged') limit 1))
             order by e.starts_at)
        from public.events e left join public.teams t on t.id = e.team_id
       where e.starts_at >= now() and e.starts_at < now() + interval '30 days'
         and e.type::text = any(public.ta_sheet_types())
         and ((e.team_id = any(coalesce(v_teams, '{}'))
               and exists (select 1 from public.ta_roster_on(e.team_id, (e.starts_at at time zone v_tz)::date) ro where ro.athlete_id = p_athlete))
              or (e.training_session_id is not null and e.org_id = v_org
                  and exists (select 1 from public.bk_event_roster(e.id) br where br.athlete_id = p_athlete)))
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event_id', e.id, 'team_id', e.team_id, 'team_name', coalesce(t.name, e.title), 'type', e.type, 'starts_at', e.starts_at,
               'training_session_id', e.training_session_id,
               'season_id', coalesce(e.season_id, t.season_id), 'season_name', sn.name,
               'status', m.finalized_status, 'is_guest', m.is_guest, 'can_request_correction', p_guardian,
               'open_request', exists (select 1 from public.attendance_correction_requests q where q.mark_id = m.id and q.status = 'open'),
               'alert', case when p_guardian then (
                  select jsonb_build_object('alert_id', al.id, 'kind', al.kind, 'status', al.status, 'mark_status', al.mark_status,
                                            'sent_at', al.sent_at)
                    from public.attendance_no_show_alerts al
                   where al.event_id = e.id and al.athlete_id = p_athlete and al.guardian_profile_id = p_viewer
                   order by al.created_at desc limit 1) end)
             order by e.starts_at desc)
        from public.team_attendance_marks m
        join public.team_attendance_sheets s on s.id = m.sheet_id and s.finalize_count > 0
        join public.events e on e.id = m.event_id
        left join public.teams t on t.id = e.team_id
        left join public.seasons sn on sn.id = coalesce(e.season_id, t.season_id)
       where m.athlete_id = p_athlete and m.finalized_status is not null and e.status <> 'cancelled'
         and s.roster_date between v_from and v_to
    ), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object('report_id', r.id, 'event_id', r.event_id, 'starts_at', e.starts_at, 'team_name', t.name,
                                          'status', r.status, 'reason', r.reason, 'reason_category', r.reason_category,
                                          'needs_review', r.needs_review, 'reporter_kind', r.reporter_kind,
                                          'mine', r.reported_by = p_viewer, 'created_at', r.created_at)
             order by r.created_at desc)
        from public.team_absence_reports r join public.events e on e.id = r.event_id left join public.teams t on t.id = e.team_id
       where r.athlete_id = p_athlete and r.created_at >= now() - interval '180 days'
    ), '[]'::jsonb),
    'correction_requests', case when p_guardian then coalesce((
      select jsonb_agg(jsonb_build_object('request_id', q.id, 'event_id', q.event_id, 'status', q.status, 'message', q.message,
                                          'current_status', q.current_status, 'requested_status', q.requested_status,
                                          'resolution_note', q.resolution_note, 'resolved_at', q.resolved_at, 'created_at', q.created_at)
             order by q.created_at desc)
        from public.attendance_correction_requests q where q.athlete_id = p_athlete
    ), '[]'::jsonb) else '[]'::jsonb end,
    'stats', (select jsonb_build_object('sessions', count(*),
                                        'present', count(*) filter (where m.finalized_status = 'present'),
                                        'late', count(*) filter (where m.finalized_status = 'late'),
                                        'excused', count(*) filter (where m.finalized_status = 'excused'),
                                        'unexcused', count(*) filter (where m.finalized_status = 'unexcused'))
                from public.team_attendance_marks m
                join public.team_attendance_sheets s on s.id = m.sheet_id and s.finalize_count > 0
                join public.events e on e.id = m.event_id
               where m.athlete_id = p_athlete and m.finalized_status is not null and e.status <> 'cancelled'
                 and s.roster_date between v_from and v_to));
end;
$function$;

-- Club breaks cancel team trainings only; booked sessions are cancelled through the booking.
create or replace function public.ta_break_events(p_break uuid)
 RETURNS TABLE(event_id uuid, status text, has_final_sheet boolean, cancel_reason text, starts_at timestamp with time zone, team_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b public.club_training_breaks; v_tz text;
begin
  select * into b from public.club_training_breaks where id = p_break;
  if not found then return; end if;
  v_tz := public.ta_tz(b.org_id);
  return query
  select e.id, e.status::text, exists (select 1 from public.team_attendance_sheets s where s.event_id = e.id and s.status = 'final'),
         e.cancel_reason, e.starts_at, e.team_id
    from public.events e
    left join public.teams t on t.id = e.team_id
   where e.org_id = b.org_id and e.type = 'training' and e.training_session_id is null
     and e.starts_at >= ((b.starts_on::timestamp) at time zone v_tz) - interval '1 day'
     and e.starts_at <  ((b.ends_on::timestamp + interval '1 day') at time zone v_tz) + interval '1 day'
     and (e.starts_at at time zone v_tz)::date between b.starts_on and b.ends_on
     and (b.season_id is null or coalesce(e.season_id, t.season_id) = b.season_id)
   order by e.starts_at;
end $function$;

-- Events: a session event is visible to staff, coaches, and guardians / the
-- player of a participant (not to every guardian of the club).
drop policy if exists events_select on public.events;
create policy events_select on public.events for select
  using (org_id = public.current_org_id()
         and (public.is_finance() or public.has_role('coach'::public.app_role)
              or (team_id is not null and public.guardian_has_athlete_on_team(team_id))
              or (team_id is null and training_session_id is null and public.is_any_guardian())
              or (training_session_id is not null and public.bk_viewer_sees_session(training_session_id))));

-- ===========================================================================
-- 12. Privileges
-- ===========================================================================
do $$
declare t text; f text;
begin
  -- Tables written only by the RPCs: read through RLS, no client writes.
  foreach t in array array['training_sessions', 'training_booking_entitlements', 'booking_requests', 'booking_notifications'] loop
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
  -- Tables with admin / finance write policies.
  foreach t in array array['training_service_coaches', 'billing_payers'] loop
    execute format('revoke truncate on public.%I from anon, authenticated', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;

  -- Internal helpers: called by the RPCs and triggers only.
  foreach f in array array[
    'public.bk_replay(uuid, text)', 'public.bk_remember(uuid, text, jsonb)', 'public.bk_settings(uuid)',
    'public.bk_currency(public.training_services)', 'public.bk_setup_missing(public.training_services)',
    'public.bk_flag(uuid, text, uuid, text, jsonb)', 'public.bk_session_count(uuid, uuid)', 'public.bk_event_roster(uuid)',
    'public.bk_payer_snapshot(uuid, uuid, uuid)',
    'public.bk_evaluate(uuid, uuid, public.training_services, uuid, timestamptz, uuid, uuid, boolean, uuid, uuid)',
    'public.bk_billing_plan(uuid, uuid, public.training_services, text, uuid, numeric, text)',
    'public.booking_billing_status(uuid)',
    'public.bk_session_create(uuid, public.training_services, uuid, timestamptz, timestamptz, uuid, uuid, integer)',
    'public.bk_session_refresh(uuid)', 'public.bk_sync_event_sheet(uuid)', 'public.bk_attach_legacy(uuid)',
    'public.bk_bookings_legacy_sync()', 'public.events_session_guard()', 'public.events_session_delete_guard()',
    'public.training_services_bk_guard()', 'public.bk_enqueue_notifications(uuid, text)',
    'public.bk_read_payload(jsonb)', 'public.bk_first_error(jsonb)', 'public.bk_create_invoice(uuid, boolean)',
    'public.bk_payer_upsert(jsonb, uuid)', 'public.bk_row(public.training_bookings)',
    'public.bk_guardian_sees_invoice(uuid)', 'public.bk_portal_rows(uuid, boolean)',
    -- service role only (dispatcher)
    'public.booking_notifications_claim(uuid, uuid, integer)',
    'public.booking_notification_record(uuid, text, text, uuid, uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;

  -- Signed-in API (each re-checks tenant and role inside) and RLS helpers.
  foreach f in array array[
    'public.bk_norm(text)', 'public.bk_is_staff()', 'public.bk_coach_eligible(uuid, uuid)',
    'public.bk_viewer_sees_session(uuid)',
    'public.booking_quote(jsonb)', 'public.booking_confirm(jsonb, uuid)',
    'public.booking_reschedule(uuid, jsonb, uuid)', 'public.booking_cancel(uuid, text, uuid, text, boolean, boolean)',
    'public.booking_invoice_preview(uuid)', 'public.booking_create_invoice(uuid, uuid, boolean)',
    'public.booking_record_payment(uuid, jsonb)', 'public.booking_notification_retry(uuid)',
    'public.people_duplicate_check(jsonb)', 'public.athlete_quick_create(jsonb, uuid)',
    'public.billing_payer_save(jsonb, uuid)', 'public.billing_payer_candidates(uuid)',
    'public.training_service_catalog(boolean)', 'public.training_service_coaches_set(uuid, uuid[])',
    'public.booking_list(jsonb)', 'public.booking_detail(uuid)', 'public.bookings_to_invoice(integer)',
    'public.athlete_booking_history(uuid)', 'public.coach_booking_agenda(timestamptz, timestamptz, uuid)',
    'public.guardian_booking_overview(uuid)', 'public.player_booking_overview()',
    'public.booking_dashboard_counts()', 'public.booking_followups(integer)', 'public.booking_review_flags(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- ===========================================================================
-- 13. Existing data: review flags for the service catalogue
-- (no bookings, invoices or payments are changed)
-- ===========================================================================
do $$
declare o record;
begin
  for o in select id from public.organizations loop
    perform public.booking_review_flags(o.id);
  end loop;
end $$;
