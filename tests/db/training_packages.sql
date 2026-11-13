-- ============================================================================
-- Training system suite (migration 20250420100200_training_system.sql)
--
--   A. Admin edits services / packages / templates / blackouts; coach owns
--      their own availability; guardians read only.
--   B. book_training(): real availability (templates, opening hours,
--      blackouts), coach busy, guardian scope, group capacity + minimum.
--   C. Packages: invoice -> pending -> paid activates the lot; credits used
--      and returned on cancellation; comp / paid by admin; cancelling a
--      purchase cancels its unpaid invoice and booking; discount hook.
--   D. Cross-tenant denial for every new table and RPC.
--   E. Athlete training profiles: admin / coach of the athlete edit,
--      guardian reads, finance and other clubs see nothing.
--   F. Group confirm / cancel by admins.
--   G. Public catalogue (anonymous) and guest checkout (service role).
--   H. Demo data script supabase/seeds/training_dlang.sql is idempotent.
--   I. Audit rows.
--
-- Fixtures (seed.sql): org A …0001 (slug dlang; admin …f1, finance …f2,
-- coach Derrick …f3 = coach …011, guardian Carla …f4 of Mateo …071),
-- athletes Lucas …072 and Sophia …073 (other family). Org B …0002 from
-- seed_tenants.sql; its admin is created here. SYNTHETIC DATA ONLY.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema tp;
grant usage on schema tp to authenticated, anon, service_role;

create function tp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

create function tp.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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

-- Monday of next week at hh:mm in org A's time zone.
create function tp.mon(p_h integer, p_m integer default 0) returns timestamptz language sql stable as $$
  select ((date_trunc('week', now() at time zone public.training_org_tz('00000000-0000-0000-0000-000000000001'))
           + interval '7 days' + make_interval(hours => p_h, mins => p_m))
          at time zone public.training_org_tz('00000000-0000-0000-0000-000000000001'));
$$;
grant execute on all functions in schema tp to authenticated, anon, service_role;

-- Org B admin (synthetic).
insert into auth.users (id, email) values ('b0000000-0000-0000-0000-0000000000d1', 'admin-b-training@example.test');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-0000000000d1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000d1', 'admin');
insert into public.coaches (id, org_id, display_name) values
  ('b0000000-0000-0000-0000-0000000000d9', '10000000-0000-0000-0000-000000000002', 'Synthetic B trainer');

-- Org A: online booking on, fixed services for this suite.
update public.app_settings
   set settings = coalesce(settings, '{}'::jsonb) || '{"bookings_enabled": true, "booking": {"cancellation_hours": 24, "refund_credits_on_cancel": true}}'::jsonb
 where org_id = '00000000-0000-0000-0000-000000000001';

-- ===========================================================================
-- A. Admin / coach edits
-- ===========================================================================
do $$
declare v text;
begin
  v := tp.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.training_services (id, org_id, slug, name, duration_min, price_chf, session_type, max_participants, min_participants, color)
          values ('a0000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-000000000001', 'tp-pt', 'Synthetic PT', 60, 95, 'individual', 1, 1, '#DA2627') returning id::text$q$);
  perform tp.ok(v like 'OK:%', 'admin creates an individual service (' || v || ')');
  v := tp.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.training_services (id, org_id, slug, name, duration_min, price_chf, session_type, max_participants, min_participants)
          values ('a0000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-000000000001', 'tp-grp', 'Synthetic group', 60, 40, 'group', 2, 2) returning id::text$q$);
  perform tp.ok(v like 'OK:%', 'admin creates a group service (min 2, max 2)');
  v := tp.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.training_services (org_id, slug, name, session_type, max_participants, min_participants)
          values ('00000000-0000-0000-0000-000000000001', 'tp-bad', 'Bad', 'group', 2, 3) returning id::text$q$);
  perform tp.ok(v like 'ERR:%min_participants%', 'min participants above max is refused (' || v || ')');
  v := tp.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.training_services (org_id, slug, name, session_type, max_participants)
          values ('00000000-0000-0000-0000-000000000001', 'tp-bad2', 'Bad', 'individual', 4) returning id::text$q$);
  perform tp.ok(v like 'ERR:%', 'an individual service cannot take several participants');

  v := tp.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.credit_packages (id, org_id, service_id, name, credit_category, credits, price_chf, validity_days, sort_order)
          values ('a0000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000e001', '5 sessions', 'personal', 5, 450, 30, 1) returning id::text$q$);
  perform tp.ok(v like 'OK:%', 'admin adds a 5-session package to the service');
  v := tp.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with u as (update public.credit_packages set price_chf = 440 where id = 'a0000000-0000-0000-0000-00000000e101' returning 1) select count(*)::text from u$q$);
  perform tp.ok(v = 'OK:1', 'admin edits a package price');
  update public.credit_packages set price_chf = 450 where id = 'a0000000-0000-0000-0000-00000000e101';
  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$with u as (update public.credit_packages set price_chf = 1 where id = 'a0000000-0000-0000-0000-00000000e101' returning 1) select count(*)::text from u$q$);
  perform tp.ok(v = 'OK:0', 'guardian cannot edit a package (' || v || ')');
  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select count(*)::text from public.credit_packages where id = 'a0000000-0000-0000-0000-00000000e101'$q$);
  perform tp.ok(v = 'OK:1', 'guardian reads the package catalogue');

  -- Coaches offering the services.
  update public.coaches set serves = serves || array['tp-pt', 'tp-grp'] where id = '00000000-0000-0000-0000-000000000011';

  v := tp.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.coach_availability_templates (id, org_id, coach_id, weekday, start_time, end_time, capacity)
          values ('a0000000-0000-0000-0000-00000000e201', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', 1, '10:00', '18:00', 6) returning id::text$q$);
  perform tp.ok(v like 'OK:%', 'admin adds a weekly template Mon 10-18 for Derrick');
  v := tp.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$insert into public.coach_availability_templates (org_id, coach_id, weekday, start_time, end_time)
          values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', 2, '10:00', '12:00') returning id::text$q$);
  perform tp.ok(v like 'OK:%', 'a coach adds their own template');
  v := tp.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$insert into public.coach_availability_templates (org_id, coach_id, weekday, start_time, end_time)
          values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000012', 2, '10:00', '12:00') returning id::text$q$);
  perform tp.ok(v like 'ERR:%', 'a coach cannot add a template for another coach');
  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$insert into public.coach_availability_templates (org_id, coach_id, weekday, start_time, end_time)
          values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', 3, '10:00', '12:00') returning id::text$q$);
  perform tp.ok(v like 'ERR:%', 'a guardian cannot add availability');
  v := tp.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.coach_availability_templates (org_id, coach_id, weekday, start_time, end_time)
          values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', 3, '12:00', '10:00') returning id::text$q$);
  perform tp.ok(v like 'ERR:%', 'a template ending before it starts is refused');
  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select count(*)::text from public.coach_availability_templates where coach_id = '00000000-0000-0000-0000-000000000011'$q$);
  perform tp.ok(v = 'OK:2', 'guardian reads the club''s availability (' || v || ')');

  v := tp.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$insert into public.training_blackouts (org_id, coach_id, starts_at, ends_at, reason)
          values ('00000000-0000-0000-0000-000000000001', null, now() + interval '100 days', now() + interval '101 days', 'x') returning id::text$q$);
  perform tp.ok(v like 'ERR:%', 'a coach cannot add a club-wide blackout');
