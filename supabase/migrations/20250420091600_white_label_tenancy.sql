-- ============================================================================
-- Club OS — Multi-tenant white-label core
-- Migration 17 · Tenant identity, branding, terminology & localisation
--
-- WHAT THIS DOES (idempotent, additive — safe to re-run):
--   * Extends public.organizations with everything the platform needs to
--     resolve and render a tenant: slug, custom_domain, branding (jsonb),
--     terminology (jsonb), sport, country, locales, currency, timezone,
--     plan, status and data_region.
--   * Validates those values in the database (format checks + a validation
--     trigger) so nothing unsafe can reach the CSS/HTML the app injects.
--   * Protects platform-managed columns (slug, custom_domain, plan, status,
--     data_region) from tenant admins: only trusted server code
--     (service_role / owner) may change them.
--   * Adds public.get_public_tenant(host, slug): a SECURITY DEFINER lookup
--     that returns ONLY public-safe branding columns for ONE tenant, so the
--     login / registration pages can be branded before anyone signs in —
--     without opening organizations to anonymous SELECT.
--
-- RLS: organizations keeps its existing policies (org_select / org_update
-- scoped to current_org_id()). Every tenant table still isolates by org_id.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Columns
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column if not exists custom_domain     text,
  add column if not exists branding          jsonb  not null default '{}'::jsonb,
  add column if not exists terminology       jsonb  not null default '{}'::jsonb,
  add column if not exists sport             text,
  add column if not exists default_locale    text   not null default 'en',
  add column if not exists supported_locales text[] not null default '{en}',
  add column if not exists timezone          text   not null default 'UTC',
  add column if not exists plan              text   not null default 'starter',
  add column if not exists status            text   not null default 'trial',
  add column if not exists data_region       text   not null default 'eu';

-- slug & country & currency already exist (migration 02). Backfill + tighten.
update public.organizations
   set slug = trim(both '-' from regexp_replace(lower(coalesce(name, 'club')), '[^a-z0-9]+', '-', 'g'))
            || case when exists (
                 select 1 from public.organizations o2
                  where o2.id <> organizations.id
                    and o2.slug = trim(both '-' from regexp_replace(lower(coalesce(organizations.name, 'club')), '[^a-z0-9]+', '-', 'g'))
               ) then '-' || substr(id::text, 1, 6) else '' end
 where slug is null or slug = '';

update public.organizations set slug = lower(slug) where slug <> lower(slug);
update public.organizations set country  = upper(country)  where country  is not null and country  <> upper(country);
update public.organizations set currency = upper(currency) where currency is not null and currency <> upper(currency);

alter table public.organizations alter column slug set not null;
alter table public.organizations alter column currency set default 'CHF';

-- ---------------------------------------------------------------------------
-- 2) Constraints (drop-then-add so re-runs stay idempotent)
-- ---------------------------------------------------------------------------
alter table public.organizations drop constraint if exists organizations_slug_format;
alter table public.organizations add constraint organizations_slug_format check (
  slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
  and slug not in ('www', 'app', 'api', 'admin', 'auth', 'mail', 'status', 'static', 'assets', 'cdn', 'platform', 'support', 'help', 'docs')
);

alter table public.organizations drop constraint if exists organizations_custom_domain_format;
alter table public.organizations add constraint organizations_custom_domain_format check (
  custom_domain is null
  or (custom_domain = lower(custom_domain)
      and custom_domain ~ '^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
      and length(custom_domain) <= 253)
);

alter table public.organizations drop constraint if exists organizations_branding_object;
alter table public.organizations add constraint organizations_branding_object
  check (jsonb_typeof(branding) = 'object');

alter table public.organizations drop constraint if exists organizations_terminology_object;
alter table public.organizations add constraint organizations_terminology_object
  check (jsonb_typeof(terminology) = 'object');

alter table public.organizations drop constraint if exists organizations_country_iso;
alter table public.organizations add constraint organizations_country_iso
  check (country is null or country ~ '^[A-Z]{2}$');

alter table public.organizations drop constraint if exists organizations_currency_iso;
alter table public.organizations add constraint organizations_currency_iso
  check (currency is null or currency ~ '^[A-Z]{3}$');

alter table public.organizations drop constraint if exists organizations_locale_format;
alter table public.organizations add constraint organizations_locale_format check (
  default_locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$'
  and array_length(supported_locales, 1) >= 1
  and default_locale = any (supported_locales)
);

alter table public.organizations drop constraint if exists organizations_sport_format;
alter table public.organizations add constraint organizations_sport_format
  check (sport is null or sport ~ '^[a-z0-9_-]{1,40}$');

alter table public.organizations drop constraint if exists organizations_plan_check;
alter table public.organizations add constraint organizations_plan_check
  check (plan in ('free', 'starter', 'pro', 'enterprise', 'founding'));

alter table public.organizations drop constraint if exists organizations_status_check;
alter table public.organizations add constraint organizations_status_check
  check (status in ('trial', 'active', 'suspended'));

alter table public.organizations drop constraint if exists organizations_data_region_check;
alter table public.organizations add constraint organizations_data_region_check
  check (data_region in ('eu', 'ch', 'us'));

-- Case-insensitive uniqueness for host lookups.
create unique index if not exists uq_organizations_custom_domain
  on public.organizations (custom_domain) where custom_domain is not null;
create unique index if not exists uq_organizations_slug_lower
  on public.organizations (lower(slug));

