-- ============================================================================
-- Family & multi-club suite (migration 20250420101400_family_multi_club.sql)
--
--   A. One login, several clubs: memberships, org-scoped guardian access,
--      switch_current_org() security, suspension, invitation to a 2nd club.
--   B. Second guardian: invite permissions, medical visibility, permission
--      management, billing split, invoice split math + guards.
--   C. Privacy: consent history (append-only), own DSARs.
--   D. Push subscriptions: own rows, current org only.
--   E. Carpooling: roster-only board, matching, seats, private thread.
--   F. Player journey: season reviews, placements, history, scout links.
--   G. Erasure keeps a guardian who still belongs to another club.
--
-- Org A …0001 (admin f1, finance f2, coach f3 = coach …011, guardian Carla f4
-- of family …061 / Mateo …071). Org B …0002 (seed_tenants.sql).
-- SYNTHETIC DATA ONLY. Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema fx;
grant usage on schema fx to authenticated, anon, service_role;

create function fx.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

create function fx.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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

create function fx.exec_as(p uuid, p_sql text) returns text language plpgsql as $$
declare v_msg text; v_n bigint;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
    perform set_config('request.jwt.claim.role', case when p is null then 'anon' else 'authenticated' end, true);
    if p is null then execute 'set local role anon'; else execute 'set local role authenticated'; end if;
    execute p_sql;
    get diagnostics v_n = row_count;
    execute 'reset role';
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    return 'OK:' || v_n;
  exception when others then
    get stacked diagnostics v_msg = message_text;
    execute 'reset role';
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    return 'ERR:' || coalesce(v_msg, 'error');
  end;
end $$;
grant execute on all functions in schema fx to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Fixtures
--   M  c…01  guardian in A (family A2, primary) AND guardian + coach in B
--   G2 c…02  second guardian of A2 (invited: no medical access)
--   G4 c…04  guardian of family A3 (athlete on team TA)
--   G5 c…05  guardian of family A5 (athlete NOT on team TA)
--   N  c…06  member of A only
--   AB c…07  admin of B
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug)
values ('30000000-0000-0000-0000-000000000003', 'Synthetic Club C', 'synthetic-c');

insert into auth.users (id, email) values
  ('c0000000-0000-0000-0000-000000000001', 'multi@example.test'),
  ('c0000000-0000-0000-0000-000000000004', 'g4@example.test'),
  ('c0000000-0000-0000-0000-000000000005', 'g5@example.test'),
  ('c0000000-0000-0000-0000-000000000006', 'n@example.test'),
  ('c0000000-0000-0000-0000-000000000007', 'admin-b2@example.test');

update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic Multi Parent'
 where id = 'c0000000-0000-0000-0000-000000000001';
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic Four'
 where id in ('c0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000006');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'c0000000-0000-0000-0000-000000000007';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000007', 'admin'),
  ('10000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'coach');

insert into public.families (id, org_id, name) values
  ('c0000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001', 'Synthetic A2'),
  ('c0000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000001', 'Synthetic A3'),
  ('c0000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000001', 'Synthetic A5'),
  ('c0000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000002', 'Synthetic B1');
insert into public.family_members (family_id, profile_id, relation, is_primary) values
  ('c0000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-000000000001', 'mother', true),
  ('c0000000-0000-0000-0000-0000000000a3', 'c0000000-0000-0000-0000-000000000004', 'father', true),
  ('c0000000-0000-0000-0000-0000000000a5', 'c0000000-0000-0000-0000-000000000005', 'father', true),
  ('c0000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-000000000001', 'mother', true);
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, position_pref) values
  ('c0000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a2', 'Synthia', 'Testova', '2012-05-01', 'Guard'),
  ('c0000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a3', 'Synth', 'Three', '2012-06-01', null),
  ('c0000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a5', 'Synth', 'Five', '2012-07-01', null),
  ('c0000000-0000-0000-0000-0000000000db', '10000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000b1', 'Synth', 'Bee', '2013-01-01', null);
insert into public.athlete_medical (org_id, athlete_id, allergies)
values ('00000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000d2', 'Synthetic allergy');

-- Second guardian of A2 arrives through an invitation that withholds medical access.
insert into public.invitations (org_id, email, role, family_id, relation, guardian_permissions)
values ('00000000-0000-0000-0000-000000000001', 'g2@example.test', 'parent', 'c0000000-0000-0000-0000-0000000000a2', 'father',
        '{"can_see_medical": false, "can_pay": true, "receives_emails": false}');
insert into auth.users (id, email) values ('c0000000-0000-0000-0000-000000000002', 'g2@example.test');

create table fx.ids (k text primary key, val text);
grant all on fx.ids to authenticated, anon, service_role;

-- ===========================================================================
-- A. One login, several clubs
-- ===========================================================================
do $$
declare v text;
  m  constant uuid := 'c0000000-0000-0000-0000-000000000001';
  n  constant uuid := 'c0000000-0000-0000-0000-000000000006';
  ab constant uuid := 'c0000000-0000-0000-0000-000000000007';
