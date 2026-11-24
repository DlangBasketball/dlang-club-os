-- ============================================================================
-- Club approval suite (migration 20250420105800_club_approval_status.sql)
--
--   A. programs.requires_club_approval defaults (club programmes on, camps off).
--   B. Submit (guardian only): pending, no registration / membership /
--      invoice / roster row; reviewers + notification recipients; replay;
--      duplicate; other family / other org / finance refused.
--   C. Visibility (RLS): guardian own family only, assigned coach only his
--      programme requests, finance / other coach / other org nothing; no
--      direct writes; direct registration into a club programme refused.
--   D. A pending club application never blocks a camp registration or a
--      training booking request of the same child.
--   E. Decisions: finance / guardian / unassigned coach / other org refused;
--      request info -> reply -> pending; replays.
--   F. Approve a programme request: registration + one invoice, paid ->
--      confirmed + team roster; replays never duplicate.
--   G. Approve a membership request: membership_create rules unchanged.
--   H. Decline with a message, re-apply, withdraw; free programme (confirmed
--      at once + team roster); capacity (PROGRAM_FULL, nothing changes).
--   I. Confirmed-only session roster + "not yet confirmed" list; coach
--      access only through confirmed registrations.
--   J. Staff paths unchanged (membership_create service-only, staff
--      registration direct); selection programmes are not club requests.
--   K. Cross-tenant: queue / counts / family list of another club.
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach …f3 = coach
-- row …011, guardian …f4 of family …061 / athlete …071; family …062 =
-- athletes …072, …073). Org B …0002 (seed_tenants.sql). SYNTHETIC DATA ONLY.
-- Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema cl;
grant usage on schema cl to authenticated, anon, service_role;
create table cl.ctx (k text primary key, v text);
grant all on cl.ctx to authenticated, anon, service_role;

