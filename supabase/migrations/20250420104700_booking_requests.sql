-- ============================================================================
-- Booking requests (phase B of the booking workflow)
--
--   1. Open availability confirmed by the coach: club setting
--      app_settings.settings.booking.availability_mode
--        'declared'     (default) a slot must fit the coach's availability
--        'open_confirm' any time inside the venue opening hours; a slot
--                       outside the declared availability is created as a
--                       `requested` booking (held place) that the coach (or
--                       an admin) confirms or declines.
--      Requests unanswered after settings.booking.request_followup_hours
--      (default 48) are listed in the booking follow-ups.
--   2. VENUE_CLOSED: a slot outside the venue opening hours (or in a club /
--      venue blackout) is refused with its own code.
--   3. Family requests: a guardian requests a session for their own child
--      (training_services.bookable_by_families); always `requested`, payer =
--      the family default, promo codes allowed as in the legacy flow.
--   4. Promo codes on workflow bookings (discount_evaluate engine); the
--      discount is recorded (applied_discounts, source 'booking') and carried
--      into the booking invoice as negative lines.
--   5. Absence reports and correction requests for booked-session events.
--   6. Booking status from the finalized attendance sheet (present / late ->
--      completed, unexcused -> no_show, excused -> booked + excused marker),
--      corrections included. Billing is unaffected.
--
-- Additive and idempotent. No new tables (new columns, enum values, functions,
-- triggers). The new enum value booking_status 'requested' is only compared
-- as text in this file (it is not usable in the transaction that adds it).
-- Contract: docs/booking-workflow.md §12. Tests: tests/db/booking_requests.sql.
-- ============================================================================

alter type public.booking_status add value if not exists 'requested';
alter type public.notification_type add value if not exists 'booking_requested';
alter type public.notification_type add value if not exists 'booking_request_declined';

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'training_services' and column_name = 'bookable_by_families') then
    alter table public.training_services add column bookable_by_families boolean not null default true;
    -- Families may request private, group and trial sessions; package services stay staff-booked.
    update public.training_services set bookable_by_families = false where kind = 'package';
  end if;
end $$;

alter table public.training_bookings add column if not exists request_source text;
alter table public.training_bookings add column if not exists requested_at timestamptz;
alter table public.training_bookings add column if not exists requested_by uuid references public.profiles(id) on delete set null;
alter table public.training_bookings add column if not exists request_decision text;
alter table public.training_bookings add column if not exists request_decided_at timestamptz;
alter table public.training_bookings add column if not exists request_decided_by uuid references public.profiles(id) on delete set null;
alter table public.training_bookings add column if not exists discount_total numeric(10,2) not null default 0;
alter table public.training_bookings add column if not exists promo_code text;
alter table public.training_bookings add column if not exists attendance_status text;
alter table public.training_bookings add column if not exists attendance_synced_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'training_bookings_req_chk') then
    alter table public.training_bookings add constraint training_bookings_req_chk check (
      (request_source is null or request_source in ('staff', 'family'))
      and (request_decision is null or request_decision in ('confirmed', 'declined', 'withdrawn'))
      and discount_total >= 0
      and (promo_code is null or length(promo_code) <= 40)
      and (attendance_status is null or attendance_status in ('present', 'late', 'excused', 'unexcused')));
  end if;
end $$;

-- One live place per athlete and session, requests included (they hold the place).
create unique index if not exists training_bookings_session_athlete_live_uidx on public.training_bookings (session_id, athlete_id)
  where session_id is not null and status <> 'cancelled';
create index if not exists idx_bookings_requested on public.training_bookings (org_id, requested_at)
  where requested_at is not null and request_decision is null;

-- Notification kinds of the request lifecycle; admins as recipients of family requests.
alter table public.booking_notifications drop constraint if exists booking_notifications_kind_chk;
alter table public.booking_notifications add constraint booking_notifications_kind_chk
  check (kind in ('confirmed', 'rescheduled', 'cancelled', 'requested', 'request_confirmed', 'request_declined', 'request_withdrawn'));
alter table public.booking_notifications drop constraint if exists booking_notifications_recipient_chk;
alter table public.booking_notifications add constraint booking_notifications_recipient_chk
  check (recipient_kind in ('payer', 'guardian', 'family', 'coach', 'player', 'admin'));

-- Correction requests of booked-session events have no team.
alter table public.attendance_correction_requests alter column team_id drop not null;

-- ---------------------------------------------------------------------------
-- 2. Settings and small helpers
-- ---------------------------------------------------------------------------
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
    'invoice_due_days', coalesce((st.settings->'booking'->>'invoice_due_days')::int, 14),
    'availability_mode', case when st.settings->'booking'->>'availability_mode' = 'open_confirm' then 'open_confirm' else 'declared' end,
    'request_followup_hours', greatest(1, least(coalesce((st.settings->'booking'->>'request_followup_hours')::int, 48), 720)),
    'bookings_enabled', coalesce((st.settings->>'bookings_enabled')::boolean, false))
    from (select 1) x left join public.app_settings st on st.org_id = p_org;
$$;

-- Live places of a session: confirmed bookings and requests (held places).
create or replace function public.bk_session_count(p_session uuid, p_exclude uuid default null)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.training_bookings b
   where b.session_id = p_session and b.status <> 'cancelled'
     and b.id is distinct from p_exclude;
$$;

-- A session that only holds requests (nobody confirmed yet).
create or replace function public.bk_session_pending(p_session uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_session is null then return false; end if;
  return exists (select 1 from public.training_bookings b where b.session_id = p_session and b.status::text = 'requested')
     and not exists (select 1 from public.training_bookings b where b.session_id = p_session and b.status in ('booked', 'completed', 'no_show'));
end $$;

-- Is the venue open for [p_start, p_end)? Opening hours (venues.opening_hours,
-- none = always open), club-wide closures and venue blackouts. No venue = open.
create or replace function public.bk_venue_open(p_org uuid, p_venue uuid, p_start timestamptz, p_end timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz   text := public.training_org_tz(p_org);
  v_day  timestamp := date_trunc('day', p_start at time zone v_tz);
  v_dow  integer := extract(isodow from (p_start at time zone v_tz))::integer;
  v_hours jsonb;
begin
  if p_start is null or p_end is null or p_end <= p_start then return false; end if;
  if exists (select 1 from public.training_blackouts b
              where b.org_id = p_org and b.venue_id is null and b.coach_id is null
                and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(p_start, p_end, '[)')) then
    return false;
  end if;
  if p_venue is null then return true; end if;
  if exists (select 1 from public.training_blackouts b
              where b.org_id = p_org and b.venue_id = p_venue and b.coach_id is null
                and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(p_start, p_end, '[)')) then
    return false;
  end if;
  -- a slot across midnight never fits one day's opening hours
  if (p_end at time zone v_tz) > v_day + interval '1 day' then return false; end if;
  select opening_hours into v_hours from public.venues where id = p_venue and org_id = p_org;
  return public.training_within_hours(v_hours, v_dow, (p_start at time zone v_tz) - v_day, (p_end at time zone v_tz) - v_day);
end $$;

-- A coach blackout (holiday, sick leave) blocks the coach in every mode.
create or replace function public.bk_coach_blocked(p_org uuid, p_coach uuid, p_start timestamptz, p_end timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.training_blackouts b
                  where b.org_id = p_org and b.coach_id = p_coach
                    and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(p_start, p_end, '[)'));
$$;

-- Shared payload reading for quote / confirm (+ promo_code).
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
    'notify', coalesce((p->>'notify')::boolean, true),
    'promo_code', upper(nullif(btrim(coalesce(p->>'promo_code', '')), '')));
end $$;

-- ---------------------------------------------------------------------------
-- 3. Slot evaluation: VENUE_CLOSED, open availability (needs_confirmation)
--    Same signature as 20250420104400. New result keys:
--      within_availability  the slot fits the coach's declared availability
--      needs_confirmation   the booking is created as `requested`
--      session_pending      the joined session only holds requests
--    Open mode: settings.booking.availability_mode = 'open_confirm', or a
--    family request (app.bk_family_request = 'on', set by the request RPC).
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
  v_open  boolean;
  v_within boolean := false;
  v_needs boolean := false;
  v_pend  boolean := false;
begin
  v_open := v_set->>'availability_mode' = 'open_confirm' or public.billing_flag_on('app.bk_family_request');
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
    v_pend := public.bk_session_pending(s.id);
    v_needs := v_pend;
    v_within := not v_pend;
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
    v_space := coalesce(v_space, p_svc.default_venue_space_id);
    if v_space is not null then
      select vs.venue_id into v_venue from public.venue_spaces vs where vs.id = v_space and vs.org_id = p_org;
      if v_venue is null then v_err := v_err || 'SPACE_NOT_FOUND'::text; v_space := null; end if;
    end if;
    select w.capacity, w.venue_id into v_wcap, v_wven
      from public.training_slot_window(p_org, v_coach, p_svc.id, v_start, v_end) w;
    if v_wcap is not null and v_venue is not null and v_wven is not null and v_wven <> v_venue
       and not public.bk_venue_open(p_org, v_venue, v_start, v_end) then
      v_wcap := null;  -- the window's venue is open, the chosen facility's venue is not
    end if;
    if v_wcap is not null then
      v_within := true;
    elsif not public.bk_venue_open(p_org, coalesce(v_venue, p_svc.venue_id), v_start, v_end) then
      if p_override then v_warn := v_warn || jsonb_build_object('code', 'VENUE_CLOSED_OVERRIDDEN');
      else v_err := v_err || 'VENUE_CLOSED'::text; end if;
    elsif p_override then
      v_warn := v_warn || jsonb_build_object('code', 'AVAILABILITY_OVERRIDDEN');
    elsif public.bk_coach_blocked(p_org, v_coach, v_start, v_end) then
      v_err := v_err || 'COACH_UNAVAILABLE'::text;
    elsif v_open then
      v_needs := true;
    else
      v_err := v_err || 'COACH_UNAVAILABLE'::text;
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
                                            and b.status <> 'cancelled' and b.id is distinct from p_exclude) then
      v_err := v_err || 'ALREADY_BOOKED'::text;
    end if;
  end if;

  if p_athlete is not null and v_start is not null and v_end is not null then
    select coalesce(jsonb_agg(jsonb_build_object('booking_id', b.id, 'starts_at', b.slot_start)), '[]'::jsonb) into v_ov
      from public.training_bookings b
     where b.athlete_id = p_athlete and b.status::text in ('booked', 'requested') and b.id is distinct from p_exclude
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
  if v_needs then
    v_warn := v_warn || jsonb_build_object('code', 'NEEDS_COACH_CONFIRMATION');
  end if;

  return jsonb_build_object(
    'session_id', s.id, 'coach_id', v_coach, 'starts_at', v_start, 'ends_at', v_end,
    'venue_id', v_venue, 'venue_space_id', v_space, 'capacity', v_cap, 'participants', v_count,
    'places_left', case when v_cap is null then null else greatest(0, v_cap - v_count) end,
    'within_availability', v_within, 'needs_confirmation', v_needs, 'session_pending', v_pend,
    'availability_mode', v_set->>'availability_mode',
    'errors', to_jsonb(v_err), 'warnings', v_warn);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Billing plan + promo code (shared discount engine, discount_evaluate).
