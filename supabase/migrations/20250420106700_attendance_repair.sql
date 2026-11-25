-- ============================================================================
-- Club OS - Attendance repair (founder report 25 Nov 2026).
--
-- Reproduced on staging:
--   1. "Led by" showed Derrick Lang on the U14 CJSC sheets of 23 and 24 Nov
--      although Ademir Sunj is the approved lead. attendance_finalize fell
--      back to the coach record of the person finalizing (current_coach_id)
--      before the session's approved lead, so a staff member with a coach
--      profile who finalized (or a picker defaulting to "me") overwrote the
--      approved lead.
--   2. A child's session of the current day disappeared from the parent and
--      athlete views once it had started: "Upcoming" only listed sessions
--      starting after now(), and the record only lists finalized marks, so a
--      session between its start and its finalization was in neither list.
--   3. Staff alert follow-up listed one row per alert row (initial and
--      correction, per recipient) for the same absence.
--
-- Changes:
--   a. attendance_finalize: led_by = chosen coach > sheet value > approved
--      lead (ac_default_lead) > finalizer's coach record.
--   b. Repair: finalized sheets whose led_by is not one of the session's
--      effective coaches (approved assignment, booked-session coach, team
--      coach) while the session has an approved lead get that approved lead.
--      The previous value stays in audit_logs (audit trigger on sheets) and in
--      team_attendance_led_by_repairs.
--   c. ta_athlete_overview: "upcoming" starts at the beginning of the club's
--      current day and keeps today's sessions until the child's attendance is
--      final (today_state: in_progress / awaiting_attendance).
--   d. attendance_alerts_followup: one row per absence (event, athlete) and
--      recipient, the most recent alert only.
-- Additive and idempotent.
-- ============================================================================

-- a. Finalize: approved lead before the finalizer's own coach record.
create or replace function public.attendance_finalize(p_event uuid, p_led_by_coach uuid, p_expected_version integer,
                                                      p_request_id uuid default null, p_ack_reported boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ev     public.events%rowtype;
  s        public.team_attendance_sheets%rowtype;
  v_prev   jsonb;
  v_unm    jsonb;
  v_rep    jsonb;
  v_coach  uuid;
  v_n      integer;
  v_version integer;
begin
  v_ev := public.ta_event_for_write(p_event);
  v_prev := public.ta_replay(p_request_id, 'finalize');
  if v_prev is not null then return v_prev; end if;
  s := public.ta_lock_sheet(p_event);
  v_prev := public.ta_replay(p_request_id, 'finalize');
  if v_prev is not null then return v_prev; end if;
  if v_ev.status = 'cancelled' then raise exception 'EVENT_CANCELLED' using errcode = 'P0001'; end if;
  if s.status = 'final' then
    return jsonb_build_object('ok', true, 'already_final', true, 'version', s.version, 'finalized_at', s.finalized_at,
                              'alerts_created', 0, 'replayed', false);
  end if;
  if p_expected_version is distinct from s.version then
    return jsonb_build_object('ok', false, 'code', 'VERSION_CONFLICT', 'version', s.version);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('athlete_id', m.athlete_id, 'first_name', a.first_name, 'last_name', a.last_name)
                            order by a.last_name, a.first_name), '[]'::jsonb)
    into v_unm
    from public.team_attendance_marks m join public.athletes a on a.id = m.athlete_id
   where m.sheet_id = s.id and m.status = 'unmarked';
  if jsonb_array_length(v_unm) > 0 then
    return jsonb_build_object('ok', false, 'code', 'UNMARKED_PLAYERS', 'unmarked', v_unm, 'version', s.version);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('athlete_id', m.athlete_id, 'first_name', a.first_name, 'last_name', a.last_name,
                                               'report_id', public.ta_active_report(p_event, m.athlete_id))), '[]'::jsonb)
    into v_rep
    from public.team_attendance_marks m join public.athletes a on a.id = m.athlete_id
   where m.sheet_id = s.id and m.status = 'unexcused' and not m.reported_absence_ack
     and public.ta_active_report(p_event, m.athlete_id) is not null;
  if jsonb_array_length(v_rep) > 0 then
    if not p_ack_reported then
      return jsonb_build_object('ok', false, 'code', 'REPORTED_ABSENCE_UNACKNOWLEDGED', 'athletes', v_rep, 'version', s.version);
    end if;
    update public.team_attendance_marks m set reported_absence_ack = true
     where m.sheet_id = s.id and m.status = 'unexcused' and public.ta_active_report(p_event, m.athlete_id) is not null;
  end if;

  -- Who led: the coach chosen on the sheet, else the session's approved lead
  -- (approved session lead > booked-session coach > team head coach), and only
  -- then the coach record of whoever finalizes (20250420106700).
  v_coach := coalesce(p_led_by_coach, s.led_by_coach_id, public.ac_default_lead(p_event), public.current_coach_id());
  if v_coach is not null and not exists (select 1 from public.coaches where id = v_coach and org_id = v_ev.org_id) then
    raise exception 'COACH_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.team_attendance_marks set finalized_status = status where sheet_id = s.id;
  update public.team_attendance_sheets
     set status = 'final', led_by_coach_id = v_coach, finalized_by = auth.uid(), finalized_at = now(),
         first_finalized_at = coalesce(first_finalized_at, now()), finalize_count = finalize_count + 1,
         version = version + 1, submitted_by = coalesce(submitted_by, auth.uid()),
         submitted_at = coalesce(submitted_at, now()), alerts_synced_at = null
   where id = s.id returning version into v_version;
  v_n := public.ta_sync_sheet_alerts(s.id);
  return public.ta_remember(p_request_id, 'finalize', s.id, jsonb_build_object(
    'ok', true, 'already_final', false, 'version', v_version, 'finalized_at', now(), 'alerts_created', v_n,
    'event_ended', v_ev.ends_at < now()));
