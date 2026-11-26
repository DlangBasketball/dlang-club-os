-- ============================================================================
-- Selection programmes suite (migration 20250420102600_selection_programs.sql
-- + data script supabase/seeds/selection_eybl_dlang.sql)
--
--   A. Data script: runs twice, configures EYBL once (divisions, packages,
--      instalment rules, head coach; missing coach skipped).
--   B. Column checks (packages always allow 1 = pay in full, counts 1-24,
--      https video links only).
--   C. Applying: guardian (own child only, division auto-suggested from the
--      date of birth, one live application per player); public page
--      (service role only; guest family + athlete + invitation, non-member).
--   D. Visibility: applicants see only their own applications; coaches only
--      for their programme / division; finance sees all; no client writes.
--   E. Decisions: status transitions, note required to decline, acceptance
--      issues the package invoice; plan with 3 instalments within the
--      package rules (count outside the set refused, also via plan_choose);
--      enrolment on plan set-up and on first payment (team roster).
--   F. Package change before payment (old invoice cancelled, new one
--      issued); locked once a plan exists. Withdrawal cancels the unpaid
--      invoice and plan.
--   G. Sponsored applicants: full (invoice settled, enrolled, ledger scope
--      'program') and partial (credit note, remainder due).
--   H. Stats and report: finance only; amounts per programme.
--   I. Cross-tenant denial for every new table and RPC.
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach …f3 =
-- "Derrick Lang" …011, guardian …f4 of family …061 / athlete …071 born
-- 2016; family …062 = athletes …072 (2014), …073 (2016)). Org B …0002 from
-- seed_tenants.sql; its admin and records are created here.
-- SYNTHETIC DATA ONLY. Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema sel;
grant usage on schema sel to authenticated, anon, service_role;
create table sel.ctx (k text primary key, v text);
grant all on sel.ctx to authenticated, anon, service_role;

create function sel.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

create function sel.put(p_k text, p_v text) returns void language sql as $$
  insert into sel.ctx (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v;
$$;
create function sel.get(p_k text) returns text language sql stable as $$ select v from sel.ctx where k = p_k $$;

-- Run p_sql as user p (null = service_role). Returns 'OK:<first column>' or 'ERR:<message>'.
create function sel.run_as(p uuid, p_sql text) returns text language plpgsql as $$
declare v_msg text; v_res text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
    if p is null then execute 'set local role service_role'; else execute 'set local role authenticated'; end if;
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
grant execute on all functions in schema sel to authenticated, anon, service_role;

-- Org B: admin, family, athlete, selection programme (synthetic).
insert into auth.users (id, email) values ('b0000000-0000-0000-0000-0000000003c1', 'sel-admin-b@example.test');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-0000000003c1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000003c1', 'admin');
insert into public.families (id, org_id, name) values
  ('b0000000-0000-0000-0000-0000000003d1', '10000000-0000-0000-0000-000000000002', 'Synthetic B family');
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob) values
  ('b0000000-0000-0000-0000-0000000003e1', '10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000003d1', 'Test', 'Bplayer', '2012-05-01');
insert into public.programs (id, org_id, slug, name, kind, price_chf, is_public, is_active, status, selection_enabled)
values ('b0000000-0000-0000-0000-0000000003f1', '10000000-0000-0000-0000-000000000002', 'b-select', 'B selection', 'selection', 100, true, true, 'published', true);
insert into public.program_packages (id, org_id, program_id, name, price, allowed_counts)
values ('b0000000-0000-0000-0000-0000000003a1', '10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000003f1', 'B package', 100, '{1,2}');

-- Org A: a second coach (not assigned to EYBL) and a second selection
-- programme the first coach does not review.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000003c2', 'sel-coach2@example.test');
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001' where id = '00000000-0000-0000-0000-0000000003c2';
insert into public.staff_roles (org_id, profile_id, role) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000003c2', 'coach');
insert into public.coaches (id, org_id, display_name, profile_id) values
  ('00000000-0000-0000-0000-0000000003c3', '00000000-0000-0000-0000-000000000001', 'Synthetic Coach Two', '00000000-0000-0000-0000-0000000003c2');

-- ===========================================================================
-- A. Data script (twice)
-- ===========================================================================
\i supabase/seeds/selection_eybl_dlang.sql
\i supabase/seeds/selection_eybl_dlang.sql