--    A code only applies to a single paid session billed by invoice, at the
--    list price (no price override). The club's other automatic discounts are
--    evaluated with it, as in the legacy book_training path. p_lock = true
--    locks the promo rows (usage limits) inside the writing transaction.
-- ---------------------------------------------------------------------------
create or replace function public.bk_billing_quote(
  p_org uuid, p_athlete uuid, p_svc public.training_services, x jsonb, p_start timestamptz, p_lock boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_bill  jsonb := public.bk_billing_plan(p_org, p_athlete, p_svc, x->>'billing', (x->>'purchase_id')::uuid,
                                          (x->>'price')::numeric, x->>'price_reason');
  v_code  text := upper(nullif(btrim(coalesce(x->>'promo_code', '')), ''));
  v_err   jsonb := coalesce(v_bill->'errors', '[]'::jsonb);
  v_disc  jsonb;
  v_total numeric := 0;
  v_fam   uuid;
  v_exp   int := public.currency_exponent(public.bk_currency(p_svc));
begin
  if v_code is null then
    return v_bill || jsonb_build_object('discount_total', 0, 'discount_lines', '[]'::jsonb, 'promo', 'none', 'promo_code', null);
  end if;
  if length(v_code) > 40 then
    v_err := v_err || '"PROMO_UNKNOWN_CODE"'::jsonb;
  elsif v_bill->>'billing_mode' not in ('invoice') then
    v_err := v_err || '"PROMO_NOT_APPLICABLE"'::jsonb;
  elsif (x->>'price') is not null then
    v_err := v_err || '"PROMO_WITH_PRICE_OVERRIDE"'::jsonb;
  else
    select family_id into v_fam from public.athletes where id = p_athlete and org_id = p_org;
    v_disc := public.discount_evaluate(p_org, 'training', null, p_svc.id, (v_bill->>'list_price')::numeric, v_bill->>'currency',
                                       v_code, v_fam, (p_start at time zone public.training_org_tz(p_org))::date, null, p_lock);
    if v_disc->>'promo' <> 'applied' then
      v_err := v_err || to_jsonb('PROMO_' || (v_disc->>'promo'));
    else
      v_total := least((v_bill->>'list_price')::numeric, round(coalesce((v_disc->>'discount_total')::numeric, 0), v_exp));
      v_bill := v_bill || jsonb_build_object('price', (v_bill->>'list_price')::numeric - v_total);
      if (v_bill->>'price')::numeric = 0 then
        v_bill := v_bill || jsonb_build_object('billing_mode', 'free', 'billing_status', 'not_billable', 'setup_missing', '[]'::jsonb);
      end if;
    end if;
  end if;
  return v_bill || jsonb_build_object(
    'errors', v_err, 'discount_total', v_total,
    'discount_lines', case when v_total > 0 then coalesce(v_disc->'lines', '[]'::jsonb) else '[]'::jsonb end,
    'promo', case when v_total > 0 then 'applied' when jsonb_array_length(v_err) > jsonb_array_length(coalesce(v_bill->'errors', '[]'::jsonb)) then 'rejected' else 'none' end,
    'promo_code', case when v_total > 0 then v_code end);
end $$;

-- Billing status: a request is never invoiced while it waits.
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
  if b.status::text = 'requested' then return 'awaiting_confirmation'; end if;
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

-- Quote: + promo code, + what confirming creates (booked / requested).
create or replace function public.booking_quote(p_payload jsonb)
returns jsonb
language plpgsql
volatile
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
  v_bill := public.bk_billing_quote(v_org, v_ath.id, v_svc, x, coalesce((v_eval->>'starts_at')::timestamptz, now()), false);
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
    'creates', case when (v_eval->>'needs_confirmation')::boolean then 'requested' else 'booked' end,
    'service', jsonb_build_object('id', v_svc.id, 'name', v_svc.name, 'kind', v_svc.kind, 'duration_min', v_svc.duration_min,
                                  'billing_category', v_svc.billing_category, 'max_participants', v_svc.max_participants),
    'billing_entity', (select jsonb_build_object('id', e.id, 'name', e.name) from public.billing_entities e where e.id = v_ent),
    'number_prefix', public.billing_series_prefix(v_org, v_svc.billing_category),
    'payer', public.bk_payer_snapshot(v_org, (x->>'payer_id')::uuid, v_ath.family_id));
end $$;

