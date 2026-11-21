-- ============================================================================
-- Website importer fixes + automatic team slugs
-- (migration 20250420101800_website_import_fixes.sql)
--
--   A. slugify_text: lowercase, accents stripped, '/' and punctuation -> '-'.
--   B. Insert: a team without a slug gets one (auto); duplicates in the same
--      org get -2, -3; the same name in ANOTHER org keeps the plain slug.
--   C. Rename: an automatic slug follows the name; a manual slug (set by an
--      admin) never changes; clearing a slug goes back to automatic.
--   D. Backfill: teams created before the trigger have a slug; existing
--      manual slugs are untouched.
--   E. Cross-tenant: an admin cannot read, rename or re-slug another club's
--      teams; slug uniqueness never looks at another club.
--   F. website_import_map.skipped: admin records a skipped source row without
--      a target; a non-skipped row still needs one; finance / coach see
--      nothing; cross-tenant read / insert / update / delete denied.
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach …f3).
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
insert into auth.users (id, email) values ('b0000000-0000-0000-0000-0000000000e9', 'admin-b-impfix@example.test');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-0000000000e9';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000e9', 'admin');

-- Org B team (service role / owner), same name as an org A team below.
insert into public.teams (id, org_id, name) values
  ('b0000000-0000-0000-0000-000000000f01', '10000000-0000-0000-0000-000000000002', 'Synthetic U18 – National');
insert into public.website_import_map (id, org_id, source, source_id, target_table, target_id) values
  ('b0000000-0000-0000-0000-000000000f02', '10000000-0000-0000-0000-000000000002', 'sportspress_team', '7', 'teams', 'b0000000-0000-0000-0000-000000000f01');

-- ===========================================================================
-- A. slugify_text
-- ===========================================================================
do $$
begin
  perform fx.ok(public.slugify_text('U18 Unity – National') = 'u18-unity-national', 'slugify: dashes and spaces');
  perform fx.ok(public.slugify_text('U16/U18 Mädchen') = 'u16-u18-madchen', 'slugify: slash and umlaut');
  perform fx.ok(public.slugify_text('  Équipe Fémin. ÆØ Straße ') = 'equipe-femin-aeo-strasse', 'slugify: accents, ligatures, trimmed');
  perform fx.ok(length(public.slugify_text(repeat('ab-', 40))) <= 64
                and public.slugify_text(repeat('ab-', 40)) !~ '-$', 'slugify: max 64, no trailing dash');
end $$;

-- ===========================================================================
-- B. Insert
-- ===========================================================================
do $$
declare v text; s text;
begin
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.teams (id, org_id, name) values
          ('a0000000-0000-0000-0000-000000000f01', '00000000-0000-0000-0000-000000000001', 'Synthetic U18 – National')
          returning slug || '|' || slug_auto::text$q$);
  perform fx.ok(v = 'OK:synthetic-u18-national|true', 'new team gets an automatic slug (' || v || ')');

  -- Same name in another season of the same org -> -2, then -3.
  insert into public.seasons (id, org_id, name, starts_on, ends_on) values
    ('a0000000-0000-0000-0000-000000000f50', '00000000-0000-0000-0000-000000000001', 'Synthetic season X', '2030-08-01', '2031-06-30'),
    ('a0000000-0000-0000-0000-000000000f51', '00000000-0000-0000-0000-000000000001', 'Synthetic season Y', '2031-08-01', '2032-06-30');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.teams (id, org_id, season_id, name) values
          ('a0000000-0000-0000-0000-000000000f02', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000f50', 'Synthetic U18 / National')
          returning slug$q$);
  perform fx.ok(v = 'OK:synthetic-u18-national-2', 'duplicate slug in the same org gets -2 (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.teams (id, org_id, season_id, name) values
          ('a0000000-0000-0000-0000-000000000f03', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000f51', 'Synthetic U18 National')
          returning slug$q$);
  perform fx.ok(v = 'OK:synthetic-u18-national-3', 'next duplicate gets -3 (' || v || ')');

  select slug into s from public.teams where id = 'b0000000-0000-0000-0000-000000000f01';
  perform fx.ok(s = 'synthetic-u18-national', 'uniqueness is per org: org B keeps the plain slug (' || coalesce(s, 'null') || ')');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.teams (id, org_id, name, slug) values
          ('a0000000-0000-0000-0000-000000000f04', '00000000-0000-0000-0000-000000000001', 'Synthetic Minis', 'minis-club')
          returning slug || '|' || slug_auto::text$q$);
  perform fx.ok(v = 'OK:minis-club|false', 'a slug given on insert is kept and manual (' || v || ')');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.teams (org_id, name) values ('00000000-0000-0000-0000-000000000001', '***') returning slug$q$);
  perform fx.ok(v ~ '^OK:team(-[0-9]+)?$', 'a name without letters falls back to "team" (' || v || ')');
