-- ============================================================================
-- Club OS · Family & multi-club features
--
--   1. One login, several clubs: org_memberships (expand step; profiles.org_id
--      stays the "current org" read by current_org_id()). switch_current_org()
--      moves the current org only to an org with an active membership (audited).
--      Invitations to a second club add a membership instead of failing.
--      Guardian helpers are scoped to the current org, so a person who is a
--      guardian in two clubs only ever sees the current club's family.
--   2. Second guardian & split billing: per-guardian permissions on
--      family_members (can pay / can see medical / receives emails), a family
--      billing split (percent per guardian) and split_family_invoice(), which
--      splits an unpaid family invoice into one invoice per paying guardian
--      (each with its own number, QR reference and payment link).
--   3. Privacy self-service: family_consent_events (media / marketing /
--      scout profile history), guardians can read their own DSARs, private
--      "privacy-exports" bucket, anonymise_family() keeps people who still
--      belong to another club.
--   4. Web push: push_subscriptions (own rows only).
--   5. Carpooling per event: offers, requests, matches (+ a private in-app
--      thread between the two guardians; no phone / email exposure).
--   6. Player journey: season reviews (coach comments, awards), placement /
--      scholarship tracker with status history, scout profiles (off by
--      default, guardian consent, hashed link token, expiry, revocable,
--      chosen fields only, never medical).
--
-- Additive and idempotent. SYNTHETIC DATA ONLY in tests.
-- ============================================================================

-- ===========================================================================
-- 1) ORG MEMBERSHIPS
-- ===========================================================================
create table if not exists public.org_memberships (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  profile_id        uuid not null references public.profiles(id) on delete cascade,
  roles             public.app_role[] not null default '{}',
  status            text not null default 'active',
  last_switched_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint org_memberships_status_chk check (status in ('active', 'suspended')),
  unique (profile_id, org_id)
);
create index if not exists idx_org_memberships_org on public.org_memberships(org_id);
create index if not exists idx_org_memberships_profile on public.org_memberships(profile_id);
drop trigger if exists trg_org_memberships_updated on public.org_memberships;
create trigger trg_org_memberships_updated before update on public.org_memberships
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_org_memberships on public.org_memberships;
create trigger trg_audit_org_memberships after insert or update or delete on public.org_memberships
  for each row execute function public.audit_trigger();

-- Internal: make sure (profile, org) is a membership, optionally adding a role.
create or replace function public.ensure_org_membership(p_profile uuid, p_org uuid, p_role public.app_role default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_profile is null or p_org is null then return; end if;
  insert into public.org_memberships (org_id, profile_id, roles)
  values (p_org, p_profile, case when p_role is null then '{}'::public.app_role[] else array[p_role] end)
  on conflict (profile_id, org_id) do update
    set roles = case
                  when p_role is null or p_role = any(public.org_memberships.roles) then public.org_memberships.roles
                  else public.org_memberships.roles || p_role
                end;
end $$;
revoke all on function public.ensure_org_membership(uuid, uuid, public.app_role) from public, anon, authenticated;
grant execute on function public.ensure_org_membership(uuid, uuid, public.app_role) to service_role;

create or replace function public.org_memberships_from_staff_roles()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.ensure_org_membership(new.profile_id, new.org_id, new.role);
    return new;
  end if;
  update public.org_memberships set roles = array_remove(roles, old.role)
   where profile_id = old.profile_id and org_id = old.org_id;
  return old;
end $$;
drop trigger if exists trg_staff_roles_membership on public.staff_roles;
create trigger trg_staff_roles_membership after insert or delete on public.staff_roles
  for each row execute function public.org_memberships_from_staff_roles();

create or replace function public.org_memberships_from_family_members()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from public.families where id = new.family_id;
  perform public.ensure_org_membership(new.profile_id, v_org, 'parent');
  return new;
end $$;
drop trigger if exists trg_family_members_membership on public.family_members;
create trigger trg_family_members_membership after insert on public.family_members
  for each row execute function public.org_memberships_from_family_members();

create or replace function public.org_memberships_from_profiles()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.org_id is not null and (tg_op = 'INSERT' or new.org_id is distinct from old.org_id) then
    perform public.ensure_org_membership(new.id, new.org_id, null);
  end if;
  return new;
end $$;
drop trigger if exists trg_profiles_membership on public.profiles;
create trigger trg_profiles_membership after insert or update of org_id on public.profiles
  for each row execute function public.org_memberships_from_profiles();

-- Backfill (idempotent).
insert into public.org_memberships (org_id, profile_id)
select p.org_id, p.id from public.profiles p where p.org_id is not null
on conflict (profile_id, org_id) do nothing;

insert into public.org_memberships (org_id, profile_id, roles)
select sr.org_id, sr.profile_id, array_agg(distinct sr.role)
  from public.staff_roles sr group by sr.org_id, sr.profile_id
on conflict (profile_id, org_id) do update
  set roles = (select array(select distinct r from unnest(public.org_memberships.roles || excluded.roles) r));

insert into public.org_memberships (org_id, profile_id, roles)
select distinct f.org_id, fm.profile_id, array['parent']::public.app_role[]
  from public.family_members fm join public.families f on f.id = fm.family_id
on conflict (profile_id, org_id) do update
  set roles = case when 'parent' = any(public.org_memberships.roles) then public.org_memberships.roles
                   else public.org_memberships.roles || 'parent'::public.app_role end;

-- current_org_id(): still profiles.org_id ("current org"), but never an org
-- whose membership an admin suspended.
create or replace function public.current_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select p.org_id from public.profiles p
   where p.id = auth.uid()
     and not exists (select 1 from public.org_memberships m
                      where m.profile_id = p.id and m.org_id = p.org_id and m.status <> 'active');
$$;

create or replace function public.has_org_membership(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.org_memberships
                  where profile_id = auth.uid() and org_id = p_org and status = 'active');
$$;
revoke all on function public.has_org_membership(uuid) from public, anon;
grant execute on function public.has_org_membership(uuid) to authenticated, service_role;

alter table public.org_memberships enable row level security;
alter table public.org_memberships force row level security;
drop policy if exists org_memberships_select on public.org_memberships;
create policy org_memberships_select on public.org_memberships for select
  using (profile_id = auth.uid() or (org_id = public.current_org_id() and public.is_admin()));
drop policy if exists org_memberships_insert on public.org_memberships;
create policy org_memberships_insert on public.org_memberships for insert
  with check (false);  -- created by invitations / triggers (security definer) only
drop policy if exists org_memberships_update on public.org_memberships;
create policy org_memberships_update on public.org_memberships for update
  using (org_id = public.current_org_id() and public.is_admin() and profile_id <> auth.uid())
  with check (org_id = public.current_org_id() and public.is_admin() and profile_id <> auth.uid());
drop policy if exists org_memberships_delete on public.org_memberships;
create policy org_memberships_delete on public.org_memberships for delete
  using (org_id = public.current_org_id() and public.is_admin() and profile_id <> auth.uid());
grant select, update, delete on public.org_memberships to authenticated;
grant all on public.org_memberships to service_role;

-- Admins may only change the status column of a membership.
create or replace function public.org_memberships_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.org_id <> old.org_id or new.profile_id <> old.profile_id or new.roles is distinct from old.roles) then
    raise exception 'MEMBERSHIP_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_org_memberships_guard on public.org_memberships;
create trigger trg_org_memberships_guard before update on public.org_memberships
  for each row execute function public.org_memberships_guard();

-- The caller's clubs (organizations RLS only shows the current one).
create or replace function public.my_org_memberships()
returns table (org_id uuid, name text, slug text, roles public.app_role[], is_current boolean)
language sql stable security definer set search_path = public as $$
  select o.id, o.name::text, o.slug::text, m.roles, (o.id = (select p.org_id from public.profiles p where p.id = auth.uid()))
    from public.org_memberships m join public.organizations o on o.id = m.org_id
   where m.profile_id = auth.uid() and m.status = 'active'
   order by o.name;
$$;
revoke all on function public.my_org_memberships() from public, anon;
grant execute on function public.my_org_memberships() to authenticated, service_role;

