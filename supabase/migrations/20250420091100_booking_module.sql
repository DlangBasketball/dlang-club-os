-- ============================================================================
-- DLang Basketball — Club OS
-- Migration 11 · Training & private-session booking
--
-- Builds on training_services / coach_availability / training_bookings /
-- training_credits (all exist) and the MVP book/cancel RPCs from migration 10.
-- Adds: service credit pricing, a credit-package catalogue, configurable
-- cancellation rules, hard double-booking guards, and atomic RPCs that handle
-- pay-by-credits vs pay-by-invoice, cancellation+refund, reschedule, and
-- admin credit grants — plus a coach notification on every new booking.
-- ============================================================================

create extension if not exists btree_gist;

-- 1) Service fields: human description + credits required ----------------------
alter table public.training_services add column if not exists description      text;
alter table public.training_services add column if not exists credits_required integer not null default 0;

-- 2) Credit packages (admin catalogue; can be granted or sold) -----------------
create table if not exists public.credit_packages (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  credit_category public.credit_category not null default 'personal',
  credits         integer not null check (credits > 0),
  price_chf       numeric(10,2) not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);
alter table public.credit_packages enable row level security;
drop policy if exists credit_packages_select on public.credit_packages;
create policy credit_packages_select on public.credit_packages for select
  using (org_id = public.current_org_id());
drop policy if exists credit_packages_admin_write on public.credit_packages;
create policy credit_packages_admin_write on public.credit_packages for all
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
grant select on public.credit_packages to authenticated;
grant all on public.credit_packages to service_role;

-- 3) Double-booking guards -----------------------------------------------------
-- a) a coach can't hold two ACTIVE bookings at the same start time
create unique index if not exists training_bookings_coach_slot_uniq
  on public.training_bookings (coach_id, slot_start)
  where status in ('booked', 'completed');
-- b) availability slots can't overlap for the same coach
alter table public.coach_availability drop constraint if exists coach_availability_no_overlap;
alter table public.coach_availability
  add constraint coach_availability_no_overlap
  exclude using gist (coach_id with =, tstzrange(starts_at, ends_at) with &&);

-- 4) Configurable cancellation rules (org setting) -----------------------------
update public.app_settings
   set settings = settings || jsonb_build_object('booking', jsonb_build_object(
         'cancellation_hours', 24,
         'refund_credits_on_cancel', true
       ))
 where org_id = '00000000-0000-0000-0000-000000000001'
   and not (settings ? 'booking');