-- ---------------------------------------------------------------------------
-- 5. Placing a booking (shared by staff confirm and family requests).
--    Internal: callers checked role, org, payload and locked the coach row.
--    Creates / joins the session, inserts the booking (booked or requested),
--    deducts the package entitlement once, records the promo discount.
-- ---------------------------------------------------------------------------
create or replace function public.bk_place(
  p_org uuid, p_ath public.athletes, p_svc public.training_services, x jsonb, p_eval jsonb, p_bill jsonb,
  p_status text, p_source text, p_request_id uuid, p_override boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s     public.training_sessions;
  v_lot public.training_package_purchases;
  v_bid uuid;
  v_disc jsonb;
  v_dtot numeric := coalesce((p_bill->>'discount_total')::numeric, 0);
begin
  if (p_eval->>'session_id') is not null then
    select * into s from public.training_sessions where id = (p_eval->>'session_id')::uuid for update;
    if s.status <> 'scheduled' then raise exception 'SESSION_NOT_SCHEDULED' using errcode = 'P0001'; end if;
    if public.bk_session_count(s.id) >= s.capacity then raise exception 'SESSION_FULL' using errcode = 'P0001'; end if;
  else
    s := public.bk_session_create(p_org, p_svc, (p_eval->>'coach_id')::uuid, (p_eval->>'starts_at')::timestamptz,
                                  (p_eval->>'ends_at')::timestamptz, (p_eval->>'venue_id')::uuid,
                                  (p_eval->>'venue_space_id')::uuid, (p_eval->>'capacity')::int);
  end if;

  if p_bill->>'billing_mode' = 'package' then
    select * into v_lot from public.training_package_purchases where id = (p_bill->>'purchase_id')::uuid for update;
    if v_lot.status <> 'active' or v_lot.sessions_used >= v_lot.sessions or (v_lot.expires_at is not null and v_lot.expires_at <= now()) then
      raise exception 'PACKAGE_NOT_AVAILABLE' using errcode = 'P0001';
    end if;
  end if;

  begin
    insert into public.training_bookings
      (org_id, athlete_id, service_id, coach_id, slot_start, slot_end, status, paid_with, credits_used, price_chf, list_price,
       currency, purchase_id, venue_id, location_text, notes, created_by, session_id, payer_id, billing_mode,
       price_override_reason, price_override_by, availability_override_reason, warnings, request_id, created_via,
       request_source, requested_at, requested_by, discount_total, promo_code)
    values
      (p_org, p_ath.id, p_svc.id, s.coach_id, s.starts_at, s.ends_at, p_status::public.booking_status,
       null,
       case when p_bill->>'billing_mode' = 'package' then 1 else 0 end,
       (p_bill->>'price')::numeric, (p_bill->>'list_price')::numeric, p_bill->>'currency',
       case when p_bill->>'billing_mode' = 'package' then v_lot.id end,
       s.venue_id, coalesce(s.location_text, p_svc.location_text), x->>'notes', auth.uid(), s.id, (x->>'payer_id')::uuid,
       p_bill->>'billing_mode',
       case when (p_bill->>'price_override')::boolean then x->>'price_reason' end,
       case when (p_bill->>'price_override')::boolean then auth.uid() end,
       case when p_override then x->>'override_reason' end,
       coalesce(p_eval->'warnings', '[]'::jsonb), p_request_id, 'workflow',
       case when p_status = 'requested' then p_source end,
       case when p_status = 'requested' then now() end,
       case when p_status = 'requested' then auth.uid() end,
       v_dtot,
       case when v_dtot > 0 then p_bill->>'promo_code' end)
    returning id into v_bid;
  exception when unique_violation then
    raise exception 'ALREADY_BOOKED' using errcode = 'P0001';
  end;

  if p_bill->>'billing_mode' = 'package' then
    update public.training_package_purchases set sessions_used = sessions_used + 1 where id = v_lot.id;
    insert into public.training_booking_entitlements (org_id, booking_id, purchase_id, consumed_by)
    values (p_org, v_bid, v_lot.id, auth.uid());
  end if;

  -- Promo: re-evaluated under lock (usage limits) and recorded on the
  -- booking; the invoice lines follow when the booking is invoiced.
  if (x->>'promo_code') is not null and v_dtot > 0 then
    v_disc := public.discount_evaluate(p_org, 'training', null, p_svc.id, (p_bill->>'list_price')::numeric, p_bill->>'currency',
                                       x->>'promo_code', p_ath.family_id,
                                       (s.starts_at at time zone public.training_org_tz(p_org))::date, null, true);
    if v_disc->>'promo' <> 'applied'
       or round(coalesce((v_disc->>'discount_total')::numeric, 0), public.currency_exponent(p_bill->>'currency')) <> v_dtot then
      raise exception 'PROMO_%', coalesce(nullif(v_disc->>'promo', 'applied'), 'CHANGED') using errcode = 'P0001';
    end if;
    perform public.training_record_discounts(p_org, v_disc, 'booking', v_bid, null, p_ath.family_id, p_ath.id,
                                             p_bill->>'currency', p_ath.first_name || ' ' || p_ath.last_name);
  end if;

  if (p_bill->>'price_override')::boolean then
    perform public.money_audit(p_org, 'BOOKING_PRICE_OVERRIDE', 'training_bookings', v_bid,
      jsonb_build_object('list_price', p_bill->'list_price'),
      jsonb_build_object('price', p_bill->'price', 'reason', x->>'price_reason', 'billing_mode', p_bill->>'billing_mode'));
  end if;
  if p_override then
    perform public.money_audit(p_org, 'BOOKING_AVAILABILITY_OVERRIDE', 'training_bookings', v_bid, null,
      jsonb_build_object('reason', x->>'override_reason', 'warnings', p_eval->'warnings'));
  end if;
  perform public.bk_sync_event_sheet(s.id);
  return jsonb_build_object('booking_id', v_bid, 'session_id', s.id, 'event_id', s.event_id, 'starts_at', s.starts_at,
                            'ends_at', s.ends_at, 'coach_id', s.coach_id);
end $$;

-- Confirm (staff): inside the declared availability (or with an admin
-- override) the booking is confirmed; in open mode a slot outside it is a
-- held `requested` booking that the coach confirms.
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
  v_bid   uuid;
  v_res   jsonb;
  v_code  text;
  v_set   jsonb;
  v_inv   jsonb;
  v_place jsonb;
  v_status text;
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  v_rep := public.bk_replay(p_request_id, 'confirm');
  if v_rep is not null then return v_rep; end if;
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
  v_bill := public.bk_billing_quote(v_org, v_ath.id, v_svc, x, (v_eval->>'starts_at')::timestamptz, false);
  v_code := public.bk_first_error(v_bill);
  if v_code is not null then raise exception '%', v_code using errcode = 'P0001'; end if;

  v_status := case when (v_eval->>'needs_confirmation')::boolean then 'requested' else 'booked' end;
  v_place := public.bk_place(v_org, v_ath, v_svc, x, v_eval, v_bill, v_status, 'staff', p_request_id, v_ov);
  v_bid := (v_place->>'booking_id')::uuid;

  if (x->>'notify')::boolean then
    perform public.bk_enqueue_notifications(v_bid, case when v_status = 'requested' then 'requested' else 'confirmed' end);
  end if;

  v_set := public.bk_settings(v_org);
  if v_status = 'booked' and (v_set->>'auto_invoice')::boolean and v_bill->>'billing_mode' = 'invoice'
     and jsonb_array_length(coalesce(v_bill->'setup_missing', '[]'::jsonb)) = 0 then
    v_inv := public.bk_create_invoice(v_bid, false);
  end if;
  perform set_config('app.bk_internal', '', true);

  v_res := jsonb_build_object(
    'ok', true, 'booking_id', v_bid, 'session_id', v_place->'session_id', 'event_id', v_place->'event_id',
    'starts_at', v_place->'starts_at', 'ends_at', v_place->'ends_at', 'coach_id', v_place->'coach_id',
    'status', v_status, 'requested', v_status = 'requested',
    'billing_mode', v_bill->>'billing_mode', 'billing_status', public.booking_billing_status(v_bid),
    'price', v_bill->'price', 'currency', v_bill->>'currency', 'purchase_id', v_bill->'purchase_id',
    'discount_total', coalesce(v_bill->'discount_total', '0'::jsonb),
    'invoice_id', v_inv->'invoice_id', 'warnings', coalesce(v_eval->'warnings', '[]'::jsonb),
    'setup_missing', coalesce(v_bill->'setup_missing', '[]'::jsonb));
  return public.bk_remember(p_request_id, 'confirm', v_res);
end $$;

-- Invoice of one booking (internal): list price line + one negative line per
-- recorded discount (as the legacy training paths), linked in applied_discounts.
create or replace function public.bk_create_invoice(p_booking uuid, p_send boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.training_bookings; v_svc public.training_services; a public.athletes; v_pay jsonb;
  v_inv uuid; v_cur text; v_desc text; v_label text; v_due int; v_tz text; v_num text; ad record; v_item uuid;
begin
  select * into b from public.training_bookings where id = p_booking for update;
  if b.status::text = 'requested' then raise exception 'REQUEST_PENDING' using errcode = 'P0001'; end if;
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
  if coalesce(b.discount_total, 0) > 0 then
    insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
    values (b.org_id, v_inv, v_desc, 1, coalesce(b.list_price, b.price_chf + b.discount_total), coalesce(b.list_price, b.price_chf + b.discount_total));
    for ad in select * from public.applied_discounts
               where org_id = b.org_id and source = 'booking' and source_id = b.id and voided_at is null and invoice_id is null
               order by created_at, id loop
      insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
      values (b.org_id, v_inv, left(ad.name || ' — ' || a.first_name || ' ' || a.last_name, 500), 1, -ad.amount, -ad.amount)
      returning id into v_item;
      update public.applied_discounts set invoice_id = v_inv, invoice_item_id = v_item where id = ad.id;
    end loop;
  else
    insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
    values (b.org_id, v_inv, v_desc, 1, b.price_chf, b.price_chf);
  end if;
  update public.invoices set total_chf = b.price_chf where id = v_inv;

  perform set_config('app.bk_internal', 'on', true);
  update public.training_bookings set invoice_id = v_inv where id = b.id;
  perform set_config('app.billing_edit', 'on', true);
  update public.invoices set source_label = v_label where id = v_inv and source_label is distinct from v_label;
  perform set_config('app.billing_edit', 'off', true);

  return (select jsonb_build_object('ok', true, 'invoice_id', i.id, 'number', i.number, 'status', i.status,
                                    'total', i.total_chf, 'currency', i.currency, 'activity', i.activity,
                                    'billing_entity_id', i.billing_entity_id, 'send', p_send)
            from public.invoices i where i.id = v_inv);
end $$;

-- One invoice per booking; a request is not billable until confirmed.
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
  if b.status::text = 'requested' then raise exception 'REQUEST_PENDING' using errcode = 'P0001'; end if;
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

-- A cancelled / declined / withdrawn booking that was never invoiced gives
-- its promo redemption back (usage limits count only live discounts).
create or replace function public.bk_bookings_release_discounts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from new.status then
    update public.applied_discounts
       set voided_at = now(), void_reason = 'booking cancelled'
     where org_id = new.org_id and source = 'booking' and source_id = new.id and voided_at is null and invoice_id is null;
  end if;
  return null;
end $$;

drop trigger if exists trg_bookings_release_discounts on public.training_bookings;
create trigger trg_bookings_release_discounts after update of status on public.training_bookings
  for each row execute function public.bk_bookings_release_discounts();

-- Requests change only through the request RPCs (and staff / internal paths):
-- a guardian's direct table write can neither create nor decide a request.
create or replace function public.bk_bookings_request_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.billing_flag_on('app.bk_internal') or public.is_service_caller() or public.is_finance() then
    return new;
  end if;
  if tg_op = 'INSERT' and new.status::text = 'requested' then
    raise exception 'BOOKING_REQUEST_MANAGED' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and (old.status::text = 'requested' or new.status::text = 'requested') then
    raise exception 'BOOKING_REQUEST_MANAGED' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_bookings_request_guard on public.training_bookings;
create trigger trg_bookings_request_guard before insert or update on public.training_bookings
  for each row execute function public.bk_bookings_request_guard();

-- ---------------------------------------------------------------------------
-- 6. Notifications: one delivery row per recipient
--    confirmed / rescheduled / cancelled  family side + coach (unchanged)
--    requested          the coach; admins too when a family asked
--    request_confirmed  family side; the coach when an admin decided
--    request_declined   family side; the coach when an admin decided
--    request_withdrawn  the coach
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
  v_family boolean := p_kind in ('confirmed', 'rescheduled', 'cancelled', 'request_confirmed', 'request_declined');
  v_coach  boolean;
  v_admins boolean;
  v_coach_profile uuid;
begin
  select * into b from public.training_bookings where id = p_booking;
  if not found then return 0; end if;
  select * into a from public.athletes where id = b.athlete_id;
  select * into f from public.families where id = a.family_id;
  select c.profile_id into v_coach_profile from public.coaches c where c.id = b.coach_id;
  v_coach := p_kind in ('confirmed', 'rescheduled', 'cancelled', 'requested', 'request_withdrawn')
             or (p_kind in ('request_confirmed', 'request_declined') and v_coach_profile is distinct from auth.uid());
  v_admins := p_kind = 'requested' and b.request_source = 'family';

  if v_family then
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
  end if;

  if v_coach then
    insert into public.booking_notifications (org_id, booking_id, kind, change_seq, recipient_kind, recipient_key,
                                              recipient_profile_id, recipient_email, recipient_name)
    select b.org_id, b.id, p_kind, b.change_seq, 'coach', 'p:' || c.profile_id::text, c.profile_id, pf.email, c.display_name
      from public.coaches c join public.profiles pf on pf.id = c.profile_id
     where c.id = b.coach_id and c.profile_id is not null
    on conflict do nothing;
    get diagnostics v_k = row_count; v_n := v_n + v_k;
  end if;

  if v_admins then
    insert into public.booking_notifications (org_id, booking_id, kind, change_seq, recipient_kind, recipient_key,
                                              recipient_profile_id, recipient_email, recipient_name)
    select distinct on (pf.id) b.org_id, b.id, p_kind, b.change_seq, 'admin', 'p:' || pf.id::text, pf.id, pf.email, pf.full_name
      from public.staff_roles sr
      join public.profiles pf on pf.id = sr.profile_id and pf.is_active
     where sr.org_id = b.org_id and sr.role = 'admin'
       and not exists (select 1 from public.org_memberships om
                        where om.profile_id = pf.id and om.org_id = b.org_id and om.status <> 'active')
    on conflict do nothing;
    get diagnostics v_k = row_count; v_n := v_n + v_k;
  end if;
  return v_n;
end $$;

-- Claim: + the booking's cancel / decline reason (request_declined notice).
drop function if exists public.booking_notifications_claim(uuid, uuid, integer);
create or replace function public.booking_notifications_claim(p_org uuid default null, p_booking uuid default null, p_limit integer default 50)
returns table (
  id uuid, org_id uuid, booking_id uuid, kind text, recipient_kind text, recipient_profile_id uuid, recipient_email text,
  recipient_name text, attempts integer, service_name text, coach_name text, athlete_first_name text,
  starts_at timestamptz, ends_at timestamptz, previous_starts_at timestamptz, location_name text, timezone text, reason text)
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
         public.ta_tz(u.org_id),
         case when u.kind in ('request_declined', 'cancelled') then b.cancel_reason end
    from u
    join public.training_bookings b on b.id = u.booking_id
    join public.training_services ts on ts.id = b.service_id
    join public.athletes a on a.id = b.athlete_id
    left join public.coaches co on co.id = b.coach_id;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Request decisions (session coach or admin) and withdrawal (guardian)
-- ---------------------------------------------------------------------------
create or replace function public.bk_can_decide(b public.training_bookings)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select b.org_id = public.current_org_id()
     and (public.is_admin() or (public.current_coach_id() is not null and b.coach_id = public.current_coach_id()));
$$;

-- Give a held place back: package entitlement restored (once), session /
-- event released when empty. Internal.
create or replace function public.bk_release_request(b public.training_bookings, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare e public.training_booking_entitlements; v_restored boolean := false;
begin
  perform public.bk_session_refresh(b.session_id);
  select * into e from public.training_booking_entitlements where booking_id = b.id for update;
  if e.id is not null and e.restored_at is null then
    update public.training_package_purchases set sessions_used = greatest(0, sessions_used - 1) where id = e.purchase_id;
    update public.training_booking_entitlements
       set restored_at = now(), restored_by = auth.uid(), restore_reason = p_reason
     where id = e.id;
    v_restored := true;
  end if;
  return v_restored;
end $$;

create or replace function public.booking_request_confirm(p_booking uuid, p_request_id uuid, p_notify boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare b public.training_bookings; v_rep jsonb; v_res jsonb;
begin
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  v_rep := public.bk_replay(p_request_id, 'request_confirm');
  if v_rep is not null then return v_rep; end if;
  select * into b from public.training_bookings where id = p_booking and org_id = public.current_org_id() for update;
  if not found or not public.bk_can_decide(b) then
    if found and (public.is_finance() or public.is_guardian_of_athlete(b.athlete_id)) then
      raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
    end if;
    raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002';
  end if;
  if b.status::text <> 'requested' then
    if b.request_decision = 'confirmed' and b.status::text <> 'cancelled' then
      return jsonb_build_object('ok', true, 'booking_id', b.id, 'status', b.status, 'already_decided', true, 'replayed', false);
    end if;
    raise exception 'NOT_A_REQUEST' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.training_sessions s where s.id = b.session_id and s.status <> 'scheduled') then
    raise exception 'SESSION_NOT_SCHEDULED' using errcode = 'P0001';
  end if;

  perform set_config('app.bk_internal', 'on', true);
  update public.training_bookings
     set status = 'booked', request_decision = 'confirmed', request_decided_at = now(), request_decided_by = auth.uid(),
         change_seq = change_seq + 1
   where id = b.id;
  perform public.bk_sync_event_sheet(b.session_id);
  if coalesce(p_notify, true) then perform public.bk_enqueue_notifications(b.id, 'request_confirmed'); end if;
  perform set_config('app.bk_internal', '', true);
  perform public.money_audit(b.org_id, 'BOOKING_REQUEST_CONFIRMED', 'training_bookings', b.id, null,
                             jsonb_build_object('source', b.request_source, 'requested_at', b.requested_at));
  v_res := jsonb_build_object('ok', true, 'booking_id', b.id, 'status', 'booked', 'session_id', b.session_id,
                              'billing_status', public.booking_billing_status(b.id), 'already_decided', false);
  return public.bk_remember(p_request_id, 'request_confirm', v_res);
end $$;

create or replace function public.booking_request_decline(p_booking uuid, p_reason text, p_request_id uuid, p_notify boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare b public.training_bookings; v_rep jsonb; v_res jsonb; v_restored boolean;
begin
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if length(p_reason) > 500 then raise exception 'REASON_TOO_LONG' using errcode = 'P0001'; end if;
  v_rep := public.bk_replay(p_request_id, 'request_decline');
  if v_rep is not null then return v_rep; end if;
  select * into b from public.training_bookings where id = p_booking and org_id = public.current_org_id() for update;
  if not found or not public.bk_can_decide(b) then
    if found and (public.is_finance() or public.is_guardian_of_athlete(b.athlete_id)) then
      raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
    end if;
    raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002';
  end if;
  if b.status::text <> 'requested' then raise exception 'NOT_A_REQUEST' using errcode = 'P0001'; end if;

  perform set_config('app.bk_internal', 'on', true);
  update public.training_bookings
     set status = 'cancelled', cancel_reason = btrim(p_reason), cancelled_at = now(), cancelled_by = auth.uid(),
         request_decision = 'declined', request_decided_at = now(), request_decided_by = auth.uid(),
         change_seq = change_seq + 1
   where id = b.id;
  v_restored := public.bk_release_request(b, 'declined');
  if coalesce(p_notify, true) then perform public.bk_enqueue_notifications(b.id, 'request_declined'); end if;
  perform set_config('app.bk_internal', '', true);
  perform public.money_audit(b.org_id, 'BOOKING_REQUEST_DECLINED', 'training_bookings', b.id, null,
                             jsonb_build_object('source', b.request_source, 'package_restored', v_restored));
  v_res := jsonb_build_object('ok', true, 'booking_id', b.id, 'status', 'cancelled', 'session_id', b.session_id,
                              'session_status', (select status from public.training_sessions where id = b.session_id),
                              'package_restored', v_restored, 'billing_status', public.booking_billing_status(b.id));
  return public.bk_remember(p_request_id, 'request_decline', v_res);
end $$;

-- A guardian withdraws a family request of their own child before it is decided.
create or replace function public.booking_request_withdraw(p_booking uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare b public.training_bookings; v_rep jsonb; v_res jsonb; v_restored boolean;
begin
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  v_rep := public.bk_replay(p_request_id, 'request_withdraw');
  if v_rep is not null then return v_rep; end if;
  select * into b from public.training_bookings where id = p_booking and org_id = public.current_org_id() for update;
  if not found or not public.is_guardian_of_athlete(b.athlete_id) then
    raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002';
  end if;
  if b.status::text <> 'requested' then raise exception 'NOT_A_REQUEST' using errcode = 'P0001'; end if;
  if coalesce(b.request_source, 'staff') <> 'family' then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;

  perform set_config('app.bk_internal', 'on', true);
  update public.training_bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
         request_decision = 'withdrawn', request_decided_at = now(), request_decided_by = auth.uid(),
         change_seq = change_seq + 1
   where id = b.id;
  v_restored := public.bk_release_request(b, 'withdrawn');
  perform public.bk_enqueue_notifications(b.id, 'request_withdrawn');
  perform set_config('app.bk_internal', '', true);
  v_res := jsonb_build_object('ok', true, 'booking_id', b.id, 'status', 'cancelled', 'package_restored', v_restored);
  return public.bk_remember(p_request_id, 'request_withdraw', v_res);
end $$;

-- Staff cancel of a request = decline (the request lifecycle keeps one path).
-- booking_cancel itself is unchanged: it refuses requests (BOOKING_NOT_CANCELLABLE).

-- ---------------------------------------------------------------------------
-- 8. Family requests (guardian of the athlete)
-- ---------------------------------------------------------------------------
-- Services, coaches, open group sessions and package coverage a guardian may
-- request for their own child. No other family's data: group sessions show
-- times and free places only.
create or replace function public.family_booking_catalog(p_athlete uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id(); a public.athletes;
begin
  select * into a from public.athletes where id = p_athlete and org_id = v_org;
  if not found or not public.is_guardian_of_athlete(p_athlete) then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'athlete', jsonb_build_object('id', a.id, 'first_name', a.first_name, 'last_name', a.last_name),
    'timezone', public.ta_tz(v_org),
    'availability_mode', public.bk_settings(v_org)->>'availability_mode',
    'enabled', (public.bk_settings(v_org)->>'bookings_enabled')::boolean,
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.name, 'kind', s.kind, 'duration_min', s.duration_min, 'price', s.price_chf,
               'currency', public.bk_currency(s), 'max_participants', s.max_participants,
               'venue_name', (select v.name from public.venues v where v.id = s.venue_id),
               'coaches', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'display_name', c.display_name) order by c.display_name)
                                      from public.coaches c
                                     where c.org_id = s.org_id and c.is_active and public.bk_coach_eligible(s.id, c.id)), '[]'::jsonb),
               'package_remaining', (select coalesce(sum(tp.sessions - tp.sessions_used), 0)::int
                                       from public.training_package_purchases tp
                                      where tp.athlete_id = a.id and tp.service_id = s.id and tp.status = 'active'
                                        and (tp.expires_at is null or tp.expires_at > now()) and tp.sessions_used < tp.sessions),
               'sessions', case when s.kind = 'group' then coalesce((
                  select jsonb_agg(jsonb_build_object('session_id', x.id, 'starts_at', x.starts_at, 'ends_at', x.ends_at,
                                                      'coach_id', x.coach_id,
                                                      'coach_name', (select c.display_name from public.coaches c where c.id = x.coach_id),
                                                      'places_left', greatest(0, x.capacity - public.bk_session_count(x.id)),
                                                      'pending', public.bk_session_pending(x.id)) order by x.starts_at)
                    from public.training_sessions x
                   where x.org_id = v_org and x.service_id = s.id and x.status = 'scheduled' and x.starts_at > now()
                     and x.starts_at < now() + interval '60 days'
                     and public.bk_session_count(x.id) < x.capacity
                     and not exists (select 1 from public.training_bookings o where o.session_id = x.id and o.athlete_id = a.id
                                      and o.status <> 'cancelled')), '[]'::jsonb) else '[]'::jsonb end)
             order by s.sort_order, s.name)
        from public.training_services s
       where s.org_id = v_org and s.is_active and s.bookable_by_families
         and (s.kind <> 'package' or exists (select 1 from public.training_package_purchases tp
                                              where tp.athlete_id = a.id and tp.service_id = s.id and tp.status = 'active'
                                                and (tp.expires_at is null or tp.expires_at > now()) and tp.sessions_used < tp.sessions))), '[]'::jsonb));
