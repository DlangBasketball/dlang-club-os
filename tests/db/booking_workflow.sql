-- ============================================================================
-- Booking workflow suite (migration 20250420104400_booking_workflow.sql)
--
--   A. Service catalogue: eligible coaches (backfilled from slugs), kind,
--      setup_missing, review flags for existing services.
--   B. People: duplicate check (accents / case), athlete quick create
--      (minor needs a guardian, idempotent, never enrols), payers.
--   C. Quote + confirm: availability / blackout / override, coach busy,
--      idempotent replay, package deduction once, trial not billable,
--      price override needs a reason (audited).
--   D. Concurrency (dblink): exclusive slot race, last place of a group.
--   E. Invoice from the booking: setup_missing refusal + flag, prefix from
--      the category series, one invoice per booking, payer snapshot,
--      payments with request ids.
--   F. Reschedule: move in place, release / take capacity, full session.
--   G. Cancel: package restored once, credit note / invoice cancelled,
--      session + event cancelled when empty.
--   H. Attendance: session sheet roster = bookings, session coach runs it,
--      history shows the session, no TRAINING_WITHOUT_TEAM flag.
--   I. Visibility: coach roster without payer / money, guardian own child
--      only, payer-only invoice visibility, player, cross-tenant denial.
--   J. Notifications queue / claim / record / retry; legacy book_training
--      bookings get a session; session events are managed by the RPCs.
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach …f3 =
-- coach …011, guardian …f4 of family …061 / athlete …071; family …062 =
-- athletes …072, …073). SYNTHETIC DATA ONLY. Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema bk;
grant usage on schema bk to authenticated, anon, service_role;
create table bk.ctx (k text primary key, v text);
grant all on bk.ctx to authenticated, anon, service_role;

create function bk.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;
create function bk.put(p_k text, p_v text) returns void language sql as $$
  insert into bk.ctx (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v;
$$;
create function bk.get(p_k text) returns text language sql stable as $$ select v from bk.ctx where k = p_k $$;
create function bk.uid(p_k text) returns uuid language sql stable as $$ select v::uuid from bk.ctx where k = p_k $$;
create function bk.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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
-- jsonb result of an RPC, or {"err": "<message>"}
create function bk.j(p uuid, p_sql text) returns jsonb language plpgsql as $$
declare r text := bk.run_as(p, p_sql);
begin
  if left(r, 3) = 'OK:' then
    if substr(r, 4) = '<null>' then return 'null'::jsonb; end if;
    return substr(r, 4)::jsonb;
  end if;
  return jsonb_build_object('err', substr(r, 5));
end $$;
create function bk.err(p jsonb) returns text language sql immutable as $$ select split_part(p->>'err', ':', 1) $$;
grant execute on all functions in schema bk to authenticated, anon, service_role;

-- Fixture ids
select bk.put('org', '00000000-0000-0000-0000-000000000001'),
       bk.put('admin', '00000000-0000-0000-0000-0000000000f1'),
       bk.put('finance', '00000000-0000-0000-0000-0000000000f2'),
       bk.put('coach', '00000000-0000-0000-0000-0000000000f3'),
       bk.put('guardian', '00000000-0000-0000-0000-0000000000f4'),
       bk.put('coach2', '00000000-0000-0000-0000-0000000006b1'),
       bk.put('guardian2', '00000000-0000-0000-0000-0000000006b2'),
       bk.put('player', '00000000-0000-0000-0000-0000000006b3'),
       bk.put('guardian3', '00000000-0000-0000-0000-0000000006b4'),
       bk.put('adminB', 'b0000000-0000-0000-0000-0000000006b5'),
       bk.put('coachRow', '00000000-0000-0000-0000-000000000011'),
       bk.put('coach2Row', '00000000-0000-0000-0000-000000000012'),
       bk.put('coach3Row', '00000000-0000-0000-0000-000000000013'),
       bk.put('a71', '00000000-0000-0000-0000-000000000071'),
       bk.put('a72', '00000000-0000-0000-0000-000000000072'),
       bk.put('a73', '00000000-0000-0000-0000-000000000073'),
       bk.put('fam61', '00000000-0000-0000-0000-000000000061'),
       bk.put('fam62', '00000000-0000-0000-0000-000000000062'),
       bk.put('svcPt', '00000000-0000-0000-0000-0000000006c1'),
       bk.put('svcGrp', '00000000-0000-0000-0000-0000000006c2'),
       bk.put('svcTrial', '00000000-0000-0000-0000-0000000006c3'),
       bk.put('svcPkg', '00000000-0000-0000-0000-0000000006c4'),
       bk.put('svcB', 'b0000000-0000-0000-0000-0000000006c5'),
       bk.put('purchase', '00000000-0000-0000-0000-0000000006d1');

-- Days (UTC midnight) far enough ahead for the cancellation policy.
select bk.put('d1', ((current_date + 10)::timestamp at time zone 'UTC')::text),
       bk.put('d2', ((current_date + 11)::timestamp at time zone 'UTC')::text),
       bk.put('d3', ((current_date + 12)::timestamp at time zone 'UTC')::text),
       bk.put('dp', ((current_date - 3)::timestamp at time zone 'UTC')::text);
create function bk.at(p_day text, p_hours numeric) returns text language sql stable as $$
  select (bk.get(p_day)::timestamptz + make_interval(mins => (p_hours * 60)::int))::text
$$;
grant execute on function bk.at(text, numeric) to authenticated, anon, service_role;

-- Users: second coach (coach row …012), second guardian of family …062, a
-- player login for athlete …072, a third guardian of family …062, org B admin.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000006b1', 'bk-coach2@example.test'),
  ('00000000-0000-0000-0000-0000000006b2', 'bk-guardian2@example.test'),
  ('00000000-0000-0000-0000-0000000006b3', 'bk-player@example.test'),
  ('00000000-0000-0000-0000-0000000006b4', 'bk-guardian3@example.test'),
  ('b0000000-0000-0000-0000-0000000006b5', 'bk-admin-b@example.test');
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic ' || left(id::text, 4)
 where id in ('00000000-0000-0000-0000-0000000006b1', '00000000-0000-0000-0000-0000000006b2',
              '00000000-0000-0000-0000-0000000006b3', '00000000-0000-0000-0000-0000000006b4');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-0000000006b5';
insert into public.staff_roles (org_id, profile_id, role) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000006b1', 'coach'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000006b2', 'parent'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000006b4', 'parent'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000006b5', 'admin');
update public.coaches set profile_id = '00000000-0000-0000-0000-0000000006b1' where id = '00000000-0000-0000-0000-000000000012';
insert into public.family_members (family_id, profile_id, relation) values
  ('00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-0000000006b2', 'guardian'),
  ('00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-0000000006b4', 'guardian');
update public.athletes set player_profile_id = '00000000-0000-0000-0000-0000000006b3' where id = '00000000-0000-0000-0000-000000000072';
update public.organizations set timezone = 'Europe/Zurich' where id = '00000000-0000-0000-0000-000000000001';

-- Services: private (paid), group of 2, free trial, package-based.
insert into public.training_services (id, org_id, slug, name, duration_min, price_chf, kind, session_type, max_participants, currency) values
  ('00000000-0000-0000-0000-0000000006c1', '00000000-0000-0000-0000-000000000001', 'bk-pt', 'BK Private', 60, 80, 'private', 'individual', 1, 'CHF'),
  ('00000000-0000-0000-0000-0000000006c2', '00000000-0000-0000-0000-000000000001', 'bk-grp', 'BK Group', 60, 30, 'group', 'group', 2, 'CHF'),
  ('00000000-0000-0000-0000-0000000006c3', '00000000-0000-0000-0000-000000000001', 'bk-trial', 'BK Trial', 45, 0, 'trial', 'individual', 1, 'CHF'),
  ('00000000-0000-0000-0000-0000000006c4', '00000000-0000-0000-0000-000000000001', 'bk-pkg', 'BK Package', 60, 70, 'package', 'individual', 1, 'CHF');
insert into public.training_service_coaches (org_id, service_id, coach_id) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000006c1', '00000000-0000-0000-0000-000000000011'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000006c2', '00000000-0000-0000-0000-000000000012'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000006c3', '00000000-0000-0000-0000-000000000011'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000006c4', '00000000-0000-0000-0000-000000000011');
-- Availability: coaches …011 and …012, whole days d1..d3 and the past day.
insert into public.coach_availability (org_id, coach_id, starts_at, ends_at, capacity)
select '00000000-0000-0000-0000-000000000001', c, bk.get(d)::timestamptz, bk.get(d)::timestamptz + interval '1 day', 10
  from unnest(array['00000000-0000-0000-0000-000000000011'::uuid, '00000000-0000-0000-0000-000000000012'::uuid]) c,
       unnest(array['d1', 'd2', 'd3', 'dp']) d;
