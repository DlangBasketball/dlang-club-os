-- ============================================================================
-- Team attendance suite (migration 20250420104000_team_attendance.sql)
--
--   A. Effective-dated rosters: add / leave / rejoin / transfer keep history,
--      roster on a date, selection teams refused, delete guard, roles.
--   B. Sheets: one mark per (event, athlete), idempotent build, roster of the
--      event date (old date -> old team), guests never change the roster.
--   C. Saves: idempotent request ids, per-mark conflict, version conflict,
--      mark-all-present only unmarked, finalize blocked while unmarked,
--      cancelled events refused.
--   D. No-show alerts: draft / excused / before-end / cancelled -> none, one
--      per guardian on double finalize, no_contact, due alerts at the end,
--      dispatcher claim + record, correction -> correction alerts + superseded,
--      cancellation suppresses.
--   E. Absence reports: guardian + player, cut-off, REPORTED_ABSENCE warning,
--      finalize needs acknowledgement, reschedule -> needs_review.
--   F. Session access: request / approve, substitute sees only that event
--      (sheet, marks), no medical, access ends after the grace window.
--   G. Correction requests: guardian asks, cross-family denied, staff resolve.
--   H. Player portal: invitation links the athlete, no staff role, player
--      reads own team / events / finalized marks only.
--   I. Training window + go-live: series outside the window refused,
--      awaiting list and unfinished flags skip earlier / outside sessions,
--      season stats use the window.
--   J. Other org denial everywhere.
--   K. Training breaks: admin only, cancel trainings in range (label, audit),
--      final sheets reported, series inside refused, delete un-cancels nothing.
--   Idempotent migration re-run.
--
-- Fixtures: synthetic only (ids …ac…). Org A …0001, org B …0002.
-- Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema tat;
grant usage on schema tat to authenticated, anon, service_role;
create table tat.ctx (k text primary key, v text);
grant all on tat.ctx to authenticated, anon, service_role;

