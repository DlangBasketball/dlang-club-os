-- ============================================================================
-- Club website suite (migration 20250420101900_site_builder.sql)
--
--   A. site_settings / site_pages / site_posts / site_redirects /
--      site_import_map / site_page_versions: admin of the org only; finance,
--      coach, guardian and anon see and write nothing.
--   B. Paths: reserved app paths and language prefixes are refused; unique
--      per club; parent and home page must be the club's own.
--   C. Public RPCs: drafts are invisible to anon; published pages / posts of
--      an ENABLED site are visible only for that club; scheduled pages appear
--      once due; the working copy never leaks.
--   D. Form submissions: anon may insert (enabled site only, status new),
--      never read / update / delete; rate limited per hashed IP.
--   E. Versions are append-only.
--   F. A library image used on a site page cannot be deleted.
--   G. Cross-tenant denial on every new table (read, insert, update, delete).
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach …f3,
-- guardian …f4). Org B …0002 (seed_tenants.sql); its admin is created here.
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
-- A = org A, B = org B. Admin A …f1, admin B …5e1.
insert into auth.users (id, email) values ('b0000000-0000-0000-0000-0000000005e1', 'admin-b-site@example.test');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-0000000005e1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000005e1', 'admin');

-- Org B: enabled site, one published page (with a different working copy),
-- one draft page, one scheduled page, posts, a redirect, a submission.
insert into public.site_settings (org_id, enabled, languages, default_language) values
  ('10000000-0000-0000-0000-000000000002', true, '{en,fr}', 'en');
insert into public.site_pages (id, org_id, path, status, published_at, content, published_content) values
  ('b0000000-0000-0000-0000-000000005a01', '10000000-0000-0000-0000-000000000002', '/about-us', 'published', now() - interval '1 day',
   '{"en": {"title": "B working copy SECRET-DRAFT", "blocks": []}}', '{"en": {"title": "B about", "blocks": []}}'),
  ('b0000000-0000-0000-0000-000000005a02', '10000000-0000-0000-0000-000000000002', '/draft-only', 'draft', null,
   '{"en": {"title": "B draft", "blocks": []}}', null),
  ('b0000000-0000-0000-0000-000000005a03', '10000000-0000-0000-0000-000000000002', '/later', 'scheduled', now() + interval '2 days',
   '{"en": {"title": "B later", "blocks": []}}', '{"en": {"title": "B later", "blocks": []}}');
insert into public.site_page_versions (id, org_id, page_id, content) values
  ('b0000000-0000-0000-0000-000000005a04', '10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000005a01', '{"en": {"title": "v1", "blocks": []}}');
insert into public.site_posts (id, org_id, slug, status, published_at, content) values
  ('b0000000-0000-0000-0000-000000005a05', '10000000-0000-0000-0000-000000000002', 'season-opener', 'published', now() - interval '1 hour',
   '{"en": {"title": "Season opener", "body_html": "<p>Hello</p>"}}'),
  ('b0000000-0000-0000-0000-000000005a06', '10000000-0000-0000-0000-000000000002', 'draft-post', 'draft', null,
   '{"en": {"title": "Draft post"}}');
insert into public.site_redirects (id, org_id, from_path, to_path, status_code) values
  ('b0000000-0000-0000-0000-000000005a07', '10000000-0000-0000-0000-000000000002', '/old-about', '/about-us', 301);
insert into public.site_import_map (id, org_id, source, source_id, target_table, target_id) values
  ('b0000000-0000-0000-0000-000000005a08', '10000000-0000-0000-0000-000000000002', 'wp_page', '11', 'site_pages', 'b0000000-0000-0000-0000-000000005a01');
insert into public.site_form_submissions (id, org_id, kind, name, email, message, consent) values
  ('b0000000-0000-0000-0000-000000005a09', '10000000-0000-0000-0000-000000000002', 'contact', 'Synthetic Person', 'person@example.test', 'Hello', true);

