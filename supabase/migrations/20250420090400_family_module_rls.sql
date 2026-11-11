-- ============================================================================
-- DLang Basketball — Club OS
-- Migration 05 · Family/athlete module: medical column-security for coaches
--
-- "Store medical securely" + "coaches only see relevant athlete info":
--   * The base athlete_medical row is now readable ONLY by admins and the
--     owning guardian (finance never; coaches not via the table).
--   * Coaches get a SAFETY SUBSET (allergies, conditions, emergency contact)
--     through a SECURITY DEFINER function that re-checks access. This gives
--     column-level security that plain row-level RLS can't express.
-- Admin create/edit/delete on families & athletes is already covered by the
-- existing FOR ALL policies (is_finance() ⊇ admin); deletes cascade via FKs.
-- ============================================================================

-- Free-text notes on an athlete (requirement: store athlete notes).
alter table public.athletes add column if not exists notes text;

-- Tighten base medical reads: drop coach access from the table itself.
drop policy if exists medical_select on public.athlete_medical;
create policy medical_select on public.athlete_medical for select
  using (
    public.is_admin()
    or public.is_guardian_of_athlete(athlete_id)
  );

-- Safety subset for anyone allowed to see the athlete (admin, guardian, or a
-- coach assigned to them). Returns at most one row; nothing if not permitted.
create or replace function public.athlete_safety(p_athlete uuid)
returns table (
  allergies text,
  conditions text,
  emergency_contact_name text,
  emergency_contact_phone text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    public.is_admin()
    or public.is_guardian_of_athlete(p_athlete)
    or public.coach_can_access_athlete(p_athlete)
  ) then
    return; -- no rows for unauthorized callers
  end if;

  return query
    select m.allergies, m.conditions, m.emergency_contact_name, m.emergency_contact_phone
    from public.athlete_medical m
    where m.athlete_id = p_athlete;
end;
$$;

grant execute on function public.athlete_safety(uuid) to authenticated;
