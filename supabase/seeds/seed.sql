-- ============================================================================
-- DLang Basketball — Club OS · seed.sql
-- Runs after migrations on `supabase db reset`. Two parts:
--   PART A — core club data (no auth dependency; safe anywhere)
--   PART B — DEV-ONLY test logins (inserts auth.users; LOCAL DEV ONLY)
-- Fixed UUIDs are used so cross-references are readable.
-- ============================================================================

-- ===========================  PART A — CORE DATA  ===========================

-- Organization
insert into public.organizations (id, name, slug, country, currency) values
  ('00000000-0000-0000-0000-000000000001', 'DLang Basketball', 'dlang', 'CH', 'CHF');

-- App settings (invoice pattern + running counter)
insert into public.app_settings (org_id, invoice_pattern, invoice_counter, currency, default_locale, payment_methods) values
  ('00000000-0000-0000-0000-000000000001', 'INV-{YYYY}-{####}', 211, 'CHF', 'en', '{card,twint,bank_transfer,manual}');

-- Coaches (profile_id linked later in PART B for those who log in)
insert into public.coaches (id, org_id, display_name, role_title, serves) values
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'Derrick Lang', 'Founder · Player Development', '{pt,shoot,ball,group}'),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'Coach Michael', 'Skills Specialist', '{pt,ball,group}'),
  ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000001', 'Coach Sarah', 'Shooting Coach', '{pt,shoot,group}'),
  ('00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000001', 'Coach David', 'Strength & Conditioning', '{sc}'),
  ('00000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000001', 'Dr. Emily', 'Sports Nutritionist', '{nutri}'),
  ('00000000-0000-0000-0000-000000000017', '00000000-0000-0000-0000-000000000001', 'Coach Marc', 'Head Coach · DL Cheetah U14', '{pt,shoot,ball,group}');

-- Training services catalog
insert into public.training_services (id, org_id, slug, name, tagline, duration_min, price_chf, credit_category) values
  ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000001', 'pt',     '1-on-1 Personal Training', 'Work directly with a head coach',        60, 75, 'personal'),
  ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000001', 'shoot',  'Shooting Lab',             'Form · footwork · catch-and-shoot',      45, 65, 'personal'),
  ('00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000001', 'ball',   'Ball Handling & Skills',   'Tight handle · finishing',               45, 55, 'personal'),
  ('00000000-0000-0000-0000-000000000024', '00000000-0000-0000-0000-000000000001', 'sc',     'Strength & Conditioning',  'Athletic development & injury prevention',60, 70, 'personal'),
  ('00000000-0000-0000-0000-000000000025', '00000000-0000-0000-0000-000000000001', 'nutri',  'Nutrition Consultation',   'Performance fueling & recovery',         45, 60, 'nutrition'),
  ('00000000-0000-0000-0000-000000000026', '00000000-0000-0000-0000-000000000001', 'mental', 'Mental Performance',       'Confidence · focus · pre-game routines', 45, 70, 'mental'),
  ('00000000-0000-0000-0000-000000000027', '00000000-0000-0000-0000-000000000001', 'group',  'Small Group Elite',        '4–6 athletes · invite-only',             60, 45, 'personal');

-- Consent forms (versioned; v1)
insert into public.consent_forms (id, org_id, key, title, version, locale, is_required) values
  ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000001', 'media',     'Media consent',                 1, 'en', true),
  ('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000001', 'transport', 'Transport consent',             1, 'en', true),
  ('00000000-0000-0000-0000-000000000033', '00000000-0000-0000-0000-000000000001', 'health',    'Health declaration',            1, 'en', true),
  ('00000000-0000-0000-0000-000000000034', '00000000-0000-0000-0000-000000000001', 'terms',     'Terms & cancellation policy',   1, 'en', true),
  ('00000000-0000-0000-0000-000000000035', '00000000-0000-0000-0000-000000000001', 'liability', 'Liability waiver (camp)',       1, 'en', true);

