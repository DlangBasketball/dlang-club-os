-- ============================================================================
-- Staff time, lesson plans and club calendar suite
-- (migration 20250420100500_staff_clockin_calendar.sql)
--
--   A. Clock RPCs: clock in / break / clock out on server time, one open
--      shift per person, auto-link to the coach's session, geo flag only.
--   B. No direct writes: staff cannot insert / update / delete clock rows;
--      a coach cannot see or edit another coach's clock records.
--   C. Admin corrections: reason required, audited, finance/coach refused.
--   D. staff_hours(): planned vs worked incl. breaks, overnight and DST;
--      callers limited to finance/admin of the org (or server code).
--   E. Timesheet approval locks the period; reopen unlocks it.
--   F. Missed clock-out detection.
--   G. Lesson plans: coach of the session writes, other coach cannot read or
--      edit, parents see shared plans of their own child's items only.
--   H. Club events: audience scoping, admin-only writes.
--   I. Calendar feed tokens: own only.
--   J. Shift templates: admin writes, employee reads own.
--   K. Cross-tenant denial for every new table, RPC and the storage bucket.
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach Derrick
-- …f3 = coach …011 leading session …051 of programme …043, guardian Carla
-- …f4 of Mateo …071 registered in programme …041 whose session is …052).
-- Org B …0002 from seed_tenants.sql. A second org A coach and an org B admin
-- are created here. SYNTHETIC DATA ONLY. Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema sc;
grant usage on schema sc to authenticated, anon, service_role;

create function sc.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

-- Run p_sql as user p (null = anon). Returns 'OK:<first column>' or 'ERR:<message>'.
create function sc.run_as(p uuid, p_sql text) returns text language plpgsql as $$
declare v_msg text; v_res text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
    perform set_config('request.jwt.claim.role', case when p is null then 'anon' else 'authenticated' end, true);
    if p is null then execute 'set local role anon'; else execute 'set local role authenticated'; end if;
    execute p_sql into v_res;
    execute 'reset role';
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    return 'OK:' || coalesce(v_res, '<null>');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    execute 'reset role';
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    return 'ERR:' || coalesce(v_msg, 'error');
  end;
end $$;
grant execute on all functions in schema sc to authenticated, anon, service_role;

-- Org A runs on Swiss time for the DST cases.
update public.organizations set timezone = 'Europe/Zurich' where id = '00000000-0000-0000-0000-000000000001';

-- Second org A coach with a login (…c2 = coach …012) and an org B admin.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000c2', 'coach2@example.test'),
  ('b0000000-0000-0000-0000-0000000000c1', 'admin-b@example.test');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002'
 where id = 'b0000000-0000-0000-0000-0000000000c1';
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic Coach Two'
 where id = 'a0000000-0000-0000-0000-0000000000c2';
insert into public.staff_roles (org_id, profile_id, role) values
  ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000c2', 'coach'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000c1', 'admin');
update public.coaches set profile_id = 'a0000000-0000-0000-0000-0000000000c2'
 where id = '00000000-0000-0000-0000-000000000012';

-- Venues: one per org.
insert into public.venues (id, org_id, name, latitude, longitude, geofence_radius_m) values
  ('a0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001', 'Synthetic Hall A', 46.519600, 6.632300, 300),
  ('b0000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-000000000002', 'Synthetic Field B', null, null, 300);

-- Derrick's session …051 runs now (for the auto-link).
update public.program_sessions set starts_at = now() - interval '10 minutes', ends_at = now() + interval '80 minutes'
 where id = '00000000-0000-0000-0000-000000000051';

