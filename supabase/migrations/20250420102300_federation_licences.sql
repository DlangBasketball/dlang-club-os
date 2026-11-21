-- ============================================================================
-- Federation licences on players + structured family postal address
-- (additive, idempotent)
--
-- Many sports federations license their players (e.g. Swiss Basketball
-- licences managed in Basketplan). The club records the licence it holds for
-- each player; nothing here is sport- or country-specific.
--
-- 1. athletes.licence_number / licence_category / licence_issued_on /
--    licence_fee / licence_federation    all nullable, length/amount checks.
-- 2. Unique licence number per club: (org_id, licence_number) where set.
--    Another club may hold the same number (different federation/sport).
-- 3. families.postal_code / city          next to the existing street line
--                                         in families.address.
-- 4. athlete_licence_guard()              licence fields are club-managed:
--                                         only staff (admin/finance of the
--                                         club) or the service role may set
--                                         or change them. Guardians keep
--                                         their existing write access to the
--                                         other athlete columns.
-- 5. anonymise_family()                   erasure also clears the licence
--                                         and the postal code / city.
--
-- RLS: unchanged. The existing row policies already cover every column:
--   athletes  select: staff of the club, the child's guardians, coaches who
--             can access the athlete (coach_can_access_athlete); write: staff
--             of the club; guardians of the child (licence columns blocked by
--             the guard in 4).
--   families  select: staff of the club and the family's guardians; write:
--             staff of the club and the family's guardians.
--   Plus the restrictive platform_tenant_isolation policies (org_id =
--   current_org_id()). Row-level policies cannot hide single columns: a coach
--   who can read the athlete row can also read licence_fee. The fee is the
--   federation's published tariff (not sensitive), so the UI simply shows it
--   only to admin/finance; no column-level split is needed.
-- Tests: tests/db/federation_licences.sql.
-- ============================================================================

-- 1) Athlete licence columns -----------------------------------------------------
alter table public.athletes add column if not exists licence_number     text;
alter table public.athletes add column if not exists licence_category   text;
alter table public.athletes add column if not exists licence_issued_on  date;
alter table public.athletes add column if not exists licence_fee        numeric(10,2);
alter table public.athletes add column if not exists licence_federation text;

do $$ begin
  alter table public.athletes add constraint athletes_licence_number_chk
    check (licence_number is null or (char_length(licence_number) <= 40 and btrim(licence_number) <> ''));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.athletes add constraint athletes_licence_category_chk
    check (licence_category is null or char_length(licence_category) <= 40);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.athletes add constraint athletes_licence_federation_chk
    check (licence_federation is null or char_length(licence_federation) <= 80);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.athletes add constraint athletes_licence_fee_chk
    check (licence_fee is null or licence_fee >= 0);
exception when duplicate_object then null; end $$;

comment on column public.athletes.licence_number is 'Federation licence number held by the club for this player (unique per club).';
comment on column public.athletes.licence_category is 'Federation licence category, e.g. U16 or Official.';
comment on column public.athletes.licence_issued_on is 'Date the federation issued / validated the licence.';
comment on column public.athletes.licence_fee is 'Licence fee in the club currency (organizations.currency).';
comment on column public.athletes.licence_federation is 'Issuing federation / licensing system, free text.';

-- 2) One licence number per club ------------------------------------------------
create unique index if not exists uq_athletes_org_licence_number
  on public.athletes (org_id, licence_number)
  where licence_number is not null;

-- 3) Family postal code and city ---------------------------------------------------
alter table public.families add column if not exists postal_code text;
alter table public.families add column if not exists city        text;

do $$ begin
  alter table public.families add constraint families_postal_code_chk
    check (postal_code is null or char_length(postal_code) <= 12);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.families add constraint families_city_chk
    check (city is null or char_length(city) <= 80);
exception when duplicate_object then null; end $$;

