-- ============================================================================
-- Club OS — My Athletes, active-athlete validation, data checks, safe merge of
-- duplicate athletes, proposed profile details on club requests (applied on
-- approval) and athlete profile history.
--
--   1. athletes.merged_into_id / merged_at (archived duplicates point to the
--      athlete they were merged into); club_approval_requests.proposed_profile
--      (pending, never applied before approval) + profile_outcome.
--   2. Profile audit: every create / change of profile fields writes
--      audit_logs 'athlete.profile.created' / 'athlete.profile.changed' with
--      before / after of the changed fields, the path ('via') and a reason.
--      DOB / sex corrections requested / decided are audited on the athlete.
--   3. Roles: participant_is_staff() is admin only (finance = billing only);
--      a finance-only caller cannot change profile fields (trigger).
--   4. my_athlete_ids() / my_athletes() / my_athlete_resolve(): the athletes a
--      signed-in adult manages in the current club (own self profile +
--      children of their families). The parent app validates the active
--      athlete cookie against it on every read.
--   5. athlete_data_check(): POSSIBLE_DUPLICATE (same normalised first + last
--      name + DOB), POSSIBLE_SELF_LINK (adult player whose family contact
--      e-mail and name match a login; staff confirm, never auto-linked) and
--      ATHLETE_WITHOUT_GUARDIAN flags. athlete_self_link_decide() confirms.
--   6. athlete_merges + athlete_merge(): staff merge of two athletes of the
--      same club in one transaction; every athlete_id foreign key is found in
--      pg_constraint and moved; unique conflicts keep the kept athlete's row
--      and are recorded; the duplicate is archived (never deleted).
--   7. Club requests: club_request_submit / _decide / _row are wrapped (the
--      originals are renamed *_base and keep their rules unchanged). A
--      family may propose profile details (position, preferred jersey number,
--      jersey size, height, weight; DOB / sex correction). Approve applies the
--      sports fields atomically, sends DOB / sex through athlete_change_requests
--      (staff review) and puts the preferred number on the new roster row when
--      it is free on that team (else the roster number stays empty and the
--      reviewer is told). Decline applies nothing.
--   8. athlete_profile_history(): admin-only profile history of an athlete.
--
-- Additive and idempotent. SYNTHETIC DATA ONLY in tests.
-- ============================================================================

-- ===========================================================================
-- 1) Columns
-- ===========================================================================
alter table public.athletes add column if not exists merged_into_id uuid references public.athletes(id) on delete set null;
alter table public.athletes add column if not exists merged_at timestamptz;
create index if not exists idx_athletes_merged_into on public.athletes(merged_into_id) where merged_into_id is not null;
comment on column public.athletes.merged_into_id is 'Set when staff merged this (archived) duplicate into another athlete of the same club.';

alter table public.club_approval_requests add column if not exists proposed_profile jsonb;
alter table public.club_approval_requests add column if not exists profile_outcome jsonb;
comment on column public.club_approval_requests.proposed_profile is
  'Profile details the family proposed with the request ({"sports": {...}, "eligibility": {"dob","gender"}}). Pending: applied only on approval.';
comment on column public.club_approval_requests.profile_outcome is
  'What the approval applied (sports fields, DOB / sex review request, roster jersey number) or that a decline applied nothing.';

-- ===========================================================================
-- 2) Profile audit
-- ===========================================================================
-- Fields of the participant profile (identity + sports + links). Medical and
-- contact data have their own tables and audit.
create or replace function public.athlete_profile_fields()
returns text[] language sql immutable as $$
  select array['first_name', 'last_name', 'dob', 'gender', 'height_cm', 'weight_kg', 'position_pref', 'jersey_size',
               'preferred_jersey_number', 'player_profile_id', 'family_id', 'status', 'merged_into_id']
$$;

-- Who changed the profile, by which path.
create or replace function public.athlete_profile_via(p_athlete uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(current_setting('app.profile_change_via', true), ''),
    nullif(current_setting('app.participant_change_via', true), ''),
    case when auth.uid() is null or public.is_service_caller() then 'system'
         when public.is_admin() then 'staff'
         when public.participant_can_manage(p_athlete) then 'family'
         when public.current_coach_id() is not null then 'coach'
         else 'direct' end);
$$;

create or replace function public.athletes_profile_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  f       text;
  v_old   jsonb := '{}'::jsonb;
  v_new   jsonb := '{}'::jsonb;
  o       jsonb;
  n       jsonb;
  v_meta  jsonb;
begin
  v_meta := jsonb_build_object('via', public.athlete_profile_via(new.id),
                               'reason', nullif(current_setting('app.profile_change_reason', true), ''));
  -- Erasure / anonymisation: the event only, never the content.
  if new.status = 'erased' or (new.first_name = 'Redacted' and new.last_name = 'Athlete' and new.dob = date '1900-01-01') then
    if tg_op = 'UPDATE' and old.status is not distinct from new.status then return null; end if;
    insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
    values (new.org_id, auth.uid(), 'athlete.profile.erased', 'athletes', new.id, jsonb_build_object('status', new.status));
    return null;
  end if;
  n := to_jsonb(new);
  if tg_op = 'INSERT' then
    foreach f in array public.athlete_profile_fields() loop
      if n->f is not null and n->f <> 'null'::jsonb then v_new := v_new || jsonb_build_object(f, n->f); end if;
    end loop;
    insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
    values (new.org_id, auth.uid(), 'athlete.profile.created', 'athletes', new.id, v_new || jsonb_build_object('_meta', v_meta));
    return null;
  end if;
  o := to_jsonb(old);
  foreach f in array public.athlete_profile_fields() loop
    if (o->f) is distinct from (n->f) then
      v_old := v_old || jsonb_build_object(f, coalesce(o->f, 'null'::jsonb));
      v_new := v_new || jsonb_build_object(f, coalesce(n->f, 'null'::jsonb));
    end if;
  end loop;
  if v_new = '{}'::jsonb then return null; end if;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (new.org_id, auth.uid(), 'athlete.profile.changed', 'athletes', new.id, v_old, v_new || jsonb_build_object('_meta', v_meta));
  return null;
end $$;

drop trigger if exists trg_athletes_profile_audit on public.athletes;
create trigger trg_athletes_profile_audit after insert or update on public.athletes
  for each row execute function public.athletes_profile_audit();

