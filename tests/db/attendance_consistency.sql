-- ============================================================================
-- Attendance consistency suite (migration 20250420105000_attendance_consistency.sql)
--
--   A. Coach roles: lead + assistant on one session, LEAD_EXISTS for a second
--      lead, role change (admin only), coverage rules (lead + assistant,
--      substitute only, none, booked session coach), led_by default at
--      finalize (session lead > booked coach > team head coach).
--   B. attendance_sessions_overview: counts = marks for team and booked
--      sessions in draft / final / reopened / corrected states, not started
--      sessions with the roster of their date (a player added today is not on
--      older practices), legacy programme sessions read-only, player filter.
--   C. Follow-ups: created at finalize (unexcused), one per (event, athlete),
--      resolved by a correction (reason kept), re-opened by a correction back
--      to unexcused (same row), no duplicates on a double finalize / reopen +
--      finalize.
--   D. Scope: coach sees only sessions they run; guardian / finance denied;
--      other org denied everywhere (RPCs and table RLS).
--   E. Reconciliation: led_by backfill (audited), follow-up backfill,
--      MULTIPLE_LEADS kept + flagged, ATTENDANCE_NO_LEAD; idempotent re-run.
--
-- Fixtures: synthetic only (ids …ac…). Org A …0001 (seed admin f1, finance
-- f2), org B …0002. Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema act;
grant usage on schema act to authenticated, anon, service_role;

create function act.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;
create function act.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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
grant execute on all functions in schema act to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- ac01 coach (head coach of team T1), ac02 coach (no team), ac03 coach (books
-- private sessions), ac11 guardian, ac91 org B admin.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000ac01', 'ac-coach1@example.test'),
  ('00000000-0000-0000-0000-00000000ac02', 'ac-coach2@example.test'),
  ('00000000-0000-0000-0000-00000000ac03', 'ac-coach3@example.test'),
  ('00000000-0000-0000-0000-00000000ac11', 'ac-guardian@example.test'),
  ('b0000000-0000-0000-0000-00000000ac91', 'ac-admin-b@example.test');
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001'
 where id in ('00000000-0000-0000-0000-00000000ac01', '00000000-0000-0000-0000-00000000ac02',
              '00000000-0000-0000-0000-00000000ac03', '00000000-0000-0000-0000-00000000ac11');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-00000000ac91';
insert into public.staff_roles (org_id, profile_id, role) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac01', 'coach'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac02', 'coach'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac03', 'coach'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000ac91', 'admin');
insert into public.coaches (id, org_id, display_name, profile_id) values
  ('00000000-0000-0000-0000-00000000ac51', '00000000-0000-0000-0000-000000000001', 'Synthetic Head', '00000000-0000-0000-0000-00000000ac01'),
  ('00000000-0000-0000-0000-00000000ac52', '00000000-0000-0000-0000-000000000001', 'Synthetic Lead', '00000000-0000-0000-0000-00000000ac02'),
  ('00000000-0000-0000-0000-00000000ac53', '00000000-0000-0000-0000-000000000001', 'Synthetic Private', '00000000-0000-0000-0000-00000000ac03');
insert into public.families (id, org_id, name) values
  ('00000000-0000-0000-0000-00000000ac21', '00000000-0000-0000-0000-000000000001', 'Synthetic AC Family');
