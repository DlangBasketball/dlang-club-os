-- ============================================================================
-- Programme team seasons + archive / delete a team
-- (migration 20250420102700_team_delete.sql, data script
--  supabase/seeds/selection_eybl_dlang.sql)
--
--   A. Season: the EYBL data script puts its division teams in the current
--      season; any new programme team gets one; a rerun backfills.
--   B. create_division_team: "<programme> <division>", season, sport, level;
--      admin of the club only.
--   C. Preview: counts and blockers; finance / coach / parent refused; org B
--      admin cannot reach org A teams (cross-tenant denial).
--   D. Archive + restore: hidden (is_active false), roster kept, upcoming
--      events cancelled; restore puts it back. Only admins.
--   E. Permanent delete: blocked by history (past games); otherwise roster,
--      coaches, upcoming events + RSVPs, division link removed; players and
--      invoices kept; no orphan row anywhere (generic single-column FK check).
--   F. selection_delete_division: live applications block unless moved; the
--      team is kept / archived / deleted as asked.
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach …f3 =
-- coach …011, guardian …f4 of family …061 with athlete …071). Org B …0002
-- (seed_tenants.sql); its admin is created here. SYNTHETIC DATA ONLY.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema td;
grant usage on schema td to authenticated, anon, service_role;

create function td.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

-- Run p_sql as user p. 'OK:<first column>' or 'ERR:<message>'.
create function td.run_as(p uuid, p_sql text) returns text language plpgsql as $$
declare v_msg text; v_res text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
    if p is null then execute 'set local role service_role'; else execute 'set local role authenticated'; end if;
    execute p_sql into v_res;
    execute 'reset role';
    perform set_config('request.jwt.claim.sub', '', true);
    return 'OK:' || coalesce(v_res, '<null>');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    execute 'reset role';
    perform set_config('request.jwt.claim.sub', '', true);
    return 'ERR:' || coalesce(v_msg, 'error');
  end;
end $$;
grant execute on all functions in schema td to authenticated, anon, service_role;

-- Generic orphan check: every single-column foreign key in public, child
-- values that have no parent row (same check as tests/db/person_delete.sql).
create function td.orphans() returns bigint language plpgsql as $$
declare con record; n bigint; total bigint := 0;
begin
  for con in
    select c.conrelid::regclass as child, ca.attname as ccol, c.confrelid::regclass as parent, pa.attname as pcol
      from pg_constraint c
      join pg_attribute ca on ca.attrelid = c.conrelid and ca.attnum = c.conkey[1]
      join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
     where c.contype = 'f' and array_length(c.conkey, 1) = 1 and c.connamespace = 'public'::regnamespace
  loop
    execute format('select count(*) from %s c where c.%I is not null and not exists (select 1 from %s p where p.%I = c.%I)',
                   con.child, con.ccol, con.parent, con.pcol, con.ccol) into n;
    if n > 0 then raise notice 'orphans: %.% -> % = %', con.child, con.ccol, con.parent, n; end if;
    total := total + n;
  end loop;
  return total;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures
--   season  e…51 current (2026-08-01 .. 2027-07-31), e…52 previous
--   T1 e…a1 team with history (past game + result) — archive only
--   T2 e…a2 team without history, linked to a division — deletable
--   T3 e…a3 org B team
--   AB e…0b admin of org B
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values ('e0000000-0000-0000-0000-00000000000b', 'td-admin-b@example.test');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'e0000000-0000-0000-0000-00000000000b';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-00000000000b', 'admin');

insert into public.seasons (id, org_id, name, starts_on, ends_on, is_current) values
  ('e0000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000001', 'Synthetic 2026-27', '2026-08-01', '2027-07-31', true),
  ('e0000000-0000-0000-0000-000000000052', '00000000-0000-0000-0000-000000000001', 'Synthetic 2025-26', '2025-08-01', '2026-07-31', false);

-- ===========================================================================
-- A. Season of programme teams (data script, trigger, backfill)
-- ===========================================================================
\i supabase/seeds/selection_eybl_dlang.sql

