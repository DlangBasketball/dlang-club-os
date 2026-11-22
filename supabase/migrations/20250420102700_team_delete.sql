-- ============================================================================
-- Club OS · Programme teams always have a season + archive / delete a team
--
--   1. default_team_season(org, program)
--      The season a programme team belongs to: the club season whose dates
--      contain the programme's start date (the current one first), else the
--      club's current season, else none. A BEFORE INSERT trigger on teams
--      fills season_id with it for every new team linked to a programme
--      (selection divisions, the Teams page, data scripts, imports), so
--      programme teams never fall out of the current-season Teams list.
--      Existing programme-division teams without a season are backfilled
--      (only when the name is free in that season).
--   2. create_division_team(division, name)                    admin only
--      Creates the team of a programme division ("<programme> <division>",
--      same sport, age group = division, level of a sibling team, season
--      from 1.) and links it to the division, in one transaction.
--   3. preview_delete_team(team)                               admin only
--      Counts: players, coaches, upcoming events, past events / games,
--      results and stats, linked divisions, team-channel messages,
--      outstanding kit, billing links; blockers of a permanent delete.
--   4. delete_team(team, mode)                                 admin only
--      'archive' (default): is_active = false (hidden from every picker),
--        roster, coaches and history kept, upcoming events cancelled.
--        Restorable with restore_team(team).
--      'delete' (permanent): refused (TEAM_DELETE_BLOCKED) while the team
--        has history that must not disappear with it: past events (games,
--        results, statistics, attendance), team-channel messages or kit
--        still ordered / handed out. Archive keeps those. Otherwise:
--        divisions unlinked, upcoming events and their RSVPs removed, roster
--        and coach assignments removed, then the team row (remaining
--        dependants cascade or are unlinked by their own keys; invoices,
--        payment plans, expenses and players are never deleted).
--   5. restore_team(team)                                      admin only
--   6. selection_delete_division(division, move_to, team_mode) admin only
--      Deletes a programme division. Live applications (not declined /
--      withdrawn) block it unless move_to names another division of the
--      same programme (applications and division coaches move there). The
--      division's team is kept, archived or deleted (team_mode).
--
--   Finance, coaches and parents cannot archive / delete / restore. Every
--   change is audit-logged (ids, names of teams and counts only; no personal
--   data). Additive and idempotent. Tests: tests/db/team_delete.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Season of a programme team
-- ---------------------------------------------------------------------------
create or replace function public.default_team_season(p_org uuid, p_program uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.id
       from public.programs p
       join public.seasons s on s.org_id = p.org_id
      where p.id = p_program and p.org_id = p_org and p.starts_on is not null
        and p.starts_on between s.starts_on and s.ends_on
      order by s.is_current desc, s.starts_on desc
      limit 1),
    (select s.id from public.seasons s where s.org_id = p_org and s.is_current limit 1)
  )
$$;

comment on function public.default_team_season(uuid, uuid) is
  'Season of a programme team: the season containing the programme start date (current first), else the current season.';

create or replace function public.teams_default_season()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.season_id is null and new.program_id is not null then
    new.season_id := public.default_team_season(new.org_id, new.program_id);
  end if;
  return new;
end $$;

-- Name sorts before trg_teams_org so the org check validates the filled season.
drop trigger if exists trg_teams_default_season on public.teams;
create trigger trg_teams_default_season before insert on public.teams
  for each row execute function public.teams_default_season();

-- Backfill: division teams created without a season (name free in the season).
do $$
declare r record; v_season uuid;
begin
  for r in
    select distinct t.id, t.org_id, t.program_id, t.name
      from public.teams t
      join public.program_divisions d on d.team_id = t.id
     where t.season_id is null and t.program_id is not null
  loop
    v_season := public.default_team_season(r.org_id, r.program_id);
    if v_season is not null and not exists (
      select 1 from public.teams x where x.org_id = r.org_id and x.season_id = v_season and lower(x.name) = lower(r.name)
    ) then
      update public.teams set season_id = v_season where id = r.id;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Team of a programme division