-- Programs (SPSA Summer Camp public; recurring teams)
insert into public.programs (id, org_id, slug, name, kind, description, price_chf, capacity, starts_on, ends_on, location, is_public, is_active) values
  ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000001', 'spsa-summer-camp-w1', 'SPSA Summer Camp 2026 · Week 1', 'camp', 'Full-day elite summer camp.', 1490, 24, '2026-07-06', '2026-07-10', 'SPSA Sport Arena, Genève', true,  true),
  ('00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000001', 'spsa-summer-camp-w2', 'SPSA Summer Camp 2026 · Week 2', 'camp', 'Full-day elite summer camp.', 1490, 24, '2026-07-13', '2026-07-17', 'SPSA Sport Arena, Genève', true,  true),
  ('00000000-0000-0000-0000-000000000043', '00000000-0000-0000-0000-000000000001', 'big-ballers',         'Big Ballers (U12)',             'recurring_team', 'Weekly development team.', 290, 30, null, null, 'Lancy Sports Centre', false, true),
  ('00000000-0000-0000-0000-000000000044', '00000000-0000-0000-0000-000000000001', 'mini-ballers',        'Mini Ballers (U8)',             'recurring_team', 'Weekly intro team.',       180, 30, null, null, 'Lancy Sports Centre', false, true);

-- Program sessions (a couple of scheduled occurrences)
insert into public.program_sessions (id, org_id, program_id, coach_id, starts_at, location) values
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000043', '00000000-0000-0000-0000-000000000011', '2026-05-20 17:00:00+02', 'Lancy Sports Centre'),
  ('00000000-0000-0000-0000-000000000052', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000017', '2026-07-06 09:00:00+02', 'SPSA Sport Arena');

-- Families
insert into public.families (id, org_id, name, address, phone) values
  ('00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000001', 'Lopes family',  'Rue de Lyon 24, 1203 Genève', '+41 78 412 09 38'),
  ('00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-000000000001', 'Müller family', 'Genève', '+41 79 000 00 00');

-- Athletes
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, gender, nationality, school, jersey_size, dominant_hand, position_pref, status) values
  ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000061', 'Mateo',  'Lopes',  '2016-03-14', 'Male',   'Portuguese / Swiss', 'Collège du Léman', 'YL', 'Right', 'Point guard', 'active'),
  ('00000000-0000-0000-0000-000000000072', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000062', 'Lucas',  'Müller', '2014-09-02', 'Male',   'Swiss', null, 'M', 'Right', 'Forward', 'active'),
  ('00000000-0000-0000-0000-000000000073', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000062', 'Sophia', 'Müller', '2016-11-21', 'Female', 'Swiss', null, 'YL', 'Left', 'Guard', 'active');

-- Athlete medical (sensitive)
insert into public.athlete_medical (org_id, athlete_id, allergies, conditions, insurance, emergency_contact_name, emergency_contact_phone) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000071', 'None declared', 'Mild asthma · inhaler at camp', 'Helsana', 'João Lopes (father)', '+41 78 309 14 22'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000072', 'Peanuts · EpiPen in kit bag', 'None', 'Assura', 'Hans Müller (father)', '+41 79 111 22 33');

-- Registrations
insert into public.registrations (id, org_id, athlete_id, program_id, status) values
  ('00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000041', 'pending'),
  ('00000000-0000-0000-0000-000000000082', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000072', '00000000-0000-0000-0000-000000000043', 'confirmed'),
  ('00000000-0000-0000-0000-000000000083', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000073', '00000000-0000-0000-0000-000000000043', 'confirmed');

-- Invoices (one pending camp invoice, one paid recurring-team invoice)
insert into public.invoices (id, org_id, number, family_id, athlete_id, program_id, registration_id, description, total_chf, status, due_date, issued_at) values
  ('00000000-0000-0000-0000-000000000091', '00000000-0000-0000-0000-000000000001', 'INV-2026-0211', '00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000081', 'SPSA Summer Camp · Week 1', 1490, 'pending', '2026-05-09', '2026-05-07 14:17:00+02'),
  ('00000000-0000-0000-0000-000000000093', '00000000-0000-0000-0000-000000000001', 'INV-2026-0182', '00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-000000000072', '00000000-0000-0000-0000-000000000043', '00000000-0000-0000-0000-000000000082', 'Big Ballers · April',        290,  'paid',    '2026-05-02', '2026-04-25 10:00:00+02');

update public.invoices set paid_at = '2026-04-28 09:12:00+02' where id = '00000000-0000-0000-0000-000000000093';

-- Invoice items
insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000091', 'SPSA Summer Camp 2026 · Week 1 (6–10 July)', 1, 1490, 1490),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000093', 'Big Ballers monthly · April',                1, 290,  290);

-- Payment (TWINT, succeeded) for the paid invoice
insert into public.payments (org_id, invoice_id, amount_chf, method, status, paid_at, notes) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000093', 290, 'twint', 'succeeded', '2026-04-28 09:12:00+02', 'TWINT confirmed');

-- Consent acceptances for Mateo (version 1; accepted_by linked in dev if desired)
insert into public.consent_acceptances (org_id, athlete_id, consent_form_id, accepted_version, accepted_at, status) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000031', 1, '2026-05-07 14:17:00+02', 'accepted'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000032', 1, '2026-05-07 14:17:00+02', 'accepted'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000033', 1, '2026-05-07 14:17:00+02', 'accepted'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000034', 1, '2026-05-07 14:17:00+02', 'accepted');

-- Attendance (Big Ballers session, submitted)
insert into public.attendance_sessions (id, org_id, program_id, program_session_id, coach_id, session_date, status, roster_size, submitted_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000043', '00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000011', '2026-05-20 17:00:00+02', 'submitted', 2, '2026-05-20 18:05:00+02');

insert into public.attendance_marks (org_id, attendance_session_id, athlete_id, status, marked_by) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000072', 'present', '00000000-0000-0000-0000-000000000011'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000073', 'late',    '00000000-0000-0000-0000-000000000011');

-- Training credits (Müller kids have packs)
insert into public.training_credits (org_id, athlete_id, credit_category, total_credits, used_credits) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000072', 'personal',  2, 1),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000073', 'personal',  3, 1),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000073', 'mental',    1, 0);

