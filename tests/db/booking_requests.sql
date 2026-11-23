-- ============================================================================
-- Booking requests suite (migration 20250420104700_booking_requests.sql)
--
--   A. Declared mode: COACH_UNAVAILABLE outside availability, VENUE_CLOSED
--      outside the venue opening hours (distinct code), admin override.
--   B. Open mode (open_confirm): a slot outside availability is `requested`
--      (held place: coach busy), inside availability is confirmed; never
--      invoiced, not in To Invoice; coach scope (own requests only), confirm
--      by the session coach (idempotent), notifications.
--   C. Decline: reason required, capacity released, package restored, no
--      invoice; group capacity held by requests and released on decline.
--   D. Mode switch back to declared.
--   E. Family requests: own child only, payer forced, non-bookable service
--      refused, auto coach, idempotent, withdraw (own family only), direct
--      table writes refused, portal flags, cross-tenant denials.
--   F. Promo codes: live quote, discount recorded, carried into the invoice,
--      usage limit, family code.
--   G. Absence reports on booked-session events (guardian, cross-family,
--      requested booking refused), shown on the coach sheet and record page.
--   H. Booking status from attendance (finalize + correction), billing
--      unaffected, correction request on a session event (session coach only).
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach …f3 =
-- coach …011, guardian …f4 of family …061 / athlete …071; family …062 =
-- athletes …072, …073). SYNTHETIC DATA ONLY. Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema br;
grant usage on schema br to authenticated, anon, service_role;
create table br.ctx (k text primary key, v text);
grant all on br.ctx to authenticated, anon, service_role;

create function br.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;
create function br.put(p_k text, p_v text) returns void language sql as $$
  insert into br.ctx (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v;
$$;
create function br.get(p_k text) returns text language sql stable as $$ select v from br.ctx where k = p_k $$;
create function br.uid(p_k text) returns uuid language sql stable as $$ select v::uuid from br.ctx where k = p_k $$;
create function br.run_as(p uuid, p_sql text) returns text language plpgsql as $$
declare v_msg text; v_res text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
    if p is null then execute 'set local role anon'; else execute 'set local role authenticated'; end if;
    execute p_sql into v_res;
    execute 'reset role';
    perform set_config('request.jwt.claim.sub', '', true);
    return 'OK:' || coalesce(v_res, '<null>');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    execute 'reset role';
    perform set_config('request.jwt.claim.sub', '', true);
    return 'ERR:' || coalesce(v_msg, 'error');
  end;
end $$;
create function br.j(p uuid, p_sql text) returns jsonb language plpgsql as $$
declare r text := br.run_as(p, p_sql);
begin
  if left(r, 3) = 'OK:' then
    if substr(r, 4) = '<null>' then return 'null'::jsonb; end if;
    return substr(r, 4)::jsonb;
  end if;
  return jsonb_build_object('err', substr(r, 5));
end $$;
create function br.err(p jsonb) returns text language sql immutable as $$ select split_part(p->>'err', ':', 1) $$;
-- booking_confirm / quote payload helper
create function br.p(p_athlete text, p_service text, p_coach text, p_start text, p_extra jsonb default '{}'::jsonb)
returns jsonb language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object('athlete_id', br.get(p_athlete), 'service_id', br.get(p_service),
                                              'coach_id', br.get(p_coach), 'starts_at', p_start)) || p_extra
$$;
create function br.confirm(p_user text, p_payload jsonb, p_req uuid default gen_random_uuid()) returns jsonb language sql as $$
  select br.j(br.uid(p_user), format('select public.booking_confirm(%L, %L)::text', p_payload, p_req))
$$;
create function br.quote(p_user text, p_payload jsonb) returns jsonb language sql as $$
  select br.j(br.uid(p_user), format('select public.booking_quote(%L)::text', p_payload))
$$;
grant execute on all functions in schema br to authenticated, anon, service_role;

select br.put('org', '00000000-0000-0000-0000-000000000001'),
       br.put('orgB', '10000000-0000-0000-0000-000000000002'),
       br.put('admin', '00000000-0000-0000-0000-0000000000f1'),
       br.put('finance', '00000000-0000-0000-0000-0000000000f2'),
       br.put('coach', '00000000-0000-0000-0000-0000000000f3'),
       br.put('guardian', '00000000-0000-0000-0000-0000000000f4'),
       br.put('coach2', '00000000-0000-0000-0000-0000000007b1'),
       br.put('guardian2', '00000000-0000-0000-0000-0000000007b2'),
       br.put('adminB', 'b0000000-0000-0000-0000-0000000007b5'),
       br.put('coachRow', '00000000-0000-0000-0000-000000000011'),
       br.put('coach2Row', '00000000-0000-0000-0000-000000000012'),
       br.put('a71', '00000000-0000-0000-0000-000000000071'),
       br.put('a72', '00000000-0000-0000-0000-000000000072'),
       br.put('a73', '00000000-0000-0000-0000-000000000073'),
       br.put('venue', '00000000-0000-0000-0000-0000000007a1'),
       br.put('svcPt', '00000000-0000-0000-0000-0000000007c1'),
       br.put('svcGrp', '00000000-0000-0000-0000-0000000007c2'),
       br.put('svcPkg', '00000000-0000-0000-0000-0000000007c4'),
       br.put('svcHidden', '00000000-0000-0000-0000-0000000007c5'),
       br.put('svcGrpPast', '00000000-0000-0000-0000-0000000007c6'),
       br.put('purchase', '00000000-0000-0000-0000-0000000007d1'),
       br.put('sponsor', '00000000-0000-0000-0000-0000000007e1');