-- DOB / sex corrections: requested / decided, on the athlete's history.
create or replace function public.athlete_change_requests_profile_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
    values (new.org_id, auth.uid(), 'athlete.profile.correction.requested', 'athletes', new.athlete_id, new.previous,
            new.changes || jsonb_build_object('_meta', jsonb_build_object('change_request_id', new.id,
              'via', coalesce(nullif(current_setting('app.profile_change_via', true), ''), 'family'))));
  elsif old.status is distinct from new.status and new.status in ('approved', 'declined', 'withdrawn') then
    insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
    values (new.org_id, auth.uid(), 'athlete.profile.correction.' || new.status, 'athletes', new.athlete_id, new.previous,
            new.changes || jsonb_build_object('_meta', jsonb_build_object('change_request_id', new.id, 'reason', new.decision_note)));
  end if;
  return null;
end $$;

drop trigger if exists trg_athlete_change_requests_profile_audit on public.athlete_change_requests;
create trigger trg_athlete_change_requests_profile_audit after insert or update on public.athlete_change_requests
  for each row execute function public.athlete_change_requests_profile_audit();

-- ===========================================================================
-- 3) Roles: profile editing is admin (or family / self / coach sports) only
-- ===========================================================================
-- Before: admin or finance. Finance keeps billing, not profile editing.
create or replace function public.participant_is_staff(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_service_caller() or (p_org is not null and p_org = public.current_org_id() and public.is_admin());
$$;

-- A finance-only caller (no admin role, not the child's guardian) cannot
-- change profile fields through the athletes_admin_write policy.
create or replace function public.athletes_finance_profile_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  f text;
  o jsonb;
  n jsonb;
begin
  if auth.uid() is null or public.is_service_caller() or public.is_admin() or not public.has_role('finance') then
    return new;
  end if;
  if new.status = 'erased' or (new.first_name = 'Redacted' and new.last_name = 'Athlete' and new.dob = date '1900-01-01') then
    return new;
  end if;
  if public.participant_can_manage(old.id) then return new; end if;
  o := to_jsonb(old); n := to_jsonb(new);
  foreach f in array array['first_name', 'last_name', 'dob', 'gender', 'height_cm', 'weight_kg', 'position_pref', 'jersey_size',
                           'preferred_jersey_number', 'player_profile_id', 'family_id', 'merged_into_id'] loop
    if (o->f) is distinct from (n->f) then raise exception 'FIELD_NOT_ALLOWED' using errcode = '42501'; end if;
  end loop;
  return new;
end $$;

drop trigger if exists trg_athletes_finance_profile_guard on public.athletes;
create trigger trg_athletes_finance_profile_guard before update on public.athletes
  for each row execute function public.athletes_finance_profile_guard();

-- ===========================================================================
-- 4) My athletes (parent app) + active-athlete validation
-- ===========================================================================
-- The athletes the signed-in adult manages in the current club: their own
-- self profile and the children of their families. Third-party participants
-- they booked for ("someone else") are not included.
create or replace function public.my_athlete_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select a.id
    from public.athletes a
   where auth.uid() is not null
     and a.org_id = public.current_org_id()
     and a.status not in ('erased', 'archived')
     and a.archived_at is null
     and a.merged_into_id is null
     and (a.player_profile_id = auth.uid()
          or exists (select 1 from public.family_members fm join public.families f on f.id = fm.family_id
                      where fm.family_id = a.family_id and fm.profile_id = auth.uid() and f.org_id = a.org_id));
$$;

-- The athlete id when the caller may act for it, else null. The parent app
-- calls it (through my_athletes) to validate the active-athlete cookie.
create or replace function public.my_athlete_resolve(p_athlete uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p_athlete where p_athlete is not null and p_athlete in (select public.my_athlete_ids());
$$;

-- My Athletes list: identity, age, active teams / programmes / memberships,
-- open club requests and corrections, sports fields. Derived on read.
create or replace function public.my_athletes()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org   uuid := public.current_org_id();
  v_today date;
begin
  if auth.uid() is null or v_org is null then return '[]'::jsonb; end if;
  v_today := public.ta_today(v_org);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'first_name', a.first_name, 'last_name', a.last_name, 'dob', a.dob, 'gender', a.gender,
      'status', a.status, 'family_id', a.family_id,
      'kind', case when a.player_profile_id = auth.uid() then 'self' else 'child' end,
      'age', case when a.dob is null then null else extract(year from age(v_today, a.dob))::int end,
      'sports', jsonb_build_object('height_cm', a.height_cm, 'weight_kg', a.weight_kg, 'position_pref', a.position_pref,
                                   'jersey_size', a.jersey_size, 'preferred_jersey_number', a.preferred_jersey_number),
      'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'jersey_number', tm.jersey_number) order by t.name)
                           from public.team_memberships tm join public.teams t on t.id = tm.team_id
                          where tm.athlete_id = a.id and tm.org_id = v_org and tm.status <> 'inactive'
                            and (tm.left_on is null or tm.left_on >= v_today)), '[]'::jsonb),
      'programmes', coalesce((select jsonb_agg(jsonb_build_object(
                                 'id', p.id, 'registration_id', r.id, 'name', p.name, 'kind', p.kind::text, 'status', r.status::text,
                                 'balance', public.club_request_invoice_open(r.invoice_id)) order by p.name)
                                from public.registrations r join public.programs p on p.id = r.program_id
                                left join public.camp_editions e on e.id = r.camp_edition_id
                               where r.athlete_id = a.id and r.org_id = v_org
                                 and r.status::text in ('pending', 'confirmed', 'pending_approval', 'waitlist')
                                 and coalesce(e.ends_on, p.ends_on, v_today) >= v_today), '[]'::jsonb),
      'memberships', coalesce((select jsonb_agg(jsonb_build_object(
                                 'id', m.id, 'name', mt.name, 'status', m.status,
                                 'balance', public.club_request_invoice_open(m.invoice_id)) order by mt.name)
                                 from public.memberships m join public.membership_types mt on mt.id = m.membership_type_id
                                where m.athlete_id = a.id and m.org_id = v_org and m.status in ('active', 'pending_payment')
                                  and m.valid_until >= v_today), '[]'::jsonb),
      'requests', coalesce((select jsonb_agg(jsonb_build_object(
                               'id', q.id, 'status', q.status, 'subject_kind', q.subject_kind,
                               'name', coalesce(p.name, mt.name)) order by q.created_at desc)
                              from public.club_approval_requests q
                              left join public.programs p on p.id = q.program_id
                              left join public.membership_types mt on mt.id = q.membership_type_id
                             where q.athlete_id = a.id and q.org_id = v_org and q.status in ('pending', 'info_requested')), '[]'::jsonb),
      'pending_corrections', (select count(*) from public.athlete_change_requests c where c.athlete_id = a.id and c.status = 'pending'))
      order by coalesce(a.player_profile_id = auth.uid(), false) desc, a.first_name, a.last_name)
      from public.athletes a
     where a.id in (select public.my_athlete_ids())), '[]'::jsonb);
