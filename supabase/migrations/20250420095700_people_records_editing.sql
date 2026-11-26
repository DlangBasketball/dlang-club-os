-- ============================================================================
-- People & records editing (track A): athlete photos, registration
-- cancellation, document metadata, manual consent records, tenant integrity.
-- Additive and idempotent.
--
--  1) athletes.photo_path (+ photo_updated_at): key of the athlete's photo in
--     the PRIVATE bucket "athlete-photos", path <org_id>/<athlete_id>/<file>.
--     Photos identify athletes inside the club only; they are never public.
--     Media/marketing consent is separate and is NOT implied by a photo.
--  2) Storage bucket "athlete-photos" (private, 2 MB, jpeg/webp/png) and its
--     object policies: admin of the org + guardians of the athlete read and
--     write; coaches read only athletes they may access; finance nothing.
--  3) registrations: cancellation reason / time / actor.
--  4) documents: expires_at, updated_at, updated_by.
--  5) consent_acceptances: manual (paper) records and withdrawal reason.
--     Records stay append-only; the immutability guard now also freezes the
--     new evidentiary columns and lets a withdrawal set its reason once.
--     withdraw_consent_with_reason() is the lawful withdrawal path.
--  6) Tenant integrity: rows that reference an athlete / family / program /
--     consent form must reference one of the SAME org (a crafted id from
--     another club is refused even where a policy only checks the role).
--  7) family_members policies are scoped to the caller's org (the table has
--     no org_id, so the restrictive platform_tenant_isolation policy does not
--     cover it).
--  8) Audit triggers on athletes and families (personal data).
--  9) anonymise_family also clears the athlete photos and returns their
--     storage paths (photo_paths) so the caller removes the objects.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Athlete photo columns
-- ---------------------------------------------------------------------------
alter table public.athletes add column if not exists photo_path text;
alter table public.athletes add column if not exists photo_updated_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'athletes_photo_path_scope') then
    alter table public.athletes add constraint athletes_photo_path_scope
      check (photo_path is null
             or photo_path like (org_id::text || '/' || id::text || '/%'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Storage: private bucket + object policies
-- ---------------------------------------------------------------------------
-- Which athlete does an object key belong to, and may the caller read / write
-- it? Key format: <org_id>/<athlete_id>/<file>. The org segment must be the
-- caller's org AND the athlete's org.
create or replace function public.athlete_photo_access(p_name text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_parts   text[];
  v_org     uuid;
  v_athlete uuid;
  v_re      constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if auth.uid() is null or p_name is null then return false; end if;
  v_parts := string_to_array(p_name, '/');
  if coalesce(array_length(v_parts, 1), 0) <> 3 or v_parts[3] = '' then return false; end if;
  if v_parts[1] !~ v_re or v_parts[2] !~ v_re then return false; end if;
  v_org := v_parts[1]::uuid;
  v_athlete := v_parts[2]::uuid;
  if v_org is distinct from public.current_org_id() then return false; end if;
  if not exists (select 1 from public.athletes a where a.id = v_athlete and a.org_id = v_org) then
    return false;
  end if;
  if public.is_admin() or public.is_guardian_of_athlete(v_athlete) then return true; end if;
  if not p_write and public.coach_can_access_athlete(v_athlete) then return true; end if;
  return false;
end $$;

revoke all on function public.athlete_photo_access(text, boolean) from public, anon;
grant execute on function public.athlete_photo_access(text, boolean) to authenticated, service_role;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
      values ('athlete-photos', 'athlete-photos', false)
      on conflict (id) do update set public = false;
    -- Size / type limits where the Storage version has the columns.
    if exists (select 1 from information_schema.columns
                where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
      execute $q$update storage.buckets set file_size_limit = 2097152 where id = 'athlete-photos'$q$;
    end if;
    if exists (select 1 from information_schema.columns
                where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
      execute $q$update storage.buckets set allowed_mime_types = array['image/jpeg','image/webp','image/png']
                 where id = 'athlete-photos'$q$;
    end if;
  end if;
end $$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    execute $p$drop policy if exists athlete_photos_select on storage.objects$p$;
    execute $p$create policy athlete_photos_select on storage.objects for select to authenticated
      using (bucket_id = 'athlete-photos' and public.athlete_photo_access(name, false))$p$;

    execute $p$drop policy if exists athlete_photos_insert on storage.objects$p$;
    execute $p$create policy athlete_photos_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'athlete-photos' and public.athlete_photo_access(name, true))$p$;

    execute $p$drop policy if exists athlete_photos_update on storage.objects$p$;
    execute $p$create policy athlete_photos_update on storage.objects for update to authenticated
      using (bucket_id = 'athlete-photos' and public.athlete_photo_access(name, true))
      with check (bucket_id = 'athlete-photos' and public.athlete_photo_access(name, true))$p$;

    execute $p$drop policy if exists athlete_photos_delete on storage.objects$p$;
    execute $p$create policy athlete_photos_delete on storage.objects for delete to authenticated
      using (bucket_id = 'athlete-photos' and public.athlete_photo_access(name, true))$p$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Registrations: cancellation details
-- ---------------------------------------------------------------------------
alter table public.registrations add column if not exists cancellation_reason text;
alter table public.registrations add column if not exists cancelled_at timestamptz;
alter table public.registrations add column if not exists cancelled_by uuid references public.profiles(id) on delete set null;

-- A cancellation reason can name an injury or illness: keep it out of the
-- audit row images like registrations.notes.
create or replace function public.audit_sensitive_columns(p_table text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select case p_table
    when 'athlete_medical' then array['allergies','conditions','medications','insurance',
                                      'emergency_contact_name','emergency_contact_phone','notes']
    when 'registrations'   then array['notes','cancellation_reason']
    else array[]::text[]
  end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Documents: expiry + last edit
-- ---------------------------------------------------------------------------
alter table public.documents add column if not exists expires_at date;
alter table public.documents add column if not exists updated_at timestamptz not null default now();
alter table public.documents add column if not exists updated_by uuid references public.profiles(id) on delete set null;
create index if not exists documents_org_idx on public.documents (org_id);

drop trigger if exists trg_documents_updated on public.documents;
create trigger trg_documents_updated before update on public.documents
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5) Consent records: manual entry + withdrawal reason
-- ---------------------------------------------------------------------------
alter table public.consent_acceptances add column if not exists source text not null default 'online';
alter table public.consent_acceptances add column if not exists recorded_by uuid references public.profiles(id) on delete set null;
alter table public.consent_acceptances add column if not exists signer_name text;
alter table public.consent_acceptances add column if not exists withdrawal_reason text;
alter table public.consent_acceptances add column if not exists withdrawn_by uuid references public.profiles(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'consent_acceptances_source_check') then
    alter table public.consent_acceptances add constraint consent_acceptances_source_check
      check (source in ('online', 'paper', 'verbal', 'email', 'other'));
  end if;
end $$;

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
     or new.created_at is distinct from old.created_at
     or new.source is distinct from old.source
     or new.recorded_by is distinct from old.recorded_by
     or new.signer_name is distinct from old.signer_name then
    raise exception 'Consent acceptance records are immutable; only withdrawal of consent is permitted';
  end if;
  -- A withdrawn record stays withdrawn; reason/actor are written once, with it.
  if old.status = 'withdrawn' and (new.status is distinct from old.status
       or new.withdrawn_at is distinct from old.withdrawn_at
       or new.withdrawal_reason is distinct from old.withdrawal_reason
       or new.withdrawn_by is distinct from old.withdrawn_by) then
    raise exception 'Consent acceptance records are immutable; this consent is already withdrawn';
  end if;
  if old.status <> 'withdrawn' and new.status <> 'withdrawn'
     and (new.withdrawal_reason is distinct from old.withdrawal_reason
          or new.withdrawn_by is distinct from old.withdrawn_by) then
    raise exception 'Consent acceptance records are immutable; only withdrawal of consent is permitted';
  end if;
  return new;
end $$;

create or replace function public.withdraw_consent_with_reason(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_ath uuid; v_org uuid; v_status public.consent_acceptance_status;
begin
  select athlete_id, org_id, status into v_ath, v_org, v_status
    from public.consent_acceptances where id = p_id;
  if v_ath is null or v_org is distinct from public.current_org_id() then raise exception 'NOT_FOUND'; end if;
  if not (public.is_admin() or public.is_guardian_of_athlete(v_ath)) then raise exception 'FORBIDDEN'; end if;
  if v_status <> 'accepted' then raise exception 'NOT_ACTIVE'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  update public.consent_acceptances
     set status = 'withdrawn', withdrawn_at = now(),
         withdrawal_reason = left(btrim(p_reason), 1000), withdrawn_by = auth.uid()
   where id = p_id and status = 'accepted';
  return jsonb_build_object('id', p_id, 'status', 'withdrawn');
end $$;

revoke all on function public.withdraw_consent_with_reason(uuid, text) from public, anon;
grant execute on function public.withdraw_consent_with_reason(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) Tenant integrity of references
-- ---------------------------------------------------------------------------
create or replace function public.enforce_same_org_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_id  uuid;
begin
  if tg_table_name = 'athletes' then
    if not exists (select 1 from public.families where id = new.family_id and org_id = new.org_id) then
      raise exception 'CROSS_TENANT_REFERENCE: family' using errcode = '42501';
    end if;
  end if;

  v_id := nullif(v_row->>'athlete_id', '')::uuid;
  if tg_table_name <> 'athletes' and v_id is not null
     and not exists (select 1 from public.athletes where id = v_id and org_id = new.org_id) then
    raise exception 'CROSS_TENANT_REFERENCE: athlete' using errcode = '42501';
  end if;

  v_id := nullif(v_row->>'program_id', '')::uuid;
  if v_id is not null
     and not exists (select 1 from public.programs where id = v_id and org_id = new.org_id) then
    raise exception 'CROSS_TENANT_REFERENCE: program' using errcode = '42501';
  end if;

  if tg_table_name = 'documents' then
    v_id := nullif(v_row->>'family_id', '')::uuid;
    if v_id is not null
       and not exists (select 1 from public.families where id = v_id and org_id = new.org_id) then
      raise exception 'CROSS_TENANT_REFERENCE: family' using errcode = '42501';
    end if;
  end if;

  if tg_table_name = 'consent_acceptances' then
    if not exists (select 1 from public.consent_forms where id = new.consent_form_id and org_id = new.org_id) then
      raise exception 'CROSS_TENANT_REFERENCE: consent form' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_same_org_refs on public.athletes;
create trigger trg_same_org_refs before insert or update of org_id, family_id on public.athletes
  for each row execute function public.enforce_same_org_refs();

drop trigger if exists trg_same_org_refs on public.registrations;
create trigger trg_same_org_refs before insert or update of org_id, athlete_id, program_id on public.registrations
  for each row execute function public.enforce_same_org_refs();

drop trigger if exists trg_same_org_refs on public.documents;
create trigger trg_same_org_refs before insert or update of org_id, athlete_id, family_id, program_id on public.documents
  for each row execute function public.enforce_same_org_refs();

drop trigger if exists trg_same_org_refs on public.consent_acceptances;
create trigger trg_same_org_refs before insert on public.consent_acceptances
  for each row execute function public.enforce_same_org_refs();

-- ---------------------------------------------------------------------------
-- 7) family_members: org-scoped admin access
-- ---------------------------------------------------------------------------
create or replace function public.family_in_current_org(p_family uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.families f
                  where f.id = p_family and f.org_id = public.current_org_id());
$$;

create or replace function public.profile_in_current_org(p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                  where p.id = p_profile and p.org_id = public.current_org_id());
$$;

revoke all on function public.family_in_current_org(uuid) from public, anon;
revoke all on function public.profile_in_current_org(uuid) from public, anon;
grant execute on function public.family_in_current_org(uuid) to authenticated, service_role;
grant execute on function public.profile_in_current_org(uuid) to authenticated, service_role;

drop policy if exists family_members_select on public.family_members;
create policy family_members_select on public.family_members for select
  using (profile_id = auth.uid()
         or public.is_guardian_of_family(family_id)
         or (public.is_admin() and public.family_in_current_org(family_id)));

drop policy if exists family_members_admin_write on public.family_members;
create policy family_members_admin_write on public.family_members for all
  using (public.is_admin() and public.family_in_current_org(family_id))
  with check (public.is_admin() and public.family_in_current_org(family_id)
              and public.profile_in_current_org(profile_id));

-- ---------------------------------------------------------------------------
-- 8) Audit trail for athlete and family records
-- ---------------------------------------------------------------------------
drop trigger if exists trg_audit_athletes on public.athletes;
create trigger trg_audit_athletes after insert or update or delete on public.athletes
  for each row execute function public.audit_trigger();

drop trigger if exists trg_audit_families on public.families;
create trigger trg_audit_families after insert or update or delete on public.families
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- 9) anonymise_family: photos too (body from 20250420095400 + photo handling)
-- ---------------------------------------------------------------------------
create or replace function public.anonymise_family(p_family uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org       uuid;
  v_athletes  integer;
  v_profiles  integer;
  v_ath_ids   uuid[];
  v_med_ids   uuid[];
  v_reg_ids   uuid[];
  v_doc_ids   uuid[];
  v_paths     text[];
  v_photos    text[];
  v_audit     integer;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select org_id into v_org from public.families where id = p_family;
  if v_org is null or v_org is distinct from public.current_org_id() then
    raise exception 'NOT_FOUND';
  end if;

  select coalesce(array_agg(id), '{}'),
         coalesce(array_agg(photo_path) filter (where photo_path is not null), '{}')
    into v_ath_ids, v_photos
    from public.athletes where family_id = p_family and org_id = v_org;
  select coalesce(array_agg(id), '{}') into v_med_ids
    from public.athlete_medical where athlete_id = any(v_ath_ids);
  select coalesce(array_agg(id), '{}') into v_reg_ids
    from public.registrations where athlete_id = any(v_ath_ids);

  update public.families
    set name = '[deleted]', address = null, phone = null, contact_name = null, contact_email = null
    where id = p_family;

  update public.athletes
    set first_name = 'Redacted', last_name = 'Athlete', dob = '1900-01-01', nationality = null,
        school = null, notes = null, status = 'inactive', photo_path = null, photo_updated_at = null
    where id = any(v_ath_ids);
  get diagnostics v_athletes = row_count;

  update public.athlete_medical
    set allergies = null, conditions = null, medications = null, insurance = null,
        emergency_contact_name = null, emergency_contact_phone = null, notes = null
    where id = any(v_med_ids);

  update public.registrations set notes = null, cancellation_reason = null
    where id = any(v_reg_ids) and (notes is not null or cancellation_reason is not null);

  update public.attendance_marks set notes = null
    where athlete_id = any(v_ath_ids) and notes is not null;

  select coalesce(array_agg(id), '{}'), coalesce(array_agg(storage_path) filter (where storage_path is not null), '{}')
    into v_doc_ids, v_paths
    from public.documents
   where org_id = v_org and (family_id = p_family or athlete_id = any(v_ath_ids));
  delete from public.documents where id = any(v_doc_ids);

  update public.profiles p
    set full_name = '[deleted]', email = 'deleted-' || p.id || '@deleted.invalid',
        phone = null, is_active = false
    where p.id in (select profile_id from public.family_members where family_id = p_family)
      and p.org_id = v_org;
  get diagnostics v_profiles = row_count;

  update public.audit_logs
     set old_data = null,
         new_data = jsonb_build_object('redacted', 'erasure')
   where org_id = v_org
     and (   (target_table = 'families'        and target_id = p_family)
          or (target_table = 'athletes'        and target_id = any(v_ath_ids))
          or (target_table = 'athlete_medical' and target_id = any(v_med_ids))
          or (target_table = 'registrations'   and target_id = any(v_reg_ids))
          or (target_table = 'documents'       and target_id = any(v_doc_ids)));
  get diagnostics v_audit = row_count;

  return jsonb_build_object(
    'family_id', p_family,
    'athletes_anonymised', v_athletes,
    'profiles_anonymised', v_profiles,
    'documents_deleted', coalesce(array_length(v_doc_ids, 1), 0),
    'audit_rows_redacted', v_audit,
    'storage_paths', to_jsonb(v_paths),
    'photo_paths', to_jsonb(v_photos)
  );
end $$;

revoke all on function public.anonymise_family(uuid) from public, anon;
grant execute on function public.anonymise_family(uuid) to authenticated, service_role;
