-- ============================================================================
-- Flexible link access, manual registrations, finance scope on athletes
--
--   1. athlete_guardian_links: per-child access for a relative / friend
--      ("This child only"). One active link per (athlete, adult). Permissions
--      can_register, can_pay, can_see_medical, receives_emails,
--      can_edit_profile. Writes through RPCs only, audited, RLS on every verb.
--   2. Helpers: athlete_link_can(athlete, permission) for the signed-in adult;
--      the guardian model (is_guardian_of_athlete / _family) stays strictly
--      family-scoped, so a per-child linker never reaches siblings, family,
--      family billing, documents or consents. Explicit grants:
--        * athletes row of that child (athletes_link_select),
--        * medical only with can_see_medical (guardian_can_see_medical),
--        * profile edits only with can_edit_profile (participant_can_manage),
--        * bookings only with can_register, through the existing "someone
--          else" flow: a participant_bookers row (scope 'linked') + a guardian
--          consent request addressed to the child's family guardians
--          (existing_child); the invoice goes to the linker as payer
--          (billing_payers kind 'other'), never to the family.
--   3. participant_link_decide(..., p_permissions.scope = 'family' | 'athlete')
--      + athlete_links_for / athlete_link_update / athlete_link_revoke;
--      my_athlete_ids / my_athletes include linked children (kind 'linked').
--   4. Data checks: a staff-created athlete without a guardian login is an
--      informational NO_GUARDIAN_LOGIN suggestion, never a problem flag;
--      resolved / dismissed findings are never raised again. Open
--      ATHLETE_WITHOUT_GUARDIAN flags are reclassified (resolved with a note,
--      history kept).
--   5. Finance: no direct read of the athletes table; billing_athletes view
--      (identity + family + status + sponsorship columns, caller's club,
--      admin / finance only); sponsorship writes through
--      athlete_sponsorship_set().
--
-- Additive and idempotent. SYNTHETIC test data only (tests/db/flexible_links.sql).
-- ============================================================================

-- ===========================================================================
-- 1) Per-child links
-- ===========================================================================
create table if not exists public.athlete_guardian_links (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  athlete_id        uuid not null references public.athletes(id) on delete cascade,
  profile_id        uuid not null references public.profiles(id) on delete cascade,
  relation          text not null default 'other_carer',
  can_register      boolean not null default true,
  can_pay           boolean not null default true,
  can_see_medical   boolean not null default false,
  receives_emails   boolean not null default true,
  can_edit_profile  boolean not null default false,
  status            text not null default 'active',
  granted_by        uuid references public.profiles(id) on delete set null,
  granted_at        timestamptz not null default now(),
  revoked_by        uuid references public.profiles(id) on delete set null,
  revoked_at        timestamptz,
  revoke_reason     text,
  link_request_id   uuid references public.athlete_link_requests(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint athlete_guardian_links_status_chk check (status in ('active', 'revoked')),
  constraint athlete_guardian_links_relation_chk check (relation in ('aunt_uncle', 'grandparent', 'adult_sibling', 'family_friend', 'other_carer')),
  -- A linker's bookings are invoiced to them (never to the family): booking needs payment.
  constraint athlete_guardian_links_register_pay_chk check (not can_register or can_pay),
  constraint athlete_guardian_links_reason_chk check (revoke_reason is null or length(revoke_reason) <= 500)
);
create index if not exists idx_athlete_guardian_links_org on public.athlete_guardian_links(org_id);
create index if not exists idx_athlete_guardian_links_profile on public.athlete_guardian_links(profile_id, status);
create index if not exists idx_athlete_guardian_links_athlete on public.athlete_guardian_links(athlete_id, status);
create unique index if not exists athlete_guardian_links_active_uidx
  on public.athlete_guardian_links(athlete_id, profile_id) where status = 'active';

drop trigger if exists trg_athlete_guardian_links_updated on public.athlete_guardian_links;
create trigger trg_athlete_guardian_links_updated before update on public.athlete_guardian_links
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_athlete_guardian_links on public.athlete_guardian_links;
create trigger trg_audit_athlete_guardian_links after insert or update or delete on public.athlete_guardian_links
  for each row execute function public.ca_audit_trigger();

alter table public.athlete_guardian_links enable row level security;
alter table public.athlete_guardian_links force row level security;

drop policy if exists platform_tenant_isolation on public.athlete_guardian_links;
create policy platform_tenant_isolation on public.athlete_guardian_links as restrictive for all
  using (org_id = (select public.current_org_id())) with check (org_id = (select public.current_org_id()));
-- The linked adult reads their own links; the child's family guardians and
-- the club's admins read the child's links. Writes: RPCs only.
drop policy if exists athlete_guardian_links_select on public.athlete_guardian_links;
create policy athlete_guardian_links_select on public.athlete_guardian_links for select
  using (profile_id = auth.uid()
         or public.is_guardian_of_athlete(athlete_id)
         or (org_id = public.current_org_id() and public.is_admin()));
drop policy if exists athlete_guardian_links_insert on public.athlete_guardian_links;
create policy athlete_guardian_links_insert on public.athlete_guardian_links for insert with check (false);
drop policy if exists athlete_guardian_links_update on public.athlete_guardian_links;
create policy athlete_guardian_links_update on public.athlete_guardian_links for update using (false) with check (false);
drop policy if exists athlete_guardian_links_delete on public.athlete_guardian_links;
create policy athlete_guardian_links_delete on public.athlete_guardian_links for delete using (false);

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.athlete_guardian_links from anon;
    grant select on public.athlete_guardian_links to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.athlete_guardian_links to service_role;
  end if;
end $$;

-- participant_bookers carries the linker's booking identity (scope 'linked').
do $$ begin
  alter table public.participant_bookers drop constraint if exists participant_bookers_scope_chk;
  alter table public.participant_bookers add constraint participant_bookers_scope_chk check (scope in ('status_only', 'linked'));
end $$;

-- ===========================================================================
-- 2) Helpers
-- ===========================================================================
-- Active per-child link of the signed-in adult, current club, live athlete.
-- p_permission: view | register | pay | medical | emails | edit_profile.
create or replace function public.athlete_link_can(p_athlete uuid, p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_athlete is not null and auth.uid() is not null and exists (
    select 1 from public.athlete_guardian_links l
      join public.athletes a on a.id = l.athlete_id
     where l.athlete_id = p_athlete and l.profile_id = auth.uid() and l.status = 'active'
       and l.org_id = public.current_org_id() and a.org_id = l.org_id
       and a.archived_at is null and a.merged_into_id is null and a.status not in ('erased', 'archived')
       and case p_permission
             when 'view' then true
             when 'register' then l.can_register
             when 'pay' then l.can_pay
             when 'medical' then l.can_see_medical
             when 'emails' then l.receives_emails
             when 'edit_profile' then l.can_edit_profile
             else false end);
$$;

-- Family guardian OR active per-child linker (any permission): who may see the
-- child at all. Family-wide data keeps using the strict family helpers.
create or replace function public.can_view_athlete(p_athlete uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_guardian_of_athlete(p_athlete) or public.athlete_link_can(p_athlete, 'view');
$$;

-- Medical: a family guardian with can_see_medical, or a linker with it.
create or replace function public.guardian_can_see_medical(p_athlete uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.athletes a join public.family_members fm on fm.family_id = a.family_id
     where a.id = p_athlete and fm.profile_id = auth.uid() and fm.can_see_medical
       and a.org_id = public.current_org_id())
      or public.athlete_link_can(p_athlete, 'medical');
$$;

-- Profile edits (participant_update / _sports / corrections): family guardian,
-- self, or a linker with can_edit_profile.
create or replace function public.participant_can_manage(p_athlete uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_guardian_of_athlete(p_athlete)
      or exists (select 1 from public.athletes a
                  where a.id = p_athlete and a.player_profile_id = auth.uid() and a.org_id = public.current_org_id())
      or public.athlete_link_can(p_athlete, 'edit_profile');
$$;

-- A booker of a "someone else" participant; a 'linked' booker row counts only
-- while the per-child link is active with can_register (revocation is immediate).
create or replace function public.gc_is_booker(p_athlete uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.participant_bookers b
                  where b.athlete_id = p_athlete and b.profile_id = auth.uid() and b.org_id = public.current_org_id()
                    and (b.scope <> 'linked' or public.athlete_link_can(b.athlete_id, 'register')));
$$;

-- The picker's "Someone else" list never repeats linked children (they come
-- from my_athletes() as kind 'linked').
create or replace function public.booker_participants()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('athlete_id', b.athlete_id, 'name', b.display_name, 'dob', b.display_dob)
                            order by b.display_name), '[]'::jsonb)
    from public.participant_bookers b
   where b.profile_id = auth.uid() and b.org_id = public.current_org_id() and b.scope <> 'linked';
