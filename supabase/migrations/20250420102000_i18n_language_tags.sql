-- ============================================================================
-- i18n: any BCP 47 language tag (expand step)
--
-- The UI language list now lives in a registry in the app
-- (src/lib/i18n/languages.ts), with regional variants (de-CH, fr-CH, it-CH,
-- en-GB) and new languages added without a migration. The database therefore
-- stops enumerating languages and checks the SHAPE of a tag instead:
--
--   language (2-3 lower-case letters) [-Script (Xxxx)] [-REGION (XX or 999)]
--   ^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$
--   "de", "de-CH", "en-GB", "pt-BR", "zh-Hant-TW", "es-419"
--
-- Which tags are actually rendered (has a catalog) is an app concern; an
-- enabled tag without a catalog falls back along its chain (de-AT -> de).
--
--  * public.is_language_tag(text) / are_language_tags(text[])   shape checks
--  * public.canonical_language_tag(text)   "DE_ch" -> "de-CH" (null if not a tag)
--  * app_settings: the five-language checks are replaced by shape checks; the
--    normalising trigger now canonicalises tags instead of reducing them to
--    the base language (so "fr-CH" survives).
--  * organizations: locale format check widened (scripts, numeric regions),
--    tags canonicalised on write.
--  * profiles.locale (the user's language preference; locale_set_at marks an
--    explicit choice): canonicalised on write; a malformed value coming from
--    sign-up metadata becomes 'en' instead of failing the sign-up.
--  * invoices.locale (document language): any tag.
--
-- Additive and idempotent: drop constraint if exists + add, create or
-- replace, new constraints added NOT VALID and validated only when existing
-- rows already comply (no data rewritten). Tenant isolation is unchanged:
-- no policy is touched.
-- ============================================================================

-- ---- helpers -----------------------------------------------------------------
create or replace function public.is_language_tag(p text)
returns boolean
language sql
immutable
parallel safe
set search_path = public
as $$
  select p is not null and p ~ '^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$';
$$;

create or replace function public.are_language_tags(p text[])
returns boolean
language sql
immutable
parallel safe
set search_path = public
as $$
  select p is not null
     and cardinality(p) between 1 and 50
     and not exists (select 1 from unnest(p) as x where not public.is_language_tag(x));
$$;

-- "DE_ch" -> "de-CH", "zh-hant-tw" -> "zh-Hant-TW", " fr " -> "fr".
-- Returns null when the input is not shaped like a language tag.
create or replace function public.canonical_language_tag(p text)
returns text
language plpgsql
immutable
parallel safe
set search_path = public
as $$
declare
  v_parts  text[];
  v_lang   text;
  v_script text;
  v_region text;
  v_i      int := 2;
  v_tag    text;
begin
  if p is null or btrim(p) = '' then
    return null;
  end if;
  v_parts := string_to_array(replace(btrim(p), '_', '-'), '-');
  v_lang := lower(v_parts[1]);
  if v_lang !~ '^[a-z]{2,3}$' then
    return null;
  end if;
  if cardinality(v_parts) >= v_i and v_parts[v_i] ~* '^[a-z]{4}$' then
    v_script := upper(left(v_parts[v_i], 1)) || lower(substr(v_parts[v_i], 2));
    v_i := v_i + 1;
  end if;
  if cardinality(v_parts) >= v_i and v_parts[v_i] ~* '^([a-z]{2}|[0-9]{3})$' then
    v_region := upper(v_parts[v_i]);
    v_i := v_i + 1;
  end if;
  -- Anything left must be a variant (5-8 chars, "1996") or an extension
  -- ("u-nu-latn", "x-private"); those are dropped. Other leftovers ("de-C")
  -- mean it is not a tag.
  if cardinality(v_parts) >= v_i
     and not (v_parts[v_i] ~* '^([a-z0-9]{5,8}|[0-9][a-z0-9]{3})$'
              or (v_parts[v_i] ~* '^[a-z0-9]$' and cardinality(v_parts) > v_i)) then
    return null;
  end if;
  v_tag := v_lang || coalesce('-' || v_script, '') || coalesce('-' || v_region, '');
  return case when public.is_language_tag(v_tag) then v_tag else null end;
end;
$$;

-- Canonicalise an array of tags, drop blanks, keep first occurrence order.
create or replace function public.canonical_language_tags(p text[])
returns text[]
language sql
immutable
parallel safe
set search_path = public
as $$
  select coalesce(array_agg(t order by first_pos), '{}')
    from (
      select coalesce(public.canonical_language_tag(x), btrim(x)) as t, min(ord) as first_pos
        from unnest(p) with ordinality as u(x, ord)
       where x is not null and btrim(x) <> ''
       group by 1
    ) s;
$$;

grant execute on function public.is_language_tag(text) to anon, authenticated, service_role;
grant execute on function public.are_language_tags(text[]) to anon, authenticated, service_role;
grant execute on function public.canonical_language_tag(text) to anon, authenticated, service_role;
grant execute on function public.canonical_language_tags(text[]) to anon, authenticated, service_role;