end $$;

-- ===========================================================================
-- 5) Data checks (staff): duplicates, self-link candidates, no guardian
-- ===========================================================================
-- Internal: runs the checks for one club, returns the number of new flags.
-- A finding staff already resolved is not raised again.
create or replace function public.athlete_data_check_org(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := public.ta_today(p_org);
  v_dup   int := 0;
  v_self  int := 0;
  v_none  int := 0;
begin
  -- (a) same normalised first + last name + DOB in the same club.
  with live as (
    select a.id, a.created_at, public.bk_norm(a.first_name) fn, public.bk_norm(a.last_name) ln, a.dob
      from public.athletes a
     where a.org_id = p_org and a.status not in ('erased', 'archived') and a.archived_at is null and a.merged_into_id is null
       and a.dob is not null and a.dob <> date '1900-01-01'
  ),
  grp as (
    select fn, ln, dob, array_agg(id order by created_at, id) ids from live group by fn, ln, dob having count(*) > 1
  ),
  cand as (
    select x.id, g.ids from grp g cross join lateral unnest(g.ids[2:]) as x(id)
  ),
  ins as (
    insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
    select p_org, 'athletes', c.id, 'POSSIBLE_DUPLICATE',
           jsonb_build_object('athlete_id', c.id, 'match_ids', to_jsonb(array_remove(c.ids, c.id)), 'source', 'data_check')
      from cand c
     where not exists (select 1 from public.data_review_flags d
                        where d.org_id = p_org and d.entity_table = 'athletes' and d.entity_id = c.id and d.reason_code = 'POSSIBLE_DUPLICATE')
    on conflict do nothing
    returning 1)
  select count(*) into v_dup from ins;

  -- (b) adult player without a login whose family contact e-mail AND name
  -- match exactly one profile of this club (or of the family): staff confirm.
  with cand as (
    select a.id athlete_id, min(p.id::text)::uuid profile_id, count(distinct p.id) n
      from public.athletes a
      join public.families f on f.id = a.family_id
      join public.profiles p on lower(p.email::text) = lower(f.contact_email::text)
     where a.org_id = p_org and a.player_profile_id is null and a.status not in ('erased', 'archived') and a.archived_at is null
       and a.merged_into_id is null and a.dob is not null and age(v_today, a.dob) >= interval '18 years'
       and f.contact_email is not null
       and public.bk_norm(p.full_name) = public.bk_norm(a.first_name || ' ' || a.last_name)
       and (p.org_id = p_org or exists (select 1 from public.family_members fm where fm.family_id = a.family_id and fm.profile_id = p.id))
       and not exists (select 1 from public.athletes o where o.org_id = p_org and o.player_profile_id = p.id)
     group by a.id
  ),
  ins as (
    insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
    select p_org, 'athletes', c.athlete_id, 'POSSIBLE_SELF_LINK',
           jsonb_build_object('athlete_id', c.athlete_id, 'profile_id', c.profile_id, 'source', 'data_check')
      from cand c
     where c.n = 1
       and not exists (select 1 from public.data_review_flags d
                        where d.org_id = p_org and d.entity_table = 'athletes' and d.entity_id = c.athlete_id and d.reason_code = 'POSSIBLE_SELF_LINK')
    on conflict do nothing
    returning 1)
  select count(*) into v_self from ins;

  -- (c) no guardian with a login and no own login.
  with ins as (
    insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
    select p_org, 'athletes', a.id, 'ATHLETE_WITHOUT_GUARDIAN',
           jsonb_build_object('athlete_id', a.id, 'has_family', a.family_id is not null, 'source', 'data_check')
      from public.athletes a
     where a.org_id = p_org and a.status not in ('erased', 'archived', 'inactive') and a.archived_at is null and a.merged_into_id is null
       and a.player_profile_id is null
       and not exists (select 1 from public.family_members fm where fm.family_id = a.family_id)
       and not exists (select 1 from public.data_review_flags d
                        where d.org_id = p_org and d.entity_table = 'athletes' and d.entity_id = a.id
                          and d.reason_code = 'ATHLETE_WITHOUT_GUARDIAN' and d.resolved_at is null)
    on conflict do nothing
    returning 1)
  select count(*) into v_none from ins;

  return jsonb_build_object('possible_duplicates', v_dup, 'possible_self_links', v_self, 'without_guardian', v_none,
                            'total', v_dup + v_self + v_none);
end $$;

-- Admin of the current club. Idempotent: re-running raises no new flag for
-- the same finding.
create or replace function public.athlete_data_check()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id(); v_res jsonb;
begin
  if auth.uid() is null or v_org is null or not public.is_admin() then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  v_res := public.athlete_data_check_org(v_org);
  perform public.ca_audit(v_org, 'athlete.data_check', 'organizations', v_org, v_res);
  return v_res;
end $$;

-- Staff confirm (link the athlete to the login) or dismiss a POSSIBLE_SELF_LINK flag.
create or replace function public.athlete_self_link_decide(p_flag uuid, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org  uuid := public.current_org_id();
  fl     public.data_review_flags%rowtype;
  v_ath  uuid;
  v_prof uuid;
  v_ok   boolean := false;
begin
  if auth.uid() is null or v_org is null or not public.is_admin() then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if p_decision not in ('link', 'dismiss') then raise exception 'INVALID_DECISION' using errcode = 'P0001'; end if;
  select * into fl from public.data_review_flags where id = p_flag and org_id = v_org and reason_code = 'POSSIBLE_SELF_LINK' for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if fl.resolved_at is not null then return jsonb_build_object('ok', true, 'replayed', true); end if;
  v_ath := (fl.details->>'athlete_id')::uuid;
  v_prof := (fl.details->>'profile_id')::uuid;
  if p_decision = 'link' then
    if exists (select 1 from public.athletes where org_id = v_org and player_profile_id = v_prof and id <> v_ath) then
      raise exception 'PROFILE_ALREADY_LINKED' using errcode = 'P0001';
    end if;
    perform set_config('app.profile_change_via', 'staff', true);
    perform set_config('app.profile_change_reason', 'self_link_confirmed', true);
    v_ok := public.ta_link_player(v_ath, v_prof, v_org);
    perform set_config('app.profile_change_via', '', true);
    perform set_config('app.profile_change_reason', '', true);
    if not v_ok then raise exception 'LINK_FAILED' using errcode = 'P0001'; end if;
  end if;
  update public.data_review_flags set resolved_at = now(), resolved_by = auth.uid(),
         resolution_note = case when p_decision = 'link' then 'linked' else 'dismissed' end
   where id = fl.id;
  return jsonb_build_object('ok', true, 'replayed', false, 'linked', p_decision = 'link', 'athlete_id', v_ath);
end $$;

-- ===========================================================================
-- 6) Merge duplicates
-- ===========================================================================
create table if not exists public.athlete_merges (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  kept_athlete_id    uuid references public.athletes(id) on delete set null,
  merged_athlete_id  uuid references public.athletes(id) on delete set null,
  merged_by          uuid references public.profiles(id) on delete set null,
  reason             text,
  moved              jsonb not null default '[]'::jsonb,
  conflicts          jsonb not null default '[]'::jsonb,
  request_id         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint athlete_merges_reason_chk check (reason is null or length(reason) <= 1000)
);
create index if not exists idx_athlete_merges_org on public.athlete_merges(org_id, created_at desc);
create index if not exists idx_athlete_merges_kept on public.athlete_merges(kept_athlete_id);
create index if not exists idx_athlete_merges_merged on public.athlete_merges(merged_athlete_id);
create unique index if not exists athlete_merges_request_uidx on public.athlete_merges(org_id, request_id) where request_id is not null;

drop trigger if exists trg_athlete_merges_updated on public.athlete_merges;
create trigger trg_athlete_merges_updated before update on public.athlete_merges
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_athlete_merges on public.athlete_merges;
create trigger trg_audit_athlete_merges after insert or update or delete on public.athlete_merges
  for each row execute function public.ca_audit_trigger('reason');

alter table public.athlete_merges enable row level security;
alter table public.athlete_merges force row level security;
drop policy if exists platform_tenant_isolation on public.athlete_merges;
create policy platform_tenant_isolation on public.athlete_merges as restrictive for all
  using (org_id = (select public.current_org_id())) with check (org_id = (select public.current_org_id()));
drop policy if exists athlete_merges_select on public.athlete_merges;
create policy athlete_merges_select on public.athlete_merges for select
  using (org_id = public.current_org_id() and public.is_admin());
drop policy if exists athlete_merges_insert on public.athlete_merges;
create policy athlete_merges_insert on public.athlete_merges for insert with check (false);
drop policy if exists athlete_merges_update on public.athlete_merges;
create policy athlete_merges_update on public.athlete_merges for update using (false) with check (false);
drop policy if exists athlete_merges_delete on public.athlete_merges;
create policy athlete_merges_delete on public.athlete_merges for delete using (false);

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on public.athlete_merges to authenticated;
    grant all on public.athlete_merges to service_role;
  end if;
end $$;

-- Every single-column foreign key that references athletes(id), except the
-- athletes table itself and the merge log.
create or replace function public.athlete_fk_columns()
returns table (tbl regclass, col name)
language sql
stable
set search_path = public
as $$
  select c.conrelid::regclass, a.attname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
   where c.contype = 'f' and c.confrelid = 'public.athletes'::regclass and cardinality(c.conkey) = 1
     and c.conrelid not in ('public.athletes'::regclass, 'public.athlete_merges'::regclass)
   order by c.conrelid::regclass::text, a.attname;
$$;

-- Merge p_duplicate into p_keep (admin of the club, same club, one
-- transaction). Unique conflicts keep the kept athlete's row; the
-- duplicate's conflicting row stays on the archived duplicate and is
-- recorded. Any other refusal aborts the whole merge (MERGE_BLOCKED).
create or replace function public.athlete_merge(p_keep uuid, p_duplicate uuid, p_reason text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      uuid := public.current_org_id();
  k          public.athletes%rowtype;
  d          public.athletes%rowtype;
  v_prev     public.athlete_merges%rowtype;
  rec        record;
  v_ctid     tid;
  v_rowid    text;
  v_n        int;
  v_moved    jsonb := '[]'::jsonb;
  v_conf     jsonb := '[]'::jsonb;
  v_id       uuid;
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
  v_state    text;
begin
  if auth.uid() is null or v_org is null or not public.is_admin() then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  if v_reason is not null and length(v_reason) > 1000 then raise exception 'TOO_LONG' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':athlete_merge', 0));

  select * into v_prev from public.athlete_merges where org_id = v_org and request_id = p_request_id;
  if found then
    return jsonb_build_object('ok', true, 'replayed', true, 'merge_id', v_prev.id, 'kept_athlete_id', v_prev.kept_athlete_id,
                              'merged_athlete_id', v_prev.merged_athlete_id, 'moved', v_prev.moved, 'conflicts', v_prev.conflicts);
  end if;
  if p_keep is null or p_duplicate is null or p_keep = p_duplicate then raise exception 'INVALID_MERGE' using errcode = 'P0001'; end if;

  -- Lock both in a fixed order.
  perform 1 from public.athletes where id in (p_keep, p_duplicate) order by id for update;
  select * into k from public.athletes where id = p_keep;
  select * into d from public.athletes where id = p_duplicate;
  -- Another club's athlete is "not found" (no cross-tenant hint).
  if k.id is null or d.id is null or k.org_id is distinct from v_org or d.org_id is distinct from v_org then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if k.status = 'erased' or d.status = 'erased' or k.merged_into_id is not null then raise exception 'INVALID_MERGE' using errcode = 'P0001'; end if;
  if d.merged_into_id is not null then raise exception 'ALREADY_MERGED' using errcode = 'P0001'; end if;

  perform set_config('app.athlete_merge', 'on', true);
  perform set_config('app.profile_change_via', 'merge', true);
  perform set_config('app.profile_change_reason', coalesce(v_reason, 'merge'), true);

  for rec in select * from public.athlete_fk_columns() loop
    v_n := 0;
    for v_ctid in execute format('select ctid from %s where %I = $1', rec.tbl, rec.col) using d.id loop
      begin
        execute format('update %s set %I = $1 where ctid = $2', rec.tbl, rec.col) using k.id, v_ctid;
        v_n := v_n + 1;
      exception
        when unique_violation or exclusion_violation then
          execute format('select to_jsonb(t)->>''id'' from %s t where ctid = $1', rec.tbl) into v_rowid using v_ctid;
          v_conf := v_conf || jsonb_build_object('table', rec.tbl::text, 'column', rec.col::text, 'row_id', v_rowid, 'kept', 'kept_athlete_row');
        when others then
          get stacked diagnostics v_state = message_text;
          raise exception 'MERGE_BLOCKED' using errcode = 'P0001', detail = rec.tbl::text || ': ' || coalesce(v_state, '');
      end;
    end loop;
    if v_n > 0 then v_moved := v_moved || jsonb_build_object('table', rec.tbl::text, 'column', rec.col::text, 'rows', v_n); end if;
  end loop;

  -- The duplicate's own login moves to the kept athlete when it has none.
  if d.player_profile_id is not null then
    if k.player_profile_id is null then
      update public.athletes set player_profile_id = null where id = d.id;
      update public.athletes set player_profile_id = d.player_profile_id, player_linked_at = coalesce(d.player_linked_at, now()) where id = k.id;
      v_moved := v_moved || jsonb_build_object('table', 'athletes', 'column', 'player_profile_id', 'rows', 1);
    elsif k.player_profile_id <> d.player_profile_id then
      v_conf := v_conf || jsonb_build_object('table', 'athletes', 'column', 'player_profile_id', 'row_id', d.id::text, 'kept', 'kept_athlete_login');
    end if;
  end if;
  if d.family_id is distinct from k.family_id then
    -- Guardians of the duplicate's family do not get the kept athlete's
    -- family: staff link them (link request / invitation) if appropriate.
    v_conf := v_conf || jsonb_build_object('table', 'athletes', 'column', 'family_id', 'row_id', d.id::text, 'kept', 'different_family');
  end if;

  -- Archive the duplicate (never deleted).
  update public.athletes
     set status = 'archived', archived_at = coalesce(archived_at, now()), merged_into_id = k.id, merged_at = now()
   where id = d.id;

  insert into public.athlete_merges (org_id, kept_athlete_id, merged_athlete_id, merged_by, reason, moved, conflicts, request_id)
  values (v_org, k.id, d.id, auth.uid(), v_reason, v_moved, v_conf, p_request_id)
  returning id into v_id;

  update public.data_review_flags set resolved_at = now(), resolved_by = auth.uid(), resolution_note = 'merged'
   where org_id = v_org and resolved_at is null and entity_table = 'athletes' and entity_id in (k.id, d.id)
     and reason_code in ('POSSIBLE_DUPLICATE', 'POSSIBLE_SELF_LINK', 'ATHLETE_WITHOUT_GUARDIAN')
     and (entity_id = d.id or reason_code = 'POSSIBLE_DUPLICATE');

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, auth.uid(), 'athlete.merge.kept', 'athletes', k.id,
          jsonb_build_object('merge_id', v_id, 'merged_athlete_id', d.id, 'moved', v_moved, 'conflicts', jsonb_array_length(v_conf),
                             '_meta', jsonb_build_object('via', 'merge', 'reason', v_reason))),
         (v_org, auth.uid(), 'athlete.merge.archived', 'athletes', d.id,
          jsonb_build_object('merge_id', v_id, 'kept_athlete_id', k.id, '_meta', jsonb_build_object('via', 'merge', 'reason', v_reason)));

  perform set_config('app.athlete_merge', '', true);
  perform set_config('app.profile_change_via', '', true);
  perform set_config('app.profile_change_reason', '', true);
  return jsonb_build_object('ok', true, 'replayed', false, 'merge_id', v_id, 'kept_athlete_id', k.id, 'merged_athlete_id', d.id,
                            'moved', v_moved, 'conflicts', v_conf);