$$;

-- Link relation -> consent-request / booker relation vocabulary.
create or replace function public.athlete_link_gc_relation(p_relation text)
returns text language sql immutable set search_path = public as $$
  select case p_relation when 'aunt_uncle' then 'nephew_niece' when 'family_friend' then 'friends_child' else 'other' end;
$$;

-- Keep the linker's booker row in step with the link (create while active +
-- can_register; remove otherwise, and cancel pending holds on revocation).
create or replace function public.athlete_link_sync_booker(p_link uuid)
returns void language plpgsql security definer set search_path = public as $$
declare l public.athlete_guardian_links%rowtype; a public.athletes%rowtype; q record;
begin
  select * into l from public.athlete_guardian_links where id = p_link;
  if not found then return; end if;
  if l.status = 'active' and l.can_register then
    select * into a from public.athletes where id = l.athlete_id;
    insert into public.participant_bookers (org_id, athlete_id, profile_id, scope, relation, display_name, display_dob)
    values (l.org_id, l.athlete_id, l.profile_id, 'linked', public.athlete_link_gc_relation(l.relation),
            left(btrim(a.first_name || ' ' || a.last_name), 170), a.dob)
    on conflict (athlete_id, profile_id) do update
       set scope = 'linked', relation = excluded.relation, display_name = excluded.display_name, display_dob = excluded.display_dob;
  else
    delete from public.participant_bookers
     where athlete_id = l.athlete_id and profile_id = l.profile_id and scope = 'linked';
    -- Pending holds of this linker for this child end now (place freed).
    for q in select id from public.guardian_consent_requests
              where athlete_id = l.athlete_id and booker_profile_id = l.profile_id and status = 'pending' loop
      perform public.gc_cancel_items(q.id, 'revoked', 'link access ended');
      update public.guardian_consent_requests set status = 'revoked', revoked_at = now() where id = q.id;
    end loop;
  end if;
end $$;

