-- ============================================================================
-- Admin attendance UI suite (migration 20250420104200_admin_attendance_ui.sql)
--
--   A. admin_session_attendance: admin reads per-session counts (final values
--      for finalized sheets, draft values otherwise), player filter, date
--      range, cancelled sessions kept with their reason; coach / finance /
--      guardian denied; other org denied (TEAM_NOT_FOUND / ATHLETE_NOT_FOUND /
--      empty).
--   B. attendance_alert_retry: admin re-queues a failed alert (pending,
--      attempts 0, audited); sent alerts and alerts without a guardian are
--      refused; coach / finance denied; other org admin gets ALERT_NOT_FOUND.
--   Idempotent migration re-run.
--
-- Fixtures: synthetic only (ids …ad…). Org A …0001 (seed admin f1, finance
-- f2), org B …0002. Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema adt;
grant usage on schema adt to authenticated, anon, service_role;

create function adt.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;
create function adt.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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
grant execute on all functions in schema adt to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000ad01', 'ad-coach@example.test'),
  ('00000000-0000-0000-0000-00000000ad11', 'ad-guardian@example.test'),
  ('b0000000-0000-0000-0000-00000000ad91', 'ad-admin-b@example.test');
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001'
 where id in ('00000000-0000-0000-0000-00000000ad01', '00000000-0000-0000-0000-00000000ad11');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-00000000ad91';
insert into public.staff_roles (org_id, profile_id, role) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ad01', 'coach'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000ad91', 'admin');
insert into public.coaches (id, org_id, display_name, profile_id) values
  ('00000000-0000-0000-0000-00000000ad51', '00000000-0000-0000-0000-000000000001', 'Synthetic AD Coach', '00000000-0000-0000-0000-00000000ad01');
insert into public.families (id, org_id, name) values
  ('00000000-0000-0000-0000-00000000ad21', '00000000-0000-0000-0000-000000000001', 'Synthetic AD Family'),
  ('00000000-0000-0000-0000-00000000ad22', '00000000-0000-0000-0000-000000000001', 'Synthetic AD No Guardian');
