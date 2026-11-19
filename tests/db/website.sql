-- ============================================================================
-- Website connection suite (migration 20250420101700_website_connect.sql)
--
--   A. website_settings: admin of the org reads / writes; finance, coach and
--      guardian see nothing; origins must be exact https origins.
--   B. website_secrets: unreadable and unwritable for EVERY app user (admin
--      included); only the service role reads it.
--   C. website_webhook_deliveries: admins read; nobody but the service role
--      queues or updates; one pending row per club + resource.
--   D. website_import_map / website_news: admin only, unique source ids.
--   E. Public flags: teams / coaches / events / club_events / club_alerts
--      default to NOT public; the anon embed-origins RPC returns origins only
--      for an enabled connection and never another club's.
--   F. Public roster: only with the club switch + public team + public roster
--      + recorded media consent (latest decision wins); first name + initial.
--   G. Cross-tenant denial on every new table (read, insert, update, delete).
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach …f3,
-- guardian …f4 of athlete …071). Org B …0002 (seed_tenants.sql); its admin
-- is created here. SYNTHETIC DATA ONLY.
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
insert into auth.users (id, email) values ('b0000000-0000-0000-0000-0000000000e1', 'admin-b-web@example.test');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-0000000000e1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000e1', 'admin');

insert into public.teams (id, org_id, name) values
  ('a0000000-0000-0000-0000-000000000e01', '00000000-0000-0000-0000-000000000001', 'Synthetic Web U12');
insert into public.team_memberships (org_id, team_id, athlete_id, jersey_number) values
  ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000e01', '00000000-0000-0000-0000-000000000071', 7),
  ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000e01', '00000000-0000-0000-0000-000000000072', 9),
  ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000e01', '00000000-0000-0000-0000-000000000073', 11);

-- Org B settings + news (service role), used for cross-tenant checks.
insert into public.website_settings (org_id, enabled, allowed_origins) values
  ('10000000-0000-0000-0000-000000000002', true, '{https://www.riverside.example}');
insert into public.website_news (id, org_id, title, is_public) values
  ('b0000000-0000-0000-0000-000000000e02', '10000000-0000-0000-0000-000000000002', 'Synthetic B news', true);
insert into public.website_secrets (org_id, secret_enc) values
  ('10000000-0000-0000-0000-000000000002', 'plain:synthetic-secret-b-0000000000');
insert into public.website_webhook_deliveries (id, org_id, resource) values
  ('b0000000-0000-0000-0000-000000000e03', '10000000-0000-0000-0000-000000000002', 'news');
insert into public.website_import_map (id, org_id, source, source_id, target_table, target_id) values
  ('b0000000-0000-0000-0000-000000000e04', '10000000-0000-0000-0000-000000000002', 'wp_post', '1', 'website_news', 'b0000000-0000-0000-0000-000000000e02');