-- 5) Book a session — pay by credits or by invoice (atomic) --------------------
create or replace function public.book_training_session(
  p_athlete  uuid,
  p_service  uuid,
  p_slot     uuid,
  p_pay_with text default 'invoice'   -- 'credits' | 'invoice'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid;
  v_enabled boolean;
  v_slot    public.coach_availability%rowtype;
  v_svc     public.training_services%rowtype;
  v_family  uuid;
  v_booking uuid;
  v_invoice uuid;
  v_invnum  text;
  v_balance integer;
  v_coach_profile uuid;
  v_athlete_name  text;
begin
  select org_id, family_id, first_name || ' ' || last_name
    into v_org, v_family, v_athlete_name from public.athletes where id = p_athlete;
  if v_org is null then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
  if not (public.is_guardian_of_athlete(p_athlete) or public.is_finance()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select coalesce((settings->>'bookings_enabled')::boolean, false) into v_enabled
    from public.app_settings where org_id = v_org;
  if not coalesce(v_enabled, false) then raise exception 'BOOKINGS_DISABLED' using errcode = 'P0001'; end if;

  select * into v_svc from public.training_services where id = p_service and is_active;
  if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002'; end if;

  -- Lock the slot to prevent a double-booking race
  select * into v_slot from public.coach_availability where id = p_slot for update;
  if not found then raise exception 'SLOT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_slot.is_booked then raise exception 'SLOT_TAKEN' using errcode = 'P0001'; end if;

  if p_pay_with = 'credits' then
    if v_svc.credits_required <= 0 then raise exception 'SERVICE_NOT_CREDIT_ELIGIBLE' using errcode = 'P0001'; end if;
    select (total_credits - used_credits) into v_balance from public.training_credits
      where athlete_id = p_athlete and credit_category = v_svc.credit_category;
    if coalesce(v_balance, 0) < v_svc.credits_required then
      raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
    end if;
    update public.training_credits set used_credits = used_credits + v_svc.credits_required, updated_at = now()
      where athlete_id = p_athlete and credit_category = v_svc.credit_category;

    insert into public.training_bookings (org_id, athlete_id, service_id, coach_id, slot_start, slot_end, status, credits_used, price_chf, created_by)
    values (v_org, p_athlete, p_service, v_slot.coach_id, v_slot.starts_at, v_slot.ends_at, 'booked', v_svc.credits_required, 0, auth.uid())
    returning id into v_booking;

  else  -- invoice path
    v_invnum := public.next_invoice_number(v_org);
    insert into public.invoices (org_id, number, family_id, description, status, due_date)
    values (v_org, v_invnum, v_family,
            v_svc.name || ' — ' || v_athlete_name, 'sent', (now() + interval '7 days')::date)
    returning id into v_invoice;
    insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
    values (v_org, v_invoice, v_svc.name || ' — ' || v_athlete_name, 1, v_svc.price_chf, v_svc.price_chf);
    update public.invoices set total_chf = v_svc.price_chf where id = v_invoice;

    insert into public.training_bookings (org_id, athlete_id, service_id, coach_id, slot_start, slot_end, status, price_chf, invoice_id, created_by)
    values (v_org, p_athlete, p_service, v_slot.coach_id, v_slot.starts_at, v_slot.ends_at, 'booked', v_svc.price_chf, v_invoice, auth.uid())
    returning id into v_booking;
  end if;

  update public.coach_availability set is_booked = true where id = p_slot;

  -- Notify the coach (in-app); the action also sends emails.
  select profile_id into v_coach_profile from public.coaches where id = v_slot.coach_id;
  if v_coach_profile is not null then
    insert into public.notifications (org_id, recipient_id, type, title, body, link)
    values (v_org, v_coach_profile, 'training', 'New booking',
            v_athlete_name || ' booked ' || v_svc.name, '/coach/schedule');
  end if;

  return jsonb_build_object('booking_id', v_booking, 'invoice_id', v_invoice,
                            'credits_used', case when p_pay_with = 'credits' then v_svc.credits_required else 0 end,
                            'price_chf', case when p_pay_with = 'credits' then 0 else v_svc.price_chf end,
                            'pay_with', p_pay_with);
end;
$$;

-- 6) Cancel with configurable rules + credit refund / invoice void -------------
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
  select * into v_b from public.training_bookings where id = p_booking;
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002'; end if;
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
    where coach_id = v_b.coach_id and starts_at = v_b.slot_start;

  -- Refund credits when within policy (or staff override)
  if v_b.credits_used > 0 and coalesce(v_refund, true) and (v_within or v_staff) then
    select credit_category into v_category from public.training_services where id = v_b.service_id;
    update public.training_credits set used_credits = greatest(0, used_credits - v_b.credits_used), updated_at = now()
      where athlete_id = v_b.athlete_id and credit_category = v_category;
    v_did_refund := true;
  end if;

  -- Void an unpaid invoice when within policy (or staff override)
  if v_b.invoice_id is not null and (v_within or v_staff) then
    update public.invoices set status = 'cancelled'
      where id = v_b.invoice_id and status in ('draft', 'sent', 'pending', 'overdue');
  end if;

  return jsonb_build_object('booking_id', p_booking, 'status', 'cancelled',
                            'within_policy', v_within, 'credits_refunded', v_did_refund);
end;
$$;

-- 7) Reschedule to another free slot -------------------------------------------
create or replace function public.reschedule_booking(p_booking uuid, p_new_slot uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b    public.training_bookings%rowtype;
  v_slot public.coach_availability%rowtype;
begin
  select * into v_b from public.training_bookings where id = p_booking;
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002'; end if;
  if not (public.is_guardian_of_athlete(v_b.athlete_id) or public.is_finance()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if v_b.status <> 'booked' then raise exception 'NOT_RESCHEDULABLE' using errcode = 'P0001'; end if;

  select * into v_slot from public.coach_availability where id = p_new_slot for update;
  if not found then raise exception 'SLOT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_slot.is_booked then raise exception 'SLOT_TAKEN' using errcode = 'P0001'; end if;

  -- free the old slot, take the new one
  update public.coach_availability set is_booked = false where coach_id = v_b.coach_id and starts_at = v_b.slot_start;
  update public.coach_availability set is_booked = true  where id = p_new_slot;
  update public.training_bookings
     set coach_id = v_slot.coach_id, slot_start = v_slot.starts_at, slot_end = v_slot.ends_at, updated_at = now()
   where id = p_booking;

  return jsonb_build_object('booking_id', p_booking, 'slot_start', v_slot.starts_at);
end;
$$;

-- 8) Admin grants credits (the "package" fulfilment) ---------------------------
create or replace function public.grant_training_credits(p_athlete uuid, p_category text, p_credits integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid;
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_credits = 0 then raise exception 'INVALID_CREDITS' using errcode = 'P0001'; end if;
  select org_id into v_org from public.athletes where id = p_athlete;
  if v_org is null then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;

  insert into public.training_credits (org_id, athlete_id, credit_category, total_credits)
  values (v_org, p_athlete, p_category::public.credit_category, greatest(0, p_credits))
  on conflict (athlete_id, credit_category) do update
    set total_credits = public.training_credits.total_credits + p_credits, updated_at = now();

  return (select jsonb_build_object('athlete_id', p_athlete, 'category', p_category,
                 'total', total_credits, 'used', used_credits, 'balance', total_credits - used_credits)
          from public.training_credits where athlete_id = p_athlete and credit_category = p_category::public.credit_category);
end;
$$;

-- 9) Grants --------------------------------------------------------------------
grant execute on function public.book_training_session(uuid, uuid, uuid, text) to authenticated, service_role;
grant execute on function public.cancel_training_booking(uuid)                 to authenticated, service_role;
grant execute on function public.reschedule_booking(uuid, uuid)                to authenticated, service_role;
grant execute on function public.grant_training_credits(uuid, text, integer)   to authenticated, service_role;
