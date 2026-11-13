-- ============================================================================
-- DLang OS — Staff time, lesson plans and the club calendar
--
--   1. Employee clock-in
--        venues                 + latitude / longitude / geofence_radius_m
--                                 (venue coordinates only; staff positions
--                                 are never stored, only a distance flag)
--        staff_shift_templates  planned weekly shifts per employee per venue
--        staff_time_entries     clock-in / clock-out records
--        staff_time_breaks      breaks inside a time entry
--        staff_timesheets       approved periods per employee (payroll lock)
--      Staff never write these tables directly: every clock action, admin
--      correction and approval goes through a SECURITY DEFINER RPC that
--      checks the caller, uses server time and writes audit_logs with the
--      reason. The RLS write policies deny direct writes.
--
--   2. Lesson plans (lesson_plans + private "lesson-plans" bucket): written by
--      the coach of a programme session / team event, optionally shared with
--      the parents of the athletes on it; admins see all.
--
--   3. Club calendar
--        club_events            things not covered elsewhere (international
--                               events, holidays, meetings ...), with audience
--        calendar_feed_tokens   per-user read-only ICS subscription tokens
--                               (only a SHA-256 hash is stored)
--
--   4. staff_hours(org, from, to): planned vs worked minutes per employee,
--      the hook for coach payouts (see docs/product/staff-time.md).
--
-- Additive and idempotent. Every new table: org_id + index, RLS with a policy
-- per verb, created_at/updated_at, audit trigger where it holds personal data.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Helpers
-- ---------------------------------------------------------------------------

-- Any staff member of the caller's org (admin, finance or coach).
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('admin') or public.has_role('finance') or public.has_role('coach');
$$;
revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated, service_role;

-- Longest a shift may stay open before it counts as a missed clock-out.
create or replace function public.staff_max_shift()
returns interval language sql immutable as $$ select interval '16 hours' $$;

-- Is the caller trusted server code (service role / direct DB session)?
create or replace function public.staff_is_service_caller()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is null and coalesce(auth.role(), 'service_role') = 'service_role';
$$;
revoke all on function public.staff_is_service_caller() from public, anon;
grant execute on function public.staff_is_service_caller() to authenticated, service_role;

-- Same-org guard for every foreign key named in the trigger arguments.
create or replace function public.staff_same_org_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_org uuid  := (v_row->>'org_id')::uuid;
  v_col text;
  v_id  uuid;
  v_tab text;
  v_ok  boolean;
begin
  foreach v_col in array tg_argv loop
    v_id := nullif(v_row->>v_col, '')::uuid;
    continue when v_id is null;
    v_tab := case v_col
      when 'profile_id'         then 'profiles'
      when 'author_id'          then 'profiles'
      when 'coach_id'           then 'coaches'
      when 'venue_id'           then 'venues'
      when 'program_session_id' then 'program_sessions'
      when 'event_id'           then 'events'
      when 'time_entry_id'      then 'staff_time_entries'
      when 'team_id'            then 'teams'
    end;
    if v_tab is null then raise exception 'staff_same_org_guard: unknown column %', v_col; end if;
    execute format('select exists (select 1 from public.%I where id = $1 and org_id = $2)', v_tab)
      into v_ok using v_id, v_org;
    if not v_ok then
      raise exception 'CROSS_ORG_REFERENCE: %', v_col using errcode = 'P0001';
    end if;
  end loop;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) Venue geofence (club facility coordinates, not personal data)
-- ---------------------------------------------------------------------------
alter table public.venues
  add column if not exists latitude          numeric(9,6),
  add column if not exists longitude         numeric(9,6),
  add column if not exists geofence_radius_m integer not null default 300;
do $$ begin
  alter table public.venues add constraint venues_geo_chk check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.venues add constraint venues_geofence_radius_chk check (geofence_radius_m between 25 and 5000);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2) Planned shifts (weekly templates)
-- ---------------------------------------------------------------------------
create table if not exists public.staff_shift_templates (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  venue_id    uuid references public.venues(id) on delete set null,
  weekday     smallint not null check (weekday between 1 and 7),   -- ISO: 1 = Monday
  start_time  time not null,
  end_time    time not null,                                       -- <= start_time: ends next day
  valid_from  date,
  valid_until date,
  label       text check (label is null or length(label) <= 120),
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint staff_shift_templates_len_chk check (end_time <> start_time),
  constraint staff_shift_templates_valid_chk check (valid_from is null or valid_until is null or valid_until >= valid_from)
);
create index if not exists idx_staff_shift_templates_org on public.staff_shift_templates(org_id);
create index if not exists idx_staff_shift_templates_profile on public.staff_shift_templates(profile_id, weekday);

drop trigger if exists trg_staff_shift_templates_updated on public.staff_shift_templates;
create trigger trg_staff_shift_templates_updated before update on public.staff_shift_templates
  for each row execute function public.set_updated_at();
drop trigger if exists trg_staff_shift_templates_org on public.staff_shift_templates;
create trigger trg_staff_shift_templates_org before insert or update on public.staff_shift_templates
  for each row execute function public.staff_same_org_guard('profile_id', 'venue_id');