insert into public.family_members (family_id, profile_id, relation, is_primary) values
  ('00000000-0000-0000-0000-00000000ac21', '00000000-0000-0000-0000-00000000ac11', 'guardian', true);
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, status) values
  ('00000000-0000-0000-0000-00000000ac31', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac21', 'Synth', 'Acone', '2012-01-01', 'active'),
  ('00000000-0000-0000-0000-00000000ac32', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac21', 'Synth', 'Actwo', '2012-02-01', 'active'),
  ('00000000-0000-0000-0000-00000000ac33', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac21', 'Synth', 'Acthree', '2012-03-01', 'active'),
  ('00000000-0000-0000-0000-00000000ac34', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac21', 'Synth', 'Acfour', '2012-04-01', 'active');
insert into public.teams (id, org_id, name, sport, age_group) values
  ('00000000-0000-0000-0000-00000000ac41', '00000000-0000-0000-0000-000000000001', 'AC U14 Synthetic', 'basketball', 'U14'),
  ('00000000-0000-0000-0000-00000000ac42', '00000000-0000-0000-0000-000000000001', 'AC U12 No Coach', 'basketball', 'U12');
insert into public.team_coaches (team_id, coach_id, org_id, role) values
  ('00000000-0000-0000-0000-00000000ac41', '00000000-0000-0000-0000-00000000ac51', '00000000-0000-0000-0000-000000000001', 'head');
-- ac31..ac33 joined 60 days ago; ac34 joins T1 on the club-local day of E8 (today's
-- session; stable around midnight UTC) and is not on older practices.
insert into public.team_memberships (org_id, team_id, athlete_id, jersey_number, status, joined_on)
select '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac41', a, n, 'active', d
  from (values ('00000000-0000-0000-0000-00000000ac31'::uuid, 11, current_date - 60), ('00000000-0000-0000-0000-00000000ac32'::uuid, 12, current_date - 60),
               ('00000000-0000-0000-0000-00000000ac33'::uuid, 13, current_date - 60), ('00000000-0000-0000-0000-00000000ac34'::uuid, 14, ((now() - interval '3 hours') at time zone public.ta_tz('00000000-0000-0000-0000-000000000001'))::date)) v(a, n, d);
insert into public.team_memberships (org_id, team_id, athlete_id, jersey_number, status, joined_on) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac42', '00000000-0000-0000-0000-00000000ac31', 7, 'active', current_date - 60);
-- Every session counts (no go-live date) for these assertions.
update public.app_settings set attendance_tracking_starts_on = null where org_id = '00000000-0000-0000-0000-000000000001';

-- E1 (2 days ago, T1), E2 (yesterday, T1, session lead + assistant), E5 (10
-- days ago, T1, never started), E6 (yesterday, T2, substitute only), E7
-- (yesterday, T2, nobody), E8 (3 hours ago, T1, draft), E9 (3 days ago, T1).
insert into public.events (id, org_id, team_id, type, title, starts_at, ends_at) values
  ('00000000-0000-0000-0000-0000000ac0e1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac41', 'training', 'AC E1', now() - interval '2 days 2 hours', now() - interval '2 days'),
  ('00000000-0000-0000-0000-0000000ac0e2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac41', 'training', 'AC E2', now() - interval '26 hours', now() - interval '24 hours'),
  ('00000000-0000-0000-0000-0000000ac0e5', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac41', 'training', 'AC E5', now() - interval '10 days 2 hours', now() - interval '10 days'),
  ('00000000-0000-0000-0000-0000000ac0e6', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac42', 'training', 'AC E6', now() - interval '28 hours', now() - interval '27 hours'),
  ('00000000-0000-0000-0000-0000000ac0e7', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac42', 'training', 'AC E7', now() - interval '30 hours', now() - interval '29 hours'),
  ('00000000-0000-0000-0000-0000000ac0e8', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac41', 'training', 'AC E8', now() - interval '3 hours', now() - interval '2 hours'),
  ('00000000-0000-0000-0000-0000000ac0e9', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac41', 'training', 'AC E9', now() - interval '3 days 2 hours', now() - interval '3 days');

-- Booked private session (team-less event) led by ac53, one booking (ac31).
insert into public.training_services (id, org_id, slug, name, duration_min, price_chf, kind, session_type, max_participants, currency) values
  ('00000000-0000-0000-0000-00000000ac61', '00000000-0000-0000-0000-000000000001', 'ac-pt', 'AC Personal Training', 60, 80, 'private', 'individual', 1, 'CHF');
insert into public.training_bookings (id, org_id, athlete_id, service_id, coach_id, slot_start, status) values
  ('00000000-0000-0000-0000-00000000ac71', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac31',
   '00000000-0000-0000-0000-00000000ac61', '00000000-0000-0000-0000-00000000ac53', date_trunc('hour', now()) - interval '20 hours', 'booked');

create table act.ids (k text primary key, v uuid);
grant all on act.ids to authenticated;
insert into act.ids
select 'eb', e.id from public.training_bookings b join public.training_sessions ts on ts.id = b.session_id join public.events e on e.training_session_id = ts.id
 where b.id = '00000000-0000-0000-0000-00000000ac71';
select act.ok((select v is not null from act.ids where k = 'eb'), 'fixture: the booking created a team-less session event');

-- Legacy programme session (read-only secondary source): 1 present, 1 absent.
insert into public.programs (id, org_id, slug, name, kind, price_chf, is_active) values
  ('00000000-0000-0000-0000-00000000ac81', '00000000-0000-0000-0000-000000000001', 'ac-legacy', 'AC Legacy Programme', 'camp', 0, true);
insert into public.attendance_sessions (id, org_id, program_id, coach_id, session_date, status) values
  ('00000000-0000-0000-0000-00000000ac82', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac81',
   '00000000-0000-0000-0000-00000000ac52', now() - interval '5 days', 'submitted');
insert into public.attendance_marks (org_id, attendance_session_id, athlete_id, status) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac82', '00000000-0000-0000-0000-00000000ac31', 'present'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac82', '00000000-0000-0000-0000-00000000ac32', 'absent');

-- ===========================================================================
-- A. Coach roles and coverage
-- ===========================================================================
do $$
declare r text; v_asg uuid;
begin
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.session_assign_coach('00000000-0000-0000-0000-0000000ac0e2', '00000000-0000-0000-0000-00000000ac52', 'lead')::text$q$);
  perform act.ok(r like 'OK:%approved%', 'admin assigns a lead coach to E2');
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.session_assign_coach('00000000-0000-0000-0000-0000000ac0e2', '00000000-0000-0000-0000-00000000ac53', 'assistant')::text$q$);
  perform act.ok(r like 'OK:%assistant%', 'admin assigns an assistant coach to the same session (lead + assistant coexist)');
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.session_assign_coach('00000000-0000-0000-0000-0000000ac0e2', '00000000-0000-0000-0000-00000000ac51', 'lead')::text$q$);
  perform act.ok(r like 'ERR:LEAD_EXISTS%', 'a second approved lead on one session is refused (LEAD_EXISTS) — ' || r);
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.session_assign_coach('00000000-0000-0000-0000-0000000ac0e2', '00000000-0000-0000-0000-00000000ac51', 'boss')::text$q$);
  perform act.ok(r like 'ERR:INVALID_ROLE%', 'unknown role refused');
  r := act.run_as('00000000-0000-0000-0000-00000000ac01', $q$select public.session_assign_coach('00000000-0000-0000-0000-0000000ac0e2', '00000000-0000-0000-0000-00000000ac51', 'assistant')::text$q$);
  perform act.ok(r like 'ERR:NOT_AUTHORIZED%', 'a coach cannot assign coaches');

  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.session_coverage(array['00000000-0000-0000-0000-0000000ac0e2'::uuid])::text$q$);
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select (c.coverage->>'coverage') || '|' || (c.coverage->>'led_by_name') || '|' || (c.coverage->>'led_by_source') || '|' ||
        (select string_agg((x->>'name') || ':' || (x->>'role'), ',' order by x->>'name') from jsonb_array_elements(c.coverage->'coaches') x)
        from public.session_coverage(array['00000000-0000-0000-0000-0000000ac0e2'::uuid]) c$q$);
  perform act.ok(r = 'OK:assigned|Synthetic Lead|session|Synthetic Head:lead,Synthetic Lead:lead,Synthetic Private:assistant',
                 'lead + assistant: "Led by" the session lead, assistant shown with its role, team head listed — ' || r);

  -- Substitute only (T2 has no team coach).
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.session_assign_coach('00000000-0000-0000-0000-0000000ac0e6', '00000000-0000-0000-0000-00000000ac52', 'substitute')::text$q$);
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select (c.coverage->>'coverage') || '|' || coalesce(c.coverage->>'led_by_name', '-')
        from public.session_coverage(array['00000000-0000-0000-0000-0000000ac0e6'::uuid]) c$q$);
  perform act.ok(r = 'OK:substitute|-', 'substitute only: "Substitute assigned", no lead named — ' || r);
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select (c.coverage->>'coverage') from public.session_coverage(array['00000000-0000-0000-0000-0000000ac0e7'::uuid]) c$q$);
  perform act.ok(r = 'OK:missing', 'no approved coach at all: "No coach assigned"');
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select (c.coverage->>'coverage') from public.session_coverage(array['00000000-0000-0000-0000-0000000ac0e1'::uuid]) c$q$);
  perform act.ok(r = 'OK:assigned', 'team head coach only: "Coach assigned" (not substitute)');
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', format($q$select (c.coverage->>'coverage') || '|' || (c.coverage->>'led_by_name') || '|' || (c.coverage->>'led_by_source')
        from public.session_coverage(array[%L::uuid]) c$q$, (select v from act.ids where k = 'eb')));
  perform act.ok(r = 'OK:assigned|Synthetic Private|booking', 'booked session without team coaches: led by the session coach, not "No coach" — ' || r);

  -- Role change (admin only, that session only).
  select id into v_asg from public.event_coach_assignments where event_id = '00000000-0000-0000-0000-0000000ac0e2' and coach_id = '00000000-0000-0000-0000-00000000ac53';
  r := act.run_as('00000000-0000-0000-0000-00000000ac01', format('select public.session_set_coach_role(%L, %L)::text', v_asg, 'substitute'));
  perform act.ok(r like 'ERR:NOT_AUTHORIZED%', 'a coach cannot change a session role');
  r := act.run_as('b0000000-0000-0000-0000-00000000ac91', format('select public.session_set_coach_role(%L, %L)::text', v_asg, 'substitute'));
  perform act.ok(r like 'ERR:ASSIGNMENT_NOT_FOUND%', 'other org admin: ASSIGNMENT_NOT_FOUND');
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', format('select public.session_set_coach_role(%L, %L)::text', v_asg, 'lead'));
  perform act.ok(r like 'ERR:LEAD_EXISTS%', 'role change to lead refused while another lead is approved');
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', format('select public.session_set_coach_role(%L, %L)::text', v_asg, 'substitute'));
  perform act.ok(r like 'OK:%"changed": true%', 'admin changes assistant -> substitute');
  perform act.ok(exists (select 1 from public.audit_logs where action = 'attendance.coach_role' and target_id = v_asg), 'role change audited');
  perform act.ok((select (public.ac_coverage('00000000-0000-0000-0000-0000000ac0e2')->>'coverage') = 'substitute'), 'with an approved substitute the session shows "Substitute assigned"');
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', format('select public.session_set_coach_role(%L, %L)::text', v_asg, 'assistant'));
  perform act.ok(r like 'OK:%', 'back to assistant');
  perform act.ok(not exists (select 1 from public.event_coach_assignments where event_id = '00000000-0000-0000-0000-0000000ac0e1'),
                 'role changes touch that session only (E1 has no assignment)');
