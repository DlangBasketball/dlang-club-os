-- ============================================================================
-- Booking portals suite (migration 20250420104600_booking_portals.sql)
--
--   A. Coach read path: no direct select / update of training_bookings,
--      column-restricted view of own bookings (no price, payer, invoice),
--      agenda with names only, mark_training_booking still works.
--   B. Staff still read the table (finance / admin).
--   C. Guardian: own children only (table + overview), changes carry the
--      cancel reason and the previous time.
--   D. Player: own bookings only, no money, no table access.
--   E. Other club and anon: denied.
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach …f3 =
-- coach …011, guardian …f4 of family …061 / athlete …071; family …062 =
-- athletes …072, …073). SYNTHETIC DATA ONLY. Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema bp;
grant usage on schema bp to authenticated, anon, service_role;
create table bp.ctx (k text primary key, v text);
grant all on bp.ctx to authenticated, anon, service_role;

create function bp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;
create function bp.put(p_k text, p_v text) returns void language sql as $$
  insert into bp.ctx (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v;
$$;
create function bp.get(p_k text) returns text language sql stable as $$ select v from bp.ctx where k = p_k $$;
create function bp.uid(p_k text) returns uuid language sql stable as $$ select v::uuid from bp.ctx where k = p_k $$;
create function bp.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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
create function bp.j(p uuid, p_sql text) returns jsonb language plpgsql as $$
declare r text := bp.run_as(p, p_sql);
begin
  if left(r, 3) = 'OK:' then
    if substr(r, 4) = '<null>' then return 'null'::jsonb; end if;
    return substr(r, 4)::jsonb;
  end if;
  return jsonb_build_object('err', substr(r, 5));
end $$;
grant execute on all functions in schema bp to authenticated, anon, service_role;

select bp.put('org', '00000000-0000-0000-0000-000000000001'),
       bp.put('admin', '00000000-0000-0000-0000-0000000000f1'),
       bp.put('finance', '00000000-0000-0000-0000-0000000000f2'),
       bp.put('coach', '00000000-0000-0000-0000-0000000000f3'),
       bp.put('guardian', '00000000-0000-0000-0000-0000000000f4'),
       bp.put('coach2', '00000000-0000-0000-0000-0000000007b1'),
       bp.put('guardian2', '00000000-0000-0000-0000-0000000007b2'),
       bp.put('player', '00000000-0000-0000-0000-0000000007b3'),
       bp.put('coachB', 'b0000000-0000-0000-0000-0000000007b4'),
       bp.put('adminB', 'b0000000-0000-0000-0000-0000000007b5'),
       bp.put('coachRow', '00000000-0000-0000-0000-000000000011'),
       bp.put('coach2Row', '00000000-0000-0000-0000-000000000012'),
       bp.put('coachBRow', 'b0000000-0000-0000-0000-0000000007c1'),
       bp.put('a71', '00000000-0000-0000-0000-000000000071'),
       bp.put('a72', '00000000-0000-0000-0000-000000000072'),
       bp.put('svc', '00000000-0000-0000-0000-0000000007d1'),
       bp.put('payer', '00000000-0000-0000-0000-0000000007e1'),
       bp.put('b1', '00000000-0000-0000-0000-0000000007f1'),
       bp.put('b2', '00000000-0000-0000-0000-0000000007f2'),
       bp.put('b3', '00000000-0000-0000-0000-0000000007f3');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000007b1', 'bp-coach2@example.test'),
  ('00000000-0000-0000-0000-0000000007b2', 'bp-guardian2@example.test'),
  ('00000000-0000-0000-0000-0000000007b3', 'bp-player@example.test'),
  ('b0000000-0000-0000-0000-0000000007b4', 'bp-coach-b@example.test'),
  ('b0000000-0000-0000-0000-0000000007b5', 'bp-admin-b@example.test');
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic ' || left(id::text, 4)
 where id in ('00000000-0000-0000-0000-0000000007b1', '00000000-0000-0000-0000-0000000007b2', '00000000-0000-0000-0000-0000000007b3');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002'
 where id in ('b0000000-0000-0000-0000-0000000007b4', 'b0000000-0000-0000-0000-0000000007b5');
insert into public.staff_roles (org_id, profile_id, role) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007b1', 'coach'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007b2', 'parent'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000007b4', 'coach'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000007b5', 'admin');
update public.coaches set profile_id = '00000000-0000-0000-0000-0000000007b1' where id = '00000000-0000-0000-0000-000000000012';
insert into public.coaches (id, org_id, display_name, profile_id) values
  ('b0000000-0000-0000-0000-0000000007c1', '10000000-0000-0000-0000-000000000002', 'Synthetic Coach B', 'b0000000-0000-0000-0000-0000000007b4');
