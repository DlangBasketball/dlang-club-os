-- ============================================================================
-- Club OS — Participant profiles (one profile per participant, add child,
-- "Myself", sports fields, edit permissions, eligibility review, private
-- duplicate matching and verified guardian linking)
--
--   1. athletes: height_cm, weight_kg, preferred_jersey_number (a PREFERENCE
--      only; team numbers stay on team_memberships.jersey_number per roster).
--      jersey_size / position_pref are reused.
--   2. participant_enrollment_impact(): which live club enrolments a DOB / sex
--      correction could affect (active team memberships, pending / confirmed /
--      pending_approval non-camp registrations, live programme applications,
--      active memberships, upcoming camp registrations whose age band or age
--      group would change).
--   3. Guard trigger on athletes (closes the RLS bypass of
--      athletes_guardian_write): a non-staff caller cannot change dob / gender
--      while such enrolments exist (REVIEW_REQUIRED). Staff (admin / finance of
--      the org), the service role, the staff review RPC and erasure bypass it.
--      Every dob / gender change is audited (athlete.eligibility.changed).
--   4. athlete_change_requests: a guardian / self correction that needs review
--      (+ data_review_flags ATHLETE_ELIGIBILITY_CHANGE); admins approve (the
--      change is applied, audited) or decline.
--   5. athlete_link_requests: "this child may already exist" — the requesting
--      adult never sees the existing record; its guardians (parent app) or an
--      admin approve; approval adds the requester as a guardian member of the
--      child's family (existing guardian model, permissions chosen by the
--      approver) instead of creating a duplicate (+ flag ATHLETE_LINK_REQUEST).
--      "This is a different child" creates a new profile flagged
--      POSSIBLE_DUPLICATE for staff.
--   6. RPCs (security definer, search_path set, caller org = current_org_id(),
--      never a client-supplied org / role): participant_create,
--      participant_self_ensure, participant_update, participant_update_sports,
--      participant_sports_profile, participant_change_decide,
--      participant_change_withdraw, participant_link_request,
--      participant_link_decide, participant_link_withdraw,
--      participant_link_inbox, participant_my_requests,
--      participant_review_queue. request_id makes create / update / link
--      idempotent (booking_requests, bk_replay / bk_remember).
--
-- Additive and idempotent. SYNTHETIC DATA ONLY in tests.
-- ============================================================================

-- ===========================================================================
-- 1) Columns
-- ===========================================================================
alter table public.athletes add column if not exists height_cm numeric(5,1);
alter table public.athletes add column if not exists weight_kg numeric(5,1);
alter table public.athletes add column if not exists preferred_jersey_number smallint;

do $$ begin
  alter table public.athletes add constraint athletes_sports_fields_chk
    check ((height_cm is null or height_cm between 40 and 250)
       and (weight_kg is null or weight_kg between 10 and 250)
       and (preferred_jersey_number is null or preferred_jersey_number between 0 and 999));
exception when duplicate_object then null; end $$;

comment on column public.athletes.height_cm is 'Height in cm (optional sports field; guardians, the player, coaches of the player and staff edit it).';
comment on column public.athletes.weight_kg is 'Weight in kg (optional sports field).';
comment on column public.athletes.preferred_jersey_number is 'Preferred jersey number (preference only). Team numbers live on team_memberships.jersey_number per roster.';

-- ===========================================================================
-- 2) Helpers
-- ===========================================================================

