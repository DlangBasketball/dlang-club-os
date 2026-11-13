-- ============================================================================
-- Forms, contracts and registration form editor suite
-- (migration 20250420100800_forms_contracts.sql)
--
--   A. Forms + versions: admin builds and publishes (version 1, 2 ...);
--      versions are immutable; parents see only published forms; coach /
--      finance / guardians cannot build.
--   B. Assignments + reminder log: admin only writes; members read.
--   C. Submissions: guardians submit for their OWN child only; the current
--      version only; valid_until from the renewal period; append-only (no
--      edits, no deletes, admins may only void); another family's guardian,
--      finance and coaches read nothing; old submissions stay on version 1.
--   D. Coach safety answers: only flagged fields, only athletes they coach;
--      finance / parents / other coaches get nothing.
--   E. Registration form configs + answers: admin writes; guardian reads own
--      child's answers only; finance none.
--   F. Contracts: guardian of the family signs via sign_contract (typed name,
--      IP hash, timestamp, version); signed contracts are immutable (pdf_path
--      once, void only); other families / finance cannot read or sign.
--   G. Storage: form-files and contracts buckets keyed by org/family.
--   H. Cross-tenant denial on every table and both buckets; audit rows carry
--      no answers.
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach Derrick
-- …f3 = coach …011 who coaches Lucas …072 / Sophia …073 via programme …043,
-- guardian Carla …f4 of Mateo …071 in family …061). Created here: guardian
-- of family …062, a second coach login, org B's admin + family + athlete.
-- SYNTHETIC DATA ONLY.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema ft;
grant usage on schema ft to authenticated, anon, service_role;

create function ft.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

create function ft.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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
grant execute on all functions in schema ft to authenticated, anon, service_role;

-- Synthetic users and org B.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000a2', 'guardian-two-forms@example.test'),
  ('a0000000-0000-0000-0000-0000000000c2', 'coach-two-forms@example.test'),
  ('b0000000-0000-0000-0000-0000000000d1', 'admin-b-forms@example.test');
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001'
 where id in ('a0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-0000000000c2');
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

-- A physical form: allergy question flagged "safety", a hidden-by-default follow-up, a signature.
create function ft.physical(p_label text) returns jsonb language sql as $$
  select jsonb_build_object('sections', jsonb_build_array(jsonb_build_object(
    'id', 's1', 'title', 'Health', 'description', '',
    'fields', jsonb_build_array(
      jsonb_build_object('id', 'allergies', 'type', 'text', 'label', p_label, 'required', true, 'safety', true),
      jsonb_build_object('id', 'doctor', 'type', 'text', 'label', 'Family doctor', 'required', false, 'safety', false),
      jsonb_build_object('id', 'sign', 'type', 'signature', 'label', 'Signature', 'required', true)
    ))));
$$;

