-- ============================================================================
-- DLANG Sports OS (Club OS) — white-label multi-tenant
-- Migration 19 · Region-aware privacy & compliance (nFADP / GDPR / COPPA / FERPA)
--
-- Adds the records a controller (the club / school) and the platform (processor)
-- need to evidence compliance in Switzerland, the EU/EEA and the United States:
--   1. compliance_settings        per-org region, org type, DPO/representative,
--                                 FERPA school-official designation, COPPA flags
--   2. data_retention_policies    per org × data category, seeded with regional
--                                 defaults (seed_retention_policies())
--   3. processing_activities      record of processing activities (ROPA)
--                                 GDPR Art. 30 / nFADP Art. 12
--   4. subprocessors              platform-wide (org_id null) + org-specific
--   5. parental_consents          verifiable parental consent (COPPA, < 13, US)
--   6. education_record_disclosures  FERPA 34 CFR 99.32 disclosure log
--   7. breach_incidents           breach register (GDPR Art. 33(5), nFADP Art. 24)
--   8. dsar_requests              data-subject request tracking with statutory
--                                 due dates (GDPR/nFADP 30 days, CCPA 45, FERPA 45)
-- RLS: org-scoped, admins only (service_role bypasses RLS for server jobs).
-- Idempotent: safe to re-run. Does NOT alter public.organizations; the region
-- is held in compliance_settings so the tenancy track can own org columns.
--
-- NOTE: retention periods and deadlines below are engineering defaults chosen
-- from the statutes cited. They are NOT legal advice; each club must confirm
-- them with qualified counsel for its jurisdiction.
-- ============================================================================

