-- ============================================================================
-- Club OS — Public entry (club customers without an invitation) and
-- guardian consent for third-party bookings ("Someone else")
--
--   1. family_bootstrap(p_org_slug): a signed-in adult who came from a club
--      entry point (Book a camp / Book personal training / Join the club)
--      gets a GUEST family in that club (families.membership_status = 'guest')
--      with themselves as primary guardian, profiles.org_id when they had
--      none, and the parent org membership (existing trigger). The club is
--      resolved from its public slug server-side, never from a client org id.
--      Idempotent; grants nothing else (no membership, no team, no invoice).
--      handle_new_user() does the same at sign-up when the sign-up carries the
--      club slug in its metadata (club_slug) and no invitation exists.
--   2. register_public(): a signed-in caller (server-resolved profile, service
--      role only) reuses their own family (or a bootstrapped guest family) and
--      an existing child of that family (same normalised name + DOB) instead
--      of creating duplicates. Programmes with requires_club_approval refuse
--      the direct path (CLUB_APPROVAL_REQUIRED): the app routes a signed-in
--      family to club_request_submit(). Anonymous guests keep the old path
--      (family found by contact e-mail) for every other programme.
--   3. Third-party participants: a booker books for a child of ANOTHER family.
--        participant_bookers        (booker <-> athlete, scope 'status_only')
--        guardian_consent_requests  (hashed token, 72 h hold, status)
--      third_party_participant_create() creates the participant in a holding
--      GUEST family with no members (or, when the child already exists in the
--      club, targets that child without telling the booker), never adding the
--      booker to any family. third_party_camp_hold() / third_party_training_
--      request() create the booking as a hold (camp: registration 'pending',
--      training: booking 'requested' — both already count toward capacity)
--      marked guardian_consent_status = 'awaiting'. Nothing is invoiced,
--      confirmed or put on a roster while consent is awaited (guard triggers).
--   4. guardian_consent_view / _accept / _decline / _revoke / _expire. Accept
--      requires a signed-in account whose CONFIRMED auth e-mail equals the
--      e-mail the request was sent to (or, for an existing child, a guardian
--      of that child's family). Accept records consent_acceptances (+
--      parental_consents 'email_plus' where COPPA applies), makes the guardian
--      the child's primary guardian and lets the booking proceed under the
--      existing rules (camp: invoice to the booker / camp age approval;
--      training: request for the coach). Decline / expiry / revoke cancel the
--      held booking and free the place.
--   5. booker_booking_status(): whitelisted status rows for the booker only.
--
-- Every new table: org_id + index, RLS on every verb (writes through the
-- RPCs), restrictive tenant isolation, updated_at, audit trigger.
-- Additive and idempotent. SYNTHETIC DATA ONLY in tests.
-- ============================================================================
-- Notification type of the consent request e-mail (ADD VALUE commits on its own
-- under psql; the label is only used at run time, never in this file's DDL).
alter type public.notification_type add value if not exists 'guardian_consent_request';


-- ===========================================================================
-- 1) Columns on the held records
-- ===========================================================================
alter table public.registrations add column if not exists guardian_consent_status text;
alter table public.registrations add column if not exists guardian_consent_request_id uuid;
alter table public.training_bookings add column if not exists guardian_consent_status text;
alter table public.training_bookings add column if not exists guardian_consent_request_id uuid;