-- Days (UTC midnight). The venue is open 07:00-21:00 in the club time zone
-- (Europe/Zurich, UTC+1 / +2): 09:00-16:00 UTC is open, 22:00 UTC is closed.
select br.put('d1', ((current_date + 10)::timestamp at time zone 'UTC')::text),
       br.put('d2', ((current_date + 11)::timestamp at time zone 'UTC')::text),
       br.put('d3', ((current_date + 12)::timestamp at time zone 'UTC')::text),
       br.put('d4', ((current_date + 13)::timestamp at time zone 'UTC')::text),
       br.put('dp', ((current_date - 3)::timestamp at time zone 'UTC')::text);
create function br.at(p_day text, p_hours numeric) returns text language sql stable as $$
  select (br.get(p_day)::timestamptz + make_interval(mins => (p_hours * 60)::int))::text
$$;
grant execute on function br.at(text, numeric) to authenticated, anon, service_role;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000007b1', 'br-coach2@example.test'),
  ('00000000-0000-0000-0000-0000000007b2', 'br-guardian2@example.test'),
  ('b0000000-0000-0000-0000-0000000007b5', 'br-admin-b@example.test');
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic ' || left(id::text, 4)
 where id in ('00000000-0000-0000-0000-0000000007b1', '00000000-0000-0000-0000-0000000007b2');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-0000000007b5';
insert into public.staff_roles (org_id, profile_id, role) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007b1', 'coach'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007b2', 'parent'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000007b5', 'admin');
update public.coaches set profile_id = '00000000-0000-0000-0000-0000000007b1' where id = '00000000-0000-0000-0000-000000000012';
insert into public.family_members (family_id, profile_id, relation) values
  ('00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-0000000007b2', 'guardian');
update public.organizations set timezone = 'Europe/Zurich' where id = '00000000-0000-0000-0000-000000000001';
insert into public.app_settings (org_id) values ('00000000-0000-0000-0000-000000000001') on conflict (org_id) do nothing;
update public.app_settings set settings = coalesce(settings, '{}'::jsonb) || '{"bookings_enabled": true}'::jsonb
 where org_id = '00000000-0000-0000-0000-000000000001';

insert into public.venues (id, org_id, name, opening_hours) values
  ('00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-000000000001', 'BR Hall',
   jsonb_build_object('1', '[["07:00","21:00"]]'::jsonb, '2', '[["07:00","21:00"]]'::jsonb, '3', '[["07:00","21:00"]]'::jsonb,
                      '4', '[["07:00","21:00"]]'::jsonb, '5', '[["07:00","21:00"]]'::jsonb, '6', '[["07:00","21:00"]]'::jsonb,
                      '7', '[["07:00","21:00"]]'::jsonb));
insert into public.training_services (id, org_id, slug, name, duration_min, price_chf, kind, session_type, max_participants, currency, venue_id, bookable_by_families) values
  ('00000000-0000-0000-0000-0000000007c1', '00000000-0000-0000-0000-000000000001', 'br-pt', 'BR Private', 60, 80, 'private', 'individual', 1, 'CHF', '00000000-0000-0000-0000-0000000007a1', true),
  ('00000000-0000-0000-0000-0000000007c2', '00000000-0000-0000-0000-000000000001', 'br-grp', 'BR Group', 60, 30, 'group', 'group', 2, 'CHF', '00000000-0000-0000-0000-0000000007a1', true),
  ('00000000-0000-0000-0000-0000000007c4', '00000000-0000-0000-0000-000000000001', 'br-pkg', 'BR Package', 60, 70, 'package', 'individual', 1, 'CHF', '00000000-0000-0000-0000-0000000007a1', false),
  ('00000000-0000-0000-0000-0000000007c5', '00000000-0000-0000-0000-000000000001', 'br-hidden', 'BR Staff only', 60, 90, 'private', 'individual', 1, 'CHF', '00000000-0000-0000-0000-0000000007a1', false),
  ('00000000-0000-0000-0000-0000000007c6', '00000000-0000-0000-0000-000000000001', 'br-grp-past', 'BR Group past', 60, 30, 'group', 'group', 3, 'CHF', '00000000-0000-0000-0000-0000000007a1', true);
insert into public.training_service_coaches (org_id, service_id, coach_id) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007c1', '00000000-0000-0000-0000-000000000011'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007c2', '00000000-0000-0000-0000-000000000012'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007c4', '00000000-0000-0000-0000-000000000011'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007c5', '00000000-0000-0000-0000-000000000011'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007c6', '00000000-0000-0000-0000-000000000012');
-- Coach …011: availability on d1 08:00-11:00 UTC only. Coach …012: only the past day.
insert into public.coach_availability (org_id, coach_id, starts_at, ends_at, capacity) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', br.at('d1', 8)::timestamptz, br.at('d1', 11)::timestamptz, 5),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000012', br.get('dp')::timestamptz, br.get('dp')::timestamptz + interval '1 day', 5);
insert into public.training_package_purchases (id, org_id, athlete_id, family_id, service_id, sessions, list_price, amount, currency,
                                               payment_mode, status, granted_at)
values ('00000000-0000-0000-0000-0000000007d1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000071',
        '00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-0000000007c4', 2, 140, 140, 'CHF', 'comp', 'active', now());
insert into public.billing_payers (id, org_id, kind, name, email) values
  ('00000000-0000-0000-0000-0000000007e1', '00000000-0000-0000-0000-000000000001', 'sponsor', 'Synthetic Sponsor', 'sponsor@example.test');
insert into public.discounts (org_id, name, kind, value, scope, rule, code, max_redemptions, is_active) values
  ('00000000-0000-0000-0000-000000000001', 'BR ten', 'percent', 10, 'training', 'promo_code', 'BR10', 1, true),
  ('00000000-0000-0000-0000-000000000001', 'BR family', 'fixed_amount', 5, 'training', 'promo_code', 'BRFAM', null, true);