end $$;

-- Open duplicate findings with both records side by side (admin).
create or replace function public.athlete_duplicate_pairs()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id();
begin
  if auth.uid() is null or v_org is null or not public.is_admin() then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('flag_id', x.flag_id, 'created_at', x.created_at,
             'athlete', public.athlete_merge_card(x.athlete_id), 'match', public.athlete_merge_card(x.match_id)) order by x.created_at)
      from (
        select distinct on (f.id) f.id flag_id, f.created_at, f.entity_id athlete_id, m.mid::uuid match_id
          from public.data_review_flags f
          cross join lateral jsonb_array_elements_text(coalesce(f.details->'match_ids', '[]'::jsonb)) m(mid)
          join public.athletes a on a.id = f.entity_id and a.org_id = v_org and a.merged_into_id is null and a.status <> 'erased'
          join public.athletes b on b.id = m.mid::uuid and b.org_id = v_org and b.merged_into_id is null and b.status <> 'erased'
         where f.org_id = v_org and f.reason_code = 'POSSIBLE_DUPLICATE' and f.resolved_at is null and f.entity_table = 'athletes'
         order by f.id, b.created_at) x), '[]'::jsonb);
end $$;

-- One athlete as staff compare it before a merge (internal).
create or replace function public.athlete_merge_card(p_athlete uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', a.id, 'first_name', a.first_name, 'last_name', a.last_name, 'dob', a.dob, 'gender', a.gender,
           'status', a.status, 'created_at', a.created_at, 'family_id', a.family_id, 'family_name', f.name,
           'has_login', a.player_profile_id is not null,
           'teams', (select count(*) from public.team_memberships tm where tm.athlete_id = a.id),
           'registrations', (select count(*) from public.registrations r where r.athlete_id = a.id),
           'invoices', (select count(*) from public.invoices i where i.athlete_id = a.id))
    from public.athletes a left join public.families f on f.id = a.family_id
   where a.id = p_athlete;