-- Guardian contact of a child's family for a consent request: the primary
-- guardian (then any guardian) with a valid e-mail, else the family contact.
create or replace function public.athlete_family_consent_contact(p_athlete uuid, out name text, out email citext)
language plpgsql stable security definer set search_path = public as $$
declare v_fam uuid;
begin
  select family_id into v_fam from public.athletes where id = p_athlete;
  select left(coalesce(nullif(btrim(p.full_name), ''), f.name), 140), lower(p.email::text)::citext into name, email
    from public.family_members fm join public.profiles p on p.id = fm.profile_id join public.families f on f.id = fm.family_id
   where fm.family_id = v_fam and p.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
   order by fm.is_primary desc, fm.created_at limit 1;
  if email is null then
    select left(coalesce(nullif(btrim(f.contact_name), ''), f.name), 140), lower(f.contact_email::text)::citext into name, email
      from public.families f where f.id = v_fam and f.contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';
  end if;
end $$;

-- The pending request of (booker, athlete), else a new one: from the last
-- request (someone else), or — for an active per-child linker — addressed to
-- the child's family guardians (existing_child: only they can consent).
create or replace function public.gc_open_request(p_org uuid, p_booker uuid, p_athlete uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; r public.guardian_consent_requests%rowtype; l public.athlete_guardian_links%rowtype; c record;
begin
  perform public.gc_expire_due(null);
  select id into v_id from public.guardian_consent_requests
   where org_id = p_org and booker_profile_id = p_booker and athlete_id = p_athlete and status = 'pending'
   for update;
  if v_id is not null then return v_id; end if;
  select * into l from public.athlete_guardian_links
   where org_id = p_org and athlete_id = p_athlete and profile_id = p_booker and status = 'active' and can_register;
  if l.id is not null then
    select * into c from public.athlete_family_consent_contact(p_athlete);
    if c.email is null then raise exception 'NO_GUARDIAN_CONTACT' using errcode = 'P0001'; end if;
    insert into public.guardian_consent_requests
      (org_id, athlete_id, booker_profile_id, guardian_name, guardian_email, relation, existing_child)
    values (p_org, p_athlete, p_booker, coalesce(c.name, 'Guardian'), c.email, public.athlete_link_gc_relation(l.relation), true)
    returning id into v_id;
    return v_id;
  end if;
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

-- ===========================================================================
-- 3) Policies: athletes (link read, finance out), medical writes family-only
-- ===========================================================================
-- Before: is_finance() (admin OR finance) read every column of every athlete.
-- Now: admins of the club, the child's family guardians, the child's coaches,
-- and an active per-child linker. Finance reads billing_athletes.
drop policy if exists athletes_select on public.athletes;
create policy athletes_select on public.athletes for select
  using ((org_id = public.current_org_id() and public.is_admin())
         or public.is_guardian_of_athlete(id)
         or public.coach_can_access_athlete(id));
drop policy if exists athletes_link_select on public.athletes;
create policy athletes_link_select on public.athletes for select
  using (public.athlete_link_can(id, 'view'));
-- Table writes: admins only (finance: sponsorship RPC below).
drop policy if exists athletes_admin_write on public.athletes;
create policy athletes_admin_write on public.athletes for all
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());

-- Medical writes stay with the family (a linker with can_see_medical reads only).
drop policy if exists medical_guardian_write on public.athlete_medical;
create policy medical_guardian_write on public.athlete_medical for all
  using (public.is_guardian_of_athlete(athlete_id) and public.guardian_can_see_medical(athlete_id))
  with check (public.is_guardian_of_athlete(athlete_id) and public.guardian_can_see_medical(athlete_id));

-- ===========================================================================
-- 4) Finance: billing columns only
-- ===========================================================================
-- Runs with the owner's rights and filters on the caller itself (tenant from
-- the session, admin / finance role): identity, family, status, sponsorship,
-- licence fee (billed).
-- No DOB, sex, sports profile, school, nationality, notes, photo, licence.
create or replace view public.billing_athletes
with (security_barrier = true)
as
  select a.id, a.org_id, a.family_id, a.first_name, a.last_name, a.status, a.archived_at, a.merged_into_id, a.created_at,
         a.sponsorship_kind, a.sponsorship_percent, a.sponsorship_scope, a.sponsor_name, a.sponsorship_reason,
         a.sponsorship_from, a.sponsorship_until, a.sponsored_at, a.licence_fee
    from public.athletes a
   where a.org_id = public.current_org_id()
     and public.is_finance();

comment on view public.billing_athletes is
  'Finance read path of athletes: identity, family, status and sponsorship of the caller''s club (admin / finance only).';

revoke all on public.billing_athletes from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on public.billing_athletes from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then grant select on public.billing_athletes to authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant select on public.billing_athletes to service_role; end if;
end $$;

-- Sponsorship (admin / finance): one athlete, or every live player of a family.
-- Only the sponsorship columns change; the guard trigger stamps and audits.
create or replace function public.athlete_sponsorship_set(p_athlete uuid, p_family uuid, p_row jsonb)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id(); v_ids uuid[];
begin
  if auth.uid() is null or v_org is null or not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if (p_athlete is null) = (p_family is null) then raise exception 'INVALID_TARGET' using errcode = 'P0001'; end if;
  with u as (
    update public.athletes a set
      sponsorship_kind = coalesce(p_row->>'sponsorship_kind', 'none'),
      sponsorship_percent = nullif(p_row->>'sponsorship_percent', '')::numeric,
      sponsorship_scope = case when p_row ? 'sponsorship_scope'
                               then coalesce((select array_agg(x) from jsonb_array_elements_text(p_row->'sponsorship_scope') x), '{}')
                               else a.sponsorship_scope end,
      sponsor_name = nullif(p_row->>'sponsor_name', ''),
      sponsorship_reason = nullif(p_row->>'sponsorship_reason', ''),
      sponsorship_from = nullif(p_row->>'sponsorship_from', '')::date,
      sponsorship_until = nullif(p_row->>'sponsorship_until', '')::date
     where a.org_id = v_org
       and ((p_athlete is not null and a.id = p_athlete)
            or (p_family is not null and a.family_id = p_family and a.status <> 'archived'))
    returning a.id)
  select coalesce(array_agg(id), '{}') into v_ids from u;
  return v_ids;