do $$ begin
  alter table public.registrations add constraint registrations_guardian_consent_chk
    check (guardian_consent_status is null or guardian_consent_status in ('awaiting', 'accepted', 'declined', 'expired', 'revoked'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.training_bookings add constraint training_bookings_guardian_consent_chk
    check (guardian_consent_status is null or guardian_consent_status in ('awaiting', 'accepted', 'declined', 'expired', 'revoked'));
exception when duplicate_object then null; end $$;
create index if not exists idx_registrations_gc_request on public.registrations(guardian_consent_request_id)
  where guardian_consent_request_id is not null;
create index if not exists idx_training_bookings_gc_request on public.training_bookings(guardian_consent_request_id)
  where guardian_consent_request_id is not null;

-- ===========================================================================
-- 2) Tables
-- ===========================================================================
create table if not exists public.participant_bookers (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  athlete_id    uuid not null references public.athletes(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  scope         text not null default 'status_only',
  relation      text not null default 'other',
  display_name  text not null,          -- what the booker typed (their own input)
  display_dob   date,                   -- what the booker typed
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint participant_bookers_scope_chk check (scope in ('status_only')),
  constraint participant_bookers_relation_chk check (relation in ('nephew_niece', 'friends_child', 'other')),
  constraint participant_bookers_name_chk check (length(btrim(display_name)) between 1 and 170),
  unique (athlete_id, profile_id)
);
create index if not exists idx_participant_bookers_org on public.participant_bookers(org_id);
create index if not exists idx_participant_bookers_profile on public.participant_bookers(profile_id);

create table if not exists public.guardian_consent_requests (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  athlete_id         uuid not null references public.athletes(id) on delete cascade,
  booker_profile_id  uuid not null references public.profiles(id) on delete cascade,
  guardian_name      text not null,
  guardian_email     citext not null,
  guardian_phone     text,
  relation           text not null default 'other',
  -- The child already existed in the club: the request goes to its existing
  -- guardians (never revealed to the booker).
  existing_child     boolean not null default false,
  token_hash         text,                -- sha-256 hex of the e-mailed token; the token itself is never stored
  token_issued_at    timestamptz,
  expires_at         timestamptz,         -- set when the first place is held (72 h)
  status             text not null default 'pending',
  registration_ids   uuid[] not null default '{}',
  booking_ids        uuid[] not null default '{}',
  order_ids          uuid[] not null default '{}',
  consent_forms      jsonb not null default '[]'::jsonb,  -- [{id,key,title,version,required}] at hold time
  accepted_keys      text[],
  accepted_by        uuid references public.profiles(id) on delete set null,
  accepted_at        timestamptz,
  declined_at        timestamptz,
  expired_at         timestamptz,
  revoked_at         timestamptz,
  outcome_notified_at timestamptz,
  request_id         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint guardian_consent_requests_status_chk check (status in ('pending', 'accepted', 'declined', 'expired', 'revoked')),
  constraint guardian_consent_requests_name_chk check (length(btrim(guardian_name)) between 1 and 140),
  constraint guardian_consent_requests_email_chk check (length(guardian_email) <= 254 and guardian_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint guardian_consent_requests_phone_chk check (guardian_phone is null or length(guardian_phone) <= 40),
  constraint guardian_consent_requests_token_chk check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  constraint guardian_consent_requests_relation_chk check (relation in ('nephew_niece', 'friends_child', 'other'))
);
create index if not exists idx_guardian_consent_requests_org on public.guardian_consent_requests(org_id, status, expires_at);
create index if not exists idx_guardian_consent_requests_booker on public.guardian_consent_requests(booker_profile_id);
create index if not exists idx_guardian_consent_requests_athlete on public.guardian_consent_requests(athlete_id);
create unique index if not exists guardian_consent_requests_token_uidx on public.guardian_consent_requests(token_hash) where token_hash is not null;
create unique index if not exists guardian_consent_requests_pending_uidx
  on public.guardian_consent_requests(athlete_id, booker_profile_id) where status = 'pending';

drop trigger if exists trg_participant_bookers_updated on public.participant_bookers;
create trigger trg_participant_bookers_updated before update on public.participant_bookers
  for each row execute function public.set_updated_at();
drop trigger if exists trg_guardian_consent_requests_updated on public.guardian_consent_requests;
create trigger trg_guardian_consent_requests_updated before update on public.guardian_consent_requests
  for each row execute function public.set_updated_at();

-- Personal data of minors and of a third adult: audited (token hash redacted).
drop trigger if exists trg_audit_participant_bookers on public.participant_bookers;
create trigger trg_audit_participant_bookers after insert or update or delete on public.participant_bookers
  for each row execute function public.ca_audit_trigger();
drop trigger if exists trg_audit_guardian_consent_requests on public.guardian_consent_requests;
create trigger trg_audit_guardian_consent_requests after insert or update or delete on public.guardian_consent_requests
  for each row execute function public.ca_audit_trigger('token_hash');

alter table public.participant_bookers enable row level security;
alter table public.participant_bookers force row level security;
alter table public.guardian_consent_requests enable row level security;
alter table public.guardian_consent_requests force row level security;

drop policy if exists platform_tenant_isolation on public.participant_bookers;
create policy platform_tenant_isolation on public.participant_bookers as restrictive for all
  using (org_id = (select public.current_org_id())) with check (org_id = (select public.current_org_id()));
drop policy if exists platform_tenant_isolation on public.guardian_consent_requests;
create policy platform_tenant_isolation on public.guardian_consent_requests as restrictive for all
  using (org_id = (select public.current_org_id())) with check (org_id = (select public.current_org_id()));

-- The booker reads their own booker rows; admins of the club read all.
drop policy if exists participant_bookers_select on public.participant_bookers;
create policy participant_bookers_select on public.participant_bookers for select
  using (profile_id = auth.uid() or (org_id = public.current_org_id() and public.is_admin()));
drop policy if exists participant_bookers_insert on public.participant_bookers;
create policy participant_bookers_insert on public.participant_bookers for insert with check (false);
drop policy if exists participant_bookers_update on public.participant_bookers;
create policy participant_bookers_update on public.participant_bookers for update using (false) with check (false);
drop policy if exists participant_bookers_delete on public.participant_bookers;
create policy participant_bookers_delete on public.participant_bookers for delete
  using (org_id = public.current_org_id() and public.is_admin());

-- Consent requests: admins only through the table (the booker and the
-- guardian go through the RPCs, which whitelist what each may see).
drop policy if exists guardian_consent_requests_select on public.guardian_consent_requests;
create policy guardian_consent_requests_select on public.guardian_consent_requests for select
  using (org_id = public.current_org_id() and public.is_admin());
drop policy if exists guardian_consent_requests_insert on public.guardian_consent_requests;
create policy guardian_consent_requests_insert on public.guardian_consent_requests for insert with check (false);
drop policy if exists guardian_consent_requests_update on public.guardian_consent_requests;
create policy guardian_consent_requests_update on public.guardian_consent_requests for update using (false) with check (false);
drop policy if exists guardian_consent_requests_delete on public.guardian_consent_requests;
create policy guardian_consent_requests_delete on public.guardian_consent_requests for delete using (false);

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, delete on public.participant_bookers to authenticated;
    grant select on public.guardian_consent_requests to authenticated;
    grant all on public.participant_bookers, public.guardian_consent_requests to service_role;
  end if;
end $$;

-- Consent hold window (hours). One place to change it.
create or replace function public.gc_hold_hours()
returns integer language sql immutable set search_path = public as $$ select 72 $$;

-- ===========================================================================
-- 3) Family bootstrap (club customers without an invitation)
-- ===========================================================================
-- Internal: the profile's family in the org, else a new guest family with the
-- profile as primary guardian. Sets profiles.org_id only when it is null.
create or replace function public.gc_family_bootstrap(p_profile uuid, p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fam uuid;
  p     public.profiles%rowtype;
begin
  if p_profile is null or p_org is null then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into p from public.profiles where id = p_profile;
  if not found then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if exists (select 1 from public.org_memberships m where m.profile_id = p_profile and m.org_id = p_org and m.status <> 'active') then
    raise exception 'MEMBERSHIP_SUSPENDED' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':family_bootstrap:' || p_profile::text, 0));

  select fm.family_id into v_fam
    from public.family_members fm join public.families f on f.id = fm.family_id
   where fm.profile_id = p_profile and f.org_id = p_org and coalesce(f.status, 'active') = 'active'
   order by fm.is_primary desc, fm.created_at
   limit 1;
  if v_fam is not null then
    update public.profiles set org_id = p_org where id = p_profile and org_id is null;
    return jsonb_build_object('family_id', v_fam, 'created', false);
  end if;

  insert into public.families (org_id, name, contact_name, contact_email, membership_status, primary_contact_id)
  values (p_org, left(coalesce(nullif(btrim(p.full_name), ''), split_part(p.email::text, '@', 1), 'Family'), 120),
          left(nullif(btrim(p.full_name), ''), 140), p.email, 'guest', p_profile)
  returning id into v_fam;
  insert into public.family_members (family_id, profile_id, relation, is_primary, receives_emails)
  values (v_fam, p_profile, 'guardian', true, true)
  on conflict (family_id, profile_id) do nothing;
  update public.profiles set org_id = p_org where id = p_profile and org_id is null;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (p_org, p_profile, 'family.bootstrap', 'families', v_fam, jsonb_build_object('membership_status', 'guest'));
  return jsonb_build_object('family_id', v_fam, 'created', true);
end $$;

-- Public club slug -> org (active / trial clubs only).
create or replace function public.gc_org_from_slug(p_slug text)
returns uuid language sql stable security definer set search_path = public as $$
  select o.id from public.organizations o
   where o.slug = lower(btrim(coalesce(p_slug, ''))) and coalesce(o.status, 'active') in ('active', 'trial')
   limit 1;
$$;

-- Signed-in adult from a club entry point. Org from the public slug only.
create or replace function public.family_bootstrap(p_org_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me  uuid := auth.uid();
  v_org uuid;
  v_res jsonb;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  v_org := public.gc_org_from_slug(p_org_slug);
  if v_org is null then raise exception 'CLUB_NOT_FOUND' using errcode = 'P0002'; end if;
  v_res := public.gc_family_bootstrap(v_me, v_org);
  return v_res || jsonb_build_object(
    'org_id', v_org,
    'is_current', (select org_id from public.profiles where id = v_me) = v_org,
    'guest', coalesce((select membership_status = 'guest' from public.families where id = (v_res->>'family_id')::uuid), false));
end $$;

-- handle_new_user(): body of 20250420104000_team_attendance.sql plus the club
-- entry point: no invitation + metadata club_slug -> guest family there.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invitations%rowtype;
  v_org uuid;
begin
  select * into v_inv
  from public.invitations
  where email = new.email
    and status = 'pending'
    and expires_at > now()
  order by created_at desc
  limit 1;

  insert into public.profiles (id, org_id, email, full_name, locale)
  values (
    new.id,
    v_inv.org_id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce(new.raw_user_meta_data->>'locale', 'en')
  )
  on conflict (id) do nothing;

  if v_inv.id is not null then
    if v_inv.role::text not in ('parent', 'player') then
      insert into public.staff_roles (org_id, profile_id, role)
      values (v_inv.org_id, new.id, v_inv.role)
      on conflict (org_id, profile_id, role) do nothing;
    end if;

    -- A player account: linked to its athlete (same club only).
    if v_inv.role::text = 'player' then
      perform public.ta_link_player(v_inv.athlete_id, new.id, v_inv.org_id);
    end if;

    if v_inv.family_id is not null
       and exists (select 1 from public.families where id = v_inv.family_id and org_id = v_inv.org_id) then
      insert into public.family_members (family_id, profile_id, relation, is_primary)
      values (
        v_inv.family_id,
        new.id,
        coalesce(v_inv.relation, 'guardian'),
        not exists (select 1 from public.family_members where family_id = v_inv.family_id)
      )
      on conflict (family_id, profile_id) do nothing;
    end if;

    if v_inv.coach_id is not null then
      update public.coaches set profile_id = new.id
       where id = v_inv.coach_id and org_id = v_inv.org_id;
    end if;

    update public.invitations
      set status = 'accepted', accepted_at = now(), accepted_by = new.id
      where id = v_inv.id;
  elsif nullif(btrim(coalesce(new.raw_user_meta_data->>'club_slug', '')), '') is not null then
    -- Club customer sign-up (Book a camp / training, Join the club): a guest
    -- family in that club. Never blocks the sign-up itself.
    begin
      v_org := public.gc_org_from_slug(new.raw_user_meta_data->>'club_slug');
      if v_org is not null then
        perform public.gc_family_bootstrap(new.id, v_org);
      end if;
    exception when others then
      null;
    end;
  end if;

  return new;
end;
$$;

-- ===========================================================================
-- 4) register_public(): no duplicates for a signed-in caller
-- ===========================================================================
-- Internal: the family + children of a signed-in caller for a public form.
-- Reuses the caller's family in the org (or bootstraps a guest family) and an
-- existing child of that family with the same normalised name + DOB.
create or replace function public.gc_resolve_children(p_profile uuid, p_org uuid, p_parent jsonb, p_children jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family uuid;
  v_child  jsonb;
  v_ath    uuid;
  v_dob    date;
  v_ids    uuid[] := '{}';
  v_new    boolean[] := '{}';
begin
  v_family := (public.gc_family_bootstrap(p_profile, p_org)->>'family_id')::uuid;
  update public.families set
    phone        = coalesce(phone, nullif(p_parent->>'phone', '')),
    address      = coalesce(address, nullif(p_parent->>'address', '')),
    contact_name = coalesce(contact_name, nullif(p_parent->>'name', ''))
  where id = v_family;
  for v_child in select * from jsonb_array_elements(coalesce(p_children, '[]'::jsonb))
  loop
    v_dob := nullif(v_child->>'dob', '')::date;
    if v_dob is null or v_dob >= current_date then raise exception 'INVALID_DOB' using errcode = 'P0001'; end if;
    select a.id into v_ath from public.athletes a
     where a.family_id = v_family and a.org_id = p_org and a.archived_at is null and a.status not in ('erased')
       and public.bk_norm(a.first_name) = public.bk_norm(v_child->>'first_name')
       and public.bk_norm(a.last_name) = public.bk_norm(v_child->>'last_name')
       and a.dob = v_dob
     order by a.created_at limit 1;
    if v_ath is null then
      insert into public.athletes (org_id, family_id, first_name, last_name, dob, gender, status)
      values (p_org, v_family, btrim(v_child->>'first_name'), btrim(v_child->>'last_name'), v_dob,
              nullif(v_child->>'gender', ''), 'active')
      returning id into v_ath;
      insert into public.athlete_medical (org_id, athlete_id, allergies, conditions, notes,
                                          emergency_contact_name, emergency_contact_phone)
      values (p_org, v_ath, nullif(v_child->>'allergies', ''), nullif(v_child->>'conditions', ''),
              nullif(v_child->>'medical_notes', ''),
              nullif(p_parent->>'emergency_name', ''), nullif(p_parent->>'emergency_phone', ''))
      on conflict (athlete_id) do nothing;
      v_new := v_new || true;
    else
      v_new := v_new || false;
    end if;
    v_ids := v_ids || v_ath;
  end loop;
  return jsonb_build_object('family_id', v_family, 'athlete_ids', to_jsonb(v_ids), 'created', to_jsonb(v_new));
end $$;

-- Service role (camp public checkout of a signed-in user): same resolution.
-- payload = { profile_id, program_id, parent:{...}, children:[{first_name,last_name,dob,gender,allergies,conditions,medical_notes}] }
create or replace function public.public_entry_resolve_children(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid; v_prof uuid;
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select org_id into v_org from public.programs where id = nullif(p_payload->>'program_id', '')::uuid;
  if v_org is null then raise exception 'PROGRAM_NOT_FOUND' using errcode = 'P0002'; end if;
  v_prof := nullif(p_payload->>'profile_id', '')::uuid;
  if v_prof is null or not exists (select 1 from public.profiles where id = v_prof) then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  return public.gc_resolve_children(v_prof, v_org, coalesce(p_payload->'parent', '{}'::jsonb), p_payload->'children');
end $$;

-- register_public(): body of 20250420095400_minors_privacy_fixes.sql plus
--   * requires_club_approval programmes: CLUB_APPROVAL_REQUIRED (the app
--     sends a signed-in family to club_request_submit());
--   * account_profile_id (honoured from the service role only, set by the
--     server action from the session): the caller's family and children are
--     reused (gc_resolve_children), no parent invitation is created.
create or replace function public.register_public(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_program  public.programs%rowtype;
  v_org      uuid;
  v_pct      numeric;
  v_price    numeric;
  v_email    citext;
  v_family   uuid;
  v_invoice  uuid;
  v_invnum   text;
  v_total    numeric := 0;
  v_child    jsonb;
  v_athlete  uuid;
  v_reg      uuid;
  v_idx      int := 0;
  v_disc     numeric;
  v_consent  text;
  v_form     record;
  v_ip       inet;
  v_reg_ids  uuid[] := '{}';
  v_ath_ids  uuid[] := '{}';
  v_children jsonb := coalesce(p_payload->'children', '[]'::jsonb);
  v_due      date := (now() + interval '14 days')::date;
  v_vpc      boolean;
  v_account  uuid;
  v_resolved jsonb;
  v_name     text;
begin
  -- Resolve + guard the program
  select * into v_program from public.programs where id = (p_payload->>'program_id')::uuid;
  if not found then raise exception 'PROGRAM_NOT_FOUND' using errcode = 'P0002'; end if;
  if not (v_program.is_public and v_program.is_active) then
    raise exception 'PROGRAM_NOT_OPEN' using errcode = 'P0001';
  end if;
  if coalesce(v_program.requires_club_approval, false) then
    raise exception 'CLUB_APPROVAL_REQUIRED' using errcode = 'P0001';
  end if;
  v_org   := v_program.org_id;
  v_price := v_program.price_chf;

  if jsonb_array_length(v_children) < 1 then
    raise exception 'NO_CHILDREN' using errcode = 'P0001';
  end if;

  -- COPPA gate: until the verifiable-parental-consent flow exists, a club
  -- that must obtain VPC does not take under-13s through online registration.
  v_vpc := public.org_requires_vpc(v_org);
  if v_vpc and exists (
    select 1 from jsonb_array_elements(v_children) c
     where nullif(c->>'dob', '')::date > (current_date - interval '13 years')
  ) then
    raise exception 'VPC_REQUIRED' using errcode = 'P0001';
  end if;

  v_email := nullif(p_payload->'parent'->>'email', '');
  if v_email is null then raise exception 'EMAIL_REQUIRED' using errcode = 'P0001'; end if;

  begin v_ip := nullif(p_payload->>'ip', '')::inet; exception when others then v_ip := null; end;
  if public.is_service_caller() then
    begin v_account := nullif(p_payload->>'account_profile_id', '')::uuid; exception when others then v_account := null; end;
  end if;

  -- Sibling-discount percentage (org setting; default 10%)
  select coalesce((settings->>'sibling_discount_pct')::numeric, 10)
    into v_pct from public.app_settings where org_id = v_org;
  v_pct := coalesce(v_pct, 10);

  if v_account is not null then
    -- Signed-in: their own family and children (no duplicates).
    v_resolved := public.gc_resolve_children(v_account, v_org, p_payload->'parent', v_children);
    v_family := (v_resolved->>'family_id')::uuid;
  else
    -- Find-or-create the family by contact email (lets a returning parent add a child)
    select id into v_family from public.families
      where org_id = v_org and contact_email = v_email limit 1;
    if v_family is null then
      insert into public.families (org_id, name, address, phone, contact_name, contact_email)
      values (
        v_org,
        coalesce(nullif(p_payload->>'family_name', ''), (p_payload->'parent'->>'name') || ' family'),
        nullif(p_payload->'parent'->>'address', ''),
        nullif(p_payload->'parent'->>'phone', ''),
        nullif(p_payload->'parent'->>'name', ''),
        v_email
      ) returning id into v_family;
    else
      update public.families set
        phone        = coalesce(nullif(p_payload->'parent'->>'phone', ''), phone),
        address      = coalesce(nullif(p_payload->'parent'->>'address', ''), address),
        contact_name = coalesce(nullif(p_payload->'parent'->>'name', ''), contact_name)
      where id = v_family;
    end if;
  end if;

  -- Invoice header (total filled after line items)
  v_invnum := public.next_invoice_number(v_org);
  insert into public.invoices (org_id, number, family_id, program_id, description, status, due_date)
  values (v_org, v_invnum, v_family, v_program.id, 'Registration — ' || v_program.name, 'sent', v_due)
  returning id into v_invoice;

  -- One athlete + medical + registration + fee line per child
  for v_child in select * from jsonb_array_elements(v_children)
  loop
    if v_account is not null then
      v_athlete := (v_resolved->'athlete_ids'->>v_idx)::uuid;
      if exists (select 1 from public.registrations where athlete_id = v_athlete and program_id = v_program.id
                  and camp_edition_id is null and status::text <> 'cancelled') then
        raise exception 'ALREADY_REGISTERED' using errcode = 'P0001';
      end if;
    else
      insert into public.athletes (org_id, family_id, first_name, last_name, dob, gender, status)
      values (v_org, v_family, v_child->>'first_name', v_child->>'last_name',
              (v_child->>'dob')::date, nullif(v_child->>'gender', ''), 'active')
      returning id into v_athlete;

      insert into public.athlete_medical (org_id, athlete_id, allergies, conditions, notes,
                                          emergency_contact_name, emergency_contact_phone)
      values (v_org, v_athlete, nullif(v_child->>'allergies', ''), nullif(v_child->>'conditions', ''),
              nullif(v_child->>'medical_notes', ''),
              nullif(p_payload->'parent'->>'emergency_name', ''),
              nullif(p_payload->'parent'->>'emergency_phone', ''))
      on conflict (athlete_id) do nothing;
    end if;

    begin
      insert into public.registrations (org_id, athlete_id, program_id, status, notes, registered_by)
      values (v_org, v_athlete, v_program.id, 'pending', null, v_account) -- medical notes live only in athlete_medical
      returning id into v_reg;
    exception when unique_violation then
      raise exception 'ALREADY_REGISTERED' using errcode = 'P0001';
    end;

    select btrim(first_name || ' ' || last_name) into v_name from public.athletes where id = v_athlete;
    insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
    values (v_org, v_invoice, v_program.name || ' — ' || v_name, 1, v_price, v_price);
    v_total := v_total + v_price;

    if v_idx >= 1 and v_pct > 0 then
      v_disc := round(v_price * v_pct / 100.0, 2);
      insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
      values (v_org, v_invoice, 'Sibling discount (' || v_pct || '%) — ' || (v_child->>'first_name'),
              1, -v_disc, -v_disc);
      v_total := v_total - v_disc;
    end if;

    v_reg_ids := v_reg_ids || v_reg;
    v_ath_ids := v_ath_ids || v_athlete;
    v_idx := v_idx + 1;
  end loop;

  update public.invoices set total_chf = v_total where id = v_invoice;

  -- Consent acceptances: each accepted key × each athlete (immutable audit row)
  if jsonb_typeof(p_payload->'consents') = 'array' then
    for v_consent in select jsonb_array_elements_text(p_payload->'consents')
    loop
      select id, version into v_form
        from public.consent_forms
        where org_id = v_org and key = v_consent and is_active
        order by version desc limit 1;
      if found then
        for v_athlete in select unnest(v_ath_ids)
        loop
          insert into public.consent_acceptances
            (org_id, athlete_id, consent_form_id, accepted_version, status, program_id, ip_address, accepted_by)
          values (v_org, v_athlete, v_form.id, v_form.version, 'accepted', v_program.id, v_ip, v_account);
        end loop;
      end if;
    end loop;
  end if;

  -- Pending parent invitation so they can later claim the account & become guardian
  if v_account is null and not exists (
    select 1 from public.invitations
    where org_id = v_org and email = v_email and status = 'pending'
  ) then
    insert into public.invitations (org_id, email, role, family_id, status, expires_at)
    values (v_org, v_email, 'parent', v_family, 'pending', now() + interval '30 days');
  end if;

  return jsonb_build_object(
    'family_id', v_family,
    'invoice_id', v_invoice,
    'invoice_number', v_invnum,
    'total_chf', v_total,
    'child_count', jsonb_array_length(v_children),
    'registration_ids', to_jsonb(v_reg_ids),
    'athlete_ids', to_jsonb(v_ath_ids)
  );
end;
$$;

-- ===========================================================================
-- 5) Guards: a held booking is never confirmed, invoiced or rostered while
--    the participant's guardian has not consented
-- ===========================================================================
create or replace function public.gc_registrations_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('app.gc_internal', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    if (new.guardian_consent_status is not null or new.guardian_consent_request_id is not null) and not public.is_service_caller() then
      raise exception 'CONSENT_LOCKED' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if (new.guardian_consent_status, new.guardian_consent_request_id)
     is distinct from (old.guardian_consent_status, old.guardian_consent_request_id) and not public.is_service_caller() then
    raise exception 'CONSENT_LOCKED' using errcode = 'P0001';
  end if;
  if old.guardian_consent_status = 'awaiting' and new.guardian_consent_status = 'awaiting'
     and (new.status::text in ('confirmed', 'completed', 'pending_approval', 'waitlist')
          or new.invoice_id is distinct from old.invoice_id) then
    raise exception 'CONSENT_PENDING' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_registrations_gc_guard on public.registrations;
create trigger trg_registrations_gc_guard before insert or update on public.registrations
  for each row execute function public.gc_registrations_guard();

create or replace function public.gc_bookings_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('app.gc_internal', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    if (new.guardian_consent_status is not null or new.guardian_consent_request_id is not null) and not public.is_service_caller() then
      raise exception 'CONSENT_LOCKED' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if (new.guardian_consent_status, new.guardian_consent_request_id)
     is distinct from (old.guardian_consent_status, old.guardian_consent_request_id) and not public.is_service_caller() then
    raise exception 'CONSENT_LOCKED' using errcode = 'P0001';
  end if;
  if old.guardian_consent_status = 'awaiting' and new.guardian_consent_status = 'awaiting'
     and (new.status::text in ('booked', 'completed', 'no_show') or new.invoice_id is distinct from old.invoice_id) then
    raise exception 'CONSENT_PENDING' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_training_bookings_gc_guard on public.training_bookings;
create trigger trg_training_bookings_gc_guard before insert or update on public.training_bookings
  for each row execute function public.gc_bookings_guard();

-- A consented camp registration invoiced to the booker is confirmed when paid
-- in full (as approved camp registrations, 20250420105100).
create or replace function public.invoices_gc_confirm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  for r in select id, org_id from public.registrations
            where invoice_id = new.id and org_id = new.org_id and guardian_consent_status = 'accepted'
              and status = 'pending' and approval_status is null
  loop
    update public.registrations set status = 'confirmed' where id = r.id;
    perform public.ca_audit(r.org_id, 'guardian_consent.confirmed_on_payment', 'registrations', r.id,
                            jsonb_build_object('invoice_id', new.id));
  end loop;
  return null;
end $$;
drop trigger if exists trg_invoices_gc_confirm on public.invoices;
create trigger trg_invoices_gc_confirm
  after update of status on public.invoices
  for each row
  when (new.status::text = 'paid' and old.status is distinct from new.status)
  execute function public.invoices_gc_confirm();

-- ===========================================================================
-- 6) Helpers
-- ===========================================================================
-- The caller's CONFIRMED sign-in e-mail (auth.users, never profiles.email,
-- which the user can edit).
create or replace function public.gc_auth_email()
returns citext language sql stable security definer set search_path = public, auth as $$
  select u.email::citext from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null;
$$;

create or replace function public.gc_is_booker(p_athlete uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.participant_bookers b
                  where b.athlete_id = p_athlete and b.profile_id = auth.uid() and b.org_id = public.current_org_id());
$$;

-- Masked e-mail for the consent page ("j***@example.com").
create or replace function public.gc_mask_email(p citext)
returns text language sql immutable set search_path = public as $$
  select case when p is null then null
              else left(split_part(p::text, '@', 1), 1) || '***@' || split_part(p::text, '@', 2) end;
$$;

-- Active consent forms of the club, latest version per key.
create or replace function public.gc_consent_forms(p_org uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'key', f.key, 'title', f.title, 'version', f.version,
                                               'required', f.is_required) order by f.key), '[]'::jsonb)
    from (select distinct on (key) id, key, title, version, is_required
            from public.consent_forms where org_id = p_org and is_active
           order by key, version desc) f;
$$;

-- The booker's payer record (billing_payers kind 'other', their own login).
create or replace function public.gc_booker_payer(p_org uuid, p_profile uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; p public.profiles%rowtype;
begin
  select id into v_id from public.billing_payers
   where org_id = p_org and profile_id = p_profile and kind = 'other' and is_active
   order by created_at limit 1;
  if v_id is not null then return v_id; end if;
  select * into p from public.profiles where id = p_profile;
  insert into public.billing_payers (org_id, kind, profile_id, name, email, created_by)
  values (p_org, 'other', p_profile, left(coalesce(nullif(btrim(p.full_name), ''), p.email::text, 'Payer'), 140),
          case when p.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then p.email end, p_profile)
  returning id into v_id;
  return v_id;
end $$;

-- Cancel the held items of a request (decline / expiry / revoke) and free the places.
create or replace function public.gc_cancel_items(p_request uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.guardian_consent_requests%rowtype; b record;
begin
  select * into r from public.guardian_consent_requests where id = p_request;
  perform set_config('app.gc_internal', 'on', true);
  perform set_config('app.bk_internal', 'on', true);
  update public.registrations
     set status = 'cancelled', cancelled_at = now(), cancellation_reason = left(p_reason, 500),
         guardian_consent_status = p_status
   where id = any(r.registration_ids) and org_id = r.org_id and status::text <> 'cancelled'
     and guardian_consent_status = 'awaiting';
  for b in select id, session_id from public.training_bookings
            where id = any(r.booking_ids) and org_id = r.org_id and status::text <> 'cancelled'
              and guardian_consent_status = 'awaiting' loop
    update public.training_bookings
       set status = 'cancelled', cancel_reason = left(p_reason, 500), cancelled_at = now(),
           guardian_consent_status = p_status, change_seq = change_seq + 1
     where id = b.id;
    if b.session_id is not null then perform public.bk_session_refresh(b.session_id); end if;
  end loop;
  perform set_config('app.bk_internal', '', true);
  perform set_config('app.gc_internal', '', true);
end $$;

-- Expire pending requests whose hold ran out (lazy on read + scheduled job).
-- A request that never held a place expires after the same window.
create or replace function public.gc_expire_due(p_request uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id, org_id from public.guardian_consent_requests
            where status = 'pending' and (p_request is null or id = p_request)
              and coalesce(expires_at, created_at + make_interval(hours => public.gc_hold_hours())) <= now()
            for update skip locked loop
    perform public.gc_cancel_items(r.id, 'expired', 'guardian consent expired');
    update public.guardian_consent_requests set status = 'expired', expired_at = now() where id = r.id;
    perform public.ca_audit(r.org_id, 'guardian_consent.expired', 'guardian_consent_requests', r.id, null);
    n := n + 1;
  end loop;
  return n;
end $$;

-- The pending request of (booker, athlete), else a new one from the last
-- guardian contact. Caller: the hold RPCs (already authorised).
create or replace function public.gc_open_request(p_org uuid, p_booker uuid, p_athlete uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; r public.guardian_consent_requests%rowtype;
begin
  perform public.gc_expire_due(null);
  select id into v_id from public.guardian_consent_requests
   where org_id = p_org and booker_profile_id = p_booker and athlete_id = p_athlete and status = 'pending'
   for update;
  if v_id is not null then return v_id; end if;
  select * into r from public.guardian_consent_requests
   where org_id = p_org and booker_profile_id = p_booker and athlete_id = p_athlete
   order by created_at desc limit 1;
  if r.id is null then raise exception 'NOT_A_THIRD_PARTY' using errcode = 'P0002'; end if;
  insert into public.guardian_consent_requests
    (org_id, athlete_id, booker_profile_id, guardian_name, guardian_email, guardian_phone, relation, existing_child)
  values (p_org, p_athlete, p_booker, r.guardian_name, r.guardian_email, r.guardian_phone, r.relation, r.existing_child)
  returning id into v_id;
  return v_id;
end $$;

-- Attach a held item to the request, (re)issue the token hash, start the hold.
create or replace function public.gc_attach(p_request uuid, p_kind text, p_item uuid, p_token_hash text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'TOKEN_REQUIRED' using errcode = 'P0001'; end if;
  update public.guardian_consent_requests
     set registration_ids = case when p_kind = 'registration' then array_append(registration_ids, p_item) else registration_ids end,
         booking_ids = case when p_kind = 'booking' then array_append(booking_ids, p_item) else booking_ids end,
         token_hash = p_token_hash, token_issued_at = now(),
         expires_at = coalesce(expires_at, now() + make_interval(hours => public.gc_hold_hours())),
         consent_forms = public.gc_consent_forms(org_id)
   where id = p_request and status = 'pending';
  if not found then raise exception 'CONSENT_NOT_PENDING' using errcode = 'P0001'; end if;
end $$;

-- Scheduled job (service role): expire due requests everywhere; returns the
-- requests whose outcome (declined / expired) is not yet notified.
create or replace function public.guardian_consent_expire()
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  n := public.gc_expire_due(null);
  return jsonb_build_object('expired', n, 'to_notify', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'org_id', org_id, 'status', status) order by updated_at)
      from public.guardian_consent_requests
     where status in ('declined', 'expired') and outcome_notified_at is null
       and (cardinality(registration_ids) > 0 or cardinality(booking_ids) > 0)), '[]'::jsonb));
end $$;

-- Service role: mark an outcome as notified (after the e-mails went out).
create or replace function public.guardian_consent_mark_notified(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  update public.guardian_consent_requests set outcome_notified_at = now() where id = p_request and outcome_notified_at is null;
end $$;

-- ===========================================================================
-- 7) Third-party participant ("Someone else")
--
-- payload = { first_name, last_name, dob, gender, guardian_name,
--             guardian_email, guardian_phone?, relation }
-- returns { ok, athlete_id, kind: other | child, status: awaiting_consent | ready, consent_request_id }
-- The response has the same shape whether or not the child already exists
-- in the club: no name, family, DOB or count of another family's record is
-- returned; the athlete id is opaque and opens nothing to the booker (RLS).
-- ===========================================================================
create or replace function public.third_party_participant_create(p_payload jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_org    uuid := public.current_org_id();
  v_rep    jsonb;
  v_first  text := btrim(coalesce(p_payload->>'first_name', ''));
  v_last   text := btrim(coalesce(p_payload->>'last_name', ''));
  v_gender text := lower(nullif(btrim(coalesce(p_payload->>'gender', '')), ''));
  v_gname  text := btrim(coalesce(p_payload->>'guardian_name', ''));
  v_gemail citext := nullif(lower(btrim(coalesce(p_payload->>'guardian_email', ''))), '');
  v_gphone text := nullif(btrim(coalesce(p_payload->>'guardian_phone', '')), '');
  v_rel    text := coalesce(nullif(p_payload->>'relation', ''), 'other');
  v_dob    date;
  v_own    uuid;
  v_ath    uuid;
  v_fam    uuid;
  v_exist  boolean := false;
  v_req    uuid;
  v_res    jsonb;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if v_org is null then raise exception 'NO_ORG' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  v_rep := public.bk_replay(p_request_id, 'tp_participant');
  if v_rep is not null then return v_rep; end if;

  if length(v_first) = 0 or length(v_first) > 80 or length(v_last) = 0 or length(v_last) > 80 then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001';
  end if;
  v_dob := public.participant_read_dob(p_payload, v_org);
  if v_gender is null or v_gender not in ('male', 'female') then raise exception 'INVALID_SEX' using errcode = 'P0001'; end if;
  if v_rel not in ('nephew_niece', 'friends_child', 'other') then raise exception 'INVALID_RELATION' using errcode = 'P0001'; end if;
  if length(v_gname) = 0 or length(v_gname) > 140 then raise exception 'GUARDIAN_NAME_REQUIRED' using errcode = 'P0001'; end if;
  if v_gemail is null or length(v_gemail) > 254 or v_gemail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'GUARDIAN_EMAIL_REQUIRED' using errcode = 'P0001';
  end if;
  if v_gphone is not null and length(v_gphone) > 40 then raise exception 'TOO_LONG' using errcode = 'P0001'; end if;
  if v_gemail = public.gc_auth_email() or v_gemail = (select email from public.profiles where id = v_me) then
    raise exception 'GUARDIAN_IS_BOOKER' using errcode = 'P0001';
  end if;

  -- The booker's own child: a normal family booking.
  select a.id into v_own from public.athletes a
    join public.family_members fm on fm.family_id = a.family_id and fm.profile_id = v_me
   where a.org_id = v_org and a.archived_at is null and a.status not in ('erased')
     and public.bk_norm(a.first_name) = public.bk_norm(v_first) and public.bk_norm(a.last_name) = public.bk_norm(v_last)
     and a.dob = v_dob
   limit 1;
  if v_own is not null then
    v_res := jsonb_build_object('ok', true, 'athlete_id', v_own, 'kind', 'child', 'status', 'ready', 'consent_request_id', null);
    return public.bk_remember(p_request_id, 'tp_participant', v_res);
  end if;

  -- Already booked by this booker (same typed identity): same participant.
  select b.athlete_id into v_ath from public.participant_bookers b
   where b.org_id = v_org and b.profile_id = v_me and b.display_dob = v_dob
     and public.bk_norm(b.display_name) = public.bk_norm(v_first || ' ' || v_last)
   limit 1;
  if v_ath is not null then
    select existing_child into v_exist from public.guardian_consent_requests
     where athlete_id = v_ath and booker_profile_id = v_me order by created_at desc limit 1;
    v_exist := coalesce(v_exist, false);
  else
    -- Private match: an existing child of the club is never duplicated.
    select m into v_ath from public.participant_matches(v_org, v_first, v_last, v_dob, v_me) m limit 1;
    if v_ath is not null then
      v_exist := true;
    else
      -- Holding guest family with NO members until the guardian consents.
      insert into public.families (org_id, name, contact_name, contact_email, phone, membership_status)
      values (v_org, left(v_gname, 120), v_gname, v_gemail, v_gphone, 'guest')
      returning id into v_fam;
      insert into public.athletes (org_id, family_id, first_name, last_name, dob, gender, status)
      values (v_org, v_fam, v_first, v_last, v_dob, v_gender, 'active')
      returning id into v_ath;
    end if;
  end if;

  insert into public.participant_bookers (org_id, athlete_id, profile_id, scope, relation, display_name, display_dob)
  values (v_org, v_ath, v_me, 'status_only', v_rel, left(v_first || ' ' || v_last, 170), v_dob)
  on conflict (athlete_id, profile_id) do update set relation = excluded.relation;

  perform public.gc_expire_due(null);
  select id into v_req from public.guardian_consent_requests
   where org_id = v_org and athlete_id = v_ath and booker_profile_id = v_me and status = 'pending';
  if v_req is null then
    insert into public.guardian_consent_requests
      (org_id, athlete_id, booker_profile_id, guardian_name, guardian_email, guardian_phone, relation, existing_child, request_id)
    values (v_org, v_ath, v_me, v_gname, v_gemail, v_gphone, v_rel, v_exist, p_request_id)
    returning id into v_req;
  else
    update public.guardian_consent_requests
       set guardian_name = v_gname, guardian_email = v_gemail, guardian_phone = v_gphone, relation = v_rel
     where id = v_req and token_hash is null;
  end if;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, v_me, 'participant.third_party', 'athletes', v_ath,
          jsonb_build_object('consent_request_id', v_req, 'existing_child', v_exist));

  v_res := jsonb_build_object('ok', true, 'athlete_id', v_ath, 'kind', 'other', 'status', 'awaiting_consent',
                              'consent_request_id', v_req);
  return public.bk_remember(p_request_id, 'tp_participant', v_res);
end $$;

-- The booker's third-party participants (only what the booker typed).
create or replace function public.booker_participants()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('athlete_id', b.athlete_id, 'name', b.display_name, 'dob', b.display_dob)
                            order by b.display_name), '[]'::jsonb)
    from public.participant_bookers b
   where b.profile_id = auth.uid() and b.org_id = public.current_org_id();