-- ===========================================================================
-- A. Forms + versions
-- ===========================================================================
do $$
declare v text;
begin
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       format($q$insert into public.forms (id, org_id, title, form_type, draft_schema, created_by)
          values ('a0000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-000000000001', 'Synthetic physical', 'medical', %L::jsonb,
                  '00000000-0000-0000-0000-0000000000f1') returning id::text$q$, ft.physical('Allergies')));
  perform ft.ok(v like 'OK:%', 'admin creates a medical form (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$insert into public.forms (org_id, title) values ('00000000-0000-0000-0000-000000000001', 'x') returning id::text$q$);
  perform ft.ok(v like 'ERR:%', 'finance cannot create forms');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$insert into public.forms (org_id, title) values ('00000000-0000-0000-0000-000000000001', 'x') returning id::text$q$);
  perform ft.ok(v like 'ERR:%', 'a coach cannot create forms');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$insert into public.forms (org_id, title) values ('00000000-0000-0000-0000-000000000001', 'x') returning id::text$q$);
  perform ft.ok(v like 'ERR:%', 'a guardian cannot create forms');

  v := ft.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.forms$q$);
  perform ft.ok(v = 'OK:0', 'a guardian does not see a draft form (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f4', $q$select public.publish_form('a0000000-0000-0000-0000-00000000f001')::text$q$);
  perform ft.ok(v like 'ERR:%NOT_PERMITTED%', 'a guardian cannot publish (' || v || ')');

  v := ft.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.publish_form('a0000000-0000-0000-0000-00000000f001')::text$q$);
  perform ft.ok(v like 'OK:%', 'admin publishes version 1 (' || v || ')');
  perform ft.ok((select version from public.form_versions where form_id = 'a0000000-0000-0000-0000-00000000f001') = 1, 'first publish is version 1');
  perform ft.ok((select status = 'published' and current_version_id is not null from public.forms where id = 'a0000000-0000-0000-0000-00000000f001'), 'form is published with a current version');

  v := ft.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.forms$q$);
  perform ft.ok(v = 'OK:1', 'a guardian sees the published form (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with u as (update public.form_versions set schema = '{"sections":[]}' where form_id = 'a0000000-0000-0000-0000-00000000f001' returning 1) select count(*)::text from u$q$);
  perform ft.ok(v like 'ERR:%' or v = 'OK:0', 'a published version cannot be edited (' || v || ')');
  begin
    update public.form_versions set title = 'tamper' where form_id = 'a0000000-0000-0000-0000-00000000f001';
    perform ft.ok(false, 'versions are immutable even for the service role');
  exception when others then
    perform ft.ok(sqlerrm like '%FORM_VERSION_IMMUTABLE%', 'versions are immutable even for the service role');
  end;
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with d as (delete from public.form_versions where form_id = 'a0000000-0000-0000-0000-00000000f001' returning 1) select count(*)::text from d$q$);
  perform ft.ok(v = 'OK:0' or v like 'ERR:%', 'versions cannot be deleted (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with d as (delete from public.forms where id = 'a0000000-0000-0000-0000-00000000f001' returning 1) select count(*)::text from d$q$);
  perform ft.ok(v = 'OK:0', 'a published form cannot be deleted, only archived (' || v || ')');

  -- An empty draft cannot be published.
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.forms (id, org_id, title) values ('a0000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-000000000001', 'Empty') returning id::text$q$);
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.publish_form('a0000000-0000-0000-0000-00000000f002')::text$q$);
  perform ft.ok(v like 'ERR:%FORM_EMPTY%', 'an empty form cannot be published (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with d as (delete from public.forms where id = 'a0000000-0000-0000-0000-00000000f002' returning 1) select count(*)::text from d$q$);
  perform ft.ok(v = 'OK:1', 'a never-published draft can be deleted (' || v || ')');
end $$;

-- ===========================================================================
-- B. Assignments
-- ===========================================================================
do $$
declare v text;
begin
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.form_assignments (id, org_id, form_id, scope, renewal, due_date)
          values ('a0000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000f001',
                  'all_members', 'yearly', current_date + 30) returning id::text$q$);
  perform ft.ok(v like 'OK:%', 'admin assigns the form to all members, yearly (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.form_assignments (org_id, form_id, scope) values ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000f001', 'program') returning id::text$q$);
  perform ft.ok(v like 'ERR:%', 'a programme assignment needs a programme');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.form_assignments (org_id, form_id, scope, program_id) values ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000f001', 'program', '00000000-0000-0000-0000-000000000043') returning id::text$q$);
  perform ft.ok(v like 'OK:%', 'admin assigns the form to a programme');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$insert into public.form_assignments (org_id, form_id, scope) values ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000f001', 'all_members') returning id::text$q$);
  perform ft.ok(v like 'ERR:%', 'a guardian cannot create assignments');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.form_assignments$q$);
  perform ft.ok(v = 'OK:2', 'a guardian reads the assignments of their club (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.form_reminders (org_id, assignment_id, family_id, sent_by) values ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-0000000000f1') returning id::text$q$);
  perform ft.ok(v like 'OK:%', 'admin logs a reminder');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.form_reminders$q$);
  perform ft.ok(v = 'OK:0', 'guardians cannot read the reminder log (' || v || ')');
end $$;