begin
  perform fx.ok((select count(*) from public.org_memberships where profile_id = m) = 2, 'multi-club parent has two memberships');
  perform fx.ok((select roles @> array['parent','coach']::public.app_role[] from public.org_memberships
                  where profile_id = m and org_id = '10000000-0000-0000-0000-000000000002'), 'membership in B carries parent + coach');
  perform fx.ok((select roles = array['parent']::public.app_role[] from public.org_memberships
                  where profile_id = m and org_id = '00000000-0000-0000-0000-000000000001'), 'membership in A carries parent only');
  perform fx.ok(exists (select 1 from public.org_memberships where profile_id = '00000000-0000-0000-0000-0000000000f1'
                         and org_id = '00000000-0000-0000-0000-000000000001' and 'admin' = any(roles)), 'backfill: seeded admin is a member of A');

  v := fx.run_as(m, $q$select count(*)::text from public.my_org_memberships()$q$);
  perform fx.ok(v = 'OK:2', 'my_org_memberships lists both clubs');
  v := fx.run_as(n, $q$select count(*)::text from public.my_org_memberships()$q$);
  perform fx.ok(v = 'OK:1', 'single-club member lists one club');

  -- Current org A: only A data
  v := fx.run_as(m, $q$select count(*)::text from public.families$q$);
  perform fx.ok(v = 'OK:1', 'in club A the parent sees only the A family (not the B family)');
  v := fx.run_as(m, $q$select count(*)::text from public.athletes where id = 'c0000000-0000-0000-0000-0000000000db'$q$);
  perform fx.ok(v = 'OK:0', 'in club A the B child is invisible');
  v := fx.run_as(m, $q$select public.is_guardian_of_family('c0000000-0000-0000-0000-0000000000b1')::text$q$);
  perform fx.ok(v = 'OK:false', 'guardian helper is scoped to the current org');
  v := fx.run_as(m, $q$select public.has_role('coach')::text$q$);
  perform fx.ok(v = 'OK:false', 'coach role in B does not count while in A');

  -- Direct org hop refused
  v := fx.exec_as(m, $q$update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = auth.uid()$q$);
  perform fx.ok(v like 'ERR:%ORG_CHANGE_NOT_ALLOWED%', 'direct profiles.org_id change is refused (' || v || ')');
  v := fx.exec_as(m, $q$insert into public.org_memberships (org_id, profile_id) values ('30000000-0000-0000-0000-000000000003', auth.uid())$q$);
  perform fx.ok(v like 'ERR:%', 'users cannot create memberships themselves');
  v := fx.run_as(m, $q$select public.switch_current_org('30000000-0000-0000-0000-000000000003')::text$q$);
  perform fx.ok(v like 'ERR:%NO_MEMBERSHIP%', 'switching into a club without membership is refused');
  v := fx.run_as(n, $q$select public.switch_current_org('10000000-0000-0000-0000-000000000002')::text$q$);
  perform fx.ok(v like 'ERR:%NO_MEMBERSHIP%', 'a member of A only cannot switch into B');
  v := fx.run_as(null, $q$select public.switch_current_org('10000000-0000-0000-0000-000000000002')::text$q$);
  perform fx.ok(v like 'ERR:%', 'anonymous cannot switch');

  -- Switch to B
  v := fx.run_as(m, $q$select (public.switch_current_org('10000000-0000-0000-0000-000000000002')->>'org_id')$q$);
  perform fx.ok(v = 'OK:10000000-0000-0000-0000-000000000002', 'switch to B with membership succeeds');
  perform fx.ok((select org_id from public.profiles where id = m) = '10000000-0000-0000-0000-000000000002', 'current org is now B');
  perform fx.ok(exists (select 1 from public.audit_logs where action = 'org.switch_in' and actor_id = m
                         and org_id = '10000000-0000-0000-0000-000000000002'), 'switch audited in the target club');
  perform fx.ok(exists (select 1 from public.audit_logs where action = 'org.switch_out' and actor_id = m
                         and org_id = '00000000-0000-0000-0000-000000000001'), 'switch audited in the previous club');
  v := fx.run_as(m, $q$select string_agg(name, ',') from public.families$q$);
  perform fx.ok(v = 'OK:Synthetic B1', 'in club B the parent sees only the B family');
  v := fx.run_as(m, $q$select count(*)::text from public.athlete_medical$q$);
  perform fx.ok(v = 'OK:0', 'in club B the A child''s medical row is invisible');
  v := fx.run_as(m, $q$select public.has_role('coach')::text$q$);
  perform fx.ok(v = 'OK:true', 'coach role counts in B');

  -- Admin of B sees B memberships only; suspends M
  v := fx.run_as(ab, $q$select count(*)::text from public.org_memberships where org_id = '00000000-0000-0000-0000-000000000001'$q$);
  perform fx.ok(v = 'OK:0', 'admin of B cannot list A memberships');
  v := fx.exec_as(ab, $q$update public.org_memberships set roles = '{admin}' where profile_id = 'c0000000-0000-0000-0000-000000000001'$q$);
  perform fx.ok(v like 'ERR:%MEMBERSHIP_IMMUTABLE%', 'admin cannot grant roles through memberships');
  v := fx.exec_as(ab, $q$update public.org_memberships set status = 'suspended' where profile_id = 'c0000000-0000-0000-0000-000000000001'$q$);
  perform fx.ok(v = 'OK:1', 'admin of B suspends the membership (B row only)');
  v := fx.run_as(m, $q$select coalesce(public.current_org_id()::text, 'none')$q$);
  perform fx.ok(v = 'OK:none', 'suspended membership: no current org');
  v := fx.run_as(m, $q$select count(*)::text from public.families$q$);
  perform fx.ok(v = 'OK:0', 'suspended membership: nothing visible');
  v := fx.run_as(m, $q$select public.switch_current_org('10000000-0000-0000-0000-000000000002')::text$q$);
  perform fx.ok(v like 'ERR:%NO_MEMBERSHIP%', 'cannot switch into a suspended membership');
  v := fx.run_as(m, $q$select (public.switch_current_org('00000000-0000-0000-0000-000000000001')->>'org_id')$q$);
  perform fx.ok(v = 'OK:00000000-0000-0000-0000-000000000001', 'can switch back to A');
  update public.org_memberships set status = 'active' where profile_id = m;
end $$;

-- Invitation to a second club adds a membership instead of failing.
do $$
declare v text;
  carla constant uuid := '00000000-0000-0000-0000-0000000000f4';
  ab    constant uuid := 'c0000000-0000-0000-0000-000000000007';