-- Switch the current org. Only to an org with an active membership; audited
-- in both clubs. The client never supplies anything but the target org id.
create or replace function public.switch_current_org(p_org uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_me   uuid := auth.uid();
  v_prev uuid;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_org is null or not exists (select 1 from public.org_memberships
                                   where profile_id = v_me and org_id = p_org and status = 'active') then
    raise exception 'NO_MEMBERSHIP' using errcode = '42501';
  end if;
  select org_id into v_prev from public.profiles where id = v_me;
  if v_prev is distinct from p_org then
    update public.profiles set org_id = p_org where id = v_me;
  end if;
  update public.org_memberships set last_switched_at = now() where profile_id = v_me and org_id = p_org;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (p_org, v_me, 'org.switch_in', 'profiles', v_me, jsonb_build_object('org_id', v_prev), jsonb_build_object('org_id', p_org));
  if v_prev is not null and v_prev <> p_org then
    insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
    values (v_prev, v_me, 'org.switch_out', 'profiles', v_me, jsonb_build_object('org_id', v_prev), jsonb_build_object('org_id', p_org));
  end if;
  return jsonb_build_object('org_id', p_org, 'previous_org_id', v_prev);
end $$;
revoke all on function public.switch_current_org(uuid) from public, anon;
grant execute on function public.switch_current_org(uuid) to authenticated, service_role;

-- ---- Invitations to a second club --------------------------------------------
alter table public.invitations add column if not exists guardian_permissions jsonb;

-- Consume one invitation for an EXISTING profile (server / definer only).
create or replace function public.consume_invitation(p_inv uuid, p_profile uuid)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  v_inv   public.invitations%rowtype;
  v_email citext;
begin
  select * into v_inv from public.invitations where id = p_inv for update;
  if not found or v_inv.status <> 'pending' or v_inv.expires_at <= now() then return false; end if;
  select email into v_email from public.profiles where id = p_profile;
  if v_email is null or v_email <> v_inv.email then return false; end if;

  perform public.ensure_org_membership(p_profile, v_inv.org_id, v_inv.role);
  if v_inv.role <> 'parent' then
    insert into public.staff_roles (org_id, profile_id, role) values (v_inv.org_id, p_profile, v_inv.role)
    on conflict (org_id, profile_id, role) do nothing;
  end if;
  if v_inv.family_id is not null
     and exists (select 1 from public.families where id = v_inv.family_id and org_id = v_inv.org_id) then
    insert into public.family_members (family_id, profile_id, relation, is_primary)
    values (v_inv.family_id, p_profile, coalesce(v_inv.relation, 'guardian'),
            not exists (select 1 from public.family_members where family_id = v_inv.family_id))
    on conflict (family_id, profile_id) do nothing;
  end if;
  if v_inv.coach_id is not null then
    update public.coaches set profile_id = p_profile where id = v_inv.coach_id and org_id = v_inv.org_id;
  end if;
  -- A login without a club yet gets this one as its current club.
  update public.profiles set org_id = v_inv.org_id where id = p_profile and org_id is null;
  update public.invitations set status = 'accepted', accepted_at = now(), accepted_by = p_profile where id = p_inv;
  return true;
end $$;
revoke all on function public.consume_invitation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.consume_invitation(uuid, uuid) to service_role;

-- A signed-in user claims every open invitation sent to their own email.
create or replace function public.claim_my_invitations()
returns integer language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_n  integer := 0;
  r    record;
begin
  if v_me is null then return 0; end if;
  for r in select i.id from public.invitations i
            where i.email = (select email from public.profiles where id = v_me)
              and i.status = 'pending' and i.expires_at > now()
            order by i.created_at loop
    if public.consume_invitation(r.id, v_me) then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.claim_my_invitations() from public, anon;
grant execute on function public.claim_my_invitations() to authenticated, service_role;

-- ---- Org-scoped guardian helpers ---------------------------------------------
create or replace function public.is_guardian_of_family(p_family uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.family_members fm join public.families f on f.id = fm.family_id
     where fm.family_id = p_family and fm.profile_id = auth.uid() and f.org_id = public.current_org_id());
$$;

create or replace function public.is_guardian_of_athlete(p_athlete uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.athletes a join public.family_members fm on fm.family_id = a.family_id
     where a.id = p_athlete and fm.profile_id = auth.uid() and a.org_id = public.current_org_id());
$$;

create or replace function public.guardian_has_athlete_in_program(p_program uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.registrations r
      join public.athletes a on a.id = r.athlete_id
      join public.family_members fm on fm.family_id = a.family_id
     where r.program_id = p_program and fm.profile_id = auth.uid() and a.org_id = public.current_org_id());
$$;

create or replace function public.guardian_has_athlete_on_team(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_team is not null and exists (
    select 1 from public.team_memberships tm
      join public.athletes a on a.id = tm.athlete_id
      join public.family_members fm on fm.family_id = a.family_id
     where tm.team_id = p_team and tm.status <> 'inactive' and fm.profile_id = auth.uid()
       and tm.org_id = public.current_org_id());
$$;

create or replace function public.is_any_guardian()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.family_members fm join public.families f on f.id = fm.family_id
                  where fm.profile_id = auth.uid() and f.org_id = public.current_org_id());
$$;

-- A profile "is in" the current org when it is current there or a member.
create or replace function public.profile_in_current_org(p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = p_profile and p.org_id = public.current_org_id())
      or exists (select 1 from public.org_memberships m
                  where m.profile_id = p_profile and m.org_id = public.current_org_id() and m.status = 'active');
$$;

-- Messaging same-org guard: a profile belongs to an org through a membership too.
create or replace function public.msg_same_org_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_org uuid  := (v_row->>'org_id')::uuid;
  v_col text;
  v_id  uuid;
  v_tab text;
  v_ok  boolean;
begin
  foreach v_col in array coalesce(tg_argv, '{}'::text[]) loop
    v_id := nullif(v_row->>v_col, '')::uuid;
    continue when v_id is null;
    v_tab := case v_col
      when 'profile_id'      then 'profiles'
      when 'sender_id'       then 'profiles'
      when 'created_by'      then 'profiles'
      when 'reporter_id'     then 'profiles'
      when 'author_id'       then 'profiles'
      when 'family_id'       then 'families'
      when 'team_id'         then 'teams'
      when 'program_id'      then 'programs'
      when 'camp_edition_id' then 'camp_editions'
      when 'conversation_id' then 'msg_conversations'
      when 'message_id'      then 'msg_messages'
      when 'alert_id'        then 'club_alerts'
      when 'lead_id'         then 'contact_leads'
    end;
    if v_tab is null then raise exception 'msg_same_org_guard: unknown column %', v_col; end if;
    execute format('select exists (select 1 from public.%I where id = $1 and org_id = $2)', v_tab)
      into v_ok using v_id, v_org;
    if not v_ok and v_tab = 'profiles' then
      v_ok := exists (select 1 from public.org_memberships m
                       where m.profile_id = v_id and m.org_id = v_org and m.status = 'active');
    end if;
    if not v_ok then
      raise exception 'CROSS_ORG_REFERENCE: %', v_col using errcode = 'P0001';
    end if;
  end loop;
  return new;
end;
$$;

-- ===========================================================================
-- 2) SECOND GUARDIAN, PERMISSIONS, SPLIT BILLING
-- ===========================================================================
alter table public.family_members
  add column if not exists can_pay           boolean not null default true,
  add column if not exists can_see_medical   boolean not null default true,
  add column if not exists receives_emails   boolean not null default true,
  add column if not exists billing_share_pct numeric(5,2),
  add column if not exists updated_at        timestamptz not null default now();
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'family_members_share_chk') then
    alter table public.family_members add constraint family_members_share_chk
      check (billing_share_pct is null or (billing_share_pct >= 0 and billing_share_pct <= 100));
  end if;
end $$;

alter table public.families add column if not exists billing_split_mode text not null default 'single';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'families_billing_split_mode_chk') then
    alter table public.families add constraint families_billing_split_mode_chk
      check (billing_split_mode in ('single', 'split'));
  end if;
end $$;

alter table public.invoices
  add column if not exists payer_profile_id      uuid references public.profiles(id) on delete set null,
  add column if not exists split_group_id        uuid,
  add column if not exists split_share_pct       numeric(5,2),
  add column if not exists split_from_invoice_id uuid references public.invoices(id) on delete set null;
create index if not exists idx_invoices_split_group on public.invoices(split_group_id) where split_group_id is not null;
create index if not exists idx_invoices_payer on public.invoices(payer_profile_id) where payer_profile_id is not null;

-- Permissions chosen when the guardian was invited are applied on link.
create or replace function public.family_members_apply_invite()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_perm jsonb;
begin
  select i.guardian_permissions into v_perm
    from public.invitations i
   where i.family_id = new.family_id and i.status = 'pending'
     and i.email = (select email from public.profiles where id = new.profile_id)
   order by i.created_at desc limit 1;
  if v_perm is not null then
    new.can_pay         := coalesce((v_perm->>'can_pay')::boolean, new.can_pay);
    new.can_see_medical := coalesce((v_perm->>'can_see_medical')::boolean, new.can_see_medical);
    new.receives_emails := coalesce((v_perm->>'receives_emails')::boolean, new.receives_emails);
  end if;
  return new;
end $$;
drop trigger if exists trg_family_members_apply_invite on public.family_members;
create trigger trg_family_members_apply_invite before insert on public.family_members
  for each row execute function public.family_members_apply_invite();

drop trigger if exists trg_family_members_updated on public.family_members;
create trigger trg_family_members_updated before update on public.family_members
  for each row execute function public.set_updated_at();