-- Staff of the athlete's org who may edit any participant field directly.
create or replace function public.participant_is_staff(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_service_caller() or (p_org is not null and p_org = public.current_org_id() and public.is_finance());
$$;

-- A coach edits the sports fields of players on a team they coach (active
-- membership) or confirmed in a programme with one of their sessions.
create or replace function public.participant_coach_can_edit(p_athlete uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_coach_id() is not null and (
    exists (select 1 from public.team_memberships tm
              join public.team_coaches tc on tc.team_id = tm.team_id
             where tm.athlete_id = p_athlete and tm.status <> 'inactive'
               and tc.coach_id = public.current_coach_id() and tm.org_id = public.current_org_id())
    or exists (select 1 from public.registrations r
                 join public.program_sessions ps on ps.program_id = r.program_id
                where r.athlete_id = p_athlete and r.status = 'confirmed'
                  and ps.coach_id = public.current_coach_id() and r.org_id = public.current_org_id()));
$$;

-- Who may manage the profile as family: a guardian of the athlete (family
-- member in the current org) or the adult's own self profile.
create or replace function public.participant_can_manage(p_athlete uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_guardian_of_athlete(p_athlete)
      or exists (select 1 from public.athletes a
                  where a.id = p_athlete and a.player_profile_id = auth.uid() and a.org_id = public.current_org_id());
$$;

-- Normalised participant identity (first + last name + DOB) for matching.
create or replace function public.participant_matches(p_org uuid, p_first text, p_last text, p_dob date, p_exclude_profile uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select a.id from public.athletes a
   where a.org_id = p_org
     and public.bk_norm(a.first_name) = public.bk_norm(p_first)
     and public.bk_norm(a.last_name) = public.bk_norm(p_last)
     and a.dob = p_dob
     and a.status not in ('erased')
     and a.archived_at is null
     and (p_exclude_profile is null or not exists (
           select 1 from public.family_members fm where fm.family_id = a.family_id and fm.profile_id = p_exclude_profile))
   order by a.created_at;
$$;

-- Live enrolments a DOB / sex correction could affect. Reads the STORED row
-- (current values) and compares with the proposed ones. Internal.
create or replace function public.participant_enrollment_impact(p_athlete uuid, p_new_dob date, p_new_gender text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a        public.athletes%rowtype;
  v_today  date;
  v        jsonb := '[]'::jsonb;
  v_dob_ch boolean;
  v_sex_ch boolean;
begin
  select * into a from public.athletes where id = p_athlete;
  if not found then return '[]'::jsonb; end if;
  v_dob_ch := a.dob is distinct from p_new_dob;
  v_sex_ch := lower(btrim(coalesce(a.gender, ''))) is distinct from lower(btrim(coalesce(p_new_gender, '')));
  if not v_dob_ch and not v_sex_ch then return '[]'::jsonb; end if;
  v_today := public.ta_today(a.org_id);

  v := v || coalesce((select jsonb_agg(jsonb_build_object('kind', 'team', 'id', tm.team_id))
                        from public.team_memberships tm
                       where tm.athlete_id = a.id and tm.status <> 'inactive'
                         and (tm.left_on is null or tm.left_on >= v_today)), '[]'::jsonb);

  v := v || coalesce((select jsonb_agg(jsonb_build_object('kind', 'registration', 'id', r.id, 'program_id', r.program_id))
                        from public.registrations r join public.programs p on p.id = r.program_id
                       where r.athlete_id = a.id and p.kind <> 'camp'
                         and r.status::text in ('pending', 'confirmed', 'pending_approval')), '[]'::jsonb);

  v := v || coalesce((select jsonb_agg(jsonb_build_object('kind', 'application', 'id', pa.id, 'program_id', pa.program_id))
                        from public.program_applications pa
                       where pa.athlete_id = a.id
                         and pa.status in ('applied', 'under_review', 'accepted', 'waitlisted', 'enrolled')), '[]'::jsonb);

  v := v || coalesce((select jsonb_agg(jsonb_build_object('kind', 'membership', 'id', m.id))
                        from public.memberships m
                       where m.athlete_id = a.id and m.status in ('active', 'pending_approval')
                         and m.valid_until >= v_today), '[]'::jsonb);

  -- Camps: only a DOB change matters, and only when the age band on the first
  -- day or the chosen age group would change.
  if v_dob_ch then
    v := v || coalesce((
      select jsonb_agg(jsonb_build_object('kind', 'camp', 'id', r.id, 'program_id', r.program_id))
        from public.registrations r
        join public.programs p on p.id = r.program_id
        left join public.camp_editions e on e.id = r.camp_edition_id
        left join public.camp_age_groups g on g.id = r.camp_age_group_id
        cross join lateral (select coalesce(e.starts_on, p.starts_on) as d) s
       where r.athlete_id = a.id and p.kind = 'camp'
         and r.status::text in ('pending', 'confirmed', 'pending_approval', 'waitlist')
         and s.d is not null and s.d >= v_today
         and (
           public.camp_age_band(public.camp_age_on_start(a.dob, s.d), p.min_age, p.max_age, p.approval_age_min, p.approval_age_max)
             is distinct from
           public.camp_age_band(public.camp_age_on_start(p_new_dob, s.d), p.min_age, p.max_age, p.approval_age_min, p.approval_age_max)
           or (g.id is not null and (
                (public.camp_age_on_start(a.dob, s.d) between coalesce(g.min_age, 0) and coalesce(g.max_age, 199))
                is distinct from
                (public.camp_age_on_start(p_new_dob, s.d) between coalesce(g.min_age, 0) and coalesce(g.max_age, 199))))
         )), '[]'::jsonb);
  end if;
  return v;
end $$;

-- The caller's family in the current org (primary first). With p_create, an
-- adult without one gets a household of their own (they are its primary
-- guardian). Internal: called by the participant RPCs.
create or replace function public.participant_my_family(p_create boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me  uuid := auth.uid();
  v_org uuid := public.current_org_id();
  v_fam uuid;
  p     public.profiles%rowtype;
begin
  if v_me is null or v_org is null then return null; end if;
  select fm.family_id into v_fam
    from public.family_members fm join public.families f on f.id = fm.family_id
   where fm.profile_id = v_me and f.org_id = v_org and coalesce(f.status, 'active') <> 'erased'
   order by fm.is_primary desc, fm.created_at
   limit 1;
  if v_fam is not null or not p_create then return v_fam; end if;
  select * into p from public.profiles where id = v_me;
  insert into public.families (org_id, name, contact_name, contact_email)
  values (v_org, left(coalesce(nullif(btrim(p.full_name), ''), 'Family'), 120), left(nullif(btrim(p.full_name), ''), 140), p.email)
  returning id into v_fam;
  insert into public.family_members (family_id, profile_id, relation, is_primary)
  values (v_fam, v_me, 'guardian', true)
  on conflict (family_id, profile_id) do nothing;
  update public.families set primary_contact_id = v_me where id = v_fam and primary_contact_id is null;
  return v_fam;
end $$;

-- Payload readers (shared validation of the participant RPCs).
create or replace function public.participant_read_dob(p jsonb, p_org uuid)
returns date language plpgsql stable security definer set search_path = public as $$
declare v date;
begin
  begin
    v := nullif(btrim(coalesce(p->>'dob', '')), '')::date;
  exception when others then
    raise exception 'INVALID_DOB' using errcode = 'P0001';
  end;
  if v is null then raise exception 'DOB_REQUIRED' using errcode = 'P0001'; end if;
  if v > public.ta_today(p_org) or v < date '1900-01-02' then raise exception 'INVALID_DOB' using errcode = 'P0001'; end if;
  return v;
end $$;

create or replace function public.participant_read_sports(p jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  v_h numeric; v_w numeric; v_n integer;
  out jsonb := '{}'::jsonb;
begin
  if p ? 'height_cm' then
    begin v_h := nullif(btrim(coalesce(p->>'height_cm', '')), '')::numeric;
    exception when others then raise exception 'INVALID_HEIGHT' using errcode = 'P0001'; end;
    if v_h is not null and (v_h < 40 or v_h > 250) then raise exception 'INVALID_HEIGHT' using errcode = 'P0001'; end if;
    out := out || jsonb_build_object('height_cm', round(v_h, 1));
  end if;
  if p ? 'weight_kg' then
    begin v_w := nullif(btrim(coalesce(p->>'weight_kg', '')), '')::numeric;
    exception when others then raise exception 'INVALID_WEIGHT' using errcode = 'P0001'; end;
    if v_w is not null and (v_w < 10 or v_w > 250) then raise exception 'INVALID_WEIGHT' using errcode = 'P0001'; end if;
    out := out || jsonb_build_object('weight_kg', round(v_w, 1));
  end if;
  if p ? 'preferred_jersey_number' then
    begin v_n := nullif(btrim(coalesce(p->>'preferred_jersey_number', '')), '')::integer;
    exception when others then raise exception 'INVALID_JERSEY_NUMBER' using errcode = 'P0001'; end;
    if v_n is not null and (v_n < 0 or v_n > 999) then raise exception 'INVALID_JERSEY_NUMBER' using errcode = 'P0001'; end if;
    out := out || jsonb_build_object('preferred_jersey_number', v_n);
  end if;
  if p ? 'position_pref' then
    if length(btrim(coalesce(p->>'position_pref', ''))) > 60 then raise exception 'TOO_LONG' using errcode = 'P0001'; end if;
    out := out || jsonb_build_object('position_pref', nullif(btrim(coalesce(p->>'position_pref', '')), ''));
  end if;
  if p ? 'jersey_size' then
    if length(btrim(coalesce(p->>'jersey_size', ''))) > 10 then raise exception 'TOO_LONG' using errcode = 'P0001'; end if;
    out := out || jsonb_build_object('jersey_size', nullif(btrim(coalesce(p->>'jersey_size', '')), ''));
  end if;
  return out;
end $$;

-- Apply sports fields (present keys only) to an athlete. Internal.
create or replace function public.participant_apply_sports(p_athlete uuid, p_sports jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_sports is null or p_sports = '{}'::jsonb then return; end if;
  update public.athletes set
    height_cm = case when p_sports ? 'height_cm' then (p_sports->>'height_cm')::numeric else height_cm end,
    weight_kg = case when p_sports ? 'weight_kg' then (p_sports->>'weight_kg')::numeric else weight_kg end,
    preferred_jersey_number = case when p_sports ? 'preferred_jersey_number' then (p_sports->>'preferred_jersey_number')::smallint else preferred_jersey_number end,
    position_pref = case when p_sports ? 'position_pref' then p_sports->>'position_pref' else position_pref end,
    jersey_size = case when p_sports ? 'jersey_size' then p_sports->>'jersey_size' else jersey_size end
  where id = p_athlete;
end $$;

-- ===========================================================================
-- 3) Tables
-- ===========================================================================
create table if not exists public.athlete_change_requests (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  athlete_id     uuid not null references public.athletes(id) on delete cascade,
  requested_by   uuid references public.profiles(id) on delete set null,
  changes        jsonb not null,             -- {"dob": "...", "gender": "..."} (proposed)
  previous       jsonb not null default '{}'::jsonb,
  impact         jsonb not null default '[]'::jsonb,
  status         text not null default 'pending',
  request_id     uuid,
  decided_by     uuid references public.profiles(id) on delete set null,
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint athlete_change_requests_status_chk check (status in ('pending', 'approved', 'declined', 'withdrawn')),
  constraint athlete_change_requests_note_chk check (decision_note is null or length(decision_note) <= 1000)
);
create index if not exists idx_athlete_change_requests_org on public.athlete_change_requests(org_id, status, created_at desc);
create index if not exists idx_athlete_change_requests_athlete on public.athlete_change_requests(athlete_id);
create unique index if not exists athlete_change_requests_pending_uidx
  on public.athlete_change_requests(athlete_id) where status = 'pending';
create unique index if not exists athlete_change_requests_request_uidx
  on public.athlete_change_requests(org_id, request_id) where request_id is not null;

create table if not exists public.athlete_link_requests (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  athlete_id            uuid not null references public.athletes(id) on delete cascade,  -- never shown to the requester
  requester_profile_id  uuid not null references public.profiles(id) on delete cascade,
  relation              text not null default 'guardian',
  submitted             jsonb not null default '{}'::jsonb,  -- what the requester typed (their own input)
  status                text not null default 'pending',
  request_id            uuid,
  decided_by            uuid references public.profiles(id) on delete set null,
  decided_at            timestamptz,
  decided_via           text,
  granted_permissions   jsonb,
  decision_note         text,
  expires_at            timestamptz not null default (now() + interval '30 days'),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint athlete_link_requests_status_chk check (status in ('pending', 'approved', 'declined', 'withdrawn', 'expired')),
  constraint athlete_link_requests_relation_chk check (relation in ('mother', 'father', 'guardian', 'other')),
  constraint athlete_link_requests_via_chk check (decided_via is null or decided_via in ('guardian', 'staff')),
  constraint athlete_link_requests_note_chk check (decision_note is null or length(decision_note) <= 1000)
);
create index if not exists idx_athlete_link_requests_org on public.athlete_link_requests(org_id, status, created_at desc);
create index if not exists idx_athlete_link_requests_athlete on public.athlete_link_requests(athlete_id, status);
create index if not exists idx_athlete_link_requests_requester on public.athlete_link_requests(requester_profile_id);
create unique index if not exists athlete_link_requests_pending_uidx
  on public.athlete_link_requests(athlete_id, requester_profile_id) where status = 'pending';
create unique index if not exists athlete_link_requests_request_uidx
  on public.athlete_link_requests(org_id, request_id) where request_id is not null;

drop trigger if exists trg_athlete_change_requests_updated on public.athlete_change_requests;
create trigger trg_athlete_change_requests_updated before update on public.athlete_change_requests
  for each row execute function public.set_updated_at();
drop trigger if exists trg_athlete_link_requests_updated on public.athlete_link_requests;
create trigger trg_athlete_link_requests_updated before update on public.athlete_link_requests
  for each row execute function public.set_updated_at();

-- Personal data: audited (free-text decision notes redacted).
drop trigger if exists trg_audit_athlete_change_requests on public.athlete_change_requests;
create trigger trg_audit_athlete_change_requests after insert or update or delete on public.athlete_change_requests
  for each row execute function public.ca_audit_trigger('decision_note');
drop trigger if exists trg_audit_athlete_link_requests on public.athlete_link_requests;
create trigger trg_audit_athlete_link_requests after insert or update or delete on public.athlete_link_requests
  for each row execute function public.ca_audit_trigger('decision_note', 'submitted');

-- RLS ------------------------------------------------------------------------
alter table public.athlete_change_requests enable row level security;
alter table public.athlete_change_requests force row level security;
alter table public.athlete_link_requests enable row level security;
alter table public.athlete_link_requests force row level security;

drop policy if exists platform_tenant_isolation on public.athlete_change_requests;
create policy platform_tenant_isolation on public.athlete_change_requests as restrictive for all
  using (org_id = (select public.current_org_id())) with check (org_id = (select public.current_org_id()));
drop policy if exists platform_tenant_isolation on public.athlete_link_requests;
create policy platform_tenant_isolation on public.athlete_link_requests as restrictive for all
  using (org_id = (select public.current_org_id())) with check (org_id = (select public.current_org_id()));

-- Change requests: admins of the org, the requester and the child's guardians read.
drop policy if exists athlete_change_requests_select on public.athlete_change_requests;
create policy athlete_change_requests_select on public.athlete_change_requests for select
  using ((org_id = public.current_org_id() and public.is_admin())
         or requested_by = auth.uid()
         or public.participant_can_manage(athlete_id));
drop policy if exists athlete_change_requests_insert on public.athlete_change_requests;
create policy athlete_change_requests_insert on public.athlete_change_requests for insert with check (false);
drop policy if exists athlete_change_requests_update on public.athlete_change_requests;
create policy athlete_change_requests_update on public.athlete_change_requests for update using (false) with check (false);
drop policy if exists athlete_change_requests_delete on public.athlete_change_requests;
create policy athlete_change_requests_delete on public.athlete_change_requests for delete using (false);

-- Link requests: admins only through the table (the requester and the
-- child's guardians read through the RPCs, which never expose the match to
-- the requester).
drop policy if exists athlete_link_requests_select on public.athlete_link_requests;
create policy athlete_link_requests_select on public.athlete_link_requests for select
  using (org_id = public.current_org_id() and public.is_admin());
drop policy if exists athlete_link_requests_insert on public.athlete_link_requests;
create policy athlete_link_requests_insert on public.athlete_link_requests for insert with check (false);
drop policy if exists athlete_link_requests_update on public.athlete_link_requests;
create policy athlete_link_requests_update on public.athlete_link_requests for update using (false) with check (false);
drop policy if exists athlete_link_requests_delete on public.athlete_link_requests;
create policy athlete_link_requests_delete on public.athlete_link_requests for delete using (false);

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on public.athlete_change_requests, public.athlete_link_requests to authenticated;
    grant all on public.athlete_change_requests, public.athlete_link_requests to service_role;
  end if;
end $$;

-- ===========================================================================
-- 4) Guard + audit triggers on athletes
-- ===========================================================================
create or replace function public.athletes_eligibility_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.dob is not distinct from old.dob
     and lower(btrim(coalesce(new.gender, ''))) = lower(btrim(coalesce(old.gender, ''))) then
    return new;
  end if;
  -- Staff review applies an approved change; erasure / anonymisation.
  if coalesce(current_setting('app.participant_review_apply', true), '') = 'on' then return new; end if;
  if public.participant_is_staff(new.org_id) then return new; end if;
  if new.status = 'erased' or (new.first_name = 'Redacted' and new.last_name = 'Athlete' and new.dob = date '1900-01-01') then
    return new;
  end if;
  if jsonb_array_length(public.participant_enrollment_impact(old.id, new.dob, new.gender)) > 0 then
    raise exception 'REVIEW_REQUIRED' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_athletes_eligibility_guard on public.athletes;
create trigger trg_athletes_eligibility_guard before update of dob, gender on public.athletes
  for each row execute function public.athletes_eligibility_guard();

create or replace function public.athletes_eligibility_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (new.org_id, auth.uid(), 'athlete.eligibility.changed', 'athletes', new.id,
          jsonb_build_object('dob', old.dob, 'gender', old.gender),
          jsonb_build_object('dob', new.dob, 'gender', new.gender,
                             'via', coalesce(nullif(current_setting('app.participant_change_via', true), ''), 'direct')));
  return new;
end $$;

drop trigger if exists trg_athletes_eligibility_audit on public.athletes;
create trigger trg_athletes_eligibility_audit after update of dob, gender on public.athletes
  for each row when (old.dob is distinct from new.dob or old.gender is distinct from new.gender)
  execute function public.athletes_eligibility_audit();

-- ===========================================================================
-- 5) RPCs
-- ===========================================================================

-- Add a participant (a child of the caller's family). Never shows another
-- family's record: a possible match returns POSSIBLE_MATCH with no details.
--   payload: first_name, last_name, dob, gender (male|female), family_id?,
--            height_cm?, weight_kg?, position_pref?, jersey_size?,
--            preferred_jersey_number?, decision? ('different')
create or replace function public.participant_create(p_payload jsonb, p_request_id uuid)
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
  v_dob    date;
  v_family uuid := nullif(p_payload->>'family_id', '')::uuid;
  v_sports jsonb;
  v_own    uuid;
  v_match  uuid[];
  v_ath    uuid;
  v_res    jsonb;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if v_org is null then raise exception 'NO_ORG' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  v_rep := public.bk_replay(p_request_id, 'participant_create');
  if v_rep is not null then return v_rep; end if;

  if length(v_first) = 0 or length(v_first) > 80 or length(v_last) = 0 or length(v_last) > 80 then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001';
  end if;
  v_dob := public.participant_read_dob(p_payload, v_org);
  if v_gender is null or v_gender not in ('male', 'female') then raise exception 'INVALID_SEX' using errcode = 'P0001'; end if;
  v_sports := public.participant_read_sports(p_payload);

  if v_family is not null then
    if not public.is_guardian_of_family(v_family) then raise exception 'FAMILY_NOT_FOUND' using errcode = 'P0002'; end if;
  else
    v_family := public.participant_my_family(true);
  end if;

  -- Already in one of the caller's own families: that profile (no duplicate).
  select a.id into v_own from public.athletes a
    join public.family_members fm on fm.family_id = a.family_id and fm.profile_id = v_me
   where a.org_id = v_org and a.archived_at is null and a.status not in ('erased')
     and public.bk_norm(a.first_name) = public.bk_norm(v_first) and public.bk_norm(a.last_name) = public.bk_norm(v_last)
     and a.dob = v_dob
   limit 1;
  if v_own is not null then
    v_res := jsonb_build_object('ok', true, 'athlete_id', v_own, 'existing', true, 'family_id', (select family_id from public.athletes where id = v_own));
    return public.bk_remember(p_request_id, 'participant_create', v_res);
  end if;

  select array_agg(m) into v_match from public.participant_matches(v_org, v_first, v_last, v_dob, v_me) m;
  if v_match is not null and coalesce(p_payload->>'decision', '') <> 'different' then
    -- Not remembered: the same request id may come back with a decision.
    return jsonb_build_object('ok', false, 'code', 'POSSIBLE_MATCH');
  end if;

  insert into public.athletes (org_id, family_id, first_name, last_name, dob, gender, status)
  values (v_org, v_family, v_first, v_last, v_dob, v_gender, 'active')
  returning id into v_ath;
  perform public.participant_apply_sports(v_ath, v_sports);

  if v_match is not null then
    perform public.bk_flag(v_org, 'athletes', v_ath, 'POSSIBLE_DUPLICATE',
                           jsonb_build_object('athlete_id', v_ath, 'match_ids', to_jsonb(v_match), 'source', 'family'));
  end if;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, v_me, 'participant.create', 'athletes', v_ath,
          jsonb_build_object('family_id', v_family, 'possible_duplicate', v_match is not null));

  v_res := jsonb_build_object('ok', true, 'athlete_id', v_ath, 'existing', false, 'family_id', v_family,
                              'possible_duplicate', v_match is not null);
  return public.bk_remember(p_request_id, 'participant_create', v_res);
end $$;

-- "Myself": the adult's own participant profile (athletes.player_profile_id =
-- auth.uid()), created on first use. Adults only (18+ on p_payload.at, else
-- today). payload: first_name, last_name, dob, gender?, at?
create or replace function public.participant_self_ensure(p_payload jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_org    uuid := public.current_org_id();
  v_rep    jsonb;
  v_ath    uuid;
  v_dob    date;
  v_at     date;
  v_first  text := btrim(coalesce(p_payload->>'first_name', ''));
  v_last   text := btrim(coalesce(p_payload->>'last_name', ''));
  v_gender text := lower(nullif(btrim(coalesce(p_payload->>'gender', '')), ''));
  v_family uuid;
  v_match  uuid[];
  v_res    jsonb;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if v_org is null then raise exception 'NO_ORG' using errcode = '42501'; end if;
  begin
    v_at := coalesce(nullif(btrim(coalesce(p_payload->>'at', '')), '')::date, public.ta_today(v_org));
  exception when others then raise exception 'INVALID_DATE' using errcode = 'P0001'; end;

  select a.id, a.dob into v_ath, v_dob from public.athletes a
   where a.player_profile_id = v_me and a.org_id = v_org and a.status not in ('erased') limit 1;
  if v_ath is not null then
    if age(v_at, v_dob) < interval '18 years' then raise exception 'SELF_MUST_BE_ADULT' using errcode = 'P0001'; end if;
    return jsonb_build_object('ok', true, 'athlete_id', v_ath, 'created', false);
  end if;

  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  v_rep := public.bk_replay(p_request_id, 'participant_self');
  if v_rep is not null then return v_rep; end if;

  if length(v_first) = 0 or length(v_first) > 80 or length(v_last) = 0 or length(v_last) > 80 then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001';
  end if;
  v_dob := public.participant_read_dob(p_payload, v_org);
  if age(v_at, v_dob) < interval '18 years' then raise exception 'SELF_MUST_BE_ADULT' using errcode = 'P0001'; end if;
  if v_gender is not null and v_gender not in ('male', 'female') then raise exception 'INVALID_SEX' using errcode = 'P0001'; end if;

  v_family := public.participant_my_family(true);
  select array_agg(m) into v_match from public.participant_matches(v_org, v_first, v_last, v_dob, v_me) m;

  insert into public.athletes (org_id, family_id, first_name, last_name, dob, gender, status, player_profile_id, player_linked_at)
  values (v_org, v_family, v_first, v_last, v_dob, v_gender, 'active', v_me, now())
  returning id into v_ath;
  if v_match is not null then
    perform public.bk_flag(v_org, 'athletes', v_ath, 'POSSIBLE_DUPLICATE',
                           jsonb_build_object('athlete_id', v_ath, 'match_ids', to_jsonb(v_match), 'source', 'self'));
  end if;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, v_me, 'participant.self_create', 'athletes', v_ath, jsonb_build_object('family_id', v_family));
  v_res := jsonb_build_object('ok', true, 'athlete_id', v_ath, 'created', true);
  return public.bk_remember(p_request_id, 'participant_self', v_res);
end $$;

-- Edit a profile: staff (any field, applied), guardian / self (name, DOB,
-- sex, sports fields; a DOB / sex change that affects a live enrolment
-- becomes a change request for staff review, the rest is applied).
create or replace function public.participant_update(p_athlete uuid, p_payload jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  v_org     uuid := public.current_org_id();
  v_rep     jsonb;
  a         public.athletes%rowtype;
  v_staff   boolean;
  v_first   text;
  v_last    text;
  v_dob     date;
  v_gender  text;
  v_sports  jsonb;
  v_impact  jsonb := '[]'::jsonb;
  v_req     uuid;
  v_changes jsonb := '{}'::jsonb;
  v_res     jsonb;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_request_id is not null then
    v_rep := public.bk_replay(p_request_id, 'participant_update');
    if v_rep is not null then return v_rep; end if;
  end if;
  select * into a from public.athletes where id = p_athlete for update;
  if not found or a.org_id is distinct from v_org or a.status = 'erased' then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  v_staff := public.participant_is_staff(a.org_id);
  if not (v_staff or public.participant_can_manage(a.id)) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;

  v_first := case when p_payload ? 'first_name' then btrim(coalesce(p_payload->>'first_name', '')) else a.first_name end;
  v_last  := case when p_payload ? 'last_name' then btrim(coalesce(p_payload->>'last_name', '')) else a.last_name end;
  if length(v_first) = 0 or length(v_first) > 80 or length(v_last) = 0 or length(v_last) > 80 then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001';
  end if;
  v_dob := case when p_payload ? 'dob' then public.participant_read_dob(p_payload, a.org_id) else a.dob end;
  v_gender := case when p_payload ? 'gender' then lower(nullif(btrim(coalesce(p_payload->>'gender', '')), '')) else a.gender end;
  -- New values: male / female (an unchanged stored value, e.g. 'other', stays readable).
  if lower(btrim(coalesce(v_gender, ''))) is distinct from lower(btrim(coalesce(a.gender, '')))
     and (v_gender is null or v_gender not in ('male', 'female')) then
    raise exception 'INVALID_SEX' using errcode = 'P0001';
  end if;
  v_sports := public.participant_read_sports(p_payload);

  if a.player_profile_id is not null and a.player_profile_id = v_me and not v_staff
     and age(public.ta_today(a.org_id), v_dob) < interval '18 years' then
    raise exception 'SELF_MUST_BE_ADULT' using errcode = 'P0001';
  end if;

  if not v_staff then
    v_impact := public.participant_enrollment_impact(a.id, v_dob, v_gender);
  end if;

  if jsonb_array_length(v_impact) > 0 then
    if a.dob is distinct from v_dob then v_changes := v_changes || jsonb_build_object('dob', v_dob); end if;
    if lower(btrim(coalesce(a.gender, ''))) is distinct from lower(btrim(coalesce(v_gender, ''))) then
      v_changes := v_changes || jsonb_build_object('gender', v_gender);
    end if;
    -- A newer correction replaces an open one.
    update public.athlete_change_requests set status = 'withdrawn', decided_at = now(), decided_by = v_me,
           decision_note = 'superseded'
     where athlete_id = a.id and status = 'pending';
    update public.data_review_flags set resolved_at = now(), resolved_by = v_me, resolution_note = 'superseded'
     where org_id = a.org_id and entity_table = 'athlete_change_requests' and resolved_at is null
       and entity_id in (select id from public.athlete_change_requests where athlete_id = a.id and decision_note = 'superseded');
    insert into public.athlete_change_requests (org_id, athlete_id, requested_by, changes, previous, impact, request_id)
    values (a.org_id, a.id, v_me, v_changes, jsonb_build_object('dob', a.dob, 'gender', a.gender), v_impact, p_request_id)
    returning id into v_req;
    perform public.bk_flag(a.org_id, 'athlete_change_requests', v_req, 'ATHLETE_ELIGIBILITY_CHANGE',
                           jsonb_build_object('athlete_id', a.id, 'change_request_id', v_req));
    update public.athletes set first_name = v_first, last_name = v_last where id = a.id;
  else
    perform set_config('app.participant_change_via', case when v_staff then 'staff' else 'family' end, true);
    update public.athletes set first_name = v_first, last_name = v_last, dob = v_dob, gender = v_gender where id = a.id;
    perform set_config('app.participant_change_via', '', true);
  end if;
  perform public.participant_apply_sports(a.id, v_sports);

  v_res := jsonb_build_object('ok', true, 'athlete_id', a.id, 'review_required', v_req is not null,
                              'change_request_id', v_req, 'family_id', a.family_id);
  if p_request_id is not null then return public.bk_remember(p_request_id, 'participant_update', v_res); end if;
  return v_res || jsonb_build_object('replayed', false);
end $$;

-- Sports fields only (height, weight, position, jersey size / preferred
-- number): staff, guardians / self, and coaches of the player. Never writes a
-- team jersey number (team_memberships.jersey_number).
create or replace function public.participant_update_sports(p_athlete uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a       public.athletes%rowtype;
  k       text;
  v_sp    jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select * into a from public.athletes where id = p_athlete for update;
  if not found or a.org_id is distinct from public.current_org_id() or a.status = 'erased' then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (public.participant_is_staff(a.org_id) or public.participant_can_manage(a.id) or public.participant_coach_can_edit(a.id)) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  for k in select jsonb_object_keys(coalesce(p_payload, '{}'::jsonb)) loop
    if k not in ('height_cm', 'weight_kg', 'position_pref', 'jersey_size', 'preferred_jersey_number') then
      raise exception 'FIELD_NOT_ALLOWED' using errcode = '42501';
    end if;
  end loop;
  v_sp := public.participant_read_sports(coalesce(p_payload, '{}'::jsonb));
  perform public.participant_apply_sports(a.id, v_sp);
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (a.org_id, auth.uid(), 'participant.sports.update', 'athletes', a.id,
          jsonb_build_object('height_cm', a.height_cm, 'weight_kg', a.weight_kg, 'position_pref', a.position_pref,
                             'jersey_size', a.jersey_size, 'preferred_jersey_number', a.preferred_jersey_number), v_sp);
  return jsonb_build_object('ok', true, 'athlete_id', a.id);
end $$;

-- Sports profile for whoever may edit it (coach view).
create or replace function public.participant_sports_profile(p_athlete uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare a public.athletes%rowtype;
begin
  select * into a from public.athletes where id = p_athlete;
  if not found or a.org_id is distinct from public.current_org_id() or a.status = 'erased' then return null; end if;
  if not (public.participant_is_staff(a.org_id) or public.participant_can_manage(a.id) or public.participant_coach_can_edit(a.id)) then
    return null;
  end if;
  return jsonb_build_object('athlete_id', a.id, 'first_name', a.first_name, 'last_name', a.last_name,
                            'height_cm', a.height_cm, 'weight_kg', a.weight_kg, 'position_pref', a.position_pref,
                            'jersey_size', a.jersey_size, 'preferred_jersey_number', a.preferred_jersey_number, 'can_edit', true);
end $$;

-- Staff decision on a DOB / sex correction.
create or replace function public.participant_change_decide(p_request uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r      public.athlete_change_requests%rowtype;
  v_fam  uuid;
begin
  select * into r from public.athlete_change_requests where id = p_request for update;
  if not found or r.org_id is distinct from public.current_org_id() then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_admin() then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if p_decision not in ('approve', 'decline') then raise exception 'INVALID_DECISION' using errcode = 'P0001'; end if;
  if p_note is not null and length(p_note) > 1000 then raise exception 'TOO_LONG' using errcode = 'P0001'; end if;
  select family_id into v_fam from public.athletes where id = r.athlete_id;
  if r.status <> 'pending' then
    return jsonb_build_object('ok', true, 'status', r.status, 'replayed', true, 'athlete_id', r.athlete_id, 'family_id', v_fam);
  end if;
  if p_decision = 'approve' then
    perform set_config('app.participant_review_apply', 'on', true);
    perform set_config('app.participant_change_via', 'review', true);
    update public.athletes
       set dob = case when r.changes ? 'dob' then (r.changes->>'dob')::date else dob end,
           gender = case when r.changes ? 'gender' then r.changes->>'gender' else gender end
     where id = r.athlete_id;
    perform set_config('app.participant_review_apply', '', true);
    perform set_config('app.participant_change_via', '', true);
  end if;
  update public.athlete_change_requests
     set status = case when p_decision = 'approve' then 'approved' else 'declined' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = r.id;
  update public.data_review_flags set resolved_at = now(), resolved_by = auth.uid(),
         resolution_note = case when p_decision = 'approve' then 'approved' else 'declined' end
   where org_id = r.org_id and entity_table = 'athlete_change_requests' and entity_id = r.id and resolved_at is null;
  return jsonb_build_object('ok', true, 'status', case when p_decision = 'approve' then 'approved' else 'declined' end,
                            'replayed', false, 'athlete_id', r.athlete_id, 'family_id', v_fam, 'requested_by', r.requested_by);
end $$;

create or replace function public.participant_change_withdraw(p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.athlete_change_requests%rowtype;
begin
  select * into r from public.athlete_change_requests where id = p_request for update;
  if not found or r.org_id is distinct from public.current_org_id()
     or not (r.requested_by = auth.uid() or public.participant_can_manage(r.athlete_id)) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if r.status <> 'pending' then return jsonb_build_object('ok', true, 'status', r.status, 'replayed', true); end if;
  update public.athlete_change_requests set status = 'withdrawn', decided_by = auth.uid(), decided_at = now() where id = r.id;
  update public.data_review_flags set resolved_at = now(), resolved_by = auth.uid(), resolution_note = 'withdrawn'
   where org_id = r.org_id and entity_table = 'athlete_change_requests' and entity_id = r.id and resolved_at is null;
  return jsonb_build_object('ok', true, 'status', 'withdrawn', 'replayed', false);
end $$;

-- Ask to be linked to a child that may already exist. The requester only
-- learns that a request was created (opaque id), never which record.
-- payload: first_name, last_name, dob, relation (mother|father|guardian|other)
create or replace function public.participant_link_request(p_payload jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_org   uuid := public.current_org_id();
  v_rep   jsonb;
  v_first text := btrim(coalesce(p_payload->>'first_name', ''));
  v_last  text := btrim(coalesce(p_payload->>'last_name', ''));
  v_rel   text := lower(coalesce(nullif(btrim(coalesce(p_payload->>'relation', '')), ''), 'guardian'));
  v_dob   date;
  v_ath   uuid;
  v_id    uuid;
  v_res   jsonb;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if v_org is null then raise exception 'NO_ORG' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  v_rep := public.bk_replay(p_request_id, 'participant_link');
  if v_rep is not null then return v_rep; end if;
  if v_rel not in ('mother', 'father', 'guardian', 'other') then raise exception 'INVALID_RELATION' using errcode = 'P0001'; end if;
  if length(v_first) = 0 or length(v_first) > 80 or length(v_last) = 0 or length(v_last) > 80 then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001';
  end if;
  v_dob := public.participant_read_dob(p_payload, v_org);
  select m into v_ath from public.participant_matches(v_org, v_first, v_last, v_dob, v_me) m limit 1;
  if v_ath is null then raise exception 'NO_MATCH' using errcode = 'P0002'; end if;

  select id into v_id from public.athlete_link_requests
   where athlete_id = v_ath and requester_profile_id = v_me and status = 'pending';
  if v_id is null then
    insert into public.athlete_link_requests (org_id, athlete_id, requester_profile_id, relation, submitted, request_id)
    values (v_org, v_ath, v_me, v_rel, jsonb_build_object('first_name', v_first, 'last_name', v_last, 'dob', v_dob), p_request_id)
    returning id into v_id;
    perform public.bk_flag(v_org, 'athlete_link_requests', v_id, 'ATHLETE_LINK_REQUEST', jsonb_build_object('athlete_id', v_ath));
  end if;
  v_res := jsonb_build_object('ok', true, 'link_request_id', v_id, 'status', 'pending');
  return public.bk_remember(p_request_id, 'participant_link', v_res);
end $$;

-- Decide a link request: a guardian of the child (not the requester) or an
-- admin of the club. Approval adds the requester as a guardian member of the
-- child's family with the permissions the approver chose
-- ({"can_pay": bool, "can_see_medical": bool, "receives_emails": bool};
-- defaults: no payment, no medical, e-mails on).
create or replace function public.participant_link_decide(p_request uuid, p_decision text, p_permissions jsonb default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r       public.athlete_link_requests%rowtype;
  v_staff boolean;
  v_guard boolean;
  v_fam   uuid;
  v_perm  jsonb;
  v_status text;
begin
  select * into r from public.athlete_link_requests where id = p_request for update;
  if not found or r.org_id is distinct from public.current_org_id() then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  v_staff := public.is_admin();
  v_guard := public.is_guardian_of_athlete(r.athlete_id) and auth.uid() <> r.requester_profile_id;
  if not (v_staff or v_guard) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_decision not in ('approve', 'decline') then raise exception 'INVALID_DECISION' using errcode = 'P0001'; end if;
  if p_note is not null and length(p_note) > 1000 then raise exception 'TOO_LONG' using errcode = 'P0001'; end if;
  select family_id into v_fam from public.athletes where id = r.athlete_id;
  if r.status <> 'pending' then
    return jsonb_build_object('ok', true, 'status', r.status, 'replayed', true, 'requester_profile_id', r.requester_profile_id);
  end if;
  if r.expires_at <= now() then
    update public.athlete_link_requests set status = 'expired' where id = r.id;
    return jsonb_build_object('ok', false, 'code', 'EXPIRED', 'status', 'expired');
  end if;

  if p_decision = 'approve' then
    v_perm := jsonb_build_object(
      'can_pay', coalesce((p_permissions->>'can_pay')::boolean, false),
      'can_see_medical', coalesce((p_permissions->>'can_see_medical')::boolean, false),
      'receives_emails', coalesce((p_permissions->>'receives_emails')::boolean, true));
    insert into public.family_members (family_id, profile_id, relation, is_primary, can_pay, can_see_medical, receives_emails)
    values (v_fam, r.requester_profile_id, case when r.relation = 'other' then 'guardian' else r.relation end, false,
            (v_perm->>'can_pay')::boolean, (v_perm->>'can_see_medical')::boolean, (v_perm->>'receives_emails')::boolean)
    on conflict (family_id, profile_id) do nothing;
    v_status := 'approved';
  else
    v_status := 'declined';
  end if;
  update public.athlete_link_requests
     set status = v_status, decided_by = auth.uid(), decided_at = now(),
         decided_via = case when v_guard then 'guardian' else 'staff' end,
         granted_permissions = v_perm, decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = r.id;
  update public.data_review_flags set resolved_at = now(), resolved_by = auth.uid(), resolution_note = v_status
   where org_id = r.org_id and entity_table = 'athlete_link_requests' and entity_id = r.id and resolved_at is null;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (r.org_id, auth.uid(), 'participant.link.' || v_status, 'athlete_link_requests', r.id,
          jsonb_build_object('athlete_id', r.athlete_id, 'family_id', v_fam, 'requester_profile_id', r.requester_profile_id,
                             'permissions', v_perm, 'via', case when v_guard then 'guardian' else 'staff' end));
  return jsonb_build_object('ok', true, 'status', v_status, 'replayed', false, 'requester_profile_id', r.requester_profile_id);
end $$;

create or replace function public.participant_link_withdraw(p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.athlete_link_requests%rowtype;
begin
  select * into r from public.athlete_link_requests where id = p_request for update;
  if not found or r.org_id is distinct from public.current_org_id() or r.requester_profile_id <> auth.uid() then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if r.status <> 'pending' then return jsonb_build_object('ok', true, 'status', r.status, 'replayed', true); end if;
  update public.athlete_link_requests set status = 'withdrawn', decided_at = now() where id = r.id;
  update public.data_review_flags set resolved_at = now(), resolved_by = auth.uid(), resolution_note = 'withdrawn'
   where org_id = r.org_id and entity_table = 'athlete_link_requests' and entity_id = r.id and resolved_at is null;
  return jsonb_build_object('ok', true, 'status', 'withdrawn', 'replayed', false);
end $$;

-- Pending link requests for children the caller guards (parent app inbox).
-- Shows the requester's name and e-mail so the guardian can verify them.
create or replace function public.participant_link_inbox()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'athlete_id', r.athlete_id, 'athlete_first_name', a.first_name,
           'requester_name', p.full_name, 'requester_email', p.email, 'relation', r.relation,
           'created_at', r.created_at, 'expires_at', r.expires_at) order by r.created_at), '[]'::jsonb)
    from public.athlete_link_requests r
    join public.athletes a on a.id = r.athlete_id
    join public.profiles p on p.id = r.requester_profile_id
   where r.org_id = public.current_org_id() and r.status = 'pending' and r.expires_at > now()
     and r.requester_profile_id <> auth.uid()
     and public.is_guardian_of_athlete(r.athlete_id);
$$;

-- The caller's own requests: link requests (only what they typed; never the
-- matched record) and profile corrections awaiting review.
create or replace function public.participant_my_requests()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'links', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', r.id, 'first_name', r.submitted->>'first_name', 'last_name', r.submitted->>'last_name',
                 'status', case when r.status = 'pending' and r.expires_at <= now() then 'expired' else r.status end,
                 'created_at', r.created_at, 'decided_at', r.decided_at) order by r.created_at desc)
               from public.athlete_link_requests r
              where r.org_id = public.current_org_id() and r.requester_profile_id = auth.uid()), '[]'::jsonb),
    'changes', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', c.id, 'athlete_id', c.athlete_id, 'changes', c.changes, 'status', c.status,
                 'decision_note', c.decision_note, 'created_at', c.created_at, 'decided_at', c.decided_at) order by c.created_at desc)
               from public.athlete_change_requests c
              where c.org_id = public.current_org_id()
                and (c.requested_by = auth.uid() or public.participant_can_manage(c.athlete_id))), '[]'::jsonb));