-- ---- app_settings -------------------------------------------------------------
-- Replaces the 20250420095100 version, which reduced every tag to one of five
-- base languages. Invalid tags are kept as written so the check rejects them.
create or replace function public.app_settings_normalize_locales()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.default_locale is not null then
    new.default_locale := coalesce(public.canonical_language_tag(new.default_locale), btrim(new.default_locale));
  end if;
  if new.enabled_locales is not null then
    new.enabled_locales := public.canonical_language_tags(new.enabled_locales);
    if cardinality(new.enabled_locales) = 0 then
      new.enabled_locales := array[coalesce(new.default_locale, 'en')];
    end if;
  end if;
  return new;
end;
$$;

do $$ begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'app_settings'
                and column_name = 'enabled_locales') then
    execute 'drop trigger if exists trg_app_settings_normalize_locales on public.app_settings';
    execute 'create trigger trg_app_settings_normalize_locales
               before insert or update of default_locale, enabled_locales on public.app_settings
               for each row execute function public.app_settings_normalize_locales()';
  end if;
end $$;

alter table public.app_settings drop constraint if exists app_settings_default_locale_supported;
alter table public.app_settings drop constraint if exists app_settings_enabled_locales_supported;

alter table public.app_settings drop constraint if exists app_settings_default_locale_tag;
alter table public.app_settings
  add constraint app_settings_default_locale_tag
  check (public.is_language_tag(default_locale)) not valid;

alter table public.app_settings drop constraint if exists app_settings_enabled_locales_tags;
alter table public.app_settings
  add constraint app_settings_enabled_locales_tags
  check (public.are_language_tags(enabled_locales)) not valid;

comment on column public.app_settings.enabled_locales is
  'UI languages offered to this tenant''s users: BCP 47 tags (de, de-CH, en-GB, ...). Tags without a catalog fall back along the registry chain (src/lib/i18n/languages.ts).';
comment on column public.app_settings.default_locale is
  'Tenant default UI language (BCP 47 tag), used when neither the user nor the browser picks one of the enabled languages.';

-- ---- organizations ------------------------------------------------------------
create or replace function public.organizations_normalize_locales()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.default_locale is not null then
    new.default_locale := coalesce(public.canonical_language_tag(new.default_locale), btrim(new.default_locale));
  end if;
  if new.supported_locales is not null then
    new.supported_locales := public.canonical_language_tags(new.supported_locales);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_organizations_normalize_locales on public.organizations;
create trigger trg_organizations_normalize_locales
  before insert or update of default_locale, supported_locales on public.organizations
  for each row execute function public.organizations_normalize_locales();

alter table public.organizations drop constraint if exists organizations_locale_format;
alter table public.organizations
  add constraint organizations_locale_format check (
    public.is_language_tag(default_locale)
    and public.are_language_tags(supported_locales)
    and default_locale = any (supported_locales)
  ) not valid;

-- ---- profiles (user language preference) --------------------------------------
create or replace function public.profiles_normalize_locale()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Sign-up metadata may carry anything; never fail a sign-up over it.
  new.locale := coalesce(public.canonical_language_tag(new.locale), 'en');
  return new;
end;
$$;

drop trigger if exists trg_profiles_normalize_locale on public.profiles;
create trigger trg_profiles_normalize_locale
  before insert or update of locale on public.profiles
  for each row execute function public.profiles_normalize_locale();

alter table public.profiles drop constraint if exists profiles_locale_format;
alter table public.profiles
  add constraint profiles_locale_format
  check (public.is_language_tag(locale)) not valid;

comment on column public.profiles.locale is
  'User language preference (BCP 47 tag). Counts as an explicit choice only when locale_set_at is set; emails, notifications and PDFs follow it.';

-- ---- invoices (document language) ---------------------------------------------
do $$ begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'invoices' and column_name = 'locale') then
    execute 'alter table public.invoices drop constraint if exists invoices_locale_known';
    execute 'alter table public.invoices drop constraint if exists invoices_locale_tag';
    execute 'alter table public.invoices add constraint invoices_locale_tag
               check (locale is null or public.is_language_tag(locale)) not valid';
  end if;
end $$;

-- ---- validate where existing rows already comply -------------------------------
do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('app_settings', 'app_settings_default_locale_tag'),
      ('app_settings', 'app_settings_enabled_locales_tags'),
      ('organizations', 'organizations_locale_format'),
      ('profiles', 'profiles_locale_format'),
      ('invoices', 'invoices_locale_tag')
    ) as v(tbl, con)
  loop
    if exists (select 1 from pg_constraint where conname = c.con) then
      begin
        execute format('alter table public.%I validate constraint %I', c.tbl, c.con);
      exception when check_violation then
        raise notice 'i18n: % keeps NOT VALID (existing rows predate the tag format; new writes are checked)', c.con;
      end;
    end if;
  end loop;
end $$;