-- ---------------------------------------------------------------------------
-- 3) Validation + protected-column guard
-- ---------------------------------------------------------------------------
create or replace function public.validate_tenant_branding(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  k text;
  v jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return false;
  end if;

  -- colors: every value must be a #RGB / #RRGGBB hex string (prevents CSS
  -- injection through the variables the app writes into the page).
  if p ? 'colors' then
    if jsonb_typeof(p->'colors') <> 'object' then return false; end if;
    for k, v in select * from jsonb_each(p->'colors') loop
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$' then
        return false;
      end if;
    end loop;
  end if;

  -- fonts: family names only (letters, digits, spaces).
  if p ? 'fonts' then
    if jsonb_typeof(p->'fonts') <> 'object' then return false; end if;
    for k, v in select * from jsonb_each(p->'fonts') loop
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[A-Za-z0-9 ]{1,60}$' then
        return false;
      end if;
    end loop;
  end if;

  -- logo / favicon: https URLs or app-relative paths, no quotes/brackets.
  foreach k in array array['logo_url', 'favicon_url'] loop
    if p ? k and jsonb_typeof(p->k) <> 'null' then
      if jsonb_typeof(p->k) <> 'string' then return false; end if;
      if (p->>k) <> '' and (p->>k) !~ '^(https://[^\s"''<>()]+|/[^\s"''<>()]*)$' then
        return false;
      end if;
    end if;
  end loop;

  if p ? 'dark_mode' and jsonb_typeof(p->'dark_mode') not in ('boolean', 'null') then
    return false;
  end if;

  return true;
end;
$$;

create or replace function public.organizations_tenant_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Normalise.
  new.slug := lower(new.slug);
  if new.custom_domain is not null then
    new.custom_domain := nullif(lower(trim(new.custom_domain)), '');
  end if;

  if not public.validate_tenant_branding(new.branding) then
    raise exception 'Invalid branding payload (colors must be hex, fonts plain names, URLs https)'
      using errcode = '22023';
  end if;

  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown timezone: %', new.timezone using errcode = '22023';
  end if;

  -- Platform-managed columns: tenant users (PostgREST roles) cannot change
  -- them. The service_role key and migrations/owner can.
  if tg_op = 'UPDATE' and current_user in ('authenticated', 'anon') then
    if new.slug          is distinct from old.slug
    or new.custom_domain is distinct from old.custom_domain
    or new.plan          is distinct from old.plan
    or new.status        is distinct from old.status
    or new.data_region   is distinct from old.data_region then
      raise exception 'slug, custom_domain, plan, status and data_region are managed by the platform'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_organizations_tenant_guard on public.organizations;
create trigger trg_organizations_tenant_guard
  before insert or update on public.organizations
  for each row execute function public.organizations_tenant_guard();

-- Tenant users never insert/delete organizations (no policies exist for
-- those verbs, so RLS already denies them); make it explicit at grant level.
revoke insert, delete, truncate on public.organizations from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) Public, pre-auth tenant lookup (no other columns leak)
-- ---------------------------------------------------------------------------
-- Returns exactly one tenant's public-safe profile, matched by custom domain
-- (preferred) or by slug. Never lists tenants; never returns plan,
-- data_region, billing or settings data. Suspended tenants are returned
-- (with status) so the app can show a "suspended" screen.
drop function if exists public.get_public_tenant(text, text);
create or replace function public.get_public_tenant(p_host text default null, p_slug text default null)
returns table (
  id                uuid,
  slug              text,
  name              text,
  custom_domain     text,
  branding          jsonb,
  terminology       jsonb,
  sport             text,
  country           text,
  default_locale    text,
  supported_locales text[],
  currency          text,
  timezone          text,
  status            text
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select nullif(split_part(lower(trim(coalesce(p_host, ''))), ':', 1), '') as host,
           nullif(lower(trim(coalesce(p_slug, ''))), '')                     as slug
  )
  select o.id, o.slug, o.name, o.custom_domain, o.branding, o.terminology,
         o.sport, o.country, o.default_locale, o.supported_locales,
         o.currency, o.timezone, o.status
    from public.organizations o, q
   where (q.host is not null and o.custom_domain = q.host)
      or (q.slug is not null and lower(o.slug) = q.slug)
   order by (q.host is not null and o.custom_domain = q.host) desc
   limit 1;
$$;

revoke all on function public.get_public_tenant(text, text) from public;
grant execute on function public.get_public_tenant(text, text) to anon, authenticated, service_role;

comment on function public.get_public_tenant(text, text) is
  'Public-safe tenant lookup by host (custom domain) or slug. Returns branding/locale only.';

-- ---------------------------------------------------------------------------
-- 5) Founding tenant defaults (only fills blanks — never overwrites edits)
-- ---------------------------------------------------------------------------
update public.organizations
   set sport             = coalesce(sport, 'basketball'),
       timezone          = case when timezone = 'UTC' and country = 'CH' then 'Europe/Zurich' else timezone end,
       data_region       = case when country = 'CH' then 'ch' else data_region end
 where slug = 'dlang';

comment on column public.organizations.branding is
  'White-label theme: {logo_url, favicon_url, colors:{primary,primaryDark,accent,background,surface,text}, fonts:{display,ui,mono}, dark_mode}';
comment on column public.organizations.terminology is
  'Vocabulary overrides, e.g. {"athlete":{"one":"Player","other":"Players"},"coach":"Trainer"}';