end $$;

-- ===========================================================================
-- B. Booking from real availability
-- ===========================================================================
do $$
declare v text; v_inv uuid;
begin
  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$select public.book_training('00000000-0000-0000-0000-000000000071', 'a0000000-0000-0000-0000-00000000e001',
                 '00000000-0000-0000-0000-000000000011', %L, 'invoice')->>'booking_id'$q$, tp.mon(10)));
  perform tp.ok(v like 'OK:%' and v <> 'OK:<null>', 'guardian books Mon 10:00 single session by invoice (' || v || ')');
  select invoice_id into v_inv from public.training_bookings where id = substr(v, 4)::uuid;
  perform tp.ok((select total_chf = 95 and currency = 'CHF' and status::text = 'sent' and athlete_id = '00000000-0000-0000-0000-000000000071'
                   from public.invoices where id = v_inv), 'single-session invoice: price, club currency, athlete');
  perform tp.ok((select group_confirmed_at is not null and slot_end = tp.mon(11) from public.training_bookings where id = substr(v, 4)::uuid),
                'individual booking is confirmed and lasts the service duration');

  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$select public.book_training('00000000-0000-0000-0000-000000000071', 'a0000000-0000-0000-0000-00000000e001',
                 '00000000-0000-0000-0000-000000000011', %L, 'invoice')::text$q$, tp.mon(20)));
  perform tp.ok(v like 'ERR:%SLOT_NOT_AVAILABLE%', 'outside the weekly availability is refused (' || v || ')');

  v := tp.run_as('00000000-0000-0000-0000-0000000000f1',
       format($q$select public.book_training('00000000-0000-0000-0000-000000000072', 'a0000000-0000-0000-0000-00000000e001',
                 '00000000-0000-0000-0000-000000000011', %L, 'invoice')::text$q$, tp.mon(10, 30)));
  perform tp.ok(v like 'ERR:%COACH_BUSY%', 'overlapping session for the same coach is refused (' || v || ')');

  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$select public.book_training('00000000-0000-0000-0000-000000000072', 'a0000000-0000-0000-0000-00000000e001',
                 '00000000-0000-0000-0000-000000000011', %L, 'invoice')::text$q$, tp.mon(13)));
  perform tp.ok(v like 'ERR:%NOT_AUTHORIZED%', 'a guardian cannot book another family''s child (' || v || ')');

  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$select public.book_training('00000000-0000-0000-0000-000000000071', 'a0000000-0000-0000-0000-00000000e001',
                 '00000000-0000-0000-0000-000000000012', %L, 'invoice')::text$q$, tp.mon(13)));
  perform tp.ok(v like 'ERR:%COACH_NOT_OFFERING%' or v like 'ERR:%SLOT_NOT_AVAILABLE%', 'a coach who does not offer the service is refused (' || v || ')');

  -- Club-wide blackout Mon 14-15.
  insert into public.training_blackouts (org_id, starts_at, ends_at, reason)
  values ('00000000-0000-0000-0000-000000000001', tp.mon(14), tp.mon(15), 'synthetic closure');
  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$select public.book_training('00000000-0000-0000-0000-000000000071', 'a0000000-0000-0000-0000-00000000e001',
                 '00000000-0000-0000-0000-000000000011', %L, 'invoice')::text$q$, tp.mon(14)));
  perform tp.ok(v like 'ERR:%SLOT_NOT_AVAILABLE%', 'a blackout blocks the slot (' || v || ')');

  -- Venue opening hours bound the template (Mon 10-12 only).
  insert into public.venues (id, org_id, name, opening_hours)
  values ('a0000000-0000-0000-0000-00000000e301', '00000000-0000-0000-0000-000000000001', 'Synthetic short-hours gym', '{"1": [["10:00", "12:00"]]}');
  update public.coach_availability_templates set venue_id = 'a0000000-0000-0000-0000-00000000e301' where id = 'a0000000-0000-0000-0000-00000000e201';
  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$select public.book_training('00000000-0000-0000-0000-000000000071', 'a0000000-0000-0000-0000-00000000e001',
                 '00000000-0000-0000-0000-000000000011', %L, 'invoice')::text$q$, tp.mon(15)));
  perform tp.ok(v like 'ERR:%SLOT_NOT_AVAILABLE%', 'venue opening hours bound the template (' || v || ')');
  update public.coach_availability_templates set venue_id = null where id = 'a0000000-0000-0000-0000-00000000e201';

  -- Admin override books outside the published availability.
  v := tp.run_as('00000000-0000-0000-0000-0000000000f1',
       format($q$select public.book_training('00000000-0000-0000-0000-000000000073', 'a0000000-0000-0000-0000-00000000e001',
                 '00000000-0000-0000-0000-000000000011', %L, 'invoice', null, null, 'invoice', true)->>'booking_id'$q$, tp.mon(20)));
  perform tp.ok(v like 'OK:%' and v <> 'OK:<null>', 'admin books on behalf of an athlete with an override (' || v || ')');
  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$select public.book_training('00000000-0000-0000-0000-000000000071', 'a0000000-0000-0000-0000-00000000e001',
                 '00000000-0000-0000-0000-000000000011', %L, 'invoice', null, null, 'invoice', true)::text$q$, tp.mon(21)));
  perform tp.ok(v like 'ERR:%SLOT_NOT_AVAILABLE%', 'a guardian''s override flag is ignored');

  -- Group: min 2, max 2.
  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$select public.book_training('00000000-0000-0000-0000-000000000071', 'a0000000-0000-0000-0000-00000000e002',
                 '00000000-0000-0000-0000-000000000011', %L, 'invoice')->>'booking_id'$q$, tp.mon(12)));
  perform tp.ok(v like 'OK:%' and v <> 'OK:<null>', 'guardian joins a group slot');
  perform tp.ok((select group_confirmed_at is null from public.training_bookings where id = substr(v, 4)::uuid),
                'a group below its minimum waits for more participants');
  v := tp.run_as('00000000-0000-0000-0000-0000000000f1',
       format($q$select public.book_training('00000000-0000-0000-0000-000000000072', 'a0000000-0000-0000-0000-00000000e002',
                 '00000000-0000-0000-0000-000000000011', %L, 'invoice')->>'booking_id'$q$, tp.mon(12)));
  perform tp.ok(v like 'OK:%' and v <> 'OK:<null>', 'a second athlete joins the same group');
  perform tp.ok((select count(*) = 2 and bool_and(group_confirmed_at is not null) from public.training_bookings
                  where service_id = 'a0000000-0000-0000-0000-00000000e002' and slot_start = tp.mon(12) and status = 'booked'),
                'reaching the minimum confirms every booking of the group');
  v := tp.run_as('00000000-0000-0000-0000-0000000000f1',
       format($q$select public.book_training('00000000-0000-0000-0000-000000000073', 'a0000000-0000-0000-0000-00000000e002',
                 '00000000-0000-0000-0000-000000000011', %L, 'invoice')::text$q$, tp.mon(12)));
  perform tp.ok(v like 'ERR:%SLOT_FULL%', 'a full group is refused (' || v || ')');
  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$select count(*)::text from public.training_busy(%L, %L) where slot_start = %L and booked = 2$q$, tp.mon(0), tp.mon(23), tp.mon(12)));
  perform tp.ok(v = 'OK:1', 'guardian sees the group count (no names) through training_busy (' || v || ')');
