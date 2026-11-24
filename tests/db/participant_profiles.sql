-- ============================================================================
-- Participant profiles suite (migration 20250420105600_participant_profiles.sql)
--
--   1. Add a child (participant_create): created in the guardian's family;
--      replay with the same request id returns the same athlete; validation.
--   2. "Myself" (participant_self_ensure): adult self profile, created once;
--      a minor cannot be "Myself".
--   3. Coach edits: height of a player on their own team; refused for another
--      team's player and for DOB.
--   4. Jersey numbers stay per team: a profile preference / one team's number
--      never changes another team's number.
--   5. DOB / sex correction: applied (audited) without a live enrolment; with
--      one -> change request + flag, athlete unchanged, direct UPDATE through
--      RLS refused; staff approve applies; decline leaves it.
--   6. Duplicates: the match check gives a parent no record details; link
--      request approved by the existing guardian / by staff gives access;
--      "different child" creates a flagged profile.
--   7. Cross-tenant denial for both tables and every RPC.
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach Derrick
-- …f3 = coach …011, guardian Carla …f4 of family …061 with Mateo …071).
-- Org B 10000000-…0002 (seed_tenants.sql). SYNTHETIC DATA ONLY.
-- Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema pp;
grant usage on schema pp to authenticated, anon, service_role;
create table pp.ctx (k text primary key, v text);
grant all on pp.ctx to authenticated, anon, service_role;

create function pp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;
create function pp.put(p_k text, p_v text) returns void language sql as $$
  insert into pp.ctx (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v;
$$;
create function pp.get(p_k text) returns uuid language sql stable as $$ select v::uuid from pp.ctx where k = p_k $$;
create function pp.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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
-- JSON result of an OK call (null on error).
create function pp.j(p_res text) returns jsonb language sql immutable as $$
  select case when p_res like 'OK:%' and p_res <> 'OK:<null>' then substr(p_res, 4)::jsonb end
$$;
grant execute on all functions in schema pp to authenticated, anon, service_role;

-- Fixtures -----------------------------------------------------------------------
-- G  = guardian of family PF (children K1 on teams T1+T2, K2 on T2 only)
-- G2 = another parent (family PF2) who asks to be linked
-- S  = adult parent for "Myself"; S2 = another login (minor DOB attempt)
-- BA = admin of org B
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000aa0a1', 'pp-guardian@example.test'),
  ('00000000-0000-0000-0000-0000000aa0a2', 'pp-guardian-two@example.test'),
  ('00000000-0000-0000-0000-0000000aa0a3', 'pp-self@example.test'),
  ('00000000-0000-0000-0000-0000000aa0a4', 'pp-self-two@example.test'),
  ('b0000000-0000-0000-0000-0000000aa0f1', 'pp-admin-b@example.test');
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic Guardian'
 where id = '00000000-0000-0000-0000-0000000aa0a1';
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic Guardian Two'
 where id = '00000000-0000-0000-0000-0000000aa0a2';
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic Self'
 where id in ('00000000-0000-0000-0000-0000000aa0a3', '00000000-0000-0000-0000-0000000aa0a4');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002'
 where id = 'b0000000-0000-0000-0000-0000000aa0f1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000aa0f1', 'admin');

insert into public.families (id, org_id, name) values
  ('00000000-0000-0000-0000-0000000aa061', '00000000-0000-0000-0000-000000000001', 'Synthetic Family'),
  ('00000000-0000-0000-0000-0000000aa062', '00000000-0000-0000-0000-000000000001', 'Synthetic Family Two'),
  ('00000000-0000-0000-0000-0000000aa063', '00000000-0000-0000-0000-000000000001', 'Synthetic Self Family');
insert into public.family_members (family_id, profile_id, relation, is_primary) values
  ('00000000-0000-0000-0000-0000000aa061', '00000000-0000-0000-0000-0000000aa0a1', 'mother', true),
  ('00000000-0000-0000-0000-0000000aa062', '00000000-0000-0000-0000-0000000aa0a2', 'father', true),
  ('00000000-0000-0000-0000-0000000aa063', '00000000-0000-0000-0000-0000000aa0a3', 'guardian', true);

insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, gender, status) values
  ('00000000-0000-0000-0000-0000000aa071', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000aa061', 'Synthetic', 'Teamkid', '2014-05-05', 'male', 'active'),
  ('00000000-0000-0000-0000-0000000aa072', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000aa061', 'Synthetic', 'Otherkid', '2015-06-06', 'female', 'active');

insert into public.teams (id, org_id, name, sport) values
  ('00000000-0000-0000-0000-0000000aa0c1', '00000000-0000-0000-0000-000000000001', 'Synthetic U12', 'basketball'),
  ('00000000-0000-0000-0000-0000000aa0c2', '00000000-0000-0000-0000-000000000001', 'Synthetic U14', 'basketball');
insert into public.team_coaches (team_id, coach_id, org_id) values
  ('00000000-0000-0000-0000-0000000aa0c1', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000aa0c2', '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001');
insert into public.team_memberships (org_id, team_id, athlete_id, jersey_number) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000aa0c1', '00000000-0000-0000-0000-0000000aa071', 7),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000aa0c2', '00000000-0000-0000-0000-0000000aa071', 23),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000aa0c2', '00000000-0000-0000-0000-0000000aa072', 11);

select pp.put('G',  '00000000-0000-0000-0000-0000000aa0a1');
select pp.put('G2', '00000000-0000-0000-0000-0000000aa0a2');
select pp.put('S',  '00000000-0000-0000-0000-0000000aa0a3');
select pp.put('S2', '00000000-0000-0000-0000-0000000aa0a4');
select pp.put('BA', 'b0000000-0000-0000-0000-0000000aa0f1');
select pp.put('K1', '00000000-0000-0000-0000-0000000aa071');
select pp.put('K2', '00000000-0000-0000-0000-0000000aa072');
select pp.put('ADMIN',   '00000000-0000-0000-0000-0000000000f1');
select pp.put('FINANCE', '00000000-0000-0000-0000-0000000000f2');
select pp.put('COACH',   '00000000-0000-0000-0000-0000000000f3');
select pp.put('CARLA',   '00000000-0000-0000-0000-0000000000f4');
select pp.put('MATEO',   '00000000-0000-0000-0000-000000000071');
select pp.put('REQ1', gen_random_uuid()::text);

-- ===========================================================================
-- 1. Add a child + idempotency + validation
-- ===========================================================================
do $$
declare r1 text; r2 text; v_id uuid; n int;
begin
  r1 := pp.run_as(pp.get('G'), format($q$select public.participant_create(
          '{"first_name":"Synthetic","last_name":"Newkid","dob":"2017-02-02","gender":"female","height_cm":"128.5","position_pref":"Guard"}'::jsonb,
          %L::uuid)::text$q$, pp.get('REQ1')));
  v_id := (pp.j(r1)->>'athlete_id')::uuid;
  perform pp.ok(pp.j(r1)->>'ok' = 'true' and v_id is not null, 'add child: participant_create returns the new athlete (' || r1 || ')');
  perform pp.ok((select family_id from public.athletes where id = v_id) = '00000000-0000-0000-0000-0000000aa061',
                'add child: created in the guardian''s own family');
  perform pp.ok((select height_cm from public.athletes where id = v_id) = 128.5, 'add child: optional sports fields stored');
  perform pp.ok(pp.run_as(pp.get('G'), format('select count(*)::text from public.athletes where id = %L', v_id)) = 'OK:1',
                'add child: the guardian reads the new child through RLS');
  perform pp.put('NEW', v_id::text);

  r2 := pp.run_as(pp.get('G'), format($q$select public.participant_create(
          '{"first_name":"Synthetic","last_name":"Newkid","dob":"2017-02-02","gender":"female"}'::jsonb, %L::uuid)::text$q$, pp.get('REQ1')));
  perform pp.ok((pp.j(r2)->>'athlete_id')::uuid = v_id and pp.j(r2)->>'replayed' = 'true', 'idempotent: same request id returns the same athlete (replayed)');
  select count(*) into n from public.athletes where last_name = 'Newkid';
  perform pp.ok(n = 1, 'idempotent: a double click never creates a second athlete');

  r2 := pp.run_as(pp.get('G'), $q$select public.participant_create(
          '{"first_name":"Synthetic","last_name":"Newkid","dob":"2017-02-02","gender":"female"}'::jsonb, gen_random_uuid())::text$q$);
  perform pp.ok((pp.j(r2)->>'athlete_id')::uuid = v_id and pp.j(r2)->>'existing' = 'true',
                'own family: the same child added again returns the existing profile (no duplicate)');

  r2 := pp.run_as(pp.get('G'), $q$select public.participant_create('{"first_name":"A","last_name":"B","gender":"male"}'::jsonb, gen_random_uuid())::text$q$);
  perform pp.ok(r2 like 'ERR:DOB_REQUIRED%', 'validation: DOB required (' || r2 || ')');
  r2 := pp.run_as(pp.get('G'), $q$select public.participant_create('{"first_name":"A","last_name":"B","dob":"2016-01-01","gender":"other"}'::jsonb, gen_random_uuid())::text$q$);
  perform pp.ok(r2 like 'ERR:INVALID_SEX%', 'validation: new forms accept male / female only');
  r2 := pp.run_as(pp.get('G'), format($q$select public.participant_create('{"first_name":"A","last_name":"B","dob":"2016-01-01","gender":"male","family_id":"%s"}'::jsonb, gen_random_uuid())::text$q$,
          '00000000-0000-0000-0000-0000000aa062'));
  perform pp.ok(r2 like 'ERR:FAMILY_NOT_FOUND%', 'a guardian cannot add a child to another family');
  r2 := pp.run_as(null, $q$select public.participant_create('{"first_name":"A","last_name":"B","dob":"2016-01-01","gender":"male"}'::jsonb, gen_random_uuid())::text$q$);
  perform pp.ok(r2 like 'ERR:%', 'anon cannot call participant_create');
end $$;

-- ===========================================================================
-- 2. "Myself"
-- ===========================================================================
do $$
declare r text; v_id uuid;
begin
  r := pp.run_as(pp.get('S'), $q$select public.participant_self_ensure('{"first_name":"Synthetic","last_name":"Self","dob":"1985-03-03","gender":"male"}'::jsonb, gen_random_uuid())::text$q$);
  v_id := (pp.j(r)->>'athlete_id')::uuid;
  perform pp.ok(pp.j(r)->>'created' = 'true' and v_id is not null, 'myself: the adult''s own profile is created on first use');
  perform pp.ok((select player_profile_id from public.athletes where id = v_id) = pp.get('S'), 'myself: athletes.player_profile_id = the adult');
  perform pp.ok((select family_id from public.athletes where id = v_id) = '00000000-0000-0000-0000-0000000aa063', 'myself: in the adult''s own household');
  r := pp.run_as(pp.get('S'), $q$select public.participant_self_ensure('{}'::jsonb, gen_random_uuid())::text$q$);
  perform pp.ok((pp.j(r)->>'athlete_id')::uuid = v_id and pp.j(r)->>'created' = 'false', 'myself: later calls return the same profile');
  r := pp.run_as(pp.get('S2'), format($q$select public.participant_self_ensure('{"first_name":"Young","last_name":"Self","dob":"%s"}'::jsonb, gen_random_uuid())::text$q$,
         to_char(current_date - interval '15 years', 'YYYY-MM-DD')));
  perform pp.ok(r like 'ERR:SELF_MUST_BE_ADULT%', 'myself: a minor cannot be "Myself" (' || r || ')');
  r := pp.run_as(pp.get('S'), format($q$select public.participant_self_ensure(jsonb_build_object('at', %L), null)::text$q$,
         '1990-01-01'));
  perform pp.ok(r like 'ERR:SELF_MUST_BE_ADULT%', 'myself: refused when the adult is under 18 on the activity date');
end $$;

-- ===========================================================================
-- 3. Coach edits (sports fields only, own players only)
-- ===========================================================================
do $$
declare r text;
begin
  r := pp.run_as(pp.get('COACH'), format($q$select public.participant_update_sports(%L, '{"height_cm":"151","position_pref":"Wing"}'::jsonb)::text$q$, pp.get('K1')));
  perform pp.ok(pp.j(r)->>'ok' = 'true', 'coach: edits the height of a player on their own team (' || r || ')');
  perform pp.ok((select height_cm from public.athletes where id = pp.get('K1')) = 151, 'coach: height stored');
  r := pp.run_as(pp.get('COACH'), format($q$select public.participant_update_sports(%L, '{"height_cm":"140"}'::jsonb)::text$q$, pp.get('K2')));
  perform pp.ok(r like 'ERR:NOT_ALLOWED%', 'coach: refused for a player of another team (' || r || ')');
  r := pp.run_as(pp.get('COACH'), format($q$select public.participant_update_sports(%L, '{"dob":"2014-01-01"}'::jsonb)::text$q$, pp.get('K1')));
  perform pp.ok(r like 'ERR:FIELD_NOT_ALLOWED%', 'coach: DOB is not a sports field (refused)');
  r := pp.run_as(pp.get('COACH'), format($q$select public.participant_update(%L, '{"dob":"2014-01-01"}'::jsonb, gen_random_uuid())::text$q$, pp.get('K1')));
  perform pp.ok(r like 'ERR:NOT_ALLOWED%', 'coach: cannot change DOB / name / sex through participant_update');
  r := pp.run_as(pp.get('COACH'), format('update public.athletes set dob = %L where id = %L returning id::text', '2014-01-01', pp.get('K1')));
  perform pp.ok(r = 'OK:<null>' and (select dob from public.athletes where id = pp.get('K1')) = '2014-05-05', 'coach: no direct UPDATE of the athlete row');
  r := pp.run_as(pp.get('COACH'), format('select public.participant_sports_profile(%L)::text', pp.get('K1')));
  perform pp.ok(pp.j(r)->>'can_edit' = 'true', 'coach: reads the sports profile of their player');
  r := pp.run_as(pp.get('COACH'), format('select public.participant_sports_profile(%L)::text', pp.get('K2')));
  perform pp.ok(r = 'OK:<null>', 'coach: no sports profile for another team''s player');
end $$;

-- ===========================================================================
-- 4. Jersey numbers per team
-- ===========================================================================
do $$
declare r text;
begin
  r := pp.run_as(pp.get('G'), format($q$select public.participant_update_sports(%L, '{"preferred_jersey_number":"99","jersey_size":"YL"}'::jsonb)::text$q$, pp.get('K1')));
  perform pp.ok(pp.j(r)->>'ok' = 'true', 'jersey: guardian sets a preferred number');
  perform pp.ok((select array_agg(jersey_number order by jersey_number) from public.team_memberships where athlete_id = pp.get('K1')) = array[7, 23]::smallint[],
                'jersey: the profile preference never writes a team jersey number');
  update public.team_memberships set jersey_number = 8 where athlete_id = pp.get('K1') and team_id = '00000000-0000-0000-0000-0000000aa0c1';
  perform pp.ok((select jersey_number from public.team_memberships where athlete_id = pp.get('K1') and team_id = '00000000-0000-0000-0000-0000000aa0c2') = 23
                and (select preferred_jersey_number from public.athletes where id = pp.get('K1')) = 99,
                'jersey: a number change on one team leaves the other team and the preference unchanged');
end $$;

-- ===========================================================================
-- 5. DOB / sex corrections
-- ===========================================================================
do $$
declare r text; v_req uuid; n int;
begin
  -- No live enrolment: applied at once, audited.
  r := pp.run_as(pp.get('G'), format($q$select public.participant_update(%L, '{"dob":"2017-03-03"}'::jsonb, gen_random_uuid())::text$q$, pp.get('NEW')));
  perform pp.ok(pp.j(r)->>'review_required' = 'false' and (select dob from public.athletes where id = pp.get('NEW')) = '2017-03-03',
                'dob: parent correction without an enrolment applies immediately (' || r || ')');
  perform pp.ok(exists (select 1 from public.audit_logs where action = 'athlete.eligibility.changed' and target_id = pp.get('NEW')
                          and new_data->>'via' = 'family' and old_data->>'dob' = '2017-02-02'), 'dob: the change is audited (old -> new, via family)');

  -- Live enrolment (K1 on two teams): change request + flag, athlete unchanged.
  r := pp.run_as(pp.get('G'), format($q$select public.participant_update(%L, '{"dob":"2013-05-05","first_name":"Synthetica"}'::jsonb, gen_random_uuid())::text$q$, pp.get('K1')));
  v_req := (pp.j(r)->>'change_request_id')::uuid;
  perform pp.ok(pp.j(r)->>'review_required' = 'true' and v_req is not null, 'dob: with a live enrolment the change becomes a review request (' || r || ')');
  perform pp.ok((select dob from public.athletes where id = pp.get('K1')) = '2014-05-05', 'dob: athlete unchanged until staff review');
  perform pp.ok((select first_name from public.athletes where id = pp.get('K1')) = 'Synthetica', 'dob: other fields of the same save still apply');
  perform pp.ok(exists (select 1 from public.data_review_flags where reason_code = 'ATHLETE_ELIGIBILITY_CHANGE' and entity_id = v_req and resolved_at is null),
                'dob: data review flag ATHLETE_ELIGIBILITY_CHANGE raised');
  perform pp.ok((select jsonb_array_length(impact) from public.athlete_change_requests where id = v_req) = 2, 'dob: the request lists the affected enrolments (2 teams)');
  perform pp.put('CR1', v_req::text);

  r := pp.run_as(pp.get('G'), format('update public.athletes set dob = %L where id = %L returning id::text', '2013-05-05', pp.get('K1')));
  perform pp.ok(r like 'ERR:REVIEW_REQUIRED%', 'guard: a direct UPDATE of dob through RLS is refused (' || r || ')');
  r := pp.run_as(pp.get('G'), format('update public.athletes set gender = %L where id = %L returning id::text', 'female', pp.get('K1')));
  perform pp.ok(r like 'ERR:REVIEW_REQUIRED%', 'guard: a direct UPDATE of sex through RLS is refused');
  r := pp.run_as(pp.get('G'), format('select count(*)::text from public.athlete_change_requests where id = %L', v_req));
  perform pp.ok(r = 'OK:1', 'the requesting guardian reads their change request');

  -- Decisions: admin only.
  r := pp.run_as(pp.get('G'), format('select public.participant_change_decide(%L, %L)::text', v_req, 'approve'));
  perform pp.ok(r like 'ERR:NOT_ALLOWED%', 'decide: a guardian cannot approve their own request');
  r := pp.run_as(pp.get('FINANCE'), format('select public.participant_change_decide(%L, %L)::text', v_req, 'approve'));
  perform pp.ok(r like 'ERR:NOT_ALLOWED%', 'decide: finance cannot approve');
  r := pp.run_as(pp.get('ADMIN'), format('select public.participant_change_decide(%L, %L)::text', v_req, 'approve'));
  perform pp.ok(pp.j(r)->>'status' = 'approved' and (select dob from public.athletes where id = pp.get('K1')) = '2013-05-05',
                'decide: staff approval applies the change (' || r || ')');
  perform pp.ok(exists (select 1 from public.audit_logs where action = 'athlete.eligibility.changed' and target_id = pp.get('K1') and new_data->>'via' = 'review'),
                'decide: the approved change is audited (via review)');
  perform pp.ok(not exists (select 1 from public.data_review_flags where entity_id = v_req and resolved_at is null), 'decide: the flag is resolved');
  r := pp.run_as(pp.get('ADMIN'), format('select public.participant_change_decide(%L, %L)::text', v_req, 'decline'));
  perform pp.ok(pp.j(r)->>'replayed' = 'true' and pp.j(r)->>'status' = 'approved', 'decide: a second decision replays the first');

  -- Sex correction declined: unchanged.
  r := pp.run_as(pp.get('G'), format($q$select public.participant_update(%L, '{"gender":"female"}'::jsonb, gen_random_uuid())::text$q$, pp.get('K1')));
  v_req := (pp.j(r)->>'change_request_id')::uuid;
  r := pp.run_as(pp.get('ADMIN'), format('select public.participant_change_decide(%L, %L, %L)::text', v_req, 'decline', 'Please send the ID card'));
  perform pp.ok(pp.j(r)->>'status' = 'declined' and (select gender from public.athletes where id = pp.get('K1')) = 'male',
                'decline: the athlete keeps the current value');
  perform pp.put('CR2', v_req::text);

  -- Staff edit directly (bypass) — still audited.
  r := pp.run_as(pp.get('ADMIN'), format('update public.athletes set dob = %L where id = %L returning id::text', '2013-06-06', pp.get('K1')));
  perform pp.ok(r = 'OK:' || pp.get('K1')::text, 'staff: admin corrects DOB directly');
  select count(*) into n from public.audit_logs where action = 'athlete.eligibility.changed' and target_id = pp.get('K1');
  perform pp.ok(n = 2, 'staff: direct corrections are audited too');
end $$;

-- ===========================================================================
-- 6. Duplicates: private match check, link requests
-- ===========================================================================
do $$
declare r text; v_link uuid; v_req uuid := gen_random_uuid();
begin
  -- G2 adds "Synthetic Otherkid" 2015-06-06 (K2 exists in G's family).
  r := pp.run_as(pp.get('G2'), $q$select public.participant_create('{"first_name":"synthetic","last_name":"OTHERKID","dob":"2015-06-06","gender":"female"}'::jsonb, gen_random_uuid())::text$q$);
  perform pp.ok(pp.j(r) = '{"ok": false, "code": "POSSIBLE_MATCH"}'::jsonb, 'match: the parent only learns POSSIBLE_MATCH (' || r || ')');
  perform pp.ok(position(pp.get('K2')::text in r) = 0 and position('aa061' in r) = 0, 'match: no id of the existing record or family is returned');
  r := pp.run_as(pp.get('G2'), $q$select public.people_duplicate_check('{"first_name":"Synthetic","last_name":"Otherkid","dob":"2015-06-06"}'::jsonb)::text$q$);
  perform pp.ok(r like 'ERR:NOT_AUTHORIZED%', 'match: people_duplicate_check is never available to parents');

  r := pp.run_as(pp.get('G2'), format($q$select public.participant_link_request('{"first_name":"Synthetic","last_name":"Otherkid","dob":"2015-06-06","relation":"father"}'::jsonb, %L::uuid)::text$q$, v_req));
  v_link := (pp.j(r)->>'link_request_id')::uuid;
  perform pp.ok(v_link is not null and position(pp.get('K2')::text in r) = 0, 'link: request created, opaque to the requester (' || r || ')');
  r := pp.run_as(pp.get('G2'), format($q$select public.participant_link_request('{"first_name":"Synthetic","last_name":"Otherkid","dob":"2015-06-06","relation":"father"}'::jsonb, %L::uuid)::text$q$, v_req));
  perform pp.ok((pp.j(r)->>'link_request_id')::uuid = v_link, 'link: replay returns the same request');
  r := pp.run_as(pp.get('G2'), $q$select public.participant_link_request('{"first_name":"Nobody","last_name":"Here","dob":"2015-06-06"}'::jsonb, gen_random_uuid())::text$q$);
  perform pp.ok(r like 'ERR:NO_MATCH%', 'link: no request without a match');
  r := pp.run_as(pp.get('G2'), 'select public.participant_my_requests()::text');
  perform pp.ok(position(pp.get('K2')::text in r) = 0 and (pp.j(r)->'links'->0->>'status') = 'pending', 'link: the requester sees status only, never the record');
  r := pp.run_as(pp.get('G2'), 'select count(*)::text from public.athlete_link_requests');
  perform pp.ok(r = 'OK:0', 'link: the requester cannot read the link table');
  r := pp.run_as(pp.get('G2'), format('select count(*)::text from public.athletes where id = %L', pp.get('K2')));
  perform pp.ok(r = 'OK:0', 'link: no access before approval');
  r := pp.run_as(pp.get('G2'), format('select public.participant_link_decide(%L, %L)::text', v_link, 'approve'));
  perform pp.ok(r like 'ERR:NOT_FOUND%', 'link: the requester cannot approve their own request');
  r := pp.run_as(pp.get('CARLA'), format('select public.participant_link_decide(%L, %L)::text', v_link, 'approve'));
  perform pp.ok(r like 'ERR:NOT_FOUND%', 'link: a guardian of another family cannot decide');

  r := pp.run_as(pp.get('G'), 'select public.participant_link_inbox()::text');
  perform pp.ok((pp.j(r)->0->>'id')::uuid = v_link and pp.j(r)->0->>'requester_name' = 'Synthetic Guardian Two', 'link: the existing guardian sees the request in the parent app');
  r := pp.run_as(pp.get('G'), format($q$select public.participant_link_decide(%L, 'approve', '{"can_pay":false,"can_see_medical":false,"receives_emails":true}'::jsonb)::text$q$, v_link));
  perform pp.ok(pp.j(r)->>'status' = 'approved', 'link: approved by the existing guardian (' || r || ')');
  r := pp.run_as(pp.get('G2'), format('select count(*)::text from public.athletes where id = %L', pp.get('K2')));
  perform pp.ok(r = 'OK:1', 'link: the requester now has guardian access to the SAME athlete');
  perform pp.ok((select not can_see_medical and not can_pay and relation = 'father' from public.family_members
                  where family_id = '00000000-0000-0000-0000-0000000aa061' and profile_id = pp.get('G2')),
                'link: guardian member of the child''s family with the permissions the approver chose');
  perform pp.ok((select count(*) from public.athletes where last_name ilike 'otherkid') = 1, 'link: no duplicate profile was created');

  -- Staff approval (Carla's Mateo).
  r := pp.run_as(pp.get('G2'), $q$select public.participant_link_request('{"first_name":"Mateo","last_name":"Lopes","dob":"2016-03-14","relation":"guardian"}'::jsonb, gen_random_uuid())::text$q$);
  v_link := (pp.j(r)->>'link_request_id')::uuid;
  perform pp.ok(exists (select 1 from public.data_review_flags where reason_code = 'ATHLETE_LINK_REQUEST' and entity_id = v_link and resolved_at is null),
                'link: staff see the request in data review (ATHLETE_LINK_REQUEST)');
  r := pp.run_as(pp.get('ADMIN'), 'select public.participant_review_queue()::text');
  perform pp.ok(exists (select 1 from jsonb_array_elements(pp.j(r)->'links') x where (x->>'athlete_id')::uuid = pp.get('MATEO')),
                'link: the staff queue shows the full match');
  r := pp.run_as(pp.get('ADMIN'), format('select public.participant_link_decide(%L, %L)::text', v_link, 'approve'));
  perform pp.ok(pp.j(r)->>'status' = 'approved', 'link: approved by staff');
  r := pp.run_as(pp.get('G2'), format('select count(*)::text from public.athletes where id = %L', pp.get('MATEO')));
  perform pp.ok(r = 'OK:1', 'link: staff approval gives the requester access');
  perform pp.ok(not exists (select 1 from public.data_review_flags where entity_id = v_link and resolved_at is null), 'link: the flag is resolved');

  -- "This is a different child": new profile, flagged for staff.
  r := pp.run_as(pp.get('S'), $q$select public.participant_create('{"first_name":"Lucas","last_name":"Muller","dob":"2014-09-02","gender":"male","decision":"different"}'::jsonb, gen_random_uuid())::text$q$);
  perform pp.ok(pp.j(r)->>'possible_duplicate' = 'true', 'different child: created with possible_duplicate (' || r || ')');
  perform pp.ok(exists (select 1 from public.data_review_flags where reason_code = 'POSSIBLE_DUPLICATE' and entity_id = (pp.j(r)->>'athlete_id')::uuid and resolved_at is null),
                'different child: POSSIBLE_DUPLICATE flag for staff');
  perform pp.put('LINK1', v_link::text);
end $$;

-- ===========================================================================
-- 7. Cross-tenant denial
-- ===========================================================================
do $$
declare r text;
begin
  r := pp.run_as(pp.get('BA'), 'select count(*)::text from public.athlete_change_requests');
  perform pp.ok(r = 'OK:0', 'cross-tenant: org B admin reads no change requests');
  r := pp.run_as(pp.get('BA'), 'select count(*)::text from public.athlete_link_requests');
  perform pp.ok(r = 'OK:0', 'cross-tenant: org B admin reads no link requests');
  r := pp.run_as(pp.get('BA'), format('select public.participant_change_decide(%L, %L)::text', pp.get('CR2'), 'approve'));
  perform pp.ok(r like 'ERR:NOT_FOUND%', 'cross-tenant: participant_change_decide refused');
  r := pp.run_as(pp.get('BA'), format('select public.participant_change_withdraw(%L)::text', pp.get('CR2')));
  perform pp.ok(r like 'ERR:NOT_FOUND%', 'cross-tenant: participant_change_withdraw refused');
  r := pp.run_as(pp.get('BA'), format('select public.participant_link_decide(%L, %L)::text', pp.get('LINK1'), 'decline'));
  perform pp.ok(r like 'ERR:NOT_FOUND%', 'cross-tenant: participant_link_decide refused');
  r := pp.run_as(pp.get('BA'), format('select public.participant_link_withdraw(%L)::text', pp.get('LINK1')));
  perform pp.ok(r like 'ERR:NOT_FOUND%', 'cross-tenant: participant_link_withdraw refused');
  r := pp.run_as(pp.get('BA'), format($q$select public.participant_update(%L, '{"first_name":"X"}'::jsonb, gen_random_uuid())::text$q$, pp.get('K1')));
  perform pp.ok(r like 'ERR:NOT_FOUND%', 'cross-tenant: participant_update refused');
  r := pp.run_as(pp.get('BA'), format($q$select public.participant_update_sports(%L, '{"height_cm":"160"}'::jsonb)::text$q$, pp.get('K1')));
  perform pp.ok(r like 'ERR:NOT_FOUND%', 'cross-tenant: participant_update_sports refused');
  r := pp.run_as(pp.get('BA'), format('select public.participant_sports_profile(%L)::text', pp.get('K1')));
  perform pp.ok(r = 'OK:<null>', 'cross-tenant: participant_sports_profile returns nothing');
  r := pp.run_as(pp.get('BA'), 'select public.participant_review_queue()::text');
  perform pp.ok(pp.j(r) = '{"links": [], "changes": []}'::jsonb, 'cross-tenant: org B review queue is empty');
  r := pp.run_as(pp.get('BA'), 'select public.participant_link_inbox()::text');
  perform pp.ok(r = 'OK:[]', 'cross-tenant: org B link inbox is empty');
  r := pp.run_as(pp.get('BA'), 'select public.participant_my_requests()::text');
  perform pp.ok(pp.j(r) = '{"links": [], "changes": []}'::jsonb, 'cross-tenant: org B sees no requests');
  r := pp.run_as(pp.get('BA'), $q$select public.participant_link_request('{"first_name":"Synthetic","last_name":"Otherkid","dob":"2015-06-06"}'::jsonb, gen_random_uuid())::text$q$);
  perform pp.ok(r like 'ERR:NO_MATCH%', 'cross-tenant: matching never looks into another club');
  r := pp.run_as(pp.get('BA'), $q$select public.participant_create('{"first_name":"Synthetic","last_name":"Otherkid","dob":"2015-06-06","gender":"female"}'::jsonb, gen_random_uuid())::text$q$);
  perform pp.ok(pp.j(r)->>'ok' = 'true' and coalesce(pp.j(r)->>'possible_duplicate', 'false') = 'false'
                and (select org_id from public.athletes where id = (pp.j(r)->>'athlete_id')::uuid) = '10000000-0000-0000-0000-000000000002',
                'cross-tenant: participant_create stays in the caller''s club (no cross-club match)');
  r := pp.run_as(pp.get('BA'), format('select public.participant_self_ensure(%L::jsonb, gen_random_uuid())::text', '{}'));
  perform pp.ok(r like 'ERR:NAME_REQUIRED%', 'cross-tenant: participant_self_ensure only looks at the caller''s club');
  r := pp.run_as(pp.get('G'), 'select count(*)::text from public.athlete_link_requests');
  perform pp.ok(r = 'OK:0', 'guardians read link requests only through the inbox RPC');
  r := pp.run_as(pp.get('G'), format($q$insert into public.athlete_change_requests (org_id, athlete_id, changes) values ('00000000-0000-0000-0000-000000000001', %L, '{}') returning id::text$q$, pp.get('K1')));
  perform pp.ok(r like 'ERR:%', 'change requests are written by the RPCs only');
  r := pp.run_as(pp.get('ADMIN'), format($q$update public.athlete_link_requests set status = 'approved' where id = %L returning id::text$q$, pp.get('LINK1')));
  perform pp.ok(r = 'OK:<null>', 'link requests are decided by the RPC only (no direct UPDATE)');
end $$;
