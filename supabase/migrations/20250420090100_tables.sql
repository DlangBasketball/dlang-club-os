-- ============================================================================
-- DLang Basketball — Club OS
-- Migration 02 · Tables, indexes, updated_at triggers
-- Dependency order respected. Every tenant table carries org_id (denormalized)
-- so RLS policies can scope without extra joins.
-- ============================================================================

-- ===========================================================================
-- ORGANIZATIONS  (the club; org_id seam supports future multi-club)
-- ===========================================================================
create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text unique,
  country       text not null default 'CH',
  currency      text not null default 'CHF',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_organizations_updated before update on public.organizations
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- PROFILES  (1:1 with auth.users; created by handle_new_user trigger)
-- ===========================================================================
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  full_name     text,
  email         citext not null,
  phone         text,
  locale        text not null default 'en',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_profiles_org on public.profiles(org_id);
create index idx_profiles_email on public.profiles(email);
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- STAFF_ROLES  (assigns admin/finance/coach/parent to a profile)
-- ===========================================================================
create table public.staff_roles (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  role          public.app_role not null,
  created_at    timestamptz not null default now(),
  unique (org_id, profile_id, role)
);
create index idx_staff_roles_profile on public.staff_roles(profile_id);
create index idx_staff_roles_role on public.staff_roles(org_id, role);