-- ===========================================================================
-- A. Admin only
-- ===========================================================================
do $$
declare v text;
begin
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.site_settings (org_id, enabled, languages, default_language)
          values ('00000000-0000-0000-0000-000000000001', false, '{en,fr,de}', 'fr') returning org_id::text$q$);
  perform fx.ok(v like 'OK:%', 'admin A creates site settings (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.site_settings set languages = '{en,fr,de,de-CH,pt-BR,ar,zh-Hant}' where org_id = '00000000-0000-0000-0000-000000000001' returning org_id::text$q$);
  perform fx.ok(v like 'OK:%', 'any BCP 47 language tag can be enabled (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.site_settings set languages = '{en,english}' where org_id = '00000000-0000-0000-0000-000000000001' returning org_id::text$q$);
  perform fx.ok(v like 'ERR:%', 'a malformed language tag is refused (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.site_settings set languages = '{en,pt_br}' where org_id = '00000000-0000-0000-0000-000000000001' returning org_id::text$q$);
  perform fx.ok(v like 'ERR:%', 'an underscore tag is refused (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.site_settings set languages = '{en,fr,de}', default_language = 'it' where org_id = '00000000-0000-0000-0000-000000000001' returning org_id::text$q$);
  perform fx.ok(v like 'ERR:%', 'the default language must be enabled (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.site_settings set languages = '{en,fr,de}' where org_id = '00000000-0000-0000-0000-000000000001' returning org_id::text$q$);
  perform fx.ok(v like 'OK:%', 'languages reset to en/fr/de (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.site_settings set logo_path = '10000000-0000-0000-0000-000000000002/covers/x.jpg' where org_id = '00000000-0000-0000-0000-000000000001' returning org_id::text$q$);
  perform fx.ok(v like 'ERR:%', 'another club''s library path cannot be the logo (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.site_pages (id, org_id, path, content) values
          ('a0000000-0000-0000-0000-000000005b01', '00000000-0000-0000-0000-000000000001', '/about-us', '{"en": {"title": "A about", "blocks": []}}') returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'admin A creates a page (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.site_page_versions (org_id, page_id, content) values
          ('00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000005b01', '{}') returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'admin A saves a version (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.site_posts (org_id, slug, content) values ('00000000-0000-0000-0000-000000000001', 'hello', '{}') returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'admin A creates a post (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.site_redirects (org_id, from_path, to_path) values ('00000000-0000-0000-0000-000000000001', '/old', '/about-us') returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'admin A creates a redirect (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.site_redirects (org_id, from_path, to_path) values ('00000000-0000-0000-0000-000000000001', '/x', '//evil.example') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'a protocol-relative redirect target is refused (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.site_redirects (org_id, from_path, to_path) values ('00000000-0000-0000-0000-000000000001', '/y', 'javascript:alert(1)') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'a javascript: redirect target is refused (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.site_redirects (org_id, from_path, to_path) values ('00000000-0000-0000-0000-000000000001', '/admin/x', '/') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'a redirect cannot shadow an app path (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.site_import_map (org_id, source, source_id, target_table, target_id) values
          ('00000000-0000-0000-0000-000000000001', 'wp_page', '1', 'site_pages', 'a0000000-0000-0000-0000-000000005b01') returning id::text$q$);
  perform fx.ok(v like 'OK:%', 'admin A writes the import map (' || v || ')');

  foreach v in array array['00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000f4'] loop
    perform fx.ok(fx.run_as(v::uuid, $q$select ((select count(*) from public.site_settings) + (select count(*) from public.site_pages)
                                         + (select count(*) from public.site_posts) + (select count(*) from public.site_redirects)
                                         + (select count(*) from public.site_page_versions) + (select count(*) from public.site_import_map)
                                         + (select count(*) from public.site_form_submissions))::text$q$) = 'OK:0',
                  'non-admin ' || v || ' reads no site rows');
    perform fx.ok(fx.run_as(v::uuid, $q$insert into public.site_pages (org_id, path) values ('00000000-0000-0000-0000-000000000001', '/hack') returning id::text$q$) like 'ERR:%',
                  'non-admin ' || v || ' cannot create pages');
    perform fx.ok(fx.run_as(v::uuid, $q$update public.site_pages set path = '/hacked' where id = 'a0000000-0000-0000-0000-000000005b01' returning id::text$q$) = 'OK:<null>',
                  'non-admin ' || v || ' cannot edit pages');
    perform fx.ok(fx.run_as(v::uuid, $q$delete from public.site_pages where id = 'a0000000-0000-0000-0000-000000005b01' returning id::text$q$) = 'OK:<null>',
                  'non-admin ' || v || ' cannot delete pages');
    perform fx.ok(fx.run_as(v::uuid, $q$update public.site_settings set enabled = true returning org_id::text$q$) = 'OK:<null>',
                  'non-admin ' || v || ' cannot switch the site on');
  end loop;

  v := fx.run_as(null, $q$select count(*)::text from public.site_pages$q$);
  perform fx.ok(v like 'ERR:%' or v = 'OK:0', 'anon cannot read the pages table (' || v || ')');
  v := fx.run_as(null, $q$select count(*)::text from public.site_settings$q$);
  perform fx.ok(v like 'ERR:%' or v = 'OK:0', 'anon cannot read site settings (' || v || ')');
  v := fx.run_as(null, $q$insert into public.site_pages (org_id, path) values ('10000000-0000-0000-0000-000000000002', '/anon') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'anon cannot create pages (' || v || ')');
end $$;

-- ===========================================================================
-- B. Paths
-- ===========================================================================
do $$
declare v text; p text;
begin
  foreach p in array array['/admin', '/admin/x', '/login', '/register/camps', '/book', '/shop', '/club', '/embed', '/api/x',
                           '/fr', '/fr/about-us', '/de', '/_next/x', '/sitemap.xml', '/robots.txt', '/About', '/a b', '/../x', '//x', 'x', '/a/b/c/d/e'] loop
    v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
         format($q$insert into public.site_pages (org_id, path) values ('00000000-0000-0000-0000-000000000001', %L) returning id::text$q$, p));
    perform fx.ok(v like 'ERR:%', 'path ' || p || ' is refused (' || left(v, 60) || ')');
  end loop;
  foreach p in array array['/', '/camps', '/pro-training', '/camps/summer-camps', '/news', '/caf%c3%a9', '/it-camp'] loop
    v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
         format($q$insert into public.site_pages (org_id, path) values ('00000000-0000-0000-0000-000000000001', %L) returning id::text$q$, p));
    perform fx.ok(v like 'OK:%', 'path ' || p || ' is accepted (' || left(v, 60) || ')');
  end loop;
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.site_pages (org_id, path) values ('00000000-0000-0000-0000-000000000001', '/it') returning id::text$q$);
  perform fx.ok(v like 'OK:%', '/it is a normal page while Italian is not enabled (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.site_settings set languages = '{en,fr,de,it}' where org_id = '00000000-0000-0000-0000-000000000001' returning org_id::text$q$);
  perform fx.ok(v like 'ERR:%SITE_PATH_IS_LANGUAGE%', 'a language whose prefix is a page path cannot be enabled (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.site_pages (org_id, path) values ('00000000-0000-0000-0000-000000000001', '/about-us') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'a path is unique per club (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$insert into public.site_pages (org_id, path, parent_id) values ('00000000-0000-0000-0000-000000000001', '/child', 'b0000000-0000-0000-0000-000000005a01') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'another club''s page cannot be the parent (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.site_settings set home_page_id = 'b0000000-0000-0000-0000-000000005a01' where org_id = '00000000-0000-0000-0000-000000000001' returning org_id::text$q$);
  perform fx.ok(v like 'ERR:%', 'another club''s page cannot be the home page (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$update public.site_pages set status = 'published' where id = 'a0000000-0000-0000-0000-000000005b01' returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'publishing needs a published snapshot and date (' || v || ')');
end $$;

-- ===========================================================================
-- C. Public RPCs
-- ===========================================================================
do $$
declare v text;
begin
  v := fx.run_as(null, $q$select public.site_public_page('10000000-0000-0000-0000-000000000002', '/about-us')->'content'->'en'->>'title'$q$);
  perform fx.ok(v = 'OK:B about', 'anon reads the published snapshot of B''s page (' || v || ')');
  v := fx.run_as(null, $q$select public.site_public_page('10000000-0000-0000-0000-000000000002', '/about-us')::text$q$);
  perform fx.ok(v not like '%SECRET-DRAFT%', 'the working copy of a published page never leaks');
  v := fx.run_as(null, $q$select coalesce(public.site_public_page('10000000-0000-0000-0000-000000000002', '/draft-only')::text, 'none')$q$);
  perform fx.ok(v = 'OK:none', 'a draft page is invisible to anon (' || v || ')');
  v := fx.run_as(null, $q$select coalesce(public.site_public_page('10000000-0000-0000-0000-000000000002', '/later')::text, 'none')$q$);
  perform fx.ok(v = 'OK:none', 'a scheduled page is invisible before its date (' || v || ')');
  update public.site_pages set published_at = now() - interval '1 minute' where id = 'b0000000-0000-0000-0000-000000005a03';
  v := fx.run_as(null, $q$select public.site_public_page('10000000-0000-0000-0000-000000000002', '/later')->'content'->'en'->>'title'$q$);
  perform fx.ok(v = 'OK:B later', 'a scheduled page appears once due (' || v || ')');
  v := fx.run_as(null, $q$select coalesce(public.site_public_page('00000000-0000-0000-0000-000000000001', '/about-us')::text, 'none')$q$);
  perform fx.ok(v = 'OK:none', 'A''s page (draft, site off) is not served (' || v || ')');
  v := fx.run_as(null, $q$select count(*)::text from public.site_public_pages('10000000-0000-0000-0000-000000000002')$q$);
  perform fx.ok(v = 'OK:2', 'the public page list has only published pages (' || v || ')');
  v := fx.run_as(null, $q$select count(*)::text from public.site_public_pages('10000000-0000-0000-0000-000000000002') where path = '/draft-only'$q$);
  perform fx.ok(v = 'OK:0', 'drafts are not listed (' || v || ')');
  v := fx.run_as(null, $q$select count(*)::text from public.site_public_posts('10000000-0000-0000-0000-000000000002')$q$);
  perform fx.ok(v = 'OK:1', 'only the published post is listed (' || v || ')');
  v := fx.run_as(null, $q$select coalesce(public.site_public_post('10000000-0000-0000-0000-000000000002', 'draft-post')::text, 'none')$q$);
  perform fx.ok(v = 'OK:none', 'a draft post is invisible to anon (' || v || ')');
  v := fx.run_as(null, $q$select public.site_public_post('10000000-0000-0000-0000-000000000002', 'season-opener')->>'slug'$q$);
  perform fx.ok(v = 'OK:season-opener', 'a published post is public (' || v || ')');
  v := fx.run_as(null, $q$select coalesce(public.site_public_post('00000000-0000-0000-0000-000000000001', 'season-opener')::text, 'none')$q$);
  perform fx.ok(v = 'OK:none', 'B''s post is not visible through A (' || v || ')');
  v := fx.run_as(null, $q$select to_path || ' ' || status_code from public.site_public_redirect('10000000-0000-0000-0000-000000000002', '/old-about')$q$);
  perform fx.ok(v = 'OK:/about-us 301', 'the redirect resolves (' || v || ')');
  v := fx.run_as(null, $q$select coalesce((select to_path from public.site_public_redirect('00000000-0000-0000-0000-000000000001', '/old-about')), 'none')$q$);
  perform fx.ok(v = 'OK:none', 'B''s redirect does not apply to A (' || v || ')');
  v := fx.run_as(null, $q$select public.site_public_settings('10000000-0000-0000-0000-000000000002')->>'default_language'$q$);
  perform fx.ok(v = 'OK:en', 'public settings of an enabled site (' || v || ')');
  v := fx.run_as(null, $q$select coalesce(public.site_public_settings('00000000-0000-0000-0000-000000000001')::text, 'none')$q$);
  perform fx.ok(v = 'OK:none', 'a disabled site exposes no settings (' || v || ')');
  update public.site_settings set enabled = false where org_id = '10000000-0000-0000-0000-000000000002';
  v := fx.run_as(null, $q$select coalesce(public.site_public_page('10000000-0000-0000-0000-000000000002', '/about-us')::text, 'none')$q$);
  perform fx.ok(v = 'OK:none', 'switching the site off hides every page (' || v || ')');
  update public.site_settings set enabled = true where org_id = '10000000-0000-0000-0000-000000000002';
end $$;

-- ===========================================================================
-- D. Form submissions
-- ===========================================================================
do $$
declare v text; i int;
begin
  v := fx.run_as(null, $q$with i as (insert into public.site_form_submissions (org_id, kind, name, email, message, consent, ip_hash)
                          values ('10000000-0000-0000-0000-000000000002', 'contact', 'Synthetic Visitor', 'visitor@example.test', 'Hi', true, 'iphash-1')) select 'ok'$q$);
  perform fx.ok(v like 'OK:%', 'anon submits a form to an enabled site (' || v || ')');
  v := fx.run_as(null, $q$with i as (insert into public.site_form_submissions (org_id, kind, name, email, message, consent)
                          values ('00000000-0000-0000-0000-000000000001', 'contact', 'Synthetic Visitor', 'visitor@example.test', 'Hi', true)) select 'ok'$q$);
  perform fx.ok(v like 'ERR:%', 'anon cannot submit to a club whose site is off (' || v || ')');
  v := fx.run_as(null, $q$with i as (insert into public.site_form_submissions (org_id, kind, name, email, message, consent, status)
                          values ('10000000-0000-0000-0000-000000000002', 'contact', 'X', 'x@example.test', 'Hi', true, 'handled')) select 'ok'$q$);
  perform fx.ok(v like 'ERR:%', 'anon cannot pre-set the status (' || v || ')');
  v := fx.run_as(null, $q$with i as (insert into public.site_form_submissions (org_id, kind, name, email, message, consent)
                          values ('10000000-0000-0000-0000-000000000002', 'contact', 'X', 'x@example.test', 'Hi', false)) select 'ok'$q$);
  perform fx.ok(v like 'ERR:%', 'consent is required (' || v || ')');
  v := fx.run_as(null, $q$select count(*)::text from public.site_form_submissions$q$);
  perform fx.ok(v like 'ERR:%' or v = 'OK:0', 'anon cannot read submissions (' || v || ')');
  v := fx.run_as(null, $q$update public.site_form_submissions set status = 'spam' returning id::text$q$);
  perform fx.ok(v like 'ERR:%' or v = 'OK:<null>', 'anon cannot update submissions (' || v || ')');
  v := fx.run_as(null, $q$delete from public.site_form_submissions returning id::text$q$);
  perform fx.ok(v like 'ERR:%' or v = 'OK:<null>', 'anon cannot delete submissions (' || v || ')');
  for i in 2..5 loop
    perform fx.run_as(null, $q$with i as (insert into public.site_form_submissions (org_id, kind, name, email, message, consent, ip_hash)
                               values ('10000000-0000-0000-0000-000000000002', 'join', 'Synthetic Visitor', 'visitor@example.test', 'Hi', true, 'iphash-1')) select 'ok'$q$);
  end loop;
  v := fx.run_as(null, $q$with i as (insert into public.site_form_submissions (org_id, kind, name, email, message, consent, ip_hash)
                          values ('10000000-0000-0000-0000-000000000002', 'contact', 'Synthetic Visitor', 'visitor@example.test', 'Hi', true, 'iphash-1')) select 'ok'$q$);
  perform fx.ok(v like 'ERR:%RATE_LIMITED%', 'the 6th submission from one IP in 10 minutes is refused (' || v || ')');
  v := fx.run_as(null, $q$with i as (insert into public.site_form_submissions (org_id, kind, name, email, message, consent, ip_hash)
                          values ('10000000-0000-0000-0000-000000000002', 'contact', 'Synthetic Visitor', 'visitor@example.test', 'Hi', true, 'iphash-2')) select 'ok'$q$);
  perform fx.ok(v like 'OK:%', 'another IP can still submit (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000005e1', $q$select count(*)::text from public.site_form_submissions$q$);
  perform fx.ok(v = 'OK:7', 'admin B reads the club''s submissions (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000005e1', $q$update public.site_form_submissions set status = 'handled' where id = 'b0000000-0000-0000-0000-000000005a09' returning status$q$);
  perform fx.ok(v = 'OK:handled', 'admin B handles a submission (' || v || ')');
  v := (select count(*)::text from public.audit_logs where target_table = 'site_form_submissions');
  perform fx.ok(v::int >= 7, 'submissions are audit-logged (' || v || ')');
end $$;

-- ===========================================================================
-- E. Versions append-only, F. media in use
-- ===========================================================================
do $$
declare v text;
begin
  v := fx.run_as('b0000000-0000-0000-0000-0000000005e1', $q$update public.site_page_versions set note = 'x' returning id::text$q$);
  perform fx.ok(v like 'ERR:%' or v = 'OK:<null>', 'versions cannot be edited (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000005e1', $q$select count(*)::text from public.site_page_versions$q$);
  perform fx.ok(v = 'OK:1', 'admin B reads the page history (' || v || ')');

  insert into public.media_assets (id, org_id, path, kind) values
    ('b0000000-0000-0000-0000-000000005a10', '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002/gallery/site-photo.jpg', 'gallery');
  update public.site_pages set content = jsonb_build_object('en', jsonb_build_object('title', 'B about', 'blocks',
        jsonb_build_array(jsonb_build_object('id', 'b1', 'type', 'image', 'image', jsonb_build_object('path', '10000000-0000-0000-0000-000000000002/gallery/site-photo.jpg')))))
   where id = 'b0000000-0000-0000-0000-000000005a01';
  v := fx.run_as('b0000000-0000-0000-0000-0000000005e1', $q$delete from public.media_assets where id = 'b0000000-0000-0000-0000-000000005a10' returning id::text$q$);
  perform fx.ok(v like 'ERR:%MEDIA_IN_USE%', 'an image used on a page cannot be deleted (' || v || ')');
end $$;

-- ===========================================================================
-- G. Cross-tenant denial (admin A vs org B rows)
-- ===========================================================================
do $$
declare v text; t text; ids jsonb := jsonb_build_object(
  'site_pages', 'b0000000-0000-0000-0000-000000005a01', 'site_page_versions', 'b0000000-0000-0000-0000-000000005a04',
  'site_posts', 'b0000000-0000-0000-0000-000000005a05', 'site_redirects', 'b0000000-0000-0000-0000-000000005a07',
  'site_import_map', 'b0000000-0000-0000-0000-000000005a08', 'site_form_submissions', 'b0000000-0000-0000-0000-000000005a09');
begin
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.site_settings where org_id = '10000000-0000-0000-0000-000000000002'$q$);
  perform fx.ok(v = 'OK:0', 'cross-tenant: A admin cannot read B site settings (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$update public.site_settings set enabled = false where org_id = '10000000-0000-0000-0000-000000000002' returning org_id::text$q$);
  perform fx.ok(v = 'OK:<null>', 'cross-tenant: A admin cannot update B site settings (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$delete from public.site_settings where org_id = '10000000-0000-0000-0000-000000000002' returning org_id::text$q$);
  perform fx.ok(v = 'OK:<null>', 'cross-tenant: A admin cannot delete B site settings (' || v || ')');

  for t in select jsonb_object_keys(ids) loop
    v := fx.run_as('00000000-0000-0000-0000-0000000000f1', format('select count(*)::text from public.%I where org_id = %L', t, '10000000-0000-0000-0000-000000000002'));
    perform fx.ok(v = 'OK:0', 'cross-tenant: A admin cannot read B ' || t || ' (' || v || ')');
    v := fx.run_as('00000000-0000-0000-0000-0000000000f1', format('update public.%I set created_at = now() where id = %L returning id::text', t, ids->>t));
    perform fx.ok(v = 'OK:<null>' or v like 'ERR:%', 'cross-tenant: A admin cannot update B ' || t || ' (' || v || ')');
    v := fx.run_as('00000000-0000-0000-0000-0000000000f1', format('delete from public.%I where id = %L returning id::text', t, ids->>t));
    perform fx.ok(v = 'OK:<null>', 'cross-tenant: A admin cannot delete B ' || t || ' (' || v || ')');
  end loop;

  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$insert into public.site_pages (org_id, path) values ('10000000-0000-0000-0000-000000000002', '/x') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'cross-tenant: A admin cannot insert B pages (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$insert into public.site_posts (org_id, slug) values ('10000000-0000-0000-0000-000000000002', 'x') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'cross-tenant: A admin cannot insert B posts (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$insert into public.site_redirects (org_id, from_path, to_path) values ('10000000-0000-0000-0000-000000000002', '/z', '/') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'cross-tenant: A admin cannot insert B redirects (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$insert into public.site_settings (org_id) values ('10000000-0000-0000-0000-000000000002') returning org_id::text$q$);
  perform fx.ok(v like 'ERR:%', 'cross-tenant: A admin cannot insert B settings (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$insert into public.site_import_map (org_id, source, source_id, target_table, target_id) values ('10000000-0000-0000-0000-000000000002', 'wp_page', '99', 'site_pages', gen_random_uuid()) returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'cross-tenant: A admin cannot insert B import map (' || v || ')');
  v := fx.run_as('00000000-0000-0000-0000-0000000000f1', $q$insert into public.site_page_versions (org_id, page_id, content) values ('00000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000005a01', '{}') returning id::text$q$);
  perform fx.ok(v like 'ERR:%', 'cross-tenant: A admin cannot attach a version to B''s page (' || v || ')');

  v := fx.run_as('b0000000-0000-0000-0000-0000000005e1', $q$select count(*)::text from public.site_pages$q$);
  perform fx.ok(v = 'OK:3', 'B admin reads only B pages (' || v || ')');
  v := fx.run_as('b0000000-0000-0000-0000-0000000005e1', $q$select count(*)::text from public.site_pages where org_id = '00000000-0000-0000-0000-000000000001'$q$);
  perform fx.ok(v = 'OK:0', 'cross-tenant: B admin cannot read A pages (' || v || ')');
end $$;