update public.discounts set currency = 'CHF' where code = 'BRFAM';

-- ===========================================================================
-- A. Declared mode (default)
-- ===========================================================================
do $$
declare q jsonb; r jsonb;
begin
  perform br.ok((public.bk_settings(br.uid('org'))->>'availability_mode') = 'declared', 'default availability mode is declared');
  q := br.quote('admin', br.p('a71', 'svcPt', 'coachRow', br.at('d1', 13)));
  perform br.ok(q->'errors' ? 'COACH_UNAVAILABLE' and q->>'creates' = 'booked',
                'declared: outside the coach availability (venue open) -> COACH_UNAVAILABLE');
  q := br.quote('admin', br.p('a71', 'svcPt', 'coachRow', br.at('d1', 22)));
  perform br.ok(q->'errors' ? 'VENUE_CLOSED' and not (q->'errors' ? 'COACH_UNAVAILABLE'),
                'declared: outside the venue opening hours -> VENUE_CLOSED (not COACH_UNAVAILABLE)');
  r := br.confirm('admin', br.p('a71', 'svcPt', 'coachRow', br.at('d1', 22)));
  perform br.ok(br.err(r) = 'VENUE_CLOSED', 'declared: confirm refuses a closed venue with VENUE_CLOSED');
  q := br.quote('admin', br.p('a71', 'svcPt', 'coachRow', br.at('d1', 22),
                               '{"override_availability": true, "override_reason": "Synthetic late slot"}'::jsonb));
  perform br.ok((q->>'ok')::boolean and exists (select 1 from jsonb_array_elements(q->'warnings') w where w->>'code' = 'VENUE_CLOSED_OVERRIDDEN'),
                'declared: an admin override lifts VENUE_CLOSED (warning recorded)');
  q := br.quote('admin', br.p('a71', 'svcPt', 'coachRow', br.at('d1', 9)));
  perform br.ok((q->>'ok')::boolean and (q->'slot'->>'within_availability')::boolean, 'declared: inside availability is bookable');
end $$;

-- ===========================================================================
-- B. Open mode: requests
-- ===========================================================================
update public.app_settings
   set settings = jsonb_set(settings, '{booking}', coalesce(settings->'booking', '{}'::jsonb) || '{"availability_mode": "open_confirm"}'::jsonb)
 where org_id = '00000000-0000-0000-0000-000000000001';

