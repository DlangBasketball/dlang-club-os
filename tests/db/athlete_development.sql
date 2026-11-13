-- ============================================================================
-- Athlete development suite (migration 20250420100600_athlete_development.sql)
--
--   A. Assessment builder: admin / coach create templates and items; coaches
--      edit only their own; guardians and finance cannot write.
--   B. Evaluations: coach of the athlete evaluates; scale enforced; overall
--      score rolled up; family sees it only once shared and only their own
--      child; finance, other coaches and other clubs see nothing.
--   C. Exercises, plans, assignments, completions (check-off + feedback).
--   D. Nutrition plans: templates, client-specific plans, assignments.
--   E. Wellness: only for teams that enabled it; admin, the athlete's
--      coaches and guardians only; never finance.
--   F. Settings: members read, admin writes.
--   G. Cross-tenant denial for every new table (read and write) and
--      cross-org references.
--   H. Storage access helper and audit rows.
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach Derrick
-- …f3 = coach …011 who coaches Lucas …072 and Sophia …073 through programme
-- …043, guardian Carla …f4 of Mateo …071). Created here: a second coach login
-- (coach …012, no athletes), a guardian of family …062 (Lucas + Sophia) and
-- org B's admin + athlete. SYNTHETIC DATA ONLY.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema ad;
grant usage on schema ad to authenticated, anon, service_role;

create function ad.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

create function ad.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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
grant execute on all functions in schema ad to authenticated, anon, service_role;

-- Synthetic users.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000c2', 'coach-two-dev@example.test'),
  ('a0000000-0000-0000-0000-0000000000a2', 'guardian-two-dev@example.test'),
  ('b0000000-0000-0000-0000-0000000000d1', 'admin-b-dev@example.test');
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001'
 where id in ('a0000000-0000-0000-0000-0000000000c2', 'a0000000-0000-0000-0000-0000000000a2');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-0000000000d1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000c2', 'coach'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000d1', 'admin');
update public.coaches set profile_id = 'a0000000-0000-0000-0000-0000000000c2' where id = '00000000-0000-0000-0000-000000000012';
insert into public.family_members (family_id, profile_id, relation, is_primary) values
  ('00000000-0000-0000-0000-000000000062', 'a0000000-0000-0000-0000-0000000000a2', 'guardian', true);
insert into public.families (id, org_id, name) values
  ('b0000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-000000000002', 'Synthetic B family');
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob) values
  ('b0000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000f1', 'Synthetic', 'B-kid', '2014-01-01');

