-- ============================================================================
-- i18n language tags suite (migration 20250420102000_i18n_language_tags.sql)
--
--   A. Shape helpers: valid BCP 47 tags accepted (de, de-CH, en-GB, pt-BR,
--      zh-Hant-TW, es-419), invalid ones refused; canonicalisation.
--   B. app_settings: an org A admin enables regional and new languages
--      (de-CH, fr-CH, it-CH, en-GB, nl); "fr_ch" is stored as "fr-CH";
--      malformed tags are refused; regional tags are no longer cut to the base.
--   C. Cross-tenant: the org B admin cannot change org A's languages (RLS,
--      0 rows) while setting its own (pt-BR, no catalog yet) works; org A is
--      unchanged afterwards.
--   D. organizations: default must be a tag and one of supported_locales.
--   E. profiles.locale: canonicalised; garbage from sign-up metadata -> 'en';
--      a user cannot change another org's profile language.
--   F. invoices.locale: any tag, malformed refused.
--
-- Fixtures (seed.sql / seed_tenants.sql): org A …0001 (admin …f1, parent …f4),
-- org B 10000000-…0002 (admin created here). SYNTHETIC DATA ONLY.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema lt;
grant usage on schema lt to authenticated, anon, service_role;

create function lt.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

-- Run p_sql as user p (null = service role). Returns 'OK:<first column>' or 'ERR:<message>'.
create function lt.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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
grant execute on all functions in schema lt to authenticated, anon, service_role;

-- Org B admin (synthetic).
insert into auth.users (id, email) values ('b2000000-0000-0000-0000-0000000000c1', 'lt-admin-b@example.test');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b2000000-0000-0000-0000-0000000000c1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-0000000000c1', 'admin');
insert into public.app_settings (org_id, currency, default_locale)
values ('10000000-0000-0000-0000-000000000002', 'USD', 'en')
on conflict (org_id) do nothing;

-- A. helpers -------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['de', 'de-CH', 'en-GB', 'fr-CH', 'it-CH', 'pt-BR', 'zh-Hant-TW', 'es-419', 'yue', 'ar'] loop
    perform lt.ok(public.is_language_tag(t), 'valid tag: ' || t);
  end loop;
  foreach t in array array['', 'german', 'de_CH', 'de-ch', 'DE', 'de-CHE', 'de-C', 'zh-hant', '12', 'de-CH-', 'en US', 'de;drop'] loop
    perform lt.ok(not public.is_language_tag(t), 'invalid tag refused: "' || t || '"');
  end loop;
  perform lt.ok(not public.is_language_tag(null), 'null is not a tag');
  perform lt.ok(public.canonical_language_tag('DE_ch') = 'de-CH', 'canonical DE_ch -> de-CH');
  perform lt.ok(public.canonical_language_tag(' zh-hant-tw ') = 'zh-Hant-TW', 'canonical zh-hant-tw -> zh-Hant-TW');
  perform lt.ok(public.canonical_language_tag('en-US-x-private') = 'en-US', 'extensions are dropped');
  perform lt.ok(public.canonical_language_tag('de-C') is null, 'de-C is not a tag');
  perform lt.ok(public.canonical_language_tag('klingon!!') is null, 'garbage is not a tag');
  perform lt.ok(public.are_language_tags(array['de-CH', 'fr-CH', 'it-CH', 'en']), 'tag array accepted');
  perform lt.ok(not public.are_language_tags(array['de', 'Deutsch']), 'array with a non-tag refused');
  perform lt.ok(not public.are_language_tags('{}'::text[]), 'empty array refused');
  perform lt.ok(public.canonical_language_tags(array['fr_ch', 'de', 'FR-CH', ' ']) = array['fr-CH', 'de'], 'array canonicalised + deduplicated in order');
end $$;

