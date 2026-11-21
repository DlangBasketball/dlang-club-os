-- ============================================================================
-- Website import polish (migration 20250420102200_site_import_polish.sql)
--
--   A. site_import_map.content_hash: admin writes / reads it for the own club;
--      malformed hashes refused.
--   B. site_settings.contact_phone / contact_address: admin sets them;
--      invalid phone / over-long address refused.
--   C. site_public_settings() returns the contact fields for an ENABLED site
--      only, and only for the requested club.
--   D. Cross-tenant: admin A cannot read / update / delete org B's import map
--      row or settings; finance / coach of A see nothing.
--
-- Fixtures (seed.sql): org A 00…0001 (admin …f1, finance …f2, coach …f3).
-- Org B …0002 (seed_tenants.sql); its admin is created here.
-- SYNTHETIC DATA ONLY.
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
grant execute on all functions in schema fx to authenticated, anon, service_role;

-- ---- Extra fixtures (synthetic) --------------------------------------------
insert into auth.users (id, email) values ('b0000000-0000-0000-0000-0000000006e1', 'admin-b-polish@example.test');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-0000000006e1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000006e1', 'admin');

insert into public.site_settings (org_id, enabled, languages, default_language, contact_phone, contact_address) values
  ('10000000-0000-0000-0000-000000000002', true, '{en,fr}', 'en', '+41 21 000 00 00', 'Synthetic Street 1, 1000 Town');
insert into public.site_settings (org_id, enabled, languages, default_language) values
  ('00000000-0000-0000-0000-000000000001', false, '{en}', 'en');
insert into public.site_import_map (id, org_id, source, source_id, target_table, target_id, content_hash) values
  ('b0000000-0000-0000-0000-000000000611', '10000000-0000-0000-0000-000000000002', 'wp_page', '42', 'site_pages',
   'b0000000-0000-0000-0000-000000000612', repeat('ab', 32));

-- ===========================================================================
-- A. content_hash
-- ===========================================================================
do $$
declare v text;
begin
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.site_import_map (org_id, source, source_id, target_table, target_id, content_hash)
          values ('00000000-0000-0000-0000-000000000001', 'wp_page', '7', 'site_pages', gen_random_uuid(), repeat('0f', 32))
          returning content_hash$q$);
  perform fx.ok(v = 'OK:' || repeat('0f', 32), 'admin A records a content hash (' || left(v, 20) || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.site_import_map set content_hash = 'not-a-hash' where source_id = '7' returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'a malformed hash is refused (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select content_hash from public.site_import_map where source_id = '7'$q$);
  perform fx.ok(v = 'OK:' || repeat('0f', 32), 'admin A reads the own hash');
end $$;

-- ===========================================================================
-- B. Contact fields
-- ===========================================================================
do $$
declare v text;
begin
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.site_settings set contact_phone = '+41 (0)21 555-00-00', contact_address = 'Synthetic Road 2, 1001 Town'
          returning contact_phone$q$);
  perform fx.ok(v = 'OK:+41 (0)21 555-00-00', 'admin A sets phone and address (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.site_settings set contact_phone = 'call me<script>' returning org_id::text$q$);
  perform fx.ok(v like 'ERR:%', 'an invalid phone is refused');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.site_settings set contact_address = repeat('x', 301) returning org_id::text$q$);
  perform fx.ok(v like 'ERR:%', 'an over-long address is refused');
end $$;

-- ===========================================================================
-- C. Public RPC
-- ===========================================================================
do $$
declare v text;
begin
  v := fx.run_as(null, $q$select public.site_public_settings('10000000-0000-0000-0000-000000000002')->>'contact_phone'$q$);
  perform fx.ok(v = 'OK:+41 21 000 00 00', 'anon gets the contact phone of an enabled site (' || v || ')');
  v := fx.run_as(null, $q$select public.site_public_settings('10000000-0000-0000-0000-000000000002')->>'contact_address'$q$);
  perform fx.ok(v = 'OK:Synthetic Street 1, 1000 Town', 'anon gets the contact address of an enabled site');
  v := fx.run_as(null, $q$select coalesce(public.site_public_settings('00000000-0000-0000-0000-000000000001')::text, 'none')$q$);
  perform fx.ok(v = 'OK:none', 'a disabled site returns nothing (' || v || ')');
end $$;

-- ===========================================================================
-- D. Cross-tenant
-- ===========================================================================
do $$
declare v text;
begin
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select count(*)::text from public.site_import_map where org_id = '10000000-0000-0000-0000-000000000002'$q$);
  perform fx.ok(v = 'OK:0', 'admin A cannot read org B import map');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.site_import_map set content_hash = repeat('cd', 32) where id = 'b0000000-0000-0000-0000-000000000611' returning id::text$q$);
  perform fx.ok(v = 'OK:<null>', 'admin A cannot update org B hash');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$delete from public.site_import_map where id = 'b0000000-0000-0000-0000-000000000611' returning id::text$q$);
  perform fx.ok(v = 'OK:<null>', 'admin A cannot delete org B import row');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.site_import_map (org_id, source, source_id, target_table, target_id, content_hash)
          values ('10000000-0000-0000-0000-000000000002', 'wp_page', '99', 'site_pages', gen_random_uuid(), repeat('ef', 32)) returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'admin A cannot insert into org B import map');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.site_settings set contact_phone = '000' where org_id = '10000000-0000-0000-0000-000000000002' returning org_id::text$q$);
  perform fx.ok(v = 'OK:<null>', 'admin A cannot change org B contact phone');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select count(*)::text from public.site_settings where org_id = '10000000-0000-0000-0000-000000000002'$q$);
  perform fx.ok(v = 'OK:0', 'admin A cannot read org B settings');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f2', $q$select count(*)::text from public.site_import_map$q$);
  perform fx.ok(v = 'OK:0', 'finance A sees no import map rows');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.site_settings$q$);
  perform fx.ok(v = 'OK:0', 'coach A sees no site settings');
  v := fx.run_as('b0000000-0000-0000-0000-0000000006e1', $q$select content_hash from public.site_import_map where source_id = '42'$q$);
  perform fx.ok(v = 'OK:' || repeat('ab', 32), 'admin B reads the own hash (unchanged by A)');
  v := fx.run_as('b0000000-0000-0000-0000-0000000006e1', $q$select contact_phone from public.site_settings$q$);
  perform fx.ok(v = 'OK:+41 21 000 00 00', 'org B phone unchanged by A');
end $$;

do $$ begin perform fx.ok(true, 'site import polish suite finished'); end $$;