insert into public.family_members (family_id, profile_id, relation, is_primary) values
  ('00000000-0000-0000-0000-00000000ad21', '00000000-0000-0000-0000-00000000ad11', 'guardian', true);
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, status) values
  ('00000000-0000-0000-0000-00000000ad31', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ad21', 'Synth', 'Adone', '2012-01-01', 'active'),
  ('00000000-0000-0000-0000-00000000ad32', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ad21', 'Synth', 'Adtwo', '2012-02-01', 'active'),
  ('00000000-0000-0000-0000-00000000ad33', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ad22', 'Synth', 'Adthree', '2012-03-01', 'active');
insert into public.teams (id, org_id, name, sport, age_group) values
  ('00000000-0000-0000-0000-00000000ad41', '00000000-0000-0000-0000-000000000001', 'AD U14 Synthetic', 'basketball', 'U14'),
  ('b0000000-0000-0000-0000-00000000ad94', '10000000-0000-0000-0000-000000000002', 'AD B Team', 'basketball', null);
insert into public.team_coaches (team_id, coach_id, org_id, role) values
  ('00000000-0000-0000-0000-00000000ad41', '00000000-0000-0000-0000-00000000ad51', '00000000-0000-0000-0000-000000000001', 'head');
insert into public.team_memberships (org_id, team_id, athlete_id, jersey_number, status, joined_on)
select '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ad41', a, n, 'active', current_date - 60
  from (values ('00000000-0000-0000-0000-00000000ad31'::uuid, 11), ('00000000-0000-0000-0000-00000000ad32'::uuid, 12),
               ('00000000-0000-0000-0000-00000000ad33'::uuid, 13)) v(a, n);
-- E1 ended 2 days ago (finalized), E2 ended yesterday (draft), E3 cancelled
-- (with a reason), E4 next week (no sheet).
insert into public.events (id, org_id, team_id, type, title, starts_at, ends_at) values
  ('00000000-0000-0000-0000-0000000ad0e1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ad41', 'training', 'AD E1', now() - interval '2 days 2 hours', now() - interval '2 days'),
  ('00000000-0000-0000-0000-0000000ad0e2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ad41', 'training', 'AD E2', now() - interval '26 hours', now() - interval '24 hours'),
  ('00000000-0000-0000-0000-0000000ad0e3', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ad41', 'training', 'AD E3', now() - interval '4 days 2 hours', now() - interval '4 days'),
  ('00000000-0000-0000-0000-0000000ad0e4', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ad41', 'training', 'AD E4', now() + interval '7 days', now() + interval '7 days 2 hours');
update public.events set status = 'cancelled', cancel_reason = 'Synthetic holiday' where id = '00000000-0000-0000-0000-0000000ad0e3';

-- E1: open, mark (present / unexcused / unexcused), finalize -> alerts.
-- E2: open, one mark saved as late (draft).
do $$
declare r text;
begin
  r := adt.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.attendance_open('00000000-0000-0000-0000-0000000ad0e1')::text$q$);
  perform adt.ok(r like 'OK:%', 'admin opens the E1 sheet');
  r := adt.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.attendance_save('00000000-0000-0000-0000-0000000ad0e1',
        '[{"athlete_id":"00000000-0000-0000-0000-00000000ad31","status":"present"},
          {"athlete_id":"00000000-0000-0000-0000-00000000ad32","status":"unexcused"},
          {"athlete_id":"00000000-0000-0000-0000-00000000ad33","status":"unexcused"}]'::jsonb, 1,
        '00000000-0000-0000-0000-0000000ad101')::text$q$);
  perform adt.ok(r like 'OK:%', 'admin saves E1 marks — ' || left(r, 80));
  r := adt.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.attendance_finalize('00000000-0000-0000-0000-0000000ad0e1',
        '00000000-0000-0000-0000-00000000ad51', (select version from public.team_attendance_sheets where event_id = '00000000-0000-0000-0000-0000000ad0e1'),
        '00000000-0000-0000-0000-0000000ad102')::text$q$);
  perform adt.ok(r like 'OK:%"ok": true%', 'admin finalizes E1 — ' || left(r, 120));
  r := adt.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.attendance_open('00000000-0000-0000-0000-0000000ad0e2')::text$q$);
  r := adt.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.attendance_save('00000000-0000-0000-0000-0000000ad0e2',
        '[{"athlete_id":"00000000-0000-0000-0000-00000000ad31","status":"late"}]'::jsonb, 1, '00000000-0000-0000-0000-0000000ad103')::text$q$);
  perform adt.ok(r like 'OK:%', 'admin saves an E2 draft mark');
end $$;

