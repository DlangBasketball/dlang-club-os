-- ============================================================================
-- Club OS — Attendance consistency: one source of truth for the Attendance
-- tab, the Dashboard, the Schedule and the player history; coach roles per
-- session; staff follow-ups for unexcused absences; reconciliation.
--
-- Founder report (23 Nov 2026), root causes:
--   * /admin/attendance read only the legacy programme tables
--     (attendance_sessions / attendance_marks). Team trainings and booked
--     sessions are saved in team_attendance_sheets / _marks, so finalized
--     records never appeared there.
--   * Coach coverage labelled ANY approved session assignment "substitute",
--     showed "No coach" whenever team_coaches was empty (always for booked,
--     team-less sessions) and "Led by" stayed blank because an admin
--     finalizing without a coach profile left led_by_coach_id null.
--
-- What this migration adds (contract: docs/team-attendance.md §12):
--   1. event_coach_assignments.role gains 'assistant' (check constraint
--      replaced; existing rows keep their values). One approved lead per
--      session for NEW assignments (LEAD_EXISTS); existing duplicates are
--      kept and flagged MULTIPLE_LEADS.
--   2. Effective coaches of a session (ac_session_coaches), the default lead
--      (ac_lead_pick / ac_default_lead) and the coverage summary
--      (ac_coverage), mirrored in TS by src/lib/attendance/coverage.ts.
--      session_set_coach_role (admin) changes the role of one assignment;
--      session_coverage(events[]) exposes the summary to staff.
--   3. Finalizing without led_by defaults it to the effective lead (trigger).
--   4. attendance_followups: one staff follow-up per (event, athlete) when a
--      mark is finalized unexcused; resolved by a correction to present /
--      late / excused, re-opened by a correction back to unexcused; append-
--      only history inside the row, audited.
--   5. attendance_sessions_overview(from, to, team, athlete, scope, program,
--      limit): one read for the Attendance tab, Dashboard and player history
--      (team trainings / games, booked sessions, legacy programme sessions
--      read-only). attendance_sessions_roster(sessions[]) and
--      attendance_followups_list(status, limit) complete it.
--   6. Reconciliation (idempotent, audited): led_by backfill on final sheets,
--      follow-ups for existing finalized unexcused marks, MULTIPLE_LEADS and
--      other inconsistencies to data_review_flags. Valid marks and history
--      are never rewritten.
--
-- Additive and idempotent. Tests: tests/db/attendance_consistency.sql.
-- ============================================================================

-- ===========================================================================
-- 1. Coach roles per session
-- ===========================================================================
do $$
begin
  if exists (select 1 from pg_constraint
              where conname = 'event_coach_assignments_role_chk'
                and conrelid = 'public.event_coach_assignments'::regclass
                and pg_get_constraintdef(oid) not like '%assistant%') then
    alter table public.event_coach_assignments drop constraint event_coach_assignments_role_chk;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'event_coach_assignments_role_chk'
                    and conrelid = 'public.event_coach_assignments'::regclass) then
    alter table public.event_coach_assignments add constraint event_coach_assignments_role_chk
      check (role in ('substitute', 'lead', 'assistant'));
  end if;
end $$;

create index if not exists idx_event_coach_assignments_event on public.event_coach_assignments(event_id, status, role);

-- One approved lead per session for new or changed assignments. Rows that
-- already break the rule are kept (flagged MULTIPLE_LEADS by the reconcile).
create or replace function public.ac_one_lead_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'lead' and new.status = 'approved'
     and (tg_op = 'INSERT' or old.role is distinct from 'lead' or old.status is distinct from 'approved')
     and exists (select 1 from public.event_coach_assignments a
                  where a.event_id = new.event_id and a.id <> new.id and a.role = 'lead' and a.status = 'approved') then
    raise exception 'LEAD_EXISTS' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_ac_one_lead_guard on public.event_coach_assignments;
create trigger trg_ac_one_lead_guard before insert or update of role, status on public.event_coach_assignments
  for each row execute function public.ac_one_lead_guard();

create or replace function public.session_assign_coach(p_event uuid, p_coach uuid, p_role text default 'substitute')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ev public.events%rowtype; v_id uuid;
begin
  select * into v_ev from public.events where id = p_event;
  if not found or v_ev.org_id is distinct from public.current_org_id() then raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if coalesce(p_role, '') not in ('substitute', 'lead', 'assistant') then raise exception 'INVALID_ROLE' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.coaches where id = p_coach and org_id = v_ev.org_id) then
    raise exception 'COACH_NOT_FOUND' using errcode = 'P0002';
  end if;
  insert into public.event_coach_assignments (org_id, event_id, coach_id, role, status, assigned_by, decided_by, decided_at)
  values (v_ev.org_id, p_event, p_coach, p_role, 'approved', auth.uid(), auth.uid(), now())
  on conflict (event_id, coach_id) do update
    set role = excluded.role, status = 'approved', assigned_by = excluded.assigned_by,
        decided_by = excluded.decided_by, decided_at = excluded.decided_at
  returning id into v_id;
  return jsonb_build_object('assignment_id', v_id, 'status', 'approved', 'event_id', p_event, 'coach_id', p_coach, 'role', p_role);
end;
$$;

