-- ============================================================================
-- DLang Basketball — Club OS
-- Migration 15 · Security hardening (production readiness)
--
-- This app handles minors, guardian data, medical notes, payments and consent.
-- This migration closes the remaining gaps found in the security audit:
--   1. FORCE row-level security on the most sensitive tables (defence in depth)
--   2. True consent-record immutability (records can be WITHDRAWN, never edited
--      or deleted) + a lawful withdraw_consent() path
--   3. Audit trail for document uploads/deletes (sensitive files)
--   4. GDPR/FADP right-to-erasure: deletion_requests workflow + anonymise_family()
--      that scrubs PII while retaining financial records for legal retention
-- Idempotent where practical.
-- ============================================================================

-- 1. FORCE RLS on sensitive tables -------------------------------------------
-- (service_role keeps BYPASSRLS, so the server admin client is unaffected; this
--  removes the table-owner's implicit bypass on real Supabase.)
alter table public.athlete_medical       force row level security;
alter table public.consent_acceptances   force row level security;
alter table public.invoices              force row level security;
alter table public.payments              force row level security;
alter table public.documents             force row level security;
alter table public.profiles              force row level security;
alter table public.families              force row level security;
alter table public.athletes              force row level security;
alter table public.audit_logs            force row level security;

-- 2. Consent record immutability ---------------------------------------------
alter table public.consent_acceptances add column if not exists withdrawn_at timestamptz;

-- Remove the broad UPDATE policy: acceptances are append-only at the RLS layer.
drop policy if exists consent_acc_update on public.consent_acceptances;

-- Guard: block DELETE always; on UPDATE allow ONLY a withdrawal (status +
-- withdrawn_at). Every evidentiary field is frozen.
create or replace function public.consent_acceptance_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Consent acceptance records are immutable and cannot be deleted';
  end if;
  if new.org_id is distinct from old.org_id
     or new.athlete_id is distinct from old.athlete_id
     or new.consent_form_id is distinct from old.consent_form_id
     or new.accepted_version is distinct from old.accepted_version
     or new.accepted_by is distinct from old.accepted_by
     or new.accepted_at is distinct from old.accepted_at
     or new.ip_address is distinct from old.ip_address
     or new.accepted_text is distinct from old.accepted_text
     or new.user_agent is distinct from old.user_agent
     or new.program_id is distinct from old.program_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Consent acceptance records are immutable; only withdrawal of consent is permitted';
  end if;
  return new;
end $$;

drop trigger if exists trg_consent_immutable on public.consent_acceptances;
create trigger trg_consent_immutable before update or delete on public.consent_acceptances
  for each row execute function public.consent_acceptance_guard();

-- Lawful withdrawal (the only permitted mutation).
create or replace function public.withdraw_consent(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ath uuid;
begin
  select athlete_id into v_ath from public.consent_acceptances where id = p_id;
  if v_ath is null then raise exception 'NOT_FOUND'; end if;
  if not (public.is_admin() or public.is_guardian_of_athlete(v_ath)) then raise exception 'FORBIDDEN'; end if;
  update public.consent_acceptances set status = 'withdrawn', withdrawn_at = now() where id = p_id and status = 'accepted';
  return jsonb_build_object('id', p_id, 'status', 'withdrawn');
end $$;

-- 3. Audit document uploads/deletes ------------------------------------------
drop trigger if exists trg_audit_documents on public.documents;
create trigger trg_audit_documents after insert or update or delete on public.documents
  for each row execute function public.audit_trigger();

-- 4. Deletion-request workflow (right to erasure) ----------------------------
create table if not exists public.deletion_requests (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  family_id    uuid not null references public.families(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  reason       text,
  status       text not null default 'pending' check (status in ('pending','approved','rejected','completed')),
  reviewed_by  uuid references public.profiles(id) on delete set null,
  reviewed_at  timestamptz,
  completed_at timestamptz,
  created_at   timestamptz not null default now()
);
alter table public.deletion_requests enable row level security;
alter table public.deletion_requests force row level security;

drop policy if exists deletion_requests_select on public.deletion_requests;
create policy deletion_requests_select on public.deletion_requests for select
  using (public.is_admin() or public.is_guardian_of_family(family_id));
drop policy if exists deletion_requests_insert on public.deletion_requests;
create policy deletion_requests_insert on public.deletion_requests for insert
  with check (org_id = public.current_org_id() and (public.is_admin() or public.is_guardian_of_family(family_id)));
drop policy if exists deletion_requests_update on public.deletion_requests;
create policy deletion_requests_update on public.deletion_requests for update
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update on public.deletion_requests to authenticated, service_role;

-- Anonymise a family: scrub PII across the graph, keep financial + consent rows
-- (lawful retention). Admin-only; SECURITY DEFINER to reach every table.
create or replace function public.anonymise_family(p_family uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_athletes integer; v_profiles integer;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select org_id into v_org from public.families where id = p_family;
  if v_org is null then raise exception 'NOT_FOUND'; end if;

  update public.families
    set name = '[deleted]', address = null, phone = null, contact_name = null, contact_email = null
    where id = p_family;

  update public.athletes
    set first_name = 'Redacted', last_name = 'Athlete', dob = '1900-01-01', nationality = null,
        school = null, notes = null, status = 'inactive'
    where family_id = p_family;
  get diagnostics v_athletes = row_count;

  update public.athlete_medical am
    set allergies = null, conditions = null, medications = null, insurance = null,
        emergency_contact_name = null, emergency_contact_phone = null, notes = null
    where am.athlete_id in (select id from public.athletes where family_id = p_family);

  update public.profiles p
    set full_name = '[deleted]', email = 'deleted-' || p.id || '@deleted.invalid',
        phone = null, is_active = false
    where p.id in (select profile_id from public.family_members where family_id = p_family);
  get diagnostics v_profiles = row_count;

  return jsonb_build_object('family_id', p_family, 'athletes_anonymised', v_athletes, 'profiles_anonymised', v_profiles);
end $$;

revoke all on function public.anonymise_family(uuid) from anon;
grant execute on function public.anonymise_family(uuid) to authenticated, service_role;
grant execute on function public.withdraw_consent(uuid) to authenticated, service_role;
