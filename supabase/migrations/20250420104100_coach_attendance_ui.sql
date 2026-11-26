-- ============================================================================
-- Coach attendance UI: three read helpers for the coach portal
-- (/coach/trainings). Additive and idempotent; no table changes.
--
--   coach_training_cards(from, to)        coach_sessions + place, roster size,
--                                         cancel reason (the training cards)
--   attendance_guest_search(event, q, n)  club players to add as a guest
--                                         (name + current team names only)
--   attendance_sheet_history(event)       sheet lifecycle + every mark change
--                                         with names (draft history and the
--                                         correction log)
--
-- All three are security definer, check the caller's org and that the caller
-- can run the session (ta_can_run), and return minimal athlete data (no
-- contacts, no medical, no dates of birth). Contract: docs/team-attendance.md.
-- ============================================================================

-- Training cards of the signed-in coach. Rows are exactly coach_sessions()
-- (teams they coach + approved / pending session assignments); place and
-- roster size are only filled in for sessions the coach can run.
create or replace function public.coach_training_cards(p_from timestamptz default null, p_to timestamptz default null)
returns table (event_id uuid, team_id uuid, team_name text, event_type text, title text, starts_at timestamptz,
               ends_at timestamptz, event_status text, cancel_reason text, access text, can_run boolean,
               sheet_status text, sheet_version integer, unmarked integer, marked integer, reported_absences integer,
               tracked boolean, location_name text, roster_size integer)
language sql stable security definer set search_path = public as $$
  select c.event_id, c.team_id, c.team_name, c.event_type, c.title, c.starts_at, c.ends_at, c.event_status,
         e.cancel_reason, c.access, c.can_run, c.sheet_status, c.sheet_version, c.unmarked, c.marked,
         case when c.can_run then c.reported_absences else 0 end,
         c.tracked,
         coalesce((select v.name from public.venues v where v.id = e.venue_id), e.location_name, e.location_text),
         case
           when not c.can_run then null
           when c.sheet_status is not null then c.unmarked + c.marked
           when c.team_id is null then 0
           else (select count(*)::int from public.ta_roster_on(c.team_id, public.ta_event_date(c.event_id)))
         end
    from public.coach_sessions(p_from, p_to) c
    join public.events e on e.id = c.event_id and e.org_id = public.current_org_id()
   order by c.starts_at;
$$;

-- Club players a coach may add as a guest to one session: active (not
-- archived) athletes of the session's org whose name matches, not already on
-- the sheet. At least 2 characters; at most 50 rows.
create or replace function public.attendance_guest_search(p_event uuid, p_query text, p_limit integer default 20)
returns table (athlete_id uuid, first_name text, last_name text, team_names text[])
language plpgsql stable security definer set search_path = public as $$
declare
  v_ev public.events%rowtype;
  v_q  text := btrim(coalesce(p_query, ''));
  v_like text;
begin
  select * into v_ev from public.events where id = p_event;
  if not found or v_ev.org_id is distinct from public.current_org_id() then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.ta_can_run(p_event) then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if length(v_q) < 2 or length(v_q) > 80 then return; end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    select a.id, a.first_name, a.last_name,
           coalesce((select array_agg(t.name order by t.name)
                       from public.team_memberships tm join public.teams t on t.id = tm.team_id
                      where tm.athlete_id = a.id and tm.status = 'active' and tm.left_on is null), '{}'::text[])
      from public.athletes a
     where a.org_id = v_ev.org_id and a.archived_at is null
       and (a.first_name ilike v_like or a.last_name ilike v_like
            or (a.first_name || ' ' || a.last_name) ilike v_like or (a.last_name || ' ' || a.first_name) ilike v_like)
       and not exists (select 1 from public.team_attendance_marks m where m.event_id = p_event and m.athlete_id = a.id)
     order by a.last_name, a.first_name
     limit greatest(1, least(coalesce(p_limit, 20), 50));
end;
$$;

-- Lifecycle of a session's sheet and every recorded mark change (newest
-- first, at most 500), for staff who can run the session.
create or replace function public.attendance_sheet_history(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ev public.events%rowtype;
  s    public.team_attendance_sheets%rowtype;
  v_changes jsonb;
begin
  select * into v_ev from public.events where id = p_event;
  if not found or v_ev.org_id is distinct from public.current_org_id() then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.ta_can_run(p_event) then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into s from public.team_attendance_sheets where event_id = p_event;
  if s.id is null then
    return jsonb_build_object('sheet', null, 'changes', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(x.j order by x.changed_at desc, x.is_correction desc), '[]'::jsonb) into v_changes
    from (select h.changed_at, h.phase = 'correction' as is_correction,
                 jsonb_build_object('id', h.id, 'athlete_id', h.athlete_id, 'first_name', a.first_name, 'last_name', a.last_name,
                                    'previous_status', h.previous_status, 'new_status', h.new_status, 'phase', h.phase,
                                    'reason', h.reason, 'changed_by_name', p.full_name, 'changed_at', h.changed_at) as j
            from public.team_attendance_mark_history h
            join public.athletes a on a.id = h.athlete_id
            left join public.profiles p on p.id = h.changed_by
           where h.sheet_id = s.id and h.org_id = v_ev.org_id
           order by h.changed_at desc, (h.phase = 'correction') desc
           limit 500) x;
  return jsonb_build_object(
    'sheet', jsonb_build_object(
       'status', s.status, 'version', s.version, 'created_at', s.created_at,
       'opened_by_name', (select full_name from public.profiles where id = s.opened_by),
       'submitted_at', s.submitted_at,
       'first_finalized_at', s.first_finalized_at, 'finalized_at', s.finalized_at,
       'finalized_by_name', (select full_name from public.profiles where id = s.finalized_by),
       'reopened_at', s.reopened_at, 'reopened_by_name', (select full_name from public.profiles where id = s.reopened_by),
       'reopen_reason', s.reopen_reason, 'finalize_count', s.finalize_count, 'correction_count', s.correction_count,
       'led_by_name', (select display_name from public.coaches where id = s.led_by_coach_id)),
    'changes', v_changes);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.coach_training_cards(timestamptz, timestamptz)',
    'public.attendance_guest_search(uuid, text, integer)',
    'public.attendance_sheet_history(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