end $$;

-- ===========================================================================
-- Sheets: E1 finalize (no led_by), E2 finalize (no led_by), booking finalize,
-- E8 draft, E7 finalize (nobody to lead), E9 finalize.
-- ===========================================================================
create function act.finalize(p_actor uuid, p_event uuid, p_marks jsonb, p_req text) returns text language plpgsql as $$
declare r text;
begin
  r := act.run_as(p_actor, format('select public.attendance_open(%L)::text', p_event));
  if r not like 'OK:%' then return 'open ' || r; end if;
  r := act.run_as(p_actor, format('select public.attendance_save(%L, %L::jsonb, (select version from public.team_attendance_sheets where event_id = %L), %L::uuid)::text',
                                  p_event, p_marks, p_event, p_req || '1'));
  if r not like 'OK:%' then return 'save ' || r; end if;
  return act.run_as(p_actor, format('select public.attendance_finalize(%L, null, (select version from public.team_attendance_sheets where event_id = %L), %L::uuid)::text',
                                    p_event, p_event, p_req || '2'));
end $$;
grant execute on function act.finalize(uuid, uuid, jsonb, text) to authenticated;

do $$
declare r text; v_eb uuid := (select v from act.ids where k = 'eb');
begin
  r := act.finalize('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000ac0e1',
        '[{"athlete_id":"00000000-0000-0000-0000-00000000ac31","status":"present"},
          {"athlete_id":"00000000-0000-0000-0000-00000000ac32","status":"unexcused"},
          {"athlete_id":"00000000-0000-0000-0000-00000000ac33","status":"late"}]', '00000000-0000-0000-0000-0000000ac10');
  perform act.ok(r like 'OK:%"ok": true%', 'admin finalizes E1 without led_by — ' || left(r, 100));
  perform act.ok((select led_by_coach_id = '00000000-0000-0000-0000-00000000ac51' from public.team_attendance_sheets where event_id = '00000000-0000-0000-0000-0000000ac0e1'),
                 'led_by defaults to the team head coach');
  r := act.finalize('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000ac0e2',
        '[{"athlete_id":"00000000-0000-0000-0000-00000000ac31","status":"present"},
          {"athlete_id":"00000000-0000-0000-0000-00000000ac32","status":"present"},
          {"athlete_id":"00000000-0000-0000-0000-00000000ac33","status":"excused"}]', '00000000-0000-0000-0000-0000000ac20');
  perform act.ok(r like 'OK:%"ok": true%', 'admin finalizes E2 without led_by');
  perform act.ok((select led_by_coach_id = '00000000-0000-0000-0000-00000000ac52' from public.team_attendance_sheets where event_id = '00000000-0000-0000-0000-0000000ac0e2'),
                 'led_by defaults to the approved session lead (before the team head coach)');
  r := act.finalize('00000000-0000-0000-0000-0000000000f1', v_eb, '[{"athlete_id":"00000000-0000-0000-0000-00000000ac31","status":"present"}]',
                    '00000000-0000-0000-0000-0000000ac30');
  perform act.ok(r like 'OK:%"ok": true%', 'admin finalizes the booked session without led_by — ' || left(r, 100));
  perform act.ok((select led_by_coach_id = '00000000-0000-0000-0000-00000000ac53' from public.team_attendance_sheets where event_id = v_eb),
                 'booked session: led_by defaults to training_sessions.coach_id');
  r := act.finalize('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000ac0e7',
        '[{"athlete_id":"00000000-0000-0000-0000-00000000ac31","status":"unexcused"}]', '00000000-0000-0000-0000-0000000ac40');
  perform act.ok(r like 'OK:%"ok": true%', 'admin finalizes E7 (no coach at all)');
  perform act.ok((select led_by_coach_id is null from public.team_attendance_sheets where event_id = '00000000-0000-0000-0000-0000000ac0e7'),
                 'no effective lead: led_by stays empty');
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.attendance_open('00000000-0000-0000-0000-0000000ac0e8')::text$q$);
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.attendance_save('00000000-0000-0000-0000-0000000ac0e8',
        '[{"athlete_id":"00000000-0000-0000-0000-00000000ac31","status":"present"},{"athlete_id":"00000000-0000-0000-0000-00000000ac32","status":"unexcused"}]'::jsonb,
        1, '00000000-0000-0000-0000-0000000ac501')::text$q$);
  perform act.ok(r like 'OK:%', 'E8 stays a draft with two saved marks');
  r := act.finalize('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000ac0e9',
        '[{"athlete_id":"00000000-0000-0000-0000-00000000ac31","status":"present"},
          {"athlete_id":"00000000-0000-0000-0000-00000000ac32","status":"present"},
          {"athlete_id":"00000000-0000-0000-0000-00000000ac33","status":"unexcused"}]', '00000000-0000-0000-0000-0000000ac60');
  perform act.ok(r like 'OK:%"ok": true%', 'admin finalizes E9');