-- ===========================================================================
-- A. Assessment builder
-- ===========================================================================
do $$
declare v text;
begin
  v := ad.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.assessment_templates (id, org_id, name, sport, age_group, age_min, age_max, created_by)
          values ('a0000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-000000000001', 'Synthetic U12 skills', 'basketball', 'U12', 10, 13,
                  '00000000-0000-0000-0000-0000000000f1') returning id::text$q$);
  perform ad.ok(v like 'OK:%', 'admin creates an assessment template (' || v || ')');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.assessment_items (id, org_id, template_id, kind, label, scale_min, scale_max, weight, sort_order) values
            ('a0000000-0000-0000-0000-00000000d101', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000d001', 'skill', 'Ball handling', 1, 5, 2, 1),
            ('a0000000-0000-0000-0000-00000000d102', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000d001', 'skill', 'Shooting form', 1, 10, 1, 2)
          returning 'x'$q$);
  perform ad.ok(v like 'OK:%', 'admin adds skill items with scales 1-5 and 1-10');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.assessment_items (id, org_id, template_id, kind, label, unit, sort_order) values
            ('a0000000-0000-0000-0000-00000000d103', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000d001', 'measurement', 'Height', 'cm', 3),
            ('a0000000-0000-0000-0000-00000000d104', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000d001', 'text', 'Attitude', null, 4)
          returning 'x'$q$);
  perform ad.ok(v like 'OK:%', 'admin adds a measurement item (unit) and a free-text item');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.assessment_items (org_id, template_id, kind, label, scale_min, scale_max)
          values ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000d001', 'skill', 'Bad', 5, 5) returning id::text$q$);
  perform ad.ok(v like 'ERR:%', 'an item whose scale max is not above min is refused');

  v := ad.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$insert into public.assessment_templates (id, org_id, name, created_by)
          values ('a0000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-000000000001', 'Derrick sprint test', '00000000-0000-0000-0000-0000000000f3') returning id::text$q$);
  perform ad.ok(v like 'OK:%', 'a coach creates their own template');
  v := ad.run_as('a0000000-0000-0000-0000-0000000000c2',
       $q$with u as (update public.assessment_templates set name = 'hijack' where id = 'a0000000-0000-0000-0000-00000000d002' returning 1) select count(*)::text from u$q$);
  perform ad.ok(v = 'OK:0', 'another coach cannot edit that template (' || v || ')');
  v := ad.run_as('a0000000-0000-0000-0000-0000000000c2',
       $q$insert into public.assessment_items (org_id, template_id, kind, label)
          values ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000d002', 'skill', 'x') returning id::text$q$);
  perform ad.ok(v like 'ERR:%', 'another coach cannot add items to that template');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$insert into public.assessment_templates (org_id, name) values ('00000000-0000-0000-0000-000000000001', 'x') returning id::text$q$);
  perform ad.ok(v like 'ERR:%', 'a guardian cannot create templates');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$insert into public.assessment_templates (org_id, name) values ('00000000-0000-0000-0000-000000000001', 'x') returning id::text$q$);
  perform ad.ok(v like 'ERR:%', 'finance cannot create templates');
end $$;