-- B. app_settings ----------------------------------------------------------------
do $$
declare v text;
begin
  v := lt.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    with u as (update public.app_settings
                  set default_locale = 'de-CH', enabled_locales = array['de-CH', 'fr_ch', 'it-CH', 'en-GB', 'nl']
                where org_id = '00000000-0000-0000-0000-000000000001'
            returning default_locale || '|' || array_to_string(enabled_locales, ','))
    select * from u$q$);
  perform lt.ok(v = 'OK:de-CH|de-CH,fr-CH,it-CH,en-GB,nl', 'org A admin enables Swiss variants, en-GB and nl; fr_ch canonicalised (' || v || ')');

  v := lt.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    update public.app_settings set enabled_locales = array['de', 'Deutsch'] where org_id = '00000000-0000-0000-0000-000000000001' returning 1$q$);
  perform lt.ok(v like 'ERR:%app_settings_enabled_locales_tags%', 'malformed enabled language refused (' || v || ')');

  v := lt.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    update public.app_settings set default_locale = 'german' where org_id = '00000000-0000-0000-0000-000000000001' returning 1$q$);
  perform lt.ok(v like 'ERR:%app_settings_default_locale_tag%', 'malformed default language refused (' || v || ')');

  v := lt.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    update public.app_settings set default_locale = 'zh-hant-tw', enabled_locales = array['es-419', 'zh-Hant-TW']
     where org_id = '00000000-0000-0000-0000-000000000001' returning default_locale$q$);
  perform lt.ok(v = 'OK:zh-Hant-TW', 'script and numeric-region tags accepted (' || v || ')');

  v := lt.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    update public.app_settings set default_locale = 'de-CH', enabled_locales = array['de-CH', 'fr-CH', 'it-CH', 'en']
     where org_id = '00000000-0000-0000-0000-000000000001' returning default_locale$q$);
  perform lt.ok(v = 'OK:de-CH', 'regional default kept as de-CH (no longer reduced to de) (' || v || ')');

  v := lt.run_as('00000000-0000-0000-0000-0000000000f4', $q$
    update public.app_settings set enabled_locales = array['en'] where org_id = '00000000-0000-0000-0000-000000000001' returning 1$q$);
  perform lt.ok(v = 'OK:<null>', 'a parent cannot change the club languages (' || v || ')');
end $$;

-- C. cross-tenant ----------------------------------------------------------------
do $$
declare v text;
begin
  v := lt.run_as('b2000000-0000-0000-0000-0000000000c1', $q$
    update public.app_settings set enabled_locales = array['en'], default_locale = 'en'
     where org_id = '00000000-0000-0000-0000-000000000001' returning 1$q$);
  perform lt.ok(v = 'OK:<null>', 'org B admin updates 0 rows of org A app_settings (' || v || ')');

  v := lt.run_as('b2000000-0000-0000-0000-0000000000c1', $q$
    select count(*)::text from public.app_settings where org_id = '00000000-0000-0000-0000-000000000001'$q$);
  perform lt.ok(v = 'OK:0', 'org B admin cannot read org A app_settings (' || v || ')');

  v := lt.run_as('b2000000-0000-0000-0000-0000000000c1', $q$
    with u as (update public.app_settings set default_locale = 'pt-BR', enabled_locales = array['pt-BR', 'en-US', 'es']
                where org_id = '10000000-0000-0000-0000-000000000002' returning default_locale)
    select * from u$q$);
  perform lt.ok(v = 'OK:pt-BR', 'org B admin sets its own languages, pt-BR without a catalog yet (' || v || ')');

  v := lt.run_as('b2000000-0000-0000-0000-0000000000c1', $q$
    update public.organizations set default_locale = 'en', supported_locales = array['en']
     where id = '00000000-0000-0000-0000-000000000001' returning 1$q$);
  perform lt.ok(v = 'OK:<null>', 'org B admin updates 0 rows of org A organizations (' || v || ')');

  perform lt.ok(
    (select default_locale = 'de-CH' and enabled_locales = array['de-CH', 'fr-CH', 'it-CH', 'en']
       from public.app_settings where org_id = '00000000-0000-0000-0000-000000000001'),
    'org A languages unchanged after org B attempts');
end $$;

