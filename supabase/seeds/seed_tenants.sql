-- ============================================================================
-- Club OS — tenant seed (white-label)
-- Run AFTER migrations (incl. 20250420091600_white_label_tenancy.sql) and
-- after seed.sql. Idempotent: upserts by id.
--
--   1) DLang Basketball — founding tenant (Lausanne, CH). slug "dlang".
--   2) Riverside High Soccer — demo tenant (US school program). slug "riverside".
--
-- Local dev: DEFAULT_ORG_SLUG=dlang (or riverside) picks the tenant when the
-- request host is localhost. In production each tenant is reached via
-- <slug>.<PLATFORM_ROOT_DOMAIN> or its verified custom_domain.
-- ============================================================================

-- ---- 1) DLang Basketball ---------------------------------------------------
insert into public.organizations (
  id, name, slug, custom_domain, country, currency, default_locale,
  supported_locales, timezone, sport, plan, status, data_region,
  branding, terminology
) values (
  '00000000-0000-0000-0000-000000000001',
  'DLang Basketball', 'dlang', null, 'CH', 'CHF', 'fr-CH',
  '{fr-CH,de-CH,en}', 'Europe/Zurich', 'basketball', 'founding', 'active', 'ch',
  '{
     "logo_url": null,
     "favicon_url": null,
     "dark_mode": true,
     "colors": {
       "primary":     "#DA2627",
       "primaryDark": "#961F1F",
       "accent":      "#C19A45",
       "background":  "#0A0A0A",
       "surface":     "#1A1A1A",
       "text":        "#F1F1F1"
     },
     "fonts": { "display": "Fraunces", "ui": "Geist", "mono": "Geist Mono" }
   }'::jsonb,
  '{
     "organization": { "one": "Club",    "other": "Clubs" },
     "athlete":      { "one": "Player",  "other": "Players" },
     "coach":        { "one": "Coach",   "other": "Coaches" },
     "program":      { "one": "Program", "other": "Programs" },
     "session":      { "one": "Session", "other": "Sessions" },
     "season":       { "one": "Season",  "other": "Seasons" },
     "family":       { "one": "Family",  "other": "Families" },
     "guardian":     { "one": "Parent",  "other": "Parents" }
   }'::jsonb
)
on conflict (id) do update set
  name = excluded.name, slug = excluded.slug, country = excluded.country,
  currency = excluded.currency, default_locale = excluded.default_locale,
  supported_locales = excluded.supported_locales, timezone = excluded.timezone,
  sport = excluded.sport, plan = excluded.plan, status = excluded.status,
  data_region = excluded.data_region, branding = excluded.branding,
  terminology = excluded.terminology;

insert into public.app_settings (org_id, invoice_pattern, invoice_counter, currency, default_locale, payment_methods)
values ('00000000-0000-0000-0000-000000000001', 'INV-{YYYY}-{####}', 0, 'CHF', 'fr-CH', '{card,twint,bank_transfer,manual}')
on conflict (org_id) do update set currency = excluded.currency, default_locale = excluded.default_locale;

-- ---- 2) Demo tenant: US school soccer program -----------------------------
insert into public.organizations (
  id, name, slug, custom_domain, country, currency, default_locale,
  supported_locales, timezone, sport, plan, status, data_region,
  branding, terminology
) values (
  '10000000-0000-0000-0000-000000000002',
  'Riverside High Soccer', 'riverside', null, 'US', 'USD', 'en-US',
  '{en-US,es}', 'America/Chicago', 'soccer', 'starter', 'trial', 'us',
  '{
     "logo_url": null,
     "favicon_url": null,
     "dark_mode": false,
     "colors": {
       "primary":     "#1D4ED8",
       "primaryDark": "#1E3A8A",
       "accent":      "#B45309",
       "background":  "#F8FAFC",
       "surface":     "#FFFFFF",
       "text":        "#0F172A"
     },
     "fonts": { "display": "Inter", "ui": "Inter", "mono": "JetBrains Mono" }
   }'::jsonb,
  '{
     "organization": { "one": "School",          "other": "Schools" },
     "athlete":      { "one": "Student-athlete", "other": "Student-athletes" },
     "coach":        { "one": "Coach",           "other": "Coaches" },
     "program":      { "one": "Team",            "other": "Teams" },
     "session":      { "one": "Practice",        "other": "Practices" },
     "season":       { "one": "Season",          "other": "Seasons" },
     "family":       { "one": "Household",       "other": "Households" },
     "guardian":     { "one": "Parent/Guardian", "other": "Parents/Guardians" }
   }'::jsonb
)
on conflict (id) do update set
  name = excluded.name, slug = excluded.slug, country = excluded.country,
  currency = excluded.currency, default_locale = excluded.default_locale,
  supported_locales = excluded.supported_locales, timezone = excluded.timezone,
  sport = excluded.sport, plan = excluded.plan, status = excluded.status,
  data_region = excluded.data_region, branding = excluded.branding,
  terminology = excluded.terminology;

insert into public.app_settings (org_id, invoice_pattern, invoice_counter, currency, default_locale, payment_methods)
values ('10000000-0000-0000-0000-000000000002', 'RHS-{YYYY}-{####}', 0, 'USD', 'en-US', '{card,bank_transfer,manual}')
on conflict (org_id) do update set currency = excluded.currency, default_locale = excluded.default_locale;