-- ===========================================================================
-- A. website_settings
-- ===========================================================================
do $$
declare v text;
begin
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.website_settings (org_id, enabled, website_url, allowed_origins)
          values ('00000000-0000-0000-0000-000000000001', true, 'https://www.club-a.example', '{https://www.club-a.example,https://club-a.example}')
          returning org_id::text$q$);
  perform fx.ok(v like 'OK:%', 'admin saves the website settings (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.website_settings$q$);
  perform fx.ok(v = 'OK:1', 'admin reads only their own club settings (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.website_settings set allowed_origins = '{https://www.club-a.example/path}' where org_id = '00000000-0000-0000-0000-000000000001' returning org_id::text$q$);
  perform fx.ok(v like 'ERR:%', 'an origin with a path is refused (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.website_settings set allowed_origins = '{http://www.club-a.example}' where org_id = '00000000-0000-0000-0000-000000000001' returning org_id::text$q$);
  perform fx.ok(v like 'ERR:%', 'a plain http origin is refused (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.website_settings set allowed_origins = '{https://*.club-a.example}' where org_id = '00000000-0000-0000-0000-000000000001' returning org_id::text$q$);
  perform fx.ok(v like 'ERR:%', 'a wildcard origin is refused (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.website_settings set embed_theme = 'neon' where org_id = '00000000-0000-0000-0000-000000000001' returning org_id::text$q$);
  perform fx.ok(v like 'ERR:%', 'an unknown embed theme is refused (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f2', $q$select count(*)::text from public.website_settings$q$);
  perform fx.ok(v = 'OK:0', 'finance reads no website settings (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.website_settings$q$);
  perform fx.ok(v = 'OK:0', 'coach reads no website settings (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.website_settings$q$);
  perform fx.ok(v = 'OK:0', 'guardian reads no website settings (' || v || ')');
  v := fx.run_as(null, $q$select count(*)::text from public.website_settings$q$);
  perform fx.ok(v like 'ERR:%' or v = 'OK:0', 'anon reads no website settings (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$update public.website_settings set enabled = false where org_id = '00000000-0000-0000-0000-000000000001' returning org_id::text$q$);
  perform fx.ok(v = 'OK:<null>', 'finance cannot change the website settings (' || v || ')');
  -- roster switch defaults to off
  perform fx.ok((select not roster_public from public.website_settings where org_id = '00000000-0000-0000-0000-000000000001'),
                'rosters are off by default');
end $$;

-- ===========================================================================
-- B. website_secrets: never readable by an app user
-- ===========================================================================
do $$
declare v text;
begin
  v := fx.run_service($q$insert into public.website_secrets (org_id, secret_enc) values
        ('00000000-0000-0000-0000-000000000001', 'plain:synthetic-secret-a-0000000000') returning org_id::text$q$);
  perform fx.ok(v like 'OK:%', 'service role stores the signing secret (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.website_secrets$q$);
  perform fx.ok(v like 'ERR:%' or v = 'OK:0', 'admin cannot read the signing secret (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f2', $q$select count(*)::text from public.website_secrets$q$);
  perform fx.ok(v like 'ERR:%' or v = 'OK:0', 'finance cannot read the signing secret (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.website_secrets$q$);
  perform fx.ok(v like 'ERR:%' or v = 'OK:0', 'guardian cannot read the signing secret (' || v || ')');
  v := fx.run_as(null, $q$select count(*)::text from public.website_secrets$q$);
  perform fx.ok(v like 'ERR:%' or v = 'OK:0', 'anon cannot read the signing secret (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.website_secrets (org_id, secret_enc) values ('00000000-0000-0000-0000-000000000001', 'plain:attacker-chosen-secret-000') returning org_id::text$q$);
  perform fx.ok(v like 'ERR:%', 'admin cannot write the secret directly (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.website_secrets set secret_enc = 'plain:attacker-chosen-secret-000' returning org_id::text$q$);
  perform fx.ok(v like 'ERR:%' or v = 'OK:<null>', 'admin cannot overwrite the secret (' || v || ')');
  v := fx.run_service($q$select count(*)::text from public.website_secrets where org_id = '00000000-0000-0000-0000-000000000001'$q$);
  perform fx.ok(v = 'OK:1', 'service role reads the secret for signing (' || v || ')');
  perform fx.ok((select secret_enc from public.website_secrets where org_id = '00000000-0000-0000-0000-000000000001') = 'plain:synthetic-secret-a-0000000000',
                'secret unchanged after the refused writes');
end $$;

-- ===========================================================================
-- C. website_webhook_deliveries
-- ===========================================================================
do $$
declare v text;
begin
  v := fx.run_service($q$insert into public.website_webhook_deliveries (org_id, resource) values
        ('00000000-0000-0000-0000-000000000001', 'camps') returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'service role queues a delivery (' || v || ')');
  v := fx.run_service($q$insert into public.website_webhook_deliveries (org_id, resource) values
        ('00000000-0000-0000-0000-000000000001', 'camps') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'a second pending delivery for the same resource is refused (coalesced) (' || v || ')');
  v := fx.run_service($q$insert into public.website_webhook_deliveries (org_id, resource) values
        ('00000000-0000-0000-0000-000000000001', 'secrets') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'an unknown resource is refused (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.website_webhook_deliveries$q$);
  perform fx.ok(v = 'OK:1', 'admin reads their own deliveries only (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.website_webhook_deliveries (org_id, resource) values ('00000000-0000-0000-0000-000000000001', 'shop') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'admin cannot queue deliveries directly (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.website_webhook_deliveries set status = 'sent' returning id::text$q$);
  perform fx.ok(v like 'ERR:%' or v = 'OK:<null>', 'admin cannot mark deliveries sent (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.website_webhook_deliveries$q$);
  perform fx.ok(v = 'OK:0', 'coach reads no deliveries (' || v || ')');
end $$;

-- ===========================================================================
-- D. website_import_map / website_news
-- ===========================================================================
do $$
declare v text;
begin
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.website_news (org_id, title, excerpt, is_public) values
          ('00000000-0000-0000-0000-000000000001', 'Synthetic A news', 'Short', true) returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'admin writes a news item (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.website_news (org_id, title, link_url) values
          ('00000000-0000-0000-0000-000000000001', 'Bad link', 'javascript:alert(1)') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'a non-https news link is refused (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.website_news$q$);
  perform fx.ok(v = 'OK:0', 'guardian reads no news rows through RLS (public via the API only) (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.website_import_map (org_id, source, source_id, target_table, target_id) values
          ('00000000-0000-0000-0000-000000000001', 'wp_post', '42', 'website_news', gen_random_uuid()) returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'admin records an import mapping (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.website_import_map (org_id, source, source_id, target_table, target_id) values
          ('00000000-0000-0000-0000-000000000001', 'wp_post', '42', 'website_news', gen_random_uuid()) returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'the same source id is mapped once per club (idempotent import) (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.website_import_map (org_id, source, source_id, target_table, target_id) values
          ('00000000-0000-0000-0000-000000000001', 'sportspress_player', '1', 'athletes', gen_random_uuid()) returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'player imports are impossible (no minors'' data) (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f2', $q$select count(*)::text from public.website_import_map$q$);
  perform fx.ok(v = 'OK:0', 'finance reads no import map (' || v || ')');
end $$;

-- ===========================================================================
-- E. Public flags + embed origins
-- ===========================================================================
do $$
declare v text;
begin
  perform fx.ok((select not is_public and not roster_public and not cover_public from public.teams where id = 'a0000000-0000-0000-0000-000000000e01'),
                'a new team is not public, roster and cover not public');
  perform fx.ok((select bool_and(not is_public and not photo_public) from public.coaches), 'coaches default to not public');
  perform fx.ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'events'
                             and column_name = 'is_public' and column_default is not null), 'events follow their team by default (is_public null)');
  perform fx.ok((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'club_alerts' and column_name = 'is_public') = 'false',
                'club alerts default to not public');
  v := fx.run_as(null, $q$select array_to_string(public.website_embed_origins('dlang', null), ',')$q$);
  perform fx.ok(v = 'OK:https://www.club-a.example,https://club-a.example', 'anon gets the enabled club''s embed origins (' || v || ')');
  v := fx.run_as(null, $q$select array_to_string(public.website_embed_origins('riverside', null), ',')$q$);
  perform fx.ok(v = 'OK:https://www.riverside.example', 'each club gets only its own origins (' || v || ')');
  update public.website_settings set enabled = false where org_id = '10000000-0000-0000-0000-000000000002';
  v := fx.run_as(null, $q$select coalesce(array_to_string(public.website_embed_origins('riverside', null), ','), '')$q$);
  perform fx.ok(v = 'OK:', 'a disabled connection yields no embed origins (' || v || ')');
  update public.website_settings set enabled = true where org_id = '10000000-0000-0000-0000-000000000002';
  v := fx.run_as(null, $q$select coalesce(array_to_string(public.website_embed_origins('no-such-club', null), ','), '')$q$);
  perform fx.ok(v = 'OK:', 'an unknown club yields no embed origins (' || v || ')');
  v := fx.run_as(null, $q$select public.website_public_roster('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000e01')::text$q$);
  perform fx.ok(v like 'ERR:%', 'anon cannot call the roster function (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f4', $q$select public.athlete_has_media_consent('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000071')::text$q$);
  perform fx.ok(v like 'ERR:%', 'app users cannot probe media consent of any child (' || v || ')');
end $$;

-- ===========================================================================
-- F. Public roster: consent filter
-- ===========================================================================
do $$
declare v text;
begin
  v := fx.run_service($q$select count(*)::text from public.website_public_roster('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000e01')$q$);
  perform fx.ok(v = 'OK:0', 'no roster while the team / club switches are off (' || v || ')');
  update public.teams set is_public = true, roster_public = true where id = 'a0000000-0000-0000-0000-000000000e01';
  v := fx.run_service($q$select count(*)::text from public.website_public_roster('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000e01')$q$);
  perform fx.ok(v = 'OK:0', 'no roster while the club roster switch is off (' || v || ')');
  update public.website_settings set roster_public = true where org_id = '00000000-0000-0000-0000-000000000001';
  -- 071 accepted the media form (seed); 072 has no media consent; 073 grants it in the parent app.
  insert into public.family_consent_events (org_id, family_id, athlete_id, kind, granted)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-000000000073', 'media', true);
  v := fx.run_service($q$select string_agg(display_name || '#' || coalesce(jersey_number::text, '-'), ',' order by display_name)
                         from public.website_public_roster('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000e01')$q$);
  perform fx.ok(v = 'OK:Mateo L.#7,Sophia M.#11', 'roster lists consented children only, first name + initial (' || v || ')');
  -- 071's guardian withdraws media consent: the latest decision wins over the form.
  insert into public.family_consent_events (org_id, family_id, athlete_id, kind, granted)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000071', 'media', false);
  v := fx.run_service($q$select string_agg(display_name, ',') from public.website_public_roster('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000e01')$q$);
  perform fx.ok(v = 'OK:Sophia M.', 'a withdrawn consent removes the child at once (' || v || ')');
  v := fx.run_service($q$select count(*)::text from public.website_public_roster('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000e01')$q$);
  perform fx.ok(v = 'OK:0', 'another club cannot list this team''s roster (' || v || ')');
end $$;

-- ===========================================================================
-- G. Cross-tenant denial (org A admin vs org B rows, and vice versa)
-- ===========================================================================
do $$
declare v text;
begin
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.website_settings where org_id = '10000000-0000-0000-0000-000000000002'$q$);
  perform fx.ok(v = 'OK:0', 'cross-tenant: A admin cannot read B settings (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$update public.website_settings set enabled = false where org_id = '10000000-0000-0000-0000-000000000002' returning org_id::text$q$);
  perform fx.ok(v = 'OK:<null>', 'cross-tenant: A admin cannot update B settings (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$delete from public.website_settings where org_id = '10000000-0000-0000-0000-000000000002' returning org_id::text$q$);
  perform fx.ok(v = 'OK:<null>', 'cross-tenant: A admin cannot delete B settings (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$insert into public.website_settings (org_id, enabled) values ('10000000-0000-0000-0000-000000000002', true) returning org_id::text$q$);
  perform fx.ok(v like 'ERR:%', 'cross-tenant: A admin cannot insert B settings (' || v || ')');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.website_secrets where org_id = '10000000-0000-0000-0000-000000000002'$q$);
  perform fx.ok(v like 'ERR:%' or v = 'OK:0', 'cross-tenant: A admin cannot read B secret (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000e1', $q$select count(*)::text from public.website_secrets$q$);
  perform fx.ok(v like 'ERR:%' or v = 'OK:0', 'B admin cannot read even their own secret (' || v || ')');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.website_webhook_deliveries where org_id = '10000000-0000-0000-0000-000000000002'$q$);
  perform fx.ok(v = 'OK:0', 'cross-tenant: A admin cannot read B deliveries (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$delete from public.website_webhook_deliveries where id = 'b0000000-0000-0000-0000-000000000e03' returning id::text$q$);
  perform fx.ok(v = 'OK:<null>', 'cross-tenant: A admin cannot delete B deliveries (' || v || ')');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.website_news where org_id = '10000000-0000-0000-0000-000000000002'$q$);
  perform fx.ok(v = 'OK:0', 'cross-tenant: A admin cannot read B news (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$update public.website_news set title = 'x' where id = 'b0000000-0000-0000-0000-000000000e02' returning id::text$q$);
  perform fx.ok(v = 'OK:<null>', 'cross-tenant: A admin cannot update B news (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$delete from public.website_news where id = 'b0000000-0000-0000-0000-000000000e02' returning id::text$q$);
  perform fx.ok(v = 'OK:<null>', 'cross-tenant: A admin cannot delete B news (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$insert into public.website_news (org_id, title) values ('10000000-0000-0000-0000-000000000002', 'x') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'cross-tenant: A admin cannot insert B news (' || v || ')');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.website_import_map where org_id = '10000000-0000-0000-0000-000000000002'$q$);
  perform fx.ok(v = 'OK:0', 'cross-tenant: A admin cannot read B import map (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$update public.website_import_map set source_id = 'x' where id = 'b0000000-0000-0000-0000-000000000e04' returning id::text$q$);
  perform fx.ok(v = 'OK:<null>', 'cross-tenant: A admin cannot update B import map (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$delete from public.website_import_map where id = 'b0000000-0000-0000-0000-000000000e04' returning id::text$q$);
  perform fx.ok(v = 'OK:<null>', 'cross-tenant: A admin cannot delete B import map (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$insert into public.website_import_map (org_id, source, source_id, target_table, target_id) values ('10000000-0000-0000-0000-000000000002', 'wp_post', '9', 'website_news', gen_random_uuid()) returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'cross-tenant: A admin cannot insert into B import map (' || v || ')');

  v := fx.run_as('b0000000-0000-0000-0000-0000000000e1', $q$select count(*)::text from public.website_settings$q$);
  perform fx.ok(v = 'OK:1', 'B admin reads only B settings (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000e1', $q$select count(*)::text from public.website_news$q$);
  perform fx.ok(v = 'OK:1', 'B admin reads only B news (' || v || ')');
end $$;
