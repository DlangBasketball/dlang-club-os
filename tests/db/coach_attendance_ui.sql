-- ============================================================================
-- Coach attendance UI suite (migration 20250420104100_coach_attendance_ui.sql)
--
--   coach_training_cards: own teams + approved / pending assignments only,
--     place and roster size for sessions the coach can run, nothing for a
--     pending request, other org sees nothing.
--   attendance_guest_search: club players by name, not already on the sheet,
--     never another org's players, refused for coaches who cannot run the
--     session and for other orgs; minimal columns.
--   attendance_sheet_history: lifecycle + changes with names (draft and
--     correction phases), refused for other coaches and other orgs.
--   Idempotent migration re-run.
--
-- Fixtures: synthetic only (ids …cd…). Org A …0001 (admin …f1), org B …0002.
-- Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema cdt;
grant usage on schema cdt to authenticated, anon, service_role;

create function cdt.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;
-- Run p_sql as a signed-in user and return 'OK:<value>' or 'ERR:<message>'.
create function cdt.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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
grant execute on all functions in schema cdt to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Fixtures: cd01 coach C1 (team coach of TA), cd02 coach C2 (approved
-- substitute for E1), cd03 coach C3 (pending request for E1), cd04 coach C4
-- (nothing). Athletes: cd31 + cd32 on team TA, cd33 on team TB (guest
-- candidate), cd34 archived. Org B: admin b…cd91, athlete b…cd92.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000cd01', 'cd-coach1@example.test'),
  ('00000000-0000-0000-0000-00000000cd02', 'cd-coach2@example.test'),
  ('00000000-0000-0000-0000-00000000cd03', 'cd-coach3@example.test'),
  ('00000000-0000-0000-0000-00000000cd04', 'cd-coach4@example.test'),
  ('b0000000-0000-0000-0000-00000000cd91', 'cd-admin-b@example.test');
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic ' || right(id::text, 4)
 where id::text like '00000000-0000-0000-0000-00000000cd%';
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-00000000cd91';
insert into public.staff_roles (org_id, profile_id, role) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000cd01', 'coach'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000cd02', 'coach'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000cd03', 'coach'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000cd04', 'coach'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000cd91', 'admin');
insert into public.coaches (id, org_id, display_name, profile_id) values
  ('00000000-0000-0000-0000-00000000cd51', '00000000-0000-0000-0000-000000000001', 'Synthetic CD One', '00000000-0000-0000-0000-00000000cd01'),
  ('00000000-0000-0000-0000-00000000cd52', '00000000-0000-0000-0000-000000000001', 'Synthetic CD Two', '00000000-0000-0000-0000-00000000cd02'),
  ('00000000-0000-0000-0000-00000000cd53', '00000000-0000-0000-0000-000000000001', 'Synthetic CD Three', '00000000-0000-0000-0000-00000000cd03'),
  ('00000000-0000-0000-0000-00000000cd54', '00000000-0000-0000-0000-000000000001', 'Synthetic CD Four', '00000000-0000-0000-0000-00000000cd04');