end $$;


-- ===========================================================================
-- B. Overview counts (one read for the tab, the dashboard, player history)
-- ===========================================================================
do $$
declare r text; v_eb uuid := (select v from act.ids where k = 'eb');
begin
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select workflow_status || ':' || present || '/' || late || '/' || excused || '/' || unexcused || '/' || unmarked || '/' || total
        || ':' || (coverage->>'led_by_name') || ':' || open_followups
        from public.attendance_sessions_overview(current_date - 30, current_date + 1) where event_id = '00000000-0000-0000-0000-0000000ac0e1'$q$);
  perform act.ok(r = 'OK:final:1/1/0/1/0/3:Synthetic Head:1', 'E1 final: counts = marks, led by the head coach, one open follow-up — ' || r);
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select bool_and(
          o.present = (select count(*) from public.team_attendance_marks m where m.event_id = o.event_id and m.status = 'present')
      and o.late = (select count(*) from public.team_attendance_marks m where m.event_id = o.event_id and m.status = 'late')
      and o.excused = (select count(*) from public.team_attendance_marks m where m.event_id = o.event_id and m.status = 'excused')
      and o.unexcused = (select count(*) from public.team_attendance_marks m where m.event_id = o.event_id and m.status = 'unexcused')
      and o.unmarked = (select count(*) from public.team_attendance_marks m where m.event_id = o.event_id and m.status = 'unmarked'))::text || ':' || count(*)
        from public.attendance_sessions_overview(current_date - 30, current_date + 1) o
       where o.event_id is not null and o.workflow_status not in ('not_started', 'cancelled')$q$);
  perform act.ok(r = 'OK:true:6', 'every started team / booked session: overview counts = saved marks (6 sessions) — ' || r);
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', format($q$select source || ':' || workflow_status || ':' || present || '/' || total || ':' || group_name || ':' || (coverage->>'led_by_name')
        from public.attendance_sessions_overview(current_date - 30, current_date + 1) where event_id = %L$q$, v_eb));
  perform act.ok(r = 'OK:booking:final:1/1:AC Personal Training:Synthetic Private', 'booked session listed with the service name and its coach — ' || r);
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select workflow_status || ':' || present || '/' || unexcused || '/' || unmarked || '/' || total
        from public.attendance_sessions_overview(current_date - 30, current_date + 1) where event_id = '00000000-0000-0000-0000-0000000ac0e8'$q$);
  perform act.ok(r = 'OK:draft:1/1/2/4', 'draft E8: saved statuses shown while the sheet is a draft (player status separate from workflow) — ' || r);
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select workflow_status || ':' || unmarked || '/' || total
        from public.attendance_sessions_overview(current_date - 30, current_date + 1) where event_id = '00000000-0000-0000-0000-0000000ac0e5'$q$);
  perform act.ok(r = 'OK:not_started:3/3', 'E5 not started: roster of its date (3), the player added today is not on it — ' || r);
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text
        from public.attendance_sessions_roster(array['00000000-0000-0000-0000-0000000ac0e5'::uuid]) where athlete_id = '00000000-0000-0000-0000-00000000ac34'$q$);
  perform act.ok(r = 'OK:0', 'roster expansion of an old session excludes a player who joined today');
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select string_agg(last_name || '=' || status || coalesce('/' || followup_status, ''), ',' order by last_name)
        from public.attendance_sessions_roster(array['00000000-0000-0000-0000-0000000ac0e1'::uuid])$q$);
  perform act.ok(r = 'OK:Acone=present,Acthree=late,Actwo=unexcused/open', 'roster expansion: current status per player + follow-up state — ' || r);
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text
        from public.attendance_sessions_overview(current_date - 30, current_date + 1, null, '00000000-0000-0000-0000-00000000ac34')$q$);
  perform act.ok(r = 'OK:1', 'player filter: the new player is only on today''s draft E8, not on older practices — ' || r);
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select source || ':' || workflow_status || ':' || present || '/' || unexcused || '/' || total || ':' || group_name
        from public.attendance_sessions_overview(current_date - 30, current_date + 1) where source = 'program'$q$);
  perform act.ok(r = 'OK:program:final:1/1/2:AC Legacy Programme', 'legacy programme session listed read-only (absent -> unexcused) — ' || r);
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text
        from public.attendance_sessions_overview(current_date - 30, current_date + 1, null, null, 'bookings')$q$);
  perform act.ok(r = 'OK:1', 'scope bookings: only the booked session');
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text
        from public.attendance_sessions_overview(current_date - 30, current_date + 1, '00000000-0000-0000-0000-00000000ac42')$q$);
  perform act.ok(r = 'OK:2', 'team filter: the two T2 sessions');
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.attendance_sessions_overview(current_date, current_date - 3)$q$);
  perform act.ok(r like 'ERR:INVALID_RANGE%', 'reversed range refused');
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.attendance_sessions_overview(null, null, null, null, 'nope')$q$);
  perform act.ok(r like 'ERR:INVALID_SCOPE%', 'unknown scope refused');
