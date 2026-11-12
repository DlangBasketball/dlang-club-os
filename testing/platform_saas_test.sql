-- ============================================================================
-- Club OS — SaaS platform layer regression suite (migration 20250420091700)
-- Run after migrations + supabase/seeds/seed.sql (needs the DLang org fixture):
--   psql -d <db> -f testing/platform_saas_test.sql
-- Run ONCE on a fresh database: creates its own users (ids ...aa01-aa04). Every check prints PASS
-- or FAIL; lines starting "EXPECT <CODE>" must show that error code.
-- Simulates auth via the request.jwt.claim.sub setting read by auth.uid().
-- ============================================================================
-- db-test: expected-errors
\set ON_ERROR_STOP off
\pset tuples_only on
\pset format unaligned

-- Fixtures: an operator, a DLang admin, and a brand-new self-signup user
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000aa01', 'ops@platform.test'),
  ('00000000-0000-0000-0000-00000000aa02', 'admin2@dlang.test'),
  ('00000000-0000-0000-0000-00000000aa03', 'founder@newclub.test'),
  ('00000000-0000-0000-0000-00000000aa04', 'second@newclub.test');
insert into public.staff_roles (org_id, profile_id, role) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000aa02', 'admin');
insert into public.platform_admins (profile_id) values ('00000000-0000-0000-0000-00000000aa01');
insert into public.subscriptions (org_id, plan_code, status, currency, billing_interval)
  values ('00000000-0000-0000-0000-000000000001', 'academy', 'active', 'CHF', 'month');

\echo '--- plans seeded ---'
select case when count(*) = 4 then 'PASS' else 'FAIL' end || ' — 4 plans' from public.plans;
select case when count(*) = 18 then 'PASS' else 'FAIL' end || ' — 18 prices' from public.plan_prices;
select case when amount = 490 and onboarding_fee = 1500 then 'PASS' else 'FAIL' end || ' — Club CHF 490/month, CHF 1,500 onboarding'
  from public.plan_prices where plan_code = 'club' and currency = 'CHF' and billing_interval = 'month';
select case when amount = 3480 then 'PASS' else 'FAIL' end || ' — Starter CHF 3,480/year'
  from public.plan_prices where plan_code = 'starter' and currency = 'CHF' and billing_interval = 'year';

\echo '--- anon ---'
set role anon; set request.jwt.claim.sub = '';
select case when count(*) = 4 then 'PASS' else 'FAIL' end || ' — anon sees public plans' from public.plans;
select case when count(*) = 0 then 'PASS' else 'FAIL' end || ' — anon sees no subscriptions' from public.subscriptions;
select case when count(*) = 0 then 'PASS' else 'FAIL' end || ' — anon sees no platform_admins' from public.platform_admins;
select 'EXPECT ERROR (anon provision): ' || (public.provision_tenant('X Club','x-club','soccer','CH','CHF'))::text;
reset role;

\echo '--- club admin ---'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000aa02';
select case when count(*) = 1 then 'PASS' else 'FAIL' end || ' — admin reads own subscription' from public.subscriptions;
select case when count(*) = 0 then 'PASS' else 'FAIL' end || ' — admin cannot read platform_admins' from public.platform_admins;
select case when count(*) = 0 then 'PASS' else 'FAIL' end || ' — admin cannot read billing_events' from public.billing_events;
select case when public.is_platform_admin() then 'FAIL' else 'PASS' end || ' — admin is not platform admin';
select 'EXPECT FORBIDDEN: ' || count(*) from public.platform_tenant_overview();
select 'EXPECT FORBIDDEN: ' || (public.platform_set_org_suspended('00000000-0000-0000-0000-000000000001', true, 'nope'))::text;
update public.subscriptions set plan_code = 'federation';
select case when plan_code = 'academy' then 'PASS' else 'FAIL' end || ' — admin cannot write subscription' from public.subscriptions;
insert into public.plans (code, name) values ('hack', 'Hack');
select 'EXPECT ALREADY_MEMBER: ' || (public.provision_tenant('Another Club','another-club','soccer','CH','CHF'))::text;
select case when public.org_has_feature('00000000-0000-0000-0000-000000000001', 'custom_domain') then 'PASS' else 'FAIL' end || ' — academy has custom_domain';
select case when public.org_has_feature('00000000-0000-0000-0000-000000000001', 'sso') then 'FAIL' else 'PASS' end || ' — academy lacks sso';
select case when public.org_within_limit('00000000-0000-0000-0000-000000000001', 'athletes', 1) then 'PASS' else 'FAIL' end || ' — within athlete limit';
reset role;