-- ===========================================================================
-- C. Submissions
-- ===========================================================================
do $$
declare v text; v1 uuid; s_before int;
begin
  select current_version_id into v1 from public.forms where id = 'a0000000-0000-0000-0000-00000000f001';
  v := ft.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$insert into public.form_submissions (id, org_id, form_id, form_version_id, assignment_id, athlete_id, family_id, answers, signer_name, submitted_by, valid_until)
          values ('a0000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000f001', %L,
                  'a0000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000062',
                  '{"allergies":"Synthetic: none","doctor":"Synthetic doctor"}', 'Carla Synthetic', '00000000-0000-0000-0000-0000000000f4', '2099-01-01') returning id::text$q$, v1));
  perform ft.ok(v like 'OK:%', 'a guardian submits the form for their own child (' || v || ')');
  perform ft.ok((select family_id = '00000000-0000-0000-0000-000000000061' from public.form_submissions where id = 'a0000000-0000-0000-0000-00000000b001'),
                'family_id is forced to the athlete''s own family (client value ignored)');
  perform ft.ok((select valid_until = (current_date + interval '1 year')::date from public.form_submissions where id = 'a0000000-0000-0000-0000-00000000b001'),
                'valid_until comes from the yearly renewal, not from the client');

  v := ft.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$insert into public.form_submissions (org_id, form_id, form_version_id, athlete_id, family_id, answers, submitted_by)
          values ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000f001', %L, '00000000-0000-0000-0000-000000000072',
                  '00000000-0000-0000-0000-000000000062', '{}', '00000000-0000-0000-0000-0000000000f4') returning id::text$q$, v1));
  perform ft.ok(v like 'ERR:%', 'a guardian cannot submit for another family''s child (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$insert into public.form_submissions (org_id, form_id, form_version_id, athlete_id, family_id, answers, submitted_by)
          values ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000f001', %L, '00000000-0000-0000-0000-000000000071',
                  '00000000-0000-0000-0000-000000000061', '{}', '00000000-0000-0000-0000-0000000000f1') returning id::text$q$, v1));
  perform ft.ok(v like 'ERR:%', 'submitted_by cannot be spoofed');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f2',
       format($q$insert into public.form_submissions (org_id, form_id, form_version_id, athlete_id, family_id, answers, submitted_by)
          values ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000f001', %L, '00000000-0000-0000-0000-000000000071',
                  '00000000-0000-0000-0000-000000000061', '{}', '00000000-0000-0000-0000-0000000000f2') returning id::text$q$, v1));
  perform ft.ok(v like 'ERR:%', 'finance cannot submit medical forms');

  -- Reads
  v := ft.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.form_submissions$q$);
  perform ft.ok(v = 'OK:1', 'the guardian reads their own child''s submission (' || v || ')');
  v := ft.run_as('a0000000-0000-0000-0000-0000000000a2', $q$select count(*)::text from public.form_submissions$q$);
  perform ft.ok(v = 'OK:0', 'a guardian of another family cannot read it (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f2', $q$select count(*)::text from public.form_submissions$q$);
  perform ft.ok(v = 'OK:0', 'finance cannot read medical forms (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.form_submissions$q$);
  perform ft.ok(v = 'OK:0', 'coaches cannot read submissions directly (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.form_submissions$q$);
  perform ft.ok(v = 'OK:1', 'admin reads the submission (' || v || ')');

  -- Append-only
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with u as (update public.form_submissions set answers = '{"allergies":"changed"}' where id = 'a0000000-0000-0000-0000-00000000b001' returning 1) select count(*)::text from u$q$);
  perform ft.ok(v like 'ERR:%SUBMISSION_IMMUTABLE%', 'answers cannot be edited, not even by an admin (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$with u as (update public.form_submissions set status = 'voided' where id = 'a0000000-0000-0000-0000-00000000b001' returning 1) select count(*)::text from u$q$);
  perform ft.ok(v = 'OK:0', 'a guardian cannot void (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with d as (delete from public.form_submissions where id = 'a0000000-0000-0000-0000-00000000b001' returning 1) select count(*)::text from d$q$);
  perform ft.ok(v = 'OK:0' or v like 'ERR:%', 'submissions cannot be deleted (' || v || ')');

  -- New version: old submission stays on v1; submitting against v1 is refused.
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       format($q$with u as (update public.forms set draft_schema = %L::jsonb where id = 'a0000000-0000-0000-0000-00000000f001' returning 1) select count(*)::text from u$q$, ft.physical('Allergies (incl. medication)')));
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.publish_form('a0000000-0000-0000-0000-00000000f001')::text$q$);
  perform ft.ok(v like 'OK:%', 'admin publishes version 2');
  perform ft.ok((select version from public.form_versions where id = (select current_version_id from public.forms where id = 'a0000000-0000-0000-0000-00000000f001')) = 2, 'current version is 2');
  perform ft.ok((select form_version_id = v1 from public.form_submissions where id = 'a0000000-0000-0000-0000-00000000b001'), 'the earlier submission stays tied to version 1');
  perform ft.ok((select schema->'sections'->0->'fields'->0->>'label' from public.form_versions where id = v1) = 'Allergies', 'version 1 still holds its original questions');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$insert into public.form_submissions (org_id, form_id, form_version_id, athlete_id, family_id, answers, submitted_by)
          values ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000f001', %L, '00000000-0000-0000-0000-000000000071',
                  '00000000-0000-0000-0000-000000000061', '{}', '00000000-0000-0000-0000-0000000000f4') returning id::text$q$, v1));
  perform ft.ok(v like 'ERR:%FORM_VERSION_NOT_CURRENT%', 'a new submission against the old version is refused (' || v || ')');

  -- Lucas (coached by Derrick) gets a submission by the admin (paper form captured).
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.form_submissions (id, org_id, form_id, form_version_id, athlete_id, family_id, answers, submitted_by)
          select 'a0000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-000000000001', id, current_version_id, '00000000-0000-0000-0000-000000000072',
                 '00000000-0000-0000-0000-000000000062', '{"allergies":"Synthetic peanuts","doctor":"Synthetic doctor"}', '00000000-0000-0000-0000-0000000000f1'
            from public.forms where id = 'a0000000-0000-0000-0000-00000000f001' returning id::text$q$);
  perform ft.ok(v like 'OK:%', 'an admin records a submission for a child (' || v || ')');

  -- Voiding
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with u as (update public.form_submissions set status = 'voided', void_reason = 'Synthetic: wrong child' where id = 'a0000000-0000-0000-0000-00000000b001' returning 1) select count(*)::text from u$q$);
  perform ft.ok(v = 'OK:1', 'admin voids a submission (' || v || ')');
  perform ft.ok((select voided_by = '00000000-0000-0000-0000-0000000000f1' and voided_at is not null from public.form_submissions where id = 'a0000000-0000-0000-0000-00000000b001'), 'void stamps who and when');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with u as (update public.form_submissions set status = 'submitted' where id = 'a0000000-0000-0000-0000-00000000b001' returning 1) select count(*)::text from u$q$);
  perform ft.ok(v like 'ERR:%', 'a voided submission is frozen (' || v || ')');
