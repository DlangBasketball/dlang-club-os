-- ============================================================================
-- Teams / seasons / schedule — RLS + integrity tests
-- (migration 20250420092000_teams_seasons_schedule.sql)
--
-- Run against a scratch database after all migrations. Needs Supabase-like
-- stubs: auth.users, auth.uid() reading the `request.jwt.claim.sub` setting,
-- and an `authenticated` role. Every check raises on failure; the script
-- ends with "SPORTSOPS RLS: ALL PASS" and rolls everything back.
--
--   psql -v ON_ERROR_STOP=1 -f testing/sportsops_rls_test.sql
-- ============================================================================
begin;

-- ---- Fixtures (as superuser) -----------------------------------------------
insert into public.organizations (id, name, slug) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Org A', 'org-a-test'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Org B', 'org-b-test');

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000a1', 'admin@a.test'),
  ('a0000000-0000-0000-0000-0000000000c1', 'coach@a.test'),
  ('a0000000-0000-0000-0000-0000000000c2', 'coach2@a.test'),
  ('a0000000-0000-0000-0000-0000000000f1', 'parent@a.test'),
  ('a0000000-0000-0000-0000-0000000000f2', 'parent2@a.test'),
  ('b0000000-0000-0000-0000-0000000000a1', 'admin@b.test');