begin
  v := fx.exec_as(ab, $q$insert into public.invitations (org_id, email, role, family_id, relation)
        values ('10000000-0000-0000-0000-000000000002', 'carla.lopes@gmail.com', 'parent', 'c0000000-0000-0000-0000-0000000000b1', 'aunt')$q$);
  perform fx.ok(v = 'OK:1', 'admin of B invites a member of A (' || v || ')');
  v := fx.run_as(carla, $q$select public.claim_my_invitations()::text$q$);
  perform fx.ok(v = 'OK:1', 'the invited user claims the invitation');
  perform fx.ok(exists (select 1 from public.org_memberships where profile_id = carla and org_id = '10000000-0000-0000-0000-000000000002'),
                'membership in B created');
  perform fx.ok((select org_id from public.profiles where id = carla) = '00000000-0000-0000-0000-000000000001', 'current club unchanged (A)');
  v := fx.run_as(carla, $q$select count(*)::text from public.families where id = 'c0000000-0000-0000-0000-0000000000b1'$q$);
  perform fx.ok(v = 'OK:0', 'while in A the new B family is not visible');
  v := fx.run_as(carla, $q$select public.claim_my_invitations()::text$q$);
  perform fx.ok(v = 'OK:0', 'claiming twice does nothing');
  v := fx.run_as(carla, $q$select public.consume_invitation('00000000-0000-0000-0000-000000000000', auth.uid())::text$q$);
  perform fx.ok(v like 'ERR:%permission denied%', 'consume_invitation is server-only');
end $$;

-- ===========================================================================
-- B. Second guardian, permissions, split billing
-- ===========================================================================
do $$
declare v text; v_inv uuid; v_inv2 uuid;
  m  constant uuid := 'c0000000-0000-0000-0000-000000000001';
  g2 constant uuid := 'c0000000-0000-0000-0000-000000000002';
  fin constant uuid := '00000000-0000-0000-0000-0000000000f2';
  ab constant uuid := 'c0000000-0000-0000-0000-000000000007';