-- ---------------------------------------------------------------------------
create or replace function public.create_division_team(p_division uuid, p_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  d        record;
  v_name   text;
  v_short  text;
  v_sport  text;
  v_level  text;
  v_team   uuid;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select pd.*, p.name as program_name, p.sport_id as program_sport_id
    into d
    from public.program_divisions pd join public.programs p on p.id = pd.program_id
   where pd.id = p_division;
  if not found or d.org_id is distinct from public.current_org_id() then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if d.team_id is not null and exists (select 1 from public.teams where id = d.team_id) then
    raise exception 'DIVISION_HAS_TEAM' using errcode = 'P0001';
  end if;

  -- Programme short name: the name without a trailing season ("EYBL 2026-27" -> "EYBL").
  v_short := btrim(regexp_replace(d.program_name, '[\s·–—-]*\(?\d{4}(\s*[-/–]\s*\d{2,4})?\)?\s*$', ''));
  if v_short = '' then v_short := btrim(d.program_name); end if;
  v_name := left(btrim(coalesce(nullif(btrim(p_name), ''), v_short || ' ' || d.name)), 120);

  select t.sport, t.level into v_sport, v_level
    from public.teams t
   where t.org_id = d.org_id and t.program_id = d.program_id and t.is_active
   order by t.created_at
   limit 1;
  if v_sport is null and d.program_sport_id is not null then
    select name into v_sport from public.sports where id = d.program_sport_id and org_id = d.org_id;
  end if;

  insert into public.teams (org_id, program_id, name, sport, age_group, level)
  values (d.org_id, d.program_id, v_name, v_sport, left(d.name, 200), coalesce(v_level, left(v_short, 200)))
  returning id into v_team;
  if d.program_sport_id is not null then
    update public.teams set sport_id = d.program_sport_id where id = v_team;
  end if;
  update public.program_divisions set team_id = v_team where id = p_division;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (d.org_id, auth.uid(), 'team.create_for_division', 'teams', v_team,
          jsonb_build_object('division_id', p_division, 'program_id', d.program_id, 'name', v_name));
  return v_team;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Impact of removing a team
-- ---------------------------------------------------------------------------
create or replace function public.team_delete_check(p_team uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select org_id into v_org from public.teams where id = p_team;
  if v_org is null or v_org is distinct from public.current_org_id() then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  return v_org;
end $$;

-- Internal (no caller check): callers check first.
create or replace function public.team_delete_impact(p_team uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t record;
  v jsonb;
  n_players int; n_members int; n_coaches int; n_upcoming int; n_past int; n_games int;
  n_results int; n_stats int; n_divisions int; n_messages int := 0; n_kit int := 0; n_billing int := 0;
  v_divisions jsonb;
  v_blockers text[] := '{}';
begin
  select id, org_id, name, is_active into t from public.teams where id = p_team;
  select count(*) filter (where status <> 'inactive'), count(*) into n_players, n_members from public.team_memberships where team_id = p_team;
  select count(*) into n_coaches from public.team_coaches where team_id = p_team;
  select count(*) into n_upcoming from public.events
   where team_id = p_team and starts_at >= now() and status in ('scheduled', 'postponed');
  select count(*), count(*) filter (where type in ('game', 'tournament')) into n_past, n_games from public.events
   where team_id = p_team and starts_at < now() and status <> 'cancelled';
  select count(*) into n_results from public.game_results r join public.events e on e.id = r.event_id where e.team_id = p_team;
  select count(*) into n_stats from public.event_athlete_stats s join public.events e on e.id = s.event_id where e.team_id = p_team;
  select count(*), coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'program_id', d.program_id, 'program_name', p.name)
                                      order by p.name, d.sort, d.name), '[]'::jsonb)
    into n_divisions, v_divisions
    from public.program_divisions d join public.programs p on p.id = d.program_id where d.team_id = p_team;
  if to_regclass('public.msg_messages') is not null then
    execute 'select count(*) from public.msg_messages m join public.msg_conversations c on c.id = m.conversation_id where c.team_id = $1'
      into n_messages using p_team;
  end if;
  if to_regclass('public.kit_assignments') is not null then
    execute 'select count(*) from public.kit_assignments where team_id = $1 and status in (''ordered'', ''handed_out'')'
      into n_kit using p_team;
  end if;
  if to_regclass('public.payment_plans') is not null then
    execute 'select count(*) from public.payment_plans where team_id = $1' into n_billing using p_team;
  end if;
  if to_regclass('public.recurring_fee_templates') is not null then
    execute 'select $2 + count(*) from public.recurring_fee_templates where team_id = $1' into n_billing using p_team, n_billing;
  end if;

  if n_past > 0 or n_results > 0 or n_stats > 0 then v_blockers := array_append(v_blockers, 'past_events'); end if;
  if n_messages > 0 then v_blockers := array_append(v_blockers, 'messages'); end if;
  if n_kit > 0 then v_blockers := array_append(v_blockers, 'kit'); end if;

  return jsonb_build_object(
    'team_id', p_team, 'name', t.name, 'is_active', t.is_active,
    'players', n_players, 'memberships', n_members, 'coaches', n_coaches,
    'upcoming_events', n_upcoming, 'past_events', n_past, 'past_games', n_games,
    'results', n_results, 'stats', n_stats,
    'linked_divisions', n_divisions, 'divisions', v_divisions,
    'messages', n_messages, 'kit_outstanding', n_kit, 'billing_links', n_billing,
    'blockers', to_jsonb(v_blockers), 'can_delete', cardinality(v_blockers) = 0);