-- handle_new_user may already have created profiles in the first org
insert into public.profiles (id, org_id, email) values
  ('a0000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'admin@a.test'),
  ('a0000000-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'coach@a.test'),
  ('a0000000-0000-0000-0000-0000000000c2', 'aaaaaaaa-0000-0000-0000-000000000001', 'coach2@a.test'),
  ('a0000000-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent@a.test'),
  ('a0000000-0000-0000-0000-0000000000f2', 'aaaaaaaa-0000-0000-0000-000000000001', 'parent2@a.test'),
  ('b0000000-0000-0000-0000-0000000000a1', 'bbbbbbbb-0000-0000-0000-000000000001', 'admin@b.test')
on conflict (id) do update set org_id = excluded.org_id;

insert into public.staff_roles (org_id, profile_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a1', 'admin'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000c1', 'coach'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000c2', 'coach'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000a1', 'admin');

insert into public.coaches (id, org_id, profile_id, display_name) values
  ('c0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000c1', 'Coach One'),
  ('c0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000c2', 'Coach Two');

insert into public.families (id, org_id, name) values
  ('f0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Family One'),
  ('f0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Family Two');
insert into public.family_members (family_id, profile_id) values
  ('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000f1'),
  ('f0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-0000000000f2');

insert into public.athletes (id, org_id, family_id, first_name, last_name, dob) values
  ('e0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'Kid', 'One', '2014-03-01'),
  ('e0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002', 'Kid', 'Two', '2014-05-01'),
  ('e0000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002', 'Kid', 'Three', '2010-05-01');

insert into public.seasons (id, org_id, name, starts_on, ends_on, is_current) values
  ('50000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-27', '2026-08-17', '2027-06-30', true);
insert into public.venues (id, org_id, name, capacity) values
  ('d0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Main Arena', 400),
  ('d0000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000001', 'B Gym', 100);
insert into public.venue_spaces (id, org_id, venue_id, name) values
  ('d1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Court A'),
  ('d1000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Court B');

insert into public.teams (id, org_id, season_id, name, sport, age_group) values
  ('70000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'U12 A', 'basketball', 'U12'),
  ('70000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'U16 A', 'basketball', 'U16');
insert into public.team_coaches (team_id, coach_id, org_id) values
  ('70000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('70000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001');
insert into public.team_memberships (org_id, team_id, athlete_id, jersey_number) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 7),
  ('aaaaaaaa-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 8),
  ('aaaaaaaa-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000003', 7);

insert into public.events (id, org_id, team_id, type, venue_id, venue_space_id, starts_at, ends_at) values
  ('ee000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'training',
   'd0000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', now() + interval '2 days', now() + interval '2 days 90 minutes'),
  ('ee000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', 'game',
   'd0000000-0000-0000-0000-000000000001', null, now() + interval '3 days', now() + interval '3 days 2 hours');

-- ---- Integrity -----------------------------------------------------------------
do $$ begin
  -- duplicate jersey on same team
  begin
    insert into public.team_memberships (org_id, team_id, athlete_id, jersey_number)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001', 7);
    raise exception 'FAIL: duplicate jersey accepted';
  exception when unique_violation then null; end;

  -- same court, overlapping time -> hard conflict
  begin
    insert into public.events (org_id, team_id, venue_id, venue_space_id, starts_at, ends_at)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002',
            'd0000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001',
            now() + interval '2 days 30 minutes', now() + interval '2 days 2 hours');
    raise exception 'FAIL: overlapping court booking accepted';
  exception when exclusion_violation then null; end;

  -- other court same time is fine; cross-org venue is rejected
  insert into public.events (org_id, team_id, venue_id, venue_space_id, starts_at, ends_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002',
          'd0000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002',
          now() + interval '2 days 30 minutes', now() + interval '2 days 2 hours');
  begin
    insert into public.events (org_id, team_id, venue_id, starts_at, ends_at)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001',
            'd0000000-0000-0000-0000-0000000000b1', now(), now() + interval '1 hour');
    raise exception 'FAIL: cross-org venue accepted';
  exception when check_violation then null; end;

  -- results only on games
  begin
    insert into public.game_results (event_id, org_id, score_for, score_against)
    values ('ee000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 1, 0);
    raise exception 'FAIL: result on training accepted';
  exception when check_violation then null; end;
  raise notice 'PASS integrity';
end $$;

-- ---- Helpers to impersonate -------------------------------------------------------
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.as_super() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- ---- Admin A -----------------------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000a1');
do $$ declare n int; begin
  select count(*) into n from public.teams;          if n <> 2 then raise exception 'FAIL admin teams %', n; end if;
  select count(*) into n from public.venues;         if n <> 1 then raise exception 'FAIL admin venues (cross-org leak?) %', n; end if;
  select count(*) into n from public.events;         if n <> 3 then raise exception 'FAIL admin events %', n; end if;
  -- soft conflicts: whole-venue game overlaps nothing on day 2, court events overlap each other's venue
  select count(*) into n from public.event_conflicts('d0000000-0000-0000-0000-000000000001', null, now() + interval '2 days', now() + interval '2 days 1 hour');
  if n <> 2 then raise exception 'FAIL conflicts whole venue %', n; end if;
  select count(*) into n from public.event_conflicts('d0000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', now() + interval '3 days', now() + interval '3 days 1 hour');
  if n <> 1 then raise exception 'FAIL conflicts vs whole-venue game %', n; end if;
  insert into public.seasons (org_id, name, starts_on, ends_on) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Summer 2027', '2027-07-01', '2027-08-15');
  raise notice 'PASS admin';
end $$;
select pg_temp.as_super();

-- ---- Admin B sees nothing of org A ----------------------------------------------------
select pg_temp.as_user('b0000000-0000-0000-0000-0000000000a1');
do $$ declare n int; begin
  select count(*) into n from public.teams;  if n <> 0 then raise exception 'FAIL cross-org teams %', n; end if;
  select count(*) into n from public.events; if n <> 0 then raise exception 'FAIL cross-org events %', n; end if;
  select count(*) into n from public.team_memberships; if n <> 0 then raise exception 'FAIL cross-org roster %', n; end if;
  begin
    insert into public.teams (org_id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Hijack');
    raise exception 'FAIL cross-org team insert';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS tenant isolation';
end $$;
select pg_temp.as_super();

-- ---- Coach One (team U12 only) -----------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000c1');
do $$ declare n int; begin
  select count(*) into n from public.team_memberships; if n <> 2 then raise exception 'FAIL coach roster %', n; end if;
  -- coach can now see roster athletes via coach_can_access_athlete
  if not public.coach_can_access_athlete('e0000000-0000-0000-0000-000000000002') then raise exception 'FAIL coach athlete access'; end if;
  if public.coach_can_access_athlete('e0000000-0000-0000-0000-000000000003') then raise exception 'FAIL coach sees other team athlete'; end if;
  -- create event for own team
  insert into public.events (org_id, team_id, type, starts_at, ends_at, location_text)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'game', now() + interval '5 days', now() + interval '5 days 2 hours', 'Away gym');
  -- cannot create for another team
  begin
    insert into public.events (org_id, team_id, starts_at, ends_at)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', now() + interval '6 days', now() + interval '6 days 1 hour');
    raise exception 'FAIL coach wrote other team event';
  exception when insufficient_privilege then null; end;
  -- cannot record a result for the other team's game
  begin
    perform public.record_game_result('ee000000-0000-0000-0000-000000000002', 60, 50);
    raise exception 'FAIL coach recorded other team result';
  exception when raise_exception then
    if sqlerrm <> 'NOT_AUTHORIZED' then raise; end if;
  end;
  -- RSVP on behalf of own athlete
  perform public.set_event_rsvp('ee000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 'maybe');
  raise notice 'PASS coach';
end $$;
select pg_temp.as_super();

-- ---- Parent One (child on U12) -------------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000f1');
do $$ declare n int; begin
  select count(*) into n from public.teams;  if n <> 1 then raise exception 'FAIL parent teams %', n; end if;
  select count(*) into n from public.events where team_id = '70000000-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'FAIL parent sees other team events'; end if;
  select count(*) into n from public.team_memberships; if n <> 1 then raise exception 'FAIL parent sees roster %', n; end if;
  perform public.set_event_rsvp('ee000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'going', 'Will be 10 min late');
  select count(*) into n from public.event_rsvps; if n <> 1 then raise exception 'FAIL parent rsvp visibility %', n; end if;
  -- cannot RSVP for someone else's child
  begin
    perform public.set_event_rsvp('ee000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 'not_going');
    raise exception 'FAIL parent rsvp for other child';
  exception when raise_exception then
    if sqlerrm <> 'NOT_AUTHORIZED' then raise; end if;
  end;
  begin
    insert into public.event_rsvps (event_id, athlete_id, org_id, status, responded_by)
    values ('ee000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'not_going', auth.uid());
    raise exception 'FAIL parent direct rsvp for other child';
  exception when insufficient_privilege then null; end;
  -- cannot create events
  begin
    insert into public.events (org_id, team_id, starts_at, ends_at)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', now(), now() + interval '1 hour');
    raise exception 'FAIL parent created event';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS parent';
end $$;
select pg_temp.as_super();

-- ---- Parent Two (child on U12 and child on U16) ---------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-0000000000f2');
do $$ declare n int; begin
  select count(*) into n from public.teams;  if n <> 2 then raise exception 'FAIL parent2 teams %', n; end if;
  -- sees the coach's "maybe" for their own child, not Parent One's RSVP
  select count(*) into n from public.event_rsvps; if n <> 1 then raise exception 'FAIL parent2 rsvps %', n; end if;
  raise notice 'PASS parent2';
end $$;
select pg_temp.as_super();

do $$ begin raise notice 'SPORTSOPS RLS: ALL PASS'; end $$;
rollback;