-- ===========================================================================
-- B. Evaluations
-- ===========================================================================
do $$
declare v text;
begin
  v := ad.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$insert into public.evaluations (id, org_id, athlete_id, template_id, coach_id, evaluated_on, comments, created_by)
          values ('a0000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000072',
                  'a0000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-000000000011', current_date - 30, 'Synthetic comment',
                  '00000000-0000-0000-0000-0000000000f3') returning id::text$q$);
  perform ad.ok(v like 'OK:%', 'the coach of Lucas evaluates him (' || v || ')');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$insert into public.evaluations (org_id, athlete_id, template_id, coach_id)
          values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000071',
                  'a0000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-000000000011') returning id::text$q$);
  perform ad.ok(v like 'ERR:%', 'a coach cannot evaluate an athlete they do not coach (' || v || ')');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$insert into public.evaluations (org_id, athlete_id, template_id)
          values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000072', 'a0000000-0000-0000-0000-00000000d001') returning id::text$q$);
  perform ad.ok(v like 'ERR:%', 'finance cannot create evaluations');

  v := ad.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$insert into public.evaluation_scores (org_id, evaluation_id, item_id, score)
          values ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000e001', 'a0000000-0000-0000-0000-00000000d101', 6) returning id::text$q$);
  perform ad.ok(v like 'ERR:%SCORE_OUT_OF_RANGE%', 'a score above the item scale is refused (' || v || ')');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$insert into public.evaluation_scores (org_id, evaluation_id, item_id, score, value, text_value) values
            ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000e001', 'a0000000-0000-0000-0000-00000000d101', 4, null, null),
            ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000e001', 'a0000000-0000-0000-0000-00000000d102', 7, null, null),
            ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000e001', 'a0000000-0000-0000-0000-00000000d103', null, 152, null),
            ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000e001', 'a0000000-0000-0000-0000-00000000d104', null, null, 'Great focus')
          returning 'x'$q$);
  perform ad.ok(v like 'OK:%', 'the coach records skill scores, a measurement and a comment (' || v || ')');
  perform ad.ok((select overall_score = 72.22 from public.evaluations where id = 'a0000000-0000-0000-0000-00000000e001'),
                'overall score = weighted normalised skill mean (2x75 + 66.67) / 3 = 72.22 (got '
                || (select overall_score::text from public.evaluations where id = 'a0000000-0000-0000-0000-00000000e001') || ')');
  perform ad.ok((select value = 152 and score is null from public.evaluation_scores where item_id = 'a0000000-0000-0000-0000-00000000d103'),
                'measurement keeps its value, no score');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$insert into public.evaluation_scores (org_id, evaluation_id, item_id, score)
          values ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000e001',
                  (select id from public.assessment_items where template_id = 'a0000000-0000-0000-0000-00000000d002' limit 1), 3) returning id::text$q$);
  perform ad.ok(v like 'ERR:%', 'an item of another template cannot be scored on this evaluation');

  -- Visibility before sharing.
  v := ad.run_as('a0000000-0000-0000-0000-0000000000a2', $q$select count(*)::text from public.evaluations$q$);
  perform ad.ok(v = 'OK:0', 'guardian of Lucas does not see an unshared evaluation (' || v || ')');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f2', $q$select count(*)::text from public.evaluations$q$);
  perform ad.ok(v = 'OK:0', 'finance cannot read evaluations (' || v || ')');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f2', $q$select count(*)::text from public.evaluation_scores$q$);
  perform ad.ok(v = 'OK:0', 'finance cannot read evaluation scores / measurements (' || v || ')');
  v := ad.run_as('a0000000-0000-0000-0000-0000000000c2', $q$select count(*)::text from public.evaluations$q$);
  perform ad.ok(v = 'OK:0', 'a coach who does not coach Lucas cannot read his evaluation (' || v || ')');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.evaluation_scores$q$);
  perform ad.ok(v = 'OK:4', 'admin reads all scores (' || v || ')');
  v := ad.run_as('a0000000-0000-0000-0000-0000000000c2',
       $q$with u as (update public.evaluations set comments = 'x' where id = 'a0000000-0000-0000-0000-00000000e001' returning 1) select count(*)::text from u$q$);
  perform ad.ok(v = 'OK:0', 'another coach cannot edit the evaluation');

  -- Share with the family.
  v := ad.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$with u as (update public.evaluations set shared_with_family = true where id = 'a0000000-0000-0000-0000-00000000e001' returning shared_at) select count(*)::text from u where shared_at is not null$q$);
  perform ad.ok(v = 'OK:1', 'the coach shares it with the family (shared_at stamped)');
  v := ad.run_as('a0000000-0000-0000-0000-0000000000a2', $q$select count(*)::text from public.evaluations$q$);
  perform ad.ok(v = 'OK:1', 'guardian of Lucas now reads the shared evaluation');
  v := ad.run_as('a0000000-0000-0000-0000-0000000000a2', $q$select count(*)::text from public.evaluation_scores$q$);
  perform ad.ok(v = 'OK:4', 'guardian of Lucas reads its scores and measurements');
  v := ad.run_as('a0000000-0000-0000-0000-0000000000a2',
       $q$with u as (update public.evaluations set comments = 'x' where id = 'a0000000-0000-0000-0000-00000000e001' returning 1) select count(*)::text from u$q$);
  perform ad.ok(v = 'OK:0', 'a guardian cannot edit an evaluation');
  v := ad.run_as('a0000000-0000-0000-0000-0000000000a2',
       $q$with u as (update public.evaluation_scores set score = 5 where evaluation_id = 'a0000000-0000-0000-0000-00000000e001' returning 1) select count(*)::text from u$q$);
  perform ad.ok(v = 'OK:0', 'a guardian cannot change scores');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.evaluations$q$);
  perform ad.ok(v = 'OK:0', 'a parent cannot read another family''s child evaluation (' || v || ')');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.evaluation_scores$q$);
  perform ad.ok(v = 'OK:0', 'a parent cannot read another family''s child scores');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f2', $q$select count(*)::text from public.evaluations$q$);
  perform ad.ok(v = 'OK:0', 'finance still cannot read a shared evaluation');
