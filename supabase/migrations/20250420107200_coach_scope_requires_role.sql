-- ============================================================================
-- Club OS - Role switcher, part 3: a coach record counts only while the person
-- still holds a coach (or admin) role in the club.
--
-- Found while verifying revocation on staging: after the coach role was
-- removed, the app moved the person out of Coach mode, but the coach record
-- still linked to their login kept answering current_coach_id(), so coach
-- access through the API remained. Now the coach scope needs the role too.
-- Additive and idempotent.
-- ============================================================================
create or replace function public.current_coach_id()
returns uuid language sql stable security definer set search_path = public as $$
  select c.id from public.coaches c
   where c.profile_id = auth.uid() and c.org_id = public.current_org_id()
     and public.mode_allows_scope('coach')
     and exists (select 1 from public.staff_roles r
                  where r.profile_id = c.profile_id and r.org_id = c.org_id and r.role in ('coach', 'admin'))
   limit 1;
$$;