end $$;

-- Shared by family quote / request: the guardian's payload, forced to the
-- family payer, auto billing, no price or availability override.
create or replace function public.bk_family_payload(p jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select public.bk_read_payload(jsonb_build_object(
    'athlete_id', p->>'athlete_id', 'service_id', p->>'service_id', 'coach_id', p->>'coach_id',
    'session_id', p->>'session_id', 'starts_at', p->>'starts_at', 'billing', 'auto',
    'notes', p->>'notes', 'promo_code', p->>'promo_code', 'notify', true));
$$;

-- Evaluate a family request; without a coach, pick the first eligible coach
-- that can take it (inside declared availability first). Internal.
create or replace function public.bk_family_evaluate(p_org uuid, p_ath uuid, p_svc public.training_services, x jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_eval jsonb; v_ok jsonb; v_first jsonb; c record;
begin
  if (x->>'session_id') is not null or (x->>'coach_id') is not null then
    if (x->>'coach_id') is not null and (x->>'session_id') is null
       and not exists (select 1 from public.coaches cc where cc.id = (x->>'coach_id')::uuid and cc.org_id = p_org and cc.is_active
                        and public.bk_coach_eligible(p_svc.id, cc.id)) then
      return jsonb_build_object('errors', to_jsonb(array['COACH_NOT_ELIGIBLE']), 'warnings', '[]'::jsonb);
    end if;
    return public.bk_evaluate(p_org, p_ath, p_svc, (x->>'coach_id')::uuid, (x->>'starts_at')::timestamptz,
                              (x->>'session_id')::uuid, null, false, null);
  end if;
  for c in select co.id from public.coaches co
            where co.org_id = p_org and co.is_active and public.bk_coach_eligible(p_svc.id, co.id)
            order by co.display_name, co.id loop
    v_eval := public.bk_evaluate(p_org, p_ath, p_svc, c.id, (x->>'starts_at')::timestamptz, null, null, false, null);
    if v_first is null then v_first := v_eval; end if;
    if jsonb_array_length(v_eval->'errors') = 0 then
      if (v_eval->>'within_availability')::boolean then return v_eval; end if;
      if v_ok is null then v_ok := v_eval; end if;
    end if;
  end loop;
  return coalesce(v_ok, v_first, jsonb_build_object('errors', to_jsonb(array['COACH_REQUIRED']), 'warnings', '[]'::jsonb));
end $$;

create or replace function public.bk_family_guard(p_org uuid, x jsonb, out a public.athletes, out s public.training_services)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_org is null then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into a from public.athletes where id = (x->>'athlete_id')::uuid and org_id = p_org;
  if not found or not public.is_guardian_of_athlete(a.id) then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
  if a.archived_at is not null then raise exception 'ATHLETE_ARCHIVED' using errcode = 'P0001'; end if;
  if not (public.bk_settings(p_org)->>'bookings_enabled')::boolean then raise exception 'BOOKINGS_DISABLED' using errcode = 'P0001'; end if;
  select * into s from public.training_services where id = (x->>'service_id')::uuid and org_id = p_org and is_active and bookable_by_families;
  if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002'; end if;
  if (x->>'session_id') is null and (x->>'starts_at') is null then raise exception 'INVALID_TIME' using errcode = 'P0001'; end if;
  if (x->>'session_id') is null and (x->>'starts_at')::timestamptz <= now() then raise exception 'SLOT_IN_PAST' using errcode = 'P0001'; end if;
  if length(coalesce(x->>'notes', '')) > 1000 then raise exception 'NOTE_TOO_LONG' using errcode = 'P0001'; end if;
end $$;

-- Quote of a family request (writes nothing).
create or replace function public.booking_family_quote(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  x jsonb := public.bk_family_payload(coalesce(p_payload, '{}'::jsonb));
  v_org uuid := public.current_org_id();
  g record; v_eval jsonb; v_bill jsonb; v_err jsonb;
begin
  select * into g from public.bk_family_guard(v_org, x);
  perform set_config('app.bk_family_request', 'on', true);
  v_eval := public.bk_family_evaluate(v_org, (g.a).id, g.s, x);
  perform set_config('app.bk_family_request', '', true);
  v_bill := public.bk_billing_quote(v_org, (g.a).id, g.s, x, coalesce((v_eval->>'starts_at')::timestamptz, now()), false);
  v_err := coalesce(v_eval->'errors', '[]'::jsonb) || coalesce(v_bill->'errors', '[]'::jsonb);
  return jsonb_build_object(
    'ok', jsonb_array_length(v_err) = 0, 'errors', v_err,
    'warnings', coalesce((select jsonb_agg(w) from jsonb_array_elements(coalesce(v_eval->'warnings', '[]'::jsonb)) w
                           where w->>'code' in ('ATHLETE_OVERLAP', 'NEEDS_COACH_CONFIRMATION')), '[]'::jsonb),
    'slot', jsonb_build_object('session_id', v_eval->'session_id', 'coach_id', v_eval->'coach_id',
                               'coach_name', (select c.display_name from public.coaches c where c.id = (v_eval->>'coach_id')::uuid),
                               'starts_at', v_eval->'starts_at', 'ends_at', v_eval->'ends_at',
                               'places_left', v_eval->'places_left', 'capacity', v_eval->'capacity',
                               'within_availability', coalesce((v_eval->>'within_availability')::boolean, false)),
    'billing', jsonb_build_object('billing_mode', v_bill->'billing_mode', 'price', v_bill->'price', 'list_price', v_bill->'list_price',
                                  'currency', v_bill->'currency', 'package_remaining', v_bill->'package_remaining',
                                  'discount_total', v_bill->'discount_total', 'promo', v_bill->'promo', 'promo_code', v_bill->'promo_code'),
    'creates', 'requested',
    'service', jsonb_build_object('id', (g.s).id, 'name', (g.s).name, 'kind', (g.s).kind, 'duration_min', (g.s).duration_min));
end $$;

-- Create a family request: always `requested`, whatever the availability mode.
create or replace function public.booking_family_request(p_payload jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  x jsonb := public.bk_family_payload(coalesce(p_payload, '{}'::jsonb));
  v_org uuid := public.current_org_id();
  g record; v_rep jsonb; v_bid uuid; v_eval jsonb; v_bill jsonb; v_code text; v_place jsonb; v_res jsonb;
begin
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  v_rep := public.bk_replay(p_request_id, 'family_request');
  if v_rep is not null then return v_rep; end if;
  select * into g from public.bk_family_guard(v_org, x);
  select id into v_bid from public.training_bookings where org_id = v_org and request_id = p_request_id;
  if v_bid is not null then raise exception 'REQUEST_ID_REUSED' using errcode = 'P0001'; end if;

  perform set_config('app.bk_internal', 'on', true);
  perform set_config('app.bk_family_request', 'on', true);
  v_eval := public.bk_family_evaluate(v_org, (g.a).id, g.s, x);
  v_code := public.bk_first_error(v_eval);
  if v_code is not null then raise exception '%', v_code using errcode = 'P0001'; end if;
  -- serialise per coach, then evaluate the chosen slot again under the lock
  perform 1 from public.coaches where id = (v_eval->>'coach_id')::uuid and org_id = v_org for update;
  v_eval := public.bk_evaluate(v_org, (g.a).id, g.s, (v_eval->>'coach_id')::uuid, (v_eval->>'starts_at')::timestamptz,
                               (x->>'session_id')::uuid, null, false, null);
  perform set_config('app.bk_family_request', '', true);
  v_code := public.bk_first_error(v_eval);
  if v_code is not null then raise exception '%', v_code using errcode = 'P0001'; end if;
  v_bill := public.bk_billing_quote(v_org, (g.a).id, g.s, x, (v_eval->>'starts_at')::timestamptz, false);
  v_code := public.bk_first_error(v_bill);
  if v_code is not null then raise exception '%', v_code using errcode = 'P0001'; end if;

  v_place := public.bk_place(v_org, g.a, g.s, x, v_eval, v_bill, 'requested', 'family', p_request_id, false);
  v_bid := (v_place->>'booking_id')::uuid;
  perform public.bk_enqueue_notifications(v_bid, 'requested');
  perform set_config('app.bk_internal', '', true);
  v_res := jsonb_build_object('ok', true, 'booking_id', v_bid, 'status', 'requested', 'session_id', v_place->'session_id',
                              'starts_at', v_place->'starts_at', 'ends_at', v_place->'ends_at', 'coach_id', v_place->'coach_id',
                              'billing_mode', v_bill->>'billing_mode', 'price', v_bill->'price', 'currency', v_bill->>'currency',
                              'discount_total', coalesce(v_bill->'discount_total', '0'::jsonb));
  return public.bk_remember(p_request_id, 'family_request', v_res);
end $$;

-- ---------------------------------------------------------------------------
-- 9. Reads
-- ---------------------------------------------------------------------------
-- One booking row for staff lists: + request, discount and attendance fields.
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
                                                                 'rescheduled_from', s.rescheduled_from,
                                                                 'pending', public.bk_session_pending(s.id)) end,
    'location', coalesce((select v.name from public.venues v where v.id = b.venue_id), b.location_text),
    'price', b.price_chf, 'list_price', b.list_price, 'currency', coalesce(b.currency, i.currency, public.bk_currency(ts)),
    'price_override_reason', b.price_override_reason,
    'discount_total', b.discount_total, 'promo_code', b.promo_code,
    'invoice', case when i.id is not null then jsonb_build_object(
                 'id', i.id, 'number', i.number, 'status', i.status, 'due_date', i.due_date,
                 'total', i.total_chf + i.adjustments_total, 'paid', public.invoice_net_paid(i.id),
                 'balance', i.total_chf + i.adjustments_total - public.invoice_net_paid(i.id)) end,
    'warnings', b.warnings, 'cancel_reason', b.cancel_reason, 'cancelled_at', b.cancelled_at,
    'request', case when b.requested_at is not null then jsonb_build_object(
                 'source', b.request_source, 'requested_at', b.requested_at,
                 'requested_by_name', (select pf.full_name from public.profiles pf where pf.id = b.requested_by),
                 'decision', b.request_decision, 'decided_at', b.request_decided_at,
                 'decided_by_name', (select pf.full_name from public.profiles pf where pf.id = b.request_decided_by),
                 'stale', b.status::text = 'requested'
                          and b.requested_at < now() - make_interval(hours => (public.bk_settings(b.org_id)->>'request_followup_hours')::int)) end,
    'attendance_status', b.attendance_status)
    from public.training_services ts
    left join public.coaches c on c.id = b.coach_id
    left join public.athletes a on a.id = b.athlete_id
    left join public.billing_payers p on p.id = b.payer_id
    left join public.training_sessions s on s.id = b.session_id
    left join public.invoices i on i.id = b.invoice_id
   where ts.id = b.service_id;
$$;

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
    'can_decide', b.status::text = 'requested' and public.bk_can_decide(b),
    'participants', coalesce((select jsonb_agg(jsonb_build_object('booking_id', o.id, 'athlete_id', o.athlete_id,
                                                                  'first_name', oa.first_name, 'last_name', oa.last_name,
                                                                  'status', o.status) order by oa.last_name, oa.first_name)
                                from public.training_bookings o join public.athletes oa on oa.id = o.athlete_id
                               where b.session_id is not null and o.session_id = b.session_id
                                 and o.status <> 'cancelled'), '[]'::jsonb),
    'entitlement', (select jsonb_build_object('purchase_id', e.purchase_id, 'consumed_at', e.consumed_at, 'restored_at', e.restored_at,
                                              'sessions', tp.sessions, 'sessions_used', tp.sessions_used)
                      from public.training_booking_entitlements e join public.training_package_purchases tp on tp.id = e.purchase_id
                     where e.booking_id = b.id),
    'discounts', coalesce((select jsonb_agg(jsonb_build_object('name', ad.name, 'code', ad.code, 'amount', ad.amount,
                                                               'currency', ad.currency, 'invoice_id', ad.invoice_id,
                                                               'voided_at', ad.voided_at) order by ad.created_at)
                             from public.applied_discounts ad
                            where ad.org_id = b.org_id and ad.source = 'booking' and ad.source_id = b.id), '[]'::jsonb),
    'attendance', (select jsonb_build_object('sheet_status', sh.status, 'status', m.status, 'finalized_status', m.finalized_status)
                     from public.training_sessions s
                     join public.team_attendance_sheets sh on sh.event_id = s.event_id
                     left join public.team_attendance_marks m on m.sheet_id = sh.id and m.athlete_id = b.athlete_id
                    where s.id = b.session_id),
    'absence_report', (select jsonb_build_object('report_id', r.id, 'status', r.status, 'reason_category', r.reason_category,
                                                 'created_at', r.created_at)
                         from public.training_sessions s
                         join public.team_absence_reports r on r.event_id = s.event_id and r.athlete_id = b.athlete_id
                        where s.id = b.session_id and r.status in ('reported', 'acknowledged') limit 1),
    'notifications', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'recipient_kind', n.recipient_kind,
                                                                   'recipient_name', n.recipient_name, 'recipient_email', n.recipient_email,
                                                                   'status', n.status, 'attempts', n.attempts, 'last_error', n.last_error,
                                                                   'sent_at', n.sent_at, 'created_at', n.created_at) order by n.created_at)
                                 from public.booking_notifications n where n.booking_id = b.id), '[]'::jsonb),
    'invoice_deliveries', coalesce((select jsonb_agg(jsonb_build_object('email_log_id', l.id, 'to_email', l.to_email, 'status', l.status,
                                                                        'error', l.error, 'attempts', l.attempts, 'sent_at', l.sent_at,
                                                                        'created_at', l.created_at) order by l.created_at)
                                      from public.email_logs l where b.invoice_id is not null and l.invoice_id = b.invoice_id), '[]'::jsonb),
    'invoice_preview', case when b.invoice_id is null and b.status::text <> 'requested' then public.booking_invoice_preview(b.id) end);