do $$
declare v_prog uuid; n int;
begin
  select id into v_prog from public.programs where org_id = '00000000-0000-0000-0000-000000000001' and slug = 'eybl';
  perform sel.put('prog', v_prog::text);
  perform sel.ok(v_prog is not null, 'data script creates the EYBL programme');
  perform sel.ok((select kind::text = 'selection' and selection_enabled and requires_approval and allow_non_members and is_public
                         and status = 'published' from public.programs where id = v_prog), 'EYBL: selection, approval, non-members, public');
  select count(*) into n from public.programs where org_id = '00000000-0000-0000-0000-000000000001' and slug = 'eybl';
  perform sel.ok(n = 1, 'rerun keeps one programme (' || n || ')');
  select count(*) into n from public.program_divisions where program_id = v_prog;
  perform sel.ok(n = 2, 'two divisions U14 / U16 (' || n || ')');
  perform sel.ok((select count(*) = 2 from public.program_divisions d join public.teams t on t.id = d.team_id where d.program_id = v_prog),
                 'each division has its team');
  select count(*) into n from public.program_packages where program_id = v_prog;
  perform sel.ok(n = 3, 'three packages (' || n || ')');
  perform sel.ok((select price = 1500 and allowed_counts = '{1,2,3,4,5}' from public.program_packages where program_id = v_prog and name = '1 tournament'),
                 '1 tournament: 1500, instalments 1-5');
  perform sel.ok((select price = 3000 and allowed_counts = '{1,2,3,4,5,6,7,8,9,10}' from public.program_packages where program_id = v_prog and name = '2 tournaments'),
                 '2 tournaments: 3000, instalments 1-10');
  perform sel.ok((select price = 4500 and allowed_counts = '{1,2,3,4,5,6,7,8,9,10}' from public.program_packages where program_id = v_prog and name = '3 tournaments'),
                 '3 tournaments: 4500, instalments 1-10');
  select count(*) into n from public.program_coaches where program_id = v_prog;
  perform sel.ok(n = 1 and exists (select 1 from public.program_coaches where program_id = v_prog and coach_id = '00000000-0000-0000-0000-000000000011' and role = 'head'),
                 'head coach Derrick Lang assigned; absent assistant skipped (' || n || ')');
  perform sel.put('u14', (select id::text from public.program_divisions where program_id = v_prog and name = 'U14'));
  perform sel.put('u16', (select id::text from public.program_divisions where program_id = v_prog and name = 'U16'));
  perform sel.put('pkg1', (select id::text from public.program_packages where program_id = v_prog and name = '1 tournament'));
  perform sel.put('pkg2', (select id::text from public.program_packages where program_id = v_prog and name = '2 tournaments'));
  perform sel.put('pkg3', (select id::text from public.program_packages where program_id = v_prog and name = '3 tournaments'));
  -- Second org A selection programme, reviewed by coach two only.
  insert into public.programs (id, org_id, slug, name, kind, price_chf, is_public, is_active, status, selection_enabled, requires_approval)
  values ('00000000-0000-0000-0000-0000000003b1', '00000000-0000-0000-0000-000000000001', 'other-select', 'Other selection', 'selection', 500, false, true, 'published', true, true);
  insert into public.program_packages (id, org_id, program_id, name, price, allowed_counts)
  values ('00000000-0000-0000-0000-0000000003b2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000003b1', 'Season', 500, '{1,2}');
  insert into public.program_coaches (org_id, program_id, coach_id, role)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000003b1', '00000000-0000-0000-0000-0000000003c3', 'head');
end $$;

-- ===========================================================================
-- B. Column checks
-- ===========================================================================
do $$
declare v text; admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
begin
  v := sel.run_as(admin_a, format($q$insert into public.program_packages (org_id, program_id, name, price, allowed_counts)
       values ('00000000-0000-0000-0000-000000000001', %L, 'No full', 100, '{2,3}') returning id$q$, sel.get('prog')));
  perform sel.ok(v like 'ERR:%', 'a package must allow pay in full (1)');
  v := sel.run_as(admin_a, format($q$insert into public.program_packages (org_id, program_id, name, price, allowed_counts)
       values ('00000000-0000-0000-0000-000000000001', %L, 'Too many', 100, '{1,25}') returning id$q$, sel.get('prog')));
  perform sel.ok(v like 'ERR:%', 'instalment counts above 24 are refused');
  v := sel.run_as(admin_a, format($q$insert into public.program_packages (org_id, program_id, name, price, allowed_counts)
       values ('00000000-0000-0000-0000-000000000001', %L, 'Free', 0, '{1}') returning id$q$, sel.get('prog')));
  perform sel.ok(v like 'ERR:%', 'a package needs a positive price');
  v := sel.run_as(admin_a, format($q$insert into public.program_divisions (org_id, program_id, name, min_birth_year, max_birth_year)
       values ('00000000-0000-0000-0000-000000000001', %L, 'Bad', 2014, 2012) returning id$q$, sel.get('prog')));
  perform sel.ok(v like 'ERR:%', 'a division birth-year range must be ordered');
  v := sel.run_as(admin_a, format($q$insert into public.program_divisions (org_id, program_id, name, age_under, sort)
       values ('00000000-0000-0000-0000-000000000001', %L, 'U18', 18, 3) returning name$q$, sel.get('prog')));
  perform sel.ok(v = 'OK:U18', 'admin adds a division (' || v || ')');
  perform sel.put('u18', (select id::text from public.program_divisions where program_id = sel.get('prog')::uuid and name = 'U18'));
  v := sel.run_as('00000000-0000-0000-0000-0000000000f3', format($q$insert into public.program_divisions (org_id, program_id, name)
       values ('00000000-0000-0000-0000-000000000001', %L, 'Coach div') returning id$q$, sel.get('prog')));
  perform sel.ok(v like 'ERR:%', 'a coach cannot change the set-up (' || left(v, 60) || ')');
  -- Division suggestion from the date of birth.
  perform sel.ok(public.selection_suggest_division(sel.get('prog')::uuid, '2016-03-14') = sel.get('u14')::uuid, 'born 2016 -> U14');
  perform sel.ok(public.selection_suggest_division(sel.get('prog')::uuid, '2012-06-01') = sel.get('u16')::uuid, 'born 2012 -> U16');
  perform sel.ok(public.selection_suggest_division(sel.get('prog')::uuid, '2009-06-01', '2026-11-21') = sel.get('u18')::uuid, 'born 2009 -> U18 (under 18 today)');
  perform sel.ok(public.selection_suggest_division(sel.get('prog')::uuid, '2000-01-01') is null, 'born 2000 -> no division');
  perform sel.ok(public.selection_transition_ok('applied', 'accepted') and not public.selection_transition_ok('applied', 'enrolled')
                 and not public.selection_transition_ok('withdrawn', 'applied') and public.selection_transition_ok('accepted', 'enrolled'),
                 'status transitions');
