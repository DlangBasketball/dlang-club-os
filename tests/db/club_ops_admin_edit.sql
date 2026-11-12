-- ============================================================================
-- Club operations admin edit (migration 20250420095800_club_ops_admin_edit)
--
-- Proves:
--   * programmes: status drives is_active; draft/archived programmes are not
--     readable by other clubs or anon; archive-not-delete when registrations
--     exist; registration window / age / status enforced for non-staff, while
--     the club's staff can still enrol; admin of org B cannot edit org A's
--     programme (cross-tenant denial)
--   * events: cancellation stamps + reason, cleared on reinstatement; series
--     column; org B admin cannot update org A events
--   * attendance: admin and the session's coach can correct a submitted
--     session (audited, note text never copied into audit_logs); another
--     coach, a parent and org B's admin cannot; reopen rules (coach cannot
--     reopen a locked session); save_attendance on a submitted session is
--     audited
--   * bookings: admin_update_booking moves time/coach/service with slot
--     bookkeeping and refuses a busy coach; admin_cancel_booking requires a
--     reason; coach/parent/org B admin are denied
-- Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema cot;
grant usage on schema cot to authenticated, anon;

create function cot.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

-- Run p_sql as user p (null = anon). Returns 'OK:<first column>' or 'ERR:<message>'.
create function cot.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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
grant execute on all functions in schema cot to authenticated, anon;

-- ---- Fixtures (synthetic) ----------------------------------------------------
insert into public.organizations (id, name, slug) values
  ('aaaa0b00-0000-0000-0000-000000000001', 'Ops Org A', 'ops-org-a-test'),
  ('bbbb0b00-0000-0000-0000-000000000001', 'Ops Org B', 'ops-org-b-test');

insert into auth.users (id, email) values
  ('a0b00000-0000-0000-0000-0000000000a1', 'admin@ops-a.test'),
  ('a0b00000-0000-0000-0000-0000000000c1', 'coach@ops-a.test'),
  ('a0b00000-0000-0000-0000-0000000000c2', 'coach2@ops-a.test'),
  ('a0b00000-0000-0000-0000-0000000000f1', 'parent@ops-a.test'),
  ('b0b00000-0000-0000-0000-0000000000a1', 'admin@ops-b.test');

insert into public.profiles (id, org_id, email) values
  ('a0b00000-0000-0000-0000-0000000000a1', 'aaaa0b00-0000-0000-0000-000000000001', 'admin@ops-a.test'),
  ('a0b00000-0000-0000-0000-0000000000c1', 'aaaa0b00-0000-0000-0000-000000000001', 'coach@ops-a.test'),
  ('a0b00000-0000-0000-0000-0000000000c2', 'aaaa0b00-0000-0000-0000-000000000001', 'coach2@ops-a.test'),
  ('a0b00000-0000-0000-0000-0000000000f1', 'aaaa0b00-0000-0000-0000-000000000001', 'parent@ops-a.test'),
  ('b0b00000-0000-0000-0000-0000000000a1', 'bbbb0b00-0000-0000-0000-000000000001', 'admin@ops-b.test')
on conflict (id) do update set org_id = excluded.org_id;

insert into public.staff_roles (org_id, profile_id, role) values
  ('aaaa0b00-0000-0000-0000-000000000001', 'a0b00000-0000-0000-0000-0000000000a1', 'admin'),
  ('aaaa0b00-0000-0000-0000-000000000001', 'a0b00000-0000-0000-0000-0000000000c1', 'coach'),
  ('aaaa0b00-0000-0000-0000-000000000001', 'a0b00000-0000-0000-0000-0000000000c2', 'coach'),
  ('bbbb0b00-0000-0000-0000-000000000001', 'b0b00000-0000-0000-0000-0000000000a1', 'admin');

insert into public.coaches (id, org_id, profile_id, display_name) values
  ('c0b00000-0000-0000-0000-000000000001', 'aaaa0b00-0000-0000-0000-000000000001', 'a0b00000-0000-0000-0000-0000000000c1', 'Coach One'),
  ('c0b00000-0000-0000-0000-000000000002', 'aaaa0b00-0000-0000-0000-000000000001', 'a0b00000-0000-0000-0000-0000000000c2', 'Coach Two');

insert into public.families (id, org_id, name) values
  ('f0b00000-0000-0000-0000-000000000001', 'aaaa0b00-0000-0000-0000-000000000001', 'Family One');