-- ===========================================================================
-- A. Clock RPCs
-- ===========================================================================
do $$
declare v text; v_id uuid;
begin
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3', $q$select public.staff_clock_in(null, 'ok', 'Synthetic note')::text$q$);
  perform sc.ok(v like 'OK:%', 'coach clocks in (' || v || ')');
  v_id := nullif(substr(v, 4), '<null>')::uuid;
  perform sc.ok((select program_session_id from public.staff_time_entries where id = v_id) = '00000000-0000-0000-0000-000000000051',
                'clock-in auto-links the coach''s session running now');
  perform sc.ok((select geo_status from public.staff_time_entries where id = v_id) = 'ok', 'only the geo flag is stored');
  perform sc.ok((select coach_id from public.staff_time_entries where id = v_id) = '00000000-0000-0000-0000-000000000011',
                'clock-in records the coach row');

  v := sc.run_as('00000000-0000-0000-0000-0000000000f3', $q$select public.staff_clock_in()::text$q$);
  perform sc.ok(v like 'ERR:%ALREADY_CLOCKED_IN%', 'second clock-in is refused (' || v || ')');

  v := sc.run_as('00000000-0000-0000-0000-0000000000f3', $q$select public.staff_clock_in(null, 'somewhere')::text$q$);
  perform sc.ok(v like 'ERR:%', 'invalid geo flag refused');

  v := sc.run_as('00000000-0000-0000-0000-0000000000f3', $q$select public.staff_break(true)::text$q$);
  perform sc.ok(v like 'OK:%', 'coach starts a break');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3', $q$select public.staff_break(true)::text$q$);
  perform sc.ok(v like 'ERR:%ALREADY_ON_BREAK%', 'second break start refused');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3', $q$select public.staff_break(false)::text$q$);
  perform sc.ok(v like 'OK:%', 'coach ends the break');

  v := sc.run_as('00000000-0000-0000-0000-0000000000f4', $q$select public.staff_clock_in()::text$q$);
  perform sc.ok(v like 'ERR:%NOT_AUTHORIZED%', 'a guardian cannot clock in');
  v := sc.run_as(null, $q$select public.staff_clock_in()::text$q$);
  perform sc.ok(v like 'ERR:%', 'anonymous cannot clock in');

  v := sc.run_as('a0000000-0000-0000-0000-0000000000c2', $q$select public.staff_clock_in('b0000000-0000-0000-0000-0000000000e1')::text$q$);
  perform sc.ok(v like 'ERR:%VENUE_NOT_FOUND%', 'clock-in at another club''s venue refused');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000c2', $q$select public.staff_clock_in(null, 'not_checked', null, '00000000-0000-0000-0000-000000000051')::text$q$);
  perform sc.ok(v like 'ERR:%SESSION_NOT_FOUND%', 'coach 2 cannot link Derrick''s session');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000c2', $q$select public.staff_break(true)::text$q$);
  perform sc.ok(v like 'ERR:%NOT_CLOCKED_IN%', 'coach 2 cannot start a break on Derrick''s shift');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000c2', $q$select public.staff_clock_out()::text$q$);
  perform sc.ok(v like 'ERR:%NOT_CLOCKED_IN%', 'coach 2 cannot clock Derrick out');

  v := sc.run_as('00000000-0000-0000-0000-0000000000f3', $q$select (public.staff_clock_out('done'))->>'status'$q$);
  perform sc.ok(v = 'OK:closed', 'coach clocks out (' || v || ')');
  perform sc.ok((select count(*) from public.staff_time_breaks where time_entry_id = v_id and ended_at is not null) = 1, 'break recorded');
  perform sc.ok((select count(*) from public.audit_logs where target_id = v_id and action in ('staff.clock_in', 'staff.clock_out')) = 2,
                'clock in / out audited');
end $$;

-- ===========================================================================
-- B. No direct writes; coaches see only their own clock rows
-- ===========================================================================
do $$
declare v text;
begin
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$insert into public.staff_time_entries (org_id, profile_id, clock_in_at, clock_out_at, status)
          values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f3', now() - interval '9 hours', now(), 'closed') returning id::text$q$);
  perform sc.ok(v like 'ERR:%', 'coach cannot insert a clock record directly');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$with u as (update public.staff_time_entries set clock_in_at = clock_in_at - interval '5 hours' returning 1) select count(*)::text from u$q$);
  perform sc.ok(v = 'OK:0', 'coach cannot edit own clock record directly (' || v || ')');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$with u as (update public.staff_time_breaks set started_at = started_at - interval '1 hour' returning 1) select count(*)::text from u$q$);
  perform sc.ok(v = 'OK:0', 'coach cannot edit breaks directly');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$with d as (delete from public.staff_time_entries returning 1) select count(*)::text from d$q$);
  perform sc.ok(v = 'OK:0', 'coach cannot delete clock records');

  v := sc.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.staff_time_entries$q$);
  perform sc.ok(v = 'OK:1', 'coach sees own clock record (' || v || ')');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000c2', $q$select count(*)::text from public.staff_time_entries$q$);
  perform sc.ok(v = 'OK:0', 'coach 2 cannot see Derrick''s clock records (' || v || ')');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000c2', $q$select count(*)::text from public.staff_time_breaks$q$);
  perform sc.ok(v = 'OK:0', 'coach 2 cannot see Derrick''s breaks');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000c2',
       $q$with u as (update public.staff_time_entries set note = 'x' returning 1) select count(*)::text from u$q$);
  perform sc.ok(v = 'OK:0', 'coach 2 cannot edit Derrick''s clock records');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000c2',
       $q$select public.staff_save_time_entry((select id from public.staff_time_entries limit 1), '00000000-0000-0000-0000-0000000000f3', now() - interval '2 hours', now(), 'Synthetic reason')::text$q$);
  perform sc.ok(v like 'ERR:%NOT_AUTHORIZED%', 'coach 2 cannot correct via RPC');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f2', $q$select count(*)::text from public.staff_time_entries$q$);
  perform sc.ok(v = 'OK:1', 'finance reads org clock records');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.staff_time_entries$q$);
  perform sc.ok(v = 'OK:0', 'guardian sees no clock records');
