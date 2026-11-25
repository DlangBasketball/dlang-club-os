-- ============================================================================
-- Federation licences suite (migration 20250420102300_federation_licences.sql)
--
--   A. Column checks: length limits, blank number, negative fee, postal code.
--   B. Unique licence number per club; another club may reuse the number.
--   C. Cross-tenant denial through the existing policies: org B admin can
--      neither read nor change org A licence / address columns.
--   D. Visibility: finance reads the fee, a coach reads the licence of an
--      athlete he coaches only, a guardian reads her own child's licence only.
--   E. Licence fields are club-managed: guardians cannot set or change them
--      (other athlete columns stay editable for them).
--   F. Audit trail + erasure clears licence and postal address.
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach …f3 who
-- leads program …043 = athlete …072, guardian …f4 of family …061 / athlete
-- …071). Org B …0002 from seed_tenants.sql; its admin and records are created
-- here. SYNTHETIC DATA ONLY. Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema lic;
grant usage on schema lic to authenticated, anon, service_role;

create function lic.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

-- Run p_sql as user p (null = service_role). Returns 'OK:<first column>' or 'ERR:<message>'.
create function lic.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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
grant execute on all functions in schema lic to authenticated, anon, service_role;

-- Org B: admin, family, athlete (synthetic).
insert into auth.users (id, email) values ('b0000000-0000-0000-0000-0000000001c1', 'lic-admin-b@example.test');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002'
 where id = 'b0000000-0000-0000-0000-0000000001c1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000001c1', 'admin');
insert into public.families (id, org_id, name) values
  ('b0000000-0000-0000-0000-0000000001d1', '10000000-0000-0000-0000-000000000002', 'Synthetic B family');
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob) values
  ('b0000000-0000-0000-0000-0000000001e1', '10000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-0000000001d1', 'Test', 'Bplayer', '2015-01-01');

-- ===========================================================================
-- A. Column checks (admin of org A)
-- ===========================================================================
do $$
declare v text;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
begin
  v := lic.run_as(admin_a, $q$update public.athletes set licence_fee = -1 where id = '00000000-0000-0000-0000-000000000071' returning id$q$);
  perform lic.ok(v like 'ERR:%', 'negative licence fee is refused');
  v := lic.run_as(admin_a, format($q$update public.athletes set licence_number = %L where id = '00000000-0000-0000-0000-000000000071' returning id$q$, repeat('9', 41)));
  perform lic.ok(v like 'ERR:%', 'licence number longer than 40 characters is refused');
  v := lic.run_as(admin_a, $q$update public.athletes set licence_number = '   ' where id = '00000000-0000-0000-0000-000000000071' returning id$q$);
  perform lic.ok(v like 'ERR:%', 'blank licence number is refused');
  v := lic.run_as(admin_a, format($q$update public.athletes set licence_category = %L where id = '00000000-0000-0000-0000-000000000071' returning id$q$, repeat('c', 41)));
  perform lic.ok(v like 'ERR:%', 'licence category longer than 40 characters is refused');
  v := lic.run_as(admin_a, format($q$update public.athletes set licence_federation = %L where id = '00000000-0000-0000-0000-000000000071' returning id$q$, repeat('f', 81)));
  perform lic.ok(v like 'ERR:%', 'federation longer than 80 characters is refused');
  v := lic.run_as(admin_a, format($q$update public.families set postal_code = %L where id = '00000000-0000-0000-0000-000000000061' returning id$q$, repeat('1', 13)));
  perform lic.ok(v like 'ERR:%', 'postal code longer than 12 characters is refused');
  v := lic.run_as(admin_a, format($q$update public.families set city = %L where id = '00000000-0000-0000-0000-000000000061' returning id$q$, repeat('x', 81)));
  perform lic.ok(v like 'ERR:%', 'city longer than 80 characters is refused');
end $$;

-- ===========================================================================
-- B. Unique licence number per club
-- ===========================================================================
do $$
declare v text;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
  admin_b uuid := 'b0000000-0000-0000-0000-0000000001c1';
begin
  v := lic.run_as(admin_a, $q$update public.athletes
         set licence_number = 'SYN-1001', licence_category = 'U12', licence_issued_on = '2026-09-01',
             licence_fee = 45.50, licence_federation = 'Synthetic Federation'
       where id = '00000000-0000-0000-0000-000000000071' returning licence_number$q$);
  perform lic.ok(v = 'OK:SYN-1001', 'org A admin records a licence (' || v || ')');
  v := lic.run_as(admin_a, $q$update public.athletes set licence_number = 'SYN-1002', licence_category = 'U14'
       where id = '00000000-0000-0000-0000-000000000072' returning licence_number$q$);
  perform lic.ok(v = 'OK:SYN-1002', 'org A admin records a second licence (' || v || ')');
  v := lic.run_as(admin_a, $q$update public.athletes set licence_number = 'SYN-1001'
       where id = '00000000-0000-0000-0000-000000000073' returning id$q$);
  perform lic.ok(v like 'ERR:%duplicate%', 'the same licence number twice in one club is refused (' || v || ')');
  v := lic.run_as(admin_a, $q$update public.athletes set licence_number = null
       where id = '00000000-0000-0000-0000-000000000073' returning coalesce(licence_number, 'none')$q$);
  perform lic.ok(v = 'OK:none', 'several players without a licence are fine (' || v || ')');
  v := lic.run_as(admin_b, $q$update public.athletes set licence_number = 'SYN-1001'
       where id = 'b0000000-0000-0000-0000-0000000001e1' returning licence_number$q$);
  perform lic.ok(v = 'OK:SYN-1001', 'org B may reuse the same licence number (' || v || ')');