-- A package of 2 sessions for athlete …071 (active).
insert into public.training_package_purchases (id, org_id, athlete_id, family_id, service_id, sessions, list_price, amount, currency,
                                               payment_mode, status, granted_at)
values ('00000000-0000-0000-0000-0000000006d1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000071',
        '00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-0000000006c4', 2, 140, 140, 'CHF', 'comp', 'active', now());
-- Org B: a family, an athlete, a service.
insert into public.families (id, org_id, name) values
  ('b0000000-0000-0000-0000-0000000006e1', '10000000-0000-0000-0000-000000000002', 'Synthetic B family');
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, status) values
  ('b0000000-0000-0000-0000-0000000006e2', '10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000006e1', 'Synthetic', 'Bkplayer', '2014-05-05', 'active');
insert into public.training_services (id, org_id, slug, name, duration_min, price_chf) values
  ('b0000000-0000-0000-0000-0000000006c5', '10000000-0000-0000-0000-000000000002', 'bk-b', 'BK B service', 60, 50);

-- ===========================================================================
-- A. Service catalogue
-- ===========================================================================
do $$
declare c jsonb; pt jsonb;
begin
  perform bk.ok((select count(*) > 0 from public.training_service_coaches
                  where service_id = '00000000-0000-0000-0000-000000000021' and coach_id = '00000000-0000-0000-0000-000000000011'),
                'eligible coaches backfilled from coaches.serves (seed service pt -> Derrick)');
  perform bk.ok((select kind = 'private' and billing_category = 'training' from public.training_services where id = '00000000-0000-0000-0000-000000000021'),
                'existing services default to kind private, billing category training');
  perform bk.ok(exists (select 1 from public.data_review_flags where entity_id = '00000000-0000-0000-0000-000000000026'
                         and reason_code = 'SERVICE_WITHOUT_COACH' and resolved_at is null),
                'seed service without any eligible coach is flagged SERVICE_WITHOUT_COACH');
  perform bk.ok(exists (select 1 from public.data_review_flags where entity_id = '00000000-0000-0000-0000-000000000021'
                         and reason_code = 'SERVICE_BILLING_SETUP' and resolved_at is null),
                'paid seed service without a number series is flagged SERVICE_BILLING_SETUP');
  c := bk.j(bk.uid('admin'), 'select public.training_service_catalog()::text');
  select x into pt from jsonb_array_elements(c) x where x->>'id' = bk.get('svcPt');
  perform bk.ok(pt->>'kind' = 'private' and (pt->'coaches') @> jsonb_build_array(jsonb_build_object('id', bk.get('coachRow'))),
                'catalogue: private service lists its eligible coach');
  perform bk.ok((pt->'setup_missing') ? 'NUMBER_SERIES_MISSING' and pt->>'number_prefix' is null,
                'catalogue: paid service without a series reports NUMBER_SERIES_MISSING');
  perform bk.ok(bk.err(bk.j(bk.uid('coach'), 'select public.training_service_catalog()::text')) = 'NOT_AUTHORIZED',
                'catalogue: a coach is refused (prices are staff data)');
  perform bk.ok(bk.err(bk.j(bk.uid('guardian'), 'select public.training_service_catalog()::text')) = 'NOT_AUTHORIZED',
                'catalogue: a guardian is refused');
  perform bk.ok(bk.err(bk.j(bk.uid('admin'), format('update public.training_services set billing_category = %L where id = %L returning id::text',
                                                      'other', bk.get('svcPt')))) is not null,
                'billing category "other" is refused on a service');
end $$;

-- ===========================================================================
-- B. People: duplicate check, quick create, payers
-- ===========================================================================
do $$
declare r jsonb; r2 jsonb; v_req uuid := gen_random_uuid(); v_ath uuid;
begin
  r := bk.j(bk.uid('admin'), 'select public.people_duplicate_check(''{"first_name":"mateo","last_name":"LOPES","dob":"2016-03-14"}'')::text');
  perform bk.ok(r->'athletes'->0->>'id' = bk.get('a71') and (r->'athletes'->0->>'score')::int = 100,
                'duplicate check: same name (case-insensitive) and dob -> score 100');
  r := bk.j(bk.uid('admin'), 'select public.people_duplicate_check(''{"first_name":"Lucas","last_name":"Muller"}'')::text');
  perform bk.ok(exists (select 1 from jsonb_array_elements(r->'athletes') x where x->>'id' = bk.get('a72')),
                'duplicate check: accent-insensitive ("Muller" finds "Müller")');
  perform bk.ok(bk.err(bk.j(bk.uid('coach'), 'select public.people_duplicate_check(''{"first_name":"a"}'')::text')) = 'NOT_AUTHORIZED',
                'duplicate check: coach refused');

  r := bk.j(bk.uid('admin'), format('select public.athlete_quick_create(%L, %L)::text',
             '{"first_name":"Nova","last_name":"Synthetica","dob":"2015-02-02"}', gen_random_uuid()));
  perform bk.ok(bk.err(r) = 'GUARDIAN_REQUIRED', 'quick create: a minor without guardian / family is refused');
  r := bk.j(bk.uid('admin'), format('select public.athlete_quick_create(%L, %L)::text',
             '{"first_name":"MATEO","last_name":"Lopes","dob":"2016-03-14","family_id":"00000000-0000-0000-0000-000000000061"}', gen_random_uuid()));
  perform bk.ok(r->>'code' = 'DUPLICATE_SUSPECTED' and r->'candidates'->0->>'id' = bk.get('a71'),
                'quick create: a likely duplicate is returned for the staff to pick');

  r := bk.j(bk.uid('admin'), format('select public.athlete_quick_create(%L, %L)::text',
             '{"first_name":"Nova","last_name":"Synthetica","dob":"2015-02-02","new_family":{"contact_name":"Synthetic Parent","contact_email":"bk-parent@example.test"},"create_payer":{"kind":"guardian"}}', v_req));
  v_ath := (r->>'athlete_id')::uuid;
  perform bk.put('aNova', v_ath::text);
  perform bk.put('famNova', r->>'family_id');
  perform bk.ok((r->>'ok')::boolean and (r->>'created_family')::boolean and (r->>'is_minor')::boolean and r->>'payer_id' is not null,
                'quick create: minor + new family contact (no login) + payer');
  r2 := bk.j(bk.uid('admin'), format('select public.athlete_quick_create(%L, %L)::text',
             '{"first_name":"Nova","last_name":"Synthetica","dob":"2015-02-02","new_family":{"contact_name":"Synthetic Parent","contact_email":"bk-parent@example.test"}}', v_req));
  perform bk.ok((r2->>'replayed')::boolean and r2->>'athlete_id' = v_ath::text
                and (select count(*) = 1 from public.athletes where last_name = 'Synthetica'),
                'quick create: same request id replays, no second athlete');
  perform bk.ok(not exists (select 1 from public.team_memberships where athlete_id = v_ath)
                and not exists (select 1 from public.memberships where athlete_id = v_ath)
                and not exists (select 1 from public.registrations where athlete_id = v_ath)
                and not exists (select 1 from public.family_members where family_id = (r->>'family_id')::uuid),
                'quick create: no membership, roster row, registration or login is created');
  perform bk.ok((select kind = 'guardian' and profile_id is null and name = 'Synthetic Parent' from public.billing_payers where id = (r->>'payer_id')::uuid),
                'quick create: payer created from the family contact (no account)');

  r := bk.j(bk.uid('admin'), format('select public.athlete_quick_create(%L, %L)::text',
             '{"first_name":"Ada","last_name":"Adultsynth","dob":"1990-01-01","email":"bk-adult@example.test"}', gen_random_uuid()));
  perform bk.ok((r->>'ok')::boolean and not (r->>'is_minor')::boolean and (r->>'created_family')::boolean,
                'quick create: an adult without a family gets a household of their own');
  perform bk.ok(bk.err(bk.j(bk.uid('guardian'), format('select public.athlete_quick_create(%L, %L)::text',
             '{"first_name":"X","last_name":"Y","dob":"2015-01-01","family_id":"00000000-0000-0000-0000-000000000061"}', gen_random_uuid()))) = 'NOT_AUTHORIZED',
                'quick create: a guardian is refused');
  perform bk.ok(bk.err(bk.j(bk.uid('adminB'), format('select public.athlete_quick_create(%L, %L)::text',
             '{"first_name":"X","last_name":"Crossy","dob":"2015-01-01","family_id":"00000000-0000-0000-0000-000000000061"}', gen_random_uuid()))) = 'FAMILY_NOT_FOUND',
                'quick create: another club''s family is not found (cross-tenant)');

  -- Payers: a sponsor shared by the Müller siblings, guardian2's own payer record.
  r := bk.j(bk.uid('finance'), format('select public.billing_payer_save(%L, %L)::text',
             '{"kind":"sponsor","name":"Synthetic Sponsor AG","email":"bk-sponsor@example.test","family_id":"00000000-0000-0000-0000-000000000062","street":"Rue Synthetique 1","postal_code":"1000","city":"Lausanne","country":"CH"}', gen_random_uuid()));
  perform bk.put('paySponsor', r->>'payer_id');
  r := bk.j(bk.uid('finance'), format('select public.billing_payer_save(%L)::text',
             '{"kind":"guardian","name":"Synthetic Guardian Two","profile_id":"00000000-0000-0000-0000-0000000006b2","family_id":"00000000-0000-0000-0000-000000000062"}'));
  perform bk.put('payG2', r->>'payer_id');
  perform bk.ok(bk.get('paySponsor') is not null and bk.get('payG2') is not null, 'payers saved by finance');
  r := bk.j(bk.uid('admin'), format('select public.billing_payer_candidates(%L)::text', bk.get('a73')));
  perform bk.ok(jsonb_array_length(r->'payers') = 2 and jsonb_array_length(r->'guardians') = 2,
                'payer candidates: siblings share the family payers; guardians listed');
  perform bk.ok(bk.run_as(bk.uid('guardian2'), 'select count(*)::text from public.billing_payers') = 'OK:1',
                'payers RLS: a guardian reads only the payer row of their own login');
  perform bk.ok(bk.run_as(bk.uid('coach'), 'select count(*)::text from public.billing_payers') = 'OK:0',
                'payers RLS: a coach reads no payer');
  perform bk.ok(bk.run_as(bk.uid('adminB'), 'select count(*)::text from public.billing_payers') = 'OK:0',
                'payers RLS: other club reads none (cross-tenant)');
  perform bk.ok(bk.err(bk.j(bk.uid('coach'), format('select public.billing_payer_save(%L)::text', '{"kind":"other","name":"x"}'))) = 'NOT_AUTHORIZED',
                'payer save: coach refused');