end $$;

-- ===========================================================================
-- C. Admin corrections
-- ===========================================================================
do $$
declare v text; v_id uuid; v_new uuid;
begin
  select id into v_id from public.staff_time_entries where profile_id = '00000000-0000-0000-0000-0000000000f3' limit 1;
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1',
       format($q$select public.staff_save_time_entry(%L, null, now() - interval '3 hours', now() - interval '1 hour', ' ')::text$q$, v_id));
  perform sc.ok(v like 'ERR:%REASON_REQUIRED%', 'correction without a reason refused');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1',
       format($q$select public.staff_save_time_entry(%L, null, now() - interval '1 hour', now() - interval '3 hours', 'Synthetic reason')::text$q$, v_id));
  perform sc.ok(v like 'ERR:%INVALID_TIMES%', 'clock-out before clock-in refused');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1',
       format($q$select public.staff_save_time_entry(%L, null, now() - interval '3 hours', now() - interval '1 hour', 'Forgot to clock in on time')::text$q$, v_id));
  perform sc.ok(v like 'OK:%', 'admin corrects a shift with a reason (' || v || ')');
  perform sc.ok((select corrected_by from public.staff_time_entries where id = v_id) = '00000000-0000-0000-0000-0000000000f1', 'correction records who');
  perform sc.ok(exists (select 1 from public.audit_logs where target_id = v_id and action = 'staff.entry_correct'
                         and new_data->>'reason' = 'Forgot to clock in on time' and actor_id = '00000000-0000-0000-0000-0000000000f1'),
                'correction audited with reason');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f2',
       format($q$select public.staff_save_time_entry(%L, null, now() - interval '3 hours', now() - interval '1 hour', 'Synthetic reason')::text$q$, v_id));
  perform sc.ok(v like 'ERR:%NOT_AUTHORIZED%', 'finance cannot correct shifts');

  -- manual entry for coach 2 (Mon 2026-03-02 09:00-17:00 local, 30 min break)
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select public.staff_save_time_entry(null, 'a0000000-0000-0000-0000-0000000000c2',
            '2026-03-02 09:00+01', '2026-03-02 17:00+01', 'Paper timesheet',
            'a0000000-0000-0000-0000-0000000000e1',
            '[{"start":"2026-03-02 12:00+01","end":"2026-03-02 12:30+01"}]'::jsonb)::text$q$);
  perform sc.ok(v like 'OK:%', 'admin adds a manual shift with a break (' || v || ')');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select public.staff_save_time_entry(null, 'a0000000-0000-0000-0000-0000000000c2',
            '2026-03-03 09:00+01', '2026-03-03 17:00+01', 'Synthetic reason', null,
            '[{"start":"2026-03-03 08:00+01","end":"2026-03-03 08:30+01"}]'::jsonb)::text$q$);
  perform sc.ok(v like 'ERR:%INVALID_BREAKS%', 'break outside the shift refused');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select public.staff_save_time_entry(null, '00000000-0000-0000-0000-0000000000f4',
            '2026-03-03 09:00+01', '2026-03-03 17:00+01', 'Synthetic reason')::text$q$);
  perform sc.ok(v like 'ERR:%EMPLOYEE_NOT_FOUND%', 'cannot log hours for a non-staff profile');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select public.staff_save_time_entry(null, 'b0000000-0000-0000-0000-0000000000c1',
            '2026-03-03 09:00+01', '2026-03-03 17:00+01', 'Synthetic reason')::text$q$);
  perform sc.ok(v like 'ERR:%EMPLOYEE_NOT_FOUND%', 'cannot log hours for another club''s employee');

  -- overnight manual shift Tue 22:00 -> Wed 02:00 (240 min)
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select public.staff_save_time_entry(null, 'a0000000-0000-0000-0000-0000000000c2',
            '2026-03-03 22:00+01', '2026-03-04 02:00+01', 'Night tournament')::text$q$);
  perform sc.ok(v like 'OK:%', 'admin adds an overnight shift');

  -- delete needs a reason
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select public.staff_save_time_entry(null, 'a0000000-0000-0000-0000-0000000000c2',
            '2026-03-05 09:00+01', '2026-03-05 10:00+01', 'Duplicate test')::text$q$);
  v_new := substr(v, 4)::uuid;
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1', format($q$select public.staff_delete_time_entry(%L, '')::text$q$, v_new));
  perform sc.ok(v like 'ERR:%REASON_REQUIRED%', 'delete without reason refused');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1', format($q$select public.staff_delete_time_entry(%L, 'Duplicate entry')::text$q$, v_new));
  perform sc.ok(v like 'OK:%' and not exists (select 1 from public.staff_time_entries where id = v_new), 'admin deletes with reason');
  perform sc.ok(exists (select 1 from public.audit_logs where target_id = v_new and action = 'staff.entry_delete'), 'delete audited');