-- ===========================================================================
-- FAMILIES  (a household; groups athletes + guardians)
-- ===========================================================================
create table public.families (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  name                text not null,
  address             text,
  phone               text,
  primary_contact_id  uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_families_org on public.families(org_id);
create trigger trg_families_updated before update on public.families
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- FAMILY_MEMBERS  (SUPPORTING TABLE — not in original list, required to make
-- "a parent sees only their own family" enforceable; supports two-parent /
-- shared-custody by being many-to-many.)
-- ===========================================================================
create table public.family_members (
  family_id     uuid not null references public.families(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  relation      text,                       -- mother | father | guardian
  is_primary    boolean not null default false,
  created_at    timestamptz not null default now(),
  primary key (family_id, profile_id)
);
create index idx_family_members_profile on public.family_members(profile_id);

-- ===========================================================================
-- ATHLETES  (children; never direct account holders)
-- ===========================================================================
create table public.athletes (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  family_id     uuid not null references public.families(id) on delete cascade,
  first_name    text not null,
  last_name     text not null,
  dob           date not null,
  gender        text,
  nationality   text,
  school        text,
  jersey_size   text,
  dominant_hand text,
  position_pref text,
  status        text not null default 'active',  -- active | inactive | archived
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_athletes_family on public.athletes(family_id);
create index idx_athletes_org on public.athletes(org_id);
create trigger trg_athletes_updated before update on public.athletes
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- ATHLETE_MEDICAL  (SUPPORTING TABLE — sensitive data isolated so it can be
-- locked down harder than the athlete row, audited, and granted to coaches as
-- read-only safety info without exposing it to finance.)
-- ===========================================================================
create table public.athlete_medical (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references public.organizations(id) on delete cascade,
  athlete_id               uuid not null unique references public.athletes(id) on delete cascade,
  allergies                text,
  conditions               text,             -- e.g. "Mild asthma · inhaler at camp"
  medications              text,
  insurance                text,
  emergency_contact_name   text,
  emergency_contact_phone  text,
  notes                    text,
  updated_by               uuid references public.profiles(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create trigger trg_athlete_medical_updated before update on public.athlete_medical
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- COACHES  (a coach is a staff member; profile_id null until they have a login)
-- ===========================================================================
create table public.coaches (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  profile_id    uuid references public.profiles(id) on delete set null,
  display_name  text not null,
  role_title    text,
  serves        text[] not null default '{}',   -- training_services.slug values
  bio           text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_coaches_org on public.coaches(org_id);
create index idx_coaches_profile on public.coaches(profile_id);
create trigger trg_coaches_updated before update on public.coaches
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- PROGRAMS  (camps, recurring teams, clinics)
-- ===========================================================================
create table public.programs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  slug          text,
  name          text not null,
  kind          public.program_kind not null,
  description   text,
  price_chf     numeric(10,2) not null default 0,
  capacity      integer,
  starts_on     date,
  ends_on       date,
  location      text,
  schedule      jsonb,                          -- weekday/time blocks
  is_public     boolean not null default false, -- shows on public landing
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, slug)
);
create index idx_programs_org on public.programs(org_id);
create index idx_programs_public on public.programs(is_public) where is_public;
create trigger trg_programs_updated before update on public.programs
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- PROGRAM_SESSIONS  (scheduled occurrences of a program; each has a lead coach)
-- ===========================================================================
create table public.program_sessions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  program_id    uuid not null references public.programs(id) on delete cascade,
  coach_id      uuid references public.coaches(id) on delete set null,
  starts_at     timestamptz not null,
  ends_at       timestamptz,
  location      text,
  capacity      integer,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_program_sessions_program on public.program_sessions(program_id);
create index idx_program_sessions_coach on public.program_sessions(coach_id);
create index idx_program_sessions_starts on public.program_sessions(starts_at);
create trigger trg_program_sessions_updated before update on public.program_sessions
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- TRAINING_SERVICES  (1-on-1 catalog: PT, Shooting Lab, etc.)
-- ===========================================================================
create table public.training_services (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  slug            text not null,
  name            text not null,
  tagline         text,
  duration_min    integer not null default 60,
  price_chf       numeric(10,2) not null default 0,
  credit_category public.credit_category not null default 'personal',
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (org_id, slug)
);
create index idx_training_services_org on public.training_services(org_id);
create trigger trg_training_services_updated before update on public.training_services
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- COACH_AVAILABILITY  (free/busy slots feeding the booking flow)
-- ===========================================================================
create table public.coach_availability (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  coach_id      uuid not null references public.coaches(id) on delete cascade,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  is_booked     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index idx_coach_availability_coach on public.coach_availability(coach_id, starts_at);
create trigger trg_coach_availability_updated before update on public.coach_availability
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- REGISTRATIONS  (an athlete enrolled in a program)
-- ===========================================================================
create table public.registrations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  athlete_id    uuid not null references public.athletes(id) on delete cascade,
  program_id    uuid not null references public.programs(id) on delete cascade,
  status        public.registration_status not null default 'pending',
  registered_by uuid references public.profiles(id) on delete set null,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (athlete_id, program_id)
);
create index idx_registrations_program on public.registrations(program_id);
create index idx_registrations_athlete on public.registrations(athlete_id);
create index idx_registrations_status on public.registrations(org_id, status);
create trigger trg_registrations_updated before update on public.registrations
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- INVOICES  (auditable; status changes only by admin/finance or service role)
-- ===========================================================================
create table public.invoices (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references public.organizations(id) on delete cascade,
  number                   text not null,
  family_id                uuid not null references public.families(id) on delete restrict,
  athlete_id               uuid references public.athletes(id) on delete set null,
  program_id               uuid references public.programs(id) on delete set null,
  registration_id          uuid references public.registrations(id) on delete set null,
  description              text,
  currency                 text not null default 'CHF',
  total_chf                numeric(10,2) not null default 0,
  status                   public.invoice_status not null default 'pending',
  due_date                 date,
  issued_at                timestamptz not null default now(),
  paid_at                  timestamptz,
  stripe_payment_intent_id text,
  created_by               uuid references public.profiles(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (org_id, number)
);
create index idx_invoices_family on public.invoices(family_id);
create index idx_invoices_status on public.invoices(org_id, status);
create index idx_invoices_due on public.invoices(due_date);
create trigger trg_invoices_updated before update on public.invoices
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- INVOICE_ITEMS  (line-item breakdown)
-- ===========================================================================
create table public.invoice_items (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  invoice_id      uuid not null references public.invoices(id) on delete cascade,
  description     text not null,
  quantity        numeric(10,2) not null default 1,
  unit_price_chf  numeric(10,2) not null default 0,
  amount_chf      numeric(10,2) not null default 0,
  created_at      timestamptz not null default now()
);
create index idx_invoice_items_invoice on public.invoice_items(invoice_id);

-- ===========================================================================
-- PAYMENTS  (append-mostly ledger; never hard-deleted)
-- ===========================================================================
create table public.payments (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references public.organizations(id) on delete cascade,
  invoice_id               uuid not null references public.invoices(id) on delete restrict,
  amount_chf               numeric(10,2) not null,
  currency                 text not null default 'CHF',
  method                   public.payment_method not null,
  status                   public.payment_status not null default 'pending',
  stripe_charge_id         text,
  stripe_payment_intent_id text,
  qr_reference             text,                 -- Swiss QR-bill reference (later)
  recorded_by              uuid references public.profiles(id) on delete set null, -- null = system/webhook
  paid_at                  timestamptz,
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index idx_payments_invoice on public.payments(invoice_id);
create index idx_payments_status on public.payments(org_id, status);
create trigger trg_payments_updated before update on public.payments
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- TRAINING_BOOKINGS  (1-on-1 / specialty sessions; pay by credit or invoice)
-- ===========================================================================
create table public.training_bookings (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  athlete_id    uuid not null references public.athletes(id) on delete cascade,
  service_id    uuid not null references public.training_services(id) on delete restrict,
  coach_id      uuid not null references public.coaches(id) on delete restrict,
  slot_start    timestamptz not null,
  slot_end      timestamptz,
  status        public.booking_status not null default 'booked',
  paid_with     public.payment_method,
  invoice_id    uuid references public.invoices(id) on delete set null,
  credits_used  integer not null default 0,
  price_chf     numeric(10,2),
  notes         text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_bookings_athlete on public.training_bookings(athlete_id);
create index idx_bookings_coach on public.training_bookings(coach_id, slot_start);
create index idx_bookings_status on public.training_bookings(org_id, status);
create trigger trg_bookings_updated before update on public.training_bookings
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- TRAINING_CREDITS  (balance per athlete per category; changes are audited)
-- ===========================================================================
create table public.training_credits (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  athlete_id      uuid not null references public.athletes(id) on delete cascade,
  credit_category public.credit_category not null,
  total_credits   integer not null default 0,
  used_credits    integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (athlete_id, credit_category),
  check (used_credits <= total_credits and used_credits >= 0)
);
create index idx_credits_athlete on public.training_credits(athlete_id);
create trigger trg_credits_updated before update on public.training_credits
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- ATTENDANCE_SESSIONS  (a roster-taking event; optionally tied to a program session)
-- ===========================================================================
create table public.attendance_sessions (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  program_id          uuid references public.programs(id) on delete set null,
  program_session_id  uuid references public.program_sessions(id) on delete set null,
  coach_id            uuid references public.coaches(id) on delete set null,
  session_date        timestamptz not null default now(),
  status              public.attendance_session_status not null default 'open',
  roster_size         integer,
  submitted_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_att_sessions_coach on public.attendance_sessions(coach_id, session_date);
create index idx_att_sessions_program on public.attendance_sessions(program_id);
create trigger trg_att_sessions_updated before update on public.attendance_sessions
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- ATTENDANCE_MARKS  (one row per athlete per session)
-- ===========================================================================
create table public.attendance_marks (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  attendance_session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  athlete_id            uuid not null references public.athletes(id) on delete cascade,
  status                public.attendance_status not null,
  marked_by             uuid references public.coaches(id) on delete set null,
  marked_at             timestamptz not null default now(),
  unique (attendance_session_id, athlete_id)
);
create index idx_att_marks_athlete on public.attendance_marks(athlete_id);

-- ===========================================================================
-- CONSENT_FORMS  (versioned policy text the parent accepts)
-- ===========================================================================
create table public.consent_forms (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  key           text not null,                  -- media | transport | health | terms | liability
  title         text not null,
  body          text,
  version       integer not null default 1,
  locale        text not null default 'en',
  is_required   boolean not null default true,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, key, version, locale)
);
create index idx_consent_forms_org on public.consent_forms(org_id, key);
create trigger trg_consent_forms_updated before update on public.consent_forms
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- CONSENT_ACCEPTANCES  (immutable record: which version accepted, by whom, when)
-- ===========================================================================
create table public.consent_acceptances (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  athlete_id        uuid not null references public.athletes(id) on delete cascade,
  consent_form_id   uuid not null references public.consent_forms(id) on delete restrict,
  accepted_version  integer not null,
  accepted_by       uuid references public.profiles(id) on delete set null,
  accepted_at       timestamptz not null default now(),
  status            public.consent_acceptance_status not null default 'accepted',
  program_id        uuid references public.programs(id) on delete set null,
  ip_address        inet,
  created_at        timestamptz not null default now()
);
create index idx_consent_acc_athlete on public.consent_acceptances(athlete_id, consent_form_id);

-- ===========================================================================
-- DOCUMENTS  (pointers to private Storage objects: consent PDFs, medical, etc.)
-- ===========================================================================
create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  athlete_id    uuid references public.athletes(id) on delete cascade,
  family_id     uuid references public.families(id) on delete cascade,
  kind          public.document_kind not null default 'other',
  storage_path  text not null,                  -- key in a PRIVATE bucket
  file_name     text,
  mime_type     text,
  size_bytes    bigint,
  uploaded_by   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index idx_documents_athlete on public.documents(athlete_id);

-- ===========================================================================
-- NOTIFICATIONS  (in-app; recipient null = club-wide broadcast)
-- ===========================================================================
create table public.notifications (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  recipient_id  uuid references public.profiles(id) on delete cascade,
  type          public.notification_type not null default 'other',
  title         text not null,
  body          text,
  link          text,
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index idx_notifications_recipient on public.notifications(recipient_id, read_at);
create index idx_notifications_org on public.notifications(org_id, created_at desc);

-- ===========================================================================
-- EMAIL_LOGS  (every transactional email; append-only)
-- ===========================================================================
create table public.email_logs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  recipient_id  uuid references public.profiles(id) on delete set null,
  to_email      citext not null,
  subject       text,
  template      text,
  status        public.email_status not null default 'queued',
  provider_id   text,                            -- Resend message id
  invoice_id    uuid references public.invoices(id) on delete set null,
  error         text,
  created_at    timestamptz not null default now()
);
create index idx_email_logs_org on public.email_logs(org_id, created_at desc);

-- ===========================================================================
-- AUDIT_LOGS  (append-only trail for sensitive/financial mutations)
-- ===========================================================================
create table public.audit_logs (
  id            bigint generated always as identity primary key,
  org_id        uuid references public.organizations(id) on delete set null,
  actor_id      uuid,                            -- auth.uid(); null = system/webhook
  action        text not null,                   -- INSERT | UPDATE | DELETE | custom
  target_table  text,
  target_id     uuid,
  old_data      jsonb,
  new_data      jsonb,
  created_at    timestamptz not null default now()
);
create index idx_audit_logs_target on public.audit_logs(target_table, target_id);
create index idx_audit_logs_org on public.audit_logs(org_id, created_at desc);

-- ===========================================================================
-- APP_SETTINGS  (one row per org; holds invoice numbering + counter, etc.)
-- ===========================================================================
create table public.app_settings (
  org_id           uuid primary key references public.organizations(id) on delete cascade,
  invoice_pattern  text not null default 'INV-{YYYY}-{####}',
  invoice_counter  integer not null default 0,
  currency         text not null default 'CHF',
  default_locale   text not null default 'en',
  payment_methods  text[] not null default '{card,twint,bank_transfer,manual}',
  settings         jsonb not null default '{}',
  updated_at       timestamptz not null default now()
);
create trigger trg_app_settings_updated before update on public.app_settings
  for each row execute function public.set_updated_at();