end $$;

-- ===========================================================================
-- C. Quote + confirm
-- ===========================================================================
do $$
declare q jsonb; r jsonb; r2 jsonb; v_req uuid := gen_random_uuid(); p text;
begin
  p := jsonb_build_object('athlete_id', bk.get('a71'), 'service_id', bk.get('svcPt'), 'coach_id', bk.get('coachRow'),
                          'starts_at', bk.at('d1', 10))::text;
  q := bk.j(bk.uid('admin'), format('select public.booking_quote(%L)::text', p));
  perform bk.ok((q->>'ok')::boolean and q->'billing'->>'billing_mode' = 'invoice' and (q->'billing'->>'price')::numeric = 80
                and (q->'billing'->'setup_missing') ? 'NUMBER_SERIES_MISSING',
                'quote: private paid service -> invoice 80, setup_missing reported');
  q := bk.j(bk.uid('admin'), format('select public.booking_quote(%L)::text',
             jsonb_build_object('athlete_id', bk.get('a71'), 'service_id', bk.get('svcPt'), 'coach_id', bk.get('coach3Row'), 'starts_at', bk.at('d1', 10))));
  perform bk.ok(q->'errors' ? 'COACH_NOT_ELIGIBLE', 'quote: a coach not eligible for the service');
  q := bk.j(bk.uid('admin'), format('select public.booking_quote(%L)::text',
             jsonb_build_object('athlete_id', bk.get('a71'), 'service_id', bk.get('svcPt'), 'coach_id', bk.get('coachRow'),
                                'starts_at', (bk.get('d1')::timestamptz + interval '20 days')::text)));
  perform bk.ok(q->'errors' ? 'COACH_UNAVAILABLE', 'quote: outside availability -> COACH_UNAVAILABLE');
  perform bk.ok(bk.err(bk.j(bk.uid('coach'), format('select public.booking_quote(%L)::text', p))) = 'NOT_AUTHORIZED', 'quote: coach refused');

  r := bk.j(bk.uid('admin'), format('select public.booking_confirm(%L, %L)::text', p, v_req));
  perform bk.put('bPt', r->>'booking_id');
  perform bk.ok((r->>'ok')::boolean and r->>'billing_status' = 'to_invoice' and r->>'session_id' is not null,
                'confirm: private booking created, billing status to_invoice (no auto invoice)');
  perform bk.ok((select e.type = 'training' and e.team_id is null and e.training_session_id = s.id and e.title = 'BK Private'
                   from public.training_sessions s join public.events e on e.id = s.event_id where s.id = (r->>'session_id')::uuid),
                'confirm: the session has a calendar event (type training, no team)');
  perform bk.ok(not exists (select 1 from public.invoices i join public.training_bookings b on b.invoice_id = i.id where b.id = (r->>'booking_id')::uuid),
                'confirm: no invoice is created by the booking itself');
  r2 := bk.j(bk.uid('admin'), format('select public.booking_confirm(%L, %L)::text', p, v_req));
  perform bk.ok((r2->>'replayed')::boolean and r2->>'booking_id' = r->>'booking_id'
                and (select count(*) = 1 from public.training_bookings where request_id = v_req),
                'confirm: same request id replays the booking');
  perform bk.ok(bk.err(bk.j(bk.uid('guardian'), format('select public.booking_confirm(%L, %L)::text', p, v_req))) = 'NOT_AUTHORIZED',
                'confirm: a guardian is refused');
  r := bk.j(bk.uid('finance'), format('select public.booking_confirm(%L, %L)::text',
             jsonb_build_object('athlete_id', bk.get('a72'), 'service_id', bk.get('svcPt'), 'coach_id', bk.get('coachRow'), 'starts_at', bk.at('d1', 10.5)),
             gen_random_uuid()));
  perform bk.ok(bk.err(r) = 'COACH_BUSY', 'confirm: an overlapping exclusive session of the coach is refused');

  -- Athlete overlap is a warning (coach2, group, overlapping 10:30).
  r := bk.j(bk.uid('admin'), format('select public.booking_confirm(%L, %L)::text',
             jsonb_build_object('athlete_id', bk.get('a71'), 'service_id', bk.get('svcGrp'), 'coach_id', bk.get('coach2Row'), 'starts_at', bk.at('d1', 10.5)),
             gen_random_uuid()));
  perform bk.put('bOverlap', r->>'booking_id');
  perform bk.ok((r->>'ok')::boolean and exists (select 1 from jsonb_array_elements(r->'warnings') w where w->>'code' = 'ATHLETE_OVERLAP'),
                'confirm: an overlapping booking of the same athlete is a warning');

  -- Blackout + admin override with reason
  insert into public.training_blackouts (org_id, coach_id, starts_at, ends_at, reason)
  values (bk.uid('org'), bk.uid('coachRow'), bk.at('d3', 8)::timestamptz, bk.at('d3', 12)::timestamptz, 'Synthetic blackout');
  p := jsonb_build_object('athlete_id', bk.get('a73'), 'service_id', bk.get('svcPt'), 'coach_id', bk.get('coachRow'), 'starts_at', bk.at('d3', 9))::text;
  perform bk.ok(bk.err(bk.j(bk.uid('admin'), format('select public.booking_confirm(%L, %L)::text', p, gen_random_uuid()))) = 'COACH_UNAVAILABLE',
                'confirm: a coach blackout is refused');
  perform bk.ok(bk.err(bk.j(bk.uid('finance'), format('select public.booking_confirm(%L, %L)::text',
                   (p::jsonb || '{"override_availability":true,"override_reason":"x"}')::text, gen_random_uuid()))) = 'OVERRIDE_NOT_ALLOWED',
                'confirm: finance cannot override availability');
  perform bk.ok(bk.err(bk.j(bk.uid('admin'), format('select public.booking_confirm(%L, %L)::text',
                   (p::jsonb || '{"override_availability":true}')::text, gen_random_uuid()))) = 'OVERRIDE_REASON_REQUIRED',
                'confirm: an override needs a reason');
  r := bk.j(bk.uid('admin'), format('select public.booking_confirm(%L, %L)::text',
             (p::jsonb || '{"override_availability":true,"override_reason":"Synthetic exception","price":60}')::text, gen_random_uuid()));
  perform bk.ok(bk.err(r) = 'PRICE_OVERRIDE_REASON_REQUIRED', 'confirm: a price override needs a reason');
  r := bk.j(bk.uid('admin'), format('select public.booking_confirm(%L, %L)::text',
             (p::jsonb || '{"override_availability":true,"override_reason":"Synthetic exception","price":60,"price_reason":"Synthetic discount"}')::text, gen_random_uuid()));
  perform bk.put('bOverride', r->>'booking_id');
  perform bk.ok((r->>'ok')::boolean and (r->>'price')::numeric = 60
                and exists (select 1 from jsonb_array_elements(r->'warnings') w where w->>'code' = 'AVAILABILITY_OVERRIDDEN'),
                'confirm: admin override with reason + price override');
  perform bk.ok(exists (select 1 from public.audit_logs where action = 'BOOKING_PRICE_OVERRIDE' and target_id = (r->>'booking_id')::uuid)
                and exists (select 1 from public.audit_logs where action = 'BOOKING_AVAILABILITY_OVERRIDE' and target_id = (r->>'booking_id')::uuid),
                'confirm: price and availability overrides are audited');

  -- Trial (free) and package
  r := bk.j(bk.uid('admin'), format('select public.booking_confirm(%L, %L)::text',
             jsonb_build_object('athlete_id', bk.get('aNova'), 'service_id', bk.get('svcTrial'), 'coach_id', bk.get('coachRow'), 'starts_at', bk.at('d1', 16)),
             gen_random_uuid()));
  perform bk.put('bTrial', r->>'booking_id');
  perform bk.ok(r->>'billing_mode' = 'free' and r->>'billing_status' = 'not_billable', 'confirm: free trial -> not_billable');
  v_req := gen_random_uuid();
  p := jsonb_build_object('athlete_id', bk.get('a71'), 'service_id', bk.get('svcPkg'), 'coach_id', bk.get('coachRow'), 'starts_at', bk.at('d2', 8))::text;
  r := bk.j(bk.uid('admin'), format('select public.booking_confirm(%L, %L)::text', p, v_req));
  perform bk.put('bPkg', r->>'booking_id');
  r2 := bk.j(bk.uid('admin'), format('select public.booking_confirm(%L, %L)::text', p, v_req));
  perform bk.ok(r->>'billing_mode' = 'package' and r->>'billing_status' = 'package'
                and (select sessions_used = 1 from public.training_package_purchases where id = bk.uid('purchase'))
                and (select count(*) = 1 from public.training_booking_entitlements where booking_id = (r->>'booking_id')::uuid),
                'confirm: package-covered booking deducts one entitlement');
  perform bk.ok((r2->>'replayed')::boolean and (select sessions_used = 1 from public.training_package_purchases where id = bk.uid('purchase')),
                'confirm: replay with the same request id does not deduct again');
  r := bk.j(bk.uid('admin'), format('select public.booking_confirm(%L, %L)::text',
             jsonb_build_object('athlete_id', bk.get('a72'), 'service_id', bk.get('svcPkg'), 'coach_id', bk.get('coachRow'), 'starts_at', bk.at('d2', 12)),
             gen_random_uuid()));
  perform bk.ok(bk.err(r) = 'PACKAGE_REQUIRED', 'confirm: a package-based service without a package is refused');
  perform bk.ok(bk.err(bk.j(bk.uid('adminB'), format('select public.booking_confirm(%L, %L)::text',
                   jsonb_build_object('athlete_id', bk.get('a71'), 'service_id', bk.get('svcPt'), 'coach_id', bk.get('coachRow'), 'starts_at', bk.at('d3', 15)),
                   gen_random_uuid()))) = 'ATHLETE_NOT_FOUND',
                'confirm: another club''s athlete is not found (cross-tenant)');
