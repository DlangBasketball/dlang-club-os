-- ============================================================================
-- DLang Basketball — Club OS
-- Migration 04 · Auth: invitations, onboarding, invite-aware signup
--
-- Adds the admin-invites-a-user flow on top of the existing auth stack:
--   * invitations table (admin creates; links email -> org + role + family/coach)
--   * profiles.onboarding_completed_at (gates the onboarding flow)
--   * handle_new_user() upgraded to CONSUME a pending invitation on first
--     sign-in: it sets the org, assigns the staff role, links the guardian to
--     their family (parent), and/or links a coach record — atomically, as the
--     SECURITY DEFINER trigger (bypasses RLS).
-- ============================================================================

-- ---- Onboarding flag -------------------------------------------------------
alter table public.profiles
  add column if not exists onboarding_completed_at timestamptz;

-- ---- Invitation status -----------------------------------------------------
create type public.invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');

-- ---- Invitations -----------------------------------------------------------
create table public.invitations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  email         citext not null,
  role          public.app_role not null default 'parent',
  family_id     uuid references public.families(id) on delete cascade,  -- for parents
  coach_id      uuid references public.coaches(id) on delete set null,  -- for coaches
  relation      text,                                                   -- mother | father | guardian
  status        public.invitation_status not null default 'pending',
  token         uuid not null default gen_random_uuid(),
  invited_by    uuid references public.profiles(id) on delete set null,
  expires_at    timestamptz not null default (now() + interval '14 days'),
  accepted_at   timestamptz,
  accepted_by   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- At most one OPEN invite per email per org.
create unique index uniq_invitations_pending
  on public.invitations(org_id, email) where status = 'pending';
create index idx_invitations_open_email
  on public.invitations(email) where status = 'pending';
create index idx_invitations_family on public.invitations(family_id);

create trigger trg_invitations_updated before update on public.invitations
  for each row execute function public.set_updated_at();

-- Audit invitation lifecycle alongside invoices/payments/medical/etc.
create trigger trg_audit_invitations
  after insert or update or delete on public.invitations
  for each row execute function public.audit_trigger();

-- ---- Helper: current user's email (SECURITY DEFINER, no RLS recursion) -----
create or replace function public.current_user_email()
returns citext language sql stable security definer set search_path = public as $$
  select email from public.profiles where id = auth.uid();
$$;

-- ---- handle_new_user: now invitation-aware ---------------------------------
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
  -- Most recent still-valid invitation for this email, if any.
  select * into v_inv
  from public.invitations
  where email = new.email
    and status = 'pending'
    and expires_at > now()
  order by created_at desc
  limit 1;

  v_org := coalesce(
    v_inv.org_id,
    (select id from public.organizations order by created_at limit 1)
  );

  -- 1) Always create the profile (onboarding still incomplete).
  insert into public.profiles (id, org_id, email, full_name, locale)
  values (
    new.id,
    v_org,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce(new.raw_user_meta_data->>'locale', 'en')
  )
  on conflict (id) do nothing;

  -- 2) Consume the invitation, if present.
  if v_inv.id is not null then
    -- Staff role (parent access derives from family_members, so only
    -- materialize a staff_roles row for non-parent roles).
    if v_inv.role <> 'parent' then
      insert into public.staff_roles (org_id, profile_id, role)
      values (v_inv.org_id, new.id, v_inv.role)
      on conflict (org_id, profile_id, role) do nothing;
    end if;

    -- Link a guardian to their family.
    if v_inv.family_id is not null then
      insert into public.family_members (family_id, profile_id, relation, is_primary)
      values (
        v_inv.family_id,
        new.id,
        coalesce(v_inv.relation, 'guardian'),
        not exists (select 1 from public.family_members where family_id = v_inv.family_id)
      )
      on conflict (family_id, profile_id) do nothing;
    end if;

    -- Link a coach record to this login (so current_coach_id() resolves).
    if v_inv.coach_id is not null then
      update public.coaches set profile_id = new.id where id = v_inv.coach_id;
    end if;

    -- Mark the invitation accepted.
    update public.invitations
      set status = 'accepted', accepted_at = now(), accepted_by = new.id
      where id = v_inv.id;
  end if;

  return new;
end;
$$;

-- ---- RLS on invitations ----------------------------------------------------
alter table public.invitations enable row level security;

-- Admins manage invitations within their org.
create policy invitations_admin_all on public.invitations for all
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());

-- The invited person can read their own invitation (by email match), e.g. to
-- show "you've been invited to the Lopes family" during onboarding.
create policy invitations_invitee_select on public.invitations for select
  using (email = public.current_user_email());
