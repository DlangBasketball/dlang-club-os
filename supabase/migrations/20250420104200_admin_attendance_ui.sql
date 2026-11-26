-- ============================================================================
-- Admin attendance UI support (team pages, session page, player profile)
--
--   1. admin_session_attendance(team?, athlete?, from?, to?, season?, limit)
--      Per-session attendance history for the admin team page and the player
--      profile: event, sheet status, per-status counts, and (with p_athlete)
--      that player's status. Finalized sheets report finalized values; drafts
--      report the live draft values (the UI labels them as not final and never
--      counts them in totals). Admin only, own club only.
--   2. attendance_alert_retry(alert)
--      Admin re-queues a failed (or no_contact with a guardian) no-show alert:
--      status 'pending', attempts reset, due now. The dispatcher then delivers
--      it as usual (claim + record). Audited 'attendance.alert_retry'.
--
-- Additive and idempotent (create or replace). No table changes.
-- Base contract: docs/team-attendance.md. Tests: tests/db/admin_attendance_ui.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Session attendance history (admin)
-- ---------------------------------------------------------------------------
create or replace function public.admin_session_attendance(p_team uuid default null, p_athlete uuid default null,
                                                           p_from date default null, p_to date default null,
                                                           p_season uuid default null, p_limit integer default 200)
returns table (event_id uuid, team_id uuid, team_name text, event_type text, title text, starts_at timestamptz,
               ends_at timestamptz, event_status text, cancel_reason text, local_date date, sheet_status text,
               finalized boolean, tracked boolean, present integer, late integer, excused integer, unexcused integer,
               unmarked integer, total integer, athlete_status text, athlete_is_guest boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org  uuid := public.current_org_id();
  v_from date := p_from;
  v_to   date := p_to;
  v_ws   date;
  v_we   date;
begin
  if v_org is null or not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_from is not null and p_to is not null and p_to < p_from then raise exception 'INVALID_RANGE' using errcode = 'P0001'; end if;
  if p_team is not null and not exists (select 1 from public.teams t where t.id = p_team and t.org_id = v_org) then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_athlete is not null and not exists (select 1 from public.athletes a where a.id = p_athlete and a.org_id = v_org) then
    raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_season is not null then
    select coalesce(s.training_starts_on, s.starts_on), coalesce(s.training_ends_on, s.ends_on) into v_ws, v_we
      from public.seasons s where s.id = p_season and s.org_id = v_org;
    if v_ws is null then raise exception 'SEASON_NOT_FOUND' using errcode = 'P0002'; end if;
    v_from := greatest(coalesce(v_from, v_ws), v_ws);
    v_to := least(coalesce(v_to, v_we), v_we);
  end if;

  return query
  with ev as (
    select e.*, (e.starts_at at time zone public.ta_tz(e.org_id))::date as ld
      from public.events e
     where e.org_id = v_org
       and e.team_id is not null
       and e.type::text = any(public.ta_sheet_types())
       and (p_team is null or e.team_id = p_team)
       and (p_season is null or coalesce(e.season_id, (select t2.season_id from public.teams t2 where t2.id = e.team_id)) = p_season)
       and (p_athlete is null or exists (select 1 from public.team_attendance_marks m0
                                          where m0.event_id = e.id and m0.athlete_id = p_athlete))
  )
  select ev.id, ev.team_id, t.name, ev.type::text, ev.title, ev.starts_at, ev.ends_at, ev.status::text, ev.cancel_reason,
         ev.ld, s.status, coalesce(s.finalize_count, 0) > 0, public.ta_event_tracked(ev.id),
         coalesce(c.present, 0), coalesce(c.late, 0), coalesce(c.excused, 0), coalesce(c.unexcused, 0),
         coalesce(c.unmarked, 0), coalesce(c.total, 0),
         am.st, am.is_guest
    from ev
    join public.teams t on t.id = ev.team_id
    left join public.team_attendance_sheets s on s.event_id = ev.id
    left join lateral (
      select count(*) filter (where x.st = 'present')::int as present,
             count(*) filter (where x.st = 'late')::int as late,
             count(*) filter (where x.st = 'excused')::int as excused,
             count(*) filter (where x.st = 'unexcused')::int as unexcused,
             count(*) filter (where x.st = 'unmarked')::int as unmarked,
             count(*)::int as total
        from (select case when s.finalize_count > 0 then coalesce(m.finalized_status, m.status) else m.status end as st
                from public.team_attendance_marks m where m.sheet_id = s.id) x
    ) c on s.id is not null
    left join lateral (
      select case when s.finalize_count > 0 then coalesce(m.finalized_status, m.status) else m.status end as st, m.is_guest
        from public.team_attendance_marks m
       where p_athlete is not null and m.event_id = ev.id and m.athlete_id = p_athlete
    ) am on true
   where (v_from is null or ev.ld >= v_from)
     and (v_to is null or ev.ld <= v_to)
     and (p_season is null or ev.type <> 'training' or public.ta_in_training_window(ev.id))
   order by ev.starts_at desc
   limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Retry a no-show alert (admin)
-- ---------------------------------------------------------------------------
create or replace function public.attendance_alert_retry(p_alert uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.attendance_no_show_alerts%rowtype; v_ev public.events%rowtype;
begin
  select * into a from public.attendance_no_show_alerts where id = p_alert for update;
  if not found or a.org_id is distinct from public.current_org_id() then
    raise exception 'ALERT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if a.status not in ('failed', 'no_contact') then raise exception 'ALERT_NOT_RETRYABLE' using errcode = 'P0001'; end if;
  if a.guardian_profile_id is null then raise exception 'ALERT_NO_GUARDIAN' using errcode = 'P0001'; end if;
  select * into v_ev from public.events where id = a.event_id;
  if v_ev.status = 'cancelled' then raise exception 'EVENT_CANCELLED' using errcode = 'P0001'; end if;
  update public.attendance_no_show_alerts
     set status = 'pending', attempts = 0, next_attempt_at = now(), claimed_at = null
   where id = a.id;
  perform public.ca_audit(a.org_id, 'attendance.alert_retry', 'attendance_no_show_alerts', a.id,
                          jsonb_build_object('previous_status', a.status, 'attempts', a.attempts));
  return jsonb_build_object('alert_id', a.id, 'status', 'pending', 'previous_status', a.status);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: signed-in API (each function checks tenant and role inside)
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_session_attendance(uuid, uuid, date, date, uuid, integer)',
    'public.attendance_alert_retry(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;