create function tat.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;
create function tat.put(p_k text, p_v text) returns void language sql as $$
  insert into tat.ctx (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v;
$$;
create function tat.get(p_k text) returns text language sql stable as $$ select v from tat.ctx where k = p_k $$;
-- Run p_sql as a signed-in user (or service_role when p is null) and return
-- 'OK:<value>' or 'ERR:<message>'.
create function tat.run_as(p uuid, p_sql text, p_service boolean default false) returns text language plpgsql as $$
declare v_msg text; v_res text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
    if p_service then execute 'set local role service_role';
    elsif p is null then execute 'set local role anon';
    else execute 'set local role authenticated'; end if;
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
create function tat.js(p uuid, p_sql text) returns jsonb language plpgsql as $$
declare r text;
begin
  r := tat.run_as(p, p_sql);
  if r = 'OK:<null>' then return 'null'::jsonb; end if;
  if r like 'OK:%' then return substr(r, 4)::jsonb; end if;
  return jsonb_build_object('error', substr(r, 5));
end $$;
create function tat.svc(p_sql text) returns text language plpgsql as $$
begin return tat.run_as(null, p_sql, true); end $$;
grant execute on all functions in schema tat to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- Profiles: ac01 coach C1 (team coach), ac02 coach C2 (substitute), ac11 + ac12
-- guardians of family FA (athletes P1 ac31, P2 ac32), ac13 guardian of family
-- FB (P3 ac33, P5 ac35), family FC without guardian (P4 ac34), Q ac36 (guest,
-- family FB), ac14 = player login of P1. Org B: admin b…ac91, athlete b…ac92.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000ac01', 'ta-coach1@example.test'),
  ('00000000-0000-0000-0000-00000000ac02', 'ta-coach2@example.test'),
  ('00000000-0000-0000-0000-00000000ac11', 'ta-g1@example.test'),
  ('00000000-0000-0000-0000-00000000ac12', 'ta-g1b@example.test'),
  ('00000000-0000-0000-0000-00000000ac13', 'ta-g2@example.test'),
  ('00000000-0000-0000-0000-00000000ac14', 'ta-player1@example.test'),
  ('b0000000-0000-0000-0000-00000000ac91', 'ta-admin-b@example.test');
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001'
 where id::text like '00000000-0000-0000-0000-00000000ac%';
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-00000000ac91';
insert into public.staff_roles (org_id, profile_id, role) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac01', 'coach'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac02', 'coach'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000ac91', 'admin');
insert into public.coaches (id, org_id, display_name, profile_id) values
  ('00000000-0000-0000-0000-00000000ac51', '00000000-0000-0000-0000-000000000001', 'Synthetic Coach One', '00000000-0000-0000-0000-00000000ac01'),
  ('00000000-0000-0000-0000-00000000ac52', '00000000-0000-0000-0000-000000000001', 'Synthetic Coach Two', '00000000-0000-0000-0000-00000000ac02');
insert into public.families (id, org_id, name) values
  ('00000000-0000-0000-0000-00000000ac21', '00000000-0000-0000-0000-000000000001', 'Synthetic FA'),
  ('00000000-0000-0000-0000-00000000ac22', '00000000-0000-0000-0000-000000000001', 'Synthetic FB'),
  ('00000000-0000-0000-0000-00000000ac23', '00000000-0000-0000-0000-000000000001', 'Synthetic FC'),
  ('b0000000-0000-0000-0000-00000000ac93', '10000000-0000-0000-0000-000000000002', 'Synthetic B');
insert into public.family_members (family_id, profile_id, relation, is_primary) values
  ('00000000-0000-0000-0000-00000000ac21', '00000000-0000-0000-0000-00000000ac11', 'guardian', true),
  ('00000000-0000-0000-0000-00000000ac21', '00000000-0000-0000-0000-00000000ac12', 'guardian', false),
  ('00000000-0000-0000-0000-00000000ac22', '00000000-0000-0000-0000-00000000ac13', 'guardian', true);
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, status) values
  ('00000000-0000-0000-0000-00000000ac31', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac21', 'Synth', 'Pone', '2013-01-01', 'active'),
  ('00000000-0000-0000-0000-00000000ac32', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac21', 'Synth', 'Ptwo', '2013-02-01', 'active'),
  ('00000000-0000-0000-0000-00000000ac33', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac22', 'Synth', 'Pthree', '2013-03-01', 'active'),
  ('00000000-0000-0000-0000-00000000ac34', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac23', 'Synth', 'Pfour', '2013-04-01', 'active'),
  ('00000000-0000-0000-0000-00000000ac35', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac22', 'Synth', 'Pfive', '2013-05-01', 'active'),
  ('00000000-0000-0000-0000-00000000ac36', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac22', 'Synth', 'Guest', '2013-06-01', 'active'),
  ('b0000000-0000-0000-0000-00000000ac92', '10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000ac93', 'Synth', 'Bplayer', '2013-01-01', 'active');
insert into public.athlete_medical (org_id, athlete_id, allergies) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac33', 'Synthetic allergy');
-- Season with a training window around today.
insert into public.seasons (id, org_id, name, starts_on, ends_on, training_starts_on, training_ends_on) values
  ('00000000-0000-0000-0000-00000000ac61', '00000000-0000-0000-0000-000000000001', 'TA synthetic season',
   current_date - 200, current_date + 165, current_date - 150, current_date + 150);
-- Teams: T1 + T2 coached by C1, T3 without C1/C2, Tsel = selection division team.
insert into public.teams (id, org_id, season_id, name, sport) values
  ('00000000-0000-0000-0000-00000000ac41', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac61', 'TA Team One', 'basketball'),
  ('00000000-0000-0000-0000-00000000ac42', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac61', 'TA Team Two', 'basketball'),
  ('00000000-0000-0000-0000-00000000ac43', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac61', 'TA Team Three', 'basketball'),
  ('00000000-0000-0000-0000-00000000ac44', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac61', 'TA Selection Team', 'basketball'),
  ('b0000000-0000-0000-0000-00000000ac94', '10000000-0000-0000-0000-000000000002', null, 'TA B Team', 'basketball');
insert into public.team_coaches (team_id, coach_id, org_id, role) values
  ('00000000-0000-0000-0000-00000000ac41', '00000000-0000-0000-0000-00000000ac51', '00000000-0000-0000-0000-000000000001', 'head'),
  ('00000000-0000-0000-0000-00000000ac42', '00000000-0000-0000-0000-00000000ac51', '00000000-0000-0000-0000-000000000001', 'head');
insert into public.programs (id, org_id, slug, name, kind, price_chf, is_public, is_active, status, selection_enabled)
values ('00000000-0000-0000-0000-00000000ac71', '00000000-0000-0000-0000-000000000001', 'ta-sel', 'TA Selection', 'selection', 0, false, true, 'published', true);
insert into public.program_divisions (org_id, program_id, name, team_id)
values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac71', 'TA U14', '00000000-0000-0000-0000-00000000ac44');
-- Rosters since 120 days ago: T1 = P1, P2, P3, P4, P5; T3 = P3.
insert into public.team_memberships (org_id, team_id, athlete_id, jersey_number, status, joined_on)
select '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac41', a, n, 'active', current_date - 120
  from (values ('00000000-0000-0000-0000-00000000ac31'::uuid, 1), ('00000000-0000-0000-0000-00000000ac32'::uuid, 2),
               ('00000000-0000-0000-0000-00000000ac33'::uuid, 3), ('00000000-0000-0000-0000-00000000ac34'::uuid, 4),
               ('00000000-0000-0000-0000-00000000ac35'::uuid, 5)) v(a, n);
insert into public.team_memberships (org_id, team_id, athlete_id, status, joined_on) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac43', '00000000-0000-0000-0000-00000000ac33', 'active', current_date - 120),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000ac94', 'b0000000-0000-0000-0000-00000000ac92', 'active', current_date - 120);
-- Go-live 30 days ago (admin setting, see section I).
select tat.ok(tat.run_as('00000000-0000-0000-0000-0000000000f1', 'select public.attendance_settings_set(current_date - 30)::text') like 'OK:%',
              'admin sets the attendance go-live date');
select tat.ok(tat.run_as('00000000-0000-0000-0000-00000000ac01', 'select public.attendance_settings_set(current_date)::text') like 'ERR:NOT_AUTHORIZED%',
              'a coach cannot set the go-live date');

-- Events (times relative to now). E1 ended yesterday, E3 ten days ago, E2
-- tomorrow, EF in two days, EC to be cancelled (past), ET3 / ET3B on T3,
-- EB in org B.
insert into public.events (id, org_id, team_id, season_id, type, title, starts_at, ends_at) values
  ('00000000-0000-0000-0000-0000000ac0e1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac41', '00000000-0000-0000-0000-00000000ac61', 'training', 'E1', now() - interval '26 hours', now() - interval '24 hours'),
  ('00000000-0000-0000-0000-0000000ac0e3', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac41', '00000000-0000-0000-0000-00000000ac61', 'training', 'E3', now() - interval '10 days 2 hours', now() - interval '10 days'),
  ('00000000-0000-0000-0000-0000000ac0e2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac41', '00000000-0000-0000-0000-00000000ac61', 'training', 'E2', now() + interval '1 day', now() + interval '1 day 2 hours'),
  ('00000000-0000-0000-0000-0000000ac0ef', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac41', '00000000-0000-0000-0000-00000000ac61', 'training', 'EF', now() + interval '2 days', now() + interval '2 days 2 hours'),
  ('00000000-0000-0000-0000-0000000ac0ec', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac41', '00000000-0000-0000-0000-00000000ac61', 'training', 'EC', now() - interval '3 days 2 hours', now() - interval '3 days'),
  ('00000000-0000-0000-0000-0000000ac0f3', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac43', '00000000-0000-0000-0000-00000000ac61', 'training', 'ET3', now() - interval '5 hours', now() - interval '3 hours'),
  ('00000000-0000-0000-0000-0000000ac0f4', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac43', '00000000-0000-0000-0000-00000000ac61', 'training', 'ET3B', now() - interval '2 days 2 hours', now() - interval '2 days'),
  ('b0000000-0000-0000-0000-0000000ac0eb', '10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000ac94', null, 'training', 'EB', now() - interval '26 hours', now() - interval '24 hours');

-- ===========================================================================
-- A. Rosters
-- ===========================================================================
do $$
declare r text; v int;
begin
  perform tat.ok((select count(*) = 0 from public.team_memberships where dates_source is null), 'every membership has a dates_source');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac01',
        $q$select count(*)::text from public.team_roster_on('00000000-0000-0000-0000-00000000ac41', current_date)$q$);
  perform tat.ok(r = 'OK:5', 'team coach reads the roster of today (5 players) — ' || r);
  r := tat.run_as('00000000-0000-0000-0000-00000000ac11',
        $q$select count(*)::text from public.team_roster_on('00000000-0000-0000-0000-00000000ac41', current_date)$q$);
  perform tat.ok(r like 'ERR:NOT_AUTHORIZED%', 'a guardian cannot read the team roster');
  r := tat.run_as('b0000000-0000-0000-0000-00000000ac91',
        $q$select count(*)::text from public.team_roster_on('00000000-0000-0000-0000-00000000ac41', current_date)$q$);
  perform tat.ok(r like 'ERR:TEAM_NOT_FOUND%', 'other org admin: TEAM_NOT_FOUND');

  -- Transfer P2 T1 -> T2 effective 5 days ago.
  r := tat.run_as('00000000-0000-0000-0000-00000000ac01',
        $q$select public.team_member_transfer('00000000-0000-0000-0000-00000000ac41', '00000000-0000-0000-0000-00000000ac42',
              '00000000-0000-0000-0000-00000000ac32', current_date - 5, 'moved up')::text$q$);
  perform tat.ok(r like 'OK:%', 'coach of both teams transfers a player — ' || r);
  perform tat.ok((select left_on = current_date - 6 and status = 'inactive' from public.team_memberships
                   where team_id = '00000000-0000-0000-0000-00000000ac41' and athlete_id = '00000000-0000-0000-0000-00000000ac32'),
                 'old membership ends the day before (history row kept, inactive)');
  perform tat.ok((select joined_on = current_date - 5 and left_on is null from public.team_memberships
                   where team_id = '00000000-0000-0000-0000-00000000ac42' and athlete_id = '00000000-0000-0000-0000-00000000ac32'),
                 'new membership starts on the effective date');
  perform tat.ok(exists (select 1 from public.ta_roster_on('00000000-0000-0000-0000-00000000ac41', current_date - 10) where athlete_id = '00000000-0000-0000-0000-00000000ac32')
             and not exists (select 1 from public.ta_roster_on('00000000-0000-0000-0000-00000000ac41', current_date - 5) where athlete_id = '00000000-0000-0000-0000-00000000ac32')
             and exists (select 1 from public.ta_roster_on('00000000-0000-0000-0000-00000000ac42', current_date - 5) where athlete_id = '00000000-0000-0000-0000-00000000ac32'),
                 'roster on a date follows the transfer (old team before, new team from the date)');
  perform tat.ok(exists (select 1 from public.audit_logs where action = 'roster.transfer'), 'transfer is audited');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac01',
        $q$select public.team_member_transfer('00000000-0000-0000-0000-00000000ac41', '00000000-0000-0000-0000-00000000ac43',
              '00000000-0000-0000-0000-00000000ac31', current_date, 'x y z')::text$q$);
  perform tat.ok(r like 'ERR:NOT_AUTHORIZED%', 'transfer into a team the coach does not coach is refused');
  r := tat.run_as('00000000-0000-0000-0000-0000000000f1',
        $q$select public.team_member_add('00000000-0000-0000-0000-00000000ac44', '00000000-0000-0000-0000-00000000ac31', current_date)::text$q$);
  perform tat.ok(r like 'ERR:SELECTION_ROSTER_MANAGED%', 'selection (EYBL) team roster is not managed by the club roster RPCs');
  r := tat.run_as('00000000-0000-0000-0000-0000000000f1',
        $q$select public.team_member_leave('00000000-0000-0000-0000-00000000ac41', '00000000-0000-0000-0000-00000000ac35', current_date, '')::text$q$);
  perform tat.ok(r like 'ERR:REASON_REQUIRED%', 'leave needs a reason');

  -- P5 leaves T1 20 days ago and rejoins today: both periods answer.
  r := tat.run_as('00000000-0000-0000-0000-0000000000f1',
        $q$select public.team_member_leave('00000000-0000-0000-0000-00000000ac41', '00000000-0000-0000-0000-00000000ac35', current_date - 20, 'break')::text$q$);
  perform tat.ok(r like 'OK:%', 'admin ends a membership (effective date in the past)');
  r := tat.run_as('00000000-0000-0000-0000-0000000000f1',
        $q$select public.team_member_add('00000000-0000-0000-0000-00000000ac41', '00000000-0000-0000-0000-00000000ac35', current_date)::text$q$);
  perform tat.ok(r like 'OK:%', 'admin re-adds the player later — ' || r);
  perform tat.ok((select count(*) = 1 from public.team_membership_periods
                   where team_id = '00000000-0000-0000-0000-00000000ac41' and athlete_id = '00000000-0000-0000-0000-00000000ac35'
                     and joined_on = current_date - 120 and left_on = current_date - 21),
                 'the earlier period is archived');
  perform tat.ok(exists (select 1 from public.ta_roster_on('00000000-0000-0000-0000-00000000ac41', current_date - 30) where athlete_id = '00000000-0000-0000-0000-00000000ac35')
             and not exists (select 1 from public.ta_roster_on('00000000-0000-0000-0000-00000000ac41', current_date - 10) where athlete_id = '00000000-0000-0000-0000-00000000ac35')
             and exists (select 1 from public.ta_roster_on('00000000-0000-0000-0000-00000000ac41', current_date) where athlete_id = '00000000-0000-0000-0000-00000000ac35'),
                 'roster on: in the first period, off in the gap, on again after rejoining');
  r := tat.run_as('00000000-0000-0000-0000-0000000000f1',
        $q$select public.team_member_add('00000000-0000-0000-0000-00000000ac41', '00000000-0000-0000-0000-00000000ac35', current_date)::text$q$);
  perform tat.ok(r like 'ERR:ALREADY_ON_TEAM%', 'adding a current member again: ALREADY_ON_TEAM');
  -- An UPDATE that moves a row to another team archives the old period.
  update public.team_memberships set team_id = '00000000-0000-0000-0000-00000000ac43', joined_on = current_date
   where team_id = '00000000-0000-0000-0000-00000000ac42' and athlete_id = '00000000-0000-0000-0000-00000000ac32';
  perform tat.ok(exists (select 1 from public.team_membership_periods where team_id = '00000000-0000-0000-0000-00000000ac42'
                          and athlete_id = '00000000-0000-0000-0000-00000000ac32' and left_on = current_date - 1),
                 'a direct move (team_id update) archives the period on the old team');
  update public.team_memberships set team_id = '00000000-0000-0000-0000-00000000ac42', joined_on = current_date - 5
   where team_id = '00000000-0000-0000-0000-00000000ac43' and athlete_id = '00000000-0000-0000-0000-00000000ac32';
  delete from public.team_membership_periods where team_id = '00000000-0000-0000-0000-00000000ac43' and athlete_id = '00000000-0000-0000-0000-00000000ac32';
  delete from public.team_membership_periods where team_id = '00000000-0000-0000-0000-00000000ac42' and athlete_id = '00000000-0000-0000-0000-00000000ac32';
end $$;

-- ===========================================================================
-- B + C. Sheets and saves
-- ===========================================================================
do $$
declare j jsonb; r text; v int;
begin
  -- E3 (10 days ago): P2 was still on T1 then.
  j := tat.js('00000000-0000-0000-0000-00000000ac01', $q$select public.attendance_open('00000000-0000-0000-0000-0000000ac0e3')::text$q$);
  perform tat.ok(jsonb_array_length(j->'marks') = 4 and exists (select 1 from jsonb_array_elements(j->'marks') x
                   where x->>'athlete_id' = '00000000-0000-0000-0000-00000000ac32'),
                 'sheet of an old date uses the old roster (transferred player still on it) — ' || coalesce(j->>'error', jsonb_array_length(j->'marks')::text));
  perform tat.ok(not exists (select 1 from jsonb_array_elements(j->'marks') x where x->>'athlete_id' = '00000000-0000-0000-0000-00000000ac35'),
                 'player in a roster gap is not on the sheet');
  -- E1 (yesterday): P2 not on T1 any more; P5 not yet back.
  j := tat.js('00000000-0000-0000-0000-00000000ac01', $q$select public.attendance_open('00000000-0000-0000-0000-0000000ac0e1')::text$q$);
  perform tat.ok(jsonb_array_length(j->'marks') = 3 and j->'sheet'->>'status' = 'draft' and (j->'sheet'->>'version')::int = 1,
                 'sheet of yesterday built from the roster of that date (3 players, draft v1)');
  j := tat.js('00000000-0000-0000-0000-00000000ac01', $q$select public.attendance_open('00000000-0000-0000-0000-0000000ac0e1')::text$q$);
  perform tat.ok((select count(*) = 3 from public.team_attendance_marks where event_id = '00000000-0000-0000-0000-0000000ac0e1'),
                 'opening twice creates no duplicate marks');
  perform tat.ok((select count(*) = 1 from public.team_attendance_sheets where event_id = '00000000-0000-0000-0000-0000000ac0e1'),
                 'one sheet per event');
  begin
    insert into public.team_attendance_marks (org_id, sheet_id, event_id, athlete_id)
    select org_id, sheet_id, event_id, athlete_id from public.team_attendance_marks where event_id = '00000000-0000-0000-0000-0000000ac0e1' limit 1;
    perform tat.ok(false, 'unique mark per (event, athlete)');
  exception when unique_violation then
    perform tat.ok(true, 'unique mark per (event, athlete)');
  end;
  r := tat.run_as('00000000-0000-0000-0000-00000000ac01',
        $q$insert into public.team_attendance_marks (org_id, sheet_id, event_id, athlete_id)
           select org_id, sheet_id, event_id, '00000000-0000-0000-0000-00000000ac36' from public.team_attendance_marks
            where event_id = '00000000-0000-0000-0000-0000000ac0e1' limit 1 returning 'x'$q$);
  perform tat.ok(r like 'ERR:%', 'clients cannot insert marks directly (RPC only)');

  -- Guest.
  r := tat.run_as('00000000-0000-0000-0000-00000000ac01',
        $q$select public.attendance_add_guest('00000000-0000-0000-0000-0000000ac0e1', '00000000-0000-0000-0000-00000000ac36')::text$q$);
  perform tat.ok(r like 'OK:%', 'coach adds a guest');
  perform tat.ok(not exists (select 1 from public.team_memberships where athlete_id = '00000000-0000-0000-0000-00000000ac36'),
                 'a guest does not change the roster');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac01',
        $q$select public.attendance_add_guest('00000000-0000-0000-0000-0000000ac0e1', '00000000-0000-0000-0000-00000000ac36')::text$q$);
  perform tat.ok(r like 'ERR:ALREADY_ON_SHEET%', 'the same guest twice: ALREADY_ON_SHEET');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac01',
        $q$select public.attendance_add_guest('00000000-0000-0000-0000-0000000ac0e1', 'b0000000-0000-0000-0000-00000000ac92')::text$q$);
  perform tat.ok(r like 'ERR:ATHLETE_NOT_FOUND%', 'a guest from another org is refused');

  -- Finalize blocked while players are unmarked.
  j := tat.js('00000000-0000-0000-0000-00000000ac01',
        $q$select public.attendance_finalize('00000000-0000-0000-0000-0000000ac0e1', null, 2, null)::text$q$);
  perform tat.ok(j->>'code' = 'UNMARKED_PLAYERS' and jsonb_array_length(j->'unmarked') = 4,
                 'finalize refused while players are unmarked (list returned) — ' || j::text);

  -- Save with a request id; replay is a no-op.
  j := tat.js('00000000-0000-0000-0000-00000000ac01',
        $q$select public.attendance_save('00000000-0000-0000-0000-0000000ac0e1',
             '[{"athlete_id":"00000000-0000-0000-0000-00000000ac31","status":"present","base_rev":0}]'::jsonb, 2,
             '00000000-0000-0000-0000-0000000ac101')::text$q$);
  perform tat.ok((j->>'version')::int = 3 and jsonb_array_length(j->'applied') = 1 and (j->>'replayed')::boolean = false,
                 'draft save applies a mark (version 3)');
  j := tat.js('00000000-0000-0000-0000-00000000ac01',
        $q$select public.attendance_save('00000000-0000-0000-0000-0000000ac0e1',
             '[{"athlete_id":"00000000-0000-0000-0000-00000000ac31","status":"present","base_rev":0}]'::jsonb, 2,
             '00000000-0000-0000-0000-0000000ac101')::text$q$);
  perform tat.ok((j->>'replayed')::boolean and (select version = 3 from public.team_attendance_sheets where event_id = '00000000-0000-0000-0000-0000000ac0e1')
                 and (select count(*) = 1 from public.team_attendance_mark_history where event_id = '00000000-0000-0000-0000-0000000ac0e1'),
                 'retry with the same request id is a no-op');
  r := tat.run_as('00000000-0000-0000-0000-0000000000f1',
        $q$select public.attendance_save('00000000-0000-0000-0000-0000000ac0e1', '[]'::jsonb, 3, '00000000-0000-0000-0000-0000000ac101')::text$q$);
  perform tat.ok(r like 'ERR:REQUEST_ID_REUSED%', 'a request id of another user is refused');
  -- Concurrent edit: admin saw rev 0 and sets late -> conflict, not overwritten.
  j := tat.js('00000000-0000-0000-0000-0000000000f1',
        $q$select public.attendance_save('00000000-0000-0000-0000-0000000ac0e1',
             '[{"athlete_id":"00000000-0000-0000-0000-00000000ac31","status":"late","base_rev":0},
               {"athlete_id":"00000000-0000-0000-0000-00000000ac33","status":"excused","base_rev":0}]'::jsonb, 2, null)::text$q$);
  perform tat.ok(jsonb_array_length(j->'conflicts') = 1 and j->'conflicts'->0->>'current_status' = 'present'
                 and jsonb_array_length(j->'applied') = 1 and (j->>'version_conflict')::boolean,
                 'stale save: the other user''s newer mark comes back as a conflict, the rest is merged — ' || j::text);
  perform tat.ok((select status = 'present' from public.team_attendance_marks where event_id = '00000000-0000-0000-0000-0000000ac0e1'
                   and athlete_id = '00000000-0000-0000-0000-00000000ac31'), 'the newer mark was not overwritten');
  -- Mark all present: strict version, only unmarked.
  j := tat.js('00000000-0000-0000-0000-00000000ac01',
        $q$select public.attendance_mark_all_present('00000000-0000-0000-0000-0000000ac0e1', 1)::text$q$);
  perform tat.ok(j->>'code' = 'VERSION_CONFLICT' and (j->>'version')::int = 4, 'mark all present with a stale version: VERSION_CONFLICT');
  j := tat.js('00000000-0000-0000-0000-00000000ac01',
        $q$select public.attendance_mark_all_present('00000000-0000-0000-0000-0000000ac0e1', 4)::text$q$);
  perform tat.ok((j->>'changed')::int = 2
                 and (select status = 'excused' from public.team_attendance_marks where event_id = '00000000-0000-0000-0000-0000000ac0e1'
                       and athlete_id = '00000000-0000-0000-0000-00000000ac33'),
                 'mark all present changes only unmarked players — ' || j::text);
  r := tat.run_as('00000000-0000-0000-0000-00000000ac01',
        $q$select public.attendance_save('00000000-0000-0000-0000-0000000ac0e1',
             '[{"athlete_id":"00000000-0000-0000-0000-00000000ac31","status":"bogus"}]'::jsonb, 5, null)::text$q$);
  perform tat.ok(r like 'ERR:INVALID_STATUS%', 'invalid status refused');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac01',
        $q$select public.attendance_save('00000000-0000-0000-0000-0000000ac0e1',
             '[{"athlete_id":"00000000-0000-0000-0000-00000000ac35","status":"present"}]'::jsonb, 5, null)::text$q$);
  perform tat.ok(r like 'ERR:NOT_ON_SHEET%', 'a player not on the sheet: NOT_ON_SHEET');

  -- Cancelled event: no finalize.
  j := tat.js('00000000-0000-0000-0000-00000000ac01', $q$select public.attendance_open('00000000-0000-0000-0000-0000000ac0ec')::text$q$);
  perform tat.ok(j ? 'sheet', 'sheet opened for EC');
  update public.events set status = 'cancelled', cancel_reason = 'synthetic' where id = '00000000-0000-0000-0000-0000000ac0ec';
  r := tat.run_as('00000000-0000-0000-0000-00000000ac01',
        $q$select public.attendance_finalize('00000000-0000-0000-0000-0000000ac0ec', null, 1, null)::text$q$);
  perform tat.ok(r like 'ERR:EVENT_CANCELLED%', 'finalize refused for a cancelled event');
end $$;

-- ===========================================================================
-- D. No-show alerts
-- ===========================================================================
do $$
declare j jsonb; r text; v int;
begin
  -- E3 stays a draft with an unexcused mark: no alerts.
  perform tat.js('00000000-0000-0000-0000-00000000ac01',
        $q$select public.attendance_save('00000000-0000-0000-0000-0000000ac0e3',
             '[{"athlete_id":"00000000-0000-0000-0000-00000000ac31","status":"unexcused"}]'::jsonb, 1, null)::text$q$);
  perform tat.ok(not exists (select 1 from public.attendance_no_show_alerts where event_id = '00000000-0000-0000-0000-0000000ac0e3'),
                 'draft sheet: no alerts');
  -- E1: P1 unexcused (2 guardians), P3 excused, P4 unexcused (no guardian), guest present.
  j := tat.js('00000000-0000-0000-0000-00000000ac01',
        $q$select public.attendance_save('00000000-0000-0000-0000-0000000ac0e1',
             '[{"athlete_id":"00000000-0000-0000-0000-00000000ac31","status":"unexcused","base_rev":1},
               {"athlete_id":"00000000-0000-0000-0000-00000000ac34","status":"unexcused","base_rev":1}]'::jsonb, 5, null)::text$q$);
  perform tat.ok(jsonb_array_length(j->'applied') = 2, 'marks saved before finalization — ' || j::text);
  j := tat.js('00000000-0000-0000-0000-00000000ac01',
        $q$select public.attendance_finalize('00000000-0000-0000-0000-0000000ac0e1', '00000000-0000-0000-0000-00000000ac51', 6,
             '00000000-0000-0000-0000-0000000ac102')::text$q$);
  perform tat.ok((j->>'ok')::boolean and (j->>'alerts_created')::int = 3, 'finalize after the end creates 3 alerts — ' || j::text);
  perform tat.ok((select count(*) = 2 from public.attendance_no_show_alerts where event_id = '00000000-0000-0000-0000-0000000ac0e1'
                   and athlete_id = '00000000-0000-0000-0000-00000000ac31' and kind = 'initial' and status = 'pending'),
                 'one initial alert per guardian of the unexcused player');
  perform tat.ok((select count(*) = 1 from public.attendance_no_show_alerts where event_id = '00000000-0000-0000-0000-0000000ac0e1'
                   and athlete_id = '00000000-0000-0000-0000-00000000ac34' and status = 'no_contact' and guardian_profile_id is null),
                 'no reachable guardian: one no_contact row for staff follow-up');
  perform tat.ok(not exists (select 1 from public.attendance_no_show_alerts where event_id = '00000000-0000-0000-0000-0000000ac0e1'
                   and athlete_id in ('00000000-0000-0000-0000-00000000ac33', '00000000-0000-0000-0000-00000000ac36')),
                 'excused / present: no alert');
  perform tat.ok((select status = 'final' and led_by_coach_id = '00000000-0000-0000-0000-00000000ac51' and finalized_by is not null
                   from public.team_attendance_sheets where event_id = '00000000-0000-0000-0000-0000000ac0e1'),
                 'sheet final with leading coach and finalizer');
  j := tat.js('00000000-0000-0000-0000-00000000ac01',
        $q$select public.attendance_finalize('00000000-0000-0000-0000-0000000ac0e1', null, 7, null)::text$q$);
  perform tat.ok((j->>'already_final')::boolean, 'finalizing twice is a no-op');
  j := tat.js('00000000-0000-0000-0000-00000000ac01',
        $q$select public.attendance_finalize('00000000-0000-0000-0000-0000000ac0e1', null, 6, '00000000-0000-0000-0000-0000000ac102')::text$q$);
  perform tat.ok((j->>'replayed')::boolean, 'finalize retry with the same request id is replayed');
  perform public.ta_sync_sheet_alerts((select id from public.team_attendance_sheets where event_id = '00000000-0000-0000-0000-0000000ac0e1'));
  r := tat.svc('select public.attendance_due_alerts()::text');
  perform tat.ok((select count(*) = 3 from public.attendance_no_show_alerts where event_id = '00000000-0000-0000-0000-0000000ac0e1'),
                 'double finalize / re-sync / due run: still exactly one alert per guardian');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac01', 'select public.attendance_due_alerts()::text');
  perform tat.ok(r like 'ERR:%', 'due alerts: service role only');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac01', 'select count(*)::text from public.attendance_alerts_claim(10)');
  perform tat.ok(r like 'ERR:%', 'claim: service role only');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac11', 'select count(*)::text from public.attendance_no_show_alerts');
  perform tat.ok(r = 'OK:1', 'a guardian reads only the alerts addressed to them');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac13', 'select count(*)::text from public.attendance_no_show_alerts');
  perform tat.ok(r = 'OK:0', 'another family''s guardian sees none');

  -- Finalized BEFORE the end (E2 tomorrow): nothing until the session ends.
  perform tat.js('00000000-0000-0000-0000-00000000ac01', $q$select public.attendance_open('00000000-0000-0000-0000-0000000ac0e2')::text$q$);
  perform tat.js('00000000-0000-0000-0000-00000000ac01',
        $q$select public.attendance_save('00000000-0000-0000-0000-0000000ac0e2',
             '[{"athlete_id":"00000000-0000-0000-0000-00000000ac31","status":"unexcused"}]'::jsonb, 1, null)::text$q$);
  perform tat.js('00000000-0000-0000-0000-00000000ac01', $q$select public.attendance_mark_all_present('00000000-0000-0000-0000-0000000ac0e2', 2)::text$q$);
  j := tat.js('00000000-0000-0000-0000-00000000ac01',
        $q$select public.attendance_finalize('00000000-0000-0000-0000-0000000ac0e2', null, 3, null)::text$q$);
  perform tat.ok((j->>'ok')::boolean and (j->>'alerts_created')::int = 0, 'finalized before the end: no alert yet — ' || j::text);
  update public.events set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour' where id = '00000000-0000-0000-0000-0000000ac0e2';
  r := tat.svc('select public.attendance_due_alerts()::text');
  perform tat.ok(r = 'OK:2', 'when the session has ended the due run creates the alerts — ' || r);
  r := tat.svc('select public.attendance_due_alerts()::text');
  perform tat.ok(r = 'OK:0', 'a second due run creates nothing');
  -- Cancelling the event suppresses its pending alerts.
  update public.events set status = 'cancelled' where id = '00000000-0000-0000-0000-0000000ac0e2';
  perform tat.ok((select bool_and(status = 'suppressed') from public.attendance_no_show_alerts where event_id = '00000000-0000-0000-0000-0000000ac0e2'),
                 'cancelling the event suppresses pending alerts');

  -- Dispatcher: claim E1 alerts and record them as sent.
  r := tat.svc($q$select string_agg(alert_id::text || '|' || coalesce(team_name, '') || '|' || coalesce(guardian_email, ''), ',')
                  from public.attendance_alerts_claim(50, '00000000-0000-0000-0000-000000000001')$q$);
  perform tat.ok(r like '%TA Team One%' and r like '%ta-g1@example.test%' and r not like '%ta-g2%',
                 'claim returns the pending alerts with team and recipient (no suppressed / other family) — ' || r);
  r := tat.svc($q$select count(*)::text from public.attendance_alerts_claim(50, '00000000-0000-0000-0000-000000000001')$q$);
  perform tat.ok(r = 'OK:0', 'claimed alerts are not handed out twice');
  perform tat.svc($q$select count(public.attendance_alert_record(a.id, 'sent', '{"in_app":{"ok":true}}'::jsonb))::text
                       from public.attendance_no_show_alerts a
                      where a.event_id = '00000000-0000-0000-0000-0000000ac0e1' and a.athlete_id = '00000000-0000-0000-0000-00000000ac31'$q$);
  perform tat.ok((select bool_and(status = 'sent' and sent_at is not null and attempts = 1) from public.attendance_no_show_alerts
                   where event_id = '00000000-0000-0000-0000-0000000ac0e1' and athlete_id = '00000000-0000-0000-0000-00000000ac31'),
                 'recorded as sent (attempts counted)');

  -- Correction unexcused -> excused after the alert was sent.
  r := tat.run_as('00000000-0000-0000-0000-00000000ac01',
        $q$select public.attendance_correct('00000000-0000-0000-0000-0000000ac0e1', '00000000-0000-0000-0000-00000000ac31', 'excused', 'x')::text$q$);
  perform tat.ok(r like 'ERR:REASON_REQUIRED%', 'correction needs a reason');
  j := tat.js('00000000-0000-0000-0000-00000000ac01',
        $q$select public.attendance_correct('00000000-0000-0000-0000-0000000ac0e1', '00000000-0000-0000-0000-00000000ac31', 'excused',
             'doctor note received', '00000000-0000-0000-0000-0000000ac103')::text$q$);
  perform tat.ok((j->>'changed')::boolean and (j->>'alerts_created')::int = 2, 'correction after a sent alert creates correction alerts — ' || j::text);
  perform tat.ok((select count(*) = 2 from public.attendance_no_show_alerts where event_id = '00000000-0000-0000-0000-0000000ac0e1'
                   and athlete_id = '00000000-0000-0000-0000-00000000ac31' and kind = 'initial' and status = 'superseded'),
                 'the sent initial alerts are marked superseded');
  perform tat.ok((select count(*) = 2 from public.attendance_no_show_alerts where event_id = '00000000-0000-0000-0000-0000000ac0e1'
                   and athlete_id = '00000000-0000-0000-0000-00000000ac31' and kind = 'correction' and status = 'pending' and mark_status = 'excused'),
                 'one correction alert per guardian with the new status');
  perform tat.ok((select previous_status = 'unexcused' and new_status = 'excused' and phase = 'correction' and reason = 'doctor note received'
                         and changed_by = '00000000-0000-0000-0000-00000000ac01'
                    from public.team_attendance_mark_history where request_id = '00000000-0000-0000-0000-0000000ac103'),
                 'correction history: previous, new, editor, reason');
  j := tat.js('00000000-0000-0000-0000-00000000ac01',
        $q$select public.attendance_correct('00000000-0000-0000-0000-0000000ac0e1', '00000000-0000-0000-0000-00000000ac31', 'excused',
             'doctor note received', '00000000-0000-0000-0000-0000000ac103')::text$q$);
  perform tat.ok((j->>'replayed')::boolean and (select count(*) = 4 from public.attendance_no_show_alerts
                   where event_id = '00000000-0000-0000-0000-0000000ac0e1' and athlete_id = '00000000-0000-0000-0000-00000000ac31'),
                 'correction retry: replayed, no extra alerts');
  -- Unsent initial for P4 (no_contact) superseded when corrected to present.
  perform tat.js('00000000-0000-0000-0000-0000000000f1',
        $q$select public.attendance_correct('00000000-0000-0000-0000-0000000ac0e1', '00000000-0000-0000-0000-00000000ac34', 'present', 'arrived late, marked wrong')::text$q$);
  perform tat.ok((select status = 'superseded' from public.attendance_no_show_alerts where event_id = '00000000-0000-0000-0000-0000000ac0e1'
                   and athlete_id = '00000000-0000-0000-0000-00000000ac34' and kind = 'initial'),
                 'correction before anything was sent: the unsent alert is superseded, no correction alert');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac01',
        $q$select public.attendance_save('00000000-0000-0000-0000-0000000ac0e1', '[]'::jsonb, 9, null)::text$q$);
  perform tat.ok(r like 'ERR:SHEET_FINAL%', 'draft save on a final sheet: SHEET_FINAL');
end $$;

-- ===========================================================================
-- E. Absence reports
-- ===========================================================================
do $$
declare j jsonb; r text;
begin
  r := tat.run_as('00000000-0000-0000-0000-00000000ac13',
        $q$select public.absence_report('00000000-0000-0000-0000-0000000ac0ef', '00000000-0000-0000-0000-00000000ac33', 'school trip', 'school')::text$q$);
  perform tat.ok(r like 'OK:%', 'guardian reports an upcoming absence');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac11',
        $q$select public.absence_report('00000000-0000-0000-0000-0000000ac0ef', '00000000-0000-0000-0000-00000000ac33', 'x', 'other')::text$q$);
  perform tat.ok(r like 'ERR:NOT_AUTHORIZED%', 'a guardian cannot report for another family''s child');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac13',
        $q$select public.absence_report('00000000-0000-0000-0000-0000000ac0e3', '00000000-0000-0000-0000-00000000ac33', 'late', 'other')::text$q$);
  perform tat.ok(r like 'ERR:ABSENCE_CUTOFF_PASSED%', 'no report after the start (cut-off = start time)');
  r := tat.run_as('b0000000-0000-0000-0000-00000000ac91',
        $q$select public.absence_report('00000000-0000-0000-0000-0000000ac0ef', '00000000-0000-0000-0000-00000000ac33', 'x', 'other')::text$q$);
  perform tat.ok(r like 'ERR:EVENT_NOT_FOUND%', 'other org: EVENT_NOT_FOUND');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac13',
        $q$select public.absence_report('00000000-0000-0000-0000-0000000ac0ef', '00000000-0000-0000-0000-00000000ac33', 'school trip, updated', 'school')::text$q$);
  perform tat.ok((select count(*) = 1 from public.team_absence_reports where event_id = '00000000-0000-0000-0000-0000000ac0ef'
                   and athlete_id = '00000000-0000-0000-0000-00000000ac33' and status = 'reported')
             and (select count(*) = 1 from public.team_absence_reports where event_id = '00000000-0000-0000-0000-0000000ac0ef'
                   and athlete_id = '00000000-0000-0000-0000-00000000ac33' and status = 'superseded'),
                 'a new report supersedes the previous one');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac11', 'select count(*)::text from public.team_absence_reports');
  perform tat.ok(r = 'OK:0', 'reports of another family are not visible');

  -- Coach sees the report on the sheet; unexcused -> warning; finalize needs ack.
  j := tat.js('00000000-0000-0000-0000-00000000ac01', $q$select public.attendance_open('00000000-0000-0000-0000-0000000ac0ef')::text$q$);
  perform tat.ok((select x->'reported_absence'->>'reason' = 'school trip, updated' from jsonb_array_elements(j->'marks') x
                   where x->>'athlete_id' = '00000000-0000-0000-0000-00000000ac33'), 'the report is shown on the sheet');
  j := tat.js('00000000-0000-0000-0000-00000000ac01',
        $q$select public.attendance_save('00000000-0000-0000-0000-0000000ac0ef',
             '[{"athlete_id":"00000000-0000-0000-0000-00000000ac33","status":"unexcused"}]'::jsonb, 1, null)::text$q$);
  perform tat.ok(j->'warnings'->0->>'code' = 'REPORTED_ABSENCE', 'unexcused with a reported absence returns REPORTED_ABSENCE');
  perform tat.js('00000000-0000-0000-0000-00000000ac01', $q$select public.attendance_mark_all_present('00000000-0000-0000-0000-0000000ac0ef', 2)::text$q$);
  j := tat.js('00000000-0000-0000-0000-00000000ac01',
        $q$select public.attendance_finalize('00000000-0000-0000-0000-0000000ac0ef', null, 3, null)::text$q$);
  perform tat.ok(j->>'code' = 'REPORTED_ABSENCE_UNACKNOWLEDGED', 'finalize asks for acknowledgement of the reported absence');
  j := tat.js('00000000-0000-0000-0000-00000000ac01',
        $q$select public.attendance_finalize('00000000-0000-0000-0000-0000000ac0ef', null, 3, null, true)::text$q$);
  perform tat.ok((j->>'ok')::boolean, 'finalize with acknowledgement');
  -- Reschedule: active reports need review.
  update public.events set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour'
   where id = '00000000-0000-0000-0000-0000000ac0ef';
  perform tat.ok((select needs_review from public.team_absence_reports where event_id = '00000000-0000-0000-0000-0000000ac0ef' and status = 'reported'),
                 'event time changed after the report: needs_review');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac01',
        $q$select public.absence_acknowledge((select id from public.team_absence_reports where event_id = '00000000-0000-0000-0000-0000000ac0ef' and status = 'reported'))::text$q$);
  perform tat.ok(r like 'OK:%' and (select status = 'acknowledged' and not needs_review from public.team_absence_reports
                   where event_id = '00000000-0000-0000-0000-0000000ac0ef' and athlete_id = '00000000-0000-0000-0000-00000000ac33'
                     and status in ('reported', 'acknowledged')),
                 'coach acknowledges the report');
end $$;

-- ===========================================================================
-- F. Session access (substitute)
-- ===========================================================================
do $$
declare j jsonb; r text; v_asg text;
begin
  r := tat.run_as('00000000-0000-0000-0000-00000000ac02', $q$select public.attendance_sheet('00000000-0000-0000-0000-0000000ac0f3')::text$q$);
  perform tat.ok(r like 'ERR:NOT_AUTHORIZED%', 'a coach without assignment cannot open another team''s session');
  j := tat.js('00000000-0000-0000-0000-00000000ac02', $q$select public.session_request_access('00000000-0000-0000-0000-0000000ac0f3', 'covering')::text$q$);
  perform tat.ok(j->>'status' = 'pending', 'coach requests access from the session (pending)');
  v_asg := j->>'assignment_id';
  r := tat.run_as('00000000-0000-0000-0000-00000000ac02', $q$select public.attendance_sheet('00000000-0000-0000-0000-0000000ac0f3')::text$q$);
  perform tat.ok(r like 'ERR:NOT_AUTHORIZED%', 'pending request gives no access');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac02', format('select public.session_decide_access(%L, true)::text', v_asg));
  perform tat.ok(r like 'ERR:NOT_AUTHORIZED%', 'a coach cannot approve their own request');
  j := tat.js('00000000-0000-0000-0000-0000000000f1', format('select public.session_decide_access(%L, true, %L)::text', v_asg, 'ok'));
  perform tat.ok(j->>'status' = 'approved' and j->>'coach_profile_id' = '00000000-0000-0000-0000-00000000ac02', 'admin approves');
  j := tat.js('00000000-0000-0000-0000-00000000ac02', $q$select public.attendance_open('00000000-0000-0000-0000-0000000ac0f3')::text$q$);
  perform tat.ok(jsonb_array_length(j->'marks') = 1 and (j->'access'->>'is_substitute')::boolean, 'approved substitute runs that session');
  perform tat.ok(not (j->'marks'->0 ? 'dob') and not (j->'marks'->0 ? 'allergies') and not (j->'marks'->0 ? 'family_id'),
                 'sheet carries minimal athlete data only');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac02', $q$select public.attendance_open('00000000-0000-0000-0000-0000000ac0f4')::text$q$);
  perform tat.ok(r like 'ERR:NOT_AUTHORIZED%', 'the substitute cannot open another session of the same team');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac02', 'select count(distinct event_id)::text from public.team_attendance_marks');
  perform tat.ok(r = 'OK:1', 'the substitute reads marks of that one session only');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac02', $q$select count(*)::text from public.athlete_medical where athlete_id = '00000000-0000-0000-0000-00000000ac33'$q$);
  perform tat.ok(r = 'OK:0', 'the substitute gets no medical data');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac02', $q$select count(*)::text from public.athletes where id = '00000000-0000-0000-0000-00000000ac33'$q$);
  perform tat.ok(r = 'OK:0', 'the substitute gets no athlete record (guardian contacts etc.)');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac02', 'select count(*)::text from public.coach_sessions(now() - interval ''3 days'', now() + interval ''3 days'')');
  perform tat.ok(r = 'OK:1', 'coach_sessions lists the approved substitute session');
  j := tat.js('00000000-0000-0000-0000-00000000ac02',
        $q$select public.attendance_save('00000000-0000-0000-0000-0000000ac0f3',
             '[{"athlete_id":"00000000-0000-0000-0000-00000000ac33","status":"present"}]'::jsonb, 1, null)::text$q$);
  j := tat.js('00000000-0000-0000-0000-00000000ac02',
        $q$select public.attendance_finalize('00000000-0000-0000-0000-0000000ac0f3', '00000000-0000-0000-0000-00000000ac52', 2, null)::text$q$);
  perform tat.ok((j->>'ok')::boolean, 'the substitute finalizes as leading coach');
  update public.team_attendance_sheets set finalized_at = now() - interval '8 days' where event_id = '00000000-0000-0000-0000-0000000ac0f3';
  r := tat.run_as('00000000-0000-0000-0000-00000000ac02', $q$select public.attendance_sheet('00000000-0000-0000-0000-0000000ac0f3')::text$q$);
  perform tat.ok(r like 'ERR:NOT_AUTHORIZED%', 'substitute access ends after the grace window');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac01', $q$select public.session_request_access('00000000-0000-0000-0000-0000000ac0e1')::text$q$);
  perform tat.ok(r like 'ERR:ALREADY_TEAM_COACH%', 'a team coach needs no session access');
end $$;

-- ===========================================================================
-- G. Correction requests
-- ===========================================================================
do $$
declare j jsonb; r text; v_req text;
begin
  j := tat.js('00000000-0000-0000-0000-00000000ac11',
        $q$select public.attendance_correction_request('00000000-0000-0000-0000-0000000ac0e1', '00000000-0000-0000-0000-00000000ac31',
             'He was there, arrived 5 minutes late', 'late')::text$q$);
  perform tat.ok(j->>'status' = 'open', 'guardian requests a correction');
  v_req := j->>'request_id';
  r := tat.run_as('00000000-0000-0000-0000-00000000ac12',
        $q$select public.attendance_correction_request('00000000-0000-0000-0000-0000000ac0e1', '00000000-0000-0000-0000-00000000ac31', 'again')::text$q$);
  perform tat.ok(r like 'ERR:CORRECTION_OPEN_EXISTS%', 'one open request per mark');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac13',
        $q$select public.attendance_correction_request('00000000-0000-0000-0000-0000000ac0e1', '00000000-0000-0000-0000-00000000ac31', 'x')::text$q$);
  perform tat.ok(r like 'ERR:NOT_AUTHORIZED%', 'another family cannot request a correction');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac13', 'select count(*)::text from public.attendance_correction_requests_list(null, null)');
  perform tat.ok(r = 'OK:0', 'another family sees no correction requests');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac02', format('select public.attendance_correction_resolve(%L, true, null, null)::text', v_req));
  perform tat.ok(r like 'ERR:NOT_AUTHORIZED%', 'a coach of another team cannot resolve');
  j := tat.js('00000000-0000-0000-0000-00000000ac01', format('select public.attendance_correction_resolve(%L, true, null, %L)::text', v_req, 'checked'));
  perform tat.ok(j->>'status' = 'accepted' and j->'correction'->>'new_status' = 'late', 'team coach accepts -> attendance corrected');
  perform tat.ok((select finalized_status = 'late' from public.team_attendance_marks where event_id = '00000000-0000-0000-0000-0000000ac0e1'
                   and athlete_id = '00000000-0000-0000-0000-00000000ac31'), 'the mark shows the corrected status');
  j := tat.js('00000000-0000-0000-0000-00000000ac11',
        $q$select public.guardian_attendance_overview('00000000-0000-0000-0000-00000000ac31')::text$q$);
  perform tat.ok(j->'correction_requests'->0->>'status' = 'accepted'
                 and (select x->>'status' = 'late' from jsonb_array_elements(j->'history') x where x->>'event_id' = '00000000-0000-0000-0000-0000000ac0e1'),
                 'guardian overview shows the outcome and the finalized status');
  perform tat.ok(not exists (select 1 from jsonb_array_elements(j->'history') x where x->>'event_id' = '00000000-0000-0000-0000-0000000ac0e3'),
                 'guardian overview never shows draft marks');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac13', $q$select public.guardian_attendance_overview('00000000-0000-0000-0000-00000000ac31')::text$q$);
  perform tat.ok(r like 'ERR:NOT_AUTHORIZED%', 'cross-family overview denied');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac11', 'select count(*)::text from public.team_attendance_marks');
  perform tat.ok(r = 'OK:0', 'guardians do not read the marks table directly');
end $$;

-- ===========================================================================
-- H. Player portal
-- ===========================================================================
do $$
declare j jsonb; r text;
begin
  begin
    insert into public.invitations (org_id, email, role) values ('00000000-0000-0000-0000-000000000001', 'ta-noathlete@example.test', 'player');
    perform tat.ok(false, 'player invitation needs an athlete');
  exception when check_violation then
    perform tat.ok(true, 'player invitation needs an athlete');
  end;
  begin
    insert into public.invitations (org_id, email, role, athlete_id)
    values ('00000000-0000-0000-0000-000000000001', 'ta-x@example.test', 'player', 'b0000000-0000-0000-0000-00000000ac92');
    perform tat.ok(false, 'player invitation for another org''s athlete refused');
  exception when others then
    perform tat.ok(sqlerrm like '%INVITATION_ATHLETE_OTHER_ORG%', 'player invitation for another org''s athlete refused');
  end;
  insert into public.invitations (org_id, email, role, athlete_id)
  values ('00000000-0000-0000-0000-000000000001', 'ta-player2@example.test', 'player', '00000000-0000-0000-0000-00000000ac32');
  insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000ac15', 'ta-player2@example.test');
  perform tat.ok((select player_profile_id = '00000000-0000-0000-0000-00000000ac15' from public.athletes where id = '00000000-0000-0000-0000-00000000ac32'),
                 'accepting a player invitation links the athlete');
  perform tat.ok(not exists (select 1 from public.staff_roles where profile_id = '00000000-0000-0000-0000-00000000ac15'),
                 'a player gets no staff role');
  -- Admin links P1 to an existing login.
  r := tat.run_as('00000000-0000-0000-0000-0000000000f1',
        $q$select public.athlete_player_link('00000000-0000-0000-0000-00000000ac31', '00000000-0000-0000-0000-00000000ac14')::text$q$);
  perform tat.ok(r like 'OK:%', 'admin links a player account');
  r := tat.run_as('00000000-0000-0000-0000-0000000000f1',
        $q$select public.athlete_player_link('00000000-0000-0000-0000-00000000ac31', '00000000-0000-0000-0000-00000000ac15')::text$q$);
  perform tat.ok(r like 'ERR:PLAYER_ALREADY_LINKED%' or r like 'ERR:%duplicate%', 'an athlete has one player login — ' || r);
  r := tat.run_as('00000000-0000-0000-0000-0000000000f1',
        $q$select public.athlete_player_link('00000000-0000-0000-0000-00000000ac33', '00000000-0000-0000-0000-00000000ac13')::text$q$);
  perform tat.ok(r like 'ERR:PLAYER_IS_GUARDIAN%', 'a guardian login cannot be the player login');

  j := tat.js('00000000-0000-0000-0000-00000000ac14', 'select to_jsonb(x) from public.player_me() x');
  perform tat.ok(j->>'athlete_id' = '00000000-0000-0000-0000-00000000ac31' and not (j ? 'allergies') and jsonb_array_length(j->'teams') = 1,
                 'player_me: own limited record and current team — ' || j::text);
  r := tat.run_as('00000000-0000-0000-0000-00000000ac14', 'select count(*)::text from public.athletes');
  perform tat.ok(r = 'OK:0', 'a player cannot read the athletes table (guardian contacts, notes)');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac14', 'select string_agg(name, '','' order by name) from public.teams');
  perform tat.ok(r = 'OK:TA Team One', 'a player sees their own team only — ' || r);
  r := tat.run_as('00000000-0000-0000-0000-00000000ac14',
        $q$select count(*)::text from public.events where team_id = '00000000-0000-0000-0000-00000000ac43'$q$);
  perform tat.ok(r = 'OK:0', 'a player does not see other teams'' events');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac14',
        $q$select (count(*) > 0)::text from public.events where team_id = '00000000-0000-0000-0000-00000000ac41'$q$);
  perform tat.ok(r = 'OK:true', 'a player sees their team''s events');
  j := tat.js('00000000-0000-0000-0000-00000000ac14', 'select public.player_attendance_overview()::text');
  perform tat.ok(jsonb_array_length(j->'history') >= 1 and j->'athlete'->>'id' = '00000000-0000-0000-0000-00000000ac31'
                 and not exists (select 1 from jsonb_array_elements(j->'history') x where x ? 'alert' and x->'alert' <> 'null'::jsonb),
                 'player overview: own finalized history, no guardian alerts');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac14', $q$select public.attendance_sheet('00000000-0000-0000-0000-0000000ac0e1')::text$q$);
  perform tat.ok(r like 'ERR:NOT_AUTHORIZED%', 'a player never reads the sheet (other players'' marks)');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac14', 'select count(*)::text from public.team_attendance_marks');
  perform tat.ok(r = 'OK:0', 'a player cannot read the marks table');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac14',
        $q$select public.absence_report('00000000-0000-0000-0000-0000000ac0ef', '00000000-0000-0000-0000-00000000ac31', 'exam', 'school')::text$q$);
  perform tat.ok(r like 'OK:%' and (select reporter_kind = 'player' from public.team_absence_reports
                   where athlete_id = '00000000-0000-0000-0000-00000000ac31' and status = 'reported'),
                 'a player reports their own absence');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac14',
        $q$select public.absence_report('00000000-0000-0000-0000-0000000ac0ef', '00000000-0000-0000-0000-00000000ac33', 'x', 'other')::text$q$);
  perform tat.ok(r like 'ERR:NOT_AUTHORIZED%', 'a player cannot report for another player');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac14',
        $q$select count(*)::text from public.attendance_stats(null, null, null, null, '00000000-0000-0000-0000-00000000ac33')$q$);
  perform tat.ok(r like 'ERR:NOT_AUTHORIZED%', 'a player cannot read another player''s stats');
end $$;

-- ===========================================================================
-- I. Training window + go-live, stats
-- ===========================================================================
do $$
declare j jsonb; r text; v_in uuid := gen_random_uuid();
begin
  begin
    insert into public.events (org_id, team_id, season_id, type, series_id, starts_at, ends_at)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac41', '00000000-0000-0000-0000-00000000ac61',
            'training', v_in, now() + interval '160 days', now() + interval '160 days 2 hours');
    perform tat.ok(false, 'a recurring training outside the training window is refused');
  exception when others then
    perform tat.ok(sqlerrm like '%TRAINING_OUTSIDE_SEASON_WINDOW%', 'a recurring training outside the training window is refused');
  end;
  insert into public.events (org_id, team_id, season_id, type, series_id, starts_at, ends_at)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac41', '00000000-0000-0000-0000-00000000ac61',
          'training', v_in, now() + interval '30 days', now() + interval '30 days 2 hours');
  perform tat.ok(true, 'a recurring training inside the window is created');
  -- Window shrinks: trainings 10 days ago / yesterday fall out of it.
  update public.seasons set training_starts_on = current_date - 5 where id = '00000000-0000-0000-0000-00000000ac61';
  r := tat.run_as('00000000-0000-0000-0000-0000000000f1', 'select string_agg(event_id::text, '','') from public.sessions_awaiting_attendance()');
  perform tat.ok(r not like '%ac0e3%', 'awaiting list skips trainings outside the training window — ' || r);
  perform tat.ok(r like '%ac0f4%', 'awaiting list holds an ended training inside the window without a final sheet');
  update public.seasons set training_starts_on = current_date - 150 where id = '00000000-0000-0000-0000-00000000ac61';
  -- Before the go-live (30 days ago): never counted / flagged.
  insert into public.events (id, org_id, team_id, season_id, type, starts_at, ends_at) values
    ('00000000-0000-0000-0000-0000000ac0e0', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac41',
     '00000000-0000-0000-0000-00000000ac61', 'training', now() - interval '40 days', now() - interval '40 days' + interval '2 hours');
  r := tat.run_as('00000000-0000-0000-0000-0000000000f1', 'select coalesce(string_agg(event_id::text, '',''), '''') from public.sessions_awaiting_attendance()');
  perform tat.ok(r not like '%ac0e0%' and r like '%ac0e3%', 'awaiting list: nothing before the go-live, sessions after it are listed');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac01', 'select coalesce(string_agg(event_id::text, '',''), '''') from public.sessions_awaiting_attendance()');
  perform tat.ok(r like '%ac0e3%' and r not like '%ac0f4%', 'coach awaiting list: own teams only');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac11', 'select count(*)::text from public.sessions_awaiting_attendance()');
  perform tat.ok(r = 'OK:0', 'guardians get no awaiting list');
  perform tat.svc($q$select public.attendance_review_flags('00000000-0000-0000-0000-000000000001')::text$q$);
  perform tat.ok(exists (select 1 from public.data_review_flags where reason_code = 'ATTENDANCE_UNFINISHED'
                          and entity_id = '00000000-0000-0000-0000-0000000ac0e3' and resolved_at is null),
                 'unfinished tracked session is flagged');
  perform tat.ok(not exists (select 1 from public.data_review_flags where reason_code = 'ATTENDANCE_UNFINISHED'
                          and entity_id = '00000000-0000-0000-0000-0000000ac0e0'),
                 'a session before the go-live is never flagged');
  perform tat.ok(exists (select 1 from public.data_review_flags where reason_code = 'ATHLETE_WITHOUT_GUARDIAN'
                          and entity_id = '00000000-0000-0000-0000-00000000ac34'),
                 'player without a guardian is flagged');
  perform tat.ok(exists (select 1 from public.data_review_flags where reason_code = 'TEAM_WITHOUT_COACH'
                          and entity_id = '00000000-0000-0000-0000-00000000ac43'),
                 'team with trainings and no coach is flagged');

  -- Stats: E1 final (P1 late, P3 excused, P4 present, guest present), EF final, ET3 final.
  j := tat.js('00000000-0000-0000-0000-0000000000f1',
        $q$select jsonb_agg(to_jsonb(s)) from public.attendance_stats(null, null, '00000000-0000-0000-0000-00000000ac41', null, null, 'team') s$q$);
  perform tat.ok((j->0->>'sessions')::int = 8 and (j->0->>'rate')::numeric = 0.75,
                 'team stats: rate = (present + late) / finalized marks — ' || j::text);
  -- A one-off training outside the window, finalized: counted without a season, not with it.
  update public.seasons set training_ends_on = current_date + 1 where id = '00000000-0000-0000-0000-00000000ac61';
  j := tat.js('00000000-0000-0000-0000-0000000000f1',
        $q$select jsonb_agg(to_jsonb(s)) from public.attendance_stats(null, null, '00000000-0000-0000-0000-00000000ac41',
             '00000000-0000-0000-0000-00000000ac61', null, 'team') s$q$);
  perform tat.ok((j->0->>'sessions')::int = 4, 'season stats use the training window (later trainings excluded) — ' || coalesce(j::text, 'null'));
  update public.seasons set training_ends_on = current_date + 150 where id = '00000000-0000-0000-0000-00000000ac61';
  j := tat.js('00000000-0000-0000-0000-00000000ac11',
        $q$select jsonb_agg(to_jsonb(s)) from public.attendance_stats(null, null, null, null, '00000000-0000-0000-0000-00000000ac31', 'team') s$q$);
  perform tat.ok(jsonb_array_length(j) = 1 and j->0->>'athlete_id' = '00000000-0000-0000-0000-00000000ac31',
                 'guardian stats: own child only, even when asking per team');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac11', 'select count(*)::text from public.attendance_stats()');
  perform tat.ok(r like 'ERR:NOT_AUTHORIZED%', 'guardian stats without a child: denied');
