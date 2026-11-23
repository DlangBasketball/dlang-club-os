-- ============================================================================
-- Club OS — Team rosters, training attendance, absence reports, no-show
-- alerts, coach session access and player portal access (Phase A backend).
--
-- Contract for the app and the UI agents: docs/team-attendance.md.
-- Tests: tests/db/team_attendance.sql (synthetic data only).
--
-- Design decisions
--   * Team attendance gets its OWN tables (team_attendance_sheets / _marks).
--     The programme-session module (attendance_sessions / attendance_marks)
--     has a different status model (open/submitted/locked; present/late/
--     absent/excused, no "unmarked", no version) and stays untouched: its
--     rows, RPCs, pages and the legacy coach roll call keep working.
--   * Rosters are effective-dated on team_memberships (joined_on / left_on,
--     both inclusive). The one-row-per-(team, athlete) unique key stays (the
--     selection flow upserts on it); an earlier, closed period of a row that
--     is reopened or moved to another team is archived in
--     team_membership_periods, so team_roster_on() answers for any date.
--   * The sheet of an event is built from team_roster_on(team, local date of
--     the event in the club time zone) plus guests; the marks ARE the roster
--     snapshot (a later roster change never rewrites a sheet).
--   * Business refusals that carry data (unmarked players, version conflict,
--     unacknowledged reported absences) are RETURNED as {ok:false, code, …};
--     authorization / not-found / invalid input RAISE an UPPER_CASE code.
--   * The new enum value app_role 'player' is added first and never used as
--     an enum literal in this file (only text comparisons), so the file is
--     safe when a migration runner wraps it in one transaction.
--
-- Additive and idempotent: if not exists / create or replace / drop policy if
-- exists + create policy / guarded do blocks. Existing rows are preserved.
-- ============================================================================

-- ===========================================================================
-- 0. Role value + helpers
-- ===========================================================================
alter type public.app_role add value if not exists 'player';

-- Club time zone and "today" in it (app_settings first, then organization).
create or replace function public.ta_tz(p_org uuid)
returns text language sql stable security definer set search_path = public as $$
  select public.staff_org_tz(p_org);
$$;

create or replace function public.ta_today(p_org uuid)
returns date language sql stable security definer set search_path = public as $$
  select (now() at time zone public.ta_tz(p_org))::date;
$$;

-- Local (club time zone) date of an event: the date its roster is taken on.
create or replace function public.ta_event_date(p_event uuid)
returns date language sql stable security definer set search_path = public as $$
  select (e.starts_at at time zone public.ta_tz(e.org_id))::date from public.events e where e.id = p_event;
$$;

-- Event types that take a team attendance sheet.
create or replace function public.ta_sheet_types()
returns text[] language sql immutable set search_path = public as $$
  select array['training', 'game', 'tournament']::text[];
$$;

-- Days a substitute / approved coach keeps access to a session after its
-- sheet was finalized (corrections window).
create or replace function public.ta_grace_days()
returns integer language sql immutable set search_path = public as $$ select 7 $$;

-- Maximum delivery attempts of a no-show alert before it needs follow-up.
create or replace function public.ta_alert_max_attempts()
returns integer language sql immutable set search_path = public as $$ select 5 $$;

-- A team of a selection programme division (EYBL …): its roster follows the
-- enrolment flow (program_applications), never the club roster RPCs.
create or replace function public.ta_is_selection_team(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.program_divisions d where d.team_id = p_team);
$$;

-- Admin of the event's org or coach of the event's team ("team staff").
create or replace function public.ta_is_event_staff(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.events e
     where e.id = p_event and e.org_id = public.current_org_id()
       and (public.is_admin() or (e.team_id is not null and public.coach_coaches_team(e.team_id))));
$$;

-- ===========================================================================
-- 1. Effective-dated rosters
-- ===========================================================================
alter table public.team_memberships
  add column if not exists dates_source       text,
  add column if not exists end_reason         text,
  add column if not exists ended_by           uuid references public.profiles(id) on delete set null;