insert into public.family_members (family_id, profile_id) values
  ('f0b00000-0000-0000-0000-000000000001', 'a0b00000-0000-0000-0000-0000000000f1');

insert into public.athletes (id, org_id, family_id, first_name, last_name, dob) values
  ('e0b00000-0000-0000-0000-000000000001', 'aaaa0b00-0000-0000-0000-000000000001', 'f0b00000-0000-0000-0000-000000000001', 'Kid', 'One', current_date - interval '10 years'),
  ('e0b00000-0000-0000-0000-000000000002', 'aaaa0b00-0000-0000-0000-000000000001', 'f0b00000-0000-0000-0000-000000000001', 'Kid', 'Two', current_date - interval '17 years'),
  ('e0b00000-0000-0000-0000-000000000003', 'aaaa0b00-0000-0000-0000-000000000001', 'f0b00000-0000-0000-0000-000000000001', 'Kid', 'Three', current_date - interval '11 years');

insert into public.programs (id, org_id, slug, name, kind, is_public, status) values
  ('90b00000-0000-0000-0000-000000000001', 'aaaa0b00-0000-0000-0000-000000000001', 'ops-camp',  'Ops Camp',  'camp', true, 'published'),
  ('90b00000-0000-0000-0000-000000000002', 'aaaa0b00-0000-0000-0000-000000000001', 'ops-draft', 'Ops Draft', 'camp', true, 'draft'),
  ('90b00000-0000-0000-0000-000000000003', 'aaaa0b00-0000-0000-0000-000000000001', 'ops-empty', 'Ops Empty', 'clinic', false, 'published');

insert into public.registrations (org_id, athlete_id, program_id, status) values
  ('aaaa0b00-0000-0000-0000-000000000001', 'e0b00000-0000-0000-0000-000000000001', '90b00000-0000-0000-0000-000000000001', 'confirmed');

insert into public.program_sessions (id, org_id, program_id, coach_id, starts_at, ends_at) values
  ('51b00000-0000-0000-0000-000000000001', 'aaaa0b00-0000-0000-0000-000000000001', '90b00000-0000-0000-0000-000000000001',
   'c0b00000-0000-0000-0000-000000000001', now() - interval '1 day', now() - interval '23 hours');
insert into public.attendance_sessions (id, org_id, program_id, program_session_id, coach_id, session_date, status, submitted_at) values
  ('a5b00000-0000-0000-0000-000000000001', 'aaaa0b00-0000-0000-0000-000000000001', '90b00000-0000-0000-0000-000000000001',
   '51b00000-0000-0000-0000-000000000001', 'c0b00000-0000-0000-0000-000000000001', now() - interval '1 day', 'submitted', now() - interval '20 hours');
insert into public.attendance_marks (org_id, attendance_session_id, athlete_id, status, notes) values
  ('aaaa0b00-0000-0000-0000-000000000001', 'a5b00000-0000-0000-0000-000000000001', 'e0b00000-0000-0000-0000-000000000001', 'absent', null);

insert into public.events (id, org_id, type, starts_at, ends_at, series_id) values
  ('ebb00000-0000-0000-0000-000000000001', 'aaaa0b00-0000-0000-0000-000000000001', 'training',
   now() + interval '2 days', now() + interval '2 days 1 hour', '5eb00000-0000-0000-0000-000000000001');

insert into public.training_services (id, org_id, slug, name, duration_min, price_chf) values
  ('5cb00000-0000-0000-0000-000000000001', 'aaaa0b00-0000-0000-0000-000000000001', 'ops-pt', 'PT', 60, 80),
  ('5cb00000-0000-0000-0000-000000000002', 'aaaa0b00-0000-0000-0000-000000000001', 'ops-shoot', 'Shoot', 45, 60),
  ('5cb00000-0000-0000-0000-0000000000b1', 'bbbb0b00-0000-0000-0000-000000000001', 'ops-b', 'B svc', 60, 50);
insert into public.coach_availability (id, org_id, coach_id, starts_at, ends_at, is_booked) values
  ('cab00000-0000-0000-0000-000000000001', 'aaaa0b00-0000-0000-0000-000000000001', 'c0b00000-0000-0000-0000-000000000001',
   date_trunc('hour', now()) + interval '3 days', date_trunc('hour', now()) + interval '3 days 1 hour', true),
  ('cab00000-0000-0000-0000-000000000002', 'aaaa0b00-0000-0000-0000-000000000001', 'c0b00000-0000-0000-0000-000000000002',
   date_trunc('hour', now()) + interval '4 days', date_trunc('hour', now()) + interval '4 days 1 hour', false);