begin
  perform fx.ok((select not can_see_medical and can_pay and not receives_emails and not is_primary from public.family_members
                  where family_id = 'c0000000-0000-0000-0000-0000000000a2' and profile_id = g2),
                'invited second guardian linked with the chosen permissions');
  perform fx.ok((select status::text from public.invitations where email = 'g2@example.test') = 'accepted', 'invitation accepted on sign-up');
  v := fx.run_as(g2, $q$select count(*)::text from public.athletes where id = 'c0000000-0000-0000-0000-0000000000d2'$q$);
  perform fx.ok(v = 'OK:1', 'second guardian sees the same child');
  v := fx.run_as(g2, $q$select count(*)::text from public.athlete_medical where athlete_id = 'c0000000-0000-0000-0000-0000000000d2'$q$);
  perform fx.ok(v = 'OK:0', 'second guardian without medical permission cannot read medical data');
  v := fx.exec_as(g2, $q$update public.athlete_medical set allergies = 'x' where athlete_id = 'c0000000-0000-0000-0000-0000000000d2'$q$);
  perform fx.ok(v = 'OK:0', 'second guardian without medical permission cannot write medical data');
  v := fx.run_as(m, $q$select count(*)::text from public.athlete_medical where athlete_id = 'c0000000-0000-0000-0000-0000000000d2'$q$);
  perform fx.ok(v = 'OK:1', 'primary guardian reads medical data');

  v := fx.run_as(g2, $q$select public.set_guardian_permissions('c0000000-0000-0000-0000-0000000000a2', auth.uid(), true, true, true)::text$q$);
  perform fx.ok(v like 'ERR:%NOT_ALLOWED%', 'second guardian cannot grant themselves permissions');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f4', $q$select public.set_guardian_permissions('c0000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-000000000002', true, true, true)::text$q$);
  perform fx.ok(v like 'ERR:%NOT_ALLOWED%', 'another family''s guardian cannot change permissions');
  v := fx.run_as(ab, $q$select public.set_guardian_permissions('c0000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-000000000002', true, true, true)::text$q$);
  perform fx.ok(v like 'ERR:%NOT_FOUND%', 'admin of another club cannot change permissions');
  v := fx.run_as(m, $q$select public.set_guardian_permissions('c0000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-000000000002', true, true, true)::text$q$);
  perform fx.ok(v like 'OK:%', 'primary guardian grants medical access');
  v := fx.run_as(g2, $q$select count(*)::text from public.athlete_medical where athlete_id = 'c0000000-0000-0000-0000-0000000000d2'$q$);
  perform fx.ok(v = 'OK:1', 'after the grant the second guardian reads medical data');
  perform fx.ok(exists (select 1 from public.audit_logs where action = 'family.guardian_permissions' and target_id = 'c0000000-0000-0000-0000-0000000000a2'),
                'permission change audited');

  -- Split configuration
  v := fx.run_as(g2, $q$select public.set_family_billing_split('c0000000-0000-0000-0000-0000000000a2', 'split', '{"c0000000-0000-0000-0000-000000000001": 50, "c0000000-0000-0000-0000-000000000002": 50}')::text$q$);
  perform fx.ok(v like 'ERR:%NOT_ALLOWED%', 'non-primary guardian cannot set the split');
  v := fx.run_as(m, $q$select public.set_family_billing_split('c0000000-0000-0000-0000-0000000000a2', 'split', '{"c0000000-0000-0000-0000-000000000001": 50, "c0000000-0000-0000-0000-000000000002": 40}')::text$q$);
  perform fx.ok(v like 'ERR:%SHARES_MUST_TOTAL_100%', 'shares must total 100');
  v := fx.run_as(m, $q$select public.set_family_billing_split('c0000000-0000-0000-0000-0000000000a2', 'split', '{"c0000000-0000-0000-0000-000000000001": 100}')::text$q$);
  perform fx.ok(v like 'ERR:%SPLIT_NEEDS_TWO_PAYERS%', 'a split needs two payers');
  v := fx.run_as(m, $q$select public.set_family_billing_split('c0000000-0000-0000-0000-0000000000a2', 'split', '{"c0000000-0000-0000-0000-000000000001": 60, "c0000000-0000-0000-0000-000000000004": 40}')::text$q$);
  perform fx.ok(v like 'ERR:%SHARE_NOT_A_PAYER%', 'only guardians of the family can take a share');
  v := fx.run_as(m, $q$select public.set_family_billing_split('c0000000-0000-0000-0000-0000000000a2', 'split', '{"c0000000-0000-0000-0000-000000000001": 60, "c0000000-0000-0000-0000-000000000002": 40}')::text$q$);
  perform fx.ok(v like 'OK:%', 'primary guardian sets a 60/40 split');

  -- Invoice split
  insert into public.invoices (org_id, number, family_id, description, status, due_date, currency, total_chf)
  values ('00000000-0000-0000-0000-000000000001', 'FAM-SPLIT-1', 'c0000000-0000-0000-0000-0000000000a2', 'Synthetic season', 'sent', current_date + 20, 'CHF', 0)
  returning id into v_inv;
  insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf) values
    ('00000000-0000-0000-0000-000000000001', v_inv, 'Synthetic fee', 1, 333.33, 333.33),
    ('00000000-0000-0000-0000-000000000001', v_inv, 'Synthetic kit', 1, 66.68, 66.68);
  update public.invoices set total_chf = 400.01 where id = v_inv;
  insert into fx.ids values ('inv', v_inv::text);

  v := fx.run_as(m, format('select public.split_family_invoice(%L)::text', v_inv));
  perform fx.ok(v like 'ERR:%NOT_ALLOWED%', 'a guardian cannot split invoices');
  v := fx.run_as(ab, format('select public.split_family_invoice(%L)::text', v_inv));
  perform fx.ok(v like 'ERR:%NOT_ALLOWED%', 'finance of another club cannot split (cross-tenant)');
  v := fx.run_as(fin, format('select public.split_family_invoice(%L)::text', v_inv));
  perform fx.ok(v like 'OK:%', 'finance splits the invoice (' || left(v, 120) || ')');
  perform fx.ok((select count(*) from public.invoices where split_group_id = (select split_group_id from public.invoices where id = v_inv)) = 2,
                'two invoices in the split group');
  perform fx.ok((select sum(total_chf) from public.invoices where split_group_id = (select split_group_id from public.invoices where id = v_inv)) = 400.01,
                'parts add up exactly to the original total');
  perform fx.ok((select total_chf from public.invoices where id = v_inv) = 240.01, 'first payer (60%) part = 240.01');
  select id into v_inv2 from public.invoices where split_from_invoice_id = v_inv;
  perform fx.ok((select total_chf from public.invoices where id = v_inv2) = 160.00, 'second payer (40%) part = 160.00');
  perform fx.ok((select sum(amount_chf) from public.invoice_items where invoice_id = v_inv2) = 160.00, 'second part lines add up to its total');
  perform fx.ok((select sum(amount_chf) from public.invoice_items where invoice_id in (v_inv, v_inv2)) = 400.01, 'all lines add up to the original');
  perform fx.ok((select payer_profile_id from public.invoices where id = v_inv) = m and (select payer_profile_id from public.invoices where id = v_inv2) = g2,
                'each part has its responsible payer');
  perform fx.ok((select count(distinct number) = 2 and count(distinct payment_reference) = 2 and bool_and(payment_reference is not null)
                   from public.invoices where id in (v_inv, v_inv2)), 'each part has its own number and payment reference');
  v := fx.run_as(fin, format('select public.split_family_invoice(%L)::text', v_inv));
  perform fx.ok(v like 'ERR:%ALREADY_SPLIT%', 'an invoice is split once');
  perform fx.ok((select array_agg(profile_id) from public.invoice_billing_recipients(v_inv2)) = array[g2], 'reminders for a part go to its payer only');
  perform fx.ok(exists (select 1 from public.audit_logs where action = 'invoice.split' and target_id = v_inv), 'split audited');

  -- Guards
  insert into public.invoices (org_id, number, family_id, status, due_date, currency, total_chf)
  values ('00000000-0000-0000-0000-000000000001', 'FAM-SPLIT-2', 'c0000000-0000-0000-0000-0000000000a2', 'paid', current_date, 'CHF', 100)
  returning id into v_inv;
  v := fx.run_as(fin, format('select public.split_family_invoice(%L)::text', v_inv));
  perform fx.ok(v like 'ERR:%INVOICE_NOT_OPEN%', 'a paid invoice is not split');
  insert into public.invoices (org_id, number, family_id, status, due_date, currency, total_chf)
  values ('00000000-0000-0000-0000-000000000001', 'FAM-SPLIT-3', 'c0000000-0000-0000-0000-0000000000a3', 'sent', current_date, 'CHF', 100)
  returning id into v_inv;
  v := fx.run_as(fin, format('select public.split_family_invoice(%L)::text', v_inv));
  perform fx.ok(v like 'ERR:%FAMILY_NOT_SPLIT%', 'a family without a split keeps one invoice');

  v := fx.run_as(g2, $q$select public.remove_family_guardian('c0000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-000000000001')::text$q$);
  perform fx.ok(v like 'ERR:%CANNOT_REMOVE_PRIMARY%', 'the primary guardian cannot be removed');
end $$;

-- ===========================================================================
-- C. Privacy self-service
-- ===========================================================================
do $$
declare v text;
  m constant uuid := 'c0000000-0000-0000-0000-000000000001';
  carla constant uuid := '00000000-0000-0000-0000-0000000000f4';
  ab constant uuid := 'c0000000-0000-0000-0000-000000000007';