create or replace function public.is_primary_guardian(p_family uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.family_members fm join public.families f on f.id = fm.family_id
     where fm.family_id = p_family and fm.profile_id = auth.uid() and fm.is_primary
       and f.org_id = public.current_org_id());
$$;

create or replace function public.guardian_can_see_medical(p_athlete uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.athletes a join public.family_members fm on fm.family_id = a.family_id
     where a.id = p_athlete and fm.profile_id = auth.uid() and fm.can_see_medical
       and a.org_id = public.current_org_id());
$$;

create or replace function public.guardian_can_pay(p_family uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.family_members fm join public.families f on f.id = fm.family_id
     where fm.family_id = p_family and fm.profile_id = auth.uid() and fm.can_pay
       and f.org_id = public.current_org_id());
$$;
do $$
declare f text;
begin
  foreach f in array array['is_primary_guardian(uuid)', 'guardian_can_see_medical(uuid)', 'guardian_can_pay(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- Medical data: admin of the athlete's org, or a guardian allowed to see it.
drop policy if exists medical_select on public.athlete_medical;
create policy medical_select on public.athlete_medical for select
  using ((public.is_admin() and org_id = public.current_org_id())
         or public.guardian_can_see_medical(athlete_id));
drop policy if exists medical_guardian_write on public.athlete_medical;
create policy medical_guardian_write on public.athlete_medical for all
  using (public.guardian_can_see_medical(athlete_id))
  with check (public.guardian_can_see_medical(athlete_id));

-- Primary guardian (or a club admin) sets another guardian's permissions.
create or replace function public.set_guardian_permissions(
  p_family uuid, p_profile uuid, p_can_pay boolean, p_can_see_medical boolean, p_receives_emails boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_old jsonb; v_org uuid;
begin
  select org_id into v_org from public.families where id = p_family;
  if v_org is null or v_org is distinct from public.current_org_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if not (public.is_primary_guardian(p_family) or public.is_admin()) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  select jsonb_build_object('can_pay', can_pay, 'can_see_medical', can_see_medical, 'receives_emails', receives_emails)
    into v_old from public.family_members where family_id = p_family and profile_id = p_profile;
  if v_old is null then raise exception 'NOT_A_GUARDIAN' using errcode = 'P0001'; end if;
  update public.family_members
     set can_pay = coalesce(p_can_pay, can_pay),
         can_see_medical = coalesce(p_can_see_medical, can_see_medical),
         receives_emails = coalesce(p_receives_emails, receives_emails),
         billing_share_pct = case when coalesce(p_can_pay, can_pay) then billing_share_pct else null end
   where family_id = p_family and profile_id = p_profile;
  -- A guardian who can no longer pay leaves the split.
  if p_can_pay is false then
    update public.families set billing_split_mode = 'single' where id = p_family and billing_split_mode = 'split';
  end if;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (v_org, auth.uid(), 'family.guardian_permissions', 'families', p_family, v_old || jsonb_build_object('profile_id', p_profile),
          jsonb_build_object('profile_id', p_profile, 'can_pay', p_can_pay, 'can_see_medical', p_can_see_medical, 'receives_emails', p_receives_emails));
end $$;

-- Billing split: p_shares = {"<profile uuid>": percent, ...}; must total 100.
create or replace function public.set_family_billing_split(p_family uuid, p_mode text, p_shares jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_org   uuid;
  v_sum   numeric := 0;
  v_n     integer := 0;
  k       text;
  v_pct   numeric;
begin
  select org_id into v_org from public.families where id = p_family;
  if v_org is null or v_org is distinct from public.current_org_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if not (public.is_primary_guardian(p_family) or public.is_finance()) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if p_mode not in ('single', 'split') then raise exception 'INVALID_MODE' using errcode = 'P0001'; end if;

  if p_mode = 'split' then
    if p_shares is null or jsonb_typeof(p_shares) <> 'object' then raise exception 'INVALID_SHARES' using errcode = 'P0001'; end if;
    for k in select jsonb_object_keys(p_shares) loop
      v_pct := (p_shares->>k)::numeric;
      if v_pct is null or v_pct < 0 or v_pct > 100 then raise exception 'INVALID_SHARES' using errcode = 'P0001'; end if;
      if not exists (select 1 from public.family_members where family_id = p_family and profile_id = k::uuid and (can_pay or v_pct = 0)) then
        raise exception 'SHARE_NOT_A_PAYER' using errcode = 'P0001';
      end if;
      v_sum := v_sum + v_pct;
      if v_pct > 0 then v_n := v_n + 1; end if;
    end loop;
    if v_sum <> 100 then raise exception 'SHARES_MUST_TOTAL_100' using errcode = 'P0001'; end if;
    if v_n < 2 then raise exception 'SPLIT_NEEDS_TWO_PAYERS' using errcode = 'P0001'; end if;
    update public.family_members fm
       set billing_share_pct = nullif((p_shares->>fm.profile_id::text)::numeric, 0)
     where fm.family_id = p_family;
  else
    update public.family_members set billing_share_pct = null where family_id = p_family;
  end if;
  update public.families set billing_split_mode = p_mode where id = p_family;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, auth.uid(), 'family.billing_split', 'families', p_family, jsonb_build_object('mode', p_mode, 'shares', p_shares));
end $$;

-- A guardian leaves (self) or the primary guardian / admin removes another one.
create or replace function public.remove_family_guardian(p_family uuid, p_profile uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid; v_primary boolean;
begin
  select org_id into v_org from public.families where id = p_family;
  if v_org is null or v_org is distinct from public.current_org_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  select is_primary into v_primary from public.family_members where family_id = p_family and profile_id = p_profile;
  if v_primary is null then raise exception 'NOT_A_GUARDIAN' using errcode = 'P0001'; end if;
  if v_primary then raise exception 'CANNOT_REMOVE_PRIMARY' using errcode = 'P0001'; end if;
  if not (p_profile = auth.uid() or public.is_primary_guardian(p_family) or public.is_admin()) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  delete from public.family_members where family_id = p_family and profile_id = p_profile;
  update public.families set billing_split_mode = 'single' where id = p_family and billing_split_mode = 'split';
  update public.family_members set billing_share_pct = null where family_id = p_family;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, auth.uid(), 'family.guardian_removed', 'families', p_family, jsonb_build_object('profile_id', p_profile));
end $$;

do $$
declare f text;
begin
  foreach f in array array['set_guardian_permissions(uuid, uuid, boolean, boolean, boolean)',
                           'set_family_billing_split(uuid, text, jsonb)', 'remove_family_guardian(uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- Split one unpaid family invoice into one invoice per paying guardian.
-- Each part is a normal invoice (own number, QR / creditor reference, Stripe
-- link, reminders, reconciliation). Lines are scaled per share; rounding
-- remainders go to the last payer so the parts add up exactly to the original.
-- Refused when anything but lines / email logs / registrations / discounts
-- already points at the invoice (payments, plans, shop orders, packages, ...).
create or replace function public.split_family_invoice(p_invoice uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_inv    public.invoices%rowtype;
  v_mode   text;
  v_group  uuid := gen_random_uuid();
  v_exp    integer;
  v_payers uuid[];
  v_pcts   numeric[];
  v_n      integer;
  v_ids    uuid[] := '{}';
  v_id     uuid;
  v_total  numeric;
  v_sub    numeric;
  v_acc_t  numeric := 0;
  v_acc_s  numeric := 0;
  v_amt    numeric;
  v_sum    numeric;
  i        integer;
  it       record;
  fk       record;
  v_linked boolean;
begin
  select * into v_inv from public.invoices where id = p_invoice for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if not (public.staff_is_service_caller() or (public.is_finance() and v_inv.org_id = public.current_org_id())) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if v_inv.split_group_id is not null then raise exception 'ALREADY_SPLIT' using errcode = 'P0001'; end if;
  if v_inv.status::text not in ('draft', 'pending', 'sent', 'overdue') then raise exception 'INVOICE_NOT_OPEN' using errcode = 'P0001'; end if;
  if coalesce(v_inv.adjustments_total, 0) <> 0 or coalesce(v_inv.total_chf, 0) <= 0 then raise exception 'INVOICE_NOT_SPLITTABLE' using errcode = 'P0001'; end if;
  select billing_split_mode into v_mode from public.families where id = v_inv.family_id and org_id = v_inv.org_id;
  if v_mode is distinct from 'split' then raise exception 'FAMILY_NOT_SPLIT' using errcode = 'P0001'; end if;

  for fk in
    select c.conrelid::regclass::text as tbl, a.attname::text as col
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.confrelid = 'public.invoices'::regclass and array_length(c.conkey, 1) = 1
  loop
    continue when fk.tbl in ('invoice_items', 'public.invoice_items', 'email_logs', 'public.email_logs',
                             'invoices', 'public.invoices', 'registrations', 'public.registrations',
                             'applied_discounts', 'public.applied_discounts');
    execute format('select exists (select 1 from %s where %I = $1)', fk.tbl, fk.col) into v_linked using p_invoice;
    if v_linked then raise exception 'INVOICE_LINKED: %', fk.tbl using errcode = 'P0001'; end if;
  end loop;

  select array_agg(profile_id order by is_primary desc, created_at, profile_id),
         array_agg(billing_share_pct order by is_primary desc, created_at, profile_id)
    into v_payers, v_pcts
    from public.family_members
   where family_id = v_inv.family_id and can_pay and coalesce(billing_share_pct, 0) > 0;
  v_n := coalesce(array_length(v_payers, 1), 0);
  if v_n < 2 then raise exception 'SPLIT_NEEDS_TWO_PAYERS' using errcode = 'P0001'; end if;

  v_exp := coalesce(public.currency_exponent(v_inv.currency), 2);
  perform set_config('app.money_edit', 'on', true);

  for i in 1..v_n loop
    if i < v_n then
      v_total := round(v_inv.total_chf * v_pcts[i] / 100, v_exp);
      v_sub   := round(coalesce(v_inv.subtotal_amount, v_inv.total_chf) * v_pcts[i] / 100, v_exp);
      v_acc_t := v_acc_t + v_total;
      v_acc_s := v_acc_s + v_sub;
    else
      v_total := v_inv.total_chf - v_acc_t;
      v_sub   := coalesce(v_inv.subtotal_amount, v_inv.total_chf) - v_acc_s;
    end if;

    if i = 1 then
      v_id := v_inv.id;
    else
      v_id := gen_random_uuid();
      insert into public.invoices
      select (jsonb_populate_record(null::public.invoices, to_jsonb(v_inv) || jsonb_build_object(
        'id', v_id, 'number', public.next_invoice_number(v_inv.org_id), 'payment_reference', null,
        'stripe_payment_intent_id', null, 'paid_at', null, 'created_at', now(), 'updated_at', now(),
        'total_chf', v_total, 'subtotal_amount', v_sub, 'tax_amount', null,
        'payer_profile_id', v_payers[i], 'split_group_id', v_group, 'split_share_pct', v_pcts[i],
        'split_from_invoice_id', v_inv.id))).*;
    end if;
    v_ids := v_ids || v_id;
  end loop;

  -- Lines: scale each line per share, remainder on the last part.
  for it in select * from public.invoice_items where invoice_id = v_inv.id order by created_at, id loop
    v_sum := 0;
    for i in 1..v_n loop
      if i < v_n then
        v_amt := round(it.amount_chf * v_pcts[i] / 100, v_exp);
        v_sum := v_sum + v_amt;
      else
        v_amt := it.amount_chf - v_sum;
      end if;
      if i = 1 then
        update public.invoice_items
           set amount_chf = v_amt,
               unit_price_chf = case when coalesce(quantity, 0) = 0 then v_amt else round(v_amt / quantity, v_exp) end
         where id = it.id;
      else
        insert into public.invoice_items
        select (jsonb_populate_record(null::public.invoice_items, to_jsonb(it) || jsonb_build_object(
          'id', gen_random_uuid(), 'invoice_id', v_ids[i], 'amount_chf', v_amt, 'created_at', now(),
          'unit_price_chf', case when coalesce(it.quantity, 0) = 0 then v_amt else round(v_amt / it.quantity, v_exp) end))).*;
      end if;
    end loop;
  end loop;

  -- The original becomes the first payer's part.
  v_total := round(v_inv.total_chf * v_pcts[1] / 100, v_exp);
  v_sub   := round(coalesce(v_inv.subtotal_amount, v_inv.total_chf) * v_pcts[1] / 100, v_exp);
  update public.invoices
     set total_chf = v_total, subtotal_amount = v_sub,
         payer_profile_id = v_payers[1], split_group_id = v_group, split_share_pct = v_pcts[1]
   where id = v_inv.id;
  perform set_config('app.money_edit', 'off', true);

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (v_inv.org_id, auth.uid(), 'invoice.split', 'invoices', v_inv.id,
          jsonb_build_object('total', v_inv.total_chf),
          jsonb_build_object('group', v_group, 'invoices', to_jsonb(v_ids), 'payers', to_jsonb(v_payers), 'shares', to_jsonb(v_pcts)));
  return jsonb_build_object('group', v_group, 'invoices', to_jsonb(v_ids));
end $$;
revoke all on function public.split_family_invoice(uuid) from public, anon;
grant execute on function public.split_family_invoice(uuid) to authenticated, service_role;

-- Who receives billing messages for an invoice: the responsible payer of a
-- split invoice, else every guardian who receives emails. Server only.
create or replace function public.invoice_billing_recipients(p_invoice uuid)
returns table (profile_id uuid)
language sql stable security definer set search_path = public as $$
  select fm.profile_id
    from public.invoices i join public.family_members fm on fm.family_id = i.family_id
   where i.id = p_invoice
     and (case when i.payer_profile_id is not null then fm.profile_id = i.payer_profile_id
               else fm.receives_emails end);
$$;
revoke all on function public.invoice_billing_recipients(uuid) from public, anon, authenticated;
grant execute on function public.invoice_billing_recipients(uuid) to service_role;

-- ===========================================================================
-- 3) PRIVACY SELF-SERVICE
-- ===========================================================================
create table if not exists public.family_consent_events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  family_id   uuid not null references public.families(id) on delete cascade,
  athlete_id  uuid references public.athletes(id) on delete cascade,
  profile_id  uuid references public.profiles(id) on delete set null,
  kind        text not null,
  granted     boolean not null,
  version     text not null default '1',
  source      text not null default 'parent_app',
  created_at  timestamptz not null default clock_timestamp(),
  updated_at  timestamptz not null default now(),
  constraint family_consent_events_kind_chk check (kind in ('media', 'marketing', 'scout_profile')),
  constraint family_consent_events_subject_chk check (
    (kind = 'marketing') or athlete_id is not null),
  constraint family_consent_events_source_chk check (source in ('parent_app', 'admin', 'registration'))
);
create index if not exists idx_family_consent_events_org on public.family_consent_events(org_id);
create index if not exists idx_family_consent_events_family on public.family_consent_events(family_id, kind, created_at desc);
drop trigger if exists trg_audit_family_consent_events on public.family_consent_events;
create trigger trg_audit_family_consent_events after insert or update or delete on public.family_consent_events
  for each row execute function public.audit_trigger();

-- Same org for family / athlete; the athlete belongs to the family.
create or replace function public.family_consent_events_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then raise exception 'CONSENT_HISTORY_IMMUTABLE' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.families where id = new.family_id and org_id = new.org_id) then
    raise exception 'CROSS_ORG_REFERENCE: family_id' using errcode = 'P0001';
  end if;
  if new.athlete_id is not null and not exists (
       select 1 from public.athletes where id = new.athlete_id and family_id = new.family_id and org_id = new.org_id) then
    raise exception 'CROSS_ORG_REFERENCE: athlete_id' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_family_consent_events_guard on public.family_consent_events;
create trigger trg_family_consent_events_guard before insert or update on public.family_consent_events
  for each row execute function public.family_consent_events_guard();

alter table public.family_consent_events enable row level security;
alter table public.family_consent_events force row level security;
drop policy if exists family_consent_events_select on public.family_consent_events;
create policy family_consent_events_select on public.family_consent_events for select
  using (org_id = public.current_org_id() and (public.is_admin() or public.is_guardian_of_family(family_id)));
drop policy if exists family_consent_events_insert on public.family_consent_events;
create policy family_consent_events_insert on public.family_consent_events for insert
  with check (org_id = public.current_org_id() and profile_id = auth.uid()
              and (public.is_guardian_of_family(family_id) or public.is_admin()));
drop policy if exists family_consent_events_update on public.family_consent_events;
create policy family_consent_events_update on public.family_consent_events for update using (false);
drop policy if exists family_consent_events_delete on public.family_consent_events;
create policy family_consent_events_delete on public.family_consent_events for delete using (false);
grant select, insert on public.family_consent_events to authenticated;
grant all on public.family_consent_events to service_role;

-- Latest decision per (athlete | guardian, kind).
create or replace function public.family_consent_state(p_family uuid)
returns table (kind text, athlete_id uuid, profile_id uuid, granted boolean, decided_at timestamptz)
language sql stable security definer set search_path = public as $$
  select distinct on (e.kind, e.athlete_id, case when e.kind = 'marketing' then e.profile_id end)
         e.kind, e.athlete_id, e.profile_id, e.granted, e.created_at
    from public.family_consent_events e
   where e.family_id = p_family and e.org_id = public.current_org_id()
     and (public.is_admin() or public.is_guardian_of_family(p_family))
   order by e.kind, e.athlete_id, case when e.kind = 'marketing' then e.profile_id end, e.created_at desc;
$$;
revoke all on function public.family_consent_state(uuid) from public, anon;
grant execute on function public.family_consent_state(uuid) to authenticated, service_role;

-- Guardians see the rights requests they filed themselves.
drop policy if exists dsar_requests_requester_select on public.dsar_requests;
create policy dsar_requests_requester_select on public.dsar_requests for select
  using (requester_profile_id = auth.uid() and org_id = public.current_org_id());
grant select on public.dsar_requests to authenticated;

-- Private bucket for data exports (service role writes; signed URLs only).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('privacy-exports', 'privacy-exports', false)
    on conflict (id) do nothing;
  end if;
end $$;

-- Erasure keeps people who still belong to another club: their link to this
-- club ends, their login and profile stay. Financial rows are kept (legal
-- retention) exactly as before.
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

-- ===========================================================================
-- 4) WEB PUSH SUBSCRIPTIONS
-- ===========================================================================
create table if not exists public.push_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  profile_id       uuid not null references public.profiles(id) on delete cascade,
  endpoint         text not null,
  p256dh           text not null,
  auth_secret      text not null,
  user_agent       text,
  failure_count    integer not null default 0,
  last_success_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint push_subscriptions_endpoint_chk check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  constraint push_subscriptions_keys_chk check (length(p256dh) between 40 and 200 and length(auth_secret) between 10 and 100),
  constraint push_subscriptions_ua_chk check (user_agent is null or length(user_agent) <= 300),
  unique (org_id, endpoint)
);
create index if not exists idx_push_subscriptions_org on public.push_subscriptions(org_id);
create index if not exists idx_push_subscriptions_profile on public.push_subscriptions(profile_id);
drop trigger if exists trg_push_subscriptions_updated on public.push_subscriptions;
create trigger trg_push_subscriptions_updated before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;
drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions for select
  using (profile_id = auth.uid() and org_id = public.current_org_id());