end $$;

-- ===========================================================================
-- C. Exercises, plans, assignments, completions
-- ===========================================================================
do $$
declare v text;
begin
  v := ad.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.exercises (id, org_id, name, sport, category, video_url, equipment, difficulty, created_by)
          values ('a0000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-000000000001', 'Synthetic wall sit', 'basketball', 'strength_conditioning',
                  'https://www.youtube.com/watch?v=dQw4w9WgXcQ', '{wall}', 'beginner', '00000000-0000-0000-0000-0000000000f1') returning id::text$q$);
  perform ad.ok(v like 'OK:%', 'admin adds an exercise with a video link');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.exercises (org_id, name, video_url) values ('00000000-0000-0000-0000-000000000001', 'x', 'javascript:alert(1)') returning id::text$q$);
  perform ad.ok(v like 'ERR:%', 'a non-https video URL is refused');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$insert into public.exercises (org_id, name) values ('00000000-0000-0000-0000-000000000001', 'x') returning id::text$q$);
  perform ad.ok(v like 'ERR:%', 'a guardian cannot add exercises');

  v := ad.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.training_plans (id, org_id, name, sport, age_min, age_max, level, weeks, is_template, auto_assign, created_by)
          values ('a0000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-000000000001', 'Synthetic home plan', 'basketball', 10, 14, 'beginner', 2, true, true,
                  '00000000-0000-0000-0000-0000000000f1') returning id::text$q$);
  perform ad.ok(v like 'OK:%', 'admin creates an auto-assign plan template');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.training_plan_items (id, org_id, plan_id, week, day, exercise_id, sets, reps, notes) values
            ('a0000000-0000-0000-0000-00000000f201', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000f101', 1, 1, 'a0000000-0000-0000-0000-00000000f001', 3, 30, null),
            ('a0000000-0000-0000-0000-00000000f202', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000f101', 1, 3, null, null, null, 'Free shooting')
          returning 'x'$q$);
  perform ad.ok(v like 'ERR:%', 'an item with neither exercise nor title is refused');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.training_plan_items (id, org_id, plan_id, week, day, exercise_id, title, sets, reps) values
            ('a0000000-0000-0000-0000-00000000f201', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000f101', 1, 1, 'a0000000-0000-0000-0000-00000000f001', null, 3, 30),
            ('a0000000-0000-0000-0000-00000000f202', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000f101', 1, 3, null, 'Free shooting', null, 100)
          returning 'x'$q$);
  perform ad.ok(v like 'OK:%', 'admin adds week 1 items (exercise + custom)');
  v := ad.run_as('a0000000-0000-0000-0000-0000000000c2',
       $q$with u as (update public.training_plan_items set reps = 1 where plan_id = 'a0000000-0000-0000-0000-00000000f101' returning 1) select count(*)::text from u$q$);
  perform ad.ok(v = 'OK:0', 'a coach cannot edit a plan created by someone else');

  v := ad.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$insert into public.training_plan_assignments (id, org_id, plan_id, athlete_id, source, assigned_by)
          values ('a0000000-0000-0000-0000-00000000f301', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000f101',
                  '00000000-0000-0000-0000-000000000072', 'manual', '00000000-0000-0000-0000-0000000000f3') returning id::text$q$);
  perform ad.ok(v like 'OK:%', 'the coach assigns the plan to Lucas (' || v || ')');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$insert into public.training_plan_assignments (org_id, plan_id, athlete_id)
          values ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-000000000072') returning id::text$q$);
  perform ad.ok(v like 'ERR:%', 'the same plan cannot be active twice for one athlete');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$insert into public.training_plan_assignments (org_id, plan_id, athlete_id)
          values ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-000000000071') returning id::text$q$);
  perform ad.ok(v like 'ERR:%', 'a coach cannot assign a plan to an athlete they do not coach');

  v := ad.run_as('a0000000-0000-0000-0000-0000000000a2', $q$select count(*)::text from public.training_plan_items where plan_id = 'a0000000-0000-0000-0000-00000000f101'$q$);
  perform ad.ok(v = 'OK:2', 'guardian of Lucas reads the assigned plan items (' || v || ')');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.training_plans$q$);
  perform ad.ok(v = 'OK:0', 'a guardian with no assignment does not see the plan (' || v || ')');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.training_plan_assignments$q$);
  perform ad.ok(v = 'OK:0', 'a parent cannot read another family''s child plan assignment');

  v := ad.run_as('a0000000-0000-0000-0000-0000000000a2',
       $q$insert into public.training_plan_completions (org_id, assignment_id, item_id, athlete_id, rating, comment, completed_by)
          values ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000f301', 'a0000000-0000-0000-0000-00000000f201',
                  '00000000-0000-0000-0000-000000000072', 4, 'Hard but fun', 'a0000000-0000-0000-0000-0000000000a2') returning id::text$q$);
  perform ad.ok(v like 'OK:%', 'guardian checks off a home exercise with feedback (' || v || ')');
  v := ad.run_as('a0000000-0000-0000-0000-0000000000a2',
       $q$insert into public.training_plan_completions (org_id, assignment_id, item_id, athlete_id)
          values ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000f301', 'a0000000-0000-0000-0000-00000000f202',
                  '00000000-0000-0000-0000-000000000073') returning id::text$q$);
  perform ad.ok(v like 'ERR:%ASSIGNMENT_MISMATCH%', 'a completion for another child than the assignment is refused (' || v || ')');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$insert into public.training_plan_completions (org_id, assignment_id, item_id, athlete_id)
          values ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000f301', 'a0000000-0000-0000-0000-00000000f202',
                  '00000000-0000-0000-0000-000000000072') returning id::text$q$);
  perform ad.ok(v like 'ERR:%', 'another family cannot check off Lucas''s plan');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f3', $q$select coalesce(avg(rating), 0)::int::text from public.training_plan_completions$q$);
  perform ad.ok(v = 'OK:4', 'the coach reads the feedback (' || v || ')');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f2', $q$select (select count(*) from public.training_plan_completions) + (select count(*) from public.training_plan_assignments)$q$);
  perform ad.ok(v = 'OK:0', 'finance cannot read plan assignments or completions (' || v || ')');
