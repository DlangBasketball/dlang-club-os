-- ============================================================================
-- AI assistant paid add-on entitlement (migration 20250420095600)
--
-- Proves:
--   * the founding club (org A, DLang) holds a 'complimentary' add-on granted
--     as data by the migration (no code path), and is entitled through it;
--   * club members read their own club's add-on row; anon reads nothing;
--   * a club admin CANNOT grant itself the add-on (insert / update / delete
--     are refused for club admin, finance and parent, in their own club);
--   * cross-tenant denial: org B cannot read org A's add-on row or its audit
--     trail, and cannot change it;
--   * only the platform (service role / platform admin) writes the table;
--     every grant / change / removal is audit-logged (club + platform trails);
--   * a paid add-on needs a live subscription; complimentary does not;
--     paused / expired / suspended = not entitled;
--   * scope 'family' is reserved (future parent add-on): it grants nothing
--     and must point at a family of the same club.
--
-- Fixtures (seed): org A 00000000-…0001 DLang (admin …f1, finance …f2,
-- parent …f4, families …61/…62); org B 10000000-…0002 Riverside. The org B
-- admin and a platform admin are created here. Prints PASS/FAIL per assertion.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema ad;
grant usage on schema ad to authenticated, anon;

create function ad.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

-- Run p_sql as user p (null = anon). Returns 'OK:<first column>' or 'ERR:<message>'.
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
grant execute on all functions in schema ad to authenticated, anon;

-- org B admin
insert into auth.users (id, email) values ('b0000000-0000-0000-0000-0000000000b9', 'admin-addon@riverside.test');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002'
 where id = 'b0000000-0000-0000-0000-0000000000b9';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000b9', 'admin');
-- platform operator (no club)
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000ab01', 'operator-addon@platform.test');
insert into public.platform_admins (profile_id) values ('00000000-0000-0000-0000-00000000ab01');

do $$
declare
  a  constant uuid := '00000000-0000-0000-0000-000000000001';
  b  constant uuid := '10000000-0000-0000-0000-000000000002';
  a_admin   constant uuid := '00000000-0000-0000-0000-0000000000f1';
  a_finance constant uuid := '00000000-0000-0000-0000-0000000000f2';
  a_parent  constant uuid := '00000000-0000-0000-0000-0000000000f4';
  b_admin   constant uuid := 'b0000000-0000-0000-0000-0000000000b9';
  op        constant uuid := '00000000-0000-0000-0000-00000000ab01';
  a_row uuid;
  v text;
  n int;