begin
  v := fx.exec_as(m, $q$insert into public.family_consent_events (org_id, family_id, athlete_id, profile_id, kind, granted)
        values ('00000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-0000000000d2', auth.uid(), 'media', true)$q$);
  perform fx.ok(v = 'OK:1', 'guardian records a media consent');
  v := fx.exec_as(m, $q$insert into public.family_consent_events (org_id, family_id, athlete_id, profile_id, kind, granted)
        values ('00000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-0000000000d2', auth.uid(), 'media', false)$q$);
  perform fx.ok(v = 'OK:1', 'guardian withdraws it (history kept)');
  v := fx.run_as(m, $q$select (select granted::text from public.family_consent_state('c0000000-0000-0000-0000-0000000000a2') where kind = 'media')$q$);
  perform fx.ok(v = 'OK:false', 'current media consent = latest decision');
  v := fx.run_as(m, $q$select count(*)::text from public.family_consent_events where family_id = 'c0000000-0000-0000-0000-0000000000a2'$q$);
  perform fx.ok(v = 'OK:2', 'consent history visible to the guardian');
  v := fx.exec_as(m, $q$update public.family_consent_events set granted = true$q$);
  perform fx.ok(v = 'OK:0', 'consent history cannot be edited');
  v := fx.exec_as(m, $q$delete from public.family_consent_events$q$);
  perform fx.ok(v = 'OK:0', 'consent history cannot be deleted');
  v := fx.exec_as(carla, $q$insert into public.family_consent_events (org_id, family_id, athlete_id, profile_id, kind, granted)
        values ('00000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-0000000000d2', auth.uid(), 'media', true)$q$);
  perform fx.ok(v like 'ERR:%', 'another family cannot record consent for this child');
  v := fx.run_as(carla, $q$select count(*)::text from public.family_consent_events where family_id = 'c0000000-0000-0000-0000-0000000000a2'$q$);
  perform fx.ok(v = 'OK:0', 'another family cannot read the consent history');
  v := fx.run_as(ab, $q$select count(*)::text from public.family_consent_events$q$);
  perform fx.ok(v = 'OK:0', 'admin of another club sees no consent history (cross-tenant)');

  insert into public.dsar_requests (org_id, family_id, requester_profile_id, requester_name, request_type, channel)
  values ('00000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a2', m, 'Synthetic Multi Parent', 'rectification', 'in_app');
  v := fx.run_as(m, $q$select count(*)::text from public.dsar_requests$q$);
  perform fx.ok(v = 'OK:1', 'guardian sees the request they filed');
  v := fx.run_as('c0000000-0000-0000-0000-000000000002', $q$select count(*)::text from public.dsar_requests$q$);
  perform fx.ok(v = 'OK:0', 'other guardians do not see someone else''s request');
end $$;

-- ===========================================================================
-- D. Push subscriptions
-- ===========================================================================
do $$
declare v text;
  m constant uuid := 'c0000000-0000-0000-0000-000000000001';
  g2 constant uuid := 'c0000000-0000-0000-0000-000000000002';
begin
  v := fx.exec_as(m, $q$insert into public.push_subscriptions (org_id, profile_id, endpoint, p256dh, auth_secret)
        values ('00000000-0000-0000-0000-000000000001', auth.uid(), 'https://push.example.test/s/1',
                'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', 'tBHItJI5svbpez7KI4CCXg')$q$);
  perform fx.ok(v = 'OK:1', 'user registers their own device');
  v := fx.exec_as(m, $q$insert into public.push_subscriptions (org_id, profile_id, endpoint, p256dh, auth_secret)
        values ('00000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'https://push.example.test/s/2',
                'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', 'tBHItJI5svbpez7KI4CCXg')$q$);
  perform fx.ok(v like 'ERR:%', 'cannot register a device for someone else');
  v := fx.exec_as(m, $q$insert into public.push_subscriptions (org_id, profile_id, endpoint, p256dh, auth_secret)
        values ('10000000-0000-0000-0000-000000000002', auth.uid(), 'https://push.example.test/s/3',
                'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', 'tBHItJI5svbpez7KI4CCXg')$q$);
  perform fx.ok(v like 'ERR:%', 'cannot register a device in another club than the current one');
  v := fx.exec_as(m, $q$insert into public.push_subscriptions (org_id, profile_id, endpoint, p256dh, auth_secret)
        values ('00000000-0000-0000-0000-000000000001', auth.uid(), 'http://insecure.example.test/s',
                'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', 'tBHItJI5svbpez7KI4CCXg')$q$);
  perform fx.ok(v like 'ERR:%', 'non-https endpoints are refused');
  v := fx.run_as(g2, $q$select count(*)::text from public.push_subscriptions$q$);
  perform fx.ok(v = 'OK:0', 'nobody else sees the device');
  v := fx.exec_as(g2, $q$delete from public.push_subscriptions$q$);
  perform fx.ok(v = 'OK:0', 'nobody else can delete the device');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.push_subscriptions$q$);
  perform fx.ok(v = 'OK:0', 'not even a club admin sees device subscriptions');
  v := fx.run_as(m, $q$select count(*)::text from public.push_subscriptions$q$);
  perform fx.ok(v = 'OK:1', 'owner sees their device');
end $$;

-- ===========================================================================
-- E. Carpooling
-- ===========================================================================
insert into public.seasons (id, org_id, name, starts_on, ends_on)
values ('c0000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-000000000001', 'Synthetic season 1', current_date - 200, current_date + 100);
insert into public.teams (id, org_id, name, season_id) values
  ('c0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001', 'Synthetic U14', 'c0000000-0000-0000-0000-0000000005e1');