do $$
declare q jsonb; r jsonb; r2 jsonb; v_req uuid := gen_random_uuid(); v_bid uuid; v_ev uuid; l jsonb;
begin
  q := br.quote('admin', br.p('a71', 'svcPt', 'coachRow', br.at('d1', 13)));
  perform br.ok((q->>'ok')::boolean and q->>'creates' = 'requested'
                and exists (select 1 from jsonb_array_elements(q->'warnings') w where w->>'code' = 'NEEDS_COACH_CONFIRMATION'),
                'open: outside availability within venue hours quotes as a request');
  q := br.quote('admin', br.p('a71', 'svcPt', 'coachRow', br.at('d1', 22)));
  perform br.ok(q->'errors' ? 'VENUE_CLOSED', 'open: the venue hours still apply (VENUE_CLOSED)');

  r := br.confirm('finance', br.p('a71', 'svcPt', 'coachRow', br.at('d1', 13)), v_req);
  v_bid := (r->>'booking_id')::uuid; v_ev := (r->>'event_id')::uuid;
  perform br.put('bReq', v_bid::text); perform br.put('evReq', v_ev::text);
  perform br.ok(r->>'status' = 'requested' and (r->>'requested')::boolean and r->>'billing_status' = 'awaiting_confirmation',
                'open: staff booking outside availability is created as requested (awaiting confirmation)');
  perform br.ok((select status::text = 'requested' and request_source = 'staff' and requested_at is not null
                   from public.training_bookings where id = v_bid)
                and exists (select 1 from public.training_sessions s join public.events e on e.id = s.event_id
                             where s.id = (r->>'session_id')::uuid and s.status = 'scheduled'),
                'open: the request holds a scheduled session with its calendar event');
  r2 := br.confirm('admin', br.p('a72', 'svcPt', 'coachRow', br.at('d1', 13.5)));
  perform br.ok(br.err(r2) = 'COACH_BUSY', 'open: the held place blocks an overlapping booking (COACH_BUSY)');
  r2 := br.confirm('admin', br.p('a72', 'svcPt', 'coachRow', br.at('d1', 9)));
  perform br.put('bDirect', r2->>'booking_id');
  perform br.ok(r2->>'status' = 'booked', 'open: inside the declared availability the booking is confirmed at once');

  -- never invoiced while it waits
  perform br.ok(not exists (select 1 from jsonb_array_elements(br.j(br.uid('finance'), 'select public.bookings_to_invoice()::text')) x
                             where x->>'booking_id' = v_bid::text),
                'open: a request is not in To Invoice');
  perform br.ok(br.err(br.j(br.uid('finance'), format('select public.booking_create_invoice(%L, %L)::text', v_bid, gen_random_uuid()))) = 'REQUEST_PENDING',
                'open: invoicing a request is refused (REQUEST_PENDING)');
  perform br.ok((br.j(br.uid('admin'), 'select public.booking_dashboard_counts()::text')->>'awaiting_confirmation')::int >= 1,
                'dashboard: awaiting confirmation counted');
  l := br.j(br.uid('admin'), format('select public.booking_list(%L)::text', '{"status": "requested"}'));
  perform br.ok(exists (select 1 from jsonb_array_elements(l->'rows') x where x->>'booking_id' = v_bid::text and x->>'state' = 'requested'),
                'bookings list: filter by requested');

  -- notifications: coach told about the request, family not yet
  perform br.ok(exists (select 1 from public.booking_notifications where booking_id = v_bid and kind = 'requested' and recipient_kind = 'coach')
                and not exists (select 1 from public.booking_notifications where booking_id = v_bid and recipient_kind in ('guardian', 'family')),
                'notifications: the coach is notified of the request (family on the decision)');

  -- coach scope
  perform br.ok(exists (select 1 from jsonb_array_elements(br.j(br.uid('coach'), 'select public.coach_booking_requests()::text')) x
                         where x->>'booking_id' = v_bid::text and x->>'athlete_first_name' is not null and not (x ? 'price')),
                'coach: own requests listed (names, no price)');
  perform br.ok(not exists (select 1 from jsonb_array_elements(br.j(br.uid('coach2'), 'select public.coach_booking_requests()::text')) x
                             where x->>'booking_id' = v_bid::text),
                'coach scope: another coach does not see the request');
  perform br.ok(br.err(br.j(br.uid('coach2'), format('select public.booking_request_confirm(%L, %L)::text', v_bid, gen_random_uuid()))) = 'BOOKING_NOT_FOUND',
                'coach scope: another coach cannot confirm it');
  perform br.ok(br.err(br.j(br.uid('finance'), format('select public.booking_request_confirm(%L, %L)::text', v_bid, gen_random_uuid()))) = 'NOT_AUTHORIZED',
                'finance cannot decide a request (coach / admin only)');
  perform br.ok(br.err(br.j(br.uid('guardian'), format('select public.booking_request_confirm(%L, %L)::text', v_bid, gen_random_uuid()))) = 'NOT_AUTHORIZED',
                'a guardian cannot confirm a request');
  perform br.ok(br.err(br.j(br.uid('adminB'), format('select public.booking_request_confirm(%L, %L)::text', v_bid, gen_random_uuid()))) = 'BOOKING_NOT_FOUND',
                'cross-tenant: org B admin cannot confirm');
  perform br.ok(br.err(br.j(br.uid('guardian'), format('update public.training_bookings set status = %L where id = %L returning id::text', 'booked', v_bid))) = 'BOOKING_REQUEST_MANAGED',
                'a guardian cannot confirm the request with a direct table write');

  -- the session coach confirms (idempotent)
  v_req := gen_random_uuid();
  r := br.j(br.uid('coach'), format('select public.booking_request_confirm(%L, %L)::text', v_bid, v_req));
  r2 := br.j(br.uid('coach'), format('select public.booking_request_confirm(%L, %L)::text', v_bid, v_req));
  perform br.ok(r->>'status' = 'booked' and not (r->>'replayed')::boolean and (r2->>'replayed')::boolean,
                'confirm: the session coach confirms; a retry replays');
  perform br.ok((select status = 'booked' and request_decision = 'confirmed' and request_decided_by = br.uid('coach')
                   from public.training_bookings where id = v_bid)
                and public.booking_billing_status(v_bid) = 'to_invoice',
                'confirm: booking confirmed, decision recorded, now billable');
  perform br.ok(exists (select 1 from public.booking_notifications where booking_id = v_bid and kind = 'request_confirmed' and recipient_kind = 'guardian')
                and not exists (select 1 from public.booking_notifications where booking_id = v_bid and kind = 'request_confirmed' and recipient_kind = 'coach'),
                'notifications: the family is told; the coach who decided is not');
  perform br.ok(br.err(br.j(br.uid('coach'), format('select public.booking_request_decline(%L, %L, %L)::text', v_bid, 'late', gen_random_uuid()))) = 'NOT_A_REQUEST',
                'a confirmed booking cannot be declined as a request');
end $$;

-- ===========================================================================
-- C. Decline: package restored, capacity released
-- ===========================================================================
do $$
declare r jsonb; r2 jsonb; v_bid uuid; v_req uuid := gen_random_uuid(); s1 jsonb; s2 jsonb; s3 jsonb;
begin
  r := br.confirm('admin', br.p('a71', 'svcPkg', 'coachRow', br.at('d2', 13)));
  v_bid := (r->>'booking_id')::uuid;
  perform br.ok(r->>'status' = 'requested' and r->>'billing_mode' = 'package'
                and (select sessions_used from public.training_package_purchases where id = br.uid('purchase')) = 1,
                'request with package: one entitlement held');
  perform br.ok(br.err(br.j(br.uid('admin'), format('select public.booking_request_decline(%L, %L, %L)::text', v_bid, '  ', gen_random_uuid()))) = 'REASON_REQUIRED',
                'decline: a reason is required');
  r := br.j(br.uid('admin'), format('select public.booking_request_decline(%L, %L, %L)::text', v_bid, 'Synthetic: coach away', v_req));
  r2 := br.j(br.uid('admin'), format('select public.booking_request_decline(%L, %L, %L)::text', v_bid, 'Synthetic: coach away', v_req));
  perform br.ok(r->>'status' = 'cancelled' and (r->>'package_restored')::boolean and r->>'session_status' = 'cancelled' and (r2->>'replayed')::boolean,
                'decline: cancelled, package restored, empty session cancelled; retry replays');
  perform br.ok((select sessions_used from public.training_package_purchases where id = br.uid('purchase')) = 0
                and (select restored_at is not null and restore_reason = 'declined' from public.training_booking_entitlements where booking_id = v_bid),
                'decline: the entitlement is restored exactly once');
  perform br.ok((select cancel_reason = 'Synthetic: coach away' and request_decision = 'declined' and invoice_id is null
                   from public.training_bookings where id = v_bid),
                'decline: reason kept, no invoice');
  perform br.ok(exists (select 1 from public.booking_notifications where booking_id = v_bid and kind = 'request_declined' and recipient_kind = 'guardian')
                and exists (select 1 from public.booking_notifications where booking_id = v_bid and kind = 'request_declined' and recipient_kind = 'coach'),
                'decline: family and coach notified (an admin decided)');

  -- group: requests hold the capacity (coach …012 has no availability ahead)
  s1 := br.confirm('admin', br.p('a72', 'svcGrp', 'coach2Row', br.at('d2', 14)));
  s2 := br.confirm('admin', jsonb_build_object('athlete_id', br.get('a73'), 'service_id', br.get('svcGrp'), 'session_id', s1->>'session_id'));
  s3 := br.confirm('admin', jsonb_build_object('athlete_id', br.get('a71'), 'service_id', br.get('svcGrp'), 'session_id', s1->>'session_id'));
  perform br.ok(s1->>'status' = 'requested' and s2->>'status' = 'requested' and br.err(s3) = 'SESSION_FULL',
                'group: two requests fill a session of two (SESSION_FULL for the third)');
  perform br.ok(public.bk_session_pending((s1->>'session_id')::uuid), 'group: a session with requests only is pending');
  perform br.ok(br.run_as(br.uid('admin'), format('select count(*)::text from public.session_events_pending(array[%L::uuid])', s1->>'event_id')) = 'OK:1'
                and br.run_as(br.uid('adminB'), format('select count(*)::text from public.session_events_pending(array[%L::uuid])', s1->>'event_id')) = 'OK:0',
                'calendar: the pending session event is flagged');
  r := br.j(br.uid('coach2'), format('select public.booking_request_decline(%L, %L, %L)::text', s2->>'booking_id', 'Synthetic: full day', gen_random_uuid()));
  perform br.ok(r->>'status' = 'cancelled' and r->>'session_status' = 'scheduled', 'group: the session coach declines one; the session stays');
  s3 := br.confirm('admin', jsonb_build_object('athlete_id', br.get('a71'), 'service_id', br.get('svcGrp'), 'session_id', s1->>'session_id'));
  perform br.ok(s3->>'status' = 'requested', 'group: the released place can be taken (joins as a request: nobody confirmed yet)');
  perform br.put('grpSession', s1->>'session_id');