end $$;

-- Coach agenda: + requests on the roster (held places) and the pending flag.
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
             'pending', public.bk_session_pending(s.id),
             'requests_count', (select count(*)::int from public.training_bookings r where r.session_id = s.id and r.status::text = 'requested'),
             'sheet_status', (select sh.status from public.team_attendance_sheets sh where sh.event_id = s.event_id),
             'participants', coalesce((select jsonb_agg(jsonb_build_object('athlete_id', a.id, 'first_name', a.first_name,
                                                                           'last_name', a.last_name, 'booking_status', b.status)
                                                        order by a.last_name, a.first_name)
                                         from public.training_bookings b join public.athletes a on a.id = b.athlete_id
                                        where b.session_id = s.id and b.status <> 'cancelled'), '[]'::jsonb))
           order by s.starts_at)
      from public.training_sessions s join public.training_services ts on ts.id = s.service_id
     where s.org_id = public.current_org_id() and s.coach_id = v_coach
       and s.starts_at >= coalesce(p_from, now() - interval '1 day')
       and s.starts_at < coalesce(p_to, now() + interval '14 days')), '[]'::jsonb);
end $$;

-- Booking requests waiting for the coach (coach: own; admin: one coach or
-- the club). Names and times only: no payer, price or notes.
create or replace function public.coach_booking_requests(p_coach uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_coach uuid; v_all boolean := false; v_hours int;
begin
  if public.is_admin() then
    v_coach := p_coach; v_all := p_coach is null;
  else
    v_coach := public.current_coach_id();
  end if;
  if v_coach is null and not v_all then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  v_hours := (public.bk_settings(public.current_org_id())->>'request_followup_hours')::int;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'booking_id', b.id, 'session_id', b.session_id, 'event_id', s.event_id,
             'service_id', ts.id, 'service_name', ts.name, 'kind', ts.kind,
             'coach_id', b.coach_id, 'coach_name', c.display_name,
             'starts_at', b.slot_start, 'ends_at', b.slot_end,
             'location', coalesce((select v.name from public.venues v where v.id = b.venue_id), b.location_text),
             'athlete_first_name', a.first_name, 'athlete_last_name', a.last_name,
             'source', b.request_source, 'requested_at', b.requested_at,
             'stale', b.requested_at < now() - make_interval(hours => v_hours),
             'participants_count', public.bk_session_count(b.session_id), 'capacity', s.capacity)
           order by b.slot_start)
      from public.training_bookings b
      join public.training_services ts on ts.id = b.service_id
      join public.athletes a on a.id = b.athlete_id
      left join public.coaches c on c.id = b.coach_id
      left join public.training_sessions s on s.id = b.session_id
     where b.org_id = public.current_org_id() and b.status::text = 'requested'
       and (v_all or b.coach_id = v_coach)), '[]'::jsonb);