end $$;

-- ===========================================================================
-- C. Applying
-- ===========================================================================
do $$
declare v text;
  guardian uuid := '00000000-0000-0000-0000-0000000000f4';
begin
  v := sel.run_as(guardian, format($q$select public.selection_apply(%L, '00000000-0000-0000-0000-000000000071', null, %L,
         '{"current_club":"DLang","position":"Guard","video_url":"http://insecure.example"}')::text$q$, sel.get('prog'), sel.get('pkg3')));
  perform sel.ok(v like 'ERR:%', 'a non-https video link is refused (' || left(v, 80) || ')');
  v := sel.run_as(guardian, format($q$select public.selection_apply(%L, '00000000-0000-0000-0000-000000000071', null, %L,
         '{"position":"Guard","notes":"Synthetic note","video_url":"https://video.example/clip"}')->>'application_id'$q$, sel.get('prog'), sel.get('pkg3')));
  perform sel.ok(v like 'OK:%' and v <> 'OK:<null>', 'guardian applies with her child in one call (' || left(v, 60) || ')');
  perform sel.put('app_mateo', substr(v, 4));
  perform sel.ok((select status = 'applied' and division_id = sel.get('u14')::uuid and is_member and source = 'parent'
                    and applied_by = guardian from public.program_applications where id = sel.get('app_mateo')::uuid),
                 'application: applied, U14 suggested from the date of birth, member, applied_by');
  v := sel.run_as(guardian, format($q$select public.selection_apply(%L, '00000000-0000-0000-0000-000000000071', null, %L)::text$q$, sel.get('prog'), sel.get('pkg1')));
  perform sel.ok(v like 'ERR:%ALREADY_APPLIED%', 'one live application per player (' || left(v, 60) || ')');
  v := sel.run_as(guardian, format($q$select public.selection_apply(%L, '00000000-0000-0000-0000-000000000072', null, %L)::text$q$, sel.get('prog'), sel.get('pkg1')));
  perform sel.ok(v like 'ERR:%NOT_AUTHORIZED%', 'guardian cannot apply for another family''s child (' || left(v, 60) || ')');
  v := sel.run_as(guardian, $q$select public.selection_apply_public('{}'::jsonb)::text$q$);
  perform sel.ok(v like 'ERR:%', 'the public RPC is service-role only (' || left(v, 60) || ')');
  v := sel.run_as(guardian, format($q$select public.selection_apply(%L, '00000000-0000-0000-0000-000000000071', null, 'b0000000-0000-0000-0000-0000000003a1')::text$q$, 'b0000000-0000-0000-0000-0000000003f1'));
  perform sel.ok(v like 'ERR:%', 'guardian cannot apply to another club''s programme (' || left(v, 60) || ')');

  -- Public page: non-member (other club), service role.
  v := sel.run_as(null, format($q$select public.selection_apply_public(jsonb_build_object(
         'program_id', %L, 'package_id', %L,
         'parent', jsonb_build_object('name', 'Synthetic Parent', 'email', 'Sel.Parent@Example.test', 'phone', '+41 00 000 00 00',
                                      'emergency_name', 'Synthetic Contact', 'emergency_phone', '+41 00 000 00 01'),
         'child', jsonb_build_object('first_name', 'Nova', 'last_name', 'Synthetic', 'dob', '2012-06-01'),
         'current_club', 'Synthetic BC', 'position', 'Forward', 'consents', jsonb_build_array('terms')))->>'application_id'$q$,
         sel.get('prog'), sel.get('pkg2')));
  perform sel.ok(v like 'OK:%' and v <> 'OK:<null>', 'public application from a non-member (' || left(v, 60) || ')');
  perform sel.put('app_nova', substr(v, 4));
  perform sel.ok((select a.status = 'applied' and not a.is_member and a.source = 'public' and a.current_club = 'Synthetic BC'
                         and a.division_id = sel.get('u16')::uuid and f.membership_status = 'guest' and f.contact_email = 'sel.parent@example.test'
                    from public.program_applications a join public.families f on f.id = a.family_id where a.id = sel.get('app_nova')::uuid),
                 'guest family + athlete created, U16, current club kept');
  perform sel.put('fam_nova', (select family_id::text from public.program_applications where id = sel.get('app_nova')::uuid));
  perform sel.put('ath_nova', (select athlete_id::text from public.program_applications where id = sel.get('app_nova')::uuid));
  perform sel.ok(exists (select 1 from public.invitations where email = 'sel.parent@example.test' and status = 'pending' and role = 'parent'
                          and family_id = sel.get('fam_nova')::uuid), 'parent invitation for the guest sign-up');
  perform sel.ok(exists (select 1 from public.consent_acceptances where athlete_id = sel.get('ath_nova')::uuid), 'consent recorded');

  -- Two more public applicants (sponsorship cases), same programme.
  v := sel.run_as(null, format($q$select public.selection_apply_public(jsonb_build_object(
         'program_id', %L, 'package_id', %L,
         'parent', jsonb_build_object('name', 'Synthetic Two', 'email', 'sel.two@example.test'),
         'child', jsonb_build_object('first_name', 'Iris', 'last_name', 'Synthetic', 'dob', '2013-02-02')))->>'application_id'$q$,
         sel.get('prog'), sel.get('pkg1')));
  perform sel.put('app_iris', substr(v, 4));
  v := sel.run_as(null, format($q$select public.selection_apply_public(jsonb_build_object(
         'program_id', %L, 'package_id', %L,
         'parent', jsonb_build_object('name', 'Synthetic Three', 'email', 'sel.three@example.test'),
         'child', jsonb_build_object('first_name', 'Leo', 'last_name', 'Synthetic', 'dob', '2011-03-03')))->>'application_id'$q$,
         sel.get('prog'), sel.get('pkg2')));
  perform sel.put('app_leo', substr(v, 4));
  perform sel.ok(sel.get('app_iris') ~ '^[0-9a-f-]{36}$' and sel.get('app_leo') ~ '^[0-9a-f-]{36}$', 'two more public applications');
  -- Other programme (reviewed by coach two only), Lucas, by admin path via service role.
  perform public.selection_apply_internal('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000003b1',
    '00000000-0000-0000-0000-000000000072', null, '00000000-0000-0000-0000-0000000003b2', '{}'::jsonb, 'admin', null);