end $$;

-- ===========================================================================
-- C. Packages and credits
-- ===========================================================================
do $$
declare v text; v_p uuid; v_inv uuid; v_b uuid;
begin
  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select public.purchase_training_package('00000000-0000-0000-0000-000000000071', 'a0000000-0000-0000-0000-00000000e001',
                 'a0000000-0000-0000-0000-00000000e101', 'invoice')->>'purchase_id'$q$);
  perform tp.ok(v like 'OK:%' and v <> 'OK:<null>', 'guardian buys a 5-session package (' || v || ')');
  v_p := substr(v, 4)::uuid;
  select invoice_id into v_inv from public.training_package_purchases where id = v_p;
  perform tp.ok((select status = 'pending' and sessions = 5 and amount = 450 and list_price = 450 and discount_total = 0
                        and discount_ids = '{}' and currency = 'CHF' from public.training_package_purchases where id = v_p),
                'purchase is pending with list price, amount, currency and an empty discount hook');
  perform tp.ok((select total_chf = 450 from public.invoices where id = v_inv), 'package invoice issued for 450');
  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select remaining || '/' || pending from public.training_balances('00000000-0000-0000-0000-000000000071') where service_id = 'a0000000-0000-0000-0000-00000000e001'$q$);
  perform tp.ok(v = 'OK:0/5', 'unpaid package: 0 usable, 5 pending (' || v || ')');

  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select public.purchase_training_package('00000000-0000-0000-0000-000000000071', 'a0000000-0000-0000-0000-00000000e001',
                 'a0000000-0000-0000-0000-00000000e101', 'comp')::text$q$);
  perform tp.ok(v like 'ERR:%NOT_AUTHORIZED%', 'a guardian cannot give themselves a free package');

  v := tp.run_as('00000000-0000-0000-0000-0000000000f2',
       format($q$select public.record_offline_payment(%L, 450, 'bank_transfer')->>'status'$q$, v_inv));
  perform tp.ok(v = 'OK:paid', 'finance records the bank payment (' || v || ')');
  perform tp.ok((select status = 'active' and granted_at is not null and expires_at > now() + interval '29 days'
                        and expires_at < now() + interval '31 days' from public.training_package_purchases where id = v_p),
                'payment activates the lot and starts the 30-day validity');

  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$select public.book_training('00000000-0000-0000-0000-000000000071', 'a0000000-0000-0000-0000-00000000e001',
                 '00000000-0000-0000-0000-000000000011', %L, 'credits')->>'booking_id'$q$, tp.mon(16)));
  perform tp.ok(v like 'OK:%' and v <> 'OK:<null>', 'guardian books with package credits (' || v || ')');
  v_b := substr(v, 4)::uuid;
  perform tp.ok((select purchase_id = v_p and credits_used = 1 and invoice_id is null from public.training_bookings where id = v_b), 'booking consumes one session of the lot');
  perform tp.ok((select sessions_used = 1 from public.training_package_purchases where id = v_p), 'lot shows one session used');

  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$select public.reschedule_training(%L, '00000000-0000-0000-0000-000000000011', %L)->>'slot_start'$q$, v_b, tp.mon(17)));
  perform tp.ok(v like 'OK:%', 'guardian reschedules to another free time (' || v || ')');
  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$select public.reschedule_training(%L, '00000000-0000-0000-0000-000000000011', %L)::text$q$, v_b, tp.mon(12)));
  perform tp.ok(v like 'ERR:%', 'rescheduling into a busy time is refused');

  v := tp.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select public.cancel_training_booking(%L)->>'credits_refunded'$q$, v_b));
  perform tp.ok(v = 'OK:true', 'cancelling outside the window returns the credit (' || v || ')');
  perform tp.ok((select sessions_used = 0 from public.training_package_purchases where id = v_p), 'lot is back to 5 sessions');

  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$select public.book_training('00000000-0000-0000-0000-000000000072', 'a0000000-0000-0000-0000-00000000e001',
                 '00000000-0000-0000-0000-000000000011', %L, 'credits', %L)::text$q$, tp.mon(16), v_p));
  perform tp.ok(v like 'ERR:%', 'another family''s child cannot use the lot');

  -- Admin: comp package, and a package sold as paid together with a booking.
  v := tp.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select public.purchase_training_package('00000000-0000-0000-0000-000000000072', 'a0000000-0000-0000-0000-00000000e001',
                 'a0000000-0000-0000-0000-00000000e101', 'comp', 'synthetic goodwill')->>'status'$q$);
  perform tp.ok(v = 'OK:active', 'admin grants a free package, active immediately (' || v || ')');
  perform tp.ok((select amount = 0 and invoice_id is null and expires_at is not null from public.training_package_purchases
                  where athlete_id = '00000000-0000-0000-0000-000000000072' and payment_mode = 'comp'), 'comp: no invoice, validity set');
  v := tp.run_as('00000000-0000-0000-0000-0000000000f1',
       format($q$select public.book_training('00000000-0000-0000-0000-000000000073', 'a0000000-0000-0000-0000-00000000e001',
                 '00000000-0000-0000-0000-000000000011', %L, 'package', null, 'a0000000-0000-0000-0000-00000000e101', 'paid')->>'purchase_id'$q$, tp.mon(16)));
  perform tp.ok(v like 'OK:%' and v <> 'OK:<null>', 'admin sells a paid package with the first booking (' || v || ')');
  perform tp.ok((select p.status = 'active' and p.sessions_used = 1 and i.status::text = 'paid'
                   from public.training_package_purchases p join public.invoices i on i.id = p.invoice_id where p.id = substr(v, 4)::uuid),
                'paid sale: invoice paid, lot active, first session used');

  -- Guardian buys a package inside the booking flow, then the purchase is cancelled.
  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$select public.book_training('00000000-0000-0000-0000-000000000071', 'a0000000-0000-0000-0000-00000000e001',
                 '00000000-0000-0000-0000-000000000011', %L, 'package', null, 'a0000000-0000-0000-0000-00000000e101')->>'purchase_id'$q$, tp.mon(11)));
  perform tp.ok(v like 'OK:%' and v <> 'OK:<null>', 'guardian books the first session of a new package (' || v || ')');
  v_p := substr(v, 4)::uuid;
  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$select public.book_training('00000000-0000-0000-0000-000000000071', 'a0000000-0000-0000-0000-00000000e001',
                 '00000000-0000-0000-0000-000000000011', %L, 'credits', %L)->>'booking_id'$q$, tp.mon(17), v_p));
  perform tp.ok(v like 'OK:%' and v <> 'OK:<null>', 'the buyer schedules a second session from the unpaid package');
  v := tp.run_as('00000000-0000-0000-0000-0000000000f1',
       format($q$select public.cancel_training_purchase(%L, 'synthetic: not paid')->>'status'$q$, v_p));
  perform tp.ok(v = 'OK:cancelled', 'admin cancels the purchase (' || v || ')');
  perform tp.ok((select i.status::text = 'cancelled' from public.training_package_purchases p join public.invoices i on i.id = p.invoice_id where p.id = v_p),
                'its unpaid invoice is cancelled');
  perform tp.ok(not exists (select 1 from public.training_bookings where purchase_id = v_p and status = 'booked'),
                'its upcoming bookings are cancelled');