insert into public.families (id, org_id, name) values
  ('00000000-0000-0000-0000-00000000cd21', '00000000-0000-0000-0000-000000000001', 'Synthetic CD family'),
  ('b0000000-0000-0000-0000-00000000cd93', '10000000-0000-0000-0000-000000000002', 'Synthetic CD B family');
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, status) values
  ('00000000-0000-0000-0000-00000000cd31', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000cd21', 'Zorbo', 'Cdone', '2013-01-01', 'active'),
  ('00000000-0000-0000-0000-00000000cd32', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000cd21', 'Zorbo', 'Cdtwo', '2013-02-01', 'active'),
  ('00000000-0000-0000-0000-00000000cd33', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000cd21', 'Zorbo', 'Cdguest', '2013-03-01', 'active'),
  ('00000000-0000-0000-0000-00000000cd34', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000cd21', 'Zorbo', 'Cdarchived', '2013-04-01', 'active'),
  ('b0000000-0000-0000-0000-00000000cd92', '10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000cd93', 'Zorbo', 'Cdother', '2013-01-01', 'active');
update public.athletes set archived_at = now() - interval '1 day' where id = '00000000-0000-0000-0000-00000000cd34';
insert into public.teams (id, org_id, name, sport) values
  ('00000000-0000-0000-0000-00000000cd41', '00000000-0000-0000-0000-000000000001', 'CD Team A', 'basketball'),
  ('00000000-0000-0000-0000-00000000cd42', '00000000-0000-0000-0000-000000000001', 'CD Team B', 'basketball'),
  ('b0000000-0000-0000-0000-00000000cd94', '10000000-0000-0000-0000-000000000002', 'CD B Team', 'basketball');
insert into public.team_coaches (team_id, coach_id, org_id, role) values
  ('00000000-0000-0000-0000-00000000cd41', '00000000-0000-0000-0000-00000000cd51', '00000000-0000-0000-0000-000000000001', 'head');
insert into public.team_memberships (org_id, team_id, athlete_id, jersey_number, status, joined_on) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000cd41', '00000000-0000-0000-0000-00000000cd31', 7, 'active', current_date - 60),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000cd41', '00000000-0000-0000-0000-00000000cd32', 8, 'active', current_date - 60),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000cd42', '00000000-0000-0000-0000-00000000cd33', 9, 'active', current_date - 60),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000cd94', 'b0000000-0000-0000-0000-00000000cd92', 1, 'active', current_date - 60);
insert into public.events (id, org_id, team_id, type, title, starts_at, ends_at, location_text) values
  ('00000000-0000-0000-0000-0000000cd0e1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000cd41', 'training', 'CD E1',
   now() + interval '2 hours', now() + interval '4 hours', 'Synthetic gym'),
  ('00000000-0000-0000-0000-0000000cd0e2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000cd42', 'training', 'CD E2',
   now() + interval '3 hours', now() + interval '5 hours', null),
  ('b0000000-0000-0000-0000-0000000cd0b1', '10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000cd94', 'training', 'CD B1',
   now() + interval '2 hours', now() + interval '4 hours', null);
insert into public.event_coach_assignments (org_id, event_id, coach_id, role, status) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000cd0e1', '00000000-0000-0000-0000-00000000cd52', 'substitute', 'approved'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000cd0e1', '00000000-0000-0000-0000-00000000cd53', 'substitute', 'pending');

-- ---------------------------------------------------------------------------
-- coach_training_cards
-- ---------------------------------------------------------------------------
select cdt.ok(cdt.run_as('00000000-0000-0000-0000-00000000cd01',
  $q$select string_agg(event_id::text || '|' || access || '|' || coalesce(location_name, '-') || '|' || coalesce(roster_size::text, '-'), ',')
       from public.coach_training_cards()$q$) = 'OK:00000000-0000-0000-0000-0000000cd0e1|team_coach|Synthetic gym|2',
  'team coach: own team session with place and roster size (no sheet yet)');
select cdt.ok(cdt.run_as('00000000-0000-0000-0000-00000000cd02',
  $q$select string_agg(event_id::text || '|' || access || '|' || can_run::text || '|' || coalesce(roster_size::text, '-'), ',')
       from public.coach_training_cards()$q$) = 'OK:00000000-0000-0000-0000-0000000cd0e1|substitute|true|2',
  'approved substitute: only the assigned session');
select cdt.ok(cdt.run_as('00000000-0000-0000-0000-00000000cd03',
  $q$select string_agg(event_id::text || '|' || access || '|' || can_run::text || '|' || coalesce(roster_size::text, '-') || '|' || reported_absences, ',')
       from public.coach_training_cards()$q$) = 'OK:00000000-0000-0000-0000-0000000cd0e1|pending|false|-|0',
  'pending request: listed without roster size or absences');
select cdt.ok(cdt.run_as('00000000-0000-0000-0000-00000000cd04', 'select count(*)::text from public.coach_training_cards()') = 'OK:0',
  'coach without teams or assignments sees nothing');
select cdt.ok(cdt.run_as('b0000000-0000-0000-0000-00000000cd91', 'select count(*)::text from public.coach_training_cards()') = 'OK:0',
  'other org admin (no coach row) sees nothing');
select cdt.ok(cdt.run_as(null, 'select count(*)::text from public.coach_training_cards()') like 'ERR:%',
  'anonymous callers cannot call coach_training_cards');

-- Sheet opened: roster size from the marks.
select cdt.ok(cdt.run_as('00000000-0000-0000-0000-00000000cd01',
  $q$select public.attendance_open('00000000-0000-0000-0000-0000000cd0e1')->'counts'->>'total'$q$) = 'OK:2', 'coach opens the sheet');
select cdt.ok(cdt.run_as('00000000-0000-0000-0000-00000000cd01',
  $q$select sheet_status || '|' || roster_size || '|' || unmarked from public.coach_training_cards()$q$) = 'OK:draft|2|2',
  'card shows the draft status and roster size from the sheet');

-- ---------------------------------------------------------------------------
-- attendance_guest_search
-- ---------------------------------------------------------------------------
select cdt.ok(cdt.run_as('00000000-0000-0000-0000-00000000cd01',
  $q$select string_agg(athlete_id::text || '|' || array_to_string(team_names, ';'), ',')
       from public.attendance_guest_search('00000000-0000-0000-0000-0000000cd0e1', 'zorbo')$q$)
  = 'OK:00000000-0000-0000-0000-00000000cd33|CD Team B',
  'guest search: club player not on the sheet, with current team; no roster players, archived or other org players');
select cdt.ok(cdt.run_as('00000000-0000-0000-0000-00000000cd02',
  $q$select count(*)::text from public.attendance_guest_search('00000000-0000-0000-0000-0000000cd0e1', 'cdguest')$q$) = 'OK:1',
  'approved substitute can search guests for the session');
select cdt.ok(cdt.run_as('00000000-0000-0000-0000-00000000cd01',
  $q$select count(*)::text from public.attendance_guest_search('00000000-0000-0000-0000-0000000cd0e1', 'z')$q$) = 'OK:0',
  'guest search needs at least 2 characters');
select cdt.ok(cdt.run_as('00000000-0000-0000-0000-00000000cd01',
  $q$select count(*)::text from public.attendance_guest_search('00000000-0000-0000-0000-0000000cd0e1', '%%')$q$) = 'OK:0',
  'guest search treats wildcards literally');
select cdt.ok(cdt.run_as('00000000-0000-0000-0000-00000000cd03',
  $q$select count(*)::text from public.attendance_guest_search('00000000-0000-0000-0000-0000000cd0e1', 'zorbo')$q$) like 'ERR:NOT_AUTHORIZED%',
  'pending coach cannot search guests');
select cdt.ok(cdt.run_as('00000000-0000-0000-0000-00000000cd01',
  $q$select count(*)::text from public.attendance_guest_search('00000000-0000-0000-0000-0000000cd0e2', 'zorbo')$q$) like 'ERR:NOT_AUTHORIZED%',
  'coach cannot search guests for another team''s session');
select cdt.ok(cdt.run_as('b0000000-0000-0000-0000-00000000cd91',
  $q$select count(*)::text from public.attendance_guest_search('00000000-0000-0000-0000-0000000cd0e1', 'zorbo')$q$) like 'ERR:EVENT_NOT_FOUND%',
  'other org admin: session not found');
select cdt.ok((select count(*) = 4 from information_schema.parameters
                where specific_schema = 'public' and parameter_mode = 'OUT'
                  and specific_name like 'attendance_guest_search%'),
  'guest search returns only id, names and team names');
-- Add the guest -> no longer a candidate.
select cdt.ok(cdt.run_as('00000000-0000-0000-0000-00000000cd01',
  $q$select (public.attendance_add_guest('00000000-0000-0000-0000-0000000cd0e1', '00000000-0000-0000-0000-00000000cd33')->>'ok')$q$) = 'OK:true',
  'coach adds the guest');
select cdt.ok(cdt.run_as('00000000-0000-0000-0000-00000000cd01',
  $q$select count(*)::text from public.attendance_guest_search('00000000-0000-0000-0000-0000000cd0e1', 'zorbo')$q$) = 'OK:0',
  'a guest on the sheet is no longer offered');

-- ---------------------------------------------------------------------------
-- attendance_sheet_history
-- ---------------------------------------------------------------------------
select cdt.ok(cdt.run_as('00000000-0000-0000-0000-00000000cd01',
  $q$select jsonb_array_length(public.attendance_sheet_history('00000000-0000-0000-0000-0000000cd0e2')->'changes')::text$q$) like 'ERR:NOT_AUTHORIZED%',
  'history refused for another team''s session');
do $$
declare r text; v int;
begin
  v := substr(cdt.run_as('00000000-0000-0000-0000-00000000cd01',
         $q$select public.attendance_sheet('00000000-0000-0000-0000-0000000cd0e1')->'sheet'->>'version'$q$), 4)::int;
  r := cdt.run_as('00000000-0000-0000-0000-00000000cd02', format($q$select public.attendance_save('00000000-0000-0000-0000-0000000cd0e1',
         '[{"athlete_id":"00000000-0000-0000-0000-00000000cd31","status":"present"},
           {"athlete_id":"00000000-0000-0000-0000-00000000cd32","status":"late"},
           {"athlete_id":"00000000-0000-0000-0000-00000000cd33","status":"present"}]'::jsonb, %s, gen_random_uuid())->>'version'$q$, v));
  perform cdt.ok(r like 'OK:%', 'substitute saves the draft ' || r);
  r := cdt.run_as('00000000-0000-0000-0000-00000000cd02', format($q$select public.attendance_finalize('00000000-0000-0000-0000-0000000cd0e1',
         '00000000-0000-0000-0000-00000000cd52', %s, gen_random_uuid())->>'ok'$q$, substr(r, 4)::int));
  perform cdt.ok(r = 'OK:true', 'substitute finalizes, led by themselves');
  r := cdt.run_as('00000000-0000-0000-0000-00000000cd01', $q$select public.attendance_correct('00000000-0000-0000-0000-0000000cd0e1',
         '00000000-0000-0000-0000-00000000cd32', 'present', 'Arrived on time after all', gen_random_uuid())->>'changed'$q$);
  perform cdt.ok(r = 'OK:true', 'team coach corrects a mark');
end $$;
do $$
declare r text;
begin
  r := cdt.run_as('00000000-0000-0000-0000-00000000cd01', $q$
  select (h->'sheet'->>'status') || '|' || (h->'sheet'->>'led_by_name') || '|' || (h->'sheet'->>'correction_count') || '|'
         || jsonb_array_length(h->'changes') || '|' || (c->>'phase') || '|' || (c->>'previous_status')
         || '>' || (c->>'new_status') || '|' || (c->>'reason') || '|' || (c->>'changed_by_name') || '|' || (c->>'last_name')
    from (select public.attendance_sheet_history('00000000-0000-0000-0000-0000000cd0e1') h) x,
         lateral (select e from jsonb_array_elements(h->'changes') e where e->>'phase' = 'correction') y(c)$q$);
  perform cdt.ok(r = 'OK:final|Synthetic CD Two|1|4|correction|late>present|Arrived on time after all|Synthetic cd01|Cdtwo',
    'history: lifecycle, led by, draft changes and the correction (who, from -> to, reason) newest first — ' || r);
end $$;
select cdt.ok(cdt.run_as('00000000-0000-0000-0000-00000000cd02', $q$
  select jsonb_array_length(public.attendance_sheet_history('00000000-0000-0000-0000-0000000cd0e1')->'changes')::text$q$) = 'OK:4',
  'approved substitute reads the history of the session (grace window)');
select cdt.ok(cdt.run_as('00000000-0000-0000-0000-00000000cd03', $q$
  select public.attendance_sheet_history('00000000-0000-0000-0000-0000000cd0e1')::text$q$) like 'ERR:NOT_AUTHORIZED%',
  'pending coach cannot read the history');
select cdt.ok(cdt.run_as('b0000000-0000-0000-0000-00000000cd91', $q$
  select public.attendance_sheet_history('00000000-0000-0000-0000-0000000cd0e1')::text$q$) like 'ERR:EVENT_NOT_FOUND%',
  'other org admin: history not found');
select cdt.ok(cdt.run_as('00000000-0000-0000-0000-00000000cd01', $q$
  select (public.attendance_sheet_history('00000000-0000-0000-0000-0000000cd0e2')->>'sheet')$q$) like 'ERR:NOT_AUTHORIZED%',
  'no history for a session without access');
select cdt.ok(cdt.run_as('00000000-0000-0000-0000-0000000000f1', $q$
  select coalesce(public.attendance_sheet_history('00000000-0000-0000-0000-0000000cd0e2')->>'sheet', 'none')$q$) = 'OK:none',
  'admin: session without a sheet has an empty history');

-- Idempotent re-run.
\set QUIET on
\i supabase/migrations/20250420104100_coach_attendance_ui.sql
\set QUIET off
select cdt.ok(cdt.run_as('00000000-0000-0000-0000-00000000cd01', 'select count(*)::text from public.coach_training_cards()') = 'OK:1',
  'migration re-run is idempotent');
