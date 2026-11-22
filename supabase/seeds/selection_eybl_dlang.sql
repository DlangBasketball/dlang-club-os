-- ============================================================================
-- Data script (NOT a test seed — testing/seed_plan.conf skips it;
-- tests/db/selection_programs.sql runs it explicitly, twice).
--
-- Configures the founding club's international EYBL team as a selection
-- programme, using only the generic capability of migration
-- 20250420102600_selection_programs.sql (no club-specific code):
--
--   Programme  "EYBL 2026-27" (slug eybl), kind selection, public, published,
--              approval required, non-members may apply
--   Divisions  U14 (born 2013 or later), U16 (born 2011-2012), each with its
--              own team "EYBL U14" / "EYBL U16" (roster on enrolment), in the
--              club season containing the programme start (else the current
--              season: public.default_team_season), so the Teams page lists
--              them under the current season. A rerun puts division teams
--              still without a season into it.
--   Packages   1 tournament   1500  instalments 1-5   (300 / month x 5)
--              2 tournaments  3000  instalments 1-10  (300 / month x 10)
--              3 tournaments  4500  instalments 1-10  (450 / month x 10)
--              (currency: the club's; tournament count and monthly amount
--              set where empty — roster fee arrangements)
--   Tournaments not seeded: entered by the club in the app (Set-up tab)
--   Coaches    "Derrick Lang" head coach, "Ademir Sunj" assistant (looked up
--              by display name; skipped when absent)
--
-- Runs only when the organisation 00000000-0000-0000-0000-000000000001
-- exists. Idempotent and non-destructive: rerunning only adds what is
-- missing; prices, counts and names the club edited in the app are kept.
--
--   scripts/seed-selection-eybl.sh             (uses $DATABASE_URL)
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seeds/selection_eybl_dlang.sql
-- ============================================================================
do $$
declare
  c_org  constant uuid := '00000000-0000-0000-0000-000000000001';
  v_prog uuid;
  v_team uuid;
  v_season uuid;
  v_coach uuid;
  d      record;
  k      record;
  c      record;
begin
  if not exists (select 1 from public.organizations where id = c_org) then
    raise notice 'selection_eybl_dlang: organisation % not found — nothing to do', c_org;
    return;
  end if;

  insert into public.programs (org_id, slug, name, kind, description, price_chf, starts_on, ends_on, is_public, is_active,
                               status, season, season_year, selection_enabled, requires_approval, allow_non_members)
  values (c_org, 'eybl', 'EYBL 2026-27', 'selection',
          'International youth team in the European Youth Basketball League (EYBL). Open to club members and to players from other clubs. Selection by the coaching staff.',
          1500, '2026-09-01', '2027-05-31', true, true, 'published', 'fall', 2026, true, true, true)
  on conflict (org_id, slug) do nothing;
  select id into v_prog from public.programs where org_id = c_org and slug = 'eybl';
  -- Always a selection programme (the only flags re-asserted on a rerun).
  update public.programs set selection_enabled = true where id = v_prog and not selection_enabled;

  for d in select * from (values ('U14', 2013, null::int, 1), ('U16', 2011, 2012, 2)) as x(name, y_from, y_to, sort) loop
    if not exists (select 1 from public.program_divisions where program_id = v_prog and lower(name) = lower(d.name)) then
      select id into v_team from public.teams
       where org_id = c_org and lower(name) = lower('EYBL ' || d.name) and program_id = v_prog limit 1;
      if v_team is null then
        insert into public.teams (org_id, program_id, season_id, name, sport, age_group, level)
        values (c_org, v_prog, public.default_team_season(c_org, v_prog), 'EYBL ' || d.name, 'basketball', d.name, 'EYBL')
        on conflict do nothing
        returning id into v_team;
      end if;
      insert into public.program_divisions (org_id, program_id, name, min_birth_year, max_birth_year, team_id, sort)
      values (c_org, v_prog, d.name, d.y_from, d.y_to, v_team, d.sort);
    end if;
  end loop;

  -- Division teams without a season (created before seasons were set up, or
  -- by an earlier version of this script): into the programme's season, when
  -- the name is still free there.
  v_season := public.default_team_season(c_org, v_prog);
  if v_season is not null then
    update public.teams t set season_id = v_season
     where t.org_id = c_org and t.season_id is null
       and t.id in (select team_id from public.program_divisions where program_id = v_prog and team_id is not null)
       and not exists (select 1 from public.teams x where x.org_id = c_org and x.season_id = v_season and lower(x.name) = lower(t.name));
  end if;

  for k in select * from (values
      ('1 tournament', 1500.00, array[1,2,3,4,5], 1, 1, 300.00),
      ('2 tournaments', 3000.00, array[1,2,3,4,5,6,7,8,9,10], 2, 2, 300.00),
      ('3 tournaments', 4500.00, array[1,2,3,4,5,6,7,8,9,10], 3, 3, 450.00)) as x(name, price, counts, sort, tournaments, monthly) loop
    insert into public.program_packages (org_id, program_id, name, price, allowed_counts, show_monthly, sort)
    select c_org, v_prog, k.name, k.price, k.counts, true, k.sort
     where not exists (select 1 from public.program_packages where program_id = v_prog and lower(name) = lower(k.name));
    -- Roster fee arrangements (migration 20250420102900): tournaments covered
    -- and default monthly amount, only where the club has not set them.
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'program_packages' and column_name = 'tournament_count') then
      execute 'update public.program_packages set tournament_count = coalesce(tournament_count, $1), monthly_amount = coalesce(monthly_amount, $2)
                where program_id = $3 and lower(name) = lower($4) and (tournament_count is null or monthly_amount is null)'
        using k.tournaments, k.monthly, v_prog, k.name;
    end if;
  end loop;
  -- Tournaments / stages are NOT seeded: the club enters them in
  -- Admin -> Selection -> EYBL -> Set-up -> Tournaments (name, dates,
  -- location), then assigns them per player on the roster.

  for c in select * from (values ('Derrick Lang', 'head'), ('Ademir Sunj', 'assistant')) as x(display_name, role) loop
    select id into v_coach from public.coaches where org_id = c_org and lower(display_name) = lower(c.display_name) limit 1;
    if v_coach is null then
      raise notice 'selection_eybl_dlang: coach "%" not found — skipped', c.display_name;
      continue;
    end if;
    insert into public.program_coaches (org_id, program_id, coach_id, role)
    select c_org, v_prog, v_coach, c.role
     where not exists (select 1 from public.program_coaches where program_id = v_prog and coach_id = v_coach and division_id is null);
  end loop;

  raise notice 'selection_eybl_dlang: programme % ready', v_prog;
end $$;