insert into public.team_memberships (org_id, team_id, athlete_id) values
  ('00000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000e1', 'c0000000-0000-0000-0000-0000000000d2'),
  ('00000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000e1', 'c0000000-0000-0000-0000-0000000000d3'),
  ('00000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000071');
insert into public.team_coaches (team_id, coach_id, org_id) values
  ('c0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001');
insert into public.events (id, org_id, team_id, season_id, type, starts_at, ends_at, home_away, location_text, opponent)
values ('c0000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000e1',
        'c0000000-0000-0000-0000-0000000005e1', 'game', now() + interval '3 days', now() + interval '3 days 2 hours', 'away', 'Synthetic away hall', 'Synthetic opponent');

do $$
declare v text; v_off text; v_req text; v_req2 text; v_match text; v_conv uuid;
  m  constant uuid := 'c0000000-0000-0000-0000-000000000001';
  g4 constant uuid := 'c0000000-0000-0000-0000-000000000004';
  g5 constant uuid := 'c0000000-0000-0000-0000-000000000005';
  carla constant uuid := '00000000-0000-0000-0000-0000000000f4';
  ab constant uuid := 'c0000000-0000-0000-0000-000000000007';
begin
  v_off := fx.run_as(m, $q$insert into public.carpool_offers (org_id, event_id, family_id, profile_id, from_area, departs_at, seats_total)
           values ('00000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000f1', 'c0000000-0000-0000-0000-0000000000a2',
                   auth.uid(), 'Synthetic station', now() + interval '3 days' - interval '1 hour', 3) returning id::text$q$);
  perform fx.ok(v_off like 'OK:%', 'guardian of a rostered player offers seats');
  v_off := substr(v_off, 4);
  v_req := fx.run_as(carla, $q$insert into public.carpool_requests (org_id, event_id, family_id, profile_id, from_area, seats_needed)
           values ('00000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000061',
                   auth.uid(), 'Synthetic square', 2) returning id::text$q$);
  perform fx.ok(v_req like 'OK:%', 'another rostered family requests seats');
  v_req := substr(v_req, 4);
  v_req2 := fx.run_as(g4, $q$insert into public.carpool_requests (org_id, event_id, family_id, profile_id, from_area, seats_needed)
           values ('00000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000f1', 'c0000000-0000-0000-0000-0000000000a3',
                   auth.uid(), 'Synthetic park', 2) returning id::text$q$);
  v_req2 := substr(v_req2, 4);

  v := fx.exec_as(g5, $q$insert into public.carpool_offers (org_id, event_id, family_id, profile_id, from_area, departs_at, seats_total)
        values ('00000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000f1', 'c0000000-0000-0000-0000-0000000000a5',
                auth.uid(), 'Synthetic street', now() + interval '3 days', 2)$q$);
  perform fx.ok(v like 'ERR:%', 'a guardian whose child is not on the roster cannot post');
  v := fx.run_as(g5, $q$select count(*)::text from public.carpool_offers$q$);
  perform fx.ok(v = 'OK:0', 'a guardian whose child is not on the roster cannot see the board');
  v := fx.run_as(g5, $q$select public.carpool_board('c0000000-0000-0000-0000-0000000000f1')::text$q$);
  perform fx.ok(v like 'ERR:%NOT_ALLOWED%', 'board RPC refused for non-roster guardians');
  v := fx.run_as(ab, $q$select count(*)::text from public.carpool_requests$q$);
  perform fx.ok(v = 'OK:0', 'admin of another club sees nothing (cross-tenant)');
  v := fx.exec_as(carla, format('update public.carpool_offers set seats_total = 8 where id = %L', v_off));
  perform fx.ok(v = 'OK:0', 'a guardian cannot edit someone else''s offer');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3', $q$select jsonb_array_length(public.carpool_board('c0000000-0000-0000-0000-0000000000f1')->'requests')::text$q$);
  perform fx.ok(v = 'OK:2', 'the team''s coach sees the overview');
  v := fx.run_as(carla, $q$select (public.carpool_board('c0000000-0000-0000-0000-0000000000f1')::text like '%@%')::text$q$);
  perform fx.ok(v = 'OK:false', 'board exposes no email addresses');

  v_match := fx.run_as(carla, format('select public.carpool_match(%L, %L)::text', v_off, v_req));
  perform fx.ok(v_match like 'OK:%', 'requester joins the offer (' || left(v_match, 80) || ')');
  v_conv := (substr(v_match, 4)::jsonb->>'conversation_id')::uuid;
  perform fx.ok((select count(*) from public.msg_participants where conversation_id = v_conv) = 2, 'a private thread with both guardians is opened');
  v := fx.run_as(m, format('select count(*)::text from public.msg_conversations where id = %L', v_conv));
  perform fx.ok(v = 'OK:1', 'the driver can read the carpool thread');
  v := fx.run_as(g4, format('select count(*)::text from public.msg_conversations where id = %L', v_conv));
  perform fx.ok(v = 'OK:0', 'other guardians cannot read the carpool thread');
  v := fx.run_as(g4, $q$select (public.carpool_board('c0000000-0000-0000-0000-0000000000f1')->'matches'->0->>'conversation_id') is null$q$);
  perform fx.ok(v = 'OK:true', 'board hides the thread from non-parties');
  v := fx.run_as(g4, format('select public.carpool_match(%L, %L)::text', v_off, v_req2));
  perform fx.ok(v like 'ERR:%NOT_ENOUGH_SEATS%', 'seats are never overbooked');
  v := fx.run_as(g5, format('select public.carpool_match(%L, %L)::text', v_off, v_req2));
  perform fx.ok(v like 'ERR:%NOT_ALLOWED%', 'outsiders cannot match');
  v := fx.run_as(carla, format('select public.carpool_match(%L, %L)::text', v_off, v_req));
  perform fx.ok(v like 'ERR:%NOT_OPEN%', 'a matched request cannot be matched twice');
  v := fx.run_as(carla, format('select (public.carpool_cancel_match((select id from public.carpool_matches where request_id = %L)) ->> ''driver_id'')', v_req));
  perform fx.ok(v = 'OK:' || m::text, 'the passenger can cancel the match');
  perform fx.ok((select status from public.carpool_requests where id = v_req::uuid) = 'open', 'cancelled match reopens the request');