end $$;

-- ===========================================================================
-- D. Cross-tenant denial (org B admin vs org A rows)
-- ===========================================================================
do $$
declare v text;
  b uuid := 'b0000000-0000-0000-0000-0000000000d1';
begin
  insert into public.athlete_training_profiles (org_id, athlete_id, goals)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000071', 'Synthetic goal: left-hand finishing');

  foreach v in array array['coach_availability_templates', 'training_blackouts', 'training_package_purchases', 'athlete_training_profiles', 'credit_packages'] loop
    perform tp.ok(tp.run_as(b, format('select count(*)::text from public.%I where org_id = %L', v, '00000000-0000-0000-0000-000000000001')) = 'OK:0',
                  'org B admin reads no org A ' || v);
    perform tp.ok(tp.run_as(b, format('with u as (update public.%I set updated_at = now() where org_id = %L returning 1) select count(*)::text from u', v, '00000000-0000-0000-0000-000000000001')) = 'OK:0',
                  'org B admin updates no org A ' || v);
    perform tp.ok(tp.run_as(b, format('with d as (delete from public.%I where org_id = %L returning 1) select count(*)::text from d', v, '00000000-0000-0000-0000-000000000001')) = 'OK:0',
                  'org B admin deletes no org A ' || v);
  end loop;

  v := tp.run_as(b, $q$insert into public.coach_availability_templates (org_id, coach_id, weekday, start_time, end_time)
                       values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', 4, '10:00', '11:00') returning id::text$q$);
  perform tp.ok(v like 'ERR:%', 'org B admin cannot insert a template into org A');
  v := tp.run_as(b, $q$insert into public.coach_availability_templates (org_id, coach_id, weekday, start_time, end_time)
                       values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000011', 4, '10:00', '11:00') returning id::text$q$);
  perform tp.ok(v like 'ERR:%CROSS_ORG_REFERENCE%', 'org B admin cannot point its template at an org A coach (' || v || ')');
  v := tp.run_as(b, $q$insert into public.training_blackouts (org_id, coach_id, starts_at, ends_at)
                       values ('00000000-0000-0000-0000-000000000001', null, now(), now() + interval '1 hour') returning id::text$q$);
  perform tp.ok(v like 'ERR:%', 'org B admin cannot insert a blackout into org A');
  v := tp.run_as(b, $q$insert into public.training_package_purchases (org_id, athlete_id, service_id, sessions, currency)
                       values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000071', 'a0000000-0000-0000-0000-00000000e001', 5, 'CHF') returning id::text$q$);
  perform tp.ok(v like 'ERR:%', 'org B admin cannot create a purchase for an org A athlete');
  v := tp.run_as(b, $q$insert into public.athlete_training_profiles (org_id, athlete_id, goals)
                       values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000072', 'x') returning id::text$q$);
  perform tp.ok(v like 'ERR:%', 'org B admin cannot create a profile for an org A athlete');
  v := tp.run_as(b, $q$insert into public.credit_packages (org_id, service_id, name, credits, price_chf)
                       values ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000e001', 'x', 1, 1) returning id::text$q$);
  perform tp.ok(v like 'ERR:%CROSS_ORG_REFERENCE%', 'org B admin cannot attach a package to an org A service');

  v := tp.run_as(b, format($q$select public.book_training('00000000-0000-0000-0000-000000000072', 'a0000000-0000-0000-0000-00000000e001',
                 '00000000-0000-0000-0000-000000000011', %L, 'invoice', null, null, 'invoice', true)::text$q$, tp.mon(19)));
  perform tp.ok(v like 'ERR:%ATHLETE_NOT_FOUND%', 'org B admin cannot book an org A athlete (' || v || ')');
  v := tp.run_as(b, $q$select public.purchase_training_package('00000000-0000-0000-0000-000000000072', 'a0000000-0000-0000-0000-00000000e001', null, 'comp')::text$q$);
  perform tp.ok(v like 'ERR:%ATHLETE_NOT_FOUND%', 'org B admin cannot sell to an org A athlete');
  v := tp.run_as(b, $q$select public.cancel_training_purchase(id, 'x')::text from public.training_package_purchases limit 1$q$);
  perform tp.ok(v = 'OK:<null>' or v like 'ERR:%', 'org B admin cannot reach org A purchases to cancel');
  perform tp.ok(tp.run_as(b, format($q$select public.cancel_training_purchase(%L, 'x')::text$q$,
                  (select id from public.training_package_purchases where org_id = '00000000-0000-0000-0000-000000000001' and status = 'active' limit 1))) like 'ERR:%PURCHASE_NOT_FOUND%',
                'org B admin cannot cancel an org A purchase by id');
  v := tp.run_as(b, format($q$select count(*)::text from public.training_busy(%L, %L)$q$, tp.mon(0), tp.mon(23)));
  perform tp.ok(v = 'OK:0', 'org B sees no org A busy times (' || v || ')');
  v := tp.run_as(b, $q$select count(*)::text from public.training_balances('00000000-0000-0000-0000-000000000071')$q$);
  perform tp.ok(v = 'OK:0', 'org B reads no org A balances');
  v := tp.run_as(b, format($q$select public.confirm_training_group('00000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-00000000e002', %L)::text$q$, tp.mon(12)));
  perform tp.ok(v like 'ERR:%NOT_FOUND%', 'org B admin cannot confirm an org A group');
  v := tp.run_as(b, format($q$select public.cancel_training_group('00000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-00000000e002', %L, 'x')::text$q$, tp.mon(12)));
  perform tp.ok(v like 'ERR:%NOT_FOUND%', 'org B admin cannot cancel an org A group');
  v := tp.run_as(b, $q$select public.mark_training_booking(id, 'no_show')::text from public.training_bookings limit 1$q$);
  perform tp.ok(v = 'OK:<null>' or v like 'ERR:%', 'org B admin cannot mark org A bookings');
end $$;

-- ===========================================================================
-- E. Athlete training profile
-- ===========================================================================
do $$
declare v text;
begin
  v := tp.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with u as (update public.athlete_training_profiles set notes = 'Synthetic note' where athlete_id = '00000000-0000-0000-0000-000000000071' returning 1) select count(*)::text from u$q$);
  perform tp.ok(v = 'OK:1', 'admin edits training notes');
  v := tp.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$with u as (update public.athlete_training_profiles set goals = 'Synthetic coach goal' where athlete_id = '00000000-0000-0000-0000-000000000071' returning 1) select count(*)::text from u$q$);
  perform tp.ok(v = 'OK:1', 'the athlete''s coach edits the goals');
  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select goals from public.athlete_training_profiles where athlete_id = '00000000-0000-0000-0000-000000000071'$q$);
  perform tp.ok(v = 'OK:Synthetic coach goal', 'guardian reads their child''s profile');
  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$with u as (update public.athlete_training_profiles set goals = 'parent edit' where athlete_id = '00000000-0000-0000-0000-000000000071' returning 1) select count(*)::text from u$q$);
  perform tp.ok(v = 'OK:0', 'guardian cannot edit the profile');
  v := tp.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$select count(*)::text from public.athlete_training_profiles$q$);
  perform tp.ok(v = 'OK:0', 'finance does not see training notes');
  insert into public.athlete_training_profiles (org_id, athlete_id, goals)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000073', 'Synthetic other');
  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select count(*)::text from public.athlete_training_profiles where athlete_id = '00000000-0000-0000-0000-000000000073'$q$);
  perform tp.ok(v = 'OK:0', 'guardian cannot read another family''s profile');