-- ===========================================================================
-- A. admin_session_attendance
-- ===========================================================================
do $$
declare r text;
begin
  r := adt.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.admin_session_attendance('00000000-0000-0000-0000-00000000ad41')$q$);
  perform adt.ok(r = 'OK:4', 'admin lists every session of the team, cancelled and future included — ' || r);
  r := adt.run_as('00000000-0000-0000-0000-0000000000f1', $q$select (finalized and sheet_status = 'final' and present = 1 and unexcused = 2 and total = 3)::text
        from public.admin_session_attendance('00000000-0000-0000-0000-00000000ad41') where event_id = '00000000-0000-0000-0000-0000000ad0e1'$q$);
  perform adt.ok(r = 'OK:true', 'finalized session: final counts (1 present, 2 unexcused)');
  r := adt.run_as('00000000-0000-0000-0000-0000000000f1', $q$select (not finalized and sheet_status = 'draft' and late = 1 and unmarked = 2)::text
        from public.admin_session_attendance('00000000-0000-0000-0000-00000000ad41') where event_id = '00000000-0000-0000-0000-0000000ad0e2'$q$);
  perform adt.ok(r = 'OK:true', 'draft session: live draft counts, not marked final');
  r := adt.run_as('00000000-0000-0000-0000-0000000000f1', $q$select (event_status = 'cancelled' and cancel_reason = 'Synthetic holiday' and sheet_status is null)::text
        from public.admin_session_attendance('00000000-0000-0000-0000-00000000ad41') where event_id = '00000000-0000-0000-0000-0000000ad0e3'$q$);
  perform adt.ok(r = 'OK:true', 'cancelled session listed with its reason');
  r := adt.run_as('00000000-0000-0000-0000-0000000000f1', $q$select string_agg(event_id::text || '=' || athlete_status, ',' order by starts_at)
        from public.admin_session_attendance(null, '00000000-0000-0000-0000-00000000ad31')$q$);
  perform adt.ok(r = 'OK:00000000-0000-0000-0000-0000000ad0e1=present,00000000-0000-0000-0000-0000000ad0e2=late',
                 'player filter: only sessions the player is on, with the player status — ' || r);
  r := adt.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.admin_session_attendance('00000000-0000-0000-0000-00000000ad41', null, current_date - 1, current_date + 1)$q$);
  perform adt.ok(r = 'OK:1', 'date range filter (local dates) — ' || r);
  r := adt.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.admin_session_attendance('00000000-0000-0000-0000-00000000ad41', null, current_date, current_date - 3)$q$);
  perform adt.ok(r like 'ERR:INVALID_RANGE%', 'reversed range: INVALID_RANGE');
  r := adt.run_as('00000000-0000-0000-0000-00000000ad01', $q$select count(*)::text from public.admin_session_attendance('00000000-0000-0000-0000-00000000ad41')$q$);
  perform adt.ok(r like 'ERR:NOT_AUTHORIZED%', 'coach cannot use the admin history');
  r := adt.run_as('00000000-0000-0000-0000-0000000000f2', $q$select count(*)::text from public.admin_session_attendance('00000000-0000-0000-0000-00000000ad41')$q$);
  perform adt.ok(r like 'ERR:NOT_AUTHORIZED%', 'finance cannot read attendance');
  r := adt.run_as('00000000-0000-0000-0000-00000000ad11', $q$select count(*)::text from public.admin_session_attendance(null, '00000000-0000-0000-0000-00000000ad31')$q$);
  perform adt.ok(r like 'ERR:NOT_AUTHORIZED%', 'guardian cannot use the admin history');
  r := adt.run_as('b0000000-0000-0000-0000-00000000ad91', $q$select count(*)::text from public.admin_session_attendance('00000000-0000-0000-0000-00000000ad41')$q$);
  perform adt.ok(r like 'ERR:TEAM_NOT_FOUND%', 'other org admin: TEAM_NOT_FOUND');
  r := adt.run_as('b0000000-0000-0000-0000-00000000ad91', $q$select count(*)::text from public.admin_session_attendance(null, '00000000-0000-0000-0000-00000000ad31')$q$);
  perform adt.ok(r like 'ERR:ATHLETE_NOT_FOUND%', 'other org admin: ATHLETE_NOT_FOUND');
  r := adt.run_as('b0000000-0000-0000-0000-00000000ad91', $q$select count(*)::text from public.admin_session_attendance()$q$);
  perform adt.ok(r = 'OK:0', 'other org admin sees none of org A''s sessions');
  r := adt.run_as(null, $q$select count(*)::text from public.admin_session_attendance()$q$);
  perform adt.ok(r like 'ERR:%', 'signed-out caller is denied');
end $$;

