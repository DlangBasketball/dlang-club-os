-- ============================================================================
-- i18n & localisation (CH / EU / US)
--
--  * profiles.locale_set_at   — marks profiles.locale as an explicit user
--                               choice (profiles.locale defaults to 'en' for
--                               everyone, so it can't signal intent by itself).
--  * app_settings.timezone    — tenant IANA time zone for dates/times.
--  * app_settings.enabled_locales — languages offered in the switcher.
--  * format checks on locale / currency / timezone values.
--
-- Additive and idempotent: safe to re-run, no data rewritten except
-- back-filling sensible defaults from organizations.country.
-- ============================================================================

-- ---- profiles ---------------------------------------------------------------
alter table public.profiles
  add column if not exists locale_set_at timestamptz;

comment on column public.profiles.locale_set_at is
  'When the user explicitly chose profiles.locale (language switcher). NULL = no explicit preference; fall back to tenant default / browser.';

-- Lenient on purpose: handle_new_user copies raw_user_meta_data->>'locale',
-- which may be a regional tag ("de-CH"); the app normalises it to "de".
do $$ begin
  alter table public.profiles
    add constraint profiles_locale_format
    check (locale ~ '^[a-z]{2}([-_][A-Za-z]{2})?$') not valid;
exception when duplicate_object then null; end $$;

-- ---- app_settings -----------------------------------------------------------
alter table public.app_settings
  add column if not exists timezone text not null default 'Europe/Zurich',
  add column if not exists enabled_locales text[] not null default '{en,de,fr,it,es}';

comment on column public.app_settings.timezone is 'IANA time zone used to render dates/times for this tenant, e.g. Europe/Zurich, America/New_York.';
comment on column public.app_settings.enabled_locales is 'UI languages offered to this tenant''s users (subset of en,de,fr,it,es).';
comment on column public.app_settings.default_locale is 'Tenant default UI language, used when the user has no explicit preference.';

do $$ begin
  alter table public.app_settings
    add constraint app_settings_default_locale_supported
    check (default_locale in ('en', 'de', 'fr', 'it', 'es')) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.app_settings
    add constraint app_settings_enabled_locales_supported
    check (enabled_locales <@ array['en', 'de', 'fr', 'it', 'es']::text[] and cardinality(enabled_locales) > 0) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.app_settings
    add constraint app_settings_currency_iso
    check (currency ~ '^[A-Z]{3}$') not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.app_settings
    add constraint app_settings_timezone_format
    check (timezone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$') not valid;
exception when duplicate_object then null; end $$;

-- Back-fill time zone from the organisation's country for existing tenants
-- that still carry the column default.
update public.app_settings s
   set timezone = case upper(o.country)
       when 'US' then 'America/New_York'
       when 'GB' then 'Europe/London'
       when 'IE' then 'Europe/Dublin'
       when 'DE' then 'Europe/Berlin'
       when 'AT' then 'Europe/Vienna'
       when 'FR' then 'Europe/Paris'
       when 'BE' then 'Europe/Brussels'
       when 'NL' then 'Europe/Amsterdam'
       when 'LU' then 'Europe/Luxembourg'
       when 'IT' then 'Europe/Rome'
       when 'ES' then 'Europe/Madrid'
       when 'PT' then 'Europe/Lisbon'
       else 'Europe/Zurich' end
  from public.organizations o
 where o.id = s.org_id
   and s.timezone = 'Europe/Zurich'
   and upper(o.country) <> 'CH';