drop policy if exists push_subscriptions_insert on public.push_subscriptions;
create policy push_subscriptions_insert on public.push_subscriptions for insert
  with check (profile_id = auth.uid() and org_id = public.current_org_id());
drop policy if exists push_subscriptions_update on public.push_subscriptions;
create policy push_subscriptions_update on public.push_subscriptions for update
  using (profile_id = auth.uid() and org_id = public.current_org_id())
  with check (profile_id = auth.uid() and org_id = public.current_org_id());
drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete on public.push_subscriptions for delete
  using (profile_id = auth.uid() and org_id = public.current_org_id());
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

-- ===========================================================================
-- 5) CARPOOLING
-- ===========================================================================
-- Guardian of a player on the event's roster (team roster, or RSVP'd athletes
-- of a club-wide event), in the current org.
create or replace function public.carpool_guardian_on_roster(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.events e
     where e.id = p_event and e.org_id = public.current_org_id()
       and (
         (e.team_id is not null and public.guardian_has_athlete_on_team(e.team_id))
         or exists (select 1 from public.event_rsvps r
                      join public.athletes a on a.id = r.athlete_id
                      join public.family_members fm on fm.family_id = a.family_id
                     where r.event_id = e.id and fm.profile_id = auth.uid())
       ));
$$;