end $$;

create or replace function public.preview_delete_team(p_team uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.team_delete_check(p_team);
  return public.team_delete_impact(p_team);
end $$;

-- ---------------------------------------------------------------------------
-- 4) Archive / delete (internal worker + checked entry point)
-- ---------------------------------------------------------------------------
create or replace function public.team_remove(p_team uuid, p_mode text, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_impact jsonb;
  n_cancelled int := 0;
  n_events_deleted int := 0;
begin
  select org_id into v_org from public.teams where id = p_team for update;
  if v_org is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  v_impact := public.team_delete_impact(p_team);

  if coalesce(p_mode, 'archive') = 'archive' then
    update public.teams set is_active = false where id = p_team;
    update public.events set status = 'cancelled'
     where team_id = p_team and starts_at >= now() and status in ('scheduled', 'postponed');
    get diagnostics n_cancelled = row_count;
    insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
    values (v_org, p_actor, 'team.archive', 'teams', p_team,
            jsonb_build_object('name', v_impact->>'name', 'events_cancelled', n_cancelled,
                               'counts', v_impact - 'divisions' - 'name' - 'team_id'));
    return v_impact || jsonb_build_object('mode', 'archive', 'events_cancelled', n_cancelled);
  end if;

  if p_mode <> 'delete' then raise exception 'INVALID_MODE' using errcode = 'P0001'; end if;
  if not (v_impact->>'can_delete')::boolean then
    raise exception 'TEAM_DELETE_BLOCKED' using errcode = 'P0001',
      detail = array_to_string(array(select jsonb_array_elements_text(v_impact->'blockers')), ',');
  end if;

  update public.program_divisions set team_id = null where team_id = p_team;
  -- Only upcoming or cancelled events are left (past ones block): their
  -- RSVPs, results and other dependants go with them.
  delete from public.events where team_id = p_team;
  get diagnostics n_events_deleted = row_count;
  delete from public.team_memberships where team_id = p_team;
  delete from public.team_coaches where team_id = p_team;
  delete from public.teams where id = p_team;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, p_actor, 'team.delete', 'teams', p_team,
          jsonb_build_object('name', v_impact->>'name', 'events_deleted', n_events_deleted,
                             'counts', v_impact - 'divisions' - 'name' - 'team_id'));
  return v_impact || jsonb_build_object('mode', 'delete', 'events_deleted', n_events_deleted);
end $$;