do $$
declare v_prog uuid; v_team uuid; n int;
begin
  select id into v_prog from public.programs where org_id = '00000000-0000-0000-0000-000000000001' and slug = 'eybl';
  select count(*) into n from public.teams t join public.program_divisions d on d.team_id = t.id
   where d.program_id = v_prog and t.season_id = 'e0000000-0000-0000-0000-000000000051';
  perform td.ok(n = 2, 'EYBL U14 / U16 are in the current season (' || n || ')');

  -- An old team without a season is backfilled by a rerun.
  update public.teams set season_id = null where id = (select team_id from public.program_divisions where program_id = v_prog and name = 'U16');
  perform td.ok((select season_id is null from public.teams t join public.program_divisions d on d.team_id = t.id
                  where d.program_id = v_prog and d.name = 'U16'), 'fixture: U16 team without season');
end $$;

\i supabase/seeds/selection_eybl_dlang.sql

do $$
declare v_prog uuid; v_team uuid; v text;
begin
  select id into v_prog from public.programs where org_id = '00000000-0000-0000-0000-000000000001' and slug = 'eybl';
  perform td.ok((select season_id = 'e0000000-0000-0000-0000-000000000051' from public.teams t join public.program_divisions d on d.team_id = t.id
                  where d.program_id = v_prog and d.name = 'U16'), 'rerun puts the U16 team back in the current season');
  perform td.ok((select count(*) = 2 from public.teams where program_id = v_prog), 'rerun creates no extra team');

  -- Admin creates a programme team without a season: the trigger fills it.
  v := td.run_as('00000000-0000-0000-0000-0000000000f1',
    format($q$insert into public.teams (org_id, program_id, name) values ('00000000-0000-0000-0000-000000000001', %L, 'Synthetic Prog Team') returning season_id::text$q$, v_prog));
  perform td.ok(v = 'OK:e0000000-0000-0000-0000-000000000051', 'new programme team gets the current season (' || v || ')');
  -- A team without a programme keeps "no season"; an explicit season is kept.
  v := td.run_as('00000000-0000-0000-0000-0000000000f1',
    $q$insert into public.teams (org_id, name) values ('00000000-0000-0000-0000-000000000001', 'Synthetic Free Team') returning coalesce(season_id::text, 'none')$q$);
  perform td.ok(v = 'OK:none', 'team without programme keeps no season');
  v := td.run_as('00000000-0000-0000-0000-0000000000f1',
    format($q$insert into public.teams (org_id, program_id, season_id, name) values ('00000000-0000-0000-0000-000000000001', %L, 'e0000000-0000-0000-0000-000000000052', 'Synthetic Old Team') returning season_id::text$q$, v_prog));
  perform td.ok(v = 'OK:e0000000-0000-0000-0000-000000000052', 'explicit season is kept');
  -- The programme start date picks its season (start in the previous season).
  update public.programs set starts_on = '2026-03-01' where id = v_prog;
  perform td.ok(public.default_team_season('00000000-0000-0000-0000-000000000001', v_prog) = 'e0000000-0000-0000-0000-000000000052',
                'programme start date selects the season containing it');
  update public.programs set starts_on = '2026-09-01' where id = v_prog;
  -- Never another club's season.
  perform td.ok(public.default_team_season('10000000-0000-0000-0000-000000000002', v_prog) is null, 'no season across clubs');
  v := td.run_as('00000000-0000-0000-0000-0000000000f1',
    format($q$select public.default_team_season('00000000-0000-0000-0000-000000000001', %L)::text$q$, v_prog));
  perform td.ok(v like 'ERR:%permission denied%', 'default_team_season is not callable by users');
end $$;

-- ===========================================================================
-- B. create_division_team
-- ===========================================================================
do $$
declare v_prog uuid; v_div uuid; v text; t record;
begin
  select id into v_prog from public.programs where org_id = '00000000-0000-0000-0000-000000000001' and slug = 'eybl';
  insert into public.program_divisions (org_id, program_id, name, min_birth_year, sort)
  values ('00000000-0000-0000-0000-000000000001', v_prog, 'U18', 2009, 3) returning id into v_div;

  foreach v in array array['00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000f4'] loop
    perform td.ok(td.run_as(v::uuid, format($q$select public.create_division_team(%L)::text$q$, v_div)) like 'ERR:%NOT_AUTHORIZED%',
                  'non-admin cannot create a division team (' || v || ')');
  end loop;
  v := td.run_as('e0000000-0000-0000-0000-00000000000b', format($q$select public.create_division_team(%L)::text$q$, v_div));
  perform td.ok(v like 'ERR:%NOT_FOUND%', 'org B admin cannot create a team for an org A division');

  v := td.run_as('00000000-0000-0000-0000-0000000000f1', format($q$select public.create_division_team(%L)::text$q$, v_div));
  perform td.ok(v like 'OK:%', 'admin creates the division team (' || v || ')');
  select * into t from public.teams where id = substr(v, 4)::uuid;
  perform td.ok(t.name = 'EYBL U18', 'default name "<programme short name> <division>" (' || t.name || ')');
  perform td.ok(t.season_id = 'e0000000-0000-0000-0000-000000000051', 'division team in the current season');
  perform td.ok(t.program_id = v_prog and t.age_group = 'U18' and t.level = 'EYBL' and t.sport = 'basketball', 'programme, age group, level, sport');
  perform td.ok((select team_id = t.id from public.program_divisions where id = v_div), 'division linked to its team');
  v := td.run_as('00000000-0000-0000-0000-0000000000f1', format($q$select public.create_division_team(%L)::text$q$, v_div));
  perform td.ok(v like 'ERR:%DIVISION_HAS_TEAM%', 'second team for the same division refused');
  perform td.ok(exists (select 1 from public.audit_logs where action = 'team.create_for_division' and target_id = t.id), 'creation audited');
