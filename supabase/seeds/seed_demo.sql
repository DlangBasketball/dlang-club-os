-- ============================================================================
-- Club OS - DEMO seed (staging / sales demos). SYNTHETIC DATA ONLY.
--
-- Every person, family, address, phone number and email below is invented.
-- Emails use the reserved example.com domain; phone numbers use the
-- +41 00 ... pattern that no Swiss operator assigns. Do NOT load into
-- production. Generated; idempotent (fixed UUIDs + ON CONFLICT).
--
-- Tenants:
--   1) DLang Basketball (slug dlang) - founding club, app name "DLang OS",
--      V5 dark-luxury theme, English UI (FR/DE enabled), complimentary AI add-on.
--   2) FC Seeblick (slug fc-seeblick) - fictional German-speaking football club,
--      light green theme, German UI and German terminology.
--
-- Demo logins are created separately through the Auth admin API (synthetic
-- demo-*@example.com users); PART B links them to their org/roles by email
-- and is a no-op when those users do not exist.
-- ============================================================================

-- =========================  PART A - TENANT DATA  ===========================

insert into public.organizations (id, name, slug, country, currency, default_locale, supported_locales, timezone, sport, plan, status, data_region, branding, terminology) values
  ('00000000-0000-0000-0000-000000000001', 'DLang Basketball', 'dlang', 'CH', 'CHF', 'en', '{en,fr-CH,de-CH}', 'Europe/Zurich', 'basketball', 'founding', 'active', 'ch', '{"app_name": "DLang OS", "logo_url": null, "favicon_url": null, "dark_mode": true, "colors": {"primary": "#DA2627", "primaryDark": "#961F1F", "accent": "#C19A45", "background": "#0A0A0A", "surface": "#1A1A1A", "text": "#F1F1F1"}, "fonts": {"display": "Fraunces", "ui": "Geist", "mono": "Geist Mono"}}'::jsonb, '{"organization": {"one": "Club", "other": "Clubs"}, "athlete": {"one": "Player", "other": "Players"}, "coach": {"one": "Coach", "other": "Coaches"}, "program": {"one": "Programme", "other": "Programmes"}, "session": {"one": "Session", "other": "Sessions"}, "season": {"one": "Season", "other": "Seasons"}, "family": {"one": "Family", "other": "Families"}, "guardian": {"one": "Parent", "other": "Parents"}}'::jsonb),
  ('20000000-0000-0000-0000-000000000002', 'FC Seeblick', 'fc-seeblick', 'CH', 'CHF', 'de-CH', '{de-CH,fr-CH}', 'Europe/Zurich', 'football', 'starter', 'active', 'ch', '{"app_name": "Seeblick Club", "logo_url": null, "favicon_url": null, "dark_mode": false, "colors": {"primary": "#0F7A3D", "primaryDark": "#0A5A2C", "accent": "#B8860B", "background": "#F5F7F4", "surface": "#FFFFFF", "text": "#10231A"}, "fonts": {"display": "Geist", "ui": "Geist", "mono": "Geist Mono"}}'::jsonb, '{"organization": {"one": "Verein", "other": "Vereine"}, "athlete": {"one": "Junior", "other": "Junioren"}, "coach": {"one": "Trainer", "other": "Trainer"}, "program": {"one": "Mannschaft", "other": "Mannschaften"}, "session": {"one": "Training", "other": "Trainings"}, "season": {"one": "Saison", "other": "Saisons"}, "family": {"one": "Familie", "other": "Familien"}, "guardian": {"one": "Elternteil", "other": "Eltern"}}'::jsonb)
on conflict (id) do update set
  name = excluded.name, slug = excluded.slug, country = excluded.country, currency = excluded.currency,
  default_locale = excluded.default_locale, supported_locales = excluded.supported_locales,
  timezone = excluded.timezone, sport = excluded.sport, plan = excluded.plan, status = excluded.status,
  data_region = excluded.data_region, branding = excluded.branding, terminology = excluded.terminology;

insert into public.app_settings (org_id, invoice_pattern, invoice_counter, currency, default_locale, enabled_locales, timezone, payment_methods, settings) values
  ('00000000-0000-0000-0000-000000000001', 'DL-{YYYY}-{####}', 40, 'CHF', 'en', '{en,fr,de}', 'Europe/Zurich', '{twint,qr_bill,bank_transfer,card,manual}', '{"ai_assistant_enabled": true, "payments": {"creditor_name": "DLang Basketball (Demo)", "creditor_street": "Avenue de l''Exemple", "creditor_building": "1", "creditor_zip": "1000", "creditor_city": "Lausanne", "creditor_country": "CH", "qr_iban": "CH4431999123000889012", "iban": "", "twint_number": "+41 00 000 00 00", "reference_type": "QRR", "reference_prefix": "21"}}'::jsonb),
  ('20000000-0000-0000-0000-000000000002', 'FCS-{YYYY}-{####}', 20, 'CHF', 'de', '{de,fr}', 'Europe/Zurich', '{qr_bill,twint,bank_transfer}', '{"payments": {"creditor_name": "FC Seeblick (Demo)", "creditor_street": "Musterstrasse", "creditor_building": "10", "creditor_zip": "8000", "creditor_city": "Zürich", "creditor_country": "CH", "qr_iban": "CH4431999123000889012", "iban": "", "twint_number": "", "reference_type": "QRR", "reference_prefix": "21"}}'::jsonb)
on conflict (org_id) do update set
  invoice_pattern = excluded.invoice_pattern, invoice_counter = greatest(public.app_settings.invoice_counter, excluded.invoice_counter),
  currency = excluded.currency, default_locale = excluded.default_locale, enabled_locales = excluded.enabled_locales,
  timezone = excluded.timezone, payment_methods = excluded.payment_methods,
  settings = public.app_settings.settings || excluded.settings;

-- Platform subscriptions (DLang: founding club on Academy, no charge; FC Seeblick: Club plan trial).
insert into public.subscriptions (id, org_id, plan_code, status, currency, billing_interval, trial_ends_at, custom_amount, onboarding_fee_waived, notes)
select v.* from (values
  ('dd010019-0000-4000-8000-000000000001'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'academy', 'active', 'CHF', 'month', null::timestamptz, 0::numeric, true, 'Founding club (demo data)'),
  ('dd020019-0000-4000-8000-000000000001'::uuid, '20000000-0000-0000-0000-000000000002'::uuid, 'club', 'trialing', 'CHF', 'month', '2026-12-31 23:59:00+01'::timestamptz, null::numeric, false, 'Demo tenant')
) as v(id, org_id, plan_code, status, currency, billing_interval, trial_ends_at, custom_amount, onboarding_fee_waived, notes)
where not exists (select 1 from public.subscriptions s where s.org_id = v.org_id);

