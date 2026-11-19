-- ============================================================================
-- Compliance (migration 20250420091900) — RLS & behaviour regression suite
-- Run after migrations + supabase/seeds/seed.sql:
--   psql -d <db> -f testing/compliance_test_suite.sql
-- ANY line that prints "FAIL" is a LAUNCH BLOCKER. Run once on a FRESH database
-- (it inserts fixtures; a second run reports false FAILs from leftover rows).
-- Users: admin ...f1 · finance ...f2 · coach ...f3 · parent ...f4
-- ============================================================================
\set ON_ERROR_STOP off
\pset tuples_only on
\pset format unaligned

\echo '--- Bootstrap ---'
select case when count(*)=1 then 'PASS' else 'FAIL' end||' — founding org has compliance settings (CH)'
  from public.compliance_settings where org_id='00000000-0000-0000-0000-000000000001' and data_region='CH';
select case when count(*)=17 then 'PASS' else 'FAIL' end||' — founding org has 17 retention policies'
  from public.data_retention_policies where org_id='00000000-0000-0000-0000-000000000001';
select case when retention_months=120 then 'PASS' else 'FAIL' end||' — CH financial retention is 10 years'
  from public.data_retention_policies where org_id='00000000-0000-0000-0000-000000000001' and data_category='financial';

-- A second (US school) tenant for isolation tests.
insert into public.organizations (id, name, slug, country, currency)
  values ('00000000-0000-0000-0000-0000000000a2','Springfield Middle School','springfield-ms','US','USD')
  on conflict (id) do nothing;
update public.compliance_settings set org_type='school', ferpa_applies=true where org_id='00000000-0000-0000-0000-0000000000a2';
insert into public.breach_incidents (org_id, title) values ('00000000-0000-0000-0000-0000000000a2','Other-tenant incident');
select case when data_region='US' and coppa_applies then 'PASS' else 'FAIL' end||' — US org bootstrapped with COPPA on'
  from public.compliance_settings where org_id='00000000-0000-0000-0000-0000000000a2';
select case when retention_months=84 then 'PASS' else 'FAIL' end||' — US financial retention is 7 years'
  from public.data_retention_policies where org_id='00000000-0000-0000-0000-0000000000a2' and data_category='financial';

\echo '--- Admin access (own org only) ---'
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f1';
insert into public.dsar_requests (org_id, requester_name, request_type, jurisdiction, received_at)
  values ('00000000-0000-0000-0000-000000000001','Carla Lopes','access','CH','2026-01-01T00:00:00Z');
select case when due_at = '2026-01-31T00:00:00Z'::timestamptz then 'PASS' else 'FAIL' end||' — CH DSAR due in 30 days'
  from public.dsar_requests where requester_name='Carla Lopes';
insert into public.dsar_requests (org_id, requester_name, request_type, jurisdiction, received_at)
  values ('00000000-0000-0000-0000-000000000001','US Parent','access','US','2026-01-01T00:00:00Z');
select case when due_at = '2026-02-15T00:00:00Z'::timestamptz then 'PASS' else 'FAIL' end||' — US (CCPA) DSAR due in 45 days'
  from public.dsar_requests where requester_name='US Parent';
select case when count(*)=2 then 'PASS' else 'FAIL' end||' — overdue view lists past-due open requests' from public.dsar_overdue;
insert into public.breach_incidents (org_id, title, detected_at)
  values ('00000000-0000-0000-0000-000000000001','Lost laptop','2026-03-01T10:00:00Z');
select case when authority_notify_by='2026-03-04T10:00:00Z'::timestamptz then 'PASS' else 'FAIL' end||' — breach 72h authority deadline set'
  from public.breach_incidents where title='Lost laptop';
select case when count(*)=1 then 'PASS' else 'FAIL' end||' — admin sees only own-org breaches' from public.breach_incidents;
select case when count(*)=0 then 'PASS' else 'FAIL' end||' — admin cannot read other org settings'
  from public.compliance_settings where org_id='00000000-0000-0000-0000-0000000000a2';
select case when count(*)>=5 then 'PASS' else 'FAIL' end||' — admin sees platform sub-processors' from public.subprocessors;
reset role;

\echo '--- Cross-tenant write blocked ---'
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f1';
do $$ begin
  insert into public.breach_incidents (org_id, title) values ('00000000-0000-0000-0000-0000000000a2','x');
  raise notice 'FAIL — admin inserted into another org';
exception when insufficient_privilege then raise notice 'PASS — cross-org insert rejected by RLS'; end $$;
do $$ begin
  update public.subprocessors set name = name where org_id is null;
  if found then raise notice 'FAIL — tenant admin modified platform sub-processor';
  else raise notice 'PASS — platform sub-processors are read-only to tenants'; end if;
end $$;
do $$ begin
  delete from public.breach_incidents where title='Lost laptop';
  raise notice 'FAIL — breach record deleted';
exception when others then raise notice 'PASS — breach records cannot be deleted'; end $$;
reset role;

\echo '--- Non-admin roles see nothing ---'
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f2';
select case when count(*)=0 then 'PASS' else 'FAIL' end||' — finance cannot read DSARs' from public.dsar_requests;
reset role;
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f3';
select case when count(*)=0 then 'PASS' else 'FAIL' end||' — coach cannot read breach log' from public.breach_incidents;
select case when count(*)=0 then 'PASS' else 'FAIL' end||' — coach cannot read ROPA' from public.processing_activities;
reset role;
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f4';
select case when count(*)=0 then 'PASS' else 'FAIL' end||' — parent cannot read parental consent register' from public.parental_consents;
select case when count(*)=0 then 'PASS' else 'FAIL' end||' — parent cannot read retention policies' from public.data_retention_policies;
select case when count(*)=0 then 'PASS' else 'FAIL' end||' — parent cannot read sub-processors' from public.subprocessors;
reset role;
set role anon;
do $$ begin
  perform 1 from public.dsar_requests;
  raise notice 'FAIL — anon could query DSARs';
exception when insufficient_privilege then raise notice 'PASS — anon has no access to DSARs'; end $$;
reset role;

\echo '--- COPPA helper ---'
update public.compliance_settings set coppa_applies = true where org_id='00000000-0000-0000-0000-000000000001';
update public.athletes set dob = current_date - interval '10 years' where id='00000000-0000-0000-0000-000000000071';
select case when public.athlete_requires_vpc('00000000-0000-0000-0000-000000000071') then 'PASS' else 'FAIL' end||' — under-13 in COPPA org requires VPC';
select case when not public.athlete_has_vpc('00000000-0000-0000-0000-000000000071') then 'PASS' else 'FAIL' end||' — no VPC recorded yet';
insert into public.parental_consents (org_id, athlete_id, guardian_name, method, status, verified_at)
  values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000071','Carla Lopes','payment_transaction','verified', now());
select case when public.athlete_has_vpc('00000000-0000-0000-0000-000000000071') then 'PASS' else 'FAIL' end||' — VPC recorded';
