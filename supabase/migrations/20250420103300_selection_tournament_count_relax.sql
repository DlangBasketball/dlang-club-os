-- EYBL / selection: saving an enrolment no longer stops on "the number of
-- tournaments does not match the package" when the tournament selection is
-- unchanged or empty (the tournament schedule is often published later).
-- A changed, non-empty selection that does not match still needs a reason.
-- Replaces one function; idempotent.

create or replace function public.selection_set_tournaments_internal(
  p_application uuid, p_tournaments uuid[], p_override_reason text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  a        public.program_applications;
  v_ids    uuid[] := coalesce((select array_agg(distinct x) from unnest(coalesce(p_tournaments, '{}'::uuid[])) x where x is not null), '{}'::uuid[]);
  v_need   int;
  v_n      int := cardinality(coalesce((select array_agg(distinct x) from unnest(coalesce(p_tournaments, '{}'::uuid[])) x where x is not null), '{}'::uuid[]));
  v_reason text := nullif(btrim(coalesce(p_override_reason, '')), '');
  v_same   boolean;
begin
  select * into a from public.program_applications where id = p_application for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if a.status = 'withdrawn' then raise exception 'ENROLLMENT_WITHDRAWN' using errcode = 'P0001'; end if;
  if exists (select 1 from unnest(v_ids) x
              where not exists (select 1 from public.program_tournaments t
                                 where t.id = x and t.program_id = a.program_id and t.org_id = a.org_id)) then
    raise exception 'TOURNAMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(v_ids) x join public.program_tournaments t on t.id = x
              where t.division_id is not null and t.division_id is distinct from a.division_id) then
    raise exception 'TOURNAMENT_DIVISION_MISMATCH' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.application_tournaments x
              where x.tournament_id = any(v_ids) and x.athlete_id = a.athlete_id and x.status = 'covered'
                and x.application_id <> a.id) then
    raise exception 'DUPLICATE_TOURNAMENT' using errcode = 'P0001';
  end if;
  v_need := coalesce(a.tournaments_covered_count, (select tournament_count from public.program_packages where id = a.package_id));
  -- Unchanged selection (e.g. saving other details) or none assigned yet (schedule
  -- not published): no reason needed. A changed, non-empty selection that does not
  -- match the package still needs one.
  v_same := coalesce((select array_agg(x.tournament_id order by x.tournament_id) from public.application_tournaments x
                       where x.application_id = a.id and x.status = 'covered'), '{}'::uuid[])
            = coalesce((select array_agg(x order by x) from unnest(v_ids) x), '{}'::uuid[]);
  if v_need is not null and v_n <> v_need and v_n > 0 and not v_same and v_reason is null then
    raise exception 'TOURNAMENT_COUNT_MISMATCH' using errcode = 'P0001';
  end if;
  delete from public.application_tournaments
   where application_id = a.id and status = 'covered' and not (tournament_id = any(v_ids));
  insert into public.application_tournaments (org_id, application_id, tournament_id, status)
  select a.org_id, a.id, x, 'covered' from unnest(v_ids) x
  on conflict (application_id, tournament_id) do update
    set status = 'covered', withdrawn_at = null, withdrawn_by = null, note = null
    where public.application_tournaments.status <> 'covered';
  update public.program_applications
     set tournament_override_reason = case when v_need is not null and v_n <> v_need
                                           then coalesce(left(v_reason, 500), a.tournament_override_reason) end
   where id = a.id;
  return v_n;
end $$;
