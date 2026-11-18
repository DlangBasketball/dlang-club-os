-- ============================================================================
-- Club operations suite (migration 20250420101600_operations.sql)
--
--   A. Equipment: admin manages the catalogue; coaches read it and check
--      material out / in for themselves or their teams (stock-safe RPCs);
--      guardians see nothing.
--   B. Kit: jersey numbers unique per team (returned kit frees the number);
--      guardians read their own child's kit and send sizes; coaches of the
--      team read; nobody else writes.
--   C. Facilities: allocations / closures readable by staff, rentals by
--      admin + finance only; cross-org and wrong-space references refused.
--   D. Board & committees: committee members + admins only; non-committee
--      staff (coach, finance) and members of another committee are denied;
--      ended memberships lose access.
--   E. Sponsors & donations: admin + finance only; coaches and parents see
--      nothing; external invoice numbering; online donations service-role only.
--   F. Cross-tenant denial for EVERY new table (read, update, delete, insert).
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach …f3 =
-- coach …011, guardian …f4 of athlete …071). Org B …0002 (seed_tenants.sql);
-- its admin and a second org A guardian are created here. SYNTHETIC DATA ONLY.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema fx;
grant usage on schema fx to authenticated, anon, service_role;

create function fx.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

-- Run p_sql as user p (null = anon, 'service' via fx.run_service). 'OK:<first column>' or 'ERR:<message>'.
create function fx.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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