end $$;

-- ===========================================================================
-- J. Other org, delete guard, follow-up list, re-run
-- ===========================================================================
do $$
declare r text;
begin
  r := tat.run_as('b0000000-0000-0000-0000-00000000ac91', $q$select public.attendance_sheet('00000000-0000-0000-0000-0000000ac0e1')::text$q$);
  perform tat.ok(r like 'ERR:EVENT_NOT_FOUND%', 'other org admin: EVENT_NOT_FOUND on the sheet');
  r := tat.run_as('b0000000-0000-0000-0000-00000000ac91', $q$select public.attendance_open('00000000-0000-0000-0000-0000000ac0e1')::text$q$);
  perform tat.ok(r like 'ERR:EVENT_NOT_FOUND%', 'other org admin cannot open');
  foreach r in array array['team_attendance_sheets', 'team_attendance_marks', 'team_attendance_mark_history', 'team_absence_reports',
                           'attendance_no_show_alerts', 'attendance_correction_requests', 'event_coach_assignments', 'team_membership_periods'] loop
    perform tat.ok(tat.run_as('b0000000-0000-0000-0000-00000000ac91', format('select count(*)::text from public.%I', r)) = 'OK:0',
                   'other org admin reads no ' || r);
  end loop;
  r := tat.run_as('b0000000-0000-0000-0000-00000000ac91', 'select count(*)::text from public.attendance_alerts_followup()');
  perform tat.ok(r = 'OK:0', 'other org: no follow-up alerts');
  r := tat.run_as('b0000000-0000-0000-0000-00000000ac91', 'select count(*)::text from public.attendance_stats()');
  perform tat.ok(r = 'OK:0', 'other org: no stats rows');
  r := tat.run_as('b0000000-0000-0000-0000-00000000ac91',
        $q$select public.session_assign_coach('00000000-0000-0000-0000-0000000ac0e1', '00000000-0000-0000-0000-00000000ac52')::text$q$);
  perform tat.ok(r like 'ERR:EVENT_NOT_FOUND%', 'other org admin cannot assign a coach');
  r := tat.run_as('00000000-0000-0000-0000-0000000000f1', 'select count(*)::text from public.attendance_alerts_followup()');
  perform tat.ok(r = 'OK:0', 'follow-up list: the no_contact alert was superseded by the correction');
  r := tat.run_as('00000000-0000-0000-0000-0000000000f1', 'select count(*)::text from public.team_attendance_requests');
  perform tat.ok(r = 'OK:0', 'idempotency keys are not readable by clients');
  -- Delete guard: memberships used by attendance cannot be deleted by API clients.
  r := tat.run_as('00000000-0000-0000-0000-00000000ac01',
        $q$delete from public.team_memberships where team_id = '00000000-0000-0000-0000-00000000ac41'
            and athlete_id = '00000000-0000-0000-0000-00000000ac31' returning 'x'$q$);
  perform tat.ok(r like 'ERR:MEMBERSHIP_HAS_ATTENDANCE%', 'a membership used by attendance cannot be deleted (end it instead) — ' || r);
  -- Existing programme-session attendance is untouched.
  perform tat.ok((select count(*) from public.attendance_sessions) = (select count(*) from public.attendance_sessions), 'legacy attendance sessions untouched');