end $$;

-- ===========================================================================
-- D. Concurrency: two staff confirm at the same time (two real sessions)
-- ===========================================================================
create function bk.race(p_a text, p_b text) returns text[] language plpgsql as $$
declare v_conn text; r1 text; r2 text; v_ok boolean := true; v_pre text;
begin
  begin
    create extension if not exists dblink;
    v_conn := format('dbname=%s host=localhost port=%s user=%s password=postgres', current_database(), current_setting('port'), current_user);
    perform dblink_connect('bk_c1', v_conn);
    perform dblink_connect('bk_c2', v_conn);
  exception when others then
    raise notice 'INFO — concurrency check skipped (no second session: %)', sqlerrm;
    return null;
  end;
  v_pre := format('set request.jwt.claim.sub = %L; set role authenticated;', bk.get('admin'));
  perform dblink_exec('bk_c1', 'begin');
  perform dblink_exec('bk_c1', v_pre);
  perform dblink_exec('bk_c2', v_pre);
  select x into r1 from dblink('bk_c1', format('select public.booking_confirm(%L, %L)::text', p_a, gen_random_uuid())) as t(x text);
  -- session 2 waits on the coach row until session 1 commits
  perform dblink_send_query('bk_c2', format('select public.booking_confirm(%L, %L)::text', p_b, gen_random_uuid()));
  perform dblink_exec('bk_c1', 'commit');
  select x into r2 from dblink_get_result('bk_c2', false) as t(x text);
  if r2 is null then r2 := 'ERR:' || coalesce(dblink_error_message('bk_c2'), '?'); end if;
  perform dblink_disconnect('bk_c1');
  perform dblink_disconnect('bk_c2');
  return array[r1, r2];
end $$;

-- Group of 2: the first place is taken (committed) before the race.
do $$
declare g jsonb;
begin
  g := bk.j(bk.uid('admin'), format('select public.booking_confirm(%L, %L)::text',
             jsonb_build_object('athlete_id', bk.get('a71'), 'service_id', bk.get('svcGrp'), 'coach_id', bk.get('coach2Row'), 'starts_at', bk.at('d2', 15)),
             gen_random_uuid()));
  perform bk.put('sGrp', g->>'session_id');
  perform bk.put('bGrp71', g->>'booking_id');
  perform bk.ok((g->>'ok')::boolean, 'confirm: first place of a group session');
end $$;

do $$
declare r text[]; v_sess uuid := bk.uid('sGrp');
begin
  r := bk.race(jsonb_build_object('athlete_id', bk.get('a72'), 'service_id', bk.get('svcPt'), 'coach_id', bk.get('coachRow'), 'starts_at', bk.at('d2', 10))::text,
               jsonb_build_object('athlete_id', bk.get('a73'), 'service_id', bk.get('svcPt'), 'coach_id', bk.get('coachRow'), 'starts_at', bk.at('d2', 10))::text);
  if r is not null then
    perform bk.ok((r[1])::jsonb->>'ok' = 'true' and r[2] like '%COACH_BUSY%'
                  and (select count(*) = 1 from public.training_bookings where service_id = bk.uid('svcPt') and slot_start = bk.at('d2', 10)::timestamptz),
                  'race: two confirms of the same exclusive slot -> one booking, the other COACH_BUSY');
  end if;

  -- Two staff race for the last place.
  r := bk.race(jsonb_build_object('athlete_id', bk.get('a72'), 'service_id', bk.get('svcGrp'), 'session_id', v_sess)::text,
               jsonb_build_object('athlete_id', bk.get('a73'), 'service_id', bk.get('svcGrp'), 'session_id', v_sess)::text);
  if r is not null then
    perform bk.ok((r[1])::jsonb->>'ok' = 'true' and r[2] like '%SESSION_FULL%' and public.bk_session_count(v_sess) = 2,
                  'race: two staff for the last place of a group -> one joins, the other SESSION_FULL');
  else
    perform bk.j(bk.uid('admin'), format('select public.booking_confirm(%L, %L)::text',
                 jsonb_build_object('athlete_id', bk.get('a72'), 'service_id', bk.get('svcGrp'), 'session_id', v_sess), gen_random_uuid()));
  end if;
  perform bk.ok(bk.err(bk.j(bk.uid('admin'), format('select public.booking_confirm(%L, %L)::text',
                   jsonb_build_object('athlete_id', bk.get('aNova'), 'service_id', bk.get('svcGrp'), 'coach_id', bk.get('coach2Row'), 'starts_at', bk.at('d2', 15)),
                   gen_random_uuid()))) = 'SESSION_FULL',
                'confirm: a group slot with a session is joined, refused when full');
  perform bk.put('bGrp72', (select id::text from public.training_bookings where session_id = v_sess and athlete_id = bk.uid('a72') and status = 'booked'));