end $$;

-- ===========================================================================
-- C. Follow-ups lifecycle
-- ===========================================================================
do $$
declare r text; v_id uuid; v_n int;
begin
  select id into v_id from public.attendance_followups where event_id = '00000000-0000-0000-0000-0000000ac0e1' and athlete_id = '00000000-0000-0000-0000-00000000ac32';
  perform act.ok(v_id is not null and (select status = 'open' and source = 'finalize' and opened_by = '00000000-0000-0000-0000-0000000000f1'
                                         from public.attendance_followups where id = v_id), 'finalize opened a follow-up for the unexcused mark');
  perform act.ok((select count(*) = 0 from public.attendance_followups where event_id = '00000000-0000-0000-0000-0000000ac0e8'),
                 'a draft unexcused mark opens nothing');
  perform act.ok((select count(*) = 1 from public.attendance_followups where event_id = '00000000-0000-0000-0000-0000000ac0e7'),
                 'E7 unexcused: one follow-up');

  -- Double finalize: no-op, no duplicate.
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.attendance_finalize('00000000-0000-0000-0000-0000000ac0e1', null,
        (select version from public.team_attendance_sheets where event_id = '00000000-0000-0000-0000-0000000ac0e1'), '00000000-0000-0000-0000-0000000ac711')::text$q$);
  perform act.ok(r like 'OK:%already_final": true%', 'second finalize is a no-op');
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.attendance_finalize('00000000-0000-0000-0000-0000000ac0e1', null, 1, '00000000-0000-0000-0000-0000000ac102')::text$q$);
  perform act.ok(r like 'OK:%replayed": true%', 'retry with the same request id replays the stored result');
  perform act.ok((select count(*) = 1 from public.attendance_followups where event_id = '00000000-0000-0000-0000-0000000ac0e1'),
                 'still one follow-up after double finalize / retry');

  -- Correction to excused resolves it (reason kept).
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.attendance_correct('00000000-0000-0000-0000-0000000ac0e1', '00000000-0000-0000-0000-00000000ac32',
        'excused', 'Synthetic note from family', '00000000-0000-0000-0000-0000000ac720')::text$q$);
  perform act.ok(r like 'OK:%"changed": true%', 'admin corrects unexcused -> excused');
  perform act.ok((select status = 'resolved' and resolution_status = 'excused' and resolved_by = '00000000-0000-0000-0000-0000000000f1'
                    and resolution_reason = 'Synthetic note from family' and resolved_at is not null from public.attendance_followups where id = v_id),
                 'correction resolves the follow-up (resolved_at, resolved_by, reason kept)');
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select open_followups::text || '/' || excused || '/' || unexcused
        from public.attendance_sessions_overview(current_date - 30, current_date + 1) where event_id = '00000000-0000-0000-0000-0000000ac0e1'$q$);
  perform act.ok(r = 'OK:0/1/0', 'overview follows the correction (0 open follow-ups, 1 excused) — ' || r);

  -- Back to unexcused: the same row re-opens.
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.attendance_correct('00000000-0000-0000-0000-0000000ac0e1', '00000000-0000-0000-0000-00000000ac32',
        'unexcused', 'Synthetic: note was for another day', '00000000-0000-0000-0000-0000000ac721')::text$q$);
  perform act.ok((select id = v_id and status = 'open' and reopen_count = 1 and resolved_at is null and jsonb_array_length(history) = 3
                    from public.attendance_followups where event_id = '00000000-0000-0000-0000-0000000ac0e1' and athlete_id = '00000000-0000-0000-0000-00000000ac32'),
                 're-opening to unexcused re-opens the same row (history opened / resolved / reopened)');

  -- Reopen + finalize again (unchanged): no duplicate, row stays open.
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.attendance_reopen('00000000-0000-0000-0000-0000000ac0e1', 'Synthetic check')::text$q$);
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select workflow_status from public.attendance_sessions_overview(current_date - 30, current_date + 1)
        where event_id = '00000000-0000-0000-0000-0000000ac0e1'$q$);
  perform act.ok(r = 'OK:reopened', 'overview shows the reopened workflow status');
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.attendance_finalize('00000000-0000-0000-0000-0000000ac0e1', null,
        (select version from public.team_attendance_sheets where event_id = '00000000-0000-0000-0000-0000000ac0e1'), '00000000-0000-0000-0000-0000000ac730')::text$q$);
  perform act.ok(r like 'OK:%"ok": true%', 'finalize after reopen');
  select count(*) into v_n from public.attendance_followups where event_id = '00000000-0000-0000-0000-0000000ac0e1';
  perform act.ok(v_n = 1 and (select status = 'open' and reopen_count = 1 from public.attendance_followups where id = v_id),
                 'reopen + finalize: still one row, unchanged');

  -- Cancelling a session resolves its open follow-ups (kept).
  update public.events set status = 'cancelled', cancel_reason = 'Synthetic' where id = '00000000-0000-0000-0000-0000000ac0e7';
  perform act.ok((select status = 'resolved' and resolution_status = 'cancelled' from public.attendance_followups where event_id = '00000000-0000-0000-0000-0000000ac0e7'),
                 'cancelled session: follow-up resolved, row kept');
  update public.events set status = 'scheduled', cancel_reason = null where id = '00000000-0000-0000-0000-0000000ac0e7';

  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select string_agg(last_name || ':' || status, ',' order by last_name) from public.attendance_followups_list('open')$q$);
  perform act.ok(r = 'OK:Acthree:open,Actwo:open', 'admin follow-up list: open rows of the club — ' || r);