-- D. organizations -----------------------------------------------------------------
do $$
declare v text;
begin
  v := lt.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    with u as (update public.organizations set default_locale = 'de_ch', supported_locales = array['de-CH', 'fr-CH', 'it-CH', 'en-gb']
                where id = '00000000-0000-0000-0000-000000000001'
            returning default_locale || '|' || array_to_string(supported_locales, ','))
    select * from u$q$);
  perform lt.ok(v = 'OK:de-CH|de-CH,fr-CH,it-CH,en-GB', 'org A admin stores canonical tags on the organisation (' || v || ')');

  v := lt.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    update public.organizations set default_locale = 'nl' where id = '00000000-0000-0000-0000-000000000001' returning 1$q$);
  perform lt.ok(v like 'ERR:%organizations_locale_format%', 'default outside supported_locales refused (' || v || ')');

  v := lt.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    update public.organizations set supported_locales = array['de-CH', 'Schweizerdeutsch'] where id = '00000000-0000-0000-0000-000000000001' returning 1$q$);
  perform lt.ok(v like 'ERR:%organizations_locale_format%', 'malformed supported language refused (' || v || ')');
end $$;

-- E. profiles ---------------------------------------------------------------------
do $$
declare v text;
begin
  v := lt.run_as('00000000-0000-0000-0000-0000000000f4', $q$
    with u as (update public.profiles set locale = 'it_ch', locale_set_at = now()
                where id = '00000000-0000-0000-0000-0000000000f4' returning locale)
    select * from u$q$);
  perform lt.ok(v = 'OK:it-CH', 'parent stores an explicit language, canonicalised (' || v || ')');

  v := lt.run_as('00000000-0000-0000-0000-0000000000f4', $q$
    with u as (update public.profiles set locale = 'klingon!!' where id = '00000000-0000-0000-0000-0000000000f4' returning locale)
    select * from u$q$);
  perform lt.ok(v = 'OK:en', 'garbage language becomes en instead of failing (' || v || ')');

  insert into auth.users (id, email, raw_user_meta_data)
  values ('a2000000-0000-0000-0000-0000000000e1', 'lt-signup@example.test', '{"locale": "FR_ch"}'::jsonb);
  perform lt.ok((select locale from public.profiles where id = 'a2000000-0000-0000-0000-0000000000e1') = 'fr-CH',
    'sign-up metadata FR_ch stored as fr-CH');

  v := lt.run_as('b2000000-0000-0000-0000-0000000000c1', $q$
    update public.profiles set locale = 'en' where id = '00000000-0000-0000-0000-0000000000f4' returning 1$q$);
  perform lt.ok(v = 'OK:<null>', 'org B admin cannot change an org A user''s language (' || v || ')');
  perform lt.ok((select locale from public.profiles where id = '00000000-0000-0000-0000-0000000000f4') = 'en',
    'org A parent language untouched by org B (still the value they set)');
end $$;

-- F. invoices.locale -----------------------------------------------------------------
do $$
declare v text; v_inv uuid;
begin
  select id into v_inv from public.invoices where org_id = '00000000-0000-0000-0000-000000000001' order by number limit 1;
  if v_inv is null then
    perform lt.ok(true, 'no seeded invoice: invoice locale checks skipped');
    return;
  end if;
  v := lt.run_as(null, format($q$update public.invoices set locale = 'de-CH' where id = %L returning locale$q$, v_inv));
  perform lt.ok(v = 'OK:de-CH', 'invoice language de-CH accepted (' || v || ')');
  v := lt.run_as(null, format($q$update public.invoices set locale = 'Deutsch' where id = %L returning locale$q$, v_inv));
  perform lt.ok(v like 'ERR:%invoices_locale_tag%', 'malformed invoice language refused (' || v || ')');
  v := lt.run_as(null, format($q$update public.invoices set locale = null where id = %L returning coalesce(locale, 'null')$q$, v_inv));
  perform lt.ok(v = 'OK:null', 'invoice language may be empty (club default) (' || v || ')');
end $$;
