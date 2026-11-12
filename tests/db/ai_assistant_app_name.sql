-- ============================================================================
-- AI assistant opt-in + per-club app name (migration 20250420095500)
--
-- Proves:
--   * the per-club switch defaults to OFF and only the club's own ADMIN can
--     change it (finance / parent / anon / another club's admin cannot);
--   * a club that is not entitled by its plan cannot switch it on;
--   * every change is audit-logged with the acting user;
--   * cross-tenant denial: org B's admin can neither read nor change org A's
--     switch, entitlement, audit trail or app name;
--   * branding.app_name is validated and exposed by get_public_tenant;
--   * the Club plan includes ai_assistant, prices unchanged.
--
-- Fixtures (seed): org A …0001 DLang (plan 'founding', no subscription; admin
-- …f1, finance …f2, parent …f4); org B 10000000-…0002 Riverside (plan
-- 'starter'), whose admin is created here. Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema ai;
grant usage on schema ai to authenticated, anon;

create function ai.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

-- Run p_sql as user p (null = anon). Returns 'OK:<first column>' or 'ERR:<message>'.
create function ai.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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
grant execute on all functions in schema ai to authenticated, anon;

insert into auth.users (id, email) values ('b0000000-0000-0000-0000-0000000000a9', 'admin-ai@riverside.test');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002'
 where id = 'b0000000-0000-0000-0000-0000000000a9';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000a9', 'admin');
insert into public.app_settings (org_id) values ('10000000-0000-0000-0000-000000000002') on conflict (org_id) do nothing;

do $$
declare
  a  constant uuid := '00000000-0000-0000-0000-000000000001';
  b  constant uuid := '10000000-0000-0000-0000-000000000002';
  a_admin   constant uuid := '00000000-0000-0000-0000-0000000000f1';
  a_finance constant uuid := '00000000-0000-0000-0000-0000000000f2';
  a_parent  constant uuid := '00000000-0000-0000-0000-0000000000f4';
  b_admin   constant uuid := 'b0000000-0000-0000-0000-0000000000a9';
  v text;
  n int;
begin
  -- ---- plans ---------------------------------------------------------------
  perform ai.ok((select (features->>'ai_assistant')::boolean from public.plans where code = 'club'), 'Club plan includes ai_assistant');
  perform ai.ok(not coalesce((select (features->>'ai_assistant')::boolean from public.plans where code = 'starter'), false), 'Starter plan does not include ai_assistant');
  perform ai.ok((select amount from public.plan_prices where plan_code = 'club' and currency = 'CHF' and billing_interval = 'month') = 490, 'Club price unchanged (CHF 490/month)');

  -- ---- defaults ------------------------------------------------------------
  v := ai.run_as(a_admin, $q$select public.org_ai_assistant_enabled('00000000-0000-0000-0000-000000000001')::text$q$);
  perform ai.ok(v = 'OK:false', 'default: assistant OFF for org A (' || v || ')');
  v := ai.run_as(a_admin, $q$select public.org_ai_assistant_entitled('00000000-0000-0000-0000-000000000001')::text$q$);
  perform ai.ok(v = 'OK:true', 'founding club without subscription is entitled (' || v || ')');
  v := ai.run_as(b_admin, $q$select public.org_ai_assistant_entitled('10000000-0000-0000-0000-000000000002')::text$q$);
  perform ai.ok(v = 'OK:false', 'org B (starter, no subscription) is not entitled (' || v || ')');

  -- ---- who may switch it ---------------------------------------------------
  v := ai.run_as(null, $q$select public.set_org_ai_assistant(true)::text$q$);
  perform ai.ok(v like 'ERR:%', 'anon cannot call set_org_ai_assistant');
  v := ai.run_as(a_finance, $q$select public.set_org_ai_assistant(true)::text$q$);
  perform ai.ok(v like 'ERR:%FORBIDDEN%', 'finance cannot switch the assistant (' || v || ')');
  v := ai.run_as(a_parent, $q$select public.set_org_ai_assistant(true)::text$q$);
  perform ai.ok(v like 'ERR:%FORBIDDEN%', 'parent cannot switch the assistant (' || v || ')');
  v := ai.run_as(a_finance, $q$update public.app_settings set settings = settings || '{"ai_assistant_enabled": true}' where org_id = '00000000-0000-0000-0000-000000000001' returning 1$q$);
  perform ai.ok(v = 'OK:<null>' or v like 'ERR:%', 'finance direct update of app_settings changes nothing (' || v || ')');
  perform ai.ok(not coalesce((select (settings->>'ai_assistant_enabled')::boolean from public.app_settings where org_id = a), false), 'org A still OFF after non-admin attempts');

  v := ai.run_as(a_admin, $q$select public.set_org_ai_assistant(true)::text$q$);
  perform ai.ok(v = 'OK:true', 'org A admin switches the assistant ON (' || v || ')');
  v := ai.run_as(a_admin, $q$select public.org_ai_assistant_enabled('00000000-0000-0000-0000-000000000001')::text$q$);
  perform ai.ok(v = 'OK:true', 'org A effective state ON');
  select count(*) into n from public.audit_logs
   where org_id = a and action = 'settings.ai_assistant.enabled' and actor_id = a_admin
     and (new_data->>'ai_assistant_enabled')::boolean;
  perform ai.ok(n = 1, 'enable is audit-logged with the acting admin');

  -- ---- not entitled --------------------------------------------------------
  v := ai.run_as(b_admin, $q$select public.set_org_ai_assistant(true)::text$q$);
  perform ai.ok(v like 'ERR:%AI_ASSISTANT_NOT_IN_PLAN%', 'org B admin cannot enable without the plan feature (' || v || ')');
  perform ai.ok(not coalesce((select (settings->>'ai_assistant_enabled')::boolean from public.app_settings where org_id = b), false), 'org B still OFF');

  -- ---- cross-tenant denial -------------------------------------------------
  v := ai.run_as(b_admin, $q$select public.org_ai_assistant_enabled('00000000-0000-0000-0000-000000000001')::text$q$);
  perform ai.ok(v = 'OK:false', 'org B admin cannot read org A effective state (' || v || ')');
  v := ai.run_as(b_admin, $q$select public.org_ai_assistant_entitled('00000000-0000-0000-0000-000000000001')::text$q$);
  perform ai.ok(v = 'OK:false', 'org B admin cannot read org A entitlement (' || v || ')');
  v := ai.run_as(b_admin, $q$select count(*)::text from public.app_settings where org_id = '00000000-0000-0000-0000-000000000001'$q$);
  perform ai.ok(v = 'OK:0', 'org B admin sees no org A app_settings row');
  v := ai.run_as(b_admin, $q$with u as (update public.app_settings set settings = settings || '{"ai_assistant_enabled": false}' where org_id = '00000000-0000-0000-0000-000000000001' returning 1) select count(*)::text from u$q$);
  perform ai.ok(v = 'OK:0' or v like 'ERR:%', 'org B admin update of org A switch touches 0 rows (' || v || ')');
  perform ai.ok((select (settings->>'ai_assistant_enabled')::boolean from public.app_settings where org_id = a), 'org A switch unchanged after org B attempt');
  v := ai.run_as(b_admin, $q$select count(*)::text from public.audit_logs where org_id = '00000000-0000-0000-0000-000000000001'$q$);
  perform ai.ok(v = 'OK:0', 'org B admin cannot read org A audit trail');

  -- ---- entitled via plan ---------------------------------------------------
  insert into public.subscriptions (org_id, plan_code, status, currency, billing_interval)
  values (b, 'club', 'active', 'USD', 'month');
  v := ai.run_as(b_admin, $q$select public.set_org_ai_assistant(true)::text$q$);
  perform ai.ok(v = 'OK:true', 'org B admin on the Club plan can enable (' || v || ')');
  perform ai.ok((select (settings->>'ai_assistant_enabled')::boolean from public.app_settings where org_id = b), 'org B switch ON');
  select count(*) into n from public.audit_logs where org_id = b and action = 'settings.ai_assistant.enabled' and actor_id = b_admin;
  perform ai.ok(n = 1, 'org B enable audit row is stamped with org B');

  -- ---- disable -------------------------------------------------------------
  v := ai.run_as(a_admin, $q$select public.set_org_ai_assistant(false)::text$q$);
  perform ai.ok(v = 'OK:false', 'org A admin switches the assistant OFF');
  select count(*) into n from public.audit_logs where org_id = a and action = 'settings.ai_assistant.disabled' and actor_id = a_admin;
  perform ai.ok(n = 1, 'disable is audit-logged');
  perform ai.ok((select (settings->>'ai_assistant_enabled')::boolean from public.app_settings where org_id = b), 'org B unaffected by org A disable');

  -- ---- suspended club ------------------------------------------------------
  update public.organizations set suspended_at = now() where id = b;
  perform ai.ok(not public.org_ai_assistant_enabled(b), 'suspended club: assistant not effective');
  update public.organizations set suspended_at = null where id = b;

  -- ---- type constraint -----------------------------------------------------
  begin
    update public.app_settings set settings = settings || '{"ai_assistant_enabled": "yes"}' where org_id = a;
    perform ai.ok(false, 'non-boolean ai_assistant_enabled is rejected');
  exception when check_violation then
    perform ai.ok(true, 'non-boolean ai_assistant_enabled is rejected');
  end;

  -- ---- app name ------------------------------------------------------------
  v := ai.run_as(a_admin, $q$with u as (update public.organizations set branding = branding || '{"app_name": "DLang OS"}' where id = '00000000-0000-0000-0000-000000000001' returning 1) select count(*)::text from u$q$);
  perform ai.ok(v = 'OK:1', 'org A admin sets app_name (' || v || ')');
  v := ai.run_as(null, $q$select branding->>'app_name' from public.get_public_tenant(null, 'dlang')$q$);
  perform ai.ok(v = 'OK:DLang OS', 'get_public_tenant exposes app_name to the login page (' || v || ')');
  v := ai.run_as(b_admin, $q$with u as (update public.organizations set branding = branding || '{"app_name": "Hijacked"}' where id = '00000000-0000-0000-0000-000000000001' returning 1) select count(*)::text from u$q$);
  perform ai.ok(v = 'OK:0' or v like 'ERR:%', 'org B admin cannot rename org A (' || v || ')');
  perform ai.ok((select branding->>'app_name' from public.organizations where id = a) = 'DLang OS', 'org A app_name unchanged after org B attempt');

  perform ai.ok(public.validate_tenant_branding('{"app_name": ""}'), 'empty app_name is allowed (falls back to org name)');
  perform ai.ok(public.validate_tenant_branding('{"app_name": null}'), 'null app_name is allowed');
  perform ai.ok(not public.validate_tenant_branding('{"app_name": "<script>x</script>"}'), 'markup in app_name is rejected');
  perform ai.ok(not public.validate_tenant_branding(jsonb_build_object('app_name', repeat('x', 61))), 'app_name over 60 chars is rejected');
  perform ai.ok(not public.validate_tenant_branding('{"app_name": 42}'), 'non-string app_name is rejected');
  perform ai.ok(not public.validate_tenant_branding(jsonb_build_object('app_name', 'A' || chr(10) || 'B')), 'control characters in app_name are rejected');
  begin
    update public.organizations set branding = branding || '{"app_name": "{{evil}}"}' where id = a;
    perform ai.ok(false, 'guard trigger rejects an invalid app_name');
  exception when others then
    perform ai.ok(true, 'guard trigger rejects an invalid app_name');
  end;
end $$;