$$;

-- ===========================================================================
-- 8) Camp hold for a third-party participant
--
-- payload = { program_id, edition_id, athlete_id, age_group_id,
--             price_option_id, days:[date], token_hash }
-- One registration 'pending' (holds the place: capacity counts pending +
-- confirmed everywhere), registered_by = booker, NO invoice, consent awaited.
-- Age on the edition's first day: below the band / above the maximum is
-- refused; the approval band (e.g. 6-7) is held too and goes to camp age
-- approval once the guardian consents.
-- ===========================================================================
create or replace function public.third_party_camp_hold(p_payload jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  v_org     uuid := public.current_org_id();
  v_rep     jsonb;
  v_program public.programs%rowtype;
  v_edition public.camp_editions%rowtype;
  v_ath     public.athletes%rowtype;
  v_grp     public.camp_age_groups%rowtype;
  v_opt     public.camp_price_options%rowtype;
  v_age     int;
  v_band    text;
  v_taken   int;
  v_currency text;
  v_list    numeric;
  v_days    date[];
  v_req     uuid;
  v_reg     uuid;
  v_res     jsonb;
begin
  if v_me is null or v_org is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  v_rep := public.bk_replay(p_request_id, 'tp_camp_hold');
  if v_rep is not null then return v_rep; end if;
  if (p_payload->>'token_hash') is null or (p_payload->>'token_hash') !~ '^[0-9a-f]{64}$' then
    raise exception 'TOKEN_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_ath from public.athletes where id = nullif(p_payload->>'athlete_id', '')::uuid and org_id = v_org;
  if not found or not public.gc_is_booker(v_ath.id) or v_ath.archived_at is not null then
    raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_program from public.programs where id = nullif(p_payload->>'program_id', '')::uuid and org_id = v_org;
  if not found or v_program.kind <> 'camp' then raise exception 'PROGRAM_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_program.status <> 'published' then raise exception 'PROGRAM_NOT_OPEN' using errcode = 'P0001'; end if;
  if (v_program.registration_opens_at is not null and now() < v_program.registration_opens_at)
     or (v_program.registration_closes_at is not null and now() >= v_program.registration_closes_at) then
    raise exception 'REGISTRATION_CLOSED' using errcode = 'P0001';
  end if;

  -- Same lock as register_camp: holds and bookings of a week serialise.
  select * into v_edition from public.camp_editions
   where id = nullif(p_payload->>'edition_id', '')::uuid and program_id = v_program.id and org_id = v_org
   for update;
  if not found then raise exception 'EDITION_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_edition.status <> 'published' then raise exception 'EDITION_NOT_OPEN' using errcode = 'P0001'; end if;
  if (v_edition.registration_opens_at is not null and now() < v_edition.registration_opens_at)
     or (v_edition.registration_closes_at is not null and now() >= v_edition.registration_closes_at)
     or (v_edition.registration_closes_at is null and current_date > v_edition.starts_on) then
    raise exception 'REGISTRATION_CLOSED' using errcode = 'P0001';
  end if;

  v_age := public.camp_age_on_start(v_ath.dob, v_edition.starts_on);
  v_band := public.camp_age_band(v_age, v_program.min_age, v_program.max_age, v_program.approval_age_min, v_program.approval_age_max);
  if v_band in ('too_young', 'too_old') then raise exception 'AGE_OUT_OF_RANGE' using errcode = 'P0001'; end if;

  perform public.gc_expire_due(null);
  if exists (select 1 from public.registrations
              where athlete_id = v_ath.id and camp_edition_id = v_edition.id and status::text <> 'cancelled') then
    raise exception 'ALREADY_REGISTERED' using errcode = 'P0001';
  end if;
  if v_edition.capacity is not null then
    select count(*) into v_taken from public.registrations
     where camp_edition_id = v_edition.id and status in ('pending', 'confirmed');
    if v_taken + 1 > v_edition.capacity then raise exception 'EDITION_FULL' using errcode = 'P0001'; end if;
  end if;

  select * into v_grp from public.camp_age_groups
   where id = nullif(p_payload->>'age_group_id', '')::uuid and program_id = v_program.id and org_id = v_org and is_active;
  if not found then raise exception 'AGE_GROUP_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_opt from public.camp_price_options
   where id = nullif(p_payload->>'price_option_id', '')::uuid and program_id = v_program.id and org_id = v_org
     and is_active and (edition_id is null or edition_id = v_edition.id);
  if not found then raise exception 'PRICE_OPTION_NOT_FOUND' using errcode = 'P0002'; end if;
  v_currency := upper(coalesce(v_program.currency, public.org_currency(v_org)));
  if upper(coalesce(v_opt.currency, v_currency)) <> v_currency then raise exception 'CURRENCY_MISMATCH' using errcode = 'P0001'; end if;
  v_list := round(v_opt.price, public.currency_exponent(v_currency));
  select coalesce(array_agg(distinct x::date order by x::date), '{}') into v_days
    from jsonb_array_elements_text(coalesce(p_payload->'days', '[]'::jsonb)) x;
  if coalesce(array_length(v_days, 1), 0) <> v_opt.days_count
     or jsonb_array_length(coalesce(p_payload->'days', '[]'::jsonb)) <> v_opt.days_count
     or exists (select 1 from unnest(v_days) x where x < v_edition.starts_on or x > v_edition.ends_on) then
    raise exception 'INVALID_DAYS' using errcode = 'P0001';
  end if;

  v_req := public.gc_open_request(v_org, v_me, v_ath.id);
  -- A cancelled row of this week without an invoice makes way (one row per child and week).
  delete from public.registrations
   where athlete_id = v_ath.id and camp_edition_id = v_edition.id and status = 'cancelled' and invoice_id is null;

  perform set_config('app.camp_pricing', 'on', true);
  perform set_config('app.camp_approval', 'on', true);
  perform set_config('app.gc_internal', 'on', true);
  insert into public.registrations
    (org_id, athlete_id, program_id, status, registered_by, camp_edition_id, camp_price_option_id, camp_age_group_id,
     camp_days, camp_includes_lunch, price_list_amount, price_discount_amount, price_amount, price_currency, price_snapshot,
     guardian_consent_status, guardian_consent_request_id)
  values
    (v_org, v_ath.id, v_program.id, 'pending', v_me, v_edition.id, v_opt.id, v_grp.id,
     v_days, v_opt.includes_lunch, v_list, 0, v_list, v_currency,
     jsonb_build_object(
       'program', v_program.name, 'edition_id', v_edition.id, 'edition_name', v_edition.name,
       'starts_on', v_edition.starts_on, 'ends_on', v_edition.ends_on,
       'option_id', v_opt.id, 'option_label', v_opt.label, 'days_count', v_opt.days_count,
       'includes_lunch', v_opt.includes_lunch, 'age_group', v_grp.label, 'days', to_jsonb(v_days),
       'currency', v_currency, 'list_amount', v_list, 'discount_amount', 0, 'amount', v_list,
       'discounts', '[]'::jsonb, 'source', 'third_party', 'age_band', v_band, 'priced_at', now()),
     'awaiting', v_req)
  returning id into v_reg;
  perform set_config('app.gc_internal', '', true);
  perform set_config('app.camp_approval', 'off', true);
  perform set_config('app.camp_pricing', 'off', true);

  perform public.gc_attach(v_req, 'registration', v_reg, p_payload->>'token_hash');
  perform public.ca_audit(v_org, 'guardian_consent.camp_hold', 'registrations', v_reg,
                          jsonb_build_object('consent_request_id', v_req, 'edition_id', v_edition.id, 'age_band', v_band));
  v_res := jsonb_build_object('ok', true, 'registration_id', v_reg, 'consent_request_id', v_req, 'status', 'awaiting_consent',
                              'age_band', v_band,
                              'expires_at', (select expires_at from public.guardian_consent_requests where id = v_req));
  return public.bk_remember(p_request_id, 'tp_camp_hold', v_res);
end $$;

-- ===========================================================================
-- 9) Training request for a third-party participant
-- ===========================================================================
-- bk_family_guard (20250420104700) plus: inside the third-party RPCs
-- (app.gc_third_party), the booker of the participant passes the guard.
create or replace function public.bk_family_guard(p_org uuid, x jsonb, out a public.athletes, out s public.training_services)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_org is null then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into a from public.athletes where id = (x->>'athlete_id')::uuid and org_id = p_org;
  if not found or not (public.is_guardian_of_athlete(a.id)
                       or (public.billing_flag_on('app.gc_third_party') and public.gc_is_booker(a.id))) then
    raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if a.archived_at is not null then raise exception 'ATHLETE_ARCHIVED' using errcode = 'P0001'; end if;
  if not (public.bk_settings(p_org)->>'bookings_enabled')::boolean then raise exception 'BOOKINGS_DISABLED' using errcode = 'P0001'; end if;
  select * into s from public.training_services where id = (x->>'service_id')::uuid and org_id = p_org and is_active and bookable_by_families;
  if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002'; end if;
  if (x->>'session_id') is null and (x->>'starts_at') is null then raise exception 'INVALID_TIME' using errcode = 'P0001'; end if;
  if (x->>'session_id') is null and (x->>'starts_at')::timestamptz <= now() then raise exception 'SLOT_IN_PAST' using errcode = 'P0001'; end if;
  if length(coalesce(x->>'notes', '')) > 1000 then raise exception 'NOTE_TOO_LONG' using errcode = 'P0001'; end if;