create or replace function public.carpool_can_view(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.events e
     where e.id = p_event and e.org_id = public.current_org_id()
       and (public.is_admin() or public.coach_coaches_team(e.team_id)
            or (e.team_id is null and public.has_role('coach'))
            or public.carpool_guardian_on_roster(p_event)));
$$;
do $$
declare f text;
begin
  foreach f in array array['carpool_guardian_on_roster(uuid)', 'carpool_can_view(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

create table if not exists public.carpool_offers (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  event_id     uuid not null references public.events(id) on delete cascade,
  family_id    uuid not null references public.families(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  from_area    text not null,
  departs_at   timestamptz not null,
  seats_total  smallint not null,
  return_trip  boolean not null default false,
  note         text,
  status       text not null default 'open',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint carpool_offers_area_chk check (length(btrim(from_area)) between 2 and 120),
  constraint carpool_offers_seats_chk check (seats_total between 1 and 8),
  constraint carpool_offers_note_chk check (note is null or length(note) <= 300),
  constraint carpool_offers_status_chk check (status in ('open', 'full', 'cancelled'))
);
create index if not exists idx_carpool_offers_org on public.carpool_offers(org_id);
create index if not exists idx_carpool_offers_event on public.carpool_offers(event_id);

create table if not exists public.carpool_requests (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  event_id      uuid not null references public.events(id) on delete cascade,
  family_id     uuid not null references public.families(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  from_area     text not null,
  seats_needed  smallint not null default 1,
  return_trip   boolean not null default false,
  note          text,
  status        text not null default 'open',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint carpool_requests_area_chk check (length(btrim(from_area)) between 2 and 120),
  constraint carpool_requests_seats_chk check (seats_needed between 1 and 6),
  constraint carpool_requests_note_chk check (note is null or length(note) <= 300),
  constraint carpool_requests_status_chk check (status in ('open', 'matched', 'cancelled'))
);
create index if not exists idx_carpool_requests_org on public.carpool_requests(org_id);
create index if not exists idx_carpool_requests_event on public.carpool_requests(event_id);

create table if not exists public.carpool_matches (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  event_id         uuid not null references public.events(id) on delete cascade,
  offer_id         uuid not null references public.carpool_offers(id) on delete cascade,
  request_id       uuid not null references public.carpool_requests(id) on delete cascade,
  seats            smallint not null,
  status           text not null default 'confirmed',
  conversation_id  uuid references public.msg_conversations(id) on delete set null,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint carpool_matches_status_chk check (status in ('confirmed', 'cancelled')),
  constraint carpool_matches_seats_chk check (seats between 1 and 8)
);
create index if not exists idx_carpool_matches_org on public.carpool_matches(org_id);
create index if not exists idx_carpool_matches_offer on public.carpool_matches(offer_id);
create unique index if not exists uniq_carpool_matches_request_live on public.carpool_matches(request_id) where status = 'confirmed';

do $$
declare t text;
begin
  foreach t in array array['carpool_offers', 'carpool_requests', 'carpool_matches'] loop
    execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_updated', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', 'trg_' || t || '_updated', t);
    execute format('drop trigger if exists %I on public.%I', 'trg_audit_' || t, t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_trigger()', 'trg_audit_' || t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- Same-org / same-family integrity for offers and requests.
create or replace function public.carpool_post_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.events where id = new.event_id and org_id = new.org_id) then
    raise exception 'CROSS_ORG_REFERENCE: event_id' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.family_members fm join public.families f on f.id = fm.family_id
                  where fm.family_id = new.family_id and fm.profile_id = new.profile_id and f.org_id = new.org_id) then
    raise exception 'CROSS_ORG_REFERENCE: family_id' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and (new.event_id <> old.event_id or new.family_id <> old.family_id or new.profile_id <> old.profile_id) then
    raise exception 'CARPOOL_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_carpool_offers_guard on public.carpool_offers;
create trigger trg_carpool_offers_guard before insert or update on public.carpool_offers
  for each row execute function public.carpool_post_guard();
drop trigger if exists trg_carpool_requests_guard on public.carpool_requests;
create trigger trg_carpool_requests_guard before insert or update on public.carpool_requests
  for each row execute function public.carpool_post_guard();

do $$
declare t text;
begin
  foreach t in array array['carpool_offers', 'carpool_requests'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select using (org_id = public.current_org_id() and public.carpool_can_view(event_id))', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format($p$create policy %I on public.%I for insert with check (
      org_id = public.current_org_id() and profile_id = auth.uid()
      and public.is_guardian_of_family(family_id) and public.carpool_guardian_on_roster(event_id))$p$, t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format($p$create policy %I on public.%I for update
      using (org_id = public.current_org_id() and (profile_id = auth.uid() or public.is_admin()))
      with check (org_id = public.current_org_id() and (profile_id = auth.uid() or public.is_admin()))$p$, t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format($p$create policy %I on public.%I for delete
      using (org_id = public.current_org_id() and (profile_id = auth.uid() or public.is_admin()))$p$, t || '_delete', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

drop policy if exists carpool_matches_select on public.carpool_matches;
create policy carpool_matches_select on public.carpool_matches for select
  using (org_id = public.current_org_id() and public.carpool_can_view(event_id));
drop policy if exists carpool_matches_insert on public.carpool_matches;
create policy carpool_matches_insert on public.carpool_matches for insert with check (false);
drop policy if exists carpool_matches_update on public.carpool_matches;
create policy carpool_matches_update on public.carpool_matches for update using (false);
drop policy if exists carpool_matches_delete on public.carpool_matches;
create policy carpool_matches_delete on public.carpool_matches for delete using (false);
grant select on public.carpool_matches to authenticated;
grant all on public.carpool_matches to service_role;

-- Board for one event: offers, requests, matches with first names only.
create or replace function public.carpool_board(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.carpool_can_view(p_event) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  select jsonb_build_object(
    'offers', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'from_area', o.from_area, 'departs_at', o.departs_at, 'seats_total', o.seats_total,
        'seats_taken', coalesce((select sum(m.seats) from public.carpool_matches m where m.offer_id = o.id and m.status = 'confirmed'), 0),
        'return_trip', o.return_trip, 'note', o.note, 'status', o.status, 'mine', o.profile_id = auth.uid(),
        'name', split_part(coalesce(p.full_name, ''), ' ', 1)) order by o.departs_at)
      from public.carpool_offers o join public.profiles p on p.id = o.profile_id
      where o.event_id = p_event and o.status <> 'cancelled'), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'from_area', r.from_area, 'seats_needed', r.seats_needed, 'return_trip', r.return_trip,
        'note', r.note, 'status', r.status, 'mine', r.profile_id = auth.uid(),
        'name', split_part(coalesce(p.full_name, ''), ' ', 1)) order by r.created_at)
      from public.carpool_requests r join public.profiles p on p.id = r.profile_id
      where r.event_id = p_event and r.status <> 'cancelled'), '[]'::jsonb),
    'matches', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'offer_id', m.offer_id, 'request_id', m.request_id, 'seats', m.seats,
        'conversation_id', case when o.profile_id = auth.uid() or r.profile_id = auth.uid() then m.conversation_id end,
        'mine', o.profile_id = auth.uid() or r.profile_id = auth.uid()))
      from public.carpool_matches m
      join public.carpool_offers o on o.id = m.offer_id
      join public.carpool_requests r on r.id = m.request_id
      where m.event_id = p_event and m.status = 'confirmed'), '[]'::jsonb)
  ) into v;
  return v;