create function fx.run_service(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_res text;
begin
  begin
    execute 'set local role service_role';
    execute p_sql into v_res;
    execute 'reset role';
    return 'OK:' || coalesce(v_res, '<null>');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    execute 'reset role';
    return 'ERR:' || coalesce(v_msg, 'error');
  end;
end $$;
grant execute on all functions in schema fx to authenticated, anon, service_role;

-- ---- Extra fixtures (synthetic) --------------------------------------------
-- Org B admin + an org B venue.
insert into auth.users (id, email) values ('b0000000-0000-0000-0000-0000000000a1', 'admin-b-ops@example.test');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-0000000000a1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000a1', 'admin');
insert into public.venues (id, org_id, name) values
  ('b0000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-000000000002', 'Synthetic B Hall');

-- A second org A guardian (family …062, athletes …072/…073).
insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000a5', 'guardian2-ops@example.test');
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001' where id = 'a0000000-0000-0000-0000-0000000000a5';
insert into public.family_members (family_id, profile_id, relation, is_primary)
  values ('00000000-0000-0000-0000-000000000062', 'a0000000-0000-0000-0000-0000000000a5', 'father', true);

-- Org A season, team (coached by …011), venue + spaces.
insert into public.seasons (id, org_id, name, starts_on, ends_on) values
  ('a0000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000001', 'Synthetic 2026-27', '2026-08-01', '2027-06-30');
insert into public.teams (id, org_id, season_id, name) values
  ('a0000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000b01', 'Synthetic U14'),
  ('a0000000-0000-0000-0000-000000000b03', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000b01', 'Synthetic U16');
insert into public.team_coaches (team_id, coach_id, org_id) values
  ('a0000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001');
insert into public.venues (id, org_id, name) values
  ('a0000000-0000-0000-0000-000000000b04', '00000000-0000-0000-0000-000000000001', 'Synthetic Gym'),
  ('a0000000-0000-0000-0000-000000000b06', '00000000-0000-0000-0000-000000000001', 'Synthetic Hall 2');
insert into public.venue_spaces (id, org_id, venue_id, name) values
  ('a0000000-0000-0000-0000-000000000b05', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000b04', 'Court A'),
  ('a0000000-0000-0000-0000-000000000b07', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000b06', 'Court Z');

-- ===========================================================================
-- A. Equipment
-- ===========================================================================
do $$
declare v text; v_co text;
begin
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.equipment_items (id, org_id, venue_id, name, category, quantity) values
          ('a0000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000b04', 'Size 7 balls', 'balls', 10) returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'admin adds an equipment item (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.equipment_items (org_id, venue_id, name) values
          ('00000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000a2', 'Cross-org item') returning id::text$q$);
  perform fx.ok(v like 'ERR:%CROSS_ORG%', 'item at an org B venue is refused (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.equipment_items$q$);
  perform fx.ok(v = 'OK:1', 'coach reads the equipment catalogue (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.equipment_items$q$);
  perform fx.ok(v = 'OK:0', 'guardian reads no equipment (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$insert into public.equipment_items (org_id, name) values ('00000000-0000-0000-0000-000000000001', 'Coach item') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'coach cannot add catalogue items directly');

  v_co := fx.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$select public.equipment_check_out('a0000000-0000-0000-0000-000000000c01', 4, null, null, current_date + 7, 'camp')::text$q$);
  perform fx.ok(v_co like 'OK:%', 'coach checks out 4 balls for themselves (' || v_co || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$select public.equipment_check_out('a0000000-0000-0000-0000-000000000c01', 2, null, 'a0000000-0000-0000-0000-000000000b02', null, null)::text$q$);
  perform fx.ok(v like 'OK:%', 'coach checks out 2 balls for a team they coach (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$select public.equipment_check_out('a0000000-0000-0000-0000-000000000c01', 1, null, 'a0000000-0000-0000-0000-000000000b03', null, null)::text$q$);
  perform fx.ok(v like 'ERR:%NOT_AUTHORIZED%', 'coach cannot check out for a team they do not coach (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$select public.equipment_check_out('a0000000-0000-0000-0000-000000000c01', 1, '00000000-0000-0000-0000-000000000012', null, null, null)::text$q$);
  perform fx.ok(v like 'ERR:%NOT_AUTHORIZED%', 'coach cannot check out in another coach''s name (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select public.equipment_check_out('a0000000-0000-0000-0000-000000000c01', 5, '00000000-0000-0000-0000-000000000012', null, null, null)::text$q$);
  perform fx.ok(v like 'ERR:%NOT_ENOUGH_STOCK%', 'check-out beyond available stock is refused (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select public.equipment_check_out('a0000000-0000-0000-0000-000000000c01', 4, '00000000-0000-0000-0000-000000000012', null, current_date, null)::text$q$);
  perform fx.ok(v like 'OK:%', 'admin checks out the remaining 4 to another coach (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select public.equipment_check_out('a0000000-0000-0000-0000-000000000c01', 1, null, null, null, null)::text$q$);
  perform fx.ok(v like 'ERR:%NOT_AUTHORIZED%', 'guardian cannot check out equipment (' || v || ')');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.equipment_checkouts$q$);
  perform fx.ok(v = 'OK:2', 'coach sees only the check-outs they hold (own + team) (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.equipment_checkouts$q$);
  perform fx.ok(v = 'OK:3', 'admin sees every check-out (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3',
       format($q$select public.equipment_check_in(%L, 'broken', 'one ball burst')::text$q$, substr(v_co, 4)));
  perform fx.ok(v like 'OK:%', 'coach checks the material back in (' || v || ')');
  perform fx.ok((select condition = 'broken' from public.equipment_items where id = 'a0000000-0000-0000-0000-000000000c01'),
       'a broken return marks the item broken');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3',
       format($q$select public.equipment_check_in(%L, null, null)::text$q$, substr(v_co, 4)));
  perform fx.ok(v like 'ERR:%ALREADY_RETURNED%', 'double check-in is refused (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$with u as (update public.equipment_checkouts set due_on = current_date + 99 returning 1) select count(*)::text from u$q$);
  perform fx.ok(v = 'OK:0', 'coach cannot edit check-outs directly (' || v || ')');
  perform fx.ok(exists (select 1 from public.audit_logs where action = 'equipment.check_out'), 'check-outs are audit-logged');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.equipment_maintenance (org_id, item_id, note) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000c01', 'Re-inflated') returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'admin logs a maintenance note (' || v || ')');
end $$;

-- ===========================================================================
-- B. Kit
-- ===========================================================================
do $$
declare v text;
begin
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.kit_assignments (id, org_id, season_id, team_id, athlete_id, jersey_number, deposit_amount, currency) values
          ('a0000000-0000-0000-0000-000000000d01', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000b01',
           'a0000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-000000000071', 7, 50, 'CHF') returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'admin assigns kit #7 to a player (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.kit_assignments (id, org_id, team_id, athlete_id, jersey_number) values
          ('a0000000-0000-0000-0000-000000000d02', '00000000-0000-0000-0000-000000000001',
           'a0000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-000000000072', 7) returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'a second #7 in the same team is refused (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.kit_assignments (id, org_id, team_id, athlete_id, jersey_number) values
          ('a0000000-0000-0000-0000-000000000d03', '00000000-0000-0000-0000-000000000001',
           'a0000000-0000-0000-0000-000000000b03', '00000000-0000-0000-0000-000000000072', 7) returning id::text$q$);
  perform fx.ok(v like 'OK:%', '#7 is free in another team (' || v || ')');
  update public.kit_assignments set status = 'returned' where id = 'a0000000-0000-0000-0000-000000000d01';
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.kit_assignments (id, org_id, team_id, athlete_id, jersey_number) values
          ('a0000000-0000-0000-0000-000000000d02', '00000000-0000-0000-0000-000000000001',
           'a0000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-000000000072', 7) returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'returned kit frees the number (' || v || ')');
  update public.kit_assignments set jersey_number = 8, status = 'sizes_requested' where id = 'a0000000-0000-0000-0000-000000000d01';

  v := fx.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.kit_assignments$q$);
  perform fx.ok(v = 'OK:1', 'guardian reads only their own child''s kit (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select public.kit_submit_sizes('a0000000-0000-0000-0000-000000000d01', 'YL', 'YM', null)::text$q$);
  perform fx.ok(v like 'OK:%', 'guardian sends sizes (' || v || ')');
  perform fx.ok((select status = 'sizes_submitted' and jersey_size = 'YL' from public.kit_assignments where id = 'a0000000-0000-0000-0000-000000000d01'),
       'sizes are stored and the status moves to submitted');
  v := fx.run_as('a0000000-0000-0000-0000-0000000000a5',
       $q$select public.kit_submit_sizes('a0000000-0000-0000-0000-000000000d01', 'XL', 'XL', null)::text$q$);
  perform fx.ok(v like 'ERR:%NOT_AUTHORIZED%', 'another family cannot send sizes for this child (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select public.kit_submit_sizes('a0000000-0000-0000-0000-000000000d01', '<script>', 'M', null)::text$q$);
  perform fx.ok(v like 'ERR:%INVALID_SIZE%', 'size values are validated (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$with u as (update public.kit_assignments set jersey_number = 99 returning 1) select count(*)::text from u$q$);
  perform fx.ok(v = 'OK:0', 'guardian cannot edit kit rows directly (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.kit_assignments$q$);
  perform fx.ok(v = 'OK:2', 'coach reads the kit of the team they coach only (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$with u as (update public.kit_assignments set status = 'handed_out' returning 1) select count(*)::text from u$q$);
  perform fx.ok(v = 'OK:0', 'coach cannot change kit status (' || v || ')');
  update public.kit_assignments set status = 'handed_out' where id = 'a0000000-0000-0000-0000-000000000d01';
  v := fx.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select public.kit_submit_sizes('a0000000-0000-0000-0000-000000000d01', 'L', 'L', null)::text$q$);
  perform fx.ok(v like 'ERR:%KIT_LOCKED%', 'sizes are locked once kit is handed out (' || v || ')');
end $$;

-- ===========================================================================
-- C. Facilities
-- ===========================================================================
do $$
declare v text;
begin
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.facility_allocations (id, org_id, venue_id, venue_space_id, team_id, weekday, start_time, end_time, valid_from) values
          ('a0000000-0000-0000-0000-000000000e01', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000b04',
           'a0000000-0000-0000-0000-000000000b05', 'a0000000-0000-0000-0000-000000000b02', 2, '17:00', '18:30', '2026-08-15') returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'admin allocates weekly court time to a team (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.facility_allocations (org_id, venue_id, venue_space_id, team_id, weekday, start_time, end_time, valid_from) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000b04',
           'a0000000-0000-0000-0000-000000000b07', 'a0000000-0000-0000-0000-000000000b02', 2, '17:00', '18:30', '2026-08-15') returning id::text$q$);
  perform fx.ok(v like 'ERR:%SPACE_NOT_IN_VENUE%', 'a space of another venue is refused (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.facility_allocations (org_id, venue_id, team_id, weekday, start_time, end_time, valid_from) values
          ('00000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000b02', 3, '17:00', '18:00', '2026-08-15') returning id::text$q$);
  perform fx.ok(v like 'ERR:%CROSS_ORG%', 'allocation at an org B venue is refused (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.facility_allocations$q$);
  perform fx.ok(v = 'OK:1', 'coach reads court allocations (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.facility_allocations$q$);
  perform fx.ok(v = 'OK:0', 'guardian reads no allocations (' || v || ')');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$insert into public.ops_customers (id, org_id, name, email) values
          ('a0000000-0000-0000-0000-000000000e02', '00000000-0000-0000-0000-000000000001', 'Synthetic Volley Club', 'office@volley.example.test') returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'finance adds an external customer (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.facility_rentals (id, org_id, venue_id, customer_id, renter_name, starts_at, ends_at, price, currency) values
          ('a0000000-0000-0000-0000-000000000e03', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000b04',
           'a0000000-0000-0000-0000-000000000e02', 'Synthetic Volley Club', '2026-09-05 10:00+02', '2026-09-05 12:00+02', 120, 'CHF') returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'admin records an external rental (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.facility_rentals$q$);
  perform fx.ok(v = 'OK:0', 'coach cannot see rentals (renter contact + price) (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f2', $q$select count(*)::text from public.facility_rentals$q$);
  perform fx.ok(v = 'OK:1', 'finance reads rentals (' || v || ')');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.venue_closures (id, org_id, venue_id, starts_on, ends_on, reason) values
          ('a0000000-0000-0000-0000-000000000e04', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000b04',
           '2026-12-21', '2027-01-04', 'holiday') returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'admin closes a venue for the holidays (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$insert into public.venue_closures (org_id, venue_id, starts_on, ends_on) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000b04', '2027-02-01', '2027-02-02') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'coach cannot close a venue');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.venue_closures$q$);
  perform fx.ok(v = 'OK:1', 'coach sees venue closures (' || v || ')');
end $$;

-- ===========================================================================
-- D. Board & committees
-- ===========================================================================
do $$
declare v text;
begin
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.committees (id, org_id, name, kind) values
          ('a0000000-0000-0000-0000-000000000f01', '00000000-0000-0000-0000-000000000001', 'Board', 'board'),
          ('a0000000-0000-0000-0000-000000000f02', '00000000-0000-0000-0000-000000000001', 'Events committee', 'events') returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'admin creates committees (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.committee_members (id, org_id, committee_id, profile_id, display_name, role) values
          ('a0000000-0000-0000-0000-000000000f03', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000f01',
           '00000000-0000-0000-0000-0000000000f4', 'Synthetic Secretary', 'secretary') returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'admin adds a parent as board secretary (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.committee_members (org_id, committee_id, profile_id, display_name) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000f01',
           'b0000000-0000-0000-0000-0000000000a1', 'Org B person') returning id::text$q$);
  perform fx.ok(v like 'ERR:%CROSS_ORG%', 'an org B profile cannot join an org A committee (' || v || ')');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.committees$q$);
  perform fx.ok(v = 'OK:1', 'member reads only their own committee (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$insert into public.committee_meetings (id, org_id, committee_id, title, kind, starts_at, agenda) values
          ('a0000000-0000-0000-0000-000000000f04', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000f01',
           'Annual general assembly', 'agm', '2027-03-15 19:00+01', '[{"title":"Accounts"}]') returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'member schedules an AGM (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$insert into public.committee_votes (org_id, meeting_id, motion, votes_for, votes_against, abstentions) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000f04', 'Approve the accounts', 31, 2, 1) returning result$q$);
  perform fx.ok(v = 'OK:carried', 'member records a vote result (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$insert into public.committee_meeting_attendees (org_id, meeting_id, member_id, display_name) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000f04', 'a0000000-0000-0000-0000-000000000f03', 'Synthetic Secretary') returning status$q$);
  perform fx.ok(v = 'OK:present', 'member records attendance (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$insert into public.committee_decisions (org_id, committee_id, meeting_id, title, owner_member_id, due_on) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000f01', 'a0000000-0000-0000-0000-000000000f04',
           'Renew hall contract', 'a0000000-0000-0000-0000-000000000f03', '2027-04-30') returning status$q$);
  perform fx.ok(v = 'OK:open', 'member logs a decision with an owner and due date (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$insert into public.committee_documents (org_id, committee_id, meeting_id, title, url) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000f01', 'a0000000-0000-0000-0000-000000000f04',
           'Accounts 2026', 'https://files.example.test/accounts.pdf') returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'member attaches a document link (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$insert into public.committee_decisions (org_id, committee_id, meeting_id, title) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000f02', 'a0000000-0000-0000-0000-000000000f04', 'Wrong committee') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'member cannot write into another committee (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$insert into public.committee_members (org_id, committee_id, display_name) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000f01', 'Self-added') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'members cannot change the membership');

  -- Non-committee staff are denied.
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$select (select count(*) from public.committees) + (select count(*) from public.committee_meetings)
               + (select count(*) from public.committee_votes) + (select count(*) from public.committee_decisions)
               + (select count(*) from public.committee_members) + (select count(*) from public.committee_documents)
               + (select count(*) from public.committee_meeting_attendees)$q$);
  perform fx.ok(v = 'OK:0', 'coach outside the committee sees nothing of the board (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$select (select count(*) from public.committees) + (select count(*) from public.committee_meetings) + (select count(*) from public.committee_decisions)$q$);
  perform fx.ok(v = 'OK:0', 'finance staff outside the committee see nothing (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$insert into public.committee_meetings (org_id, committee_id, title, starts_at) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000f01', 'Coach meeting', now()) returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'coach outside the committee cannot add meetings');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$with u as (update public.committee_meetings set minutes = 'tampered' returning 1) select count(*)::text from u$q$);
  perform fx.ok(v = 'OK:0', 'coach outside the committee cannot edit minutes (' || v || ')');
  v := fx.run_as('a0000000-0000-0000-0000-0000000000a5', $q$select count(*)::text from public.committee_meetings$q$);
  perform fx.ok(v = 'OK:0', 'a parent not on the board sees no meetings (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.committee_meetings$q$);
  perform fx.ok(v = 'OK:1', 'admin reads every committee meeting (' || v || ')');

  -- Ended membership loses access.
  update public.committee_members set starts_on = current_date - 400, ends_on = current_date - 1 where id = 'a0000000-0000-0000-0000-000000000f03';
  v := fx.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.committee_meetings$q$);
  perform fx.ok(v = 'OK:0', 'a former member loses access (' || v || ')');
  update public.committee_members set ends_on = null where id = 'a0000000-0000-0000-0000-000000000f03';