end $$;

-- ===========================================================================
-- D. Coach safety answers
-- ===========================================================================
do $$
declare v text;
begin
  v := ft.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$select string_agg(field_label || '=' || answer, ';') from public.form_safety_answers('00000000-0000-0000-0000-000000000072')$q$);
  perform ft.ok(v = 'OK:Allergies (incl. medication)=Synthetic peanuts', 'Lucas''s coach sees only the safety-flagged answer (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.form_safety_answers('00000000-0000-0000-0000-000000000071')$q$);
  perform ft.ok(v = 'OK:0', 'a coach gets nothing for an athlete they do not coach (' || v || ')');
  v := ft.run_as('a0000000-0000-0000-0000-0000000000c2', $q$select count(*)::text from public.form_safety_answers('00000000-0000-0000-0000-000000000072')$q$);
  perform ft.ok(v = 'OK:0', 'another coach gets nothing (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f2', $q$select count(*)::text from public.form_safety_answers('00000000-0000-0000-0000-000000000072')$q$);
  perform ft.ok(v = 'OK:0', 'finance gets no safety answers (' || v || ')');
  v := ft.run_as('a0000000-0000-0000-0000-0000000000a2', $q$select count(*)::text from public.form_safety_answers('00000000-0000-0000-0000-000000000072')$q$);
  perform ft.ok(v = 'OK:0', 'parents do not use the coach function (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.form_safety_answers('00000000-0000-0000-0000-000000000071')$q$);
  perform ft.ok(v = 'OK:0', 'voided submissions do not count as safety information (' || v || ')');
end $$;

-- ===========================================================================
-- E. Registration form configs + answers
-- ===========================================================================
do $$
declare v text;
begin
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.registration_form_configs (org_id, program_id, builtin, questions)
          values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000041', '{"school":{"shown":true,"required":true}}',
                  '[{"id":"f1","type":"yes_no","label":"Can swim?","required":true}]') returning id::text$q$);
  perform ft.ok(v like 'OK:%', 'admin configures the camp registration form (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.registration_form_configs (org_id, program_id) values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000041') returning id::text$q$);
  perform ft.ok(v like 'ERR:%', 'one config per programme');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$insert into public.registration_form_configs (org_id, program_id) values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000043') returning id::text$q$);
  perform ft.ok(v like 'ERR:%', 'a guardian cannot configure registration forms');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.registration_form_configs$q$);
  perform ft.ok(v = 'OK:1', 'members read their club''s config (' || v || ')');

  -- Answers stored with Mateo's camp registration …081.
  insert into public.registration_answers (org_id, registration_id, athlete_id, program_id, answers, questions)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-000000000071',
          '00000000-0000-0000-0000-000000000041', '{"f1":"yes"}', '[{"id":"f1","type":"yes_no","label":"Can swim?"}]');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.registration_answers$q$);
  perform ft.ok(v = 'OK:1', 'the guardian reads their child''s registration answers (' || v || ')');
  v := ft.run_as('a0000000-0000-0000-0000-0000000000a2', $q$select count(*)::text from public.registration_answers$q$);
  perform ft.ok(v = 'OK:0', 'another family''s guardian cannot (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f2', $q$select count(*)::text from public.registration_answers$q$);
  perform ft.ok(v = 'OK:0', 'finance cannot read registration answers (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$with u as (update public.registration_answers set answers = '{}' returning 1) select count(*)::text from u$q$);
  perform ft.ok(v = 'OK:0', 'a guardian cannot alter stored answers (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.registration_answers (org_id, registration_id, athlete_id, program_id)
          values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000082', '00000000-0000-0000-0000-000000000072', '10000000-0000-0000-0000-000000000099') returning id::text$q$);
  perform ft.ok(v like 'ERR:%', 'answers cannot reference another programme / org');
end $$;

-- ===========================================================================
-- F. Contracts
-- ===========================================================================
do $$
declare v text;
begin
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.contract_templates (id, org_id, name, activity_type, title, body, status, published_at)
          values ('a0000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-000000000001', 'Synthetic camp contract', 'camp',
                  'Camp contract {{athlete.first_name}}', 'I, {{guardian.full_name}}, register {{athlete.full_name}} for {{programme.name}}.', 'published', now()) returning id::text$q$);
  perform ft.ok(v like 'OK:%', 'admin creates a published contract template (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.contract_templates$q$);
  perform ft.ok(v = 'OK:0', 'guardians do not see templates (' || v || ')');

  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.contracts (id, org_id, template_id, template_version, family_id, athlete_id, registration_id, program_id, source, title, body, merge_data, issued_by, status, signed_at, signer_name)
          values ('a0000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000c001', 1,
                  '00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000081',
                  '00000000-0000-0000-0000-000000000041', 'registration', 'Camp contract Mateo', 'I, Carla Synthetic, register Mateo Lopes for camp.',
                  '{"athlete.first_name":"Mateo"}', '00000000-0000-0000-0000-0000000000f1', 'issued', null, null) returning id::text$q$);
  perform ft.ok(v like 'OK:%', 'admin issues a contract (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.contracts (org_id, template_id, template_version, family_id, athlete_id, title, body, status, signed_at, signer_name)
          values ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000c001', 1, '00000000-0000-0000-0000-000000000061',
                  '00000000-0000-0000-0000-000000000071', 'x', 'x', 'signed', now(), 'Forged') returning id::text$q$);
  perform ft.ok(v like 'ERR:%', 'a contract cannot be inserted as already signed (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.contracts (org_id, template_id, template_version, family_id, athlete_id, title, body)
          values ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000c001', 1, '00000000-0000-0000-0000-000000000061',
                  '00000000-0000-0000-0000-000000000072', 'x', 'x') returning id::text$q$);
  perform ft.ok(v like 'ERR:%', 'the athlete must belong to the contract''s family (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$insert into public.contracts (org_id, template_id, template_version, family_id, title, body)
          values ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000c001', 1, '00000000-0000-0000-0000-000000000061', 'x', 'x') returning id::text$q$);
  perform ft.ok(v like 'ERR:%', 'a guardian cannot issue contracts');

  v := ft.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.contracts$q$);
  perform ft.ok(v = 'OK:1', 'the family''s guardian reads "my contracts" (' || v || ')');
  v := ft.run_as('a0000000-0000-0000-0000-0000000000a2', $q$select count(*)::text from public.contracts$q$);
  perform ft.ok(v = 'OK:0', 'another family cannot read it (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f2', $q$select count(*)::text from public.contracts$q$);
  perform ft.ok(v = 'OK:0', 'finance cannot read contracts (' || v || ')');

  -- Signing
  v := ft.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$with u as (update public.contracts set status = 'signed', signed_at = now(), signer_name = 'Carla' where id = 'a0000000-0000-0000-0000-00000000d001' returning 1) select count(*)::text from u$q$);
  perform ft.ok(v = 'OK:0', 'a guardian cannot update the row directly (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with u as (update public.contracts set status = 'signed', signed_at = now(), signer_name = 'Admin' where id = 'a0000000-0000-0000-0000-00000000d001' returning 1) select count(*)::text from u$q$);
  perform ft.ok(v like 'ERR:%CONTRACT_SIGN_VIA_RPC%', 'not even an admin can mark it signed outside sign_contract (' || v || ')');
  v := ft.run_as('a0000000-0000-0000-0000-0000000000a2', $q$select public.sign_contract('a0000000-0000-0000-0000-00000000d001', 'Intruder', null)::text$q$);
  perform ft.ok(v like 'ERR:%NOT_PERMITTED%', 'a guardian of another family cannot sign (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f4', $q$select public.sign_contract('a0000000-0000-0000-0000-00000000d001', ' ', null)::text$q$);
  perform ft.ok(v like 'ERR:%SIGNER_NAME_REQUIRED%', 'a typed name is required (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select public.sign_contract('a0000000-0000-0000-0000-00000000d001', 'Carla Synthetic', repeat('ab', 32))::text$q$);
  perform ft.ok(v like 'OK:%', 'the guardian signs with typed name + IP hash (' || v || ')');
  perform ft.ok((select status = 'signed' and signer_name = 'Carla Synthetic' and signer_profile_id = '00000000-0000-0000-0000-0000000000f4'
                        and ip_hash = repeat('ab', 32) and signed_at is not null and template_version = 1
                   from public.contracts where id = 'a0000000-0000-0000-0000-00000000d001'), 'signature evidence recorded (name, who, IP hash, time, version)');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f4', $q$select public.sign_contract('a0000000-0000-0000-0000-00000000d001', 'Carla Synthetic', null)::text$q$);
  perform ft.ok(v like 'ERR:%CONTRACT_NOT_SIGNABLE%', 'a signed contract cannot be signed again (' || v || ')');

  -- Immutable once signed
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with u as (update public.contracts set body = 'tampered' where id = 'a0000000-0000-0000-0000-00000000d001' returning 1) select count(*)::text from u$q$);
  perform ft.ok(v like 'ERR:%CONTRACT_IMMUTABLE%', 'a signed contract''s text cannot change (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with u as (update public.contracts set signer_name = 'Someone else' where id = 'a0000000-0000-0000-0000-00000000d001' returning 1) select count(*)::text from u$q$);
  perform ft.ok(v like 'ERR:%CONTRACT_IMMUTABLE%', 'signature evidence cannot change (' || v || ')');
  begin
    update public.contracts set pdf_path = '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000061/a0000000-0000-0000-0000-00000000d001.pdf'
     where id = 'a0000000-0000-0000-0000-00000000d001';
    perform ft.ok(true, 'the server records the signed PDF path once');
  exception when others then perform ft.ok(false, 'the server records the signed PDF path once: ' || sqlerrm);
  end;
  begin
    update public.contracts set pdf_path = 'x/y/z.pdf' where id = 'a0000000-0000-0000-0000-00000000d001';
    perform ft.ok(false, 'the PDF path cannot be replaced');
  exception when others then perform ft.ok(sqlerrm like '%CONTRACT_IMMUTABLE%', 'the PDF path cannot be replaced');
  end;
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with d as (delete from public.contracts where id = 'a0000000-0000-0000-0000-00000000d001' returning 1) select count(*)::text from d$q$);
  perform ft.ok(v = 'OK:0' or v like 'ERR:%', 'contracts cannot be deleted (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with d as (delete from public.contract_templates where id = 'a0000000-0000-0000-0000-00000000c001' returning 1) select count(*)::text from d$q$);
  perform ft.ok(v = 'OK:0' or v like 'ERR:%', 'a template with contracts cannot be deleted (' || v || ')');

  -- Void (+ reissue)
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with u as (update public.contracts set status = 'void', void_reason = 'Synthetic: wrong dates' where id = 'a0000000-0000-0000-0000-00000000d001' returning 1) select count(*)::text from u$q$);
  perform ft.ok(v = 'OK:1', 'admin voids a signed contract (' || v || ')');
  perform ft.ok((select voided_by = '00000000-0000-0000-0000-0000000000f1' and signer_name = 'Carla Synthetic' from public.contracts where id = 'a0000000-0000-0000-0000-00000000d001'),
                'voiding keeps the signature evidence and stamps who voided');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with u as (update public.contracts set status = 'issued' where id = 'a0000000-0000-0000-0000-00000000d001' returning 1) select count(*)::text from u$q$);
  perform ft.ok(v like 'ERR:%', 'a void contract is final (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.contracts (org_id, template_id, template_version, family_id, athlete_id, title, body, reissued_from, source)
          values ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000c001', 1, '00000000-0000-0000-0000-000000000061',
                  '00000000-0000-0000-0000-000000000071', 'Camp contract Mateo (v2)', 'text', 'a0000000-0000-0000-0000-00000000d001', 'admin') returning id::text$q$);
  perform ft.ok(v like 'OK:%', 'admin reissues a contract linked to the voided one (' || v || ')');

  -- Deleting a registration only clears the link on a signed / void contract.
  begin
    delete from public.registrations where id = '00000000-0000-0000-0000-000000000081';
    perform ft.ok((select registration_id is null from public.contracts where id = 'a0000000-0000-0000-0000-00000000d001'), 'deleting a registration clears the contract link only');
  exception when others then perform ft.ok(false, 'deleting a registration clears the contract link only: ' || sqlerrm);
  end;