end $$;

-- ===========================================================================
-- D. Nutrition
-- ===========================================================================
do $$
declare v text;
begin
  v := ad.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.nutrition_plans (id, org_id, name, age_min, age_max, hydration_ml, guidelines, created_by)
          values ('a0000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-000000000001', 'Synthetic U12 fuel', 9, 13, 1500, 'Eat colours',
                  '00000000-0000-0000-0000-0000000000f1') returning id::text$q$);
  perform ad.ok(v like 'OK:%', 'admin creates an age-group nutrition template');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.nutrition_plan_meals (org_id, plan_id, day, meal, description)
          values ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000c001', 0, 'breakfast', 'Oats and fruit') returning id::text$q$);
  perform ad.ok(v like 'OK:%', 'admin adds a daily meal');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.nutrition_plans (id, org_id, name, athlete_id, created_by)
          values ('a0000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-000000000001', 'Synthetic Mateo plan', '00000000-0000-0000-0000-000000000071',
                  '00000000-0000-0000-0000-0000000000f1') returning id::text$q$);
  perform ad.ok(v like 'OK:%', 'admin creates a client-specific plan for Mateo');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$insert into public.nutrition_plan_assignments (org_id, plan_id, athlete_id, assigned_by)
          values ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-000000000072',
                  '00000000-0000-0000-0000-0000000000f3') returning id::text$q$);
  perform ad.ok(v like 'OK:%', 'the coach assigns the template to Lucas');
  v := ad.run_as('a0000000-0000-0000-0000-0000000000a2', $q$select string_agg(name, ',' order by name) from public.nutrition_plans$q$);
  perform ad.ok(v = 'OK:Synthetic U12 fuel', 'guardian of Lucas reads only the plan assigned to Lucas (' || v || ')');
  v := ad.run_as('a0000000-0000-0000-0000-0000000000a2', $q$select count(*)::text from public.nutrition_plan_meals$q$);
  perform ad.ok(v = 'OK:1', 'guardian of Lucas reads its meals');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f4', $q$select string_agg(name, ',' order by name) from public.nutrition_plans$q$);
  perform ad.ok(v = 'OK:Synthetic Mateo plan', 'Mateo''s guardian reads only Mateo''s client-specific plan (' || v || ')');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.nutrition_plan_assignments$q$);
  perform ad.ok(v = 'OK:0', 'a parent cannot read another family''s nutrition assignment');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f2', $q$select count(*)::text from public.nutrition_plans$q$);
  perform ad.ok(v = 'OK:0', 'finance cannot read nutrition plans (' || v || ')');
  v := ad.run_as('a0000000-0000-0000-0000-0000000000c2', $q$select count(*)::text from public.nutrition_plans where athlete_id is not null$q$);
  perform ad.ok(v = 'OK:0', 'a coach who does not coach Mateo cannot read his client-specific plan');
  v := ad.run_as('a0000000-0000-0000-0000-0000000000c2',
       $q$insert into public.nutrition_plans (org_id, name, athlete_id) values ('00000000-0000-0000-0000-000000000001', 'x', '00000000-0000-0000-0000-000000000071') returning id::text$q$);
  perform ad.ok(v like 'ERR:%', 'a coach cannot create a client-specific plan for an athlete they do not coach');