end $$;

-- ===========================================================================
-- D. Mode switch back to declared
-- ===========================================================================
update public.app_settings
   set settings = jsonb_set(settings, '{booking}', settings->'booking' || '{"availability_mode": "declared"}'::jsonb)
 where org_id = '00000000-0000-0000-0000-000000000001';
do $$
declare q jsonb;
begin
  q := br.quote('admin', br.p('a71', 'svcPt', 'coachRow', br.at('d3', 13)));
  perform br.ok(q->'errors' ? 'COACH_UNAVAILABLE' and q->>'creates' = 'booked', 'declared again: outside availability is refused');
  perform br.ok(br.err(br.confirm('admin', br.p('a71', 'svcPt', 'coachRow', br.at('d3', 13)))) = 'COACH_UNAVAILABLE',
                'declared again: confirm refused (no request created)');
end $$;

-- ===========================================================================
-- E. Family requests
-- ===========================================================================
do $$
declare c jsonb; q jsonb; r jsonb; r2 jsonb; v_req uuid := gen_random_uuid(); v_bid uuid; o jsonb;
begin
  c := br.j(br.uid('guardian'), format('select public.family_booking_catalog(%L)::text', br.get('a71')));
  perform br.ok(exists (select 1 from jsonb_array_elements(c->'services') s where s->>'id' = br.get('svcPt'))
                and not exists (select 1 from jsonb_array_elements(c->'services') s where s->>'id' = br.get('svcHidden')),
                'family catalogue: bookable services only (staff-only service hidden)');
  perform br.ok(br.err(br.j(br.uid('guardian'), format('select public.family_booking_catalog(%L)::text', br.get('a72')))) = 'ATHLETE_NOT_FOUND',
                'cross-family: catalogue of another family''s child refused');
  perform br.ok(br.err(br.j(br.uid('adminB'), format('select public.family_booking_catalog(%L)::text', br.get('a71')))) = 'ATHLETE_NOT_FOUND',
                'cross-tenant: org B cannot read the catalogue');

  q := br.j(br.uid('guardian'), format('select public.booking_family_quote(%L)::text',
            jsonb_build_object('athlete_id', br.get('a71'), 'service_id', br.get('svcPt'), 'starts_at', br.at('d3', 14))));
  perform br.ok((q->>'ok')::boolean and q->>'creates' = 'requested' and q->'slot'->>'coach_id' = br.get('coachRow')
                and (q->'billing'->>'price')::numeric = 80,
                'family quote: declared mode still allows a request; the eligible coach is picked');
  q := br.j(br.uid('guardian'), format('select public.booking_family_quote(%L)::text',
            jsonb_build_object('athlete_id', br.get('a71'), 'service_id', br.get('svcPt'), 'starts_at', br.at('d3', 22))));
  perform br.ok(q->'errors' ? 'VENUE_CLOSED', 'family quote: outside venue hours -> VENUE_CLOSED');
  perform br.ok(br.err(br.j(br.uid('guardian'), format('select public.booking_family_quote(%L)::text',
            jsonb_build_object('athlete_id', br.get('a71'), 'service_id', br.get('svcPt'), 'starts_at', br.at('dp', 10))))) = 'SLOT_IN_PAST',
                'family quote: a past slot is refused');
  perform br.ok(br.err(br.j(br.uid('guardian'), format('select public.booking_family_request(%L, %L)::text',
            jsonb_build_object('athlete_id', br.get('a71'), 'service_id', br.get('svcHidden'), 'starts_at', br.at('d3', 14)), gen_random_uuid()))) = 'SERVICE_NOT_FOUND',
                'family request: a service not bookable by families is refused');
  perform br.ok(br.err(br.j(br.uid('guardian'), format('select public.booking_family_request(%L, %L)::text',
            jsonb_build_object('athlete_id', br.get('a72'), 'service_id', br.get('svcPt'), 'starts_at', br.at('d3', 14)), gen_random_uuid()))) = 'ATHLETE_NOT_FOUND',
                'cross-family: a guardian cannot request for another family''s child');
  perform br.ok(br.err(br.j(br.uid('coach'), format('select public.booking_family_request(%L, %L)::text',
            jsonb_build_object('athlete_id', br.get('a71'), 'service_id', br.get('svcPt'), 'starts_at', br.at('d3', 14)), gen_random_uuid()))) = 'ATHLETE_NOT_FOUND',
                'coach scope: a coach cannot create a family request');

  r := br.j(br.uid('guardian'), format('select public.booking_family_request(%L, %L)::text',
            jsonb_build_object('athlete_id', br.get('a71'), 'service_id', br.get('svcPt'), 'starts_at', br.at('d3', 14),
                               'payer_id', br.get('sponsor'), 'notes', 'Synthetic note'), v_req));
  r2 := br.j(br.uid('guardian'), format('select public.booking_family_request(%L, %L)::text',
            jsonb_build_object('athlete_id', br.get('a71'), 'service_id', br.get('svcPt'), 'starts_at', br.at('d3', 14)), v_req));
  v_bid := (r->>'booking_id')::uuid;
  perform br.put('bFam', v_bid::text);
  perform br.ok(r->>'status' = 'requested' and (r2->>'replayed')::boolean
                and (select count(*) from public.training_bookings where request_id = v_req) = 1,
                'family request: created as requested; a retry replays (one booking)');
  perform br.ok((select payer_id is null and request_source = 'family' and requested_by = br.uid('guardian') and coach_id = br.uid('coachRow')
                   from public.training_bookings where id = v_bid),
                'family request: payer forced to the family default (sponsor ignored), source family');
  perform br.ok(exists (select 1 from public.booking_notifications where booking_id = v_bid and kind = 'requested' and recipient_kind = 'coach')
                and exists (select 1 from public.booking_notifications where booking_id = v_bid and kind = 'requested' and recipient_kind = 'admin'),
                'family request: coach and admins notified');
  o := br.j(br.uid('guardian'), format('select public.guardian_booking_overview(%L)::text', br.get('a71')));
  perform br.ok(exists (select 1 from jsonb_array_elements(o) k, jsonb_array_elements(k->'upcoming') u
                         where u->>'booking_id' = v_bid::text and (u->>'awaiting_confirmation')::boolean and (u->>'can_withdraw')::boolean),
                'portal: the request shows as awaiting confirmation, withdrawable');
  perform br.ok(br.err(br.j(br.uid('guardian2'), format('select public.booking_request_withdraw(%L, %L)::text', v_bid, gen_random_uuid()))) = 'BOOKING_NOT_FOUND',
                'cross-family: another family cannot withdraw it');
  perform br.ok(br.err(br.j(br.uid('guardian'), format('insert into public.training_bookings (org_id, athlete_id, service_id, coach_id, slot_start, status) values (%L, %L, %L, %L, %L, %L) returning id::text',
                       br.get('org'), br.get('a71'), br.get('svcPt'), br.get('coachRow'), br.at('d4', 9), 'requested'))) = 'BOOKING_REQUEST_MANAGED',
                'a guardian cannot insert a request directly');
  perform br.ok(br.err(br.j(br.uid('adminB'), format('select public.booking_detail(%L)::text', v_bid))) = 'BOOKING_NOT_FOUND',
                'cross-tenant: org B admin cannot read the request');
  perform br.ok(not exists (select 1 from jsonb_array_elements(br.j(br.uid('adminB'), 'select public.coach_booking_requests()::text')) x
                             where x->>'booking_id' = v_bid::text),
                'cross-tenant: org B admin sees no org A requests');
  perform br.ok(exists (select 1 from jsonb_array_elements(br.j(br.uid('admin'), 'select public.coach_booking_requests()::text')) x
                         where x->>'booking_id' = v_bid::text and x->>'source' = 'family'),
                'admin: club-wide requests list includes the family request');

  r := br.j(br.uid('guardian'), format('select public.booking_request_withdraw(%L, %L)::text', v_bid, gen_random_uuid()));
  perform br.ok(r->>'status' = 'cancelled' and (select request_decision = 'withdrawn' from public.training_bookings where id = v_bid)
                and exists (select 1 from public.booking_notifications where booking_id = v_bid and kind = 'request_withdrawn' and recipient_kind = 'coach'),
                'withdraw: the guardian withdraws; the coach is told');
  perform br.ok(br.err(br.j(br.uid('guardian'), format('select public.booking_request_withdraw(%L, %L)::text', br.get('bReq'), gen_random_uuid()))) = 'NOT_A_REQUEST',
                'withdraw: only an open request can be withdrawn');

  -- a family request without a coach in a group: joins with free places only
  c := br.j(br.uid('guardian2'), format('select public.family_booking_catalog(%L)::text', br.get('a73')));
  perform br.ok(exists (select 1 from jsonb_array_elements(c->'services') s, jsonb_array_elements(s->'sessions') x
                         where s->>'id' = br.get('svcGrp') and x->>'session_id' = br.get('grpSession')) = false,
                'family catalogue: a full group session is not offered');