end;
$$;

-- b. Repair of led_by (kept: the previous value, who and when).
create table if not exists public.team_attendance_led_by_repairs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  sheet_id    uuid not null references public.team_attendance_sheets(id) on delete cascade,
  event_id    uuid not null references public.events(id) on delete cascade,
  previous_coach_id uuid references public.coaches(id) on delete set null,
  new_coach_id      uuid references public.coaches(id) on delete set null,
  reason      text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (sheet_id, previous_coach_id, new_coach_id)
);
create index if not exists idx_team_attendance_led_by_repairs_org on public.team_attendance_led_by_repairs(org_id);
alter table public.team_attendance_led_by_repairs enable row level security;
drop policy if exists led_by_repairs_admin_select on public.team_attendance_led_by_repairs;
create policy led_by_repairs_admin_select on public.team_attendance_led_by_repairs
  for select to authenticated using (org_id = public.current_org_id() and public.is_admin());
drop policy if exists led_by_repairs_no_insert on public.team_attendance_led_by_repairs;
create policy led_by_repairs_no_insert on public.team_attendance_led_by_repairs
  for insert to authenticated with check (false);
drop policy if exists led_by_repairs_no_update on public.team_attendance_led_by_repairs;
create policy led_by_repairs_no_update on public.team_attendance_led_by_repairs
  for update to authenticated using (false) with check (false);
drop policy if exists led_by_repairs_no_delete on public.team_attendance_led_by_repairs;
create policy led_by_repairs_no_delete on public.team_attendance_led_by_repairs
  for delete to authenticated using (false);
revoke all on public.team_attendance_led_by_repairs from anon;

-- Sheets to repair: final, led_by set, led_by not an effective coach of the
-- session, and the session has an approved lead that differs.
create or replace function public.ac_led_by_repair_candidates(p_org uuid)
returns table (sheet_id uuid, event_id uuid, previous_coach_id uuid, new_coach_id uuid)
language sql stable security definer set search_path = public as $$
  select s.id, s.event_id, s.led_by_coach_id, public.ac_default_lead(s.event_id)
    from public.team_attendance_sheets s
   where s.org_id = p_org and s.status = 'final' and s.led_by_coach_id is not null
     and public.ac_default_lead(s.event_id) is not null
     and public.ac_default_lead(s.event_id) <> s.led_by_coach_id
     and not exists (select 1 from public.ac_session_coaches(s.event_id) c where c.coach_id = s.led_by_coach_id);
$$;
revoke all on function public.ac_led_by_repair_candidates(uuid) from public, anon, authenticated;