insert into public.training_bookings (id, org_id, athlete_id, service_id, coach_id, slot_start, slot_end, status, price_chf) values
  ('bbb00000-0000-0000-0000-000000000001', 'aaaa0b00-0000-0000-0000-000000000001', 'e0b00000-0000-0000-0000-000000000001',
   '5cb00000-0000-0000-0000-000000000001', 'c0b00000-0000-0000-0000-000000000001',
   date_trunc('hour', now()) + interval '3 days', date_trunc('hour', now()) + interval '3 days 1 hour', 'booked', 80),
  ('bbb00000-0000-0000-0000-000000000002', 'aaaa0b00-0000-0000-0000-000000000001', 'e0b00000-0000-0000-0000-000000000003',
   '5cb00000-0000-0000-0000-000000000001', 'c0b00000-0000-0000-0000-000000000002',
   date_trunc('hour', now()) + interval '5 days', date_trunc('hour', now()) + interval '5 days 1 hour', 'booked', 80);

do $$
declare
  a_admin  constant uuid := 'a0b00000-0000-0000-0000-0000000000a1';
  a_coach  constant uuid := 'a0b00000-0000-0000-0000-0000000000c1';
  a_coach2 constant uuid := 'a0b00000-0000-0000-0000-0000000000c2';
  a_parent constant uuid := 'a0b00000-0000-0000-0000-0000000000f1';
  b_admin  constant uuid := 'b0b00000-0000-0000-0000-0000000000a1';
  sess     constant text := 'a5b00000-0000-0000-0000-000000000001';
  v text;
  n int;