insert into public.family_members (family_id, profile_id, relation) values
  ('00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-0000000007b2', 'guardian');
update public.athletes set player_profile_id = '00000000-0000-0000-0000-0000000007b3' where id = '00000000-0000-0000-0000-000000000072';

insert into public.training_services (id, org_id, slug, name, duration_min, price_chf, kind, session_type, max_participants, currency) values
  ('00000000-0000-0000-0000-0000000007d1', '00000000-0000-0000-0000-000000000001', 'bp-pt', 'BP Private', 60, 90, 'private', 'individual', 1, 'CHF');
insert into public.billing_payers (id, org_id, kind, name, email) values
  ('00000000-0000-0000-0000-0000000007e1', '00000000-0000-0000-0000-000000000001', 'sponsor', 'Synthetic Sponsor SA', 'sponsor@example.test');

-- Bookings (legacy insert path: the trigger attaches each to a session + event).
-- b1: athlete …071 with coach …011, priced, sponsor payer.  b2: athlete …072 with coach …012.
-- b3: athlete …071 with coach …011, cancelled below with a reason.
insert into public.training_bookings (id, org_id, athlete_id, service_id, coach_id, slot_start, slot_end, status, price_chf, list_price,
                                      currency, payer_id, notes)
values
  ('00000000-0000-0000-0000-0000000007f1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000071',
   '00000000-0000-0000-0000-0000000007d1', '00000000-0000-0000-0000-000000000011',
   date_trunc('hour', now()) + interval '5 days', date_trunc('hour', now()) + interval '5 days 1 hour', 'booked', 90, 90, 'CHF',
   '00000000-0000-0000-0000-0000000007e1', 'Synthetic staff note'),
  ('00000000-0000-0000-0000-0000000007f2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000072',
   '00000000-0000-0000-0000-0000000007d1', '00000000-0000-0000-0000-000000000012',
   date_trunc('hour', now()) + interval '6 days', date_trunc('hour', now()) + interval '6 days 1 hour', 'booked', 90, 90, 'CHF', null, null),
  ('00000000-0000-0000-0000-0000000007f3', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000071',
   '00000000-0000-0000-0000-0000000007d1', '00000000-0000-0000-0000-000000000011',
   date_trunc('hour', now()) + interval '7 days', date_trunc('hour', now()) + interval '7 days 1 hour', 'booked', 90, 90, 'CHF', null, null);
update public.training_bookings set status = 'cancelled', cancel_reason = 'Synthetic: coach unavailable', cancelled_at = now()
 where id = '00000000-0000-0000-0000-0000000007f3';