\echo '--- self-signup ---'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000aa03';
select 'EXPECT INVALID_SLUG: ' || (public.provision_tenant('Lakers Youth','Bad Slug!','basketball','US','USD'))::text;
select 'EXPECT SLUG_RESERVED: ' || (public.provision_tenant('Lakers Youth','platform','basketball','US','USD'))::text;
select 'EXPECT SLUG_TAKEN: ' || (public.provision_tenant('Lakers Youth','dlang','basketball','US','USD'))::text;
select 'EXPECT INVALID_CURRENCY: ' || (public.provision_tenant('Lakers Youth','lakers-youth','basketball','US','GBP'))::text;
select 'EXPECT INVALID_PLAN: ' || (public.provision_tenant('Lakers Youth','lakers-youth','basketball','US','USD','en',null,'federation'))::text;
select 'EXPECT INVALID_NAME: ' || (public.provision_tenant('<script>','lakers-youth','basketball','US','USD'))::text;
select case when public.is_slug_available('lakers-youth') then 'PASS' else 'FAIL' end || ' — slug available';
select 'OK: ' || (public.provision_tenant('Lakers Youth','lakers-youth','basketball','US','USD','en','Jane Founder'))::text;
select case when public.is_slug_available('lakers-youth') then 'FAIL' else 'PASS' end || ' — slug now taken';
select case when count(*) = 1 and bool_and(slug = 'lakers-youth') then 'PASS' else 'FAIL' end || ' — founder sees only new org' from public.organizations;
select case when count(*) = 1 and bool_and(status = 'trialing' and trial_ends_at > now() + interval '13 days') then 'PASS' else 'FAIL' end || ' — 14-day trial' from public.subscriptions;
select case when public.is_admin() then 'PASS' else 'FAIL' end || ' — founder is admin';
select case when public.org_has_feature(public.current_org_id(), 'bookings') then 'PASS' else 'FAIL' end || ' — club trial has bookings';
select case when count(*) = 0 then 'PASS' else 'FAIL' end || ' — founder sees no DLang athletes' from public.athletes;
select 'EXPECT ALREADY_MEMBER: ' || (public.provision_tenant('Second','second-club','soccer','CH','CHF'))::text;
reset role;

\echo '--- platform admin ---'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000aa01';
select case when public.is_platform_admin() then 'PASS' else 'FAIL' end || ' — operator is platform admin';
select case when count(*) >= 2 then 'PASS' else 'FAIL' end || ' — operator sees all orgs' from public.organizations;
select case when count(*) >= 2 then 'PASS' else 'FAIL' end || ' — overview lists tenants' from public.platform_tenant_overview();
select 'MRR row: ' || name || ' ' || coalesce(plan_code,'-') || ' ' || mrr || ' ' || athletes from public.platform_tenant_overview();
select 'EXPECT REASON_REQUIRED: ' || (public.platform_set_org_suspended('00000000-0000-0000-0000-000000000001', true, ''))::text;
select 'OK: ' || (public.platform_set_org_suspended('00000000-0000-0000-0000-000000000001', true, 'Unpaid invoices'))::text;
select 'OK: ' || (public.platform_change_plan((select id from public.organizations where slug='lakers-youth'), 'academy', 'active'))::text;
-- Founding-club lock: CHF 290 for life, onboarding waived
select 'OK: ' || (public.platform_change_plan('00000000-0000-0000-0000-000000000001', 'club', null, null, 290, true))::text;
select case when plan_code = 'club' and custom_amount = 290 and onboarding_fee_waived then 'PASS' else 'FAIL' end
  || ' — founding lock stored' from public.subscriptions where org_id = '00000000-0000-0000-0000-000000000001';
select 'OK: ' || (public.platform_change_plan('00000000-0000-0000-0000-000000000001', 'academy'))::text;
select 'OK: ' || (public.platform_upsert_plan('{"code":"school","name":"School","features":{"registration":true},"max_athletes":"800"}'::jsonb, '[{"currency":"CHF","billing_interval":"month","amount":"199"}]'::jsonb))::text;
select case when count(*) = 1 then 'PASS' else 'FAIL' end || ' — new plan price' from public.plan_prices where plan_code = 'school';
select 'OK snapshots: ' || public.capture_all_usage_snapshots();
select case when count(*) >= 2 then 'PASS' else 'FAIL' end || ' — snapshots visible' from public.usage_snapshots;
select case when count(*) >= 4 then 'PASS' else 'FAIL' end || ' — audit log' from public.platform_audit_log;
reset role;

\echo '--- suspension ---'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000aa02';
select case when count(*) = 0 then 'PASS' else 'FAIL' end || ' — suspended org athletes hidden' from public.athletes;
select case when count(*) = 1 then 'PASS' else 'FAIL' end || ' — suspended admin still reads own subscription' from public.subscriptions;
select case when count(*) = 1 then 'PASS' else 'FAIL' end || ' — suspended admin still has roles' from public.staff_roles where profile_id = auth.uid();
select case when public.org_has_feature(public.current_org_id(), 'registration') then 'FAIL' else 'PASS' end || ' — suspended org has no features';
reset role;
select case when count(*) > 0 then 'PASS' else 'FAIL' end || ' — superuser still sees DLang athletes' from public.athletes;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000aa01';
select 'OK: ' || (public.platform_set_org_suspended('00000000-0000-0000-0000-000000000001', false))::text;
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000aa02';
select case when count(*) > 0 then 'PASS' else 'FAIL' end || ' — reactivated org athletes visible' from public.athletes;
reset role;