end $$;

-- ===========================================================================
-- F. Promo codes
-- ===========================================================================
do $$
declare q jsonb; r jsonb; v_bid uuid; v_inv uuid; f jsonb;
begin
  perform br.run_as(br.uid('admin'), 'select public.invoice_number_series_set(''training'', ''BR PT'', true)::text');
  q := br.quote('admin', br.p('a71', 'svcPt', 'coachRow', br.at('d1', 10), '{"promo_code": "br10"}'::jsonb));
  perform br.ok((q->>'ok')::boolean and (q->'billing'->>'price')::numeric = 72 and (q->'billing'->>'discount_total')::numeric = 8
                and q->'billing'->>'promo' = 'applied' and (q->'billing'->>'list_price')::numeric = 80,
                'promo: live quote 80 -> 72 with BR10');
  q := br.quote('admin', br.p('a71', 'svcPt', 'coachRow', br.at('d1', 10), '{"promo_code": "NOPE"}'::jsonb));
  perform br.ok(q->'errors' ? 'PROMO_UNKNOWN_CODE', 'promo: unknown code refused in the quote');
  q := br.quote('admin', br.p('a71', 'svcPt', 'coachRow', br.at('d1', 10), '{"promo_code": "BR10", "price": 50, "price_reason": "x"}'::jsonb));
  perform br.ok(q->'errors' ? 'PROMO_WITH_PRICE_OVERRIDE', 'promo: not combined with a price override');

  r := br.confirm('admin', br.p('a71', 'svcPt', 'coachRow', br.at('d1', 10), '{"promo_code": "BR10"}'::jsonb));
  v_bid := (r->>'booking_id')::uuid;
  perform br.ok(r->>'status' = 'booked' and (select price_chf = 72 and list_price = 80 and discount_total = 8 and promo_code = 'BR10'
                                                from public.training_bookings where id = v_bid)
                and exists (select 1 from public.applied_discounts where source = 'booking' and source_id = v_bid and amount = 8 and voided_at is null),
                'promo: discount recorded on the booking');
  r := br.j(br.uid('finance'), format('select public.booking_create_invoice(%L, %L, true)::text', v_bid, gen_random_uuid()));
  v_inv := (r->>'invoice_id')::uuid;
  perform br.ok((select total_chf = 72 from public.invoices where id = v_inv)
                and exists (select 1 from public.invoice_items where invoice_id = v_inv and amount_chf = 80)
                and exists (select 1 from public.invoice_items where invoice_id = v_inv and amount_chf = -8)
                and exists (select 1 from public.applied_discounts where source_id = v_bid and invoice_id = v_inv and invoice_item_id is not null),
                'promo: carried into the invoice as a discount line (80 - 8 = 72)');
  r := br.confirm('admin', br.p('a73', 'svcPt', 'coachRow', br.at('d1', 8), '{"promo_code": "BR10"}'::jsonb));
  perform br.ok(br.err(r) = 'PROMO_LIMIT_REACHED', 'promo: the usage limit is enforced');
  -- family code on a family request
  f := br.j(br.uid('guardian'), format('select public.booking_family_quote(%L)::text',
            jsonb_build_object('athlete_id', br.get('a71'), 'service_id', br.get('svcPt'), 'starts_at', br.at('d4', 14), 'promo_code', 'BRFAM')));
  perform br.ok((f->>'ok')::boolean and (f->'billing'->>'price')::numeric = 75, 'promo: families may use a code (80 - 5)');
  r := br.j(br.uid('guardian'), format('select public.booking_family_request(%L, %L)::text',
            jsonb_build_object('athlete_id', br.get('a71'), 'service_id', br.get('svcPt'), 'starts_at', br.at('d4', 14), 'promo_code', 'BRFAM'), gen_random_uuid()));
  perform br.ok(r->>'status' = 'requested' and exists (select 1 from public.applied_discounts where source_id = (r->>'booking_id')::uuid and voided_at is null),
                'promo: recorded on the family request');
  perform br.run_as(br.uid('admin'), format('select public.booking_request_decline(%L, %L, %L)::text', r->>'booking_id', 'Synthetic', gen_random_uuid()));
  perform br.ok(not exists (select 1 from public.applied_discounts where source_id = (r->>'booking_id')::uuid and voided_at is null),
                'promo: a declined request gives the redemption back');