end $$;

-- ===========================================================================
-- 5) Link decisions, list, update, revoke
-- ===========================================================================
-- p_permissions: { scope: 'family' | 'athlete', relation?, can_register?,
--   can_pay?, can_see_medical?, receives_emails?, can_edit_profile? }.
-- 'family' (default) = the second-parent behaviour (family_members row);
-- 'athlete' = this child only (athlete_guardian_links).
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
  v_scope text := coalesce(nullif(p_permissions->>'scope', ''), 'family');
  v_rel   text;
  v_link  uuid;
begin
  select * into r from public.athlete_link_requests where id = p_request for update;
  if not found or r.org_id is distinct from public.current_org_id() then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  v_staff := public.is_admin();
  v_guard := public.is_guardian_of_athlete(r.athlete_id) and auth.uid() <> r.requester_profile_id;
  if not (v_staff or v_guard) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_decision not in ('approve', 'decline') then raise exception 'INVALID_DECISION' using errcode = 'P0001'; end if;
  if v_scope not in ('family', 'athlete') then raise exception 'INVALID_SCOPE' using errcode = 'P0001'; end if;
  if p_note is not null and length(p_note) > 1000 then raise exception 'TOO_LONG' using errcode = 'P0001'; end if;
  select family_id into v_fam from public.athletes where id = r.athlete_id;
  if r.status <> 'pending' then
    return jsonb_build_object('ok', true, 'status', r.status, 'replayed', true, 'requester_profile_id', r.requester_profile_id);
  end if;
  if r.expires_at <= now() then
    update public.athlete_link_requests set status = 'expired' where id = r.id;
    return jsonb_build_object('ok', false, 'code', 'EXPIRED', 'status', 'expired');
  end if;

  if p_decision = 'approve' and v_scope = 'family' then
    v_perm := jsonb_build_object(
      'scope', 'family',
      'can_pay', coalesce((p_permissions->>'can_pay')::boolean, false),
      'can_see_medical', coalesce((p_permissions->>'can_see_medical')::boolean, false),
      'receives_emails', coalesce((p_permissions->>'receives_emails')::boolean, true));
    insert into public.family_members (family_id, profile_id, relation, is_primary, can_pay, can_see_medical, receives_emails)
    values (v_fam, r.requester_profile_id, case when r.relation = 'other' then 'guardian' else r.relation end, false,
            (v_perm->>'can_pay')::boolean, (v_perm->>'can_see_medical')::boolean, (v_perm->>'receives_emails')::boolean)
    on conflict (family_id, profile_id) do nothing;
    -- A per-child link of the same adult is superseded by the family access.
    for v_link in select id from public.athlete_guardian_links
                   where org_id = r.org_id and profile_id = r.requester_profile_id and status = 'active'
                     and athlete_id in (select id from public.athletes where family_id = v_fam) loop
      update public.athlete_guardian_links
         set status = 'revoked', revoked_by = auth.uid(), revoked_at = now(), revoke_reason = 'superseded by family access'
       where id = v_link;
      perform public.athlete_link_sync_booker(v_link);
    end loop;
    v_status := 'approved';
  elsif p_decision = 'approve' then
    v_rel := coalesce(nullif(p_permissions->>'relation', ''), 'other_carer');
    if v_rel not in ('aunt_uncle', 'grandparent', 'adult_sibling', 'family_friend', 'other_carer') then
      raise exception 'INVALID_RELATION' using errcode = 'P0001';
    end if;
    v_perm := jsonb_build_object(
      'scope', 'athlete', 'relation', v_rel,
      'can_register', coalesce((p_permissions->>'can_register')::boolean, true),
      'can_pay', coalesce((p_permissions->>'can_pay')::boolean, true),
      'can_see_medical', coalesce((p_permissions->>'can_see_medical')::boolean, false),
      'receives_emails', coalesce((p_permissions->>'receives_emails')::boolean, true),
      'can_edit_profile', coalesce((p_permissions->>'can_edit_profile')::boolean, false));
    if (v_perm->>'can_register')::boolean and not (v_perm->>'can_pay')::boolean then
      raise exception 'REGISTER_NEEDS_PAY' using errcode = 'P0001';
    end if;
    -- Already a family guardian of this child: nothing to add.
    if not exists (select 1 from public.family_members where family_id = v_fam and profile_id = r.requester_profile_id) then
      select id into v_link from public.athlete_guardian_links
       where athlete_id = r.athlete_id and profile_id = r.requester_profile_id and status = 'active';
      if v_link is null then
        insert into public.athlete_guardian_links
          (org_id, athlete_id, profile_id, relation, can_register, can_pay, can_see_medical, receives_emails, can_edit_profile,
           granted_by, link_request_id)
        values (r.org_id, r.athlete_id, r.requester_profile_id, v_rel, (v_perm->>'can_register')::boolean,
                (v_perm->>'can_pay')::boolean, (v_perm->>'can_see_medical')::boolean, (v_perm->>'receives_emails')::boolean,
                (v_perm->>'can_edit_profile')::boolean, auth.uid(), r.id)
        returning id into v_link;
      else
        update public.athlete_guardian_links
           set relation = v_rel, can_register = (v_perm->>'can_register')::boolean, can_pay = (v_perm->>'can_pay')::boolean,
               can_see_medical = (v_perm->>'can_see_medical')::boolean, receives_emails = (v_perm->>'receives_emails')::boolean,
               can_edit_profile = (v_perm->>'can_edit_profile')::boolean, link_request_id = r.id
         where id = v_link;
      end if;
      perform public.athlete_link_sync_booker(v_link);
    end if;
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
                             'permissions', v_perm, 'scope', v_scope, 'link_id', v_link,
                             'via', case when v_guard then 'guardian' else 'staff' end));
  return jsonb_build_object('ok', true, 'status', v_status, 'replayed', false, 'scope', v_scope,
                            'requester_profile_id', r.requester_profile_id);