$$;

-- ===========================================================================
-- 7) Club requests: proposed profile details
-- ===========================================================================
-- Keep the existing functions (rules unchanged) under *_base and wrap them.
do $$
begin
  if to_regprocedure('public.club_request_submit_base(jsonb, uuid)') is null then
    alter function public.club_request_submit(jsonb, uuid) rename to club_request_submit_base;
  end if;
  if to_regprocedure('public.club_request_decide_base(uuid, text, text, uuid)') is null then
    alter function public.club_request_decide(uuid, text, text, uuid) rename to club_request_decide_base;
  end if;
  if to_regprocedure('public.club_request_row_base(uuid, boolean)') is null then
    alter function public.club_request_row(uuid, boolean) rename to club_request_row_base;
  end if;
end $$;

-- Validated proposal: only the keys that differ from the athlete's current
-- values. {"sports": {...}, "eligibility": {"dob": ..., "gender": ...}} or null.
create or replace function public.club_profile_proposal(p_athlete uuid, p_profile jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a      public.athletes%rowtype;
  k      text;
  v_sp   jsonb;
  v_cur  jsonb;
  v_out  jsonb := '{}'::jsonb;
  v_sports jsonb := '{}'::jsonb;
  v_elig jsonb := '{}'::jsonb;
  v_dob  date;
  v_sex  text;
begin
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' or p_profile = '{}'::jsonb then return null; end if;
  select * into a from public.athletes where id = p_athlete;
  if not found then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
  for k in select jsonb_object_keys(p_profile) loop
    if k not in ('height_cm', 'weight_kg', 'position_pref', 'jersey_size', 'preferred_jersey_number', 'dob', 'gender') then
      raise exception 'FIELD_NOT_ALLOWED' using errcode = '42501';
    end if;
  end loop;
  v_sp := public.participant_read_sports(p_profile - 'dob' - 'gender');
  v_cur := jsonb_build_object('height_cm', a.height_cm, 'weight_kg', a.weight_kg, 'position_pref', a.position_pref,
                              'jersey_size', a.jersey_size, 'preferred_jersey_number', a.preferred_jersey_number);
  for k in select jsonb_object_keys(v_sp) loop
    if (v_sp->>k) is distinct from (v_cur->>k) then v_sports := v_sports || jsonb_build_object(k, v_sp->k); end if;
  end loop;
  if nullif(btrim(coalesce(p_profile->>'dob', '')), '') is not null then
    v_dob := public.participant_read_dob(p_profile, a.org_id);
    if v_dob is distinct from a.dob then v_elig := v_elig || jsonb_build_object('dob', v_dob); end if;
  end if;
  v_sex := lower(nullif(btrim(coalesce(p_profile->>'gender', '')), ''));
  if v_sex is not null then
    if v_sex not in ('male', 'female') then raise exception 'INVALID_SEX' using errcode = 'P0001'; end if;
    if v_sex is distinct from lower(btrim(coalesce(a.gender, ''))) then v_elig := v_elig || jsonb_build_object('gender', v_sex); end if;
  end if;
  if v_sports <> '{}'::jsonb then v_out := v_out || jsonb_build_object('sports', v_sports); end if;
  if v_elig <> '{}'::jsonb then v_out := v_out || jsonb_build_object('eligibility', v_elig); end if;
  return nullif(v_out, '{}'::jsonb);
end $$;

-- club_request_submit: as before, plus
--   * family_id may be omitted when athlete_id is given (the athlete's family;
--     the base still checks the caller is its guardian),
--   * payload.profile = proposed details (stored pending, never applied here).
create or replace function public.club_request_submit(p_payload jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb) - 'profile';
  v_profile jsonb := p_payload->'profile';
  v_res     jsonb;
  v_fam     uuid;
  v_ath     uuid;
  v_prop    jsonb;
  v_id      uuid;
begin
  if coalesce(v_payload->>'family_id', '') = '' and coalesce(v_payload->>'athlete_id', '') <> '' then
    begin
      select family_id into v_fam from public.athletes
       where id = (v_payload->>'athlete_id')::uuid and org_id = public.current_org_id();
    exception when others then v_fam := null; end;
    if v_fam is not null then v_payload := v_payload || jsonb_build_object('family_id', v_fam); end if;
  end if;
  v_res := public.club_request_submit_base(v_payload, p_request_id);
  v_id := (v_res->>'id')::uuid;
  if coalesce((v_res->>'replayed')::boolean, false) then
    return v_res || jsonb_build_object('proposed_profile', (select proposed_profile from public.club_approval_requests where id = v_id));
  end if;
  if v_profile is null or jsonb_typeof(v_profile) <> 'object' or v_profile = '{}'::jsonb then return v_res; end if;
  v_ath := nullif(v_res->>'athlete_id', '')::uuid;
  if v_ath is null then raise exception 'ATHLETE_REQUIRED' using errcode = 'P0001'; end if;
  v_prop := public.club_profile_proposal(v_ath, v_profile);
  if v_prop is not null then
    update public.club_approval_requests set proposed_profile = v_prop where id = v_id;
    insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
    values (public.current_org_id(), auth.uid(), 'athlete.profile.proposal.submitted', 'athletes', v_ath,
            v_prop || jsonb_build_object('_meta', jsonb_build_object('club_request_id', v_id, 'via', 'family')));
  end if;
  return v_res || jsonb_build_object('proposed_profile', v_prop);
end $$;

-- Apply an approved proposal (internal; called by club_request_decide).
create or replace function public.club_profile_apply(p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r        public.club_approval_requests%rowtype;
  a        public.athletes%rowtype;
  v_sp     jsonb;
  v_el     jsonb;
  v_before jsonb := '{}'::jsonb;
  k        text;
  v_cur    jsonb;
  v_impact jsonb;
  v_req    uuid;
  v_num    int;
  v_reg    public.registrations%rowtype;
  t        record;
  v_teams  jsonb := '[]'::jsonb;
  v_state  text;
  v_jersey jsonb;
  v_out    jsonb;
begin
  select * into r from public.club_approval_requests where id = p_request;
  select * into a from public.athletes where id = r.athlete_id for update;
  if r.proposed_profile is null or a.id is null then return null; end if;
  v_sp := coalesce(r.proposed_profile->'sports', '{}'::jsonb);
  v_el := coalesce(r.proposed_profile->'eligibility', '{}'::jsonb);

  perform set_config('app.profile_change_via', 'club_approval', true);
  perform set_config('app.profile_change_reason', 'club_request:' || r.id::text, true);

  -- Sports fields: the confirmed values, at once.
  if v_sp <> '{}'::jsonb then
    v_cur := jsonb_build_object('height_cm', a.height_cm, 'weight_kg', a.weight_kg, 'position_pref', a.position_pref,
                                'jersey_size', a.jersey_size, 'preferred_jersey_number', a.preferred_jersey_number);
    for k in select jsonb_object_keys(v_sp) loop v_before := v_before || jsonb_build_object(k, v_cur->k); end loop;
    perform public.participant_apply_sports(a.id, v_sp);
  end if;

  -- DOB / sex: the existing correction path (applied only when staff approve).
  if v_el <> '{}'::jsonb then
    v_impact := public.participant_enrollment_impact(a.id, coalesce((v_el->>'dob')::date, a.dob), coalesce(v_el->>'gender', a.gender));
    update public.athlete_change_requests set status = 'withdrawn', decided_at = now(), decided_by = auth.uid(), decision_note = 'superseded'
     where athlete_id = a.id and status = 'pending';
    update public.data_review_flags set resolved_at = now(), resolved_by = auth.uid(), resolution_note = 'superseded'
     where org_id = a.org_id and entity_table = 'athlete_change_requests' and resolved_at is null
       and entity_id in (select id from public.athlete_change_requests where athlete_id = a.id and decision_note = 'superseded');
    insert into public.athlete_change_requests (org_id, athlete_id, requested_by, changes, previous, impact)
    values (a.org_id, a.id, r.requested_by, v_el, jsonb_build_object('dob', a.dob, 'gender', a.gender), v_impact)
    returning id into v_req;
    perform public.bk_flag(a.org_id, 'athlete_change_requests', v_req, 'ATHLETE_ELIGIBILITY_CHANGE',
                           jsonb_build_object('athlete_id', a.id, 'change_request_id', v_req, 'club_request_id', r.id));
  end if;

  -- Preferred number -> the new roster row(s) of a club programme, if free.
  v_num := nullif(v_sp->>'preferred_jersey_number', '')::int;
  if v_num is not null and r.subject_kind = 'program_registration' then
    select * into v_reg from public.registrations where id = r.registration_id;
    for t in select tm.id as tid, tm2.id as tm_id, tm2.jersey_number as current_number, tm.name
               from public.teams tm
               left join public.team_memberships tm2 on tm2.team_id = tm.id and tm2.athlete_id = a.id
              where tm.program_id = r.program_id and tm.org_id = r.org_id and tm.is_active
              order by tm.name loop
      if exists (select 1 from public.team_memberships x where x.team_id = t.tid and x.jersey_number = v_num
                    and x.status <> 'inactive' and x.athlete_id <> a.id) then
        v_state := 'taken';
      elsif t.tm_id is not null then
        if t.current_number is null then
          begin
            update public.team_memberships set jersey_number = v_num where id = t.tm_id;
            v_state := 'assigned';
          exception when unique_violation then v_state := 'taken';
          end;
        else
          v_state := case when t.current_number = v_num then 'assigned' else 'kept_existing' end;
        end if;
      else
        -- Joins the roster once the registration is confirmed (paid).
        v_state := 'reserved';
      end if;
      v_teams := v_teams || jsonb_build_object('team_id', t.tid, 'team_name', t.name, 'status', v_state);
    end loop;
    v_jersey := jsonb_build_object('number', v_num, 'teams', v_teams,
                                   'status', case when jsonb_array_length(v_teams) = 0 then 'no_team'
                                                  when exists (select 1 from jsonb_array_elements(v_teams) e where e->>'status' = 'taken') then 'taken'
                                                  when exists (select 1 from jsonb_array_elements(v_teams) e where e->>'status' = 'reserved') then 'reserved'
                                                  else 'assigned' end);
  end if;

  v_out := jsonb_build_object('status', 'approved', 'applied', v_sp, 'previous', v_before,
                              'eligibility', case when v_req is null then null else jsonb_build_object('status', 'review_pending', 'change_request_id', v_req, 'changes', v_el) end,
                              'jersey', v_jersey, 'decided_at', now());
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (r.org_id, auth.uid(), 'athlete.profile.proposal.approved', 'athletes', a.id, v_before,
          v_sp || jsonb_build_object('_meta', jsonb_build_object('club_request_id', r.id, 'via', 'club_approval',
                                                                  'eligibility_review', v_req, 'jersey', v_jersey)));
  perform set_config('app.profile_change_via', '', true);
  perform set_config('app.profile_change_reason', '', true);
  return v_out;
end $$;

-- club_request_decide: as before; then, once (not on replays), apply an
-- approved proposal or record that a decline applied nothing.
create or replace function public.club_request_decide(p_id uuid, p_decision text, p_message text default null, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res jsonb;
  r     public.club_approval_requests%rowtype;
  v_out jsonb;
begin
  v_res := public.club_request_decide_base(p_id, p_decision, p_message, p_request_id);
  select * into r from public.club_approval_requests where id = p_id;
  if r.proposed_profile is null then return v_res; end if;
  if coalesce((v_res->>'replayed')::boolean, false) or not coalesce((v_res->>'decided')::boolean, false)
     or r.profile_outcome is not null or r.status not in ('approved', 'declined') then
    return v_res || jsonb_build_object('profile', r.profile_outcome);
  end if;
  if r.status = 'approved' then
    v_out := public.club_profile_apply(r.id);
  else
    v_out := jsonb_build_object('status', 'declined', 'applied', '{}'::jsonb, 'decided_at', now());
    insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
    values (r.org_id, auth.uid(), 'athlete.profile.proposal.declined', 'athletes', r.athlete_id,
            r.proposed_profile || jsonb_build_object('_meta', jsonb_build_object('club_request_id', r.id, 'via', 'club_approval')));
  end if;
  update public.club_approval_requests set profile_outcome = v_out where id = r.id;
  return v_res || jsonb_build_object('profile', v_out);
end $$;

-- The roster row of a paid programme is created on confirmation: put the
-- reserved number on it if it is still free (after the roster trigger).
create or replace function public.registrations_profile_jersey()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r      public.club_approval_requests%rowtype;
  v_num  int;
  v_teams jsonb := '[]'::jsonb;
  e      jsonb;
  v_tm   uuid;
  v_st   text;
begin
  if new.status::text <> 'confirmed' or old.status::text = 'confirmed' then return null; end if;
  select * into r from public.club_approval_requests q
   where q.registration_id = new.id and q.org_id = new.org_id and q.status = 'approved'
     and q.profile_outcome->'jersey'->>'status' = 'reserved'
   limit 1;
  if not found then return null; end if;
  v_num := (r.profile_outcome->'jersey'->>'number')::int;
  for e in select * from jsonb_array_elements(r.profile_outcome->'jersey'->'teams') loop
    v_st := e->>'status';
    if v_st = 'reserved' then
      select id into v_tm from public.team_memberships
       where team_id = (e->>'team_id')::uuid and athlete_id = new.athlete_id and jersey_number is null and status <> 'inactive';
      if v_tm is null then
        v_st := 'kept_existing';
      elsif exists (select 1 from public.team_memberships x where x.team_id = (e->>'team_id')::uuid and x.jersey_number = v_num
                       and x.status <> 'inactive' and x.athlete_id <> new.athlete_id) then
        v_st := 'taken';
      else
        begin
          update public.team_memberships set jersey_number = v_num where id = v_tm;
          v_st := 'assigned';
        exception when unique_violation then v_st := 'taken';
        end;
      end if;
    end if;
    v_teams := v_teams || (e || jsonb_build_object('status', v_st));
  end loop;
  update public.club_approval_requests
     set profile_outcome = jsonb_set(profile_outcome, '{jersey}', (profile_outcome->'jersey') || jsonb_build_object(
           'teams', v_teams,
           'status', case when exists (select 1 from jsonb_array_elements(v_teams) x where x->>'status' = 'taken') then 'taken' else 'assigned' end))
   where id = r.id;
  return null;
end $$;

drop trigger if exists trg_registrations_profile_jersey on public.registrations;
create trigger trg_registrations_profile_jersey
  after update of status on public.registrations
  for each row execute function public.registrations_profile_jersey();

-- Current vs proposed values for the reviewer / family. Coaches see the
-- sports fields only; DOB / sex only for admins and the family.
create or replace function public.club_request_profile_view(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r      public.club_approval_requests%rowtype;
  a      public.athletes%rowtype;
  v_full boolean;
  v_prop jsonb;
  v_out  jsonb;
begin
  select * into r from public.club_approval_requests where id = p_id;
  if r.proposed_profile is null or r.athlete_id is null then return null; end if;
  select * into a from public.athletes where id = r.athlete_id;
  v_full := public.is_admin() or public.is_guardian_of_family(r.family_id);
  v_prop := case when v_full then r.proposed_profile else r.proposed_profile - 'eligibility' end;
  v_out := r.profile_outcome;
  if v_out is not null and not v_full then v_out := v_out - 'eligibility'; end if;
  return jsonb_build_object(
    'proposed', v_prop,
    'current', jsonb_build_object('height_cm', a.height_cm, 'weight_kg', a.weight_kg, 'position_pref', a.position_pref,
                                  'jersey_size', a.jersey_size, 'preferred_jersey_number', a.preferred_jersey_number)
               || case when v_full then jsonb_build_object('dob', a.dob, 'gender', a.gender) else '{}'::jsonb end,
    'outcome', v_out);
end $$;

create or replace function public.club_request_row(p_id uuid, p_staff boolean)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.club_request_row_base(p_id, p_staff) || jsonb_build_object('profile', public.club_request_profile_view(p_id));
$$;

-- ===========================================================================
-- 8) Profile history (admin only)
-- ===========================================================================
create or replace function public.athlete_profile_history(p_athlete uuid, p_limit int default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id();
begin
  if auth.uid() is null or v_org is null or not public.is_admin()
     or not exists (select 1 from public.athletes where id = p_athlete and org_id = v_org) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', l.id, 'at', l.created_at, 'action', l.action, 'actor_name', p.full_name,
             'via', coalesce(l.new_data->'_meta'->>'via', l.new_data->>'via'),
             'reason', coalesce(l.new_data->'_meta'->>'reason', l.new_data->'_meta'->>'club_request_id'),
             'before', coalesce(l.old_data, '{}'::jsonb) - '_meta',
             'after', coalesce(l.new_data, '{}'::jsonb) - '_meta') order by l.created_at desc, l.id desc)
      from (select * from public.audit_logs l
             where l.org_id = v_org
               and ((l.target_table = 'athletes' and l.target_id = p_athlete and l.action like 'athlete.%'
                     and l.action <> 'athlete.eligibility.changed')
                    or (l.action like 'participant.link.%' and l.new_data->>'athlete_id' = p_athlete::text))
             order by l.created_at desc, l.id desc
             limit greatest(1, least(coalesce(p_limit, 200), 500))) l
      left join public.profiles p on p.id = l.actor_id), '[]'::jsonb);