end $$;

-- ===========================================================================
-- D. Visibility
-- ===========================================================================
do $$
declare v text;
  guardian uuid := '00000000-0000-0000-0000-0000000000f4';
  finance_a uuid := '00000000-0000-0000-0000-0000000000f2';
  coach1 uuid := '00000000-0000-0000-0000-0000000000f3';
  coach2 uuid := '00000000-0000-0000-0000-0000000003c2';
  admin_b uuid := 'b0000000-0000-0000-0000-0000000003c1';
begin
  v := sel.run_as(guardian, $q$select count(*)::text from public.program_applications$q$);
  perform sel.ok(v = 'OK:1', 'guardian sees only her own application (' || v || ')');
  v := sel.run_as(guardian, $q$select count(*)::text from public.program_packages$q$);
  perform sel.ok(v = 'OK:4', 'members of the club read the packages (' || v || ')');
  v := sel.run_as(finance_a, $q$select count(*)::text from public.program_applications$q$);
  perform sel.ok(v = 'OK:5', 'finance sees every application of the club (' || v || ')');
  v := sel.run_as(coach1, $q$select count(*)::text from public.program_applications$q$);
  perform sel.ok(v = 'OK:4', 'EYBL coach sees EYBL applications only (' || v || ')');
  v := sel.run_as(coach1, format($q$select count(*)::text from public.selection_review_list(%L)$q$, sel.get('prog')));
  perform sel.ok(v = 'OK:4', 'EYBL coach review list (' || v || ')');
  v := sel.run_as(coach1, $q$select count(*)::text from public.selection_review_list('00000000-0000-0000-0000-0000000003b1')$q$);
  perform sel.ok(v = 'OK:0', 'EYBL coach cannot review the other programme (' || v || ')');
  v := sel.run_as(coach2, $q$select count(*)::text from public.program_applications$q$);
  perform sel.ok(v = 'OK:1', 'coach two sees only his programme (' || v || ')');
  v := sel.run_as(coach2, format($q$select count(*)::text from public.selection_review_list(%L)$q$, sel.get('prog')));
  perform sel.ok(v = 'OK:0', 'coach two cannot review EYBL (' || v || ')');
  v := sel.run_as(guardian, format($q$select count(*)::text from public.selection_review_list(%L)$q$, sel.get('prog')));
  perform sel.ok(v = 'OK:0', 'a guardian gets no review list (' || v || ')');
  v := sel.run_as(guardian, format($q$with u as (update public.program_applications set status = 'accepted' where id = %L returning 1) select count(*)::text from u$q$, sel.get('app_mateo')));
  perform sel.ok(v = 'OK:0' or v like 'ERR:%', 'no direct client updates of applications (' || v || ')');
  v := sel.run_as(finance_a, format($q$insert into public.program_applications (org_id, program_id, athlete_id, family_id, package_id)
       values ('00000000-0000-0000-0000-000000000001', %L, '00000000-0000-0000-0000-000000000073', '00000000-0000-0000-0000-000000000062', %L) returning id$q$,
       sel.get('prog'), sel.get('pkg1')));
  perform sel.ok(v like 'ERR:%', 'no direct client inserts of applications (' || left(v, 50) || ')');
  v := sel.run_as(admin_b, $q$select count(*)::text from public.program_applications$q$);
  perform sel.ok(v = 'OK:0', 'org B admin sees no org A application (' || v || ')');