-- ===========================================================================
-- B. attendance_alert_retry
-- ===========================================================================
do $$
declare r text; v_failed uuid; v_nc uuid; v_sent uuid; v_n int;
begin
  -- Finalize created one initial alert for ad32 (guardian ad11) and a
  -- no_contact row for ad33 (no guardian).
  select id into v_nc from public.attendance_no_show_alerts
   where event_id = '00000000-0000-0000-0000-0000000ad0e1' and athlete_id = '00000000-0000-0000-0000-00000000ad33';
  perform adt.ok(v_nc is not null and (select guardian_profile_id is null from public.attendance_no_show_alerts where id = v_nc),
                 'fixture: player without guardian -> no_contact row');
  select id into v_failed from public.attendance_no_show_alerts
   where event_id = '00000000-0000-0000-0000-0000000ad0e1' and athlete_id = '00000000-0000-0000-0000-00000000ad32';
  -- Simulate the dispatcher giving up after the attempt cap.
  update public.attendance_no_show_alerts set status = 'failed', attempts = 5, last_error = 'synthetic failure',
         next_attempt_at = now() + interval '1 hour' where id = v_failed;

  r := adt.run_as('00000000-0000-0000-0000-00000000ad01', format('select public.attendance_alert_retry(%L)::text', v_failed));
  perform adt.ok(r like 'ERR:NOT_AUTHORIZED%', 'coach cannot retry an alert');
  r := adt.run_as('00000000-0000-0000-0000-0000000000f2', format('select public.attendance_alert_retry(%L)::text', v_failed));
  perform adt.ok(r like 'ERR:NOT_AUTHORIZED%', 'finance cannot retry an alert');
  r := adt.run_as('b0000000-0000-0000-0000-00000000ad91', format('select public.attendance_alert_retry(%L)::text', v_failed));
  perform adt.ok(r like 'ERR:ALERT_NOT_FOUND%', 'other org admin: ALERT_NOT_FOUND');
  perform adt.ok((select status = 'failed' and attempts = 5 from public.attendance_no_show_alerts where id = v_failed),
                 'denied retries change nothing');

  r := adt.run_as('00000000-0000-0000-0000-0000000000f1', format('select public.attendance_alert_retry(%L)::text', v_failed));
  perform adt.ok(r like 'OK:%"pending"%', 'admin retries a failed alert — ' || r);
  perform adt.ok((select status = 'pending' and attempts = 0 and next_attempt_at <= now() and claimed_at is null
                    from public.attendance_no_show_alerts where id = v_failed), 'retried alert is pending, attempts reset, due now');
  perform adt.ok(exists (select 1 from public.audit_logs where action = 'attendance.alert_retry' and target_id = v_failed),
                 'retry is audited');
  r := adt.run_as('00000000-0000-0000-0000-0000000000f1', format('select public.attendance_alert_retry(%L)::text', v_failed));
  perform adt.ok(r like 'ERR:ALERT_NOT_RETRYABLE%', 'a pending alert cannot be retried again');
  r := adt.run_as('00000000-0000-0000-0000-0000000000f1', format('select public.attendance_alert_retry(%L)::text', v_nc));
  perform adt.ok(r like 'ERR:ALERT_NO_GUARDIAN%', 'no_contact without a guardian: ALERT_NO_GUARDIAN (fix the family first)');

  update public.attendance_no_show_alerts set status = 'sent', sent_at = now() where id = v_failed;
  r := adt.run_as('00000000-0000-0000-0000-0000000000f1', format('select public.attendance_alert_retry(%L)::text', v_failed));
  perform adt.ok(r like 'ERR:ALERT_NOT_RETRYABLE%', 'a sent alert is not retried');

  r := adt.run_as('00000000-0000-0000-0000-0000000000f1', format('select public.attendance_alert_retry(%L)::text', gen_random_uuid()));
  perform adt.ok(r like 'ERR:ALERT_NOT_FOUND%', 'unknown alert: ALERT_NOT_FOUND');
  select count(*) into v_n from public.attendance_no_show_alerts;
  perform adt.ok(v_n >= 2, 'alert rows are kept (history)');
end $$;

-- Idempotent re-run of the migration.
\set QUIET on
\i supabase/migrations/20250420104200_admin_attendance_ui.sql
\set QUIET off
select adt.ok(adt.run_as('00000000-0000-0000-0000-0000000000f1',
              $q$select count(*)::text from public.admin_session_attendance('00000000-0000-0000-0000-00000000ad41')$q$) = 'OK:4',
              'migration re-run is idempotent (functions still answer)');