end $$;

-- ===========================================================================
-- 9) Grants
-- ===========================================================================
do $$
declare f text;
begin
  -- Internal: definer callers only.
  foreach f in array array[
    'athlete_profile_fields()', 'athlete_profile_via(uuid)', 'athletes_profile_audit()', 'athlete_change_requests_profile_audit()',
    'athletes_finance_profile_guard()', 'athlete_data_check_org(uuid)', 'athlete_fk_columns()', 'athlete_merge_card(uuid)',
    'club_request_submit_base(jsonb, uuid)', 'club_request_decide_base(uuid, text, text, uuid)', 'club_request_row_base(uuid, boolean)',
    'club_request_row(uuid, boolean)', 'club_profile_proposal(uuid, jsonb)', 'club_profile_apply(uuid)',
    'registrations_profile_jersey()', 'club_request_profile_view(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', f);
    end if;
  end loop;
  -- RPCs: signed-in users (each checks the caller, role and club).
  foreach f in array array[
    'my_athlete_ids()', 'my_athlete_resolve(uuid)', 'my_athletes()', 'athlete_data_check()',
    'athlete_self_link_decide(uuid, text)', 'athlete_merge(uuid, uuid, text, uuid)', 'athlete_duplicate_pairs()',
    'club_request_submit(jsonb, uuid)', 'club_request_decide(uuid, text, text, uuid)',
    'athlete_profile_history(uuid, integer)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function public.%s to authenticated, service_role', f);
    end if;
  end loop;
end $$;