end $$;

-- ===========================================================================
-- G. Storage
-- ===========================================================================
do $$
declare v text;
begin
  v := ft.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$insert into storage.objects (bucket_id, name) values ('form-files', '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000061/a0000000-0000-0000-0000-0000000000e1.png') returning name$q$);
  perform ft.ok(v like 'OK:%', 'a guardian uploads into their own family folder (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$insert into storage.objects (bucket_id, name) values ('form-files', '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000062/a0000000-0000-0000-0000-0000000000e2.png') returning name$q$);
  perform ft.ok(v like 'ERR:%', 'a guardian cannot upload into another family''s folder');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$insert into storage.objects (bucket_id, name) values ('form-files', '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000061/sub/x.png') returning name$q$);
  perform ft.ok(v like 'ERR:%', 'nested keys are refused');
  insert into storage.objects (bucket_id, name) values
    ('form-files', '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000062/a0000000-0000-0000-0000-0000000000e3.png'),
    ('contracts', '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000061/a0000000-0000-0000-0000-00000000d001.pdf'),
    ('form-files', '10000000-0000-0000-0000-000000000002/b0000000-0000-0000-0000-0000000000f1/b0000000-0000-0000-0000-0000000000e4.png');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from storage.objects where bucket_id = 'form-files'$q$);
  perform ft.ok(v = 'OK:1', 'a guardian reads only their family''s files (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from storage.objects where bucket_id = 'contracts'$q$);
  perform ft.ok(v = 'OK:1', 'a guardian reads their family''s signed contract PDF (' || v || ')');
  v := ft.run_as('a0000000-0000-0000-0000-0000000000a2', $q$select count(*)::text from storage.objects where bucket_id = 'contracts'$q$);
  perform ft.ok(v = 'OK:0', 'another family cannot read that PDF (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f2', $q$select count(*)::text from storage.objects where bucket_id in ('form-files', 'contracts')$q$);
  perform ft.ok(v = 'OK:0', 'finance reads no form files or contract PDFs (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from storage.objects where bucket_id in ('form-files', 'contracts')$q$);
  perform ft.ok(v = 'OK:0', 'coaches read no form files (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from storage.objects where bucket_id in ('form-files', 'contracts')$q$);
  perform ft.ok(v = 'OK:3', 'an admin reads their own club''s files only (' || v || ')');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into storage.objects (bucket_id, name) values ('contracts', '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000061/a0000000-0000-0000-0000-0000000000e5.pdf') returning name$q$);
  perform ft.ok(v like 'ERR:%', 'contract PDFs are written by the server only');
  v := ft.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$with d as (delete from storage.objects where bucket_id = 'form-files' returning 1) select count(*)::text from d$q$);
  perform ft.ok(v = 'OK:0', 'uploaded evidence cannot be deleted by a guardian (' || v || ')');
  perform ft.ok((select not public from storage.buckets where id = 'form-files') and (select not public from storage.buckets where id = 'contracts'), 'both buckets are private');
end $$;

-- ===========================================================================
-- H. Cross-tenant denial + audit
-- ===========================================================================
do $$
declare v text; t text;
begin
  foreach t in array array['forms', 'form_versions', 'form_assignments', 'form_reminders', 'form_submissions', 'registration_form_configs',
                           'registration_answers', 'contract_templates', 'contracts'] loop
    v := ft.run_as('b0000000-0000-0000-0000-0000000000d1', format('select count(*)::text from public.%I', t));
    perform ft.ok(v = 'OK:0', 'org B admin reads no rows of org A in ' || t || ' (' || v || ')');
  end loop;
  v := ft.run_as('b0000000-0000-0000-0000-0000000000d1', $q$select count(*)::text from storage.objects where bucket_id in ('form-files', 'contracts') and name like '00000000-0000-0000-0000-000000000001/%'$q$);
  perform ft.ok(v = 'OK:0', 'org B admin reads no org A files (' || v || ')');
  v := ft.run_as('b0000000-0000-0000-0000-0000000000d1', $q$select count(*)::text from storage.objects where bucket_id = 'form-files'$q$);
  perform ft.ok(v = 'OK:1', 'org B admin reads their own club''s file (' || v || ')');

  v := ft.run_as('b0000000-0000-0000-0000-0000000000d1',
       $q$insert into public.forms (org_id, title) values ('00000000-0000-0000-0000-000000000001', 'x') returning id::text$q$);
  perform ft.ok(v like 'ERR:%', 'org B admin cannot create a form in org A');
  v := ft.run_as('b0000000-0000-0000-0000-0000000000d1', $q$select public.publish_form('a0000000-0000-0000-0000-00000000f001')::text$q$);
  perform ft.ok(v like 'ERR:%NOT_PERMITTED%', 'org B admin cannot publish org A''s form');
  v := ft.run_as('b0000000-0000-0000-0000-0000000000d1',
       $q$with u as (update public.forms set title = 'hijack' returning 1) select count(*)::text from u$q$);
  perform ft.ok(v = 'OK:0', 'org B admin cannot update org A forms (' || v || ')');
  v := ft.run_as('b0000000-0000-0000-0000-0000000000d1',
       $q$with u as (update public.form_submissions set status = 'voided' returning 1) select count(*)::text from u$q$);
  perform ft.ok(v = 'OK:0', 'org B admin cannot void org A submissions (' || v || ')');
  v := ft.run_as('b0000000-0000-0000-0000-0000000000d1',
       $q$with u as (update public.contracts set status = 'void' returning 1) select count(*)::text from u$q$);
  perform ft.ok(v = 'OK:0', 'org B admin cannot void org A contracts (' || v || ')');
  v := ft.run_as('b0000000-0000-0000-0000-0000000000d1', $q$select count(*)::text from public.form_safety_answers('00000000-0000-0000-0000-000000000072')$q$);
  perform ft.ok(v = 'OK:0', 'org B admin gets no safety answers for org A (' || v || ')');

  -- Org B admin builds a form; a cross-org assignment / submission / contract is refused.
  v := ft.run_as('b0000000-0000-0000-0000-0000000000d1',
       format($q$insert into public.forms (id, org_id, title, draft_schema) values ('b0000000-0000-0000-0000-00000000f001', '10000000-0000-0000-0000-000000000002', 'B form', %L::jsonb) returning id::text$q$, ft.physical('Allergies')));
  perform ft.ok(v like 'OK:%', 'org B admin builds their own form');
  v := ft.run_as('b0000000-0000-0000-0000-0000000000d1',
       $q$insert into public.form_assignments (org_id, form_id, scope, program_id) values ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000f001', 'program', '00000000-0000-0000-0000-000000000043') returning id::text$q$);
  perform ft.ok(v like 'ERR:%CROSS_ORG%', 'an assignment cannot target another org''s programme (' || v || ')');
  v := ft.run_as('b0000000-0000-0000-0000-0000000000d1', $q$select public.publish_form('b0000000-0000-0000-0000-00000000f001')::text$q$);
  v := ft.run_as('b0000000-0000-0000-0000-0000000000d1',
       $q$insert into public.form_submissions (org_id, form_id, form_version_id, athlete_id, family_id, submitted_by)
          select '10000000-0000-0000-0000-000000000002', id, current_version_id, '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000061', 'b0000000-0000-0000-0000-0000000000d1'
            from public.forms where id = 'b0000000-0000-0000-0000-00000000f001' returning id::text$q$);
  perform ft.ok(v like 'ERR:%', 'org B cannot record a submission for an org A child (' || v || ')');
  v := ft.run_as('b0000000-0000-0000-0000-0000000000d1',
       $q$insert into public.contracts (org_id, template_id, template_version, family_id, title, body)
          values ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000c001', 1, 'b0000000-0000-0000-0000-0000000000f1', 'x', 'x') returning id::text$q$);
  perform ft.ok(v like 'ERR:%CROSS_ORG%', 'org B cannot issue from org A''s template (' || v || ')');
  v := ft.run_as('b0000000-0000-0000-0000-0000000000d1',
       $q$insert into public.registration_form_configs (org_id, program_id) values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000043') returning id::text$q$);
  perform ft.ok(v like 'ERR:%CROSS_ORG%', 'org B cannot configure org A''s programme (' || v || ')');
  v := ft.run_as('b0000000-0000-0000-0000-0000000000d1',
       $q$insert into storage.objects (bucket_id, name) values ('form-files', '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000061/b0000000-0000-0000-0000-0000000000e9.png') returning name$q$);
  perform ft.ok(v like 'ERR:%', 'org B cannot upload into an org A family folder');
  v := ft.run_as(null, $q$select count(*)::text from public.forms$q$);
  perform ft.ok(v = 'OK:0' or v like 'ERR:%', 'anonymous users read nothing (' || v || ')');

  -- Audit rows: the submission is logged without its answers or signature.
  perform ft.ok(exists (select 1 from public.audit_logs where target_table = 'form_submissions' and target_id = 'a0000000-0000-0000-0000-00000000b001' and action = 'INSERT'),
                'submission insert is audited');
  perform ft.ok(not exists (select 1 from public.audit_logs where target_table = 'form_submissions'
                             and (coalesce(new_data, '{}') ? 'answers' or coalesce(old_data, '{}') ? 'answers' or coalesce(new_data::text, '') like '%Synthetic peanuts%')),
                'audit rows never contain form answers');
  perform ft.ok(exists (select 1 from public.audit_logs where target_table = 'contracts' and target_id = 'a0000000-0000-0000-0000-00000000d001' and action = 'UPDATE'
                          and new_data->>'status' = 'signed'), 'contract signing is audited');
  perform ft.ok(not exists (select 1 from public.audit_logs where target_table = 'contracts' and coalesce(new_data, '{}') ? 'body'), 'audit rows never copy contract text');
end $$;