end $$;

-- ===========================================================================
-- Teams T1 (history), T2 (deletable), T3 (org B)
-- ===========================================================================
insert into public.teams (id, org_id, season_id, name, sport) values
  ('e0000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000051', 'Synthetic Tigers', 'basketball'),
  ('e0000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000051', 'Synthetic Lynx', 'basketball'),
  ('e0000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-000000000002', null, 'Synthetic B Team', 'basketball');
insert into public.team_memberships (org_id, team_id, athlete_id, jersey_number) values
  ('00000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000071', 7),
  ('00000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000071', 9);
insert into public.team_coaches (team_id, coach_id, org_id, role) values
  ('e0000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'head'),
  ('e0000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'head');
insert into public.events (id, org_id, team_id, type, starts_at, ends_at, status) values
  ('e0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-0000000000a1', 'game', now() - interval '7 days', now() - interval '7 days' + interval '2 hours', 'completed'),
  ('e0000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-0000000000a1', 'training', now() + interval '3 days', now() + interval '3 days' + interval '90 minutes', 'scheduled'),
  ('e0000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-0000000000a2', 'training', now() + interval '4 days', now() + interval '4 days' + interval '90 minutes', 'scheduled'),
  ('e0000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-0000000000a2', 'game', now() + interval '9 days', now() + interval '9 days' + interval '2 hours', 'scheduled');
insert into public.game_results (event_id, org_id, score_for, score_against) values
  ('e0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001', 70, 64);
insert into public.event_rsvps (event_id, athlete_id, org_id, status) values
  ('e0000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000001', 'going'),
  ('e0000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000001', 'going'),
  ('e0000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000001', 'maybe');
insert into public.kit_assignments (org_id, team_id, athlete_id, status, include_jersey, include_shorts, include_warmup) values
  ('00000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000071', 'sizes_requested', true, true, false);
update public.program_divisions set team_id = 'e0000000-0000-0000-0000-0000000000a2'
 where program_id = (select id from public.programs where org_id = '00000000-0000-0000-0000-000000000001' and slug = 'eybl') and name = 'U14';

-- ===========================================================================
-- C. Preview + who may call
-- ===========================================================================
do $$
declare v text; j jsonb; who uuid;
begin
  v := td.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.preview_delete_team('e0000000-0000-0000-0000-0000000000a1')::text$q$);
  perform td.ok(v like 'OK:%', 'admin previews (' || left(v, 60) || ')');
  j := substr(v, 4)::jsonb;
  perform td.ok((j->>'players')::int = 1 and (j->>'coaches')::int = 1 and (j->>'upcoming_events')::int = 1, 'T1 counts: 1 player, 1 coach, 1 upcoming event');
  perform td.ok((j->>'past_games')::int = 1 and (j->>'results')::int = 1, 'T1 counts: 1 past game with result');
  perform td.ok(not (j->>'can_delete')::boolean and j->'blockers' ? 'past_events', 'T1 permanent delete blocked by past events');
  perform td.ok((select is_active from public.teams where id = 'e0000000-0000-0000-0000-0000000000a1'), 'preview changes nothing');

  v := td.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.preview_delete_team('e0000000-0000-0000-0000-0000000000a2')::text$q$);
  j := substr(v, 4)::jsonb;
  perform td.ok((j->>'can_delete')::boolean and (j->>'linked_divisions')::int = 1 and (j->>'upcoming_events')::int = 2,
                'T2 deletable, 1 linked division, 2 upcoming events');
  perform td.ok(j->'divisions'->0->>'name' = 'U14', 'linked division listed by name');

  foreach who in array array['00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000f4']::uuid[] loop
    perform td.ok(td.run_as(who, $q$select public.preview_delete_team('e0000000-0000-0000-0000-0000000000a1')::text$q$) like 'ERR:%NOT_AUTHORIZED%',
                  'preview refused for finance / coach / parent (' || who || ')');
    perform td.ok(td.run_as(who, $q$select public.delete_team('e0000000-0000-0000-0000-0000000000a2', 'archive')::text$q$) like 'ERR:%NOT_AUTHORIZED%',
                  'archive refused for finance / coach / parent (' || who || ')');
    perform td.ok(td.run_as(who, $q$select public.delete_team('e0000000-0000-0000-0000-0000000000a2', 'delete')::text$q$) like 'ERR:%NOT_AUTHORIZED%',
                  'delete refused for finance / coach / parent (' || who || ')');
  end loop;
  -- Direct table writes stay closed for non-admins too.
  v := td.run_as('00000000-0000-0000-0000-0000000000f3',
                 $q$with d as (delete from public.teams where id = 'e0000000-0000-0000-0000-0000000000a2' returning 1) select count(*)::text from d$q$);
  perform td.ok(v = 'OK:0' or v like 'ERR:%', 'coach cannot delete the team row directly (' || v || ')');
  perform td.ok(exists (select 1 from public.teams where id = 'e0000000-0000-0000-0000-0000000000a2'), 'T2 still there');

  -- Cross-tenant: org B admin cannot see, archive or delete org A teams; org A admin cannot touch org B.
  v := td.run_as('e0000000-0000-0000-0000-00000000000b', $q$select public.preview_delete_team('e0000000-0000-0000-0000-0000000000a1')::text$q$);
  perform td.ok(v like 'ERR:%NOT_FOUND%', 'org B admin cannot preview an org A team');
  v := td.run_as('e0000000-0000-0000-0000-00000000000b', $q$select public.delete_team('e0000000-0000-0000-0000-0000000000a2', 'delete')::text$q$);
  perform td.ok(v like 'ERR:%NOT_FOUND%', 'org B admin cannot delete an org A team');
  v := td.run_as('e0000000-0000-0000-0000-00000000000b', $q$select public.delete_team('e0000000-0000-0000-0000-0000000000a1', 'archive')::text$q$);
  perform td.ok(v like 'ERR:%NOT_FOUND%', 'org B admin cannot archive an org A team');
  v := td.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.delete_team('e0000000-0000-0000-0000-0000000000a3', 'delete')::text$q$);
  perform td.ok(v like 'ERR:%NOT_FOUND%', 'org A admin cannot delete an org B team');
  perform td.ok((select count(*) = 3 from public.teams where id in ('e0000000-0000-0000-0000-0000000000a1', 'e0000000-0000-0000-0000-0000000000a2', 'e0000000-0000-0000-0000-0000000000a3')),
                'no team removed by refused calls');
  v := td.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.team_remove('e0000000-0000-0000-0000-0000000000a2', 'delete', null)::text$q$);
  perform td.ok(v like 'ERR:%permission denied%', 'internal worker not callable by users');
  v := td.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.team_delete_impact('e0000000-0000-0000-0000-0000000000a3')::text$q$);
  perform td.ok(v like 'ERR:%permission denied%', 'internal impact not callable by users');