end $$;

-- Session events that only hold requests (calendar style "awaiting
-- confirmation"). Visible events only: staff, coaches, and the family of a
-- participant (same rule as events_select).
create or replace function public.session_events_pending(p_events uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select e.id
    from public.events e
   where e.id = any(coalesce(p_events, '{}')) and e.org_id = public.current_org_id()
     and e.training_session_id is not null
     and (public.is_finance() or public.has_role('coach'::public.app_role) or public.bk_viewer_sees_session(e.training_session_id))
     and public.bk_session_pending(e.training_session_id);
$$;

-- Guardian / player portal rows: + requests (awaiting confirmation), the
-- decision of a declined request, the attendance marker of a booking.
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
               'booking_id', b.id, 'service_name', ts.name, 'kind', ts.kind, 'coach_name', c.display_name,
               'starts_at', b.slot_start, 'ends_at', b.slot_end, 'status', b.status,
               'awaiting_confirmation', b.status::text = 'requested',
               'can_withdraw', p_money and b.status::text = 'requested' and b.request_source = 'family',
               'requested_at', b.requested_at,
               'event_id', s.event_id,
               'can_report_absence', b.status::text = 'booked' and b.slot_start > now() and s.event_id is not null
                                     and coalesce(s.status, 'scheduled') = 'scheduled',
               'absence_report', (select jsonb_build_object('report_id', r.id, 'status', r.status, 'reason_category', r.reason_category)
                                    from public.team_absence_reports r
                                   where r.event_id = s.event_id and r.athlete_id = b.athlete_id and r.status in ('reported', 'acknowledged')
                                   limit 1),
               'rescheduled_from', s.rescheduled_from, 'rescheduled_at', b.rescheduled_at,
               'location', coalesce((select v.name from public.venues v where v.id = b.venue_id), b.location_text))
             order by b.slot_start)
        from public.training_bookings b
        join public.training_services ts on ts.id = b.service_id
        left join public.coaches c on c.id = b.coach_id
        left join public.training_sessions s on s.id = b.session_id
       where b.athlete_id = p_athlete and b.status::text in ('booked', 'requested')
         and coalesce(b.slot_end, b.slot_start) >= now()), '[]'::jsonb),
    'changes', coalesce((
      select jsonb_agg(jsonb_build_object('booking_id', b.id, 'service_name', ts.name, 'coach_name', c.display_name,
                                          'starts_at', b.slot_start, 'ends_at', b.slot_end,
                                          'change', case when b.request_decision = 'declined' then 'declined'
                                                         when b.request_decision = 'withdrawn' then 'withdrawn'
                                                         when b.status = 'cancelled' then 'cancelled' else 'rescheduled' end,
                                          'reason', case when b.status = 'cancelled' then b.cancel_reason end,
                                          'previous_starts_at', case when b.status <> 'cancelled' then s.rescheduled_from end,
                                          'at', coalesce(b.cancelled_at, b.rescheduled_at))
             order by coalesce(b.cancelled_at, b.rescheduled_at) desc)
        from public.training_bookings b
        join public.training_services ts on ts.id = b.service_id
        left join public.coaches c on c.id = b.coach_id
        left join public.training_sessions s on s.id = b.session_id
       where b.athlete_id = p_athlete
         and ((b.status = 'cancelled' and b.cancelled_at >= now() - interval '30 days')
              or (b.status <> 'cancelled' and b.rescheduled_at is not null and b.rescheduled_at >= now() - interval '30 days'))), '[]'::jsonb),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object('event_id', e.id, 'service_name', ts.name, 'coach_name', c.display_name,
                                          'starts_at', e.starts_at, 'status', m.finalized_status,
                                          'booking_status', (select bb.status from public.training_bookings bb
                                                              where bb.session_id = s.id and bb.athlete_id = p_athlete
                                                                and bb.status <> 'cancelled' limit 1))
             order by e.starts_at desc)
        from public.team_attendance_marks m
        join public.team_attendance_sheets sh on sh.id = m.sheet_id and sh.finalize_count > 0
        join public.events e on e.id = m.event_id and e.training_session_id is not null
        join public.training_sessions s on s.id = e.training_session_id
        join public.training_services ts on ts.id = s.service_id
        left join public.coaches c on c.id = s.coach_id
       where m.athlete_id = p_athlete and m.finalized_status is not null), '[]'::jsonb),
    'invoices', case when p_money then coalesce((
      select jsonb_agg(jsonb_build_object('invoice_id', i.id, 'number', i.number, 'status', i.status, 'due_date', i.due_date,
                                          'currency', i.currency, 'total', i.total_chf + i.adjustments_total,
                                          'balance', i.total_chf + i.adjustments_total - public.invoice_net_paid(i.id),
                                          'booking_id', b.id, 'service_name', ts.name, 'starts_at', b.slot_start)
             order by i.issued_at desc)
        from public.training_bookings b
        join public.invoices i on i.id = b.invoice_id
        join public.training_services ts on ts.id = b.service_id
       where b.athlete_id = p_athlete and public.bk_guardian_sees_invoice(i.id)), '[]'::jsonb) else '[]'::jsonb end);
$$;