end $$;

-- Quote for the booker (writes nothing; no promo codes).
create or replace function public.third_party_training_quote(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.gc_is_booker(nullif(p_payload->>'athlete_id', '')::uuid) then
    raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform set_config('app.gc_third_party', 'on', true);
  v := public.booking_family_quote(coalesce(p_payload, '{}'::jsonb) - 'promo_code');
  perform set_config('app.gc_third_party', '', true);
  -- The booker pays by invoice: a package of the child's family never covers it.
  if v->'billing'->>'billing_mode' = 'package' then
    v := jsonb_set(v, '{billing}', (v->'billing') || jsonb_build_object(
           'billing_mode', 'invoice', 'price', v->'billing'->'list_price', 'package_remaining', 0));
  end if;
  return v;
end $$;

-- payload = booking_family_request payload (athlete_id, service_id, coach_id?,
--           session_id?, starts_at?, notes?) + token_hash.
-- Always 'requested' (counts toward the session's capacity); the booker is
-- the payer (billing_payers kind 'other'); staff cannot confirm it before the
-- guardian consents (guard); staff are notified once the guardian consented.
create or replace function public.third_party_training_request(p_payload jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me  uuid := auth.uid();
  v_org uuid := public.current_org_id();
  x jsonb;
  g record; v_rep jsonb; v_bid uuid; v_eval jsonb; v_bill jsonb; v_code text; v_place jsonb; v_res jsonb; v_req uuid;
begin
  if v_me is null or v_org is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  v_rep := public.bk_replay(p_request_id, 'tp_training_request');
  if v_rep is not null then return v_rep; end if;
  if not public.gc_is_booker(nullif(p_payload->>'athlete_id', '')::uuid) then
    raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if (p_payload->>'token_hash') is null or (p_payload->>'token_hash') !~ '^[0-9a-f]{64}$' then
    raise exception 'TOKEN_REQUIRED' using errcode = 'P0001';
  end if;
  x := public.bk_read_payload(jsonb_build_object(
         'athlete_id', p_payload->>'athlete_id', 'service_id', p_payload->>'service_id', 'coach_id', p_payload->>'coach_id',
         'session_id', p_payload->>'session_id', 'starts_at', p_payload->>'starts_at', 'billing', 'invoice',  -- never the child's family's package
         'notes', p_payload->>'notes', 'notify', true,
         'payer_id', public.gc_booker_payer(v_org, v_me)));

  perform set_config('app.gc_third_party', 'on', true);
  select * into g from public.bk_family_guard(v_org, x);
  perform set_config('app.gc_third_party', '', true);
  select id into v_bid from public.training_bookings where org_id = v_org and request_id = p_request_id;
  if v_bid is not null then raise exception 'REQUEST_ID_REUSED' using errcode = 'P0001'; end if;
  v_req := public.gc_open_request(v_org, v_me, (g.a).id);

  perform set_config('app.bk_internal', 'on', true);
  perform set_config('app.bk_family_request', 'on', true);
  v_eval := public.bk_family_evaluate(v_org, (g.a).id, g.s, x);
  v_code := public.bk_first_error(v_eval);
  if v_code is not null then raise exception '%', v_code using errcode = 'P0001'; end if;
  perform 1 from public.coaches where id = (v_eval->>'coach_id')::uuid and org_id = v_org for update;
  v_eval := public.bk_evaluate(v_org, (g.a).id, g.s, (v_eval->>'coach_id')::uuid, (v_eval->>'starts_at')::timestamptz,
                               (x->>'session_id')::uuid, null, false, null);
  perform set_config('app.bk_family_request', '', true);
  v_code := public.bk_first_error(v_eval);
  if v_code is not null then raise exception '%', v_code using errcode = 'P0001'; end if;
  v_bill := public.bk_billing_quote(v_org, (g.a).id, g.s, x, (v_eval->>'starts_at')::timestamptz, false);
  v_code := public.bk_first_error(v_bill);
  if v_code is not null then raise exception '%', v_code using errcode = 'P0001'; end if;

  v_place := public.bk_place(v_org, g.a, g.s, x, v_eval, v_bill, 'requested', 'family', p_request_id, false);
  v_bid := (v_place->>'booking_id')::uuid;
  perform set_config('app.gc_internal', 'on', true);
  update public.training_bookings set guardian_consent_status = 'awaiting', guardian_consent_request_id = v_req where id = v_bid;
  perform set_config('app.gc_internal', '', true);
  perform set_config('app.bk_internal', '', true);
  perform public.gc_attach(v_req, 'booking', v_bid, p_payload->>'token_hash');
  perform public.ca_audit(v_org, 'guardian_consent.training_hold', 'training_bookings', v_bid,
                          jsonb_build_object('consent_request_id', v_req));

  v_res := jsonb_build_object('ok', true, 'booking_id', v_bid, 'status', 'requested', 'consent', 'awaiting',
                              'consent_request_id', v_req, 'starts_at', v_place->'starts_at', 'ends_at', v_place->'ends_at',
                              'billing_mode', v_bill->>'billing_mode', 'price', v_bill->'price', 'currency', v_bill->>'currency',
                              'expires_at', (select expires_at from public.guardian_consent_requests where id = v_req));
  return public.bk_remember(p_request_id, 'tp_training_request', v_res);
end $$;

-- ===========================================================================
-- 10) The guardian: view, accept, decline (token from the e-mail)
-- ===========================================================================
create or replace function public.gc_items(r public.guardian_consent_requests)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_agg(x order by x->>'sort') from (
      select jsonb_build_object('kind', 'camp', 'id', g.id, 'activity', p.name, 'edition', e.name,
                                'starts_on', e.starts_on, 'ends_on', e.ends_on, 'status', g.status::text,
                                'consent', g.guardian_consent_status, 'sort', e.starts_on::text) x
        from public.registrations g
        join public.programs p on p.id = g.program_id
        left join public.camp_editions e on e.id = g.camp_edition_id
       where g.id = any(r.registration_ids) and g.org_id = r.org_id
      union all
      select jsonb_build_object('kind', 'training', 'id', b.id, 'activity', s.name,
                                'starts_at', b.slot_start, 'ends_at', b.slot_end, 'status', b.status::text,
                                'consent', b.guardian_consent_status, 'sort', b.slot_start::text)
        from public.training_bookings b
        join public.training_services s on s.id = b.service_id
       where b.id = any(r.booking_ids) and b.org_id = r.org_id) t), '[]'::jsonb);
