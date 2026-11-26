-- ============================================================================
-- Feature packaging & upgrades (migration 20250420102100)
--
-- Proves:
--   * the catalog, add-on prices and the plan matrix are seeded;
--   * customer zero (org A, DLang) holds 'complimentary_all' as DATA and gets
--     every module through it, even without a subscription;
--   * resolution: plan inclusion, paid add-on, running vs expired trial,
--     grants vs blocks (block wins), dependencies, core always on, pending
--     requests grant nothing, suspended club gets nothing but core;
--   * RLS: club admins and finance read ONLY their own club's grants; coaches,
--     parents and anon read nothing; cross-tenant denial (org B cannot read or
--     probe org A, and vice versa);
--   * nobody in a club can write entitlements (insert / update / delete, own
--     club or another), call the platform RPCs, or edit prices / the matrix;
--   * platform admins write through the RPCs; every change is audit-logged;
--   * one self-serve trial per feature, core features cannot be granted.
--
-- Fixtures (seed): org A 00000000-…0001 DLang (admin …f1, finance …f2, coach
-- …f3, parent …f4); org B 10000000-…0002. Created here: org B admin, platform
-- admin. Prints PASS/FAIL per assertion.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema ent;
grant usage on schema ent to authenticated, anon;

create function ent.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

-- Run p_sql as user p (null = anon). Returns 'OK:<first column>' or 'ERR:<message>'.
create function ent.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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
grant execute on all functions in schema ent to authenticated, anon;

insert into auth.users (id, email) values ('b0000000-0000-0000-0000-0000000000e9', 'admin-ent@riverside.test');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002'
 where id = 'b0000000-0000-0000-0000-0000000000e9';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000e9', 'admin');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000ae01', 'operator-ent@platform.test');
insert into public.platform_admins (profile_id) values ('00000000-0000-0000-0000-00000000ae01');

do $$
declare
  a  constant uuid := '00000000-0000-0000-0000-000000000001';
  b  constant uuid := '10000000-0000-0000-0000-000000000002';
  a_admin   constant uuid := '00000000-0000-0000-0000-0000000000f1';
  a_finance constant uuid := '00000000-0000-0000-0000-0000000000f2';
  a_coach   constant uuid := '00000000-0000-0000-0000-0000000000f3';
  a_parent  constant uuid := '00000000-0000-0000-0000-0000000000f4';
  b_admin   constant uuid := 'b0000000-0000-0000-0000-0000000000e9';
  op        constant uuid := '00000000-0000-0000-0000-00000000ae01';
  v text;
  n int;
  g uuid;