end $$;

-- ===========================================================================
-- E. Invoice from the booking
-- ===========================================================================
do $$
declare r jsonb; r2 jsonb; v_req uuid := gen_random_uuid(); v_inv uuid; pv jsonb; v_pay uuid := gen_random_uuid();
begin
  r := bk.j(bk.uid('finance'), format('select public.booking_create_invoice(%L, %L, true)::text', bk.get('bPt'), gen_random_uuid()));
  perform bk.ok(r->>'code' = 'SETUP_MISSING' and (r->'setup_missing') ? 'NUMBER_SERIES_MISSING'
                and not exists (select 1 from public.training_bookings where id = bk.uid('bPt') and invoice_id is not null),
                'invoice: refused with setup_missing while the category has no number series');
  perform bk.ok(exists (select 1 from public.data_review_flags where entity_id = bk.uid('svcPt') and reason_code = 'SERVICE_BILLING_SETUP' and resolved_at is null),
                'invoice: the service is flagged SERVICE_BILLING_SETUP');
  perform bk.run_as(bk.uid('admin'), 'select public.invoice_number_series_set(''training'', ''BK PT'', true)::text');
  pv := bk.j(bk.uid('finance'), format('select public.booking_invoice_preview(%L)::text', bk.get('bPt')));
  perform bk.ok(pv->>'number_prefix' = 'BK PT' and pv->>'category' = 'training' and (pv->>'amount')::numeric = 80
                and pv->'billing_entity'->>'id' is not null and pv->>'number_preview' like 'BK PT-%-0001'
                and jsonb_array_length(pv->'setup_missing') = 0,
                'invoice preview: prefix, category, entity, amount');
  r := bk.j(bk.uid('finance'), format('select public.booking_create_invoice(%L, %L, true)::text', bk.get('bPt'), v_req));
  v_inv := (r->>'invoice_id')::uuid;
  perform bk.put('invPt', v_inv::text);
  perform bk.ok((r->>'ok')::boolean and r->>'number' like 'BK PT-' || to_char(now(), 'YYYY') || '-%' and r->>'activity' = 'training',
                'invoice: number from the category series (' || coalesce(r->>'number', '-') || ')');
  perform bk.ok((select source_label like 'BK Private · %' and payer_kind = 'family' and payer_name is not null and status = 'sent'
                        and billing_entity_id is not null and total_chf = 80
                   from public.invoices where id = v_inv),
                'invoice: source label "service · date", payer snapshot, issued, entity from the route');
  r2 := bk.j(bk.uid('finance'), format('select public.booking_create_invoice(%L, %L, true)::text', bk.get('bPt'), v_req));
  perform bk.ok((r2->>'replayed')::boolean and r2->>'invoice_id' = v_inv::text, 'invoice: same request id replays');
  r2 := bk.j(bk.uid('finance'), format('select public.booking_create_invoice(%L, %L, true)::text', bk.get('bPt'), gen_random_uuid()));
  perform bk.ok((r2->>'already_invoiced')::boolean and r2->>'invoice_id' = v_inv::text
                and (select count(*) = 1 from public.invoices where athlete_id = bk.uid('a71') and source_label like 'BK Private%'),
                'invoice: one invoice per booking (a new request returns the existing one)');
  perform bk.ok(bk.err(bk.j(bk.uid('finance'), format('select public.booking_create_invoice(%L, %L, true)::text', bk.get('bPkg'), gen_random_uuid()))) = 'NOT_BILLABLE',
                'invoice: a package-covered booking is not billable');
  perform bk.ok(bk.err(bk.j(bk.uid('coach'), format('select public.booking_create_invoice(%L, %L, true)::text', bk.get('bOverride'), gen_random_uuid()))) = 'NOT_AUTHORIZED',
                'invoice: a coach is refused');
  perform bk.ok(public.booking_billing_status(bk.uid('bPt')) = 'invoiced', 'billing status: invoiced');

  -- Payments (receipt_record with request id)
  r := bk.j(bk.uid('finance'), format('select public.booking_record_payment(%L, %L)::text', bk.get('bPt'),
             jsonb_build_object('request_id', v_pay, 'amount', 30, 'method', 'bank_transfer')));
  r2 := bk.j(bk.uid('finance'), format('select public.booking_record_payment(%L, %L)::text', bk.get('bPt'),
             jsonb_build_object('request_id', v_pay, 'amount', 30, 'method', 'bank_transfer')));
  perform bk.ok(public.booking_billing_status(bk.uid('bPt')) = 'partially_paid' and (r2->>'replayed')::boolean
                and (select count(*) = 1 from public.payments where invoice_id = v_inv),
                'payment: partial payment recorded once (retry with same request id replays)');
  perform bk.j(bk.uid('finance'), format('select public.booking_record_payment(%L, %L)::text', bk.get('bPt'),
             jsonb_build_object('request_id', gen_random_uuid(), 'amount', 50, 'method', 'twint')));
  perform bk.ok(public.booking_billing_status(bk.uid('bPt')) = 'paid', 'billing status: paid after the rest');
end $$;

-- ===========================================================================
-- F. Reschedule
-- ===========================================================================
do $$
declare r jsonb; r2 jsonb; v_req uuid := gen_random_uuid(); v_old uuid; v_new uuid; v_ev uuid;
begin
  -- Private session moves in place; invoice and total unchanged.
  v_old := (select session_id from public.training_bookings where id = bk.uid('bPt'));
  v_ev := (select event_id from public.training_sessions where id = v_old);
  r := bk.j(bk.uid('admin'), format('select public.booking_reschedule(%L, %L, %L)::text', bk.get('bPt'),
             jsonb_build_object('starts_at', bk.at('d1', 14)), v_req));
  perform bk.ok((r->>'ok')::boolean and (r->>'moved_in_place')::boolean and (r->>'session_id')::uuid = v_old,
                'reschedule: a private session moves in place');
  perform bk.ok((select starts_at = bk.at('d1', 14)::timestamptz and rescheduled_from = bk.at('d1', 10)::timestamptz from public.events where id = v_ev),
                'reschedule: the calendar event follows (rescheduled_from kept)');
  perform bk.ok((select invoice_id = bk.uid('invPt') and price_chf = 80 and change_seq = 1 from public.training_bookings where id = bk.uid('bPt'))
                and (select total_chf = 80 and adjustments_total = 0 from public.invoices where id = bk.uid('invPt')),
                'reschedule: invoice unchanged when the price does not change');
  r2 := bk.j(bk.uid('admin'), format('select public.booking_reschedule(%L, %L, %L)::text', bk.get('bPt'),
             jsonb_build_object('starts_at', bk.at('d1', 18)), v_req));
  perform bk.ok((r2->>'replayed')::boolean and (select slot_start = bk.at('d1', 14)::timestamptz from public.training_bookings where id = bk.uid('bPt')),
                'reschedule: same request id replays, nothing moves twice');

  -- Group: athlete 71 leaves the full session for a new slot (releases a place) ...
  r := bk.j(bk.uid('admin'), format('select public.booking_reschedule(%L, %L, %L)::text', bk.get('bGrp71'),
             jsonb_build_object('starts_at', bk.at('d2', 17)), gen_random_uuid()));
  v_new := (r->>'session_id')::uuid;
  perform bk.put('sGrp2', v_new::text);
  perform bk.ok((r->>'ok')::boolean and v_new <> bk.uid('sGrp') and public.bk_session_count(bk.uid('sGrp')) = 1
                and public.bk_session_count(v_new) = 1,
                'reschedule: leaving a group session releases its place; the new slot takes one');
  -- ... the place is free again for someone else
  r := bk.j(bk.uid('admin'), format('select public.booking_confirm(%L, %L)::text',
             jsonb_build_object('athlete_id', bk.get('aNova'), 'service_id', bk.get('svcGrp'), 'session_id', bk.get('sGrp')), gen_random_uuid()));
  perform bk.ok((r->>'ok')::boolean and public.bk_session_count(bk.uid('sGrp')) = 2, 'reschedule: the released place can be booked');
  perform bk.put('bGrpNova', r->>'booking_id');
  -- moving athlete 72 into the new session leaves Nova alone in the old one
  r := bk.j(bk.uid('admin'), format('select public.booking_reschedule(%L, %L, %L)::text', bk.get('bGrp72'),
             jsonb_build_object('session_id', v_new), gen_random_uuid()));
  perform bk.ok((r->>'ok')::boolean and public.bk_session_count(v_new) = 2 and public.bk_session_count(bk.uid('sGrp')) = 1,
                'reschedule: joining another session by id');
  r := bk.j(bk.uid('admin'), format('select public.booking_reschedule(%L, %L, %L)::text', bk.get('bGrpNova'),
             jsonb_build_object('session_id', v_new), gen_random_uuid()));
  perform bk.ok(bk.err(r) = 'SESSION_FULL', 'reschedule: into a full session is refused');
  r := bk.j(bk.uid('admin'), format('select public.booking_cancel(%L, %L, %L)::text', bk.get('bGrpNova'), 'Synthetic reason', gen_random_uuid()));
  perform bk.ok((select s.status = 'cancelled' and e.status = 'cancelled' from public.training_sessions s join public.events e on e.id = s.event_id
                  where s.id = bk.uid('sGrp')),
                'cancel: the last participant leaving cancels the session and its event');
  perform bk.ok(bk.err(bk.j(bk.uid('adminB'), format('select public.booking_reschedule(%L, %L, %L)::text', bk.get('bPt'),
                   jsonb_build_object('starts_at', bk.at('d3', 15)), gen_random_uuid()))) = 'BOOKING_NOT_FOUND',
                'reschedule: another club cannot touch the booking (cross-tenant)');