end $$;

-- Per-child links of a child: family guardians of the child and admins.
create or replace function public.athlete_links_for(p_athlete uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id();
begin
  if auth.uid() is null or v_org is null
     or not exists (select 1 from public.athletes where id = p_athlete and org_id = v_org)
     or not (public.is_admin() or public.is_guardian_of_athlete(p_athlete)) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', l.id, 'athlete_id', l.athlete_id, 'profile_id', l.profile_id, 'name', p.full_name, 'email', p.email,
             'relation', l.relation, 'status', l.status, 'can_register', l.can_register, 'can_pay', l.can_pay,
             'can_see_medical', l.can_see_medical, 'receives_emails', l.receives_emails, 'can_edit_profile', l.can_edit_profile,
             'granted_at', l.granted_at, 'revoked_at', l.revoked_at) order by l.status, l.granted_at desc)
      from public.athlete_guardian_links l join public.profiles p on p.id = l.profile_id
     where l.athlete_id = p_athlete and l.org_id = v_org), '[]'::jsonb);
end $$;

-- Per-child links over all children the caller guards (parent family page).
create or replace function public.athlete_links_mine_to_manage()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'athlete_id', l.athlete_id, 'athlete_first_name', a.first_name, 'name', p.full_name, 'email', p.email,
           'relation', l.relation, 'can_register', l.can_register, 'can_pay', l.can_pay, 'can_see_medical', l.can_see_medical,
           'receives_emails', l.receives_emails, 'can_edit_profile', l.can_edit_profile, 'granted_at', l.granted_at)
           order by a.first_name, l.granted_at), '[]'::jsonb)
    from public.athlete_guardian_links l
    join public.athletes a on a.id = l.athlete_id
    join public.profiles p on p.id = l.profile_id
   where l.org_id = public.current_org_id() and l.status = 'active'
     and public.is_guardian_of_athlete(l.athlete_id);
$$;

-- Change the permissions of an active link: a family guardian of the child or an admin.
create or replace function public.athlete_link_update(p_link uuid, p_permissions jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare l public.athlete_guardian_links%rowtype; v_new public.athlete_guardian_links%rowtype; v_rel text;
begin
  select * into l from public.athlete_guardian_links where id = p_link for update;
  if not found or l.org_id is distinct from public.current_org_id()
     or not (public.is_admin() or public.is_guardian_of_athlete(l.athlete_id)) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if l.status <> 'active' then raise exception 'LINK_NOT_ACTIVE' using errcode = 'P0001'; end if;
  v_rel := coalesce(nullif(p_permissions->>'relation', ''), l.relation);
  if v_rel not in ('aunt_uncle', 'grandparent', 'adult_sibling', 'family_friend', 'other_carer') then
    raise exception 'INVALID_RELATION' using errcode = 'P0001';
  end if;
  if coalesce((p_permissions->>'can_register')::boolean, l.can_register)
     and not coalesce((p_permissions->>'can_pay')::boolean, l.can_pay) then
    raise exception 'REGISTER_NEEDS_PAY' using errcode = 'P0001';
  end if;
  update public.athlete_guardian_links
     set relation = v_rel,
         can_register = coalesce((p_permissions->>'can_register')::boolean, can_register),
         can_pay = coalesce((p_permissions->>'can_pay')::boolean, can_pay),
         can_see_medical = coalesce((p_permissions->>'can_see_medical')::boolean, can_see_medical),
         receives_emails = coalesce((p_permissions->>'receives_emails')::boolean, receives_emails),
         can_edit_profile = coalesce((p_permissions->>'can_edit_profile')::boolean, can_edit_profile)
   where id = l.id
  returning * into v_new;
  perform public.athlete_link_sync_booker(l.id);
  perform public.ca_audit(l.org_id, 'participant.link.permissions', 'athlete_guardian_links', l.id,
    jsonb_build_object('athlete_id', l.athlete_id, 'profile_id', l.profile_id,
      'before', jsonb_build_object('relation', l.relation, 'can_register', l.can_register, 'can_pay', l.can_pay,
                                   'can_see_medical', l.can_see_medical, 'receives_emails', l.receives_emails,
                                   'can_edit_profile', l.can_edit_profile),
      'after', jsonb_build_object('relation', v_new.relation, 'can_register', v_new.can_register, 'can_pay', v_new.can_pay,
                                  'can_see_medical', v_new.can_see_medical, 'receives_emails', v_new.receives_emails,
                                  'can_edit_profile', v_new.can_edit_profile)));
  return jsonb_build_object('ok', true, 'id', l.id);
end $$;

-- Revoke (immediate): a family guardian of the child, an admin, or the linked adult themselves.
create or replace function public.athlete_link_revoke(p_link uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare l public.athlete_guardian_links%rowtype;
begin
  select * into l from public.athlete_guardian_links where id = p_link for update;
  if not found or l.org_id is distinct from public.current_org_id()
     or not (public.is_admin() or public.is_guardian_of_athlete(l.athlete_id) or l.profile_id = auth.uid()) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_reason is not null and length(p_reason) > 500 then raise exception 'TOO_LONG' using errcode = 'P0001'; end if;
  if l.status = 'revoked' then return jsonb_build_object('ok', true, 'id', l.id, 'replayed', true); end if;
  update public.athlete_guardian_links
     set status = 'revoked', revoked_by = auth.uid(), revoked_at = now(), revoke_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = l.id;
  perform public.athlete_link_sync_booker(l.id);
  perform public.ca_audit(l.org_id, 'participant.link.revoked', 'athlete_guardian_links', l.id,
    jsonb_build_object('athlete_id', l.athlete_id, 'profile_id', l.profile_id,
                       'via', case when l.profile_id = auth.uid() then 'self'
                                   when public.is_guardian_of_athlete(l.athlete_id) then 'guardian' else 'staff' end));
  return jsonb_build_object('ok', true, 'id', l.id, 'replayed', false);
end $$;

-- ===========================================================================
-- 6) My athletes: linked children (kind 'linked', restricted fields)
-- ===========================================================================
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
                      where fm.family_id = a.family_id and fm.profile_id = auth.uid() and f.org_id = a.org_id)
          or exists (select 1 from public.athlete_guardian_links l
                      where l.athlete_id = a.id and l.profile_id = auth.uid() and l.status = 'active' and l.org_id = a.org_id));