end $$;

-- ===========================================================================
-- D. Archive + restore
-- ===========================================================================
do $$
declare v text; j jsonb;
begin
  v := td.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.delete_team('e0000000-0000-0000-0000-0000000000a1', 'delete')::text$q$);
  perform td.ok(v like 'ERR:%TEAM_DELETE_BLOCKED%', 'permanent delete of a team with history is refused (' || v || ')');
  perform td.ok(exists (select 1 from public.teams where id = 'e0000000-0000-0000-0000-0000000000a1'), 'T1 kept');

  v := td.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.delete_team('e0000000-0000-0000-0000-0000000000a1')::text$q$);
  perform td.ok(v like 'OK:%', 'archive is the default mode');
  j := substr(v, 4)::jsonb;
  perform td.ok(j->>'mode' = 'archive' and (j->>'events_cancelled')::int = 1, 'archive cancelled 1 upcoming event');
  perform td.ok((select not is_active from public.teams where id = 'e0000000-0000-0000-0000-0000000000a1'), 'archived team inactive');
  perform td.ok((select count(*) = 1 from public.team_memberships where team_id = 'e0000000-0000-0000-0000-0000000000a1'), 'roster kept');
  perform td.ok((select count(*) = 1 from public.team_coaches where team_id = 'e0000000-0000-0000-0000-0000000000a1'), 'coaches kept');
  perform td.ok((select status = 'cancelled' from public.events where id = 'e0000000-0000-0000-0000-0000000000e2'), 'upcoming event cancelled');
  perform td.ok((select status = 'completed' from public.events where id = 'e0000000-0000-0000-0000-0000000000e1')
                and exists (select 1 from public.game_results where event_id = 'e0000000-0000-0000-0000-0000000000e1'), 'past game and result kept');
  perform td.ok(exists (select 1 from public.audit_logs where action = 'team.archive' and target_id = 'e0000000-0000-0000-0000-0000000000a1'), 'archive audited');
  perform td.ok(not exists (select 1 from public.audit_logs where action like 'team.%' and new_data::text ilike '%first_name%'), 'audit carries no player data');

  perform td.ok(td.run_as('00000000-0000-0000-0000-0000000000f3', $q$select public.restore_team('e0000000-0000-0000-0000-0000000000a1')::text$q$) like 'ERR:%NOT_AUTHORIZED%',
                'coach cannot restore');
  perform td.ok(td.run_as('e0000000-0000-0000-0000-00000000000b', $q$select public.restore_team('e0000000-0000-0000-0000-0000000000a1')::text$q$) like 'ERR:%NOT_FOUND%',
                'org B admin cannot restore an org A team');
  v := td.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.restore_team('e0000000-0000-0000-0000-0000000000a1')::text$q$);
  perform td.ok(v like 'OK:%', 'admin restores');
  perform td.ok((select is_active from public.teams where id = 'e0000000-0000-0000-0000-0000000000a1'), 'restored team active again');
  perform td.ok((select count(*) = 1 from public.team_memberships where team_id = 'e0000000-0000-0000-0000-0000000000a1' and status <> 'inactive'), 'roster back with the team');
  v := td.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.restore_team('e0000000-0000-0000-0000-0000000000a1')::text$q$);
  perform td.ok(v like 'ERR:%NOT_ARCHIVED%', 'restoring an active team is refused');
  perform td.ok(exists (select 1 from public.audit_logs where action = 'team.restore' and target_id = 'e0000000-0000-0000-0000-0000000000a1'), 'restore audited');