$$;

-- Staff queue (admins): pending corrections and link requests with names.
create or replace function public.participant_review_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() or public.current_org_id() is null then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  return jsonb_build_object(
    'changes', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', c.id, 'athlete_id', c.athlete_id, 'athlete_name', a.first_name || ' ' || a.last_name,
                 'previous', c.previous, 'changes', c.changes, 'impact', c.impact,
                 'requested_by_name', p.full_name, 'created_at', c.created_at) order by c.created_at)
               from public.athlete_change_requests c
               join public.athletes a on a.id = c.athlete_id
               left join public.profiles p on p.id = c.requested_by
              where c.org_id = public.current_org_id() and c.status = 'pending'), '[]'::jsonb),
    'links', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', r.id, 'athlete_id', r.athlete_id, 'athlete_name', a.first_name || ' ' || a.last_name,
                 'athlete_dob', a.dob, 'family_id', a.family_id, 'family_name', f.name,
                 'requester_name', p.full_name, 'requester_email', p.email, 'relation', r.relation,
                 'created_at', r.created_at, 'expires_at', r.expires_at) order by r.created_at)
               from public.athlete_link_requests r
               join public.athletes a on a.id = r.athlete_id
               left join public.families f on f.id = a.family_id
               join public.profiles p on p.id = r.requester_profile_id
              where r.org_id = public.current_org_id() and r.status = 'pending'), '[]'::jsonb));