$$;

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
    select jsonb_agg(x.j order by x.ord, x.fn, x.ln)
      from (
        select case when not lk.linked then 0 else 1 end + case when a.player_profile_id = auth.uid() then -1 else 0 end ord,
               a.first_name fn, a.last_name ln,
               jsonb_build_object(
                 'id', a.id, 'first_name', a.first_name, 'last_name', a.last_name, 'dob', a.dob, 'gender', a.gender,
                 'status', a.status,
                 'family_id', case when lk.linked then null else a.family_id end,
                 'kind', case when a.player_profile_id = auth.uid() then 'self' when lk.linked then 'linked' else 'child' end,
                 'link', case when lk.linked then jsonb_build_object(
                           'id', lk.id, 'relation', lk.relation, 'can_register', lk.can_register, 'can_pay', lk.can_pay,
                           'can_see_medical', lk.can_see_medical, 'receives_emails', lk.receives_emails,
                           'can_edit_profile', lk.can_edit_profile) end,
                 'age', case when a.dob is null then null else extract(year from age(v_today, a.dob))::int end,
                 'sports', case when lk.linked and not lk.can_edit_profile then null
                                else jsonb_build_object('height_cm', a.height_cm, 'weight_kg', a.weight_kg, 'position_pref', a.position_pref,
                                                        'jersey_size', a.jersey_size, 'preferred_jersey_number', a.preferred_jersey_number) end,
                 'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'jersey_number', tm.jersey_number) order by t.name)
                                      from public.team_memberships tm join public.teams t on t.id = tm.team_id
                                     where tm.athlete_id = a.id and tm.org_id = v_org and tm.status <> 'inactive'
                                       and (tm.left_on is null or tm.left_on >= v_today)), '[]'::jsonb),
                 -- Family billing never reaches a linker: no balances.
                 'programmes', coalesce((select jsonb_agg(jsonb_build_object(
                                            'id', p.id, 'registration_id', r.id, 'name', p.name, 'kind', p.kind::text, 'status', r.status::text,
                                            'balance', case when lk.linked then null else public.club_request_invoice_open(r.invoice_id) end) order by p.name)
                                           from public.registrations r join public.programs p on p.id = r.program_id
                                           left join public.camp_editions e on e.id = r.camp_edition_id
                                          where r.athlete_id = a.id and r.org_id = v_org
                                            and r.status::text in ('pending', 'confirmed', 'pending_approval', 'waitlist')
                                            and coalesce(e.ends_on, p.ends_on, v_today) >= v_today), '[]'::jsonb),
                 'memberships', case when lk.linked then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
                                            'id', m.id, 'name', mt.name, 'status', m.status,
                                            'balance', public.club_request_invoice_open(m.invoice_id)) order by mt.name)
                                            from public.memberships m join public.membership_types mt on mt.id = m.membership_type_id
                                           where m.athlete_id = a.id and m.org_id = v_org and m.status in ('active', 'pending_payment')
                                             and m.valid_until >= v_today), '[]'::jsonb) end,
                 'requests', case when lk.linked then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
                                          'id', q.id, 'status', q.status, 'subject_kind', q.subject_kind,
                                          'name', coalesce(p.name, mt.name)) order by q.created_at desc)
                                         from public.club_approval_requests q
                                         left join public.programs p on p.id = q.program_id
                                         left join public.membership_types mt on mt.id = q.membership_type_id
                                        where q.athlete_id = a.id and q.org_id = v_org and q.status in ('pending', 'info_requested')), '[]'::jsonb) end,
                 'pending_corrections', case when lk.linked and not lk.can_edit_profile then 0
                                             else (select count(*) from public.athlete_change_requests c where c.athlete_id = a.id and c.status = 'pending') end
               ) j
          from public.athletes a
          cross join lateral (
            select l.id, l.relation, l.can_register, l.can_pay, l.can_see_medical, l.receives_emails, l.can_edit_profile,
                   (l.id is not null
                    and a.player_profile_id is distinct from auth.uid()
                    and not exists (select 1 from public.family_members fm where fm.family_id = a.family_id and fm.profile_id = auth.uid())) linked
              from (select 1) one
              left join public.athlete_guardian_links l
                on l.athlete_id = a.id and l.profile_id = auth.uid() and l.status = 'active' and l.org_id = v_org) lk
         where a.id in (select public.my_athlete_ids())) x), '[]'::jsonb);