end $$;

-- ===========================================================================
-- E. Decisions, invoice, plan with 3 instalments, enrolment
-- ===========================================================================
do $$
declare v text;
  guardian uuid := '00000000-0000-0000-0000-0000000000f4';
  coach1 uuid := '00000000-0000-0000-0000-0000000000f3';
  coach2 uuid := '00000000-0000-0000-0000-0000000003c2';
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
begin
  v := sel.run_as(guardian, format($q$select public.selection_set_status(%L, 'accepted')::text$q$, sel.get('app_mateo')));
  perform sel.ok(v like 'ERR:%APPLICATION_NOT_FOUND%', 'a guardian cannot decide (' || left(v, 60) || ')');
  v := sel.run_as(coach2, format($q$select public.selection_set_status(%L, 'accepted')::text$q$, sel.get('app_mateo')));
  perform sel.ok(v like 'ERR:%APPLICATION_NOT_FOUND%', 'a coach of another programme cannot decide (' || left(v, 60) || ')');
  v := sel.run_as(coach1, format($q$select public.selection_set_status(%L, 'enrolled')::text$q$, sel.get('app_mateo')));
  perform sel.ok(v like 'ERR:%INVALID_TRANSITION%', 'applied -> enrolled is refused (' || left(v, 60) || ')');
  v := sel.run_as(coach1, format($q$select public.selection_set_status(%L, 'declined')::text$q$, sel.get('app_mateo')));
  perform sel.ok(v like 'ERR:%NOTE_REQUIRED%', 'declining needs a message (' || left(v, 60) || ')');
  v := sel.run_as(coach1, format($q$select public.selection_set_status(%L, 'under_review', null, null, 'Synthetic staff note')->>'status'$q$, sel.get('app_mateo')));
  perform sel.ok(v = 'OK:under_review', 'coach puts the application under review (' || v || ')');
  v := sel.run_as(coach1, format($q$select public.selection_set_status(%L, 'accepted', 'Welcome to the team')->>'invoice_id'$q$, sel.get('app_mateo')));
  perform sel.ok(v like 'OK:%' and v <> 'OK:<null>', 'coach accepts: package invoice issued (' || left(v, 60) || ')');
  perform sel.put('inv_mateo', substr(v, 4));
  perform sel.ok((select i.total_chf = 4500 and i.status::text = 'sent' and i.program_id = sel.get('prog')::uuid and i.currency = 'CHF'
                         and i.athlete_id = '00000000-0000-0000-0000-000000000071'
                    from public.invoices i where i.id = sel.get('inv_mateo')::uuid), 'invoice: 4500 CHF, linked to the programme and the player');
  perform sel.ok((select status = 'accepted' and decision_note = 'Welcome to the team' and reviewed_by = coach1 and accepted_at is not null
                         and staff_notes = 'Synthetic staff note'
                    from public.program_applications where id = sel.get('app_mateo')::uuid), 'application accepted with the note and reviewer');
  v := sel.run_as(guardian, format($q$select staff_notes from public.program_applications where id = %L$q$, sel.get('app_mateo')));
  perform sel.ok(v like 'OK:%', 'guardian reads her application (' || v || ')');

  -- Plan rules: counts outside the package set are refused (here and via plan_choose).
  v := sel.run_as(guardian, format($q$select public.selection_choose_plan(%L, 11)::text$q$, sel.get('app_mateo')));
  perform sel.ok(v like 'ERR:%COUNT_NOT_ALLOWED%', '11 instalments are outside the package rules (' || left(v, 60) || ')');
  v := sel.run_as(guardian, format($q$select public.plan_choose(%L, 12)::text$q$, sel.get('inv_mateo')));
  perform sel.ok(v like 'ERR:%COUNT_NOT_ALLOWED%', 'plan_choose on a package invoice follows the package (' || left(v, 60) || ')');
  v := sel.run_as(guardian, format($q$select (public.selection_choose_plan(%L, 3)->'amounts')::text$q$, sel.get('app_mateo')));
  perform sel.ok(v = 'OK:[1500.00, 1500.00, 1500.00]', 'accept -> invoice -> plan with 3 instalments of 1500 (' || v || ')');
  perform sel.ok((select count(*) = 3 and min(due_date) = current_date and max(due_date) <= (current_date + interval '2 months')::date
                    from public.payment_plan_installments i join public.payment_plans p on p.id = i.plan_id
                   where p.invoice_id = sel.get('inv_mateo')::uuid), 'monthly schedule from today');
  perform sel.ok((select status = 'enrolled' and installment_count = 3 and enrolled_at is not null
                    from public.program_applications where id = sel.get('app_mateo')::uuid), 'plan set up -> enrolled');
  perform sel.ok(exists (select 1 from public.team_memberships tm join public.program_divisions d on d.team_id = tm.team_id
                          where d.id = sel.get('u14')::uuid and tm.athlete_id = '00000000-0000-0000-0000-000000000071' and tm.status = 'active'),
                 'enrolled player is on the U14 team roster');
  v := sel.run_as(guardian, format($q$select public.selection_change_package(%L, %L)::text$q$, sel.get('app_mateo'), sel.get('pkg1')));
  perform sel.ok(v like 'ERR:%PACKAGE_LOCKED%', 'package locked once a plan exists (' || left(v, 60) || ')');

  -- Leo: admin accepts, division override to U16 (already), first payment enrols.
  v := sel.run_as(admin_a, format($q$select public.selection_set_status(%L, 'accepted', null, %L)->>'invoice_id'$q$, sel.get('app_leo'), sel.get('u18')));
  perform sel.put('inv_leo', substr(v, 4));
  perform sel.ok((select division_id = sel.get('u18')::uuid from public.program_applications where id = sel.get('app_leo')::uuid),
                 'admin overrides the division');
  insert into public.payments (org_id, invoice_id, amount_chf, currency, method, status, paid_at)
  values ('00000000-0000-0000-0000-000000000001', sel.get('inv_leo')::uuid, 500, 'CHF', 'manual', 'succeeded', now());
  perform public.recompute_invoice(sel.get('inv_leo')::uuid);
  perform sel.ok((select status = 'enrolled' from public.program_applications where id = sel.get('app_leo')::uuid),
                 'first payment (partially paid) -> enrolled');