end $$;

-- ===========================================================================
-- G. Cancel
-- ===========================================================================
do $$
declare r jsonb; v_req uuid := gen_random_uuid(); r2 jsonb; v_inv uuid; b uuid;
begin
  r := bk.j(bk.uid('admin'), format('select public.booking_cancel(%L, %L, %L)::text', bk.get('bPkg'), 'Synthetic illness', v_req));
  r2 := bk.j(bk.uid('admin'), format('select public.booking_cancel(%L, %L, %L)::text', bk.get('bPkg'), 'Synthetic illness', v_req));
  perform bk.ok((r->>'package_restored')::boolean and (r2->>'replayed')::boolean
                and (select sessions_used = 0 from public.training_package_purchases where id = bk.uid('purchase'))
                and (select restored_at is not null from public.training_booking_entitlements where booking_id = bk.uid('bPkg')),
                'cancel: package entitlement restored exactly once (policy: more than the cancellation hours ahead)');
  perform bk.ok(bk.err(bk.j(bk.uid('admin'), format('select public.booking_cancel(%L, %L, %L)::text', bk.get('bPkg'), 'again', gen_random_uuid()))) = 'ALREADY_CANCELLED',
                'cancel: a second cancel is refused');
  perform bk.ok((select status = 'cancelled' and cancel_reason = 'Synthetic illness' from public.training_bookings where id = bk.uid('bPkg')),
                'cancel: history kept (row stays, reason recorded)');
  perform bk.ok(bk.err(bk.j(bk.uid('admin'), format('select public.booking_cancel(%L, %L, %L)::text', bk.get('bOverride'), '', gen_random_uuid()))) = 'REASON_REQUIRED',
                'cancel: a reason is required');

  -- Paid invoice: credit note, invoice preserved
  r := bk.j(bk.uid('finance'), format('select public.booking_cancel(%L, %L, %L, %L)::text', bk.get('bPt'), 'Synthetic cancel', gen_random_uuid(), 'credit_note'));
  perform bk.ok((r->>'ok')::boolean and (select status::text <> 'cancelled' and adjustments_total = -80 from public.invoices where id = bk.uid('invPt'))
                and public.booking_billing_status(bk.uid('bPt')) = 'credited',
                'cancel: paid invoice gets a credit note, the issued invoice is preserved');
  perform bk.ok((select s.status = 'cancelled' from public.training_sessions s join public.training_bookings b on b.session_id = s.id where b.id = bk.uid('bPt')),
                'cancel: the private session is freed');

  -- Unpaid invoice: cancelled through cancel_invoice
  r := bk.j(bk.uid('finance'), format('select public.booking_create_invoice(%L, %L, true)::text', bk.get('bOverride'), gen_random_uuid()));
  v_inv := (r->>'invoice_id')::uuid;
  r := bk.j(bk.uid('finance'), format('select public.booking_cancel(%L, %L, %L, %L)::text', bk.get('bOverride'), 'Synthetic cancel', gen_random_uuid(), 'cancel_invoice'));
  perform bk.ok((select status::text = 'cancelled' from public.invoices where id = v_inv) and public.booking_billing_status(bk.uid('bOverride')) = 'credited',
                'cancel: unpaid invoice cancelled via cancel_invoice');
  perform bk.ok(bk.err(bk.j(bk.uid('coach'), format('select public.booking_cancel(%L, %L, %L)::text', bk.get('bTrial'), 'x', gen_random_uuid()))) = 'NOT_AUTHORIZED',
                'cancel: a coach is refused');
end $$;

-- ===========================================================================
-- H. Attendance on a (past) session
-- ===========================================================================
do $$
declare r jsonb; v_ev uuid; s jsonb; v_ver int;
begin
  r := bk.j(bk.uid('admin'), format('select public.booking_confirm(%L, %L)::text',
             jsonb_build_object('athlete_id', bk.get('a72'), 'service_id', bk.get('svcGrp'), 'coach_id', bk.get('coach2Row'), 'starts_at', bk.at('dp', 15)),
             gen_random_uuid()));
  perform bk.ok((r->>'ok')::boolean and exists (select 1 from jsonb_array_elements(r->'warnings') w where w->>'code' = 'SLOT_IN_PAST'),
                'confirm: a past slot is a warning for staff');
  perform bk.j(bk.uid('admin'), format('select public.booking_confirm(%L, %L)::text',
             jsonb_build_object('athlete_id', bk.get('a73'), 'service_id', bk.get('svcGrp'), 'session_id', r->>'session_id'), gen_random_uuid()));
  v_ev := (r->>'event_id')::uuid;
  perform bk.put('evPast', v_ev::text);
  s := bk.j(bk.uid('coach2'), format('select public.attendance_open(%L)::text', v_ev));
  perform bk.ok(jsonb_array_length(s->'marks') = 2 and s->'event'->>'team_name' = 'BK Group',
                'attendance: the session coach opens the sheet; roster = the 2 confirmed bookings');
  perform bk.ok(bk.err(bk.j(bk.uid('coach'), format('select public.attendance_open(%L)::text', v_ev))) = 'NOT_AUTHORIZED',
                'attendance: another coach cannot run the session sheet');
  v_ver := (s->'sheet'->>'version')::int;
  s := bk.j(bk.uid('coach2'), format('select public.attendance_mark_all_present(%L, %s, %L)::text', v_ev, v_ver, gen_random_uuid()));
  v_ver := (s->>'version')::int;
  s := bk.j(bk.uid('coach2'), format('select public.attendance_finalize(%L, %L, %s, %L)::text', v_ev, bk.get('coach2Row'), v_ver, gen_random_uuid()));
  perform bk.ok((s->>'ok')::boolean, 'attendance: the session sheet is finalized (' || coalesce(s->>'err', s::text) || ')');
  r := bk.j(bk.uid('guardian2'), format('select public.guardian_attendance_overview(%L)::text', bk.get('a72')));
  perform bk.ok(exists (select 1 from jsonb_array_elements(r->'history') h where h->>'event_id' = v_ev::text and h->>'status' = 'present'),
                'attendance: the session shows in the athlete''s attendance history');
  r := bk.j(bk.uid('guardian2'), 'select public.guardian_booking_overview()::text');
  perform bk.ok(exists (select 1 from jsonb_array_elements(r) c, jsonb_array_elements(c->'attendance') x
                         where c->'athlete'->>'id' = bk.get('a72') and x->>'event_id' = v_ev::text),
                'portal: finalized session attendance in the guardian booking overview');
  perform public.attendance_review_flags(bk.uid('org'));
  perform bk.ok(not exists (select 1 from public.data_review_flags f join public.events e on e.id = f.entity_id
                             where f.reason_code = 'TRAINING_WITHOUT_TEAM' and e.training_session_id is not null),
                'attendance: session events are not flagged TRAINING_WITHOUT_TEAM');
  r := bk.j(bk.uid('coach2'), 'select coalesce(jsonb_agg(c), ''[]'')::text from public.coach_sessions(now() - interval ''5 days'', now() + interval ''30 days'') c');
  perform bk.ok(exists (select 1 from jsonb_array_elements(r) c where c->>'event_id' = v_ev::text and c->>'access' = 'session_coach'),
                'attendance: the session is in the coach''s sessions (access session_coach)');
end $$;