end $$;

-- ===========================================================================
-- D. staff_hours
-- ===========================================================================
-- Coach 2 plans: Mon 09-17 (480), Sun 01:00-05:00 (DST day 2026-03-29: 180),
-- Tue 22:00-02:00 overnight (240).
insert into public.staff_shift_templates (org_id, profile_id, venue_id, weekday, start_time, end_time) values
  ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000c2', 'a0000000-0000-0000-0000-0000000000e1', 1, '09:00', '17:00'),
  ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000c2', null, 7, '01:00', '05:00'),
  ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000c2', null, 2, '22:00', '02:00');

do $$
declare v text;
begin
  -- week 2026-03-02 .. 2026-03-08: Mon 480 + Tue overnight 240 + Sun 240 (no DST that week)
  v := sc.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$select planned_minutes || '/' || worked_minutes || '/' || break_minutes || '/' || entry_count
            from public.staff_hours('00000000-0000-0000-0000-000000000001', '2026-03-02', '2026-03-08')
           where profile_id = 'a0000000-0000-0000-0000-0000000000c2'$q$);
  perform sc.ok(v = 'OK:960/690/30/2', 'week: planned 960, worked 450 + 240 overnight, 30 break (' || v || ')');

  -- DST week 2026-03-23 .. 2026-03-29: Mon 480 + Tue 240 + Sun 01-05 = 180 real minutes
  v := sc.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$select planned_minutes::text from public.staff_hours('00000000-0000-0000-0000-000000000001', '2026-03-23', '2026-03-29')
           where profile_id = 'a0000000-0000-0000-0000-0000000000c2'$q$);
  perform sc.ok(v = 'OK:900', 'DST spring-forward Sunday counts 3 real hours (' || v || ')');

  -- window clipping: only Wednesday 03-04 -> the overnight shift's 2 hours after midnight
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select worked_minutes::text from public.staff_hours('00000000-0000-0000-0000-000000000001', '2026-03-04', '2026-03-04')
           where profile_id = 'a0000000-0000-0000-0000-0000000000c2'$q$);
  perform sc.ok(v = 'OK:120', 'overnight shift clipped to the window (' || v || ')');

  v := sc.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$select count(*)::text from public.staff_hours('00000000-0000-0000-0000-000000000001', '2026-03-02', '2026-03-08')$q$);
  perform sc.ok(v like 'ERR:%NOT_AUTHORIZED%', 'a coach cannot run staff_hours');
  v := sc.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$select count(*)::text from public.staff_hours('00000000-0000-0000-0000-000000000001', '2026-03-02', '2026-03-08')$q$);
  perform sc.ok(v like 'ERR:%NOT_AUTHORIZED%', 'org B admin cannot run staff_hours for org A');
  v := sc.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$select count(*)::text from public.staff_hours('10000000-0000-0000-0000-000000000002', '2026-03-02', '2026-03-08')
           where profile_id in ('a0000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000f3')$q$);
  perform sc.ok(v = 'OK:0', 'org B staff_hours lists no org A employees');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select count(*)::text from public.staff_hours('00000000-0000-0000-0000-000000000001', '2026-03-08', '2026-03-02')$q$);
  perform sc.ok(v like 'ERR:%INVALID_RANGE%', 'reversed range refused');