end $$;

-- ===========================================================================
-- F. Group confirm / cancel (admin)
-- ===========================================================================
do $$
declare v text;
begin
  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$select public.book_training('00000000-0000-0000-0000-000000000071', 'a0000000-0000-0000-0000-00000000e002',
                 '00000000-0000-0000-0000-000000000011', %L, 'invoice')->>'booking_id'$q$, tp.mon(13)));
  perform tp.ok(v like 'OK:%' and v <> 'OK:<null>', 'single participant in a new group slot');
  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$select public.confirm_training_group('00000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-00000000e002', %L)::text$q$, tp.mon(13)));
  perform tp.ok(v like 'ERR:%NOT_AUTHORIZED%', 'a guardian cannot confirm a group');
  v := tp.run_as('00000000-0000-0000-0000-0000000000f1',
       format($q$select public.confirm_training_group('00000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-00000000e002', %L)->>'confirmed'$q$, tp.mon(13)));
  perform tp.ok(v = 'OK:1', 'admin confirms a group below its minimum (' || v || ')');
  v := tp.run_as('00000000-0000-0000-0000-0000000000f1',
       format($q$select public.cancel_training_group('00000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-00000000e002', %L, 'synthetic: weather')->>'cancelled'$q$, tp.mon(13)));
  perform tp.ok(v = 'OK:1', 'admin cancels the whole group slot (' || v || ')');
  perform tp.ok((select status::text = 'cancelled' and cancel_reason = 'synthetic: weather' from public.training_bookings
                  where service_id = 'a0000000-0000-0000-0000-00000000e002' and slot_start = tp.mon(13)), 'group bookings cancelled with the reason');
  perform tp.ok((select i.status::text = 'cancelled' from public.training_bookings b join public.invoices i on i.id = b.invoice_id
                  where b.service_id = 'a0000000-0000-0000-0000-00000000e002' and b.slot_start = tp.mon(13)), 'and their unpaid invoices voided');

  v := tp.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$select public.mark_training_booking(id, 'completed')->>'status' from public.training_bookings
           where athlete_id = '00000000-0000-0000-0000-000000000071' and status = 'booked' and coach_id = '00000000-0000-0000-0000-000000000011' limit 1$q$);
  perform tp.ok(v = 'OK:completed', 'the coach marks a session attended (' || v || ')');
  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select public.mark_training_booking(id, 'no_show')::text from public.training_bookings
           where athlete_id = '00000000-0000-0000-0000-000000000071' and status = 'booked' limit 1$q$);
  perform tp.ok(v like 'ERR:%NOT_AUTHORIZED%' or v = 'OK:<null>', 'a guardian cannot mark attendance');