-- ===========================================================================
-- I. Visibility
-- ===========================================================================
do $$
declare r jsonb; v_sp uuid; v_g2 uuid; i_sp uuid; i_g2 uuid;
begin
  -- Coach: roster names, no payer / money
  r := bk.j(bk.uid('coach2'), format('select public.coach_booking_agenda(%L, %L)::text', now() - interval '5 days', now() + interval '30 days'));
  perform bk.ok(jsonb_array_length(r) >= 1 and exists (select 1 from jsonb_array_elements(r) s, jsonb_array_elements(s->'participants') p
                                                        where p->>'first_name' is not null)
                and r::text not like '%price%' and r::text not like '%payer%' and r::text not like '%invoice%',
                'coach agenda: roster names, no payer and no money');
  perform bk.ok(not exists (select 1 from jsonb_array_elements(r) s where s->>'service_id' = bk.get('svcPt')),
                'coach agenda: only the sessions the coach leads');
  perform bk.ok(bk.err(bk.j(bk.uid('coach'), format('select public.booking_detail(%L)::text', bk.get('bPt')))) = 'NOT_AUTHORIZED'
                and bk.err(bk.j(bk.uid('coach'), 'select public.booking_list()::text')) = 'NOT_AUTHORIZED',
                'coach: booking detail / list (payer, money) refused');
  perform bk.ok(bk.run_as(bk.uid('coach'), format('select count(*)::text from public.invoices where id = %L', bk.get('invPt'))) = 'OK:0'
                and bk.run_as(bk.uid('coach'), 'select count(*)::text from public.training_booking_entitlements') = 'OK:0'
                and bk.run_as(bk.uid('coach'), 'select count(*)::text from public.booking_notifications') = 'OK:0',
                'coach: no invoice, entitlement or notification rows');
  perform bk.ok(bk.run_as(bk.uid('coach2'), format('select count(*)::text from public.training_sessions where coach_id = %L', bk.get('coachRow'))) = 'OK:0',
                'coach: sessions of another coach are not readable');

  -- Guardian: own child only
  r := bk.j(bk.uid('guardian'), 'select public.guardian_booking_overview()::text');
  perform bk.ok(jsonb_array_length(r) = 1 and r->0->'athlete'->>'id' = bk.get('a71'), 'guardian overview: own child only');
  perform bk.ok(bk.err(bk.j(bk.uid('guardian'), format('select public.guardian_booking_overview(%L)::text', bk.get('a72')))) = 'NOT_AUTHORIZED',
                'guardian overview: another family''s child refused');
  perform bk.ok(bk.run_as(bk.uid('guardian'), format('select count(*)::text from public.events where id = %L', bk.get('evPast'))) = 'OK:0'
                and bk.run_as(bk.uid('guardian2'), format('select count(*)::text from public.events where id = %L', bk.get('evPast'))) = 'OK:1',
                'events RLS: a session event is visible to the participants'' guardians only');
  perform bk.ok(bk.run_as(bk.uid('guardian'), format('select count(*)::text from public.training_sessions where event_id = %L', bk.get('evPast'))) = 'OK:0',
                'sessions RLS: no session of another family');

  -- Payer-only invoice visibility (family …062): sponsor invoice hidden, guardian2's own visible to guardian2 only.
  r := bk.j(bk.uid('admin'), format('select public.booking_confirm(%L, %L)::text',
             jsonb_build_object('athlete_id', bk.get('a72'), 'service_id', bk.get('svcPt'), 'coach_id', bk.get('coachRow'), 'starts_at', bk.at('d3', 13),
                                'payer_id', bk.get('paySponsor')), gen_random_uuid()));
  v_sp := (r->>'booking_id')::uuid;
  r := bk.j(bk.uid('admin'), format('select public.booking_confirm(%L, %L)::text',
             jsonb_build_object('athlete_id', bk.get('a73'), 'service_id', bk.get('svcPt'), 'coach_id', bk.get('coachRow'), 'starts_at', bk.at('d3', 15),
                                'payer_id', bk.get('payG2')), gen_random_uuid()));
  v_g2 := (r->>'booking_id')::uuid;
  i_sp := (bk.j(bk.uid('finance'), format('select public.booking_create_invoice(%L, %L, true)::text', v_sp, gen_random_uuid()))->>'invoice_id')::uuid;
  i_g2 := (bk.j(bk.uid('finance'), format('select public.booking_create_invoice(%L, %L, true)::text', v_g2, gen_random_uuid()))->>'invoice_id')::uuid;
  perform bk.ok((select payer_kind = 'sponsor' and payer_name = 'Synthetic Sponsor AG' and payer_address->>'city' = 'Lausanne' and payer_id = bk.uid('paySponsor')
                   from public.invoices where id = i_sp),
                'invoice: sponsor payer snapshot (name, address) on the invoice');
  perform bk.ok(bk.run_as(bk.uid('guardian2'), format('select count(*)::text from public.invoices where id = %L', i_sp)) = 'OK:0',
                'payer visibility: a sponsor-paid invoice is not shown to the guardians');
  perform bk.ok(bk.run_as(bk.uid('guardian2'), format('select count(*)::text from public.invoices where id = %L', i_g2)) = 'OK:1'
                and bk.run_as(bk.uid('guardian3'), format('select count(*)::text from public.invoices where id = %L', i_g2)) = 'OK:0',
                'payer visibility: only the guardian who is the payer sees the invoice');
  r := bk.j(bk.uid('guardian3'), format('select public.guardian_booking_overview(%L)::text', bk.get('a73')));
  perform bk.ok(not exists (select 1 from jsonb_array_elements(r->0->'invoices') x where x->>'invoice_id' = i_g2::text)
                and exists (select 1 from jsonb_array_elements(r->0->'invoices') x where x->>'booking_id' = bk.get('bOverride'))
                and jsonb_array_length(r->0->'upcoming') >= 1,
                'guardian overview: family invoices shown, another guardian''s payer invoice hidden');
  r := bk.j(bk.uid('guardian2'), format('select public.guardian_booking_overview(%L)::text', bk.get('a73')));
  perform bk.ok(exists (select 1 from jsonb_array_elements(r->0->'invoices') x where x->>'invoice_id' = i_g2::text),
                'guardian overview: the payer guardian sees their invoice');

  -- Player
  r := bk.j(bk.uid('player'), 'select public.player_booking_overview()::text');
  perform bk.ok(r->'athlete'->>'id' = bk.get('a72') and jsonb_array_length(r->'invoices') = 0 and jsonb_array_length(r->'upcoming') >= 1,
                'player overview: own bookings, no money');
  perform bk.ok(bk.run_as(bk.uid('player'), format('select count(*)::text from public.events where training_session_id = (select session_id from public.training_bookings where id = %L)', bk.get('bTrial'))) = 'OK:0',
                'player: a session the player is not booked on is not visible');

  -- Other club
  perform bk.ok(bk.err(bk.j(bk.uid('adminB'), format('select public.booking_detail(%L)::text', bk.get('bPt')))) = 'BOOKING_NOT_FOUND',
                'cross-tenant: booking detail of another club not found');
  perform bk.ok((bk.j(bk.uid('adminB'), 'select public.booking_list()::text')->>'total')::int = 0
                and bk.run_as(bk.uid('adminB'), 'select count(*)::text from public.training_sessions') = 'OK:0'
                and bk.run_as(bk.uid('adminB'), 'select count(*)::text from public.booking_notifications') = 'OK:0',
                'cross-tenant: lists and tables of another club are empty');
  perform bk.ok(bk.err(bk.j(bk.uid('adminB'), format('select public.booking_cancel(%L, %L, %L)::text', bk.get('bTrial'), 'x', gen_random_uuid()))) = 'BOOKING_NOT_FOUND',
                'cross-tenant: cancel of another club''s booking refused');
  perform bk.ok(bk.err(bk.j(bk.uid('adminB'), format('select public.booking_confirm(%L, %L)::text',
                   jsonb_build_object('athlete_id', 'b0000000-0000-0000-0000-0000000006e2', 'service_id', 'b0000000-0000-0000-0000-0000000006c5',
                                      'session_id', (select session_id from public.training_bookings where id = bk.uid('bTrial'))), gen_random_uuid()))) = 'SESSION_NOT_FOUND',
                'cross-tenant: another club''s session cannot be joined');

  -- Direct writes are refused; session events are managed by the RPCs
  perform bk.ok(left(bk.run_as(bk.uid('admin'), format('insert into public.training_sessions (org_id, service_id, coach_id, starts_at, ends_at) values (%L, %L, %L, now(), now() + interval ''1 hour'') returning id::text',
                   bk.get('org'), bk.get('svcPt'), bk.get('coachRow'))), 4) = 'ERR:',
                'sessions: direct insert refused (RPC only)');
  perform bk.ok(bk.run_as(bk.uid('admin'), format('update public.events set starts_at = starts_at + interval ''1 hour'' where training_session_id = (select session_id from public.training_bookings where id = %L) returning id::text', bk.get('bTrial'))) like 'ERR:SESSION_EVENT_MANAGED%',
                'events: a session event cannot be moved directly (SESSION_EVENT_MANAGED)');

  -- Lists
  r := bk.j(bk.uid('finance'), 'select public.bookings_to_invoice()::text');
  perform bk.ok(not exists (select 1 from jsonb_array_elements(r) x where x->>'billing_status' <> 'to_invoice')
                and not exists (select 1 from jsonb_array_elements(r) x where x->>'booking_id' in (bk.get('bTrial'), bk.get('bPt'))),
                'to invoice: billable bookings without invoice only');
  r := bk.j(bk.uid('finance'), 'select public.booking_dashboard_counts()::text');
  perform bk.ok((r->>'awaiting_invoice')::int = jsonb_array_length(bk.j(bk.uid('finance'), 'select public.bookings_to_invoice()::text'))
                and jsonb_array_length(r->'outstanding') >= 1,
                'dashboard counts: awaiting invoice, outstanding by currency');
  r := bk.j(bk.uid('finance'), format('select public.booking_list(%L)::text', jsonb_build_object('athlete_id', bk.get('a71'))));
  perform bk.ok((r->>'total')::int >= 3 and r->'rows'->0->'service'->>'name' is not null, 'booking list: filter by athlete');
  r := bk.j(bk.uid('finance'), format('select public.booking_detail(%L)::text', bk.get('bPt')));
  perform bk.ok(r->'invoice'->>'number' like 'BK PT-%' and jsonb_array_length(r->'notifications') > 0 and r->'recipient'->>'name' is not null,
                'booking detail: invoice number, notifications, recipient');
  r := bk.j(bk.uid('admin'), format('select public.athlete_booking_history(%L)::text', bk.get('a71')));
  perform bk.ok(jsonb_array_length(r->'upcoming') + jsonb_array_length(r->'past') >= 3, 'athlete booking history');