do $$ begin
  alter table public.team_memberships add constraint team_memberships_dates_source_chk
    check (dates_source is null or dates_source in ('recorded', 'uncertain'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.team_memberships add constraint team_memberships_end_reason_len
    check (end_reason is null or length(end_reason) <= 500);
exception when duplicate_object then null; end $$;

-- Closed earlier periods of a membership row (reopened later, or moved to
-- another team by an UPDATE of team_id). Written by trigger only.
create table if not exists public.team_membership_periods (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  membership_id  uuid references public.team_memberships(id) on delete set null,
  team_id        uuid not null references public.teams(id) on delete cascade,
  athlete_id     uuid not null references public.athletes(id) on delete cascade,
  joined_on      date not null,
  left_on        date not null,
  jersey_number  smallint,
  position       text,
  reason         text,
  archived_by    uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint team_membership_periods_dates_chk check (left_on >= joined_on),
  constraint team_membership_periods_reason_len check (reason is null or length(reason) <= 500)
);
create index if not exists idx_team_membership_periods_org on public.team_membership_periods(org_id);
create index if not exists idx_team_membership_periods_team on public.team_membership_periods(team_id, joined_on, left_on);
create index if not exists idx_team_membership_periods_athlete on public.team_membership_periods(athlete_id);
drop trigger if exists trg_team_membership_periods_updated on public.team_membership_periods;
create trigger trg_team_membership_periods_updated before update on public.team_membership_periods
  for each row execute function public.set_updated_at();
drop trigger if exists trg_team_membership_periods_org on public.team_membership_periods;
create trigger trg_team_membership_periods_org before insert or update on public.team_membership_periods
  for each row execute function public.ca_same_org_guard('team_id:teams', 'athlete_id:athletes');
drop trigger if exists trg_audit_team_membership_periods on public.team_membership_periods;
create trigger trg_audit_team_membership_periods after insert or update or delete on public.team_membership_periods
  for each row execute function public.audit_trigger();

-- Effective-date bookkeeping on every write of a membership:
--   * status set to inactive without an end date -> ends today (club date)
--   * a row that had ended in the past and is made current again (left_on
--     cleared / status re-activated) -> the old period is archived and the
--     row restarts today (or on the explicitly given later joined_on)
--   * team_id changed (a "move") -> the period on the old team is archived
--     (it ends the day before the new joined_on) so old sheets keep it
create or replace function public.team_memberships_effective()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.ta_today(new.org_id);
  v_end   date;
begin
  if tg_op = 'INSERT' then
    new.dates_source := coalesce(new.dates_source, 'recorded');
    if new.status = 'inactive' and new.left_on is null then
      new.left_on := greatest(new.joined_on, v_today);
    end if;
    return new;
  end if;

  -- Move to another team: archive the period on the old team.
  if new.team_id is distinct from old.team_id then
    v_end := least(coalesce(old.left_on, new.joined_on - 1), new.joined_on - 1);
    if v_end >= old.joined_on then
      insert into public.team_membership_periods
        (org_id, membership_id, team_id, athlete_id, joined_on, left_on, jersey_number, position, reason, archived_by)
      values (old.org_id, old.id, old.team_id, old.athlete_id, old.joined_on, v_end, old.jersey_number, old.position,
              'moved', auth.uid());
    end if;
    if new.joined_on is not distinct from old.joined_on then new.joined_on := greatest(v_today, old.joined_on); end if;
    new.dates_source := 'recorded';
    return new;
  end if;

  -- Re-activation of an ended row (selection re-enrolment, roster edit).
  if old.left_on is not null
     and (new.left_on is null
          or (old.status = 'inactive' and new.status <> 'inactive' and new.left_on is not distinct from old.left_on)) then
    if old.left_on < v_today then
      insert into public.team_membership_periods
        (org_id, membership_id, team_id, athlete_id, joined_on, left_on, jersey_number, position, reason, archived_by)
      values (old.org_id, old.id, old.team_id, old.athlete_id, old.joined_on, old.left_on, old.jersey_number, old.position,
              coalesce(old.end_reason, 'ended'), auth.uid());
      if new.joined_on is not distinct from old.joined_on or new.joined_on <= old.left_on then
        new.joined_on := greatest(v_today, old.left_on + 1);
      end if;
    end if;
    new.left_on := null;
    new.end_reason := null;
    new.ended_by := null;
  end if;

  if new.status = 'inactive' and new.left_on is null then
    new.left_on := greatest(new.joined_on, v_today);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_team_memberships_effective on public.team_memberships;
create trigger trg_team_memberships_effective before insert or update on public.team_memberships
  for each row execute function public.team_memberships_effective();

-- Rows used by team attendance are history: an API client (RLS path) may
-- not delete them; the roster RPCs end them instead. SECURITY DEFINER flows
-- (person / team deletion) run as the owner and are not affected.
create or replace function public.ta_membership_has_attendance(p_team uuid, p_athlete uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  return exists (select 1 from public.team_attendance_marks m
                   join public.team_attendance_sheets s on s.id = m.sheet_id
                  where s.team_id = p_team and m.athlete_id = p_athlete and not m.is_guest);
end;
$$;

-- SECURITY INVOKER on purpose: current_user is the role running the DELETE
-- (authenticated / anon for API clients, the owner inside definer RPCs).
create or replace function public.team_memberships_delete_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon')
     and public.ta_membership_has_attendance(old.team_id, old.athlete_id) then
    raise exception 'MEMBERSHIP_HAS_ATTENDANCE' using errcode = 'P0001';
  end if;
  return old;
end;
$$;
drop trigger if exists trg_team_memberships_delete_guard on public.team_memberships;
create trigger trg_team_memberships_delete_guard before delete on public.team_memberships
  for each row execute function public.team_memberships_delete_guard();

-- ===========================================================================
-- 2. Tables
-- ===========================================================================

-- ---- Player portal link: one login per athlete per club ---------------------
alter table public.athletes add column if not exists player_profile_id uuid references public.profiles(id) on delete set null;
alter table public.athletes add column if not exists player_linked_at timestamptz;
create unique index if not exists athletes_player_profile_uidx
  on public.athletes(org_id, player_profile_id) where player_profile_id is not null;

alter table public.invitations add column if not exists athlete_id uuid references public.athletes(id) on delete cascade;
create index if not exists idx_invitations_athlete on public.invitations(athlete_id) where athlete_id is not null;
do $$ begin
  alter table public.invitations add constraint invitations_player_athlete_chk
    check (role::text <> 'player' or athlete_id is not null);
exception when duplicate_object then null; end $$;

-- ---- Session-level coach access ----------------------------------------------
create table if not exists public.event_coach_assignments (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  event_id       uuid not null references public.events(id) on delete cascade,
  coach_id       uuid not null references public.coaches(id) on delete cascade,
  role           text not null default 'substitute',
  status         text not null default 'pending',
  request_note   text,
  requested_by   uuid references public.profiles(id) on delete set null,
  assigned_by    uuid references public.profiles(id) on delete set null,
  decided_by     uuid references public.profiles(id) on delete set null,
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint event_coach_assignments_role_chk check (role in ('substitute', 'lead')),
  constraint event_coach_assignments_status_chk check (status in ('approved', 'pending', 'rejected')),
  constraint event_coach_assignments_text_len check (coalesce(length(request_note), 0) <= 500 and coalesce(length(decision_note), 0) <= 500),
  unique (event_id, coach_id)
);
create index if not exists idx_event_coach_assignments_org on public.event_coach_assignments(org_id, status);
create index if not exists idx_event_coach_assignments_coach on public.event_coach_assignments(coach_id, status);

-- ---- Attendance sheet: one per event -----------------------------------------
create table if not exists public.team_attendance_sheets (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  event_id              uuid not null unique references public.events(id) on delete cascade,
  team_id               uuid not null references public.teams(id) on delete cascade,
  roster_date           date not null,
  status                text not null default 'draft',
  version               integer not null default 1,
  led_by_coach_id       uuid references public.coaches(id) on delete set null,
  opened_by             uuid references public.profiles(id) on delete set null,
  submitted_by          uuid references public.profiles(id) on delete set null,
  submitted_at          timestamptz,
  finalized_by          uuid references public.profiles(id) on delete set null,
  finalized_at          timestamptz,
  first_finalized_at    timestamptz,
  reopened_by           uuid references public.profiles(id) on delete set null,
  reopened_at           timestamptz,
  reopen_reason         text,
  finalize_count        integer not null default 0,
  correction_count      integer not null default 0,
  alerts_synced_at      timestamptz,
  legacy_attendance_session_id uuid references public.attendance_sessions(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint team_attendance_sheets_status_chk check (status in ('draft', 'final', 'reopened')),
  constraint team_attendance_sheets_reason_len check (reopen_reason is null or length(reopen_reason) <= 500)
);
create index if not exists idx_team_attendance_sheets_org on public.team_attendance_sheets(org_id, status);
create index if not exists idx_team_attendance_sheets_team on public.team_attendance_sheets(team_id, roster_date);
create index if not exists idx_team_attendance_sheets_due on public.team_attendance_sheets(org_id)
  where status = 'final' and alerts_synced_at is null;

-- ---- Marks: one row per (event, athlete) ---------------------------------------
create table if not exists public.team_attendance_marks (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  sheet_id            uuid not null references public.team_attendance_sheets(id) on delete cascade,
  event_id            uuid not null references public.events(id) on delete cascade,
  athlete_id          uuid not null references public.athletes(id) on delete cascade,
  membership_id       uuid references public.team_memberships(id) on delete set null,
  is_guest            boolean not null default false,
  status              text not null default 'unmarked',
  finalized_status    text,
  rev                 integer not null default 0,
  note                text,
  reported_absence_ack boolean not null default false,
  added_by            uuid references public.profiles(id) on delete set null,
  updated_by          uuid references public.profiles(id) on delete set null,
  marked_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint team_attendance_marks_status_chk check (status in ('unmarked', 'present', 'late', 'excused', 'unexcused')),
  constraint team_attendance_marks_final_chk check (finalized_status is null or finalized_status in ('present', 'late', 'excused', 'unexcused')),
  constraint team_attendance_marks_note_len check (note is null or length(note) <= 500)
);
create unique index if not exists team_attendance_marks_event_athlete_uidx on public.team_attendance_marks(event_id, athlete_id);
create unique index if not exists team_attendance_marks_sheet_athlete_uidx on public.team_attendance_marks(sheet_id, athlete_id);
create index if not exists idx_team_attendance_marks_org on public.team_attendance_marks(org_id);
create index if not exists idx_team_attendance_marks_athlete on public.team_attendance_marks(athlete_id, event_id);

-- ---- Mark history: every change (drafts and after finalization) ------------------
create table if not exists public.team_attendance_mark_history (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  sheet_id         uuid not null references public.team_attendance_sheets(id) on delete cascade,
  mark_id          uuid not null references public.team_attendance_marks(id) on delete cascade,
  event_id         uuid not null references public.events(id) on delete cascade,
  athlete_id       uuid not null references public.athletes(id) on delete cascade,
  previous_status  text,
  new_status       text not null,
  phase            text not null,
  reason           text,
  request_id       uuid,
  changed_by       uuid references public.profiles(id) on delete set null,
  changed_at       timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint team_attendance_mark_history_phase_chk check (phase in ('draft', 'reopened', 'correction')),
  constraint team_attendance_mark_history_reason_len check (reason is null or length(reason) <= 500)
);
create index if not exists idx_team_attendance_mark_history_org on public.team_attendance_mark_history(org_id);
create index if not exists idx_team_attendance_mark_history_mark on public.team_attendance_mark_history(mark_id, changed_at desc);

-- ---- Idempotency keys of attendance writes ------------------------------------------
create table if not exists public.team_attendance_requests (
  request_id  uuid primary key,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  sheet_id    uuid references public.team_attendance_sheets(id) on delete cascade,
  kind        text not null,
  actor_id    uuid references public.profiles(id) on delete set null,
  result      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_team_attendance_requests_org on public.team_attendance_requests(org_id, created_at);

-- ---- Absence reports (guardian / player, before the event) ---------------------------
create table if not exists public.team_absence_reports (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  event_id           uuid not null references public.events(id) on delete cascade,
  athlete_id         uuid not null references public.athletes(id) on delete cascade,
  reported_by        uuid references public.profiles(id) on delete set null,
  reporter_kind      text not null,
  reason             text,
  reason_category    text not null default 'other',
  status             text not null default 'reported',
  needs_review       boolean not null default false,
  event_starts_at    timestamptz not null,
  acknowledged_by    uuid references public.profiles(id) on delete set null,
  acknowledged_at    timestamptz,
  withdrawn_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint team_absence_reports_status_chk check (status in ('reported', 'acknowledged', 'superseded', 'withdrawn')),
  constraint team_absence_reports_kind_chk check (reporter_kind in ('guardian', 'player')),
  constraint team_absence_reports_category_chk check (reason_category in ('illness', 'injury', 'school', 'family', 'travel', 'other')),
  constraint team_absence_reports_reason_len check (reason is null or length(reason) <= 500)
);
create index if not exists idx_team_absence_reports_org on public.team_absence_reports(org_id, created_at desc);
create index if not exists idx_team_absence_reports_event on public.team_absence_reports(event_id, athlete_id);
create unique index if not exists team_absence_reports_active_uidx
  on public.team_absence_reports(event_id, athlete_id) where status in ('reported', 'acknowledged');

-- ---- No-show alerts (to guardians) ---------------------------------------------------------
create table if not exists public.attendance_no_show_alerts (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  event_id             uuid not null references public.events(id) on delete cascade,
  athlete_id           uuid not null references public.athletes(id) on delete cascade,
  mark_id              uuid references public.team_attendance_marks(id) on delete set null,
  history_id           uuid references public.team_attendance_mark_history(id) on delete set null,
  guardian_profile_id  uuid references public.profiles(id) on delete cascade,
  kind                 text not null default 'initial',
  mark_status          text not null,
  status               text not null default 'pending',
  channel_results      jsonb not null default '{}'::jsonb,
  attempts             integer not null default 0,
  last_error           text,
  notification_id      uuid references public.notifications(id) on delete set null,
  claimed_at           timestamptz,
  next_attempt_at      timestamptz,
  sent_at              timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint attendance_no_show_alerts_kind_chk check (kind in ('initial', 'correction')),
  constraint attendance_no_show_alerts_status_chk check (status in ('pending', 'sent', 'failed', 'no_contact', 'suppressed', 'superseded')),
  constraint attendance_no_show_alerts_mark_status_chk check (mark_status in ('present', 'late', 'excused', 'unexcused')),
  constraint attendance_no_show_alerts_channels_chk check (jsonb_typeof(channel_results) = 'object'),
  constraint attendance_no_show_alerts_error_len check (last_error is null or length(last_error) <= 500)
);
create index if not exists idx_attendance_no_show_alerts_org on public.attendance_no_show_alerts(org_id, status, created_at desc);
create index if not exists idx_attendance_no_show_alerts_event on public.attendance_no_show_alerts(event_id, athlete_id, created_at desc);
create index if not exists idx_attendance_no_show_alerts_guardian on public.attendance_no_show_alerts(guardian_profile_id, created_at desc);
create index if not exists idx_attendance_no_show_alerts_due on public.attendance_no_show_alerts(next_attempt_at)
  where status in ('pending', 'failed');
-- At most ONE initial alert per (event, athlete, guardian); a missing
-- guardian (no_contact) counts as one recipient.
create unique index if not exists attendance_no_show_alerts_initial_uidx
  on public.attendance_no_show_alerts(event_id, athlete_id, coalesce(guardian_profile_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where kind = 'initial';
-- One correction alert per guardian per correction (history row).
create unique index if not exists attendance_no_show_alerts_correction_uidx
  on public.attendance_no_show_alerts(history_id, coalesce(guardian_profile_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where kind = 'correction';

-- ---- Correction requests (guardian -> staff) ----------------------------------------------
create table if not exists public.attendance_correction_requests (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  event_id          uuid not null references public.events(id) on delete cascade,
  team_id           uuid not null references public.teams(id) on delete cascade,
  athlete_id        uuid not null references public.athletes(id) on delete cascade,
  mark_id           uuid not null references public.team_attendance_marks(id) on delete cascade,
  requested_by      uuid references public.profiles(id) on delete set null,
  current_status    text not null,
  requested_status  text,
  message           text not null,
  status            text not null default 'open',
  resolved_by       uuid references public.profiles(id) on delete set null,
  resolved_at       timestamptz,
  resolution_note   text,
  history_id        uuid references public.team_attendance_mark_history(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint attendance_correction_requests_status_chk check (status in ('open', 'accepted', 'rejected', 'withdrawn')),
  constraint attendance_correction_requests_req_chk check (requested_status is null or requested_status in ('present', 'late', 'excused', 'unexcused')),
  constraint attendance_correction_requests_text_len check (length(btrim(message)) between 1 and 1000 and coalesce(length(resolution_note), 0) <= 1000)
);
create index if not exists idx_attendance_correction_requests_org on public.attendance_correction_requests(org_id, status, created_at desc);
create index if not exists idx_attendance_correction_requests_team on public.attendance_correction_requests(team_id, status);
create index if not exists idx_attendance_correction_requests_athlete on public.attendance_correction_requests(athlete_id);
create unique index if not exists attendance_correction_requests_open_uidx
  on public.attendance_correction_requests(mark_id) where status = 'open';

-- ---- updated_at, same-org guards, audit -------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['event_coach_assignments', 'team_attendance_sheets', 'team_attendance_marks',
                           'team_attendance_mark_history', 'team_attendance_requests', 'team_absence_reports',
                           'attendance_no_show_alerts', 'attendance_correction_requests'] loop
    execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_updated', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', 'trg_' || t || '_updated', t);
  end loop;
end $$;

drop trigger if exists trg_event_coach_assignments_org on public.event_coach_assignments;
create trigger trg_event_coach_assignments_org before insert or update on public.event_coach_assignments
  for each row execute function public.ca_same_org_guard('event_id:events', 'coach_id:coaches');
drop trigger if exists trg_team_attendance_sheets_org on public.team_attendance_sheets;
create trigger trg_team_attendance_sheets_org before insert or update on public.team_attendance_sheets
  for each row execute function public.ca_same_org_guard('event_id:events', 'team_id:teams', 'led_by_coach_id:coaches', 'legacy_attendance_session_id:attendance_sessions');
drop trigger if exists trg_team_attendance_marks_org on public.team_attendance_marks;
create trigger trg_team_attendance_marks_org before insert or update on public.team_attendance_marks
  for each row execute function public.ca_same_org_guard('sheet_id:team_attendance_sheets', 'event_id:events', 'athlete_id:athletes', 'membership_id:team_memberships');
drop trigger if exists trg_team_attendance_mark_history_org on public.team_attendance_mark_history;
create trigger trg_team_attendance_mark_history_org before insert or update on public.team_attendance_mark_history
  for each row execute function public.ca_same_org_guard('sheet_id:team_attendance_sheets', 'event_id:events', 'athlete_id:athletes');
drop trigger if exists trg_team_absence_reports_org on public.team_absence_reports;
create trigger trg_team_absence_reports_org before insert or update on public.team_absence_reports
  for each row execute function public.ca_same_org_guard('event_id:events', 'athlete_id:athletes');
drop trigger if exists trg_attendance_no_show_alerts_org on public.attendance_no_show_alerts;
create trigger trg_attendance_no_show_alerts_org before insert or update on public.attendance_no_show_alerts
  for each row execute function public.ca_same_org_guard('event_id:events', 'athlete_id:athletes', 'mark_id:team_attendance_marks');
drop trigger if exists trg_attendance_correction_requests_org on public.attendance_correction_requests;
create trigger trg_attendance_correction_requests_org before insert or update on public.attendance_correction_requests
  for each row execute function public.ca_same_org_guard('event_id:events', 'team_id:teams', 'athlete_id:athletes', 'mark_id:team_attendance_marks');

-- Personal data of minors: audited; free text (may hold health details) redacted.
drop trigger if exists trg_audit_team_attendance_marks on public.team_attendance_marks;
create trigger trg_audit_team_attendance_marks after insert or update or delete on public.team_attendance_marks
  for each row execute function public.ca_audit_trigger('note');
drop trigger if exists trg_audit_team_attendance_sheets on public.team_attendance_sheets;
create trigger trg_audit_team_attendance_sheets after insert or update or delete on public.team_attendance_sheets
  for each row execute function public.ca_audit_trigger('reopen_reason');
drop trigger if exists trg_audit_team_absence_reports on public.team_absence_reports;
create trigger trg_audit_team_absence_reports after insert or update or delete on public.team_absence_reports
  for each row execute function public.ca_audit_trigger('reason');
drop trigger if exists trg_audit_attendance_correction_requests on public.attendance_correction_requests;
create trigger trg_audit_attendance_correction_requests after insert or update or delete on public.attendance_correction_requests
  for each row execute function public.ca_audit_trigger('message', 'resolution_note');
drop trigger if exists trg_audit_event_coach_assignments on public.event_coach_assignments;
create trigger trg_audit_event_coach_assignments after insert or update or delete on public.event_coach_assignments
  for each row execute function public.ca_audit_trigger('request_note', 'decision_note');
drop trigger if exists trg_audit_attendance_no_show_alerts on public.attendance_no_show_alerts;
create trigger trg_audit_attendance_no_show_alerts after insert or update or delete on public.attendance_no_show_alerts
  for each row execute function public.ca_audit_trigger('last_error');

-- team_attendance_mark_history is itself the audit trail of mark changes.

-- ===========================================================================
-- 3. Access helpers (SECURITY DEFINER: no recursive RLS)
-- ===========================================================================

-- The athlete a signed-in player account is linked to (in the current club).
create or replace function public.current_player_athlete_id()
returns uuid language sql stable security definer set search_path = public as $$
  select a.id from public.athletes a
   where a.player_profile_id = auth.uid() and a.org_id = public.current_org_id() and a.archived_at is null
   limit 1;
$$;

create or replace function public.is_player()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.current_player_athlete_id() is not null;
$$;

create or replace function public.is_player_of_athlete(p_athlete uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_athlete is not null and p_athlete = public.current_player_athlete_id();
$$;

-- Was / is the player's athlete on this team (any period)?
create or replace function public.player_on_team(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_team is not null and public.current_player_athlete_id() is not null and (
    exists (select 1 from public.team_memberships tm
             where tm.team_id = p_team and tm.athlete_id = public.current_player_athlete_id())
    or exists (select 1 from public.team_membership_periods p
                where p.team_id = p_team and p.athlete_id = public.current_player_athlete_id()));
$$;

-- Roster of a team on a date (internal, no caller check): the current row
-- when its [joined_on, left_on] covers the date, else an archived period.
-- A row that is 'inactive' without an end date counts as off the roster.
create or replace function public.ta_roster_on(p_team uuid, p_on date)
returns table (athlete_id uuid, membership_id uuid, jersey_number smallint, player_position text,
               membership_status text, joined_on date, left_on date, source text)
language sql stable security definer set search_path = public as $$
  select distinct on (x.athlete_id)
         x.athlete_id, x.membership_id, x.jersey_number, x.player_position, x.membership_status,
         x.joined_on, x.left_on, x.source
    from (
      select tm.athlete_id, tm.id as membership_id, tm.jersey_number, tm.position as player_position,
             tm.status::text as membership_status, tm.joined_on, tm.left_on, 'current'::text as source, 0 as pri
        from public.team_memberships tm
       where tm.team_id = p_team and tm.joined_on <= p_on
         and (tm.left_on is null or tm.left_on >= p_on)
         and not (tm.status = 'inactive' and tm.left_on is null)
      union all
      select p.athlete_id, p.membership_id, p.jersey_number, p.position, 'ended', p.joined_on, p.left_on, 'history', 1
        from public.team_membership_periods p
       where p.team_id = p_team and p.joined_on <= p_on and p.left_on >= p_on
    ) x
    join public.athletes a on a.id = x.athlete_id
   where a.archived_at is null or (a.archived_at at time zone public.ta_tz(a.org_id))::date > p_on
   order by x.athlete_id, x.pri;
$$;

-- Player sees an event of a team they were on that day, or a future event
-- of a team they are on now; club-wide events (no team) too.
create or replace function public.player_sees_event(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.events e
     where e.id = p_event and e.org_id = public.current_org_id() and public.current_player_athlete_id() is not null
       and (e.team_id is null
            or exists (select 1 from public.ta_roster_on(e.team_id, (e.starts_at at time zone public.ta_tz(e.org_id))::date) r
                        where r.athlete_id = public.current_player_athlete_id())
            or (e.starts_at >= now() and exists (
                  select 1 from public.ta_roster_on(e.team_id, public.ta_today(e.org_id)) r
                   where r.athlete_id = public.current_player_athlete_id()))));
$$;

-- Can the caller (a coach) run this session? Team coaches of the event's team
-- always; a coach with an APPROVED session assignment for this event only,
-- until the grace window after the sheet was finalized has passed.
create or replace function public.coach_can_run_event(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.events e
     where e.id = p_event and e.org_id = public.current_org_id()
       and public.current_coach_id() is not null
       and ((e.team_id is not null and public.coach_coaches_team(e.team_id))
            or exists (
              select 1 from public.event_coach_assignments a
               where a.event_id = e.id and a.coach_id = public.current_coach_id() and a.status = 'approved'
                 and not exists (select 1 from public.team_attendance_sheets s
                                  where s.event_id = e.id and s.status = 'final'
                                    and s.finalized_at < now() - make_interval(days => public.ta_grace_days())))));
$$;

-- Admin of the org or a coach who can run the session.
create or replace function public.ta_can_run(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.events e where e.id = p_event and e.org_id = public.current_org_id() and public.is_admin())
      or public.coach_can_run_event(p_event);
$$;

-- Guardians of an athlete reachable for attendance notices: members of the
-- athlete's family whose login is active and not suspended in the club.
create or replace function public.ta_alert_recipients(p_athlete uuid)
returns table (profile_id uuid)
language sql stable security definer set search_path = public as $$
  select fm.profile_id
    from public.athletes a
    join public.family_members fm on fm.family_id = a.family_id
    join public.profiles pf on pf.id = fm.profile_id and pf.is_active
   where a.id = p_athlete
     and not exists (select 1 from public.org_memberships om
                      where om.profile_id = fm.profile_id and om.org_id = a.org_id and om.status <> 'active')
   order by fm.is_primary desc, fm.created_at;
$$;

-- ===========================================================================
-- 4. Roster RPCs (effective-dated; every change audited)
-- ===========================================================================
create or replace function public.team_roster_on(p_team uuid, p_on date default null)
returns table (athlete_id uuid, membership_id uuid, first_name text, last_name text, jersey_number smallint,
               player_position text, membership_status text, joined_on date, left_on date, source text)
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid;
begin
  select t.org_id into v_org from public.teams t where t.id = p_team;
  if v_org is null or v_org is distinct from public.current_org_id() then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (public.is_finance() or public.coach_coaches_team(p_team)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  return query
    select r.athlete_id, r.membership_id, a.first_name, a.last_name, r.jersey_number, r.player_position,
           r.membership_status, r.joined_on, r.left_on, r.source
      from public.ta_roster_on(p_team, coalesce(p_on, public.ta_today(v_org))) r
      join public.athletes a on a.id = r.athlete_id
     order by a.last_name, a.first_name;
end;
$$;

-- Roster history of a team (current rows + archived periods), staff of the team.
create or replace function public.team_roster_history(p_team uuid)
returns table (athlete_id uuid, membership_id uuid, first_name text, last_name text, joined_on date, left_on date,
               membership_status text, end_reason text, source text)
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid;
begin
  select t.org_id into v_org from public.teams t where t.id = p_team;
  if v_org is null or v_org is distinct from public.current_org_id() then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (public.is_finance() or public.coach_coaches_team(p_team)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  return query
    select x.athlete_id, x.membership_id, a.first_name, a.last_name, x.joined_on, x.left_on, x.st, x.reason, x.src
      from (
        select tm.athlete_id, tm.id as membership_id, tm.joined_on, tm.left_on, tm.status::text as st, tm.end_reason as reason, 'current'::text as src
          from public.team_memberships tm where tm.team_id = p_team
        union all
        select p.athlete_id, p.membership_id, p.joined_on, p.left_on, 'ended', p.reason, 'history'
          from public.team_membership_periods p where p.team_id = p_team
      ) x
      join public.athletes a on a.id = x.athlete_id
     order by a.last_name, a.first_name, x.joined_on;
end;
$$;

-- Internal: add (or restart) a membership from p_on. No caller check.
create or replace function public.ta_member_add(p_team uuid, p_athlete uuid, p_on date, p_jersey integer,
                                                p_position text, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  m     public.team_memberships%rowtype;
  v_id  uuid;
begin
  select org_id into v_org from public.teams where id = p_team;
  if p_jersey is not null and (p_jersey < 0 or p_jersey > 999) then
    raise exception 'INVALID_JERSEY' using errcode = 'P0001';
  end if;
  select * into m from public.team_memberships where team_id = p_team and athlete_id = p_athlete for update;
  begin
    if found then
      if m.left_on is null or m.left_on >= p_on then
        raise exception 'ALREADY_ON_TEAM' using errcode = 'P0001';
      end if;
      -- Restart after the end: the trigger archives the closed period.
      update public.team_memberships
         set joined_on = p_on, left_on = null, status = 'active',
             jersey_number = coalesce(p_jersey::smallint, jersey_number),
             position = coalesce(left(nullif(btrim(p_position), ''), 60), position),
             dates_source = 'recorded'
       where id = m.id
      returning id into v_id;
    else
      insert into public.team_memberships (org_id, team_id, athlete_id, jersey_number, position, status, joined_on, dates_source)
      values (v_org, p_team, p_athlete, p_jersey::smallint, left(nullif(btrim(p_position), ''), 60), 'active', p_on, 'recorded')
      returning id into v_id;
    end if;
  exception when unique_violation then
    raise exception 'JERSEY_TAKEN' using errcode = 'P0001';
  end;
  perform public.ca_audit(v_org, 'roster.add', 'team_memberships', v_id,
    jsonb_build_object('team_id', p_team, 'athlete_id', p_athlete, 'effective_on', p_on, 'reason', left(p_reason, 500)));
  return v_id;
end;
$$;

-- Internal: the athlete is off the team FROM p_on (left_on = p_on - 1).
-- Returns the membership id, or null when a never-effective row was removed.
create or replace function public.ta_member_leave(p_team uuid, p_athlete uuid, p_on date, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  m     public.team_memberships%rowtype;
begin
  select org_id into v_org from public.teams where id = p_team;
  select * into m from public.team_memberships where team_id = p_team and athlete_id = p_athlete for update;
  if not found or (m.left_on is not null and m.left_on < p_on)
     or (m.status = 'inactive' and m.left_on is null) then
    raise exception 'NOT_ON_TEAM' using errcode = 'P0001';
  end if;
  if p_on <= m.joined_on then
    -- Never effective before p_on: nothing to keep unless attendance uses it.
    if public.ta_membership_has_attendance(p_team, p_athlete) then
      raise exception 'INVALID_EFFECTIVE_DATE' using errcode = 'P0001';
    end if;
    delete from public.team_memberships where id = m.id;
    perform public.ca_audit(v_org, 'roster.leave', 'team_memberships', m.id,
      jsonb_build_object('team_id', p_team, 'athlete_id', p_athlete, 'effective_on', p_on, 'removed', true, 'reason', left(p_reason, 500)));
    return null;
  end if;
  update public.team_memberships
     set left_on = p_on - 1, end_reason = left(p_reason, 500), ended_by = auth.uid(),
         status = case when p_on - 1 < public.ta_today(v_org) then 'inactive'::public.team_membership_status else status end
   where id = m.id;
  perform public.ca_audit(v_org, 'roster.leave', 'team_memberships', m.id,
    jsonb_build_object('team_id', p_team, 'athlete_id', p_athlete, 'effective_on', p_on, 'reason', left(p_reason, 500)));
  return m.id;
end;
$$;

create or replace function public.ta_roster_write_check(p_team uuid, p_athlete uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from public.teams where id = p_team;
  if v_org is null or v_org is distinct from public.current_org_id() then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (public.is_admin() or public.coach_coaches_team(p_team)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if public.ta_is_selection_team(p_team) then
    raise exception 'SELECTION_ROSTER_MANAGED' using errcode = 'P0001';
  end if;
  if p_athlete is not null and not exists (select 1 from public.athletes where id = p_athlete and org_id = v_org and archived_at is null) then
    raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.team_member_add(p_team uuid, p_athlete uuid, p_effective_on date default null,
                                                  p_jersey integer default null, p_position text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_on date; v_id uuid;
begin
  perform public.ta_roster_write_check(p_team, p_athlete);
  v_on := coalesce(p_effective_on, public.ta_today(public.current_org_id()));
  v_id := public.ta_member_add(p_team, p_athlete, v_on, p_jersey, p_position, null);
  return jsonb_build_object('membership_id', v_id, 'team_id', p_team, 'athlete_id', p_athlete, 'effective_on', v_on);
end;
$$;

create or replace function public.team_member_leave(p_team uuid, p_athlete uuid, p_effective_on date, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_on date; v_id uuid;
begin
  perform public.ta_roster_write_check(p_team, p_athlete);
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  v_on := coalesce(p_effective_on, public.ta_today(public.current_org_id()));
  v_id := public.ta_member_leave(p_team, p_athlete, v_on, btrim(p_reason));
  return jsonb_build_object('membership_id', v_id, 'removed', v_id is null, 'team_id', p_team, 'athlete_id', p_athlete,
                            'effective_on', v_on, 'left_on', v_on - 1);
end;
$$;

-- Transfer: the old membership ends the day before p_effective_on, the new
-- one starts on it; jersey / position carry over when free. History kept.
create or replace function public.team_member_transfer(p_from_team uuid, p_to_team uuid, p_athlete uuid,
                                                       p_effective_on date, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_on   date;
  v_old  public.team_memberships%rowtype;
  v_from uuid;
  v_to   uuid;
  v_jersey integer;
begin
  if p_from_team = p_to_team then raise exception 'SAME_TEAM' using errcode = 'P0001'; end if;
  perform public.ta_roster_write_check(p_from_team, p_athlete);
  perform public.ta_roster_write_check(p_to_team, p_athlete);
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  v_on := coalesce(p_effective_on, public.ta_today(public.current_org_id()));
  select * into v_old from public.team_memberships where team_id = p_from_team and athlete_id = p_athlete;
  v_jersey := v_old.jersey_number;
  if v_jersey is not null and exists (select 1 from public.team_memberships x where x.team_id = p_to_team
                                        and x.jersey_number = v_jersey and x.status <> 'inactive' and x.athlete_id <> p_athlete) then
    v_jersey := null;
  end if;
  v_from := public.ta_member_leave(p_from_team, p_athlete, v_on, 'transfer: ' || btrim(p_reason));
  v_to := public.ta_member_add(p_to_team, p_athlete, v_on, v_jersey, v_old.position, 'transfer: ' || btrim(p_reason));
  perform public.ca_audit(public.current_org_id(), 'roster.transfer', 'team_memberships', v_to,
    jsonb_build_object('athlete_id', p_athlete, 'from_team_id', p_from_team, 'to_team_id', p_to_team,
                       'from_membership_id', v_from, 'effective_on', v_on, 'reason', left(btrim(p_reason), 500)));
  return jsonb_build_object('from_membership_id', v_from, 'to_membership_id', v_to, 'athlete_id', p_athlete,
                            'from_team_id', p_from_team, 'to_team_id', p_to_team, 'effective_on', v_on);
end;
$$;

-- Cron: memberships whose (future-dated) end has passed become inactive.
create or replace function public.team_memberships_apply_due()
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  update public.team_memberships tm set status = 'inactive'
   where tm.status <> 'inactive' and tm.left_on is not null and tm.left_on < public.ta_today(tm.org_id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ===========================================================================
-- 5. Training window per season + attendance go-live per club
-- ===========================================================================
-- The training calendar differs from the billing season (seasons.starts_on /
-- ends_on). Both dates are data, set by the club admin; nullable = no window.
alter table public.seasons add column if not exists training_starts_on date;
alter table public.seasons add column if not exists training_ends_on date;
do $$ begin
  alter table public.seasons add constraint seasons_training_window_chk
    check (training_starts_on is null or training_ends_on is null or training_ends_on >= training_starts_on);
exception when duplicate_object then null; end $$;

-- First day whose sessions count for attendance tracking (awaiting lists,
-- unfinished-session flags). Null = no go-live set: every session counts.
alter table public.app_settings add column if not exists attendance_tracking_starts_on date;

-- Training window of the event's season (the event's own season, else its
-- team's). Returns nulls when there is no season or no window.
create or replace function public.ta_event_window(p_event uuid)
returns table (training_starts_on date, training_ends_on date)
language sql stable security definer set search_path = public as $$
  select s.training_starts_on, s.training_ends_on
    from public.events e
    left join public.teams t on t.id = e.team_id
    join public.seasons s on s.id = coalesce(e.season_id, t.season_id)
   where e.id = p_event;
$$;

-- Is the (local) date of the event inside its season's training window?
-- No season or no window set: true (nothing to restrict).
create or replace function public.ta_in_training_window(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select (w.training_starts_on is null or public.ta_event_date(p_event) >= w.training_starts_on)
       and (w.training_ends_on is null or public.ta_event_date(p_event) <= w.training_ends_on)
      from public.ta_event_window(p_event) w), true);
$$;

-- Does the session count for attendance tracking? Inside the training window
-- (training sessions only — games / tournaments are not bound to it) and on
-- or after the club's attendance go-live date.
create or replace function public.ta_event_tracked(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.events e
      left join public.app_settings st on st.org_id = e.org_id
     where e.id = p_event
       and (st.attendance_tracking_starts_on is null or public.ta_event_date(e.id) >= st.attendance_tracking_starts_on)
       and (e.type <> 'training' or public.ta_in_training_window(e.id)));
$$;

-- Recurring trainings (series) are never created outside the season's
-- training window; one-off events are not restricted.
create or replace function public.events_training_window_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_start date; v_end date; v_day date;
begin
  if new.series_id is null or new.type <> 'training' then return new; end if;
  if tg_op = 'UPDATE' and new.starts_at is not distinct from old.starts_at and new.series_id is not distinct from old.series_id then
    return new;
  end if;
  select s.training_starts_on, s.training_ends_on into v_start, v_end
    from public.seasons s
   where s.id = coalesce(new.season_id, (select t.season_id from public.teams t where t.id = new.team_id));
  v_day := (new.starts_at at time zone public.ta_tz(new.org_id))::date;
  if (v_start is not null and v_day < v_start) or (v_end is not null and v_day > v_end) then
    raise exception 'TRAINING_OUTSIDE_SEASON_WINDOW' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_events_training_window on public.events;
create trigger trg_events_training_window before insert or update of starts_at, series_id, type, season_id, team_id on public.events
  for each row execute function public.events_training_window_guard();

-- Admin: set the go-live date (null clears it). Audited.
create or replace function public.attendance_settings_set(p_tracking_starts_on date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  insert into public.app_settings (org_id, attendance_tracking_starts_on) values (v_org, p_tracking_starts_on)
  on conflict (org_id) do update set attendance_tracking_starts_on = excluded.attendance_tracking_starts_on;
  perform public.ca_audit(v_org, 'attendance.settings', 'app_settings', null,
    jsonb_build_object('attendance_tracking_starts_on', p_tracking_starts_on));
  return jsonb_build_object('attendance_tracking_starts_on', p_tracking_starts_on);
end;
$$;

create or replace function public.attendance_settings()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('attendance_tracking_starts_on',
           (select st.attendance_tracking_starts_on from public.app_settings st where st.org_id = public.current_org_id()),
           'timezone', public.ta_tz(public.current_org_id()),
           'grace_days', public.ta_grace_days())
   where public.current_org_id() is not null and public.is_staff();
$$;

-- ===========================================================================
-- 6. Player accounts: invitations link a login to an athlete
-- ===========================================================================
create or replace function public.invitations_same_org_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.family_id is not null
     and not exists (select 1 from public.families where id = new.family_id and org_id = new.org_id) then
    raise exception 'INVITATION_FAMILY_OTHER_ORG' using errcode = '42501';
  end if;
  if new.coach_id is not null
     and not exists (select 1 from public.coaches where id = new.coach_id and org_id = new.org_id) then
    raise exception 'INVITATION_COACH_OTHER_ORG' using errcode = '42501';
  end if;
  if new.athlete_id is not null
     and not exists (select 1 from public.athletes where id = new.athlete_id and org_id = new.org_id) then
    raise exception 'INVITATION_ATHLETE_OTHER_ORG' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_invitations_same_org on public.invitations;
create trigger trg_invitations_same_org
  before insert or update of org_id, family_id, coach_id, athlete_id on public.invitations
  for each row execute function public.invitations_same_org_guard();

-- Internal: link a login to an athlete of the club as its player account.
-- Never takes over an athlete already linked to another login.
create or replace function public.ta_link_player(p_athlete uuid, p_profile uuid, p_org uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_athlete is null or p_profile is null then return false; end if;
  update public.athletes
     set player_profile_id = p_profile, player_linked_at = now()
   where id = p_athlete and org_id = p_org and archived_at is null
     and (player_profile_id is null or player_profile_id = p_profile);
  if not found then return false; end if;
  perform public.ensure_org_membership(p_profile, p_org, 'player');
  perform public.ca_audit(p_org, 'player.link', 'athletes', p_athlete, jsonb_build_object('profile_id', p_profile));
  return true;
end;
$$;

create or replace function public.consume_invitation(p_inv uuid, p_profile uuid)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  v_inv   public.invitations%rowtype;
  v_email citext;
begin
  select * into v_inv from public.invitations where id = p_inv for update;
  if not found or v_inv.status <> 'pending' or v_inv.expires_at <= now() then return false; end if;
  select email into v_email from public.profiles where id = p_profile;
  if v_email is null or v_email <> v_inv.email then return false; end if;

  perform public.ensure_org_membership(p_profile, v_inv.org_id, v_inv.role);
  -- 'parent' and 'player' are not staff roles (derived from family_members /
  -- athletes.player_profile_id).
  if v_inv.role::text not in ('parent', 'player') then
    insert into public.staff_roles (org_id, profile_id, role) values (v_inv.org_id, p_profile, v_inv.role)
    on conflict (org_id, profile_id, role) do nothing;
  end if;
  if v_inv.role::text = 'player' then
    perform public.ta_link_player(v_inv.athlete_id, p_profile, v_inv.org_id);
  end if;
  if v_inv.family_id is not null
     and exists (select 1 from public.families where id = v_inv.family_id and org_id = v_inv.org_id) then
    insert into public.family_members (family_id, profile_id, relation, is_primary)
    values (v_inv.family_id, p_profile, coalesce(v_inv.relation, 'guardian'),
            not exists (select 1 from public.family_members where family_id = v_inv.family_id))
    on conflict (family_id, profile_id) do nothing;
  end if;
  if v_inv.coach_id is not null then
    update public.coaches set profile_id = p_profile where id = v_inv.coach_id and org_id = v_inv.org_id;
  end if;
  update public.profiles set org_id = v_inv.org_id where id = p_profile and org_id is null;
  update public.invitations set status = 'accepted', accepted_at = now(), accepted_by = p_profile where id = p_inv;
  return true;
end $$;
revoke all on function public.consume_invitation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.consume_invitation(uuid, uuid) to service_role;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invitations%rowtype;
begin
  select * into v_inv
  from public.invitations
  where email = new.email
    and status = 'pending'
    and expires_at > now()
  order by created_at desc
  limit 1;

  insert into public.profiles (id, org_id, email, full_name, locale)
  values (
    new.id,
    v_inv.org_id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce(new.raw_user_meta_data->>'locale', 'en')
  )
  on conflict (id) do nothing;

  if v_inv.id is not null then
    if v_inv.role::text not in ('parent', 'player') then
      insert into public.staff_roles (org_id, profile_id, role)
      values (v_inv.org_id, new.id, v_inv.role)
      on conflict (org_id, profile_id, role) do nothing;
    end if;

    -- A player account: linked to its athlete (same club only).
    if v_inv.role::text = 'player' then
      perform public.ta_link_player(v_inv.athlete_id, new.id, v_inv.org_id);
    end if;

    if v_inv.family_id is not null
       and exists (select 1 from public.families where id = v_inv.family_id and org_id = v_inv.org_id) then
      insert into public.family_members (family_id, profile_id, relation, is_primary)
      values (
        v_inv.family_id,
        new.id,
        coalesce(v_inv.relation, 'guardian'),
        not exists (select 1 from public.family_members where family_id = v_inv.family_id)
      )
      on conflict (family_id, profile_id) do nothing;
    end if;

    if v_inv.coach_id is not null then
      update public.coaches set profile_id = new.id
       where id = v_inv.coach_id and org_id = v_inv.org_id;
    end if;

    update public.invitations
      set status = 'accepted', accepted_at = now(), accepted_by = new.id
      where id = v_inv.id;
  end if;

  return new;
end;
$$;

-- Admin: link an existing login of the club directly / unlink.
create or replace function public.athlete_player_link(p_athlete uuid, p_profile uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.athletes where id = p_athlete and org_id = v_org and archived_at is null) then
    raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.profiles pf where pf.id = p_profile
                  and (pf.org_id = v_org or exists (select 1 from public.org_memberships om
                                                     where om.profile_id = pf.id and om.org_id = v_org))) then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- A guardian of the athlete's family is never the player's own login.
  if exists (select 1 from public.athletes a join public.family_members fm on fm.family_id = a.family_id
              where a.id = p_athlete and fm.profile_id = p_profile) then
    raise exception 'PLAYER_IS_GUARDIAN' using errcode = 'P0001';
  end if;
  if not public.ta_link_player(p_athlete, p_profile, v_org) then
    raise exception 'PLAYER_ALREADY_LINKED' using errcode = 'P0001';
  end if;
  return jsonb_build_object('athlete_id', p_athlete, 'profile_id', p_profile);
end;
$$;

create or replace function public.athlete_player_unlink(p_athlete uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.current_org_id(); v_prev uuid;
begin
  if v_org is null or not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select player_profile_id into v_prev from public.athletes where id = p_athlete and org_id = v_org;
  if not found then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
  update public.athletes set player_profile_id = null, player_linked_at = null where id = p_athlete and org_id = v_org;
  perform public.ca_audit(v_org, 'player.unlink', 'athletes', p_athlete, jsonb_build_object('profile_id', v_prev));
  return jsonb_build_object('athlete_id', p_athlete, 'unlinked', v_prev is not null);
end;
$$;

-- The player's own record: limited columns (no guardian contacts, medical,
-- staff notes, money).
create or replace function public.player_me()
returns table (athlete_id uuid, first_name text, last_name text, dob date, photo_path text,
               teams jsonb)
language sql stable security definer set search_path = public as $$
  select a.id, a.first_name, a.last_name, a.dob, a.photo_path,
         coalesce((select jsonb_agg(jsonb_build_object('team_id', t.id, 'name', t.name, 'season_id', t.season_id,
                                                      'jersey_number', r.jersey_number, 'position', r.player_position)
                                    order by t.name)
                     from public.teams t
                     join public.ta_roster_on(t.id, public.ta_today(a.org_id)) r on r.athlete_id = a.id
                    where t.org_id = a.org_id), '[]'::jsonb)
    from public.athletes a
   where a.id = public.current_player_athlete_id();
$$;

-- RLS: a player reads their teams and their teams' events (see player_sees_event).
drop policy if exists teams_player_select on public.teams;
create policy teams_player_select on public.teams for select
  using (org_id = public.current_org_id() and public.player_on_team(id));
drop policy if exists events_player_select on public.events;
create policy events_player_select on public.events for select
  using (org_id = public.current_org_id() and public.is_player() and public.player_sees_event(id));

-- ===========================================================================
-- 7. Session-level coach access
-- ===========================================================================
create or replace function public.session_assign_coach(p_event uuid, p_coach uuid, p_role text default 'substitute')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ev public.events%rowtype; v_id uuid;
begin
  select * into v_ev from public.events where id = p_event;
  if not found or v_ev.org_id is distinct from public.current_org_id() then raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if coalesce(p_role, '') not in ('substitute', 'lead') then raise exception 'INVALID_ROLE' using errcode = 'P0001'; end if;
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

create or replace function public.session_request_access(p_event uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ev public.events%rowtype; v_coach uuid := public.current_coach_id(); r public.event_coach_assignments%rowtype;
begin
  select * into v_ev from public.events where id = p_event;
  if not found or v_ev.org_id is distinct from public.current_org_id() then raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_coach is null or not public.has_role('coach') then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if v_ev.status = 'cancelled' then raise exception 'EVENT_CANCELLED' using errcode = 'P0001'; end if;
  if v_ev.team_id is not null and public.coach_coaches_team(v_ev.team_id) then
    raise exception 'ALREADY_TEAM_COACH' using errcode = 'P0001';
  end if;
  if length(coalesce(p_note, '')) > 500 then raise exception 'NOTE_TOO_LONG' using errcode = 'P0001'; end if;
  insert into public.event_coach_assignments (org_id, event_id, coach_id, role, status, request_note, requested_by)
  values (v_ev.org_id, p_event, v_coach, 'substitute', 'pending', nullif(btrim(p_note), ''), auth.uid())
  on conflict (event_id, coach_id) do update
    set status = 'pending', request_note = excluded.request_note, requested_by = excluded.requested_by,
        decided_by = null, decided_at = null, decision_note = null
    where public.event_coach_assignments.status = 'rejected';
  select * into r from public.event_coach_assignments where event_id = p_event and coach_id = v_coach;
  return jsonb_build_object('assignment_id', r.id, 'status', r.status, 'event_id', p_event, 'coach_id', v_coach);
end;
$$;

create or replace function public.session_decide_access(p_assignment uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.event_coach_assignments%rowtype; v_profile uuid;
begin
  select * into r from public.event_coach_assignments where id = p_assignment for update;
  if not found or r.org_id is distinct from public.current_org_id() then raise exception 'ASSIGNMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if length(coalesce(p_note, '')) > 500 then raise exception 'NOTE_TOO_LONG' using errcode = 'P0001'; end if;
  if r.status = 'rejected' and not p_approve then
    return jsonb_build_object('assignment_id', r.id, 'status', r.status, 'changed', false);
  end if;
  update public.event_coach_assignments
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), '')
   where id = r.id;
  select profile_id into v_profile from public.coaches where id = r.coach_id;
  return jsonb_build_object('assignment_id', r.id, 'status', case when p_approve then 'approved' else 'rejected' end,
                            'changed', true, 'event_id', r.event_id, 'coach_id', r.coach_id, 'coach_profile_id', v_profile,
                            'requested_by', r.requested_by);
end;
$$;

-- ===========================================================================
-- 8. Attendance core
-- ===========================================================================
create or replace function public.ta_valid_status(p_status text, p_allow_unmarked boolean)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_status in ('present', 'late', 'excused', 'unexcused') or (p_allow_unmarked and p_status = 'unmarked'), false);
$$;

-- Active (reported / acknowledged) absence report of an athlete for an event.
create or replace function public.ta_active_report(p_event uuid, p_athlete uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select r.id from public.team_absence_reports r
   where r.event_id = p_event and r.athlete_id = p_athlete and r.status in ('reported', 'acknowledged')
   limit 1;
$$;

-- Load the event of a sheet operation with the common checks.
create or replace function public.ta_event_for_write(p_event uuid)
returns public.events language plpgsql stable security definer set search_path = public as $$
declare v_ev public.events%rowtype;
begin
  select * into v_ev from public.events where id = p_event;
  if not found or v_ev.org_id is distinct from public.current_org_id() then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.ta_can_run(p_event) then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if v_ev.team_id is null then raise exception 'EVENT_HAS_NO_TEAM' using errcode = 'P0001'; end if;
  if not (v_ev.type::text = any(public.ta_sheet_types())) then
    raise exception 'EVENT_TYPE_NOT_SUPPORTED' using errcode = 'P0001';
  end if;
  return v_ev;
end;
$$;

-- Idempotency: the stored result of a request id, or null. Raises when the id
-- was used by another actor / org / kind.
create or replace function public.ta_replay(p_request uuid, p_kind text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.team_attendance_requests%rowtype;
begin
  if p_request is null then return null; end if;
  select * into r from public.team_attendance_requests where request_id = p_request;
  if not found then return null; end if;
  if r.org_id is distinct from public.current_org_id() or r.actor_id is distinct from auth.uid() or r.kind <> p_kind then
    raise exception 'REQUEST_ID_REUSED' using errcode = 'P0001';
  end if;
  return r.result || jsonb_build_object('replayed', true);
end;
$$;

create or replace function public.ta_remember(p_request uuid, p_kind text, p_sheet uuid, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_request is not null then
    insert into public.team_attendance_requests (request_id, org_id, sheet_id, kind, actor_id, result)
    values (p_request, public.current_org_id(), p_sheet, p_kind, auth.uid(), p_result)
    on conflict (request_id) do nothing;
  end if;
  return p_result || jsonb_build_object('replayed', false);
end;
$$;

-- Bring a DRAFT sheet's roster rows in line with the roster of its date:
-- missing roster players are added (unmarked); untouched (rev 0, unmarked)
-- roster rows of players no longer on the roster are removed. Guests stay.
create or replace function public.ta_sheet_sync(p_sheet uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.team_attendance_sheets%rowtype;
begin
  select * into s from public.team_attendance_sheets where id = p_sheet;
  if s.status <> 'draft' then return; end if;
  insert into public.team_attendance_marks (org_id, sheet_id, event_id, athlete_id, membership_id, is_guest, status, added_by)
  select s.org_id, s.id, s.event_id, r.athlete_id, r.membership_id, false, 'unmarked', auth.uid()
    from public.ta_roster_on(s.team_id, s.roster_date) r
  on conflict (sheet_id, athlete_id) do nothing;
  delete from public.team_attendance_marks m
   where m.sheet_id = s.id and not m.is_guest and m.status = 'unmarked' and m.rev = 0
     and not exists (select 1 from public.ta_roster_on(s.team_id, s.roster_date) r where r.athlete_id = m.athlete_id);
end;
$$;

-- The sheet as the UIs read it (roster + guests + reports + marks). Minimal
-- athlete data only: name, jersey, position, photo with media consent.
create or replace function public.ta_sheet_json(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ev    public.events%rowtype;
  s       public.team_attendance_sheets%rowtype;
  v_team  text;
  v_tz    text;
  v_marks jsonb;
  v_admin boolean := public.is_admin();
  v_tc    boolean;
  v_sub   boolean;
begin
  select * into v_ev from public.events where id = p_event;
  select name into v_team from public.teams where id = v_ev.team_id;
  v_tz := public.ta_tz(v_ev.org_id);
  v_tc := v_ev.team_id is not null and public.coach_coaches_team(v_ev.team_id);
  v_sub := not v_tc and public.coach_can_run_event(p_event);
  select * into s from public.team_attendance_sheets where event_id = p_event;

  if s.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'mark_id', m.id, 'athlete_id', m.athlete_id, 'first_name', a.first_name, 'last_name', a.last_name,
             'jersey_number', coalesce(tm.jersey_number, pp.jersey_number), 'position', coalesce(tm.position, pp.position),
             'photo_path', case when public.athlete_has_media_consent(a.org_id, a.id) then a.photo_path end,
             'is_guest', m.is_guest, 'status', m.status, 'finalized_status', m.finalized_status, 'rev', m.rev,
             'note', m.note, 'updated_by', m.updated_by, 'updated_by_name', up.full_name, 'updated_at', m.updated_at,
             'reported_absence_ack', m.reported_absence_ack,
             'reported_absence', (select jsonb_build_object('report_id', r.id, 'reason', r.reason, 'reason_category', r.reason_category,
                                                            'status', r.status, 'needs_review', r.needs_review,
                                                            'reporter_kind', r.reporter_kind, 'created_at', r.created_at)
                                    from public.team_absence_reports r
                                   where r.event_id = p_event and r.athlete_id = m.athlete_id and r.status in ('reported', 'acknowledged')
                                   limit 1))
             order by m.is_guest, a.last_name, a.first_name), '[]'::jsonb)
      into v_marks
      from public.team_attendance_marks m
      join public.athletes a on a.id = m.athlete_id
      left join public.team_memberships tm on tm.id = m.membership_id and tm.team_id = s.team_id
      left join lateral (select p.jersey_number, p.position from public.team_membership_periods p
                          where p.team_id = s.team_id and p.athlete_id = m.athlete_id
                            and s.roster_date between p.joined_on and p.left_on limit 1) pp on tm.id is null
      left join public.profiles up on up.id = m.updated_by
     where m.sheet_id = s.id;
  else
    -- No sheet yet: preview of the roster of the event date (not saved).
    select coalesce(jsonb_agg(jsonb_build_object(
             'mark_id', null, 'athlete_id', r.athlete_id, 'first_name', a.first_name, 'last_name', a.last_name,
             'jersey_number', r.jersey_number, 'position', r.player_position,
             'photo_path', case when public.athlete_has_media_consent(a.org_id, a.id) then a.photo_path end,
             'is_guest', false, 'status', 'unmarked', 'finalized_status', null, 'rev', 0, 'note', null,
             'updated_by', null, 'updated_by_name', null, 'updated_at', null, 'reported_absence_ack', false,
             'reported_absence', (select jsonb_build_object('report_id', x.id, 'reason', x.reason, 'reason_category', x.reason_category,
                                                            'status', x.status, 'needs_review', x.needs_review,
                                                            'reporter_kind', x.reporter_kind, 'created_at', x.created_at)
                                    from public.team_absence_reports x
                                   where x.event_id = p_event and x.athlete_id = r.athlete_id and x.status in ('reported', 'acknowledged')
                                   limit 1))
             order by a.last_name, a.first_name), '[]'::jsonb)
      into v_marks
      from public.ta_roster_on(v_ev.team_id, (v_ev.starts_at at time zone v_tz)::date) r
      join public.athletes a on a.id = r.athlete_id;
  end if;

  return jsonb_build_object(
    'event', jsonb_build_object('id', v_ev.id, 'team_id', v_ev.team_id, 'team_name', v_team, 'type', v_ev.type,
                                'title', v_ev.title, 'starts_at', v_ev.starts_at, 'ends_at', v_ev.ends_at,
                                'status', v_ev.status, 'cancel_reason', v_ev.cancel_reason, 'timezone', v_tz,
                                'local_date', (v_ev.starts_at at time zone v_tz)::date,
                                'ended', v_ev.ends_at < now(), 'tracked', public.ta_event_tracked(v_ev.id),
                                'location_name', coalesce((select name from public.venues where id = v_ev.venue_id), v_ev.location_name, v_ev.location_text)),
    'sheet', case when s.id is null then null else jsonb_build_object(
                'id', s.id, 'status', s.status, 'version', s.version, 'roster_date', s.roster_date,
                'led_by_coach_id', s.led_by_coach_id,
                'led_by_name', (select display_name from public.coaches where id = s.led_by_coach_id),
                'finalized_at', s.finalized_at, 'finalized_by', s.finalized_by, 'first_finalized_at', s.first_finalized_at,
                'reopened_at', s.reopened_at, 'finalize_count', s.finalize_count, 'correction_count', s.correction_count) end,
    'access', jsonb_build_object('is_admin', v_admin, 'is_team_coach', v_tc, 'is_substitute', v_sub,
                                 'can_edit', v_ev.status <> 'cancelled' and coalesce(s.status, 'draft') in ('draft', 'reopened'),
                                 'can_correct', s.status = 'final',
                                 'can_resolve_requests', v_admin or v_tc),
    'marks', v_marks,
    'counts', jsonb_build_object(
       'total', jsonb_array_length(v_marks),
       'unmarked', (select count(*) from jsonb_array_elements(v_marks) x where x->>'status' = 'unmarked'),
       'present', (select count(*) from jsonb_array_elements(v_marks) x where x->>'status' = 'present'),
       'late', (select count(*) from jsonb_array_elements(v_marks) x where x->>'status' = 'late'),
       'excused', (select count(*) from jsonb_array_elements(v_marks) x where x->>'status' = 'excused'),
       'unexcused', (select count(*) from jsonb_array_elements(v_marks) x where x->>'status' = 'unexcused'),
       'guests', (select count(*) from jsonb_array_elements(v_marks) x where (x->>'is_guest')::boolean),
       'reported_absences', (select count(*) from jsonb_array_elements(v_marks) x where x->'reported_absence' <> 'null'::jsonb)));
end;
$$;

create or replace function public.attendance_sheet(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ev public.events%rowtype;
begin
  select * into v_ev from public.events where id = p_event;
  if not found or v_ev.org_id is distinct from public.current_org_id() then raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.ta_can_run(p_event) then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if v_ev.team_id is null then raise exception 'EVENT_HAS_NO_TEAM' using errcode = 'P0001'; end if;
  return public.ta_sheet_json(p_event);
end;
$$;

-- Create (or return) the sheet of an event; idempotent.
create or replace function public.attendance_open(p_event uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ev public.events%rowtype;
  s    public.team_attendance_sheets%rowtype;
  v_on date;
begin
  v_ev := public.ta_event_for_write(p_event);
  v_on := (v_ev.starts_at at time zone public.ta_tz(v_ev.org_id))::date;
  select * into s from public.team_attendance_sheets where event_id = p_event;
  if not found then
    if v_ev.status = 'cancelled' then raise exception 'EVENT_CANCELLED' using errcode = 'P0001'; end if;
    insert into public.team_attendance_sheets (org_id, event_id, team_id, roster_date, opened_by, legacy_attendance_session_id)
    values (v_ev.org_id, p_event, v_ev.team_id, v_on, auth.uid(),
            (select x.id from public.attendance_sessions x
              where v_ev.program_session_id is not null and x.program_session_id = v_ev.program_session_id and x.org_id = v_ev.org_id
              limit 1))
    on conflict (event_id) do nothing;
    select * into s from public.team_attendance_sheets where event_id = p_event;
  end if;
  if s.status = 'draft' and v_ev.status <> 'cancelled' then
    if s.roster_date is distinct from v_on or s.team_id is distinct from v_ev.team_id then
      update public.team_attendance_sheets set roster_date = v_on, team_id = v_ev.team_id where id = s.id;
    end if;
    perform public.ta_sheet_sync(s.id);
  end if;
  return public.ta_sheet_json(p_event);
end;
$$;

-- Lock the sheet of an event for a write (after the common checks).
create or replace function public.ta_lock_sheet(p_event uuid)
returns public.team_attendance_sheets language plpgsql security definer set search_path = public as $$
declare s public.team_attendance_sheets%rowtype;
begin
  select * into s from public.team_attendance_sheets where event_id = p_event for update;
  if not found then raise exception 'SHEET_NOT_FOUND' using errcode = 'P0002'; end if;
  return s;
end;
$$;

create or replace function public.ta_write_history(p_mark public.team_attendance_marks, p_prev text, p_new text,
                                                   p_phase text, p_reason text, p_request uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.team_attendance_mark_history
    (org_id, sheet_id, mark_id, event_id, athlete_id, previous_status, new_status, phase, reason, request_id, changed_by)
  values (p_mark.org_id, p_mark.sheet_id, p_mark.id, p_mark.event_id, p_mark.athlete_id, p_prev, p_new, p_phase,
          left(p_reason, 500), p_request, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Draft save: per-mark merge. A mark another user changed after the caller
-- loaded it (rev > base_rev) is NOT overwritten; it comes back in conflicts.
create or replace function public.attendance_save(p_event uuid, p_marks jsonb, p_expected_version integer,
                                                  p_request_id uuid default null, p_ack_reported boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ev       public.events%rowtype;
  s          public.team_attendance_sheets%rowtype;
  m          public.team_attendance_marks%rowtype;
  v_prev     jsonb;
  v_x        jsonb;
  v_ath      uuid;
  v_status   text;
  v_base     integer;
  v_note     text;
  v_has_note boolean;
  v_rep      uuid;
  v_applied  jsonb := '[]'::jsonb;
  v_conf     jsonb := '[]'::jsonb;
  v_warn     jsonb := '[]'::jsonb;
  v_version  integer;
begin
  v_ev := public.ta_event_for_write(p_event);
  v_prev := public.ta_replay(p_request_id, 'save');
  if v_prev is not null then return v_prev; end if;
  s := public.ta_lock_sheet(p_event);
  v_prev := public.ta_replay(p_request_id, 'save'); -- a concurrent retry finished while we waited
  if v_prev is not null then return v_prev; end if;
  if v_ev.status = 'cancelled' then raise exception 'EVENT_CANCELLED' using errcode = 'P0001'; end if;
  if s.status = 'final' then raise exception 'SHEET_FINAL' using errcode = 'P0001'; end if;
  if jsonb_typeof(coalesce(p_marks, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_marks) > 200 then
    raise exception 'INVALID_MARKS' using errcode = 'P0001';
  end if;

  for v_x in select * from jsonb_array_elements(p_marks) loop
    begin
      v_ath := (v_x->>'athlete_id')::uuid;
      v_base := nullif(v_x->>'base_rev', '')::integer;
    exception when others then
      raise exception 'INVALID_MARKS' using errcode = 'P0001';
    end;
    v_status := v_x->>'status';
    if not public.ta_valid_status(v_status, true) then raise exception 'INVALID_STATUS' using errcode = 'P0001'; end if;
    v_has_note := v_x ? 'note';
    v_note := nullif(btrim(coalesce(v_x->>'note', '')), '');
    if length(coalesce(v_note, '')) > 500 then raise exception 'NOTE_TOO_LONG' using errcode = 'P0001'; end if;

    select * into m from public.team_attendance_marks where sheet_id = s.id and athlete_id = v_ath for update;
    if not found then raise exception 'NOT_ON_SHEET' using errcode = 'P0001'; end if;

    if m.status = v_status and (not v_has_note or m.note is not distinct from v_note) then continue; end if;
    if v_base is not null and m.rev > v_base and m.updated_by is distinct from auth.uid() then
      v_conf := v_conf || jsonb_build_object('athlete_id', v_ath, 'your_status', v_status, 'current_status', m.status,
                                             'current_rev', m.rev, 'updated_by', m.updated_by,
                                             'updated_by_name', (select full_name from public.profiles where id = m.updated_by),
                                             'updated_at', m.updated_at);
      continue;
    end if;

    v_rep := case when v_status = 'unexcused' then public.ta_active_report(p_event, v_ath) end;
    update public.team_attendance_marks
       set status = v_status,
           note = case when v_has_note then v_note else note end,
           rev = rev + 1, updated_by = auth.uid(), marked_at = now(),
           reported_absence_ack = (v_rep is not null and p_ack_reported)
     where id = m.id;
    if m.status <> v_status then
      perform public.ta_write_history(m, m.status, v_status, case when s.status = 'reopened' then 'reopened' else 'draft' end,
                                      null, p_request_id);
    end if;
    v_applied := v_applied || jsonb_build_object('athlete_id', v_ath, 'status', v_status, 'rev', m.rev + 1);
    if v_rep is not null then
      v_warn := v_warn || jsonb_build_object('code', 'REPORTED_ABSENCE', 'athlete_id', v_ath, 'report_id', v_rep,
                                             'acknowledged', p_ack_reported);
    end if;
  end loop;

  v_version := s.version;
  if jsonb_array_length(v_applied) > 0 then
    update public.team_attendance_sheets
       set version = version + 1, submitted_by = coalesce(submitted_by, auth.uid()), submitted_at = coalesce(submitted_at, now())
     where id = s.id returning version into v_version;
  end if;
  return public.ta_remember(p_request_id, 'save', s.id, jsonb_build_object(
    'ok', true, 'version', v_version, 'version_conflict', p_expected_version is distinct from s.version,
    'applied', v_applied, 'conflicts', v_conf, 'warnings', v_warn));
end;
$$;

-- Only UNMARKED players become present. Strict version check.
create or replace function public.attendance_mark_all_present(p_event uuid, p_expected_version integer,
                                                              p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ev public.events%rowtype;
  s    public.team_attendance_sheets%rowtype;
  m    public.team_attendance_marks%rowtype;
  v_prev jsonb;
  v_n  integer := 0;
  v_version integer;
begin
  v_ev := public.ta_event_for_write(p_event);
  v_prev := public.ta_replay(p_request_id, 'mark_all_present');
  if v_prev is not null then return v_prev; end if;
  s := public.ta_lock_sheet(p_event);
  v_prev := public.ta_replay(p_request_id, 'mark_all_present');
  if v_prev is not null then return v_prev; end if;
  if v_ev.status = 'cancelled' then raise exception 'EVENT_CANCELLED' using errcode = 'P0001'; end if;
  if s.status = 'final' then raise exception 'SHEET_FINAL' using errcode = 'P0001'; end if;
  if p_expected_version is distinct from s.version then
    return jsonb_build_object('ok', false, 'code', 'VERSION_CONFLICT', 'version', s.version);
  end if;
  for m in select * from public.team_attendance_marks where sheet_id = s.id and status = 'unmarked' for update loop
    update public.team_attendance_marks set status = 'present', rev = rev + 1, updated_by = auth.uid(), marked_at = now()
     where id = m.id;
    perform public.ta_write_history(m, 'unmarked', 'present', case when s.status = 'reopened' then 'reopened' else 'draft' end,
                                    null, p_request_id);
    v_n := v_n + 1;
  end loop;
  v_version := s.version;
  if v_n > 0 then
    update public.team_attendance_sheets set version = version + 1 where id = s.id returning version into v_version;
  end if;
  return public.ta_remember(p_request_id, 'mark_all_present', s.id,
    jsonb_build_object('ok', true, 'version', v_version, 'changed', v_n));
end;
$$;

-- Guest: an existing player of the club added to THIS session only (the
-- roster does not change).
create or replace function public.attendance_add_guest(p_event uuid, p_athlete uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ev public.events%rowtype; s public.team_attendance_sheets%rowtype; v_id uuid; v_version integer;
begin
  v_ev := public.ta_event_for_write(p_event);
  s := public.ta_lock_sheet(p_event);
  if v_ev.status = 'cancelled' then raise exception 'EVENT_CANCELLED' using errcode = 'P0001'; end if;
  if s.status = 'final' then raise exception 'SHEET_FINAL' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.athletes where id = p_athlete and org_id = v_ev.org_id and archived_at is null) then
    raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.team_attendance_marks where sheet_id = s.id and athlete_id = p_athlete) then
    raise exception 'ALREADY_ON_SHEET' using errcode = 'P0001';
  end if;
  insert into public.team_attendance_marks (org_id, sheet_id, event_id, athlete_id, is_guest, status, added_by)
  values (v_ev.org_id, s.id, p_event, p_athlete, true, 'unmarked', auth.uid())
  returning id into v_id;
  update public.team_attendance_sheets set version = version + 1 where id = s.id returning version into v_version;
  return jsonb_build_object('ok', true, 'mark_id', v_id, 'athlete_id', p_athlete, 'version', v_version);
end;
$$;

create or replace function public.attendance_remove_guest(p_event uuid, p_athlete uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ev public.events%rowtype; s public.team_attendance_sheets%rowtype; m public.team_attendance_marks%rowtype; v_version integer;
begin
  v_ev := public.ta_event_for_write(p_event);
  s := public.ta_lock_sheet(p_event);
  if s.status = 'final' then raise exception 'SHEET_FINAL' using errcode = 'P0001'; end if;
  select * into m from public.team_attendance_marks where sheet_id = s.id and athlete_id = p_athlete and is_guest for update;
  if not found then raise exception 'NOT_ON_SHEET' using errcode = 'P0001'; end if;
  if m.status <> 'unmarked' or m.rev > 0 then raise exception 'GUEST_MARKED' using errcode = 'P0001'; end if;
  delete from public.team_attendance_marks where id = m.id;
  update public.team_attendance_sheets set version = version + 1 where id = s.id returning version into v_version;
  return jsonb_build_object('ok', true, 'athlete_id', p_athlete, 'version', v_version);
end;
$$;

-- ===========================================================================
-- 9. No-show alerts: creation / reconciliation (idempotent)
-- ===========================================================================
-- Rules (per mark, after finalization, once the event has ended, unless it
-- was cancelled):
--   * nothing communicated yet: an 'unexcused' mark has ONE pending initial
--     alert per authorized guardian (or one 'no_contact' row without any);
--     any other status supersedes unsent initial alerts
--   * something was communicated (an alert was sent): when the status differs
--     from the last status actually sent, every live alert is superseded and
--     'correction' alerts (one per guardian per correction) are created;
--     when it is back to the status last sent, unsent alerts are superseded
create or replace function public.ta_sync_mark_alerts(p_mark uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  m       public.team_attendance_marks%rowtype;
  s       public.team_attendance_sheets%rowtype;
  v_ev    public.events%rowtype;
  v_n     integer := 0;
  v_k     integer;
  v_last  text;
  v_hist  uuid;
  v_rcpt  uuid[];
  g       uuid;
begin
  select * into m from public.team_attendance_marks where id = p_mark;
  if not found then return 0; end if;
  select * into s from public.team_attendance_sheets where id = m.sheet_id;
  select * into v_ev from public.events where id = m.event_id;
  if s.status <> 'final' or v_ev.status = 'cancelled' or v_ev.ends_at >= now() or m.finalized_status is null then
    return 0;
  end if;
  select coalesce(array_agg(r.profile_id), '{}') into v_rcpt from public.ta_alert_recipients(m.athlete_id) r;

  select a.mark_status into v_last from public.attendance_no_show_alerts a
   where a.event_id = m.event_id and a.athlete_id = m.athlete_id and a.sent_at is not null
   order by a.sent_at desc, a.created_at desc limit 1;

  if v_last is null then
    if m.finalized_status = 'unexcused' then
      foreach g in array v_rcpt loop
        insert into public.attendance_no_show_alerts (org_id, event_id, athlete_id, mark_id, guardian_profile_id, kind, mark_status, status, next_attempt_at)
        values (m.org_id, m.event_id, m.athlete_id, m.id, g, 'initial', 'unexcused', 'pending', now())
        on conflict (event_id, athlete_id, coalesce(guardian_profile_id, '00000000-0000-0000-0000-000000000000'::uuid)) where kind = 'initial'
        do update set status = 'pending', mark_id = excluded.mark_id, next_attempt_at = now(), attempts = 0, last_error = null
         where public.attendance_no_show_alerts.status in ('superseded', 'suppressed') and public.attendance_no_show_alerts.sent_at is null;
        get diagnostics v_k = row_count; v_n := v_n + v_k;
      end loop;
      if cardinality(v_rcpt) = 0 then
        insert into public.attendance_no_show_alerts (org_id, event_id, athlete_id, mark_id, guardian_profile_id, kind, mark_status, status)
        values (m.org_id, m.event_id, m.athlete_id, m.id, null, 'initial', 'unexcused', 'no_contact')
        on conflict (event_id, athlete_id, coalesce(guardian_profile_id, '00000000-0000-0000-0000-000000000000'::uuid)) where kind = 'initial'
        do update set status = 'no_contact', mark_id = excluded.mark_id
         where public.attendance_no_show_alerts.status in ('superseded', 'suppressed') and public.attendance_no_show_alerts.sent_at is null;
        get diagnostics v_k = row_count; v_n := v_n + v_k;
      else
        update public.attendance_no_show_alerts set status = 'superseded'
         where event_id = m.event_id and athlete_id = m.athlete_id and guardian_profile_id is null and status = 'no_contact';
      end if;
    else
      update public.attendance_no_show_alerts set status = 'superseded'
       where event_id = m.event_id and athlete_id = m.athlete_id and sent_at is null
         and status in ('pending', 'failed', 'no_contact');
    end if;
    return v_n;
  end if;

  if v_last = m.finalized_status then
    update public.attendance_no_show_alerts set status = 'superseded'
     where event_id = m.event_id and athlete_id = m.athlete_id and sent_at is null and status in ('pending', 'failed', 'no_contact');
    return 0;
  end if;

  select h.id into v_hist from public.team_attendance_mark_history h
   where h.mark_id = m.id order by h.changed_at desc, h.created_at desc limit 1;
  if v_hist is null then return 0; end if;
  if exists (select 1 from public.attendance_no_show_alerts where history_id = v_hist and kind = 'correction') then
    return 0; -- this correction is already being communicated
  end if;
  update public.attendance_no_show_alerts set status = 'superseded'
   where event_id = m.event_id and athlete_id = m.athlete_id and status in ('sent', 'pending', 'failed', 'no_contact');
  foreach g in array v_rcpt loop
    insert into public.attendance_no_show_alerts (org_id, event_id, athlete_id, mark_id, history_id, guardian_profile_id, kind, mark_status, status, next_attempt_at)
    values (m.org_id, m.event_id, m.athlete_id, m.id, v_hist, g, 'correction', m.finalized_status, 'pending', now())
    on conflict (history_id, coalesce(guardian_profile_id, '00000000-0000-0000-0000-000000000000'::uuid)) where kind = 'correction'
    do nothing;
    get diagnostics v_k = row_count; v_n := v_n + v_k;
  end loop;
  if cardinality(v_rcpt) = 0 then
    insert into public.attendance_no_show_alerts (org_id, event_id, athlete_id, mark_id, history_id, guardian_profile_id, kind, mark_status, status)
    values (m.org_id, m.event_id, m.athlete_id, m.id, v_hist, null, 'correction', m.finalized_status, 'no_contact')
    on conflict (history_id, coalesce(guardian_profile_id, '00000000-0000-0000-0000-000000000000'::uuid)) where kind = 'correction'
    do nothing;
    get diagnostics v_k = row_count; v_n := v_n + v_k;
  end if;
  return v_n;
end;
$$;

-- Reconcile every mark of a sheet once its event has ended.
create or replace function public.ta_sync_sheet_alerts(p_sheet uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  s    public.team_attendance_sheets%rowtype;
  v_ev public.events%rowtype;
  v_n  integer := 0;
  r    record;
begin
  select * into s from public.team_attendance_sheets where id = p_sheet;
  select * into v_ev from public.events where id = s.event_id;
  if s.status <> 'final' or v_ev.ends_at >= now() then return 0; end if;
  if v_ev.status <> 'cancelled' then
    for r in select id from public.team_attendance_marks where sheet_id = s.id loop
      v_n := v_n + public.ta_sync_mark_alerts(r.id);
    end loop;
  end if;
  update public.team_attendance_sheets set alerts_synced_at = now() where id = s.id;
  return v_n;
end;
$$;

-- Cron / dispatcher: alerts of sheets finalized before their event ended.
create or replace function public.attendance_due_alerts()
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer := 0; r record;
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  for r in select s.id from public.team_attendance_sheets s join public.events e on e.id = s.event_id
            where s.status = 'final' and s.alerts_synced_at is null and e.ends_at < now()
            order by e.ends_at limit 500 loop
    v_n := v_n + public.ta_sync_sheet_alerts(r.id);
  end loop;
  return v_n;
end;
$$;

-- Dispatcher: claim alerts to send (pending, or failed below the attempt cap
-- and past their back-off). A claimed row is skipped by other runs for 10
-- minutes. Returns everything a message needs; never other families' data.
create or replace function public.attendance_alerts_claim(p_limit integer default 50, p_org uuid default null)
returns table (alert_id uuid, org_id uuid, kind text, mark_status text, attempts integer, channel_results jsonb,
               notification_id uuid, guardian_profile_id uuid, guardian_email text, guardian_name text,
               guardian_locale text, receives_emails boolean, event_id uuid, athlete_id uuid,
               athlete_first_name text, athlete_last_name text, team_name text, event_type text,
               starts_at timestamptz, ends_at timestamptz, timezone text)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  return query
  with c as (
    select a.id from public.attendance_no_show_alerts a
      join public.events e on e.id = a.event_id
      join public.team_attendance_sheets s on s.event_id = a.event_id
     where a.status in ('pending', 'failed') and a.guardian_profile_id is not null
       and a.attempts < public.ta_alert_max_attempts()
       and coalesce(a.next_attempt_at, a.created_at) <= now()
       and (a.claimed_at is null or a.claimed_at < now() - interval '10 minutes')
       and e.ends_at < now() and e.status <> 'cancelled' and s.status = 'final'
       and (p_org is null or a.org_id = p_org)
     order by a.created_at
     limit greatest(1, least(coalesce(p_limit, 50), 500))
     for update of a skip locked
  ), u as (
    update public.attendance_no_show_alerts a set claimed_at = now(), attempts = a.attempts + 1
      from c where a.id = c.id
    returning a.*
  )
  select u.id, u.org_id, u.kind, u.mark_status, u.attempts, u.channel_results, u.notification_id, u.guardian_profile_id,
         pf.email::text, pf.full_name, case when pf.locale_set_at is not null then pf.locale end,
         coalesce((select bool_or(fm.receives_emails) from public.family_members fm join public.athletes a2 on a2.family_id = fm.family_id
                    where a2.id = u.athlete_id and fm.profile_id = u.guardian_profile_id), false),
         u.event_id, u.athlete_id, ath.first_name, ath.last_name, t.name, e.type::text, e.starts_at, e.ends_at,
         public.ta_tz(u.org_id)
    from u
    join public.events e on e.id = u.event_id
    join public.athletes ath on ath.id = u.athlete_id
    left join public.teams t on t.id = e.team_id
    left join public.profiles pf on pf.id = u.guardian_profile_id;
end;
$$;

-- Dispatcher: record the outcome of one delivery attempt.
create or replace function public.attendance_alert_record(p_alert uuid, p_status text, p_channel_results jsonb,
                                                          p_error text default null, p_notification_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.attendance_no_show_alerts%rowtype; v_status text;
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_status not in ('sent', 'failed', 'no_contact') then raise exception 'INVALID_STATUS' using errcode = 'P0001'; end if;
  select * into a from public.attendance_no_show_alerts where id = p_alert for update;
  if not found then raise exception 'ALERT_NOT_FOUND' using errcode = 'P0002'; end if;
  -- Superseded / suppressed meanwhile: keep that status, but remember a send.
  v_status := case when a.status in ('pending', 'failed') then p_status else a.status end;
  update public.attendance_no_show_alerts
     set status = v_status,
         channel_results = coalesce(p_channel_results, '{}'::jsonb),
         last_error = left(p_error, 500),
         notification_id = coalesce(p_notification_id, notification_id),
         sent_at = case when p_status = 'sent' then coalesce(sent_at, now()) else sent_at end,
         next_attempt_at = case when p_status = 'failed'
                                then now() + make_interval(mins => 5 * a.attempts * a.attempts) end,
         claimed_at = null
   where id = a.id;
  return jsonb_build_object('alert_id', a.id, 'status', v_status);
end;
$$;

-- ===========================================================================
-- 10. Finalize, reopen, correct
-- ===========================================================================
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

  v_coach := coalesce(p_led_by_coach, s.led_by_coach_id, public.current_coach_id());
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

create or replace function public.attendance_reopen(p_event uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ev public.events%rowtype; s public.team_attendance_sheets%rowtype; v_version integer;
begin
  v_ev := public.ta_event_for_write(p_event);
  s := public.ta_lock_sheet(p_event);
  if s.status <> 'final' then raise exception 'SHEET_NOT_FINAL' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if length(p_reason) > 500 then raise exception 'REASON_TOO_LONG' using errcode = 'P0001'; end if;
  update public.team_attendance_sheets
     set status = 'reopened', reopened_by = auth.uid(), reopened_at = now(), reopen_reason = btrim(p_reason),
         version = version + 1, alerts_synced_at = null
   where id = s.id returning version into v_version;
  return jsonb_build_object('ok', true, 'status', 'reopened', 'version', v_version);
end;
$$;

-- Internal: one correction on a FINAL sheet (history row + alert sync).
create or replace function public.ta_correct(p_sheet uuid, p_athlete uuid, p_status text, p_reason text,
                                             p_request uuid, p_ack boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s     public.team_attendance_sheets%rowtype;
  m     public.team_attendance_marks%rowtype;
  v_h   uuid;
  v_n   integer;
  v_rep uuid;
  v_version integer;
begin
  select * into s from public.team_attendance_sheets where id = p_sheet;
  if s.status <> 'final' then raise exception 'SHEET_NOT_FINAL' using errcode = 'P0001'; end if;
  if not public.ta_valid_status(p_status, false) then raise exception 'INVALID_STATUS' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  select * into m from public.team_attendance_marks where sheet_id = s.id and athlete_id = p_athlete for update;
  if not found then raise exception 'MARK_NOT_FOUND' using errcode = 'P0002'; end if;
  if m.status = p_status then
    return jsonb_build_object('ok', true, 'changed', false, 'status', m.status, 'version', s.version, 'alerts_created', 0,
                              'warnings', '[]'::jsonb);
  end if;
  v_rep := case when p_status = 'unexcused' then public.ta_active_report(s.event_id, p_athlete) end;
  update public.team_attendance_marks
     set status = p_status, finalized_status = p_status, rev = rev + 1, updated_by = auth.uid(), marked_at = now(),
         reported_absence_ack = (v_rep is not null and p_ack)
   where id = m.id;
  v_h := public.ta_write_history(m, m.status, p_status, 'correction', btrim(p_reason), p_request);
  update public.team_attendance_sheets set correction_count = correction_count + 1, version = version + 1
   where id = s.id returning version into v_version;
  v_n := public.ta_sync_mark_alerts(m.id);
  return jsonb_build_object('ok', true, 'changed', true, 'history_id', v_h, 'previous_status', m.status,
                            'new_status', p_status, 'version', v_version, 'alerts_created', v_n,
                            'warnings', case when v_rep is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
                              'code', 'REPORTED_ABSENCE', 'athlete_id', p_athlete, 'report_id', v_rep, 'acknowledged', p_ack)) end);
end;
$$;

create or replace function public.attendance_correct(p_event uuid, p_athlete uuid, p_new_status text, p_reason text,
                                                     p_request_id uuid default null, p_ack_reported boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ev public.events%rowtype; s public.team_attendance_sheets%rowtype; v_prev jsonb;
begin
  v_ev := public.ta_event_for_write(p_event);
  v_prev := public.ta_replay(p_request_id, 'correct');
  if v_prev is not null then return v_prev; end if;
  s := public.ta_lock_sheet(p_event);
  v_prev := public.ta_replay(p_request_id, 'correct');
  if v_prev is not null then return v_prev; end if;
  if length(coalesce(p_reason, '')) > 500 then raise exception 'REASON_TOO_LONG' using errcode = 'P0001'; end if;
  return public.ta_remember(p_request_id, 'correct', s.id,
    public.ta_correct(s.id, p_athlete, p_new_status, p_reason, p_request_id, p_ack_reported));
end;
$$;

-- ===========================================================================
-- 11. Event changes: cancellation suppresses alerts; a new time flags reports
-- ===========================================================================
create or replace function public.events_attendance_follow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    update public.attendance_no_show_alerts set status = 'suppressed'
     where event_id = new.id and status in ('pending', 'failed', 'no_contact');
  elsif old.status = 'cancelled' and new.status <> 'cancelled' then
    update public.team_attendance_sheets set alerts_synced_at = null where event_id = new.id;
  end if;
  if new.starts_at is distinct from old.starts_at then
    update public.team_absence_reports set needs_review = true
     where event_id = new.id and status in ('reported', 'acknowledged');
  end if;
  if new.ends_at is distinct from old.ends_at and new.ends_at >= now() then
    update public.team_attendance_sheets set alerts_synced_at = null where event_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_events_attendance_follow on public.events;
create trigger trg_events_attendance_follow after update of status, starts_at, ends_at on public.events
  for each row execute function public.events_attendance_follow();

-- ===========================================================================
-- 12. Absence reports
-- ===========================================================================
create or replace function public.absence_report(p_event uuid, p_athlete uuid, p_reason text default null,
                                                 p_category text default 'other')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ev   public.events%rowtype;
  v_kind text;
  v_id   uuid;
begin
  select * into v_ev from public.events where id = p_event;
  if not found or v_ev.org_id is distinct from public.current_org_id() then raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if public.is_guardian_of_athlete(p_athlete) then v_kind := 'guardian';
  elsif public.is_player_of_athlete(p_athlete) then v_kind := 'player';
  else raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if v_ev.team_id is null or not (v_ev.type::text = any(public.ta_sheet_types())) then
    raise exception 'EVENT_TYPE_NOT_SUPPORTED' using errcode = 'P0001';
  end if;
  if v_ev.status not in ('scheduled', 'postponed') then raise exception 'EVENT_CLOSED' using errcode = 'P0001'; end if;
  -- Cut-off: until the scheduled start.
  if now() >= v_ev.starts_at then raise exception 'ABSENCE_CUTOFF_PASSED' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.ta_roster_on(v_ev.team_id, (v_ev.starts_at at time zone public.ta_tz(v_ev.org_id))::date) r
                  where r.athlete_id = p_athlete)
     and not exists (select 1 from public.team_attendance_marks m where m.event_id = p_event and m.athlete_id = p_athlete) then
    raise exception 'NOT_ON_TEAM' using errcode = 'P0001';
  end if;
  if coalesce(p_category, 'other') not in ('illness', 'injury', 'school', 'family', 'travel', 'other') then
    raise exception 'INVALID_CATEGORY' using errcode = 'P0001';
  end if;
  if length(coalesce(p_reason, '')) > 500 then raise exception 'REASON_TOO_LONG' using errcode = 'P0001'; end if;
  update public.team_absence_reports set status = 'superseded'
   where event_id = p_event and athlete_id = p_athlete and status in ('reported', 'acknowledged');
  insert into public.team_absence_reports (org_id, event_id, athlete_id, reported_by, reporter_kind, reason, reason_category, event_starts_at)
  values (v_ev.org_id, p_event, p_athlete, auth.uid(), v_kind, nullif(btrim(p_reason), ''), coalesce(p_category, 'other'), v_ev.starts_at)
  returning id into v_id;
  return jsonb_build_object('report_id', v_id, 'status', 'reported', 'event_id', p_event, 'athlete_id', p_athlete,
                            'team_id', v_ev.team_id);
end;
$$;

create or replace function public.absence_withdraw(p_report uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.team_absence_reports%rowtype; v_start timestamptz;
begin
  select * into r from public.team_absence_reports where id = p_report for update;
  if not found or r.org_id is distinct from public.current_org_id() then raise exception 'REPORT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not (public.is_guardian_of_athlete(r.athlete_id) or public.is_player_of_athlete(r.athlete_id)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if r.status not in ('reported', 'acknowledged') then raise exception 'REPORT_CLOSED' using errcode = 'P0001'; end if;
  select starts_at into v_start from public.events where id = r.event_id;
  if now() >= v_start then raise exception 'ABSENCE_CUTOFF_PASSED' using errcode = 'P0001'; end if;
  update public.team_absence_reports set status = 'withdrawn', withdrawn_at = now() where id = r.id;
  return jsonb_build_object('report_id', r.id, 'status', 'withdrawn');
end;
$$;

create or replace function public.absence_acknowledge(p_report uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.team_absence_reports%rowtype;
begin
  select * into r from public.team_absence_reports where id = p_report for update;
  if not found or r.org_id is distinct from public.current_org_id() then raise exception 'REPORT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.ta_can_run(r.event_id) then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if r.status not in ('reported', 'acknowledged') then raise exception 'REPORT_CLOSED' using errcode = 'P0001'; end if;
  update public.team_absence_reports
     set status = 'acknowledged', acknowledged_by = auth.uid(), acknowledged_at = now(), needs_review = false
   where id = r.id;
  return jsonb_build_object('report_id', r.id, 'status', 'acknowledged');
end;
$$;

-- ===========================================================================
-- 13. Correction requests (guardian -> admin / team coaches)
-- ===========================================================================
create or replace function public.attendance_correction_request(p_event uuid, p_athlete uuid, p_message text,
                                                                p_requested_status text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ev public.events%rowtype;
  s    public.team_attendance_sheets%rowtype;
  m    public.team_attendance_marks%rowtype;
  v_id uuid;
begin
  select * into v_ev from public.events where id = p_event;
  if not found or v_ev.org_id is distinct from public.current_org_id() then raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_guardian_of_athlete(p_athlete) then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into s from public.team_attendance_sheets where event_id = p_event;
  if not found or s.finalize_count = 0 then raise exception 'SHEET_NOT_FINAL' using errcode = 'P0001'; end if;
  select * into m from public.team_attendance_marks where sheet_id = s.id and athlete_id = p_athlete;
  if not found or m.finalized_status is null then raise exception 'MARK_NOT_FOUND' using errcode = 'P0002'; end if;
  if length(btrim(coalesce(p_message, ''))) = 0 then raise exception 'MESSAGE_REQUIRED' using errcode = 'P0001'; end if;
  if length(p_message) > 1000 then raise exception 'MESSAGE_TOO_LONG' using errcode = 'P0001'; end if;
  if p_requested_status is not null and not public.ta_valid_status(p_requested_status, false) then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.attendance_correction_requests where mark_id = m.id and status = 'open') then
    raise exception 'CORRECTION_OPEN_EXISTS' using errcode = 'P0001';
  end if;
  insert into public.attendance_correction_requests
    (org_id, event_id, team_id, athlete_id, mark_id, requested_by, current_status, requested_status, message)
  values (v_ev.org_id, p_event, s.team_id, p_athlete, m.id, auth.uid(), m.finalized_status, p_requested_status, btrim(p_message))
  returning id into v_id;
  return jsonb_build_object('request_id', v_id, 'status', 'open', 'event_id', p_event, 'athlete_id', p_athlete, 'team_id', s.team_id);
end;
$$;

create or replace function public.attendance_correction_withdraw(p_request uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.attendance_correction_requests%rowtype;
begin
  select * into r from public.attendance_correction_requests where id = p_request for update;
  if not found or r.org_id is distinct from public.current_org_id() then raise exception 'CORRECTION_NOT_FOUND' using errcode = 'P0002'; end if;
  if r.requested_by is distinct from auth.uid() or not public.is_guardian_of_athlete(r.athlete_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if r.status <> 'open' then raise exception 'CORRECTION_CLOSED' using errcode = 'P0001'; end if;
  update public.attendance_correction_requests set status = 'withdrawn', resolved_at = now() where id = r.id;
  return jsonb_build_object('request_id', r.id, 'status', 'withdrawn');
end;
$$;

-- Staff (admin or a coach of the team) resolve; accepted -> attendance correction.
create or replace function public.attendance_correction_resolve(p_request uuid, p_accept boolean,
                                                                p_new_status text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r      public.attendance_correction_requests%rowtype;
  s      public.team_attendance_sheets%rowtype;
  v_st   text;
  v_res  jsonb := null;
begin
  select * into r from public.attendance_correction_requests where id = p_request for update;
  if not found or r.org_id is distinct from public.current_org_id() then raise exception 'CORRECTION_NOT_FOUND' using errcode = 'P0002'; end if;
  if not (public.is_admin() or public.coach_coaches_team(r.team_id)) then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if r.status <> 'open' then raise exception 'CORRECTION_CLOSED' using errcode = 'P0001'; end if;
  if length(coalesce(p_note, '')) > 1000 then raise exception 'NOTE_TOO_LONG' using errcode = 'P0001'; end if;
  if p_accept then
    v_st := coalesce(p_new_status, r.requested_status);
    if v_st is null or not public.ta_valid_status(v_st, false) then raise exception 'INVALID_STATUS' using errcode = 'P0001'; end if;
    select * into s from public.team_attendance_sheets where event_id = r.event_id for update;
    v_res := public.ta_correct(s.id, r.athlete_id, v_st,
                               'correction request' || coalesce(': ' || nullif(btrim(p_note), ''), ''), null, true);
  elsif length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'NOTE_REQUIRED' using errcode = 'P0001';
  end if;
  update public.attendance_correction_requests
     set status = case when p_accept then 'accepted' else 'rejected' end,
         resolved_by = auth.uid(), resolved_at = now(), resolution_note = nullif(btrim(p_note), ''),
         history_id = nullif(v_res->>'history_id', '')::uuid
   where id = r.id;
  return jsonb_build_object('request_id', r.id, 'status', case when p_accept then 'accepted' else 'rejected' end,
                            'requested_by', r.requested_by, 'event_id', r.event_id, 'athlete_id', r.athlete_id,
                            'team_id', r.team_id, 'correction', v_res);
end;
$$;

-- ===========================================================================
-- 14. Reads for the UIs (tenant + role checked inside)
-- ===========================================================================

-- A coach's sessions in a time range: teams they coach + session assignments
-- (approved, or pending for visibility without access).
create or replace function public.coach_sessions(p_from timestamptz default null, p_to timestamptz default null)
returns table (event_id uuid, team_id uuid, team_name text, event_type text, title text, starts_at timestamptz,
               ends_at timestamptz, event_status text, access text, can_run boolean, sheet_status text,
               sheet_version integer, unmarked integer, marked integer, reported_absences integer, tracked boolean)
language sql stable security definer set search_path = public as $$
  with me as (select public.current_coach_id() as coach, public.current_org_id() as org),
  ev as (
    select e.*, 'team_coach'::text as access
      from public.events e, me
     where me.coach is not null and e.org_id = me.org and e.team_id is not null
       and exists (select 1 from public.team_coaches tc where tc.team_id = e.team_id and tc.coach_id = me.coach)
    union all
    select e.*, case when a.status = 'pending' then 'pending' else a.role end
      from public.events e join public.event_coach_assignments a on a.event_id = e.id, me
     where me.coach is not null and e.org_id = me.org and a.coach_id = me.coach and a.status in ('approved', 'pending')
       and not exists (select 1 from public.team_coaches tc where tc.team_id = e.team_id and tc.coach_id = me.coach)
  )
  select ev.id, ev.team_id, t.name, ev.type::text, ev.title, ev.starts_at, ev.ends_at, ev.status::text, ev.access,
         public.coach_can_run_event(ev.id), s.status, s.version,
         (select count(*)::int from public.team_attendance_marks m where m.sheet_id = s.id and m.status = 'unmarked'),
         (select count(*)::int from public.team_attendance_marks m where m.sheet_id = s.id and m.status <> 'unmarked'),
         (select count(*)::int from public.team_absence_reports r where r.event_id = ev.id and r.status in ('reported', 'acknowledged')),
         public.ta_event_tracked(ev.id)
    from ev
    left join public.teams t on t.id = ev.team_id
    left join public.team_attendance_sheets s on s.event_id = ev.id
   where ev.type::text = any(public.ta_sheet_types())
     and ev.starts_at >= coalesce(p_from, now() - interval '1 day')
     and ev.starts_at < coalesce(p_to, now() + interval '14 days')
   order by ev.starts_at;
$$;

-- Ended, not cancelled sessions without a final sheet, inside the training
-- window and on/after the club's attendance go-live. Admin: the club (or one
-- team); coach: the sessions they can run.
create or replace function public.sessions_awaiting_attendance(p_team uuid default null, p_limit integer default 100)
returns table (event_id uuid, team_id uuid, team_name text, event_type text, starts_at timestamptz, ends_at timestamptz,
               sheet_status text, unmarked integer, days_since_end integer)
language sql stable security definer set search_path = public as $$
  select e.id, e.team_id, t.name, e.type::text, e.starts_at, e.ends_at, s.status,
         (select count(*)::int from public.team_attendance_marks m where m.sheet_id = s.id and m.status = 'unmarked'),
         (public.ta_today(e.org_id) - (e.ends_at at time zone public.ta_tz(e.org_id))::date)::int
    from public.events e
    join public.teams t on t.id = e.team_id
    left join public.team_attendance_sheets s on s.event_id = e.id
   where e.org_id = public.current_org_id()
     and (p_team is null or e.team_id = p_team)
     and e.type::text = any(public.ta_sheet_types())
     and e.status <> 'cancelled' and e.ends_at < now()
     and (s.id is null or s.status <> 'final')
     and (public.is_admin() or public.coach_can_run_event(e.id))
     and public.ta_event_tracked(e.id)
   order by e.ends_at desc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

-- Attendance statistics from FINALIZED marks of non-cancelled events
-- (finalized_status: a sheet reopened for corrections still counts with its
-- last finalized state). rate = (present + late) / finalized marks.
-- p_season: the season's training window bounds the dates (trainings outside
-- it never count). Scope: admin = club; coach = teams they coach; guardian =
-- own children; player = self. p_group 'team' (one row per team) or
-- 'player' (one row per team and player); guardians / players always get
-- their own player rows only.
create or replace function public.attendance_stats(p_from date default null, p_to date default null, p_team uuid default null,
                                                   p_season uuid default null, p_athlete uuid default null,
                                                   p_group text default 'player')
returns table (team_id uuid, team_name text, athlete_id uuid, first_name text, last_name text,
               sessions integer, present integer, late integer, excused integer, unexcused integer, rate numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org   uuid := public.current_org_id();
  v_admin boolean := public.is_admin();
  v_coach uuid := public.current_coach_id();
  v_self  boolean;
  v_from  date := p_from;
  v_to    date := p_to;
  v_ws    date;
  v_we    date;
begin
  if v_org is null then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if coalesce(p_group, 'player') not in ('player', 'team') then raise exception 'INVALID_GROUP' using errcode = 'P0001'; end if;
  v_self := not v_admin and v_coach is null;
  if v_self then
    if p_athlete is null or not (public.is_guardian_of_athlete(p_athlete) or public.is_player_of_athlete(p_athlete)) then
      raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
    end if;
  elsif not v_admin and p_athlete is not null and not public.is_guardian_of_athlete(p_athlete)
        and not exists (select 1 from public.team_memberships tm join public.team_coaches tc on tc.team_id = tm.team_id
                         where tm.athlete_id = p_athlete and tc.coach_id = v_coach) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if p_season is not null then
    select coalesce(s.training_starts_on, s.starts_on), coalesce(s.training_ends_on, s.ends_on) into v_ws, v_we
      from public.seasons s where s.id = p_season and s.org_id = v_org;
    if v_ws is null then raise exception 'SEASON_NOT_FOUND' using errcode = 'P0002'; end if;
    v_from := greatest(coalesce(v_from, v_ws), v_ws);
    v_to := least(coalesce(v_to, v_we), v_we);
  end if;

  return query
  with base as (
    select e.team_id, m.athlete_id, m.finalized_status as st
      from public.team_attendance_marks m
      join public.team_attendance_sheets s on s.id = m.sheet_id and s.finalize_count > 0
      join public.events e on e.id = m.event_id
     where m.org_id = v_org and e.status <> 'cancelled' and m.finalized_status is not null
       and (v_from is null or s.roster_date >= v_from)
       and (v_to is null or s.roster_date <= v_to)
       and (p_team is null or e.team_id = p_team)
       and (p_athlete is null or m.athlete_id = p_athlete)
       and (p_season is null or (coalesce(e.season_id, (select t2.season_id from public.teams t2 where t2.id = e.team_id)) = p_season
                                 and (e.type <> 'training' or public.ta_in_training_window(e.id))))
       and (v_admin or v_self or exists (select 1 from public.team_coaches tc where tc.team_id = e.team_id and tc.coach_id = v_coach)
            or (p_athlete is not null and public.is_guardian_of_athlete(p_athlete)))
  )
  select b.team_id, t.name,
         case when p_group = 'team' and not v_self then null else b.athlete_id end,
         case when p_group = 'team' and not v_self then null else max(a.first_name) end,
         case when p_group = 'team' and not v_self then null else max(a.last_name) end,
         count(*)::int,
         count(*) filter (where b.st = 'present')::int,
         count(*) filter (where b.st = 'late')::int,
         count(*) filter (where b.st = 'excused')::int,
         count(*) filter (where b.st = 'unexcused')::int,
         round((count(*) filter (where b.st in ('present', 'late')))::numeric / nullif(count(*), 0), 4)
    from base b
    join public.teams t on t.id = b.team_id
    join public.athletes a on a.id = b.athlete_id
   group by b.team_id, t.name, case when p_group = 'team' and not v_self then null else b.athlete_id end
   order by t.name, 5, 4;
end;
$$;

-- Alerts needing staff follow-up: no reachable guardian, or delivery failed.
create or replace function public.attendance_alerts_followup(p_limit integer default 100)
returns table (alert_id uuid, status text, kind text, mark_status text, attempts integer, last_error text,
               created_at timestamptz, event_id uuid, starts_at timestamptz, team_id uuid, team_name text,
               athlete_id uuid, first_name text, last_name text, guardian_profile_id uuid, guardian_name text)
language sql stable security definer set search_path = public as $$
  select a.id, a.status, a.kind, a.mark_status, a.attempts, a.last_error, a.created_at, e.id, e.starts_at, e.team_id,
         t.name, a.athlete_id, ath.first_name, ath.last_name, a.guardian_profile_id, pf.full_name
    from public.attendance_no_show_alerts a
    join public.events e on e.id = a.event_id
    left join public.teams t on t.id = e.team_id
    join public.athletes ath on ath.id = a.athlete_id
    left join public.profiles pf on pf.id = a.guardian_profile_id
   where a.org_id = public.current_org_id()
     and (a.status = 'no_contact' or (a.status = 'failed' and a.attempts >= public.ta_alert_max_attempts()))
     and (public.is_admin() or (e.team_id is not null and public.coach_coaches_team(e.team_id)))
   order by a.created_at desc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

-- Correction requests: staff (admin = club, coach = their teams) or a
-- guardian (requests about their own children).
create or replace function public.attendance_correction_requests_list(p_status text default 'open', p_athlete uuid default null)
returns table (request_id uuid, status text, event_id uuid, starts_at timestamptz, team_id uuid, team_name text,
               athlete_id uuid, first_name text, last_name text, current_status text, requested_status text,
               mark_status text, message text, requested_by uuid, requested_by_name text, created_at timestamptz,
               resolved_at timestamptz, resolved_by_name text, resolution_note text)
language sql stable security definer set search_path = public as $$
  select r.id, r.status, r.event_id, e.starts_at, r.team_id, t.name, r.athlete_id, a.first_name, a.last_name,
         r.current_status, r.requested_status, m.finalized_status, r.message, r.requested_by, rq.full_name, r.created_at,
         r.resolved_at, rs.full_name, r.resolution_note
    from public.attendance_correction_requests r
    join public.events e on e.id = r.event_id
    join public.teams t on t.id = r.team_id
    join public.athletes a on a.id = r.athlete_id
    left join public.team_attendance_marks m on m.id = r.mark_id
    left join public.profiles rq on rq.id = r.requested_by
    left join public.profiles rs on rs.id = r.resolved_by
   where r.org_id = public.current_org_id()
     and (p_status is null or r.status = p_status)
     and (p_athlete is null or r.athlete_id = p_athlete)
     and (public.is_admin() or public.coach_coaches_team(r.team_id) or public.is_guardian_of_athlete(r.athlete_id))
   order by r.created_at desc
   limit 500;
$$;

-- Session access requests / assignments (admin: club; coach: own).
create or replace function public.session_access_list(p_status text default 'pending')
returns table (assignment_id uuid, status text, role text, event_id uuid, starts_at timestamptz, team_id uuid, team_name text,
               coach_id uuid, coach_name text, request_note text, decision_note text, created_at timestamptz, decided_at timestamptz)
language sql stable security definer set search_path = public as $$
  select x.id, x.status, x.role, x.event_id, e.starts_at, e.team_id, t.name, x.coach_id, c.display_name, x.request_note,
         x.decision_note, x.created_at, x.decided_at
    from public.event_coach_assignments x
    join public.events e on e.id = x.event_id
    left join public.teams t on t.id = e.team_id
    join public.coaches c on c.id = x.coach_id
   where x.org_id = public.current_org_id()
     and (p_status is null or x.status = p_status)
     and (public.is_admin() or x.coach_id = public.current_coach_id())
   order by e.starts_at desc
   limit 500;
$$;

-- Internal: one athlete's attendance overview (upcoming trainings with
-- absence-report state, finalized history, reports, requests, alerts to the
-- viewer). Only FINALIZED values; never other players' data.
create or replace function public.ta_athlete_overview(p_athlete uuid, p_from date, p_to date, p_viewer uuid, p_guardian boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org  uuid;
  v_tz   text;
  v_from date;
  v_to   date;
  v_teams uuid[];
begin
  select org_id into v_org from public.athletes where id = p_athlete;
  v_tz := public.ta_tz(v_org);
  v_to := coalesce(p_to, public.ta_today(v_org));
  v_from := coalesce(p_from, v_to - 120);
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
               'event_id', e.id, 'team_id', e.team_id, 'team_name', t.name, 'type', e.type, 'title', e.title,
               'starts_at', e.starts_at, 'ends_at', e.ends_at, 'status', e.status,
               'can_report', e.status in ('scheduled', 'postponed') and e.starts_at > now(),
               'report', (select jsonb_build_object('report_id', r.id, 'status', r.status, 'reason', r.reason,
                                                    'reason_category', r.reason_category, 'needs_review', r.needs_review,
                                                    'created_at', r.created_at)
                            from public.team_absence_reports r
                           where r.event_id = e.id and r.athlete_id = p_athlete and r.status in ('reported', 'acknowledged') limit 1))
             order by e.starts_at)
        from public.events e join public.teams t on t.id = e.team_id
       where e.team_id = any(coalesce(v_teams, '{}')) and e.starts_at >= now() and e.starts_at < now() + interval '30 days'
         and e.type::text = any(public.ta_sheet_types())
         and exists (select 1 from public.ta_roster_on(e.team_id, (e.starts_at at time zone v_tz)::date) ro where ro.athlete_id = p_athlete)
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event_id', e.id, 'team_id', e.team_id, 'team_name', t.name, 'type', e.type, 'starts_at', e.starts_at,
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
        join public.teams t on t.id = e.team_id
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
$$;

create or replace function public.guardian_attendance_overview(p_athlete uuid, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.athletes where id = p_athlete and org_id = public.current_org_id()) then
    raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (public.is_guardian_of_athlete(p_athlete) or public.is_admin()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if p_from is not null and p_to is not null and p_to < p_from then raise exception 'INVALID_RANGE' using errcode = 'P0001'; end if;
  return public.ta_athlete_overview(p_athlete, p_from, p_to, auth.uid(), true);
end;
$$;

create or replace function public.player_attendance_overview(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ath uuid := public.current_player_athlete_id();
begin
  if v_ath is null then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_from is not null and p_to is not null and p_to < p_from then raise exception 'INVALID_RANGE' using errcode = 'P0001'; end if;
  return public.ta_athlete_overview(v_ath, p_from, p_to, auth.uid(), false);
end;
$$;

-- ===========================================================================
-- 15. RLS: reads are role-scoped; every write goes through the RPCs above
-- ===========================================================================
do $$
declare t text;
begin
  foreach t in array array['team_membership_periods', 'event_coach_assignments', 'team_attendance_sheets',
                           'team_attendance_marks', 'team_attendance_mark_history', 'team_attendance_requests',
                           'team_absence_reports', 'attendance_no_show_alerts', 'attendance_correction_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert with check (false)', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update using (false) with check (false)', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete using (false)', t || '_delete', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

create policy team_membership_periods_select on public.team_membership_periods for select
  using (org_id = public.current_org_id()
         and (public.is_finance() or public.coach_coaches_team(team_id) or public.is_guardian_of_athlete(athlete_id)
              or public.is_player_of_athlete(athlete_id)));
create policy event_coach_assignments_select on public.event_coach_assignments for select
  using (org_id = public.current_org_id()
         and (public.is_admin() or coach_id = public.current_coach_id() or public.ta_is_event_staff(event_id)));
create policy team_attendance_sheets_select on public.team_attendance_sheets for select
  using (org_id = public.current_org_id() and public.ta_can_run(event_id));
-- Marks: staff running the session only. Guardians / players read finalized
-- values through guardian_attendance_overview / player_attendance_overview.
create policy team_attendance_marks_select on public.team_attendance_marks for select
  using (org_id = public.current_org_id() and public.ta_can_run(event_id));
create policy team_attendance_mark_history_select on public.team_attendance_mark_history for select
  using (org_id = public.current_org_id() and public.ta_can_run(event_id));
create policy team_attendance_requests_select on public.team_attendance_requests for select
  using (false);
create policy team_absence_reports_select on public.team_absence_reports for select
  using (org_id = public.current_org_id()
         and (public.ta_can_run(event_id) or public.is_guardian_of_athlete(athlete_id) or public.is_player_of_athlete(athlete_id)));
create policy attendance_no_show_alerts_select on public.attendance_no_show_alerts for select
  using (org_id = public.current_org_id()
         and (public.is_admin() or guardian_profile_id = auth.uid() or public.ta_is_event_staff(event_id)));
create policy attendance_correction_requests_select on public.attendance_correction_requests for select
  using (org_id = public.current_org_id()
         and (public.is_admin() or public.coach_coaches_team(team_id) or public.is_guardian_of_athlete(athlete_id)));

-- ===========================================================================
-- 16. Data review: what cannot be matched reliably goes to data_review_flags
-- ===========================================================================
-- Reason codes:
--   MEMBERSHIP_INACTIVE_NO_END   inactive roster row without an end date (off every roster)
--   MEMBERSHIP_DATE_UNCERTAIN    joined_on after a tracked training of the team the
--                                player has a mark for / is expected at (date unknown)
--   TRAINING_WITHOUT_TEAM        tracked training not linked to a team (no roster)
--   TEAM_WITHOUT_COACH           active team with tracked trainings and no team coach
--   ATHLETE_WITHOUT_GUARDIAN     player on a current roster without a reachable guardian
--   LEGACY_ATTENDANCE_SESSION    programme-session attendance linked to a team event
--   ATTENDANCE_UNFINISHED        tracked session ended > 2 days ago without a final sheet
create or replace function public.attendance_review_flags(p_org uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer := 0; v_k integer;
begin
  if not (public.is_service_caller() or (p_org = public.current_org_id() and public.is_admin())) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
  select tm.org_id, 'team_memberships', tm.id, 'MEMBERSHIP_INACTIVE_NO_END',
         jsonb_build_object('team_id', tm.team_id, 'athlete_id', tm.athlete_id, 'joined_on', tm.joined_on)
    from public.team_memberships tm
   where tm.org_id = p_org and tm.status = 'inactive' and tm.left_on is null
  on conflict do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
  select tm.org_id, 'team_memberships', tm.id, 'MEMBERSHIP_DATE_UNCERTAIN',
         jsonb_build_object('team_id', tm.team_id, 'athlete_id', tm.athlete_id, 'joined_on', tm.joined_on)
    from public.team_memberships tm
   where tm.org_id = p_org and tm.dates_source = 'uncertain'
  on conflict do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
  select e.org_id, 'events', e.id, 'TRAINING_WITHOUT_TEAM',
         jsonb_build_object('starts_at', e.starts_at, 'title', e.title)
    from public.events e
   where e.org_id = p_org and e.type = 'training' and e.team_id is null and e.status <> 'cancelled'
     and public.ta_event_tracked(e.id)
  on conflict do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
  select t.org_id, 'teams', t.id, 'TEAM_WITHOUT_COACH', jsonb_build_object('name', t.name)
    from public.teams t
   where t.org_id = p_org and t.is_active
     and not exists (select 1 from public.team_coaches tc where tc.team_id = t.id)
     and exists (select 1 from public.events e where e.team_id = t.id and e.type = 'training' and e.status <> 'cancelled'
                  and e.starts_at >= now() - interval '30 days' and public.ta_event_tracked(e.id))
  on conflict do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
  select distinct a.org_id, 'athletes', a.id, 'ATHLETE_WITHOUT_GUARDIAN',
         jsonb_build_object('team_id', t.id, 'has_family', a.family_id is not null)
    from public.teams t
    cross join lateral public.ta_roster_on(t.id, public.ta_today(t.org_id)) r
    join public.athletes a on a.id = r.athlete_id
   where t.org_id = p_org and t.is_active
     and not exists (select 1 from public.ta_alert_recipients(a.id))
  on conflict do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
  select x.org_id, 'attendance_sessions', x.id, 'LEGACY_ATTENDANCE_SESSION',
         jsonb_build_object('event_id', e.id, 'team_id', e.team_id, 'program_session_id', x.program_session_id)
    from public.attendance_sessions x
    join public.events e on e.program_session_id = x.program_session_id and e.org_id = x.org_id and e.team_id is not null
   where x.org_id = p_org
  on conflict do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  insert into public.data_review_flags (org_id, entity_table, entity_id, reason_code, details)
  select e.org_id, 'events', e.id, 'ATTENDANCE_UNFINISHED',
         jsonb_build_object('team_id', e.team_id, 'starts_at', e.starts_at, 'sheet_status', s.status)
    from public.events e
    left join public.team_attendance_sheets s on s.event_id = e.id
   where e.org_id = p_org and e.team_id is not null and e.type::text = any(public.ta_sheet_types())
     and e.status <> 'cancelled' and e.ends_at < now() - interval '2 days'
     and (s.id is null or s.status <> 'final')
     and public.ta_event_tracked(e.id)
  on conflict do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  -- A flagged unfinished session that is now final resolves itself.
  update public.data_review_flags f
     set resolved_at = now(), resolution_note = 'attendance finalized'
   where f.org_id = p_org and f.reason_code = 'ATTENDANCE_UNFINISHED' and f.resolved_at is null
     and exists (select 1 from public.team_attendance_sheets s where s.event_id = f.entity_id and s.status = 'final');
  return v_n;
end;
$$;

-- ===========================================================================
-- 17. Data steps (idempotent)
-- ===========================================================================
-- Rosters: joined_on is NOT NULL since the table was created (column default
-- = the insert date), so there is nothing to backfill; existing rows are
-- marked 'recorded'. Their dates are not rewritten (no guessing): a row's
-- joined_on is its creation date unless someone set it.
update public.team_memberships set dates_source = 'recorded' where dates_source is null;

-- Attendance go-live: existing clubs start tracking on the day this migration
-- runs (club time zone), so the sessions before it never flood the
-- "awaiting attendance" lists or the unfinished-session flags. An admin moves
-- it (attendance_settings_set). Clubs created later start with null = all.
update public.app_settings st set attendance_tracking_starts_on = public.ta_today(st.org_id)
 where st.attendance_tracking_starts_on is null
   and not exists (select 1 from public.team_attendance_sheets s where s.org_id = st.org_id);

do $$
declare r record;
begin
  for r in select id from public.organizations loop
    perform public.attendance_review_flags(r.id);
  end loop;
end $$;

-- ===========================================================================
-- 18. Function privileges
-- ===========================================================================
do $$
declare f text;
begin
  -- Internal helpers / triggers: never callable through the API.
  foreach f in array array[
    'public.ta_member_add(uuid, uuid, date, integer, text, text)',
    'public.ta_member_leave(uuid, uuid, date, text)',
    'public.ta_roster_write_check(uuid, uuid)',
    'public.ta_roster_on(uuid, date)',
    'public.ta_alert_recipients(uuid)',
    'public.ta_link_player(uuid, uuid, uuid)',
    'public.ta_sheet_sync(uuid)',
    'public.ta_sheet_json(uuid)',
    'public.ta_lock_sheet(uuid)',
    'public.ta_write_history(public.team_attendance_marks, text, text, text, text, uuid)',
    'public.ta_replay(uuid, text)',
    'public.ta_remember(uuid, text, uuid, jsonb)',
    'public.ta_event_for_write(uuid)',
    'public.ta_sync_mark_alerts(uuid)',
    'public.ta_sync_sheet_alerts(uuid)',
    'public.ta_correct(uuid, uuid, text, text, uuid, boolean)',
    'public.ta_athlete_overview(uuid, date, date, uuid, boolean)',
    'public.team_memberships_effective()',
    'public.team_memberships_delete_guard()',
    'public.events_attendance_follow()',
    'public.events_training_window_guard()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;

  -- Service only (cron / dispatcher).
  foreach f in array array[
    'public.attendance_due_alerts()',
    'public.attendance_alerts_claim(integer, uuid)',
    'public.attendance_alert_record(uuid, text, jsonb, text, uuid)',
    'public.team_memberships_apply_due()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;

  -- Signed-in API (each checks tenant and role inside).
  foreach f in array array[
    'public.ta_tz(uuid)', 'public.ta_today(uuid)', 'public.ta_event_date(uuid)', 'public.ta_sheet_types()',
    'public.ta_grace_days()', 'public.ta_alert_max_attempts()', 'public.ta_is_selection_team(uuid)',
    'public.ta_is_event_staff(uuid)', 'public.ta_valid_status(text, boolean)', 'public.ta_active_report(uuid, uuid)',
    'public.ta_event_window(uuid)', 'public.ta_in_training_window(uuid)', 'public.ta_event_tracked(uuid)',
    'public.current_player_athlete_id()', 'public.is_player()', 'public.is_player_of_athlete(uuid)',
    'public.player_on_team(uuid)', 'public.player_sees_event(uuid)', 'public.coach_can_run_event(uuid)',
    'public.ta_can_run(uuid)', 'public.ta_membership_has_attendance(uuid, uuid)',
    'public.team_roster_on(uuid, date)', 'public.team_roster_history(uuid)',
    'public.team_member_add(uuid, uuid, date, integer, text)', 'public.team_member_leave(uuid, uuid, date, text)',
    'public.team_member_transfer(uuid, uuid, uuid, date, text)',
    'public.attendance_settings_set(date)', 'public.attendance_settings()',
    'public.athlete_player_link(uuid, uuid)', 'public.athlete_player_unlink(uuid)', 'public.player_me()',
    'public.session_assign_coach(uuid, uuid, text)', 'public.session_request_access(uuid, text)',
    'public.session_decide_access(uuid, boolean, text)',
    'public.attendance_sheet(uuid)', 'public.attendance_open(uuid)',
    'public.attendance_save(uuid, jsonb, integer, uuid, boolean)',
    'public.attendance_mark_all_present(uuid, integer, uuid)',
    'public.attendance_add_guest(uuid, uuid)', 'public.attendance_remove_guest(uuid, uuid)',
    'public.attendance_finalize(uuid, uuid, integer, uuid, boolean)', 'public.attendance_reopen(uuid, text)',
    'public.attendance_correct(uuid, uuid, text, text, uuid, boolean)',
    'public.absence_report(uuid, uuid, text, text)', 'public.absence_withdraw(uuid)', 'public.absence_acknowledge(uuid)',
    'public.attendance_correction_request(uuid, uuid, text, text)', 'public.attendance_correction_withdraw(uuid)',
    'public.attendance_correction_resolve(uuid, boolean, text, text)',
    'public.coach_sessions(timestamptz, timestamptz)', 'public.sessions_awaiting_attendance(uuid, integer)',
    'public.attendance_stats(date, date, uuid, uuid, uuid, text)', 'public.attendance_alerts_followup(integer)',
    'public.attendance_correction_requests_list(text, uuid)', 'public.session_access_list(text)',
    'public.guardian_attendance_overview(uuid, date, date)', 'public.player_attendance_overview(date, date)',
    'public.attendance_review_flags(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