-- Club-wide notifications
insert into public.notifications (org_id, recipient_id, type, title, body) values
  ('00000000-0000-0000-0000-000000000001', null, 'practice', 'Game · DL Unity U16 vs Lausanne', 'Sat 10 May · 14:00 · Lancy Sports Centre · roster set'),
  ('00000000-0000-0000-0000-000000000001', null, 'system',   'Welcome to DLang Basketball OS',  'Your club portal is live.');

-- Email log sample (a payment reminder that was sent)
insert into public.email_logs (org_id, to_email, subject, template, status, invoice_id) values
  ('00000000-0000-0000-0000-000000000001', 'carla.lopes@gmail.com', 'Payment reminder · INV-2026-0211', 'payment_reminder', 'sent', '00000000-0000-0000-0000-000000000091');


-- =======================  PART B — DEV-ONLY TEST LOGINS  ====================
-- LOCAL DEV ONLY. Inserts into auth.users so you can sign in. The
-- handle_new_user trigger auto-creates matching public.profiles rows.
-- Do NOT run this block against production. Password for all: "password123".
-- (Remove or guard this block before deploying.)

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000f1', 'authenticated', 'authenticated', 'admin@dlang.test',   crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Club Admin"}',     now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000f2', 'authenticated', 'authenticated', 'finance@dlang.test', crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Finance Staff"}',  now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000f3', 'authenticated', 'authenticated', 'derrick@dlang.test', crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Derrick Lang"}',   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000f4', 'authenticated', 'authenticated', 'carla.lopes@gmail.com', crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Carla Lopes"}', now(), now(), '', '', '', '');

-- Roles
insert into public.staff_roles (org_id, profile_id, role) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f1', 'admin'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f2', 'finance'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f3', 'coach');

-- Link coach Derrick's login to his coach record
update public.coaches set profile_id = '00000000-0000-0000-0000-0000000000f3'
  where id = '00000000-0000-0000-0000-000000000011';

-- Carla is the guardian of the Lopes family (-> sees only Mateo)
insert into public.family_members (family_id, profile_id, relation, is_primary) values
  ('00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-0000000000f4', 'mother', true);

update public.families set primary_contact_id = '00000000-0000-0000-0000-0000000000f4'
  where id = '00000000-0000-0000-0000-000000000061';