drop trigger if exists trg_audit_staff_shift_templates on public.staff_shift_templates;
create trigger trg_audit_staff_shift_templates after insert or update or delete on public.staff_shift_templates
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- 3) Time entries + breaks
-- ---------------------------------------------------------------------------
create table if not exists public.staff_time_entries (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  profile_id         uuid not null references public.profiles(id) on delete cascade,
  coach_id           uuid references public.coaches(id) on delete set null,
  venue_id           uuid references public.venues(id) on delete set null,
  program_session_id uuid references public.program_sessions(id) on delete set null,
  event_id           uuid references public.events(id) on delete set null,
  clock_in_at        timestamptz not null,
  clock_out_at       timestamptz,
  status             text not null default 'open',
  geo_status         text not null default 'not_checked',
  source             text not null default 'app',
  note               text check (note is null or length(note) <= 500),
  corrected_by       uuid references public.profiles(id) on delete set null,
  corrected_at       timestamptz,
  correction_reason  text check (correction_reason is null or length(correction_reason) <= 500),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint staff_time_entries_status_chk check (status in ('open', 'closed', 'missed')),
  constraint staff_time_entries_geo_chk check (geo_status in ('not_checked', 'ok', 'too_far', 'unavailable')),
  constraint staff_time_entries_source_chk check (source in ('app', 'admin')),
  constraint staff_time_entries_times_chk check (
    clock_out_at is null or (clock_out_at > clock_in_at and clock_out_at - clock_in_at <= interval '24 hours')),
  constraint staff_time_entries_closed_chk check ((status = 'closed') = (clock_out_at is not null)),
  constraint staff_time_entries_correction_chk check (
    corrected_at is null or length(btrim(coalesce(correction_reason, ''))) >= 3)
);
create index if not exists idx_staff_time_entries_org on public.staff_time_entries(org_id, clock_in_at desc);
create index if not exists idx_staff_time_entries_profile on public.staff_time_entries(profile_id, clock_in_at desc);
-- one open shift per person
create unique index if not exists staff_time_entries_one_open
  on public.staff_time_entries(profile_id) where status = 'open';

drop trigger if exists trg_staff_time_entries_updated on public.staff_time_entries;
create trigger trg_staff_time_entries_updated before update on public.staff_time_entries
  for each row execute function public.set_updated_at();
drop trigger if exists trg_staff_time_entries_org on public.staff_time_entries;
create trigger trg_staff_time_entries_org before insert or update on public.staff_time_entries
  for each row execute function public.staff_same_org_guard('profile_id', 'coach_id', 'venue_id', 'program_session_id', 'event_id');
drop trigger if exists trg_audit_staff_time_entries on public.staff_time_entries;
create trigger trg_audit_staff_time_entries after insert or update or delete on public.staff_time_entries
  for each row execute function public.audit_trigger();

create table if not exists public.staff_time_breaks (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  time_entry_id uuid not null references public.staff_time_entries(id) on delete cascade,
  started_at    timestamptz not null,
  ended_at      timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint staff_time_breaks_times_chk check (ended_at is null or ended_at > started_at)
);
create index if not exists idx_staff_time_breaks_org on public.staff_time_breaks(org_id);
create index if not exists idx_staff_time_breaks_entry on public.staff_time_breaks(time_entry_id);
create unique index if not exists staff_time_breaks_one_open
  on public.staff_time_breaks(time_entry_id) where ended_at is null;

drop trigger if exists trg_staff_time_breaks_updated on public.staff_time_breaks;
create trigger trg_staff_time_breaks_updated before update on public.staff_time_breaks
  for each row execute function public.set_updated_at();
drop trigger if exists trg_staff_time_breaks_org on public.staff_time_breaks;
create trigger trg_staff_time_breaks_org before insert or update on public.staff_time_breaks
  for each row execute function public.staff_same_org_guard('time_entry_id');
drop trigger if exists trg_audit_staff_time_breaks on public.staff_time_breaks;
create trigger trg_audit_staff_time_breaks after insert or update or delete on public.staff_time_breaks
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- 4) Timesheet approvals (an approved period locks its entries)
-- ---------------------------------------------------------------------------
create table if not exists public.staff_timesheets (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  period_start    date not null,
  period_end      date not null,
  status          text not null default 'approved',
  planned_minutes integer not null default 0,
  worked_minutes  integer not null default 0,
  note            text check (note is null or length(note) <= 500),
  approved_by     uuid references public.profiles(id) on delete set null,
  approved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint staff_timesheets_period_chk check (period_end >= period_start and period_end - period_start <= 62),
  constraint staff_timesheets_status_chk check (status in ('approved', 'reopened')),
  unique (org_id, profile_id, period_start, period_end)
);
create index if not exists idx_staff_timesheets_org on public.staff_timesheets(org_id, period_start desc);
create index if not exists idx_staff_timesheets_profile on public.staff_timesheets(profile_id, period_start);

drop trigger if exists trg_staff_timesheets_updated on public.staff_timesheets;
create trigger trg_staff_timesheets_updated before update on public.staff_timesheets
  for each row execute function public.set_updated_at();
drop trigger if exists trg_staff_timesheets_org on public.staff_timesheets;
create trigger trg_staff_timesheets_org before insert or update on public.staff_timesheets
  for each row execute function public.staff_same_org_guard('profile_id');
drop trigger if exists trg_audit_staff_timesheets on public.staff_timesheets;
create trigger trg_audit_staff_timesheets after insert or update or delete on public.staff_timesheets
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- 5) Lesson plans
-- ---------------------------------------------------------------------------
create table if not exists public.lesson_plans (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  program_session_id  uuid references public.program_sessions(id) on delete cascade,
  event_id            uuid references public.events(id) on delete cascade,
  coach_id            uuid references public.coaches(id) on delete set null,
  author_id           uuid references public.profiles(id) on delete set null,
  title               text check (title is null or length(title) <= 160),
  objectives          text check (objectives is null or length(objectives) <= 4000),
  drills              jsonb not null default '[]'::jsonb,
  notes               text check (notes is null or length(notes) <= 4000),
  attachment_path     text,
  attachment_name     text check (attachment_name is null or length(attachment_name) <= 200),
  shared_with_parents boolean not null default false,
  shared_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint lesson_plans_one_item_chk check ((program_session_id is null) <> (event_id is null)),
  constraint lesson_plans_drills_chk check (jsonb_typeof(drills) = 'array' and jsonb_array_length(drills) <= 50),
  constraint lesson_plans_attachment_chk check (
    attachment_path is null or attachment_path like org_id::text || '/' || id::text || '/%')
);
create index if not exists idx_lesson_plans_org on public.lesson_plans(org_id);
create unique index if not exists lesson_plans_one_per_session on public.lesson_plans(program_session_id) where program_session_id is not null;
create unique index if not exists lesson_plans_one_per_event on public.lesson_plans(event_id) where event_id is not null;
create index if not exists idx_lesson_plans_coach on public.lesson_plans(coach_id);