end $$;

-- ===========================================================================
-- D. Scope and denials
-- ===========================================================================
do $$
declare r text; v_eb uuid := (select v from act.ids where k = 'eb');
begin
  -- Coach of T1 (head): T1 sessions only, no booked session, no T2, no legacy.
  r := act.run_as('00000000-0000-0000-0000-00000000ac01', $q$select string_agg(distinct coalesce(source, '?'), ',') || ':' || count(*)
        from public.attendance_sessions_overview(current_date - 30, current_date + 1)$q$);
  perform act.ok(r = 'OK:team:5', 'T1 head coach sees only the 5 T1 sessions — ' || r);
  r := act.run_as('00000000-0000-0000-0000-00000000ac03', $q$select string_agg(source, ',' order by source) from public.attendance_sessions_overview(current_date - 30, current_date + 1)$q$);
  perform act.ok(r = 'OK:booking,team', 'booked-session coach sees their booked session and E2 (approved assistant) — ' || r);
  r := act.run_as('00000000-0000-0000-0000-00000000ac02', $q$select string_agg(source, ',' order by source) from public.attendance_sessions_overview(current_date - 30, current_date + 1)$q$);
  perform act.ok(r = 'OK:program,team,team', 'coach ac02: own legacy session + E2 (lead) + E6 (substitute) — ' || r);
  r := act.run_as('00000000-0000-0000-0000-00000000ac03', $q$select count(*)::text from public.attendance_followups_list(null)$q$);
  perform act.ok(r = 'OK:0', 'booked-session coach sees no follow-ups of other sessions');
  r := act.run_as('00000000-0000-0000-0000-00000000ac01', $q$select count(*)::text from public.attendance_followups_list('open')$q$);
  perform act.ok(r = 'OK:2', 'T1 coach sees the open follow-ups of T1 sessions');
  r := act.run_as('00000000-0000-0000-0000-00000000ac01', $q$select count(*)::text from public.attendance_followups$q$);
  perform act.ok(r = 'OK:2', 'table RLS: T1 coach reads the 2 follow-ups of T1 sessions only — ' || r);
  r := act.run_as('00000000-0000-0000-0000-00000000ac01', $q$select count(*)::text from public.attendance_sessions_roster(array['00000000-0000-0000-0000-0000000ac0e7'::uuid])$q$);
  perform act.ok(r = 'OK:0', 'coach cannot expand the roster of another team''s session');
  r := act.run_as('00000000-0000-0000-0000-00000000ac01', $q$select count(*)::text from public.session_coverage(array['00000000-0000-0000-0000-0000000ac0e7'::uuid])$q$);
  perform act.ok(r = 'OK:0', 'coach gets no coverage for a session they cannot run');

  -- Guardian and finance: denied.
  r := act.run_as('00000000-0000-0000-0000-00000000ac11', $q$select count(*)::text from public.attendance_sessions_overview()$q$);
  perform act.ok(r like 'ERR:NOT_AUTHORIZED%', 'guardian cannot read the overview');
  r := act.run_as('00000000-0000-0000-0000-00000000ac11', $q$select count(*)::text from public.attendance_followups_list()$q$);
  perform act.ok(r like 'ERR:NOT_AUTHORIZED%', 'guardian cannot list follow-ups');
  r := act.run_as('00000000-0000-0000-0000-00000000ac11', $q$select count(*)::text from public.attendance_sessions_roster(array['00000000-0000-0000-0000-0000000ac0e1'::uuid])$q$);
  perform act.ok(r like 'ERR:NOT_AUTHORIZED%', 'guardian cannot expand a roster');
  r := act.run_as('00000000-0000-0000-0000-00000000ac11', $q$select count(*)::text from public.attendance_followups$q$);
  perform act.ok(r = 'OK:0', 'guardian reads no follow-up rows (own child included)');
  r := act.run_as('00000000-0000-0000-0000-0000000000f2', $q$select count(*)::text from public.attendance_sessions_overview()$q$);
  perform act.ok(r like 'ERR:NOT_AUTHORIZED%', 'finance cannot read attendance');
  r := act.run_as('00000000-0000-0000-0000-0000000000f2', $q$select count(*)::text from public.attendance_followups$q$);
  perform act.ok(r = 'OK:0', 'finance reads no follow-up rows');
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$insert into public.attendance_followups (org_id, event_id, athlete_id, mark_status)
        values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ac0e5', '00000000-0000-0000-0000-00000000ac31', 'unexcused') returning id::text$q$);
  perform act.ok(r like 'ERR:%', 'no direct insert, even for an admin');
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$with d as (delete from public.attendance_followups returning 1) select count(*)::text from d$q$);
  perform act.ok(r like 'ERR:%' or r = 'OK:0', 'no direct delete (rows kept)');
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.ac_reconcile('00000000-0000-0000-0000-000000000001')::text$q$);
  perform act.ok(r like 'ERR:%permission denied%', 'internal reconcile helper is not callable through the API');

  -- Other org.
  r := act.run_as('b0000000-0000-0000-0000-00000000ac91', $q$select count(*)::text from public.attendance_sessions_overview()$q$);
  perform act.ok(r = 'OK:0', 'other org admin: no sessions of org A');
  r := act.run_as('b0000000-0000-0000-0000-00000000ac91', $q$select count(*)::text from public.attendance_sessions_overview(null, null, '00000000-0000-0000-0000-00000000ac41')$q$);
  perform act.ok(r like 'ERR:TEAM_NOT_FOUND%', 'other org admin: TEAM_NOT_FOUND');
  r := act.run_as('b0000000-0000-0000-0000-00000000ac91', $q$select count(*)::text from public.attendance_sessions_overview(null, null, null, '00000000-0000-0000-0000-00000000ac31')$q$);
  perform act.ok(r like 'ERR:ATHLETE_NOT_FOUND%', 'other org admin: ATHLETE_NOT_FOUND');
  r := act.run_as('b0000000-0000-0000-0000-00000000ac91', $q$select count(*)::text from public.attendance_followups_list(null)$q$);
  perform act.ok(r = 'OK:0', 'other org admin: no follow-ups');
  r := act.run_as('b0000000-0000-0000-0000-00000000ac91', $q$select count(*)::text from public.attendance_followups$q$);
  perform act.ok(r = 'OK:0', 'other org admin: table RLS denies follow-up rows');
  r := act.run_as('b0000000-0000-0000-0000-00000000ac91', $q$select count(*)::text from public.attendance_sessions_roster(array['00000000-0000-0000-0000-0000000ac0e1'::uuid, '00000000-0000-0000-0000-00000000ac82'::uuid])$q$);
  perform act.ok(r = 'OK:0', 'other org admin: no roster rows');
  r := act.run_as('b0000000-0000-0000-0000-00000000ac91', $q$select count(*)::text from public.session_coverage(array['00000000-0000-0000-0000-0000000ac0e1'::uuid])$q$);
  perform act.ok(r = 'OK:0', 'other org admin: no coverage');
  r := act.run_as('b0000000-0000-0000-0000-00000000ac91', $q$select public.attendance_consistency_reconcile('00000000-0000-0000-0000-000000000001')::text$q$);
  perform act.ok(r like 'ERR:NOT_AUTHORIZED%', 'other org admin cannot reconcile org A');
  r := act.run_as(null, $q$select count(*)::text from public.attendance_sessions_overview()$q$);
  perform act.ok(r like 'ERR:%', 'signed-out caller denied');