end $$;

-- ===========================================================================
-- C. Rename / manual edit / reset
-- ===========================================================================
do $$
declare v text;
begin
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.teams set name = 'Synthetic U18 Élite' where id = 'a0000000-0000-0000-0000-000000000f01' returning slug$q$);
  perform fx.ok(v = 'OK:synthetic-u18-elite', 'rename updates an automatic slug (' || v || ')');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.teams set notes = 'x' where id = 'a0000000-0000-0000-0000-000000000f01' returning slug || '|' || slug_auto::text$q$);
  perform fx.ok(v = 'OK:synthetic-u18-elite|true', 'other edits leave the slug alone (' || v || ')');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.teams set slug = 'elite' where id = 'a0000000-0000-0000-0000-000000000f01' returning slug || '|' || slug_auto::text$q$);
  perform fx.ok(v = 'OK:elite|false', 'an admin edit makes the slug manual (' || v || ')');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.teams set name = 'Synthetic U18 Gold' where id = 'a0000000-0000-0000-0000-000000000f01' returning slug$q$);
  perform fx.ok(v = 'OK:elite', 'rename keeps a manual slug (' || v || ')');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.teams set slug = 'minis-club' where id = 'a0000000-0000-0000-0000-000000000f01' returning slug$q$);
  perform fx.ok(v like 'ERR:%', 'a manual slug already used in the org is refused (' || v || ')');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.teams set slug = 'Bad Slug!' where id = 'a0000000-0000-0000-0000-000000000f01' returning slug$q$);
  perform fx.ok(v like 'ERR:%', 'an invalid manual slug is refused (' || v || ')');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.teams set slug = null where id = 'a0000000-0000-0000-0000-000000000f01' returning slug || '|' || slug_auto::text$q$);
  perform fx.ok(v = 'OK:synthetic-u18-gold|true', 'clearing the slug goes back to automatic (' || v || ')');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.teams set name = 'Synthetic U18 / National' where id = 'a0000000-0000-0000-0000-000000000f01' returning slug$q$);
  perform fx.ok(v = 'OK:synthetic-u18-national', 'rename back reuses the free slug, never its own duplicate (' || v || ')');
end $$;

-- ===========================================================================
-- D. Backfill (+ the migration is idempotent: re-applied here on rows that
--    were written without the trigger, as on a database before it)
-- ===========================================================================
alter table public.teams disable trigger trg_teams_slug;
insert into public.teams (id, org_id, name, slug, slug_auto) values
  ('a0000000-0000-0000-0000-000000000f10', '00000000-0000-0000-0000-000000000001', 'Synthetic Legacy Team', null, true),
  ('a0000000-0000-0000-0000-000000000f11', '00000000-0000-0000-0000-000000000001', 'Synthetic Legacy Manual', 'legacy-own-slug', false);
alter table public.teams enable trigger trg_teams_slug;
\i supabase/migrations/20250420101800_website_import_fixes.sql
do $$
declare s text;
begin
  select slug into s from public.teams where id = 'a0000000-0000-0000-0000-000000000f10';
  perform fx.ok(s = 'synthetic-legacy-team', 'backfill gives a legacy team without slug an automatic slug (' || coalesce(s, 'null') || ')');
  select slug into s from public.teams where id = 'a0000000-0000-0000-0000-000000000f11';
  perform fx.ok(s = 'legacy-own-slug', 'backfill leaves an existing manual slug untouched (' || coalesce(s, 'null') || ')');
  select slug into s from public.teams where id = 'a0000000-0000-0000-0000-000000000f01';
  perform fx.ok(s = 'synthetic-u18-national', 're-applying the migration changes no existing slug (' || coalesce(s, 'null') || ')');
end $$;

do $$
declare n int;
begin
  select count(*) into n from public.teams where slug is null;
  perform fx.ok(n = 0, 'every team has a slug after the migration (' || n || ' without)');
  select count(*) into n from (select org_id, slug from public.teams group by 1, 2 having count(*) > 1) d;
  perform fx.ok(n = 0, 'slugs are unique per org (' || n || ' duplicates)');