end $$;

-- ===========================================================================
-- J. Notifications, legacy path
-- ===========================================================================
do $$
declare v_n uuid; r jsonb; v_cnt int; v_leg jsonb; v_sess uuid;
begin
  perform bk.ok(exists (select 1 from public.booking_notifications where booking_id = bk.uid('bTrial') and recipient_kind = 'family' and recipient_email = 'bk-parent@example.test')
                and exists (select 1 from public.booking_notifications where booking_id = bk.uid('bTrial') and recipient_kind = 'coach'),
                'notifications: family without login gets the e-mail-only row; the coach is notified');
  perform bk.ok(exists (select 1 from public.booking_notifications where booking_id = bk.uid('bPt') and kind = 'rescheduled')
                and exists (select 1 from public.booking_notifications where booking_id = bk.uid('bPt') and kind = 'cancelled')
                and exists (select 1 from public.booking_notifications where booking_id = bk.uid('bPt') and kind = 'confirmed' and recipient_kind = 'guardian'),
                'notifications: confirmation, reschedule and cancellation queued per recipient');
  -- service role claims (no auth.uid)
  select count(*) into v_cnt from public.booking_notifications_claim(bk.uid('org'), bk.uid('bTrial'), 10);
  perform bk.ok(v_cnt >= 2 and not exists (select 1 from public.booking_notifications where booking_id = bk.uid('bTrial') and status = 'pending'),
                'notifications: claimed by the dispatcher');
  select id into v_n from public.booking_notifications where booking_id = bk.uid('bTrial') and recipient_kind = 'family';
  perform public.booking_notification_record(v_n, 'failed', 'resend-422: synthetic');
  r := bk.j(bk.uid('finance'), 'select public.booking_followups()::text');
  perform bk.ok(exists (select 1 from jsonb_array_elements(r->'notifications') x where x->>'id' = v_n::text),
                'follow-up: failed delivery listed for staff');
  perform bk.ok(bk.err(bk.j(bk.uid('guardian'), format('select public.booking_notification_retry(%L)::text', v_n))) = 'NOT_AUTHORIZED',
                'retry: guardian refused');
  r := bk.j(bk.uid('finance'), format('select public.booking_notification_retry(%L)::text', v_n));
  perform bk.ok((select status = 'pending' from public.booking_notifications where id = v_n), 'retry: failed delivery queued again');
  perform bk.ok(bk.run_as(bk.uid('admin'), format('select public.booking_notifications_claim(%L, null, 10)::text', bk.get('org'))) like 'ERR:%',
                'claim: service role only');

  -- Legacy book_training (admin override): the booking gets a session + event
  v_leg := bk.j(bk.uid('admin'), format('select public.book_training(%L, %L, %L, %L, ''invoice'', null, null, ''invoice'', true)::text',
                bk.get('aNova'), bk.get('svcPt'), bk.get('coach2Row'), bk.at('d3', 18)));
  v_sess := (select session_id from public.training_bookings where id = (v_leg->>'booking_id')::uuid);
  perform bk.ok(v_sess is not null and exists (select 1 from public.events e where e.training_session_id = v_sess),
                'legacy: book_training bookings are attached to a session with an event (' || coalesce(v_leg->>'err', 'ok') || ')');
  perform bk.run_as(bk.uid('admin'), format('select public.admin_cancel_booking(%L, ''Synthetic'')::text', v_leg->>'booking_id'));
  perform bk.ok((select status = 'cancelled' from public.training_sessions where id = v_sess), 'legacy: cancelling the booking cancels the empty session');
end $$;


-- ===========================================================================
-- K. Category follows the service; price change on reschedule
-- ===========================================================================
insert into public.training_services (id, org_id, slug, name, duration_min, price_chf, kind, billing_category, currency) values
  ('00000000-0000-0000-0000-0000000006c6', '00000000-0000-0000-0000-000000000001', 'bk-campday', 'BK Camp day', 60, 40, 'private', 'camp', 'CHF');
insert into public.training_service_coaches (org_id, service_id, coach_id) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000006c6', '00000000-0000-0000-0000-000000000012');

do $$
declare r jsonb; v_b uuid; v_inv uuid;
begin
  perform bk.run_as(bk.uid('admin'), 'select public.invoice_number_series_set(''camp'', ''BK CAMP'', true)::text');
  r := bk.j(bk.uid('admin'), format('select public.booking_confirm(%L, %L)::text',
             jsonb_build_object('athlete_id', bk.get('a71'), 'service_id', '00000000-0000-0000-0000-0000000006c6', 'coach_id', bk.get('coach2Row'),
                                'starts_at', bk.at('d3', 9)), gen_random_uuid()));
  v_b := (r->>'booking_id')::uuid;
  r := bk.j(bk.uid('finance'), format('select public.booking_create_invoice(%L, %L, false)::text', v_b, gen_random_uuid()));
  v_inv := (r->>'invoice_id')::uuid;
  perform bk.ok(r->>'activity' = 'camp' and (select status::text = 'draft' and number like 'DRAFT-%' from public.invoices where id = v_inv)
                and public.booking_billing_status(v_b) = 'invoice_draft',
                'invoice: category from the service (camp); send=false keeps a staff-only draft');
  update public.invoices set status = 'sent' where id = v_inv;
  perform bk.ok((select number like 'BK CAMP-%' from public.invoices where id = v_inv), 'invoice: the camp series number is assigned at issue');

  r := bk.j(bk.uid('admin'), format('select public.booking_reschedule(%L, %L, %L)::text', v_b,
             jsonb_build_object('starts_at', bk.at('d3', 16), 'price', 30), gen_random_uuid()));
  perform bk.ok(bk.err(r) = 'PRICE_OVERRIDE_REASON_REQUIRED', 'reschedule: a price change needs a reason');
  r := bk.j(bk.uid('admin'), format('select public.booking_reschedule(%L, %L, %L)::text', v_b,
             jsonb_build_object('starts_at', bk.at('d3', 16), 'price', 30, 'price_reason', 'Synthetic shorter session'), gen_random_uuid()));
  perform bk.ok((r->>'ok')::boolean and (select adjustments_total = -10 and total_chf = 40 from public.invoices where id = v_inv)
                and (select price_chf = 30 from public.training_bookings where id = v_b),
                'reschedule: a lower price becomes a credit note on the existing invoice');
end $$;

select 'PASS — booking workflow suite finished' as result;