create or replace function public.booking_dashboard_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id(); v_tz text; v_day timestamptz; v_hours int;
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  v_tz := public.ta_tz(v_org);
  v_day := (public.ta_today(v_org)::timestamp) at time zone v_tz;
  v_hours := (public.bk_settings(v_org)->>'request_followup_hours')::int;
  return jsonb_build_object(
    'today', (select count(*) from public.training_bookings b where b.org_id = v_org and b.status in ('booked', 'completed', 'no_show')
                and b.slot_start >= v_day and b.slot_start < v_day + interval '1 day'),
    'next_7_days', (select count(*) from public.training_bookings b where b.org_id = v_org and b.status = 'booked'
                      and b.slot_start >= now() and b.slot_start < now() + interval '7 days'),
    'awaiting_invoice', (select count(*) from public.training_bookings b
                          where b.org_id = v_org and b.status in ('booked', 'completed', 'no_show') and b.invoice_id is null
                            and coalesce(b.price_chf, 0) > 0
                            and coalesce(b.billing_mode, case when b.purchase_id is null and coalesce(b.credits_used, 0) = 0 then 'invoice' end) = 'invoice'),
    'awaiting_confirmation', (select count(*) from public.training_bookings b where b.org_id = v_org and b.status::text = 'requested'),
    'stale_requests', (select count(*) from public.training_bookings b where b.org_id = v_org and b.status::text = 'requested'
                         and b.requested_at < now() - make_interval(hours => v_hours)),
    'outstanding', coalesce((select jsonb_agg(jsonb_build_object('currency', x.currency, 'amount', x.amount, 'count', x.n))
                               from (select i.currency, sum(i.total_chf + i.adjustments_total - public.invoice_net_paid(i.id)) as amount, count(*) as n
                                       from public.invoices i
                                      where i.org_id = v_org and i.status::text in ('pending', 'sent', 'partially_paid', 'overdue')
                                        and exists (select 1 from public.training_bookings b where b.invoice_id = i.id)
                                      group by i.currency) x), '[]'::jsonb),
    'failed_notifications', (select count(*) from public.booking_notifications n
                              where n.org_id = v_org and n.status in ('failed', 'no_contact')));
end $$;

-- Follow-ups: + requests unanswered after settings.booking.request_followup_hours.
create or replace function public.booking_followups(p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id(); v_lim int := greatest(1, least(coalesce(p_limit, 100), 500)); v_hours int;
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  v_hours := (public.bk_settings(v_org)->>'request_followup_hours')::int;
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
        join public.training_bookings b on b.invoice_id = i.id), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('booking_id', b.id, 'athlete_name', a.first_name || ' ' || a.last_name,
                                          'service_name', ts.name, 'coach_name', c.display_name, 'starts_at', b.slot_start,
                                          'requested_at', b.requested_at, 'source', b.request_source,
                                          'hours_waiting', floor(extract(epoch from now() - b.requested_at) / 3600)::int)
             order by b.requested_at)
        from (select * from public.training_bookings b
               where b.org_id = v_org and b.status::text = 'requested' and b.requested_at < now() - make_interval(hours => v_hours)
               order by b.requested_at limit v_lim) b
        join public.athletes a on a.id = b.athlete_id
        join public.training_services ts on ts.id = b.service_id
        left join public.coaches c on c.id = b.coach_id), '[]'::jsonb),
    'request_followup_hours', v_hours);
end $$;

-- Catalogue: + bookable_by_families.
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
             'bookable_by_families', s.bookable_by_families,
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


-- ---------------------------------------------------------------------------
-- 10. Booking status from the finalized attendance sheet
--     present / late -> completed, unexcused -> no_show, excused -> stays
--     booked with attendance_status = 'excused'. Runs on finalize and on
--     every correction (finalized_status changes). Billing is unaffected.
-- ---------------------------------------------------------------------------
create or replace function public.bk_attendance_booking_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_session uuid; v_status text; v_prev text := current_setting('app.bk_internal', true);
begin
  if new.finalized_status is null then return null; end if;
  if tg_op = 'UPDATE' and new.finalized_status is not distinct from old.finalized_status then return null; end if;
  select e.training_session_id into v_session from public.events e where e.id = new.event_id;
  if v_session is null then return null; end if;
  v_status := case new.finalized_status when 'present' then 'completed' when 'late' then 'completed'
                                        when 'unexcused' then 'no_show' when 'excused' then 'booked' end;
  if v_status is null then return null; end if;
  perform set_config('app.bk_internal', 'on', true);
  update public.training_bookings b
     set status = v_status::public.booking_status, attendance_status = new.finalized_status, attendance_synced_at = now()
   where b.session_id = v_session and b.athlete_id = new.athlete_id and b.status in ('booked', 'completed', 'no_show')
     and (b.status::text is distinct from v_status or b.attendance_status is distinct from new.finalized_status);
  perform set_config('app.bk_internal', coalesce(v_prev, ''), true);
  return null;
end $$;

drop trigger if exists trg_marks_booking_status on public.team_attendance_marks;
create trigger trg_marks_booking_status after insert or update of finalized_status on public.team_attendance_marks
  for each row execute function public.bk_attendance_booking_sync();

-- Existing finalized session marks (none expected on the live club): sync once.
do $$
declare m record;
begin
  for m in select tm.* from public.team_attendance_marks tm
             join public.events e on e.id = tm.event_id and e.training_session_id is not null
            where tm.finalized_status is not null loop
    perform set_config('app.bk_internal', 'on', true);
    update public.training_bookings b
       set status = (case m.finalized_status when 'present' then 'completed' when 'late' then 'completed'
                                             when 'unexcused' then 'no_show' else 'booked' end)::public.booking_status,
           attendance_status = m.finalized_status, attendance_synced_at = now()
     where b.session_id = (select training_session_id from public.events where id = m.event_id)
       and b.athlete_id = m.athlete_id and b.status in ('booked', 'completed', 'no_show') and b.attendance_status is null;
    perform set_config('app.bk_internal', '', true);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 11. Absence reports and correction requests for booked-session events
-- ---------------------------------------------------------------------------
-- A guardian (or the player) reports an absence for a confirmed booked
-- session before it starts; team events unchanged.
create or replace function public.absence_report(p_event uuid, p_athlete uuid, p_reason text default null,
                                                 p_category text default 'other')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ev   public.events%rowtype;
  v_kind text;
  v_id   uuid;
begin
  select * into v_ev from public.events where id = p_event;
  if not found or v_ev.org_id is distinct from public.current_org_id() then raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if public.is_guardian_of_athlete(p_athlete) then v_kind := 'guardian';
  elsif public.is_player_of_athlete(p_athlete) then v_kind := 'player';
  else raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if v_ev.training_session_id is not null then
    if v_ev.status not in ('scheduled', 'postponed') then raise exception 'EVENT_CLOSED' using errcode = 'P0001'; end if;
    if now() >= v_ev.starts_at then raise exception 'ABSENCE_CUTOFF_PASSED' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.training_bookings b
                    where b.session_id = v_ev.training_session_id and b.athlete_id = p_athlete and b.status = 'booked') then
      raise exception 'NOT_BOOKED' using errcode = 'P0001';
    end if;
  else
    if v_ev.team_id is null or not (v_ev.type::text = any(public.ta_sheet_types())) then
      raise exception 'EVENT_TYPE_NOT_SUPPORTED' using errcode = 'P0001';
    end if;
    if v_ev.status not in ('scheduled', 'postponed') then raise exception 'EVENT_CLOSED' using errcode = 'P0001'; end if;
    if now() >= v_ev.starts_at then raise exception 'ABSENCE_CUTOFF_PASSED' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.ta_roster_on(v_ev.team_id, (v_ev.starts_at at time zone public.ta_tz(v_ev.org_id))::date) r
                    where r.athlete_id = p_athlete)
       and not exists (select 1 from public.team_attendance_marks m where m.event_id = p_event and m.athlete_id = p_athlete) then
      raise exception 'NOT_ON_TEAM' using errcode = 'P0001';
    end if;
  end if;
  if coalesce(p_category, 'other') not in ('illness', 'injury', 'school', 'family', 'travel', 'other') then
    raise exception 'INVALID_CATEGORY' using errcode = 'P0001';
  end if;
  if length(coalesce(p_reason, '')) > 500 then raise exception 'REASON_TOO_LONG' using errcode = 'P0001'; end if;
  update public.team_absence_reports set status = 'superseded'
   where event_id = p_event and athlete_id = p_athlete and status in ('reported', 'acknowledged');
  insert into public.team_absence_reports (org_id, event_id, athlete_id, reported_by, reporter_kind, reason, reason_category, event_starts_at)
  values (v_ev.org_id, p_event, p_athlete, auth.uid(), v_kind, nullif(btrim(p_reason), ''), coalesce(p_category, 'other'), v_ev.starts_at)
  returning id into v_id;
  return jsonb_build_object('report_id', v_id, 'status', 'reported', 'event_id', p_event, 'athlete_id', p_athlete,
                            'team_id', v_ev.team_id, 'training_session_id', v_ev.training_session_id,
                            'coach_profile_id', (select c.profile_id from public.training_sessions s join public.coaches c on c.id = s.coach_id
                                                  where s.id = v_ev.training_session_id));
end;
$$;