end $$;

-- ===========================================================================
-- E. Cross-tenant
-- ===========================================================================
do $$
declare v text;
begin
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select count(*)::text from public.teams where org_id = '10000000-0000-0000-0000-000000000002'$q$);
  perform fx.ok(v = 'OK:0', 'cross-tenant: A admin cannot read B teams (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.teams set name = 'Hijack', slug = null where id = 'b0000000-0000-0000-0000-000000000f01' returning slug$q$);
  perform fx.ok(v = 'OK:<null>', 'cross-tenant: A admin cannot rename or re-slug a B team (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.teams (org_id, name) values ('10000000-0000-0000-0000-000000000002', 'Planted') returning slug$q$);
  perform fx.ok(v like 'ERR:%', 'cross-tenant: A admin cannot create a team in B (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000e9',
       $q$select string_agg(slug, ',' order by slug) from public.teams where name like 'Synthetic U18%'$q$);
  perform fx.ok(v = 'OK:synthetic-u18-national', 'B admin sees only the B team slug (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000e9',
       $q$update public.teams set name = 'Synthetic U18 Gold' where id = 'b0000000-0000-0000-0000-000000000f01' returning slug$q$);
  perform fx.ok(v = 'OK:synthetic-u18-gold', 'B rename gets the plain slug even though A has synthetic-u18-gold-? (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$select public.team_unique_slug('10000000-0000-0000-0000-000000000002', 'x', null)$q$);
  perform fx.ok(v like 'ERR:%', 'the slug helper is not callable by app users (' || v || ')');
end $$;

-- ===========================================================================
-- F. website_import_map.skipped
-- ===========================================================================
do $$
declare v text;
begin
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.website_import_map (org_id, source, source_id, target_table, target_id, skipped) values
          ('00000000-0000-0000-0000-000000000001', 'woo_product', '901', 'shop_products', null, true) returning skipped::text$q$);
  perform fx.ok(v = 'OK:true', 'admin remembers a deselected product without a target (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.website_import_map (org_id, source, source_id, target_table, target_id) values
          ('00000000-0000-0000-0000-000000000001', 'woo_product', '902', 'shop_products', null) returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'an imported (not skipped) row needs a target (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.website_import_map (org_id, source, source_id, target_table, target_id) values
          ('00000000-0000-0000-0000-000000000001', 'sportspress_team', '7', 'teams', 'a0000000-0000-0000-0000-000000000f01') returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'admin maps a website team onto an existing app team (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.website_import_map set skipped = false, target_id = gen_random_uuid()
          where org_id = '00000000-0000-0000-0000-000000000001' and source = 'woo_product' and source_id = '901' returning skipped::text$q$);
  perform fx.ok(v = 'OK:false', 'admin re-selects a product (' || v || ')');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f2', $q$select count(*)::text from public.website_import_map$q$);
  perform fx.ok(v = 'OK:0', 'finance reads no import map (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.website_import_map$q$);
  perform fx.ok(v = 'OK:0', 'coach reads no import map (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$insert into public.website_import_map (org_id, source, source_id, target_table, skipped) values
          ('00000000-0000-0000-0000-000000000001', 'woo_product', '903', 'shop_products', true) returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'coach cannot write the import map (' || v || ')');

  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select count(*)::text from public.website_import_map where org_id = '10000000-0000-0000-0000-000000000002'$q$);
  perform fx.ok(v = 'OK:0', 'cross-tenant: A admin cannot read B import map (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.website_import_map set skipped = true, target_id = null where id = 'b0000000-0000-0000-0000-000000000f02' returning id::text$q$);
  perform fx.ok(v = 'OK:<null>', 'cross-tenant: A admin cannot mark a B row skipped (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$delete from public.website_import_map where id = 'b0000000-0000-0000-0000-000000000f02' returning id::text$q$);
  perform fx.ok(v = 'OK:<null>', 'cross-tenant: A admin cannot delete a B row (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.website_import_map (org_id, source, source_id, target_table, skipped) values
          ('10000000-0000-0000-0000-000000000002', 'woo_product', '904', 'shop_products', true) returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'cross-tenant: A admin cannot insert a skipped row into B (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000000e9', $q$select count(*)::text from public.website_import_map$q$);
  perform fx.ok(v = 'OK:1', 'B admin reads only the B import map (' || v || ')');
end $$;