end $$;

-- ===========================================================================
-- F. Player journey
-- ===========================================================================
do $$
declare v text; v_rev text; v_pl text; v_hash text := repeat('ab', 32); v_view jsonb;
  m  constant uuid := 'c0000000-0000-0000-0000-000000000001';
  coach constant uuid := '00000000-0000-0000-0000-0000000000f3';
  carla constant uuid := '00000000-0000-0000-0000-0000000000f4';
  ab constant uuid := 'c0000000-0000-0000-0000-000000000007';
begin
  insert into public.event_athlete_stats (event_id, athlete_id, org_id, stats)
  values ('c0000000-0000-0000-0000-0000000000f1', 'c0000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000001', '{"points": 12, "rebounds": 4}');

  v_rev := fx.run_as(coach, $q$insert into public.player_season_reviews (org_id, athlete_id, season_id, season_label, coach_comment, awards, shared_with_family)
           values ('00000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000d2', 'c0000000-0000-0000-0000-0000000005e1',
                   'Synthetic season 1', 'Synthetic comment', '{"Synthetic MVP"}', false) returning id::text$q$);
  perform fx.ok(v_rev like 'OK:%', 'the team''s coach writes an end-of-season review');
  v_rev := substr(v_rev, 4);
  v := fx.run_as(m, $q$select count(*)::text from public.player_season_reviews$q$);
  perform fx.ok(v = 'OK:0', 'an unshared review is not visible to guardians');
  update public.player_season_reviews set shared_with_family = true where id = v_rev::uuid;
  v := fx.run_as(m, $q$select count(*)::text from public.player_season_reviews$q$);
  perform fx.ok(v = 'OK:1', 'a shared review is visible to the guardian');
  v := fx.run_as(carla, $q$select count(*)::text from public.player_season_reviews where athlete_id = 'c0000000-0000-0000-0000-0000000000d2'$q$);
  perform fx.ok(v = 'OK:0', 'other families cannot see the review');
  v := fx.exec_as(m, format('update public.player_season_reviews set coach_comment = %L where id = %L', 'x', v_rev));
  perform fx.ok(v = 'OK:0', 'guardians cannot edit reviews');

  v := fx.run_as(m, $q$select jsonb_array_length(public.player_journey('c0000000-0000-0000-0000-0000000000d2')->'seasons')::text$q$);
  perform fx.ok(v = 'OK:1', 'journey lists the season');
  v := fx.run_as(m, $q$select (public.player_journey('c0000000-0000-0000-0000-0000000000d2')->'seasons'->0->'stats'->>'points')$q$);
  perform fx.ok(v = 'OK:12', 'journey aggregates season stats');
  v := fx.run_as(carla, $q$select public.player_journey('c0000000-0000-0000-0000-0000000000d2')::text$q$);
  perform fx.ok(v like 'ERR:%NOT_ALLOWED%', 'another family cannot read the journey');
  v := fx.run_as(ab, $q$select public.player_journey('c0000000-0000-0000-0000-0000000000d2')::text$q$);
  perform fx.ok(v like 'ERR:%NOT_ALLOWED%', 'admin of another club cannot read the journey (cross-tenant)');

  v_pl := fx.run_as(coach, $q$insert into public.placement_targets (org_id, athlete_id, target_name, target_kind, status, deadline)
          values ('00000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000d2', 'Synthetic Academy', 'academy', 'interested', current_date + 30)
          returning id::text$q$);
  perform fx.ok(v_pl like 'OK:%', 'coach adds a placement target');
  v_pl := substr(v_pl, 4);
  v := fx.exec_as(coach, format('update public.placement_targets set status = %L where id = %L', 'trial', v_pl));
  perform fx.ok(v = 'OK:1', 'coach moves it along the pipeline');
  perform fx.ok((select count(*) from public.placement_status_history where placement_id = v_pl::uuid) = 2, 'status history kept');
  v := fx.run_as(m, $q$select count(*)::text from public.placement_targets$q$);
  perform fx.ok(v = 'OK:1', 'guardian sees the placement tracker');
  v := fx.exec_as(m, format('update public.placement_targets set status = %L where id = %L', 'placed', v_pl));
  perform fx.ok(v = 'OK:0', 'guardian cannot change the tracker');
  v := fx.run_as(carla, $q$select count(*)::text from public.placement_targets$q$);
  perform fx.ok(v = 'OK:0', 'other families cannot see the tracker');
  v := fx.exec_as(coach, format('update public.placement_targets set document_ids = array[%L::uuid] where id = %L', '00000000-0000-0000-0000-000000000000', v_pl));
  perform fx.ok(v like 'ERR:%CROSS_ORG_REFERENCE%', 'only the athlete''s own documents can be attached');

  -- Scout profile: off by default, guardian consent required
  perform fx.ok(not exists (select 1 from public.scout_profiles where athlete_id = 'c0000000-0000-0000-0000-0000000000d2'), 'no scout profile by default');
  v := fx.run_as(coach, format('select public.scout_profile_publish(%L, %L, 30, %L, null, %L)::text',
        'c0000000-0000-0000-0000-0000000000d2', '{birth_year,teams}', v_hash, '1'));
  perform fx.ok(v like 'ERR:%GUARDIAN_CONSENT_REQUIRED%', 'a coach cannot publish the scout profile');
  v := fx.run_as(carla, format('select public.scout_profile_publish(%L, %L, 30, %L, null, %L)::text',
        'c0000000-0000-0000-0000-0000000000d2', '{birth_year,teams}', v_hash, '1'));
  perform fx.ok(v like 'ERR:%', 'another family cannot publish it');
  v := fx.run_as(m, format('select public.scout_profile_publish(%L, %L, 400, %L, null, %L)::text',
        'c0000000-0000-0000-0000-0000000000d2', '{birth_year,teams}', v_hash, '1'));
  perform fx.ok(v like 'ERR:%INVALID_EXPIRY%', 'expiry is limited');
  v := fx.run_as(m, format('select public.scout_profile_publish(%L, %L, 30, %L, null, %L)::text',
        'c0000000-0000-0000-0000-0000000000d2', '{birth_year,medical}', v_hash, '1'));
  perform fx.ok(v like 'ERR:%', 'medical can never be a published field');
  v := fx.run_as(m, format('select public.scout_profile_publish(%L, %L, 30, %L, %L, %L)::text',
        'c0000000-0000-0000-0000-0000000000d2', '{birth_year,teams,stats}', v_hash, 'Synthetic headline', '1'));
  perform fx.ok(v like 'OK:%', 'guardian publishes with consent');
  perform fx.ok(exists (select 1 from public.family_consent_events where kind = 'scout_profile' and granted
                         and athlete_id = 'c0000000-0000-0000-0000-0000000000d2'), 'consent recorded with the publication');

  v := fx.run_as(null, format('select public.scout_profile_view(%L)::text', v_hash));
  perform fx.ok(v like 'ERR:%permission denied%', 'the view RPC is server-only (anon cannot call it)');
  v := 'OK:' || public.scout_profile_view(v_hash)::text;
  perform fx.ok(v like 'OK:{%', 'the public page (server) opens the link');
  v_view := substr(v, 4)::jsonb;
  perform fx.ok(v_view->>'name' = 'Synthia T.', 'name shows first name + initial unless chosen otherwise');
  perform fx.ok((v_view->>'birth_year')::int = 2012, 'chosen field shown (birth year)');
  perform fx.ok(not (v_view ? 'position'), 'unchosen field hidden (position)');
  perform fx.ok((v_view->'stats'->>'points')::int = 12, 'stats aggregated');
  perform fx.ok(v_view::text not like '%allergy%' and not (v_view ? 'medical'), 'never medical data');
  v := 'OK:' || coalesce(public.scout_profile_view(repeat('cd', 32))::text, 'none');
  perform fx.ok(v = 'OK:none', 'unknown token shows nothing');
  v := fx.run_as(m, $q$select token_hash from public.scout_profiles limit 1$q$);
  perform fx.ok(v like 'ERR:%permission denied%', 'the token hash is never readable by users');
  v := fx.run_as(m, $q$select to_jsonb(s)::text from public.scout_profiles s limit 1$q$);
  perform fx.ok(v like 'ERR:%', 'select * on scout_profiles is refused (column privileges)');
  v := fx.run_as(m, $q$select count(id)::text from public.scout_profiles$q$);
  perform fx.ok(v = 'OK:1', 'guardian sees publication status');
  v := fx.run_as(ab, $q$select public.scout_profile_revoke('c0000000-0000-0000-0000-0000000000d2')::text$q$);
  perform fx.ok(v like 'ERR:%NOT_FOUND%', 'another club cannot revoke (cross-tenant)');
  v := fx.run_as(m, $q$select public.scout_profile_revoke('c0000000-0000-0000-0000-0000000000d2')::text$q$);
  perform fx.ok(v like 'OK:%', 'guardian revokes');
  v := 'OK:' || coalesce(public.scout_profile_view(v_hash)::text, 'none');
  perform fx.ok(v = 'OK:none', 'revoked link shows nothing');
  v := fx.run_as(m, format('select public.scout_profile_publish(%L, %L, 30, %L, null, %L)::text',
        'c0000000-0000-0000-0000-0000000000d2', '{birth_year}', v_hash, '1'));
  update public.scout_profiles set published_at = now() - interval '40 days', expires_at = now() - interval '1 minute'
   where athlete_id = 'c0000000-0000-0000-0000-0000000000d2';
  v := 'OK:' || coalesce(public.scout_profile_view(v_hash)::text, 'none');
  perform fx.ok(v = 'OK:none', 'expired link shows nothing');