end $$;

-- ===========================================================================
-- G. Absence reports on booked-session events
-- ===========================================================================
do $$
declare r jsonb; v_ev uuid; s jsonb; g jsonb; v_req_ev uuid;
begin
  v_ev := (select s.event_id from public.training_bookings b join public.training_sessions s on s.id = b.session_id
            where b.id = br.uid('bReq'));
  r := br.j(br.uid('guardian'), format('select public.absence_report(%L, %L, %L, %L)::text', v_ev, br.get('a71'), 'Synthetic cold', 'illness'));
  perform br.ok(r->>'status' = 'reported' and r->>'training_session_id' is not null, 'absence: a guardian reports for a booked session');
  perform br.ok(br.err(br.j(br.uid('guardian2'), format('select public.absence_report(%L, %L, null, %L)::text', v_ev, br.get('a71'), 'other'))) = 'NOT_AUTHORIZED',
                'cross-family: another guardian cannot report for the child');
  v_req_ev := (select s.event_id from public.training_sessions s where s.id = br.uid('grpSession'));
  perform br.ok(br.err(br.j(br.uid('guardian2'), format('select public.absence_report(%L, %L, null, %L)::text', v_req_ev, br.get('a72'), 'other'))) = 'NOT_BOOKED',
                'absence: a request (not confirmed) cannot be reported absent');
  s := br.j(br.uid('coach'), format('select public.attendance_sheet(%L)::text', v_ev));
  perform br.ok(exists (select 1 from jsonb_array_elements(s->'marks') m where m->>'athlete_id' = br.get('a71') and m->'reported_absence'->>'report_id' = r->>'report_id'),
                'absence: shown on the coach sheet (preview before the session)');
  g := br.j(br.uid('guardian'), format('select public.guardian_attendance_record(%L, %L)::text', v_ev, br.get('a71')));
  perform br.ok(g->'report'->>'report_id' = r->>'report_id' and g->'session'->>'service_name' = 'BR Private' and g->'event'->>'team_name' = 'BR Private',
                'record page: works for a session event (report, service name)');
  perform br.ok(br.err(br.j(br.uid('guardian2'), format('select public.guardian_attendance_record(%L, %L)::text', v_ev, br.get('a71')))) = 'NOT_AUTHORIZED',
                'record page: another family is refused');
  perform br.ok(exists (select 1 from jsonb_array_elements(br.j(br.uid('guardian'), format('select public.guardian_booking_overview(%L)::text', br.get('a71')))) k,
                                     jsonb_array_elements(k->'upcoming') u
                         where u->>'booking_id' = br.get('bReq') and u->'absence_report'->>'report_id' = r->>'report_id'),
                'portal: the booking shows the reported absence');