end $$;

-- ===========================================================================
-- F. Package change before payment; withdrawal
-- ===========================================================================
do $$
declare v text; v_old uuid;
  finance_a uuid := '00000000-0000-0000-0000-0000000000f2';
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
begin
  v := sel.run_as(admin_a, format($q$select public.selection_set_status(%L, 'accepted')->>'invoice_id'$q$, sel.get('app_nova')));
  v_old := substr(v, 4)::uuid;
  perform sel.ok((select total_chf = 3000 from public.invoices where id = v_old), 'Nova accepted: 2 tournaments invoice 3000');
  v := sel.run_as(finance_a, format($q$select public.selection_change_package(%L, %L)->>'invoice_id'$q$, sel.get('app_nova'), sel.get('pkg1')));
  perform sel.ok(v like 'OK:%' and substr(v, 4)::uuid <> v_old, 'package changed before payment: new invoice (' || left(v, 60) || ')');
  perform sel.put('inv_nova', substr(v, 4));
  perform sel.ok((select status::text = 'cancelled' and cancelled_at is not null from public.invoices where id = v_old), 'old invoice cancelled');
  perform sel.ok((select total_chf = 1500 and status::text = 'sent' from public.invoices where id = sel.get('inv_nova')::uuid), 'new invoice 1500');
  v := sel.run_as(finance_a, format($q$select (public.selection_choose_plan(%L, 4)->'amounts')::text$q$, sel.get('app_nova')));
  perform sel.ok(v = 'OK:[375.00, 375.00, 375.00, 375.00]', 'four instalments of 375 (' || v || ')');
  v := sel.run_as(admin_a, format($q$select public.selection_withdraw(%L, 'Moved abroad')->>'invoice_cancelled'$q$, sel.get('app_nova')));
  perform sel.ok(v = 'OK:true', 'withdrawal cancels the unpaid invoice (' || v || ')');
  perform sel.ok((select status = 'withdrawn' from public.program_applications where id = sel.get('app_nova')::uuid), 'application withdrawn');
  perform sel.ok((select count(*) = 0 from public.payment_plans where invoice_id = sel.get('inv_nova')::uuid and status in ('active', 'paused')),
                 'plan cancelled with the invoice');
  perform sel.ok(not exists (select 1 from public.team_memberships tm join public.program_divisions d on d.team_id = tm.team_id
                               where d.id = sel.get('u16')::uuid and tm.athlete_id = sel.get('ath_nova')::uuid and tm.status = 'active'),
                 'withdrawn player left the roster');
end $$;

-- ===========================================================================
-- G. Sponsored applicants
-- ===========================================================================
do $$
declare v text;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
  v_iris uuid := (select athlete_id from public.program_applications where id = sel.get('app_iris')::uuid);
