-- ============================================================================
-- Club OS — Migration 20 · Teams, seasons, venues, schedule, games & RSVP
--
-- Sport-agnostic club operations, built ON the existing model:
--   * teams can link to an existing `programs` row (billing/registration stays
--     in programs/registrations/invoices; teams carry the sporting structure)
--   * events can link to an existing `program_sessions` row
--   * attendance continues to live in attendance_sessions/attendance_marks
--   * coach access to athletes is extended to team rosters
--
-- Tables
--   seasons            org-scoped date ranges ("2026-27")
--   venues             facilities (gym, arena, pitch complex …)
--   venue_spaces       bookable sub-spaces (court A, field 2 …)
--   teams              team per season (age group, gender, level, sport)
--   team_coaches       coach <-> team assignments (head / assistant …)
--   team_memberships   athlete <-> team (jersey number, position, status)
--   events             training / game / tournament / meeting / other
--   game_results       final score per game event
--   event_athlete_stats optional per-athlete stats (jsonb)
--   event_rsvps        availability per athlete per event
--
-- Conflict detection
--   * HARD: the same venue_space cannot hold two live events that overlap
--     (btree_gist exclusion constraint).
--   * SOFT: overlapping events at the same venue (whole venue or a space vs
--     the whole venue) are reported by public.event_conflicts() so the UI can
--     warn ("two teams booked the same arena at 16:00") and let staff confirm.
--
-- RLS
--   admin          manage everything in their org
--   finance        read everything in their org
--   coach          read all teams/events of their org; manage events, RSVPs,
--                  results and rosters of teams they are assigned to
--   parent         read the teams/events of their own children; read and set
--                  RSVPs for their own children only
-- ============================================================================

create extension if not exists "btree_gist";

-- ---- Enums -----------------------------------------------------------------
do $$ begin
  create type public.team_event_type as enum ('training', 'game', 'tournament', 'meeting', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.team_event_status as enum ('scheduled', 'postponed', 'cancelled', 'completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.rsvp_status as enum ('going', 'maybe', 'not_going');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.team_membership_status as enum ('active', 'trial', 'injured', 'inactive');
exception when duplicate_object then null; end $$;

-- ===========================================================================
-- SEASONS
-- ===========================================================================
create table if not exists public.seasons (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 80),
  starts_on   date not null,
  ends_on     date not null,
  is_current  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint seasons_dates_chk check (ends_on >= starts_on),
  unique (org_id, name)
);
create index if not exists idx_seasons_org on public.seasons(org_id, starts_on desc);
-- at most one "current" season per org
create unique index if not exists seasons_one_current
  on public.seasons(org_id) where is_current;
create trigger trg_seasons_updated before update on public.seasons
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- VENUES + SPACES
-- ===========================================================================
create table if not exists public.venues (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 120),
  address     text,
  city        text,
  postal_code text,
  country     text,
  capacity    integer check (capacity is null or capacity >= 0),
  notes       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, name)
);
create index if not exists idx_venues_org on public.venues(org_id);
create trigger trg_venues_updated before update on public.venues
  for each row execute function public.set_updated_at();

create table if not exists public.venue_spaces (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  venue_id    uuid not null references public.venues(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 80), -- "Court A", "Field 2"
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (venue_id, name)
);
create index if not exists idx_venue_spaces_venue on public.venue_spaces(venue_id);