-- DLang's complimentary AI assistant add-on (founding-club grant).
insert into public.ai_assistant_addons (id, org_id, scope, source, status, starts_at, note) values
  ('dd010018-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'org', 'complimentary', 'active', '2026-11-01 00:00:00+01', 'Founding club: complimentary AI assistant add-on (demo)')
on conflict do nothing;

-- ---------------------------------------------------------------- DLang Basketball (demo data)

insert into public.venues (id, org_id, name, address, city, postal_code, country, capacity) values
  ('dd010002-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'Salle de sport Exemple', 'Chemin de l''Exemple 5', 'Lausanne', '1000', 'CH', 400),
  ('dd010002-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'Gymnase Démo', 'Rue Fictive 12', 'Renens', '1020', 'CH', 200)
on conflict (id) do nothing;

insert into public.coaches (id, org_id, display_name, role_title, serves, bio) values
  ('dd010001-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'Alex Moreau', 'Head Coach · U14', '{pt,shoot,ball,group}', 'Demo coach profile.'),
  ('dd010001-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'Sam Keller', 'Skills Coach · U12', '{pt,ball,group}', 'Demo coach profile.'),
  ('dd010001-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', 'Lina Haddad', 'Shooting Coach', '{pt,shoot}', 'Demo coach profile.'),
  ('dd010001-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000001', 'Tom Favre', 'Strength & Conditioning', '{sc}', 'Demo coach profile.')
on conflict (id) do nothing;

insert into public.training_services (id, org_id, slug, name, tagline, duration_min, price_chf, credit_category) values
  ('dd010003-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'pt', '1-on-1 Personal Training', 'Work directly with a head coach', 60, 75, 'personal'),
  ('dd010003-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'shoot', 'Shooting Lab', 'Form, footwork, catch-and-shoot', 45, 65, 'personal'),
  ('dd010003-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', 'ball', 'Ball Handling & Skills', 'Tight handle, finishing', 45, 55, 'personal'),
  ('dd010003-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000001', 'mental', 'Mental Performance', 'Confidence, focus, routines', 45, 70, 'mental')
on conflict (id) do nothing;

insert into public.consent_forms (id, org_id, key, title, body, version, locale, is_required) values
  ('dd010004-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'media', 'Media consent', 'Photos and video of my child may be used in club communications.', 1, 'en', false),
  ('dd010004-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'health', 'Health declaration', 'I confirm the health information provided is complete.', 1, 'en', true),
  ('dd010004-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', 'terms', 'Terms & cancellation policy', 'I accept the club''s terms and cancellation policy.', 1, 'en', true)
on conflict (id) do nothing;

insert into public.seasons (id, org_id, name, starts_on, ends_on, is_current) values
  ('dd010005-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'Season 2026-27', '2026-08-24', '2027-06-30', true)
on conflict (id) do nothing;

insert into public.programs (id, org_id, slug, name, kind, description, price_chf, capacity, starts_on, ends_on, location, schedule, is_public, is_active) values
  ('dd010006-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'u12-big-ballers', 'Big Ballers U12', 'recurring_team', 'Weekly development team for under-12 players.', 290, 24, '2026-08-24', '2027-06-30', 'Salle de sport Exemple, Lausanne', null, true, true),
  ('dd010006-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'u14-cheetahs', 'Cheetahs U14', 'recurring_team', 'Competitive U14 team, regional league.', 340, 18, '2026-08-24', '2027-06-30', 'Salle de sport Exemple, Lausanne', null, false, true),
  ('dd010006-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', 'u16-unity', 'Unity U16', 'recurring_team', 'U16 performance squad.', 380, 16, '2026-08-24', '2027-06-30', 'Gymnase Démo, Renens', null, false, true),
  ('dd010006-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000001', 'winter-skills-clinic-2026', 'Winter Skills Clinic', 'clinic', 'One-day shooting and ball-handling clinic before the holidays.', 90, 30, '2026-12-19', '2026-12-19', 'Salle de sport Exemple, Lausanne', null, true, true),
  ('dd010006-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000001', 'easter-camp-2027', 'Easter Camp 2027', 'camp', 'Five-day day camp for ages 8-15: skills, games, lunch included.', 490, 40, '2027-04-05', '2027-04-09', 'Salle de sport Exemple, Lausanne', null, true, true),
  ('dd010006-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000001', 'summer-camp-2027-w1', 'Summer Camp 2027 · Week 1', 'camp', 'Full-day elite summer camp.', 690, 48, '2027-07-05', '2027-07-09', 'Salle de sport Exemple, Lausanne', null, true, true)
on conflict (id) do nothing;

insert into public.teams (id, org_id, season_id, program_id, name, sport, age_group, gender, level, color) values
  ('dd010007-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'dd010005-0000-4000-8000-000000000001', 'dd010006-0000-4000-8000-000000000002', 'Cheetahs U14', 'basketball', 'U14', 'mixed', 'Regional', '#DA2627'),
  ('dd010007-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'dd010005-0000-4000-8000-000000000001', 'dd010006-0000-4000-8000-000000000001', 'Big Ballers U12', 'basketball', 'U12', 'mixed', 'Development', '#C19A45'),
  ('dd010007-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', 'dd010005-0000-4000-8000-000000000001', 'dd010006-0000-4000-8000-000000000003', 'Unity U16', 'basketball', 'U16', 'mixed', 'Performance', '#961F1F')
on conflict (id) do nothing;

insert into public.team_coaches (team_id, coach_id, org_id, role) values
  ('dd010007-0000-4000-8000-000000000001', 'dd010001-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'head'),
  ('dd010007-0000-4000-8000-000000000001', 'dd010001-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', 'assistant'),
  ('dd010007-0000-4000-8000-000000000002', 'dd010001-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'head'),
  ('dd010007-0000-4000-8000-000000000002', 'dd010001-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'assistant'),
  ('dd010007-0000-4000-8000-000000000003', 'dd010001-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'head')
on conflict do nothing;

insert into public.families (id, org_id, name, address, phone, contact_name, contact_email) values
  ('dd01000a-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'Martin family', 'Avenue Exemple 10, 1000 Lausanne', '+41 00 000 10 10', 'Claire Martin', 'demo-parent@example.com'),
  ('dd01000a-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'Keller family', 'Rue Fictive 3, 1020 Renens', '+41 00 000 11 17', 'Jonas Keller', 'keller.demo@example.com'),
  ('dd01000a-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', 'Rochat family', 'Chemin Démo 8, 1004 Lausanne', '+41 00 000 12 24', 'Sophie Rochat', 'rochat.demo@example.com'),
  ('dd01000a-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000001', 'Bianchi family', 'Via Esempio 2, 1006 Lausanne', '+41 00 000 13 31', 'Marco Bianchi', 'bianchi.demo@example.com'),
  ('dd01000a-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000001', 'Nguyen family', 'Avenue Démo 21, 1007 Lausanne', '+41 00 000 14 38', 'Linh Nguyen', 'nguyen.demo@example.com'),
  ('dd01000a-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000001', 'Dubois family', 'Rue Exemple 44, 1010 Lausanne', '+41 00 000 15 45', 'Julie Dubois', 'dubois.demo@example.com'),
  ('dd01000a-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000001', 'Silva family', 'Chemin Fictif 7, 1018 Lausanne', '+41 00 000 16 52', 'Ana Silva', 'silva.demo@example.com'),
  ('dd01000a-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000001', 'Weber family', 'Avenue Exemple 99, 1012 Lausanne', '+41 00 000 17 59', 'Daniel Weber', 'weber.demo@example.com')
on conflict (id) do nothing;

insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, gender, school, jersey_size, dominant_hand, position_pref, status) values
  ('dd01000b-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'dd01000a-0000-4000-8000-000000000001', 'Léo', 'Martin', '2013-03-14', 'Male', 'Collège Démo', 'M', 'Right', 'Point guard', 'active'),
  ('dd01000b-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'dd01000a-0000-4000-8000-000000000001', 'Emma', 'Martin', '2015-09-02', 'Female', 'Collège Démo', 'YL', 'Right', 'Guard', 'active'),
  ('dd01000b-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', 'dd01000a-0000-4000-8000-000000000002', 'Noah', 'Keller', '2012-11-21', 'Male', null, 'L', 'Right', 'Forward', 'active'),
  ('dd01000b-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000001', 'dd01000a-0000-4000-8000-000000000003', 'Chloé', 'Rochat', '2013-06-30', 'Female', null, 'M', 'Right', 'Guard', 'active'),
  ('dd01000b-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000001', 'dd01000a-0000-4000-8000-000000000003', 'Hugo', 'Rochat', '2016-01-17', 'Male', null, 'YM', 'Right', 'Guard', 'active'),
  ('dd01000b-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000001', 'dd01000a-0000-4000-8000-000000000004', 'Giulia', 'Bianchi', '2013-04-05', 'Female', null, 'M', 'Right', 'Center', 'active'),
  ('dd01000b-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000001', 'dd01000a-0000-4000-8000-000000000005', 'Minh', 'Nguyen', '2011-08-12', 'Male', null, 'L', 'Right', 'Forward', 'active'),
  ('dd01000b-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000001', 'dd01000a-0000-4000-8000-000000000005', 'Anh', 'Nguyen', '2014-02-28', 'Female', null, 'S', 'Right', 'Guard', 'active'),
  ('dd01000b-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000001', 'dd01000a-0000-4000-8000-000000000006', 'Lucas', 'Dubois', '2011-12-03', 'Male', null, 'XL', 'Right', 'Center', 'active'),
  ('dd01000b-0000-4000-8000-000000000010', '00000000-0000-0000-0000-000000000001', 'dd01000a-0000-4000-8000-000000000006', 'Inès', 'Dubois', '2016-05-19', 'Female', null, 'YM', 'Right', 'Guard', 'active'),
  ('dd01000b-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000001', 'dd01000a-0000-4000-8000-000000000007', 'Tiago', 'Silva', '2013-10-09', 'Male', null, 'M', 'Right', 'Wing', 'active'),
  ('dd01000b-0000-4000-8000-000000000012', '00000000-0000-0000-0000-000000000001', 'dd01000a-0000-4000-8000-000000000008', 'Mia', 'Weber', '2015-07-07', 'Female', null, 'YL', 'Right', 'Guard', 'active')
on conflict (id) do nothing;

insert into public.athlete_medical (id, org_id, athlete_id, allergies, conditions, insurance, emergency_contact_name, emergency_contact_phone) values
  ('dd01000c-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000001', 'None declared', 'Mild asthma - inhaler in kit bag (demo)', 'Demo insurance', 'Claire Martin', '+41 00 000 10 10'),
  ('dd01000c-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000002', 'None declared', 'None', 'Demo insurance', 'Claire Martin', '+41 00 000 10 10')
on conflict (id) do nothing;

insert into public.registrations (id, org_id, athlete_id, program_id, status, created_at) values
  ('dd01000d-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000001', 'dd010006-0000-4000-8000-000000000002', 'confirmed', '2026-09-14 10:00:00+01'),
  ('dd01000d-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000001', 'dd010006-0000-4000-8000-000000000005', 'pending', '2026-09-15 10:00:00+01'),
  ('dd01000d-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000002', 'dd010006-0000-4000-8000-000000000001', 'confirmed', '2026-09-16 10:00:00+01'),
  ('dd01000d-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000003', 'dd010006-0000-4000-8000-000000000002', 'confirmed', '2026-09-17 10:00:00+01'),
  ('dd01000d-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000004', 'dd010006-0000-4000-8000-000000000002', 'confirmed', '2026-09-18 10:00:00+01'),
  ('dd01000d-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000004', 'dd010006-0000-4000-8000-000000000004', 'confirmed', '2026-09-19 10:00:00+01'),
  ('dd01000d-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000005', 'dd010006-0000-4000-8000-000000000001', 'confirmed', '2026-09-20 10:00:00+01'),
  ('dd01000d-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000006', 'dd010006-0000-4000-8000-000000000002', 'confirmed', '2026-09-21 10:00:00+01'),
  ('dd01000d-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000007', 'dd010006-0000-4000-8000-000000000003', 'confirmed', '2026-09-22 10:00:00+01'),
  ('dd01000d-0000-4000-8000-000000000010', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000008', 'dd010006-0000-4000-8000-000000000002', 'confirmed', '2026-09-23 10:00:00+01'),
  ('dd01000d-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000009', 'dd010006-0000-4000-8000-000000000003', 'confirmed', '2026-09-24 10:00:00+01'),
  ('dd01000d-0000-4000-8000-000000000012', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000010', 'dd010006-0000-4000-8000-000000000001', 'waitlist', '2026-09-25 10:00:00+01'),
  ('dd01000d-0000-4000-8000-000000000013', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000011', 'dd010006-0000-4000-8000-000000000002', 'confirmed', '2026-09-26 10:00:00+01'),
  ('dd01000d-0000-4000-8000-000000000014', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000011', 'dd010006-0000-4000-8000-000000000005', 'confirmed', '2026-09-27 10:00:00+01'),
  ('dd01000d-0000-4000-8000-000000000015', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000012', 'dd010006-0000-4000-8000-000000000001', 'confirmed', '2026-09-28 10:00:00+01'),
  ('dd01000d-0000-4000-8000-000000000016', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000012', 'dd010006-0000-4000-8000-000000000004', 'pending', '2026-09-29 10:00:00+01')
on conflict (id) do nothing;

insert into public.team_memberships (id, org_id, team_id, athlete_id, jersey_number, position, status, joined_on) values
  ('dd010017-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000001', 'dd01000b-0000-4000-8000-000000000001', 7, 'Point guard', 'active', '2026-08-24'),
  ('dd010017-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000002', 'dd01000b-0000-4000-8000-000000000002', 4, 'Guard', 'active', '2026-08-24'),
  ('dd010017-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000001', 'dd01000b-0000-4000-8000-000000000003', 11, 'Forward', 'active', '2026-08-24'),
  ('dd010017-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000001', 'dd01000b-0000-4000-8000-000000000004', 5, 'Guard', 'active', '2026-08-24'),
  ('dd010017-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000002', 'dd01000b-0000-4000-8000-000000000005', 9, 'Guard', 'active', '2026-08-24'),
  ('dd010017-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000001', 'dd01000b-0000-4000-8000-000000000006', 15, 'Center', 'active', '2026-08-24'),
  ('dd010017-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000003', 'dd01000b-0000-4000-8000-000000000007', 23, 'Forward', 'active', '2026-08-24'),
  ('dd010017-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000001', 'dd01000b-0000-4000-8000-000000000008', 3, 'Guard', 'active', '2026-08-24'),
  ('dd010017-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000003', 'dd01000b-0000-4000-8000-000000000009', 12, 'Center', 'active', '2026-08-24'),
  ('dd010017-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000001', 'dd01000b-0000-4000-8000-000000000011', 21, 'Wing', 'injured', '2026-08-24'),
  ('dd010017-0000-4000-8000-000000000012', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000002', 'dd01000b-0000-4000-8000-000000000012', 6, 'Guard', 'active', '2026-08-24')
on conflict (id) do nothing;

insert into public.invoices (id, org_id, number, family_id, athlete_id, program_id, description, currency, total_chf, subtotal_amount, tax_rate, tax_amount, tax_inclusive, reverse_charge, status, due_date, issued_at, paid_at, payment_reference) values
  ('dd01000e-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'DL-2026-0021', 'dd01000a-0000-4000-8000-000000000001', 'dd01000b-0000-4000-8000-000000000001', 'dd010006-0000-4000-8000-000000000002', 'Cheetahs U14 · Autumn term', 'CHF', 340, 340, 0, 0, false, false, 'paid', '2026-10-01', '2026-09-01 08:00:00+01', '2026-09-12 09:30:00+01', '000000000000000021000000010'),
  ('dd01000e-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'DL-2026-0034', 'dd01000a-0000-4000-8000-000000000001', 'dd01000b-0000-4000-8000-000000000002', 'dd010006-0000-4000-8000-000000000001', 'Big Ballers U12 · Autumn term', 'CHF', 290, 290, 0, 0, false, false, 'overdue', '2026-10-10', '2026-09-10 08:00:00+01', null, '000000000000000021000000021'),
  ('dd01000e-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', 'DL-2026-0039', 'dd01000a-0000-4000-8000-000000000001', 'dd01000b-0000-4000-8000-000000000001', 'dd010006-0000-4000-8000-000000000005', 'Easter Camp 2027 · deposit', 'CHF', 150, 150, 0, 0, false, false, 'pending', '2026-12-05', '2026-11-05 08:00:00+01', null, '000000000000000021000000036'),
  ('dd01000e-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000001', 'DL-2026-0022', 'dd01000a-0000-4000-8000-000000000002', 'dd01000b-0000-4000-8000-000000000003', 'dd010006-0000-4000-8000-000000000002', 'Cheetahs U14 · Autumn term', 'CHF', 340, 340, 0, 0, false, false, 'paid', '2026-10-01', '2026-09-01 08:00:00+01', '2026-09-20 09:30:00+01', '000000000000000021000000044'),
  ('dd01000e-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000001', 'DL-2026-0023', 'dd01000a-0000-4000-8000-000000000003', 'dd01000b-0000-4000-8000-000000000004', 'dd010006-0000-4000-8000-000000000002', 'Cheetahs U14 + Big Ballers U12 · Autumn term', 'CHF', 600, 600, 0, 0, false, false, 'paid', '2026-10-01', '2026-09-01 08:00:00+01', '2026-09-08 09:30:00+01', '000000000000000021000000052'),
  ('dd01000e-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000001', 'DL-2026-0024', 'dd01000a-0000-4000-8000-000000000004', 'dd01000b-0000-4000-8000-000000000006', 'dd010006-0000-4000-8000-000000000002', 'Cheetahs U14 · Autumn term', 'CHF', 340, 340, 0, 0, false, false, 'overdue', '2026-10-01', '2026-09-01 08:00:00+01', null, '000000000000000021000000068'),
  ('dd01000e-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000001', 'DL-2026-0025', 'dd01000a-0000-4000-8000-000000000005', 'dd01000b-0000-4000-8000-000000000007', 'dd010006-0000-4000-8000-000000000003', 'Unity U16 · Autumn term', 'CHF', 720, 720, 0, 0, false, false, 'partially_paid', '2026-10-01', '2026-09-01 08:00:00+01', null, '000000000000000021000000073'),
  ('dd01000e-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000001', 'DL-2026-0026', 'dd01000a-0000-4000-8000-000000000006', 'dd01000b-0000-4000-8000-000000000009', 'dd010006-0000-4000-8000-000000000003', 'Unity U16 · Autumn term', 'CHF', 380, 380, 0, 0, false, false, 'pending', '2026-11-19', '2026-10-20 08:00:00+01', null, '000000000000000021000000089'),
  ('dd01000e-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000001', 'DL-2026-0027', 'dd01000a-0000-4000-8000-000000000007', 'dd01000b-0000-4000-8000-000000000011', 'dd010006-0000-4000-8000-000000000005', 'Easter Camp 2027', 'CHF', 490, 490, 0, 0, false, false, 'paid', '2026-11-27', '2026-10-28 08:00:00+01', '2026-11-02 09:30:00+01', '000000000000000021000000097'),
  ('dd01000e-0000-4000-8000-000000000010', '00000000-0000-0000-0000-000000000001', 'DL-2026-0028', 'dd01000a-0000-4000-8000-000000000008', 'dd01000b-0000-4000-8000-000000000012', 'dd010006-0000-4000-8000-000000000001', 'Big Ballers U12 · Autumn term', 'CHF', 290, 290, 0, 0, false, false, 'pending', '2026-12-01', '2026-11-01 08:00:00+01', null, '000000000000000021000000102')
on conflict (id) do nothing;

insert into public.invoice_items (id, org_id, invoice_id, description, quantity, unit_price_chf, amount_chf) values
  ('dd01000f-0000-4000-8000-000000000010', '00000000-0000-0000-0000-000000000001', 'dd01000e-0000-4000-8000-000000000001', 'Cheetahs U14 · Autumn term (Sep-Dec)', 1, 340, 340),
  ('dd01000f-0000-4000-8000-000000000020', '00000000-0000-0000-0000-000000000001', 'dd01000e-0000-4000-8000-000000000002', 'Big Ballers U12 · Autumn term (Sep-Dec)', 1, 290, 290),
  ('dd01000f-0000-4000-8000-000000000030', '00000000-0000-0000-0000-000000000001', 'dd01000e-0000-4000-8000-000000000003', 'Easter Camp 2027 · deposit', 1, 150, 150),
  ('dd01000f-0000-4000-8000-000000000040', '00000000-0000-0000-0000-000000000001', 'dd01000e-0000-4000-8000-000000000004', 'Cheetahs U14 · Autumn term (Sep-Dec)', 1, 340, 340),
  ('dd01000f-0000-4000-8000-000000000050', '00000000-0000-0000-0000-000000000001', 'dd01000e-0000-4000-8000-000000000005', 'Cheetahs U14 · Autumn term (Sep-Dec)', 1, 340, 340),
  ('dd01000f-0000-4000-8000-000000000051', '00000000-0000-0000-0000-000000000001', 'dd01000e-0000-4000-8000-000000000005', 'Big Ballers U12 · Autumn term (Sep-Dec)', 1, 290, 290),
  ('dd01000f-0000-4000-8000-000000000052', '00000000-0000-0000-0000-000000000001', 'dd01000e-0000-4000-8000-000000000005', 'Sibling discount', 1, -30, -30),
  ('dd01000f-0000-4000-8000-000000000060', '00000000-0000-0000-0000-000000000001', 'dd01000e-0000-4000-8000-000000000006', 'Cheetahs U14 · Autumn term (Sep-Dec)', 1, 340, 340),
  ('dd01000f-0000-4000-8000-000000000070', '00000000-0000-0000-0000-000000000001', 'dd01000e-0000-4000-8000-000000000007', 'Unity U16 · Autumn term (Sep-Dec)', 1, 380, 380),
  ('dd01000f-0000-4000-8000-000000000071', '00000000-0000-0000-0000-000000000001', 'dd01000e-0000-4000-8000-000000000007', 'Cheetahs U14 · Autumn term (Sep-Dec)', 1, 340, 340),
  ('dd01000f-0000-4000-8000-000000000080', '00000000-0000-0000-0000-000000000001', 'dd01000e-0000-4000-8000-000000000008', 'Unity U16 · Autumn term (Sep-Dec)', 1, 380, 380),
  ('dd01000f-0000-4000-8000-000000000090', '00000000-0000-0000-0000-000000000001', 'dd01000e-0000-4000-8000-000000000009', 'Easter Camp 2027 (5 days)', 1, 490, 490),
  ('dd01000f-0000-4000-8000-000000000100', '00000000-0000-0000-0000-000000000001', 'dd01000e-0000-4000-8000-000000000010', 'Big Ballers U12 · Autumn term (Sep-Dec)', 1, 290, 290)
on conflict (id) do nothing;

insert into public.payments (id, org_id, invoice_id, amount_chf, currency, method, status, paid_at, notes, qr_reference) values
  ('dd010010-0000-4000-8000-000000000010', '00000000-0000-0000-0000-000000000001', 'dd01000e-0000-4000-8000-000000000001', 340, 'CHF', 'twint', 'succeeded', '2026-09-12 09:30:00+01', 'TWINT (demo)', null),
  ('dd010010-0000-4000-8000-000000000040', '00000000-0000-0000-0000-000000000001', 'dd01000e-0000-4000-8000-000000000004', 340, 'CHF', 'qr_bill', 'succeeded', '2026-09-20 09:30:00+01', 'QR-bill (demo)', '000000000000000021000000044'),
  ('dd010010-0000-4000-8000-000000000050', '00000000-0000-0000-0000-000000000001', 'dd01000e-0000-4000-8000-000000000005', 600, 'CHF', 'bank_transfer', 'succeeded', '2026-09-08 09:30:00+01', 'Bank transfer (demo)', null),
  ('dd010010-0000-4000-8000-000000000070', '00000000-0000-0000-0000-000000000001', 'dd01000e-0000-4000-8000-000000000007', 380, 'CHF', 'twint', 'succeeded', '2026-09-15 09:30:00+01', 'TWINT (demo)', null),
  ('dd010010-0000-4000-8000-000000000090', '00000000-0000-0000-0000-000000000001', 'dd01000e-0000-4000-8000-000000000009', 490, 'CHF', 'card', 'succeeded', '2026-11-02 09:30:00+01', 'Card (demo)', null)
on conflict (id) do nothing;

insert into public.program_sessions (id, org_id, program_id, coach_id, starts_at, ends_at, location, capacity) values
  ('dd010008-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'dd010006-0000-4000-8000-000000000002', 'dd010001-0000-4000-8000-000000000001', '2026-11-03 17:30:00+01', '2026-11-03 19:00:00+01', 'Salle de sport Exemple', 30),
  ('dd010008-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'dd010006-0000-4000-8000-000000000002', 'dd010001-0000-4000-8000-000000000001', '2026-11-05 17:30:00+01', '2026-11-05 19:00:00+01', 'Salle de sport Exemple', 30),
  ('dd010008-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', 'dd010006-0000-4000-8000-000000000002', 'dd010001-0000-4000-8000-000000000001', '2026-11-10 17:30:00+01', '2026-11-10 19:00:00+01', 'Salle de sport Exemple', 30),
  ('dd010008-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000001', 'dd010006-0000-4000-8000-000000000002', 'dd010001-0000-4000-8000-000000000001', '2026-11-12 17:30:00+01', '2026-11-12 19:00:00+01', 'Salle de sport Exemple', 30),
  ('dd010008-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000001', 'dd010006-0000-4000-8000-000000000002', 'dd010001-0000-4000-8000-000000000001', '2026-11-17 17:30:00+01', '2026-11-17 19:00:00+01', 'Salle de sport Exemple', 30),
  ('dd010008-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000001', 'dd010006-0000-4000-8000-000000000002', 'dd010001-0000-4000-8000-000000000001', '2026-11-19 17:30:00+01', '2026-11-19 19:00:00+01', 'Salle de sport Exemple', 30),
  ('dd010008-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000001', 'dd010006-0000-4000-8000-000000000001', 'dd010001-0000-4000-8000-000000000002', '2026-11-02 17:00:00+01', '2026-11-02 18:15:00+01', 'Salle de sport Exemple', 30),
  ('dd010008-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000001', 'dd010006-0000-4000-8000-000000000001', 'dd010001-0000-4000-8000-000000000002', '2026-11-04 17:00:00+01', '2026-11-04 18:15:00+01', 'Salle de sport Exemple', 30),
  ('dd010008-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000001', 'dd010006-0000-4000-8000-000000000001', 'dd010001-0000-4000-8000-000000000002', '2026-11-09 17:00:00+01', '2026-11-09 18:15:00+01', 'Salle de sport Exemple', 30),
  ('dd010008-0000-4000-8000-000000000010', '00000000-0000-0000-0000-000000000001', 'dd010006-0000-4000-8000-000000000001', 'dd010001-0000-4000-8000-000000000002', '2026-11-11 17:00:00+01', '2026-11-11 18:15:00+01', 'Salle de sport Exemple', 30),
  ('dd010008-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000001', 'dd010006-0000-4000-8000-000000000001', 'dd010001-0000-4000-8000-000000000002', '2026-11-16 17:00:00+01', '2026-11-16 18:15:00+01', 'Salle de sport Exemple', 30),
  ('dd010008-0000-4000-8000-000000000012', '00000000-0000-0000-0000-000000000001', 'dd010006-0000-4000-8000-000000000001', 'dd010001-0000-4000-8000-000000000002', '2026-11-18 17:00:00+01', '2026-11-18 18:15:00+01', 'Salle de sport Exemple', 30),
  ('dd010008-0000-4000-8000-000000000013', '00000000-0000-0000-0000-000000000001', 'dd010006-0000-4000-8000-000000000003', 'dd010001-0000-4000-8000-000000000001', '2026-11-03 19:00:00+01', '2026-11-03 20:30:00+01', 'Salle de sport Exemple', 30),
  ('dd010008-0000-4000-8000-000000000014', '00000000-0000-0000-0000-000000000001', 'dd010006-0000-4000-8000-000000000003', 'dd010001-0000-4000-8000-000000000001', '2026-11-06 18:30:00+01', '2026-11-06 20:00:00+01', 'Salle de sport Exemple', 30),
  ('dd010008-0000-4000-8000-000000000015', '00000000-0000-0000-0000-000000000001', 'dd010006-0000-4000-8000-000000000003', 'dd010001-0000-4000-8000-000000000001', '2026-11-10 19:00:00+01', '2026-11-10 20:30:00+01', 'Salle de sport Exemple', 30),
  ('dd010008-0000-4000-8000-000000000016', '00000000-0000-0000-0000-000000000001', 'dd010006-0000-4000-8000-000000000003', 'dd010001-0000-4000-8000-000000000001', '2026-11-13 18:30:00+01', '2026-11-13 20:00:00+01', 'Salle de sport Exemple', 30),
  ('dd010008-0000-4000-8000-000000000017', '00000000-0000-0000-0000-000000000001', 'dd010006-0000-4000-8000-000000000003', 'dd010001-0000-4000-8000-000000000001', '2026-11-17 19:00:00+01', '2026-11-17 20:30:00+01', 'Salle de sport Exemple', 30),
  ('dd010008-0000-4000-8000-000000000018', '00000000-0000-0000-0000-000000000001', 'dd010006-0000-4000-8000-000000000003', 'dd010001-0000-4000-8000-000000000001', '2026-11-20 18:30:00+01', '2026-11-20 20:00:00+01', 'Salle de sport Exemple', 30)
on conflict (id) do nothing;

insert into public.events (id, org_id, team_id, season_id, program_session_id, type, title, venue_id, starts_at, ends_at, opponent, home_away, status) values
  ('dd010009-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000001', 'dd010005-0000-4000-8000-000000000001', 'dd010008-0000-4000-8000-000000000001', 'training', 'Team practice', 'dd010002-0000-4000-8000-000000000001', '2026-11-03 17:30:00+01', '2026-11-03 19:00:00+01', null, null, 'completed'),
  ('dd010009-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000001', 'dd010005-0000-4000-8000-000000000001', 'dd010008-0000-4000-8000-000000000002', 'training', 'Team practice', 'dd010002-0000-4000-8000-000000000001', '2026-11-05 17:30:00+01', '2026-11-05 19:00:00+01', null, null, 'completed'),
  ('dd010009-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000001', 'dd010005-0000-4000-8000-000000000001', 'dd010008-0000-4000-8000-000000000003', 'training', 'Team practice', 'dd010002-0000-4000-8000-000000000001', '2026-11-10 17:30:00+01', '2026-11-10 19:00:00+01', null, null, 'completed'),
  ('dd010009-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000001', 'dd010005-0000-4000-8000-000000000001', 'dd010008-0000-4000-8000-000000000004', 'training', 'Team practice', 'dd010002-0000-4000-8000-000000000001', '2026-11-12 17:30:00+01', '2026-11-12 19:00:00+01', null, null, 'scheduled'),
  ('dd010009-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000001', 'dd010005-0000-4000-8000-000000000001', 'dd010008-0000-4000-8000-000000000005', 'training', 'Team practice', 'dd010002-0000-4000-8000-000000000001', '2026-11-17 17:30:00+01', '2026-11-17 19:00:00+01', null, null, 'scheduled'),
  ('dd010009-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000001', 'dd010005-0000-4000-8000-000000000001', 'dd010008-0000-4000-8000-000000000006', 'training', 'Team practice', 'dd010002-0000-4000-8000-000000000001', '2026-11-19 17:30:00+01', '2026-11-19 19:00:00+01', null, null, 'scheduled'),
  ('dd010009-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000001', 'dd010005-0000-4000-8000-000000000001', null, 'game', 'League game', 'dd010002-0000-4000-8000-000000000001', '2026-11-07 14:00:00+01', '2026-11-07 16:00:00+01', 'BC Exemple Morges', 'home', 'completed'),
  ('dd010009-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000001', 'dd010005-0000-4000-8000-000000000001', null, 'game', 'League game', null, '2026-11-14 15:00:00+01', '2026-11-14 17:00:00+01', 'Basket Démo Vevey', 'away', 'scheduled'),
  ('dd010009-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000001', 'dd010005-0000-4000-8000-000000000001', null, 'game', 'League game', 'dd010002-0000-4000-8000-000000000001', '2026-11-21 14:00:00+01', '2026-11-21 16:00:00+01', 'BC Fictif Nyon', 'home', 'scheduled'),
  ('dd010009-0000-4000-8000-000000000010', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000002', 'dd010005-0000-4000-8000-000000000001', 'dd010008-0000-4000-8000-000000000007', 'training', 'Team practice', 'dd010002-0000-4000-8000-000000000001', '2026-11-02 17:00:00+01', '2026-11-02 18:15:00+01', null, null, 'completed'),
  ('dd010009-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000002', 'dd010005-0000-4000-8000-000000000001', 'dd010008-0000-4000-8000-000000000008', 'training', 'Team practice', 'dd010002-0000-4000-8000-000000000001', '2026-11-04 17:00:00+01', '2026-11-04 18:15:00+01', null, null, 'completed'),
  ('dd010009-0000-4000-8000-000000000012', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000002', 'dd010005-0000-4000-8000-000000000001', 'dd010008-0000-4000-8000-000000000009', 'training', 'Team practice', 'dd010002-0000-4000-8000-000000000001', '2026-11-09 17:00:00+01', '2026-11-09 18:15:00+01', null, null, 'completed'),
  ('dd010009-0000-4000-8000-000000000013', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000002', 'dd010005-0000-4000-8000-000000000001', 'dd010008-0000-4000-8000-000000000010', 'training', 'Team practice', 'dd010002-0000-4000-8000-000000000001', '2026-11-11 17:00:00+01', '2026-11-11 18:15:00+01', null, null, 'completed'),
  ('dd010009-0000-4000-8000-000000000014', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000002', 'dd010005-0000-4000-8000-000000000001', 'dd010008-0000-4000-8000-000000000011', 'training', 'Team practice', 'dd010002-0000-4000-8000-000000000001', '2026-11-16 17:00:00+01', '2026-11-16 18:15:00+01', null, null, 'scheduled'),
  ('dd010009-0000-4000-8000-000000000015', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000002', 'dd010005-0000-4000-8000-000000000001', 'dd010008-0000-4000-8000-000000000012', 'training', 'Team practice', 'dd010002-0000-4000-8000-000000000001', '2026-11-18 17:00:00+01', '2026-11-18 18:15:00+01', null, null, 'scheduled'),
  ('dd010009-0000-4000-8000-000000000016', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000002', 'dd010005-0000-4000-8000-000000000001', null, 'game', 'U12 tournament', 'dd010002-0000-4000-8000-000000000001', '2026-11-15 10:00:00+01', '2026-11-15 12:00:00+01', 'Tournoi Démo Lausanne', 'home', 'scheduled'),
  ('dd010009-0000-4000-8000-000000000017', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000003', 'dd010005-0000-4000-8000-000000000001', 'dd010008-0000-4000-8000-000000000013', 'training', 'Team practice', 'dd010002-0000-4000-8000-000000000001', '2026-11-03 19:00:00+01', '2026-11-03 20:30:00+01', null, null, 'completed'),
  ('dd010009-0000-4000-8000-000000000018', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000003', 'dd010005-0000-4000-8000-000000000001', 'dd010008-0000-4000-8000-000000000014', 'training', 'Team practice', 'dd010002-0000-4000-8000-000000000001', '2026-11-06 18:30:00+01', '2026-11-06 20:00:00+01', null, null, 'completed'),
  ('dd010009-0000-4000-8000-000000000019', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000003', 'dd010005-0000-4000-8000-000000000001', 'dd010008-0000-4000-8000-000000000015', 'training', 'Team practice', 'dd010002-0000-4000-8000-000000000001', '2026-11-10 19:00:00+01', '2026-11-10 20:30:00+01', null, null, 'completed'),
  ('dd010009-0000-4000-8000-000000000020', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000003', 'dd010005-0000-4000-8000-000000000001', 'dd010008-0000-4000-8000-000000000016', 'training', 'Team practice', 'dd010002-0000-4000-8000-000000000001', '2026-11-13 18:30:00+01', '2026-11-13 20:00:00+01', null, null, 'scheduled'),
  ('dd010009-0000-4000-8000-000000000021', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000003', 'dd010005-0000-4000-8000-000000000001', 'dd010008-0000-4000-8000-000000000017', 'training', 'Team practice', 'dd010002-0000-4000-8000-000000000001', '2026-11-17 19:00:00+01', '2026-11-17 20:30:00+01', null, null, 'scheduled'),
  ('dd010009-0000-4000-8000-000000000022', '00000000-0000-0000-0000-000000000001', 'dd010007-0000-4000-8000-000000000003', 'dd010005-0000-4000-8000-000000000001', 'dd010008-0000-4000-8000-000000000018', 'training', 'Team practice', 'dd010002-0000-4000-8000-000000000001', '2026-11-20 18:30:00+01', '2026-11-20 20:00:00+01', null, null, 'scheduled')
on conflict (id) do nothing;

insert into public.game_results (event_id, org_id, score_for, score_against) values
  ('dd010009-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000001', 58, 51)
on conflict (event_id) do nothing;

insert into public.attendance_sessions (id, org_id, program_id, program_session_id, coach_id, session_date, status, roster_size, submitted_at) values
  ('dd010011-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'dd010006-0000-4000-8000-000000000002', 'dd010008-0000-4000-8000-000000000001', 'dd010001-0000-4000-8000-000000000001', '2026-11-03 17:30:00+01', 'submitted', 6, '2026-11-03 19:15:00+01'),
  ('dd010011-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'dd010006-0000-4000-8000-000000000002', 'dd010008-0000-4000-8000-000000000002', 'dd010001-0000-4000-8000-000000000001', '2026-11-05 17:30:00+01', 'submitted', 6, '2026-11-05 19:15:00+01'),
  ('dd010011-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', 'dd010006-0000-4000-8000-000000000002', 'dd010008-0000-4000-8000-000000000003', 'dd010001-0000-4000-8000-000000000001', '2026-11-10 17:30:00+01', 'submitted', 6, '2026-11-10 19:15:00+01'),
  ('dd010011-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000001', 'dd010006-0000-4000-8000-000000000002', 'dd010008-0000-4000-8000-000000000004', 'dd010001-0000-4000-8000-000000000001', '2026-11-12 17:30:00+01', 'open', 6, null)
on conflict (id) do nothing;

insert into public.attendance_marks (id, org_id, attendance_session_id, athlete_id, status, marked_by) values
  ('dd010012-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'dd010011-0000-4000-8000-000000000001', 'dd01000b-0000-4000-8000-000000000001', 'present', 'dd010001-0000-4000-8000-000000000001'),
  ('dd010012-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'dd010011-0000-4000-8000-000000000001', 'dd01000b-0000-4000-8000-000000000003', 'late', 'dd010001-0000-4000-8000-000000000001'),
  ('dd010012-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', 'dd010011-0000-4000-8000-000000000001', 'dd01000b-0000-4000-8000-000000000004', 'present', 'dd010001-0000-4000-8000-000000000001'),
  ('dd010012-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000001', 'dd010011-0000-4000-8000-000000000001', 'dd01000b-0000-4000-8000-000000000006', 'absent', 'dd010001-0000-4000-8000-000000000001'),
  ('dd010012-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000001', 'dd010011-0000-4000-8000-000000000001', 'dd01000b-0000-4000-8000-000000000008', 'present', 'dd010001-0000-4000-8000-000000000001'),
  ('dd010012-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000001', 'dd010011-0000-4000-8000-000000000001', 'dd01000b-0000-4000-8000-000000000011', 'excused', 'dd010001-0000-4000-8000-000000000001'),
  ('dd010012-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000001', 'dd010011-0000-4000-8000-000000000002', 'dd01000b-0000-4000-8000-000000000001', 'late', 'dd010001-0000-4000-8000-000000000001'),
  ('dd010012-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000001', 'dd010011-0000-4000-8000-000000000002', 'dd01000b-0000-4000-8000-000000000003', 'present', 'dd010001-0000-4000-8000-000000000001'),
  ('dd010012-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000001', 'dd010011-0000-4000-8000-000000000002', 'dd01000b-0000-4000-8000-000000000004', 'absent', 'dd010001-0000-4000-8000-000000000001'),
  ('dd010012-0000-4000-8000-000000000010', '00000000-0000-0000-0000-000000000001', 'dd010011-0000-4000-8000-000000000002', 'dd01000b-0000-4000-8000-000000000006', 'present', 'dd010001-0000-4000-8000-000000000001'),
  ('dd010012-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000001', 'dd010011-0000-4000-8000-000000000002', 'dd01000b-0000-4000-8000-000000000008', 'excused', 'dd010001-0000-4000-8000-000000000001'),
  ('dd010012-0000-4000-8000-000000000012', '00000000-0000-0000-0000-000000000001', 'dd010011-0000-4000-8000-000000000002', 'dd01000b-0000-4000-8000-000000000011', 'present', 'dd010001-0000-4000-8000-000000000001'),
  ('dd010012-0000-4000-8000-000000000013', '00000000-0000-0000-0000-000000000001', 'dd010011-0000-4000-8000-000000000003', 'dd01000b-0000-4000-8000-000000000001', 'present', 'dd010001-0000-4000-8000-000000000001'),
  ('dd010012-0000-4000-8000-000000000014', '00000000-0000-0000-0000-000000000001', 'dd010011-0000-4000-8000-000000000003', 'dd01000b-0000-4000-8000-000000000003', 'absent', 'dd010001-0000-4000-8000-000000000001'),
  ('dd010012-0000-4000-8000-000000000015', '00000000-0000-0000-0000-000000000001', 'dd010011-0000-4000-8000-000000000003', 'dd01000b-0000-4000-8000-000000000004', 'present', 'dd010001-0000-4000-8000-000000000001'),
  ('dd010012-0000-4000-8000-000000000016', '00000000-0000-0000-0000-000000000001', 'dd010011-0000-4000-8000-000000000003', 'dd01000b-0000-4000-8000-000000000006', 'excused', 'dd010001-0000-4000-8000-000000000001'),
  ('dd010012-0000-4000-8000-000000000017', '00000000-0000-0000-0000-000000000001', 'dd010011-0000-4000-8000-000000000003', 'dd01000b-0000-4000-8000-000000000008', 'present', 'dd010001-0000-4000-8000-000000000001'),
  ('dd010012-0000-4000-8000-000000000018', '00000000-0000-0000-0000-000000000001', 'dd010011-0000-4000-8000-000000000003', 'dd01000b-0000-4000-8000-000000000011', 'present', 'dd010001-0000-4000-8000-000000000001')
on conflict (id) do nothing;

insert into public.consent_acceptances (id, org_id, athlete_id, consent_form_id, accepted_version, accepted_at, status) values
  ('dd01001a-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000001', 'dd010004-0000-4000-8000-000000000001', 1, '2026-08-20 19:00:00+02', 'accepted'),
  ('dd01001a-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000001', 'dd010004-0000-4000-8000-000000000002', 1, '2026-08-20 19:00:00+02', 'accepted'),
  ('dd01001a-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000001', 'dd010004-0000-4000-8000-000000000003', 1, '2026-08-20 19:00:00+02', 'accepted'),
  ('dd01001a-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000002', 'dd010004-0000-4000-8000-000000000001', 1, '2026-08-20 19:00:00+02', 'accepted'),
  ('dd01001a-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000002', 'dd010004-0000-4000-8000-000000000002', 1, '2026-08-20 19:00:00+02', 'accepted'),
  ('dd01001a-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000002', 'dd010004-0000-4000-8000-000000000003', 1, '2026-08-20 19:00:00+02', 'accepted'),
  ('dd01001a-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000003', 'dd010004-0000-4000-8000-000000000001', 1, '2026-08-20 19:00:00+02', 'accepted'),
  ('dd01001a-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000003', 'dd010004-0000-4000-8000-000000000002', 1, '2026-08-20 19:00:00+02', 'accepted'),
  ('dd01001a-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000003', 'dd010004-0000-4000-8000-000000000003', 1, '2026-08-20 19:00:00+02', 'accepted'),
  ('dd01001a-0000-4000-8000-000000000010', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000004', 'dd010004-0000-4000-8000-000000000001', 1, '2026-08-20 19:00:00+02', 'accepted'),
  ('dd01001a-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000004', 'dd010004-0000-4000-8000-000000000002', 1, '2026-08-20 19:00:00+02', 'accepted'),
  ('dd01001a-0000-4000-8000-000000000012', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000004', 'dd010004-0000-4000-8000-000000000003', 1, '2026-08-20 19:00:00+02', 'accepted'),
  ('dd01001a-0000-4000-8000-000000000013', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000005', 'dd010004-0000-4000-8000-000000000001', 1, '2026-08-20 19:00:00+02', 'accepted'),
  ('dd01001a-0000-4000-8000-000000000014', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000005', 'dd010004-0000-4000-8000-000000000002', 1, '2026-08-20 19:00:00+02', 'accepted'),
  ('dd01001a-0000-4000-8000-000000000015', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000005', 'dd010004-0000-4000-8000-000000000003', 1, '2026-08-20 19:00:00+02', 'accepted')
on conflict (id) do nothing;

insert into public.notifications (id, org_id, recipient_id, type, title, body) values
  ('dd010016-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', null, 'practice', 'Game day: Cheetahs U14 at Basket Démo Vevey', 'Sat 14 Nov · 15:00 · meet at 13:45 at the hall.'),
  ('dd010016-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', null, 'system', 'Welcome to DLang OS', 'Your club portal is live (demo data).'),
  ('dd010016-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', null, 'payment', 'Autumn term invoices sent', 'Invoices for the autumn term are in the parent app.')
on conflict (id) do nothing;

insert into public.training_credits (id, org_id, athlete_id, credit_category, total_credits, used_credits) values
  ('dd010013-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000001', 'personal', 5, 2),
  ('dd010013-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000003', 'personal', 10, 4),
  ('dd010013-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000002', 'mental', 2, 0)
on conflict (id) do nothing;

insert into public.training_bookings (id, org_id, athlete_id, service_id, coach_id, slot_start, slot_end, status, paid_with, credits_used, price_chf) values
  ('dd010014-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000001', 'dd010003-0000-4000-8000-000000000001', 'dd010001-0000-4000-8000-000000000001', '2026-11-14 10:00:00+01', '2026-11-14 11:00:00+01', 'booked', null, 1, 75),
  ('dd010014-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'dd01000b-0000-4000-8000-000000000003', 'dd010003-0000-4000-8000-000000000002', 'dd010001-0000-4000-8000-000000000003', '2026-11-07 16:00:00+01', '2026-11-07 16:45:00+01', 'completed', null, 1, 65)
on conflict (id) do nothing;

insert into public.coach_availability (id, org_id, coach_id, starts_at, ends_at, is_booked) values
  ('dd010015-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'dd010001-0000-4000-8000-000000000001', '2026-11-13 14:00:00+01', '2026-11-13 15:00:00+01', false),
  ('dd010015-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'dd010001-0000-4000-8000-000000000002', '2026-11-14 14:00:00+01', '2026-11-14 15:00:00+01', false),
  ('dd010015-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000001', 'dd010001-0000-4000-8000-000000000002', '2026-11-16 14:00:00+01', '2026-11-16 15:00:00+01', false),
  ('dd010015-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000001', 'dd010001-0000-4000-8000-000000000001', '2026-11-17 14:00:00+01', '2026-11-17 15:00:00+01', false),
  ('dd010015-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000001', 'dd010001-0000-4000-8000-000000000002', '2026-11-18 14:00:00+01', '2026-11-18 15:00:00+01', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------- FC Seeblick (fictional demo club)

insert into public.venues (id, org_id, name, address, city, postal_code, country, capacity) values
  ('dd020002-0000-4000-8000-000000000001', '20000000-0000-0000-0000-000000000002', 'Sportanlage Musterwiese', 'Musterweg 1', 'Zürich', '8000', 'CH', 800)
on conflict (id) do nothing;

insert into public.coaches (id, org_id, display_name, role_title, serves, bio) values
  ('dd020001-0000-4000-8000-000000000001', '20000000-0000-0000-0000-000000000002', 'Reto Beispiel', 'Cheftrainer Junioren D', '{group}', 'Demo-Trainerprofil.'),
  ('dd020001-0000-4000-8000-000000000002', '20000000-0000-0000-0000-000000000002', 'Sandra Muster', 'Trainerin Junioren E', '{group}', 'Demo-Trainerprofil.')
on conflict (id) do nothing;

insert into public.consent_forms (id, org_id, key, title, body, version, locale, is_required) values
  ('dd020004-0000-4000-8000-000000000001', '20000000-0000-0000-0000-000000000002', 'media', 'Einwilligung Foto & Video', 'Fotos und Videos meines Kindes dürfen für Vereinsmitteilungen verwendet werden.', 1, 'de', false),
  ('dd020004-0000-4000-8000-000000000002', '20000000-0000-0000-0000-000000000002', 'terms', 'Vereinsbedingungen', 'Ich akzeptiere die Vereinsbedingungen und die Abmeldefristen.', 1, 'de', true)
on conflict (id) do nothing;

insert into public.seasons (id, org_id, name, starts_on, ends_on, is_current) values
  ('dd020005-0000-4000-8000-000000000001', '20000000-0000-0000-0000-000000000002', 'Saison 2026/27', '2026-08-24', '2027-06-30', true)
on conflict (id) do nothing;

insert into public.programs (id, org_id, slug, name, kind, description, price_chf, capacity, starts_on, ends_on, location, schedule, is_public, is_active) values
  ('dd020006-0000-4000-8000-000000000001', '20000000-0000-0000-0000-000000000002', 'junioren-e', 'Junioren E (U10)', 'recurring_team', 'Training zweimal pro Woche, Meisterschaft Region Zürich.', 220, 20, '2026-08-24', '2027-06-30', 'Sportanlage Musterwiese, Zürich', null, true, true),
  ('dd020006-0000-4000-8000-000000000002', '20000000-0000-0000-0000-000000000002', 'junioren-d', 'Junioren D (U12)', 'recurring_team', 'Leistungsorientierte D-Junioren.', 260, 18, '2026-08-24', '2027-06-30', 'Sportanlage Musterwiese, Zürich', null, false, true),
  ('dd020006-0000-4000-8000-000000000003', '20000000-0000-0000-0000-000000000002', 'fussballcamp-ostern-2027', 'Fussballcamp Ostern 2027', 'camp', 'Fünf Tage Fussball für 7- bis 13-Jährige, Mittagessen inbegriffen.', 350, 60, '2027-04-12', '2027-04-16', 'Sportanlage Musterwiese, Zürich', null, true, true)
on conflict (id) do nothing;

insert into public.teams (id, org_id, season_id, program_id, name, sport, age_group, gender, level, color) values
  ('dd020007-0000-4000-8000-000000000001', '20000000-0000-0000-0000-000000000002', 'dd020005-0000-4000-8000-000000000001', 'dd020006-0000-4000-8000-000000000002', 'Junioren D', 'football', 'U12', 'mixed', 'Promotion', '#0F7A3D'),
  ('dd020007-0000-4000-8000-000000000002', '20000000-0000-0000-0000-000000000002', 'dd020005-0000-4000-8000-000000000001', 'dd020006-0000-4000-8000-000000000001', 'Junioren E', 'football', 'U10', 'mixed', 'Breitensport', '#B8860B')
on conflict (id) do nothing;

insert into public.team_coaches (team_id, coach_id, org_id, role) values
  ('dd020007-0000-4000-8000-000000000001', 'dd020001-0000-4000-8000-000000000001', '20000000-0000-0000-0000-000000000002', 'head'),
  ('dd020007-0000-4000-8000-000000000002', 'dd020001-0000-4000-8000-000000000002', '20000000-0000-0000-0000-000000000002', 'head')
on conflict do nothing;

insert into public.families (id, org_id, name, address, phone, contact_name, contact_email) values
  ('dd02000a-0000-4000-8000-000000000001', '20000000-0000-0000-0000-000000000002', 'Familie Brunner', 'Musterstrasse 4, 8000 Zürich', '+41 00 000 10 10', 'Petra Brunner', 'brunner.demo@example.com'),
  ('dd02000a-0000-4000-8000-000000000002', '20000000-0000-0000-0000-000000000002', 'Familie Meier', 'Beispielweg 9, 8004 Zürich', '+41 00 000 11 17', 'Thomas Meier', 'meier.demo@example.com'),
  ('dd02000a-0000-4000-8000-000000000003', '20000000-0000-0000-0000-000000000002', 'Familie Gerber', 'Demoplatz 2, 8050 Zürich', '+41 00 000 12 24', 'Nadia Gerber', 'gerber.demo@example.com'),
  ('dd02000a-0000-4000-8000-000000000004', '20000000-0000-0000-0000-000000000002', 'Familie Frei', 'Fiktivgasse 6, 8037 Zürich', '+41 00 000 13 31', 'Andrea Frei', 'frei.demo@example.com')
on conflict (id) do nothing;

insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, gender, school, jersey_size, dominant_hand, position_pref, status) values
  ('dd02000b-0000-4000-8000-000000000001', '20000000-0000-0000-0000-000000000002', 'dd02000a-0000-4000-8000-000000000001', 'Luca', 'Brunner', '2015-02-11', 'Male', null, null, 'Rechts', 'Sturm', 'active'),
  ('dd02000b-0000-4000-8000-000000000002', '20000000-0000-0000-0000-000000000002', 'dd02000a-0000-4000-8000-000000000002', 'Lina', 'Meier', '2015-06-23', 'Female', null, null, 'Rechts', 'Mittelfeld', 'active'),
  ('dd02000b-0000-4000-8000-000000000003', '20000000-0000-0000-0000-000000000002', 'dd02000a-0000-4000-8000-000000000002', 'Jonas', 'Meier', '2017-03-01', 'Male', null, null, 'Rechts', 'Verteidigung', 'active'),
  ('dd02000b-0000-4000-8000-000000000004', '20000000-0000-0000-0000-000000000002', 'dd02000a-0000-4000-8000-000000000003', 'Elias', 'Gerber', '2014-12-15', 'Male', null, null, 'Rechts', 'Tor', 'active'),
  ('dd02000b-0000-4000-8000-000000000005', '20000000-0000-0000-0000-000000000002', 'dd02000a-0000-4000-8000-000000000004', 'Nina', 'Frei', '2017-09-30', 'Female', null, null, 'Rechts', 'Sturm', 'active'),
  ('dd02000b-0000-4000-8000-000000000006', '20000000-0000-0000-0000-000000000002', 'dd02000a-0000-4000-8000-000000000004', 'Tim', 'Frei', '2015-11-04', 'Male', null, null, 'Rechts', 'Mittelfeld', 'active')
on conflict (id) do nothing;

insert into public.registrations (id, org_id, athlete_id, program_id, status, created_at) values
  ('dd02000d-0000-4000-8000-000000000001', '20000000-0000-0000-0000-000000000002', 'dd02000b-0000-4000-8000-000000000001', 'dd020006-0000-4000-8000-000000000002', 'confirmed', '2026-09-14 10:00:00+01'),
  ('dd02000d-0000-4000-8000-000000000002', '20000000-0000-0000-0000-000000000002', 'dd02000b-0000-4000-8000-000000000001', 'dd020006-0000-4000-8000-000000000003', 'pending', '2026-09-15 10:00:00+01'),
  ('dd02000d-0000-4000-8000-000000000003', '20000000-0000-0000-0000-000000000002', 'dd02000b-0000-4000-8000-000000000002', 'dd020006-0000-4000-8000-000000000002', 'confirmed', '2026-09-16 10:00:00+01'),
  ('dd02000d-0000-4000-8000-000000000004', '20000000-0000-0000-0000-000000000002', 'dd02000b-0000-4000-8000-000000000003', 'dd020006-0000-4000-8000-000000000001', 'confirmed', '2026-09-17 10:00:00+01'),
  ('dd02000d-0000-4000-8000-000000000005', '20000000-0000-0000-0000-000000000002', 'dd02000b-0000-4000-8000-000000000004', 'dd020006-0000-4000-8000-000000000002', 'confirmed', '2026-09-18 10:00:00+01'),
  ('dd02000d-0000-4000-8000-000000000006', '20000000-0000-0000-0000-000000000002', 'dd02000b-0000-4000-8000-000000000005', 'dd020006-0000-4000-8000-000000000001', 'confirmed', '2026-09-19 10:00:00+01'),
  ('dd02000d-0000-4000-8000-000000000007', '20000000-0000-0000-0000-000000000002', 'dd02000b-0000-4000-8000-000000000006', 'dd020006-0000-4000-8000-000000000002', 'waitlist', '2026-09-20 10:00:00+01')
on conflict (id) do nothing;

insert into public.team_memberships (id, org_id, team_id, athlete_id, jersey_number, position, status, joined_on) values
  ('dd020017-0000-4000-8000-000000000001', '20000000-0000-0000-0000-000000000002', 'dd020007-0000-4000-8000-000000000001', 'dd02000b-0000-4000-8000-000000000001', 9, 'Sturm', 'active', '2026-08-24'),
  ('dd020017-0000-4000-8000-000000000002', '20000000-0000-0000-0000-000000000002', 'dd020007-0000-4000-8000-000000000001', 'dd02000b-0000-4000-8000-000000000002', 8, 'Mittelfeld', 'active', '2026-08-24'),
  ('dd020017-0000-4000-8000-000000000003', '20000000-0000-0000-0000-000000000002', 'dd020007-0000-4000-8000-000000000002', 'dd02000b-0000-4000-8000-000000000003', 4, 'Verteidigung', 'active', '2026-08-24'),
  ('dd020017-0000-4000-8000-000000000004', '20000000-0000-0000-0000-000000000002', 'dd020007-0000-4000-8000-000000000001', 'dd02000b-0000-4000-8000-000000000004', 1, 'Tor', 'active', '2026-08-24'),
  ('dd020017-0000-4000-8000-000000000005', '20000000-0000-0000-0000-000000000002', 'dd020007-0000-4000-8000-000000000002', 'dd02000b-0000-4000-8000-000000000005', 10, 'Sturm', 'active', '2026-08-24')
on conflict (id) do nothing;

insert into public.invoices (id, org_id, number, family_id, athlete_id, program_id, description, currency, total_chf, subtotal_amount, tax_rate, tax_amount, tax_inclusive, reverse_charge, status, due_date, issued_at, paid_at, payment_reference) values
  ('dd02000e-0000-4000-8000-000000000001', '20000000-0000-0000-0000-000000000002', 'FCS-2026-0011', 'dd02000a-0000-4000-8000-000000000001', 'dd02000b-0000-4000-8000-000000000001', 'dd020006-0000-4000-8000-000000000002', 'Mitgliederbeitrag Junioren D · Herbst', 'CHF', 260, 260, 0, 0, false, false, 'paid', '2026-10-01', '2026-09-01 08:00:00+01', '2026-09-14 09:30:00+01', '000000000000000031000000019'),
  ('dd02000e-0000-4000-8000-000000000002', '20000000-0000-0000-0000-000000000002', 'FCS-2026-0012', 'dd02000a-0000-4000-8000-000000000002', 'dd02000b-0000-4000-8000-000000000002', 'dd020006-0000-4000-8000-000000000002', 'Mitgliederbeitrag Junioren D + E · Herbst', 'CHF', 440, 440, 0, 0, false, false, 'overdue', '2026-10-01', '2026-09-01 08:00:00+01', null, '000000000000000031000000027'),
  ('dd02000e-0000-4000-8000-000000000003', '20000000-0000-0000-0000-000000000002', 'FCS-2026-0013', 'dd02000a-0000-4000-8000-000000000003', 'dd02000b-0000-4000-8000-000000000004', 'dd020006-0000-4000-8000-000000000002', 'Mitgliederbeitrag Junioren D · Herbst', 'CHF', 260, 260, 0, 0, false, false, 'pending', '2026-11-14', '2026-10-15 08:00:00+01', null, '000000000000000031000000035'),
  ('dd02000e-0000-4000-8000-000000000004', '20000000-0000-0000-0000-000000000002', 'FCS-2026-0014', 'dd02000a-0000-4000-8000-000000000004', 'dd02000b-0000-4000-8000-000000000005', 'dd020006-0000-4000-8000-000000000001', 'Mitgliederbeitrag Junioren E · Herbst', 'CHF', 220, 220, 0, 0, false, false, 'paid', '2026-10-01', '2026-09-01 08:00:00+01', '2026-09-03 09:30:00+01', '000000000000000031000000040')
on conflict (id) do nothing;

insert into public.invoice_items (id, org_id, invoice_id, description, quantity, unit_price_chf, amount_chf) values
  ('dd02000f-0000-4000-8000-000000000010', '20000000-0000-0000-0000-000000000002', 'dd02000e-0000-4000-8000-000000000001', 'Mitgliederbeitrag Junioren D · Herbstrunde', 1, 260, 260),
  ('dd02000f-0000-4000-8000-000000000020', '20000000-0000-0000-0000-000000000002', 'dd02000e-0000-4000-8000-000000000002', 'Mitgliederbeitrag Junioren D · Herbstrunde', 1, 260, 260),
  ('dd02000f-0000-4000-8000-000000000021', '20000000-0000-0000-0000-000000000002', 'dd02000e-0000-4000-8000-000000000002', 'Mitgliederbeitrag Junioren E · Herbstrunde', 1, 220, 220),
  ('dd02000f-0000-4000-8000-000000000022', '20000000-0000-0000-0000-000000000002', 'dd02000e-0000-4000-8000-000000000002', 'Geschwisterrabatt', 1, -40, -40),
  ('dd02000f-0000-4000-8000-000000000030', '20000000-0000-0000-0000-000000000002', 'dd02000e-0000-4000-8000-000000000003', 'Mitgliederbeitrag Junioren D · Herbstrunde', 1, 260, 260),
  ('dd02000f-0000-4000-8000-000000000040', '20000000-0000-0000-0000-000000000002', 'dd02000e-0000-4000-8000-000000000004', 'Mitgliederbeitrag Junioren E · Herbstrunde', 1, 220, 220)
on conflict (id) do nothing;

insert into public.payments (id, org_id, invoice_id, amount_chf, currency, method, status, paid_at, notes, qr_reference) values
  ('dd020010-0000-4000-8000-000000000010', '20000000-0000-0000-0000-000000000002', 'dd02000e-0000-4000-8000-000000000001', 260, 'CHF', 'qr_bill', 'succeeded', '2026-09-14 09:30:00+01', 'QR-Rechnung (Demo)', '000000000000000031000000019'),
  ('dd020010-0000-4000-8000-000000000040', '20000000-0000-0000-0000-000000000002', 'dd02000e-0000-4000-8000-000000000004', 220, 'CHF', 'twint', 'succeeded', '2026-09-03 09:30:00+01', 'TWINT (Demo)', null)
on conflict (id) do nothing;

insert into public.program_sessions (id, org_id, program_id, coach_id, starts_at, ends_at, location, capacity) values
  ('dd020008-0000-4000-8000-000000000001', '20000000-0000-0000-0000-000000000002', 'dd020006-0000-4000-8000-000000000002', 'dd020001-0000-4000-8000-000000000001', '2026-11-03 17:30:00+01', '2026-11-03 19:00:00+01', 'Sportanlage Musterwiese', 30),
  ('dd020008-0000-4000-8000-000000000002', '20000000-0000-0000-0000-000000000002', 'dd020006-0000-4000-8000-000000000002', 'dd020001-0000-4000-8000-000000000001', '2026-11-05 17:30:00+01', '2026-11-05 19:00:00+01', 'Sportanlage Musterwiese', 30),
  ('dd020008-0000-4000-8000-000000000003', '20000000-0000-0000-0000-000000000002', 'dd020006-0000-4000-8000-000000000002', 'dd020001-0000-4000-8000-000000000001', '2026-11-10 17:30:00+01', '2026-11-10 19:00:00+01', 'Sportanlage Musterwiese', 30),
  ('dd020008-0000-4000-8000-000000000004', '20000000-0000-0000-0000-000000000002', 'dd020006-0000-4000-8000-000000000002', 'dd020001-0000-4000-8000-000000000001', '2026-11-12 17:30:00+01', '2026-11-12 19:00:00+01', 'Sportanlage Musterwiese', 30),
  ('dd020008-0000-4000-8000-000000000005', '20000000-0000-0000-0000-000000000002', 'dd020006-0000-4000-8000-000000000002', 'dd020001-0000-4000-8000-000000000001', '2026-11-17 17:30:00+01', '2026-11-17 19:00:00+01', 'Sportanlage Musterwiese', 30),
  ('dd020008-0000-4000-8000-000000000006', '20000000-0000-0000-0000-000000000002', 'dd020006-0000-4000-8000-000000000002', 'dd020001-0000-4000-8000-000000000001', '2026-11-19 17:30:00+01', '2026-11-19 19:00:00+01', 'Sportanlage Musterwiese', 30),
  ('dd020008-0000-4000-8000-000000000007', '20000000-0000-0000-0000-000000000002', 'dd020006-0000-4000-8000-000000000001', 'dd020001-0000-4000-8000-000000000002', '2026-11-02 17:00:00+01', '2026-11-02 18:15:00+01', 'Sportanlage Musterwiese', 30),
  ('dd020008-0000-4000-8000-000000000008', '20000000-0000-0000-0000-000000000002', 'dd020006-0000-4000-8000-000000000001', 'dd020001-0000-4000-8000-000000000002', '2026-11-04 17:00:00+01', '2026-11-04 18:15:00+01', 'Sportanlage Musterwiese', 30),
  ('dd020008-0000-4000-8000-000000000009', '20000000-0000-0000-0000-000000000002', 'dd020006-0000-4000-8000-000000000001', 'dd020001-0000-4000-8000-000000000002', '2026-11-09 17:00:00+01', '2026-11-09 18:15:00+01', 'Sportanlage Musterwiese', 30),
  ('dd020008-0000-4000-8000-000000000010', '20000000-0000-0000-0000-000000000002', 'dd020006-0000-4000-8000-000000000001', 'dd020001-0000-4000-8000-000000000002', '2026-11-11 17:00:00+01', '2026-11-11 18:15:00+01', 'Sportanlage Musterwiese', 30),
  ('dd020008-0000-4000-8000-000000000011', '20000000-0000-0000-0000-000000000002', 'dd020006-0000-4000-8000-000000000001', 'dd020001-0000-4000-8000-000000000002', '2026-11-16 17:00:00+01', '2026-11-16 18:15:00+01', 'Sportanlage Musterwiese', 30),
  ('dd020008-0000-4000-8000-000000000012', '20000000-0000-0000-0000-000000000002', 'dd020006-0000-4000-8000-000000000001', 'dd020001-0000-4000-8000-000000000002', '2026-11-18 17:00:00+01', '2026-11-18 18:15:00+01', 'Sportanlage Musterwiese', 30)
on conflict (id) do nothing;

insert into public.events (id, org_id, team_id, season_id, program_session_id, type, title, venue_id, starts_at, ends_at, opponent, home_away, status) values
  ('dd020009-0000-4000-8000-000000000001', '20000000-0000-0000-0000-000000000002', 'dd020007-0000-4000-8000-000000000001', 'dd020005-0000-4000-8000-000000000001', 'dd020008-0000-4000-8000-000000000001', 'training', 'Mannschaftstraining', 'dd020002-0000-4000-8000-000000000001', '2026-11-03 17:30:00+01', '2026-11-03 19:00:00+01', null, null, 'completed'),
  ('dd020009-0000-4000-8000-000000000002', '20000000-0000-0000-0000-000000000002', 'dd020007-0000-4000-8000-000000000001', 'dd020005-0000-4000-8000-000000000001', 'dd020008-0000-4000-8000-000000000002', 'training', 'Mannschaftstraining', 'dd020002-0000-4000-8000-000000000001', '2026-11-05 17:30:00+01', '2026-11-05 19:00:00+01', null, null, 'completed'),
  ('dd020009-0000-4000-8000-000000000003', '20000000-0000-0000-0000-000000000002', 'dd020007-0000-4000-8000-000000000001', 'dd020005-0000-4000-8000-000000000001', 'dd020008-0000-4000-8000-000000000003', 'training', 'Mannschaftstraining', 'dd020002-0000-4000-8000-000000000001', '2026-11-10 17:30:00+01', '2026-11-10 19:00:00+01', null, null, 'completed'),
  ('dd020009-0000-4000-8000-000000000004', '20000000-0000-0000-0000-000000000002', 'dd020007-0000-4000-8000-000000000001', 'dd020005-0000-4000-8000-000000000001', 'dd020008-0000-4000-8000-000000000004', 'training', 'Mannschaftstraining', 'dd020002-0000-4000-8000-000000000001', '2026-11-12 17:30:00+01', '2026-11-12 19:00:00+01', null, null, 'scheduled'),
  ('dd020009-0000-4000-8000-000000000005', '20000000-0000-0000-0000-000000000002', 'dd020007-0000-4000-8000-000000000001', 'dd020005-0000-4000-8000-000000000001', 'dd020008-0000-4000-8000-000000000005', 'training', 'Mannschaftstraining', 'dd020002-0000-4000-8000-000000000001', '2026-11-17 17:30:00+01', '2026-11-17 19:00:00+01', null, null, 'scheduled'),
  ('dd020009-0000-4000-8000-000000000006', '20000000-0000-0000-0000-000000000002', 'dd020007-0000-4000-8000-000000000001', 'dd020005-0000-4000-8000-000000000001', 'dd020008-0000-4000-8000-000000000006', 'training', 'Mannschaftstraining', 'dd020002-0000-4000-8000-000000000001', '2026-11-19 17:30:00+01', '2026-11-19 19:00:00+01', null, null, 'scheduled'),
  ('dd020009-0000-4000-8000-000000000007', '20000000-0000-0000-0000-000000000002', 'dd020007-0000-4000-8000-000000000001', 'dd020005-0000-4000-8000-000000000001', null, 'game', 'Meisterschaftsspiel', 'dd020002-0000-4000-8000-000000000001', '2026-11-07 10:30:00+01', '2026-11-07 12:30:00+01', 'FC Beispiel Uster', 'home', 'completed'),
  ('dd020009-0000-4000-8000-000000000008', '20000000-0000-0000-0000-000000000002', 'dd020007-0000-4000-8000-000000000001', 'dd020005-0000-4000-8000-000000000001', null, 'game', 'Meisterschaftsspiel', null, '2026-11-14 11:00:00+01', '2026-11-14 13:00:00+01', 'SC Muster Wädenswil', 'away', 'scheduled'),
  ('dd020009-0000-4000-8000-000000000009', '20000000-0000-0000-0000-000000000002', 'dd020007-0000-4000-8000-000000000002', 'dd020005-0000-4000-8000-000000000001', 'dd020008-0000-4000-8000-000000000007', 'training', 'Mannschaftstraining', 'dd020002-0000-4000-8000-000000000001', '2026-11-02 17:00:00+01', '2026-11-02 18:15:00+01', null, null, 'completed'),
  ('dd020009-0000-4000-8000-000000000010', '20000000-0000-0000-0000-000000000002', 'dd020007-0000-4000-8000-000000000002', 'dd020005-0000-4000-8000-000000000001', 'dd020008-0000-4000-8000-000000000008', 'training', 'Mannschaftstraining', 'dd020002-0000-4000-8000-000000000001', '2026-11-04 17:00:00+01', '2026-11-04 18:15:00+01', null, null, 'completed'),
  ('dd020009-0000-4000-8000-000000000011', '20000000-0000-0000-0000-000000000002', 'dd020007-0000-4000-8000-000000000002', 'dd020005-0000-4000-8000-000000000001', 'dd020008-0000-4000-8000-000000000009', 'training', 'Mannschaftstraining', 'dd020002-0000-4000-8000-000000000001', '2026-11-09 17:00:00+01', '2026-11-09 18:15:00+01', null, null, 'completed'),
  ('dd020009-0000-4000-8000-000000000012', '20000000-0000-0000-0000-000000000002', 'dd020007-0000-4000-8000-000000000002', 'dd020005-0000-4000-8000-000000000001', 'dd020008-0000-4000-8000-000000000010', 'training', 'Mannschaftstraining', 'dd020002-0000-4000-8000-000000000001', '2026-11-11 17:00:00+01', '2026-11-11 18:15:00+01', null, null, 'completed'),
  ('dd020009-0000-4000-8000-000000000013', '20000000-0000-0000-0000-000000000002', 'dd020007-0000-4000-8000-000000000002', 'dd020005-0000-4000-8000-000000000001', 'dd020008-0000-4000-8000-000000000011', 'training', 'Mannschaftstraining', 'dd020002-0000-4000-8000-000000000001', '2026-11-16 17:00:00+01', '2026-11-16 18:15:00+01', null, null, 'scheduled'),
  ('dd020009-0000-4000-8000-000000000014', '20000000-0000-0000-0000-000000000002', 'dd020007-0000-4000-8000-000000000002', 'dd020005-0000-4000-8000-000000000001', 'dd020008-0000-4000-8000-000000000012', 'training', 'Mannschaftstraining', 'dd020002-0000-4000-8000-000000000001', '2026-11-18 17:00:00+01', '2026-11-18 18:15:00+01', null, null, 'scheduled')
on conflict (id) do nothing;

insert into public.game_results (event_id, org_id, score_for, score_against) values
  ('dd020009-0000-4000-8000-000000000007', '20000000-0000-0000-0000-000000000002', 4, 2)
on conflict (event_id) do nothing;

insert into public.attendance_sessions (id, org_id, program_id, program_session_id, coach_id, session_date, status, roster_size, submitted_at) values
  ('dd020011-0000-4000-8000-000000000001', '20000000-0000-0000-0000-000000000002', 'dd020006-0000-4000-8000-000000000002', 'dd020008-0000-4000-8000-000000000001', 'dd020001-0000-4000-8000-000000000001', '2026-11-03 17:30:00+01', 'submitted', 3, '2026-11-03 19:15:00+01'),
  ('dd020011-0000-4000-8000-000000000002', '20000000-0000-0000-0000-000000000002', 'dd020006-0000-4000-8000-000000000002', 'dd020008-0000-4000-8000-000000000002', 'dd020001-0000-4000-8000-000000000001', '2026-11-05 17:30:00+01', 'submitted', 3, '2026-11-05 19:15:00+01'),
  ('dd020011-0000-4000-8000-000000000003', '20000000-0000-0000-0000-000000000002', 'dd020006-0000-4000-8000-000000000002', 'dd020008-0000-4000-8000-000000000003', 'dd020001-0000-4000-8000-000000000001', '2026-11-10 17:30:00+01', 'submitted', 3, '2026-11-10 19:15:00+01'),
  ('dd020011-0000-4000-8000-000000000004', '20000000-0000-0000-0000-000000000002', 'dd020006-0000-4000-8000-000000000002', 'dd020008-0000-4000-8000-000000000004', 'dd020001-0000-4000-8000-000000000001', '2026-11-12 17:30:00+01', 'open', 3, null)
on conflict (id) do nothing;

insert into public.attendance_marks (id, org_id, attendance_session_id, athlete_id, status, marked_by) values
  ('dd020012-0000-4000-8000-000000000001', '20000000-0000-0000-0000-000000000002', 'dd020011-0000-4000-8000-000000000001', 'dd02000b-0000-4000-8000-000000000001', 'present', 'dd020001-0000-4000-8000-000000000001'),
  ('dd020012-0000-4000-8000-000000000002', '20000000-0000-0000-0000-000000000002', 'dd020011-0000-4000-8000-000000000001', 'dd02000b-0000-4000-8000-000000000002', 'late', 'dd020001-0000-4000-8000-000000000001'),
  ('dd020012-0000-4000-8000-000000000003', '20000000-0000-0000-0000-000000000002', 'dd020011-0000-4000-8000-000000000001', 'dd02000b-0000-4000-8000-000000000004', 'present', 'dd020001-0000-4000-8000-000000000001'),
  ('dd020012-0000-4000-8000-000000000004', '20000000-0000-0000-0000-000000000002', 'dd020011-0000-4000-8000-000000000002', 'dd02000b-0000-4000-8000-000000000001', 'late', 'dd020001-0000-4000-8000-000000000001'),
  ('dd020012-0000-4000-8000-000000000005', '20000000-0000-0000-0000-000000000002', 'dd020011-0000-4000-8000-000000000002', 'dd02000b-0000-4000-8000-000000000002', 'present', 'dd020001-0000-4000-8000-000000000001'),
  ('dd020012-0000-4000-8000-000000000006', '20000000-0000-0000-0000-000000000002', 'dd020011-0000-4000-8000-000000000002', 'dd02000b-0000-4000-8000-000000000004', 'absent', 'dd020001-0000-4000-8000-000000000001'),
  ('dd020012-0000-4000-8000-000000000007', '20000000-0000-0000-0000-000000000002', 'dd020011-0000-4000-8000-000000000003', 'dd02000b-0000-4000-8000-000000000001', 'present', 'dd020001-0000-4000-8000-000000000001'),
  ('dd020012-0000-4000-8000-000000000008', '20000000-0000-0000-0000-000000000002', 'dd020011-0000-4000-8000-000000000003', 'dd02000b-0000-4000-8000-000000000002', 'absent', 'dd020001-0000-4000-8000-000000000001'),
  ('dd020012-0000-4000-8000-000000000009', '20000000-0000-0000-0000-000000000002', 'dd020011-0000-4000-8000-000000000003', 'dd02000b-0000-4000-8000-000000000004', 'present', 'dd020001-0000-4000-8000-000000000001')
on conflict (id) do nothing;

insert into public.consent_acceptances (id, org_id, athlete_id, consent_form_id, accepted_version, accepted_at, status) values
  ('dd02001a-0000-4000-8000-000000000001', '20000000-0000-0000-0000-000000000002', 'dd02000b-0000-4000-8000-000000000001', 'dd020004-0000-4000-8000-000000000001', 1, '2026-08-20 19:00:00+02', 'accepted'),
  ('dd02001a-0000-4000-8000-000000000002', '20000000-0000-0000-0000-000000000002', 'dd02000b-0000-4000-8000-000000000001', 'dd020004-0000-4000-8000-000000000002', 1, '2026-08-20 19:00:00+02', 'accepted'),
  ('dd02001a-0000-4000-8000-000000000003', '20000000-0000-0000-0000-000000000002', 'dd02000b-0000-4000-8000-000000000002', 'dd020004-0000-4000-8000-000000000001', 1, '2026-08-20 19:00:00+02', 'accepted'),
  ('dd02001a-0000-4000-8000-000000000004', '20000000-0000-0000-0000-000000000002', 'dd02000b-0000-4000-8000-000000000002', 'dd020004-0000-4000-8000-000000000002', 1, '2026-08-20 19:00:00+02', 'accepted'),
  ('dd02001a-0000-4000-8000-000000000005', '20000000-0000-0000-0000-000000000002', 'dd02000b-0000-4000-8000-000000000003', 'dd020004-0000-4000-8000-000000000001', 1, '2026-08-20 19:00:00+02', 'accepted'),
  ('dd02001a-0000-4000-8000-000000000006', '20000000-0000-0000-0000-000000000002', 'dd02000b-0000-4000-8000-000000000003', 'dd020004-0000-4000-8000-000000000002', 1, '2026-08-20 19:00:00+02', 'accepted'),
  ('dd02001a-0000-4000-8000-000000000007', '20000000-0000-0000-0000-000000000002', 'dd02000b-0000-4000-8000-000000000004', 'dd020004-0000-4000-8000-000000000001', 1, '2026-08-20 19:00:00+02', 'accepted'),
  ('dd02001a-0000-4000-8000-000000000008', '20000000-0000-0000-0000-000000000002', 'dd02000b-0000-4000-8000-000000000004', 'dd020004-0000-4000-8000-000000000002', 1, '2026-08-20 19:00:00+02', 'accepted')
on conflict (id) do nothing;

insert into public.notifications (id, org_id, recipient_id, type, title, body) values
  ('dd020016-0000-4000-8000-000000000001', '20000000-0000-0000-0000-000000000002', null, 'practice', 'Spiel: Junioren D in Wädenswil', 'Sa 14. Nov · 11:00 · Treffpunkt 09:45 Sportanlage Musterwiese.'),
  ('dd020016-0000-4000-8000-000000000002', '20000000-0000-0000-0000-000000000002', null, 'system', 'Willkommen bei Seeblick Club', 'Euer Vereinsportal ist bereit (Demodaten).')
on conflict (id) do nothing;

-- =================  PART B - LINK DEMO LOGINS (by email)  ==================
-- The demo users are created with the Auth admin API (handle_new_user creates
-- their profiles with org_id null). This links them to their club and roles.
-- No-op for any demo user that does not exist.

update public.profiles p set
  org_id = v.org_id, full_name = v.full_name, locale = v.locale,
  onboarding_completed_at = coalesce(p.onboarding_completed_at, now())
from (values
  ('demo-admin@example.com',    '00000000-0000-0000-0000-000000000001'::uuid, 'Demo Admin',      'en'),
  ('demo-finance@example.com',  '00000000-0000-0000-0000-000000000001'::uuid, 'Demo Finance',    'en'),
  ('demo-coach@example.com',    '00000000-0000-0000-0000-000000000001'::uuid, 'Alex Moreau',     'en'),
  ('demo-parent@example.com',   '00000000-0000-0000-0000-000000000001'::uuid, 'Claire Martin',   'en'),
  ('demo-fc-admin@example.com', '20000000-0000-0000-0000-000000000002'::uuid, 'Demo Vereinsadmin', 'de')
) as v(email, org_id, full_name, locale)
where p.email = v.email;

insert into public.staff_roles (org_id, profile_id, role)
select v.org_id, p.id, v.role::public.app_role
from (values
  ('demo-admin@example.com',    '00000000-0000-0000-0000-000000000001'::uuid, 'admin'),
  ('demo-finance@example.com',  '00000000-0000-0000-0000-000000000001'::uuid, 'finance'),
  ('demo-coach@example.com',    '00000000-0000-0000-0000-000000000001'::uuid, 'coach'),
  ('demo-fc-admin@example.com', '20000000-0000-0000-0000-000000000002'::uuid, 'admin')
) as v(email, org_id, role)
join public.profiles p on p.email = v.email
on conflict (org_id, profile_id, role) do nothing;

-- Coach login -> coach record "Alex Moreau" (head coach of Cheetahs U14).
update public.coaches c set profile_id = p.id
from public.profiles p
where p.email = 'demo-coach@example.com' and c.id = 'dd010001-0000-4000-8000-000000000001';

-- Parent login -> guardian of the Martin family (sees only Léo and Emma).
insert into public.family_members (family_id, profile_id, relation, is_primary)
select 'dd01000a-0000-4000-8000-000000000001'::uuid, p.id, 'mother', true
from public.profiles p where p.email = 'demo-parent@example.com'
on conflict do nothing;

update public.families f set primary_contact_id = p.id
from public.profiles p
where p.email = 'demo-parent@example.com' and f.id = 'dd01000a-0000-4000-8000-000000000001';