end $$;

-- service role (server job) may run it
set role service_role;
select sc.ok((select count(*) from public.staff_hours('00000000-0000-0000-0000-000000000001', '2026-03-02', '2026-03-08')) >= 3,
             'service role runs staff_hours');
reset role;

-- ===========================================================================
-- E. Timesheet approval
-- ===========================================================================
do $$
declare v text; v_e uuid;
begin
  v := sc.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$select public.staff_set_timesheet('a0000000-0000-0000-0000-0000000000c2', '2026-03-02', '2026-03-08', true)::text$q$);
  perform sc.ok(v like 'ERR:%NOT_AUTHORIZED%', 'finance cannot approve timesheets');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select public.staff_set_timesheet('a0000000-0000-0000-0000-0000000000c2', '2026-03-02', '2026-03-08', true, 'OK')::text$q$);
  perform sc.ok(v like 'OK:%', 'admin approves the week (' || v || ')');
  perform sc.ok((select worked_minutes from public.staff_timesheets where profile_id = 'a0000000-0000-0000-0000-0000000000c2') = 690,
                'approval snapshots worked minutes');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$select approved::text from public.staff_hours('00000000-0000-0000-0000-000000000001', '2026-03-02', '2026-03-08')
           where profile_id = 'a0000000-0000-0000-0000-0000000000c2'$q$);
  perform sc.ok(v = 'OK:true', 'staff_hours reports the window approved');

  select id into v_e from public.staff_time_entries where profile_id = 'a0000000-0000-0000-0000-0000000000c2' order by clock_in_at limit 1;
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1',
       format($q$select public.staff_save_time_entry(%L, null, '2026-03-02 08:00+01', '2026-03-02 17:00+01', 'Synthetic reason')::text$q$, v_e));
  perform sc.ok(v like 'ERR:%TIMESHEET_APPROVED%', 'approved period is locked');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1', format($q$select public.staff_delete_time_entry(%L, 'Synthetic reason')::text$q$, v_e));
  perform sc.ok(v like 'ERR:%TIMESHEET_APPROVED%', 'approved entries cannot be deleted');

  v := sc.run_as('a0000000-0000-0000-0000-0000000000c2', $q$select count(*)::text from public.staff_timesheets$q$);
  perform sc.ok(v = 'OK:1', 'employee reads own timesheet');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.staff_timesheets$q$);
  perform sc.ok(v = 'OK:0', 'another coach cannot read it');

  v := sc.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select public.staff_set_timesheet('a0000000-0000-0000-0000-0000000000c2', '2026-03-02', '2026-03-08', false, 'Fix needed')::text$q$);
  perform sc.ok(v like 'OK:%', 'admin reopens the week');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1',
       format($q$select public.staff_save_time_entry(%L, null, '2026-03-02 08:30+01', '2026-03-02 17:00+01', 'Started earlier')::text$q$, v_e));
  perform sc.ok(v like 'OK:%', 'reopened period can be corrected');
end $$;

-- ===========================================================================
-- F. Missed clock-out
-- ===========================================================================
insert into public.staff_time_entries (org_id, profile_id, coach_id, clock_in_at, status)
values ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000012',
        now() - interval '20 hours', 'open');
do $$
declare v text;
begin
  v := sc.run_as('a0000000-0000-0000-0000-0000000000c2', $q$select public.staff_flag_missed_clockouts()::text$q$);
  perform sc.ok(v like 'ERR:%NOT_AUTHORIZED%', 'a coach cannot run missed clock-out detection');
  v := sc.run_as('b0000000-0000-0000-0000-0000000000c1', $q$select public.staff_flag_missed_clockouts()::text$q$);
  perform sc.ok(v = 'OK:0', 'org B admin flags nothing in org A');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.staff_flag_missed_clockouts()::text$q$);
  perform sc.ok(v = 'OK:1', 'admin flags the forgotten clock-out (' || v || ')');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select missed_entries::text from public.staff_hours('00000000-0000-0000-0000-000000000001', (now() - interval '1 day')::date, now()::date)
           where profile_id = 'a0000000-0000-0000-0000-0000000000c2'$q$);
  perform sc.ok(v = 'OK:1', 'staff_hours reports the missed clock-out');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000c2', $q$select public.staff_clock_in()::text$q$);
  perform sc.ok(v like 'OK:%', 'employee can clock in again after a missed clock-out');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select public.staff_set_timesheet('a0000000-0000-0000-0000-0000000000c2', (now() - interval '1 day')::date, now()::date, true)::text$q$);
  perform sc.ok(v like 'ERR:%OPEN_ENTRIES%', 'cannot approve a period with open or missed shifts');