-- ===========================================================================
-- A. Coach read path
-- ===========================================================================
do $$
declare r jsonb; s jsonb;
begin
  perform bp.ok((select session_id is not null from public.training_bookings where id = bp.uid('b1')),
                'fixture: the booking is attached to a session');
  perform bp.ok(bp.run_as(bp.uid('coach'), format('select count(*)::text from public.training_bookings where id = %L', bp.get('b1'))) = 'OK:0',
                'coach: the booking row is not readable on the table (no price / payer / invoice)');
  perform bp.ok(bp.run_as(bp.uid('coach'), 'select max(price_chf)::text from public.training_bookings') = 'OK:<null>'
                and bp.run_as(bp.uid('coach'), 'select count(payer_id)::text from public.training_bookings') = 'OK:0',
                'coach: no price or payer value reaches the coach through the table');
  perform bp.ok(bp.run_as(bp.uid('coach'), format('select count(*)::text from public.coach_training_bookings where id = %L', bp.get('b1'))) = 'OK:1',
                'coach view: own booking is listed');
  perform bp.ok(bp.run_as(bp.uid('coach'), format('select count(*)::text from public.coach_training_bookings where id = %L', bp.get('b2'))) = 'OK:0',
                'coach view: another coach''s booking is not listed');
  perform bp.ok(not exists (select 1 from information_schema.columns
                             where table_schema = 'public' and table_name = 'coach_training_bookings'
                               and column_name in ('price_chf', 'list_price', 'currency', 'payer_id', 'invoice_id', 'purchase_id',
                                                   'credits_used', 'paid_with', 'notes', 'price_override_reason', 'billing_mode')),
                'coach view: no money, payer, invoice, package or notes columns');
  perform bp.ok(left(bp.run_as(bp.uid('coach'), 'select max(price_chf)::text from public.coach_training_bookings'), 4) = 'ERR:',
                'coach view: selecting a price column fails');
  perform bp.ok(bp.run_as(bp.uid('coach'), format('update public.training_bookings set price_chf = 0 where id = %L returning id::text', bp.get('b1'))) = 'OK:<null>'
                and (select price_chf = 90 from public.training_bookings where id = bp.uid('b1')),
                'coach: cannot update the booking row directly (price unchanged)');

  r := bp.j(bp.uid('coach'), format('select public.coach_booking_agenda(%L, %L)::text', now(), now() + interval '30 days'));
  select x into s from jsonb_array_elements(r) x
   where x->>'session_id' = (select session_id::text from public.training_bookings where id = bp.uid('b1'));
  perform bp.ok(s is not null and s->'participants'->0->>'athlete_id' = bp.get('a71') and s->>'service_name' = 'BP Private',
                'coach agenda: the booked session with the athlete name');
  perform bp.ok(r::text not like '%price%' and r::text not like '%payer%' and r::text not like '%invoice%' and r::text not like '%Sponsor%',
                'coach agenda: no price, payer or invoice data');
  perform bp.ok(not exists (select 1 from jsonb_array_elements(r) x, jsonb_array_elements(x->'participants') p where p->>'athlete_id' = bp.get('a72')),
                'coach agenda: no athlete of another coach''s session');
  perform bp.ok(bp.j(bp.uid('coach'), format('select public.mark_training_booking(%L, %L)::text', bp.get('b1'), 'booked'))->>'status' = 'booked',
                'coach: mark_training_booking (RPC) still works');
end $$;

-- ===========================================================================
-- B. Staff
-- ===========================================================================
do $$
begin
  perform bp.ok(bp.run_as(bp.uid('finance'), format('select price_chf::int::text from public.training_bookings where id = %L', bp.get('b1'))) = 'OK:90',
                'finance: reads the booking with its price');
  perform bp.ok(bp.run_as(bp.uid('admin'), format('select payer_id::text from public.training_bookings where id = %L', bp.get('b1'))) = 'OK:' || bp.get('payer'),
                'admin: reads the booking payer');
  perform bp.ok(bp.run_as(bp.uid('admin'), 'select count(*)::text from public.coach_training_bookings') = 'OK:0',
                'admin without a coach profile: the coach view is empty');
end $$;