begin
  -- ---- founding club: complimentary row as data ----------------------------
  select id into a_row from public.ai_assistant_addons where org_id = a and scope = 'org';
  perform ad.ok(a_row is not null, 'org A (DLang) has an add-on row granted by the migration');
  perform ad.ok((select source = 'complimentary' and status = 'active' from public.ai_assistant_addons where id = a_row),
                'org A add-on is complimentary and active');
  perform ad.ok(not exists (select 1 from public.ai_assistant_addons where org_id = b), 'org B has no add-on row');
  v := ad.run_as(a_admin, $q$select public.org_ai_assistant_entitled('00000000-0000-0000-0000-000000000001')::text$q$);
  perform ad.ok(v = 'OK:true', 'org A entitled via complimentary add-on without a subscription (' || v || ')');
  v := ad.run_as(b_admin, $q$select public.org_ai_assistant_entitled('10000000-0000-0000-0000-000000000002')::text$q$);
  perform ad.ok(v = 'OK:false', 'org B not entitled without an add-on (' || v || ')');

  -- ---- read: own club members only -----------------------------------------
  v := ad.run_as(a_admin, $q$select count(*)::text from public.ai_assistant_addons$q$);
  perform ad.ok(v = 'OK:1', 'org A admin reads own add-on row (' || v || ')');
  v := ad.run_as(a_finance, $q$select source from public.ai_assistant_addons where org_id = '00000000-0000-0000-0000-000000000001'$q$);
  perform ad.ok(v = 'OK:complimentary', 'org A finance reads own add-on row (' || v || ')');
  v := ad.run_as(a_parent, $q$select count(*)::text from public.ai_assistant_addons where org_id = '00000000-0000-0000-0000-000000000001'$q$);
  perform ad.ok(v = 'OK:1', 'org A parent (club member) reads the club-scope row (' || v || ')');
  v := ad.run_as(null, $q$select count(*)::text from public.ai_assistant_addons$q$);
  perform ad.ok(v like 'ERR:%' or v = 'OK:0', 'anon cannot read add-ons (' || v || ')');

  -- ---- cross-tenant denial -------------------------------------------------
  v := ad.run_as(b_admin, $q$select count(*)::text from public.ai_assistant_addons where org_id = '00000000-0000-0000-0000-000000000001'$q$);
  perform ad.ok(v = 'OK:0', 'org B admin cannot read org A (DLang) add-on (' || v || ')');
  v := ad.run_as(b_admin, $q$select public.org_ai_assistant_entitled('00000000-0000-0000-0000-000000000001')::text$q$);
  perform ad.ok(v = 'OK:false', 'org B admin cannot learn org A entitlement via RPC (' || v || ')');
  v := ad.run_as(b_admin, $q$with u as (update public.ai_assistant_addons set status = 'canceled' where org_id = '00000000-0000-0000-0000-000000000001' returning 1) select count(*)::text from u$q$);
  perform ad.ok(v = 'OK:0' or v like 'ERR:%', 'org B admin cannot cancel org A add-on (' || v || ')');
  v := ad.run_as(b_admin, $q$with d as (delete from public.ai_assistant_addons where org_id = '00000000-0000-0000-0000-000000000001' returning 1) select count(*)::text from d$q$);
  perform ad.ok(v = 'OK:0' or v like 'ERR:%', 'org B admin cannot delete org A add-on (' || v || ')');
  v := ad.run_as(b_admin, $q$select count(*)::text from public.audit_logs where org_id = '00000000-0000-0000-0000-000000000001' and action like 'addon.%'$q$);
  perform ad.ok(v = 'OK:0', 'org B admin cannot read org A add-on audit trail (' || v || ')');

  -- ---- a club admin cannot grant itself the add-on -------------------------
  v := ad.run_as(b_admin, $q$insert into public.ai_assistant_addons (org_id, scope, source) values ('10000000-0000-0000-0000-000000000002', 'org', 'complimentary') returning 1$q$);
  perform ad.ok(v like 'ERR:%', 'org B admin cannot grant its own club the add-on (' || v || ')');
  v := ad.run_as(b_admin, $q$insert into public.ai_assistant_addons (org_id, scope, source) values ('10000000-0000-0000-0000-000000000002', 'org', 'paid_addon') returning 1$q$);
  perform ad.ok(v like 'ERR:%', 'org B admin cannot insert a paid add-on for itself (' || v || ')');
  perform ad.ok(not exists (select 1 from public.ai_assistant_addons where org_id = b), 'org B still has no add-on row');
  v := ad.run_as(a_admin, $q$with u as (update public.ai_assistant_addons set ends_at = now() + interval '100 years', note = 'self' where org_id = '00000000-0000-0000-0000-000000000001' returning 1) select count(*)::text from u$q$);
  perform ad.ok(v = 'OK:0' or v like 'ERR:%', 'org A admin cannot modify its own add-on row (' || v || ')');
  v := ad.run_as(a_admin, $q$with d as (delete from public.ai_assistant_addons where org_id = '00000000-0000-0000-0000-000000000001' returning 1) select count(*)::text from d$q$);
  perform ad.ok(v = 'OK:0' or v like 'ERR:%', 'org A admin cannot delete its own add-on row (' || v || ')');
  v := ad.run_as(a_finance, $q$insert into public.ai_assistant_addons (org_id, scope, source) values ('00000000-0000-0000-0000-000000000001', 'family', 'complimentary') returning 1$q$);
  perform ad.ok(v like 'ERR:%', 'org A finance cannot insert add-on rows (' || v || ')');
  v := ad.run_as(a_parent, $q$insert into public.ai_assistant_addons (org_id, scope, family_id, source) values ('00000000-0000-0000-0000-000000000001', 'family', '00000000-0000-0000-0000-000000000061', 'paid_addon') returning 1$q$);
  perform ad.ok(v like 'ERR:%', 'org A parent cannot buy itself a family add-on by insert (' || v || ')');
  perform ad.ok((select note is distinct from 'self' and ends_at is null from public.ai_assistant_addons where id = a_row), 'org A add-on unchanged after club attempts');

  -- ---- platform admin grants a paid add-on (audited) -----------------------
  v := ad.run_as(op, $q$insert into public.ai_assistant_addons (org_id, scope, source, status, note) values ('10000000-0000-0000-0000-000000000002', 'org', 'paid_addon', 'active', 'sold') returning 1$q$);
  perform ad.ok(v = 'OK:1', 'platform admin can grant org B a paid add-on (' || v || ')');
  select count(*) into n from public.audit_logs
   where org_id = b and action = 'addon.ai_assistant.granted' and actor_id = op and new_data->>'source' = 'paid_addon';
  perform ad.ok(n = 1, 'grant is audit-logged in the club trail with the operator');
  select count(*) into n from public.platform_audit_log where org_id = b and action = 'addon.ai_assistant.granted' and actor_id = op;
  perform ad.ok(n = 1, 'grant is audit-logged in the platform trail');
  v := ad.run_as(b_admin, $q$select count(*)::text from public.audit_logs where org_id = '10000000-0000-0000-0000-000000000002' and action = 'addon.ai_assistant.granted'$q$);
  perform ad.ok(v = 'OK:1', 'org B admin sees its own add-on grant in the audit log (' || v || ')');
  v := ad.run_as(b_admin, $q$select count(*)::text from public.platform_audit_log$q$);
  perform ad.ok(v = 'OK:0' or v like 'ERR:%', 'club admin cannot read the platform audit log (' || v || ')');

  -- paid add-on needs a live subscription
  v := ad.run_as(b_admin, $q$select public.org_ai_assistant_entitled('10000000-0000-0000-0000-000000000002')::text$q$);
  perform ad.ok(v = 'OK:false', 'paid add-on without a live subscription does not entitle (' || v || ')');
  insert into public.subscriptions (org_id, plan_code, status, currency, billing_interval) values (b, 'starter', 'active', 'USD', 'month');
  v := ad.run_as(b_admin, $q$select public.org_ai_assistant_entitled('10000000-0000-0000-0000-000000000002')::text$q$);
  perform ad.ok(v = 'OK:true', 'paid add-on on a live subscription (any tier) entitles (' || v || ')');
  v := ad.run_as(b_admin, $q$select public.set_org_ai_assistant(true)::text$q$);
  perform ad.ok(v = 'OK:true', 'org B admin can switch it on once entitled (' || v || ')');
  v := ad.run_as(b_admin, $q$select public.org_ai_assistant_enabled('10000000-0000-0000-0000-000000000002')::text$q$);
  perform ad.ok(v = 'OK:true', 'org B effective state ON (entitled + switched on)');

  -- paused add-on: not entitled, effective state off (switch kept)
  v := ad.run_as(op, $q$with u as (update public.ai_assistant_addons set status = 'paused' where org_id = '10000000-0000-0000-0000-000000000002' and scope = 'org' returning 1) select count(*)::text from u$q$);
  perform ad.ok(v = 'OK:1', 'platform admin pauses org B add-on (' || v || ')');
  select count(*) into n from public.audit_logs where org_id = b and action = 'addon.ai_assistant.updated' and old_data->>'status' = 'active' and new_data->>'status' = 'paused';
  perform ad.ok(n = 1, 'status change is audit-logged with old and new values');
  perform ad.ok(not public.org_ai_assistant_enabled(b), 'paused add-on: assistant not effective');
  update public.ai_assistant_addons set status = 'active' where org_id = b and scope = 'org';
  perform ad.ok(public.org_ai_assistant_enabled(b), 'reactivated add-on: assistant effective again');

  -- expired period
  update public.ai_assistant_addons set starts_at = now() - interval '2 days', ends_at = now() - interval '1 day' where org_id = b and scope = 'org';
  perform ad.ok(not public.org_ai_assistant_entitled(b), 'expired add-on does not entitle');
  update public.ai_assistant_addons set ends_at = null where org_id = b and scope = 'org';

  -- suspended club, complimentary or not
  update public.organizations set suspended_at = now() where id = a;
  perform ad.ok(not public.org_ai_assistant_entitled(a), 'suspended club is not entitled even with a complimentary add-on');
  update public.organizations set suspended_at = null where id = a;
  perform ad.ok(public.org_ai_assistant_entitled(a), 'unsuspended founding club entitled again');

  -- ---- family scope: reserved, grants nothing, same-club family only --------
  begin
    insert into public.ai_assistant_addons (org_id, scope, family_id, source) values (b, 'family', '00000000-0000-0000-0000-000000000061', 'paid_addon');
    perform ad.ok(false, 'family add-on pointing at another club''s family is rejected');
  exception when others then
    perform ad.ok(sqlerrm like '%AI_ADDON_FAMILY_ORG_MISMATCH%', 'family add-on pointing at another club''s family is rejected (' || sqlerrm || ')');
  end;
  begin
    insert into public.ai_assistant_addons (org_id, scope, source) values (b, 'family', 'paid_addon');
    perform ad.ok(false, 'family scope without family_id is rejected');
  exception when check_violation then
    perform ad.ok(true, 'family scope without family_id is rejected');
  end;
  begin
    insert into public.ai_assistant_addons (org_id, scope, source) values (a, 'org', 'paid_addon');
    perform ad.ok(false, 'only one club-scope add-on per club');
  exception when unique_violation then
    perform ad.ok(true, 'only one club-scope add-on per club');
  end;
  begin
    insert into public.ai_assistant_addons (org_id, scope, source) values (b, 'org', 'trial');
    perform ad.ok(false, 'unknown source is rejected');
  exception when check_violation then
    perform ad.ok(true, 'unknown source is rejected');
  end;
  -- A family row alone does not entitle the club.
  delete from public.ai_assistant_addons where org_id = b;
  insert into public.ai_assistant_addons (org_id, scope, family_id, source) values (a, 'family', '00000000-0000-0000-0000-000000000061', 'complimentary');
  delete from public.ai_assistant_addons where id = a_row;
  perform ad.ok(not public.org_ai_assistant_entitled(a), 'a family-scope add-on grants nothing to the club');
  perform ad.ok(not public.org_ai_assistant_entitled(b), 'org B not entitled after its add-on was removed');
  select count(*) into n from public.audit_logs where org_id = b and action = 'addon.ai_assistant.removed';
  perform ad.ok(n = 1, 'removal is audit-logged');
end $$;