end $$;

-- ===========================================================================
-- E. Permanent delete
-- ===========================================================================
do $$
declare v text; j jsonb; n_inv bigint; n_ath bigint;
begin
  select count(*) into n_inv from public.invoices;
  select count(*) into n_ath from public.athletes;
  v := td.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.delete_team('e0000000-0000-0000-0000-0000000000a2', 'delete')::text$q$);
  perform td.ok(v like 'OK:%', 'admin deletes T2 permanently (' || left(v, 80) || ')');
  j := substr(v, 4)::jsonb;
  perform td.ok(j->>'mode' = 'delete' and (j->>'events_deleted')::int = 2, 'two upcoming events removed');
  perform td.ok(not exists (select 1 from public.teams where id = 'e0000000-0000-0000-0000-0000000000a2'), 'team row gone');
  perform td.ok(not exists (select 1 from public.team_memberships where team_id = 'e0000000-0000-0000-0000-0000000000a2'), 'roster rows gone');
  perform td.ok(not exists (select 1 from public.team_coaches where team_id = 'e0000000-0000-0000-0000-0000000000a2'), 'coach assignments gone');
  perform td.ok(not exists (select 1 from public.events where id in ('e0000000-0000-0000-0000-0000000000e3', 'e0000000-0000-0000-0000-0000000000e4')), 'upcoming events gone');
  perform td.ok(not exists (select 1 from public.event_rsvps where event_id in ('e0000000-0000-0000-0000-0000000000e3', 'e0000000-0000-0000-0000-0000000000e4')), 'their RSVPs gone');
  perform td.ok(not exists (select 1 from public.program_divisions where team_id = 'e0000000-0000-0000-0000-0000000000a2')
                and exists (select 1 from public.program_divisions where name = 'U14' and team_id is null
                              and program_id = (select id from public.programs where org_id = '00000000-0000-0000-0000-000000000001' and slug = 'eybl')),
                'division kept, unlinked');
  perform td.ok((select count(*) from public.invoices) = n_inv, 'no invoice deleted');
  perform td.ok((select count(*) from public.athletes) = n_ath and exists (select 1 from public.athletes where id = '00000000-0000-0000-0000-000000000071'), 'no player deleted');
  perform td.ok(exists (select 1 from public.team_memberships where athlete_id = '00000000-0000-0000-0000-000000000071'), 'player keeps the other team');
  perform td.ok(td.orphans() = 0, 'generic orphan check over all single-column foreign keys');
  perform td.ok(exists (select 1 from public.audit_logs where action = 'team.delete' and target_id = 'e0000000-0000-0000-0000-0000000000a2'), 'delete audited');
  v := td.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.delete_team('e0000000-0000-0000-0000-0000000000a2', 'delete')::text$q$);
  perform td.ok(v like 'ERR:%NOT_FOUND%', 'deleting twice is refused');
  v := td.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.delete_team('e0000000-0000-0000-0000-0000000000a1', 'purge')::text$q$);
  perform td.ok(v like 'ERR:%INVALID_MODE%', 'unknown mode refused');