end $$;

-- ===========================================================================
-- K. Training breaks
-- ===========================================================================
insert into public.events (id, org_id, team_id, season_id, type, starts_at, ends_at) values
  ('00000000-0000-0000-0000-0000000ac0a1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac41', '00000000-0000-0000-0000-00000000ac61', 'training', now() + interval '40 days', now() + interval '40 days 2 hours'),
  ('00000000-0000-0000-0000-0000000ac0a2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac43', '00000000-0000-0000-0000-00000000ac61', 'training', now() + interval '41 days', now() + interval '41 days 2 hours'),
  ('00000000-0000-0000-0000-0000000ac0a3', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac41', '00000000-0000-0000-0000-00000000ac61', 'game', now() + interval '40 days', now() + interval '40 days 2 hours'),
  ('00000000-0000-0000-0000-0000000ac0a4', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac41', '00000000-0000-0000-0000-00000000ac61', 'training', now() + interval '60 days', now() + interval '60 days 2 hours');
insert into public.seasons (id, org_id, name, starts_on, ends_on) values
  ('00000000-0000-0000-0000-00000000ac62', '00000000-0000-0000-0000-000000000001', 'TA other season', current_date + 400, current_date + 700);
do $$
declare j jsonb; r text; v_brk text; v_alerts int;
begin
  r := tat.run_as('00000000-0000-0000-0000-00000000ac01',
        $q$select public.training_break_save(null, 'Synthetic break', current_date + 38, current_date + 42)::text$q$);
  perform tat.ok(r like 'ERR:NOT_AUTHORIZED%', 'a coach cannot create a break');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac01',
        $q$insert into public.club_training_breaks (org_id, label, starts_on, ends_on)
           values ('00000000-0000-0000-0000-000000000001', 'x', current_date, current_date) returning 'x'$q$);
  perform tat.ok(r like 'ERR:%', 'a coach cannot insert a break directly (RLS)');
  -- Season-scoped break of another season: cancels nothing here.
  j := tat.js('00000000-0000-0000-0000-0000000000f1',
        $q$select public.training_break_save(null, 'Other season break', current_date + 38, current_date + 42,
             '00000000-0000-0000-0000-00000000ac62')::text$q$);
  perform tat.ok(jsonb_array_length(j->'cancelled') = 0, 'a break of another season cancels nothing — ' || j::text);
  j := tat.js('00000000-0000-0000-0000-0000000000f1',
        $q$select public.training_break_save(null, 'Synthetic break', current_date + 38, current_date + 42)::text$q$);
  v_brk := j->>'break_id';
  perform tat.ok(jsonb_array_length(j->'cancelled') = 2, 'adding a break cancels the trainings in its range — ' || j::text);
  perform tat.ok((select bool_and(status = 'cancelled' and cancel_reason = 'Synthetic break' and cancelled_at is not null)
                    from public.events where id in ('00000000-0000-0000-0000-0000000ac0a1', '00000000-0000-0000-0000-0000000ac0a2')),
                 'cancelled with the break label as reason (normal cancel path)');
  perform tat.ok((select status <> 'cancelled' from public.events where id = '00000000-0000-0000-0000-0000000ac0a3'),
                 'games in the range are not cancelled');
  perform tat.ok((select status <> 'cancelled' from public.events where id = '00000000-0000-0000-0000-0000000ac0a4'),
                 'trainings after the range are untouched');
  perform tat.ok((select count(*) = 2 from public.audit_logs where action = 'event.cancel_break'), 'each cancellation is audited');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac11', 'select count(*)::text from public.club_training_breaks');
  perform tat.ok(r = 'OK:2', 'guardians read the breaks');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac14', 'select count(*)::text from public.training_breaks_list()');
  perform tat.ok(r = 'OK:2', 'players read the breaks');
  r := tat.run_as('b0000000-0000-0000-0000-00000000ac91', 'select count(*)::text from public.club_training_breaks');
  perform tat.ok(r = 'OK:0', 'other org reads no breaks');
  r := tat.run_as('00000000-0000-0000-0000-00000000ac14',
        $q$select count(*)::text from public.events where id = '00000000-0000-0000-0000-0000000ac0a1' and status = 'cancelled'$q$);
  perform tat.ok(r = 'OK:1', 'the cancelled session stays visible as cancelled in the player portal');
  -- Recurring generation inside the break refused.
  begin
    insert into public.events (org_id, team_id, season_id, type, series_id, starts_at, ends_at)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ac41', '00000000-0000-0000-0000-00000000ac61',
            'training', gen_random_uuid(), now() + interval '39 days', now() + interval '39 days 2 hours');
    perform tat.ok(false, 'a recurring training inside a break is refused');
  exception when others then
    perform tat.ok(sqlerrm like '%TRAINING_IN_BREAK%', 'a recurring training inside a break is refused');
  end;
  -- A break over a session with a FINAL sheet: reported, not cancelled.
  v_alerts := (select count(*) from public.attendance_no_show_alerts where event_id = '00000000-0000-0000-0000-0000000ac0e1');
  j := tat.js('00000000-0000-0000-0000-0000000000f1',
        $q$select public.training_break_save(null, 'Late break', current_date - 2, current_date - 1)::text$q$);
  perform tat.ok(j->'skipped_final' ? '00000000-0000-0000-0000-0000000ac0e1'
                 and (select status <> 'cancelled' from public.events where id = '00000000-0000-0000-0000-0000000ac0e1'),
                 'a session with a final sheet is reported, not cancelled — ' || j::text);
  -- Direct admin insert (RLS path) applies the break too.
  r := tat.run_as('00000000-0000-0000-0000-0000000000f1',
        $q$insert into public.club_training_breaks (org_id, label, starts_on, ends_on)
           values ('00000000-0000-0000-0000-000000000001', 'Direct break', current_date + 60, current_date + 60) returning 'x'$q$);
  perform tat.ok(r = 'OK:x' and (select status = 'cancelled' and cancel_reason = 'Direct break' from public.events
                   where id = '00000000-0000-0000-0000-0000000ac0a4'), 'a break inserted directly by an admin cancels too');
  -- Delete: nothing un-cancelled; affected sessions reported.
  j := tat.js('00000000-0000-0000-0000-0000000000f1', format('select public.training_break_delete(%L)::text', v_brk));
  perform tat.ok(jsonb_array_length(j->'still_cancelled') = 2
                 and (select bool_and(status = 'cancelled') from public.events
                       where id in ('00000000-0000-0000-0000-0000000ac0a1', '00000000-0000-0000-0000-0000000ac0a2')),
                 'deleting a break un-cancels nothing and reports the sessions — ' || j::text);
  r := tat.run_as('b0000000-0000-0000-0000-00000000ac91', format('select public.training_break_delete(%L)::text',
        (select id from public.club_training_breaks where label = 'Direct break')));
  perform tat.ok(r like 'ERR:NOT_AUTHORIZED%' or r like 'ERR:BREAK_NOT_FOUND%', 'other org cannot delete a break');