$$;

-- What the consent page shows to the holder of the e-mailed link (anon or
-- signed in): the club, the activity and dates, who booked, the required
-- forms. Never the child's DOB, medical data or the booker's contact.
create or replace function public.guardian_consent_view(p_token_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare r public.guardian_consent_requests%rowtype; a public.athletes%rowtype; o public.organizations%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('found', false); end if;
  select * into r from public.guardian_consent_requests where token_hash = p_token_hash;
  if not found then return jsonb_build_object('found', false); end if;
  perform public.gc_expire_due(r.id);
  select * into r from public.guardian_consent_requests where id = r.id;
  select * into a from public.athletes where id = r.athlete_id;
  select * into o from public.organizations where id = r.org_id;
  return jsonb_build_object(
    'found', true, 'status', r.status, 'expires_at', r.expires_at,
    'club', jsonb_build_object('name', o.name, 'slug', o.slug),
    'participant', jsonb_build_object('first_name', a.first_name, 'last_name', a.last_name),
    'booker_name', (select full_name from public.profiles where id = r.booker_profile_id),
    'relation', r.relation, 'guardian_name', r.guardian_name,
    'verification', case when r.existing_child then 'family' else 'email' end,
    'email_hint', case when r.existing_child then null else public.gc_mask_email(r.guardian_email) end,
    'items', public.gc_items(r),
    'forms', coalesce((select jsonb_agg(jsonb_build_object('key', f->>'key', 'title', f->>'title', 'version', (f->>'version')::int,
                                                           'required', (f->>'required')::boolean,
                                                           'body', (select cf.body from public.consent_forms cf where cf.id = (f->>'id')::uuid))
                                        order by f->>'key')
                         from jsonb_array_elements(r.consent_forms) f), '[]'::jsonb));
end $$;

-- Accept (signed-in guardian). Verification: the caller's confirmed sign-in
-- e-mail is the e-mail the request was sent to; for a child who already
-- existed in the club, the caller is a guardian of that child's family.
-- payload = { accepted_keys: [key] } (every required form must be accepted).
create or replace function public.guardian_consent_accept(p_token_hash text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  r       public.guardian_consent_requests%rowtype;
  a       public.athletes%rowtype;
  v_keys  text[];
  v_gfam  uuid;
  v_hold  uuid;
  f       jsonb;
  g       public.registrations%rowtype;
  v_prog  public.programs%rowtype;
  v_ed    public.camp_editions%rowtype;
  v_band  text;
  v_age   int;
  v_inv   uuid;
  v_invnum text;
  v_desc  text;
  v_payer uuid;
  v_bname text;
  v_first_program uuid;
  b       record;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into r from public.guardian_consent_requests where token_hash = p_token_hash for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.gc_expire_due(r.id);
  select * into r from public.guardian_consent_requests where id = r.id;

  if r.status = 'accepted' and r.accepted_by = v_me then
    return jsonb_build_object('ok', true, 'replayed', true, 'status', 'accepted', 'org_id', r.org_id, 'request_id', r.id,
                              'club_slug', (select slug from public.organizations where id = r.org_id),
                              'is_current_org', (select org_id from public.profiles where id = v_me) = r.org_id,
                              'items', public.gc_items(r));
  end if;
  if r.status = 'expired' then raise exception 'EXPIRED' using errcode = 'P0001'; end if;
  if r.status <> 'pending' then raise exception 'CONSENT_NOT_PENDING' using errcode = 'P0001'; end if;
  if v_me = r.booker_profile_id then raise exception 'BOOKER_CANNOT_CONSENT' using errcode = '42501'; end if;

  select * into a from public.athletes where id = r.athlete_id and org_id = r.org_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if r.existing_child then
    if not exists (select 1 from public.family_members fm where fm.family_id = a.family_id and fm.profile_id = v_me) then
      raise exception 'NOT_GUARDIAN' using errcode = '42501';
    end if;
  elsif public.gc_auth_email() is distinct from r.guardian_email then
    raise exception 'EMAIL_MISMATCH' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct k), '{}') into v_keys
    from jsonb_array_elements_text(coalesce(p_payload->'accepted_keys', '[]'::jsonb)) k;
  if exists (select 1 from jsonb_array_elements(r.consent_forms) f2
              where (f2->>'required')::boolean and not ((f2->>'key') = any(v_keys))) then
    raise exception 'CONSENT_REQUIRED' using errcode = 'P0001';
  end if;

  -- The guardian becomes the child's guardian (never the booker).
  if not r.existing_child then
    v_hold := a.family_id;
    select fm.family_id into v_gfam
      from public.family_members fm join public.families fa on fa.id = fm.family_id
     where fm.profile_id = v_me and fa.org_id = r.org_id and fa.id <> v_hold and coalesce(fa.status, 'active') = 'active'
     order by fm.is_primary desc, fm.created_at limit 1;
    if v_gfam is not null then
      -- Already a family in this club: the child joins it (no second family).
      update public.athletes set family_id = v_gfam where id = a.id;
      if not exists (select 1 from public.athletes where family_id = v_hold)
         and not exists (select 1 from public.family_members where family_id = v_hold)
         and not exists (select 1 from public.invoices where family_id = v_hold) then
        delete from public.families where id = v_hold;
      end if;
    else
      insert into public.family_members (family_id, profile_id, relation, is_primary, can_pay, can_see_medical, receives_emails)
      values (v_hold, v_me, 'guardian', true, true, true, true)
      on conflict (family_id, profile_id) do update set is_primary = true, receives_emails = true;
      update public.families set primary_contact_id = coalesce(primary_contact_id, v_me) where id = v_hold;
    end if;
    update public.profiles set org_id = r.org_id where id = v_me and org_id is null;
    select * into a from public.athletes where id = a.id;
  end if;

  -- Consent forms accepted for this child.
  select program_id into v_first_program from public.registrations where id = any(r.registration_ids) order by created_at limit 1;
  for f in select * from jsonb_array_elements(r.consent_forms) loop
    if (f->>'key') = any(v_keys) then
      insert into public.consent_acceptances (org_id, athlete_id, consent_form_id, accepted_version, status, program_id, accepted_by)
      values (r.org_id, a.id, (f->>'id')::uuid, (f->>'version')::int, 'accepted', v_first_program, v_me);
    end if;
  end loop;
  -- COPPA (US clubs, under 13): verifiable parental consent, e-mail plus method.
  if public.org_requires_vpc(r.org_id) and a.dob > (current_date - interval '13 years') then
    insert into public.parental_consents (org_id, athlete_id, guardian_profile_id, guardian_name, guardian_email, method, status,
                                          verified_at, verified_by, evidence_reference)
    values (r.org_id, a.id, v_me, r.guardian_name, coalesce(public.gc_auth_email(), r.guardian_email), 'email_plus', 'verified',
            now(), v_me, 'guardian_consent_request:' || r.id::text);
  end if;

  -- The held bookings proceed under the existing rules.
  v_payer := public.gc_booker_payer(r.org_id, r.booker_profile_id);
  select full_name into v_bname from public.profiles where id = r.booker_profile_id;
  perform set_config('app.gc_internal', 'on', true);
  perform set_config('app.camp_pricing', 'on', true);
  perform set_config('app.camp_approval', 'on', true);
  for g in select * from public.registrations
            where id = any(r.registration_ids) and org_id = r.org_id and guardian_consent_status = 'awaiting'
              and status = 'pending' for update loop
    select * into v_prog from public.programs where id = g.program_id;
    select * into v_ed from public.camp_editions where id = g.camp_edition_id;
    v_age := public.camp_age_on_start(a.dob, v_ed.starts_on);
    v_band := public.camp_age_band(v_age, v_prog.min_age, v_prog.max_age, v_prog.approval_age_min, v_prog.approval_age_max);
    if v_band = 'approval' then
      -- Camp age approval (existing workflow; admins decide).
      update public.registrations
         set status = 'pending_approval', approval_status = 'pending', approval_request_id = gen_random_uuid(),
             approval_requested_at = now(), approval_age = v_age, guardian_consent_status = 'accepted'
       where id = g.id;
    elsif v_band in ('too_young', 'too_old') then
      update public.registrations
         set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'AGE_OUT_OF_RANGE', guardian_consent_status = 'accepted'
       where id = g.id;
    elsif coalesce(g.price_amount, 0) > 0 then
      -- Existing reservation rule: 'pending' with an issued camp invoice,
      -- addressed to the booker (payer), until paid in full.
      v_invnum := public.next_invoice_number(r.org_id);
      insert into public.invoices (org_id, number, family_id, athlete_id, program_id, registration_id, description, status,
                                   due_date, currency, total_chf, payer_id, payer_kind, payer_profile_id, payer_name)
      values (r.org_id, v_invnum, a.family_id, a.id, g.program_id, g.id, left(v_prog.name, 500), 'sent',
              public.ca_org_today(r.org_id) + 14, g.price_currency, g.price_amount, v_payer, 'other', r.booker_profile_id,
              left(v_bname, 140))
      returning id into v_inv;
      v_desc := v_prog.name || coalesce(' — ' || (g.price_snapshot->>'option_label'), '') || ' — ' || a.first_name || ' ' || a.last_name;
      insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
      values (r.org_id, v_inv, left(v_desc, 500), 1, g.price_list_amount, g.price_list_amount);
      update public.registrations set invoice_id = v_inv, guardian_consent_status = 'accepted' where id = g.id;
    else
      update public.registrations set status = 'confirmed', guardian_consent_status = 'accepted' where id = g.id;
    end if;
  end loop;
  perform set_config('app.camp_approval', 'off', true);
  perform set_config('app.camp_pricing', 'off', true);
  perform set_config('app.bk_internal', 'on', true);
  for b in select id from public.training_bookings
            where id = any(r.booking_ids) and org_id = r.org_id and guardian_consent_status = 'awaiting' loop
    update public.training_bookings set guardian_consent_status = 'accepted' where id = b.id;
    perform public.bk_enqueue_notifications(b.id, 'requested');
  end loop;
  perform set_config('app.bk_internal', '', true);
  perform set_config('app.gc_internal', '', true);

  update public.guardian_consent_requests
     set status = 'accepted', accepted_by = v_me, accepted_at = now(), accepted_keys = v_keys
   where id = r.id;
  perform public.ca_audit(r.org_id, 'guardian_consent.accepted', 'guardian_consent_requests', r.id,
                          jsonb_build_object('athlete_id', a.id, 'keys', to_jsonb(v_keys), 'existing_child', r.existing_child));
  select * into r from public.guardian_consent_requests where id = r.id;
  return jsonb_build_object('ok', true, 'replayed', false, 'status', 'accepted', 'org_id', r.org_id, 'request_id', r.id,
                            'club_slug', (select slug from public.organizations where id = r.org_id),
                            'is_current_org', (select org_id from public.profiles where id = v_me) = r.org_id,
                            'items', public.gc_items(r));