begin
  -- ---- catalog, prices, matrix -----------------------------------------------
  select count(*) into n from public.platform_features;
  perform ent.ok(n >= 60, 'feature catalog seeded (' || n || ' features)');
  select count(*) into n from public.platform_features where is_core;
  perform ent.ok(n = 13, 'core features flagged (' || n || ')');
  perform ent.ok((select amount = 69 from public.feature_addon_prices where feature_key = 'ai_assistant' and currency = 'CHF'),
                 'AI assistant add-on priced CHF 69 (business model §4.3)');
  perform ent.ok((select amount = 29 from public.feature_addon_prices where feature_key = 'custom_domain' and currency = 'CHF'),
                 'custom domain add-on priced CHF 29 (business model §4.3)');
  perform ent.ok(not exists (select 1 from public.feature_addon_prices where feature_key = 'js_export' and currency <> 'CHF'),
                 'J+S export is sold in CHF only');
  perform ent.ok((select (features->>'coach_app')::boolean and not (features->>'bookings')::boolean from public.plans where code = 'club'),
                 'Club plan: coach app included, bookings not (Academy)');
  perform ent.ok((select (features->>'bookings')::boolean and (features->>'player_development')::boolean and (features->>'custom_domain')::boolean
                    from public.plans where code = 'academy'), 'Academy plan: bookings, development, custom domain included');
  perform ent.ok((select not (features->>'coach_app')::boolean and (features->>'camps')::boolean from public.plans where code = 'starter'),
                 'Starter plan: camps included, coach app not');
  perform ent.ok((select not coalesce((features->>'ai_assistant')::boolean, false) from public.plans where code = 'federation'),
                 'AI assistant stays out of every plan (paid add-on)');

  -- ---- customer zero: complimentary_all as data -----------------------------
  perform ent.ok(exists (select 1 from public.org_feature_grants where org_id = a and kind = 'complimentary_all' and feature_key = '*' and status = 'active'),
                 'org A (DLang) holds complimentary_all granted by the migration');
  perform ent.ok(not exists (select 1 from public.subscriptions where org_id = a), 'org A has no subscription in the test fixtures');
  v := ent.run_as(a_admin, $q$select public.org_feature_enabled('00000000-0000-0000-0000-000000000001', 'accounting')::text$q$);
  perform ent.ok(v = 'OK:true', 'org A: accounting on via complimentary_all (' || v || ')');
  v := ent.run_as(a_admin, $q$select public.org_feature_enabled('00000000-0000-0000-0000-000000000001', 'player_journey')::text$q$);
  perform ent.ok(v = 'OK:true', 'org A: a dependent module (journey -> development) is on too (' || v || ')');
  perform ent.ok(public.org_has_feature(a, 'site_builder'), 'legacy org_has_feature() follows the grants');

  -- ---- org B: plan, add-on, trial, block, dependencies ----------------------
  perform ent.ok(public.org_feature_enabled(b, 'invoicing'), 'core feature on without any subscription');
  perform ent.ok(not public.org_feature_enabled(b, 'shop'), 'no subscription: non-core feature off');
  insert into public.subscriptions (org_id, plan_code, status, currency, billing_interval) values (b, 'club', 'active', 'USD', 'month');
  perform ent.ok(public.org_feature_enabled(b, 'shop'), 'Club plan: shop on');
  perform ent.ok(not public.org_feature_enabled(b, 'bookings'), 'Club plan: bookings off (higher plan)');

  insert into public.org_feature_grants (org_id, feature_key, kind, status, currency, amount) values (b, 'bookings', 'addon', 'pending', 'USD', 87)
  returning id into g;
  perform ent.ok(not public.org_feature_enabled(b, 'bookings'), 'pending add-on request grants nothing');
  update public.org_feature_grants set status = 'active' where id = g;
  perform ent.ok(public.org_feature_enabled(b, 'bookings'), 'active add-on: bookings on');
  update public.org_feature_grants set status = 'canceling', ends_at = now() + interval '10 days' where id = g;
  perform ent.ok(public.org_feature_enabled(b, 'bookings'), 'add-on canceling at period end stays on until then');
  update public.org_feature_grants set ends_at = now() - interval '1 minute', starts_at = now() - interval '2 days' where id = g;
  perform ent.ok(not public.org_feature_enabled(b, 'bookings'), 'add-on past its end date: off (data kept)');

  insert into public.org_feature_grants (org_id, feature_key, kind, starts_at, ends_at) values (b, 'accounting', 'trial', now() - interval '20 days', now() - interval '6 days');
  perform ent.ok(not public.org_feature_enabled(b, 'accounting'), 'expired trial: off');
  begin
    insert into public.org_feature_grants (org_id, feature_key, kind, ends_at) values (b, 'accounting', 'trial', now() + interval '14 days');
    perform ent.ok(false, 'a second self-serve trial of the same feature is rejected');
  exception when unique_violation then
    perform ent.ok(true, 'a second self-serve trial of the same feature is rejected');
  end;
  insert into public.org_feature_grants (org_id, feature_key, kind, ends_at) values (b, 'ops_board', 'trial', now() + interval '14 days');
  perform ent.ok(public.org_feature_enabled(b, 'ops_board'), 'running trial: on');

  insert into public.org_feature_grants (org_id, feature_key, kind, status) values (b, 'player_journey', 'addon', 'active');
  perform ent.ok(not public.org_feature_enabled(b, 'player_journey'), 'dependency missing (player development off): journey off');
  insert into public.org_feature_grants (org_id, feature_key, kind) values (b, 'player_development', 'complimentary');
  perform ent.ok(public.org_feature_enabled(b, 'player_journey'), 'dependency granted: journey on');

  insert into public.org_feature_grants (org_id, feature_key, kind) values (b, 'shop', 'block');
  perform ent.ok(not public.org_feature_enabled(b, 'shop'), 'block wins over the plan');
  insert into public.org_feature_grants (org_id, feature_key, kind) values (b, '*', 'complimentary_all');
  perform ent.ok(not public.org_feature_enabled(b, 'shop'), 'block wins over complimentary_all');
  perform ent.ok(public.org_feature_enabled(b, 'accounting'), 'complimentary_all turns on the expired-trial module');
  delete from public.org_feature_grants where org_id = b and kind in ('block', 'complimentary_all');

  update public.subscriptions set status = 'canceled' where org_id = b;
  perform ent.ok(not public.org_feature_enabled(b, 'multi_team'), 'subscription not live: plan features off');
  perform ent.ok(public.org_feature_enabled(b, 'player_development'), 'complimentary grant survives a lapsed subscription');
  update public.subscriptions set status = 'active' where org_id = b;
  update public.organizations set suspended_at = now() where id = a;
  perform ent.ok(not public._org_feature_enabled(a, 'accounting') and public._org_feature_enabled(a, 'invoicing'),
                 'suspended club: nothing but core');
  update public.organizations set suspended_at = null where id = a;

  begin
    insert into public.org_feature_grants (org_id, feature_key, kind) values (b, 'invoicing', 'block');
    perform ent.ok(false, 'core features cannot be granted or blocked');
  exception when others then
    perform ent.ok(sqlerrm like '%CORE_FEATURE%', 'core features cannot be granted or blocked (' || sqlerrm || ')');
  end;
  begin
    insert into public.org_feature_grants (org_id, feature_key, kind) values (b, 'no_such_module', 'complimentary');
    perform ent.ok(false, 'unknown feature keys are rejected');
  exception when others then
    perform ent.ok(sqlerrm like '%UNKNOWN_FEATURE%', 'unknown feature keys are rejected');
  end;

  -- ---- read: admins & finance of their own club only ------------------------
  v := ent.run_as(a_admin, $q$select count(*)::text from public.org_feature_grants where org_id <> '00000000-0000-0000-0000-000000000001'$q$);
  perform ent.ok(v = 'OK:0', 'org A admin reads no other club''s grants (' || v || ')');
  v := ent.run_as(a_admin, $q$select count(*)::text from public.org_feature_grants$q$);
  perform ent.ok(v = 'OK:1', 'org A admin reads its own grant (' || v || ')');
  v := ent.run_as(a_finance, $q$select kind from public.org_feature_grants$q$);
  perform ent.ok(v = 'OK:complimentary_all', 'org A finance can view its own grants (' || v || ')');
  v := ent.run_as(a_coach, $q$select count(*)::text from public.org_feature_grants$q$);
  perform ent.ok(v = 'OK:0', 'org A coach reads no grants (' || v || ')');
  v := ent.run_as(a_parent, $q$select count(*)::text from public.org_feature_grants$q$);
  perform ent.ok(v = 'OK:0', 'org A parent reads no grants (' || v || ')');
  v := ent.run_as(null, $q$select count(*)::text from public.org_feature_grants$q$);
  perform ent.ok(v like 'ERR:%' or v = 'OK:0', 'anon reads no grants (' || v || ')');
  v := ent.run_as(b_admin, $q$select count(*)::text from public.org_feature_grants where org_id = '00000000-0000-0000-0000-000000000001'$q$);
  perform ent.ok(v = 'OK:0', 'cross-tenant: org B admin cannot read org A grants (' || v || ')');
  v := ent.run_as(b_admin, $q$select count(*)::text from public.org_feature_grants$q$);
  perform ent.ok(v ~ '^OK:[1-9]', 'org B admin reads its own grants (' || v || ')');
  v := ent.run_as(b_admin, $q$select public.org_feature_enabled('00000000-0000-0000-0000-000000000001', 'accounting')::text$q$);
  perform ent.ok(v = 'OK:false', 'cross-tenant: org B cannot probe org A entitlements (' || v || ')');
  v := ent.run_as(a_admin, $q$select public.org_feature_enabled('10000000-0000-0000-0000-000000000002', 'shop')::text$q$);
  perform ent.ok(v = 'OK:false', 'cross-tenant: org A cannot probe org B entitlements (' || v || ')');
  v := ent.run_as(b_admin, $q$select public._org_feature_enabled('00000000-0000-0000-0000-000000000001', 'accounting')::text$q$);
  perform ent.ok(v like 'ERR:%', 'internal resolver is not callable by clubs (' || v || ')');
  v := ent.run_as(b_admin, $q$select count(*)::text from public.audit_logs where org_id = '00000000-0000-0000-0000-000000000001' and target_table = 'org_feature_grants'$q$);
  perform ent.ok(v = 'OK:0', 'cross-tenant: org B cannot read org A entitlement audit trail (' || v || ')');

  -- ---- write: nobody in a club ---------------------------------------------
  v := ent.run_as(b_admin, $q$insert into public.org_feature_grants (org_id, feature_key, kind) values ('10000000-0000-0000-0000-000000000002', 'accounting', 'complimentary') returning 1$q$);
  perform ent.ok(v like 'ERR:%', 'org B admin cannot grant its own club a feature (' || v || ')');
  v := ent.run_as(b_admin, $q$insert into public.org_feature_grants (org_id, feature_key, kind) values ('10000000-0000-0000-0000-000000000002', '*', 'complimentary_all') returning 1$q$);
  perform ent.ok(v like 'ERR:%', 'org B admin cannot grant itself complimentary_all (' || v || ')');
  v := ent.run_as(b_admin, $q$with u as (update public.org_feature_grants set ends_at = now() + interval '100 years' where org_id = '10000000-0000-0000-0000-000000000002' returning 1) select count(*)::text from u$q$);
  perform ent.ok(v = 'OK:0' or v like 'ERR:%', 'org B admin cannot extend its own grants (' || v || ')');
  v := ent.run_as(b_admin, $q$with d as (delete from public.org_feature_grants where org_id = '10000000-0000-0000-0000-000000000002' and kind = 'trial' returning 1) select count(*)::text from d$q$);
  perform ent.ok(v = 'OK:0' or v like 'ERR:%', 'org B admin cannot delete its trial history (' || v || ')');
  v := ent.run_as(b_admin, $q$with d as (delete from public.org_feature_grants where org_id = '00000000-0000-0000-0000-000000000001' returning 1) select count(*)::text from d$q$);
  perform ent.ok(v = 'OK:0' or v like 'ERR:%', 'cross-tenant: org B admin cannot delete org A grants (' || v || ')');
  v := ent.run_as(a_admin, $q$with u as (update public.org_feature_grants set status = 'canceled' where org_id = '00000000-0000-0000-0000-000000000001' returning 1) select count(*)::text from u$q$);
  perform ent.ok(v = 'OK:0' or v like 'ERR:%', 'org A admin cannot modify its own grant (' || v || ')');
  v := ent.run_as(a_finance, $q$insert into public.org_feature_grants (org_id, feature_key, kind) values ('00000000-0000-0000-0000-000000000001', 'sms', 'complimentary') returning 1$q$);
  perform ent.ok(v like 'ERR:%', 'org A finance cannot insert grants (' || v || ')');
  v := ent.run_as(b_admin, $q$select public.platform_set_feature_grant('10000000-0000-0000-0000-000000000002', 'accounting', 'complimentary')::text$q$);
  perform ent.ok(v like 'ERR:%FORBIDDEN%', 'club admin cannot call the platform grant RPC (' || v || ')');
  v := ent.run_as(b_admin, $q$select public.platform_set_plan_feature('club', 'bookings', true)::text$q$);
  perform ent.ok(v like 'ERR:%FORBIDDEN%', 'club admin cannot edit the plan matrix (' || v || ')');
  v := ent.run_as(b_admin, $q$select public.platform_set_addon_price('bookings', 'USD', 1)::text$q$);
  perform ent.ok(v like 'ERR:%FORBIDDEN%', 'club admin cannot edit add-on prices via RPC (' || v || ')');
  v := ent.run_as(b_admin, $q$with u as (update public.feature_addon_prices set amount = 0 returning 1) select count(*)::text from u$q$);
  perform ent.ok(v = 'OK:0' or v like 'ERR:%', 'club admin cannot edit add-on prices directly (' || v || ')');
  v := ent.run_as(b_admin, $q$with u as (update public.plans set features = features || '{"bookings": true}' returning 1) select count(*)::text from u$q$);
  perform ent.ok(v = 'OK:0' or v like 'ERR:%', 'club admin cannot edit plans directly (' || v || ')');
  v := ent.run_as(b_admin, $q$select count(*)::text from public.feature_addon_prices$q$);
  perform ent.ok(v ~ '^OK:[1-9]', 'club admin reads the add-on price list (' || v || ')');

  -- ---- platform admin: RPCs, audited ----------------------------------------
  v := ent.run_as(op, $q$select public.platform_set_feature_grant('10000000-0000-0000-0000-000000000002', 'media_library', 'block', null, 'abuse review')::text$q$);
  perform ent.ok(v ~ '^OK:[0-9a-f-]{36}$', 'platform admin blocks a feature (' || v || ')');
  perform ent.ok(not public.org_feature_enabled(b, 'media_library'), 'platform block applies');
  perform ent.ok(exists (select 1 from public.platform_audit_log where org_id = b and actor_id = op and action = 'feature.grant.created'
                         and details->'new'->>'kind' = 'block'), 'block is audit-logged in the platform trail with the operator');
  perform ent.ok(exists (select 1 from public.audit_logs where org_id = b and target_table = 'org_feature_grants' and action = 'feature.grant.created'),
                 'block is audit-logged in the club trail');
  v := ent.run_as(op, $q$select public.platform_set_feature_grant('10000000-0000-0000-0000-000000000002', 'accounting', 'trial', now() + interval '30 days')::text$q$);
  perform ent.ok(v like 'OK:%', 'platform admin can grant a second trial (' || v || ')');
  perform ent.ok(public.org_feature_enabled(b, 'accounting'), 'platform trial applies');
  select id into g from public.org_feature_grants where org_id = b and feature_key = 'bookings' and kind = 'addon';
  update public.org_feature_grants set status = 'pending', ends_at = null where id = g;
  v := ent.run_as(op, format($q$select public.platform_update_feature_grant(%L, 'active')::text$q$, g));
  perform ent.ok(v like 'OK:%', 'platform admin activates a pending add-on request (' || v || ')');
  perform ent.ok(public.org_feature_enabled(b, 'bookings'), 'activated request: on');
  perform ent.ok(exists (select 1 from public.audit_logs where org_id = b and action = 'feature.grant.updated'
                         and old_data->>'status' = 'pending' and new_data->>'status' = 'active'), 'activation audit-logged with old/new');
  v := ent.run_as(op, $q$select public.platform_set_plan_feature('starter', 'csv_import', true)::text$q$);
  perform ent.ok(v like 'OK:%' and (select (features->>'csv_import')::boolean from public.plans where code = 'starter'),
                 'platform admin edits the plan matrix (' || v || ')');
  perform ent.ok(exists (select 1 from public.platform_audit_log where action = 'plan.feature.set' and actor_id = op), 'matrix change audit-logged');
  v := ent.run_as(op, $q$select public.platform_set_addon_price('shop', 'EUR', 35)::text$q$);
  perform ent.ok(v like 'OK:%' and (select amount = 35 from public.feature_addon_prices where feature_key = 'shop' and currency = 'EUR'),
                 'platform admin edits an add-on price (' || v || ')');
  perform ent.ok(exists (select 1 from public.platform_audit_log where action = 'addon.price.set' and details->>'feature' = 'shop'), 'price change audit-logged');
  v := ent.run_as(op, $q$select public.platform_set_plan_feature('club', 'ai_assistant', true)::text$q$);
  perform ent.ok(v like 'ERR:%ADDON_ONLY%', 'the AI assistant (add-on only) cannot be put into a plan (' || v || ')');
  v := ent.run_as(op, $q$select public.platform_set_plan_feature('starter', 'invoicing', false)::text$q$);
  perform ent.ok(v like 'ERR:%', 'core features cannot be removed from a plan (' || v || ')');
end $$;