-- ===========================================================================
-- C. Guardian
-- ===========================================================================
do $$
declare r jsonb; c jsonb;
begin
  perform bp.ok(bp.run_as(bp.uid('guardian'), format('select count(*)::text from public.training_bookings where id in (%L, %L)', bp.get('b1'), bp.get('b3'))) = 'OK:2'
                and bp.run_as(bp.uid('guardian'), format('select count(*)::text from public.training_bookings where id = %L', bp.get('b2'))) = 'OK:0',
                'guardian table: own child''s bookings only');
  perform bp.ok(bp.run_as(bp.uid('guardian'), 'select count(*)::text from public.coach_training_bookings') = 'OK:0',
                'guardian: the coach view is empty');
  r := bp.j(bp.uid('guardian'), 'select public.guardian_booking_overview()::text');
  perform bp.ok(jsonb_array_length(r) = 1 and r->0->'athlete'->>'id' = bp.get('a71'), 'guardian overview: own child only');
  perform bp.ok(exists (select 1 from jsonb_array_elements(r->0->'upcoming') u
                         where u->>'booking_id' = bp.get('b1') and u->>'coach_name' is not null and u->>'event_id' is not null),
                'guardian overview: upcoming booking with coach and session event');
  select x into c from jsonb_array_elements(r->0->'changes') x where x->>'booking_id' = bp.get('b3');
  perform bp.ok(c->>'change' = 'cancelled' and c->>'reason' = 'Synthetic: coach unavailable',
                'guardian overview: a cancelled booking carries its reason');
  perform bp.ok(r::text not like '%Synthetic staff note%' and r::text not like '%Sponsor%',
                'guardian overview: no staff notes and no sponsor payer data');
  perform bp.ok(left(bp.run_as(bp.uid('guardian'), format('select public.bk_portal_rows(%L, true)::text', bp.get('a72'))), 4) = 'ERR:',
                'guardian: the internal portal helper cannot be called directly');
  r := bp.j(bp.uid('guardian2'), 'select public.guardian_booking_overview()::text');
  perform bp.ok(not exists (select 1 from jsonb_array_elements(r) x where x->'athlete'->>'id' = bp.get('a71'))
                and exists (select 1 from jsonb_array_elements(r) x, jsonb_array_elements(x->'upcoming') u where u->>'booking_id' = bp.get('b2')),
                'second family: sees its own child''s booking, never the first family''s');
end $$;

-- ===========================================================================
-- D. Player
-- ===========================================================================
do $$
declare r jsonb;
begin
  r := bp.j(bp.uid('player'), 'select public.player_booking_overview()::text');
  perform bp.ok(r->'athlete'->>'id' = bp.get('a72')
                and exists (select 1 from jsonb_array_elements(r->'upcoming') u where u->>'booking_id' = bp.get('b2'))
                and not exists (select 1 from jsonb_array_elements(r->'upcoming') u where u->>'booking_id' = bp.get('b1'))
                and jsonb_array_length(r->'invoices') = 0,
                'player overview: own bookings only, no money');
  perform bp.ok(bp.run_as(bp.uid('player'), 'select count(*)::text from public.training_bookings') = 'OK:0'
                and bp.run_as(bp.uid('player'), 'select count(*)::text from public.coach_training_bookings') = 'OK:0',
                'player: no direct table or coach view access');
end $$;

-- ===========================================================================
-- E. Other club, anon
-- ===========================================================================
do $$
declare r jsonb;
begin
  perform bp.ok(bp.run_as(bp.uid('coachB'), 'select count(*)::text from public.coach_training_bookings') = 'OK:0'
                and bp.run_as(bp.uid('coachB'), 'select count(*)::text from public.training_bookings') = 'OK:0',
                'cross-tenant: another club''s coach sees no booking');
  perform bp.ok(bp.run_as(bp.uid('adminB'), format('select count(*)::text from public.training_bookings where id = %L', bp.get('b1'))) = 'OK:0',
                'cross-tenant: another club''s admin cannot read the booking');
  r := bp.j(bp.uid('adminB'), format('select public.coach_booking_agenda(%L, %L, %L)::text', now(), now() + interval '30 days', bp.get('coachRow')));
  perform bp.ok(r = '[]'::jsonb, 'cross-tenant: agenda of another club''s coach is empty');
  perform bp.ok((bp.j(bp.uid('adminB'), 'select public.guardian_booking_overview()::text')) = '[]'::jsonb,
                'cross-tenant: guardian overview of another club is empty');
  perform bp.ok(left(bp.run_as(null, 'select count(*)::text from public.coach_training_bookings'), 4) = 'ERR:',
                'anon: the coach view is not readable');
end $$;
