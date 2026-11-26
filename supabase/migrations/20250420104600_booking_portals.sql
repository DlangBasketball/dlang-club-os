-- ============================================================================
-- Booking portals: coach / parent / player views of booked training sessions
--
-- 1. Closes the coach read path on training_bookings. Until now the booking's
--    coach could select (and update) the row directly, including price_chf,
--    list_price, payer_id, invoice_id and purchase_id. Coaches now read:
--      - coach_booking_agenda()          sessions + roster names (RPC)
--      - public.coach_training_bookings  column-restricted view of their own
--                                        bookings (no money, payer, invoice,
--                                        package or staff notes)
--    The table policies keep finance / admin and the athlete's guardians.
--    Coach writes go through the existing security definer RPCs
--    (mark_training_booking, attendance sheet RPCs); no coach UI updates the
--    table directly.
-- 2. bk_portal_rows (guardian / player overview) also returns the cancel
--    reason and the previous time of a change, the session event of an
--    upcoming booking, and the coach of a finalized session, so the portals
--    can show "moved / cancelled (reason)" and link the attendance record.
--
-- Additive and idempotent. Contract: docs/booking-workflow.md §7, §11.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. training_bookings: no direct coach access
-- ---------------------------------------------------------------------------
drop policy if exists bookings_select on public.training_bookings;
create policy bookings_select on public.training_bookings for select
  using (org_id = public.current_org_id()
         and (public.is_finance() or public.is_guardian_of_athlete(athlete_id)));

drop policy if exists bookings_write on public.training_bookings;
create policy bookings_write on public.training_bookings for update
  using (org_id = public.current_org_id()
         and (public.is_finance() or public.is_guardian_of_athlete(athlete_id)))
  with check (org_id = public.current_org_id()
              and (public.is_finance() or public.is_guardian_of_athlete(athlete_id)));

-- Coach read path: own bookings, operational columns only. The view runs with
-- the owner's rights (it bypasses the table RLS) and filters on the caller
-- itself: tenant from the session, coach from the signed-in profile.
create or replace view public.coach_training_bookings
with (security_barrier = true)
as
  select b.id, b.org_id, b.athlete_id, b.service_id, b.coach_id, b.session_id,
         b.slot_start, b.slot_end, b.status, b.venue_id, b.location_text,
         b.group_confirmed_at, b.cancelled_at, b.rescheduled_at, b.created_at
    from public.training_bookings b
   where b.org_id = public.current_org_id()
     and public.current_coach_id() is not null
     and b.coach_id = public.current_coach_id();

comment on view public.coach_training_bookings is
  'Coach read path of training_bookings: own bookings only, no price, payer, invoice, package or notes columns.';

revoke all on public.coach_training_bookings from public, anon;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on public.coach_training_bookings to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on public.coach_training_bookings to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Portal rows: reasons, previous time, session event, coach
-- ---------------------------------------------------------------------------
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
               'event_id', s.event_id,
               'rescheduled_from', s.rescheduled_from, 'rescheduled_at', b.rescheduled_at,
               'location', coalesce((select v.name from public.venues v where v.id = b.venue_id), b.location_text))
             order by b.slot_start)
        from public.training_bookings b
        join public.training_services ts on ts.id = b.service_id
        left join public.coaches c on c.id = b.coach_id
        left join public.training_sessions s on s.id = b.session_id
       where b.athlete_id = p_athlete and b.status = 'booked' and coalesce(b.slot_end, b.slot_start) >= now()), '[]'::jsonb),
    'changes', coalesce((
      select jsonb_agg(jsonb_build_object('booking_id', b.id, 'service_name', ts.name, 'coach_name', c.display_name,
                                          'starts_at', b.slot_start, 'ends_at', b.slot_end,
                                          'change', case when b.status = 'cancelled' then 'cancelled' else 'rescheduled' end,
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
                                          'starts_at', e.starts_at, 'status', m.finalized_status) order by e.starts_at desc)
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

-- Internal helper: callers are guardian_booking_overview / player_booking_overview.
revoke all on function public.bk_portal_rows(uuid, boolean) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.bk_portal_rows(uuid, boolean) to service_role;
  end if;
end $$;