end $$;

-- Match a request to an offer. Allowed for the driver (accepting), the
-- requester (joining), or club staff managing the event. Opens a private
-- in-app thread between the two guardians (names only, no contact details).
create or replace function public.carpool_match(p_offer uuid, p_request uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  o       public.carpool_offers%rowtype;
  r       public.carpool_requests%rowtype;
  v_taken integer;
  v_match uuid;
  v_conv  uuid;
begin
  select * into o from public.carpool_offers where id = p_offer for update;
  select * into r from public.carpool_requests where id = p_request for update;
  if o.id is null or r.id is null or o.event_id <> r.event_id or o.org_id <> public.current_org_id() then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if not (o.profile_id = auth.uid() or r.profile_id = auth.uid() or public.can_manage_event(o.event_id)) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if o.profile_id = r.profile_id or o.family_id = r.family_id then raise exception 'SAME_FAMILY' using errcode = 'P0001'; end if;
  if o.status <> 'open' or r.status <> 'open' then raise exception 'NOT_OPEN' using errcode = 'P0001'; end if;
  if exists (select 1 from public.events where id = o.event_id and (status = 'cancelled' or ends_at < now())) then
    raise exception 'EVENT_CLOSED' using errcode = 'P0001';
  end if;
  select coalesce(sum(seats), 0) into v_taken from public.carpool_matches where offer_id = o.id and status = 'confirmed';
  if v_taken + r.seats_needed > o.seats_total then raise exception 'NOT_ENOUGH_SEATS' using errcode = 'P0001'; end if;

  insert into public.msg_conversations (org_id, kind, subject, sensitive, created_by)
  values (o.org_id, 'direct', null, true, auth.uid()) returning id into v_conv;
  insert into public.msg_participants (org_id, conversation_id, profile_id, side) values
    (o.org_id, v_conv, o.profile_id, 'family'), (o.org_id, v_conv, r.profile_id, 'family');

  insert into public.carpool_matches (org_id, event_id, offer_id, request_id, seats, conversation_id, created_by)
  values (o.org_id, o.event_id, o.id, r.id, r.seats_needed, v_conv, auth.uid()) returning id into v_match;
  update public.carpool_requests set status = 'matched' where id = r.id;
  if v_taken + r.seats_needed >= o.seats_total then
    update public.carpool_offers set status = 'full' where id = o.id;
  end if;
  return jsonb_build_object('match_id', v_match, 'conversation_id', v_conv,
                            'driver_id', o.profile_id, 'passenger_id', r.profile_id, 'event_id', o.event_id);
end $$;

create or replace function public.carpool_cancel_match(p_match uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare m public.carpool_matches%rowtype; o public.carpool_offers%rowtype; r public.carpool_requests%rowtype;
begin
  select * into m from public.carpool_matches where id = p_match for update;
  if m.id is null or m.org_id <> public.current_org_id() or m.status <> 'confirmed' then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  select * into o from public.carpool_offers where id = m.offer_id;
  select * into r from public.carpool_requests where id = m.request_id;
  if not (o.profile_id = auth.uid() or r.profile_id = auth.uid() or public.can_manage_event(m.event_id)) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  update public.carpool_matches set status = 'cancelled' where id = m.id;
  update public.carpool_requests set status = 'open' where id = r.id and status = 'matched';
  update public.carpool_offers set status = 'open' where id = o.id and status = 'full';
  return jsonb_build_object('driver_id', o.profile_id, 'passenger_id', r.profile_id, 'event_id', m.event_id);
end $$;
do $$
declare f text;
begin
  foreach f in array array['carpool_board(uuid)', 'carpool_match(uuid, uuid)', 'carpool_cancel_match(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- ===========================================================================
-- 6) PLAYER JOURNEY: season reviews, placements, scout profiles
-- ===========================================================================
create table if not exists public.player_season_reviews (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  athlete_id          uuid not null references public.athletes(id) on delete cascade,
  season_id           uuid references public.seasons(id) on delete set null,
  team_id             uuid references public.teams(id) on delete set null,
  season_label        text not null,
  coach_comment       text,
  awards              text[] not null default '{}',
  shared_with_family  boolean not null default true,
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint player_season_reviews_label_chk check (length(btrim(season_label)) between 1 and 80),
  constraint player_season_reviews_comment_chk check (coach_comment is null or length(coach_comment) <= 4000),
  constraint player_season_reviews_awards_chk check (coalesce(array_length(awards, 1), 0) <= 10)
);
create index if not exists idx_player_season_reviews_org on public.player_season_reviews(org_id);
create index if not exists idx_player_season_reviews_athlete on public.player_season_reviews(athlete_id);
create unique index if not exists uniq_player_season_reviews on public.player_season_reviews(athlete_id, season_id) where season_id is not null;

create table if not exists public.placement_targets (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  athlete_id    uuid not null references public.athletes(id) on delete cascade,
  target_name   text not null,
  target_kind   text not null default 'school',
  country       text,
  level         text,
  status        text not null default 'interested',
  deadline      date,
  next_step     text,
  notes         text,
  document_ids  uuid[] not null default '{}',
  created_by    uuid references public.profiles(id) on delete set null,
  updated_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint placement_targets_name_chk check (length(btrim(target_name)) between 1 and 160),
  constraint placement_targets_kind_chk check (target_kind in ('school', 'club', 'college', 'academy', 'other')),
  constraint placement_targets_status_chk check (status in ('interested', 'contacted', 'trial', 'offer', 'placed', 'declined', 'withdrawn')),
  constraint placement_targets_text_chk check (
    (country is null or length(country) <= 80) and (level is null or length(level) <= 80)
    and (next_step is null or length(next_step) <= 300) and (notes is null or length(notes) <= 4000)),
  constraint placement_targets_docs_chk check (coalesce(array_length(document_ids, 1), 0) <= 20)
);
create index if not exists idx_placement_targets_org on public.placement_targets(org_id);
create index if not exists idx_placement_targets_athlete on public.placement_targets(athlete_id);

create table if not exists public.placement_status_history (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  placement_id  uuid not null references public.placement_targets(id) on delete cascade,
  from_status   text,
  to_status     text not null,
  actor_id      uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_placement_status_history_org on public.placement_status_history(org_id);
create index if not exists idx_placement_status_history_placement on public.placement_status_history(placement_id, created_at);

create table if not exists public.scout_profiles (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  athlete_id       uuid not null unique references public.athletes(id) on delete cascade,
  token_hash       text not null unique,
  fields           text[] not null default '{}',
  headline         text,
  consent_by       uuid references public.profiles(id) on delete set null,
  consented_at     timestamptz not null,
  consent_version  text not null default '1',
  published_at     timestamptz not null default now(),
  expires_at       timestamptz not null,
  revoked_at       timestamptz,
  revoked_by       uuid references public.profiles(id) on delete set null,
  view_count       integer not null default 0,
  last_viewed_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint scout_profiles_token_chk check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint scout_profiles_fields_chk check (fields <@ array['full_name', 'birth_year', 'position', 'dominant_hand',
    'teams', 'stats', 'attendance', 'evaluation_trend', 'coach_comments', 'awards', 'placements']::text[]),
  constraint scout_profiles_headline_chk check (headline is null or length(headline) <= 200),
  constraint scout_profiles_expiry_chk check (expires_at > published_at and expires_at <= published_at + interval '366 days')
);
create index if not exists idx_scout_profiles_org on public.scout_profiles(org_id);

do $$
declare t text;
begin
  foreach t in array array['player_season_reviews', 'placement_targets', 'placement_status_history', 'scout_profiles'] loop
    execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_updated', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', 'trg_' || t || '_updated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
  foreach t in array array['player_season_reviews', 'placement_targets', 'scout_profiles'] loop
    execute format('drop trigger if exists %I on public.%I', 'trg_audit_' || t, t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_trigger()', 'trg_audit_' || t, t);
  end loop;
end $$;

-- Same-org integrity (+ placement documents must be the athlete's own).
create or replace function public.journey_same_org_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_row jsonb := to_jsonb(new);
begin
  if not exists (select 1 from public.athletes where id = (v_row->>'athlete_id')::uuid and org_id = new.org_id) then
    raise exception 'CROSS_ORG_REFERENCE: athlete_id' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and (v_row->>'athlete_id') <> (to_jsonb(old)->>'athlete_id') then
    raise exception 'JOURNEY_IMMUTABLE' using errcode = 'P0001';
  end if;
  if tg_table_name = 'player_season_reviews' then
    if new.season_id is not null and not exists (select 1 from public.seasons where id = new.season_id and org_id = new.org_id) then
      raise exception 'CROSS_ORG_REFERENCE: season_id' using errcode = 'P0001';
    end if;
    if (v_row->>'team_id') is not null and not exists (select 1 from public.teams where id = (v_row->>'team_id')::uuid and org_id = new.org_id) then
      raise exception 'CROSS_ORG_REFERENCE: team_id' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'placement_targets' then
    if exists (select 1 from (select jsonb_array_elements_text(coalesce(v_row->'document_ids', '[]'::jsonb))::uuid as d) x
                where not exists (select 1 from public.documents doc
                                   where doc.id = x.d and doc.org_id = new.org_id
                                     and (doc.athlete_id = (v_row->>'athlete_id')::uuid
                                          or doc.family_id = (select family_id from public.athletes where id = (v_row->>'athlete_id')::uuid)))) then
      raise exception 'CROSS_ORG_REFERENCE: document_ids' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_player_season_reviews_guard on public.player_season_reviews;
create trigger trg_player_season_reviews_guard before insert or update on public.player_season_reviews
  for each row execute function public.journey_same_org_guard();
drop trigger if exists trg_placement_targets_guard on public.placement_targets;
create trigger trg_placement_targets_guard before insert or update on public.placement_targets
  for each row execute function public.journey_same_org_guard();

-- Status pipeline history.
create or replace function public.placement_status_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.placement_status_history (org_id, placement_id, from_status, to_status, actor_id)
    values (new.org_id, new.id, case when tg_op = 'UPDATE' then old.status end, new.status, auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists trg_placement_status_log on public.placement_targets;
create trigger trg_placement_status_log after insert or update of status on public.placement_targets
  for each row execute function public.placement_status_log();

-- Journey readers: admin, a coach with access to the athlete, the athlete's guardians.
create or replace function public.journey_can_read(p_athlete uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.athletes a where a.id = p_athlete and a.org_id = public.current_org_id())
     and (public.is_admin() or public.coach_can_access_athlete(p_athlete) or public.is_guardian_of_athlete(p_athlete));
$$;
create or replace function public.journey_can_write(p_athlete uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.athletes a where a.id = p_athlete and a.org_id = public.current_org_id())
     and (public.is_admin() or public.coach_can_access_athlete(p_athlete));
$$;
do $$
declare f text;
begin
  foreach f in array array['journey_can_read(uuid)', 'journey_can_write(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

drop policy if exists player_season_reviews_select on public.player_season_reviews;
create policy player_season_reviews_select on public.player_season_reviews for select
  using (org_id = public.current_org_id()
         and (public.journey_can_write(athlete_id) or (shared_with_family and public.is_guardian_of_athlete(athlete_id))));
drop policy if exists placement_targets_select on public.placement_targets;
create policy placement_targets_select on public.placement_targets for select
  using (org_id = public.current_org_id() and public.journey_can_read(athlete_id));
drop policy if exists placement_status_history_select on public.placement_status_history;
create policy placement_status_history_select on public.placement_status_history for select
  using (org_id = public.current_org_id()
         and exists (select 1 from public.placement_targets p where p.id = placement_id and public.journey_can_read(p.athlete_id)));
drop policy if exists placement_status_history_write on public.placement_status_history;
create policy placement_status_history_write on public.placement_status_history for all using (false) with check (false);

do $$
declare t text;
begin
  foreach t in array array['player_season_reviews', 'placement_targets'] loop
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert with check (org_id = public.current_org_id() and public.journey_can_write(athlete_id))', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update using (org_id = public.current_org_id() and public.journey_can_write(athlete_id)) with check (org_id = public.current_org_id() and public.journey_can_write(athlete_id))', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete using (org_id = public.current_org_id() and public.journey_can_write(athlete_id))', t || '_delete', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant select on public.placement_status_history to authenticated;
grant all on public.placement_status_history to service_role;

-- Scout profiles: readable by journey readers (never the token); written only
-- through the RPCs below.
drop policy if exists scout_profiles_select on public.scout_profiles;
create policy scout_profiles_select on public.scout_profiles for select
  using (org_id = public.current_org_id() and public.journey_can_read(athlete_id));
drop policy if exists scout_profiles_insert on public.scout_profiles;
create policy scout_profiles_insert on public.scout_profiles for insert with check (false);
drop policy if exists scout_profiles_update on public.scout_profiles;
create policy scout_profiles_update on public.scout_profiles for update using (false);
drop policy if exists scout_profiles_delete on public.scout_profiles;
create policy scout_profiles_delete on public.scout_profiles for delete using (false);
revoke all on public.scout_profiles from authenticated, anon;
grant select (id, org_id, athlete_id, fields, headline, consent_by, consented_at, consent_version, published_at,
              expires_at, revoked_at, revoked_by, view_count, last_viewed_at, created_at, updated_at)
  on public.scout_profiles to authenticated;
grant all on public.scout_profiles to service_role;

-- Publish (or re-publish with a new link): guardians only, with consent.
create or replace function public.scout_profile_publish(
  p_athlete uuid, p_fields text[], p_days integer, p_token_hash text, p_headline text, p_consent_version text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_org uuid;
  v_fam uuid;
  v_id  uuid;
begin
  select org_id, family_id into v_org, v_fam from public.athletes where id = p_athlete;
  if v_org is null or v_org is distinct from public.current_org_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if not public.is_guardian_of_athlete(p_athlete) then raise exception 'GUARDIAN_CONSENT_REQUIRED' using errcode = '42501'; end if;
  if p_days is null or p_days < 1 or p_days > 365 then raise exception 'INVALID_EXPIRY' using errcode = 'P0001'; end if;
  if coalesce(array_length(p_fields, 1), 0) = 0 then raise exception 'NO_FIELDS' using errcode = 'P0001'; end if;

  insert into public.scout_profiles (org_id, athlete_id, token_hash, fields, headline, consent_by, consented_at,
                                     consent_version, published_at, expires_at, revoked_at, revoked_by, view_count)
  values (v_org, p_athlete, p_token_hash, p_fields, nullif(btrim(p_headline), ''), auth.uid(), now(),
          coalesce(p_consent_version, '1'), now(), now() + make_interval(days => p_days), null, null, 0)
  on conflict (athlete_id) do update
    set token_hash = excluded.token_hash, fields = excluded.fields, headline = excluded.headline,
        consent_by = excluded.consent_by, consented_at = excluded.consented_at,
        consent_version = excluded.consent_version, published_at = excluded.published_at,
        expires_at = excluded.expires_at, revoked_at = null, revoked_by = null, view_count = 0, last_viewed_at = null
  returning id into v_id;

  insert into public.family_consent_events (org_id, family_id, athlete_id, profile_id, kind, granted, version)
  values (v_org, v_fam, p_athlete, auth.uid(), 'scout_profile', true, coalesce(p_consent_version, '1'));
  return v_id;
end $$;

-- Revoke: any guardian of the athlete, or a club admin / the athlete's coach.
create or replace function public.scout_profile_revoke(p_athlete uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid; v_fam uuid;
begin
  select org_id, family_id into v_org, v_fam from public.athletes where id = p_athlete;
  if v_org is null or v_org is distinct from public.current_org_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if not public.journey_can_read(p_athlete) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  update public.scout_profiles set revoked_at = now(), revoked_by = auth.uid()
   where athlete_id = p_athlete and revoked_at is null;
  if public.is_guardian_of_athlete(p_athlete) then
    insert into public.family_consent_events (org_id, family_id, athlete_id, profile_id, kind, granted)
    values (v_org, v_fam, p_athlete, auth.uid(), 'scout_profile', false);
  end if;
end $$;

-- Public view by link token hash (server only, see grants). Only chosen fields; never
-- medical, contact or family data; nothing once expired or revoked.
create or replace function public.scout_profile_view(p_token_hash text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  s   public.scout_profiles%rowtype;
  a   public.athletes%rowtype;
  v   jsonb;
  f   text[];
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into s from public.scout_profiles where token_hash = p_token_hash;
  if not found or s.revoked_at is not null or s.expires_at <= now() then return null; end if;
  select * into a from public.athletes where id = s.athlete_id and org_id = s.org_id and status <> 'archived';
  if not found then return null; end if;
  f := s.fields;

  update public.scout_profiles set view_count = view_count + 1, last_viewed_at = now() where id = s.id;

  v := jsonb_build_object(
    'club', (select name from public.organizations where id = s.org_id),
    'headline', s.headline,
    'expires_at', s.expires_at,
    'name', case when 'full_name' = any(f) then a.first_name || ' ' || a.last_name
                 else a.first_name || ' ' || left(a.last_name, 1) || '.' end);
  if 'birth_year' = any(f) then v := v || jsonb_build_object('birth_year', extract(year from a.dob)::int); end if;
  if 'position' = any(f) then v := v || jsonb_build_object('position', a.position_pref); end if;
  if 'dominant_hand' = any(f) then v := v || jsonb_build_object('dominant_hand', a.dominant_hand); end if;
  if 'teams' = any(f) then
    v := v || jsonb_build_object('teams', coalesce((
      select jsonb_agg(jsonb_build_object('team', t.name, 'season', se.name, 'level', t.level, 'age_group', t.age_group) order by se.starts_on desc nulls last)
        from public.team_memberships tm join public.teams t on t.id = tm.team_id
        left join public.seasons se on se.id = t.season_id
       where tm.athlete_id = a.id and tm.org_id = s.org_id), '[]'::jsonb));
  end if;
  if 'stats' = any(f) then
    v := v || jsonb_build_object('stats', coalesce((
      select jsonb_object_agg(k, total) from (
        select kv.key as k, sum((kv.value)::text::numeric) as total
          from public.event_athlete_stats st, jsonb_each(st.stats) kv
         where st.athlete_id = a.id and st.org_id = s.org_id and jsonb_typeof(kv.value) = 'number'
         group by kv.key) x), '{}'::jsonb)
      || jsonb_build_object('games', (select count(*) from public.event_athlete_stats st where st.athlete_id = a.id and st.org_id = s.org_id)));
  end if;
  if 'attendance' = any(f) then
    v := v || jsonb_build_object('attendance_pct', (
      select case when count(*) = 0 then null
                  else round(100.0 * count(*) filter (where m.status in ('present', 'late')) / count(*)) end
        from public.attendance_marks m where m.athlete_id = a.id and m.org_id = s.org_id));
  end if;
  if 'evaluation_trend' = any(f) then
    v := v || jsonb_build_object('evaluations', coalesce((
      select jsonb_agg(jsonb_build_object('date', e.evaluated_on, 'score', e.overall_score) order by e.evaluated_on)
        from public.evaluations e
       where e.athlete_id = a.id and e.org_id = s.org_id and e.shared_with_family and e.overall_score is not null), '[]'::jsonb));
  end if;
  if 'coach_comments' = any(f) or 'awards' = any(f) then
    v := v || jsonb_build_object('seasons', coalesce((
      select jsonb_agg(jsonb_build_object(
               'season', r.season_label,
               'comment', case when 'coach_comments' = any(f) then r.coach_comment end,
               'awards', case when 'awards' = any(f) then to_jsonb(r.awards) else '[]'::jsonb end)
             order by r.created_at desc)
        from public.player_season_reviews r
       where r.athlete_id = a.id and r.org_id = s.org_id and r.shared_with_family), '[]'::jsonb));
  end if;
  if 'placements' = any(f) then
    v := v || jsonb_build_object('placements', coalesce((
      select jsonb_agg(jsonb_build_object('name', p.target_name, 'kind', p.target_kind, 'status', p.status))
        from public.placement_targets p
       where p.athlete_id = a.id and p.org_id = s.org_id and p.status in ('offer', 'placed')), '[]'::jsonb));
  end if;
  return v;
end $$;

revoke all on function public.scout_profile_publish(uuid, text[], integer, text, text, text) from public, anon;
grant execute on function public.scout_profile_publish(uuid, text[], integer, text, text, text) to authenticated, service_role;
revoke all on function public.scout_profile_revoke(uuid) from public, anon;
grant execute on function public.scout_profile_revoke(uuid) to authenticated, service_role;
-- Server only: the public /scout/[token] page hashes the token and calls this
-- with the service role (anon never executes security definer code here).
revoke all on function public.scout_profile_view(text) from public, anon, authenticated;
grant execute on function public.scout_profile_view(text) to service_role;

-- Season history for one athlete (teams, results, stats, attendance,
-- evaluation trend, reviews). Same readers as the journey.
create or replace function public.player_journey(p_athlete uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_guardian_only boolean;
begin
  if not public.journey_can_read(p_athlete) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  v_org := public.current_org_id();
  v_guardian_only := not public.journey_can_write(p_athlete);
  return jsonb_build_object(
    'seasons', coalesce((
      select jsonb_agg(x order by x->>'starts_on' desc nulls last) from (
        select jsonb_build_object(
          'season_id', se.id, 'season', se.name, 'starts_on', se.starts_on, 'ends_on', se.ends_on,
          'teams', (select coalesce(jsonb_agg(distinct t.name), '[]'::jsonb)
                      from public.team_memberships tm join public.teams t on t.id = tm.team_id
                     where tm.athlete_id = p_athlete and t.season_id = se.id),
          'games', (select count(*) from public.event_athlete_stats st join public.events e on e.id = st.event_id
                     where st.athlete_id = p_athlete and e.season_id = se.id),
          'record', (select jsonb_build_object(
                        'wins', count(*) filter (where gr.outcome = 'win'),
                        'losses', count(*) filter (where gr.outcome = 'loss'),
                        'draws', count(*) filter (where gr.outcome = 'draw'))
                       from public.team_memberships tm join public.teams t on t.id = tm.team_id
                       join public.events e on e.team_id = t.id join public.game_results gr on gr.event_id = e.id
                      where tm.athlete_id = p_athlete and t.season_id = se.id),
          'stats', (select coalesce(jsonb_object_agg(k, total), '{}'::jsonb) from (
                      select kv.key as k, sum((kv.value)::text::numeric) as total
                        from public.event_athlete_stats st join public.events e on e.id = st.event_id,
                             jsonb_each(st.stats) kv
                       where st.athlete_id = p_athlete and e.season_id = se.id and jsonb_typeof(kv.value) = 'number'
                       group by kv.key) s2),
          'attendance_pct', (select case when count(*) = 0 then null
                                         else round(100.0 * count(*) filter (where m.status in ('present', 'late')) / count(*)) end
                               from public.attendance_marks m join public.attendance_sessions s on s.id = m.attendance_session_id
                              where m.athlete_id = p_athlete and s.session_date::date between se.starts_on and se.ends_on),
          'evaluations', (select coalesce(jsonb_agg(jsonb_build_object('date', e.evaluated_on, 'score', e.overall_score) order by e.evaluated_on), '[]'::jsonb)
                            from public.evaluations e
                           where e.athlete_id = p_athlete and e.overall_score is not null
                             and e.evaluated_on between se.starts_on and se.ends_on
                             and (not v_guardian_only or e.shared_with_family)),
          'review', (select jsonb_build_object('id', r.id, 'comment', r.coach_comment, 'awards', to_jsonb(r.awards), 'shared', r.shared_with_family)
                       from public.player_season_reviews r
                      where r.athlete_id = p_athlete and r.season_id = se.id
                        and (not v_guardian_only or r.shared_with_family) limit 1)
        ) as x
        from public.seasons se
       where se.org_id = v_org
         and (exists (select 1 from public.team_memberships tm join public.teams t on t.id = tm.team_id
                       where tm.athlete_id = p_athlete and t.season_id = se.id)
              or exists (select 1 from public.player_season_reviews r where r.athlete_id = p_athlete and r.season_id = se.id))
      ) q), '[]'::jsonb),
    'other_reviews', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'season', r.season_label, 'comment', r.coach_comment,
                                          'awards', to_jsonb(r.awards), 'shared', r.shared_with_family) order by r.created_at desc)
        from public.player_season_reviews r
       where r.athlete_id = p_athlete and r.season_id is null and (not v_guardian_only or r.shared_with_family)), '[]'::jsonb)
  );
end $$;
revoke all on function public.player_journey(uuid) from public, anon;
grant execute on function public.player_journey(uuid) to authenticated, service_role;