begin
  v := sel.run_as(admin_a, format($q$update public.athletes set sponsorship_kind = 'full', sponsorship_scope = '{program}', sponsor_name = 'Synthetic Sponsor'
       where id = %L returning array_to_string(sponsorship_scope, ',')$q$, v_iris));
  perform sel.ok(v = 'OK:program', 'sponsorship scope ''program'' is accepted (' || v || ')');
  v := sel.run_as(admin_a, format($q$select public.selection_set_status(%L, 'accepted')->>'invoice_id'$q$, sel.get('app_iris')));
  perform sel.put('inv_iris', substr(v, 4));
end $$;
-- (the sponsorship applies at the end of the creating transaction)
do $$
begin
  perform sel.ok((select status::text = 'paid' and total_chf + adjustments_total = 0 from public.invoices where id = sel.get('inv_iris')::uuid),
                 'fully sponsored package invoice: sponsored line, nothing due, settled');
  perform sel.ok(exists (select 1 from public.athlete_sponsorship_entries where invoice_id = sel.get('inv_iris')::uuid and scope = 'program' and amount = 1500),
                 'ledger: 1500 sponsored, scope program');
  perform sel.ok((select status = 'enrolled' from public.program_applications where id = sel.get('app_iris')::uuid),
                 'fully sponsored applicant enrolled');
end $$;
do $$
declare v text;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
begin
  -- Partial (50 %) for Lucas on the other programme.
  v := sel.run_as(admin_a, $q$update public.athletes set sponsorship_kind = 'partial', sponsorship_percent = 50, sponsorship_scope = '{program}'
       where id = '00000000-0000-0000-0000-000000000072' returning sponsorship_kind$q$);
  v := sel.run_as(admin_a, $q$select public.selection_set_status(a.id, 'accepted')->>'invoice_id' from public.program_applications a
       where a.program_id = '00000000-0000-0000-0000-0000000003b1'$q$);
  perform sel.put('inv_lucas', substr(v, 4));
end $$;
do $$
begin
  perform sel.ok((select status::text = 'sent' and total_chf + adjustments_total = 250 from public.invoices where id = sel.get('inv_lucas')::uuid),
                 'partially sponsored: credit note, 250 of 500 due');
end $$;

-- ===========================================================================
-- H. Stats and report
-- ===========================================================================
do $$
declare v text; j jsonb;
  finance_a uuid := '00000000-0000-0000-0000-0000000000f2';
  guardian uuid := '00000000-0000-0000-0000-0000000000f4';
  coach1 uuid := '00000000-0000-0000-0000-0000000000f3';
begin
  v := sel.run_as(finance_a, format($q$select public.selection_program_stats(%L)::text$q$, sel.get('prog')));
  j := (substr(v, 4)::jsonb) -> 0;
  -- Invoices: Mateo 4500 (plan), Leo 3000 (500 paid), Iris 1500 (sponsored); Nova's cancelled.
  perform sel.ok((j->>'invoiced')::numeric = 9000, 'stats: invoiced 9000 (' || coalesce(j->>'invoiced', v) || ')');
  perform sel.ok((j->>'collected')::numeric = 500, 'stats: collected 500 (' || (j->>'collected') || ')');
  perform sel.ok((j->>'sponsored')::numeric = 1500, 'stats: sponsored 1500 (' || (j->>'sponsored') || ')');
  perform sel.ok((j->>'outstanding')::numeric = 7000, 'stats: outstanding 7000 (' || (j->>'outstanding') || ')');
  perform sel.ok((j->>'applicants')::int = 3 and (j->>'enrolled')::int = 3, 'stats: 3 applicants (1 withdrawn excluded), 3 enrolled');
  perform sel.ok(jsonb_array_length(j->'divisions') >= 2, 'stats per division');
  v := sel.run_as(finance_a, format($q$select count(*)::text from public.selection_report(%L)$q$, sel.get('prog')));
  perform sel.ok(v = 'OK:4', 'report: one row per application (' || v || ')');
  v := sel.run_as(finance_a, format($q$select count(*)::text from public.selection_report(%L, 2026, %L)$q$, sel.get('prog'), sel.get('u14')));
  perform sel.ok(v = 'OK:2', 'report filtered by season and division (' || v || ')');
  v := sel.run_as(finance_a, format($q$select sum(sponsored)::text from public.selection_report(%L, null, null, %L)$q$, sel.get('prog'), sel.get('pkg1')));
  perform sel.ok(v = 'OK:1500.00', 'report filtered by package: sponsored value (' || v || ')');
  v := sel.run_as(guardian, $q$select public.selection_program_stats()::text$q$);
  perform sel.ok(v like 'ERR:%NOT_AUTHORIZED%', 'a guardian cannot read programme revenue (' || left(v, 50) || ')');
  v := sel.run_as(coach1, $q$select count(*)::text from public.selection_report()$q$);
  perform sel.ok(v like 'ERR:%NOT_AUTHORIZED%', 'a coach cannot read the finance report (' || left(v, 50) || ')');
end $$;