end $$;

-- Decline (holder of the e-mailed link; no account needed): the held places are freed.
create or replace function public.guardian_consent_decline(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.guardian_consent_requests%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into r from public.guardian_consent_requests where token_hash = p_token_hash for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.gc_expire_due(r.id);
  select * into r from public.guardian_consent_requests where id = r.id;
  if r.status = 'declined' then return jsonb_build_object('ok', true, 'replayed', true, 'status', 'declined'); end if;
  if r.status = 'expired' then raise exception 'EXPIRED' using errcode = 'P0001'; end if;
  if r.status <> 'pending' then raise exception 'CONSENT_NOT_PENDING' using errcode = 'P0001'; end if;
  if auth.uid() is not null and auth.uid() = r.booker_profile_id then raise exception 'BOOKER_CANNOT_CONSENT' using errcode = '42501'; end if;
  perform public.gc_cancel_items(r.id, 'declined', 'guardian declined');
  update public.guardian_consent_requests set status = 'declined', declined_at = now() where id = r.id;
  perform public.ca_audit(r.org_id, 'guardian_consent.declined', 'guardian_consent_requests', r.id, null);
  return jsonb_build_object('ok', true, 'replayed', false, 'status', 'declined', 'request_id', r.id, 'org_id', r.org_id);
end $$;

-- The booker withdraws a pending request (frees the held places).
create or replace function public.guardian_consent_revoke(p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.guardian_consent_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select * into r from public.guardian_consent_requests
   where id = p_request and booker_profile_id = auth.uid() and org_id = public.current_org_id() for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if r.status = 'revoked' then return jsonb_build_object('ok', true, 'replayed', true, 'status', 'revoked'); end if;
  if r.status <> 'pending' then raise exception 'CONSENT_NOT_PENDING' using errcode = 'P0001'; end if;
  perform public.gc_cancel_items(r.id, 'revoked', 'withdrawn by booker');
  update public.guardian_consent_requests set status = 'revoked', revoked_at = now(), outcome_notified_at = now() where id = r.id;
  perform public.ca_audit(r.org_id, 'guardian_consent.revoked', 'guardian_consent_requests', r.id, null);
  return jsonb_build_object('ok', true, 'replayed', false, 'status', 'revoked');
end $$;

-- A camp registration of a consented third-party booking invoiced later (camp
-- age approval approved by an admin) is billed to the booker as well.
create or replace function public.gc_registrations_payer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_payer uuid;
begin
  if new.guardian_consent_status = 'accepted' and new.invoice_id is not null and old.invoice_id is null
     and new.registered_by is not null
     and exists (select 1 from public.participant_bookers pb
                  where pb.athlete_id = new.athlete_id and pb.profile_id = new.registered_by and pb.org_id = new.org_id) then
    v_payer := public.gc_booker_payer(new.org_id, new.registered_by);
    update public.invoices
       set payer_id = v_payer, payer_kind = 'other', payer_profile_id = new.registered_by,
           payer_name = left((select full_name from public.profiles where id = new.registered_by), 140)
     where id = new.invoice_id and org_id = new.org_id and payer_profile_id is null;
  end if;
  return null;
end $$;
drop trigger if exists trg_registrations_gc_payer on public.registrations;
create trigger trg_registrations_gc_payer after update of invoice_id on public.registrations
  for each row execute function public.gc_registrations_payer();

-- ===========================================================================
-- 11) The booker's view: status only (whitelisted fields)
-- ===========================================================================
create or replace function public.booker_booking_status()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid(); v_org uuid := public.current_org_id(); q record;
begin
  if v_me is null or v_org is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  for q in select id from public.guardian_consent_requests
            where booker_profile_id = v_me and org_id = v_org and status = 'pending' loop
    perform public.gc_expire_due(q.id);
  end loop;
  return coalesce((
    select jsonb_agg(x order by x->>'sort' desc) from (
      select jsonb_build_object(
               'consent_request_id', c.id, 'kind', 'camp', 'item_id', g.id,
               'participant_name', pb.display_name, 'activity', p.name, 'edition', e.name,
               'starts_on', e.starts_on, 'ends_on', e.ends_on, 'starts_at', null, 'ends_at', null,
               'status', g.status::text, 'consent', g.guardian_consent_status, 'camp_approval', g.approval_status,
               'consent_expires_at', case when c.status = 'pending' then c.expires_at end,
               'invoice', case when i.id is not null then jsonb_build_object(
                            'number', i.number, 'status', i.status::text, 'currency', i.currency,
                            'total', i.total_chf + coalesce(i.adjustments_total, 0),
                            'balance', i.total_chf + coalesce(i.adjustments_total, 0) - public.invoice_net_paid(i.id)) end,
               'sort', coalesce(e.starts_on::text, g.created_at::text)) x
        from public.guardian_consent_requests c
        join public.registrations g on g.id = any(c.registration_ids) and g.org_id = c.org_id
        join public.programs p on p.id = g.program_id
        left join public.camp_editions e on e.id = g.camp_edition_id
        join public.participant_bookers pb on pb.athlete_id = c.athlete_id and pb.profile_id = c.booker_profile_id
        left join public.invoices i on i.id = g.invoice_id and i.payer_profile_id = v_me
       where c.booker_profile_id = v_me and c.org_id = v_org
      union all
      select jsonb_build_object(
               'consent_request_id', c.id, 'kind', 'training', 'item_id', b.id,
               'participant_name', pb.display_name, 'activity', s.name, 'edition', null,
               'starts_on', null, 'ends_on', null, 'starts_at', b.slot_start, 'ends_at', b.slot_end,
               'status', b.status::text, 'consent', b.guardian_consent_status, 'camp_approval', null,
               'consent_expires_at', case when c.status = 'pending' then c.expires_at end,
               'invoice', case when i.id is not null then jsonb_build_object(
                            'number', i.number, 'status', i.status::text, 'currency', i.currency,
                            'total', i.total_chf + coalesce(i.adjustments_total, 0),
                            'balance', i.total_chf + coalesce(i.adjustments_total, 0) - public.invoice_net_paid(i.id)) end,
               'sort', b.slot_start::text)
        from public.guardian_consent_requests c
        join public.training_bookings b on b.id = any(c.booking_ids) and b.org_id = c.org_id
        join public.training_services s on s.id = b.service_id
        join public.participant_bookers pb on pb.athlete_id = c.athlete_id and pb.profile_id = c.booker_profile_id
        left join public.invoices i on i.id = b.invoice_id
             and (i.payer_profile_id = v_me
                  or exists (select 1 from public.billing_payers bp where bp.id = i.payer_id and bp.profile_id = v_me))
       where c.booker_profile_id = v_me and c.org_id = v_org) t), '[]'::jsonb);
end $$;

-- ===========================================================================
-- 12) Reserved app paths (mirrors RESERVED_SEGMENTS in src/lib/site/paths.ts)
-- ===========================================================================
create or replace function public.site_path_reserved(p text)
returns boolean language sql immutable set search_path = public as $$
  select split_part(ltrim(coalesce(p, ''), '/'), '/', 1) in (
    'admin', 'coach', 'parent', 'player', 'platform', 'login', 'auth', 'register', 'book', 'shop', 'club', 'embed',
    'embed.js', 'api', 'board', 'scout', 'waitlist', 'onboarding', 'signup', 'legal', 'offline', 'pwa',
    'sw.js', 'manifest.webmanifest', '_next', 'favicon.ico', 'sitemap.xml', 'robots.txt', 'icon',
    'apple-icon', 'opengraph-image', 'monitoring', 'join', 'consent');