comment on column public.families.postal_code is 'Postal code (NPA / PLZ / ZIP) of the family address; families.address is the street line.';
comment on column public.families.city is 'City / locality of the family address.';

-- 4) Licence fields are club-managed ---------------------------------------------
create or replace function public.athlete_licence_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_service_caller() or public.is_finance() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.licence_number is not null or new.licence_category is not null or new.licence_issued_on is not null
       or new.licence_fee is not null or new.licence_federation is not null then
      raise exception 'LICENCE_STAFF_ONLY' using errcode = '42501';
    end if;
  elsif (new.licence_number, new.licence_category, new.licence_issued_on, new.licence_fee, new.licence_federation)
        is distinct from
        (old.licence_number, old.licence_category, old.licence_issued_on, old.licence_fee, old.licence_federation) then
    raise exception 'LICENCE_STAFF_ONLY' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_athlete_licence_guard on public.athletes;
create trigger trg_athlete_licence_guard
  before insert or update of licence_number, licence_category, licence_issued_on, licence_fee, licence_federation
  on public.athletes
  for each row execute function public.athlete_licence_guard();

-- 5) Erasure clears the new personal fields ------------------------------------------
-- Body from 20250420101400_family_multi_club.sql plus postal_code / city and
-- the licence columns.
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
  v_unlinked  integer := 0;
  v_ath_ids   uuid[];
  v_med_ids   uuid[];
  v_reg_ids   uuid[];
  v_doc_ids   uuid[];
  v_paths     text[];
  v_photos    text[];
  v_audit     integer;
  v_multi     uuid[];
  r           record;
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
    set name = '[deleted]', address = null, postal_code = null, city = null,
        phone = null, contact_name = null, contact_email = null
    where id = p_family;

  update public.athletes
    set first_name = 'Redacted', last_name = 'Athlete', dob = '1900-01-01', nationality = null,
        school = null, notes = null, status = 'inactive', photo_path = null, photo_updated_at = null,
        licence_number = null, licence_category = null, licence_issued_on = null,
        licence_fee = null, licence_federation = null
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

  delete from public.scout_profiles where athlete_id = any(v_ath_ids);
  delete from public.placement_targets where athlete_id = any(v_ath_ids);
  delete from public.player_season_reviews where athlete_id = any(v_ath_ids);
  delete from public.carpool_offers where family_id = p_family;
  delete from public.carpool_requests where family_id = p_family;

  select coalesce(array_agg(id), '{}'), coalesce(array_agg(storage_path) filter (where storage_path is not null), '{}')
    into v_doc_ids, v_paths
    from public.documents
   where org_id = v_org and (family_id = p_family or athlete_id = any(v_ath_ids));
  delete from public.documents where id = any(v_doc_ids);

  -- Guardians who also belong to another club: unlink from this club only.
  select coalesce(array_agg(fm.profile_id), '{}') into v_multi
    from public.family_members fm
   where fm.family_id = p_family
     and exists (select 1 from public.org_memberships m
                  where m.profile_id = fm.profile_id and m.org_id <> v_org and m.status = 'active');
  for r in select unnest(v_multi) as pid loop
    delete from public.family_members where family_id = p_family and profile_id = r.pid;
    delete from public.staff_roles where org_id = v_org and profile_id = r.pid;
    delete from public.org_memberships where org_id = v_org and profile_id = r.pid;
    update public.profiles p
       set org_id = (select m.org_id from public.org_memberships m
                      where m.profile_id = r.pid and m.status = 'active' order by m.last_switched_at desc nulls last limit 1)
     where p.id = r.pid and p.org_id = v_org;
    v_unlinked := v_unlinked + 1;
  end loop;

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
    'profiles_unlinked', v_unlinked,
    'documents_deleted', coalesce(array_length(v_doc_ids, 1), 0),
    'audit_rows_redacted', v_audit,
    'storage_paths', to_jsonb(v_paths),
    'photo_paths', to_jsonb(v_photos)
  );
end $$;