end $$;

-- ===========================================================================
-- G. Public catalogue + guest checkout
-- ===========================================================================
do $$
declare v text; v_cat jsonb; v_res jsonb; v_bool boolean;
  g uuid := 'c0000000-0000-0000-0000-0000000000a1';
begin
  v := tp.run_as(null, format($q$select public.training_public_catalog('dlang', now(), %L)::text$q$, tp.mon(23)));
  perform tp.ok(v like 'OK:{%', 'anonymous visitor reads the club catalogue');
  v_cat := substr(v, 4)::jsonb;
  perform tp.ok(jsonb_array_length(v_cat->'services') >= 2 and jsonb_array_length(v_cat->'templates') >= 1
                and jsonb_array_length(v_cat->'packages') >= 1, 'catalogue has services, packages and availability');
  perform tp.ok(v not like '%Mateo%' and v not like '%Lopes%' and v not like '%Synthetic note%' and v not like '%synthetic closure%',
                'catalogue carries no athlete data or blackout reasons');
  v := tp.run_as(null, $q$select coalesce(public.training_public_catalog('no-such-club', null, null)::text, 'none')$q$);
  perform tp.ok(v = 'OK:none', 'unknown club: nothing');
  v := tp.run_as(null, $q$select count(*)::text from public.coach_availability_templates$q$);
  perform tp.ok(v = 'OK:0' or v like 'ERR:%', 'anonymous callers cannot read the tables directly');

  insert into auth.users (id, email) values (g, 'guest-parent@example.test');

  v := tp.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$select public.training_guest_checkout('dlang', %L, '{}'::jsonb)::text$q$, g));
  perform tp.ok(v like 'ERR:%permission denied%' or v like 'ERR:%NOT_AUTHORIZED%', 'signed-in users cannot call the guest checkout (' || v || ')');
  v := tp.run_as(null, format($q$select public.training_guest_checkout('dlang', %L, '{}'::jsonb)::text$q$, g));
  perform tp.ok(v like 'ERR:%permission denied%', 'anonymous callers cannot call the guest checkout directly');

  begin
    perform public.training_guest_checkout('dlang', g, jsonb_build_object(
      'parent', jsonb_build_object('email', 'someone-else@example.test', 'name', 'Synthetic Guest'),
      'child', jsonb_build_object('first_name', 'Synthetic', 'last_name', 'Child', 'dob', '2014-05-05'),
      'consents', '[]'::jsonb, 'guardian_confirmed', true));
    perform tp.ok(false, 'email mismatch is refused');
  exception when others then
    perform tp.ok(sqlerrm like '%ACCOUNT_MISMATCH%', 'email mismatch is refused (' || sqlerrm || ')');
  end;
  begin
    perform public.training_guest_checkout('dlang', g, jsonb_build_object(
      'parent', jsonb_build_object('email', 'guest-parent@example.test', 'name', 'Synthetic Guest'),
      'child', jsonb_build_object('first_name', 'Synthetic', 'last_name', 'Child', 'dob', '2014-05-05'),
      'consents', '[]'::jsonb, 'guardian_confirmed', true,
      'service_id', 'a0000000-0000-0000-0000-00000000e001', 'coach_id', '00000000-0000-0000-0000-000000000011',
      'start', tp.mon(15), 'pay_with', 'invoice'));
    perform tp.ok(false, 'missing required consents are refused');
  exception when others then
    perform tp.ok(sqlerrm like '%CONSENT_REQUIRED%', 'missing required consents are refused (' || sqlerrm || ')');
  end;

  v_res := public.training_guest_checkout('dlang', g, jsonb_build_object(
    'parent', jsonb_build_object('email', 'Guest-Parent@example.test', 'name', 'Synthetic Guest', 'phone', '+41 00 000 00 00'),
    'child', jsonb_build_object('first_name', 'Synthetic', 'last_name', 'Child', 'dob', '2014-05-05'),
    'consents', (select jsonb_agg(distinct key) from public.consent_forms where org_id = '00000000-0000-0000-0000-000000000001' and is_active),
    'guardian_confirmed', true,
    'service_id', 'a0000000-0000-0000-0000-00000000e001', 'coach_id', '00000000-0000-0000-0000-000000000011',
    'start', tp.mon(15), 'pay_with', 'package', 'package_id', 'a0000000-0000-0000-0000-00000000e101'));
  perform tp.ok(v_res->>'booking_id' is not null and v_res->>'purchase_id' is not null, 'guest checkout books the first session of a package');
  perform tp.ok((select org_id = '00000000-0000-0000-0000-000000000001' from public.profiles where id = g), 'guest account belongs to the club of the page');
  perform tp.ok(exists (select 1 from public.family_members where profile_id = g and family_id = (v_res->>'family_id')::uuid), 'guest is the guardian of the new family');
  perform tp.ok((select count(*) > 0 from public.consent_acceptances where athlete_id = (v_res->>'athlete_id')::uuid and accepted_by = g), 'consents recorded with who accepted');
  perform tp.ok((select p.status = 'pending' and p.created_by = g and i.status::text = 'sent' from public.training_package_purchases p
                   join public.invoices i on i.id = p.invoice_id where p.id = (v_res->>'purchase_id')::uuid), 'guest package waits for payment of its invoice');
  perform tp.ok(coalesce(current_setting('request.jwt.claim.sub', true), '') = '', 'identity is restored after the guest checkout');
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'families' and column_name = 'membership_status') then
    execute format('select membership_status::text = %L from public.families where id = %L', 'guest', v_res->>'family_id') into v_bool;
    perform tp.ok(v_bool, 'guest family is marked as a non-member');
  end if;
  v := tp.run_as(g, format($q$select count(*)::text from public.training_bookings where athlete_id = %L$q$, v_res->>'athlete_id'));
  perform tp.ok(v = 'OK:1', 'the new parent sees the booking in the parent app (' || v || ')');
  v := tp.run_as(g, $q$select count(*)::text from public.athletes where id = '00000000-0000-0000-0000-000000000071'$q$);
  perform tp.ok(v = 'OK:0', 'the new parent sees no other family''s child');

  -- Another club's account cannot be reused here.
  insert into auth.users (id, email) values ('c0000000-0000-0000-0000-0000000000a2', 'guest-b@example.test');
  update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'c0000000-0000-0000-0000-0000000000a2';
  begin
    perform public.training_guest_checkout('dlang', 'c0000000-0000-0000-0000-0000000000a2', jsonb_build_object(
      'parent', jsonb_build_object('email', 'guest-b@example.test', 'name', 'x'),
      'child', jsonb_build_object('first_name', 'x', 'last_name', 'y', 'dob', '2014-05-05'), 'guardian_confirmed', true));
    perform tp.ok(false, 'an account of another club is refused');
  exception when others then
    perform tp.ok(sqlerrm like '%ACCOUNT_OTHER_CLUB%', 'an account of another club is refused (' || sqlerrm || ')');
  end;