end $$;

-- ===========================================================================
-- H. Booking status from attendance (finalize + correction)
-- ===========================================================================
do $$
declare r1 jsonb; r2 jsonb; r3 jsonb; v_ev uuid; s jsonb; v_ver int; c jsonb; q jsonb;
begin
  r1 := br.confirm('admin', br.p('a71', 'svcGrpPast', 'coach2Row', br.at('dp', 10)));
  r2 := br.confirm('admin', jsonb_build_object('athlete_id', br.get('a72'), 'service_id', br.get('svcGrpPast'), 'session_id', r1->>'session_id'));
  r3 := br.confirm('admin', jsonb_build_object('athlete_id', br.get('a73'), 'service_id', br.get('svcGrpPast'), 'session_id', r1->>'session_id'));
  perform br.ok(r1->>'status' = 'booked' and r3->>'status' = 'booked', 'past group session booked inside availability');
  v_ev := (r1->>'event_id')::uuid;
  s := br.j(br.uid('coach2'), format('select public.attendance_open(%L)::text', v_ev));
  v_ver := (s->'sheet'->>'version')::int;
  s := br.j(br.uid('coach2'), format('select public.attendance_save(%L, %L, %s, %L)::text', v_ev,
             jsonb_build_array(jsonb_build_object('athlete_id', br.get('a71'), 'status', 'present'),
                               jsonb_build_object('athlete_id', br.get('a72'), 'status', 'unexcused'),
                               jsonb_build_object('athlete_id', br.get('a73'), 'status', 'excused')), v_ver, gen_random_uuid()));
  v_ver := (s->>'version')::int;
  perform br.ok((select status = 'booked' from public.training_bookings where id = (r1->>'booking_id')::uuid),
                'status sync: a draft sheet changes nothing');
  s := br.j(br.uid('coach2'), format('select public.attendance_finalize(%L, %L, %s, %L)::text', v_ev, br.get('coach2Row'), v_ver, gen_random_uuid()));
  perform br.ok((s->>'ok')::boolean, 'attendance: finalized (' || coalesce(s->>'err', s->>'code', 'ok') || ')');
  perform br.ok((select status = 'completed' and attendance_status = 'present' from public.training_bookings where id = (r1->>'booking_id')::uuid)
                and (select status = 'no_show' and attendance_status = 'unexcused' from public.training_bookings where id = (r2->>'booking_id')::uuid)
                and (select status = 'booked' and attendance_status = 'excused' from public.training_bookings where id = (r3->>'booking_id')::uuid),
                'status sync: present -> completed, unexcused -> no_show, excused -> booked + excused marker');
  perform br.ok((select invoice_id is null and billing_mode = 'invoice' from public.training_bookings where id = (r2->>'booking_id')::uuid)
                and public.booking_billing_status((r2->>'booking_id')::uuid) = 'to_invoice',
                'status sync: billing unaffected (no-show still to invoice)');
  s := br.j(br.uid('coach2'), format('select public.attendance_correct(%L, %L, %L, %L)::text', v_ev, br.get('a72'), 'late', 'Synthetic: arrived late'));
  perform br.ok((select status = 'completed' and attendance_status = 'late' from public.training_bookings where id = (r2->>'booking_id')::uuid),
                'status sync: a correction updates the booking (no_show -> completed)');
  q := br.j(br.uid('admin'), format('select public.booking_detail(%L)::text', r3->>'booking_id'));
  perform br.ok(q->>'attendance_status' = 'excused' and q->>'state' = 'confirmed', 'detail: excused marker shown');

  -- correction request on a session event: the session coach resolves it
  c := br.j(br.uid('guardian'), format('select public.attendance_correction_request(%L, %L, %L, %L)::text', v_ev, br.get('a71'), 'Synthetic: was late', 'late'));
  perform br.ok(c->>'status' = 'open' and c->>'team_id' is null, 'correction request on a session event (no team)');
  perform br.ok(br.err(br.j(br.uid('coach'), format('select public.attendance_correction_resolve(%L, true)::text', c->>'request_id'))) = 'NOT_AUTHORIZED',
                'coach scope: another coach cannot resolve it');
  perform br.ok(exists (select 1 from jsonb_array_elements(br.j(br.uid('coach2'),
                  'select coalesce(jsonb_agg(x), ''[]'')::text from public.attendance_correction_requests_list(''open'') x')) x
                         where x->>'request_id' = c->>'request_id' and x->>'team_name' = 'BR Group past'),
                'the session coach lists it (team name = service)');
  r1 := br.j(br.uid('coach2'), format('select public.attendance_correction_resolve(%L, true)::text', c->>'request_id'));
  perform br.ok(r1->>'status' = 'accepted'
                and (select status = 'completed' and attendance_status = 'late' from public.training_bookings
                      where session_id = (select training_session_id from public.events where id = v_ev) and athlete_id = br.uid('a71')),
                'the session coach accepts; the booking follows (late)');
end $$;