end $$;

-- ===========================================================================
-- E. Wellness
-- ===========================================================================
do $$
declare v text;
begin
  v := ad.run_as('a0000000-0000-0000-0000-0000000000a2',
       $q$insert into public.wellness_checkins (org_id, athlete_id, sleep, energy, soreness, mood)
          values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000072', 4, 4, 2, 5) returning id::text$q$);
  perform ad.ok(v like 'ERR:%WELLNESS_DISABLED%', 'no check-in while no team of the athlete enabled the questionnaire (' || v || ')');

  insert into public.teams (id, org_id, name, sport, wellness_enabled)
  values ('a0000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-000000000001', 'Synthetic U12 wellness', 'basketball', true);
  insert into public.team_memberships (org_id, team_id, athlete_id)
  values ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-000000000072');

  v := ad.run_as('a0000000-0000-0000-0000-0000000000a2',
       $q$insert into public.wellness_checkins (org_id, athlete_id, sleep, energy, soreness, mood, note, submitted_by)
          values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000072', 2, 3, 5, 4, 'Knee sore',
                  'a0000000-0000-0000-0000-0000000000a2') returning id::text$q$);
  perform ad.ok(v like 'OK:%', 'guardian of Lucas submits today''s check-in (' || v || ')');
  v := ad.run_as('a0000000-0000-0000-0000-0000000000a2',
       $q$insert into public.wellness_checkins (org_id, athlete_id, sleep, energy, soreness, mood)
          values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000072', 6, 3, 3, 3) returning id::text$q$);
  perform ad.ok(v like 'ERR:%', 'values outside 1-5 are refused');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$insert into public.wellness_checkins (org_id, athlete_id, checkin_date, sleep, energy, soreness, mood)
          values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000072', current_date - 1, 3, 3, 3, 3) returning id::text$q$);
  perform ad.ok(v like 'ERR:%', 'another family cannot submit for Lucas');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.wellness_checkins$q$);
  perform ad.ok(v = 'OK:0', 'a parent cannot read another family''s child wellness (' || v || ')');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f2', $q$select count(*)::text from public.wellness_checkins$q$);
  perform ad.ok(v = 'OK:0', 'finance cannot read wellness data (' || v || ')');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.wellness_checkins$q$);
  perform ad.ok(v = 'OK:1', 'Lucas''s coach reads his wellness');
  v := ad.run_as('a0000000-0000-0000-0000-0000000000c2', $q$select count(*)::text from public.wellness_checkins$q$);
  perform ad.ok(v = 'OK:0', 'a coach who does not coach Lucas cannot read his wellness');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.wellness_checkins$q$);
  perform ad.ok(v = 'OK:1', 'admin reads the club''s wellness');