end $$;

-- ===========================================================================
-- H. Demo data script (run twice: idempotent)
-- ===========================================================================
\i supabase/seeds/training_dlang.sql
\i supabase/seeds/training_dlang.sql
do $$
declare v_pt uuid; v_g uuid;
begin
  select id into v_pt from public.training_services where org_id = '00000000-0000-0000-0000-000000000001' and slug = 'personal-training';
  select id into v_g  from public.training_services where org_id = '00000000-0000-0000-0000-000000000001' and slug = 'group-training';
  perform tp.ok((select count(*) = 1 from public.training_services where org_id = '00000000-0000-0000-0000-000000000001' and slug = 'personal-training'),
                'demo: one Personal Training service');
  perform tp.ok((select duration_min = 60 and price_chf = 95 and session_type = 'individual' from public.training_services where id = v_pt), 'demo: 60 min, 95 single');
  perform tp.ok((select string_agg(credits || '/' || price_chf::int, ',' order by credits) = '5/450,10/850,16/1280,20/1500'
                   from public.credit_packages where service_id = v_pt), 'demo: packages 5/450, 10/850, 16/1280, 20/1500 (no duplicates)');
  perform tp.ok((select session_type = 'group' and min_participants = 2 and max_participants = 6 and price_chf = 40
                        and description not ilike '%confirm%' from public.training_services where id = v_g), 'demo: group 2-6 at 40 per person');
  perform tp.ok((select count(*) = 1 and bool_and(address = 'Chemin d''Entre-Bois 21' and postal_code = '1018' and city = 'Lausanne' and opening_hours ? '6')
                   from public.venues where org_id = '00000000-0000-0000-0000-000000000001' and name = 'Dlang Gym'), 'demo: Dlang Gym venue with opening hours');
  perform tp.ok((select venue_id = (select id from public.venues where org_id = '00000000-0000-0000-0000-000000000001' and name = 'Dlang Gym')
                   from public.training_services where id = v_pt), 'demo: default location is the gym');
  perform tp.ok((select count(*) = 5 and count(distinct weekday) = 5 and min(weekday) = 1 and max(weekday) = 5 from public.coach_availability_templates
                  where coach_id = '00000000-0000-0000-0000-000000000011' and start_time = '10:00' and end_time = '18:00' and service_id is null),
                'demo: Derrick Mon-Fri 10-18 (no duplicates; Monday reused from this suite)');
  perform tp.ok((select serves @> array['personal-training', 'group-training'] from public.coaches where id = '00000000-0000-0000-0000-000000000011'),
                'demo: Derrick offers both services');