end $$;

-- ===========================================================================
-- E. Reconciliation (legacy data shapes) and idempotency
-- ===========================================================================
do $$
declare r text; v_flags int; v_fu int; v_audit int;
begin
  -- Existing data before this release: E9 final without led_by, its follow-up
  -- missing, and two approved leads on E2 (as on staging).
  update public.team_attendance_sheets set led_by_coach_id = null where event_id = '00000000-0000-0000-0000-0000000ac0e9';
  delete from public.attendance_followups where event_id = '00000000-0000-0000-0000-0000000ac0e9';
  alter table public.event_coach_assignments disable trigger trg_ac_one_lead_guard;
  update public.event_coach_assignments set role = 'lead'
   where event_id = '00000000-0000-0000-0000-0000000ac0e2' and coach_id = '00000000-0000-0000-0000-00000000ac53';
  alter table public.event_coach_assignments enable trigger trg_ac_one_lead_guard;

  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.attendance_consistency_reconcile('00000000-0000-0000-0000-000000000001')::text$q$);
  perform act.ok(r like 'OK:%"led_by_backfilled": 1%' and r like '%"followups_created": 1%' and r like '%"multiple_leads_flagged": 1%',
                 'admin reconcile: 1 led_by backfilled, 1 follow-up created, 1 MULTIPLE_LEADS flagged — ' || r);
  perform act.ok((select led_by_coach_id = '00000000-0000-0000-0000-00000000ac51' from public.team_attendance_sheets where event_id = '00000000-0000-0000-0000-0000000ac0e9'),
                 'backfill: led_by = effective lead (team head coach)');
  perform act.ok(exists (select 1 from public.audit_logs where action = 'attendance.led_by_backfill'
                           and target_id = (select id from public.team_attendance_sheets where event_id = '00000000-0000-0000-0000-0000000ac0e9')),
                 'backfill is audited');
  perform act.ok((select source = 'backfill' and status = 'open' from public.attendance_followups where event_id = '00000000-0000-0000-0000-0000000ac0e9'),
                 'follow-up backfilled for the existing finalized unexcused mark');
  perform act.ok((select count(*) = 2 from public.event_coach_assignments where event_id = '00000000-0000-0000-0000-0000000ac0e2' and role = 'lead' and status = 'approved'),
                 'MULTIPLE_LEADS: both leads kept (no deletion)');
  perform act.ok(exists (select 1 from public.data_review_flags where reason_code = 'MULTIPLE_LEADS' and entity_id = '00000000-0000-0000-0000-0000000ac0e2' and resolved_at is null),
                 'MULTIPLE_LEADS flag open for E2');
  perform act.ok((select (public.ac_coverage('00000000-0000-0000-0000-0000000ac0e2')->>'multiple_leads')::boolean), 'coverage reports multiple leads');
  perform act.ok(exists (select 1 from public.data_review_flags where reason_code = 'ATTENDANCE_NO_LEAD'
                           and entity_id = (select id from public.team_attendance_sheets where event_id = '00000000-0000-0000-0000-0000000ac0e7') and resolved_at is null),
                 'final sheet without any possible lead is flagged ATTENDANCE_NO_LEAD');
  perform act.ok((select count(*) = 3 from public.team_attendance_marks where event_id = '00000000-0000-0000-0000-0000000ac0e1')
                 and (select count(*) >= 3 from public.team_attendance_mark_history where event_id = '00000000-0000-0000-0000-0000000ac0e1'),
                 'marks and history untouched by the reconcile');

  -- Second run: nothing new.
  select count(*) into v_flags from public.data_review_flags where org_id = '00000000-0000-0000-0000-000000000001';
  select count(*) into v_fu from public.attendance_followups;
  select count(*) into v_audit from public.audit_logs where action = 'attendance.led_by_backfill';
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.attendance_consistency_reconcile('00000000-0000-0000-0000-000000000001')::text$q$);
  perform act.ok(r like 'OK:%"led_by_backfilled": 0%' and r like '%"followups_created": 0%' and r like '%"multiple_leads_flagged": 0%',
                 'second reconcile changes nothing — ' || r);
  perform act.ok((select count(*) from public.data_review_flags where org_id = '00000000-0000-0000-0000-000000000001') = v_flags
                 and (select count(*) from public.attendance_followups) = v_fu
                 and (select count(*) from public.audit_logs where action = 'attendance.led_by_backfill') = v_audit,
                 'idempotent: no new flags, follow-ups or audit rows');

  -- Fixing the data resolves the flag.
  update public.event_coach_assignments set role = 'assistant'
   where event_id = '00000000-0000-0000-0000-0000000ac0e2' and coach_id = '00000000-0000-0000-0000-00000000ac53';
  r := act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.attendance_consistency_reconcile('00000000-0000-0000-0000-000000000001')::text$q$);
  perform act.ok(not exists (select 1 from public.data_review_flags where reason_code = 'MULTIPLE_LEADS' and entity_id = '00000000-0000-0000-0000-0000000ac0e2' and resolved_at is null),
                 'MULTIPLE_LEADS resolves itself once one lead remains');
  r := act.run_as('00000000-0000-0000-0000-00000000ac01', $q$select public.attendance_consistency_reconcile('00000000-0000-0000-0000-000000000001')::text$q$);
  perform act.ok(r like 'ERR:NOT_AUTHORIZED%', 'a coach cannot run the reconcile');
end $$;

-- Idempotent re-run of the migration (runs the reconcile again).
create temp table act_before as
  select (select count(*) from public.attendance_followups) as fu,
         (select count(*) from public.data_review_flags) as fl,
         (select count(*) from public.event_coach_assignments) as asg,
         (select count(*) from public.team_attendance_marks) as mk;
\set QUIET on
\i supabase/migrations/20250420105000_attendance_consistency.sql
\set QUIET off
select act.ok((select fu = (select count(*) from public.attendance_followups) and fl = (select count(*) from public.data_review_flags)
                 and asg = (select count(*) from public.event_coach_assignments) and mk = (select count(*) from public.team_attendance_marks) from act_before),
              'migration re-run is idempotent (no new follow-ups, flags, assignments or marks)');
select act.ok(exists (select 1 from pg_constraint where conname = 'event_coach_assignments_role_chk' and pg_get_constraintdef(oid) like '%assistant%'),
              'role check constraint accepts assistant after re-run');
select act.ok(act.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.attendance_sessions_overview(current_date - 30, current_date + 1)$q$) = 'OK:9',
              'overview still answers after re-run (9 sessions)');