end $$;

-- ===========================================================================
-- G. Lesson plans
-- ===========================================================================
do $$
declare v text; v_plan uuid; v_plan2 uuid;
begin
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$insert into public.lesson_plans (org_id, program_session_id, coach_id, author_id, title, objectives, drills)
          values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000011',
                  '00000000-0000-0000-0000-0000000000f3', 'Synthetic plan', 'Footwork', '[{"name":"Layups","minutes":10}]')
          returning id::text$q$);
  perform sc.ok(v like 'OK:%', 'coach writes the lesson plan of their session (' || v || ')');
  v_plan := substr(v, 4)::uuid;

  v := sc.run_as('a0000000-0000-0000-0000-0000000000c2',
       $q$insert into public.lesson_plans (org_id, program_session_id, coach_id, author_id, title)
          values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000052', '00000000-0000-0000-0000-000000000012',
                  'a0000000-0000-0000-0000-0000000000c2', 'Not my session') returning id::text$q$);
  perform sc.ok(v like 'ERR:%', 'coach 2 cannot plan a session they do not lead');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000c2', $q$select count(*)::text from public.lesson_plans$q$);
  perform sc.ok(v = 'OK:0', 'coach 2 cannot read Derrick''s plan');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000c2',
       $q$with u as (update public.lesson_plans set title = 'Hijack' returning 1) select count(*)::text from u$q$);
  perform sc.ok(v = 'OK:0', 'coach 2 cannot edit Derrick''s plan');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000c2',
       $q$with d as (delete from public.lesson_plans returning 1) select count(*)::text from d$q$);
  perform sc.ok(v = 'OK:0', 'coach 2 cannot delete Derrick''s plan');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3',
       format($q$with u as (update public.lesson_plans set shared_with_parents = true, shared_at = now() where id = %L returning 1) select count(*)::text from u$q$, v_plan));
  perform sc.ok(v = 'OK:1', 'coach shares own plan');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.lesson_plans$q$);
  perform sc.ok(v = 'OK:0', 'guardian does not see a shared plan of another programme');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f2', $q$select count(*)::text from public.lesson_plans$q$);
  perform sc.ok(v = 'OK:0', 'finance does not read lesson plans');

  -- admin plans Mateo's camp session …052
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.lesson_plans (org_id, program_session_id, author_id, title)
          values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000052',
                  '00000000-0000-0000-0000-0000000000f1', 'Camp day 1') returning id::text$q$);
  perform sc.ok(v like 'OK:%', 'admin writes a plan for any session');
  v_plan2 := substr(v, 4)::uuid;
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.lesson_plans$q$);
  perform sc.ok(v = 'OK:0', 'guardian does not see an unshared plan');
  update public.lesson_plans set shared_with_parents = true where id = v_plan2;
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4', $q$select title from public.lesson_plans$q$);
  perform sc.ok(v = 'OK:Camp day 1', 'guardian sees the shared plan of their child''s session');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$with u as (update public.lesson_plans set title = 'x' returning 1) select count(*)::text from u$q$);
  perform sc.ok(v = 'OK:0', 'guardian cannot edit plans');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.lesson_plans$q$);
  perform sc.ok(v = 'OK:2', 'admin sees all plans');
  v := sc.run_as('b0000000-0000-0000-0000-0000000000c1', $q$select count(*)::text from public.lesson_plans$q$);
  perform sc.ok(v = 'OK:0', 'org B admin sees no org A plans');
  v := sc.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$with u as (update public.lesson_plans set title = 'x' returning 1) select count(*)::text from u$q$);
  perform sc.ok(v = 'OK:0', 'org B admin cannot edit org A plans');
  v := sc.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$insert into public.lesson_plans (org_id, program_session_id, author_id, title)
          values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000051',
                  'b0000000-0000-0000-0000-0000000000c1', 'x') returning id::text$q$);
  perform sc.ok(v like 'ERR:%', 'org B admin cannot create a plan in org A');

  -- storage bucket
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3',
       format($q$insert into storage.objects (bucket_id, name) values ('lesson-plans', %L) returning name$q$,
              '00000000-0000-0000-0000-000000000001/' || v_plan || '/drills.pdf'));
  perform sc.ok(v like 'OK:%', 'coach uploads an attachment to own plan');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000c2',
       format($q$insert into storage.objects (bucket_id, name) values ('lesson-plans', %L) returning name$q$,
              '00000000-0000-0000-0000-000000000001/' || v_plan || '/evil.pdf'));
  perform sc.ok(v like 'ERR:%', 'coach 2 cannot upload to Derrick''s plan');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000c2', $q$select count(*)::text from storage.objects where bucket_id = 'lesson-plans'$q$);
  perform sc.ok(v = 'OK:0', 'coach 2 cannot read Derrick''s attachment');
  v := sc.run_as('b0000000-0000-0000-0000-0000000000c1', $q$select count(*)::text from storage.objects where bucket_id = 'lesson-plans'$q$);
  perform sc.ok(v = 'OK:0', 'org B admin cannot read org A attachments');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from storage.objects where bucket_id = 'lesson-plans'$q$);
  perform sc.ok(v = 'OK:0', 'guardian cannot read attachments of another programme''s plan');