end $$;

-- ===========================================================================
-- I. Audit trail
-- ===========================================================================
do $$
begin
  perform tp.ok(exists (select 1 from public.audit_logs where target_table = 'coach_availability_templates' and action = 'INSERT'
                          and actor_id = '00000000-0000-0000-0000-0000000000f1'), 'template changes are audited with the actor');
  perform tp.ok(exists (select 1 from public.audit_logs where action = 'TRAINING_PACKAGE_SOLD'), 'package sales are audited');
  perform tp.ok(exists (select 1 from public.audit_logs where action = 'TRAINING_PACKAGE_CANCELLED'), 'purchase cancellations are audited');
  perform tp.ok(exists (select 1 from public.audit_logs where target_table = 'athlete_training_profiles' and action = 'UPDATE'), 'profile edits are audited');
  perform tp.ok(exists (select 1 from public.audit_logs where action = 'TRAINING_GUEST_SIGNUP'), 'guest sign-ups are audited');
  perform tp.ok(exists (select 1 from public.audit_logs where action in ('TRAINING_GROUP_CONFIRMED', 'TRAINING_GROUP_CANCELLED')), 'group decisions are audited');
  perform tp.ok(exists (select 1 from public.audit_logs where target_table = 'credit_packages' and action = 'UPDATE'), 'package edits are audited');
end $$;