$$;

-- ===========================================================================
-- 13) Grants
-- ===========================================================================
do $$
declare f text;
begin
  -- Internal helpers: definer callers only.
  foreach f in array array[
    'gc_family_bootstrap(uuid, uuid)', 'gc_org_from_slug(text)', 'gc_resolve_children(uuid, uuid, jsonb, jsonb)',
    'gc_registrations_guard()', 'gc_bookings_guard()', 'invoices_gc_confirm()', 'gc_registrations_payer()',
    'gc_auth_email()', 'gc_is_booker(uuid)', 'gc_consent_forms(uuid)', 'gc_booker_payer(uuid, uuid)',
    'gc_cancel_items(uuid, text, text)', 'gc_expire_due(uuid)', 'gc_open_request(uuid, uuid, uuid)',
    'gc_attach(uuid, text, uuid, text)', 'gc_items(public.guardian_consent_requests)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', f);
    end if;
  end loop;
  -- Service role only (server actions / scheduled job).
  foreach f in array array['public_entry_resolve_children(jsonb)', 'guardian_consent_expire()', 'guardian_consent_mark_notified(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', f);
    end if;
  end loop;
  -- Signed-in users (each checks the caller and the org).
  foreach f in array array[
    'family_bootstrap(text)', 'third_party_participant_create(jsonb, uuid)', 'booker_participants()',
    'third_party_camp_hold(jsonb, uuid)', 'third_party_training_quote(jsonb)', 'third_party_training_request(jsonb, uuid)',
    'guardian_consent_accept(text, jsonb)', 'guardian_consent_revoke(uuid)', 'booker_booking_status()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function public.%s to authenticated, service_role', f);
    end if;
  end loop;
  -- The e-mailed link is the credential (view / decline need no account): the
  -- server calls them with the service role after hashing the token, so anon
  -- gets no EXECUTE (rpc_tenant_isolation allowlist unchanged).
  foreach f in array array['guardian_consent_view(text)', 'guardian_consent_decline(text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function public.%s to authenticated, service_role', f);
    end if;
  end loop;
  -- The pure helpers stay callable (no data access).
  execute 'grant execute on function public.gc_hold_hours() to public';
  execute 'grant execute on function public.gc_mask_email(citext) to public';