end $$;

-- ===========================================================================
-- H. Club events
-- ===========================================================================
do $$
declare v text;
begin
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with i as (insert into public.club_events (org_id, title, type, starts_at, ends_at, audience) values
            ('00000000-0000-0000-0000-000000000001', 'Synthetic tournament', 'international', now() + interval '10 days', now() + interval '12 days', 'everyone'),
            ('00000000-0000-0000-0000-000000000001', 'Staff meeting', 'meeting', now() + interval '3 days', now() + interval '3 days 1 hour', 'staff'),
            ('00000000-0000-0000-0000-000000000001', 'Parents evening', 'meeting', now() + interval '4 days', now() + interval '4 days 2 hours', 'parents')
          returning 1) select count(*)::text from i$q$);
  perform sc.ok(v = 'OK:3', 'admin creates club events');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4', $q$select string_agg(audience, ',' order by audience) from public.club_events$q$);
  perform sc.ok(v = 'OK:everyone,parents', 'guardian sees everyone + parents events (' || v || ')');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3', $q$select string_agg(audience, ',' order by audience) from public.club_events$q$);
  perform sc.ok(v = 'OK:everyone,staff', 'coach sees everyone + staff events (' || v || ')');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$insert into public.club_events (org_id, title, starts_at, ends_at) values ('00000000-0000-0000-0000-000000000001', 'x', now(), now()) returning id::text$q$);
  perform sc.ok(v like 'ERR:%', 'coach cannot create club events');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$with u as (update public.club_events set title = 'x' returning 1) select count(*)::text from u$q$);
  perform sc.ok(v = 'OK:0', 'guardian cannot edit club events');
  v := sc.run_as('b0000000-0000-0000-0000-0000000000c1', $q$select count(*)::text from public.club_events$q$);
  perform sc.ok(v = 'OK:0', 'org B admin sees no org A club events');
  v := sc.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$insert into public.club_events (org_id, title, starts_at, ends_at) values ('00000000-0000-0000-0000-000000000001', 'x', now(), now()) returning id::text$q$);
  perform sc.ok(v like 'ERR:%', 'org B admin cannot create an org A club event');
  v := sc.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$with d as (delete from public.club_events returning 1) select count(*)::text from d$q$);
  perform sc.ok(v = 'OK:0', 'org B admin cannot delete org A club events');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.club_events (org_id, title, starts_at, ends_at, venue_id) values
            ('00000000-0000-0000-0000-000000000001', 'x', now(), now(), 'b0000000-0000-0000-0000-0000000000e1') returning id::text$q$);
  perform sc.ok(v like 'ERR:%CROSS_ORG%', 'club event cannot point at another club''s venue');
end $$;

-- ===========================================================================
-- I. Calendar feed tokens
-- ===========================================================================
do $$
declare v text;
begin
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$insert into public.calendar_feed_tokens (org_id, profile_id, token_hash)
          values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f3', repeat('a', 64)) returning id::text$q$);
  perform sc.ok(v like 'OK:%', 'user creates own feed token');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$insert into public.calendar_feed_tokens (org_id, profile_id, token_hash)
          values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f3', repeat('b', 64)) returning id::text$q$);
  perform sc.ok(v like 'ERR:%', 'user cannot create a token for someone else');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.calendar_feed_tokens$q$);
  perform sc.ok(v = 'OK:0', 'user cannot see others'' tokens');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.calendar_feed_tokens$q$);
  perform sc.ok(v = 'OK:0', 'even an admin cannot read someone''s token');
  v := sc.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$with u as (update public.calendar_feed_tokens set revoked_at = now() returning 1) select count(*)::text from u$q$);
  perform sc.ok(v = 'OK:0', 'org B admin cannot revoke org A tokens');
  v := sc.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$insert into public.calendar_feed_tokens (org_id, profile_id, token_hash)
          values ('00000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000c1', repeat('c', 64)) returning id::text$q$);
  perform sc.ok(v like 'ERR:%', 'org B admin cannot create a token in org A');