-- 0. Shared helper: admin of a given org ------------------------------------
create or replace function public.is_org_admin(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_org is not null and p_org = public.current_org_id() and public.is_admin();
$$;
grant execute on function public.is_org_admin(uuid) to authenticated, service_role;

-- 1. Compliance settings -----------------------------------------------------
create table if not exists public.compliance_settings (
  org_id                     uuid primary key references public.organizations(id) on delete cascade,
  -- Where the controller is established / which regime applies first.
  data_region                text not null default 'CH' check (data_region in ('CH','EU','UK','US','OTHER')),
  -- ISO 3166-2 subdivision for US state laws (e.g. 'US-CA') or EU member state.
  jurisdiction_subdivision   text,
  org_type                   text not null default 'club'
                               check (org_type in ('club','team','school','school_district','federation','academy','camp_provider','organization','other')),
  -- Hosting region of the tenant's primary database (data residency evidence).
  hosting_region             text not null default 'eu-central-1',
  legal_entity_name          text,
  registered_address         text,
  company_register_id        text,   -- e.g. CHE-123.456.789 / HRB 12345
  vat_id                     text,
  privacy_contact_email      text,
  dpo_name                   text,
  dpo_email                  text,
  eu_representative          text,   -- GDPR Art. 27 (non-EU controller targeting EU)
  ch_representative          text,   -- nFADP Art. 14 (foreign controller targeting CH)
  supervisory_authority      text,
  -- COPPA: org knowingly collects data from children < 13 in the US.
  coppa_applies              boolean not null default false,
  coppa_direct_notice_version integer not null default 1,
  -- FERPA: the platform is designated a "school official" with a legitimate
  -- educational interest under 34 CFR 99.31(a)(1)(i)(B).
  ferpa_applies              boolean not null default false,
  ferpa_school_official_designated boolean not null default false,
  ferpa_designation_date     date,
  ferpa_annual_notice_url    text,
  -- US state privacy laws the org has determined apply (e.g. CCPA/CPRA).
  us_state_laws              text[] not null default '{}',
  honor_global_privacy_control boolean not null default true,
  cookie_banner_enabled      boolean not null default true,
  legal_overrides            jsonb not null default '{}'::jsonb,  -- per-template text overrides
  last_reviewed_at           timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

drop trigger if exists trg_compliance_settings_updated on public.compliance_settings;
create trigger trg_compliance_settings_updated before update on public.compliance_settings
  for each row execute function public.set_updated_at();

-- 2. Data retention policies -------------------------------------------------
create table if not exists public.data_retention_policies (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  data_category     text not null check (data_category in (
                      'athlete_profile','guardian_contact','medical','attendance','registrations',
                      'financial','consent_records','parental_consents','communications','media',
                      'documents','audit_logs','ai_queries','dsar_records','breach_records',
                      'education_records','marketing')),
  retention_months  integer not null check (retention_months >= 0),
  retention_trigger text not null default 'membership_end'
                      check (retention_trigger in ('membership_end','record_created','fiscal_year_end','consent_withdrawn','request_closed','incident_closed')),
  expiry_action     text not null default 'anonymise' check (expiry_action in ('delete','anonymise','archive','review')),
  legal_basis       text,
  statutory_reference text,
  is_default        boolean not null default true,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (org_id, data_category)
);
create index if not exists idx_retention_org on public.data_retention_policies (org_id);

drop trigger if exists trg_retention_updated on public.data_retention_policies;
create trigger trg_retention_updated before update on public.data_retention_policies
  for each row execute function public.set_updated_at();

-- Regional defaults. Mirrored in src/lib/compliance/retention.ts — keep in sync.
create or replace function public.default_retention_months(p_region text, p_category text)
returns integer language sql immutable as $$
  select case p_category
    -- Bookkeeping: CH CO Art. 958f (10y); EU typical 10y (e.g. DE HGB §257, FR 10y);
    -- US IRS guidance 7y is the conservative upper bound.
    when 'financial'          then case p_region when 'US' then 84 else 120 end
    -- Health data: delete soon after participation ends (data minimisation).
    when 'medical'            then 12
    when 'athlete_profile'    then 24
    when 'guardian_contact'   then 24
    when 'attendance'         then 24
    when 'registrations'      then 36
    -- Liability waivers / consents: keep to cover limitation periods.
    -- CH: personal-injury claims up to 20y absolute (CO Art. 60 rev. 2020); 10y chosen
    -- as default and flagged for counsel review. US: varies by state (2-6y typical).
    when 'consent_records'    then case p_region when 'US' then 72 else 120 end
    -- COPPA 16 CFR 312.10: only as long as reasonably necessary; 36 months default.
    when 'parental_consents'  then 36
    when 'communications'     then 24
    when 'media'              then 36
    when 'documents'          then 36
    when 'audit_logs'         then 60
    when 'ai_queries'         then 6
    -- DSAR & breach evidence: keep 3y (CCPA regs §7101 require 24 months of
    -- request records; GDPR accountability).
    when 'dsar_records'       then 36
    when 'breach_records'     then 60
    -- FERPA: education records follow the school's own schedule; 60m default.
    when 'education_records'  then 60
    when 'marketing'          then 24
    else 24
  end;
$$;

create or replace function public.seed_retention_policies(p_org uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_region text; v_count integer;
begin
  if auth.uid() is not null and not public.is_org_admin(p_org) then
    raise exception 'FORBIDDEN';
  end if;
  select coalesce((select data_region from public.compliance_settings where org_id = p_org),
                  case when (select country from public.organizations where id = p_org) = 'US' then 'US'
                       when (select country from public.organizations where id = p_org) = 'CH' then 'CH'
                       else 'EU' end)
    into v_region;

  insert into public.data_retention_policies (org_id, data_category, retention_months, retention_trigger, expiry_action, legal_basis, statutory_reference)
  select p_org, c.cat, public.default_retention_months(v_region, c.cat), c.trg, c.act, c.basis, c.ref
  from (values
    ('athlete_profile',  'membership_end',    'anonymise', 'contract',            'GDPR Art. 5(1)(e) / nFADP Art. 6(4)'),
    ('guardian_contact', 'membership_end',    'anonymise', 'contract',            'GDPR Art. 5(1)(e) / nFADP Art. 6(4)'),
    ('medical',          'membership_end',    'delete',    'consent / vital interests', 'GDPR Art. 9 / nFADP Art. 5(c)'),
    ('attendance',       'record_created',    'anonymise', 'contract',            'GDPR Art. 5(1)(e)'),
    ('registrations',    'membership_end',    'anonymise', 'contract',            'GDPR Art. 5(1)(e)'),
    ('financial',        'fiscal_year_end',   'archive',   'legal obligation',    'CH CO Art. 958f; DE HGB §257; US IRS Pub. 583'),
    ('consent_records',  'membership_end',    'archive',   'legal obligation / defence of claims', 'GDPR Art. 7(1); CH CO Art. 60'),
    ('parental_consents','membership_end',    'delete',    'legal obligation',    '16 CFR 312.10'),
    ('communications',   'record_created',    'delete',    'legitimate interests', 'GDPR Art. 5(1)(e)'),
    ('media',            'consent_withdrawn', 'delete',    'consent',             'GDPR Art. 7(3)'),
    ('documents',        'membership_end',    'delete',    'contract',            'GDPR Art. 5(1)(e)'),
    ('audit_logs',       'record_created',    'delete',    'legitimate interests / security', 'GDPR Art. 32 / nFADP Art. 8'),
    ('ai_queries',       'record_created',    'delete',    'legitimate interests', 'GDPR Art. 5(1)(c)'),
    ('dsar_records',     'request_closed',    'delete',    'legal obligation',    'CCPA Regs §7101; GDPR Art. 5(2)'),
    ('breach_records',   'incident_closed',   'archive',   'legal obligation',    'GDPR Art. 33(5); nFADP Art. 24'),
    ('education_records','membership_end',    'review',    'legal obligation',    'FERPA 34 CFR Part 99'),
    ('marketing',        'consent_withdrawn', 'delete',    'consent',             'GDPR Art. 6(1)(a); CAN-SPAM')
  ) as c(cat, trg, act, basis, ref)
  on conflict (org_id, data_category) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.seed_retention_policies(uuid) from public, anon;
grant execute on function public.seed_retention_policies(uuid) to authenticated, service_role;

-- 3. Record of processing activities (ROPA) ---------------------------------
create table if not exists public.processing_activities (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references public.organizations(id) on delete cascade,
  name                     text not null,
  purpose                  text not null,
  role                     text not null default 'controller' check (role in ('controller','joint_controller','processor')),
  legal_basis              text not null check (legal_basis in ('consent','contract','legal_obligation','vital_interests','public_task','legitimate_interests')),
  special_category_basis   text,          -- GDPR Art. 9(2) ground when health data is processed
  data_subject_categories  text[] not null default '{}',
  data_categories          text[] not null default '{}',
  involves_special_category boolean not null default false,
  involves_minors          boolean not null default false,
  recipients               text[] not null default '{}',
  subprocessor_names       text[] not null default '{}',
  international_transfers  text,
  transfer_safeguards      text,          -- adequacy / SCCs / DPF
  retention_category       text,          -- -> data_retention_policies.data_category
  security_measures        text,
  dpia_required            boolean not null default false,
  dpia_completed_at        date,
  owner_name               text,
  next_review_at           date,
  is_active                boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists idx_ropa_org on public.processing_activities (org_id);
drop trigger if exists trg_ropa_updated on public.processing_activities;
create trigger trg_ropa_updated before update on public.processing_activities
  for each row execute function public.set_updated_at();

-- 4. Sub-processors ----------------------------------------------------------
-- org_id null  = platform-wide sub-processor (managed by the platform operator
--                with service_role; visible to every org's admins).
-- org_id set   = additional processor engaged directly by that org.
create table if not exists public.subprocessors (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid references public.organizations(id) on delete cascade,
  name               text not null,
  service            text not null,
  purpose            text not null,
  data_categories    text[] not null default '{}',
  processing_location text not null,
  transfer_mechanism text,     -- 'adequacy' | 'SCCs' | 'EU-US DPF' | 'Swiss-US DPF' | ...
  dpa_url            text,
  website            text,
  is_active          boolean not null default true,
  added_on           date not null default current_date,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists subprocessors_platform_name_uq on public.subprocessors (name) where org_id is null;
create unique index if not exists subprocessors_org_name_uq on public.subprocessors (org_id, name) where org_id is not null;
drop trigger if exists trg_subprocessors_updated on public.subprocessors;
create trigger trg_subprocessors_updated before update on public.subprocessors
  for each row execute function public.set_updated_at();

-- Platform defaults (kept in sync with docs/legal/SUBPROCESSORS.md).
insert into public.subprocessors (org_id, name, service, purpose, data_categories, processing_location, transfer_mechanism, website)
select null, v.name, v.service, v.purpose, v.cats, v.loc, v.mech, v.web
from (values
  ('Supabase', 'Database, authentication, file storage', 'Hosting of all tenant data',
     array['all tenant data'], 'EU (AWS eu-central-1, Frankfurt)', 'In-region; SCCs + EU-US/Swiss-US DPF for support access', 'https://supabase.com'),
  ('Vercel', 'Application hosting / CDN', 'Serving the web application',
     array['request metadata','session cookies'], 'EU edge (fra1) with global CDN', 'SCCs + EU-US/Swiss-US DPF', 'https://vercel.com'),
  ('Stripe', 'Card / wallet payments', 'Processing online payments',
     array['payer name','email','payment data'], 'EU / US', 'SCCs + EU-US/Swiss-US DPF', 'https://stripe.com'),
  ('Resend', 'Transactional email', 'Sending invoices, reminders, notifications',
     array['recipient name','email','message content'], 'US (EU region available)', 'SCCs + EU-US DPF', 'https://resend.com'),
  ('AI assistant API provider', 'Optional in-app assistant', 'Answering staff/parent questions from club data (feature can be disabled per org)',
     array['question text','minimised club context'], 'US', 'SCCs; zero-retention setting required', null)
) as v(name, service, purpose, cats, loc, mech, web)
where not exists (select 1 from public.subprocessors s where s.org_id is null and s.name = v.name);

-- 5. Verifiable parental consent (COPPA) ------------------------------------
create table if not exists public.parental_consents (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  athlete_id          uuid not null references public.athletes(id) on delete cascade,
  guardian_profile_id uuid references public.profiles(id) on delete set null,
  guardian_name       text not null,
  guardian_email      citext,
  -- FTC-recognised verification methods (16 CFR 312.5(b)(2)).
  method              text not null check (method in (
                        'signed_form','payment_transaction','government_id_check','video_conference',
                        'toll_free_call','knowledge_based_auth','facial_match_id','email_plus','school_authorization')),
  status              text not null default 'pending' check (status in ('pending','verified','rejected','revoked','expired')),
  -- What the parent agreed to: collection/use vs. disclosure to third parties
  -- (separate consent required for third-party disclosure under the 2025 rule).
  scope               text[] not null default array['collection_use'],
  third_party_disclosure_consented boolean not null default false,
  direct_notice_version integer not null default 1,
  -- Reference only (e.g. Stripe charge id or form file id). NEVER store ID scans here.
  evidence_reference  text,
  requested_at        timestamptz not null default now(),
  verified_at         timestamptz,
  verified_by         uuid references public.profiles(id) on delete set null,
  revoked_at          timestamptz,
  expires_at          timestamptz,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint parental_consents_verified_chk check (status <> 'verified' or verified_at is not null)
);
create index if not exists idx_parental_consents_athlete on public.parental_consents (athlete_id);
create index if not exists idx_parental_consents_org on public.parental_consents (org_id, status);
drop trigger if exists trg_parental_consents_updated on public.parental_consents;
create trigger trg_parental_consents_updated before update on public.parental_consents
  for each row execute function public.set_updated_at();

-- Does this athlete need verifiable parental consent before collection?
create or replace function public.athlete_requires_vpc(p_athlete uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select cs.coppa_applies and a.dob is not null and a.dob > (current_date - interval '13 years')
    from public.athletes a
    join public.compliance_settings cs on cs.org_id = a.org_id
    where a.id = p_athlete
  ), false);
$$;
create or replace function public.athlete_has_vpc(p_athlete uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.parental_consents
                 where athlete_id = p_athlete and status = 'verified'
                   and (expires_at is null or expires_at > now()));
$$;
grant execute on function public.athlete_requires_vpc(uuid) to authenticated, service_role;
grant execute on function public.athlete_has_vpc(uuid) to authenticated, service_role;

-- 6. FERPA disclosure log (34 CFR 99.32) ------------------------------------
create table if not exists public.education_record_disclosures (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  athlete_id       uuid references public.athletes(id) on delete set null,
  disclosed_to     text not null,
  legitimate_interest text not null,
  records_described text not null,
  exception_basis  text not null default 'school_official'
                     check (exception_basis in ('school_official','parental_consent','directory_information','health_safety_emergency','subpoena','other')),
  disclosed_by     uuid references public.profiles(id) on delete set null,
  disclosed_at     timestamptz not null default now(),
  created_at       timestamptz not null default now()
);
create index if not exists idx_ferpa_disclosures_org on public.education_record_disclosures (org_id, athlete_id);

-- 7. Breach incident log -----------------------------------------------------
create table if not exists public.breach_incidents (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references public.organizations(id) on delete cascade,
  title                     text not null,
  description               text,
  status                    text not null default 'open' check (status in ('open','investigating','contained','notified','closed')),
  severity                  text not null default 'medium' check (severity in ('low','medium','high','critical')),
  risk_assessment           text not null default 'undetermined' check (risk_assessment in ('undetermined','unlikely_risk','risk','high_risk')),
  occurred_at               timestamptz,
  detected_at               timestamptz not null default now(),
  contained_at              timestamptz,
  data_categories           text[] not null default '{}',
  subjects_affected_estimate integer,
  involves_minors           boolean not null default false,
  involves_special_category boolean not null default false,
  jurisdictions             text[] not null default '{}',   -- 'CH','EU','US-CA', ...
  -- GDPR Art. 33: 72h from awareness. nFADP Art. 24: "as soon as possible" — the
  -- same 72h target is applied. US state laws: 30–60 days (tracked in notes).
  authority_notify_by       timestamptz,
  authority_notification_required boolean,
  authority_notified_at     timestamptz,
  authority_reference       text,
  subjects_notified_at      timestamptz,
  controller_notified_at    timestamptz,   -- when the platform (processor) informed the club
  root_cause                text,
  remediation               text,
  reported_by               uuid references public.profiles(id) on delete set null,
  closed_at                 timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index if not exists idx_breach_org on public.breach_incidents (org_id, status);

create or replace function public.breach_set_deadline()
returns trigger language plpgsql as $$
begin
  if new.authority_notify_by is null or (tg_op = 'UPDATE' and new.detected_at is distinct from old.detected_at) then
    new.authority_notify_by := new.detected_at + interval '72 hours';
  end if;
  if new.status = 'closed' and new.closed_at is null then new.closed_at := now(); end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_breach_deadline on public.breach_incidents;
create trigger trg_breach_deadline before insert or update on public.breach_incidents
  for each row execute function public.breach_set_deadline();

-- 8. Data-subject access / rights requests (DSAR) ---------------------------
create table if not exists public.dsar_requests (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  family_id            uuid references public.families(id) on delete set null,
  athlete_id           uuid references public.athletes(id) on delete set null,
  requester_profile_id uuid references public.profiles(id) on delete set null,
  requester_name       text not null,
  requester_email      citext,
  relationship         text not null default 'self' check (relationship in ('self','parent_guardian','authorized_agent','eligible_student','other')),
  request_type         text not null check (request_type in (
                         'access','rectification','erasure','restriction','portability','objection',
                         'withdraw_consent','opt_out_sale_share','limit_sensitive','ferpa_inspect','ferpa_amend',
                         'coppa_review','coppa_delete')),
  jurisdiction         text not null default 'CH' check (jurisdiction in ('CH','EU','UK','US','OTHER')),
  channel              text not null default 'email' check (channel in ('email','web_form','in_app','post','phone','in_person')),
  received_at          timestamptz not null default now(),
  due_at               timestamptz,
  extended_due_at      timestamptz,
  extension_reason     text,
  identity_verified_at timestamptz,
  status               text not null default 'received'
                         check (status in ('received','verifying','in_progress','extended','completed','rejected','withdrawn')),
  rejection_reason     text,
  completed_at         timestamptz,
  response_summary     text,
  deletion_request_id  uuid references public.deletion_requests(id) on delete set null,
  handled_by           uuid references public.profiles(id) on delete set null,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_dsar_org_status on public.dsar_requests (org_id, status, due_at);

-- Statutory response windows (calendar days). Mirrored in src/lib/compliance/dsar.ts.
--   GDPR Art. 12(3): one month (+2 months extension) -> 30 days used.
--   nFADP Art. 25(7) / FADO Art. 18: 30 days.
--   CCPA §1798.130: 45 days (+45 extension).  FERPA 34 CFR 99.10: 45 days.
--   COPPA: "reasonable" — 30 days applied.
create or replace function public.dsar_due_days(p_jurisdiction text, p_type text)
returns integer language sql immutable as $$
  select case
    when p_type in ('ferpa_inspect','ferpa_amend') then 45
    when p_jurisdiction = 'US' then case when p_type = 'opt_out_sale_share' then 15 else 45 end
    else 30
  end;
$$;

create or replace function public.dsar_set_due()
returns trigger language plpgsql as $$
begin
  if new.due_at is null or (tg_op = 'UPDATE' and (new.received_at is distinct from old.received_at
                                                  or new.jurisdiction is distinct from old.jurisdiction
                                                  or new.request_type is distinct from old.request_type)) then
    new.due_at := new.received_at + make_interval(days => public.dsar_due_days(new.jurisdiction, new.request_type));
  end if;
  if new.status in ('completed','rejected','withdrawn') and new.completed_at is null then
    new.completed_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_dsar_due on public.dsar_requests;
create trigger trg_dsar_due before insert or update on public.dsar_requests
  for each row execute function public.dsar_set_due();

create or replace view public.dsar_overdue
with (security_invoker = true) as
  select d.*, coalesce(d.extended_due_at, d.due_at) as effective_due_at
  from public.dsar_requests d
  where d.status not in ('completed','rejected','withdrawn')
    and coalesce(d.extended_due_at, d.due_at) < now();

-- 9. RLS — org-scoped, admins only -------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['compliance_settings','data_retention_policies','processing_activities',
                           'parental_consents','education_record_disclosures','breach_incidents','dsar_requests']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format('create policy %I on public.%I for all using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id))',
                   t || '_admin_all', t);
  end loop;
end $$;

-- Sub-processors: admins read platform rows + own rows; write own rows only.
alter table public.subprocessors enable row level security;
alter table public.subprocessors force row level security;
drop policy if exists subprocessors_select on public.subprocessors;
create policy subprocessors_select on public.subprocessors for select
  using (public.is_admin() and (org_id is null or org_id = public.current_org_id()));
drop policy if exists subprocessors_write on public.subprocessors;
create policy subprocessors_write on public.subprocessors for all
  using (org_id is not null and public.is_org_admin(org_id))
  with check (org_id is not null and public.is_org_admin(org_id));

-- Breach & consent evidence must never be silently deleted by tenants.
create or replace function public.compliance_no_delete()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then
    raise exception '% records are retained as compliance evidence and cannot be deleted', tg_table_name;
  end if;
  return old;
end $$;
drop trigger if exists trg_breach_no_delete on public.breach_incidents;
create trigger trg_breach_no_delete before delete on public.breach_incidents
  for each row execute function public.compliance_no_delete();
drop trigger if exists trg_parental_consents_no_delete on public.parental_consents;
create trigger trg_parental_consents_no_delete before delete on public.parental_consents
  for each row execute function public.compliance_no_delete();
drop trigger if exists trg_ferpa_disclosures_no_delete on public.education_record_disclosures;
create trigger trg_ferpa_disclosures_no_delete before delete on public.education_record_disclosures
  for each row execute function public.compliance_no_delete();

-- Audit trail on the evidentiary tables.
drop trigger if exists trg_audit_parental_consents on public.parental_consents;
create trigger trg_audit_parental_consents after insert or update or delete on public.parental_consents
  for each row execute function public.audit_trigger();
drop trigger if exists trg_audit_breach_incidents on public.breach_incidents;
create trigger trg_audit_breach_incidents after insert or update or delete on public.breach_incidents
  for each row execute function public.audit_trigger();
drop trigger if exists trg_audit_dsar_requests on public.dsar_requests;
create trigger trg_audit_dsar_requests after insert or update or delete on public.dsar_requests
  for each row execute function public.audit_trigger();
drop trigger if exists trg_audit_ferpa_disclosures on public.education_record_disclosures;
create trigger trg_audit_ferpa_disclosures after insert or update or delete on public.education_record_disclosures
  for each row execute function public.audit_trigger();

grant select, insert, update, delete on
  public.compliance_settings, public.data_retention_policies, public.processing_activities,
  public.subprocessors, public.parental_consents, public.education_record_disclosures,
  public.breach_incidents, public.dsar_requests
  to authenticated, service_role;
grant select on public.dsar_overdue to authenticated, service_role;

-- 10. Bootstrap the founding club (DLang Basketball, Lausanne, CH) ----------
insert into public.compliance_settings (org_id, data_region, jurisdiction_subdivision, org_type, hosting_region,
                                        legal_entity_name, supervisory_authority)
select o.id, 'CH', 'CH-VD', 'club', 'eu-central-1', o.name,
       'Federal Data Protection and Information Commissioner (FDPIC)'
from public.organizations o
where o.id = '00000000-0000-0000-0000-000000000001'
on conflict (org_id) do nothing;

do $$
begin
  if exists (select 1 from public.organizations where id = '00000000-0000-0000-0000-000000000001') then
    perform public.seed_retention_policies('00000000-0000-0000-0000-000000000001');
  end if;
end $$;

-- Starter ROPA for the founding club (admins refine in-app; review with counsel).
insert into public.processing_activities (org_id, name, purpose, legal_basis, special_category_basis, data_subject_categories,
  data_categories, involves_special_category, involves_minors, recipients, subprocessor_names, international_transfers,
  transfer_safeguards, retention_category, dpia_required, next_review_at)
select o.id, v.name, v.purpose, v.basis, v.sbasis, v.subjects, v.cats, v.special, true, v.recips, v.subs,
       'Hosting in EU (Frankfurt); support / email providers in US', 'EU adequacy for CH; Swiss-US DPF or SCCs', v.ret, v.dpia,
       (current_date + interval '12 months')::date
from public.organizations o
cross join (values
  ('Registration & membership', 'Register participants for programmes, manage families and teams', 'contract', null,
     array['participants','parents/guardians'], array['identity','contact','date of birth','team/programme'], false,
     array['club staff'], array['Supabase','Vercel','Resend'], 'athlete_profile', false),
  ('Health & emergency information', 'Keep participants safe; emergency response', 'consent', 'explicit consent; vital interests',
     array['participants','emergency contacts'], array['allergies','conditions','medication','insurance','emergency contacts'], true,
     array['authorised club staff'], array['Supabase'], 'medical', true),
  ('Attendance & training', 'Record attendance, bookings and coaching notes', 'contract', null,
     array['participants','coaches'], array['attendance','bookings','coach notes'], false,
     array['coaches','club staff'], array['Supabase','Vercel'], 'attendance', false),
  ('Billing & accounting', 'Invoice fees, collect payments, keep statutory books', 'legal_obligation', null,
     array['parents/guardians'], array['invoices','payments','payment references'], false,
     array['finance staff','auditors','tax authority'], array['Supabase','Stripe','Resend'], 'financial', false),
  ('Consent management', 'Capture and evidence consents and waivers', 'legal_obligation', null,
     array['parents/guardians'], array['consent text snapshot','timestamp','IP address','user agent'], false,
     array['club staff'], array['Supabase'], 'consent_records', false),
  ('Club communications', 'Service notifications, reminders, newsletters (with consent)', 'contract', null,
     array['parents/guardians','staff'], array['name','email','message content'], false,
     array['club staff'], array['Resend'], 'communications', false),
  ('Photos & media', 'Club promotion and coaching footage', 'consent', null,
     array['participants'], array['photos','video'], false,
     array['public (website/social) where consented'], array['Supabase'], 'media', true)
) as v(name, purpose, basis, sbasis, subjects, cats, special, recips, subs, ret, dpia)
where o.id = '00000000-0000-0000-0000-000000000001'
  and not exists (select 1 from public.processing_activities pa where pa.org_id = o.id and pa.name = v.name);

-- Every new org gets settings + default retention schedule automatically.
create or replace function public.bootstrap_org_compliance()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_region text;
begin
  v_region := case
    when new.country = 'CH' then 'CH'
    when new.country = 'US' then 'US'
    when new.country in ('GB','UK') then 'UK'
    when new.country in ('AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU',
                         'MT','NL','PL','PT','RO','SK','SI','ES','SE','IS','LI','NO') then 'EU'
    else 'OTHER' end;
  insert into public.compliance_settings (org_id, data_region, legal_entity_name, coppa_applies)
    values (new.id, v_region, new.name, v_region = 'US')
    on conflict (org_id) do nothing;
  insert into public.data_retention_policies (org_id, data_category, retention_months)
  select new.id, c, public.default_retention_months(v_region, c)
  from unnest(array['athlete_profile','guardian_contact','medical','attendance','registrations','financial',
                    'consent_records','parental_consents','communications','media','documents','audit_logs',
                    'ai_queries','dsar_records','breach_records','education_records','marketing']) as c
  on conflict (org_id, data_category) do nothing;
  return new;
end $$;
drop trigger if exists trg_org_bootstrap_compliance on public.organizations;
create trigger trg_org_bootstrap_compliance after insert on public.organizations
  for each row execute function public.bootstrap_org_compliance();