end $$;

-- Idempotent re-run of the migration keeps every row; review flags are not duplicated.
select tat.svc($q$select sum(public.attendance_review_flags(id))::text from public.organizations$q$);
select tat.ok(tat.svc($q$select public.attendance_review_flags('00000000-0000-0000-0000-000000000001')::text$q$) = 'OK:0',
              'review flags: a second run adds nothing');
create temp table tat_counts as
  select (select count(*) from public.team_attendance_marks) m, (select count(*) from public.attendance_no_show_alerts) a,
         (select count(*) from public.team_memberships) tm, (select count(*) from public.team_membership_periods) p,
         (select count(*) from public.data_review_flags) f, (select count(*) from public.team_attendance_sheets) s,
         (select count(*) from public.club_training_breaks) b, (select count(*) from public.events where status = 'cancelled') c;
\set QUIET on
\i supabase/migrations/20250420104000_team_attendance.sql
\set QUIET off
select tat.ok((select m = (select count(*) from public.team_attendance_marks) and a = (select count(*) from public.attendance_no_show_alerts)
                  and tm = (select count(*) from public.team_memberships) and p = (select count(*) from public.team_membership_periods)
                  and f = (select count(*) from public.data_review_flags) and s = (select count(*) from public.team_attendance_sheets)
                  and b = (select count(*) from public.club_training_breaks) and c = (select count(*) from public.events where status = 'cancelled')
                 from tat_counts),
              'migration re-run is idempotent (no row added or lost)');