end $$;

-- ===========================================================================
-- 6) Grants
-- ===========================================================================
do $$
declare f text;
begin
  -- Internal helpers: definer callers only.
  foreach f in array array[
    'participant_enrollment_impact(uuid, date, text)', 'participant_my_family(boolean)',
    'participant_matches(uuid, text, text, date, uuid)', 'participant_read_dob(jsonb, uuid)',
    'participant_read_sports(jsonb)', 'participant_apply_sports(uuid, jsonb)',
    'athletes_eligibility_guard()', 'athletes_eligibility_audit()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', f);
    end if;
  end loop;
  -- Policy helpers + RPCs: signed-in users (each checks the caller and org).
  foreach f in array array[
    'participant_is_staff(uuid)', 'participant_coach_can_edit(uuid)', 'participant_can_manage(uuid)',
    'participant_create(jsonb, uuid)', 'participant_self_ensure(jsonb, uuid)', 'participant_update(uuid, jsonb, uuid)',
    'participant_update_sports(uuid, jsonb)', 'participant_sports_profile(uuid)',
    'participant_change_decide(uuid, text, text)', 'participant_change_withdraw(uuid)',
    'participant_link_request(jsonb, uuid)', 'participant_link_decide(uuid, text, jsonb, text)',
    'participant_link_withdraw(uuid)', 'participant_link_inbox()', 'participant_my_requests()',
    'participant_review_queue()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function public.%s to authenticated, service_role', f);
    end if;
  end loop;
end $$;