end $$;

-- ===========================================================================
-- J. Shift templates
-- ===========================================================================
do $$
declare v text;
begin
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.staff_shift_templates (org_id, profile_id, weekday, start_time, end_time)
          values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f3', 3, '16:00', '20:00') returning id::text$q$);
  perform sc.ok(v like 'OK:%', 'admin plans a weekly shift');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.staff_shift_templates$q$);
  perform sc.ok(v = 'OK:1', 'employee reads own planned shifts only (' || v || ')');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$insert into public.staff_shift_templates (org_id, profile_id, weekday, start_time, end_time)
          values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f3', 4, '16:00', '20:00') returning id::text$q$);
  perform sc.ok(v like 'ERR:%', 'employee cannot plan own shifts');
  v := sc.run_as('a0000000-0000-0000-0000-0000000000c2',
       $q$with u as (update public.staff_shift_templates set start_time = '10:00' where profile_id = '00000000-0000-0000-0000-0000000000f3' returning 1) select count(*)::text from u$q$);
  perform sc.ok(v = 'OK:0', 'coach 2 cannot edit Derrick''s shifts');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.staff_shift_templates (org_id, profile_id, venue_id, weekday, start_time, end_time)
          values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f3', 'b0000000-0000-0000-0000-0000000000e1', 3, '16:00', '20:00') returning id::text$q$);
  perform sc.ok(v like 'ERR:%CROSS_ORG%', 'shift cannot use another club''s venue');
  v := sc.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.staff_shift_templates (org_id, profile_id, weekday, start_time, end_time)
          values ('00000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000c1', 3, '16:00', '20:00') returning id::text$q$);
  perform sc.ok(v like 'ERR:%CROSS_ORG%', 'shift cannot be planned for another club''s employee');
end $$;

-- ===========================================================================
-- K. Cross-tenant denial (org B admin vs every org A table)
-- ===========================================================================
do $$
declare v text; t text;
begin
  foreach t in array array['staff_shift_templates', 'staff_time_entries', 'staff_time_breaks', 'staff_timesheets',
                           'lesson_plans', 'club_events', 'calendar_feed_tokens'] loop
    v := sc.run_as('b0000000-0000-0000-0000-0000000000c1',
         format('select count(*)::text from public.%I where org_id = %L', t, '00000000-0000-0000-0000-000000000001'));
    perform sc.ok(v = 'OK:0', 'org B admin reads no org A rows in ' || t || ' (' || v || ')');
  end loop;
  v := sc.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$with u as (update public.staff_shift_templates set start_time = '05:00' returning 1) select count(*)::text from u$q$);
  perform sc.ok(v = 'OK:0', 'org B admin cannot edit org A shift templates');
  v := sc.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$insert into public.staff_shift_templates (org_id, profile_id, weekday, start_time, end_time)
          values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f3', 1, '09:00', '10:00') returning id::text$q$);
  perform sc.ok(v like 'ERR:%', 'org B admin cannot plan shifts in org A');
  v := sc.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$select public.staff_save_time_entry((select id from public.staff_time_entries limit 1), null, now() - interval '2 hours', now(), 'Synthetic reason')::text$q$);
  perform sc.ok(v like 'ERR:%', 'org B admin cannot correct org A shifts');
  v := sc.run_as('b0000000-0000-0000-0000-0000000000c1',
       $q$select public.staff_set_timesheet('a0000000-0000-0000-0000-0000000000c2', '2026-03-02', '2026-03-08', true)::text$q$);
  perform sc.ok(v like 'ERR:%EMPLOYEE_NOT_FOUND%', 'org B admin cannot approve org A timesheets');
  v := sc.run_as('b0000000-0000-0000-0000-0000000000c1', $q$select public.staff_clock_in('a0000000-0000-0000-0000-0000000000e1')::text$q$);
  perform sc.ok(v like 'ERR:%VENUE_NOT_FOUND%', 'org B admin cannot clock in at an org A venue');
end $$;

select 'PASS — staff clock-in suite completed' as result;