-- ===========================================================================
-- I. Cross-tenant denial
-- ===========================================================================
do $$
declare v text;
  admin_b uuid := 'b0000000-0000-0000-0000-0000000003c1';
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
begin
  v := sel.run_as(admin_b, $q$select (select count(*) from public.program_divisions where org_id = '00000000-0000-0000-0000-000000000001')
                          + (select count(*) from public.program_packages where org_id = '00000000-0000-0000-0000-000000000001')
                          + (select count(*) from public.program_coaches where org_id = '00000000-0000-0000-0000-000000000001')
                          + (select count(*) from public.program_applications where org_id = '00000000-0000-0000-0000-000000000001')$q$);
  perform sel.ok(v = 'OK:0', 'org B admin reads no org A divisions / packages / coaches / applications (' || v || ')');
  v := sel.run_as(admin_b, format($q$insert into public.program_divisions (org_id, program_id, name) values ('00000000-0000-0000-0000-000000000001', %L, 'X') returning id$q$, sel.get('prog')));
  perform sel.ok(v like 'ERR:%', 'org B admin cannot add a division to org A (' || left(v, 50) || ')');
  v := sel.run_as(admin_b, format($q$insert into public.program_packages (org_id, program_id, name, price) values ('10000000-0000-0000-0000-000000000002', %L, 'X', 10) returning id$q$, sel.get('prog')));
  perform sel.ok(v like 'ERR:%', 'org B admin cannot attach a package to an org A programme (' || left(v, 50) || ')');
  v := sel.run_as(admin_b, $q$insert into public.program_coaches (org_id, program_id, coach_id) values ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000003f1', '00000000-0000-0000-0000-000000000011') returning id$q$);
  perform sel.ok(v like 'ERR:%CROSS_TENANT%', 'org B admin cannot assign an org A coach (' || left(v, 50) || ')');
  v := sel.run_as(admin_b, format($q$with u as (update public.program_packages set price = 1 where program_id = %L returning 1) select count(*)::text from u$q$, sel.get('prog')));
  perform sel.ok(v = 'OK:0', 'org B admin cannot change org A packages (' || v || ')');
  v := sel.run_as(admin_b, format($q$with u as (delete from public.program_divisions where program_id = %L returning 1) select count(*)::text from u$q$, sel.get('prog')));
  perform sel.ok(v = 'OK:0', 'org B admin cannot delete org A divisions (' || v || ')');
  v := sel.run_as(admin_b, format($q$select public.selection_set_status(%L, 'declined', 'x')::text$q$, sel.get('app_leo')));
  perform sel.ok(v like 'ERR:%APPLICATION_NOT_FOUND%', 'org B admin cannot decide an org A application (' || left(v, 60) || ')');
  v := sel.run_as(admin_b, format($q$select public.selection_withdraw(%L)::text$q$, sel.get('app_leo')));
  perform sel.ok(v like 'ERR:%APPLICATION_NOT_FOUND%', 'org B admin cannot withdraw an org A application');
  v := sel.run_as(admin_b, format($q$select public.selection_change_package(%L, %L)::text$q$, sel.get('app_leo'), sel.get('pkg1')));
  perform sel.ok(v like 'ERR:%APPLICATION_NOT_FOUND%', 'org B admin cannot change an org A package choice');
  v := sel.run_as(admin_b, format($q$select public.selection_choose_plan(%L, 2)::text$q$, sel.get('app_leo')));
  perform sel.ok(v like 'ERR:%APPLICATION_NOT_FOUND%', 'org B admin cannot set up an org A plan');
  v := sel.run_as(admin_b, format($q$select count(*)::text from public.selection_review_list(%L)$q$, sel.get('prog')));
  perform sel.ok(v = 'OK:0', 'org B admin gets no org A review list (' || v || ')');
  v := sel.run_as(admin_b, format($q$select public.selection_program_stats(%L)::text$q$, sel.get('prog')));
  perform sel.ok(v = 'OK:[]', 'org B admin gets no org A revenue (' || v || ')');
  v := sel.run_as(admin_b, format($q$select count(*)::text from public.selection_report(%L)$q$, sel.get('prog')));
  perform sel.ok(v = 'OK:0', 'org B admin gets no org A report rows (' || v || ')');
  v := sel.run_as(admin_a, $q$insert into public.program_divisions (org_id, program_id, name) values ('00000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000003f1', 'X') returning id$q$);
  perform sel.ok(v like 'ERR:%', 'org A admin cannot reference an org B programme (' || left(v, 50) || ')');
  v := sel.run_as(admin_a, $q$select count(*)::text from public.program_packages where org_id = '10000000-0000-0000-0000-000000000002'$q$);
  perform sel.ok(v = 'OK:0', 'org A admin reads no org B packages (' || v || ')');
  -- A guest (programme-only) family's application is not visible to other families.
  v := sel.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select count(*)::text from public.program_applications where family_id = %L$q$, sel.get('fam_nova')));
  perform sel.ok(v = 'OK:0', 'another family cannot see a non-member family''s application (' || v || ')');
end $$;