drop trigger if exists trg_lesson_plans_updated on public.lesson_plans;
create trigger trg_lesson_plans_updated before update on public.lesson_plans
  for each row execute function public.set_updated_at();
drop trigger if exists trg_lesson_plans_org on public.lesson_plans;
create trigger trg_lesson_plans_org before insert or update on public.lesson_plans
  for each row execute function public.staff_same_org_guard('program_session_id', 'event_id', 'coach_id', 'author_id');
drop trigger if exists trg_audit_lesson_plans on public.lesson_plans;
create trigger trg_audit_lesson_plans after insert or update or delete on public.lesson_plans
  for each row execute function public.audit_trigger();

-- May the caller write the lesson plan of this session / event?
-- (admin, the lead coach of the programme session, a coach of the event's team)
create or replace function public.can_plan_lesson(p_session uuid, p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_session is not null then exists (
      select 1 from public.program_sessions ps
       where ps.id = p_session and ps.org_id = public.current_org_id()
         and (public.is_admin() or (ps.coach_id is not null and ps.coach_id = public.current_coach_id())))
    when p_event is not null then public.can_manage_event(p_event)
    else false
  end;
$$;
revoke all on function public.can_plan_lesson(uuid, uuid) from public, anon;
grant execute on function public.can_plan_lesson(uuid, uuid) to authenticated, service_role;

-- May the caller read a lesson plan with these values? (row-based so the
-- policy also works for the RETURNING row of an insert)
create or replace function public.can_read_lesson_plan_row(
  p_org uuid, p_coach uuid, p_session uuid, p_event uuid, p_shared boolean
)
returns boolean language sql stable security definer set search_path = public as $$
  select p_org = public.current_org_id()
     and (
       public.is_admin()
       or (p_coach is not null and p_coach = public.current_coach_id())
       or public.can_plan_lesson(p_session, p_event)
       or (coalesce(p_shared, false) and (
             (p_session is not null and exists (
                select 1 from public.program_sessions ps
                 where ps.id = p_session and ps.org_id = p_org
                   and public.guardian_has_athlete_in_program(ps.program_id)))
          or (p_event is not null and exists (
                select 1 from public.events e
                 where e.id = p_event and e.org_id = p_org
                   and ((e.team_id is not null and public.guardian_has_athlete_on_team(e.team_id))
                     or (e.team_id is null and public.is_any_guardian()))))))
     );
$$;
revoke all on function public.can_read_lesson_plan_row(uuid, uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.can_read_lesson_plan_row(uuid, uuid, uuid, uuid, boolean) to authenticated, service_role;

create or replace function public.can_read_lesson_plan(p_plan uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.lesson_plans lp
     where lp.id = p_plan
       and public.can_read_lesson_plan_row(lp.org_id, lp.coach_id, lp.program_session_id, lp.event_id, lp.shared_with_parents)
  );
$$;
revoke all on function public.can_read_lesson_plan(uuid) from public, anon;
grant execute on function public.can_read_lesson_plan(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) Club events (things not covered by teams / programmes / camps)
-- ---------------------------------------------------------------------------
create table if not exists public.club_events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  title       text not null check (length(btrim(title)) between 1 and 160),
  type        text not null default 'other',
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  all_day     boolean not null default false,
  venue_id    uuid references public.venues(id) on delete set null,
  location    text check (location is null or length(location) <= 200),
  audience    text not null default 'everyone',
  description text check (description is null or length(description) <= 4000),
  url         text check (url is null or (length(url) <= 500 and url ~* '^https://')),
  team_id     uuid references public.teams(id) on delete set null,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint club_events_type_chk check (type in ('international', 'tournament', 'meeting', 'social', 'holiday', 'trip', 'other')),
  constraint club_events_audience_chk check (audience in ('everyone', 'staff', 'parents')),
  constraint club_events_time_chk check (ends_at >= starts_at and ends_at - starts_at <= interval '62 days')
);
create index if not exists idx_club_events_org on public.club_events(org_id, starts_at);

drop trigger if exists trg_club_events_updated on public.club_events;
create trigger trg_club_events_updated before update on public.club_events
  for each row execute function public.set_updated_at();
drop trigger if exists trg_club_events_org on public.club_events;
create trigger trg_club_events_org before insert or update on public.club_events
  for each row execute function public.staff_same_org_guard('venue_id', 'team_id');
drop trigger if exists trg_audit_club_events on public.club_events;
create trigger trg_audit_club_events after insert or update or delete on public.club_events
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- 7) Calendar subscription tokens (hash only; raw token lives in the URL)
-- ---------------------------------------------------------------------------
create table if not exists public.calendar_feed_tokens (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_calendar_feed_tokens_org on public.calendar_feed_tokens(org_id);
create index if not exists idx_calendar_feed_tokens_profile on public.calendar_feed_tokens(profile_id);
create unique index if not exists calendar_feed_tokens_one_active
  on public.calendar_feed_tokens(profile_id) where revoked_at is null;

drop trigger if exists trg_calendar_feed_tokens_updated on public.calendar_feed_tokens;
create trigger trg_calendar_feed_tokens_updated before update on public.calendar_feed_tokens
  for each row execute function public.set_updated_at();
drop trigger if exists trg_calendar_feed_tokens_org on public.calendar_feed_tokens;
create trigger trg_calendar_feed_tokens_org before insert or update on public.calendar_feed_tokens
  for each row execute function public.staff_same_org_guard('profile_id');

-- ---------------------------------------------------------------------------
-- 8) RLS
-- ---------------------------------------------------------------------------
alter table public.staff_shift_templates enable row level security;
alter table public.staff_time_entries    enable row level security;
alter table public.staff_time_breaks     enable row level security;
alter table public.staff_timesheets      enable row level security;
alter table public.lesson_plans          enable row level security;
alter table public.club_events           enable row level security;
alter table public.calendar_feed_tokens  enable row level security;

-- Shift templates: admin/finance and the employee read; admins write.
drop policy if exists sst_select on public.staff_shift_templates;
create policy sst_select on public.staff_shift_templates for select
  using (org_id = public.current_org_id() and (public.is_finance() or profile_id = auth.uid()));
drop policy if exists sst_insert on public.staff_shift_templates;
create policy sst_insert on public.staff_shift_templates for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists sst_update on public.staff_shift_templates;
create policy sst_update on public.staff_shift_templates for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists sst_delete on public.staff_shift_templates;
create policy sst_delete on public.staff_shift_templates for delete
  using (org_id = public.current_org_id() and public.is_admin());

-- Time entries / breaks / timesheets: read by admin/finance and the employee;
-- no direct writes at all (RPCs below).
do $$
declare t text;
begin
  foreach t in array array['staff_time_entries', 'staff_timesheets'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select using (org_id = public.current_org_id() and (public.is_finance() or profile_id = auth.uid()))', t || '_select', t);
  end loop;
  foreach t in array array['staff_time_entries', 'staff_time_breaks', 'staff_timesheets'] loop
    execute format('drop policy if exists %I on public.%I', t || '_no_insert', t);
    execute format('create policy %I on public.%I for insert with check (false)', t || '_no_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_no_update', t);
    execute format('create policy %I on public.%I for update using (false) with check (false)', t || '_no_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_no_delete', t);
    execute format('create policy %I on public.%I for delete using (false)', t || '_no_delete', t);
  end loop;
end $$;
drop policy if exists staff_time_breaks_select on public.staff_time_breaks;
create policy staff_time_breaks_select on public.staff_time_breaks for select
  using (org_id = public.current_org_id() and (public.is_finance() or exists (
    select 1 from public.staff_time_entries e where e.id = time_entry_id and e.profile_id = auth.uid())));

-- Lesson plans
drop policy if exists lesson_plans_select on public.lesson_plans;
create policy lesson_plans_select on public.lesson_plans for select
  using (public.can_read_lesson_plan_row(org_id, coach_id, program_session_id, event_id, shared_with_parents));
drop policy if exists lesson_plans_insert on public.lesson_plans;
create policy lesson_plans_insert on public.lesson_plans for insert
  with check (
    org_id = public.current_org_id()
    and public.can_plan_lesson(program_session_id, event_id)
    and author_id = auth.uid()
    and (public.is_admin() or coach_id = public.current_coach_id()));
drop policy if exists lesson_plans_update on public.lesson_plans;
create policy lesson_plans_update on public.lesson_plans for update
  using (org_id = public.current_org_id()
         and (public.is_admin() or (coach_id is not null and coach_id = public.current_coach_id())))
  with check (org_id = public.current_org_id()
         and public.can_plan_lesson(program_session_id, event_id)
         and (public.is_admin() or coach_id = public.current_coach_id()));
drop policy if exists lesson_plans_delete on public.lesson_plans;
create policy lesson_plans_delete on public.lesson_plans for delete
  using (org_id = public.current_org_id()
         and (public.is_admin() or (coach_id is not null and coach_id = public.current_coach_id())));

-- Club events: audience-scoped reads, admin writes.
drop policy if exists club_events_select on public.club_events;
create policy club_events_select on public.club_events for select
  using (org_id = public.current_org_id() and (
    public.is_admin()
    or audience = 'everyone'
    or (audience = 'staff' and public.is_staff())
    or (audience = 'parents' and public.is_any_guardian())));
drop policy if exists club_events_insert on public.club_events;
create policy club_events_insert on public.club_events for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists club_events_update on public.club_events;
create policy club_events_update on public.club_events for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists club_events_delete on public.club_events;
create policy club_events_delete on public.club_events for delete
  using (org_id = public.current_org_id() and public.is_admin());

-- Feed tokens: each user manages only their own.
drop policy if exists cft_select on public.calendar_feed_tokens;
create policy cft_select on public.calendar_feed_tokens for select
  using (org_id = public.current_org_id() and profile_id = auth.uid());
drop policy if exists cft_insert on public.calendar_feed_tokens;
create policy cft_insert on public.calendar_feed_tokens for insert
  with check (org_id = public.current_org_id() and profile_id = auth.uid() and revoked_at is null);
drop policy if exists cft_update on public.calendar_feed_tokens;
create policy cft_update on public.calendar_feed_tokens for update
  using (org_id = public.current_org_id() and profile_id = auth.uid())
  with check (org_id = public.current_org_id() and profile_id = auth.uid());
drop policy if exists cft_delete on public.calendar_feed_tokens;
create policy cft_delete on public.calendar_feed_tokens for delete
  using (org_id = public.current_org_id() and profile_id = auth.uid());

grant select, insert, update, delete on
  public.staff_shift_templates, public.staff_time_entries, public.staff_time_breaks,
  public.staff_timesheets, public.lesson_plans, public.club_events, public.calendar_feed_tokens
  to authenticated;
grant all on
  public.staff_shift_templates, public.staff_time_entries, public.staff_time_breaks,
  public.staff_timesheets, public.lesson_plans, public.club_events, public.calendar_feed_tokens
  to service_role;

-- ---------------------------------------------------------------------------
-- 9) Lesson-plan attachments: private bucket, key <org_id>/<plan_id>/<file>
-- ---------------------------------------------------------------------------
create or replace function public.lesson_plan_file_access(p_name text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_parts text[];
  v_plan  public.lesson_plans%rowtype;
  v_re    constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if auth.uid() is null or p_name is null then return false; end if;
  v_parts := string_to_array(p_name, '/');
  if coalesce(array_length(v_parts, 1), 0) <> 3 or v_parts[3] = '' then return false; end if;
  if v_parts[1] !~ v_re or v_parts[2] !~ v_re then return false; end if;
  if v_parts[1]::uuid is distinct from public.current_org_id() then return false; end if;
  select * into v_plan from public.lesson_plans where id = v_parts[2]::uuid and org_id = v_parts[1]::uuid;
  if not found then return false; end if;
  if not p_write then return public.can_read_lesson_plan(v_plan.id); end if;
  return public.is_admin() or (v_plan.coach_id is not null and v_plan.coach_id = public.current_coach_id());
end $$;
revoke all on function public.lesson_plan_file_access(text, boolean) from public, anon;
grant execute on function public.lesson_plan_file_access(text, boolean) to authenticated, service_role;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
      values ('lesson-plans', 'lesson-plans', false)
      on conflict (id) do update set public = false;
    if exists (select 1 from information_schema.columns
                where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
      execute $q$update storage.buckets set file_size_limit = 10485760 where id = 'lesson-plans'$q$;
    end if;
    if exists (select 1 from information_schema.columns
                where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
      execute $q$update storage.buckets set allowed_mime_types = array['application/pdf','image/jpeg','image/png','image/webp']
                 where id = 'lesson-plans'$q$;
    end if;
  end if;
end $$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    execute $p$drop policy if exists lesson_plans_files_select on storage.objects$p$;
    execute $p$create policy lesson_plans_files_select on storage.objects for select to authenticated
      using (bucket_id = 'lesson-plans' and public.lesson_plan_file_access(name, false))$p$;
    execute $p$drop policy if exists lesson_plans_files_insert on storage.objects$p$;
    execute $p$create policy lesson_plans_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'lesson-plans' and public.lesson_plan_file_access(name, true))$p$;
    execute $p$drop policy if exists lesson_plans_files_update on storage.objects$p$;
    execute $p$create policy lesson_plans_files_update on storage.objects for update to authenticated
      using (bucket_id = 'lesson-plans' and public.lesson_plan_file_access(name, true))
      with check (bucket_id = 'lesson-plans' and public.lesson_plan_file_access(name, true))$p$;
    execute $p$drop policy if exists lesson_plans_files_delete on storage.objects$p$;
    execute $p$create policy lesson_plans_files_delete on storage.objects for delete to authenticated
      using (bucket_id = 'lesson-plans' and public.lesson_plan_file_access(name, true))$p$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 10) Clock RPCs (staff; server time; one open shift per person)
-- ---------------------------------------------------------------------------

-- Has this instant (in the org's time zone) fallen inside an approved timesheet?
create or replace function public.staff_period_locked(p_org uuid, p_profile uuid, p_at timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.staff_timesheets ts
     where ts.org_id = p_org and ts.profile_id = p_profile and ts.status = 'approved'
       and (p_at at time zone public.training_org_tz(p_org))::date between ts.period_start and ts.period_end
  );
$$;
revoke all on function public.staff_period_locked(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.staff_period_locked(uuid, uuid, timestamptz) to authenticated, service_role;

-- Flag shifts left open longer than staff_max_shift() as "missed" (they then
-- count zero hours until an admin corrects them). Admins: own org; server
-- jobs (service role): every org. Returns the number of flagged shifts.
create or replace function public.staff_flag_missed_clockouts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  if public.staff_is_service_caller() then
    update public.staff_time_entries set status = 'missed'
     where status = 'open' and clock_in_at < now() - public.staff_max_shift();
  elsif public.is_admin() then
    update public.staff_time_entries set status = 'missed'
     where status = 'open' and org_id = public.current_org_id()
       and clock_in_at < now() - public.staff_max_shift();
  else
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  get diagnostics v_n = row_count;
  -- Close the open breaks of flagged shifts as well.
  update public.staff_time_breaks b set ended_at = greatest(b.started_at + interval '1 second', e.clock_in_at + public.staff_max_shift())
    from public.staff_time_entries e
   where b.time_entry_id = e.id and b.ended_at is null and e.status = 'missed';
  return v_n;
end;
$$;
revoke all on function public.staff_flag_missed_clockouts() from public, anon;
grant execute on function public.staff_flag_missed_clockouts() to authenticated, service_role;

-- Clock in. Links the shift to the caller's programme session / team event
-- happening around now (or the one passed, if the caller may access it).
-- p_geo: the distance flag computed by the server action ('ok', 'too_far',
-- 'unavailable', 'not_checked'); coordinates never reach the database.
create or replace function public.staff_clock_in(
  p_venue uuid default null,
  p_geo text default 'not_checked',
  p_note text default null,
  p_program_session uuid default null,
  p_event uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid := public.current_org_id();
  v_uid     uuid := auth.uid();
  v_coach   uuid := public.current_coach_id();
  v_session uuid := p_program_session;
  v_event   uuid := p_event;
  v_venue   uuid := p_venue;
  v_id      uuid;
begin
  if v_uid is null or v_org is null or not public.is_staff() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if coalesce(p_geo, 'not_checked') not in ('not_checked', 'ok', 'too_far', 'unavailable') then
    raise exception 'INVALID_GEO' using errcode = '22023';
  end if;

  -- A shift left open too long is flagged, not silently extended.
  update public.staff_time_entries set status = 'missed'
   where profile_id = v_uid and status = 'open' and clock_in_at < now() - public.staff_max_shift();
  if exists (select 1 from public.staff_time_entries where profile_id = v_uid and status = 'open') then
    raise exception 'ALREADY_CLOCKED_IN' using errcode = 'P0001';
  end if;

  if v_venue is not null and not exists (select 1 from public.venues where id = v_venue and org_id = v_org) then
    raise exception 'VENUE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_session is not null and not exists (
       select 1 from public.program_sessions where id = v_session and org_id = v_org
          and (public.is_admin() or coach_id = v_coach)) then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_event is not null and not exists (
       select 1 from public.events e where e.id = v_event and e.org_id = v_org
          and (public.is_admin() or public.coach_coaches_team(e.team_id))) then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Auto-link: the caller's session / event running now or starting soon.
  if v_session is null and v_event is null and v_coach is not null then
    select ps.id into v_session
      from public.program_sessions ps
     where ps.org_id = v_org and ps.coach_id = v_coach
       and now() between ps.starts_at - interval '60 minutes'
                     and coalesce(ps.ends_at, ps.starts_at + interval '2 hours')
     order by abs(extract(epoch from ps.starts_at - now()))
     limit 1;
    if v_session is null then
      select e.id into v_event
        from public.events e
        join public.team_coaches tc on tc.team_id = e.team_id and tc.coach_id = v_coach
       where e.org_id = v_org and e.status in ('scheduled', 'postponed')
         and now() between e.starts_at - interval '60 minutes' and e.ends_at
       order by abs(extract(epoch from e.starts_at - now()))
       limit 1;
    end if;
  end if;
  if v_venue is null and v_event is not null then
    select venue_id into v_venue from public.events where id = v_event;
  end if;

  insert into public.staff_time_entries
    (org_id, profile_id, coach_id, venue_id, program_session_id, event_id, clock_in_at, status, geo_status, source, note)
  values
    (v_org, v_uid, v_coach, v_venue, v_session, v_event, now(), 'open', coalesce(p_geo, 'not_checked'), 'app',
     nullif(btrim(p_note), ''))
  returning id into v_id;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, v_uid, 'staff.clock_in', 'staff_time_entries', v_id,
          jsonb_build_object('geo_status', coalesce(p_geo, 'not_checked'), 'linked', v_session is not null or v_event is not null));
  return v_id;
end;
$$;
revoke all on function public.staff_clock_in(uuid, text, text, uuid, uuid) from public, anon;
grant execute on function public.staff_clock_in(uuid, text, text, uuid, uuid) to authenticated, service_role;

-- Clock out of the caller's open shift (closes an open break too). A shift
-- open longer than staff_max_shift() is flagged as missed instead.
create or replace function public.staff_clock_out(p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_e   public.staff_time_entries%rowtype;
begin
  if v_uid is null or not public.is_staff() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  select * into v_e from public.staff_time_entries
   where profile_id = v_uid and status = 'open' and org_id = public.current_org_id()
   for update;
  if not found then
    raise exception 'NOT_CLOCKED_IN' using errcode = 'P0001';
  end if;
  update public.staff_time_breaks set ended_at = greatest(now(), started_at + interval '1 second')
   where time_entry_id = v_e.id and ended_at is null;
  if now() - v_e.clock_in_at > public.staff_max_shift() then
    update public.staff_time_entries set status = 'missed' where id = v_e.id;
    insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
    values (v_e.org_id, v_uid, 'staff.clock_out_missed', 'staff_time_entries', v_e.id, null);
    return jsonb_build_object('id', v_e.id, 'status', 'missed');
  end if;
  update public.staff_time_entries
     set clock_out_at = greatest(now(), clock_in_at + interval '1 second'), status = 'closed',
         note = coalesce(nullif(btrim(p_note), ''), note)
   where id = v_e.id;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_e.org_id, v_uid, 'staff.clock_out', 'staff_time_entries', v_e.id, null);
  return jsonb_build_object('id', v_e.id, 'status', 'closed');
end;
$$;
revoke all on function public.staff_clock_out(text) from public, anon;
grant execute on function public.staff_clock_out(text) to authenticated, service_role;

-- Start / end a break inside the caller's open shift.
create or replace function public.staff_break(p_start boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_e   public.staff_time_entries%rowtype;
  v_id  uuid;
begin
  if v_uid is null or not public.is_staff() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  select * into v_e from public.staff_time_entries
   where profile_id = v_uid and status = 'open' and org_id = public.current_org_id()
   for update;
  if not found then raise exception 'NOT_CLOCKED_IN' using errcode = 'P0001'; end if;
  if p_start then
    if exists (select 1 from public.staff_time_breaks where time_entry_id = v_e.id and ended_at is null) then
      raise exception 'ALREADY_ON_BREAK' using errcode = 'P0001';
    end if;
    insert into public.staff_time_breaks (org_id, time_entry_id, started_at)
    values (v_e.org_id, v_e.id, greatest(now(), v_e.clock_in_at)) returning id into v_id;
  else
    update public.staff_time_breaks set ended_at = greatest(now(), started_at + interval '1 second')
     where time_entry_id = v_e.id and ended_at is null
     returning id into v_id;
    if v_id is null then raise exception 'NOT_ON_BREAK' using errcode = 'P0001'; end if;
  end if;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_e.org_id, v_uid, case when p_start then 'staff.break_start' else 'staff.break_end' end,
          'staff_time_breaks', v_id, null);
  return v_id;
end;
$$;
revoke all on function public.staff_break(boolean) from public, anon;
grant execute on function public.staff_break(boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 11) Admin corrections (reason required, audited, blocked in approved periods)
-- ---------------------------------------------------------------------------

-- Create (p_entry null) or correct a time entry. Breaks are replaced by
-- p_breaks: [{"start": "...", "end": "..."}] (null = keep existing breaks).
create or replace function public.staff_save_time_entry(
  p_entry uuid,
  p_profile uuid,
  p_clock_in timestamptz,
  p_clock_out timestamptz,
  p_reason text,
  p_venue uuid default null,
  p_breaks jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid := public.current_org_id();
  v_uid    uuid := auth.uid();
  v_old    public.staff_time_entries%rowtype;
  v_id     uuid;
  v_coach  uuid;
  v_b      jsonb;
  v_bs     timestamptz;
  v_be     timestamptz;
begin
  if v_uid is null or v_org is null or not public.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;
  if p_clock_in is null or p_clock_out is null or p_clock_out <= p_clock_in
     or p_clock_out - p_clock_in > interval '24 hours' then
    raise exception 'INVALID_TIMES' using errcode = '22023';
  end if;
  if p_venue is not null and not exists (select 1 from public.venues where id = p_venue and org_id = v_org) then
    raise exception 'VENUE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_entry is null then
    if not exists (
      select 1 from public.staff_roles sr where sr.profile_id = p_profile and sr.org_id = v_org
         and sr.role in ('admin', 'finance', 'coach')) then
      raise exception 'EMPLOYEE_NOT_FOUND' using errcode = 'P0002';
    end if;
    if public.staff_period_locked(v_org, p_profile, p_clock_in) then
      raise exception 'TIMESHEET_APPROVED' using errcode = 'P0001';
    end if;
    select id into v_coach from public.coaches where profile_id = p_profile and org_id = v_org limit 1;
    insert into public.staff_time_entries
      (org_id, profile_id, coach_id, venue_id, clock_in_at, clock_out_at, status, source,
       corrected_by, corrected_at, correction_reason)
    values
      (v_org, p_profile, v_coach, p_venue, p_clock_in, p_clock_out, 'closed', 'admin',
       v_uid, now(), btrim(p_reason))
    returning id into v_id;
  else
    select * into v_old from public.staff_time_entries where id = p_entry and org_id = v_org for update;
    if not found then raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0002'; end if;
    if public.staff_period_locked(v_org, v_old.profile_id, v_old.clock_in_at)
       or public.staff_period_locked(v_org, v_old.profile_id, p_clock_in) then
      raise exception 'TIMESHEET_APPROVED' using errcode = 'P0001';
    end if;
    update public.staff_time_entries
       set clock_in_at = p_clock_in, clock_out_at = p_clock_out, status = 'closed',
           venue_id = coalesce(p_venue, venue_id),
           corrected_by = v_uid, corrected_at = now(), correction_reason = btrim(p_reason)
     where id = p_entry;
    v_id := p_entry;
  end if;

  if p_breaks is not null then
    if jsonb_typeof(p_breaks) <> 'array' or jsonb_array_length(p_breaks) > 10 then
      raise exception 'INVALID_BREAKS' using errcode = '22023';
    end if;
    delete from public.staff_time_breaks where time_entry_id = v_id;
    for v_b in select * from jsonb_array_elements(p_breaks) loop
      v_bs := (v_b->>'start')::timestamptz;
      v_be := (v_b->>'end')::timestamptz;
      if v_bs is null or v_be is null or v_be <= v_bs or v_bs < p_clock_in or v_be > p_clock_out then
        raise exception 'INVALID_BREAKS' using errcode = '22023';
      end if;
      insert into public.staff_time_breaks (org_id, time_entry_id, started_at, ended_at)
      values (v_org, v_id, v_bs, v_be);
    end loop;
  else
    -- keep breaks inside the corrected shift
    delete from public.staff_time_breaks where time_entry_id = v_id
       and (started_at >= p_clock_out or coalesce(ended_at, p_clock_out) <= p_clock_in);
    update public.staff_time_breaks
       set started_at = greatest(started_at, p_clock_in),
           ended_at = least(coalesce(ended_at, p_clock_out), p_clock_out)
     where time_entry_id = v_id;
  end if;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (v_org, v_uid, case when p_entry is null then 'staff.entry_create' else 'staff.entry_correct' end,
          'staff_time_entries', v_id,
          case when p_entry is null then null
               else jsonb_build_object('clock_in_at', v_old.clock_in_at, 'clock_out_at', v_old.clock_out_at, 'status', v_old.status) end,
          jsonb_build_object('clock_in_at', p_clock_in, 'clock_out_at', p_clock_out, 'reason', btrim(p_reason)));
  return v_id;
end;
$$;
revoke all on function public.staff_save_time_entry(uuid, uuid, timestamptz, timestamptz, text, uuid, jsonb) from public, anon;
grant execute on function public.staff_save_time_entry(uuid, uuid, timestamptz, timestamptz, text, uuid, jsonb) to authenticated, service_role;

create or replace function public.staff_delete_time_entry(p_entry uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_old public.staff_time_entries%rowtype;
begin
  if auth.uid() is null or v_org is null or not public.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;
  select * into v_old from public.staff_time_entries where id = p_entry and org_id = v_org for update;
  if not found then raise exception 'ENTRY_NOT_FOUND' using errcode = 'P0002'; end if;
  if public.staff_period_locked(v_org, v_old.profile_id, v_old.clock_in_at) then
    raise exception 'TIMESHEET_APPROVED' using errcode = 'P0001';
  end if;
  delete from public.staff_time_entries where id = p_entry;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (v_org, auth.uid(), 'staff.entry_delete', 'staff_time_entries', p_entry,
          jsonb_build_object('clock_in_at', v_old.clock_in_at, 'clock_out_at', v_old.clock_out_at),
          jsonb_build_object('reason', btrim(p_reason)));
end;
$$;
revoke all on function public.staff_delete_time_entry(uuid, text) from public, anon;
grant execute on function public.staff_delete_time_entry(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 12) staff_hours(org, from, to) — the payout hook
-- ---------------------------------------------------------------------------
-- One row per employee (anyone with a staff role in the org, or anyone with a
-- time entry / planned shift in the window). Window = club-local days
-- [p_from, p_to] in the org's time zone. Minutes:
--   planned_minutes  weekly templates expanded day by day (overnight shifts
--                    count on their start day; DST-correct wall-clock maths)
--   worked_minutes   closed shifts clipped to the window, minus their breaks
--   break_minutes    breaks of those shifts clipped to the window
--   open_entries     shifts still running (not counted)
--   missed_entries   missed clock-outs awaiting correction (not counted)
--   approved         every day of the window is covered by approved timesheets
-- Callers: finance/admin of p_org, or server code (service role).
create or replace function public.staff_hours(p_org uuid, p_from date, p_to date)
returns table (
  profile_id      uuid,
  coach_id        uuid,
  full_name       text,
  planned_minutes integer,
  worked_minutes  integer,
  break_minutes   integer,
  entry_count     integer,
  open_entries    integer,
  missed_entries  integer,
  approved        boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_ws timestamptz;
  v_we timestamptz;
begin
  if p_org is null or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'INVALID_RANGE' using errcode = '22023';
  end if;
  if not (public.staff_is_service_caller() or (p_org = public.current_org_id() and public.is_finance())) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  v_tz := public.training_org_tz(p_org);
  v_ws := (p_from::timestamp) at time zone v_tz;
  v_we := ((p_to + 1)::timestamp) at time zone v_tz;

  return query
  with people as (
    select sr.profile_id as pid from public.staff_roles sr
     where sr.org_id = p_org and sr.role in ('admin', 'finance', 'coach')
    union
    select e.profile_id from public.staff_time_entries e
     where e.org_id = p_org and e.clock_in_at < v_we and coalesce(e.clock_out_at, e.clock_in_at) >= v_ws
    union
    select t.profile_id from public.staff_shift_templates t where t.org_id = p_org and t.is_active
  ),
  days as (
    select d::date as day from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
  ),
  planned as (
    select t.profile_id as pid,
           sum(extract(epoch from (
             ((dd.day + t.end_time + case when t.end_time <= t.start_time then interval '1 day' else interval '0' end)::timestamp at time zone v_tz)
             - ((dd.day + t.start_time)::timestamp at time zone v_tz)
           )) / 60)::integer as mins
      from public.staff_shift_templates t
      join days dd on extract(isodow from dd.day) = t.weekday
     where t.org_id = p_org and t.is_active
       and (t.valid_from is null or dd.day >= t.valid_from)
       and (t.valid_until is null or dd.day <= t.valid_until)
     group by t.profile_id
  ),
  closed as (
    select e.id, e.profile_id as pid,
           greatest(e.clock_in_at, v_ws) as s, least(e.clock_out_at, v_we) as f
      from public.staff_time_entries e
     where e.org_id = p_org and e.status = 'closed'
       and e.clock_in_at < v_we and e.clock_out_at > v_ws
  ),
  brk as (
    select c.id, coalesce(sum(case when b.id is null then 0 else greatest(0, extract(epoch from
             least(coalesce(b.ended_at, c.f), c.f) - greatest(b.started_at, c.s))) end), 0) as secs
      from closed c
      left join public.staff_time_breaks b on b.time_entry_id = c.id
     group by c.id
  ),
  worked as (
    select c.pid,
           sum(extract(epoch from c.f - c.s)) as gross_secs,
           sum(coalesce(b.secs, 0)) as break_secs,
           count(*) as n
      from closed c left join brk b on b.id = c.id
     group by c.pid
  ),
  flags as (
    select e.profile_id as pid,
           count(*) filter (where e.status = 'open') as n_open,
           count(*) filter (where e.status = 'missed') as n_missed
      from public.staff_time_entries e
     where e.org_id = p_org and e.status in ('open', 'missed')
       and e.clock_in_at < v_we and e.clock_in_at >= v_ws - public.staff_max_shift()
     group by e.profile_id
  ),
  appr as (
    select pp.pid,
           not exists (
             select 1 from days dd
              where not exists (
                select 1 from public.staff_timesheets ts
                 where ts.org_id = p_org and ts.profile_id = pp.pid and ts.status = 'approved'
                   and dd.day between ts.period_start and ts.period_end)) as ok
      from people pp
  )
  select pp.pid,
         (select c.id from public.coaches c where c.profile_id = pp.pid and c.org_id = p_org limit 1),
         coalesce(pr.full_name, pr.email::text),
         coalesce(pl.mins, 0),
         greatest(0, round((coalesce(w.gross_secs, 0) - coalesce(w.break_secs, 0)) / 60))::integer,
         round(coalesce(w.break_secs, 0) / 60)::integer,
         coalesce(w.n, 0)::integer,
         coalesce(fl.n_open, 0)::integer,
         coalesce(fl.n_missed, 0)::integer,
         coalesce(ap.ok, false)
    from people pp
    join public.profiles pr on pr.id = pp.pid and pr.org_id = p_org
    left join planned pl on pl.pid = pp.pid
    left join worked w on w.pid = pp.pid
    left join flags fl on fl.pid = pp.pid
    left join appr ap on ap.pid = pp.pid
   order by coalesce(pr.full_name, pr.email::text);
end;
$$;
revoke all on function public.staff_hours(uuid, date, date) from public, anon;
grant execute on function public.staff_hours(uuid, date, date) to authenticated, service_role;
comment on function public.staff_hours(uuid, date, date) is
  'Planned vs worked minutes per employee for club-local days [p_from, p_to]. '
  'Payout hook: use worked_minutes where approved = true. See docs/product/staff-time.md.';

-- ---------------------------------------------------------------------------
-- 13) Timesheet approval (snapshot of staff_hours; locks the period)
-- ---------------------------------------------------------------------------
create or replace function public.staff_set_timesheet(
  p_profile uuid, p_from date, p_to date, p_approve boolean, p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_uid uuid := auth.uid();
  v_h   record;
  v_id  uuid;
begin
  if v_uid is null or v_org is null or not public.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'INVALID_RANGE' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile and org_id = v_org) then
    raise exception 'EMPLOYEE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_approve then
    select * into v_h from public.staff_hours(v_org, p_from, p_to) h where h.profile_id = p_profile;
    if coalesce(v_h.open_entries, 0) > 0 or coalesce(v_h.missed_entries, 0) > 0 then
      raise exception 'OPEN_ENTRIES' using errcode = 'P0001';
    end if;
    insert into public.staff_timesheets
      (org_id, profile_id, period_start, period_end, status, planned_minutes, worked_minutes, note, approved_by, approved_at)
    values
      (v_org, p_profile, p_from, p_to, 'approved', coalesce(v_h.planned_minutes, 0), coalesce(v_h.worked_minutes, 0),
       nullif(btrim(p_note), ''), v_uid, now())
    on conflict (org_id, profile_id, period_start, period_end) do update
      set status = 'approved', planned_minutes = excluded.planned_minutes, worked_minutes = excluded.worked_minutes,
          note = excluded.note, approved_by = excluded.approved_by, approved_at = excluded.approved_at
    returning id into v_id;
  else
    update public.staff_timesheets set status = 'reopened', note = coalesce(nullif(btrim(p_note), ''), note)
     where org_id = v_org and profile_id = p_profile and status = 'approved'
       and period_start <= p_to and period_end >= p_from
    returning id into v_id;
    if v_id is null then raise exception 'TIMESHEET_NOT_FOUND' using errcode = 'P0002'; end if;
  end if;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, v_uid, case when p_approve then 'staff.timesheet_approve' else 'staff.timesheet_reopen' end,
          'staff_timesheets', v_id, jsonb_build_object('profile_id', p_profile, 'from', p_from, 'to', p_to));
  return v_id;
end;
$$;
revoke all on function public.staff_set_timesheet(uuid, date, date, boolean, text) from public, anon;
grant execute on function public.staff_set_timesheet(uuid, date, date, boolean, text) to authenticated, service_role;