end $$;

-- ===========================================================================
-- F. Delete a programme division
-- ===========================================================================
do $$
declare v text; v_prog uuid; v_u16 uuid; v_u18 uuid; v_u16_team uuid; v_u18_team uuid; v_app uuid;
begin
  select id into v_prog from public.programs where org_id = '00000000-0000-0000-0000-000000000001' and slug = 'eybl';
  select id, team_id into v_u16, v_u16_team from public.program_divisions where program_id = v_prog and name = 'U16';
  select id, team_id into v_u18, v_u18_team from public.program_divisions where program_id = v_prog and name = 'U18';
  insert into public.program_applications (org_id, program_id, division_id, athlete_id, family_id, status)
  values ('00000000-0000-0000-0000-000000000001', v_prog, v_u18, '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000061', 'applied')
  returning id into v_app;

  perform td.ok(td.run_as('00000000-0000-0000-0000-0000000000f3', format($q$select public.selection_delete_division(%L)::text$q$, v_u18)) like 'ERR:%NOT_AUTHORIZED%',
                'coach cannot delete a division');
  perform td.ok(td.run_as('e0000000-0000-0000-0000-00000000000b', format($q$select public.selection_delete_division(%L)::text$q$, v_u18)) like 'ERR:%DIVISION_NOT_FOUND%',
                'org B admin cannot delete an org A division');
  v := td.run_as('00000000-0000-0000-0000-0000000000f1', format($q$select public.selection_delete_division(%L)::text$q$, v_u18));
  perform td.ok(v like 'ERR:%DIVISION_HAS_APPLICATIONS%', 'live applications block the delete (' || v || ')');
  perform td.ok(exists (select 1 from public.program_divisions where id = v_u18), 'division kept');

  v := td.run_as('00000000-0000-0000-0000-0000000000f1', format($q$select public.selection_delete_division(%L, %L, 'archive')::text$q$, v_u18, v_u16));
  perform td.ok(v like 'OK:%', 'move applications to U16, delete U18, archive its team (' || left(v, 80) || ')');
  perform td.ok(not exists (select 1 from public.program_divisions where id = v_u18), 'U18 deleted');
  perform td.ok((select division_id = v_u16 from public.program_applications where id = v_app), 'application moved to U16');
  perform td.ok((select not is_active from public.teams where id = v_u18_team), 'U18 team archived');
  perform td.ok(exists (select 1 from public.audit_logs where action = 'selection.division_delete' and target_id = v_u18), 'division delete audited');

  -- Withdrawn applications do not block; the team can be deleted with the division.
  update public.program_applications set status = 'withdrawn' where id = v_app;
  v := td.run_as('00000000-0000-0000-0000-0000000000f1', format($q$select public.selection_delete_division(%L, null, 'delete')::text$q$, v_u16));
  perform td.ok(v like 'OK:%', 'U16 (withdrawn application only) deleted with its team (' || left(v, 80) || ')');
  perform td.ok(not exists (select 1 from public.teams where id = v_u16_team), 'U16 team deleted');
  perform td.ok((select division_id is null from public.program_applications where id = v_app), 'withdrawn application kept, unlinked');
  perform td.ok(td.orphans() = 0, 'no orphan rows after division + team delete');
end $$;
