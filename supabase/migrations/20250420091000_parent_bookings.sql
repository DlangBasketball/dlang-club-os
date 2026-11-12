-- ============================================================================
-- DLang Basketball — Club OS
-- Migration 10 · Parent self-serve training bookings
--
-- The parent portal otherwise needs NO schema changes — existing RLS already
-- enforces own-family isolation, guardian medical writes (audited), self
-- profile/family updates, and own-only notifications. The one gap: a parent
-- cannot flip coach_availability.is_booked (coach/admin only), so booking a
-- slot must go through a SECURITY DEFINER RPC that also enforces the org's
-- "bookings enabled" toggle and the guardian check.
-- ============================================================================

-- Org toggle: is parent self-serve booking enabled?
update public.app_settings
   set settings = settings || jsonb_build_object('bookings_enabled', true)
 where org_id = '00000000-0000-0000-0000-000000000001'
   and not (settings ? 'bookings_enabled');

-- Book a free availability slot (guardian / finance only; respects the toggle)
create or replace function public.book_training_slot(p_athlete uuid, p_service uuid, p_slot uuid)
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
  v_booking uuid;
begin
  select org_id into v_org from public.athletes where id = p_athlete;
  if v_org is null then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
  if not (public.is_guardian_of_athlete(p_athlete) or public.is_finance()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select coalesce((settings->>'bookings_enabled')::boolean, false) into v_enabled
    from public.app_settings where org_id = v_org;
  if not coalesce(v_enabled, false) then raise exception 'BOOKINGS_DISABLED' using errcode = 'P0001'; end if;

  select * into v_slot from public.coach_availability where id = p_slot for update;
  if not found then raise exception 'SLOT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_slot.is_booked then raise exception 'SLOT_TAKEN' using errcode = 'P0001'; end if;

  select * into v_svc from public.training_services where id = p_service;
  if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002'; end if;

  insert into public.training_bookings (org_id, athlete_id, service_id, coach_id, slot_start, slot_end, status, price_chf, created_by)
  values (v_org, p_athlete, p_service, v_slot.coach_id, v_slot.starts_at, v_slot.ends_at, 'booked', v_svc.price_chf, auth.uid())
  returning id into v_booking;

  update public.coach_availability set is_booked = true where id = p_slot;
  return jsonb_build_object('booking_id', v_booking, 'price_chf', v_svc.price_chf, 'starts_at', v_slot.starts_at);
end;
$$;

-- Cancel a booking (guardian / finance), freeing the slot
create or replace function public.cancel_training_booking(p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_b public.training_bookings%rowtype;
begin
  select * into v_b from public.training_bookings where id = p_booking;
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002'; end if;
  if not (public.is_guardian_of_athlete(v_b.athlete_id) or public.is_finance()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  update public.training_bookings set status = 'cancelled', updated_at = now() where id = p_booking;
  update public.coach_availability set is_booked = false
   where coach_id = v_b.coach_id and starts_at = v_b.slot_start;
  return jsonb_build_object('booking_id', p_booking, 'status', 'cancelled');
end;
$$;

grant execute on function public.book_training_slot(uuid, uuid, uuid)  to authenticated, service_role;
grant execute on function public.cancel_training_booking(uuid)         to authenticated, service_role;

-- Demo availability: a few upcoming 1-on-1 slots for Derrick Lang
insert into public.coach_availability (org_id, coach_id, starts_at, ends_at)
select '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011',
       d, d + interval '1 hour'
from (values
  ((now() + interval '2 days')::date + time '17:00'),
  ((now() + interval '3 days')::date + time '17:00'),
  ((now() + interval '4 days')::date + time '18:00')
) as t(d)
where not exists (
  select 1 from public.coach_availability
  where coach_id = '00000000-0000-0000-0000-000000000011'
)
-- Founding-club demo data: skipped on an empty database.
and exists (select 1 from public.coaches where id = '00000000-0000-0000-0000-000000000011');
