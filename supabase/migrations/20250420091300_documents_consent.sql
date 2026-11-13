-- ============================================================================
-- DLang Basketball — Club OS
-- Migration 14 · Documents & consent system
--
-- Builds on the base schema (documents / consent_forms / consent_acceptances).
--   1. documents gains a program scope (+ optional title)
--   2. documents_select gains program-scoped and global (org-wide) visibility
--   3. consent_acceptances gains an immutable accepted-text snapshot, filled by
--      a BEFORE INSERT trigger so EVERY acceptance path (public registration RPC,
--      guardian RLS insert, admin) captures the exact wording shown at the time
--   4. private Storage bucket for document files (guarded; no-ops off Supabase)
-- Idempotent: safe to re-run.
-- ============================================================================

-- 1. Document program scope --------------------------------------------------
alter table public.documents add column if not exists program_id uuid references public.programs(id) on delete cascade;
alter table public.documents add column if not exists title      text;

create index if not exists documents_program_idx on public.documents (program_id) where program_id is not null;
create index if not exists documents_family_idx  on public.documents (family_id)  where family_id is not null;

-- 2. Visibility: admin · athlete-guardian · family-guardian · program-guardian · global
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select
  using (
    public.is_admin()
    or (athlete_id is not null and public.is_guardian_of_athlete(athlete_id))
    or (family_id  is not null and public.is_guardian_of_family(family_id))
    or (program_id is not null and exists (
          select 1 from public.registrations r
          where r.program_id = documents.program_id
            and public.is_guardian_of_athlete(r.athlete_id)))
    or (athlete_id is null and family_id is null and program_id is null
          and org_id = public.current_org_id())   -- global club documents
  );

-- 3. Accepted-text snapshot --------------------------------------------------
alter table public.consent_acceptances add column if not exists accepted_text text;
alter table public.consent_acceptances add column if not exists user_agent    text;

create or replace function public.snapshot_consent_text()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_body text; v_ver integer;
begin
  if new.accepted_text is null or new.accepted_version is null then
    select body, version into v_body, v_ver from public.consent_forms where id = new.consent_form_id;
    if new.accepted_text is null then new.accepted_text := v_body; end if;
    if new.accepted_version is null then new.accepted_version := v_ver; end if;
  end if;
  if new.accepted_at is null then new.accepted_at := now(); end if;
  return new;
end $$;

drop trigger if exists trg_snapshot_consent_text on public.consent_acceptances;
create trigger trg_snapshot_consent_text
  before insert on public.consent_acceptances
  for each row execute function public.snapshot_consent_text();

-- 3b. Seed real consent wording (so snapshots are meaningful) -----------------
-- Only fills empty bodies; admins can publish newer versions from the manager.
update public.consent_forms set body =
  'I have read the DLang Basketball Club privacy policy. I consent to the club processing my and my child''s personal data (including contact, medical and attendance information) to administer participation, in accordance with the Swiss Federal Act on Data Protection (FADP) and the GDPR. I understand I may request access, correction or deletion at any time.'
  where key = 'privacy' and (body is null or body = '');
update public.consent_forms set body =
  'I acknowledge that basketball involves inherent risks of injury. On behalf of myself and my child, I voluntarily assume these risks and release DLang Basketball Club, its coaches and staff from liability for injuries sustained during participation, except those caused by gross negligence. I confirm my child is physically fit to participate.'
  where key = 'liability' and (body is null or body = '');
update public.consent_forms set body =
  'I declare that the medical information provided is accurate and complete. I will inform the club of any changes. I authorise club staff to seek emergency medical treatment for my child if I cannot be reached, and I accept responsibility for any resulting medical costs.'
  where key = 'health' and (body is null or body = '');
update public.consent_forms set body =
  'I consent to photographs and video of my child being taken during club activities and used for coaching, promotion and on the club''s website and social media. I understand I may withdraw this consent at any time by contacting the club.'
  where key = 'media' and (body is null or body = '');
update public.consent_forms set body =
  'I accept the club''s terms and conditions, including the registration fees, payment schedule and cancellation/refund policy as published by the club.'
  where key = 'terms' and (body is null or body = '');
update public.consent_forms set body =
  'I consent to my child being transported by club-organised transport to and from training sessions, matches and events.'
  where key = 'transport' and (body is null or body = '');

-- Founding-club data: skipped on an empty database (new white-label project).
insert into public.consent_forms (id, org_id, key, title, body, version, locale, is_required, is_active)
  select '00000000-0000-0000-0000-000000000037','00000000-0000-0000-0000-000000000001','conduct','Code of conduct',
    'I and my child agree to abide by the DLang Basketball Club code of conduct: to show respect to coaches, teammates, opponents and officials; to attend punctually; to refrain from abusive language, violence or discrimination; and to represent the club positively. I understand serious breaches may result in suspension.',
    1, 'en', true, true
   where exists (select 1 from public.organizations where id = '00000000-0000-0000-0000-000000000001')
  on conflict (id) do nothing;

-- 3a. Backfill snapshots for pre-existing acceptances (accurate while version matches)
update public.consent_acceptances ca
  set accepted_text = cf.body
  from public.consent_forms cf
  where ca.consent_form_id = cf.id
    and ca.accepted_text is null
    and ca.accepted_version = cf.version;

-- 4. Private Storage bucket for document files (Supabase only) ----------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
      values ('documents', 'documents', false)
      on conflict (id) do nothing;
  end if;
end $$;

-- Object policies (guarded). Downloads are served via short-lived signed URLs
-- minted server-side with the service role, so reads stay locked to staff here.
do $$
begin
  if to_regclass('storage.objects') is not null then
    execute $p$drop policy if exists documents_objects_staff on storage.objects$p$;
    execute $p$create policy documents_objects_staff on storage.objects for all
      using (bucket_id = 'documents' and public.is_admin())
      with check (bucket_id = 'documents' and public.is_admin())$p$;
  end if;
end $$;

grant select, insert, update, delete on public.documents to authenticated, service_role;