create function cl.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;
create function cl.put(p_k text, p_v text) returns void language sql as $$
  insert into cl.ctx (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v;
$$;
create function cl.get(p_k text) returns text language sql stable as $$ select v from cl.ctx where k = p_k $$;
create function cl.uid(p_k text) returns uuid language sql stable as $$ select v::uuid from cl.ctx where k = p_k $$;
create function cl.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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
create function cl.j(p uuid, p_sql text) returns jsonb language plpgsql as $$
declare r text := cl.run_as(p, p_sql);
begin
  if left(r, 3) = 'OK:' then
    if substr(r, 4) = '<null>' then return 'null'::jsonb; end if;
    return substr(r, 4)::jsonb;
  end if;
  return jsonb_build_object('err', substr(r, 5));
end $$;
create function cl.err(p jsonb) returns text language sql immutable as $$ select split_part(p->>'err', ':', 1) $$;
create function cl.n(p uuid, p_sql text) returns int language plpgsql as $$
declare r text := cl.run_as(p, p_sql);
begin
  if left(r, 3) = 'OK:' then return substr(r, 4)::int; end if;
  return -1;
end $$;
create function cl.submit(p_user text, p_payload jsonb, p_req uuid default gen_random_uuid()) returns jsonb language sql as $$
  select cl.j(cl.uid(p_user), format('select public.club_request_submit(%L::jsonb, %L)::text', p_payload, p_req))
$$;
create function cl.decide(p_user text, p_id uuid, p_decision text, p_msg text default null, p_req uuid default gen_random_uuid()) returns jsonb language sql as $$
  select cl.j(cl.uid(p_user), format('select public.club_request_decide(%L, %L, %L, %L)::text', p_id, p_decision, p_msg, p_req))
$$;
create function cl.reply(p_user text, p_id uuid, p_msg text, p_req uuid default gen_random_uuid()) returns jsonb language sql as $$
  select cl.j(cl.uid(p_user), format('select public.club_request_reply(%L, %L, %L)::text', p_id, p_msg, p_req))
$$;
grant execute on all functions in schema cl to authenticated, anon, service_role;

select cl.put('org', '00000000-0000-0000-0000-000000000001'),
       cl.put('orgB', '10000000-0000-0000-0000-000000000002'),
       cl.put('admin', '00000000-0000-0000-0000-0000000000f1'),
       cl.put('finance', '00000000-0000-0000-0000-0000000000f2'),
       cl.put('coach', '00000000-0000-0000-0000-0000000000f3'),
       cl.put('guardian', '00000000-0000-0000-0000-0000000000f4'),
       cl.put('coach2', '00000000-0000-0000-0000-000000000cc2'),
       cl.put('guardian2', '00000000-0000-0000-0000-000000000cb2'),
       cl.put('adminB', 'b0000000-0000-0000-0000-000000000cf5'),
       cl.put('coachRow', '00000000-0000-0000-0000-000000000011'),
       cl.put('coach2Row', '00000000-0000-0000-0000-000000000012'),
       cl.put('fam1', '00000000-0000-0000-0000-000000000061'),
       cl.put('fam2', '00000000-0000-0000-0000-000000000062'),
       cl.put('a71', '00000000-0000-0000-0000-000000000071'),
       cl.put('a72', '00000000-0000-0000-0000-000000000072'),
       cl.put('a73', '00000000-0000-0000-0000-000000000073'),
       cl.put('a74', '00000000-0000-0000-0000-000000000c74'),
       cl.put('a75', '00000000-0000-0000-0000-000000000c75'),
       cl.put('a76', '00000000-0000-0000-0000-000000000c76'),
       cl.put('pClinic', '00000000-0000-0000-0000-000000000c41'),
       cl.put('pFree', '00000000-0000-0000-0000-000000000c42'),
       cl.put('pOpen', '00000000-0000-0000-0000-000000000c43'),
       cl.put('pCamp', '00000000-0000-0000-0000-000000000c44'),
       cl.put('pSel', '00000000-0000-0000-0000-000000000c45'),
       cl.put('pBig', '00000000-0000-0000-0000-000000000043'),
       cl.put('tClinic', '00000000-0000-0000-0000-000000000ce1'),
       cl.put('tFree', '00000000-0000-0000-0000-000000000ce2'),
       cl.put('mt', '00000000-0000-0000-0000-000000000cd1'),
       cl.put('ed', '00000000-0000-0000-0000-000000000ca1'),
       cl.put('grp', '00000000-0000-0000-0000-000000000ca2'),
       cl.put('opt', '00000000-0000-0000-0000-000000000ca3'),
       cl.put('venue', '00000000-0000-0000-0000-000000000ca4'),
       cl.put('svc', '00000000-0000-0000-0000-000000000ca5'),
       cl.put('attClinic', '00000000-0000-0000-0000-000000000ca6'),
       cl.put('attBig', '00000000-0000-0000-0000-0000000000a1');

-- Fixtures -----------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000cc2', 'cl-coach2@example.test'),
  ('00000000-0000-0000-0000-000000000cb2', 'cl-guardian2@example.test'),
  ('b0000000-0000-0000-0000-000000000cf5', 'cl-admin-b@example.test');
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic ' || left(id::text, 4)
 where id in ('00000000-0000-0000-0000-000000000cc2', '00000000-0000-0000-0000-000000000cb2');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-000000000cf5';
insert into public.staff_roles (org_id, profile_id, role) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000cc2', 'coach'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000cb2', 'parent'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000cf5', 'admin');
update public.coaches set profile_id = '00000000-0000-0000-0000-000000000cc2' where id = '00000000-0000-0000-0000-000000000012';
insert into public.family_members (family_id, profile_id, relation) values
  ('00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-000000000cb2', 'guardian');
update public.organizations set timezone = 'Europe/Zurich' where id = '00000000-0000-0000-0000-000000000001';
insert into public.app_settings (org_id) values ('00000000-0000-0000-0000-000000000001') on conflict (org_id) do nothing;
update public.app_settings set settings = coalesce(settings, '{}'::jsonb) || '{"bookings_enabled": true}'::jsonb
 where org_id = '00000000-0000-0000-0000-000000000001';

insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, status) values
  ('00000000-0000-0000-0000-000000000c74', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000062', 'Synthetic', 'Four', current_date - interval '11 years', 'active'),
  ('00000000-0000-0000-0000-000000000c75', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000062', 'Synthetic', 'Five', current_date - interval '12 years', 'active'),
  ('00000000-0000-0000-0000-000000000c76', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000062', 'Synthetic', 'Six', current_date - interval '9 years', 'active');

insert into public.programs (id, org_id, slug, name, kind, price_chf, capacity, is_public, is_active, status, currency) values
  ('00000000-0000-0000-0000-000000000c41', '00000000-0000-0000-0000-000000000001', 'cl-clinic', 'Synthetic Clinic', 'clinic', 120, 2, false, true, 'published', 'CHF'),
  ('00000000-0000-0000-0000-000000000c42', '00000000-0000-0000-0000-000000000001', 'cl-free', 'Synthetic Free Team', 'recurring_team', 0, null, false, true, 'published', 'CHF'),
  ('00000000-0000-0000-0000-000000000c43', '00000000-0000-0000-0000-000000000001', 'cl-open', 'Synthetic Open Team', 'recurring_team', 50, null, false, true, 'published', 'CHF'),
  ('00000000-0000-0000-0000-000000000c44', '00000000-0000-0000-0000-000000000001', 'cl-camp', 'Synthetic Camp', 'camp', 0, null, true, true, 'published', 'CHF');
-- An admin switches the approval off for the open team.
update public.programs set requires_club_approval = false where id = '00000000-0000-0000-0000-000000000c43';

insert into public.teams (id, org_id, program_id, name, is_active) values
  ('00000000-0000-0000-0000-000000000ce1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000c41', 'CL Clinic squad', true),
  ('00000000-0000-0000-0000-000000000ce2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000c42', 'CL Free squad', true);
insert into public.team_coaches (team_id, coach_id, org_id, role) values
  ('00000000-0000-0000-0000-000000000ce1', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'head'),
  ('00000000-0000-0000-0000-000000000ce1', '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'assistant');

insert into public.membership_types (id, org_id, name, kind, scope, price, currency, period, is_active) values
  ('00000000-0000-0000-0000-000000000cd1', '00000000-0000-0000-0000-000000000001', 'Synthetic Player Membership', 'player', 'person', 200, 'CHF', 'season', true);

-- Camp week (40 days ahead) + training service for the non-blocking checks.
insert into public.camp_editions (id, org_id, program_id, name, starts_on, ends_on, capacity, status) values
  ('00000000-0000-0000-0000-000000000ca1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000c44', 'CL Week', current_date + 40, current_date + 44, 10, 'published');
insert into public.camp_age_groups (id, org_id, program_id, label, min_age, max_age) values
  ('00000000-0000-0000-0000-000000000ca2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000c44', '6-16', 6, 16);
insert into public.camp_price_options (id, org_id, program_id, edition_id, label, days_count, includes_lunch, price) values
  ('00000000-0000-0000-0000-000000000ca3', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000c44', null, 'Full week', 5, true, 250);
insert into public.venues (id, org_id, name, opening_hours) values
  ('00000000-0000-0000-0000-000000000ca4', '00000000-0000-0000-0000-000000000001', 'CL Hall',
   jsonb_build_object('1', '[["07:00","21:00"]]'::jsonb, '2', '[["07:00","21:00"]]'::jsonb, '3', '[["07:00","21:00"]]'::jsonb,
                      '4', '[["07:00","21:00"]]'::jsonb, '5', '[["07:00","21:00"]]'::jsonb, '6', '[["07:00","21:00"]]'::jsonb,
                      '7', '[["07:00","21:00"]]'::jsonb));
insert into public.training_services (id, org_id, slug, name, duration_min, price_chf, kind, session_type, max_participants, currency, venue_id, bookable_by_families) values
  ('00000000-0000-0000-0000-000000000ca5', '00000000-0000-0000-0000-000000000001', 'cl-pt', 'CL Private', 60, 80, 'private', 'individual', 1, 'CHF', '00000000-0000-0000-0000-000000000ca4', true);
insert into public.training_service_coaches (org_id, service_id, coach_id) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000ca5', '00000000-0000-0000-0000-000000000011');

-- Attendance session of the clinic, led by coach …011.
insert into public.program_sessions (id, org_id, program_id, coach_id, starts_at, location) values
  ('00000000-0000-0000-0000-000000000ca7', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000c41',
   '00000000-0000-0000-0000-000000000011', now() + interval '20 days', 'CL Hall');
insert into public.attendance_sessions (id, org_id, program_id, program_session_id, coach_id, session_date, status) values
  ('00000000-0000-0000-0000-000000000ca6', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000c41',
   '00000000-0000-0000-0000-000000000ca7', '00000000-0000-0000-0000-000000000011', now() + interval '20 days', 'open');

-- ===========================================================================
-- A. Defaults
-- ===========================================================================
do $$
begin
  perform cl.ok((select requires_club_approval from public.programs where id = cl.uid('pClinic'))
            and (select requires_club_approval from public.programs where id = cl.uid('pFree'))
            and (select requires_club_approval from public.programs where id = cl.uid('pBig')),
                'clinic / recurring team programmes require club approval by default (backfill + new rows)');
  perform cl.ok(not (select requires_club_approval from public.programs where id = cl.uid('pCamp'))
            and not (select requires_club_approval from public.programs where id = cl.uid('pOpen')),
                'camps never require it; an admin can switch it off (editable)');
end $$;

-- ===========================================================================
-- B. Submit
-- ===========================================================================
do $$
declare r jsonb; r2 jsonb; v_req uuid := gen_random_uuid(); v_id uuid; v_inv int; v_reg int; v_tm int;
begin
  select count(*) into v_inv from public.invoices where org_id = cl.uid('org');
  select count(*) into v_reg from public.registrations where org_id = cl.uid('org');
  select count(*) into v_tm from public.team_memberships where org_id = cl.uid('org');

  r := cl.submit('guardian', jsonb_build_object('kind', 'program_registration', 'family_id', cl.get('fam1'), 'athlete_id', cl.get('a71'),
                                                'program_id', cl.get('pClinic'), 'message', 'Synthetic: plays at school'), v_req);
  v_id := (r->>'id')::uuid;
  perform cl.put('reqClinic', v_id::text);
  perform cl.ok(r->>'status' = 'pending' and not (r->>'replayed')::boolean, 'submit: programme request saved as pending (' || left(r::text, 80) || ')');
  perform cl.ok((select count(*) from public.invoices where org_id = cl.uid('org')) = v_inv
            and (select count(*) from public.registrations where org_id = cl.uid('org')) = v_reg
            and (select count(*) from public.team_memberships where org_id = cl.uid('org')) = v_tm,
                'submit: no invoice, no registration, no roster row');
  perform cl.ok((r->'assigned_coach_ids') = jsonb_build_array(cl.get('coachRow')),
                'submit: reviewer = head coach of the programme''s team (assistant not assigned)');
  perform cl.ok((r->'notify_profile_ids') = jsonb_build_array(cl.get('coach')),
                'notification recipients: the assigned coach''s login (not the admins)');
  perform cl.ok((select count(*) from public.club_approval_messages where approval_id = v_id and kind = 'note' and author_side = 'family') = 1,
                'submit: the family note is stored as the first message');

  r2 := cl.submit('guardian', jsonb_build_object('kind', 'program_registration', 'family_id', cl.get('fam1'), 'athlete_id', cl.get('a71'),
                                                 'program_id', cl.get('pClinic')), v_req);
  perform cl.ok((r2->>'replayed')::boolean and r2->>'id' = v_id::text
            and (select count(*) from public.club_approval_requests where request_id = v_req) = 1,
                'submit replay (same request id) returns the same request, no duplicate');
  r2 := cl.submit('guardian', jsonb_build_object('kind', 'program_registration', 'family_id', cl.get('fam1'), 'athlete_id', cl.get('a71'),
                                                 'program_id', cl.get('pClinic')));
  perform cl.ok(cl.err(r2) = 'ALREADY_REQUESTED', 'double submit with a new id: ALREADY_REQUESTED');
  r2 := cl.submit('guardian2', jsonb_build_object('kind', 'program_registration', 'family_id', cl.get('fam1'), 'athlete_id', cl.get('a71'),
                                                  'program_id', cl.get('pFree')));
  perform cl.ok(cl.err(r2) = 'NOT_AUTHORIZED', 'another family''s guardian cannot submit for this child');
  r2 := cl.submit('guardian', jsonb_build_object('kind', 'program_registration', 'family_id', cl.get('fam1'), 'athlete_id', cl.get('a72'),
                                                 'program_id', cl.get('pFree')));
  perform cl.ok(cl.err(r2) = 'ATHLETE_NOT_FOUND', 'a child of another family is refused');
  r2 := cl.submit('finance', jsonb_build_object('kind', 'program_registration', 'family_id', cl.get('fam1'), 'athlete_id', cl.get('a71'),
                                                'program_id', cl.get('pFree')));
  perform cl.ok(cl.err(r2) = 'NOT_AUTHORIZED', 'finance cannot submit a family request');
  r2 := cl.submit('adminB', jsonb_build_object('kind', 'program_registration', 'family_id', cl.get('fam1'), 'athlete_id', cl.get('a71'),
                                               'program_id', cl.get('pFree')));
  perform cl.ok(cl.err(r2) = 'FAMILY_NOT_FOUND', 'cross-tenant: another club''s admin cannot submit for this family');
  r2 := cl.submit('guardian', jsonb_build_object('kind', 'program_registration', 'family_id', cl.get('fam1'), 'athlete_id', cl.get('a71'),
                                                 'program_id', cl.get('pOpen')));
  perform cl.ok(cl.err(r2) = 'APPROVAL_NOT_REQUIRED', 'a programme without club approval is not a club request');
  r2 := cl.submit('guardian', jsonb_build_object('kind', 'program_registration', 'family_id', cl.get('fam1'), 'athlete_id', cl.get('a71'),
                                                 'program_id', cl.get('pFree')), null);
  perform cl.ok(cl.err(r2) = 'REQUEST_ID_REQUIRED', 'submit without a request id is refused');

  r := cl.submit('guardian', jsonb_build_object('kind', 'membership', 'family_id', cl.get('fam1'), 'athlete_id', cl.get('a71'),
                                                'membership_type_id', cl.get('mt')));
  perform cl.put('reqMember', r->>'id');
  perform cl.ok(r->>'status' = 'pending' and not exists (select 1 from public.memberships where athlete_id = cl.uid('a71')),
                '"Join the club": membership request pending, no membership / invoice');
  perform cl.ok((r->'notify_profile_ids') = jsonb_build_array(cl.get('admin')),
                'membership request: the club''s admins are notified');
end $$;

-- ===========================================================================
-- C. Visibility + direct writes
-- ===========================================================================
do $$
declare v text;
begin
  perform cl.ok(cl.n(cl.uid('guardian'), 'select count(*)::text from public.club_approval_requests') = 2, 'guardian sees the family''s two requests');
  perform cl.ok(cl.n(cl.uid('guardian2'), 'select count(*)::text from public.club_approval_requests') = 0, 'other family sees nothing');
  perform cl.ok(cl.n(cl.uid('coach'), 'select count(*)::text from public.club_approval_requests') = 1
            and cl.n(cl.uid('coach'), format('select count(*)::text from public.club_approval_requests where id = %L', cl.get('reqClinic'))) = 1,
                'assigned coach sees only his programme request (not the membership request)');
  perform cl.ok(cl.n(cl.uid('coach2'), 'select count(*)::text from public.club_approval_requests') = 0, 'unassigned coach sees nothing');
  perform cl.ok(cl.n(cl.uid('finance'), 'select count(*)::text from public.club_approval_requests') = 0, 'finance sees no requests');
  perform cl.ok(cl.n(cl.uid('adminB'), 'select count(*)::text from public.club_approval_requests') = 0, 'cross-tenant: other club sees nothing');
  perform cl.ok(cl.n(cl.uid('admin'), 'select count(*)::text from public.club_approval_requests') = 2, 'admin sees every request of the club');
  perform cl.ok(cl.n(cl.uid('guardian2'), 'select count(*)::text from public.club_approval_messages') = 0
            and cl.n(cl.uid('guardian'), 'select count(*)::text from public.club_approval_messages') = 1,
                'messages follow the request visibility');

  v := cl.run_as(cl.uid('guardian'), format($q$insert into public.club_approval_requests (org_id, subject_kind, program_id, family_id, athlete_id, request_id)
                                             values (%L, 'program_registration', %L, %L, %L, gen_random_uuid()) returning id::text$q$,
                                            cl.get('org'), cl.get('pFree'), cl.get('fam1'), cl.get('a71')));
  perform cl.ok(v like 'ERR:%', 'no direct insert into club_approval_requests (' || left(v, 60) || ')');
  perform cl.ok(cl.n(cl.uid('admin'), format($q$with u as (update public.club_approval_requests set status = 'approved' where id = %L returning 1)
                                               select count(*)::text from u$q$, cl.get('reqClinic'))) = 0,
                'no direct status update (even an admin goes through the RPC)');
  v := cl.run_as(cl.uid('guardian'), format($q$insert into public.registrations (org_id, athlete_id, program_id, status)
                                             values (%L, %L, %L, 'pending') returning id::text$q$, cl.get('org'), cl.get('a71'), cl.get('pFree')));
  perform cl.ok(v like 'ERR:%CLUB_APPROVAL_REQUIRED%', 'a guardian cannot enrol directly in a club-approval programme (' || left(v, 60) || ')');
end $$;

-- ===========================================================================
-- D. A pending club application never blocks camps / training bookings
-- ===========================================================================
do $$
declare v text; r jsonb; v_days jsonb;
begin
  select jsonb_agg(to_char(d, 'YYYY-MM-DD') order by d) into v_days
    from generate_series(current_date + 40, current_date + 44, interval '1 day') d;
  v := cl.run_as(null, 'select 1::text'); -- reset
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    r := public.register_camp(jsonb_build_object(
      'mode', 'parent', 'program_id', cl.get('pCamp'), 'edition_id', cl.get('ed'), 'family_id', cl.get('fam1'),
      'registered_by', cl.get('guardian'),
      'children', jsonb_build_array(jsonb_build_object('athlete_id', cl.get('a71'), 'age_group_id', cl.get('grp'),
                                                       'price_option_id', cl.get('opt'), 'days', v_days, 'list_amount', 250,
                                                       'discounts', '[]'::jsonb)),
      'consents', '[]'::jsonb));
    perform cl.ok(r->>'invoice_id' is not null, 'camp registration of a child with pending club requests succeeds');
  exception when others then
    perform cl.ok(false, 'camp registration of a child with pending club requests succeeds (' || sqlerrm || ')');
  end;

  r := cl.j(cl.uid('guardian'), format('select public.booking_family_request(%L, %L)::text',
            jsonb_build_object('athlete_id', cl.get('a71'), 'service_id', cl.get('svc'),
                               'starts_at', ((current_date + 12)::timestamp at time zone 'UTC' + interval '13 hours')::text),
            gen_random_uuid()));
  perform cl.ok(r->>'booking_id' is not null and r->>'status' = 'requested',
                'training booking request of a child with pending club requests succeeds (' || left(r::text, 80) || ')');
end $$;

-- ===========================================================================
-- E. Decisions: who may decide; request info -> reply
-- ===========================================================================
do $$
declare r jsonb; r2 jsonb; v_id uuid := cl.uid('reqClinic'); v_req uuid := gen_random_uuid(); v_rep uuid := gen_random_uuid();
begin
  perform cl.ok(cl.err(cl.decide('finance', v_id, 'approve')) = 'NOT_AUTHORIZED', 'finance cannot decide');
  perform cl.ok(cl.err(cl.decide('guardian', v_id, 'approve')) = 'NOT_AUTHORIZED', 'the parent cannot decide');
  perform cl.ok(cl.err(cl.decide('coach2', v_id, 'approve')) = 'NOT_AUTHORIZED', 'an unassigned coach (assistant) cannot decide');
  perform cl.ok(cl.err(cl.decide('adminB', v_id, 'approve')) = 'REQUEST_NOT_FOUND', 'cross-tenant: another club''s admin cannot decide');
  perform cl.ok(cl.err(cl.decide('coach', cl.uid('reqMember'), 'approve')) = 'NOT_AUTHORIZED',
                'a coach cannot decide a membership request (admins only)');
  perform cl.ok(cl.err(cl.decide('coach', v_id, 'request_info', '  ')) = 'MESSAGE_REQUIRED', 'request info needs a message');

  r := cl.decide('coach', v_id, 'request_info', 'Synthetic: which school team?', v_req);
  r2 := cl.decide('coach', v_id, 'request_info', 'Synthetic: which school team?', v_req);
  perform cl.ok(r->>'status' = 'info_requested' and (r2->>'replayed')::boolean
            and (select count(*) from public.club_approval_messages where approval_id = v_id and kind = 'info_request') = 1,
                'assigned coach requests information; a retry replays (one message)');
  perform cl.ok(cl.err(cl.reply('guardian2', v_id, 'Synthetic')) = 'NOT_AUTHORIZED', 'another family cannot reply');
  r := cl.reply('guardian', v_id, 'Synthetic: the U12 school team', v_rep);
  r2 := cl.reply('guardian', v_id, 'Synthetic: the U12 school team', v_rep);
  perform cl.ok(r->>'status' = 'pending' and (r2->>'replayed')::boolean
            and (select count(*) from public.club_approval_messages where approval_id = v_id and kind = 'reply') = 1,
                'family replies -> back to pending; a retry replays');
  perform cl.ok(cl.err(cl.reply('guardian', v_id, 'Synthetic again')) = 'NO_INFO_REQUESTED', 'no reply without an open information request');
end $$;

-- ===========================================================================
-- F. Approve a programme request (coach) -> registration + invoice; paid -> confirmed + team
-- ===========================================================================
do $$
declare r jsonb; r2 jsonb; v_id uuid := cl.uid('reqClinic'); v_req uuid := gen_random_uuid(); v_reg uuid; v_inv uuid; v text;
begin
  r := cl.decide('coach', v_id, 'approve', 'Synthetic: welcome', v_req);
  r2 := cl.decide('coach', v_id, 'approve', null, v_req);
  v_reg := (r->>'registration_id')::uuid;
  v_inv := (r->>'invoice_id')::uuid;
  perform cl.put('regClinic', v_reg::text);
  perform cl.put('invClinic', v_inv::text);
  perform cl.ok(r->>'status' = 'approved' and r->>'registration_status' = 'pending' and v_inv is not null,
                'approve (assigned coach): registration pending + invoice (' || left(r::text, 100) || ')');
  perform cl.ok((select total_chf = 120 and status::text = 'sent' and currency = 'CHF' and registration_id = v_reg and program_id = cl.uid('pClinic')
                   from public.invoices where id = v_inv), 'programme invoice: price 120 CHF, sent, linked to the registration');
  perform cl.ok((r2->>'replayed')::boolean and r2->>'registration_id' = v_reg::text, 'approve replay returns the same result');
  r2 := cl.decide('admin', v_id, 'approve');
  perform cl.ok((r2->>'replayed')::boolean
            and (select count(*) from public.registrations where athlete_id = cl.uid('a71') and program_id = cl.uid('pClinic')) = 1
            and (select count(*) from public.invoices where registration_id = v_reg) = 1,
                'a second approval (new id, other reviewer) never duplicates registration or invoice');
  perform cl.ok(cl.err(cl.decide('admin', v_id, 'decline')) = 'ALREADY_DECIDED', 'decline after approval: ALREADY_DECIDED');
  perform cl.ok(not exists (select 1 from public.team_memberships where team_id = cl.uid('tClinic') and athlete_id = cl.uid('a71')),
                'not on the team roster while awaiting payment');

  -- Roster of the clinic session: confirmed only; Mateo is "not yet confirmed" (awaiting payment).
  perform cl.ok(cl.n(cl.uid('coach'), format('select count(*)::text from public.session_roster(%L)', cl.get('attClinic'))) = 0,
                'session roster: an approved but unpaid registration is not on the sheet');
  perform cl.ok(cl.run_as(cl.uid('coach'), format('select reason from public.session_roster_unconfirmed(%L) where athlete_id = %L',
                                                   cl.get('attClinic'), cl.get('a71'))) = 'OK:awaiting_payment',
                'not-yet-confirmed list: awaiting payment');

  update public.invoices set status = 'paid', paid_at = now() where id = v_inv;
  perform cl.ok((select status::text from public.registrations where id = v_reg) = 'confirmed', 'paid in full -> registration confirmed');
  perform cl.ok(exists (select 1 from public.team_memberships where team_id = cl.uid('tClinic') and athlete_id = cl.uid('a71') and status = 'active'),
                'confirmed -> on the programme team roster (team_memberships)');
  perform cl.ok(cl.n(cl.uid('coach'), format('select count(*)::text from public.session_roster(%L)', cl.get('attClinic'))) = 1,
                'session roster now lists the confirmed child');
  perform cl.ok((select count(*) from public.team_memberships where athlete_id = cl.uid('a71') and team_id = cl.uid('tClinic')) = 1,
                'one roster row only');
end $$;

-- ===========================================================================
-- G. Approve a membership request: existing membership rules
-- ===========================================================================
do $$
declare r jsonb; r2 jsonb; v_id uuid := cl.uid('reqMember'); v_req uuid := gen_random_uuid(); m public.memberships%rowtype; ref jsonb;
begin
  r := cl.decide('admin', v_id, 'approve', null, v_req);
  r2 := cl.decide('admin', v_id, 'approve', null, v_req);
  select * into m from public.memberships where id = (r->>'membership_id')::uuid;
  perform cl.ok(r->>'status' = 'approved' and m.status = 'pending_payment' and m.price_amount = 200 and m.invoice_id is not null
            and m.family_id = cl.uid('fam1') and m.athlete_id = cl.uid('a71') and m.created_by = cl.uid('guardian'),
                'membership approved: pending_payment, price 200, invoice, created for the requesting guardian');
  -- The reference: what membership_create (staff path) produces for the same type.
  ref := public.membership_create(jsonb_build_object('org_id', cl.get('org'), 'type_id', cl.get('mt'), 'family_id', cl.get('fam2'),
                                                     'athlete_id', cl.get('a72')));
  perform cl.ok((ref->>'amount')::numeric = m.price_amount
            and (select valid_from = m.valid_from and valid_until = m.valid_until and status = m.status
                   from public.memberships where id = (ref->>'membership_id')::uuid)
            and (select total_chf from public.invoices where id = m.invoice_id) = (select total_chf from public.invoices where id = (ref->>'invoice_id')::uuid),
                'same rules as a staff-created membership (period, status, amount, invoice)');
  perform cl.ok((r2->>'replayed')::boolean and (select count(*) from public.memberships where athlete_id = cl.uid('a71')) = 1,
                'membership approval replay: one membership, one invoice');
end $$;

-- ===========================================================================
-- H. Decline, re-apply, withdraw; free programme; capacity
-- ===========================================================================
do $$
declare r jsonb; v_id uuid; v_reg uuid; v_n int;
begin
  r := cl.submit('guardian2', jsonb_build_object('kind', 'program_registration', 'family_id', cl.get('fam2'), 'athlete_id', cl.get('a74'),
                                                 'program_id', cl.get('pClinic')));
  v_id := (r->>'id')::uuid;
  r := cl.decide('admin', v_id, 'decline', 'Synthetic: group full this term');
  perform cl.ok(r->>'status' = 'declined' and r->>'registration_id' is null
            and exists (select 1 from public.club_approval_messages where approval_id = v_id and kind = 'declined' and body like 'Synthetic%'),
                'decline with a message: no registration, the message is kept');
  r := cl.submit('guardian2', jsonb_build_object('kind', 'program_registration', 'family_id', cl.get('fam2'), 'athlete_id', cl.get('a74'),
                                                 'program_id', cl.get('pClinic')));
  perform cl.ok(r->>'status' = 'pending', 're-apply after a decline is a new request');
  v_id := (r->>'id')::uuid;
  r := cl.j(cl.uid('guardian2'), format('select public.club_request_withdraw(%L, %L)::text', v_id, gen_random_uuid()));
  perform cl.ok(r->>'status' = 'withdrawn', 'guardian withdraws a pending request');

  -- Free programme: confirmed at once + team roster, no invoice.
  r := cl.submit('guardian2', jsonb_build_object('kind', 'program_registration', 'family_id', cl.get('fam2'), 'athlete_id', cl.get('a73'),
                                                 'program_id', cl.get('pFree')));
  perform cl.ok(r->'notify_profile_ids' = jsonb_build_array(cl.get('admin')), 'programme without a coach: admins are notified');
  r := cl.decide('admin', (r->>'id')::uuid, 'approve');
  perform cl.ok(r->>'registration_status' = 'confirmed' and r->>'invoice_id' is null
            and exists (select 1 from public.team_memberships where team_id = cl.uid('tFree') and athlete_id = cl.uid('a73')),
                'free programme: confirmed at once, on the team roster, no invoice');

  -- Capacity 2: Mateo (confirmed) + one more pending; the third approval is refused, nothing changes.
  r := cl.submit('guardian2', jsonb_build_object('kind', 'program_registration', 'family_id', cl.get('fam2'), 'athlete_id', cl.get('a75'),
                                                 'program_id', cl.get('pClinic')));
  r := cl.decide('admin', (r->>'id')::uuid, 'approve');
  perform cl.ok(r->>'registration_status' = 'pending', 'second place: approved, awaiting payment');
  r := cl.submit('guardian2', jsonb_build_object('kind', 'program_registration', 'family_id', cl.get('fam2'), 'athlete_id', cl.get('a76'),
                                                 'program_id', cl.get('pClinic')));
  v_id := (r->>'id')::uuid;
  select count(*) into v_n from public.invoices where org_id = cl.uid('org');
  r := cl.decide('admin', v_id, 'approve');
  perform cl.ok(r->>'reason' = 'PROGRAM_FULL' and not (r->>'decided')::boolean and r->>'status' = 'pending'
            and (select count(*) from public.invoices where org_id = cl.uid('org')) = v_n
            and not exists (select 1 from public.registrations where athlete_id = cl.uid('a76') and program_id = cl.uid('pClinic')),
                'full programme: PROGRAM_FULL, request stays pending, nothing written');
  perform cl.put('reqFull', v_id::text);
end $$;

-- ===========================================================================
-- I. Confirmed-only roster (seed session …a1 of Big Ballers) + coach access
-- ===========================================================================
do $$
declare v text;
begin
  -- Not-yet-confirmed participants of Big Ballers (staff writes).
  insert into public.registrations (org_id, athlete_id, program_id, status) values
    (cl.uid('org'), cl.uid('a74'), cl.uid('pBig'), 'pending'),
    (cl.uid('org'), cl.uid('a76'), cl.uid('pBig'), 'waitlist');
  perform set_config('app.camp_approval', 'on', true);
  insert into public.registrations (org_id, athlete_id, program_id, status, approval_status, approval_request_id, approval_requested_at)
  values (cl.uid('org'), cl.uid('a75'), cl.uid('pBig'), 'pending_approval', 'pending', gen_random_uuid(), now());
  perform set_config('app.camp_approval', 'off', true);

  v := cl.run_as(cl.uid('coach'), format('select string_agg(athlete_id::text, '','' order by athlete_id) from public.session_roster(%L)', cl.get('attBig')));
  perform cl.ok(v like '%' || cl.get('a72') || '%' and v like '%' || cl.get('a73') || '%'
            and v not like '%' || cl.get('a74') || '%' and v not like '%' || cl.get('a75') || '%' and v not like '%' || cl.get('a76') || '%',
                'session_roster: confirmed only (pending, pending_approval and waitlist excluded) [' || v || ']');
  v := cl.run_as(cl.uid('coach'), format('select string_agg(athlete_id::text || ''='' || reason, '','' order by athlete_id) from public.session_roster_unconfirmed(%L)', cl.get('attBig')));
  perform cl.ok(v = 'OK:' || cl.get('a74') || '=pending,' || cl.get('a75') || '=pending_camp_approval',
                'not-yet-confirmed list: pending + pending approval, never the waitlist [' || v || ']');
  perform cl.ok(cl.run_as(cl.uid('coach2'), format('select count(*)::text from public.session_roster_unconfirmed(%L)', cl.get('attBig'))) like 'ERR:%',
                'not-yet-confirmed list: only the session''s coach / admins');

  perform cl.ok(cl.run_as(cl.uid('coach'), format('select public.coach_can_access_athlete(%L)::text', cl.get('a74'))) = 'OK:false',
                'coach access: a pending registration grants no access to the child''s data');
  perform cl.ok(cl.run_as(cl.uid('coach'), format('select public.coach_can_access_athlete(%L)::text', cl.get('a72'))) = 'OK:true',
                'coach access: a confirmed registration still grants access');
  update public.registrations set status = 'confirmed' where athlete_id = cl.uid('a74') and program_id = cl.uid('pBig');
  perform cl.ok(cl.run_as(cl.uid('coach'), format('select public.coach_can_access_athlete(%L)::text', cl.get('a74'))) = 'OK:true',
                'coach access once confirmed');
  perform cl.ok(cl.run_as(cl.uid('coach'), format('select count(*)::text from public.athletes where id = %L', cl.get('a76'))) = 'OK:0',
                'pending club request reviewer: no direct read of the child row (minimal queue data only)');
end $$;

-- ===========================================================================
-- J. Queue (minimal data), family list, staff paths unchanged
-- ===========================================================================
do $$
declare q jsonb; f jsonb; v text; r jsonb;
begin
  q := cl.j(cl.uid('coach'), 'select public.club_request_queue(''all'')::text');
  perform cl.ok(jsonb_array_length(q) >= 1 and not exists (select 1 from jsonb_array_elements(q) x where x->>'subject_kind' = 'membership')
            and not exists (select 1 from jsonb_array_elements(q) x where x->'family'->>'email' is not null or x->'requested_by'->>'email' is not null),
                'coach queue: his programme requests only, no contact details');
  q := cl.j(cl.uid('admin'), 'select public.club_request_queue(''open'')::text');
  perform cl.ok(exists (select 1 from jsonb_array_elements(q) x where x->>'id' = cl.get('reqFull'))
            and not exists (select 1 from jsonb_array_elements(q) x where x->>'status' not in ('pending', 'info_requested')),
                'admin queue (open): pending + info requested only');
  perform cl.ok(cl.err(cl.j(cl.uid('guardian'), 'select public.club_request_queue()::text')) = 'NOT_AUTHORIZED', 'a parent has no reviewer queue');
  perform cl.ok(cl.err(cl.j(cl.uid('finance'), 'select public.club_request_queue()::text')) = 'NOT_AUTHORIZED', 'finance has no reviewer queue');
  f := cl.j(cl.uid('guardian'), 'select public.club_request_family_list()::text');
  perform cl.ok(jsonb_array_length(f) = 2
            and exists (select 1 from jsonb_array_elements(f) x where x->'registration'->>'status' = 'confirmed' and (x->'invoice'->>'open')::numeric = 0)
            and exists (select 1 from jsonb_array_elements(f) x where x->'membership'->>'status' = 'pending_payment' and (x->'invoice'->>'open')::numeric = 200),
                'family list: derived state from the source rows (confirmed + paid; membership awaiting payment)');
  perform cl.ok(jsonb_array_length(cl.j(cl.uid('guardian2'), 'select public.club_request_family_list()::text')) >= 1
            and not exists (select 1 from jsonb_array_elements(cl.j(cl.uid('guardian2'), 'select public.club_request_family_list()::text')) x
                             where x->'family'->>'id' <> cl.get('fam2')),
                'family list: own family only');

  -- Staff paths unchanged.
  v := cl.run_as(cl.uid('guardian'), format('select public.membership_create(%L::jsonb)::text',
                 jsonb_build_object('org_id', cl.get('org'), 'type_id', cl.get('mt'), 'family_id', cl.get('fam1'), 'athlete_id', cl.get('a71'))));
  perform cl.ok(v like 'ERR:%', 'membership_create stays service-role only');
  perform cl.ok(not has_function_privilege('authenticated', 'public.membership_create_core(jsonb)', 'execute')
            and not has_function_privilege('anon', 'public.membership_create_core(jsonb)', 'execute'),
                'membership_create_core is not callable through the API');
  v := cl.run_as(cl.uid('admin'), format($q$insert into public.registrations (org_id, athlete_id, program_id, status)
                                          values (%L, %L, %L, 'confirmed') returning status::text$q$, cl.get('org'), cl.get('a76'), cl.get('pFree')));
  perform cl.ok(v = 'OK:confirmed', 'staff enrolment into a club-approval programme stays direct');

  insert into public.programs (id, org_id, slug, name, kind, price_chf, is_public, is_active, status, currency)
  values (cl.uid('pSel'), cl.uid('org'), 'cl-sel', 'Synthetic Selection', 'selection', 500, false, true, 'published', 'CHF');
  perform cl.ok(not (select requires_club_approval from public.programs where id = cl.uid('pSel')),
                'selection (EYBL) programmes are not club-approval programmes');
  r := cl.submit('guardian', jsonb_build_object('kind', 'program_registration', 'family_id', cl.get('fam1'), 'athlete_id', cl.get('a71'),
                                                'program_id', cl.get('pSel')));
  perform cl.ok(cl.err(r) = 'APPROVAL_NOT_REQUIRED', 'selection programmes keep their own application flow');
end $$;

-- ===========================================================================
-- K. Cross-tenant
-- ===========================================================================
do $$
declare c jsonb;
begin
  perform cl.ok(jsonb_array_length(cl.j(cl.uid('adminB'), 'select public.club_request_queue(''all'')::text')) = 0,
                'cross-tenant: another club''s queue is empty');
  c := cl.j(cl.uid('adminB'), 'select public.club_request_counts()::text');
  perform cl.ok((c->>'club_open')::int = 0 and (c->>'club_info_requested')::int = 0, 'cross-tenant: counts of another club are 0');
  perform cl.ok(jsonb_array_length(cl.j(cl.uid('adminB'), 'select public.club_request_family_list()::text')) = 0,
                'cross-tenant: family list of another club is empty');
  perform cl.ok(cl.err(cl.reply('adminB', cl.uid('reqFull'), 'x')) = 'REQUEST_NOT_FOUND', 'cross-tenant: reply refused');
  perform cl.ok(cl.err(cl.j(cl.uid('adminB'), format('select public.session_roster_unconfirmed(%L)::text', cl.get('attBig')))) = 'SESSION_NOT_FOUND',
                'cross-tenant: not-yet-confirmed list refused');
  c := cl.j(cl.uid('admin'), 'select public.club_request_counts()::text');
  perform cl.ok((c->>'club_open')::int >= 1, 'admin counts: open club requests');
end $$;