-- ===========================================================================
-- TEAMS
-- ===========================================================================
create table if not exists public.teams (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  season_id   uuid references public.seasons(id) on delete set null,
  program_id  uuid references public.programs(id) on delete set null, -- billing / registration link
  name        text not null check (length(btrim(name)) between 1 and 120),
  sport       text,                        -- free text: basketball, soccer, swimming …
  age_group   text,                        -- "U12", "Varsity", "Senior"
  gender      text,                        -- free text: girls / boys / mixed / women / men / open
  level       text,                        -- "A", "Competitive", "Recreational", league name
  color       text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  notes       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists teams_name_per_season
  on public.teams(org_id, coalesce(season_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
create index if not exists idx_teams_org on public.teams(org_id, is_active);
create index if not exists idx_teams_program on public.teams(program_id);
create trigger trg_teams_updated before update on public.teams
  for each row execute function public.set_updated_at();

create table if not exists public.team_coaches (
  team_id     uuid not null references public.teams(id) on delete cascade,
  coach_id    uuid not null references public.coaches(id) on delete cascade,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  role        text not null default 'head' check (role in ('head', 'assistant', 'manager', 'trainer')),
  created_at  timestamptz not null default now(),
  primary key (team_id, coach_id)
);
create index if not exists idx_team_coaches_coach on public.team_coaches(coach_id);

create table if not exists public.team_memberships (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  team_id       uuid not null references public.teams(id) on delete cascade,
  athlete_id    uuid not null references public.athletes(id) on delete cascade,
  jersey_number smallint check (jersey_number is null or jersey_number between 0 and 999),
  position      text,
  status        public.team_membership_status not null default 'active',
  joined_on     date not null default current_date,
  left_on       date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (team_id, athlete_id),
  constraint team_memberships_dates_chk check (left_on is null or left_on >= joined_on)
);
create unique index if not exists team_memberships_jersey_uniq
  on public.team_memberships(team_id, jersey_number)
  where jersey_number is not null and status <> 'inactive';
create index if not exists idx_team_memberships_athlete on public.team_memberships(athlete_id);
create trigger trg_team_memberships_updated before update on public.team_memberships
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- EVENTS
-- ===========================================================================
create table if not exists public.events (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  team_id            uuid references public.teams(id) on delete cascade, -- null = club-wide
  season_id          uuid references public.seasons(id) on delete set null,
  program_session_id uuid references public.program_sessions(id) on delete set null,
  type               public.team_event_type not null default 'training',
  title              text,
  venue_id           uuid references public.venues(id) on delete set null,
  venue_space_id     uuid references public.venue_spaces(id) on delete set null,
  location_text      text,                -- free-text location for away games etc.
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  opponent           text,
  home_away          text check (home_away is null or home_away in ('home', 'away', 'neutral')),
  status             public.team_event_status not null default 'scheduled',
  notes              text,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint events_time_chk check (ends_at > starts_at and ends_at - starts_at <= interval '14 days'),
  constraint events_space_needs_venue check (venue_space_id is null or venue_id is not null),
  -- HARD conflict rule: one live event per space at a time.
  constraint events_space_no_overlap exclude using gist (
    venue_space_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (venue_space_id is not null and status in ('scheduled', 'postponed'))
);
create index if not exists idx_events_org_start on public.events(org_id, starts_at);
create index if not exists idx_events_team_start on public.events(team_id, starts_at);
create index if not exists idx_events_venue_time on public.events using gist (venue_id, tstzrange(starts_at, ends_at, '[)'));
create trigger trg_events_updated before update on public.events
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- GAME RESULTS + PER-ATHLETE STATS
-- ===========================================================================
create table if not exists public.game_results (
  event_id      uuid primary key references public.events(id) on delete cascade,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  score_for     integer not null check (score_for >= 0),
  score_against integer not null check (score_against >= 0),
  outcome       text generated always as (
                  case when score_for > score_against then 'win'
                       when score_for < score_against then 'loss'
                       else 'draw' end) stored,
  periods       jsonb,                    -- optional per-period breakdown
  notes         text,
  recorded_by   uuid references public.profiles(id) on delete set null,
  recorded_at   timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_game_results_updated before update on public.game_results
  for each row execute function public.set_updated_at();

create table if not exists public.event_athlete_stats (
  event_id    uuid not null references public.events(id) on delete cascade,
  athlete_id  uuid not null references public.athletes(id) on delete cascade,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  stats       jsonb not null default '{}'::jsonb check (jsonb_typeof(stats) = 'object'),
  updated_at  timestamptz not null default now(),
  primary key (event_id, athlete_id)
);
create index if not exists idx_event_athlete_stats_athlete on public.event_athlete_stats(athlete_id);
create trigger trg_event_athlete_stats_updated before update on public.event_athlete_stats
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- RSVP / AVAILABILITY
-- ===========================================================================
create table if not exists public.event_rsvps (
  event_id      uuid not null references public.events(id) on delete cascade,
  athlete_id    uuid not null references public.athletes(id) on delete cascade,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  status        public.rsvp_status not null,
  note          text check (note is null or length(note) <= 500),
  responded_by  uuid references public.profiles(id) on delete set null,
  responded_at  timestamptz not null default now(),
  primary key (event_id, athlete_id)
);
create index if not exists idx_event_rsvps_athlete on public.event_rsvps(athlete_id);

-- ===========================================================================
-- INTEGRITY: every referenced row must belong to the same org
-- ===========================================================================
create or replace function public.sportsops_same_org()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_bad boolean := false;
begin
  if tg_table_name = 'venue_spaces' then
    v_bad := not exists (select 1 from public.venues where id = new.venue_id and org_id = new.org_id);
  elsif tg_table_name = 'teams' then
    v_bad := (new.season_id is not null and not exists (select 1 from public.seasons where id = new.season_id and org_id = new.org_id))
          or (new.program_id is not null and not exists (select 1 from public.programs where id = new.program_id and org_id = new.org_id));
  elsif tg_table_name = 'team_coaches' then
    v_bad := not exists (select 1 from public.teams where id = new.team_id and org_id = new.org_id)
          or not exists (select 1 from public.coaches where id = new.coach_id and org_id = new.org_id);
  elsif tg_table_name = 'team_memberships' then
    v_bad := not exists (select 1 from public.teams where id = new.team_id and org_id = new.org_id)
          or not exists (select 1 from public.athletes where id = new.athlete_id and org_id = new.org_id);
  elsif tg_table_name = 'events' then
    v_bad := (new.team_id is not null and not exists (select 1 from public.teams where id = new.team_id and org_id = new.org_id))
          or (new.season_id is not null and not exists (select 1 from public.seasons where id = new.season_id and org_id = new.org_id))
          or (new.venue_id is not null and not exists (select 1 from public.venues where id = new.venue_id and org_id = new.org_id))
          or (new.venue_space_id is not null and not exists (
                select 1 from public.venue_spaces where id = new.venue_space_id and venue_id = new.venue_id and org_id = new.org_id))
          or (new.program_session_id is not null and not exists (select 1 from public.program_sessions where id = new.program_session_id and org_id = new.org_id));
  elsif tg_table_name in ('game_results', 'event_athlete_stats', 'event_rsvps') then
    v_bad := not exists (select 1 from public.events where id = new.event_id and org_id = new.org_id);
    if not v_bad and tg_table_name in ('event_athlete_stats', 'event_rsvps') then
      v_bad := not exists (select 1 from public.athletes where id = new.athlete_id and org_id = new.org_id);
    end if;
  end if;
  if v_bad then
    raise exception 'CROSS_ORG_REFERENCE' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger trg_venue_spaces_org        before insert or update on public.venue_spaces        for each row execute function public.sportsops_same_org();
create trigger trg_teams_org               before insert or update on public.teams               for each row execute function public.sportsops_same_org();
create trigger trg_team_coaches_org        before insert or update on public.team_coaches        for each row execute function public.sportsops_same_org();
create trigger trg_team_memberships_org    before insert or update on public.team_memberships    for each row execute function public.sportsops_same_org();
create trigger trg_events_org              before insert or update on public.events              for each row execute function public.sportsops_same_org();
create trigger trg_game_results_org        before insert or update on public.game_results        for each row execute function public.sportsops_same_org();
create trigger trg_event_athlete_stats_org before insert or update on public.event_athlete_stats for each row execute function public.sportsops_same_org();
create trigger trg_event_rsvps_org         before insert or update on public.event_rsvps         for each row execute function public.sportsops_same_org();

-- Results only make sense for competitive events.
create or replace function public.game_results_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.events where id = new.event_id and type in ('game', 'tournament')) then
    raise exception 'NOT_A_GAME' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger trg_game_results_guard before insert or update on public.game_results
  for each row execute function public.game_results_guard();

-- ===========================================================================
-- RLS HELPERS (SECURITY DEFINER: no recursive RLS)
-- ===========================================================================
create or replace function public.coach_coaches_team(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_team is not null and exists (
    select 1 from public.team_coaches tc
    where tc.team_id = p_team and tc.coach_id = public.current_coach_id()
  );
$$;

create or replace function public.guardian_has_athlete_on_team(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_team is not null and exists (
    select 1
    from public.team_memberships tm
    join public.athletes a on a.id = tm.athlete_id
    join public.family_members fm on fm.family_id = a.family_id
    where tm.team_id = p_team and tm.status <> 'inactive' and fm.profile_id = auth.uid()
  );
$$;

create or replace function public.is_any_guardian()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.family_members where profile_id = auth.uid());
$$;

create or replace function public.event_team(p_event uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select team_id from public.events where id = p_event;
$$;

-- Can the caller read this event? (mirrors events_select)
create or replace function public.can_read_event(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event
      and e.org_id = public.current_org_id()
      and (
        public.is_finance()
        or public.has_role('coach')
        or (e.team_id is not null and public.guardian_has_athlete_on_team(e.team_id))
        or (e.team_id is null and public.is_any_guardian())
      )
  );
$$;

-- Can the caller manage (write) this event's sporting data?
create or replace function public.can_manage_event(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event
      and e.org_id = public.current_org_id()
      and (public.is_admin() or public.coach_coaches_team(e.team_id))
  );
$$;

-- Extend coach access to athletes on the rosters of teams they coach.
-- (Re-declares the helper from migration 03 with one additional branch.)
create or replace function public.coach_can_access_athlete(p_athlete uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.registrations r
    join public.program_sessions ps on ps.program_id = r.program_id
    where r.athlete_id = p_athlete and ps.coach_id = public.current_coach_id()
  )
  or exists (
    select 1 from public.training_bookings b
    where b.athlete_id = p_athlete and b.coach_id = public.current_coach_id()
  )
  or exists (
    select 1 from public.attendance_marks m
    join public.attendance_sessions s on s.id = m.attendance_session_id
    where m.athlete_id = p_athlete and s.coach_id = public.current_coach_id()
  )
  or exists (
    select 1 from public.team_memberships tm
    join public.team_coaches tc on tc.team_id = tm.team_id
    where tm.athlete_id = p_athlete and tc.coach_id = public.current_coach_id()
  );
$$;

-- ===========================================================================
-- RLS
-- ===========================================================================
alter table public.seasons              enable row level security;
alter table public.venues               enable row level security;
alter table public.venue_spaces         enable row level security;
alter table public.teams                enable row level security;
alter table public.team_coaches         enable row level security;
alter table public.team_memberships     enable row level security;
alter table public.events               enable row level security;
alter table public.game_results         enable row level security;
alter table public.event_athlete_stats  enable row level security;
alter table public.event_rsvps          enable row level security;

-- seasons / venues / spaces: readable org-wide, admin writes
create policy seasons_select on public.seasons for select
  using (org_id = public.current_org_id());
create policy seasons_admin_write on public.seasons for all
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());

create policy venues_select on public.venues for select
  using (org_id = public.current_org_id());
create policy venues_admin_write on public.venues for all
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());

create policy venue_spaces_select on public.venue_spaces for select
  using (org_id = public.current_org_id());
create policy venue_spaces_admin_write on public.venue_spaces for all
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());

-- teams: staff see all org teams; parents only their children's teams
create policy teams_select on public.teams for select
  using (
    org_id = public.current_org_id()
    and (public.is_finance() or public.has_role('coach') or public.guardian_has_athlete_on_team(id))
  );
create policy teams_admin_write on public.teams for all
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());

-- team_coaches: visible wherever the team is visible; admin writes
create policy team_coaches_select on public.team_coaches for select
  using (
    org_id = public.current_org_id()
    and (public.is_finance() or public.has_role('coach') or public.guardian_has_athlete_on_team(team_id))
  );
create policy team_coaches_admin_write on public.team_coaches for all
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());

-- team_memberships: staff of the team see the roster; parents see only their
-- own child's membership row (rosters of other families are not exposed).
create policy team_memberships_select on public.team_memberships for select
  using (
    org_id = public.current_org_id()
    and (
      public.is_finance()
      or public.coach_coaches_team(team_id)
      or public.is_guardian_of_athlete(athlete_id)
    )
  );
create policy team_memberships_write on public.team_memberships for all
  using (org_id = public.current_org_id() and (public.is_admin() or public.coach_coaches_team(team_id)))
  with check (org_id = public.current_org_id() and (public.is_admin() or public.coach_coaches_team(team_id)));

-- events
create policy events_select on public.events for select
  using (
    org_id = public.current_org_id()
    and (
      public.is_finance()
      or public.has_role('coach')
      or (team_id is not null and public.guardian_has_athlete_on_team(team_id))
      or (team_id is null and public.is_any_guardian())
    )
  );
create policy events_write on public.events for all
  using (org_id = public.current_org_id() and (public.is_admin() or public.coach_coaches_team(team_id)))
  with check (org_id = public.current_org_id() and (public.is_admin() or public.coach_coaches_team(team_id)));

-- game results: visible with the event; managed by admin / team coach
create policy game_results_select on public.game_results for select
  using (public.can_read_event(event_id));
create policy game_results_write on public.game_results for all
  using (public.can_manage_event(event_id))
  with check (org_id = public.current_org_id() and public.can_manage_event(event_id));

-- per-athlete stats: staff of the team + the athlete's own guardians
create policy event_athlete_stats_select on public.event_athlete_stats for select
  using (
    org_id = public.current_org_id()
    and (public.is_finance() or public.coach_coaches_team(public.event_team(event_id)) or public.is_guardian_of_athlete(athlete_id))
  );
create policy event_athlete_stats_write on public.event_athlete_stats for all
  using (public.can_manage_event(event_id))
  with check (org_id = public.current_org_id() and public.can_manage_event(event_id));

-- RSVPs: staff of the team see all; guardians see/set their own children only
create policy event_rsvps_select on public.event_rsvps for select
  using (
    org_id = public.current_org_id()
    and (
      public.is_finance()
      or public.coach_coaches_team(public.event_team(event_id))
      or public.is_guardian_of_athlete(athlete_id)
    )
  );
create policy event_rsvps_staff_write on public.event_rsvps for all
  using (public.can_manage_event(event_id))
  with check (org_id = public.current_org_id() and public.can_manage_event(event_id));
create policy event_rsvps_guardian_insert on public.event_rsvps for insert
  with check (
    org_id = public.current_org_id()
    and public.is_guardian_of_athlete(athlete_id)
    and public.can_read_event(event_id)
    and responded_by = auth.uid()
  );
create policy event_rsvps_guardian_update on public.event_rsvps for update
  using (public.is_guardian_of_athlete(athlete_id))
  with check (
    org_id = public.current_org_id()
    and public.is_guardian_of_athlete(athlete_id)
    and public.can_read_event(event_id)
    and responded_by = auth.uid()
  );

-- ===========================================================================
-- RPCs
-- ===========================================================================

-- Soft conflict check: live events overlapping [p_start, p_end) at the same
-- venue. A space-level event conflicts with whole-venue events and with the
-- same space; a whole-venue event conflicts with every event at the venue.
create or replace function public.event_conflicts(
  p_venue uuid,
  p_space uuid,
  p_start timestamptz,
  p_end   timestamptz,
  p_exclude_event uuid default null
)
returns table (
  event_id uuid, team_id uuid, team_name text, title text, type public.team_event_type,
  starts_at timestamptz, ends_at timestamptz, venue_space_id uuid, space_name text, same_space boolean
)
language sql stable security definer set search_path = public as $$
  select e.id, e.team_id, t.name, e.title, e.type, e.starts_at, e.ends_at, e.venue_space_id, vs.name,
         (p_space is not null and e.venue_space_id = p_space)
  from public.events e
  left join public.teams t on t.id = e.team_id
  left join public.venue_spaces vs on vs.id = e.venue_space_id
  where p_venue is not null
    and e.org_id = public.current_org_id()
    and (public.is_finance() or public.has_role('coach'))
    and e.venue_id = p_venue
    and e.status in ('scheduled', 'postponed')
    and (p_exclude_event is null or e.id <> p_exclude_event)
    and tstzrange(e.starts_at, e.ends_at, '[)') && tstzrange(p_start, p_end, '[)')
    and (p_space is null or e.venue_space_id is null or e.venue_space_id = p_space)
  order by e.starts_at;
$$;

-- Parent / coach / admin sets an RSVP. Guardians only for their own children,
-- only for events of teams the child is on (or club-wide events), never for
-- cancelled or finished events.
create or replace function public.set_event_rsvp(
  p_event uuid,
  p_athlete uuid,
  p_status public.rsvp_status,
  p_note text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ev public.events%rowtype;
begin
  select * into v_ev from public.events where id = p_event;
  if not found or v_ev.org_id is distinct from public.current_org_id() then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (public.can_manage_event(p_event) or public.is_guardian_of_athlete(p_athlete)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if v_ev.team_id is not null and not exists (
    select 1 from public.team_memberships
    where team_id = v_ev.team_id and athlete_id = p_athlete and status <> 'inactive'
  ) then
    raise exception 'NOT_ON_TEAM' using errcode = 'P0001';
  end if;
  if v_ev.status in ('cancelled', 'completed') or v_ev.ends_at < now() then
    raise exception 'EVENT_CLOSED' using errcode = 'P0001';
  end if;

  insert into public.event_rsvps (event_id, athlete_id, org_id, status, note, responded_by, responded_at)
  values (p_event, p_athlete, v_ev.org_id, p_status, nullif(btrim(p_note), ''), auth.uid(), now())
  on conflict (event_id, athlete_id) do update
    set status = excluded.status, note = excluded.note,
        responded_by = excluded.responded_by, responded_at = excluded.responded_at;

  return jsonb_build_object('event_id', p_event, 'athlete_id', p_athlete, 'status', p_status);
end;
$$;

-- Record (or correct) a final score; marks the event completed.
create or replace function public.record_game_result(
  p_event uuid,
  p_score_for integer,
  p_score_against integer,
  p_notes text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  if not public.can_manage_event(p_event) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select org_id into v_org from public.events where id = p_event;
  insert into public.game_results (event_id, org_id, score_for, score_against, notes, recorded_by)
  values (p_event, v_org, p_score_for, p_score_against, nullif(btrim(p_notes), ''), auth.uid())
  on conflict (event_id) do update
    set score_for = excluded.score_for, score_against = excluded.score_against,
        notes = excluded.notes, recorded_by = excluded.recorded_by, recorded_at = now();
  update public.events set status = 'completed' where id = p_event and status <> 'completed';
  return jsonb_build_object('event_id', p_event, 'score_for', p_score_for, 'score_against', p_score_against);
end;
$$;

-- ---- Grants ----------------------------------------------------------------
grant select, insert, update, delete on
  public.seasons, public.venues, public.venue_spaces, public.teams, public.team_coaches,
  public.team_memberships, public.events, public.game_results, public.event_athlete_stats,
  public.event_rsvps
to authenticated;
grant all on
  public.seasons, public.venues, public.venue_spaces, public.teams, public.team_coaches,
  public.team_memberships, public.events, public.game_results, public.event_athlete_stats,
  public.event_rsvps
to service_role;

revoke all on function public.event_conflicts(uuid, uuid, timestamptz, timestamptz, uuid) from public, anon;
revoke all on function public.set_event_rsvp(uuid, uuid, public.rsvp_status, text) from public, anon;
revoke all on function public.record_game_result(uuid, integer, integer, text) from public, anon;
grant execute on function public.event_conflicts(uuid, uuid, timestamptz, timestamptz, uuid) to authenticated, service_role;
grant execute on function public.set_event_rsvp(uuid, uuid, public.rsvp_status, text) to authenticated, service_role;
grant execute on function public.record_game_result(uuid, integer, integer, text) to authenticated, service_role;

-- ---- Audit: results and rosters are club records -----------------------------
create trigger trg_audit_game_results     after insert or update or delete on public.game_results     for each row execute function public.audit_trigger();
create trigger trg_audit_team_memberships after insert or update or delete on public.team_memberships for each row execute function public.audit_trigger();