create or replace function public.ac_led_by_repair(p_org uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_n integer := 0;
begin
  for r in select * from public.ac_led_by_repair_candidates(p_org) loop
    insert into public.team_attendance_led_by_repairs (org_id, sheet_id, event_id, previous_coach_id, new_coach_id, reason)
    values (p_org, r.sheet_id, r.event_id, r.previous_coach_id, r.new_coach_id,
            'led_by was not a coach of the session; set to the approved lead')
    on conflict (sheet_id, previous_coach_id, new_coach_id) do nothing;
    update public.team_attendance_sheets set led_by_coach_id = r.new_coach_id, updated_at = now()
     where id = r.sheet_id and led_by_coach_id = r.previous_coach_id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.ac_led_by_repair(uuid) from public, anon, authenticated;

do $$
declare o uuid;
begin
  for o in select distinct org_id from public.team_attendance_sheets where status = 'final' loop
    perform public.ac_led_by_repair(o);
  end loop;
end $$;

-- c. Athlete overview (guardian / player): today's sessions stay until final.
create or replace function public.ta_athlete_overview(p_athlete uuid, p_from date, p_to date, p_viewer uuid, p_guardian boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org  uuid;
  v_tz   text;
  v_from date;
  v_to   date;
  v_teams uuid[];
  v_day_start timestamptz;
begin
  select org_id into v_org from public.athletes where id = p_athlete;
  v_tz := public.ta_tz(v_org);
  v_to := coalesce(p_to, public.ta_today(v_org));
  v_from := coalesce(p_from, v_to - 120);
  v_day_start := (public.ta_today(v_org)::timestamp) at time zone v_tz;
  select array_agg(distinct x.team_id) into v_teams from (
    select tm.team_id from public.team_memberships tm where tm.athlete_id = p_athlete
    union select p.team_id from public.team_membership_periods p where p.athlete_id = p_athlete
    union select s.team_id from public.team_attendance_marks m join public.team_attendance_sheets s on s.id = m.sheet_id
           where m.athlete_id = p_athlete) x;

  return jsonb_build_object(
    'athlete', (select jsonb_build_object('id', a.id, 'first_name', a.first_name, 'last_name', a.last_name)
                  from public.athletes a where a.id = p_athlete),
    'timezone', v_tz,
    'upcoming', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event_id', e.id, 'team_id', e.team_id, 'team_name', coalesce(t.name, e.title), 'type', e.type, 'title', e.title,
               'training_session_id', e.training_session_id,
               'starts_at', e.starts_at, 'ends_at', e.ends_at, 'status', e.status,
               'cancel_reason', case when e.status = 'cancelled' then e.cancel_reason end,
               'rescheduled_from', e.rescheduled_from,
               'location', coalesce((select v.name from public.venues v where v.id = e.venue_id), e.location_name, e.location_text),
               'can_report', e.status in ('scheduled', 'postponed') and e.starts_at > now(),
               'today_state', case when e.starts_at > now() then null
                                   when e.ends_at > now() then 'in_progress' else 'awaiting_attendance' end,
               'report', (select jsonb_build_object('report_id', r.id, 'status', r.status, 'reason', r.reason,
                                                    'reason_category', r.reason_category, 'needs_review', r.needs_review,
                                                    'created_at', r.created_at)
                            from public.team_absence_reports r
                           where r.event_id = e.id and r.athlete_id = p_athlete and r.status in ('reported', 'acknowledged') limit 1))
             order by e.starts_at)
        from public.events e left join public.teams t on t.id = e.team_id
       where e.starts_at >= v_day_start and e.starts_at < now() + interval '30 days'
         -- Today's sessions stay listed after they start until this child's attendance is final.
         and (e.starts_at >= now() or not exists (
               select 1 from public.team_attendance_marks fm
                 join public.team_attendance_sheets fs on fs.id = fm.sheet_id and fs.finalize_count > 0
                where fm.event_id = e.id and fm.athlete_id = p_athlete and fm.finalized_status is not null))
         and e.type::text = any(public.ta_sheet_types())
         and ((e.team_id = any(coalesce(v_teams, '{}'))
               and exists (select 1 from public.ta_roster_on(e.team_id, (e.starts_at at time zone v_tz)::date) ro where ro.athlete_id = p_athlete))
              or (e.training_session_id is not null and e.org_id = v_org
                  and exists (select 1 from public.bk_event_roster(e.id) br where br.athlete_id = p_athlete)))
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event_id', e.id, 'team_id', e.team_id, 'team_name', coalesce(t.name, e.title), 'type', e.type, 'starts_at', e.starts_at,
               'training_session_id', e.training_session_id,
               'season_id', coalesce(e.season_id, t.season_id), 'season_name', sn.name,
               'status', m.finalized_status, 'is_guest', m.is_guest, 'can_request_correction', p_guardian,
               'open_request', exists (select 1 from public.attendance_correction_requests q where q.mark_id = m.id and q.status = 'open'),
               'alert', case when p_guardian then (
                  select jsonb_build_object('alert_id', al.id, 'kind', al.kind, 'status', al.status, 'mark_status', al.mark_status,
                                            'sent_at', al.sent_at)
                    from public.attendance_no_show_alerts al
                   where al.event_id = e.id and al.athlete_id = p_athlete and al.guardian_profile_id = p_viewer
                   order by al.created_at desc limit 1) end)
             order by e.starts_at desc)
        from public.team_attendance_marks m
        join public.team_attendance_sheets s on s.id = m.sheet_id and s.finalize_count > 0
        join public.events e on e.id = m.event_id
        left join public.teams t on t.id = e.team_id
        left join public.seasons sn on sn.id = coalesce(e.season_id, t.season_id)
       where m.athlete_id = p_athlete and m.finalized_status is not null and e.status <> 'cancelled'
         and s.roster_date between v_from and v_to
    ), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object('report_id', r.id, 'event_id', r.event_id, 'starts_at', e.starts_at, 'team_name', t.name,
                                          'status', r.status, 'reason', r.reason, 'reason_category', r.reason_category,
                                          'needs_review', r.needs_review, 'reporter_kind', r.reporter_kind,
                                          'mine', r.reported_by = p_viewer, 'created_at', r.created_at)
             order by r.created_at desc)
        from public.team_absence_reports r join public.events e on e.id = r.event_id left join public.teams t on t.id = e.team_id
       where r.athlete_id = p_athlete and r.created_at >= now() - interval '180 days'
    ), '[]'::jsonb),
    'correction_requests', case when p_guardian then coalesce((
      select jsonb_agg(jsonb_build_object('request_id', q.id, 'event_id', q.event_id, 'status', q.status, 'message', q.message,
                                          'current_status', q.current_status, 'requested_status', q.requested_status,
                                          'resolution_note', q.resolution_note, 'resolved_at', q.resolved_at, 'created_at', q.created_at)
             order by q.created_at desc)
        from public.attendance_correction_requests q where q.athlete_id = p_athlete
    ), '[]'::jsonb) else '[]'::jsonb end,
    'stats', (select jsonb_build_object('sessions', count(*),
                                        'present', count(*) filter (where m.finalized_status = 'present'),
                                        'late', count(*) filter (where m.finalized_status = 'late'),
                                        'excused', count(*) filter (where m.finalized_status = 'excused'),
                                        'unexcused', count(*) filter (where m.finalized_status = 'unexcused'))
                from public.team_attendance_marks m
                join public.team_attendance_sheets s on s.id = m.sheet_id and s.finalize_count > 0
                join public.events e on e.id = m.event_id
               where m.athlete_id = p_athlete and m.finalized_status is not null and e.status <> 'cancelled'
                 and s.roster_date between v_from and v_to));