end $$;

-- ===========================================================================
-- E. Sponsors & donations
-- ===========================================================================
do $$
declare v text;
begin
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.sponsors (id, org_id, customer_id, tier, amount, currency, contract_start, contract_end) values
          ('a0000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000e02',
           'gold', 5000, 'CHF', '2026-08-01', '2027-07-31') returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'admin records a sponsor (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.sponsor_deliverables (org_id, sponsor_id, kind, title, due_on) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000a01', 'jersey_logo', 'Logo on jerseys', '2026-09-01') returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'admin adds a sponsor deliverable (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$insert into public.fundraising_campaigns (id, org_id, slug, title, goal_amount, currency, status, is_public) values
          ('a0000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-000000000001', 'new-hoops', 'New hoops', 8000, 'CHF', 'active', true) returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'finance creates a fundraising campaign (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$insert into public.donations (org_id, campaign_id, donor_id, amount, currency, is_anonymous) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000a02', 'a0000000-0000-0000-0000-000000000e02', 250, 'CHF', true) returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'finance records a donation (' || v || ')');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$select (select count(*) from public.sponsors) + (select count(*) from public.sponsor_deliverables)
               + (select count(*) from public.donations) + (select count(*) from public.fundraising_campaigns)
               + (select count(*) from public.ops_customers) + (select count(*) from public.ops_invoices)$q$);
  perform fx.ok(v = 'OK:0', 'coach sees no sponsor / donor data (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select (select count(*) from public.sponsors) + (select count(*) from public.sponsor_deliverables)
               + (select count(*) from public.donations) + (select count(*) from public.fundraising_campaigns)
               + (select count(*) from public.ops_customers) + (select count(*) from public.ops_invoices)$q$);
  perform fx.ok(v = 'OK:0', 'parent sees no sponsor / donor data (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$insert into public.donations (org_id, amount, currency) values ('00000000-0000-0000-0000-000000000001', 10, 'CHF') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'coach cannot record donations');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$select public.ops_create_invoice('a0000000-0000-0000-0000-000000000e02', 'sponsor', 'a0000000-0000-0000-0000-000000000a01',
          'Gold package', 'chf', '2026-10-01', '[{"description":"Gold package 2026-27","quantity":1,"unit_price":5000}]')->>'number'$q$);
  perform fx.ok(v = 'OK:EXT-' || extract(year from current_date)::int || '-0001', 'finance invoices the sponsor with a numbered external invoice (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select (public.ops_create_invoice('a0000000-0000-0000-0000-000000000e02', 'rental', 'a0000000-0000-0000-0000-000000000e03',
          null, 'CHF', null, '[{"description":"Court rental","quantity":2,"unit_price":60}]')->>'total')$q$);
  perform fx.ok(v = 'OK:120.00', 'rental invoice totals its lines (' || v || ')');
  perform fx.ok((select count(*) = 2 from public.ops_invoices where org_id = '00000000-0000-0000-0000-000000000001'
                 and number like 'EXT-%-000_'), 'invoice numbers are sequential per org');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$select public.ops_create_invoice('a0000000-0000-0000-0000-000000000e02', 'other', null, null, 'CHF', null, '[{"description":"x","unit_price":1}]')::text$q$);
  perform fx.ok(v like 'ERR:%NOT_AUTHORIZED%', 'coach cannot issue external invoices (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$with d as (delete from public.ops_invoices returning 1) select count(*)::text from d$q$);
  perform fx.ok(v = 'OK:0', 'issued external invoices are never hard-deleted (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.ops_counters$q$);
  perform fx.ok(v = 'OK:0', 'invoice counters are not readable directly (' || v || ')');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select public.record_online_donation('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000a02',
          'cs_test_1', 40, 'CHF', 'Synthetic Donor', 'donor@example.test', false)::text$q$);
  perform fx.ok(v like 'ERR:%', 'signed-in users cannot record online donations (' || v || ')');
  v := fx.run_service($q$select public.record_online_donation('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000a02',
          'cs_test_1', 40, 'chf', 'Synthetic Donor', 'Donor@Example.test', false)::text$q$);
  perform fx.ok(v like 'OK:%', 'the webhook (service role) records an online donation (' || v || ')');
  v := fx.run_service($q$select public.record_online_donation('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000a02',
          'cs_test_1', 40, 'CHF', 'Synthetic Donor', 'donor@example.test', false)::text$q$);
  perform fx.ok((select count(*) = 1 from public.donations where stripe_session_id = 'cs_test_1'), 'online donations are idempotent per session');
  perform fx.ok((select count(*) = 1 from public.ops_customers where lower(email) = 'donor@example.test'), 'the donor record is created once, by email');
  v := fx.run_service($q$select public.record_online_donation('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000a02',
          'cs_test_2', 40, 'CHF', null, null, true)::text$q$);
  perform fx.ok(v like 'ERR:%CAMPAIGN_NOT_FOUND%', 'a donation cannot land on another org''s campaign (' || v || ')');
end $$;

-- ===========================================================================
-- F. Cross-tenant denial for every new table
-- ===========================================================================
do $$
declare
  v text;
  t text;
begin
  foreach t in array array[
    'equipment_items', 'equipment_checkouts', 'equipment_maintenance', 'kit_assignments', 'facility_allocations',
    'ops_customers', 'ops_invoices', 'ops_invoice_lines', 'facility_rentals', 'venue_closures', 'committees',
    'committee_members', 'committee_meetings', 'committee_meeting_attendees', 'committee_documents',
    'committee_decisions', 'committee_votes', 'sponsors', 'sponsor_deliverables', 'fundraising_campaigns', 'donations'
  ] loop
    execute format('select (select count(*) from public.%I where org_id = %L) > 0', t, '00000000-0000-0000-0000-000000000001') into v;
    perform fx.ok(v = 'true', 'fixture rows exist in org A for ' || t);
    v := fx.run_as('b0000000-0000-0000-0000-0000000000a1',
         format('select count(*)::text from public.%I where org_id = %L', t, '00000000-0000-0000-0000-000000000001'));
    perform fx.ok(v = 'OK:0', 'org B admin cannot read org A ' || t || ' (' || v || ')');
    v := fx.run_as('b0000000-0000-0000-0000-0000000000a1',
         format('with u as (update public.%I set updated_at = now() where org_id = %L returning 1) select count(*)::text from u',
                t, '00000000-0000-0000-0000-000000000001'));
    perform fx.ok(v = 'OK:0' or v like 'ERR:%', 'org B admin cannot update org A ' || t || ' (' || v || ')');
    v := fx.run_as('b0000000-0000-0000-0000-0000000000a1',
         format('with d as (delete from public.%I where org_id = %L returning 1) select count(*)::text from d',
                t, '00000000-0000-0000-0000-000000000001'));
    perform fx.ok(v = 'OK:0' or v like 'ERR:%', 'org B admin cannot delete org A ' || t || ' (' || v || ')');
    v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
         format('select count(*)::text from public.%I where org_id = %L', t, '10000000-0000-0000-0000-000000000002'));
    perform fx.ok(v = 'OK:0', 'org A admin cannot read org B ' || t || ' (' || v || ')');
  end loop;

  -- Inserts into org A from org B are refused (one per table family).
  v := fx.run_as('b0000000-0000-0000-0000-0000000000a1',
       $q$insert into public.equipment_items (org_id, name) values ('00000000-0000-0000-0000-000000000001', 'Planted') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'org B admin cannot add equipment in org A');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000a1',
       $q$insert into public.equipment_checkouts (org_id, item_id, quantity, coach_id) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000c01', 1, '00000000-0000-0000-0000-000000000011') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'org B admin cannot add a check-out in org A');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000a1',
       $q$select public.equipment_check_out('a0000000-0000-0000-0000-000000000c01', 1, '00000000-0000-0000-0000-000000000011', null, null, null)::text$q$);
  perform fx.ok(v like 'ERR:%ITEM_NOT_FOUND%', 'org B admin cannot check out org A equipment (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000a1',
       $q$insert into public.equipment_maintenance (org_id, item_id, note) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000c01', 'x') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'org B admin cannot add maintenance in org A');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000a1',
       $q$insert into public.kit_assignments (org_id, team_id, athlete_id) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000b03', '00000000-0000-0000-0000-000000000073') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'org B admin cannot add kit in org A');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000a1',
       $q$select public.kit_submit_sizes('a0000000-0000-0000-0000-000000000d02', 'M', 'M', null)::text$q$);
  perform fx.ok(v like 'ERR:%NOT_AUTHORIZED%', 'org B admin cannot send kit sizes in org A (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000a1',
       $q$insert into public.facility_allocations (org_id, venue_id, label, weekday, start_time, end_time, valid_from) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000b04', 'x', 1, '10:00', '11:00', '2026-09-01') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'org B admin cannot allocate org A courts');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000a1',
       $q$insert into public.facility_rentals (org_id, venue_id, renter_name, starts_at, ends_at, currency) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000b04', 'x', now(), now() + interval '1 hour', 'CHF') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'org B admin cannot add an org A rental');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000a1',
       $q$insert into public.venue_closures (org_id, venue_id, starts_on, ends_on) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000b04', '2027-01-01', '2027-01-02') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'org B admin cannot close an org A venue');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000a1',
       $q$insert into public.committees (org_id, name) values ('00000000-0000-0000-0000-000000000001', 'Planted') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'org B admin cannot create an org A committee');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000a1',
       $q$insert into public.committee_members (org_id, committee_id, display_name) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000f01', 'Planted') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'org B admin cannot add org A committee members');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000a1',
       $q$insert into public.committee_meetings (org_id, committee_id, title, starts_at) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000f01', 'Planted', now()) returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'org B admin cannot add org A meetings');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000a1',
       $q$insert into public.committee_meeting_attendees (org_id, meeting_id, display_name) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000f04', 'Planted') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'org B admin cannot add org A attendees');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000a1',
       $q$insert into public.committee_documents (org_id, committee_id, title, url) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000f01', 'Planted', 'https://x.example.test') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'org B admin cannot add org A committee documents');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000a1',
       $q$insert into public.committee_decisions (org_id, committee_id, title) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000f01', 'Planted') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'org B admin cannot add org A decisions');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000a1',
       $q$insert into public.committee_votes (org_id, meeting_id, motion) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000f04', 'Planted') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'org B admin cannot add org A votes');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000a1',
       $q$insert into public.ops_customers (org_id, name) values ('00000000-0000-0000-0000-000000000001', 'Planted') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'org B admin cannot add org A customers');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000a1',
       $q$select public.ops_create_invoice('a0000000-0000-0000-0000-000000000e02', 'other', null, null, 'CHF', null, '[{"description":"x","unit_price":1}]')::text$q$);
  perform fx.ok(v like 'ERR:%CUSTOMER_NOT_FOUND%', 'org B admin cannot invoice an org A customer (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000a1',
       $q$insert into public.ops_invoices (org_id, customer_id, number, currency) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000e02', 'X-1', 'CHF') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'org B admin cannot add org A invoices');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000a1',
       $q$insert into public.ops_invoice_lines (org_id, invoice_id, description, unit_price, amount)
          select '00000000-0000-0000-0000-000000000001', id, 'x', 1, 1 from public.ops_invoices limit 1 returning id::text$q$);
  perform fx.ok(v like 'ERR:%' or v = 'OK:<null>', 'org B admin cannot add org A invoice lines (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000a1',
       $q$insert into public.sponsors (org_id, customer_id, currency) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000e02', 'CHF') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'org B admin cannot add org A sponsors');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000a1',
       $q$insert into public.sponsor_deliverables (org_id, sponsor_id, title) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000a01', 'Planted') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'org B admin cannot add org A deliverables');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000a1',
       $q$insert into public.fundraising_campaigns (org_id, slug, title, goal_amount, currency) values
          ('00000000-0000-0000-0000-000000000001', 'planted', 'Planted', 1, 'CHF') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'org B admin cannot add org A campaigns');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000a1',
       $q$insert into public.donations (org_id, amount, currency) values ('00000000-0000-0000-0000-000000000001', 1, 'CHF') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'org B admin cannot add org A donations');
  -- And an org B row cannot point at org A rows.
  v := fx.run_as('b0000000-0000-0000-0000-0000000000a1',
       $q$insert into public.donations (org_id, campaign_id, amount, currency) values
          ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000a02', 1, 'USD') returning id::text$q$);
  perform fx.ok(v like 'ERR:%CROSS_ORG%', 'org B donation cannot reference an org A campaign (' || v || ')');
end $$;