end $$;

-- ===========================================================================
-- F. Settings
-- ===========================================================================
do $$
declare v text;
begin
  v := ad.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.development_settings (org_id, attendance_weight, evaluation_weight) values ('00000000-0000-0000-0000-000000000001', 40, 60) returning org_id::text$q$);
  perform ad.ok(v like 'OK:%', 'admin saves ranking weights');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$with u as (update public.development_settings set attendance_weight = 100 returning 1) select count(*)::text from u$q$);
  perform ad.ok(v = 'OK:0', 'finance cannot change ranking settings');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f4', $q$select jsonb_array_length(levels)::text from public.development_settings$q$);
  perform ad.ok(v = 'OK:5', 'a guardian reads the level / emoji scale (' || v || ')');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.development_settings (org_id, attendance_weight, evaluation_weight) values ('10000000-0000-0000-0000-000000000002', 1, 1) returning org_id::text$q$);
  perform ad.ok(v like 'ERR:%', 'admin A cannot write org B settings');
end $$;

-- ===========================================================================
-- G. Cross-tenant denial
-- ===========================================================================
do $$
declare v text; t text;
begin
  foreach t in array array['development_settings', 'assessment_templates', 'assessment_items', 'evaluations', 'evaluation_scores', 'exercises',
                           'training_plans', 'training_plan_items', 'training_plan_assignments', 'training_plan_completions',
                           'nutrition_plans', 'nutrition_plan_meals', 'nutrition_plan_assignments', 'wellness_checkins'] loop
    v := ad.run_as('b0000000-0000-0000-0000-0000000000d1', format('select count(*)::text from public.%I', t));
    perform ad.ok(v = 'OK:0', 'org B admin reads nothing of org A in ' || t || ' (' || v || ')');
  end loop;

  v := ad.run_as('b0000000-0000-0000-0000-0000000000d1',
       $q$with u as (update public.evaluations set comments = 'x' returning 1) select count(*)::text from u$q$);
  perform ad.ok(v = 'OK:0', 'org B admin cannot update org A evaluations');
  v := ad.run_as('b0000000-0000-0000-0000-0000000000d1',
       $q$with u as (delete from public.wellness_checkins returning 1) select count(*)::text from u$q$);
  perform ad.ok(v = 'OK:0', 'org B admin cannot delete org A wellness rows');
  v := ad.run_as('b0000000-0000-0000-0000-0000000000d1',
       $q$with u as (delete from public.training_plans returning 1) select count(*)::text from u$q$);
  perform ad.ok(v = 'OK:0', 'org B admin cannot delete org A plans');
  v := ad.run_as('b0000000-0000-0000-0000-0000000000d1',
       $q$insert into public.assessment_templates (org_id, name) values ('00000000-0000-0000-0000-000000000001', 'x') returning id::text$q$);
  perform ad.ok(v like 'ERR:%', 'org B admin cannot insert into org A (template)');
  v := ad.run_as('b0000000-0000-0000-0000-0000000000d1',
       $q$insert into public.exercises (org_id, name) values ('00000000-0000-0000-0000-000000000001', 'x') returning id::text$q$);
  perform ad.ok(v like 'ERR:%', 'org B admin cannot insert into org A (exercise)');
  v := ad.run_as('b0000000-0000-0000-0000-0000000000d1',
       $q$insert into public.evaluations (org_id, athlete_id, template_id) values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000072', 'a0000000-0000-0000-0000-00000000d001') returning id::text$q$);
  perform ad.ok(v like 'ERR:%', 'org B admin cannot evaluate an org A athlete via its own org id (' || v || ')');
  v := ad.run_as('b0000000-0000-0000-0000-0000000000d1',
       $q$insert into public.training_plans (id, org_id, name) values ('b0000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-000000000002', 'B plan') returning id::text$q$);
  perform ad.ok(v like 'OK:%', 'org B admin creates its own plan');
  v := ad.run_as('b0000000-0000-0000-0000-0000000000d1',
       $q$insert into public.training_plan_items (org_id, plan_id, week, day, exercise_id) values ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000e1', 1, 1, 'a0000000-0000-0000-0000-00000000f001') returning id::text$q$);
  perform ad.ok(v like 'ERR:%CROSS_ORG_REFERENCE%', 'org B plan cannot reference an org A exercise (' || v || ')');
  v := ad.run_as('b0000000-0000-0000-0000-0000000000d1',
       $q$insert into public.training_plan_assignments (org_id, plan_id, athlete_id) values ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000072') returning id::text$q$);
  perform ad.ok(v like 'ERR:%', 'org B cannot assign its plan to an org A athlete');
  v := ad.run_as('b0000000-0000-0000-0000-0000000000d1',
       $q$insert into public.training_plan_assignments (org_id, plan_id, athlete_id) values ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000e1', 'b0000000-0000-0000-0000-0000000000a1') returning id::text$q$);
  perform ad.ok(v like 'OK:%', 'org B assigns its plan to its own athlete');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.training_plan_assignments where org_id = '10000000-0000-0000-0000-000000000002'$q$);
  perform ad.ok(v = 'OK:0', 'org A admin cannot see org B assignments');
  v := ad.run_as('b0000000-0000-0000-0000-0000000000d1',
       $q$insert into public.wellness_checkins (org_id, athlete_id, sleep, energy, soreness, mood) values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000072', 3, 3, 3, 3) returning id::text$q$);
  perform ad.ok(v like 'ERR:%', 'org B cannot write wellness for an org A athlete');
  v := ad.run_as(null, $q$select count(*)::text from public.evaluations$q$);
  perform ad.ok(v like 'ERR:%' or v = 'OK:0', 'anonymous users read no evaluations');
end $$;

-- ===========================================================================
-- H. Storage helper + audit
-- ===========================================================================
do $$
declare v text;
begin
  v := ad.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select public.exercise_video_access('00000000-0000-0000-0000-000000000001/a0000000-0000-0000-0000-00000000f001/clip.mp4')::text$q$);
  perform ad.ok(v = 'OK:true', 'admin may store a video for the club exercise');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select public.exercise_video_access('00000000-0000-0000-0000-000000000001/a0000000-0000-0000-0000-00000000f001/clip.mp4')::text$q$);
  perform ad.ok(v = 'OK:false', 'a guardian has no direct access to the private video bucket');
  v := ad.run_as('b0000000-0000-0000-0000-0000000000d1',
       $q$select public.exercise_video_access('00000000-0000-0000-0000-000000000001/a0000000-0000-0000-0000-00000000f001/clip.mp4')::text$q$);
  perform ad.ok(v = 'OK:false', 'org B admin has no access to org A videos');
  v := ad.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.exercise_video_access('../etc/passwd')::text$q$);
  perform ad.ok(v = 'OK:false', 'a malformed path is refused');
  perform ad.ok((select public from storage.buckets where id = 'exercise-videos') = false, 'the exercise-videos bucket is private');

  perform ad.ok((select count(*) from public.audit_logs where target_table = 'evaluations' and target_id = 'a0000000-0000-0000-0000-00000000e001') >= 2,
                'evaluation insert + share are audit-logged');
  perform ad.ok((select count(*) from public.audit_logs where target_table = 'wellness_checkins') >= 1, 'wellness check-ins are audit-logged');
  perform ad.ok((select count(*) from public.audit_logs where target_table = 'training_plan_completions') >= 1, 'plan completions are audit-logged');
end $$;
