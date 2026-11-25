-- ============================================================================
-- Attendance repair suite (migration 20250420106700_attendance_repair.sql)
--
--   L. Lead / assistant / substitute: a staff member with a coach profile
--      finalizing without choosing keeps the approved lead (not themselves);
--      an explicit choice is kept; assistant and substitute keep their roles
--      in the coverage; booked-session coach and team head as fallbacks.
--   R. Repair of led_by: a finalized sheet naming a coach who is not on the
--      session gets the approved lead; previous value kept (repair table +
--      audit_logs); idempotent; repair table admin-read only, other org denied.
--   T. Current day: a child's session that already started today stays in
--      "upcoming" (in_progress / awaiting_attendance, no absence report) until
--      the attendance is final, then moves to the record with the approved
--      (finalized) status; a draft change after a reopen does not change what
--      the family sees. Same for the player view.
--   A. Finalized absence alerts: one initial alert per guardian, unchanged by
--      a retry (same request id), a double click (other request id) and a
--      reopen + finalize; corrections create one alert per recipient and
--      supersede the pending ones; history kept; staff follow-up lists one
--      row per absence and recipient.
--
-- Fixtures: synthetic only (ids …a7…). Org A …0001 (seed admin f1), org B …0002.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema art;
grant usage on schema art to authenticated, anon, service_role;

create function art.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;
create function art.run_as(p uuid, p_sql text) returns text language plpgsql as $$
declare v_msg text; v_res text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
    execute 'set local role authenticated';
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
grant execute on all functions in schema art to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- a701 admin who is also a coach (coach a751), a702 head coach (a752),
-- a703 assistant (a753), a704 substitute (a754), a711 / a712 guardians,
-- a713 player (linked to athlete a731), a791 org B admin.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a701', 'ar-admincoach@example.test'),
  ('00000000-0000-0000-0000-00000000a702', 'ar-head@example.test'),
  ('00000000-0000-0000-0000-00000000a703', 'ar-assistant@example.test'),
  ('00000000-0000-0000-0000-00000000a704', 'ar-sub@example.test'),
  ('00000000-0000-0000-0000-00000000a711', 'ar-guardian1@example.test'),
  ('00000000-0000-0000-0000-00000000a712', 'ar-guardian2@example.test'),
  ('00000000-0000-0000-0000-00000000a713', 'ar-player@example.test'),
  ('b0000000-0000-0000-0000-00000000a791', 'ar-admin-b@example.test');
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001'
 where id::text like '00000000-0000-0000-0000-00000000a7%';
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-00000000a791';
insert into public.staff_roles (org_id, profile_id, role) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a701', 'admin'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a701', 'coach'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a702', 'coach'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a703', 'coach'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a704', 'coach'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000a791', 'admin');
insert into public.coaches (id, org_id, display_name, profile_id) values
  ('00000000-0000-0000-0000-00000000a751', '00000000-0000-0000-0000-000000000001', 'Synthetic AdminCoach', '00000000-0000-0000-0000-00000000a701'),
  ('00000000-0000-0000-0000-00000000a752', '00000000-0000-0000-0000-000000000001', 'Synthetic Head', '00000000-0000-0000-0000-00000000a702'),
  ('00000000-0000-0000-0000-00000000a753', '00000000-0000-0000-0000-000000000001', 'Synthetic Assistant', '00000000-0000-0000-0000-00000000a703'),
  ('00000000-0000-0000-0000-00000000a754', '00000000-0000-0000-0000-000000000001', 'Synthetic Substitute', '00000000-0000-0000-0000-00000000a704');
insert into public.families (id, org_id, name) values
  ('00000000-0000-0000-0000-00000000a721', '00000000-0000-0000-0000-000000000001', 'Synthetic AR Family');