end $$;

-- ===========================================================================
-- G. Erasure keeps a guardian who still belongs to another club
-- ===========================================================================
do $$
declare v text;
  m constant uuid := 'c0000000-0000-0000-0000-000000000001';
  g2 constant uuid := 'c0000000-0000-0000-0000-000000000002';
begin
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$select (public.anonymise_family('c0000000-0000-0000-0000-0000000000a2')->>'profiles_unlinked')$q$);
  perform fx.ok(v = 'OK:1', 'erasure in A unlinks the guardian who also belongs to B (' || v || ')');
  perform fx.ok((select is_active and full_name = 'Synthetic Multi Parent' from public.profiles where id = m), 'that guardian''s login and profile are kept');
  perform fx.ok((select org_id from public.profiles where id = m) = '10000000-0000-0000-0000-000000000002', 'their current club moves to B');
  perform fx.ok(not exists (select 1 from public.org_memberships where profile_id = m and org_id = '00000000-0000-0000-0000-000000000001'), 'membership in A removed');
  perform fx.ok((select not is_active from public.profiles where id = g2), 'the A-only guardian is anonymised');
  perform fx.ok(exists (select 1 from public.invoices where number = 'FAM-SPLIT-1'), 'invoices are retained (legal retention)');
  perform fx.ok(not exists (select 1 from public.scout_profiles where athlete_id = 'c0000000-0000-0000-0000-0000000000d2'), 'scout profile deleted on erasure');
end $$;