begin
  -- ===================== PROGRAMMES ========================================
  perform cot.ok((select not is_active from public.programs where id = '90b00000-0000-0000-0000-000000000002'), 'draft programme is not active');
  perform cot.ok((select is_active from public.programs where id = '90b00000-0000-0000-0000-000000000001'), 'published programme is active');

  v := cot.run_as(null, $q$select count(*)::text from public.programs where slug in ('ops-camp','ops-draft','ops-empty')$q$);
  perform cot.ok(v = 'OK:0', 'anon reads no programme rows directly, drafts included (' || v || ')');
  v := cot.run_as(b_admin, $q$select count(*)::text from public.programs where slug in ('ops-camp','ops-draft','ops-empty')$q$);
  perform cot.ok(v = 'OK:0', 'cross-tenant: org B admin cannot read org A programmes, drafts included (' || v || ')');

  v := cot.run_as(a_admin, $q$with u as (update public.programs set name = 'Ops Camp 2', min_age = 8, max_age = 12, currency = 'eur',
       registration_opens_at = now() - interval '1 day', registration_closes_at = now() + interval '30 days'
       where id = '90b00000-0000-0000-0000-000000000001' returning currency) select currency from u$q$);
  perform cot.ok(v = 'OK:EUR', 'admin A edits programme; currency normalised (' || v || ')');

  v := cot.run_as(b_admin, $q$with u as (update public.programs set name = 'hijack' where id = '90b00000-0000-0000-0000-000000000001' returning 1) select count(*)::text from u$q$);
  perform cot.ok(v = 'OK:0', 'cross-tenant: org B admin cannot update org A programme (' || v || ')');
  v := cot.run_as(a_coach, $q$with u as (update public.programs set name = 'coach edit' where id = '90b00000-0000-0000-0000-000000000001' returning 1) select count(*)::text from u$q$);
  perform cot.ok(v = 'OK:0', 'coach cannot update a programme (' || v || ')');

  v := cot.run_as(a_admin, $q$update public.programs set max_age = 5, min_age = 9 where id = '90b00000-0000-0000-0000-000000000003'$q$);
  perform cot.ok(v like 'ERR:%programs_age_chk%', 'age range must be min <= max (' || v || ')');

  -- archive-not-delete
  v := cot.run_as(a_admin, $q$delete from public.programs where id = '90b00000-0000-0000-0000-000000000001'$q$);
  perform cot.ok(v like 'ERR:%PROGRAM_HAS_REGISTRATIONS%', 'programme with registrations cannot be deleted (' || v || ')');
  v := cot.run_as(a_admin, $q$with d as (delete from public.programs where id = '90b00000-0000-0000-0000-000000000003' returning 1) select count(*)::text from d$q$);
  perform cot.ok(v = 'OK:1', 'programme without registrations can be deleted (' || v || ')');

  -- registration rules for non-staff (parent) vs staff (admin)
  v := cot.run_as(a_parent, $q$insert into public.registrations (org_id, athlete_id, program_id) values ('aaaa0b00-0000-0000-0000-000000000001','e0b00000-0000-0000-0000-000000000002','90b00000-0000-0000-0000-000000000001') returning 'x'$q$);
  perform cot.ok(v like 'ERR:%AGE_OUT_OF_RANGE%', 'parent cannot register a 17-year-old into an 8-12 programme (' || v || ')');
  v := cot.run_as(a_parent, $q$insert into public.registrations (org_id, athlete_id, program_id) values ('aaaa0b00-0000-0000-0000-000000000001','e0b00000-0000-0000-0000-000000000003','90b00000-0000-0000-0000-000000000002') returning 'x'$q$);
  perform cot.ok(v like 'ERR:%PROGRAM_NOT_OPEN%', 'parent cannot register into a draft programme (' || v || ')');
  update public.programs set registration_closes_at = now() - interval '1 hour', registration_opens_at = now() - interval '2 days'
   where id = '90b00000-0000-0000-0000-000000000001';
  v := cot.run_as(a_parent, $q$insert into public.registrations (org_id, athlete_id, program_id) values ('aaaa0b00-0000-0000-0000-000000000001','e0b00000-0000-0000-0000-000000000003','90b00000-0000-0000-0000-000000000001') returning 'x'$q$);
  perform cot.ok(v like 'ERR:%REGISTRATION_CLOSED%', 'parent cannot register after the window closed (' || v || ')');
  v := cot.run_as(a_admin, $q$insert into public.registrations (org_id, athlete_id, program_id) values ('aaaa0b00-0000-0000-0000-000000000001','e0b00000-0000-0000-0000-000000000003','90b00000-0000-0000-0000-000000000001') returning 'x'$q$);
  perform cot.ok(v = 'OK:x', 'admin can still enrol after the window closed (' || v || ')');
  begin
    perform public.register_public(jsonb_build_object('program_id', '90b00000-0000-0000-0000-000000000002',
      'parent', jsonb_build_object('email', 'p@example.com', 'name', 'P'),
      'children', jsonb_build_array(jsonb_build_object('first_name', 'A', 'last_name', 'B', 'dob', '2015-01-01'))));
    perform cot.ok(false, 'public registration into a draft programme is refused');
  exception when others then
    perform cot.ok(sqlerrm like '%PROGRAM_NOT_OPEN%', 'public registration into a draft programme is refused (' || sqlerrm || ')');
  end;

  -- status sync: archiving
  update public.programs set status = 'archived' where id = '90b00000-0000-0000-0000-000000000001';
  perform cot.ok((select not is_active and archived_at is not null from public.programs where id = '90b00000-0000-0000-0000-000000000001'), 'archived programme is inactive with archived_at');
  perform cot.ok(exists (select 1 from public.audit_logs where target_table = 'programs' and target_id = '90b00000-0000-0000-0000-000000000001' and action = 'UPDATE'), 'programme changes are audit-logged');

  -- ===================== EVENTS ============================================
  v := cot.run_as(a_admin, $q$with u as (update public.events set status = 'cancelled', cancel_reason = 'Gym closed' where id = 'ebb00000-0000-0000-0000-000000000001' returning cancelled_by::text) select * from u$q$);
  perform cot.ok(v = 'OK:a0b00000-0000-0000-0000-0000000000a1', 'cancelling stamps who cancelled (' || v || ')');
  v := cot.run_as(a_admin, $q$with u as (update public.events set status = 'scheduled' where id = 'ebb00000-0000-0000-0000-000000000001' returning coalesce(cancel_reason, 'cleared')) select * from u$q$);
  perform cot.ok(v = 'OK:cleared', 'reinstating clears the cancellation reason (' || v || ')');
  v := cot.run_as(b_admin, $q$with u as (update public.events set title = 'x' where series_id = '5eb00000-0000-0000-0000-000000000001' returning 1) select count(*)::text from u$q$);
  perform cot.ok(v = 'OK:0', 'cross-tenant: org B admin cannot edit org A''s series (' || v || ')');
  perform cot.ok(exists (select 1 from public.audit_logs where target_table = 'events' and target_id = 'ebb00000-0000-0000-0000-000000000001'), 'event changes are audit-logged');

  -- ===================== ATTENDANCE ========================================
  v := cot.run_as(a_admin, format($q$select (public.correct_attendance(%L, '[{"athlete_id":"e0b00000-0000-0000-0000-000000000001","status":"late","notes":"knee sore"},{"athlete_id":"e0b00000-0000-0000-0000-000000000003","status":"present"}]'::jsonb, 'arrived late'))->>'changed'$q$, sess));
  perform cot.ok(v = 'OK:2', 'admin corrects a submitted session and adds a late arrival (' || v || ')');
  perform cot.ok((select status::text from public.attendance_marks where attendance_session_id = sess::uuid and athlete_id = 'e0b00000-0000-0000-0000-000000000001') = 'late', 'mark changed to late');
  perform cot.ok((select corrected_by from public.attendance_marks where attendance_session_id = sess::uuid and athlete_id = 'e0b00000-0000-0000-0000-000000000001') = a_admin, 'mark records who corrected it');
  select count(*) into n from public.audit_logs where target_table = 'attendance_marks' and new_data->>'session_id' = sess
     and action in ('attendance.correct', 'attendance.mark_added') and actor_id = a_admin;
  perform cot.ok(n = 2, 'each correction is audited with the actor (' || n || ')');
  perform cot.ok(not exists (select 1 from public.audit_logs where target_table = 'attendance_marks' and (coalesce(old_data::text, '') || coalesce(new_data::text, '')) like '%knee sore%'),
                 'private note text is never copied into audit_logs');
  perform cot.ok((select correction_count from public.attendance_sessions where id = sess::uuid) = 2, 'session counts corrections');

  v := cot.run_as(a_coach, format($q$select (public.correct_attendance(%L, '[{"athlete_id":"e0b00000-0000-0000-0000-000000000001","status":"present"}]'::jsonb, null))->>'changed'$q$, sess));
  perform cot.ok(v = 'OK:1', 'the session''s coach can correct (' || v || ')');
  v := cot.run_as(a_coach2, format($q$select (public.correct_attendance(%L, '[{"athlete_id":"e0b00000-0000-0000-0000-000000000001","status":"absent"}]'::jsonb, null))->>'changed'$q$, sess));
  perform cot.ok(v like 'ERR:%NOT_AUTHORIZED%', 'another coach cannot correct (' || v || ')');
  v := cot.run_as(a_parent, format($q$select (public.correct_attendance(%L, '[{"athlete_id":"e0b00000-0000-0000-0000-000000000001","status":"present"}]'::jsonb, null))->>'changed'$q$, sess));
  perform cot.ok(v like 'ERR:%NOT_AUTHORIZED%', 'a parent cannot correct (' || v || ')');
  v := cot.run_as(b_admin, format($q$select (public.correct_attendance(%L, '[{"athlete_id":"e0b00000-0000-0000-0000-000000000001","status":"present"}]'::jsonb, null))->>'changed'$q$, sess));
  perform cot.ok(v like 'ERR:%SESSION_NOT_FOUND%', 'cross-tenant: org B admin cannot correct org A attendance (' || v || ')');
  v := cot.run_as(b_admin, format($q$select (public.reopen_attendance_session(%L, null))->>'status'$q$, sess));
  perform cot.ok(v like 'ERR:%SESSION_NOT_FOUND%', 'cross-tenant: org B admin cannot reopen org A attendance (' || v || ')');
  v := cot.run_as(a_admin, format($q$select (public.correct_attendance(%L, '[{"athlete_id":"e0b00000-0000-0000-0000-000000000001","status":"maybe"}]'::jsonb, null))->>'changed'$q$, sess));
  perform cot.ok(v like 'ERR:%INVALID_STATUS%', 'invalid status rejected (' || v || ')');

  -- coach roster save on a submitted session is audited
  v := cot.run_as(a_coach, format($q$select (public.save_attendance(%L, '[{"athlete_id":"e0b00000-0000-0000-0000-000000000003","status":"excused"}]'::jsonb, false))->>'excused'$q$, sess));
  perform cot.ok(v = 'OK:1', 'coach saves on a submitted session (' || v || ')');
  perform cot.ok(exists (select 1 from public.audit_logs where target_table = 'attendance_marks' and actor_id = a_coach and new_data->>'status' = 'excused'),
                 'post-submission roster save is audited');

  -- clear a mark
  v := cot.run_as(a_admin, format($q$select (public.correct_attendance(%L, '[{"athlete_id":"e0b00000-0000-0000-0000-000000000003","status":null}]'::jsonb, 'marked by mistake'))->>'changed'$q$, sess));
  perform cot.ok(v = 'OK:1', 'admin removes a mark (' || v || ')');

  -- reopen rules
  update public.attendance_sessions set status = 'locked' where id = sess::uuid;
  v := cot.run_as(a_coach, format($q$select (public.reopen_attendance_session(%L, null))->>'status'$q$, sess));
  perform cot.ok(v like 'ERR:%SESSION_LOCKED%', 'coach cannot reopen a locked session (' || v || ')');
  v := cot.run_as(a_coach, format($q$select (public.correct_attendance(%L, '[{"athlete_id":"e0b00000-0000-0000-0000-000000000001","status":"absent"}]'::jsonb, null))->>'changed'$q$, sess));
  perform cot.ok(v like 'ERR:%SESSION_LOCKED%', 'coach cannot correct a locked session (' || v || ')');
  v := cot.run_as(a_admin, format($q$select (public.reopen_attendance_session(%L, 'late paperwork'))->>'status'$q$, sess));
  perform cot.ok(v = 'OK:open', 'admin reopens a locked session (' || v || ')');
  perform cot.ok(exists (select 1 from public.audit_logs where action = 'attendance.reopen' and target_id = sess::uuid and actor_id = a_admin), 'reopen is audited');
  v := cot.run_as(a_admin, format($q$select (public.reopen_attendance_session(%L, null))->>'status'$q$, sess));
  perform cot.ok(v like 'ERR:%ALREADY_OPEN%', 'reopening an open session is refused (' || v || ')');

  -- ===================== BOOKINGS ==========================================
  v := cot.run_as(a_admin, $q$select (public.admin_update_booking('bbb00000-0000-0000-0000-000000000001', '5cb00000-0000-0000-0000-000000000002',
        'c0b00000-0000-0000-0000-000000000002', date_trunc('hour', now()) + interval '4 days', null, 'booked', 'moved by office'))->>'status'$q$);
  perform cot.ok(v = 'OK:booked', 'admin moves a booking to another coach, time and service (' || v || ')');
  perform cot.ok((select not is_booked from public.coach_availability where id = 'cab00000-0000-0000-0000-000000000001'), 'old slot freed');
  perform cot.ok((select is_booked from public.coach_availability where id = 'cab00000-0000-0000-0000-000000000002'), 'matching new slot taken');
  perform cot.ok((select slot_end - slot_start from public.training_bookings where id = 'bbb00000-0000-0000-0000-000000000001') = interval '45 minutes', 'end defaults to the new service duration');

  v := cot.run_as(a_admin, $q$select (public.admin_update_booking('bbb00000-0000-0000-0000-000000000001', '5cb00000-0000-0000-0000-000000000002',
        'c0b00000-0000-0000-0000-000000000002', date_trunc('hour', now()) + interval '5 days' + interval '30 minutes', null, 'booked', null))->>'status'$q$);
  perform cot.ok(v like 'ERR:%COACH_BUSY%', 'refuses to double-book the coach (' || v || ')');
  v := cot.run_as(a_admin, $q$select (public.admin_update_booking('bbb00000-0000-0000-0000-000000000001', '5cb00000-0000-0000-0000-0000000000b1',
        'c0b00000-0000-0000-0000-000000000002', date_trunc('hour', now()) + interval '4 days', null, 'booked', null))->>'status'$q$);
  perform cot.ok(v like 'ERR:%SERVICE_NOT_FOUND%', 'refuses another club''s service (' || v || ')');
  v := cot.run_as(a_coach, $q$select (public.admin_update_booking('bbb00000-0000-0000-0000-000000000001', '5cb00000-0000-0000-0000-000000000002',
        'c0b00000-0000-0000-0000-000000000002', date_trunc('hour', now()) + interval '4 days', null, 'completed', null))->>'status'$q$);
  perform cot.ok(v like 'ERR:%NOT_AUTHORIZED%', 'a coach cannot use the admin booking edit (' || v || ')');
  v := cot.run_as(b_admin, $q$select (public.admin_update_booking('bbb00000-0000-0000-0000-000000000001', '5cb00000-0000-0000-0000-000000000002',
        'c0b00000-0000-0000-0000-000000000002', date_trunc('hour', now()) + interval '4 days', null, 'completed', null))->>'status'$q$);
  perform cot.ok(v like 'ERR:%BOOKING_NOT_FOUND%', 'cross-tenant: org B admin cannot edit org A booking (' || v || ')');

  v := cot.run_as(a_admin, $q$select (public.admin_cancel_booking('bbb00000-0000-0000-0000-000000000002', '  '))->>'status'$q$);
  perform cot.ok(v like 'ERR:%REASON_REQUIRED%', 'cancel needs a reason (' || v || ')');
  v := cot.run_as(b_admin, $q$select (public.admin_cancel_booking('bbb00000-0000-0000-0000-000000000002', 'nope'))->>'status'$q$);
  perform cot.ok(v like 'ERR:%BOOKING_NOT_FOUND%', 'cross-tenant: org B admin cannot cancel org A booking (' || v || ')');
  v := cot.run_as(a_parent, $q$select (public.admin_cancel_booking('bbb00000-0000-0000-0000-000000000002', 'nope'))->>'status'$q$);
  perform cot.ok(v like 'ERR:%NOT_AUTHORIZED%', 'a parent cannot use the admin cancel (' || v || ')');
  v := cot.run_as(a_admin, $q$select (public.admin_cancel_booking('bbb00000-0000-0000-0000-000000000002', 'Coach ill'))->>'status'$q$);
  perform cot.ok(v = 'OK:cancelled', 'admin cancels with a reason (' || v || ')');
  perform cot.ok((select cancel_reason = 'Coach ill' and cancelled_by = a_admin and cancelled_at is not null from public.training_bookings where id = 'bbb00000-0000-0000-0000-000000000002'),
                 'reason, actor and time stored');
  v := cot.run_as(a_admin, $q$select (public.admin_update_booking('bbb00000-0000-0000-0000-000000000002', '5cb00000-0000-0000-0000-000000000001',
        'c0b00000-0000-0000-0000-000000000002', date_trunc('hour', now()) + interval '6 days', null, 'booked', null))->>'status'$q$);
  perform cot.ok(v like 'ERR:%NOT_EDITABLE%', 'a cancelled booking cannot be edited back (' || v || ')');
  perform cot.ok(exists (select 1 from public.audit_logs where target_table = 'training_bookings' and target_id = 'bbb00000-0000-0000-0000-000000000002'), 'booking changes are audit-logged');

  -- availability: coach edits own slot, not another coach's
  v := cot.run_as(a_coach2, $q$with u as (update public.coach_availability set ends_at = ends_at + interval '30 minutes' where id = 'cab00000-0000-0000-0000-000000000001' returning 1) select count(*)::text from u$q$);
  perform cot.ok(v = 'OK:0', 'a coach cannot edit another coach''s slot (' || v || ')');
  v := cot.run_as(a_coach, $q$with u as (update public.coach_availability set ends_at = ends_at + interval '30 minutes' where id = 'cab00000-0000-0000-0000-000000000001' returning 1) select count(*)::text from u$q$);
  perform cot.ok(v = 'OK:1', 'a coach edits their own slot (' || v || ')');
  v := cot.run_as(b_admin, $q$with u as (update public.coach_availability set ends_at = ends_at + interval '30 minutes' where id = 'cab00000-0000-0000-0000-000000000001' returning 1) select count(*)::text from u$q$);
  perform cot.ok(v = 'OK:0', 'cross-tenant: org B admin cannot edit org A availability (' || v || ')');
  v := cot.run_as(b_admin, $q$with u as (update public.training_services set name = 'x' where id = '5cb00000-0000-0000-0000-000000000001' returning 1) select count(*)::text from u$q$);
  perform cot.ok(v = 'OK:0', 'cross-tenant: org B admin cannot edit org A services (' || v || ')');
end $$;

-- A parent can't save attendance either (save_attendance null-coach guard).
do $$ declare v text; begin
  v := cot.run_as('a0b00000-0000-0000-0000-0000000000f1', $q$select (public.save_attendance('a5b00000-0000-0000-0000-000000000001', '[{"athlete_id":"e0b00000-0000-0000-0000-000000000001","status":"present"}]'::jsonb, false))->>'total'$q$);
  perform cot.ok(v like 'ERR:%NOT_AUTHORIZED%', 'a parent cannot save attendance (' || v || ')');
end $$;