end $$;

-- ===========================================================================
-- C. Cross-tenant denial
-- ===========================================================================
do $$
declare v text;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
  admin_b uuid := 'b0000000-0000-0000-0000-0000000001c1';
begin
  v := lic.run_as(admin_a, $q$update public.families set address = 'Synthetic street 1', postal_code = '9999', city = 'Synthville'
       where id = '00000000-0000-0000-0000-000000000061' returning postal_code || ' ' || city$q$);
  perform lic.ok(v = 'OK:9999 Synthville', 'org A admin sets postal code and city (' || v || ')');

  v := lic.run_as(admin_b, $q$select count(*)::text from public.athletes where licence_number = 'SYN-1001'$q$);
  perform lic.ok(v = 'OK:1', 'org B admin sees only its own SYN-1001 licence (' || v || ')');
  v := lic.run_as(admin_b, $q$select licence_number from public.athletes where id = '00000000-0000-0000-0000-000000000071'$q$);
  perform lic.ok(v = 'OK:<null>', 'org B admin cannot read an org A licence (' || v || ')');
  v := lic.run_as(admin_b, $q$select count(*)::text from public.athletes where licence_fee is not null$q$);
  perform lic.ok(v = 'OK:0', 'org B admin cannot read org A licence fees (' || v || ')');
  v := lic.run_as(admin_b, $q$select city from public.families where id = '00000000-0000-0000-0000-000000000061'$q$);
  perform lic.ok(v = 'OK:<null>', 'org B admin cannot read an org A family city (' || v || ')');
  v := lic.run_as(admin_b, $q$with u as (update public.athletes set licence_number = 'HIJACK'
       where id = '00000000-0000-0000-0000-000000000071' returning 1) select count(*)::text from u$q$);
  perform lic.ok(v in ('OK:0') or v like 'ERR:%', 'org B admin cannot change an org A licence (' || v || ')');
  v := lic.run_as(admin_b, $q$with u as (update public.families set postal_code = '0000'
       where id = '00000000-0000-0000-0000-000000000061' returning 1) select count(*)::text from u$q$);
  perform lic.ok(v in ('OK:0') or v like 'ERR:%', 'org B admin cannot change an org A postal code (' || v || ')');
  v := lic.run_as(admin_b, $q$insert into public.athletes (org_id, family_id, first_name, last_name, dob, licence_number)
       values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000061', 'X', 'Y', '2015-01-01', 'PLANT') returning id$q$);
  perform lic.ok(v like 'ERR:%', 'org B admin cannot plant a licensed athlete in org A');

  perform lic.ok((select licence_number = 'SYN-1001' from public.athletes where id = '00000000-0000-0000-0000-000000000071'),
                 'org A licence unchanged after org B attempts');
  perform lic.ok((select postal_code = '9999' from public.families where id = '00000000-0000-0000-0000-000000000061'),
                 'org A postal code unchanged after org B attempts');
end $$;

-- ===========================================================================
-- D. Visibility inside the club (existing row policies)
-- ===========================================================================
do $$
declare v text;
  finance_a uuid := '00000000-0000-0000-0000-0000000000f2';
  coach_a   uuid := '00000000-0000-0000-0000-0000000000f3';
  guardian  uuid := '00000000-0000-0000-0000-0000000000f4';
begin
  -- 20250420106300: finance reads billing columns through billing_athletes, never the athletes table.
  v := lic.run_as(finance_a, $q$select licence_fee::text from public.billing_athletes where id = '00000000-0000-0000-0000-000000000071'$q$);
  perform lic.ok(v = 'OK:45.50', 'finance reads the licence fee (' || v || ')');
  v := lic.run_as(finance_a, $q$select licence_number from public.athletes where id = '00000000-0000-0000-0000-000000000071'$q$);
  perform lic.ok(v = 'OK:<null>', 'finance cannot read the athlete record itself (' || v || ')');

  v := lic.run_as(coach_a, $q$select licence_number || '/' || licence_category from public.athletes where id = '00000000-0000-0000-0000-000000000072'$q$);
  perform lic.ok(v = 'OK:SYN-1002/U14', 'coach reads the licence of an athlete he coaches (' || v || ')');
  v := lic.run_as(coach_a, $q$select licence_number from public.athletes where id = '00000000-0000-0000-0000-000000000071'$q$);
  perform lic.ok(v = 'OK:<null>', 'coach cannot read the licence of an athlete he does not coach (' || v || ')');

  v := lic.run_as(guardian, $q$select licence_number || '/' || licence_category || '/' || licence_issued_on from public.athletes where id = '00000000-0000-0000-0000-000000000071'$q$);
  perform lic.ok(v = 'OK:SYN-1001/U12/2026-09-01', 'guardian reads her own child''s licence (' || v || ')');
  v := lic.run_as(guardian, $q$select licence_number from public.athletes where id = '00000000-0000-0000-0000-000000000072'$q$);
  perform lic.ok(v = 'OK:<null>', 'guardian cannot read another family''s licence (' || v || ')');
  v := lic.run_as(guardian, $q$select postal_code || ' ' || city from public.families where id = '00000000-0000-0000-0000-000000000061'$q$);
  perform lic.ok(v = 'OK:9999 Synthville', 'guardian reads her own family''s postal address (' || v || ')');
  v := lic.run_as(guardian, $q$select city from public.families where id = '00000000-0000-0000-0000-000000000062'$q$);
  perform lic.ok(v = 'OK:<null>', 'guardian cannot read another family''s city (' || v || ')');
end $$;

-- ===========================================================================
-- E. Licence fields are club-managed
-- ===========================================================================
do $$
declare v text;
  guardian uuid := '00000000-0000-0000-0000-0000000000f4';
  finance_a uuid := '00000000-0000-0000-0000-0000000000f2';
begin
  v := lic.run_as(guardian, $q$update public.athletes set licence_number = 'SELF-1'
       where id = '00000000-0000-0000-0000-000000000071' returning id$q$);
  perform lic.ok(v like 'ERR:%LICENCE_STAFF_ONLY%', 'guardian cannot change her child''s licence number (' || v || ')');
  v := lic.run_as(guardian, $q$update public.athletes set licence_fee = 0
       where id = '00000000-0000-0000-0000-000000000071' returning id$q$);
  perform lic.ok(v like 'ERR:%LICENCE_STAFF_ONLY%', 'guardian cannot change the licence fee (' || v || ')');
  v := lic.run_as(guardian, $q$update public.athletes set school = 'Synthetic school'
       where id = '00000000-0000-0000-0000-000000000071' returning school$q$);
  perform lic.ok(v = 'OK:Synthetic school', 'guardian still edits other child fields (' || v || ')');
  v := lic.run_as(guardian, $q$insert into public.athletes (org_id, family_id, first_name, last_name, dob, licence_number)
       values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000061', 'New', 'Sibling', '2018-01-01', 'SELF-2') returning id$q$);
  perform lic.ok(v like 'ERR:%', 'guardian cannot add a child with a licence (' || v || ')');
  v := lic.run_as(guardian, $q$update public.families set postal_code = '8888', city = 'Newtown'
       where id = '00000000-0000-0000-0000-000000000061' returning postal_code$q$);
  perform lic.ok(v = 'OK:8888', 'guardian updates her own family postal address (' || v || ')');
  v := lic.run_as(finance_a, $q$update public.athletes set licence_fee = 50
       where id = '00000000-0000-0000-0000-000000000071' returning licence_fee::text$q$);
  -- 20250420106300: licence data is edited by admins (updateAthleteLicence is admin-only); finance has no table write.
  perform lic.ok(v = 'OK:<null>', 'finance no longer writes the athletes table (licence fee unchanged) (' || v || ')');
  perform lic.ok((select licence_number = 'SYN-1001' from public.athletes where id = '00000000-0000-0000-0000-000000000071'),
                 'licence number unchanged after guardian attempts');
end $$;

-- ===========================================================================
-- F. Audit + erasure
-- ===========================================================================
do $$
declare v text; v_audit int;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
begin
  select count(*) into v_audit from public.audit_logs
   where target_table = 'athletes' and target_id = '00000000-0000-0000-0000-000000000071'
     and new_data ->> 'licence_number' = 'SYN-1001';
  perform lic.ok(v_audit >= 1, 'licence edits are written to audit_logs (' || v_audit || ')');

  v := lic.run_as(admin_a, $q$select (public.anonymise_family('00000000-0000-0000-0000-000000000061') ->> 'athletes_anonymised')$q$);
  perform lic.ok(v = 'OK:1', 'org A admin anonymises family 061 (' || v || ')');
  perform lic.ok((select licence_number is null and licence_category is null and licence_issued_on is null
                         and licence_fee is null and licence_federation is null
                    from public.athletes where id = '00000000-0000-0000-0000-000000000071'),
                 'erasure clears the licence fields');
  perform lic.ok((select postal_code is null and city is null and address is null
                    from public.families where id = '00000000-0000-0000-0000-000000000061'),
                 'erasure clears street, postal code and city');
  perform lic.ok((select licence_number = 'SYN-1001' from public.athletes where id = 'b0000000-0000-0000-0000-0000000001e1'),
                 'org B licence untouched by org A erasure');
end $$;