-- Admin: change the role of one session assignment (that session only).
create or replace function public.session_set_coach_role(p_assignment uuid, p_role text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.event_coach_assignments%rowtype;
begin
  select * into r from public.event_coach_assignments where id = p_assignment for update;
  if not found or r.org_id is distinct from public.current_org_id() then raise exception 'ASSIGNMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if coalesce(p_role, '') not in ('substitute', 'lead', 'assistant') then raise exception 'INVALID_ROLE' using errcode = 'P0001'; end if;
  if r.role = p_role then
    return jsonb_build_object('assignment_id', r.id, 'event_id', r.event_id, 'role', r.role, 'changed', false);
  end if;
  update public.event_coach_assignments set role = p_role where id = r.id;
  perform public.ca_audit(r.org_id, 'attendance.coach_role', 'event_coach_assignments', r.id,
                          jsonb_build_object('event_id', r.event_id, 'coach_id', r.coach_id, 'previous_role', r.role, 'role', p_role));
  return jsonb_build_object('assignment_id', r.id, 'event_id', r.event_id, 'role', p_role, 'previous_role', r.role, 'changed', true);
end;
$$;

-- ===========================================================================
-- 2. Effective coaches, default lead, coverage (TS mirror: src/lib/attendance/coverage.ts)
-- ===========================================================================
-- Effective coaches of a session: approved session assignments (lead /
-- assistant / substitute), the booked-session coach (lead) and the team's
-- coaches (head -> lead, others -> assistant). A session assignment decides
-- the role shown for its coach.
create or replace function public.ac_session_coaches(p_event uuid)
returns table (coach_id uuid, coach_name text, role text, source text)
language sql stable security definer set search_path = public as $$
  with e as (select ev.id, ev.org_id, ev.team_id, ev.training_session_id from public.events ev where ev.id = p_event),
  src as (
    select a.coach_id, a.role, 'session'::text as source, 1 as prio
      from public.event_coach_assignments a join e on a.event_id = e.id
     where a.status = 'approved'
    union all
    select ts.coach_id, 'lead', 'booking', 2
      from e join public.training_sessions ts on ts.id = e.training_session_id
    union all
    select tc.coach_id, case when tc.role = 'head' then 'lead' else 'assistant' end, 'team', 3
      from e join public.team_coaches tc on tc.team_id = e.team_id
  )
  select x.coach_id, x.coach_name, x.role, x.source
    from (select distinct on (s.coach_id) s.coach_id, c.display_name as coach_name, s.role, s.source
            from src s join public.coaches c on c.id = s.coach_id and c.org_id = (select e.org_id from e)
           order by s.coach_id, s.prio) x
   order by case x.role when 'lead' then 0 when 'assistant' then 1 else 2 end, x.coach_name;
$$;

-- Default lead when the sheet names none: approved session lead (earliest),
-- else the booked-session coach, else the team head coach.
create or replace function public.ac_lead_pick(p_event uuid)
returns table (coach_id uuid, source text)
language sql stable security definer set search_path = public as $$
  select y.coach_id, y.source from (
    (select a.coach_id, 'session'::text as source, 1 as prio
       from public.event_coach_assignments a join public.coaches c on c.id = a.coach_id
      where a.event_id = p_event and a.status = 'approved' and a.role = 'lead'
      order by coalesce(a.decided_at, a.created_at), c.display_name limit 1)
    union all
    (select ts.coach_id, 'booking', 2
       from public.events e join public.training_sessions ts on ts.id = e.training_session_id
      where e.id = p_event)
    union all
    (select tc.coach_id, 'team', 3
       from public.events e join public.team_coaches tc on tc.team_id = e.team_id join public.coaches c on c.id = tc.coach_id
      where e.id = p_event and tc.role = 'head'
      order by tc.created_at, c.display_name limit 1)
  ) y order by y.prio limit 1;
$$;

create or replace function public.ac_default_lead(p_event uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coach_id from public.ac_lead_pick(p_event);
$$;

-- Coverage summary of one session (team or booked):
--   coverage   'missing'    no approved coach at all (and no led_by)
--              'substitute' an approved substitute is assigned
--              'assigned'   otherwise
--   led_by_*   sheet.led_by, else the default lead (ac_lead_pick)
create or replace function public.ac_coverage(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_sheet_lead uuid;
  v_lead       uuid;
  v_src        text;
  v_coaches    jsonb;
  v_sub        boolean;
  v_leads      integer;
  v_pending    integer;
begin
  select s.led_by_coach_id into v_sheet_lead from public.team_attendance_sheets s where s.event_id = p_event;
  select coalesce(jsonb_agg(jsonb_build_object('coach_id', c.coach_id, 'name', c.coach_name, 'role', c.role, 'source', c.source)), '[]'::jsonb)
    into v_coaches from public.ac_session_coaches(p_event) c;
  if v_sheet_lead is not null then
    v_lead := v_sheet_lead; v_src := 'sheet';
  else
    select p.coach_id, p.source into v_lead, v_src from public.ac_lead_pick(p_event) p;
  end if;
  select coalesce(bool_or(a.role = 'substitute' and a.status = 'approved'), false),
         count(*) filter (where a.role = 'lead' and a.status = 'approved')::int,
         count(*) filter (where a.status = 'pending')::int
    into v_sub, v_leads, v_pending
    from public.event_coach_assignments a where a.event_id = p_event;
  return jsonb_build_object(
    'coverage', case when v_lead is null and jsonb_array_length(v_coaches) = 0 then 'missing'
                     when v_sub then 'substitute' else 'assigned' end,
    'led_by_coach_id', v_lead,
    'led_by_name', (select c.display_name from public.coaches c where c.id = v_lead),
    'led_by_source', v_src,
    'coaches', v_coaches,
    'substitute', v_sub,
    'multiple_leads', v_leads > 1,
    'pending_requests', v_pending);
end;
$$;

-- Staff read of the coverage of several sessions (Schedule, Today's sessions).
create or replace function public.session_coverage(p_events uuid[])
returns table (event_id uuid, coverage jsonb)
language sql stable security definer set search_path = public as $$
  select e.id, public.ac_coverage(e.id)
    from public.events e
   where e.id = any((coalesce(p_events, '{}'::uuid[]))[1:300])
     and e.org_id = public.current_org_id()
     and (public.is_admin() or public.coach_can_run_event(e.id));
$$;

-- ===========================================================================
-- 3. Finalizing without led_by defaults it to the effective lead
-- ===========================================================================
create or replace function public.ac_sheet_default_lead()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'final' and old.status is distinct from 'final' and new.led_by_coach_id is null then
    new.led_by_coach_id := public.ac_default_lead(new.event_id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_ac_sheet_default_lead on public.team_attendance_sheets;
create trigger trg_ac_sheet_default_lead before update of status on public.team_attendance_sheets
  for each row execute function public.ac_sheet_default_lead();

-- ===========================================================================
-- 4. Staff follow-ups for unexcused absences
-- ===========================================================================
create table if not exists public.attendance_followups (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  event_id           uuid not null references public.events(id) on delete cascade,
  athlete_id         uuid not null references public.athletes(id) on delete cascade,
  sheet_id           uuid references public.team_attendance_sheets(id) on delete set null,
  mark_id            uuid references public.team_attendance_marks(id) on delete set null,
  team_id            uuid references public.teams(id) on delete set null,
  status             text not null default 'open',
  mark_status        text not null,
  source             text not null default 'finalize',
  opened_at          timestamptz not null default now(),
  opened_by          uuid references public.profiles(id) on delete set null,
  reopen_count       integer not null default 0,
  resolved_at        timestamptz,
  resolved_by        uuid references public.profiles(id) on delete set null,
  resolution_status  text,
  resolution_reason  text,
  history            jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint attendance_followups_status_chk check (status in ('open', 'resolved')),
  constraint attendance_followups_mark_chk check (mark_status in ('present', 'late', 'excused', 'unexcused')),
  constraint attendance_followups_source_chk check (source in ('finalize', 'correction', 'backfill')),
  constraint attendance_followups_resolution_chk check (resolution_status is null or resolution_status in ('present', 'late', 'excused', 'cancelled')),
  constraint attendance_followups_reason_len check (resolution_reason is null or length(resolution_reason) <= 500),
  constraint attendance_followups_event_athlete_key unique (event_id, athlete_id)
);
create index if not exists idx_attendance_followups_org on public.attendance_followups(org_id, status, opened_at desc);
create index if not exists idx_attendance_followups_athlete on public.attendance_followups(athlete_id);

drop trigger if exists trg_attendance_followups_updated on public.attendance_followups;
create trigger trg_attendance_followups_updated before update on public.attendance_followups
  for each row execute function public.set_updated_at();
drop trigger if exists trg_attendance_followups_org on public.attendance_followups;
create trigger trg_attendance_followups_org before insert or update on public.attendance_followups
  for each row execute function public.ca_same_org_guard('event_id:events', 'athlete_id:athletes', 'sheet_id:team_attendance_sheets', 'team_id:teams');
-- Personal data of minors: audited; the free-text reason is redacted.
drop trigger if exists trg_audit_attendance_followups on public.attendance_followups;
create trigger trg_audit_attendance_followups after insert or update or delete on public.attendance_followups
  for each row execute function public.ca_audit_trigger('resolution_reason');

alter table public.attendance_followups enable row level security;
drop policy if exists attendance_followups_select on public.attendance_followups;
create policy attendance_followups_select on public.attendance_followups for select
  using (org_id = public.current_org_id() and (public.is_admin() or public.coach_can_run_event(event_id)));
drop policy if exists attendance_followups_insert on public.attendance_followups;
create policy attendance_followups_insert on public.attendance_followups for insert with check (false);
drop policy if exists attendance_followups_update on public.attendance_followups;
create policy attendance_followups_update on public.attendance_followups for update using (false) with check (false);
drop policy if exists attendance_followups_delete on public.attendance_followups;
create policy attendance_followups_delete on public.attendance_followups for delete using (false);
revoke insert, update, delete, truncate on public.attendance_followups from anon, authenticated;
grant select on public.attendance_followups to authenticated;
grant all on public.attendance_followups to service_role;

-- Bring the follow-up of one mark in line with its FINALIZED status:
-- unexcused -> open (insert, or re-open the same row); present / late /
-- excused -> resolve an open row. Draft values never open anything.
create or replace function public.ac_followup_sync(p_mark uuid, p_reason text, p_actor uuid, p_source text)
returns void language plpgsql security definer set search_path = public as $$
declare
  m     public.team_attendance_marks%rowtype;
  v_ev  public.events%rowtype;
  v_now timestamptz := now();
begin
  select * into m from public.team_attendance_marks where id = p_mark;
  if not found or m.finalized_status is null then return; end if;
  select * into v_ev from public.events where id = m.event_id;
  if m.finalized_status = 'unexcused' and v_ev.status <> 'cancelled' then
    insert into public.attendance_followups as f
      (org_id, event_id, athlete_id, sheet_id, mark_id, team_id, status, mark_status, source, opened_at, opened_by, history)
    values (m.org_id, m.event_id, m.athlete_id, m.sheet_id, m.id, v_ev.team_id, 'open', 'unexcused', p_source, v_now, p_actor,
            jsonb_build_array(jsonb_build_object('action', 'opened', 'at', v_now, 'by', p_actor, 'status', 'unexcused', 'source', p_source)))
    on conflict (event_id, athlete_id) do update
      set status = 'open', mark_status = 'unexcused', source = excluded.source, opened_at = excluded.opened_at,
          opened_by = excluded.opened_by, reopen_count = f.reopen_count + 1, mark_id = excluded.mark_id, sheet_id = excluded.sheet_id,
          resolved_at = null, resolved_by = null, resolution_status = null, resolution_reason = null,
          history = f.history || jsonb_build_array(jsonb_build_object('action', 'reopened', 'at', v_now, 'by', p_actor,
                                                                      'status', 'unexcused', 'source', p_source))
      where f.status = 'resolved';
  elsif m.finalized_status in ('present', 'late', 'excused') then
    update public.attendance_followups f
       set status = 'resolved', mark_status = m.finalized_status, resolved_at = v_now, resolved_by = p_actor,
           resolution_status = m.finalized_status, resolution_reason = left(nullif(btrim(p_reason), ''), 500),
           history = f.history || jsonb_build_array(jsonb_build_object('action', 'resolved', 'at', v_now, 'by', p_actor,
                                                                       'status', m.finalized_status, 'source', p_source))
     where f.event_id = m.event_id and f.athlete_id = m.athlete_id and f.status = 'open';
  end if;
end;
$$;

-- Sheet finalized (first time or again after a reopen): sync every mark.
create or replace function public.ac_followups_on_finalize()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_mark uuid;
begin
  if new.status = 'final' and old.status is distinct from 'final' then
    for v_mark in select m.id from public.team_attendance_marks m where m.sheet_id = new.id loop
      perform public.ac_followup_sync(v_mark, null, auth.uid(), 'finalize');
    end loop;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_ac_followups_on_finalize on public.team_attendance_sheets;
create trigger trg_ac_followups_on_finalize after update of status on public.team_attendance_sheets
  for each row execute function public.ac_followups_on_finalize();

-- Correction of a final mark (history row phase 'correction').
create or replace function public.ac_followups_on_correction()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.phase = 'correction' then
    perform public.ac_followup_sync(new.mark_id, new.reason, new.changed_by, 'correction');
  end if;
  return null;
end;
$$;
drop trigger if exists trg_ac_followups_on_correction on public.team_attendance_mark_history;
create trigger trg_ac_followups_on_correction after insert on public.team_attendance_mark_history
  for each row execute function public.ac_followups_on_correction();

-- A cancelled session needs no follow-up: open rows are resolved (kept).
create or replace function public.ac_followups_on_cancel()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    update public.attendance_followups f
       set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(), resolution_status = 'cancelled',
           history = f.history || jsonb_build_array(jsonb_build_object('action', 'resolved', 'at', now(), 'by', auth.uid(),
                                                                       'status', 'cancelled', 'source', 'event'))
     where f.event_id = new.id and f.status = 'open';
  end if;
  return null;
end;
$$;
drop trigger if exists trg_ac_followups_on_cancel on public.events;
create trigger trg_ac_followups_on_cancel after update of status on public.events
  for each row execute function public.ac_followups_on_cancel();

-- Staff list: admin = club; coach = sessions they can run.
create or replace function public.attendance_followups_list(p_status text default 'open', p_limit integer default 100)
returns table (followup_id uuid, event_id uuid, athlete_id uuid, first_name text, last_name text, team_id uuid, group_name text,
               event_type text, starts_at timestamptz, status text, mark_status text, opened_at timestamptz, reopen_count integer,
               resolved_at timestamptz, resolved_by_name text, resolution_status text, resolution_reason text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_org uuid := public.current_org_id(); v_admin boolean := public.is_admin(); v_coach uuid := public.current_coach_id();
begin
  if v_org is null or not (v_admin or (v_coach is not null and public.has_role('coach'))) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if p_status is not null and p_status not in ('open', 'resolved') then raise exception 'INVALID_STATUS' using errcode = 'P0001'; end if;
  return query
  select f.id, f.event_id, f.athlete_id, a.first_name, a.last_name, e.team_id,
         coalesce(t.name, (select sv.name from public.training_sessions x join public.training_services sv on sv.id = x.service_id
                            where x.id = e.training_session_id)),
         e.type::text, e.starts_at, f.status, f.mark_status, f.opened_at, f.reopen_count,
         f.resolved_at, (select p.full_name from public.profiles p where p.id = f.resolved_by), f.resolution_status,
         case when v_admin then f.resolution_reason end
    from public.attendance_followups f
    join public.events e on e.id = f.event_id
    join public.athletes a on a.id = f.athlete_id
    left join public.teams t on t.id = e.team_id
   where f.org_id = v_org
     and (p_status is null or f.status = p_status)
     and (v_admin or public.coach_can_run_event(f.event_id))
   order by f.status, e.starts_at desc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

-- ===========================================================================
-- 5. Attendance overview: one read for the Attendance tab, Dashboard and
--    player history. Player status = the current SAVED mark (separate from
--    the sheet workflow); athlete_finalized_status = the value totals use.
-- ===========================================================================
create or replace function public.attendance_sessions_overview(
  p_from date default null, p_to date default null, p_team uuid default null, p_athlete uuid default null,
  p_scope text default 'all', p_program uuid default null, p_limit integer default 300)
returns table (source text, session_id uuid, event_id uuid, team_id uuid, program_id uuid, group_name text, event_type text,
               title text, starts_at timestamptz, ends_at timestamptz, local_date date, event_status text, cancel_reason text,
               workflow_status text, sheet_version integer, finalized boolean, tracked boolean,
               present integer, late integer, excused integer, unexcused integer, unmarked integer, total integer,
               athlete_status text, athlete_finalized_status text, athlete_is_guest boolean, coverage jsonb, open_followups integer)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_org   uuid := public.current_org_id();
  v_admin boolean := public.is_admin();
  v_coach uuid := public.current_coach_id();
  v_scope text := coalesce(p_scope, 'all');
  v_tz    text;
  v_teams uuid[];
begin
  if v_org is null or not (v_admin or (v_coach is not null and public.has_role('coach'))) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if v_scope not in ('all', 'teams', 'bookings', 'programs') then raise exception 'INVALID_SCOPE' using errcode = 'P0001'; end if;
  if p_from is not null and p_to is not null and p_to < p_from then raise exception 'INVALID_RANGE' using errcode = 'P0001'; end if;
  if p_team is not null and not exists (select 1 from public.teams t where t.id = p_team and t.org_id = v_org) then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_athlete is not null and not exists (select 1 from public.athletes a where a.id = p_athlete and a.org_id = v_org) then
    raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_program is not null and not exists (select 1 from public.programs p where p.id = p_program and p.org_id = v_org) then
    raise exception 'PROGRAM_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_tz := public.ta_tz(v_org);
  if p_athlete is not null then
    select array_agg(distinct x.team_id) into v_teams from (
      select tm.team_id from public.team_memberships tm where tm.athlete_id = p_athlete
      union select tp.team_id from public.team_membership_periods tp where tp.athlete_id = p_athlete) x;
  end if;

  return query
  with ev as (
    select e.id, e.team_id, e.training_session_id, e.type::text as et, e.title, e.starts_at, e.ends_at,
           e.status::text as es, e.cancel_reason, (e.starts_at at time zone v_tz)::date as ld
      from public.events e
     where e.org_id = v_org
       and e.type::text = any(public.ta_sheet_types())
       and (e.team_id is not null or e.training_session_id is not null)
       and p_program is null
       and (v_scope = 'all' or (v_scope = 'teams' and e.team_id is not null) or (v_scope = 'bookings' and e.team_id is null))
       and (p_team is null or e.team_id = p_team)
       and (p_from is null or e.starts_at >= (p_from::timestamp at time zone v_tz) - interval '1 day')
       and (p_to is null or e.starts_at < ((p_to + 1)::timestamp at time zone v_tz) + interval '1 day')
       and (p_athlete is null or e.team_id = any(coalesce(v_teams, '{}'::uuid[]))
            or exists (select 1 from public.team_attendance_marks m0 where m0.event_id = e.id and m0.athlete_id = p_athlete)
            or exists (select 1 from public.training_bookings b0 where b0.session_id = e.training_session_id and b0.athlete_id = p_athlete))
  ),
  team_rows as (
    select case when ev.team_id is not null then 'team' else 'booking' end as src, ev.*, s.id as sheet_id, s.status as ss, s.version as sv,
           coalesce(s.finalize_count, 0) > 0 as fin
      from ev
      left join public.team_attendance_sheets s on s.event_id = ev.id
     where (p_from is null or ev.ld >= p_from) and (p_to is null or ev.ld <= p_to)
       and (s.id is not null or public.ta_event_tracked(ev.id))
       and (v_admin or public.coach_can_run_event(ev.id))
  ),
  team_out as (
    select tr.src, tr.id as sid, tr.id as eid, tr.team_id as tid, null::uuid as pid,
           coalesce(t.name, (select sv.name from public.training_sessions x join public.training_services sv on sv.id = x.service_id
                              where x.id = tr.training_session_id)) as gname,
           tr.et, tr.title, tr.starts_at, tr.ends_at, tr.ld, tr.es, tr.cancel_reason,
           case when tr.es = 'cancelled' then 'cancelled' when tr.sheet_id is null then 'not_started' else tr.ss end as wf,
           tr.sv, tr.fin, (tr.sheet_id is not null or public.ta_event_tracked(tr.id)) as trk,
           coalesce(c.present, 0) as present, coalesce(c.late, 0) as late, coalesce(c.excused, 0) as excused,
           coalesce(c.unexcused, 0) as unexcused,
           case when tr.sheet_id is not null then coalesce(c.unmarked, 0)
                when tr.es = 'cancelled' then 0
                when tr.team_id is not null then (select count(*)::int from public.ta_roster_on(tr.team_id, tr.ld))
                else (select count(*)::int from public.bk_event_roster(tr.id)) end as unmarked_n,
           case when tr.sheet_id is not null then coalesce(c.total, 0)
                when tr.es = 'cancelled' then 0
                when tr.team_id is not null then (select count(*)::int from public.ta_roster_on(tr.team_id, tr.ld))
                else (select count(*)::int from public.bk_event_roster(tr.id)) end as total_n,
           am.st as a_st, am.fst as a_fst, am.guest as a_guest,
           public.ac_coverage(tr.id) as cov,
           (select count(*)::int from public.attendance_followups f where f.event_id = tr.id and f.status = 'open') as ofu
      from team_rows tr
      left join public.teams t on t.id = tr.team_id
      left join lateral (
        select count(*) filter (where m.status = 'present')::int as present,
               count(*) filter (where m.status = 'late')::int as late,
               count(*) filter (where m.status = 'excused')::int as excused,
               count(*) filter (where m.status = 'unexcused')::int as unexcused,
               count(*) filter (where m.status = 'unmarked')::int as unmarked,
               count(*)::int as total
          from public.team_attendance_marks m where m.sheet_id = tr.sheet_id
      ) c on tr.sheet_id is not null
      left join lateral (
        select m.status as st, m.finalized_status as fst, m.is_guest as guest
          from public.team_attendance_marks m
         where p_athlete is not null and tr.sheet_id is not null and m.sheet_id = tr.sheet_id and m.athlete_id = p_athlete
        union all
        select 'unmarked', null, false
         where p_athlete is not null and tr.sheet_id is null and tr.es <> 'cancelled'
           and ((tr.team_id is not null and exists (select 1 from public.ta_roster_on(tr.team_id, tr.ld) r where r.athlete_id = p_athlete))
                or (tr.team_id is null and exists (select 1 from public.bk_event_roster(tr.id) b where b.athlete_id = p_athlete)))
      ) am on true
     where p_athlete is null or am.st is not null
  ),
  legacy_out as (
    select 'program'::text as src, x.id as sid, null::uuid as eid, null::uuid as tid, x.program_id as pid, p.name as gname,
           'training'::text as et, null::text as title, x.session_date as starts_at, x.session_date as ends_at,
           (x.session_date at time zone v_tz)::date as ld, 'scheduled'::text as es, null::text as cancel_reason,
           case when x.status::text = 'open' then 'draft' else 'final' end as wf, null::integer as sv,
           x.status::text <> 'open' as fin, true as trk,
           (select count(*)::int from public.attendance_marks m where m.attendance_session_id = x.id and m.status = 'present') as present,
           (select count(*)::int from public.attendance_marks m where m.attendance_session_id = x.id and m.status = 'late') as late,
           (select count(*)::int from public.attendance_marks m where m.attendance_session_id = x.id and m.status = 'excused') as excused,
           (select count(*)::int from public.attendance_marks m where m.attendance_session_id = x.id and m.status = 'absent') as unexcused,
           0 as unmarked_n,
           (select count(*)::int from public.attendance_marks m where m.attendance_session_id = x.id) as total_n,
           (select case m.status::text when 'absent' then 'unexcused' else m.status::text end
              from public.attendance_marks m where m.attendance_session_id = x.id and m.athlete_id = p_athlete) as a_st,
           (select case when x.status::text = 'open' then null when m.status::text = 'absent' then 'unexcused' else m.status::text end
              from public.attendance_marks m where m.attendance_session_id = x.id and m.athlete_id = p_athlete) as a_fst,
           false as a_guest,
           jsonb_build_object(
             'coverage', case when x.coach_id is null then 'missing' else 'assigned' end,
             'led_by_coach_id', x.coach_id, 'led_by_name', c.display_name,
             'led_by_source', case when x.coach_id is null then null else 'program' end,
             'coaches', case when x.coach_id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
                          'coach_id', x.coach_id, 'name', c.display_name, 'role', 'lead', 'source', 'program')) end,
             'substitute', false, 'multiple_leads', false, 'pending_requests', 0) as cov,
           0 as ofu
      from public.attendance_sessions x
      left join public.programs p on p.id = x.program_id
      left join public.coaches c on c.id = x.coach_id
     where x.org_id = v_org
       and v_scope in ('all', 'programs') and p_team is null
       and (p_program is null or x.program_id = p_program)
       and (v_admin or x.coach_id = v_coach)
       and (p_from is null or (x.session_date at time zone v_tz)::date >= p_from)
       and (p_to is null or (x.session_date at time zone v_tz)::date <= p_to)
       -- A programme session linked to a team sheet is shown once, through the sheet.
       and not exists (select 1 from public.team_attendance_sheets s where s.legacy_attendance_session_id = x.id)
       and (p_athlete is null or exists (select 1 from public.attendance_marks m where m.attendance_session_id = x.id and m.athlete_id = p_athlete))
  ),
  allrows as (select * from team_out union all select * from legacy_out)
  select a.src, a.sid, a.eid, a.tid, a.pid, a.gname, a.et, a.title, a.starts_at, a.ends_at, a.ld, a.es, a.cancel_reason,
         a.wf, a.sv, a.fin, a.trk, a.present, a.late, a.excused, a.unexcused, a.unmarked_n, a.total_n,
         a.a_st, a.a_fst, a.a_guest, a.cov, a.ofu
    from allrows a
   order by a.starts_at desc, a.sid
   limit greatest(1, least(coalesce(p_limit, 300), 1000));
end;
$$;

-- Roster of listed sessions with each player's current status (expand rows).
-- The roster is the one of the session: the sheet snapshot when it exists,
-- otherwise team_roster_on(local date) / the confirmed bookings; programme
-- sessions list their marks. Minimal data: name, jersey, status.
create or replace function public.attendance_sessions_roster(p_sessions uuid[])
returns table (session_id uuid, athlete_id uuid, first_name text, last_name text, jersey_number integer,
               status text, finalized_status text, is_guest boolean, followup_status text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_org   uuid := public.current_org_id();
  v_admin boolean := public.is_admin();
  v_coach uuid := public.current_coach_id();
  v_ids   uuid[] := (coalesce(p_sessions, '{}'::uuid[]))[1:100];
begin
  if v_org is null or not (v_admin or (v_coach is not null and public.has_role('coach'))) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  return query
  with ev as (
    select e.id, e.team_id, e.status::text as es, (e.starts_at at time zone public.ta_tz(e.org_id))::date as ld, s.id as sheet_id
      from public.events e left join public.team_attendance_sheets s on s.event_id = e.id
     where e.id = any(v_ids) and e.org_id = v_org and (v_admin or public.coach_can_run_event(e.id))
  ),
  rows_ as (
    select ev.id as sid, m.athlete_id as aid, m.status as st, m.finalized_status as fst, m.is_guest as guest
      from ev join public.team_attendance_marks m on m.sheet_id = ev.sheet_id
    union all
    select ev.id, r.athlete_id, 'unmarked', null, false
      from ev cross join lateral public.ta_roster_on(ev.team_id, ev.ld) r
     where ev.sheet_id is null and ev.team_id is not null and ev.es <> 'cancelled'
    union all
    select ev.id, b.athlete_id, 'unmarked', null, false
      from ev cross join lateral public.bk_event_roster(ev.id) b
     where ev.sheet_id is null and ev.team_id is null and ev.es <> 'cancelled'
    union all
    select x.id, m.athlete_id, case m.status::text when 'absent' then 'unexcused' else m.status::text end,
           case when x.status::text = 'open' then null when m.status::text = 'absent' then 'unexcused' else m.status::text end, false
      from public.attendance_sessions x join public.attendance_marks m on m.attendance_session_id = x.id
     where x.id = any(v_ids) and x.org_id = v_org and (v_admin or x.coach_id = v_coach)
  )
  select r.sid, r.aid, a.first_name, a.last_name,
         (select tm.jersey_number::int from public.team_memberships tm join public.events e2 on e2.id = r.sid
           where tm.team_id = e2.team_id and tm.athlete_id = r.aid limit 1),
         r.st, r.fst, r.guest,
         (select f.status from public.attendance_followups f where f.event_id = r.sid and f.athlete_id = r.aid)
    from rows_ r join public.athletes a on a.id = r.aid
   order by r.sid, a.last_name, a.first_name;
end;
$$;

-- ===========================================================================
-- 6. Reconciliation (idempotent, audited; never rewrites valid marks/history)
-- ===========================================================================
create or replace function public.ac_reconcile(p_org uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_led   integer := 0;
  v_fu    integer := 0;
  v_ml    integer := 0;
  v_nl    integer := 0;
  v_nf    integer := 0;
  v_res   integer := 0;
  r       record;
  v_lead  uuid;
begin
  -- a) led_by on final sheets where it is null and an effective lead exists.
  for r in select s.id, s.event_id from public.team_attendance_sheets s
            where s.org_id = p_org and s.status = 'final' and s.led_by_coach_id is null loop
    v_lead := public.ac_default_lead(r.event_id);
    if v_lead is not null then
      update public.team_attendance_sheets set led_by_coach_id = v_lead where id = r.id and led_by_coach_id is null;
      perform public.ca_audit(p_org, 'attendance.led_by_backfill', 'team_attendance_sheets', r.id,
                              jsonb_build_object('event_id', r.event_id, 'led_by_coach_id', v_lead,
                                                 'source', (select p.source from public.ac_lead_pick(r.event_id) p)));
      v_led := v_led + 1;
    end if;
  end loop;

  -- b) follow-ups for finalized unexcused marks (final or reopened sheets).
  insert into public.attendance_followups (org_id, event_id, athlete_id, sheet_id, mark_id, team_id, status, mark_status, source,
                                           opened_at, history)
  select m.org_id, m.event_id, m.athlete_id, m.sheet_id, m.id, e.team_id, 'open', 'unexcused', 'backfill',
         coalesce(s.finalized_at, now()),
         jsonb_build_array(jsonb_build_object('action', 'opened', 'at', now(), 'by', null, 'status', 'unexcused', 'source', 'backfill'))
    from public.team_attendance_marks m
    join public.team_attendance_sheets s on s.id = m.sheet_id
    join public.events e on e.id = m.event_id
   where m.org_id = p_org and m.finalized_status = 'unexcused' and s.finalize_count > 0
     and s.status in ('final', 'reopened') and e.status <> 'cancelled'
  on conflict (event_id, athlete_id) do nothing;
  get diagnostics v_fu = row_count;
  if v_fu > 0 then
    perform public.ca_audit(p_org, 'attendance.followups_backfill', 'attendance_followups', null, jsonb_build_object('created', v_fu));
  end if;

  -- c) several approved leads on one session: kept, flagged.
  insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
  select a.org_id, 'events', a.event_id, 'MULTIPLE_LEADS',
         jsonb_build_object('coach_ids', jsonb_agg(a.coach_id order by a.created_at), 'count', count(*))
    from public.event_coach_assignments a
   where a.org_id = p_org and a.role = 'lead' and a.status = 'approved'
   group by a.org_id, a.event_id having count(*) > 1
  on conflict do nothing;
  get diagnostics v_ml = row_count;

  -- d) final sheets with no lead at all (nobody to name).
  insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
  select s.org_id, 'team_attendance_sheets', s.id, 'ATTENDANCE_NO_LEAD', jsonb_build_object('event_id', s.event_id)
    from public.team_attendance_sheets s
   where s.org_id = p_org and s.status = 'final' and s.led_by_coach_id is null
  on conflict do nothing;
  get diagnostics v_nl = row_count;

  -- e) final sheets with marks that carry no finalized value.
  insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
  select s.org_id, 'team_attendance_sheets', s.id, 'ATTENDANCE_MARK_NOT_FINALIZED',
         jsonb_build_object('event_id', s.event_id, 'marks', count(*))
    from public.team_attendance_sheets s join public.team_attendance_marks m on m.sheet_id = s.id
   where s.org_id = p_org and s.status = 'final' and (m.finalized_status is null or m.status = 'unmarked')
   group by s.org_id, s.id, s.event_id
  on conflict do nothing;
  get diagnostics v_nf = row_count;

  -- Flags whose cause is gone resolve themselves.
  update public.data_review_flags f
     set resolved_at = now(), resolution_note = 'resolved by attendance reconcile'
   where f.org_id = p_org and f.resolved_at is null
     and ((f.reason_code = 'MULTIPLE_LEADS'
           and (select count(*) from public.event_coach_assignments a
                 where a.event_id = f.entity_id and a.role = 'lead' and a.status = 'approved') <= 1)
       or (f.reason_code = 'ATTENDANCE_NO_LEAD'
           and not exists (select 1 from public.team_attendance_sheets s
                            where s.id = f.entity_id and s.status = 'final' and s.led_by_coach_id is null))
       or (f.reason_code = 'ATTENDANCE_MARK_NOT_FINALIZED'
           and not exists (select 1 from public.team_attendance_sheets s join public.team_attendance_marks m on m.sheet_id = s.id
                            where s.id = f.entity_id and s.status = 'final'
                              and (m.finalized_status is null or m.status = 'unmarked'))));
  get diagnostics v_res = row_count;

  return jsonb_build_object('led_by_backfilled', v_led, 'followups_created', v_fu, 'multiple_leads_flagged', v_ml,
                            'no_lead_flagged', v_nl, 'not_finalized_flagged', v_nf, 'flags_resolved', v_res);
end;
$$;

-- Admin (own club) or service role (cron).
create or replace function public.attendance_consistency_reconcile(p_org uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_service_caller() or (p_org = public.current_org_id() and public.is_admin())) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  return public.ac_reconcile(p_org);
end;
$$;

-- ===========================================================================
-- 7. Privileges
-- ===========================================================================
do $$
declare f text;
begin
  -- Internal helpers and trigger functions: never callable through the API.
  foreach f in array array[
    'public.ac_one_lead_guard()', 'public.ac_session_coaches(uuid)', 'public.ac_lead_pick(uuid)', 'public.ac_default_lead(uuid)',
    'public.ac_coverage(uuid)', 'public.ac_sheet_default_lead()', 'public.ac_followup_sync(uuid, text, uuid, text)',
    'public.ac_followups_on_finalize()', 'public.ac_followups_on_correction()', 'public.ac_followups_on_cancel()',
    'public.ac_reconcile(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  -- Signed-in API: each function checks tenant and role inside.
  foreach f in array array[
    'public.session_assign_coach(uuid, uuid, text)', 'public.session_set_coach_role(uuid, text)',
    'public.session_coverage(uuid[])', 'public.attendance_followups_list(text, integer)',
    'public.attendance_sessions_overview(date, date, uuid, uuid, text, uuid, integer)',
    'public.attendance_sessions_roster(uuid[])', 'public.attendance_consistency_reconcile(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 8. Run the reconciliation once for every club (idempotent)
-- ===========================================================================
do $$
declare o record;
begin
  for o in select id from public.organizations loop
    perform public.ac_reconcile(o.id);
  end loop;
end $$;