insert into public.family_members (family_id, profile_id, relation, is_primary) values
  ('00000000-0000-0000-0000-00000000a721', '00000000-0000-0000-0000-00000000a711', 'guardian', true),
  ('00000000-0000-0000-0000-00000000a721', '00000000-0000-0000-0000-00000000a712', 'guardian', false);
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, status) values
  ('00000000-0000-0000-0000-00000000a731', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a721', 'Synth', 'Arone', '2012-01-01', 'active'),
  ('00000000-0000-0000-0000-00000000a732', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a721', 'Synth', 'Artwo', '2013-01-01', 'active');
update public.athletes set player_profile_id = '00000000-0000-0000-0000-00000000a713' where id = '00000000-0000-0000-0000-00000000a731';
insert into public.teams (id, org_id, name, sport, age_group) values
  ('00000000-0000-0000-0000-00000000a741', '00000000-0000-0000-0000-000000000001', 'AR U14 Synthetic', 'basketball', 'U14');
insert into public.team_coaches (team_id, coach_id, org_id, role) values
  ('00000000-0000-0000-0000-00000000a741', '00000000-0000-0000-0000-00000000a752', '00000000-0000-0000-0000-000000000001', 'head');
insert into public.team_memberships (org_id, team_id, athlete_id, jersey_number, status, joined_on) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a741', '00000000-0000-0000-0000-00000000a731', 4, 'active', current_date - 60),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a741', '00000000-0000-0000-0000-00000000a732', 5, 'active', current_date - 60);
update public.app_settings set attendance_tracking_starts_on = null where org_id = '00000000-0000-0000-0000-000000000001';

-- E1 yesterday (approved session lead a752 + assistant a753 + substitute a754),
-- E2 two days ago (team head only), E3 three days ago (alerts),
-- ET today: started a minute ago (never before the club's local midnight), ends in 1 hour,
-- EF tomorrow.
insert into public.events (id, org_id, team_id, type, title, starts_at, ends_at)
select v.id, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a741', 'training', v.title, v.s, v.e
  from (values
    ('00000000-0000-0000-0000-0000000a70e1'::uuid, 'AR E1', now() - interval '27 hours', now() - interval '25 hours'),
    ('00000000-0000-0000-0000-0000000a70e2'::uuid, 'AR E2', now() - interval '50 hours', now() - interval '48 hours'),
    ('00000000-0000-0000-0000-0000000a70e3'::uuid, 'AR E3', now() - interval '74 hours', now() - interval '72 hours'),
    ('00000000-0000-0000-0000-0000000a70e4'::uuid, 'AR ET',
       greatest(now() - interval '1 minute', (public.ta_today('00000000-0000-0000-0000-000000000001')::timestamp) at time zone public.ta_tz('00000000-0000-0000-0000-000000000001')),
       now() + interval '1 hour'),
    ('00000000-0000-0000-0000-0000000a70e5'::uuid, 'AR EF', now() + interval '1 day', now() + interval '1 day 2 hours')) v(id, title, s, e);

create function art.finalize(p_actor uuid, p_event uuid, p_marks jsonb, p_req text, p_led uuid default null) returns text language plpgsql as $$
declare r text;
begin
  r := art.run_as(p_actor, format('select public.attendance_open(%L)::text', p_event));
  if r not like 'OK:%' then return 'open ' || r; end if;
  r := art.run_as(p_actor, format('select public.attendance_save(%L, %L::jsonb, (select version from public.team_attendance_sheets where event_id = %L), %L::uuid)::text',
                                  p_event, p_marks, p_event, p_req || '1'));
  if r not like 'OK:%' then return 'save ' || r; end if;
  return art.run_as(p_actor, format('select public.attendance_finalize(%L, %L::uuid, (select version from public.team_attendance_sheets where event_id = %L), %L::uuid)::text',
                                    p_event, p_led, p_event, p_req || '2'));
end $$;
grant execute on function art.finalize(uuid, uuid, jsonb, text, uuid) to authenticated;

-- ===========================================================================
-- L. Lead / assistant / substitute
-- ===========================================================================
do $$
declare r text;
  v_admin uuid := '00000000-0000-0000-0000-00000000a701';
  v_cov jsonb;
begin
  r := art.run_as(v_admin, $q$select public.session_assign_coach('00000000-0000-0000-0000-0000000a70e1', '00000000-0000-0000-0000-00000000a752', 'lead')::text$q$);
  perform art.ok(r like 'OK:%', 'admin assigns the approved lead on E1 (' || left(r, 80) || ')');
  r := art.run_as(v_admin, $q$select public.session_assign_coach('00000000-0000-0000-0000-0000000a70e1', '00000000-0000-0000-0000-00000000a753', 'assistant')::text$q$);
  perform art.ok(r like 'OK:%', 'admin adds an assistant on E1');
  r := art.run_as(v_admin, $q$select public.session_assign_coach('00000000-0000-0000-0000-0000000a70e1', '00000000-0000-0000-0000-00000000a754', 'substitute')::text$q$);
  perform art.ok(r like 'OK:%', 'admin adds a substitute on E1');

  -- The admin (who has a coach profile) finalizes without choosing.
  r := art.finalize(v_admin, '00000000-0000-0000-0000-0000000a70e1',
        '[{"athlete_id":"00000000-0000-0000-0000-00000000a731","status":"present"},{"athlete_id":"00000000-0000-0000-0000-00000000a732","status":"present"}]', '00000000-0000-0000-0000-0000000a7a1');
  perform art.ok(r like 'OK:%"ok": true%', 'admin-coach finalizes E1 (' || left(r, 80) || ')');
  perform art.ok((select led_by_coach_id = '00000000-0000-0000-0000-00000000a752' from public.team_attendance_sheets where event_id = '00000000-0000-0000-0000-0000000a70e1'),
                 'led_by = the approved session lead, not the finalizer''s own coach record');

  select coverage into v_cov from public.session_coverage(array['00000000-0000-0000-0000-0000000a70e1'::uuid]) limit 1;
  -- session_coverage needs a caller; read through run_as.
  r := art.run_as(v_admin, $q$select coverage::text from public.session_coverage(array['00000000-0000-0000-0000-0000000a70e1'::uuid])$q$);
  v_cov := substr(r, 4)::jsonb;
  perform art.ok(v_cov->>'led_by_name' = 'Synthetic Head' and v_cov->>'led_by_source' = 'sheet', 'coverage: Led by the approved lead');
  perform art.ok((select count(*) = 3 from jsonb_array_elements(v_cov->'coaches') c
                   where (c->>'name', c->>'role') in (('Synthetic Head', 'lead'), ('Synthetic Assistant', 'assistant'), ('Synthetic Substitute', 'substitute'))),
                 'coverage keeps lead, assistant and substitute roles');
  perform art.ok((v_cov->>'substitute')::boolean and v_cov->>'coverage' = 'substitute', 'coverage flags the approved substitute');

  -- Each assigned role can open its session; the head coach sees it in Today's cards.
  r := art.run_as('00000000-0000-0000-0000-00000000a704', $q$select count(*)::text from public.coach_training_cards(now() - interval '2 days', now()) where event_id = '00000000-0000-0000-0000-0000000a70e1' and can_run$q$);
  perform art.ok(r = 'OK:1', 'substitute can run E1 (' || r || ')');
  r := art.run_as('00000000-0000-0000-0000-00000000a703', $q$select count(*)::text from public.coach_training_cards(now() - interval '2 days', now()) where event_id = '00000000-0000-0000-0000-0000000a70e1' and can_run$q$);
  perform art.ok(r = 'OK:1', 'assistant can run E1 (' || r || ')');
  r := art.run_as('00000000-0000-0000-0000-00000000a704', $q$select count(*)::text from public.coach_training_cards(now() - interval '3 days', now()) where event_id = '00000000-0000-0000-0000-0000000a70e2' and can_run$q$);
  perform art.ok(r = 'OK:0', 'substitute access stays scoped to E1 (' || r || ')');

  -- No session assignment: the team head coach is the default lead.
  r := art.finalize(v_admin, '00000000-0000-0000-0000-0000000a70e2',
        '[{"athlete_id":"00000000-0000-0000-0000-00000000a731","status":"present"},{"athlete_id":"00000000-0000-0000-0000-00000000a732","status":"late"}]', '00000000-0000-0000-0000-0000000a7a2');
  perform art.ok((select led_by_coach_id = '00000000-0000-0000-0000-00000000a752' from public.team_attendance_sheets where event_id = '00000000-0000-0000-0000-0000000a70e2'),
                 'no session assignment: led_by = team head coach, not the finalizer');
end $$;

-- An explicit choice is kept (the coach who actually stepped in).
do $$
declare r text;
begin
  r := art.run_as('00000000-0000-0000-0000-00000000a701', $q$select public.session_assign_coach('00000000-0000-0000-0000-0000000a70e2', '00000000-0000-0000-0000-00000000a753', 'assistant')::text$q$);
  perform art.ok(r like 'OK:%', 'assistant assigned to E2 (stepped in)');
  r := art.run_as('00000000-0000-0000-0000-00000000a701', $q$select public.attendance_reopen('00000000-0000-0000-0000-0000000a70e2', 'Synthetic reopen')::text$q$);
  perform art.ok(r like 'OK:%', 'admin reopens E2 (' || left(r, 120) || ')');
  r := art.run_as('00000000-0000-0000-0000-00000000a701', $q$select public.attendance_finalize('00000000-0000-0000-0000-0000000a70e2', '00000000-0000-0000-0000-00000000a753',
        (select version from public.team_attendance_sheets where event_id = '00000000-0000-0000-0000-0000000a70e2'), '00000000-0000-0000-0000-00000000a7a3')::text$q$);
  perform art.ok(r like 'OK:%"ok": true%', 'refinalize E2 naming the assistant as leader (' || left(r, 120) || ')');
  -- E2 keeps led_by from the first finalize unless the sheet value is cleared; the explicit value wins.
  perform art.ok((select led_by_coach_id = '00000000-0000-0000-0000-00000000a753' from public.team_attendance_sheets where event_id = '00000000-0000-0000-0000-0000000a70e2'),
                 'explicit Led-by choice is stored');
end $$;

-- ===========================================================================
-- R. Repair of an existing wrong led_by
-- ===========================================================================
do $$
declare v_n int; v_audit int;
begin
  -- Simulate the old behaviour: E1 recorded as led by the finalizer (not a coach of E1).
  update public.team_attendance_sheets set led_by_coach_id = '00000000-0000-0000-0000-00000000a751'
   where event_id = '00000000-0000-0000-0000-0000000a70e1';
  select count(*) into v_audit from public.audit_logs where target_table = 'team_attendance_sheets'
     and target_id = (select id from public.team_attendance_sheets where event_id = '00000000-0000-0000-0000-0000000a70e1');
  v_n := public.ac_led_by_repair('00000000-0000-0000-0000-000000000001');
  perform art.ok(v_n = 1, 'repair finds one sheet (' || v_n || ')');
  perform art.ok((select led_by_coach_id = '00000000-0000-0000-0000-00000000a752' from public.team_attendance_sheets where event_id = '00000000-0000-0000-0000-0000000a70e1'),
                 'E1 led_by repaired to the approved lead');
  perform art.ok((select count(*) = 1 from public.team_attendance_led_by_repairs where event_id = '00000000-0000-0000-0000-0000000a70e1'
                    and previous_coach_id = '00000000-0000-0000-0000-00000000a751' and new_coach_id = '00000000-0000-0000-0000-00000000a752'),
                 'previous value kept in the repair table');
  perform art.ok((select count(*) > v_audit from public.audit_logs where target_table = 'team_attendance_sheets'
                    and target_id = (select id from public.team_attendance_sheets where event_id = '00000000-0000-0000-0000-0000000a70e1')),
                 'repair is audited');
  perform art.ok((select led_by_coach_id = '00000000-0000-0000-0000-00000000a753' from public.team_attendance_sheets where event_id = '00000000-0000-0000-0000-0000000a70e2'),
                 'a leader who is a coach of the session (assistant) is not repaired');
  v_n := public.ac_led_by_repair('00000000-0000-0000-0000-000000000001');
  perform art.ok(v_n = 0, 'repair is idempotent');
end $$;

do $$
declare r text;
begin
  r := art.run_as('00000000-0000-0000-0000-00000000a701', 'select count(*)::text from public.team_attendance_led_by_repairs');
  perform art.ok(r = 'OK:1', 'admin reads the repair log (' || r || ')');
  r := art.run_as('00000000-0000-0000-0000-00000000a702', 'select count(*)::text from public.team_attendance_led_by_repairs');
  perform art.ok(r = 'OK:0', 'coach cannot read the repair log (' || r || ')');
  r := art.run_as('b0000000-0000-0000-0000-00000000a791', 'select count(*)::text from public.team_attendance_led_by_repairs');
  perform art.ok(r = 'OK:0', 'other org admin cannot read the repair log (' || r || ')');
  r := art.run_as('00000000-0000-0000-0000-00000000a701', $q$select public.ac_led_by_repair('00000000-0000-0000-0000-000000000001')::text$q$);
  perform art.ok(r like 'ERR:%', 'repair is not callable by users (' || left(r, 60) || ')');
  r := art.run_as('00000000-0000-0000-0000-00000000a701', $q$delete from public.team_attendance_led_by_repairs returning 1$q$);
  perform art.ok(r = 'OK:<null>' and (select count(*) = 1 from public.team_attendance_led_by_repairs), 'repair log cannot be deleted');
end $$;

-- ===========================================================================
-- T. Current day in the family and player views
-- ===========================================================================
do $$
declare r text; v jsonb; u jsonb;
  v_g uuid := '00000000-0000-0000-0000-00000000a711';
begin
  r := art.run_as(v_g, $q$select public.guardian_attendance_overview('00000000-0000-0000-0000-00000000a731')::text$q$);
  v := substr(r, 4)::jsonb;
  select x into u from jsonb_array_elements(v->'upcoming') x where x->>'event_id' = '00000000-0000-0000-0000-0000000a70e4';
  perform art.ok(u is not null, 'today''s started session is listed for the guardian');
  perform art.ok(u->>'today_state' = 'in_progress' and (u->>'can_report')::boolean = false, 'in progress, no absence report once started (' || coalesce(u::text, 'null') || ')');
  perform art.ok(exists (select 1 from jsonb_array_elements(v->'upcoming') x where x->>'event_id' = '00000000-0000-0000-0000-0000000a70e5' and x->>'today_state' is null),
                 'tomorrow''s session is upcoming without a today state');
  perform art.ok(not exists (select 1 from jsonb_array_elements(v->'upcoming') x where x->>'event_id' = '00000000-0000-0000-0000-0000000a70e1'),
                 'yesterday''s session is not in upcoming');

  r := art.run_as('00000000-0000-0000-0000-00000000a713', $q$select public.player_attendance_overview()::text$q$);
  perform art.ok(r like 'OK:%' and exists (select 1 from jsonb_array_elements(substr(r, 4)::jsonb->'upcoming') x
                   where x->>'event_id' = '00000000-0000-0000-0000-0000000a70e4' and x->>'today_state' = 'in_progress'),
                 'player view lists today''s started session');

  -- Finalize today (Present / Excused): moves to the record with the approved status.
  r := art.finalize('00000000-0000-0000-0000-00000000a702', '00000000-0000-0000-0000-0000000a70e4',
        '[{"athlete_id":"00000000-0000-0000-0000-00000000a731","status":"present"},{"athlete_id":"00000000-0000-0000-0000-00000000a732","status":"excused"}]', '00000000-0000-0000-0000-0000000a7b1');
  perform art.ok(r like 'OK:%"ok": true%', 'head coach finalizes today''s session (' || left(r, 80) || ')');
  r := art.run_as(v_g, $q$select public.guardian_attendance_overview('00000000-0000-0000-0000-00000000a731')::text$q$);
  v := substr(r, 4)::jsonb;
  perform art.ok(not exists (select 1 from jsonb_array_elements(v->'upcoming') x where x->>'event_id' = '00000000-0000-0000-0000-0000000a70e4'),
                 'final: no longer in upcoming');
  perform art.ok(exists (select 1 from jsonb_array_elements(v->'history') x where x->>'event_id' = '00000000-0000-0000-0000-0000000a70e4' and x->>'status' = 'present'),
                 'final: in the record as Present');

  -- Reopen + draft change: the family keeps seeing the approved value.
  r := art.run_as('00000000-0000-0000-0000-00000000a701', $q$select public.attendance_reopen('00000000-0000-0000-0000-0000000a70e4', 'Synthetic check')::text$q$);
  r := art.run_as('00000000-0000-0000-0000-00000000a701', $q$select public.attendance_save('00000000-0000-0000-0000-0000000a70e4',
        '[{"athlete_id":"00000000-0000-0000-0000-00000000a731","status":"late"}]'::jsonb,
        (select version from public.team_attendance_sheets where event_id = '00000000-0000-0000-0000-0000000a70e4'), '00000000-0000-0000-0000-00000000a7b3')::text$q$);
  perform art.ok(r like 'OK:%', 'admin saves a draft change after reopening (' || left(r, 160) || ')');
  r := art.run_as(v_g, $q$select public.guardian_attendance_overview('00000000-0000-0000-0000-00000000a731')::text$q$);
  v := substr(r, 4)::jsonb;
  perform art.ok(exists (select 1 from jsonb_array_elements(v->'history') x where x->>'event_id' = '00000000-0000-0000-0000-0000000a70e4' and x->>'status' = 'present')
                 and not exists (select 1 from jsonb_array_elements(v->'upcoming') x where x->>'event_id' = '00000000-0000-0000-0000-0000000a70e4'),
                 'reopened draft: family still sees the approved Present, session not duplicated in upcoming');
  r := art.run_as('00000000-0000-0000-0000-00000000a701', $q$select athlete_status || '/' || athlete_finalized_status
        from public.attendance_sessions_overview(current_date - 1, current_date + 1, null, '00000000-0000-0000-0000-00000000a731')
       where event_id = '00000000-0000-0000-0000-0000000a70e4'$q$);
  perform art.ok(r = 'OK:late/present', 'staff overview shows the draft value and the approved value separately (' || r || ')');
  r := art.run_as('00000000-0000-0000-0000-00000000a701', $q$select public.attendance_finalize('00000000-0000-0000-0000-0000000a70e4', null,
        (select version from public.team_attendance_sheets where event_id = '00000000-0000-0000-0000-0000000a70e4'), '00000000-0000-0000-0000-00000000a7b4')::text$q$);
  perform art.ok((select finalized_status = 'late' from public.team_attendance_marks where event_id = '00000000-0000-0000-0000-0000000a70e4'
                    and athlete_id = '00000000-0000-0000-0000-00000000a731'), 'refinalized: approved value is now Late');
  perform art.ok((select led_by_coach_id = '00000000-0000-0000-0000-00000000a752' from public.team_attendance_sheets where event_id = '00000000-0000-0000-0000-0000000a70e4'),
                 'refinalize by the admin keeps the lead recorded by the head coach');
end $$;

-- ===========================================================================
-- A. Finalized absence alerts
-- ===========================================================================
do $$
declare r text; v_ver int; v_active int; v_hist int;
  v_admin uuid := '00000000-0000-0000-0000-00000000a701';
  v_e3 uuid := '00000000-0000-0000-0000-0000000a70e3';
  v_a uuid := '00000000-0000-0000-0000-00000000a731';
begin
  r := art.finalize('00000000-0000-0000-0000-00000000a702', v_e3,
        '[{"athlete_id":"00000000-0000-0000-0000-00000000a731","status":"unexcused"},{"athlete_id":"00000000-0000-0000-0000-00000000a732","status":"present"}]', '00000000-0000-0000-0000-0000000a7c1');
  perform art.ok(r like 'OK:%"alerts_created": 2%', 'finalize unexcused: one alert per guardian (' || left(r, 120) || ')');

  -- Retry with the same request id, then a double click with a new request id.
  r := art.run_as('00000000-0000-0000-0000-00000000a702', format('select public.attendance_finalize(%L, null, 2, %L::uuid)::text', v_e3, '00000000-0000-0000-0000-0000000a7c12'));
  perform art.ok(r like 'OK:%"replayed": true%', 'retry replays the stored result (' || left(r, 80) || ')');
  r := art.run_as('00000000-0000-0000-0000-00000000a702', format('select public.attendance_finalize(%L, null, 2, %L::uuid)::text', v_e3, '00000000-0000-0000-0000-0000000a7c99'));
  perform art.ok(r like 'OK:%already_final": true%', 'double click: already final');
  perform art.ok((select count(*) = 2 from public.attendance_no_show_alerts where event_id = v_e3 and athlete_id = v_a), 'still 2 alerts after retry and double click');

  -- Reopen + finalize unchanged.
  r := art.run_as(v_admin, format('select public.attendance_reopen(%L, %L)::text', v_e3, 'Synthetic reopen'));
  select version into v_ver from public.team_attendance_sheets where event_id = v_e3;
  r := art.run_as(v_admin, format('select public.attendance_finalize(%L, null, %s, %L::uuid)::text', v_e3, v_ver, '00000000-0000-0000-0000-00000000a7c2'));
  perform art.ok(r like 'OK:%"ok": true%', 'reopen + finalize unchanged (' || left(r, 160) || ')');
  perform art.ok((select count(*) = 2 from public.attendance_no_show_alerts where event_id = v_e3 and athlete_id = v_a and status <> 'superseded'),
                 'reopen + finalize unchanged: no new alert');

  -- Delivered.
  update public.attendance_no_show_alerts set status = 'sent', sent_at = now() - interval '1 minute' where event_id = v_e3 and athlete_id = v_a;

  -- Correction to excused: one correction alert per guardian; correction retried with the same id: nothing new.
  r := art.run_as(v_admin, format('select public.attendance_correct(%L, %L, %L, %L, %L::uuid)::text', v_e3, v_a, 'excused', 'Synthetic doctor note', '00000000-0000-0000-0000-00000000a7c3'));
  perform art.ok(r like 'OK:%"changed": true%', 'correction unexcused -> excused (' || left(r, 160) || ')');
  r := art.run_as(v_admin, format('select public.attendance_correct(%L, %L, %L, %L, %L::uuid)::text', v_e3, v_a, 'excused', 'Synthetic doctor note', '00000000-0000-0000-0000-00000000a7c3'));
  perform art.ok(r like 'OK:%', 'correction retry (same request id)');
  perform art.ok((select count(*) = 2 from public.attendance_no_show_alerts where event_id = v_e3 and athlete_id = v_a and kind = 'correction' and mark_status = 'excused'),
                 'one correction alert per guardian after a retry');

  -- Back to unexcused before the correction was delivered: pending corrections superseded, new ones created.
  r := art.run_as(v_admin, format('select public.attendance_correct(%L, %L, %L, %L, %L::uuid)::text', v_e3, v_a, 'unexcused', 'Synthetic: note was for another day', '00000000-0000-0000-0000-00000000a7c4'));
  perform art.ok(r like 'OK:%"changed": true%', 'correction excused -> unexcused');
  -- The family was told "unexcused" and the excused correction was never sent: nothing new to send.
  select count(*) into v_active from public.attendance_no_show_alerts where event_id = v_e3 and athlete_id = v_a and status in ('pending', 'failed', 'no_contact');
  perform art.ok(v_active = 0, 'back to the delivered value: the unsent correction is cancelled, no duplicate alert (' || v_active || ' active)');
  perform art.ok((select count(*) = 2 from public.attendance_no_show_alerts where event_id = v_e3 and athlete_id = v_a and kind = 'correction' and status = 'superseded'),
                 'the cancelled corrections stay as history (superseded)');
end $$;

-- Next correction in its own transaction (as in the app).
do $$
declare r text; v_active int; v_hist int;
  v_admin uuid := '00000000-0000-0000-0000-00000000a701';
  v_e3 uuid := '00000000-0000-0000-0000-0000000a70e3';
  v_a uuid := '00000000-0000-0000-0000-00000000a731';
begin
  -- Correct again to excused: one new correction alert per guardian.
  r := art.run_as(v_admin, format('select public.attendance_correct(%L, %L, %L, %L, %L::uuid)::text', v_e3, v_a, 'excused', 'Synthetic doctor note again', '00000000-0000-0000-0000-00000000a7c5'));
  select count(*) into v_active from public.attendance_no_show_alerts where event_id = v_e3 and athlete_id = v_a and status = 'pending';
  perform art.ok(v_active = 2, 'new correction: one pending alert per guardian (' || v_active || ') ' || left(r, 200));
  select count(*) into v_hist from public.team_attendance_mark_history h join public.team_attendance_marks m on m.id = h.mark_id
   where m.event_id = v_e3 and m.athlete_id = v_a;
  perform art.ok(v_hist >= 3, 'history keeps the original value and both corrections (' || v_hist || ' rows)');
  perform art.ok((select count(*) = 1 from public.attendance_followups where event_id = v_e3 and athlete_id = v_a),
                 'one staff follow-up row for the absence across all corrections');

  -- Delivery failed for every alert (initial and corrections): staff follow-up lists one row per recipient.
  update public.attendance_no_show_alerts set status = 'failed', attempts = 99, last_error = 'synthetic' where event_id = v_e3 and athlete_id = v_a and status <> 'superseded';
  update public.attendance_no_show_alerts set status = 'failed', attempts = 99, sent_at = null where event_id = v_e3 and athlete_id = v_a and kind = 'initial';
  update public.attendance_no_show_alerts set status = 'failed', attempts = 99 where event_id = v_e3 and athlete_id = v_a and kind = 'correction' and mark_status = 'unexcused';
  r := art.run_as(v_admin, format('select count(*)::text from public.attendance_alerts_followup(100) where event_id = %L and athlete_id = %L', v_e3, v_a));
  perform art.ok(r = 'OK:2', 'alert follow-up: one row per absence and recipient (' || r || ')');
  r := art.run_as('b0000000-0000-0000-0000-00000000a791', format('select count(*)::text from public.attendance_alerts_followup(100) where event_id = %L', v_e3));
  perform art.ok(r = 'OK:0', 'other org admin sees no follow-up (' || r || ')');
  r := art.run_as('00000000-0000-0000-0000-00000000a711', format('select count(*)::text from public.attendance_alerts_followup(100) where event_id = %L', v_e3));
  perform art.ok(r = 'OK:0', 'guardian sees no staff follow-up (' || r || ')');
end $$;

do $$
declare n_fail int;
begin
  raise notice 'attendance_repair suite done';
end $$;