create or replace function public.delete_team(p_team uuid, p_mode text default 'archive')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.team_delete_check(p_team);
  if coalesce(p_mode, 'archive') not in ('archive', 'delete') then raise exception 'INVALID_MODE' using errcode = 'P0001'; end if;
  return public.team_remove(p_team, coalesce(p_mode, 'archive'), auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- 5) Restore an archived team
-- ---------------------------------------------------------------------------
create or replace function public.restore_team(p_team uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid; v_name text;
begin
  v_org := public.team_delete_check(p_team);
  update public.teams set is_active = true where id = p_team and not is_active returning name into v_name;
  if v_name is null then raise exception 'NOT_ARCHIVED' using errcode = 'P0001'; end if;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, auth.uid(), 'team.restore', 'teams', p_team, jsonb_build_object('name', v_name));
  return jsonb_build_object('team_id', p_team, 'name', v_name, 'is_active', true);
end $$;

-- ---------------------------------------------------------------------------
-- 6) Delete a programme division
-- ---------------------------------------------------------------------------
create or replace function public.selection_delete_division(p_division uuid, p_move_to uuid default null, p_team_mode text default 'keep')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
  n_live int;
  n_moved int := 0;
  v_team jsonb := null;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into d from public.program_divisions where id = p_division for update;
  if not found or d.org_id is distinct from public.current_org_id() then raise exception 'DIVISION_NOT_FOUND' using errcode = 'P0002'; end if;
  if coalesce(p_team_mode, 'keep') not in ('keep', 'archive', 'delete') then raise exception 'INVALID_MODE' using errcode = 'P0001'; end if;

  select count(*) into n_live from public.program_applications
   where division_id = p_division and status not in ('declined', 'withdrawn');
  if n_live > 0 then
    if p_move_to is null then
      raise exception 'DIVISION_HAS_APPLICATIONS' using errcode = 'P0001', detail = n_live::text;
    end if;
    if p_move_to = p_division or not exists (
      select 1 from public.program_divisions where id = p_move_to and program_id = d.program_id and org_id = d.org_id
    ) then
      raise exception 'DIVISION_NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;

  if p_move_to is not null and p_move_to <> p_division and exists (
    select 1 from public.program_divisions where id = p_move_to and program_id = d.program_id and org_id = d.org_id
  ) then
    update public.program_applications set division_id = p_move_to
     where division_id = p_division and status not in ('declined', 'withdrawn');
    get diagnostics n_moved = row_count;
    -- Division coaches follow, unless already assigned there.
    update public.program_coaches c set division_id = p_move_to
     where c.division_id = p_division
       and not exists (select 1 from public.program_coaches x where x.program_id = c.program_id and x.coach_id = c.coach_id and x.division_id = p_move_to);
  end if;

  delete from public.program_divisions where id = p_division;

  if d.team_id is not null and coalesce(p_team_mode, 'keep') <> 'keep' and exists (select 1 from public.teams where id = d.team_id and org_id = d.org_id) then
    v_team := public.team_remove(d.team_id, p_team_mode, auth.uid());
  end if;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (d.org_id, auth.uid(), 'selection.division_delete', 'program_divisions', p_division,
          jsonb_build_object('name', d.name, 'program_id', d.program_id, 'team_id', d.team_id),
          jsonb_build_object('moved_to', p_move_to, 'applications_moved', n_moved, 'team_mode', coalesce(p_team_mode, 'keep')));
  return jsonb_build_object('division_id', p_division, 'applications_moved', n_moved, 'team', v_team);
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.team_delete_impact(uuid)', 'public.team_remove(uuid, text, uuid)', 'public.teams_default_season()',
    'public.default_team_season(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon, authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;
  foreach f in array array[
    'public.create_division_team(uuid, text)', 'public.team_delete_check(uuid)',
    'public.preview_delete_team(uuid)', 'public.delete_team(uuid, text)', 'public.restore_team(uuid)',
    'public.selection_delete_division(uuid, uuid, text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
      execute format('grant execute on function %s to authenticated, service_role', f);
    end if;
  end loop;
end $$;
