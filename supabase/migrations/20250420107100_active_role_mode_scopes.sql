-- ============================================================================
-- Club OS - Role switcher, part 2: coach and family scopes follow the mode.
--
-- 20250420107000 made has_role() follow the active mode. Coach access and
-- family access are not staff roles: they come from the coach record
-- (current_coach_id) and from family / relative links (is_guardian_of_*,
-- athlete_link_can). Verified on staging through the REST API: in Parent mode
-- the coached team's players were still readable, in Coach mode the own
-- family's invoices. Now:
--   * Coach mode:  coach scope on,  family scope off;
--   * Parent mode: coach scope off, family scope on;
--   * Admin mode and no mode (single-role people): both as before.
-- Additive and idempotent.
-- ============================================================================

create or replace function public.mode_allows_scope(p_scope text)
returns boolean language sql stable security definer set search_path = public as $$
  select case public.current_active_mode()
           when 'coach'  then p_scope = 'coach'
           when 'parent' then p_scope = 'guardian'
           else true end;
$$;
grant execute on function public.mode_allows_scope(text) to authenticated, anon, service_role;

create or replace function public.current_coach_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.coaches
   where profile_id = auth.uid() and org_id = public.current_org_id()
     and public.mode_allows_scope('coach')
   limit 1;
$$;

create or replace function public.is_guardian_of_family(p_family uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.mode_allows_scope('guardian') and exists (
    select 1 from public.family_members fm join public.families f on f.id = fm.family_id
     where fm.family_id = p_family and fm.profile_id = auth.uid() and f.org_id = public.current_org_id());
$$;

create or replace function public.is_guardian_of_athlete(p_athlete uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.mode_allows_scope('guardian') and exists (
    select 1 from public.athletes a join public.family_members fm on fm.family_id = a.family_id
     where a.id = p_athlete and fm.profile_id = auth.uid() and a.org_id = public.current_org_id());
$$;

create or replace function public.is_any_guardian()
returns boolean language sql stable security definer set search_path = public as $$
  select public.mode_allows_scope('guardian') and exists (
    select 1 from public.family_members fm join public.families f on f.id = fm.family_id
     where fm.profile_id = auth.uid() and f.org_id = public.current_org_id());
$$;

-- Relatives linked to one child: family scope too.
create or replace function public.athlete_link_can(p_athlete uuid, p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_athlete is not null and auth.uid() is not null and public.mode_allows_scope('guardian') and exists (
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
             when 'consent' then l.can_consent and public.org_carer_consent_enabled(l.org_id)
             else false end);
$$;