end $$;

-- ===========================================================================
-- 9b) Training catalog for the booker
-- ===========================================================================
-- family_booking_catalog (20250420104700) with the same guard extension as
-- bk_family_guard: inside third_party_training_catalog() the booker passes.
-- times and free places only.
create or replace function public.family_booking_catalog(p_athlete uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id(); a public.athletes;
begin
  select * into a from public.athletes where id = p_athlete and org_id = v_org;
  if not found or not (public.is_guardian_of_athlete(p_athlete)
                     or (public.billing_flag_on('app.gc_third_party') and public.gc_is_booker(p_athlete))) then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'athlete', jsonb_build_object('id', a.id, 'first_name', a.first_name, 'last_name', a.last_name),
    'timezone', public.ta_tz(v_org),
    'availability_mode', public.bk_settings(v_org)->>'availability_mode',
    'enabled', (public.bk_settings(v_org)->>'bookings_enabled')::boolean,
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.name, 'kind', s.kind, 'duration_min', s.duration_min, 'price', s.price_chf,
               'currency', public.bk_currency(s), 'max_participants', s.max_participants,
               'venue_name', (select v.name from public.venues v where v.id = s.venue_id),
               'coaches', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'display_name', c.display_name) order by c.display_name)
                                      from public.coaches c
                                     where c.org_id = s.org_id and c.is_active and public.bk_coach_eligible(s.id, c.id)), '[]'::jsonb),
               'package_remaining', (select coalesce(sum(tp.sessions - tp.sessions_used), 0)::int
                                       from public.training_package_purchases tp
                                      where tp.athlete_id = a.id and tp.service_id = s.id and tp.status = 'active'
                                        and (tp.expires_at is null or tp.expires_at > now()) and tp.sessions_used < tp.sessions),
               'sessions', case when s.kind = 'group' then coalesce((
                  select jsonb_agg(jsonb_build_object('session_id', x.id, 'starts_at', x.starts_at, 'ends_at', x.ends_at,
                                                      'coach_id', x.coach_id,
                                                      'coach_name', (select c.display_name from public.coaches c where c.id = x.coach_id),
                                                      'places_left', greatest(0, x.capacity - public.bk_session_count(x.id)),
                                                      'pending', public.bk_session_pending(x.id)) order by x.starts_at)
                    from public.training_sessions x
                   where x.org_id = v_org and x.service_id = s.id and x.status = 'scheduled' and x.starts_at > now()
                     and x.starts_at < now() + interval '60 days'
                     and public.bk_session_count(x.id) < x.capacity
                     and not exists (select 1 from public.training_bookings o where o.session_id = x.id and o.athlete_id = a.id
                                      and o.status <> 'cancelled')), '[]'::jsonb) else '[]'::jsonb end)
             order by s.sort_order, s.name)
        from public.training_services s
       where s.org_id = v_org and s.is_active and s.bookable_by_families
         and (s.kind <> 'package' or exists (select 1 from public.training_package_purchases tp
                                              where tp.athlete_id = a.id and tp.service_id = s.id and tp.status = 'active'
                                                and (tp.expires_at is null or tp.expires_at > now()) and tp.sessions_used < tp.sessions))), '[]'::jsonb));
end $$;

-- The booker's catalog: the participant shown with the name the booker typed,
-- no package coverage (packages belong to the child's family) and no package
-- services.
create or replace function public.third_party_training_catalog(p_athlete uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v jsonb; v_name text;
begin
  if not public.gc_is_booker(p_athlete) then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
  select display_name into v_name from public.participant_bookers
   where athlete_id = p_athlete and profile_id = auth.uid() and org_id = public.current_org_id();
  perform set_config('app.gc_third_party', 'on', true);
  v := public.family_booking_catalog(p_athlete);
  perform set_config('app.gc_third_party', '', true);
  return v || jsonb_build_object(
    'athlete', jsonb_build_object('id', p_athlete, 'first_name', v_name, 'last_name', ''),
    'services', coalesce((select jsonb_agg(s || jsonb_build_object('package_remaining', 0))
                            from jsonb_array_elements(v->'services') s where s->>'kind' <> 'package'), '[]'::jsonb));
end $$;
revoke all on function public.third_party_training_catalog(uuid) from public, anon;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.third_party_training_catalog(uuid) to authenticated, service_role;
  end if;
end $$;