end;
$function$;

-- d. Staff alert follow-up: one row per absence and recipient (latest alert).
create or replace function public.attendance_alerts_followup(p_limit integer default 100)
returns table (alert_id uuid, status text, kind text, mark_status text, attempts integer, last_error text,
               created_at timestamptz, event_id uuid, starts_at timestamptz, team_id uuid, team_name text,
               athlete_id uuid, first_name text, last_name text, guardian_profile_id uuid, guardian_name text)
language sql stable security definer set search_path = public as $$
  select x.id, x.status, x.kind, x.mark_status, x.attempts, x.last_error, x.created_at, e.id, e.starts_at, e.team_id,
         t.name, x.athlete_id, ath.first_name, ath.last_name, x.guardian_profile_id, pf.full_name
    from (select distinct on (a.event_id, a.athlete_id, a.recipient_key) a.*
            from public.attendance_no_show_alerts a
           where a.org_id = public.current_org_id() and a.status <> 'superseded'
           order by a.event_id, a.athlete_id, a.recipient_key, a.created_at desc) x
    join public.events e on e.id = x.event_id
    left join public.teams t on t.id = e.team_id
    join public.athletes ath on ath.id = x.athlete_id
    left join public.profiles pf on pf.id = x.guardian_profile_id
   where (x.status = 'no_contact' or (x.status = 'failed' and x.attempts >= public.ta_alert_max_attempts()))
     and (public.is_admin() or (e.team_id is not null and public.coach_coaches_team(e.team_id)))
   order by x.created_at desc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;