end $$;

-- ===========================================================================
-- 7) Data checks: manual registrations are expected
-- ===========================================================================
-- NO_GUARDIAN_LOGIN (informational): the athlete's family has no login and the
-- athlete has none either (staff-created / imported). Suggestion: invite a
-- guardian. Never raised twice for the same athlete (open, resolved or
-- dismissed), never for a "someone else" holding family awaiting consent, and
-- resolved automatically once a guardian or the player logs in.
create or replace function public.athlete_no_login_flags(p_org uuid, p_athletes uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n int := 0;
begin
  update public.data_review_flags f
     set resolved_at = now(), resolution_note = 'guardian login linked'
   where f.org_id = p_org and f.reason_code = 'NO_GUARDIAN_LOGIN' and f.resolved_at is null
     and exists (select 1 from public.athletes a
                  where a.id = f.entity_id
                    and (a.player_profile_id is not null
                         or exists (select 1 from public.family_members fm where fm.family_id = a.family_id)));
  with ins as (
    insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
    select p_org, 'athletes', a.id, 'NO_GUARDIAN_LOGIN',
           jsonb_build_object('athlete_id', a.id, 'family_id', a.family_id, 'informational', true,
                              'has_contact_email', coalesce(f.contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$', false),
                              'source', 'data_check')
      from public.athletes a
      join public.families f on f.id = a.family_id
     where a.org_id = p_org and a.status not in ('erased', 'archived', 'inactive') and a.archived_at is null and a.merged_into_id is null
       and (p_athletes is null or a.id = any(p_athletes))
       and a.player_profile_id is null
       and not exists (select 1 from public.family_members fm where fm.family_id = a.family_id)
       and not exists (select 1 from public.guardian_consent_requests g where g.athlete_id = a.id and g.status = 'pending')
       and not exists (select 1 from public.data_review_flags d
                        where d.org_id = p_org and d.entity_table = 'athletes' and d.entity_id = a.id
                          and d.reason_code in ('NO_GUARDIAN_LOGIN', 'ATHLETE_WITHOUT_GUARDIAN'))
    on conflict do nothing
    returning 1)
  select count(*) into v_n from ins;
  return v_n;
end $$;

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

  -- (c) no guardian login and no own login: informational (manual registrations are expected).
  v_none := public.athlete_no_login_flags(p_org, null);

  return jsonb_build_object('possible_duplicates', v_dup, 'possible_self_links', v_self, 'without_guardian', 0,
                            'no_guardian_login', v_none, 'total', v_dup + v_self + v_none);
end $$;

-- Attendance review: a rostered player whose family has no login is the same
-- informational suggestion; ATHLETE_WITHOUT_GUARDIAN stays for a family that
-- has logins none of which can be reached. Neither is raised again once
-- resolved / dismissed.
create or replace function public.attendance_review_flags(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer := 0; v_k integer; v_no_login uuid[];
begin
  if not (public.is_service_caller() or (p_org = public.current_org_id() and public.is_admin())) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
  select tm.org_id, 'team_memberships', tm.id, 'MEMBERSHIP_INACTIVE_NO_END',
         jsonb_build_object('team_id', tm.team_id, 'athlete_id', tm.athlete_id, 'joined_on', tm.joined_on)
    from public.team_memberships tm
   where tm.org_id = p_org and tm.status = 'inactive' and tm.left_on is null
  on conflict do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
  select tm.org_id, 'team_memberships', tm.id, 'MEMBERSHIP_DATE_UNCERTAIN',
         jsonb_build_object('team_id', tm.team_id, 'athlete_id', tm.athlete_id, 'joined_on', tm.joined_on)
    from public.team_memberships tm
   where tm.org_id = p_org and tm.dates_source = 'uncertain'
  on conflict do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
  select e.org_id, 'events', e.id, 'TRAINING_WITHOUT_TEAM',
         jsonb_build_object('starts_at', e.starts_at, 'title', e.title)
    from public.events e
   where e.org_id = p_org and e.type = 'training' and e.team_id is null and e.training_session_id is null and e.status <> 'cancelled'
     and public.ta_event_tracked(e.id)
  on conflict do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
  select t.org_id, 'teams', t.id, 'TEAM_WITHOUT_COACH', jsonb_build_object('name', t.name)
    from public.teams t
   where t.org_id = p_org and t.is_active
     and not exists (select 1 from public.team_coaches tc where tc.team_id = t.id)
     and exists (select 1 from public.events e where e.team_id = t.id and e.type = 'training' and e.status <> 'cancelled'
                  and e.starts_at >= now() - interval '30 days' and public.ta_event_tracked(e.id))
  on conflict do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  -- Rostered players nobody can be alerted for.
  select coalesce(array_agg(distinct a.id), '{}') into v_no_login
    from public.teams t
    cross join lateral public.ta_roster_on(t.id, public.ta_today(t.org_id)) r
    join public.athletes a on a.id = r.athlete_id
   where t.org_id = p_org and t.is_active
     and not exists (select 1 from public.ta_alert_recipients(a.id));
  -- (a) no login at all (staff-created): informational suggestion.
  v_n := v_n + public.athlete_no_login_flags(p_org, v_no_login);
  -- (b) the family has logins, none reachable: a real problem.
  insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
  select distinct a.org_id, 'athletes', a.id, 'ATHLETE_WITHOUT_GUARDIAN',
         jsonb_build_object('has_family', a.family_id is not null, 'source', 'attendance_review')
    from public.athletes a
   where a.id = any(v_no_login)
     and a.player_profile_id is null
     and exists (select 1 from public.family_members fm where fm.family_id = a.family_id)
     and not exists (select 1 from public.data_review_flags d
                      where d.org_id = p_org and d.entity_table = 'athletes' and d.entity_id = a.id
                        and d.reason_code = 'ATHLETE_WITHOUT_GUARDIAN')
  on conflict do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
  select x.org_id, 'attendance_sessions', x.id, 'LEGACY_ATTENDANCE_SESSION',
         jsonb_build_object('event_id', e.id, 'team_id', e.team_id, 'program_session_id', x.program_session_id)
    from public.attendance_sessions x
    join public.events e on e.program_session_id = x.program_session_id and e.org_id = x.org_id and e.team_id is not null
   where x.org_id = p_org
  on conflict do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
  select e.org_id, 'events', e.id, 'ATTENDANCE_UNFINISHED',
         jsonb_build_object('team_id', e.team_id, 'starts_at', e.starts_at, 'sheet_status', s.status)
    from public.events e
    left join public.team_attendance_sheets s on s.event_id = e.id
   where e.org_id = p_org and e.team_id is not null and e.type::text = any(public.ta_sheet_types())
     and e.status <> 'cancelled' and e.ends_at < now() - interval '2 days'
     and (s.id is null or s.status <> 'final')
     and public.ta_event_tracked(e.id)
  on conflict do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  -- A flagged unfinished session that is now final resolves itself.
  update public.data_review_flags f
     set resolved_at = now(), resolution_note = 'attendance finalized'
   where f.org_id = p_org and f.reason_code = 'ATTENDANCE_UNFINISHED' and f.resolved_at is null
     and exists (select 1 from public.team_attendance_sheets s where s.event_id = f.entity_id and s.status = 'final');
  return v_n;
end;
$$;

-- One-off reclassification (history kept): open ATHLETE_WITHOUT_GUARDIAN flags
-- of athletes without any login become NO_GUARDIAN_LOGIN suggestions; the old
-- flag is resolved with a note, never deleted. Idempotent.
do $$
declare r record;
begin
  for r in
    select d.id, d.org_id, d.entity_id, a.family_id, f.contact_email
      from public.data_review_flags d
      join public.athletes a on a.id = d.entity_id
      join public.families f on f.id = a.family_id
     where d.reason_code = 'ATHLETE_WITHOUT_GUARDIAN' and d.entity_table = 'athletes' and d.resolved_at is null
       and a.player_profile_id is null
       and not exists (select 1 from public.family_members fm where fm.family_id = a.family_id)
  loop
    update public.data_review_flags
       set resolved_at = now(),
           resolution_note = 'Reclassified: staff-created athlete without a guardian login (informational NO_GUARDIAN_LOGIN)'
     where id = r.id;
    insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
    values (r.org_id, 'athletes', r.entity_id, 'NO_GUARDIAN_LOGIN',
            jsonb_build_object('athlete_id', r.entity_id, 'family_id', r.family_id, 'informational', true,
                               'has_contact_email', coalesce(r.contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$', false),
                               'source', 'reclassified', 'previous_flag_id', r.id))
    on conflict do nothing;
  end loop;
end $$;

-- ===========================================================================
-- 8) Grants
-- ===========================================================================
do $$
declare f text;
begin
  -- Internal helpers: no client EXECUTE.
  foreach f in array array[
    'athlete_link_sync_booker(uuid)', 'athlete_family_consent_contact(uuid)', 'athlete_link_gc_relation(text)',
    'athlete_no_login_flags(uuid, uuid[])', 'gc_open_request(uuid, uuid, uuid)', 'athlete_data_check_org(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', f);
    end if;
  end loop;
  -- Signed-in callers (each checks the caller and the org in SQL).
  foreach f in array array[
    'athlete_link_can(uuid, text)', 'can_view_athlete(uuid)', 'guardian_can_see_medical(uuid)', 'participant_can_manage(uuid)',
    'gc_is_booker(uuid)', 'booker_participants()', 'athlete_sponsorship_set(uuid, uuid, jsonb)',
    'participant_link_decide(uuid, text, jsonb, text)', 'athlete_links_for(uuid)', 'athlete_links_mine_to_manage()',
    'athlete_link_update(uuid, jsonb)', 'athlete_link_revoke(uuid, text)', 'my_athlete_ids()', 'my_athletes()',
    'attendance_review_flags(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function public.%s to authenticated, service_role', f);
    end if;
  end loop;
end $$;