-- Sheet preview (read, nothing saved) of a booked-session event too, so the
-- coach sees reported absences before opening the sheet.
create or replace function public.attendance_sheet(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ev public.events%rowtype;
begin
  select * into v_ev from public.events where id = p_event;
  if not found or v_ev.org_id is distinct from public.current_org_id() then raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.ta_can_run(p_event) then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if v_ev.team_id is null and v_ev.training_session_id is null then raise exception 'EVENT_HAS_NO_TEAM' using errcode = 'P0001'; end if;
  return public.ta_sheet_json(p_event);
end;
$$;

-- Parent record page: team events and booked-session events.
create or replace function public.guardian_attendance_record(p_event uuid, p_athlete uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ev   public.events%rowtype;
  v_ath  public.athletes%rowtype;
  v_tz   text;
  s      public.team_attendance_sheets%rowtype;
  m      public.team_attendance_marks%rowtype;
  v_has_sheet boolean;
  v_has_mark  boolean;
  v_final     boolean;
  v_bk        public.training_bookings%rowtype;
  v_session   public.training_sessions%rowtype;
begin
  select * into v_ath from public.athletes where id = p_athlete;
  if not found or v_ath.org_id is distinct from public.current_org_id() then
    raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (public.is_guardian_of_athlete(p_athlete) or public.is_admin()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select * into v_ev from public.events where id = p_event;
  if not found or v_ev.org_id is distinct from v_ath.org_id or (v_ev.team_id is null and v_ev.training_session_id is null) then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_tz := public.ta_tz(v_ev.org_id);
  select * into s from public.team_attendance_sheets where event_id = p_event;
  v_has_sheet := found;
  if v_has_sheet then
    select * into m from public.team_attendance_marks where sheet_id = s.id and athlete_id = p_athlete;
    v_has_mark := found;
  else
    v_has_mark := false;
  end if;
  if v_ev.training_session_id is not null then
    select * into v_session from public.training_sessions where id = v_ev.training_session_id;
    select * into v_bk from public.training_bookings b
     where b.session_id = v_ev.training_session_id and b.athlete_id = p_athlete and b.status::text <> 'cancelled'
     order by b.created_at desc limit 1;
    if not v_has_mark and v_bk.id is null then raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002'; end if;
  elsif not v_has_mark and not exists (
       select 1 from public.ta_roster_on(v_ev.team_id, (v_ev.starts_at at time zone v_tz)::date) r where r.athlete_id = p_athlete) then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_final := v_has_mark and s.finalize_count > 0 and m.finalized_status is not null;

  return jsonb_build_object(
    'athlete', jsonb_build_object('id', v_ath.id, 'first_name', v_ath.first_name, 'last_name', v_ath.last_name),
    'timezone', v_tz,
    'event', jsonb_build_object(
      'id', v_ev.id, 'team_id', v_ev.team_id,
      'team_name', coalesce((select name from public.teams where id = v_ev.team_id), v_ev.title),
      'training_session_id', v_ev.training_session_id,
      'type', v_ev.type, 'title', v_ev.title, 'starts_at', v_ev.starts_at, 'ends_at', v_ev.ends_at, 'status', v_ev.status,
      'cancel_reason', case when v_ev.status = 'cancelled' then v_ev.cancel_reason end,
      'rescheduled_from', v_ev.rescheduled_from,
      'location', coalesce((select v.name from public.venues v where v.id = v_ev.venue_id), v_ev.location_name, v_ev.location_text),
      'ended', v_ev.ends_at < now()),
    'session', case when v_ev.training_session_id is not null then jsonb_build_object(
      'service_name', (select ts.name from public.training_services ts where ts.id = v_session.service_id),
      'coach_name', (select c.display_name from public.coaches c where c.id = v_session.coach_id),
      'booking_id', v_bk.id, 'booking_status', v_bk.status, 'attendance_status', v_bk.attendance_status) end,
    'attendance', case when v_final then jsonb_build_object(
        'status', m.finalized_status, 'is_guest', m.is_guest,
        'finalized_at', coalesce(s.finalized_at, s.first_finalized_at),
        'corrected', exists (select 1 from public.team_attendance_mark_history h where h.mark_id = m.id and h.phase = 'correction'))
      end,
    'final', v_final,
    'can_request_correction', v_final and public.is_guardian_of_athlete(p_athlete) and v_ev.status <> 'cancelled'
                              and not exists (select 1 from public.attendance_correction_requests q where q.mark_id = m.id and q.status = 'open'),
    'can_report', v_ev.status in ('scheduled', 'postponed') and v_ev.starts_at > now() and public.is_guardian_of_athlete(p_athlete)
                  and (v_ev.training_session_id is null or v_bk.status::text = 'booked'),
    'report', (select jsonb_build_object('report_id', r.id, 'status', r.status, 'reason', r.reason, 'reason_category', r.reason_category,
                                         'needs_review', r.needs_review, 'reporter_kind', r.reporter_kind,
                                         'mine', r.reported_by = auth.uid(), 'created_at', r.created_at)
                 from public.team_absence_reports r
                where r.event_id = p_event and r.athlete_id = p_athlete and r.status in ('reported', 'acknowledged')
                order by r.created_at desc limit 1),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('request_id', q.id, 'status', q.status, 'message', q.message,
                                          'current_status', q.current_status, 'requested_status', q.requested_status,
                                          'resolution_note', q.resolution_note, 'resolved_at', q.resolved_at,
                                          'created_at', q.created_at, 'mine', q.requested_by = auth.uid())
             order by q.created_at desc)
        from public.attendance_correction_requests q where q.event_id = p_event and q.athlete_id = p_athlete), '[]'::jsonb),
    'alerts', coalesce((
      select jsonb_agg(jsonb_build_object('kind', al.kind, 'status', al.status, 'mark_status', al.mark_status, 'sent_at', al.sent_at)
             order by al.created_at desc)
        from public.attendance_no_show_alerts al
       where al.event_id = p_event and al.athlete_id = p_athlete and al.guardian_profile_id = auth.uid()
         and al.status in ('sent', 'superseded') and al.sent_at is not null), '[]'::jsonb));
end;
$$;

-- Corrections of a booked session are resolved by an admin or the session coach.
create or replace function public.attendance_correction_resolve(p_request uuid, p_accept boolean,
                                                                p_new_status text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r      public.attendance_correction_requests%rowtype;
  s      public.team_attendance_sheets%rowtype;
  v_st   text;
  v_res  jsonb := null;
begin
  select * into r from public.attendance_correction_requests where id = p_request for update;
  if not found or r.org_id is distinct from public.current_org_id() then raise exception 'CORRECTION_NOT_FOUND' using errcode = 'P0002'; end if;
  if not (public.is_admin()
          or (r.team_id is not null and public.coach_coaches_team(r.team_id))
          or (r.team_id is null and exists (select 1 from public.events e join public.training_sessions ts on ts.id = e.training_session_id
                                             where e.id = r.event_id and ts.coach_id = public.current_coach_id()))) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if r.status <> 'open' then raise exception 'CORRECTION_CLOSED' using errcode = 'P0001'; end if;
  if length(coalesce(p_note, '')) > 1000 then raise exception 'NOTE_TOO_LONG' using errcode = 'P0001'; end if;
  if p_accept then
    v_st := coalesce(p_new_status, r.requested_status);
    if v_st is null or not public.ta_valid_status(v_st, false) then raise exception 'INVALID_STATUS' using errcode = 'P0001'; end if;
    select * into s from public.team_attendance_sheets where event_id = r.event_id for update;
    v_res := public.ta_correct(s.id, r.athlete_id, v_st,
                               'correction request' || coalesce(': ' || nullif(btrim(p_note), ''), ''), null, true);
  elsif length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'NOTE_REQUIRED' using errcode = 'P0001';
  end if;
  update public.attendance_correction_requests
     set status = case when p_accept then 'accepted' else 'rejected' end,
         resolved_by = auth.uid(), resolved_at = now(), resolution_note = nullif(btrim(p_note), ''),
         history_id = nullif(v_res->>'history_id', '')::uuid
   where id = r.id;
  return jsonb_build_object('request_id', r.id, 'status', case when p_accept then 'accepted' else 'rejected' end,
                            'requested_by', r.requested_by, 'event_id', r.event_id, 'athlete_id', r.athlete_id,
                            'team_id', r.team_id, 'correction', v_res);
end;
$$;

create or replace function public.attendance_correction_requests_list(p_status text default 'open', p_athlete uuid default null)
returns table (request_id uuid, status text, event_id uuid, starts_at timestamptz, team_id uuid, team_name text,
               athlete_id uuid, first_name text, last_name text, current_status text, requested_status text,
               mark_status text, message text, requested_by uuid, requested_by_name text, created_at timestamptz,
               resolved_at timestamptz, resolved_by_name text, resolution_note text)
language sql stable security definer set search_path = public as $$
  select r.id, r.status, r.event_id, e.starts_at, r.team_id, coalesce(t.name, e.title), r.athlete_id, a.first_name, a.last_name,
         r.current_status, r.requested_status, m.finalized_status, r.message, r.requested_by, rq.full_name, r.created_at,
         r.resolved_at, rs.full_name, r.resolution_note
    from public.attendance_correction_requests r
    join public.events e on e.id = r.event_id
    left join public.teams t on t.id = r.team_id
    join public.athletes a on a.id = r.athlete_id
    left join public.team_attendance_marks m on m.id = r.mark_id
    left join public.profiles rq on rq.id = r.requested_by
    left join public.profiles rs on rs.id = r.resolved_by
   where r.org_id = public.current_org_id()
     and (p_status is null or r.status = p_status)
     and (p_athlete is null or r.athlete_id = p_athlete)
     and (public.is_admin()
          or (r.team_id is not null and public.coach_coaches_team(r.team_id))
          or (r.team_id is null and exists (select 1 from public.training_sessions ts where ts.id = e.training_session_id
                                             and ts.coach_id = public.current_coach_id()))
          or public.is_guardian_of_athlete(r.athlete_id))
   order by r.created_at desc
   limit 500;
$$;

-- ---------------------------------------------------------------------------
-- 12. Privileges
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.bk_settings(uuid)', 'public.bk_session_count(uuid, uuid)', 'public.bk_session_pending(uuid)',
    'public.bk_venue_open(uuid, uuid, timestamptz, timestamptz)', 'public.bk_coach_blocked(uuid, uuid, timestamptz, timestamptz)',
    'public.bk_read_payload(jsonb)',
    'public.bk_evaluate(uuid, uuid, public.training_services, uuid, timestamptz, uuid, uuid, boolean, uuid, uuid)',
    'public.bk_billing_quote(uuid, uuid, public.training_services, jsonb, timestamptz, boolean)',
    'public.booking_billing_status(uuid)',
    'public.bk_place(uuid, public.athletes, public.training_services, jsonb, jsonb, jsonb, text, text, uuid, boolean)',
    'public.bk_create_invoice(uuid, boolean)', 'public.bk_bookings_release_discounts()', 'public.bk_bookings_request_guard()',
    'public.bk_enqueue_notifications(uuid, text)', 'public.bk_can_decide(public.training_bookings)',
    'public.bk_release_request(public.training_bookings, text)',
    'public.bk_family_payload(jsonb)', 'public.bk_family_evaluate(uuid, uuid, public.training_services, jsonb)',
    'public.bk_family_guard(uuid, jsonb)', 'public.bk_row(public.training_bookings)', 'public.bk_portal_rows(uuid, boolean)',
    'public.bk_attendance_booking_sync()',
    -- service role only (dispatcher)
    'public.booking_notifications_claim(uuid, uuid, integer)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;

  foreach f in array array[
    'public.booking_quote(jsonb)', 'public.booking_confirm(jsonb, uuid)', 'public.booking_create_invoice(uuid, uuid, boolean)',
    'public.booking_request_confirm(uuid, uuid, boolean)', 'public.booking_request_decline(uuid, text, uuid, boolean)',
    'public.booking_request_withdraw(uuid, uuid)', 'public.family_booking_catalog(uuid)',
    'public.booking_family_quote(jsonb)', 'public.booking_family_request(jsonb, uuid)',
    'public.booking_detail(uuid)', 'public.coach_booking_agenda(timestamptz, timestamptz, uuid)',
    'public.coach_booking_requests(uuid)', 'public.session_events_pending(uuid[])',
    'public.booking_dashboard_counts()', 'public.booking_followups(integer)', 'public.training_service_catalog(boolean)',
    'public.absence_report(uuid, uuid, text, text)', 'public.guardian_attendance_record(uuid, uuid)', 'public.attendance_sheet(uuid)',
    'public.attendance_correction_resolve(uuid, boolean, text, text)', 'public.attendance_correction_requests_list(text, uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
